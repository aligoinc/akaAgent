// Kiểm đầu-cuối đẩy quản trị viên group vào hai Nhóm data (UID / SĐT) bằng dữ liệu thật, theo lô (docs/FIND_DATA_GROUP_ADMIN_DATA_GROUPS.md).
// Luồng: cài đặt chiến dịch do form thật lưu (run-form-group-admin-ui-smoke.cjs, E2E_FORM_OUT) → tạo Nhóm data bằng hàm thật của app
// (dataGroupRepository.createDataGroup → aka_agent_create_data_group_v2) → lượt "Tìm data" (dữ liệu quét thật) qua
// CampaignScheduler.logMilestonesV2 thật → dataGroupRepository.ingestDataGroup thật → aka_agent_ingest_data_group như production.
// Bộ kiểm độc lập tự tính tập UID / SĐT đúng sau mỗi lô rồi so với thành viên Nhóm data trong DB.
//   PG_MODULE=<…/node_modules/pg> node scripts/find-data-push/e2e-group-admin-realdata.cjs <cluster.json> <realdata.json> <form-out.json>
// cluster.json: e2e-admin-cluster.py; realdata.json: xuất CHỈ ĐỌC từ production (không commit).
const fs = require('node:fs')
const path = require('node:path')
const { createLoader, loadScheduler, root } = require('./load-scheduler.cjs')
const { Client } = require(process.env.PG_MODULE || 'pg')

const [clusterFile, realFile, formFile] = process.argv.slice(2)
const cluster = JSON.parse(fs.readFileSync(clusterFile, 'utf8'))
const real = JSON.parse(fs.readFileSync(realFile, 'utf8'))
const formOut = JSON.parse(fs.readFileSync(formFile, 'utf8'))
const STAFF = 4
const ORG = 1
const ACCOUNT = 135
const CREDS = { username: 'e2e-admin', password: 'e2e-secret' }

const problems = []
let passed = 0
const check = (ok, label, info) => {
  if (ok) { passed += 1; console.log(`PASS ${label}`) } else { problems.push(label); console.log(`FAIL ${label}\n  ${JSON.stringify(info).slice(0, 1600)}`) }
}

// ---------------------------------------------------------------- bộ kiểm độc lập (không dùng hàm dựng dòng)
const VN_MOBILE = value => {
  let d = String(value ?? '').replace(/[^\d+]/g, '')
  if (d.startsWith('+84')) d = `0${d.slice(3)}`
  else if (d.startsWith('84')) d = `0${d.slice(2)}`
  d = d.replace(/\D/g, '')
  return /^0[35789]\d{8}$/.test(d) ? d : ''
}
const adminIdOf = a => {
  const uid = String(a.uid ?? '').trim()
  if (/^\d{5,30}$/.test(uid)) return uid
  const m = /[?&]id=(\d{5,30})(?:&|$)/.exec(String(a.url ?? ''))
  return m ? m[1] : ''
}
function expectedOfRun(groups, ownUid) {
  const uidKeys = new Set()
  const phoneOwners = new Map()
  for (const g of groups) {
    if (g.adminScan !== 'listed') continue
    for (const a of g.admins || []) {
      const id = adminIdOf(a)
      const url = String(a.url || '').trim()
      if (!id && !/^https:\/\/(?:www\.|m\.|web\.)?facebook\.com\//i.test(url)) continue
      if (!a.name && !id) continue
      if (ownUid && id === ownUid) continue
      const key = id || canonicalProfileUrl(url)
      if (!key) continue
      uidKeys.add(key)
      for (const p of a.phones || []) { const n = VN_MOBILE(p); if (n) phoneOwners.set(n, true) }
    }
  }
  return { uids: uidKeys, phones: new Set(phoneOwners.keys()) }
}
function canonicalProfileUrl(url) {
  try {
    const u = new URL(url)
    if (u.pathname === '/profile.php') return /^\d{1,30}$/.test(u.searchParams.get('id') || '') ? u.searchParams.get('id') : ''
    const seg = u.pathname.split('/').filter(Boolean)[0] || ''
    return /^[A-Za-z0-9.\-_]{1,100}$/.test(seg) ? `https://www.facebook.com/${seg}` : ''
  } catch { return '' }
}

;(async () => {
  const db = new Client({ host: cluster.dir, port: cluster.port, user: 'postgres', database: 'postgres' })
  await db.connect()
  const q = (sql, params) => db.query(sql, params)

  // ---------------------------------------------------------------- dữ liệu nền (thật)
  // Hàm có sẵn trên Supabase mà cụm cục bộ chưa có.
  await q(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
    $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$`)
  await q('SET session_replication_role = replica')
  await q('DELETE FROM public.category_item'); await q('DELETE FROM public.category_type')
  await q(`INSERT INTO public.category_type SELECT (jsonb_populate_record(NULL::public.category_type, x)).* FROM jsonb_array_elements($1::jsonb) x`, [JSON.stringify(real.cat_types)])
  await q(`INSERT INTO public.category_item SELECT (jsonb_populate_record(NULL::public.category_item, x)).* FROM jsonb_array_elements($1::jsonb) x`, [JSON.stringify(real.cat_items)])
  await q(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'e2e') ON CONFLICT (id) DO NOTHING`, [ORG]).catch(() => {})
  await q(`INSERT INTO public.org_staff (id, organization_id, name, username, password, is_active) VALUES ($1,$2,'e2e',$3,$4,true)
    ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, password = EXCLUDED.password, is_active = true, organization_id = EXCLUDED.organization_id`,
  [STAFF, ORG, CREDS.username, CREDS.password])
  const realAccount = real.accounts[0]
  await q(`INSERT INTO public.auto_accounts (id, staff_id, organization_id, flatform_type, facebook_uid, name, is_delete) VALUES ($1,$2,$3,'facebook',$4,'fb e2e',false)
    ON CONFLICT (id) DO UPDATE SET facebook_uid = EXCLUDED.facebook_uid`, [ACCOUNT, STAFF, ORG, realAccount.facebook_uid])
  await q('SET session_replication_role = origin')
  const ownUid = String(realAccount.facebook_uid || '')

  // ---------------------------------------------------------------- mã thật của app
  const rpcCalls = []
  const rpc = async (name, params) => {
    const keys = Object.keys(params)
    const sql = `SELECT to_jsonb(r) AS r FROM public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`
    const values = keys.map(k => (params[k] !== null && typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]))
    rpcCalls.push(name)
    try {
      const r = await db.query(sql, values)
      let data = r.rows.map(row => row.r)
      // Hàm trả một giá trị (jsonb / scalar) thì PostgREST trả thẳng giá trị.
      if (data.length === 1 && data[0] && typeof data[0] === 'object' && name in data[0]) data = data[0][name]
      return { data, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message, code: error.code, details: error.detail, hint: error.hint } }
    }
  }
  const load = createLoader({
    '../supabaseClient': { getSupabaseClient: () => ({ rpc }) },
    '../currentUser': {
      requireCurrentUser: () => ({ staffId: STAFF, organizationId: ORG }),
      requireCurrentUserCredentials: () => CREDS
    }
  })
  const repo = load(path.join(root, 'src/main/data/repositories/dataGroupRepository.ts'))
  const listDataTypes = async () => (await q(`SELECT i.id, i.code, i.name, i.sort_order, i.is_active FROM public.category_item i
      JOIN public.category_type t ON t.id = i.category_type_id
      WHERE t.namespace = 'common' AND t.code = 'data_type' AND t.managed_by = 'system' AND t.is_active AND i.managed_by = 'system' AND i.is_active
      ORDER BY i.sort_order, i.id`)).rows.map(r => ({ id: Number(r.id), code: r.code, name: r.name, isActive: r.is_active !== false }))
  const types = await listDataTypes()
  const typeId = code => types.find(t => t.code === code)?.id
  check(typeId('facebook_person') && typeId('phone'), 'danh mục loại dữ liệu thật có User Facebook và Số điện thoại', { types: types.map(t => t.code) })

  // ---------------------------------------------------------------- bước 1: tạo nhóm như form (Tạo nhóm mới) rồi lưu chiến dịch
  const groupIdMap = new Map()
  for (const request of formOut.createDataGroup) {
    const created = await repo.createDataGroup({ ...request, dataTypeCategoryItemId: typeId(request.dataTypeCode) })
    groupIdMap.set(request.fakeGroupId, created)
  }
  const uidGroup = groupIdMap.get(formOut.campaign.extraSettings.findDataTargetDataGroups.facebook_group_admin_uid.groupId)
  const phoneGroup = groupIdMap.get(formOut.campaign.extraSettings.findDataTargetDataGroups.facebook_group_admin_phone.groupId)
  check(uidGroup?.id > 0 && phoneGroup?.id > 0, 'tạo hai Nhóm data bằng hàm thật (aka_agent_create_data_group_v2)', { uidGroup, phoneGroup })
  const sourceCampaign = real.campaigns[0]
  const extraSettings = {
    ...sourceCampaign.extra_settings,
    ...formOut.campaign.extraSettings,
    findDataTargetDataGroups: {
      facebook_group_admin_uid: { groupId: uidGroup.id, groupName: uidGroup.name },
      facebook_group_admin_phone: { groupId: phoneGroup.id, groupName: phoneGroup.name }
    }
  }
  const campaign = { id: sourceCampaign.id, name: sourceCampaign.name, actionId: 'facebook_find_data_search', staffId: STAFF, organizationId: ORG, accountId: ACCOUNT, extraSettings }

  // ---------------------------------------------------------------- bộ lập lịch thật
  const { CampaignScheduler } = loadScheduler({
    '../data/repositories/entitlementRepository': { ensureCurrentUserCanUseCampaignAction: async () => {}, getAccountActionDailySendLimit: () => null, loadCurrentUserEffectiveEntitlements: async () => null },
    '../data/repositories/findDataPushRepository': { FindDataPushError: class FindDataPushError extends Error {} }
  })
  const scheduler = Object.create(CampaignScheduler.prototype)
  Object.assign(scheduler, { running: true, runtimeTarget: 'desktop', findDataPushWarnings: new Map(), facebookEngineSinks: new Map(), facebookEngineProgress: new Map(),
    mainWindow: { webContents: { send() {} } }, logSinks: [], emitLog() {}, broadcastCampaignUpdate() {} })
  const progress = []
  const details = []
  let failTypesOnce = 0
  let loseResponseOnce = 0
  const lostRequestIds = []
  scheduler.logCampaignProgress = async (_c, message) => { progress.push(message) }
  scheduler.supabase = {
    createCampaignDetail: async action => { const d = { id: 9_100_000 + details.length, ...action, createdAt: new Date().toISOString() }; details.push(d); return d },
    listCampaignDetailsByCampaign: async id => details.filter(d => d.campaignId === id).slice(-500).reverse(),
    listCampaignDetailsByInputData: async id => details.filter(d => d.inputDataId === id),
    listDataTypeCategoryItems: async () => { if (failTypesOnce > 0) { failTypesOnce -= 1; throw new Error('fetch failed') } return listDataTypes() },
    ingestDataGroup: async request => {
      const result = await repo.ingestDataGroup(request)
      // Ca mất câu trả lời: DB đã ghi xong mà app nhận lỗi mạng (lô 10).
      if (loseResponseOnce > 0) { loseResponseOnce -= 1; lostRequestIds.push(request.requestId); throw new Error('fetch failed') }
      return result
    },
    getAccount: async id => { const r = await q('SELECT id, facebook_uid FROM public.auto_accounts WHERE id = $1', [id]); return r.rows[0] ? { id: Number(r.rows[0].id), facebookUid: r.rows[0].facebook_uid } : null },
    getCampaign: async () => campaign,
    pushFindDataToLinkedCampaigns: async () => { throw Object.assign(new Error('no V608 here'), { code: 'PGRST202' }) }
  }

  const members = async groupId => (await q(`SELECT c.contact_type, c.uid, c.phone, c.name, c.extra_data
      FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id = m.contact_id
      WHERE m.group_id = $1 AND COALESCE(m.is_delete, false) = false`, [groupId])).rows
  const cumulative = { uids: new Set(), phones: new Set() }
  let inputSeq = 1
  async function runOnce(label, groups, opts = {}) {
    const exp = expectedOfRun(groups, ownUid)
    const newUids = [...exp.uids].filter(k => !cumulative.uids.has(k))
    const newPhones = [...exp.phones].filter(k => !cumulative.phones.has(k))
    const progressFrom = progress.length
    const step = { id: 77_000 + inputSeq, nodeId: 'summary', blockName: 'fb_find_search_data_summary', status: 'success',
      output: { facebookGroups: groups, searchKeyword: opts.keyword || 'kw', uids: [], phones: [], postLinks: [], linkGroupZalos: [] } }
    const inputData = { id: 800_000 + inputSeq, campaignId: campaign.id, uid: opts.keyword || 'kw', name: opts.keyword || 'kw' }
    inputSeq += 1
    let error = null
    try { await scheduler.logMilestonesV2(campaign, inputData, ACCOUNT, [step], true, [], undefined) } catch (e) { error = e }
    check(!error, `${label}: chạy không ngoại lệ`, { error: String(error?.stack || error).slice(0, 600) })
    for (const k of exp.uids) cumulative.uids.add(k)
    for (const k of exp.phones) cumulative.phones.add(k)
    const uidRows = await members(uidGroup.id)
    const phoneRows = await members(phoneGroup.id)
    const dbUids = new Set(uidRows.map(r => (/^\d+$/.test(String(r.uid)) ? String(r.uid) : canonicalProfileUrl(r.uid || '') || String(r.uid))))
    const dbPhones = new Set(phoneRows.map(r => VN_MOBILE(r.phone)))
    const missUid = [...cumulative.uids].filter(k => !dbUids.has(k))
    const extraUid = [...dbUids].filter(k => !cumulative.uids.has(k))
    const missPhone = [...cumulative.phones].filter(k => !dbPhones.has(k))
    const extraPhone = [...dbPhones].filter(k => !cumulative.phones.has(k))
    check(missUid.length === 0 && extraUid.length === 0 && uidRows.length === cumulative.uids.size,
      `${label}: Nhóm UID có đúng ${cumulative.uids.size} quản trị viên (lô này ${exp.uids.size}, mới ${newUids.length})`,
      { missUid: missUid.slice(0, 5), extraUid: extraUid.slice(0, 5), rows: uidRows.length })
    check(missPhone.length === 0 && extraPhone.length === 0 && phoneRows.length === cumulative.phones.size,
      `${label}: Nhóm SĐT có đúng ${cumulative.phones.size} số (lô này ${exp.phones.size}, mới ${newPhones.length})`,
      { missPhone: missPhone.slice(0, 5), extraPhone: extraPhone.slice(0, 5), rows: phoneRows.length })
    check(!dbUids.has(ownUid) || !ownUid, `${label}: không có tài khoản chạy chiến dịch trong nhóm UID`, {})
    const lines = progress.slice(progressFrom)
    const uidLine = lines.find(l => l.includes('quản trị viên group (UID)'))
    const phoneLine = lines.find(l => l.includes('SĐT quản trị viên group'))
    if (exp.uids.size > 0) {
      const m = /Đã đẩy (\d+) quản trị viên group \(UID\) sang Nhóm data "[^"]+" \((\d+) mới(?: · (\d+) đã có)?/.exec(uidLine || '')
      check(m && Number(m[1]) === exp.uids.size && Number(m[2]) === newUids.length && Number(m[3] || 0) === exp.uids.size - newUids.length,
        `${label}: câu tiến trình UID đúng số`, { uidLine, expected: [exp.uids.size, newUids.length] })
    } else check(!uidLine, `${label}: không có quản trị viên thì không in dòng UID`, { uidLine })
    if (exp.phones.size > 0) {
      const m = /Đã đẩy (\d+) SĐT quản trị viên group sang Nhóm data "[^"]+" \((\d+) mới(?: · (\d+) đã có)?/.exec(phoneLine || '')
      check(m && Number(m[1]) === exp.phones.size && Number(m[2]) === newPhones.length, `${label}: câu tiến trình SĐT đúng số`, { phoneLine, expected: [exp.phones.size, newPhones.length] })
    } else check(!phoneLine, `${label}: không có SĐT thì không in dòng SĐT`, { phoneLine })
    const warn = lines.filter(l => l.startsWith('⚠️'))
    if (!opts.expectWarning) check(warn.length === 0, `${label}: không có cảnh báo`, { warn })
    return { lines, uidRows, phoneRows }
  }

  // ---------------------------------------------------------------- lô 1: 3 lượt thật có quản trị viên (chiến dịch thử 58476 / 58486)
  for (const d of real.admin_details) {
    if (!Array.isArray(d.facebookGroups) || d.facebookGroups.length === 0) continue
    await runOnce(`Lô 1 lượt thật ${d.id}`, d.facebookGroups)
  }
  // ---------------------------------------------------------------- lô 2: chạy lại y hệt (đã có hết)
  const firstReal = real.admin_details.find(d => d.facebookGroups?.length)
  await runOnce('Lô 2 chạy lại lượt thật', firstReal.facebookGroups)

  // ---------------------------------------------------------------- lô 3–5: group thật + người thật từ data quét được, nhiều cách viết SĐT / link
  const people = real.uid_profiles.filter(p => p && (p.uid || p.url))
  const phones = [...real.phone_profiles.map(p => p.phone), ...real.raw_phones].filter(Boolean)
  const formats = [p => p, p => p.replace(/^0/, '+84'), p => p.replace(/^0/, '84 '), p => p.replace(/(\d{4})(\d{3})(\d{3})/, '$1.$2.$3'), p => p.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3')]
  let seed = 12345
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  const makeAdmin = i => {
    const p = people[i % people.length]
    const uid = /^\d{5,30}$/.test(String(p.uid || '')) ? String(p.uid) : ''
    const url = uid ? (rnd(3) === 0 ? `https://m.facebook.com/profile.php?id=${uid}` : `https://www.facebook.com/profile.php?id=${uid}`) : (p.url || '')
    const ph = rnd(3) === 0 ? [] : [formats[rnd(formats.length)](phones[rnd(phones.length)])]
    if (rnd(10) === 0) ph.push(phones[rnd(phones.length)])
    return { name: p.name || '', uid, url, phones: ph, emails: rnd(5) === 0 ? ['x@example.com'] : [], profileRead: rnd(4) !== 0 }
  }
  const lots = [
    { label: 'Lô 3 (100 group thật, 4–6 quản trị viên)', groups: 100, per: [4, 6], start: 0 },
    { label: 'Lô 4 (200 group thật, người trùng lô 3, có tài khoản chạy chiến dịch)', groups: 200, per: [2, 8], start: 150, own: true },
    { label: 'Lô 5 (300 group thật, group riêng tư / chưa đọc được xen kẽ)', groups: 300, per: [1, 5], start: 300, mixed: true }
  ]
  let personCursor = 0
  for (const lot of lots) {
    const groups = real.groups.slice(lot.start, lot.start + lot.groups).map((g, gi) => {
      const scan = lot.mixed && gi % 7 === 0 ? 'not_listed' : lot.mixed && gi % 11 === 0 ? 'failed' : 'listed'
      const count = lot.per[0] + rnd(lot.per[1] - lot.per[0] + 1)
      const admins = scan === 'listed' ? Array.from({ length: count }, () => makeAdmin(personCursor++ % (people.length + 60))) : []
      if (lot.own && gi % 25 === 0) admins.push({ name: 'Tài khoản chạy', uid: ownUid, url: `https://www.facebook.com/profile.php?id=${ownUid}`, phones: ['0912345678'], emails: [], profileRead: true })
      return { url: g.url, name: g.name, keyword: g.keyword || 'kw', adminScan: scan, admins }
    })
    // Chia mỗi lô thành nhiều lượt như bộ chạy gặp (mỗi lượt một trang kết quả ~20 group).
    for (let i = 0; i < groups.length; i += 20) await runOnce(`${lot.label} lượt ${i / 20 + 1}`, groups.slice(i, i + 20))
  }

  // ---------------------------------------------------------------- lô 6: lỗi mạng khi đọc danh mục loại dữ liệu (tự gửi lại)
  failTypesOnce = 1
  await runOnce('Lô 6 lỗi mạng tạm thời', real.groups.slice(700, 710).map(g => ({ url: g.url, name: g.name, adminScan: 'listed', admins: [makeAdmin(personCursor++), makeAdmin(personCursor++)] })))

  // Người mới (chưa có trong nhóm) để DB phải xét loại nhóm: UID dạng thật, không trùng người đã có.
  const freshAdmin = i => ({ name: `Quản trị viên mới ${i}`, uid: String(61550000000000 + i), url: `https://www.facebook.com/profile.php?id=${61550000000000 + i}`, phones: [], emails: [], profileRead: true })
  // ---------------------------------------------------------------- lô 9: lượt lớn nhất có thể (20 group × 200 quản trị viên, trần của block)
  const bigGroups = real.groups.slice(750, 770).map((g, gi) => ({ url: g.url, name: g.name, keyword: 'kw', adminScan: 'listed',
    admins: Array.from({ length: 200 }, (_, i) => {
      const n = 10_000 + gi * 200 + i
      return { ...freshAdmin(n), phones: i % 3 === 0 ? [formats[i % formats.length](`09${String(10_000_000 + n).slice(-8)}`)] : [] }
    }) }))
  const t9 = Date.now()
  await runOnce('Lô 9 lượt lớn (4.000 quản trị viên)', bigGroups)
  console.log(`  lô 9: ${Date.now() - t9} ms`)
  check(Date.now() - t9 < 60_000, 'Lô 9: dưới trần 60 giây của hàm nạp', { ms: Date.now() - t9 })

  // ---------------------------------------------------------------- lô 10: DB đã ghi mà mất câu trả lời → gửi lại cùng mã, không thêm trùng
  loseResponseOnce = 2
  const callsBefore10 = rpcCalls.length
  await runOnce('Lô 10 mất câu trả lời sau khi DB đã ghi', real.groups.slice(780, 790).map((g, gi) => ({ url: g.url, name: g.name, adminScan: 'listed',
    admins: [freshAdmin(90_000 + gi * 2), { ...freshAdmin(90_001 + gi * 2), phones: [`09${String(20_000_000 + gi).slice(-8)}`] }] })))
  const ingests10 = rpcCalls.slice(callsBefore10).filter(n => n === 'aka_agent_ingest_data_group').length
  check(lostRequestIds.length === 2 && ingests10 === 4, 'Lô 10: mỗi nhóm gửi lại đúng một lần cùng mã yêu cầu', { lostRequestIds, ingests10 })

  // ---------------------------------------------------------------- lô 7: nhóm SĐT bị xoá giữa chừng → cảnh báo, nhóm UID vẫn nhận
  await repo.deleteDataGroup(phoneGroup.id, `e2e-del-${Date.now()}`, false).catch(e => { throw new Error('xoá nhóm: ' + e.message) })
  const before7 = cumulative.phones.size
  const lot7 = real.groups.slice(720, 730).map(g => ({ url: g.url, name: g.name, adminScan: 'listed', admins: [makeAdmin(personCursor++), makeAdmin(personCursor++)] }))
  const exp7 = expectedOfRun(lot7, ownUid)
  const progressFrom7 = progress.length
  await scheduler.logMilestonesV2(campaign, { id: 899_999, campaignId: campaign.id, uid: 'kw', name: 'kw' }, ACCOUNT,
    [{ id: 99_999, nodeId: 'summary', blockName: 'fb_find_search_data_summary', status: 'success', output: { facebookGroups: lot7, searchKeyword: 'kw' } }], true, [], undefined)
  const lines7 = progress.slice(progressFrom7)
  for (const k of exp7.uids) cumulative.uids.add(k)
  const uid7 = await members(uidGroup.id)
  check(uid7.length === cumulative.uids.size, 'Lô 7: nhóm SĐT bị xoá vẫn đẩy được UID', { rows: uid7.length, expected: cumulative.uids.size })
  const warn7 = lines7.find(l => l.startsWith('⚠️ Không thể đẩy SĐT quản trị viên group'))
  check(exp7.phones.size === 0 || (warn7 && warn7.includes('Nhóm data đã bị xoá hoặc không còn quyền dùng') && !/Failed to|data_group_/.test(warn7)),
    'Lô 7: nhóm SĐT bị xoá thì báo ⚠️ bằng câu cho khách (không lộ mã), không ngoại lệ', { lines7, before7 })

  // ---------------------------------------------------------------- lô 8: khách đổi loại nhóm UID sang loại khác → báo đúng loại, không ngoại lệ
  const wrongGroup = await repo.createDataGroup({ name: 'Nhóm SĐT bị chọn nhầm cho UID', requestId: `e2e-wrong-${Date.now()}`, dataTypeCategoryItemId: typeId('phone') })
  const savedUidDestination = campaign.extraSettings.findDataTargetDataGroups.facebook_group_admin_uid
  campaign.extraSettings.findDataTargetDataGroups.facebook_group_admin_uid = { groupId: wrongGroup.id, groupName: wrongGroup.name }
  const progressFrom8 = progress.length
  const lot8 = real.groups.slice(740, 745).map((g, i) => ({ url: g.url, name: g.name, adminScan: 'listed', admins: [freshAdmin(i)] }))
  let error8 = null
  try {
    await scheduler.logMilestonesV2(campaign, { id: 899_998, campaignId: campaign.id, uid: 'kw', name: 'kw' }, ACCOUNT,
      [{ id: 99_998, nodeId: 'summary', blockName: 'fb_find_search_data_summary', status: 'success', output: { facebookGroups: lot8, searchKeyword: 'kw' } }], true, [], undefined)
  } catch (e) { error8 = e }
  const lines8 = progress.slice(progressFrom8)
  console.log('  lô 8:', JSON.stringify(lines8))
  campaign.extraSettings.findDataTargetDataGroups.facebook_group_admin_uid = savedUidDestination
  const wrongRows = await members(wrongGroup.id)
  const line8 = lines8.find(l => l.includes('quản trị viên group (UID)'))
  check(!error8 && wrongRows.length === 0 && line8 && !/Failed to|data_group_|invalid_/.test(line8),
    'Lô 8: ô UID trỏ nhầm nhóm loại SĐT: không ngoại lệ, không dòng nào vào nhóm sai loại, câu cho khách không lộ mã',
    { lines8, wrongRows: wrongRows.length, error8: String(error8) })

  // ---------------------------------------------------------------- phần thêm của dòng trong DB
  const sample = (await members(uidGroup.id)).find(r => (r.extra_data?.adminGroups || []).length > 1)
  check(sample && sample.extra_data.sourceProfileKind === 'group_admin' && sample.extra_data.sourceCampaignId === campaign.id,
    'phần thêm trong DB: nguồn quản trị viên, chiến dịch nguồn, nhiều group', { extra: sample?.extra_data })
  const dbCalls = rpcCalls.filter(n => n === 'aka_agent_ingest_data_group').length
  console.log(`\nlượt nạp nhóm data: ${dbCalls}; nhóm UID ${cumulative.uids.size} người, nhóm SĐT ${before7} số (trước khi xoá)`)
  console.log(`== ${passed} PASS, ${problems.length} FAIL`)
  await db.end()
  if (problems.length) process.exitCode = 1
})().catch(error => { console.error(error); process.exit(1) })

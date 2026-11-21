// Phát lại lịch sử thật của chiến dịch tìm data qua mã thật (V608, docs/FIND_DATA_PUSH_LINKS_V608.md):
//   dòng "Tìm data" thật (đã xuất chỉ đọc) → CampaignScheduler.logMilestonesV2 thật (nhánh "Tìm data": lọc data đã thấy, ghi dòng
//   lịch sử, đẩy sang Nhóm data, đẩy sang chiến dịch đích) → hàm DB thật aka_agent_find_data_push_v1 trên Postgres cục bộ.
// Bộ kiểm độc lập (cuối file) tự tính kết quả đúng theo data đang có ở từng đích rồi so với DB sau mỗi lượt.
//   node scripts/find-data-push/replay-realdata.cjs <thư mục dữ liệu> [--limit N] [--variants] [--migrations a.sql,b.sql] [--json <file báo cáo>]
// Thư mục dữ liệu (xuất từ production, KHÔNG commit vì có dữ liệu khách): campaigns.json, target_rows.json, details.json
// (khuôn: xem export-realdata.sql). Cần module `pg` (PG_MODULE=<đường dẫn> nếu không có trong node_modules).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { loadScheduler, root } = require('./load-scheduler.cjs')
const { Client } = require(process.env.PG_MODULE || 'pg')

const args = process.argv.slice(2)
const dataDir = args.find(a => !a.startsWith('--'))
if (!dataDir) { console.error('thiếu thư mục dữ liệu'); process.exit(2) }
const argValue = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const LIMIT = Number(argValue('--limit') || 0) || Infinity
const REPORT = argValue('--json')
const PGBIN = process.env.PGBIN || '/usr/lib/postgresql/16/bin'
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const read = name => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))

// ---------------------------------------------------------------- Postgres cục bộ
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'find-data-replay-'))
fs.chmodSync(work, 0o777)
const port = 56000 + Math.floor(Math.random() * 900)
const asPg = (bin, binArgs) => {
  const command = [path.join(PGBIN, bin), ...binArgs]
  if (isRoot) {
    const quoted = command.map(part => `'${String(part).replace(/'/g, `'\\''`)}'`).join(' ')
    return execFileSync('su', ['postgres', '-s', '/bin/bash', '-c', `LC_ALL=C ${quoted}`], { encoding: 'utf8', stdio: 'ignore' })
  }
  return execFileSync(command[0], command.slice(1), { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: 'ignore' })
}
let db
async function startDb() {
  asPg('initdb', ['-D', path.join(work, 'data'), '-U', 'postgres', '-A', 'trust'])
  asPg('pg_ctl', ['-D', path.join(work, 'data'), '-o', `-p ${port} -k ${work}`, '-l', path.join(work, 'log'), 'start', '-w'])
  db = new Client({ host: work, port, user: 'postgres', database: 'postgres' })
  await db.connect()
  await db.query(fs.readFileSync(path.join(root, 'scripts/find-data-push/fixture_v608.sql'), 'utf8'))
}
async function stopDb() {
  try { await db?.end() } catch { /* đã đóng */ }
  try { asPg('pg_ctl', ['-D', path.join(work, 'data'), '-m', 'immediate', 'stop']) } catch { /* đã dừng */ }
  fs.rmSync(work, { recursive: true, force: true })
}

// ---------------------------------------------------------------- dữ liệu
const campaigns = read('campaigns.json')
const targetRows = read('target_rows.json').map(r => ({
  id: r[0], campaignId: r[1], uid: r[2], phone: r[3], name: r[4], status: r[5], note: r[6], isDelete: r[7], createdAt: new Date(r[8]).getTime()
}))
const detailsAll = read('details.json').map(r => ({
  id: r[0], campaignId: r[1], inputDataId: r[2], accountId: r[3], createdAt: new Date(r[4]).getTime(), log: r[5], data: r[6]
})).sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
const details = detailsAll.slice(0, LIMIT)
const campaignById = new Map(campaigns.map(c => [c.id, c]))
const KIND_FIELDS = {
  facebook_uid: { flag: 'isFindUid', fields: ['findUidTargetCampaignIds'], column: 'uid' },
  post_link: { flag: 'isFindPostLink', fields: ['findPostLinkTargetCampaignIds'], column: 'uid' },
  facebook_group: { flag: 'isFindFacebookGroup', searchOnly: true, column: 'uid',
    fields: ['findFacebookGroupPostTargetCampaignIds', 'findFacebookGroupCommentTargetCampaignIds', 'findFacebookGroupJoinTargetCampaignIds'] },
  phone: { flag: 'isFindPhone', fields: ['findPhoneZaloMessagePhoneTargetCampaignIds'], column: 'phone' },
  zalo_group_link: { flag: 'isFindLinkGroupZalo', fields: ['findZaloGroupLinkJoinTargetCampaignIds'], column: 'uid' }
}
const FIELD_ACTION = {
  findUidTargetCampaignIds: 'facebook_message_uid', findPostLinkTargetCampaignIds: 'facebook_comment_seeding_post',
  findFacebookGroupPostTargetCampaignIds: 'facebook_group_post', findFacebookGroupCommentTargetCampaignIds: 'facebook_comment_seeding',
  findFacebookGroupJoinTargetCampaignIds: 'facebook_join_group', findPhoneZaloMessagePhoneTargetCampaignIds: 'zalo_message_phone',
  findZaloGroupLinkJoinTargetCampaignIds: 'zalo_join_group_link'
}
const targetIdsOf = (source, field) => {
  const raw = source.extra?.[field]
  const out = []
  for (const v of Array.isArray(raw) ? raw : []) {
    const n = Number(v)
    if (Number.isSafeInteger(n) && n > 0 && n !== source.id && !out.includes(n)) out.push(n)
  }
  return out.slice(0, 50)
}

// ---------------------------------------------------------------- bộ kiểm độc lập (không dùng hàm chuẩn hoá của app)
// "Cùng một data" theo nghĩa khách hiểu: group Facebook = cùng mã group sau /groups/; UID = cùng chuỗi bỏ dấu "/" cuối, không phân
// biệt hoa thường; link bài = cùng link bỏ "/" cuối + bỏ tham số theo dõi; SĐT = cùng 10 số sau chuẩn hoá Việt Nam.
function oracleKey(kind, raw) {
  const v = String(raw || '').trim()
  if (!v) return ''
  if (kind === 'facebook_group') {
    const m = v.match(/groups\/([^/?#]+)/i)
    return m ? `g:${m[1].toLowerCase()}` : ''
  }
  if (kind === 'phone') {
    let d = v.replace(/\D/g, '')
    if (d.startsWith('84') && d.length >= 11) d = `0${d.slice(2)}`
    if (d.length === 9) d = `0${d}`
    return d.length >= 9 ? `p:${d}` : ''
  }
  if (kind === 'post_link') {
    try {
      const url = new URL(v, 'https://www.facebook.com')
      url.hash = ''
      for (const k of [...url.searchParams.keys()]) if (k.startsWith('__') || ['mibextid', 'ref', 'locale', 'comment_id', 'reply_comment_id'].includes(k)) url.searchParams.delete(k)
      return `l:${url.hostname.replace(/^(m|mbasic|mobile|web)\./, 'www.')}${url.pathname.replace(/\/+$/, '')}${url.search}`.toLowerCase()
    } catch { return `l:${v.replace(/\/+$/, '').toLowerCase()}` }
  }
  return `u:${v.replace(/\/+$/, '').toLowerCase()}`
}
function itemsOfDetail(kind, data) {
  if (kind === 'facebook_group') return (data.facebookGroups || []).map(g => g && g.url).filter(Boolean)
  if (kind === 'facebook_uid') return [...(data.groupMembers || []).map(m => m && m.uid), ...(data.uids || [])].filter(Boolean)
  if (kind === 'post_link') return (data.postLinks || []).filter(Boolean)
  if (kind === 'phone') return (data.phones || []).filter(Boolean)
  return (data.linkGroupZalos || []).filter(Boolean)
}

// ---------------------------------------------------------------- chạy
const problems = []
const problem = (type, info) => { problems.push({ ...info, type }); if (problems.length <= 40) console.log(`  ✗ ${type}: ${JSON.stringify(info).slice(0, 400)}`) }

;(async () => {
  let clock = 0
  const realNow = Date.now
  Date.now = () => (clock || realNow())
  try {
    await startDb()
    const staffIds = [...new Set(campaigns.map(c => c.staff_id))]
    await db.query(`DELETE FROM public.org_staff`)
    for (const sid of staffIds) {
      const org = campaigns.find(c => c.staff_id === sid).organization_id
      await db.query('INSERT INTO public.org_staff (id, organization_id) VALUES ($1, $2)', [sid, org])
    }
    const sourceIds = new Set(details.map(d => d.campaignId))
    const firstEventAt = details.length ? details[0].createdAt : 0
    const pendingDeletes = []
    for (const c of campaigns) {
      // Nguồn đã chạy trong khung phát lại thì lúc chạy chưa xoá; đích giữ trạng thái hiện tại.
      const isSource = sourceIds.has(c.id) || c.action_id.startsWith('facebook_find_data')
      // Đích đã xoá: chỉ coi là đã xoá từ lần sửa cuối (updated_at), trước đó vẫn nhận data như lúc chạy thật.
      const deletedLater = !isSource && c.is_delete && new Date(c.updated_at).getTime() > firstEventAt
      if (deletedLater) pendingDeletes.push({ id: c.id, at: new Date(c.updated_at).getTime() })
      await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, staff_id, organization_id, status, is_delete, data_target_source_mode,
        extra_settings, created_at, updated_at, completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11)`,
      [c.id, c.name, c.action_id, c.staff_id, c.organization_id, c.status, isSource || deletedLater ? false : c.is_delete, c.mode, c.extra || {}, c.created_at, c.completed_at])
    }
    pendingDeletes.sort((a, b) => a.at - b.at)
    // Liên kết nguồn → đích: những đích nào sẽ nhận loại data nào.
    const linkPlan = []
    for (const source of campaigns.filter(c => c.action_id.startsWith('facebook_find_data'))) {
      for (const [kind, cfg] of Object.entries(KIND_FIELDS)) {
        if (cfg.searchOnly && source.action_id !== 'facebook_find_data_search') continue
        if (source.extra?.[cfg.flag] !== true) continue
        for (const field of cfg.fields) for (const tid of targetIdsOf(source, field)) linkPlan.push({ sourceId: source.id, kind, field, targetId: tid })
      }
    }
    // Data của đích: có trước khung phát lại thì nạp sẵn; dòng do app cũ đẩy (thời điểm khớp một lượt "Tìm data" của nguồn trỏ tới
    // đích, giá trị có trong lượt đó) thì bỏ, để mã mới tự đẩy lại; dòng khách tự thêm sau đó nạp đúng thời điểm.
    const t0 = details.length ? details[0].createdAt : Infinity
    const tEnd = details.length ? details[details.length - 1].createdAt + 5 * 60_000 : 0
    const detailKeysByTarget = new Map()
    for (const d of detailsAll) {
      for (const link of linkPlan.filter(l => l.sourceId === d.campaignId)) {
        const keys = new Set(itemsOfDetail(link.kind, d.data).map(v => oracleKey(link.kind, v)))
        if (!detailKeysByTarget.has(link.targetId)) detailKeysByTarget.set(link.targetId, [])
        detailKeysByTarget.get(link.targetId).push({ at: d.createdAt, keys, kind: link.kind })
      }
    }
    const legacyPushed = []
    const userLater = []
    const baseline = []
    for (const row of targetRows) {
      const value = row.uid || row.phone
      if (row.createdAt < t0) { baseline.push(row); continue }
      const cands = detailKeysByTarget.get(row.campaignId) || []
      const pushed = cands.some(c => row.createdAt >= c.at - 5_000 && row.createdAt <= c.at + 600_000 && c.keys.has(oracleKey(c.kind, value)))
      if (pushed || String(row.note || '').startsWith('Đã thêm từ chiến dịch')) legacyPushed.push(row)
      else if (row.createdAt <= tEnd) userLater.push(row)
    }
    userLater.sort((a, b) => a.createdAt - b.createdAt)
    const insertRow = row => db.query(`INSERT INTO public.auto_campaign_input_data (campaign_id, uid, phone, name, status, note, is_delete, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8 / 1000.0))`, [row.campaignId, row.uid, row.phone, row.name, row.status, row.note, row.isDelete, row.createdAt])
    for (const row of baseline) await insertRow(row)
    await db.query(fs.readFileSync(path.join(root, 'migrations/migration_v608_find_data_push_links.sql'), 'utf8'))
    for (const extra of (argValue('--migrations') || '').split(',').filter(Boolean)) {
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261121072153', 'migration_v608_find_data_push_links') ON CONFLICT DO NOTHING`)
      await db.query(fs.readFileSync(path.join(root, 'migrations', extra), 'utf8'))
      console.log(`đã nạp thêm ${extra}`)
    }
    console.log(`dữ liệu: ${campaigns.length} chiến dịch, ${linkPlan.length} liên kết, ${details.length}/${detailsAll.length} lượt "Tìm data",`,
      `data đích: ${baseline.length} có sẵn + ${userLater.length} khách thêm sau + ${legacyPushed.length} do app cũ đẩy`)

    // ---------------------------------------------------------------- mã thật
    let currentStaff = null
    const ingestFailures = []
    let entitledActions = null
    const replayDetails = []
    const progress = []
    const groupIngests = []
    const broadcasts = []
    const allowAll = async actionId => { if (entitledActions && !entitledActions.has(actionId)) throw new Error('Gói hiện tại không có tính năng này') }
    const { CampaignScheduler, internals, load: loadModule } = loadScheduler({
      '../data/repositories/entitlementRepository': { ensureCurrentUserCanUseCampaignAction: allowAll, getAccountActionDailySendLimit: () => null, loadCurrentUserEffectiveEntitlements: async () => null },
      '../data/repositories/findDataPushRepository': { FindDataPushError: class FindDataPushError extends Error { constructor(m, c) { super(m); this.code = c } } }
    })
    const scheduler = Object.create(CampaignScheduler.prototype)
    Object.assign(scheduler, {
      running: true, runtimeTarget: 'desktop', findDataPushWarnings: new Map(), facebookEngineSinks: new Map(), facebookEngineProgress: new Map(),
      mainWindow: { webContents: { send() {} } }, logSinks: [], emitLog() {}, broadcastCampaignUpdate: c => broadcasts.push({ id: c.id, at: clock })
    })
    const mapCampaign = row => row && ({
      id: Number(row.id), name: row.name, actionId: row.action_id, staffId: Number(row.staff_id), organizationId: Number(row.organization_id),
      status: row.status, isDelete: row.is_delete, dataTargetSourceMode: row.data_target_source_mode, extraSettings: row.extra_settings || {}
    })
    scheduler.logCampaignProgress = async (campaignOrId, message) => {
      progress.push({ campaignId: typeof campaignOrId === 'number' ? campaignOrId : campaignOrId.id, message, at: clock })
    }
    scheduler.supabase = {
      createCampaignDetail: async action => {
        const created = { id: 9_000_000 + replayDetails.length, ...action, createdAt: new Date(clock).toISOString(), isDelete: false }
        replayDetails.push(created)
        return created
      },
      listCampaignDetailsByCampaign: async campaignId => replayDetails.filter(d => d.campaignId === campaignId).slice(-500).reverse(),
      listCampaignDetailsByInputData: async inputDataId => replayDetails.filter(d => d.inputDataId === inputDataId),
      listDataTypeCategoryItems: async () => (await db.query('SELECT id, code FROM public.category_item')).rows,
      ingestDataGroup: async payload => {
        groupIngests.push({ ...payload, at: clock })
        if (ingestFailures.length) throw ingestFailures.shift()
        return { insertedMembershipCount: payload.rows.length, reactivatedMembershipCount: 0, alreadyMemberCount: 0, invalidCount: 0, incompatibleCount: 0, conflictCount: 0 }
      },
      getCampaign: async id => {
        const r = await db.query('SELECT * FROM public.auto_campaigns WHERE id = $1 AND staff_id = $2', [id, currentStaff])
        return mapCampaign(r.rows[0])
      },
      pushFindDataToLinkedCampaigns: async request => {
        await db.query('BEGIN')
        try {
          await db.query(`SELECT set_config('test.staff_id', $1, true)`, [String(currentStaff)])
          await db.query('SET LOCAL ROLE aka_agent_desktop')
          const r = await db.query('SELECT public.aka_agent_find_data_push_v1($1::jsonb) AS r', [JSON.stringify(request)])
          await db.query('COMMIT')
          return require(path.join(root, 'scripts/find-data-push/parse-response.cjs'))(r.rows[0].r)
        } catch (error) {
          await db.query('ROLLBACK')
          const E = class extends Error { constructor(m, c) { super(m); this.code = c } }
          throw new E(error.message, error.code || null)
        }
      }
    }

    // ---------------------------------------------------------------- phát lại + kiểm
    const oracleTargetKeys = new Map()
    const keysOfTarget = async (targetId, kind) => {
      const r = await db.query('SELECT uid, phone FROM public.auto_campaign_input_data WHERE campaign_id = $1 AND NOT COALESCE(is_delete, false)', [targetId])
      return new Set(r.rows.map(x => oracleKey(kind, kind === 'phone' ? x.phone : x.uid)).filter(Boolean))
    }
    const sourceSeen = new Map() // nguồn → loại → khoá đã thấy ở các lượt trước (app lọc theo lịch sử của chính nguồn)
    const blockedExpectation = async (targetId, field, staffId, orgId) => {
      const r = (await db.query('SELECT * FROM public.auto_campaigns WHERE id = $1', [targetId])).rows[0]
      if (!r) return 'target_missing'
      if (Number(r.staff_id) !== staffId || Number(r.organization_id) !== orgId) return 'target_other_owner'
      if (r.is_delete) return 'target_deleted'
      if (r.action_id !== FIELD_ACTION[field]) return 'target_action_mismatch'
      if (r.data_target_source_mode === 'data_group') return 'target_data_group_mode'
      return null
    }
    const stats = { events: 0, pushes: 0, inserted: 0, existing: 0, blocked: 0, legacyRows: legacyPushed.length }
    const perTarget = new Map()
    let userIdx = 0
    for (const d of details) {
      clock = d.createdAt
      while (userIdx < userLater.length && userLater[userIdx].createdAt <= clock) await insertRow(userLater[userIdx++])
      while (pendingDeletes.length && pendingDeletes[0].at <= clock) {
        await db.query('UPDATE public.auto_campaigns SET is_delete = true WHERE id = $1', [pendingDeletes.shift().id])
      }
      const source = campaignById.get(d.campaignId)
      currentStaff = source.staff_id
      const campaign = mapCampaign((await db.query('SELECT * FROM public.auto_campaigns WHERE id = $1', [d.campaignId])).rows[0])
      const isSearch = campaign.actionId === 'facebook_find_data_search'
      const links = linkPlan.filter(l => l.sourceId === d.campaignId)
      // Bộ kiểm: trước lượt, tính kết quả đúng cho từng đích.
      const expected = []
      for (const link of links) {
        const seen = sourceSeen.get(`${d.campaignId}:${link.kind}`) || new Set()
        const keys = []
        for (const raw of itemsOfDetail(link.kind, d.data)) {
          const k = oracleKey(link.kind, raw)
          if (k && !seen.has(k) && !keys.includes(k)) keys.push(k)
        }
        const reason = await blockedExpectation(link.targetId, link.field, source.staff_id, source.organization_id)
        const have = await keysOfTarget(link.targetId, link.kind)
        expected.push({ link, reason, keys, fresh: reason ? [] : keys.filter(k => !have.has(k)), before: have })
      }
      const before = new Map()
      for (const e of expected) {
        before.set(e.link.targetId, Number((await db.query('SELECT COALESCE(max(id), 0) AS m FROM public.auto_campaign_input_data WHERE campaign_id = $1', [e.link.targetId])).rows[0].m))
      }
      const progressFrom = progress.length
      const detailsFrom = replayDetails.length
      const ingestFrom = groupIngests.length
      const statusBefore = new Map()
      for (const e of expected) statusBefore.set(e.link.targetId, (await db.query('SELECT status FROM public.auto_campaigns WHERE id = $1', [e.link.targetId])).rows[0]?.status)
      const step = {
        id: d.id, nodeId: 'summary', blockName: isSearch ? 'fb_find_search_data_summary' : 'fb_find_group_data_summary', status: 'success',
        output: { ...d.data, searchKeyword: d.data.searchKeyword, groupUrl: d.data.groupUrl }
      }
      const inputData = { id: d.inputDataId, campaignId: d.campaignId, uid: d.data.groupUrl || d.data.searchKeyword || '', name: d.data.searchKeyword || '' }
      try {
        await scheduler.logMilestonesV2(campaign, inputData, d.accountId, [step], true, [], undefined)
      } catch (error) {
        problem('exception', { detail: d.id, error: String(error && error.stack || error).slice(0, 300) })
        continue
      }
      stats.events += 1
      // Sự kiện: đúng một dòng "Tìm data" thành công, data khớp lượt thật.
      const made = replayDetails.slice(detailsFrom)
      if (made.length !== 1 || made[0].actionName !== 'Tìm data' || made[0].status !== 'thành công') {
        problem('detail_event', { detail: d.id, made: made.map(m => [m.actionName, m.status]) })
      } else {
        for (const k of ['uids', 'postLinks', 'phones', 'linkGroupZalos']) {
          const a = JSON.stringify((made[0].data[k] || []).map(String))
          const b = JSON.stringify((d.data[k] || []).map(String))
          if (a !== b) problem('detail_data', { detail: d.id, field: k, replay: a.slice(0, 120), real: b.slice(0, 120) })
        }
        const ga = (made[0].data.facebookGroups || []).map(g => g.url)
        const gb = (d.data.facebookGroups || []).map(g => g.url)
        if (JSON.stringify(ga) !== JSON.stringify(gb)) problem('detail_data', { detail: d.id, field: 'facebookGroups', replay: ga.length, real: gb.length })
      }
      // Data đích: so với bộ kiểm.
      for (const e of expected) {
        const rows = (await db.query('SELECT id, uid, phone, name, status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1 AND id > $2 ORDER BY id',
          [e.link.targetId, before.get(e.link.targetId)])).rows
        const gotKeys = rows.map(r => oracleKey(e.link.kind, e.link.kind === 'phone' ? r.phone : r.uid))
        const dup = gotKeys.filter((k, i) => gotKeys.indexOf(k) !== i || e.before.has(k))
        const missing = e.fresh.filter(k => !gotKeys.includes(k))
        const extra = gotKeys.filter(k => !e.fresh.includes(k))
        stats.pushes += 1
        stats.inserted += rows.length
        const pt = perTarget.get(e.link.targetId) || { replay: 0, blocked: null, kind: e.link.kind, field: e.link.field }
        pt.replay += rows.length
        if (e.reason) { pt.blocked = e.reason; stats.blocked += 1 }
        perTarget.set(e.link.targetId, pt)
        if (dup.length) problem('duplicate_in_target', { detail: d.id, target: e.link.targetId, kind: e.link.kind, n: dup.length, sample: dup.slice(0, 3) })
        if (missing.length) problem('missing_in_target', { detail: d.id, target: e.link.targetId, kind: e.link.kind, n: missing.length, sample: missing.slice(0, 3), reason: e.reason })
        if (extra.length && !dup.length) problem('unexpected_in_target', { detail: d.id, target: e.link.targetId, n: extra.length, sample: extra.slice(0, 3) })
        for (const r of rows) {
          if (r.status !== 'chờ xử lý') problem('row_status', { target: e.link.targetId, status: r.status })
          if (r.note !== `Đã thêm từ chiến dịch "${campaign.name}"`) problem('row_note', { target: e.link.targetId, note: r.note })
        }
        // Sự kiện tiến trình: câu ✅ / ⚠️ đúng số.
        const evts = progress.slice(progressFrom)
        const tName = (await db.query('SELECT name FROM public.auto_campaigns WHERE id = $1', [e.link.targetId])).rows[0]?.name
        if (rows.length > 0) {
          const ok = evts.some(p => p.campaignId === d.campaignId && p.message.startsWith(`✅ Đã đẩy ${rows.length} `) && p.message.includes(`"${tName}"`))
          const recv = evts.some(p => p.campaignId === e.link.targetId && p.message.startsWith(`✅ Đã nhận ${rows.length} `) && p.message.includes(`"${campaign.name}"`))
          if (!ok || !recv) problem('progress_event', { detail: d.id, target: e.link.targetId, inserted: rows.length, ok, recv })
          if (statusBefore.get(e.link.targetId) === 'hoàn thành') {
            const now = (await db.query('SELECT status FROM public.auto_campaigns WHERE id = $1', [e.link.targetId])).rows[0].status
            if (now !== 'chờ xử lý') problem('reopen', { target: e.link.targetId, now })
          }
        }
        if (e.reason && e.keys.length) {
          const warned = progress.some(p => p.campaignId === d.campaignId && p.message.startsWith('⚠️ Không đẩy được') && p.message.includes(String(e.link.targetId) === String(tName) ? '' : (tName || `#${e.link.targetId}`))
            && clock - p.at < 3_600_000 + 1)
          if (!warned) problem('blocked_not_warned', { detail: d.id, target: e.link.targetId, reason: e.reason })
        }
      }
      // Cập nhật lịch sử nguồn cho bộ kiểm (app lọc theo lượt "Tìm data" trước của chính nguồn).
      for (const link of links) {
        const k = `${d.campaignId}:${link.kind}`
        if (!sourceSeen.has(k)) sourceSeen.set(k, new Set())
        for (const raw of itemsOfDetail(link.kind, d.data)) sourceSeen.get(k).add(oracleKey(link.kind, raw))
      }
      void ingestFrom
    }
    // So với app cũ: số dòng app cũ đã thêm vào từng đích và số dòng trùng (theo bộ kiểm) trong đó.
    const legacyByTarget = new Map()
    for (const row of legacyPushed) {
      const e = legacyByTarget.get(row.campaignId) || { rows: 0, keys: new Map() }
      e.rows += 1
      const kind = linkPlan.find(l => l.targetId === row.campaignId)?.kind || 'facebook_uid'
      const k = oracleKey(kind, row.uid || row.phone)
      e.keys.set(k, (e.keys.get(k) || 0) + 1)
      legacyByTarget.set(row.campaignId, e)
    }
    const compare = []
    for (const [tid, pt] of perTarget) {
      const lg = legacyByTarget.get(tid) || { rows: 0, keys: new Map() }
      const legacyDup = [...lg.keys.values()].reduce((s, n) => s + n - 1, 0)
      compare.push({ target: tid, field: pt.field, blocked: pt.blocked, replayRows: pt.replay, legacyRows: lg.rows, legacyDistinct: lg.keys.size, legacyDuplicates: legacyDup })
    }
    compare.sort((a, b) => b.legacyRows - a.legacyRows)
    const ledger = (await db.query(`SELECT result, count(*)::int AS n FROM public.auto_campaign_data_link_deliveries GROUP BY 1`)).rows
    const links = (await db.query(`SELECT status, coalesce(block_reason,'') AS reason, count(*)::int AS n FROM public.auto_campaign_data_links GROUP BY 1, 2 ORDER BY 1, 2`)).rows
    console.log('kết quả:', JSON.stringify(stats))
    console.log('sổ đẩy:', JSON.stringify(ledger), 'liên kết:', JSON.stringify(links))
    console.log('nhóm data: ', groupIngests.length, 'lượt nạp')
    console.table(compare.slice(0, 40))
    if (args.includes('--reconcile')) {
      // Câu đối chiếu A↔B dùng cho production (reconcile-prod.sql) chạy trên kết quả phát lại: phải ra 0 dòng lệch.
      const recSql = fs.readFileSync(path.join(__dirname, 'reconcile-prod.sql'), 'utf8')
      const body = recSql.slice(recSql.indexOf('WITH params'), recSql.indexOf('LIMIT 500;') + 'LIMIT 500'.length)
        .replace("timestamptz '2026-11-21 00:00:00+00'", "timestamptz '-infinity'")
      // Dòng "Tìm data" bộ chạy đã ghi trong lúc phát lại (để C4 so sổ đẩy với đúng dòng nguồn).
      await db.query('CREATE TABLE IF NOT EXISTS public.auto_campaign_details (id bigint PRIMARY KEY, campaign_id bigint)')
      for (const d of replayDetails) await db.query('INSERT INTO public.auto_campaign_details (id, campaign_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [d.id, d.campaignId])
      await db.query('CREATE TABLE IF NOT EXISTS public.auto_data_ingest_batches (id bigserial PRIMARY KEY, request_id text, status text, created_at timestamptz DEFAULT now())')
      // C6 bỏ qua khi phát lại: sổ đẩy ghi giờ thật (clock_timestamp của DB) còn giờ xoá đích là giờ cũ của production, nên mọi lượt
      // đẩy đều như sau lúc xoá. Ở production hai mốc cùng một đồng hồ; C6 đã kiểm ở test_v608.sh.
      const rec = (await db.query(body)).rows.filter(r => r.check_id !== 'C6')
      const byCheck = {}
      for (const r of rec) byCheck[r.check_id] = (byCheck[r.check_id] || 0) + 1
      console.log('đối chiếu A↔B (reconcile-prod.sql):', rec.length, 'dòng lệch', JSON.stringify(byCheck))
      for (const r of rec.slice(0, 10)) console.log('  ', r.check_id, r.campaign_id, r.problem, r.detail)
      if (rec.length) problem('reconcile', { count: rec.length, byCheck, sample: rec.slice(0, 5) })
    }
    if (args.includes('--variants')) await runVariants()
    if (args.includes('--states')) await runStates()
    async function runStates() {
      // Lô trạng thái: đích bị chặn theo từng lý do, mở lại đích "hoàn thành", cảnh báo mỗi giờ một lần, engine dừng giữa lúc báo,
      // lượt "Tìm data" lỗi, ghi dòng "Tìm data" lỗi, Nhóm data lỗi mạng tạm thời / lỗi cố định, hai nguồn đẩy cùng lúc.
      console.log('--- lô trạng thái')
      const say = (ok, label, info = {}) => { console.log(`  ${ok ? '✓' : '✗'} ${label}`); if (!ok) problem('state', { label, ...info }) }
      const realSource = campaignById.get(41722)
      currentStaff = realSource.staff_id
      let nextId = 991000
      const realGroups = (await db.query(`SELECT uid FROM public.auto_campaign_input_data WHERE campaign_id = 41723 ORDER BY id LIMIT 40`)).rows.map(r => r.uid)
      const fresh = n => Array.from({ length: n }, (_, i) => `https://www.facebook.com/groups/state${nextId}x${i}/`)
      const make = async (name, actionId, extra = {}, opts = {}) => {
        const id = nextId++
        await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, staff_id, organization_id, status, is_delete, data_target_source_mode, extra_settings)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, name, actionId, opts.staff ?? realSource.staff_id, opts.org ?? realSource.organization_id,
          opts.status ?? 'chờ xử lý', opts.deleted ?? false, opts.mode ?? 'direct', extra])
        return id
      }
      const rowsOf = async id => Number((await db.query('SELECT count(*) AS n FROM public.auto_campaign_input_data WHERE campaign_id = $1', [id])).rows[0].n)
      const camp = async id => mapCampaign((await db.query('SELECT * FROM public.auto_campaigns WHERE id = $1', [id])).rows[0])
      const pushGroups = async (sourceId, urls) => scheduler.pushFoundDataToLinkedCampaigns(await camp(sourceId), 'facebook_group',
        scheduler.buildFindDataFacebookGroupPushItems(urls.map(url => ({ url, name: '' }))), { sourceDetailId: null, sourceInputDataId: null }, async () => {})
      const warnings = (sourceId, from) => progress.slice(from).filter(p => p.campaignId === sourceId && p.message.startsWith('⚠️'))

      // 1. Mỗi lý do chặn: không thêm dòng, liên kết blocked đúng lý do, câu ⚠️ đúng.
      const otherStaff = campaigns.find(c => c.staff_id !== realSource.staff_id)
      const targets = {
        target_deleted: await make('Đích đã xoá', 'facebook_join_group', {}, { deleted: true }),
        target_data_group_mode: await make('Đích Nhóm data', 'facebook_join_group', {}, { mode: 'data_group' }),
        target_other_owner: await make('Đích của người khác', 'facebook_join_group', {}, { staff: otherStaff.staff_id, org: otherStaff.organization_id }),
        target_action_mismatch: await make('Đích sai loại', 'facebook_message_uid'),
        target_not_entitled: await make('Đích ngoài gói', 'facebook_group_post'),
        ok: await make('Đích nhận được', 'facebook_join_group', {}, { status: 'hoàn thành' })
      }
      const src = await make('Nguồn trạng thái', 'facebook_find_data_search', {
        isFindFacebookGroup: true,
        findFacebookGroupJoinTargetCampaignIds: [targets.target_deleted, targets.target_data_group_mode, targets.target_other_owner, targets.target_action_mismatch, targets.ok],
        findFacebookGroupPostTargetCampaignIds: [targets.target_not_entitled]
      })
      entitledActions = new Set(['facebook_join_group', 'facebook_message_uid'])
      let from = progress.length
      const broadcastFrom = broadcasts.length
      const urls = fresh(5)
      await pushGroups(src, urls)
      for (const [reason, id] of Object.entries(targets)) {
        if (reason === 'ok') continue
        const link = (await db.query('SELECT status, block_reason FROM public.auto_campaign_data_links WHERE source_campaign_id = $1 AND target_campaign_id = $2', [src, id])).rows[0]
        say(await rowsOf(id) === 0 && link?.status === 'blocked' && link.block_reason === reason, `chặn ${reason}: 0 dòng, liên kết blocked`, { link })
      }
      const w = warnings(src, from).map(p => p.message)
      say(w.some(m => m.includes('"Đích đã xoá": chiến dịch này đã bị xoá')), 'câu ⚠️ đích đã xoá', { w })
      say(w.some(m => m.includes('"Đích Nhóm data": chiến dịch này đang chạy bằng Nhóm data')), 'câu ⚠️ đích chạy bằng Nhóm data', { w })
      say(w.some(m => m.includes(`#${targets.target_other_owner}: không tìm thấy chiến dịch này`)) && !w.some(m => m.includes('Đích của người khác')),
        'câu ⚠️ đích của người khác không lộ tên', { w })
      say(w.some(m => m.includes('"Đích sai loại": loại chiến dịch này không nhận link group Facebook')), 'câu ⚠️ đích sai loại', { w })
      say(w.some(m => m.includes('"Đích ngoài gói": gói dịch vụ hiện tại không có loại chiến dịch này')), 'câu ⚠️ đích ngoài gói', { w })
      say(await rowsOf(targets.ok) === 5, 'đích hợp lệ nhận đủ 5 dòng')
      const okStatus = (await db.query('SELECT status FROM public.auto_campaigns WHERE id = $1', [targets.ok])).rows[0].status
      say(okStatus === 'chờ xử lý' && broadcasts.slice(broadcastFrom).some(b => b.id === targets.ok), 'đích "hoàn thành" mở lại + báo giao diện')
      // Cảnh báo mỗi giờ một lần cho cùng nguồn / đích / lý do.
      from = progress.length
      clock += 10 * 60_000
      await pushGroups(src, fresh(2))
      say(warnings(src, from).length === 0, 'trong 1 giờ không cảnh báo lại')
      from = progress.length
      clock += 61 * 60_000
      await pushGroups(src, fresh(2))
      say(warnings(src, from).length === 5, 'sau 1 giờ cảnh báo lại đủ 5 đích', { n: warnings(src, from).length })
      entitledActions = null

      // 2. Engine dừng giữa lúc báo: không đẩy gì.
      const engineTarget = await make('Đích engine', 'facebook_join_group')
      const engineSrc = await make('Nguồn engine', 'facebook_find_data_search', { isFindFacebookGroup: true, findFacebookGroupJoinTargetCampaignIds: [engineTarget] })
      const Stop = internals.FacebookEngineReportStop
      say(typeof Stop === 'function', 'lấy được lớp FacebookEngineReportStop')
      scheduler.facebookEngineSinks.set(engineSrc, async () => { throw new Stop() })
      let threw = null
      const step = (urlsList, status = 'success') => [{ id: nextId++, nodeId: 'summary', blockName: 'fb_find_search_data_summary', status,
        output: { facebookGroups: urlsList.map(url => ({ url, name: '' })), searchKeyword: 'kiểm thử' }, error: status === 'error' ? 'lỗi thử' : undefined }]
      try { await scheduler.logMilestonesV2(await camp(engineSrc), { id: nextId++, uid: 'kiểm thử', name: 'kiểm thử' }, 1, step(fresh(3)), true, [], undefined) } catch (e) { threw = e }
      say(threw instanceof Stop && await rowsOf(engineTarget) === 0, 'engine dừng: ném lại, không đẩy')
      // Engine ghi được dòng: đẩy bình thường.
      scheduler.facebookEngineSinks.set(engineSrc, async action => ({ id: 777, ...action }))
      await scheduler.logMilestonesV2(await camp(engineSrc), { id: nextId++, uid: 'kiểm thử', name: 'kiểm thử' }, 1, step(fresh(3)), true, [], undefined)
      say(await rowsOf(engineTarget) === 3, 'engine ghi dòng được: đẩy 3 dòng')
      const ledger777 = (await db.query('SELECT count(*)::int AS n FROM public.auto_campaign_data_link_deliveries WHERE source_detail_id = 777')).rows[0].n
      say(ledger777 === 3, 'sổ đẩy ghi id dòng "Tìm data" của engine', { ledger777 })
      scheduler.facebookEngineSinks.delete(engineSrc)
      // Lượt "Tìm data" lỗi: dòng lỗi, không đẩy.
      const errFrom = replayDetails.length
      await scheduler.logMilestonesV2(await camp(engineSrc), { id: nextId++, uid: 'kiểm thử', name: 'kiểm thử' }, 1, step(fresh(3), 'error'), true, [], undefined)
      say(replayDetails.slice(errFrom).some(d => d.status === 'lỗi') && await rowsOf(engineTarget) === 3, 'lượt lỗi: ghi dòng lỗi, không đẩy')
      // Ghi dòng "Tìm data" lỗi vì lý do khác (không phải engine dừng): vẫn đẩy, DB không thêm trùng.
      const realCreate = scheduler.supabase.createCampaignDetail
      scheduler.supabase.createCampaignDetail = async () => { throw new Error('mất mạng khi ghi dòng') }
      const again = fresh(2)
      await scheduler.logMilestonesV2(await camp(engineSrc), { id: nextId++, uid: 'kiểm thử', name: 'kiểm thử' }, 1, step(again), true, [], undefined)
      scheduler.supabase.createCampaignDetail = realCreate
      say(await rowsOf(engineTarget) === 5, 'ghi dòng lỗi vì lý do khác: vẫn đẩy')

      // 3. Nhóm data: lỗi mạng tạm thời thì gửi lại cùng mã yêu cầu; lỗi cố định thì báo ngay.
      const dgSrc = await make('Nguồn Nhóm data', 'facebook_find_data_search', { findDataTargetDataGroups: { facebook_group: { groupId: 5555, groupName: 'Nhóm thử' } } })
      let ingFrom = groupIngests.length
      from = progress.length
      ingestFailures.push(new Error('Failed to ingest data group: TypeError: fetch failed'), new Error('Đã thêm 100/128 dòng trước khi dừng, thử lại để thêm tiếp. Failed to ingest data group: TypeError: fetch failed'))
      const realSetTimeout = global.setTimeout
      global.setTimeout = (fn) => realSetTimeout(fn, 0)
      await scheduler.logMilestonesV2(await camp(dgSrc), { id: nextId++, uid: 'kiểm thử', name: 'kiểm thử' }, 1, step(fresh(4)), true, [], undefined)
      const calls = groupIngests.slice(ingFrom)
      say(calls.length === 3 && new Set(calls.map(c => c.requestId)).size === 1, 'Nhóm data lỗi mạng: gửi lại 3 lần cùng mã yêu cầu', { n: calls.length })
      say(progress.slice(from).some(p => p.message.startsWith('✅ Đã đẩy 4 group Facebook sang Nhóm data "Nhóm thử"')), 'Nhóm data: câu ✅ sau khi gửi lại được')
      ingFrom = groupIngests.length
      from = progress.length
      ingestFailures.push(new Error('Failed to ingest data group: data_group_request_id_conflict'))
      await scheduler.logMilestonesV2(await camp(dgSrc), { id: nextId++, uid: 'kiểm thử', name: 'kiểm thử' }, 1, step(fresh(2)), true, [], undefined)
      say(groupIngests.length - ingFrom === 1 && progress.slice(from).some(p => p.message.startsWith('⚠️ Không thể đẩy group Facebook sang Nhóm data')),
        'Nhóm data lỗi cố định: không gửi lại, báo ⚠️')
      global.setTimeout = realSetTimeout

      // 4. Hai nguồn đẩy cùng data vào một đích cùng lúc (hai kết nối DB): mỗi data một dòng.
      const raceTarget = await make('Đích đua', 'facebook_join_group')
      const srcA = await make('Nguồn A', 'facebook_find_data_search', { isFindFacebookGroup: true, findFacebookGroupJoinTargetCampaignIds: [raceTarget] })
      const srcB = await make('Nguồn B', 'facebook_find_data_search', { isFindFacebookGroup: true, findFacebookGroupJoinTargetCampaignIds: [raceTarget] })
      const db2 = new Client({ host: work, port, user: 'postgres', database: 'postgres' })
      await db2.connect()
      const sharedFresh = fresh(20)
      // Cùng data (group thật của đích 41723 + 20 group mới) cho cả hai nguồn.
      const raceItems = scheduler.buildFindDataFacebookGroupPushItems([...realGroups, ...sharedFresh].map(url => ({ url, name: '' })))
      const race = (client, sourceId) => (async () => {
        await client.query('BEGIN')
        await client.query(`SELECT set_config('test.staff_id', $1, true)`, [String(realSource.staff_id)])
        await client.query('SET LOCAL ROLE aka_agent_desktop')
        await client.query('SELECT public.aka_agent_find_data_push_v1($1::jsonb)', [JSON.stringify({ sourceCampaignId: sourceId, outputKind: 'facebook_group', items: raceItems })])
        await client.query('SELECT pg_sleep(0.3)')
        await client.query('COMMIT')
      })()
      await Promise.all([race(db, srcA), race(db2, srcB)])
      await db2.end()
      const raceRows = (await db.query('SELECT uid FROM public.auto_campaign_input_data WHERE campaign_id = $1', [raceTarget])).rows.map(r => oracleKey('facebook_group', r.uid))
      const raceExpected = new Set(raceItems.map(i => oracleKey('facebook_group', i.value))).size
      say(raceRows.length === raceExpected && new Set(raceRows).size === raceExpected, `hai nguồn cùng lúc: ${raceExpected} dòng, không trùng`,
        { n: raceRows.length, distinct: new Set(raceRows).size, expected: raceExpected })
    }
    async function runVariants() {
      // Lô cách viết khác: data thật của đích viết kiểu khác (dấu "/" cuối, m./web., tham số theo dõi, +84, khoảng trắng), đẩy qua đúng
      // đường của app (bộ dựng data + pushFoundDataToLinkedCampaigns). Đúng: không thêm dòng nào cho data đích đã có; data mới viết nhiều
      // kiểu trong một lượt chỉ thêm 1 dòng.
      console.log('--- lô cách viết khác')
      const pickRows = async (targetId, column, n) => (await db.query(
        `SELECT ${column} AS v FROM public.auto_campaign_input_data WHERE campaign_id = $1 AND NOT COALESCE(is_delete, false) AND ${column} IS NOT NULL ORDER BY id LIMIT $2`,
        [targetId, n])).rows.map(r => r.v)
      const realPhones = [...new Set(details.flatMap(d => d.data.phones || []))].slice(0, 12)
      const realGroups = await pickRows(41723, 'uid', 30)
      const realUids = (await pickRows(37639, 'uid', 20)).filter(v => /^\d+$/.test(v))
      const realPosts = await pickRows(37640, 'uid', 20)
      const zaloLinks = ['https://zalo.me/g/abcdef123', 'https://zalo.me/g/xyz987', 'https://zalo.me/g/QWERTY55']
      const groupVariants = v => [v.replace('https://www.', 'https://m.'), v.replace(/\/$/, ''), `${v}?ref=share`, v.replace('https://www.', 'https://web.'),
        v.replace('https://www.facebook.com', 'facebook.com')]
      const uidVariants = v => [`${v}/`, ` ${v} `, `${v}//`]
      const postVariants = v => [`${v}${v.includes('?') ? '&' : '?'}__cft__[0]=AZW&__tn__=R`, v.replace('https://www.', 'https://m.'), v.replace(/\/$/, '')]
      const phoneVariants = v => [`+84${v.slice(1)}`, `${v.slice(0, 4)} ${v.slice(4, 7)} ${v.slice(7)}`, `84${v.slice(1)}`]
      const zaloVariants = v => [`${v}/`, ` ${v.toUpperCase()} `]
      const staff = campaignById.get(41722).staff_id
      const org = campaignById.get(41722).organization_id
      currentStaff = staff
      let nextId = 990000
      const makeCampaign = async (name, actionId, extra) => {
        const id = nextId++
        await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, staff_id, organization_id, status, is_delete, data_target_source_mode, extra_settings)
          VALUES ($1,$2,$3,$4,$5,'hoàn thành',false,'direct',$6)`, [id, name, actionId, staff, org, extra])
        return id
      }
      const addRows = (id, column, values) => Promise.all(values.map(v => db.query(
        `INSERT INTO public.auto_campaign_input_data (campaign_id, ${column}, status) VALUES ($1, $2, 'hoàn thành')`, [id, v])))
      const kinds = [
        { kind: 'facebook_group', action: 'facebook_join_group', field: 'findFacebookGroupJoinTargetCampaignIds', flag: 'isFindFacebookGroup', column: 'uid',
          values: realGroups, variants: groupVariants, build: vs => scheduler.buildFindDataFacebookGroupPushItems(vs.map(url => ({ url, name: '' }))) },
        { kind: 'facebook_uid', action: 'facebook_message_uid', field: 'findUidTargetCampaignIds', flag: 'isFindUid', column: 'uid',
          values: realUids, variants: uidVariants, build: vs => scheduler.buildFindDataUidPushItems(vs, new Map()) },
        { kind: 'post_link', action: 'facebook_comment_seeding_post', field: 'findPostLinkTargetCampaignIds', flag: 'isFindPostLink', column: 'uid',
          values: realPosts, variants: postVariants, build: vs => scheduler.buildFindDataPostLinkPushItems(vs) },
        { kind: 'phone', action: 'zalo_message_phone', field: 'findPhoneZaloMessagePhoneTargetCampaignIds', flag: 'isFindPhone', column: 'phone',
          values: realPhones, variants: phoneVariants, build: vs => scheduler.buildFindDataPhonePushItems(vs, []) },
        { kind: 'zalo_group_link', action: 'zalo_join_group_link', field: 'findZaloGroupLinkJoinTargetCampaignIds', flag: 'isFindLinkGroupZalo', column: 'uid',
          values: zaloLinks, variants: zaloVariants, build: vs => scheduler.buildFindDataZaloGroupLinkPushItems(vs) }
      ]
      const countRows = async id => Number((await db.query('SELECT count(*) AS n FROM public.auto_campaign_input_data WHERE campaign_id = $1', [id])).rows[0].n)
      for (const k of kinds) {
        const caseCheck = async (label, targetRowsValues, pushValues, expectedNew) => {
          const target = await makeCampaign(`Đích ${label}`, k.action, {})
          await addRows(target, k.column, targetRowsValues)
          const source = await makeCampaign(`Nguồn ${label}`, 'facebook_find_data_search', { [k.flag]: true, [k.field]: [target] })
          const sourceCampaign = mapCampaign((await db.query('SELECT * FROM public.auto_campaigns WHERE id = $1', [source])).rows[0])
          const beforeN = await countRows(target)
          await scheduler.pushFoundDataToLinkedCampaigns(sourceCampaign, k.kind, k.build(pushValues), { sourceDetailId: null, sourceInputDataId: null },
            async () => { throw new Error('không được dùng cách cũ') })
          const added = (await countRows(target)) - beforeN
          const okLine = added === expectedNew
          console.log(`  ${okLine ? '✓' : '✗'} ${k.kind} · ${label}: thêm ${added}, đúng ${expectedNew}`)
          if (!okLine) problem('variant_match', { kind: k.kind, label, added, expected: expectedNew, sample: pushValues.slice(0, 2), rows: targetRowsValues.slice(0, 2) })
          // Gọi lại cùng data (app thử lại): không thêm gì.
          await scheduler.pushFoundDataToLinkedCampaigns(sourceCampaign, k.kind, k.build(pushValues), { sourceDetailId: null, sourceInputDataId: null }, async () => {})
          const again = (await countRows(target)) - beforeN - added
          if (again !== 0) problem('variant_retry', { kind: k.kind, label, again })
        }
        if (k.values.length === 0) { console.log(`  - ${k.kind}: không có data thật`); continue }
        // A: đích có data viết chuẩn, đẩy cách viết khác.
        await caseCheck('A đích chuẩn / đẩy kiểu khác', k.values, k.values.flatMap(k.variants), 0)
        // B: đích có data khách tự nhập kiểu khác, đẩy cách viết chuẩn.
        await caseCheck('B đích kiểu khác / đẩy chuẩn', k.values.map(v => k.variants(v)[0]), k.values, 0)
        // C: data mới, mỗi data viết nhiều kiểu trong một lượt: thêm đúng 1 dòng mỗi data.
        const distinct = new Set(k.values.map(v => oracleKey(k.kind, v))).size
        await caseCheck('C data mới nhiều kiểu', [], [...k.values, ...k.values.flatMap(k.variants)], distinct)
      }
    }
    const byKind = problems.reduce((m, p) => (m[p.type] = (m[p.type] || 0) + 1, m), {})
    console.log('vấn đề:', JSON.stringify(byKind))
    if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ stats, ledger, links, compare, problems, groupIngests: groupIngests.length, progressSample: progress.slice(0, 50) }, null, 1))
    process.exitCode = problems.length ? 1 : 0
  } finally {
    Date.now = realNow
    await stopDb()
  }
})().catch(error => { console.error(error); process.exitCode = 2 })

#!/usr/bin/env node
// Ca xác định cho ĐỀ XUẤT kiểm Global ID theo nguồn gốc dòng zalo_users (scripts/build-gid-trust-proposal-sql.cjs): mỗi lỗ hổng của
// gid_ok V657 (luật đếm dòng / tên) một ca cho từng đường đọc đã sửa, cùng các ca đúng phải giữ. Chạy trên PostgreSQL cục bộ hai lần:
// V657 đang chạy (ca lỗ hổng phải khớp nhầm — bài kiểm bắt được) và V657 + đề xuất (mọi ca đúng).
//   PG_MODULE_DIR=<thư mục có node_modules/pg> LC_ALL=C node scripts/send-exclusion-gid-trust-smoke.cjs
'use strict'
// Production đã có V666 (17:43:55 VN 26/11): fixture nạp V666 sau V657 (SX_WITH_V666, xem send-exclusion-v657-fixture.cjs).
process.env.SX_WITH_V666 ??= '1'
const { buildDb } = require('./send-exclusion-v657-fixture.cjs')
const PROPOSAL_SQL = require('./build-gid-trust-proposal-sql.cjs').sql

const ORG = 7701, STAFF = 77101
let seq = 77000
const id = () => ++seq
// Dữ liệu dòng zalo_users như production (đo 26/11/2026).
const SCAN = (uid, gid, name) => ({ id: uid, globalId: gid, source: 'profile', zaloGroupId: '6784869142295974592', zaloName: name })   // hồ sơ thành viên nhóm
const PROFILE = (uid, gid, name) => ({ userId: uid, globalId: gid, zaloName: name, bizPkg: { pkgId: 0 } })                            // đọc hồ sơ / bạn bè
const SCAN_THEN_PROFILE = (uid, gid) => ({ ...SCAN(uid, gid, 'x'), userId: uid, globalId: gid })                                       // quét nhóm rồi đọc hồ sơ ghi đè
const G = k => ('G' + k).padEnd(32, '0')

async function variant(proposal) {
  const T = await buildDb({ label: 'aka-gidtrust-smoke-' })
  const { db, one, q } = T
  const cols = {}
  const ins = async (table, rows) => {
    rows = Array.isArray(rows) ? rows : [rows]
    cols[table] ??= (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).map(r => r.column_name)
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols[table].includes(k))
    const list = keys.map(k => `"${k}"`).join(', ')
    await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`, [JSON.stringify(rows)])
  }
  const results = []
  try {
    await T.applyV657()
    if (proposal && process.env.GID_TRUST_PROPOSAL === 'migration') await require('./gid-trust-apply-migration.cjs')(db)
    else if (proposal) await db.query(PROPOSAL_SQL)
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'Org gid trust') ON CONFLICT DO NOTHING`, [ORG])
    await ins('org_staff', { id: STAFF, organization_id: ORG, username: 'gt', password: 'pw', is_active: true })
    const cat = async code => (await one(`SELECT id FROM public.category_item WHERE code=$1 LIMIT 1`, [code]))?.id
    let catPerson = await cat('zalo_person')
    if (!catPerson) { catPerson = 990002; await ins('category_item', { id: catPerson, code: 'zalo_person', name: 'Zalo User' }) }
    // Tài khoản Zalo; nickGid = Global ID của nick ghi ở zalo_accounts (không truyền = nick không ghi nhận ở đâu).
    const acc = async (nickGid) => {
      const a = id(); let za = null
      if (nickGid) { za = id(); await ins('zalo_accounts', { id: za, zalo_uid: 'nick' + a, metadata: { globalId: nickGid } }) }
      await ins('auto_accounts', { id: a, name: 'Zalo ' + a, flatform_type: 'zalo', login_status: 'đã đăng nhập', status: 'chờ xử lý', is_active: true, is_delete: false,
        staff_id: STAFF, organization_id: ORG, is_zalo_server: false, is_zalo_show_web: false, zalo_account_id: za })
      return a
    }
    const zu = (account, uid, gid, name, raw, extra = {}) => ins('zalo_users', { id: id(), account_id: account, zalo_uid: uid, global_id: gid, zalo_name: name,
      raw_payload: raw, staff_id: STAFF, organization_id: ORG, is_fr: 0, ...extra })
    const contact = async (account, uid) => { const c = id(); await ins('auto_account_contacts', { id: c, account_id: account, contact_type: 'person', uid, is_delete: false,
      staff_id: STAFF, organization_id: ORG, flatform_type: 'zalo' }); return c }
    const group = async (extra) => { const g = id(); await ins('auto_account_contact_groups', { id: g, is_delete: false, staff_id: STAFF, organization_id: ORG, name: 'G' + g, ...extra }); return g }
    const member = (g, c) => ins('auto_account_contact_group_members', { id: id(), group_id: g, contact_id: c, is_delete: false })
    const list = async (account, uids) => { const g = await group({ purpose: 'zalo_friend_blocklist', account_id: account, contact_type: 'person' }); for (const u of uids) await member(g, await contact(account, u)); return g }
    const dataGroup = async (members) => { const g = await group({ purpose: 'data_group', data_type_category_item_id: catPerson }); for (const [a, u] of members) await member(g, await contact(a, u)); return g }
    const campaign = async (account, selection) => { const c = id(); await ins('auto_campaigns', { id: c, name: 'C' + c, action_id: 'zalo_message_group_member', account_id: account, status: 'hoàn thành',
      is_delete: false, staff_id: STAFF, organization_id: ORG, schedule: new Date().toISOString(), schedule_type: 'daily', extra_settings: { enableMessage: true } }); return c }
    const sentCampaign = async (account, uid, target) => {
      const c = await campaign(account, null); const i = id()
      await ins('auto_campaign_input_data', { id: i, campaign_id: c, uid, status: 'hoàn thành', is_delete: false })
      await ins('auto_campaign_details', { id: id(), campaign_id: c, input_data_id: i, account_id: account, action_code: 'zalo_message_stranger', action_name: 'zalo_message_stranger',
        staff_id: STAFF, organization_id: ORG, status: 'thành công', is_delete: false, created_at: new Date().toISOString(), data: target ? { target } : {} })
      return c
    }
    const match = async (account, selection, gid, uid, final) => {
      const c = await campaign(account)
      return (await one(`SELECT private.aka_agent_send_exclusion_match(c, $2::bigint, $3::jsonb, NULL, $4::text, $5::text, $6::boolean) m FROM public.auto_campaigns c WHERE c.id=$1`,
        [c, account, selection, gid, uid, final])).m
    }
    // expected: true = phải khớp (đúng người), false = không được khớp (người khác).
    const cas = async (name, expected, fn) => {
      let got, error = null
      try { got = await fn() } catch (e) { error = e.message }
      results.push({ name, expected, got, error })
    }

    // Người thật V (Global ID G('V')) có dòng tin được ở tài khoản D (nick ghi nhận).
    const D = await acc(G('nickD'))
    await zu(D, 'uD-V', G('V'), 'Chủ nick V', PROFILE('uD-V', G('V'), 'Chủ nick V'))

    // ------------------------------------------------------------ lỗ hổng
    // H1: data ở tài khoản A (nick không ghi nhận) là thành viên nhóm, 2 dòng quét mang Global ID người xem G('V'), 1 dòng tên rỗng ⇒
    // luật tên của V657 cho qua; danh sách ở D có người V thật.
    const A = await acc(null)
    await zu(A, 'uA1', G('V'), 'An', SCAN('uA1', G('V'), 'An'))
    await zu(A, 'uA2', G('V'), '', SCAN('uA2', G('V'), ''))
    const LD = await list(D, ['uD-V'])
    await cas('H1 bước A, danh sách: data quét nhóm (2 dòng, tên rỗng, nick không ghi nhận) không bị coi là người V', false,
      async () => !!(await match(A, { blocklistIds: [LD] }, null, 'uA1', false)).match)
    // H2: danh sách ở C (nick không ghi nhận) có thành viên quét nhóm uC1 — 1 dòng mang Global ID người xem G('V'); data là người V thật.
    const C = await acc(null)
    await zu(C, 'uC1', G('V'), 'Bình', SCAN('uC1', G('V'), 'Bình'), { is_fr: 1 })
    const LC = await list(C, ['uC1'])
    await cas('H2 bước B, danh sách: thành viên quét nhóm 1 dòng (nick không ghi nhận) không bị coi là người V', false,
      async () => !!(await match(D, { blocklistIds: [LC] }, G('V'), 'uD-V', true)).match)
    const DG = await dataGroup([[C, 'uC1']])
    await cas('H3 bước B, Nhóm data Zalo UID: thành viên quét nhóm 1 dòng không bị coi là người V', false,
      async () => !!(await match(D, { dataGroupIds: [DG] }, G('V'), 'uD-V', true)).match)
    const SC = await sentCampaign(C, 'uC1', null)
    await cas('H4 bước B, chiến dịch đã gửi: đã gửi cho uC1 (dòng quét nhóm, kết quả gửi cũ không ghi Global ID) không bị coi là đã gửi cho V', false,
      async () => !!(await match(D, { sentCampaignIds: [SC] }, G('V'), 'uD-V', true)).match)
    // H5: dòng đúng bị quét nhóm đè: raw_payload.globalId = Global ID thật của Bảo, cột = Global ID người xem G('F') (nick F không ghi nhận).
    const F = await acc(null)
    await zu(F, 'uF1', G('F'), 'Bảo', PROFILE('uF1', G('Bao'), 'Bảo'))
    await zu(D, 'uD-F', G('F'), 'Chủ nick F', PROFILE('uD-F', G('F'), 'Chủ nick F'))
    const LF = await list(F, ['uF1'])
    await cas('H5 bước B, danh sách: dòng bị quét nhóm đè cột global_id không bị coi là chủ nick F', false,
      async () => !!(await match(D, { blocklistIds: [LF] }, G('F'), 'uD-F', true)).match)
    // H6: đổi nick: E nay đăng nhập nick G('E4'), còn 1 dòng quét nhóm của nick cũ G('V5'); danh sách ở D có chủ nick cũ.
    const E = await acc(G('E4'))
    await zu(E, 'uE1', G('V5'), 'Cường', SCAN('uE1', G('V5'), 'Cường'))
    await zu(D, 'uD-V5', G('V5'), 'Chủ nick cũ', PROFILE('uD-V5', G('V5'), 'Chủ nick cũ'))
    const LD5 = await list(D, ['uD-V5'])
    await cas('H6 bước A, danh sách: tài khoản đổi nick, 1 dòng quét của nick cũ không bị coi là chủ nick cũ', false,
      async () => !!(await match(E, { blocklistIds: [LD5] }, null, 'uE1', false)).match)
    // H7: khoá chống gửi lặp: uA1 và uA2 (người khác nhau, cùng Global ID người xem) không gộp khoá.
    await cas('H7 khoá chống gửi lặp: thành viên quét nhóm không gộp khoá của người khác', false, async () => {
      const k1 = (await one(`SELECT private.aka_agent_send_exclusion_person_keys($1, 'uA1', NULL, NULL, NULL) k`, [A])).k
      const k2 = (await one(`SELECT public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person', 'uA2', NULL, NULL) k`)).k
      return k2.some(k => k1.includes(k))
    })
    // H8: dữ kiện Zalo khác: C có uC1 (bạn bè, dòng quét nhóm mang G('V')) ⇒ người V không phải bạn bè của C.
    await cas('H8 dữ kiện Zalo khác: bạn bè của Zalo C không lấy từ dòng quét nhóm', false, async () => {
      const rules = [{ fieldId: (await one(`SELECT id FROM public.auto_filter_fields WHERE source_key='zalo_friendship' LIMIT 1`)).id, operatorId: 1, value: 'friend', isEnabled: true }]
      const c = await campaign(D)
      const f = (await one(`SELECT private.aka_agent_send_exclusion_block_facts(c, $2, $3, NULL, $4) f FROM public.auto_campaigns c WHERE c.id=$1`, [c, C, G('V'), JSON.stringify(rules)])).f
      return f.facts?.zalo_friendship?.status === 'friend'
    })

    // ------------------------------------------------------------ ca đúng phải giữ
    const W = await acc(null)
    await zu(W, 'uW1', G('W'), 'Dung', PROFILE('uW1', G('W'), 'Dung'))
    await zu(D, 'uD-W', G('W'), 'Dung', PROFILE('uD-W', G('W'), 'Dung'))
    await cas('G1 bước B, danh sách: thành viên có dòng đọc hồ sơ (tin được) vẫn khớp', true,
      async () => !!(await match(D, { blocklistIds: [await list(W, ['uW1'])] }, G('W'), 'uD-W', true)).match)
    await zu(W, 'uW2', G('X'), 'Em', SCAN_THEN_PROFILE('uW2', G('X')))
    await cas('G2 bước B, Nhóm data: thành viên quét nhóm rồi đọc hồ sơ ghi đè (tin được) vẫn khớp', true,
      async () => !!(await match(D, { dataGroupIds: [await dataGroup([[W, 'uW2']])] }, G('X'), null, true)).match)
    await zu(W, 'uW3', G('Y'), 'Giang', {})
    await cas('G3 bước B, danh sách: dòng không có raw_payload (đường cũ) vẫn khớp', true,
      async () => !!(await match(D, { blocklistIds: [await list(W, ['uW3'])] }, G('Y'), null, true)).match)
    await zu(D, 'uD-W1', G('W'), 'Dung', PROFILE('uD-W1', G('W'), 'Dung'))
    await cas('G4 bước A, danh sách: Global ID của data từ dòng tin được (người đổi Zalo ID, 2 dòng cùng tên) vẫn khớp', true,
      async () => !!(await match(D, { blocklistIds: [await list(W, ['uW1'])] }, null, 'uD-W1', false)).match)
    const Z = await acc(null)
    // Zalo ID của data đã gửi trùng chuỗi Zalo ID của V ở D (ứng viên), xác minh bằng Global ID trong kết quả gửi.
    const SZ = await sentCampaign(Z, 'uD-W', { uid: 'uD-W', globalId: G('W') })
    await cas('G5 bước B, chiến dịch đã gửi: kết quả gửi ghi Global ID, tài khoản đã gửi không lưu dòng zalo_users ⇒ vẫn khớp', true,
      async () => !!(await match(D, { sentCampaignIds: [SZ] }, G('W'), 'uD-W', true)).match)
    await cas('G6 bước A, danh sách cùng tài khoản: Zalo ID của data nằm trong danh sách (so thẳng Zalo ID cùng nick) vẫn khớp dù dòng là quét nhóm', true,
      async () => !!(await match(C, { blocklistIds: [LC] }, null, 'uC1', false)).match)
    await cas('G7 dữ kiện Zalo khác: bạn bè từ dòng tin được vẫn là bạn bè', true, async () => {
      await zu(W, 'uW-fr', G('V'), 'Chủ nick V', PROFILE('uW-fr', G('V'), 'Chủ nick V'), { is_fr: 1 })
      const rules = [{ fieldId: (await one(`SELECT id FROM public.auto_filter_fields WHERE source_key='zalo_friendship' LIMIT 1`)).id, operatorId: 1, value: 'friend', isEnabled: true }]
      const c = await campaign(D)
      const f = (await one(`SELECT private.aka_agent_send_exclusion_block_facts(c, $2, $3, NULL, $4) f FROM public.auto_campaigns c WHERE c.id=$1`, [c, W, G('V'), JSON.stringify(rules)])).f
      return f.facts?.zalo_friendship?.status === 'friend'
    })
  } finally { await T.stop() }
  return results
}

async function main() {
  const current = await variant(false)
  const proposal = await variant(true)
  let ok = true
  console.log('ca'.padEnd(4), 'đúng phải là'.padEnd(13), 'V657 đang chạy'.padEnd(16), 'đề xuất'.padEnd(10), 'mô tả')
  for (let k = 0; k < current.length; k++) {
    const c = current[k], p = proposal[k]
    const fmt = r => r.error ? 'LỖI' : r.got ? 'khớp' : 'không khớp'
    const pOk = !p.error && p.got === p.expected
    const isHole = c.name.startsWith('H')
    const cCaught = isHole ? (!c.error && c.got !== c.expected) : (!c.error && c.got === c.expected)
    if (!pOk || !cCaught) ok = false
    console.log(c.name.slice(0, 3).padEnd(4), (c.expected ? 'khớp' : 'không khớp').padEnd(13), (fmt(c) + (isHole ? (cCaught ? ' (sai)' : ' (?)') : (cCaught ? '' : ' (sai!)'))).padEnd(16),
      (fmt(p) + (pOk ? '' : ' (SAI)')).padEnd(10), c.name.slice(3), c.error || p.error ? ` — ${c.error || ''} ${p.error || ''}` : '')
  }
  console.log(ok ? '\nĐẠT: đề xuất đúng mọi ca; V657 đang chạy sai đúng các ca lỗ hổng, đúng các ca phải giữ.' : '\nKHÔNG ĐẠT')
  if (!ok) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })

#!/usr/bin/env node
// Kiểm V657 (loại trừ gửi so theo SĐT / Global ID, lọc ở bước nhận data) trên PostgreSQL cục bộ có engine v2 đúng bản production.
//   PG_MODULE_DIR=<thư mục có node_modules/pg> LC_ALL=C node scripts/send-exclusion-v657-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { buildDb } = require('./send-exclusion-v657-fixture.cjs')

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}: ${e.stack || e.message}`) }
}

const ORG = 701
const STAFF = 7101
const OTHER_STAFF = 7102
const B = 70201            // Zalo khác của nhân viên (chủ danh sách, đã gửi chiến dịch cũ)
const FB = 70209           // tài khoản Facebook cùng tổ chức (liên hệ SĐT của Nhóm data có thể gắn tài khoản này)
const GX = 'GLOBALX0000000000000000000000001'
const P1 = '0912345678'
let seq = 1000

async function main() {
  const T = await buildDb()
  const { db, one, q } = T
  const ins = async (table, rows) => {
    rows = Array.isArray(rows) ? rows : [rows]
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).map(r => r.column_name)
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols.includes(k))
    const list = keys.map(k => `"${k}"`).join(', ')
    await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`, [JSON.stringify(rows)])
  }
  const id = () => ++seq
  try {
    await T.applyV657()
    // ------------------------------------------------------------------ dữ liệu nền
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'Org thử') ON CONFLICT DO NOTHING`, [ORG])
    await ins('org_staff', [{ id: STAFF, organization_id: ORG, username: 's1', password: 'pw', is_active: true }, { id: OTHER_STAFF, organization_id: ORG, username: 's2', password: 'pw', is_active: true }])
    const cat = async code => (await one(`SELECT id FROM public.category_item WHERE code=$1 LIMIT 1`, [code]))?.id
    let catPhone = await cat('phone'); let catPerson = await cat('zalo_person')
    if (!catPhone) { catPhone = 990001; await ins('category_item', { id: catPhone, code: 'phone', name: 'Số điện thoại' }) }
    if (!catPerson) { catPerson = 990002; await ins('category_item', { id: catPerson, code: 'zalo_person', name: 'Zalo User' }) }
    const acc = async (accId, extra = {}) => ins('auto_accounts', { id: accId, name: 'Zalo ' + accId, flatform_type: 'zalo', login_status: 'đã đăng nhập', status: 'chờ xử lý',
      is_active: true, is_delete: false, staff_id: STAFF, organization_id: ORG, is_zalo_server: false, is_zalo_show_web: false, ...extra })
    await acc(B)
    await acc(FB, { flatform_type: 'facebook' })
    const zu = (account, uid, gid, extra = {}) => ins('zalo_users', { id: id(), account_id: account, zalo_uid: uid, global_id: gid, staff_id: STAFF, organization_id: ORG, is_fr: 0, ...extra })
    const contact = async (account, type, uid, extra = {}) => { const cid = id(); await ins('auto_account_contacts', { id: cid, account_id: account, contact_type: type, uid, is_delete: false, staff_id: STAFF, organization_id: ORG, flatform_type: 'zalo', ...extra }); return cid }
    const group = async (extra) => { const gid = id(); await ins('auto_account_contact_groups', { id: gid, is_delete: false, staff_id: STAFF, organization_id: ORG, name: 'G' + gid, ...extra }); return gid }
    const member = (groupId, contactId) => ins('auto_account_contact_group_members', { id: id(), group_id: groupId, contact_id: contactId, is_delete: false })
    const detail = (campaignId, inputId, account, action, status, data = {}, extra = {}) => ins('auto_campaign_details',
      { id: id(), campaign_id: campaignId, input_data_id: inputId, account_id: account, action_code: action, action_name: action, staff_id: STAFF, organization_id: ORG, status, is_delete: false, created_at: new Date().toISOString(), data, ...extra })
    const campaign = async (account, action, selection, extra = {}) => {
      const cid = id()
      await ins('auto_campaigns', { id: cid, name: 'C' + cid, action_id: action, account_id: account, status: 'chờ xử lý', is_delete: false, staff_id: STAFF, organization_id: ORG,
        schedule: new Date(Date.now() - 60000).toISOString(), schedule_type: 'daily',
        extra_settings: { enableMessage: true, ...(selection ? { zaloSendExclusionsByAccountId: { [account]: { groupId: null, blocklistIds: [], ...selection } } } : {}), ...extra } })
      return cid
    }
    const camp0 = () => campaign(B, 'zalo_message_phone', null)
    const row = async (campaignId, fields) => { const rid = id(); await ins('auto_campaign_input_data', { id: rid, campaign_id: campaignId, status: 'chờ xử lý', is_delete: false, ...fields }); return rid }
    const status = async rid => one(`SELECT status, note FROM public.auto_campaign_input_data WHERE id=$1`, [rid])
    const asDesktop = async (staffId, fn) => {
      await db.query('BEGIN')
      try {
        await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [String(staffId)])
        await db.query('SET LOCAL ROLE aka_agent_desktop')
        const out = await fn(); await db.query('COMMIT'); return out
      } catch (e) { await db.query('ROLLBACK'); throw e }
    }
    const claim = (account, campaignId, actions) => asDesktop(STAFF, async () => (await one('SELECT public.aka_agent_engine_claim_target_v1($1) r',
      [{ staffId: STAFF, accountId: account, campaignId, runnerId: 'desktop:v657', runtimeTarget: 'desktop', actions: actions.map(code => ({ code })) }])).r)
    const PHONE_ACTIONS = ['zalo_find_phone_user', 'zalo_message_stranger']
    const match = async (campaignId, account, phone, gid, uid, final = true) => (await one(
      `SELECT private.aka_agent_send_exclusion_match(c, $2::bigint, c.extra_settings->'zaloSendExclusionsByAccountId'->($2::bigint::text), $3::text, $4::text, $5::text, $6::boolean) m FROM public.auto_campaigns c WHERE c.id=$1`,
      [campaignId, account, phone, gid, uid, final])).m

    // Người X: SĐT P1, Global ID GX; ở B Zalo ID riêng uB; lịch sử tra số (cho bảng đối chiếu) ở chiến dịch cũ của B.
    await zu(B, 'uB-1', GX)
    const oldCamp = await campaign(B, 'zalo_message_phone', null)
    const oldRow = await row(oldCamp, { phone: '0912 345 678', uid: 'uB-1', name: 'X' })
    await detail(oldCamp, oldRow, B, 'zalo_find_phone_user', 'thành công', { target: { phone: '+84912345678', uid: 'uB-1', globalId: GX } })

    await check('bảng đối chiếu nạp SĐT → Global ID từ Tìm SĐT thành công (SĐT chuẩn hoá)', async () => {
      const r = await one(`SELECT private.aka_agent_zalo_phone_identity_ingest(5000, 1000) r`)
      assert.ok(Number(r.r.rows) >= 1)
      const i = await one(`SELECT global_id FROM private.auto_zalo_phone_identity WHERE phone=$1`, [P1])
      assert.equal(i.global_id, GX)
    })

    await check('bước nhận data (engine): Nhóm data SĐT loại theo SĐT viết kiểu khác, data sau vẫn nhận', async () => {
      const ph = await contact(null, 'phone', P1, { flatform_type: null })
      const dg = await group({ purpose: 'data_group', data_type_category_item_id: catPhone, name: 'Khách cũ' })
      await member(dg, ph)
      const A = id(); await acc(A)
      const c = await campaign(A, 'zalo_message_phone', { dataGroupIds: [dg] })
      const r1 = await row(c, { phone: '+84 912.345.678', name: 'X' })
      const r2 = await row(c, { phone: '0987000111', name: 'Y' })
      const res = await claim(A, c, PHONE_ACTIONS)
      assert.equal(res.status, 'claimed', JSON.stringify(res))
      assert.equal(Number(res.target.id), r2)
      assert.equal(res.cooldownPaused.length, 1)
      assert.equal(Number(res.cooldownPaused[0].inputDataId), r1)
      assert.equal(res.cooldownPaused[0].note, 'Có trong Nhóm data “Khách cũ”.')
      assert.deepEqual(await status(r1), { status: 'tạm dừng', note: 'Có trong Nhóm data “Khách cũ”.' })
    })

    await check('bước nhận data: danh sách Zalo ID của Zalo khác loại theo Global ID (SĐT → Global ID qua bảng đối chiếu, trước khi tra số)', async () => {
      const cB = await contact(B, 'person', 'uB-1')
      const bl = await group({ purpose: 'zalo_friend_blocklist', account_id: B, contact_type: 'person', name: 'Bạn của B' })
      await member(bl, cB)
      const A = id(); await acc(A)
      const c = await campaign(A, 'zalo_message_phone', { blocklistIds: [bl] })
      const r1 = await row(c, { phone: P1 })
      const r2 = await row(c, { phone: '0987000222' })
      const res = await claim(A, c, PHONE_ACTIONS)
      assert.equal(Number(res.target.id), r2)
      assert.equal((await status(r1)).note, 'Thuộc danh sách Zalo ID loại trừ “Bạn của B”.')
    })

    await check('danh sách của chính Zalo đang gửi: Zalo ID riêng đã đổi vẫn loại (so theo Global ID)', async () => {
      const A = id(); await acc(A)
      await zu(A, 'uA-old', GX); await zu(A, 'uA-new', GX)
      const cOld = await contact(A, 'person', 'uA-old')
      const bl = await group({ purpose: 'zalo_friend_blocklist', account_id: A, contact_type: 'person', name: 'Bạn cũ của A' })
      await member(bl, cOld)
      const c = await campaign(A, 'zalo_message_friend', { blocklistIds: [bl] })
      const r1 = await row(c, { uid: 'uA-new', name: 'X' })
      const r2 = await row(c, { uid: 'uA-other', name: 'Z' })
      const res = await claim(A, c, ['zalo_message_friend'])
      assert.equal(Number(res.target.id), r2)
      assert.equal((await status(r1)).note, 'Thuộc danh sách Zalo ID loại trừ “Bạn cũ của A”.')
      // Bản đang chạy (V655, snapshot): danh sách của Zalo đang gửi chỉ có Zalo ID cũ → không nhận ra Zalo ID mới.
      const snap = await one(`SELECT private.aka_agent_send_exclusion_snapshot(c, $2, false) s FROM public.auto_campaigns c WHERE c.id=$1`, [c, A])
      assert.deepEqual(snap.s.blocklistUids, ['uA-old'])
      const snap2 = await one(`SELECT private.aka_agent_send_exclusion_snapshot(c, $2, true) s FROM public.auto_campaigns c WHERE c.id=$1`, [c, A])
      assert.deepEqual(snap2.s.blocklistUids, [])
      assert.deepEqual(snap2.s.remote.blocklistIds, [bl])
    })

    await check('chiến dịch đã gửi: nhận tin thành công ở Zalo khác (Zalo ID khác) → loại; chỉ tra số / gửi lỗi → không loại', async () => {
      const sent = await campaign(B, 'zalo_message_friend', null)
      const sRow = await row(sent, { uid: 'uB-1' })
      await detail(sent, sRow, B, 'zalo_message_friend', 'thành công', { target: { uid: 'uB-1', globalId: GX } })
      const failedCamp = await campaign(B, 'zalo_message_friend', null)
      const fRow = await row(failedCamp, { uid: 'uB-1' })
      await detail(failedCamp, fRow, B, 'zalo_message_friend', 'thất bại', { target: { uid: 'uB-1', globalId: GX } })
      const A = id(); await acc(A)
      await zu(A, 'uA-x', GX)
      const c1 = await campaign(A, 'zalo_message_friend', { sentCampaignIds: [sent] })
      const r1 = await row(c1, { uid: 'uA-x' })
      await row(c1, { uid: 'uA-y' })
      await claim(A, c1, ['zalo_message_friend'])
      assert.match((await status(r1)).note, /^Đã được gửi ở chiến dịch “C\d+” ngày \d{2}\/\d{2}\.$/)
      const A2 = id(); await acc(A2)
      await zu(A2, 'uA2-x', GX)
      const c2 = await campaign(A2, 'zalo_message_friend', { sentCampaignIds: [failedCamp] })
      const r2 = await row(c2, { uid: 'uA2-x' })
      const res = await claim(A2, c2, ['zalo_message_friend'])
      assert.equal(Number(res.target.id), r2)
      assert.equal((await status(r2)).status, 'đang chạy')
    })

    await check('chiến dịch đã gửi theo SĐT: người nhận theo UID (không có SĐT) vẫn nhận ra qua Global ID', async () => {
      const A = id(); await acc(A)
      await zu(A, 'uA-p', GX)
      const sentPhone = await campaign(B, 'zalo_message_phone', null)
      const sp = await row(sentPhone, { phone: P1, uid: 'uB-1' })
      await detail(sentPhone, sp, B, 'zalo_message_stranger', 'thành công', { target: { phone: P1, uid: 'uB-1', globalId: GX } })
      const c = await campaign(A, 'zalo_message_group_member', { sentCampaignIds: [sentPhone] })
      const r1 = await row(c, { uid: 'uA-p' })
      await row(c, { uid: 'uA-q' })
      await claim(A, c, ['zalo_message_stranger'])
      assert.equal((await status(r1)).status, 'tạm dừng')
    })

    await check('Nhóm data Zalo UID (liên hệ của Zalo khác) loại người nhận theo UID ở Zalo đang gửi; Nhóm data SĐT với người nhận theo UID qua bảng đối chiếu', async () => {
      const uidContact = await contact(B, 'person', 'uB-1')
      const dgu = await group({ purpose: 'data_group', data_type_category_item_id: catPerson, name: 'UID nhóm' })
      await member(dgu, uidContact)
      const A = id(); await acc(A)
      await zu(A, 'uA-z', GX)
      const m1 = await match(await campaign(A, 'zalo_message_friend', { dataGroupIds: [dgu] }), A, null, null, 'uA-z')
      assert.equal(m1.match.kind, 'data_group')
      const ph = await contact(FB, 'phone', P1, { flatform_type: 'facebook' })
      const dgp = await group({ purpose: 'data_group', data_type_category_item_id: catPhone, name: 'SĐT nhóm' })
      await member(dgp, ph)
      const m2 = await match(await campaign(A, 'zalo_message_friend', { dataGroupIds: [dgp] }), A, null, null, 'uA-z')
      assert.equal(m2.match.name, 'SĐT nhóm')
    })

    await check('chưa có Global ID: bước nhận data không loại (để sau tra số); sau tra số có Global ID thì loại; vẫn không có thì unknown', async () => {
      const cB = await contact(B, 'person', 'uB-1')
      const bl = await group({ purpose: 'zalo_friend_blocklist', account_id: B, contact_type: 'person', name: 'BL2' })
      await member(bl, cB)
      const A = id(); await acc(A)
      const c = await campaign(A, 'zalo_message_phone', { blocklistIds: [bl] })
      const m0 = await match(c, A, '0977111222', null, null, false)
      assert.equal(m0.match, null); assert.equal(m0.needGlobalId, true); assert.equal(m0.unknown, null)
      const m1 = await match(c, A, '0977111222', GX, 'uA-new2', true)
      assert.equal(m1.match.kind, 'blocklist')
      const m2 = await match(c, A, null, null, 'uid-khong-biet', true)
      assert.equal(m2.unknown, 'Chưa xác định được khách để kiểm tra loại trừ.')
      const rr = await row(c, { phone: '0977111222' })
      const remote = await one(`SELECT private.aka_agent_send_exclusion_remote(c, $2::bigint, $3::bigint, $4::jsonb) r FROM public.auto_campaigns c WHERE c.id=$1`,
        [c, A, rr, { uid: 'uA-n', globalId: GX, phone: '0977111222' }])
      assert.equal(remote.r.match.kind, 'blocklist')
      const remote2 = await one(`SELECT private.aka_agent_send_exclusion_remote(c, $2::bigint, $3::bigint, $4::jsonb) r FROM public.auto_campaigns c WHERE c.id=$1`, [c, A, rr, { uid: 'x' }])
      assert.equal(remote2.r.match, null); assert.equal(remote2.r.unknown, 'Chưa xác định được khách để kiểm tra loại trừ.')
    })

    await check('công tắc campaign.send_exclusion_precheck {"enabled":false} tắt bước nhận data; chiến dịch không loại trừ không đổi', async () => {
      const ph = await contact(null, 'phone', '0933000111', { flatform_type: null })
      const dg = await group({ purpose: 'data_group', data_type_category_item_id: catPhone, name: 'Tắt' })
      await member(dg, ph)
      await db.query(`INSERT INTO public.auto_system_settings(key, value, description) VALUES ('campaign.send_exclusion_precheck','{"enabled":false}','thử')`)
      const A = id(); await acc(A)
      const c = await campaign(A, 'zalo_message_phone', { dataGroupIds: [dg] })
      const r1 = await row(c, { phone: '0933000111' })
      const res = await claim(A, c, PHONE_ACTIONS)
      assert.equal(Number(res.target.id), r1)
      await db.query(`DELETE FROM public.auto_system_settings WHERE key='campaign.send_exclusion_precheck'`)
      const A2 = id(); await acc(A2)
      const c2 = await campaign(A2, 'zalo_message_phone', null)
      const r2 = await row(c2, { phone: '0933000111' })
      const res2 = await claim(A2, c2, PHONE_ACTIONS)
      assert.equal(Number(res2.target.id), r2); assert.deepEqual(res2.cooldownPaused, [])
    })

    await check('khối điều kiện Zalo khác: bạn bè xét mọi Zalo ID của Global ID', async () => {
      await zu(B, 'uB-old-fr', GX, { is_fr: 1 })
      const rules = [{ fieldId: (await one(`SELECT id FROM public.auto_filter_fields WHERE source_key='zalo_friendship' LIMIT 1`)).id, operatorId: 1, value: 'friend', isEnabled: true }]
      const f = await one(`SELECT private.aka_agent_send_exclusion_block_facts(c, $2, $3, NULL, $4) f FROM public.auto_campaigns c WHERE c.id=$1`, [oldCamp, B, GX, JSON.stringify(rules)])
      assert.equal(f.f.facts.zalo_friendship.status, 'friend')
    })

    await check('xem trước ở bước lưu: đếm theo nguồn, chưa xác định tính riêng, không đổi data', async () => {
      const ph = await contact(null, 'phone', '0944000111', { flatform_type: null })
      const dg = await group({ purpose: 'data_group', data_type_category_item_id: catPhone, name: 'Xem trước' })
      await member(dg, ph)
      const cB = await contact(B, 'person', 'uB-1')
      const bl = await group({ purpose: 'zalo_friend_blocklist', account_id: B, contact_type: 'person', name: 'BL xem trước' })
      await member(bl, cB)
      const A = id(); await acc(A)
      const sel = { groupId: null, blocklistIds: [bl], dataGroupIds: [dg], sentCampaignIds: [] }
      const res = await one(`SELECT public.aka_agent_send_exclusion_v2($1, $2, 'preview', $3, 's1', 'pw') r`, [STAFF, ORG,
        { accountId: A, selection: sel, targets: [{ phone: '0944000111' }, { phone: P1 }, { phone: '0955000999' }, { uid: 'not-known' }] }]).catch(e => ({ error: e.message }))
      if (res.error) throw new Error(res.error)
      assert.equal(res.r.checked, 4); assert.equal(res.r.excluded, 2); assert.equal(res.r.pending, 2)
      assert.deepEqual(res.r.sources.map(s => [s.kind, s.count]).sort(), [['blocklist', 1], ['data_group', 1]])
    })

    await check('bộ chạy cũ: thao tác precheck tạm dừng data khớp, trả lý do; data không khớp giữ nguyên', async () => {
      const ph = await contact(null, 'phone', '0966000111', { flatform_type: null })
      const dg = await group({ purpose: 'data_group', data_type_category_item_id: catPhone, name: 'Cũ' })
      await member(dg, ph)
      const A = id(); await acc(A)
      const c = await campaign(A, 'zalo_message_phone', { dataGroupIds: [dg] })
      const token = '00000000-0000-4000-8000-00000000a001'
      await db.query(`UPDATE public.auto_campaigns SET runtime_claim_token=$2 WHERE id=$1`, [c, token])
      const r1 = await row(c, { phone: '0966000111' })
      const r2 = await row(c, { phone: '0966000999' })
      const call = async rid => (await one(`SELECT public.aka_agent_campaign_send_exclusion_runtime($1, $2, $3, $4, 'precheck', $5) r`, [c, A, STAFF, token, { inputId: rid }])).r
      assert.deepEqual(await call(r1), { excluded: true, note: 'Có trong Nhóm data “Cũ”.', changed: true })
      assert.deepEqual(await call(r2), { excluded: false })
      assert.equal((await status(r2)).status, 'chờ xử lý')
    })

    await check('Nhóm data: người ở cả Nhóm SĐT lẫn Nhóm Zalo UID → ghi chú theo tên nhóm (xếp chung), không theo loại nhóm', async () => {
      const ph = await contact(null, 'phone', P1, { flatform_type: null })
      const gPhone = await group({ purpose: 'data_group', data_type_category_item_id: catPhone, name: 'zz SĐT' })
      await member(gPhone, ph)
      const pc = await contact(B, 'person', 'uB-1')
      const gPerson = await group({ purpose: 'data_group', data_type_category_item_id: catPerson, name: 'aa UID' })
      await member(gPerson, pc)
      const A = id(); await acc(A)
      const c = await campaign(A, 'zalo_message_phone', { dataGroupIds: [gPhone, gPerson] })
      const m = await match(c, A, P1, null, null, false)
      assert.equal(m.match.name, 'aa UID')
      const m2 = await match(c, A, '0999888777', null, null, false)
      assert.equal(m2.match, null); assert.equal(m2.needGlobalId, true)
    })

    await check('bảng đối chiếu: dòng Tìm SĐT commit muộn (id nhỏ hơn mốc đã nạp) vẫn được nạp ở lượt sau', async () => {
      await one(`SELECT private.aka_agent_zalo_phone_identity_ingest(5000, 1000) r`)
      const last = Number((await one(`SELECT last_detail_id l FROM private.auto_zalo_phone_identity_state`)).l)
      const late = await camp0()
      const lateId = Number((await one(`SELECT g FROM generate_series($1::bigint-200,$1::bigint-1) g WHERE NOT EXISTS (SELECT 1 FROM public.auto_campaign_details d WHERE d.id=g) ORDER BY g DESC LIMIT 1`, [last])).g)
      await ins('auto_campaign_details', { id: lateId, campaign_id: late, account_id: B, action_code: 'zalo_find_phone_user', action_name: 'x', staff_id: STAFF, organization_id: ORG,
        status: 'thành công', is_delete: false, created_at: new Date().toISOString(), data: { target: { phone: '0977 555 444', globalId: 'GLATE' } } })
      await one(`SELECT private.aka_agent_zalo_phone_identity_ingest(5000, 1000) r`)
      assert.equal((await one(`SELECT global_id FROM private.auto_zalo_phone_identity WHERE phone='0977555444'`))?.global_id, 'GLATE')
      assert.equal(Number((await one(`SELECT last_detail_id l FROM private.auto_zalo_phone_identity_state`)).l) >= last, true)
    })

    await check('gỡ V657 trả đúng md5 production; apply lại được', async () => {
      await T.rollbackV657()
      await T.applyV657()
    })
  } finally { await T.stop() }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  if (failed) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })

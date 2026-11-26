#!/usr/bin/env node
// Kiểm V666 (sửa lỗi review loại trừ gửi) trên PostgreSQL cục bộ dựng tới V657 như production (send-exclusion-v657-fixture.cjs).
//   PG_MODULE_DIR=<thư mục có node_modules/pg> LC_ALL=C node scripts/send-exclusion-v666-smoke.cjs [--write-md5]
// --write-md5: ghi md5(pg_get_functiondef) của 7 thân mới vào scripts/fixtures/send-exclusion-v666/new-md5.json (bản gỡ kiểm theo file này),
// rồi chạy lại node scripts/build-v666-sql.cjs.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { buildDb } = require('./send-exclusion-v657-fixture.cjs')
const V666 = require('./build-v666-sql.cjs')

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}: ${e.stack || e.message}`) }
}

const ORG = 701
const STAFF = 7101
const OTHER_STAFF = 7102
const B = 70201
const GX = 'GLOBALX0000000000000000000000001'
const P1 = '0912345678'
let seq = 5000

async function main() {
  const T = await buildDb({ label: 'aka-v666-' })
  const { db, one, q, read } = T
  const ins = async (table, rows) => {
    rows = Array.isArray(rows) ? rows : [rows]
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).map(r => r.column_name)
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols.includes(k))
    const list = keys.map(k => `"${k}"`).join(', ')
    await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`, [JSON.stringify(rows)])
  }
  const id = () => ++seq
  const md5Of = async sig => (await one('SELECT md5(pg_get_functiondef(to_regprocedure($1))) m', [sig])).m
  const setting = async (key, value) => db.query(`INSERT INTO public.auto_system_settings(key, value, is_active) VALUES ($1, $2, true)
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, is_active=true`, [key, JSON.stringify(value)])
  const expectError = async (fn, code) => {
    let err = null
    try { await fn() } catch (e) { err = e }
    assert.ok(err, 'phải lỗi ' + code)
    assert.match(String(err.message), new RegExp(code))
  }
  try {
    await T.applyV657()
    // Hai hàm nhận lượt không có trong bộ dựng V657: nạp đúng thân production 26/11 (thân tham chiếu bảng / hàm của các migration khác,
    // nên tắt kiểm thân lúc tạo; các nhánh chạy trong bài này chỉ cần bảng đã có).
    await db.query('SET check_function_bodies = off')
    await db.query(V666.OLD.claim)
    await db.query(V666.OLD.engineClaim)
    await db.query('SET check_function_bodies = on')
    await check('preflight: 7 hàm sau V657 trên DB thử trùng md5 production 26/11', async () => {
      for (const k of V666.ORDER) assert.equal(await md5Of(V666.SIG[k]), V666.OLD_MD5[k], k)
    })
    await db.query(`CREATE TABLE IF NOT EXISTS public.auto_staff_device_presence (id bigserial PRIMARY KEY, staff_id bigint, app_version text, last_seen_at timestamptz)`)
    await db.query(`ALTER TABLE public.auto_staff_device_presence ADD COLUMN IF NOT EXISTS device_fingerprint_hash text, ADD COLUMN IF NOT EXISTS ended_at timestamptz`)
    await db.query(`ALTER TABLE public.org_staff ADD COLUMN IF NOT EXISTS is_admin_akabiz boolean, ADD COLUMN IF NOT EXISTS aka_agent_device_fingerprint_hash text`)
    const constraint = await one(`SELECT count(*)::int n FROM pg_constraint WHERE conrelid='public.auto_system_settings'::regclass AND contype IN ('u','p') AND pg_get_constraintdef(oid) ILIKE '%(key)%'`)
    if (!constraint.n) await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS auto_system_settings_key_t ON public.auto_system_settings(key)`)
    await db.query(`INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('20261125211830','migration_v657_send_exclusion_global_match_p2','{}') ON CONFLICT DO NOTHING`)
    await db.query(read('migrations/migration_v666_send_exclusion_review_fixes.sql'))
    await check('apply V666: 7 hàm có dấu V666, thiết lập send_exclusion.runtime mặc định chặn', async () => {
      for (const k of V666.ORDER) assert.ok((await one('SELECT pg_get_functiondef(to_regprocedure($1)) d', [V666.SIG[k]])).d.includes('V666'))
      const s = await one(`SELECT value FROM public.auto_system_settings WHERE key='send_exclusion.runtime'`)
      assert.deepEqual(JSON.parse(s.value), { server: false, desktopMinVersion: null })
    })
    const newMd5 = {}
    for (const k of V666.ORDER) newMd5[k] = await md5Of(V666.SIG[k])
    if (process.argv.includes('--write-md5')) { fs.writeFileSync(V666.NEW_MD5_FILE, JSON.stringify(newMd5, null, 1) + '\n'); console.log('ghi', V666.NEW_MD5_FILE) }

    // ------------------------------------------------------------------ dữ liệu nền (như send-exclusion-v657-smoke.cjs)
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'Org thử') ON CONFLICT DO NOTHING`, [ORG])
    await ins('org_staff', [{ id: STAFF, organization_id: ORG, username: 's1', password: 'pw', is_active: true }, { id: OTHER_STAFF, organization_id: ORG, username: 's2', password: 'pw', is_active: true }])
    const cat = async code => (await one(`SELECT id FROM public.category_item WHERE code=$1 LIMIT 1`, [code]))?.id
    let catPhone = await cat('phone'); let catPerson = await cat('zalo_person')
    if (!catPhone) { catPhone = 990001; await ins('category_item', { id: catPhone, code: 'phone', name: 'Số điện thoại' }) }
    if (!catPerson) { catPerson = 990002; await ins('category_item', { id: catPerson, code: 'zalo_person', name: 'Zalo User' }) }
    const acc = async (accId, extra = {}) => ins('auto_accounts', { id: accId, name: 'Zalo ' + accId, flatform_type: 'zalo', login_status: 'đã đăng nhập', status: 'chờ xử lý',
      is_active: true, is_delete: false, staff_id: STAFF, organization_id: ORG, is_zalo_server: false, is_zalo_show_web: false, ...extra })
    await acc(B)
    const zu = (account, uid, gid, extra = {}) => ins('zalo_users', { id: id(), account_id: account, zalo_uid: uid, global_id: gid, staff_id: STAFF, organization_id: ORG, is_fr: 0, ...extra })
    const contact = async (account, type, uid, extra = {}) => { const cid = id(); await ins('auto_account_contacts', { id: cid, account_id: account, contact_type: type, uid, is_delete: false, staff_id: STAFF, organization_id: ORG, flatform_type: 'zalo', ...extra }); return cid }
    const group = async (extra) => { const gid = id(); await ins('auto_account_contact_groups', { id: gid, is_delete: false, staff_id: STAFF, organization_id: ORG, name: 'G' + gid, ...extra }); return gid }
    const member = (groupId, contactId) => ins('auto_account_contact_group_members', { id: id(), group_id: groupId, contact_id: contactId, is_delete: false })
    const detail = (campaignId, inputId, account, action, status, data = {}) => ins('auto_campaign_details',
      { id: id(), campaign_id: campaignId, input_data_id: inputId, account_id: account, action_code: action, action_name: action, staff_id: STAFF, organization_id: ORG, status, is_delete: false, created_at: new Date().toISOString(), data })
    const campaign = async (account, action, selection, extra = {}) => {
      const cid = id()
      await ins('auto_campaigns', { id: cid, name: 'C' + cid, action_id: action, account_id: account, status: 'chờ xử lý', is_delete: false, staff_id: STAFF, organization_id: ORG,
        schedule: new Date(Date.now() - 60000).toISOString(), schedule_type: 'daily',
        extra_settings: { enableMessage: true, ...(selection ? { zaloSendExclusionsByAccountId: { [account]: { groupId: null, blocklistIds: [], ...selection } } } : {}), ...extra } })
      return cid
    }
    const row = async (campaignId, fields) => { const rid = id(); await ins('auto_campaign_input_data', { id: rid, campaign_id: campaignId, status: 'chờ xử lý', is_delete: false, ...fields }); return rid }
    const selectionOf = async (cid, account) => (await one(`SELECT extra_settings->'zaloSendExclusionsByAccountId'->$2::text s FROM public.auto_campaigns WHERE id=$1`, [cid, String(account)])).s
    const setSelection = (cid, account, sel) => db.query(`UPDATE public.auto_campaigns SET extra_settings=jsonb_set(extra_settings,'{zaloSendExclusionsByAccountId}',$2::jsonb) WHERE id=$1`,
      [cid, JSON.stringify({ [account]: sel })])
    const ready = () => setting('send_exclusion.runtime', { server: true, desktopMinVersion: '10.7.0' })
    const match = async (campaignId, account, phone, gid, uid, final = true) => (await one(
      `SELECT private.aka_agent_send_exclusion_match(c, $2::bigint, c.extra_settings->'zaloSendExclusionsByAccountId'->($2::bigint::text), $3::text, $4::text, $5::text, $6::boolean) m FROM public.auto_campaigns c WHERE c.id=$1`,
      [campaignId, account, phone, gid, uid, final])).m
    const v2 = async (op, payload, staff = STAFF) => (await one(`SELECT public.aka_agent_send_exclusion_v2($1, $2, $3, $4, $5, 'pw') r`, [staff, ORG, op, payload, staff === STAFF ? 's1' : 's2'])).r
    // Mỗi lần mở app là một phiên (dòng); máy gắn với tài khoản ở org_staff.aka_agent_device_fingerprint_hash.
    const presence = (staff, version, device = 'H1', extra = {}) => db.query(`INSERT INTO public.auto_staff_device_presence(staff_id, app_version, last_seen_at, device_fingerprint_hash, ended_at)
      VALUES ($1,$2,COALESCE($4::timestamptz, now()),$3,$5)`, [staff, version, device, extra.seenAt ?? null, extra.endedAt ?? null])

    // Người X: SĐT P1, Global ID GX ở B (uB-1); lịch sử tra số cho bảng đối chiếu.
    await zu(B, 'uB-1', GX)
    const oldCamp = await campaign(B, 'zalo_message_phone', null)
    const oldRow = await row(oldCamp, { phone: P1, uid: 'uB-1', name: 'X' })
    await detail(oldCamp, oldRow, B, 'zalo_find_phone_user', 'thành công', { target: { phone: '+84912345678', uid: 'uB-1', globalId: GX } })
    await one(`SELECT private.aka_agent_zalo_phone_identity_ingest(5000, 1000) r`)
    const dg = await group({ purpose: 'data_group', data_type_category_item_id: catPhone, name: 'Khách cũ' })
    await member(dg, await contact(null, 'phone', P1, { flatform_type: null }))

    // ------------------------------------------------------------------ 1. cổng lưu cấu hình mới
    await check('công tắc tắt: lưu chiến dịch có Nhóm data bị từ chối (send_exclusion_multi_zalo_off)', async () => {
      await setting('campaign.send_exclusion_multi_zalo_v2', { audience: 'off' })
      await expectError(() => campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] }), 'send_exclusion_multi_zalo_off')
      await setting('campaign.send_exclusion_multi_zalo_v2', { audience: 'admin_akabiz' })
      await expectError(() => campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] }), 'send_exclusion_multi_zalo_off')
    })
    await check('công tắc thiếu dòng / tắt dòng / không phải object / thiếu audience / khoá cũ bật: vẫn là tắt', async () => {
      await db.query(`DELETE FROM public.auto_system_settings WHERE key='campaign.send_exclusion_multi_zalo_v2'`)
      await setting('campaign.send_exclusion_multi_zalo', { audience: 'all' }) // khoá cũ (Desktop 10.7.0 / Web v144) không mở cổng mới
      await expectError(() => campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] }), 'send_exclusion_multi_zalo_off')
      for (const raw of ['"all"', '{}', '{"audience":null}', 'không phải json']) {
        await db.query(`INSERT INTO public.auto_system_settings(key, value, is_active) VALUES ('campaign.send_exclusion_multi_zalo_v2', $1, true)
          ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, is_active=true`, [raw])
        await expectError(() => campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] }), 'send_exclusion_multi_zalo_off')
        assert.equal((await one(`SELECT private.aka_agent_send_exclusion_multi_on($1) r`, [STAFF])).r, false, raw)
      }
      await setting('campaign.send_exclusion_multi_zalo_v2', { audience: 'all' })
      await db.query(`UPDATE public.auto_system_settings SET is_active=false WHERE key='campaign.send_exclusion_multi_zalo_v2'`)
      assert.equal((await one(`SELECT private.aka_agent_send_exclusion_multi_on($1) r`, [STAFF])).r, false)
      await setting('campaign.send_exclusion_multi_zalo_v2', { audience: 'off' })
    })
    await check('công tắc bật, máy chưa đủ bản mới: send_exclusion_runtime_outdated; đủ bản thì lưu được', async () => {
      await setting('campaign.send_exclusion_multi_zalo_v2', { audience: 'all' })
      await expectError(() => campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] }), 'send_exclusion_runtime_outdated')
      await setting('send_exclusion.runtime', { server: false, desktopMinVersion: '10.7.0' })
      await expectError(() => campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] }), 'send_exclusion_runtime_outdated') // chưa gắn máy nào
      await db.query(`UPDATE public.org_staff SET aka_agent_device_fingerprint_hash='H1' WHERE id=$1`, [STAFF])
      await presence(STAFF, '10.6.0', 'H1', { seenAt: new Date(Date.now() - 3600e3).toISOString(), endedAt: new Date(Date.now() - 3500e3).toISOString() })
      await expectError(() => campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] }), 'send_exclusion_runtime_outdated')
      // Cập nhật app: phiên mới của cùng máy ≥ bản tối thiểu; phiên cũ (bản cũ) vẫn còn trong bảng nhưng không chặn nữa.
      await presence(STAFF, '10.7.1', 'H1')
      const c = await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] })
      assert.deepEqual((await selectionOf(c, B)).dataGroupIds, [dg])
      // Máy cũ đã đổi (không còn gắn) có phiên bản cũ đã kết thúc: không chặn. Máy khác đang mở app bản cũ: chặn.
      await presence(STAFF, '9.9.0', 'H0', { seenAt: new Date(Date.now() - 86400e3 * 3).toISOString(), endedAt: new Date(Date.now() - 86400e3 * 3).toISOString() })
      await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] })
      await presence(STAFF, '10.5.0', 'H2')
      await expectError(() => campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] }), 'send_exclusion_runtime_outdated')
      await db.query(`UPDATE public.auto_staff_device_presence SET ended_at=now() WHERE device_fingerprint_hash='H2'`)
      await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] })
    })
    await check('admin akaBiz khi công tắc admin_akabiz: lưu được', async () => {
      await setting('campaign.send_exclusion_multi_zalo_v2', { audience: 'admin_akabiz' })
      await db.query(`UPDATE public.org_staff SET is_admin_akabiz=true WHERE id=$1`, [STAFF])
      await campaign(B, 'zalo_message_phone', { sentCampaignIds: [oldCamp] })
      await db.query(`UPDATE public.org_staff SET is_admin_akabiz=false WHERE id=$1`, [STAFF])
      await setting('campaign.send_exclusion_multi_zalo_v2', { audience: 'all' })
    })
    await check('tài khoản Zalo Server: cần server=true (send_exclusion_server_not_ready)', async () => {
      const S = id(); await acc(S, { is_zalo_server: true })
      await expectError(() => campaign(S, 'zalo_message_phone', { dataGroupIds: [dg] }), 'send_exclusion_server_not_ready')
      await setting('send_exclusion.runtime', { server: true, desktopMinVersion: '10.7.0' })
      await campaign(S, 'zalo_message_phone', { dataGroupIds: [dg] })
    })
    await check('cấu hình kiểu cũ (danh sách của chính Zalo) không bị cổng chặn kể cả khi chưa đủ bản', async () => {
      await setting('send_exclusion.runtime', { server: false, desktopMinVersion: '99.0.0' })
      const bl = await group({ purpose: 'zalo_friend_blocklist', account_id: B, contact_type: 'person', name: 'BL cũ' })
      await member(bl, await contact(B, 'person', 'uB-1'))
      await campaign(B, 'zalo_message_friend', { blocklistIds: [bl] })
    })
    await check('sửa chỗ khác (tên) của chiến dịch đã có cấu hình mới khi máy chưa đủ bản: vẫn lưu được', async () => {
      await setting('send_exclusion.runtime', { server: true, desktopMinVersion: '10.7.0' })
      const c = await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] })
      await setting('send_exclusion.runtime', { server: false, desktopMinVersion: '99.0.0' })
      await db.query(`UPDATE public.auto_campaigns SET name='Đổi tên', extra_settings=extra_settings||'{"x":1}'::jsonb WHERE id=$1`, [c])
      await expectError(() => setSelection(c, B, { groupId: null, blocklistIds: [], dataGroupIds: [dg], sentCampaignIds: [oldCamp] }), 'send_exclusion_runtime_outdated')
      await setting('send_exclusion.runtime', { server: true, desktopMinVersion: '10.7.0' })
    })

    // ------------------------------------------------------------------ 2. client cũ thiếu khoá
    await check('client cũ gửi lựa chọn thiếu dataGroupIds / sentCampaignIds: giữ giá trị đang lưu; mảng rỗng thì bỏ chọn', async () => {
      await ready()
      const c = await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg], sentCampaignIds: [oldCamp] })
      await setSelection(c, B, { groupId: null, blocklistIds: [] })
      let s = await selectionOf(c, B)
      assert.deepEqual(s.dataGroupIds, [dg]); assert.deepEqual(s.sentCampaignIds, [oldCamp])
      await setting('send_exclusion.runtime', { server: false, desktopMinVersion: '99.0.0' }) // giữ lại = không đổi lựa chọn mới → không qua cổng
      await setSelection(c, B, { groupId: null, blocklistIds: [] })
      await setting('send_exclusion.runtime', { server: true, desktopMinVersion: '10.7.0' })
      await setSelection(c, B, { groupId: null, blocklistIds: [], dataGroupIds: [], sentCampaignIds: [oldCamp] })
      s = await selectionOf(c, B)
      assert.deepEqual(s.dataGroupIds, []); assert.deepEqual(s.sentCampaignIds, [oldCamp])
    })

    await check('so lựa chọn: khoá thiếu = mảng rỗng (client mới ghi thêm [] không qua cổng, không chạy lại kiểm cấu hình)', async () => {
      await ready()
      const A2 = id(); await acc(A2)
      const blOther = await group({ purpose: 'zalo_friend_blocklist', account_id: A2, contact_type: 'person', name: 'BL Zalo khác' })
      // Cấu hình cần bản mới (danh sách của Zalo khác) do client trước V666 ghi (không có hai khoá mới).
      const c = await campaign(B, 'zalo_message_friend', { blocklistIds: [blOther] })
      assert.equal((await selectionOf(c, B)).dataGroupIds, undefined)
      await setting('send_exclusion.runtime', { server: false, desktopMinVersion: '99.0.0' })
      await setSelection(c, B, { groupId: null, blocklistIds: [blOther], dataGroupIds: [], sentCampaignIds: [] })
      assert.deepEqual((await selectionOf(c, B)).dataGroupIds, [])
      await setSelection(c, B, { groupId: null, blocklistIds: [blOther] }) // client cũ bỏ mảng rỗng: giữ [] đang lưu, không đổi nghĩa
      assert.deepEqual((await selectionOf(c, B)).sentCampaignIds, [])
      await expectError(() => setSelection(c, B, { groupId: null, blocklistIds: [blOther], dataGroupIds: [dg], sentCampaignIds: [] }), 'send_exclusion_runtime_outdated')
      assert.equal((await one(`SELECT private.aka_agent_send_exclusion_entry_norm('{"groupId":null,"blocklistIds":[1]}'::jsonb)
        = private.aka_agent_send_exclusion_entry_norm('{"groupId":null,"blocklistIds":[1],"dataGroupIds":[],"sentCampaignIds":[]}'::jsonb) r`)).r, true)
      assert.equal((await one(`SELECT private.aka_agent_send_exclusion_entry_norm('{"dataGroupIds":[2]}'::jsonb)->'dataGroupIds' r`)).r[0], 2)
      assert.equal((await one(`SELECT private.aka_agent_send_exclusion_map_norm('null'::jsonb) r`)).r, null)
      await setting('send_exclusion.runtime', { server: true, desktopMinVersion: '10.7.0' })
    })

    // ------------------------------------------------------------------ 3. so khớp
    await check('Nhóm data bị gỡ chia sẻ giữa lượt: vẫn loại (như V657); lượt sau snapshot báo nhóm không còn dùng được', async () => {
      await ready()
      const A = id(); await acc(A)
      const shared = await group({ purpose: 'data_group', data_type_category_item_id: catPhone, name: 'Của người khác', staff_id: OTHER_STAFF, sharing_scope: 'organization' })
      await member(shared, await contact(null, 'phone', '0933000111', { flatform_type: null, staff_id: OTHER_STAFF }))
      const c = await campaign(A, 'zalo_message_phone', { dataGroupIds: [shared] })
      assert.equal((await match(c, A, '0933000111', null, null, false)).match.kind, 'data_group')
      await db.query(`UPDATE public.auto_account_contact_groups SET sharing_scope='private' WHERE id=$1`, [shared])
      assert.equal((await match(c, A, '0933000111', null, null, false)).match.kind, 'data_group')
      await expectError(() => one(`SELECT public.aka_agent_internal_validate_send_exclusion_selection(extra_settings->'zaloSendExclusionsByAccountId', staff_id, organization_id, account_id) r
        FROM public.auto_campaigns WHERE id=$1`, [c]), 'send_exclusion_data_group_not_found')
    })
    await check('chiến dịch đã gửi: tra một lượt, lấy chiến dịch id nhỏ nhất có khớp, ngày gửi mới nhất', async () => {
      await ready()
      const A = id(); await acc(A)
      await zu(A, 'uA-s', GX)
      const s1 = await campaign(B, 'zalo_message_friend', null)
      const s2 = await campaign(B, 'zalo_message_friend', null)
      const r1 = await row(s1, { uid: 'uB-1' }); const r2 = await row(s2, { uid: 'uB-1' })
      await detail(s2, r2, B, 'zalo_message_friend', 'thành công', { target: { uid: 'uB-1', globalId: GX } })
      await detail(s1, r1, B, 'zalo_message_friend', 'thất bại', { target: { uid: 'uB-1', globalId: GX } })
      const c = await campaign(A, 'zalo_message_friend', { sentCampaignIds: [s1, s2] })
      const m = await match(c, A, null, null, 'uA-s', true)
      assert.equal(m.match.kind, 'campaign'); assert.equal(Number(m.match.id), s2)
      await detail(s1, r1, B, 'zalo_message_friend', 'thành công', { target: { uid: 'uB-1', globalId: GX } })
      assert.equal(Number((await match(c, A, null, null, 'uA-s', true)).match.id), s1)
      assert.equal((await match(c, A, null, null, 'uA-none', true)).match, null)
    })
    await check('xem trước data tự nhập không dùng bảng đối chiếu; data của chiến dịch đã lưu vẫn dùng', async () => {
      await ready()
      const A = id(); await acc(A)
      const blB = await group({ purpose: 'zalo_friend_blocklist', account_id: B, contact_type: 'person', name: 'BL dò' })
      await member(blB, await contact(B, 'person', 'uB-1'))
      const sel = { groupId: null, blocklistIds: [blB], dataGroupIds: [], sentCampaignIds: [] }
      const free = await v2('preview', { accountId: A, selection: sel, campaignId: null, targets: [{ phone: P1 }] })
      assert.equal(free.excluded, 0); assert.equal(free.pending, 1)
      const c = await campaign(A, 'zalo_message_phone', sel)
      await row(c, { phone: P1 })
      const saved = await v2('preview', { accountId: A, selection: sel, campaignId: c })
      assert.equal(saved.excluded, 1)
      assert.equal((await one(`SELECT current_setting('aka_agent.send_exclusion_identity', true) s`)).s || '', '')
    })

    // ------------------------------------------------------------------ 4. lists / save
    await check('lists: Nhóm data đã xoá của nhân viên khác không lộ tên / số; của mình thì có', async () => {
      const theirs = await group({ purpose: 'data_group', data_type_category_item_id: catPhone, name: 'Bí mật của s2', staff_id: OTHER_STAFF, is_delete: true })
      await member(theirs, await contact(null, 'phone', '0944000111', { flatform_type: null, staff_id: OTHER_STAFF }))
      const mine = await group({ purpose: 'data_group', data_type_category_item_id: catPhone, name: 'Của tôi đã xoá', is_delete: true })
      const r = await v2('lists', { kind: 'dataGroups', dataGroupIds: [theirs, mine] })
      const t = r.dataGroups.find(g => Number(g.id) === theirs), m = r.dataGroups.find(g => Number(g.id) === mine)
      assert.equal(t.name, 'Nhóm data #' + theirs); assert.equal(Number(t.count), 0); assert.equal(t.deleted, true)
      assert.equal(m.name, 'Của tôi đã xoá')
    })
    await check('lists: lọc trạng thái ở DB (chiến dịch đã chọn luôn có), sentCount đếm', async () => {
      const run = await campaign(B, 'zalo_message_friend', null)
      await db.query(`UPDATE public.auto_campaigns SET status='đang chạy' WHERE id=$1`, [run])
      const done = await campaign(B, 'zalo_message_friend', null)
      await db.query(`UPDATE public.auto_campaigns SET status='hoàn thành' WHERE id=$1`, [done])
      const rr = await row(done, { uid: 'x1' }); await detail(done, rr, B, 'zalo_message_friend', 'thành công', {})
      const r = await v2('lists', { kind: 'campaigns', status: 'đang chạy', sentCampaignIds: [done] })
      const ids = r.campaigns.map(c => Number(c.id))
      assert.ok(ids.includes(run)); assert.ok(ids.includes(done))
      assert.ok(r.campaigns.filter(c => Number(c.id) !== done).every(c => c.status === 'đang chạy'))
      assert.equal(Number(r.campaigns.find(c => Number(c.id) === done).sentCount), 1)
      // Đếm theo trạng thái thành công (chỉ mục), không theo policy_snapshot.
      const rr2 = await row(done, { uid: 'x2' }); await detail(done, rr2, B, 'zalo_message_stranger', 'đã xem', {}); await detail(done, rr2, B, 'zalo_message_friend', 'thất bại', {})
      assert.equal(Number((await v2('lists', { kind: 'campaigns', sentCampaignIds: [done] })).campaigns.find(c => Number(c.id) === done).sentCount), 2)
      const all = await v2('lists', { kind: 'campaigns' })
      assert.ok(all.campaigns.length > ids.length)
      assert.equal(r.dataGroups, null)
    })
    await check('save nhóm khi công tắc tắt: send_exclusion_multi_zalo_off; bật thì lưu được', async () => {
      await setting('campaign.send_exclusion_multi_zalo_v2', { audience: 'off' })
      const group = { requestId: '11111111-1111-4111-8111-111111111111', name: 'N', revision: 0, blocks: [{ accountId: B, matchMode: 'and', rules: [] }] }
      await expectError(() => v2('save', group), 'send_exclusion_multi_zalo_off')
      await setting('campaign.send_exclusion_multi_zalo_v2', { audience: 'all' })
      await expectError(() => v2('save', group), 'send_exclusion_rules_required|rules') // qua được cổng công tắc, tới bước kiểm điều kiện
    })

    // ------------------------------------------------------------------ 5. job nạp bảng đối chiếu
    await check('job nạp: chạy lại đoạn đã qua không khoá lại dòng cũ; Global ID đổi thì đếm changes', async () => {
      for (let i = 0; i < 30; i++) {
        const r = await row(oldCamp, { phone: `090000${String(i).padStart(4, '0')}` })
        await detail(oldCamp, r, B, 'zalo_find_phone_user', 'thành công', { target: { phone: `090000${String(i).padStart(4, '0')}`, uid: 'u' + i, globalId: 'G' + i } })
      }
      await one(`SELECT private.aka_agent_zalo_phone_identity_ingest(5000, 1000) r`)
      const before = await one(`SELECT count(*)::int n FROM private.auto_zalo_phone_identity WHERE xmax::text<>'0'`)
      await db.query(`UPDATE private.auto_zalo_phone_identity_state SET last_detail_id=0`) // đọc lại toàn bộ như đoạn overlap
      const second = await one(`SELECT private.aka_agent_zalo_phone_identity_ingest(5000, 1000) r`)
      assert.equal(Number(second.r.rows), 0)
      const locked = await one(`SELECT count(*)::int n FROM private.auto_zalo_phone_identity WHERE xmax::text<>'0'`)
      assert.equal(locked.n, before.n, 'không khoá lại dòng cũ')
      const st0 = await one(`SELECT changes FROM private.auto_zalo_phone_identity_state`)
      const r = await row(oldCamp, { phone: '0900000003' })
      await detail(oldCamp, r, B, 'zalo_find_phone_user', 'thành công', { target: { phone: '0900000003', uid: 'u3b', globalId: 'G3-new' } })
      const third = await one(`SELECT private.aka_agent_zalo_phone_identity_ingest(5000, 1000) r`)
      assert.equal(Number(third.r.rows), 1); assert.equal(Number(third.r.changes), 1)
      const st1 = await one(`SELECT changes FROM private.auto_zalo_phone_identity_state`)
      assert.equal(Number(st1.changes), Number(st0.changes) + 1)
      assert.equal((await one(`SELECT global_id FROM private.auto_zalo_phone_identity WHERE phone='0900000003'`)).global_id, 'G3-new')
    })
    await check('aka_agent_campaign_send_exclusion_runtime khoá FOR KEY SHARE', async () => {
      const d = (await one('SELECT pg_get_functiondef(to_regprocedure($1)) d', [V666.SIG.runtime])).d
      assert.ok(d.includes('FOR KEY SHARE OF campaign')); assert.ok(!d.includes('FOR UPDATE OF campaign'))
    })

    // ------------------------------------------------------------------ 5b. kiểm lúc nhận lượt (anh chốt 26/11)
    const DESKTOP_NOTE = 'akaAgent trên máy này là bản cũ nên chưa chạy được loại trừ theo Nhóm data, chiến dịch đã gửi hoặc nhiều Zalo. Hãy cập nhật akaAgent rồi bấm Tiếp tục.'
    const SERVER_NOTE = 'Loại trừ theo Nhóm data, chiến dịch đã gửi hoặc nhiều Zalo chưa dùng được với tài khoản Zalo Server.'
    const claimCheck = async (cid, account, runner, headers) => {
      await db.query('BEGIN')
      try {
        if (headers !== undefined) await db.query(`SELECT set_config('request.headers', $1, true)`, [headers])
        const r = (await one(`SELECT private.aka_agent_send_exclusion_claim_check($1, $2, $3) r`, [cid, account, runner])).r
        await db.query('COMMIT'); return r
      } catch (e) { await db.query('ROLLBACK'); throw e }
    }
    const statusOf = async cid => one(`SELECT status, note FROM public.auto_campaigns WHERE id=$1`, [cid])
    await check('kiểm lúc nhận lượt: bộ chạy báo bản mới (ctx / header) thì không chặn; bản cũ + cấu hình mới thì tạm dừng kèm ghi chú', async () => {
      await ready()
      const c = await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] })
      assert.equal(await claimCheck(c, B, '1'), null)
      assert.equal(await claimCheck(c, B, null, JSON.stringify({ 'x-aka-send-exclusion-runner': '1' })), null)
      assert.equal((await statusOf(c)).status, 'chờ xử lý')
      // header hỏng / runner không phải số: coi như bản cũ, không lỗi
      assert.equal(await claimCheck(c, B, 'abc', '{không phải json'), DESKTOP_NOTE)
      assert.deepEqual(await statusOf(c), { status: 'tạm dừng', note: DESKTOP_NOTE })
      // cấu hình kiểu cũ (danh sách của chính Zalo): bản cũ chạy đúng, không chặn
      const bl = await group({ purpose: 'zalo_friend_blocklist', account_id: B, contact_type: 'person', name: 'BL nhận lượt' })
      const c2 = await campaign(B, 'zalo_message_friend', { blocklistIds: [bl] })
      assert.equal(await claimCheck(c2, B, null), null)
      assert.equal((await statusOf(c2)).status, 'chờ xử lý')
      // chiến dịch không có cấu hình cho tài khoản này / không có loại trừ
      const c3 = await campaign(B, 'zalo_message_phone', null)
      assert.equal(await claimCheck(c3, B, null), null)
      // tài khoản Zalo Server: câu Zalo Server
      const S = id(); await acc(S, { is_zalo_server: true })
      const c4 = await campaign(S, 'zalo_message_phone', { sentCampaignIds: [oldCamp] })
      assert.equal(await claimCheck(c4, S, ''), SERVER_NOTE)
      assert.deepEqual(await statusOf(c4), { status: 'tạm dừng', note: SERVER_NOTE })
      // chiến dịch đang giữ lượt của bộ chạy khác: trả ghi chú (từ chối) nhưng không đổi trạng thái
      const c5 = await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] })
      await db.query(`UPDATE public.auto_campaigns SET runtime_unit_token=gen_random_uuid() WHERE id=$1`, [c5])
      assert.equal(await claimCheck(c5, B, null), DESKTOP_NOTE)
      assert.equal((await statusOf(c5)).status, 'chờ xử lý')
      await db.query(`UPDATE public.auto_campaigns SET runtime_unit_token=NULL, is_delete=true WHERE id=$1`, [c5])
    })
    await check('quyền hàm kiểm lúc nhận lượt: Desktop / ChatApi / service_role chạy được; anon / authenticated không', async () => {
      const sig = 'private.aka_agent_send_exclusion_claim_check(bigint,bigint,text)'
      for (const role of ['aka_agent_desktop', 'aka_agent_chat_api', 'service_role']) {
        if ((await one(`SELECT count(*)::int n FROM pg_roles WHERE rolname=$1`, [role])).n) assert.equal((await one(`SELECT has_function_privilege($1,$2,'EXECUTE') r`, [role, sig])).r, true, role)
      }
      for (const role of ['anon', 'authenticated']) {
        if ((await one(`SELECT count(*)::int n FROM pg_roles WHERE rolname=$1`, [role])).n) assert.equal((await one(`SELECT has_function_privilege($1,$2,'EXECUTE') r`, [role, sig])).r, false, role)
      }
      for (const fn of ['private.aka_agent_send_exclusion_entry_norm(jsonb)', 'private.aka_agent_send_exclusion_map_norm(jsonb)', 'private.aka_agent_send_exclusion_runtime_ready(bigint,boolean)']) {
        assert.equal((await one(`SELECT has_function_privilege('aka_agent_desktop',$1,'EXECUTE') r`, [fn])).r, false, fn)
      }
    })
    await check('hàm nhận lượt bộ cũ (thân production + V666): bản cũ (không header) gặp chiến dịch có cấu hình mới thì từ chối, tạm dừng', async () => {
      await ready()
      const c = await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] })
      const r = await one(`SELECT ok, reason, campaign_status FROM public.aka_agent_claim_campaign_runtime_v2($1, $2, $3, 'desktop', gen_random_uuid())`, [c, B, STAFF])
      assert.deepEqual(r, { ok: false, reason: 'send_exclusion_client_outdated', campaign_status: 'tạm dừng' })
      assert.deepEqual(await statusOf(c), { status: 'tạm dừng', note: DESKTOP_NOTE })
      // Bản mới (header): qua bước kiểm (các bước sau của hàm nhận lượt cần bảng / hàm không có trong bộ dựng này: chỉ kiểm không bị chặn ở bước V666)
      const c2 = await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] })
      await db.query('BEGIN')
      let reason = null
      try {
        await db.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-aka-send-exclusion-runner': '1' })])
        reason = (await one(`SELECT reason FROM public.aka_agent_claim_campaign_runtime_v2($1, $2, $3, 'desktop', gen_random_uuid())`, [c2, B, STAFF])).reason
      } catch (e) { reason = 'error: ' + e.message } finally { await db.query('ROLLBACK') }
      assert.notEqual(reason, 'send_exclusion_client_outdated')
      assert.equal((await statusOf(c2)).status, 'chờ xử lý')
    })
    await check('hàm nhận lượt engine (thân production + V666): lõi cũ (không ctx.sendExclusionRunner) thì campaign_paused + ghi chú; lõi mới thì không', async () => {
      const d = (await one('SELECT pg_get_functiondef(to_regprocedure($1)) d', [V666.SIG.engineClaim])).d
      const at = d.indexOf("private.aka_agent_send_exclusion_claim_check(v_campaign_id, v_account_id, p_ctx->>'sendExclusionRunner')")
      assert.ok(at > 0 && at < d.indexOf("'campaign_paused'"), 'kiểm đặt ngay trước nhánh campaign_paused')
      assert.ok(d.indexOf('FOR UPDATE', d.indexOf('SELECT * INTO c FROM public.auto_campaigns')) < at, 'sau khi khoá dòng chiến dịch')
      await ready()
      const call = async (cid, extra) => {
        const ctx = { staffId: STAFF, accountId: B, campaignId: cid, runnerId: 'smoke-' + cid, runtimeTarget: 'desktop', actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }] }
        await db.query('BEGIN')
        try { const r = (await one(`SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) r`, [JSON.stringify({ ...ctx, ...extra })])).r; await db.query('COMMIT'); return r }
        catch (e) { await db.query('ROLLBACK'); return { error: e.message } }
      }
      const cNew = await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] })
      await row(cNew, { phone: '0988000111' })
      const fresh = await call(cNew, { sendExclusionRunner: 1 })
      console.log('   lõi mới:', JSON.stringify(fresh).slice(0, 160))
      assert.notEqual(fresh.status, 'campaign_paused', JSON.stringify(fresh))
      assert.notEqual((await statusOf(cNew)).status, 'tạm dừng')
      await db.query(`DELETE FROM public.auto_engine_leases WHERE campaign_id=$1`, [cNew]).catch(() => {})
      await db.query(`UPDATE public.auto_campaigns SET is_delete=true, status='hoàn thành' WHERE id=$1`, [cNew])
      const c = await campaign(B, 'zalo_message_phone', { dataGroupIds: [dg] })
      await row(c, { phone: '0988000112' })
      const old = await call(c, {})
      if (old.error) console.log('   (thân engine production cần bảng / hàm ngoài bộ dựng:', old.error.slice(0, 160), ')')
      else {
        assert.equal(old.status, 'campaign_paused', JSON.stringify(old))
        assert.deepEqual(await statusOf(c), { status: 'tạm dừng', note: DESKTOP_NOTE })
      }
    })

    // ------------------------------------------------------------------ 6. gỡ và apply lại
    if (fs.existsSync(V666.NEW_MD5_FILE)) {
      await check('bản gỡ: kiểm thân V666 trước, trả đúng thân production, apply lại được', async () => {
        for (const k of V666.ORDER) assert.equal(await md5Of(V666.SIG[k]), JSON.parse(fs.readFileSync(V666.NEW_MD5_FILE, 'utf8'))[k], 'new-md5.json lệch ' + k)
        await db.query(`INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('20261126999999','migration_v666_send_exclusion_review_fixes','{}')`)
        await db.query(read('migrations/rollback_v666_send_exclusion_review_fixes.sql'))
        for (const k of V666.ORDER) assert.equal(await md5Of(V666.SIG[k]), V666.OLD_MD5[k], k)
        assert.equal((await one(`SELECT count(*)::int n FROM public.auto_system_settings WHERE key='send_exclusion.runtime'`)).n, 0)
        await db.query(read('migrations/migration_v666_send_exclusion_review_fixes.sql'))
        for (const k of V666.ORDER) assert.ok((await one('SELECT pg_get_functiondef(to_regprocedure($1)) d', [V666.SIG[k]])).d.includes('V666'))
      })
    } else console.log('SKIP bản gỡ: chưa có new-md5.json (chạy với --write-md5 rồi sinh lại migration)')
  } finally {
    await T.stop()
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  if (failed) process.exitCode = 1
}
main().catch(e => { console.error(e); process.exit(1) })

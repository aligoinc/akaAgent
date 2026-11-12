// V495 engine kết quả chiến dịch: kiểm thử trên PostgreSQL 17 cục bộ dùng một lần.
// Không mạng, không dữ liệu khách. Bảng dựng từ ảnh chụp schema + danh mục thật (chỉ đọc) ở
// scripts/fixtures/campaign-outcome-engine/akachat-catalog-20261106.json.
// Chạy: node scripts/campaign-outcome-engine-sql-smoke.cjs   (PG17_BIN, CHAT_REPO để đổi đường dẫn)
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { ROOT, SNAP, MIGRATION, ROLLBACK, requireFrom, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const ts = requireFrom('typescript')
const PORT = Number(process.env.V495_TEST_PORT || 55497)

// Bộ giải quyết kết quả hiện tại (src/shared/actionStatusPolicy.ts) để so quyết định cũ với engine.
function loadLegacyCatalog() {
  const source = fs.readFileSync(path.join(ROOT, 'src/shared/actionStatusPolicy.ts'), 'utf8')
  const mod = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: mod.exports, module: mod, require, Object, Map, Set, Error, Number, JSON, Array, String })
  const statuses = SNAP.rows.auto_status.map(s => ({ id: Number(s.id), code: s.code, name: s.name, statusValue: s.status_value, color: s.color,
    componentType: s.component_type, platform: s.flatform_type, isActive: s.is_active, isDelete: s.is_delete }))
  const policies = SNAP.rows.auto_account_action_status_policies.map(p => ({ id: Number(p.id), actionCode: p.action_code, statusId: Number(p.status_id),
    reportGroup: p.report_group, countsTowardLimit: p.counts_toward_limit, badTargetEffect: p.bad_target_effect,
    resetErrorStreak: p.reset_error_streak, inputEffect: p.input_effect, isActive: p.is_active, isDelete: p.is_delete }))
  return new mod.exports.ActionStatusCatalog(statuses, policies)
}

// Tra mã Zalo như getZaloErrorPolicyByCode + fallback err_zalo_api_business_failed của scheduler.
function legacyZaloErrorCode(code, actionCode) {
  const rows = SNAP.rows.auto_error.filter(e => e.is_active && !e.is_delete && (e.zalo_error_codes || []).includes(code))
  const scoped = rows.find(e => (e.zalo_action_codes || []).includes(actionCode))
  return (scoped || rows.find(e => (e.zalo_action_codes || []).length === 0))?.error_code || 'err_zalo_api_business_failed'
}

async function main() {
  const { connect, stop } = startCluster({ port: PORT })
  const db = await connect()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
  const rpc = async (fn, ...args) => val(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)
  const skipped = []
  try {
    await buildFixture(db, skipped)
    if (skipped.length) console.log('NOTE fixture bỏ qua:', skipped.length, 'mục (default/index dùng hàm ngoài phạm vi)')
    const catalogChecksum = async () => val(`SELECT md5(string_agg(to_jsonb(e)::text, ',' ORDER BY e.id)) FROM public.auto_error e`)
    const before = await catalogChecksum()

    // ---- 1. Thử apply rồi rollback, rồi apply thật -------------------------------------------
    await db.query(MIGRATION.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await val(`SELECT to_regclass('public.auto_outcome_policies')`), null)
    assert.equal(await catalogChecksum(), before)
    pass('apply trong transaction rồi ROLLBACK: không để lại gì, danh mục giữ nguyên')
    await db.query(MIGRATION)
    await assert.rejects(db.query(MIGRATION), /already applied/)
    await db.query('ROLLBACK')
    pass('apply thật; apply lần hai bị chặn ở preflight')

    // ---- 2. Danh mục, lint, quyền --------------------------------------------------------------
    const lint = (await db.query(`SELECT issue, subject FROM public.aka_agent_engine_policy_lint ORDER BY 1, 2`)).rows
    assert.deepEqual(lint, [], 'lint: ' + JSON.stringify(lint))
    const activeLegacy = SNAP.rows.auto_error.filter(e => e.is_active && !e.is_delete)
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_outcome_policies WHERE source = 'seed_v495_error'`)), activeLegacy.length)
    const legacyCols = await val(`SELECT md5(string_agg((to_jsonb(e) - 'public_code' - 'error_class' - 'customer_title' - 'customer_help')::text, ',' ORDER BY e.id))
      FROM public.auto_error e WHERE e.error_type <> 'engine v2'`)
    assert.equal(legacyCols, before, 'cột cũ của auto_error phải giữ nguyên')
    pass(`lint sạch; ${activeLegacy.length} mã cũ có chính sách 1:1; cột cũ của auto_error giữ nguyên`)

    const engineRows = (await db.query(`SELECT error_code, error_type, zalo_error_codes, counts_toward_limit, counts_toward_bad_target FROM public.auto_error WHERE error_type = 'engine v2'`)).rows
    assert.ok(engineRows.length >= 12)
    for (const r of engineRows) {
      assert.deepEqual(r.zalo_error_codes, [])
      assert.equal(r.counts_toward_limit, false); assert.equal(r.counts_toward_bad_target, false)
      assert.ok(!/zalo|facebook|email|system/i.test(r.error_type))
    }
    const statusValues = (await db.query(`SELECT status_value, count(*) FROM public.auto_status WHERE component_type = 'campaign_detail' AND status_value IS NOT NULL GROUP BY 1 HAVING count(*) > 1`)).rows
    assert.deepEqual(statusValues, [])
    pass(`${engineRows.length} mã engine v2 không lọt vào bộ kiểm bản cũ (error_type, mã Zalo rỗng); status_value vẫn duy nhất`)

    const priv = async (role, fn) => val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, fn])
    for (const fn of ['public.aka_agent_engine_claim_target_v1(jsonb)', 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)']) {
      assert.equal(await priv('anon', fn), false); assert.equal(await priv('authenticated', fn), false)
      assert.equal(await priv('service_role', fn), true); assert.equal(await priv('aka_agent_chat_api', fn), true)
    }
    assert.equal(await priv('aka_agent_chat_api', 'public.aka_agent_engine_simulate_v1(text,text,jsonb)'), false)
    assert.equal(await priv('aka_agent_chat_api', 'public.aka_agent_engine_enabled_orgs_v1()'), true)
    assert.equal(await priv('anon', 'public.aka_agent_engine_enabled_orgs_v1()'), false)
    assert.equal(await val(`SELECT to_regclass('public.auto_engine_rollout')`), null, 'không có công tắc theo loại chiến dịch')
    const noRls = (await db.query(`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
      AND (relname LIKE 'auto_outcome%' OR relname LIKE 'auto_engine%' OR relname IN ('auto_target_memory', 'auto_status_event_rules')) AND NOT relrowsecurity`)).rows
    assert.deepEqual(noRls, [])
    assert.equal(await val(`SELECT has_table_privilege('anon', 'public.auto_outcome_policies', 'SELECT')`), false)
    assert.equal(await val(`SELECT has_table_privilege('anon', 'public.aka_agent_public_error_catalog', 'SELECT')`), false)
    const seqs = (await db.query(`SELECT c.relname FROM pg_class c WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
      AND (c.relname LIKE 'auto_outcome%' OR c.relname LIKE 'auto_engine%' OR c.relname LIKE 'auto_target_memory%' OR c.relname LIKE 'auto_status_event_rules%')`)).rows
    assert.ok(seqs.length >= 8)
    for (const s of seqs) {
      assert.equal(await val(`SELECT has_sequence_privilege('anon', $1, 'USAGE')`, ['public.' + s.relname]), false, s.relname)
      assert.equal(await val(`SELECT has_sequence_privilege('authenticated', $1, 'UPDATE')`, ['public.' + s.relname]), false, s.relname)
    }
    pass('RPC chỉ service_role + aka_agent_chat_api; bảng/view/sequence mới thu hồi khỏi anon/authenticated dù Supabase cấp mặc định; RLS bật')

    // ---- 3. Phân loại mã Zalo khớp bản cũ ------------------------------------------------------
    const zaloActions = SNAP.rows.auto_account_actions.filter(a => a.flatform_type === 'zalo').map(a => a.code)
    const zaloCodes = [...new Set(SNAP.rows.auto_error.flatMap(e => e.zalo_error_codes || []))].concat(['999999', '-1'])
    let classified = 0
    for (const code of zaloCodes) for (const action of zaloActions) {
      const got = await one(`SELECT * FROM public.aka_agent_engine_classify_signal('zalo', $1, 'after_send', $2::jsonb)`, [action, JSON.stringify({ kind: 'zalo_code', code })])
      assert.equal(got.error_code, legacyZaloErrorCode(code, action), `mã ${code} / ${action}`)
      classified++
    }
    pass(`${classified} cặp (mã Zalo, thao tác) phân loại đúng như getZaloErrorPolicyByCode + fallback`)

    // ---- 4. Quyết định chính sách khớp bộ giải quyết hiện tại ----------------------------------
    const catalog = loadLegacyCatalog()
    const statusById = new Map(SNAP.rows.auto_status.map(s => [Number(s.id), s]))
    const statusByValue = new Map(SNAP.rows.auto_status.filter(s => s.component_type === 'campaign_detail' && s.status_value).map(s => [s.status_value, s]))
    const inputMap = { complete: 'complete', requeue: 'requeue', pause: 'hold' }
    let compared = 0
    for (const e of activeLegacy) {
      if (/facebook/i.test(e.error_type)) continue // FB: đếm theo trạng thái khi không có detail_mode; làm ở giai đoạn 5
      if (e.error_code === 'err_undefined') continue // đi đường handleCampaignBadTarget, kiểm riêng bên dưới
      const actions = (e.zalo_action_codes || []).length ? e.zalo_action_codes : [/email/i.test(e.error_type) || e.error_code.startsWith('err_email') ? 'email_send' : 'zalo_message_stranger']
      for (const action of actions) {
        const ds = e.detail_mode === 'override' ? statusById.get(Number(e.detail_status_id)) : (e.detail_status ? statusByValue.get(e.detail_status) : null)
        const legacy = catalog.resolve(
          { actionCode: action, statusCode: ds ? ds.code : 'campaign_detail_failed', operationState: 'not_committed' },
          { detailMode: e.detail_mode ?? null, detailStatusId: e.detail_status_id == null ? null : Number(e.detail_status_id), inputEffect: e.input_effect ?? null,
            countsTowardLimit: e.counts_toward_limit, badTargetEffect: e.counts_toward_bad_target ? 'increment' : 'ignore', resetErrorStreak: e.counts_toward_limit },
          { legacySuppress: !e.detail_status && e.detail_mode == null, legacyInputEffect: !e.detail_status ? 'requeue' : undefined,
            auxiliaryAction: action === 'zalo_tag_contact' || action === 'zalo_change_alias' })
        const sim = await rpc('aka_agent_engine_simulate_v1', 'zalo_message_phone', 'fly',
          JSON.stringify({ actionCode: action, ok: false, phase: 'after_send', signal: { errorCode: e.error_code } }))
        const p = sim.policy
        const label = `${e.error_code}/${action}`
        assert.equal(sim.errorCode, e.error_code, label)
        assert.equal(p.detail_mode === 'write', legacy.createDetail, label + ' createDetail')
        if (legacy.createDetail) assert.equal(Number(p.detail_status_id), legacy.statusId, label + ' status')
        assert.equal(p.quota_effect === 'count', legacy.countsTowardLimit, label + ' countsTowardLimit')
        assert.equal(p.target_streak_effect, legacy.badTargetEffect, label + ' badTargetEffect')
        assert.equal(p.target_effect, inputMap[legacy.inputEffect] || 'complete', label + ' inputEffect ' + legacy.inputEffect)
        assert.equal(p.streak_threshold ?? null, e.count_consecutive_errors > 0 ? e.count_consecutive_errors : null, label + ' threshold')
        assert.deepEqual(p.lock_action_codes, e.disable_action_codes || [], label + ' locks')
        assert.equal(p.campaign_effect, { 'tạm dừng': 'pause', 'chờ xử lý': 'hold' }[e.update_status_campaign] || 'none', label + ' campaign')
        assert.equal(p.login_effect, { 'chưa đăng nhập': 'logged_out', checkpoint: 'checkpoint' }[e.update_login_status] || 'none', label + ' login')
        const side = !!(e.update_status_campaign || e.update_status_account || e.update_login_status || (e.disable_action_codes || []).length)
        assert.equal(p.run_effect, side ? 'end_unit' : 'continue', label + ' run')
        // Desktop/VPS làm chuẩn: bước còn lại của data vẫn chạy (Fly bản cũ bỏ, Fly bộ mới chạy theo Desktop).
        assert.equal(p.remaining_steps, 'continue', label + ' remaining (fly)')
        const desk = (await rpc('aka_agent_engine_simulate_v1', 'zalo_message_phone', 'desktop',
          JSON.stringify({ actionCode: action, ok: false, phase: 'after_send', signal: { errorCode: e.error_code } }))).policy
        assert.deepEqual({ ...desk, policy_ids: null, revisions: null }, { ...p, policy_ids: null, revisions: null }, label + ' Fly giống hệt Desktop')
        compared++
      }
    }
    pass(`${compared} cặp (mã, thao tác) Zalo/Email/hệ thống: ghi lịch sử, trạng thái, tính lượt, chuỗi lỗi, data đi đâu, ngưỡng, khoá, hiệu ứng khớp bản cũ`)
    const undef = (await rpc('aka_agent_engine_simulate_v1', 'zalo_message_phone', 'fly',
      JSON.stringify({ actionCode: 'zalo_message_stranger', ok: false, phase: 'after_send', signal: { kind: 'exception', message: 'TypeError: x is undefined' } }))).policy
    assert.deepEqual([undef.detail_mode, undef.quota_effect, undef.target_streak_effect, undef.streak_threshold, undef.campaign_effect, undef.remaining_steps, undef.run_effect],
      ['write', 'no_count', 'increment', 4, 'pause', 'skip', 'continue'])
    assert.equal(Number(undef.detail_status_id), Number(SNAP.rows.auto_status.find(s => s.code === 'campaign_detail_error').id))
    pass('lỗi code (err_undefined): ghi "lỗi", không tính lượt, tăng chuỗi, chỉ tạm dừng khi đủ 4 như handleCampaignBadTarget')
    const unknownOf = async actionCode => (await rpc('aka_agent_engine_simulate_v1', 'zalo_message_phone', 'fly',
      JSON.stringify({ actionCode, ok: false, phase: 'in_flight', signal: { kind: 'fly_command', code: 'command_result_unknown' } }))).policy
    const lookupUnknown = await unknownOf('zalo_find_phone_user'), sendUnknown = await unknownOf('zalo_message_stranger')
    assert.deepEqual([lookupUnknown.detail_mode, lookupUnknown.target_effect, lookupUnknown.run_effect, lookupUnknown.quota_effect], ['suppress', 'requeue', 'end_unit', 'no_count'])
    assert.deepEqual([sendUnknown.detail_mode, sendUnknown.target_effect, sendUnknown.run_effect], ['write', 'complete', 'continue'])
    pass('lệnh Fly không rõ kết quả: tra số (chỉ đọc) về hàng đợi và dừng lượt như Fly bản cũ; bước gửi hoàn thành, không gửi lại (UNK01)')

    // ---- 5. Kịch bản chạy thật qua RPC ---------------------------------------------------------
    let nextId = 900000
    const makeCampaign = async ({ action = 'zalo_message_phone', targets = 3, accountStatus = 'chờ xử lý', org = 501, newRuntime = true,
                                  server = true, schedule = "now() - interval '1 minute'" } = {}) => {
      const account = ++nextId, campaign = ++nextId, staff = 7001
      // Tổ chức chọn chạy bộ mới bằng org_organization.use_new_zalo_runtime (V371).
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Fixture org', $2) ON CONFLICT (id) DO NOTHING`, [org, newRuntime])
      // Tài khoản Zalo Server cho runtime 'fly'; server=false là tài khoản QR chạy trên Desktop.
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Fixture Zalo', 'zalo', 'đã đăng nhập', $2, true, false, $3, $4, $5)`, [account, accountStatus, staff, org, server])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Fixture campaign', $2, $3, 'chờ xử lý', ${schedule}, false, $4, $5)`, [campaign, action, account, staff, org])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`,
          [id, campaign, `Khách ${i + 1}`, `0909${String(campaign).slice(-3)}${String(i).padStart(3, '0')}`])
        ids.push(id)
      }
      return { account, campaign, staff, ids }
    }
    const ctx = (c, extra = {}) => JSON.stringify({ staffId: c.staff, accountId: c.account, campaignId: c.campaign, runnerId: 'fly:test',
      runtimeTarget: 'fly', leaseToken: c.lease ?? null,
      actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }, { code: 'zalo_add_friend', required: false }], ...extra })
    // Runner giữ token của lần nhận trước để nhận tiếp trong cùng lease (như runUnit).
    const claim = async (c, extra) => { const res = await rpc('aka_agent_engine_claim_target_v1', ctx(c, extra)); if (res.leaseToken) c.lease = res.leaseToken; return res }
    let rkSeq = 0
    const out = (actionCode, extra = {}) => ({ resultKey: `test:${++rkSeq}:${actionCode}`, actionCode, ok: true, phase: 'after_send', ...extra })
    const report = (cl, outcomes, final = false, dry = false) => rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken, JSON.stringify(outcomes), final, dry)
    const mark = (cl, actionCode) => rpc('aka_agent_engine_mark_sending_v1', cl.targetRunId, cl.leaseToken, actionCode, actionCode)
    const target = id => one(`SELECT status, note, schedule FROM public.auto_campaign_input_data WHERE id = $1`, [id])
    const details = id => db.query(`SELECT action_code, status, error_code, counts_toward_limit, report_group, log FROM public.auto_campaign_details WHERE input_data_id = $1 ORDER BY id`, [id]).then(r => r.rows)

    const c1 = await makeCampaign()
    // Không có công tắc theo loại: trên Fly chỉ cờ tổ chức quyết định. Tổ chức chưa bật cờ thì vẫn chạy đường cũ.
    const c0 = await makeCampaign({ targets: 1, org: 888, newRuntime: false })
    assert.equal((await claim(c0)).status, 'not_enabled')
    assert.equal((await target(c0.ids[0])).status, 'chờ xử lý')
    const enabled = await rpc('aka_agent_engine_enabled_orgs_v1')
    assert.ok(enabled.organizationIds.includes('501') && !enabled.organizationIds.includes('888'))
    await db.query(`UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id = 888`)
    assert.equal((await claim(c0)).status, 'claimed')
    assert.equal((await rpc('aka_agent_engine_release_v1', c0.account, c0.lease)).ok, false, 'còn data đang chạy thì không nhả')
    await db.query(`UPDATE public.org_organization SET use_new_zalo_runtime = false WHERE id = 888`)
    assert.equal((await claim(c0)).status, 'not_enabled', 'tắt cờ tổ chức thì tổ chức đó về đường cũ')
    const cl1 = await claim(c1)
    assert.equal(cl1.status, 'claimed'); assert.equal(cl1.target.id, c1.ids[0])
    assert.equal((await target(c1.ids[0])).status, 'đang chạy')
    assert.equal(await val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c1.campaign]), 'đang chạy')
    assert.equal(await val(`SELECT status FROM public.auto_accounts WHERE id = $1`, [c1.account]), 'đang chạy')
    const busy = await rpc('aka_agent_engine_claim_target_v1', ctx(c1, { runnerId: 'desktop:other', leaseToken: null }))
    assert.equal(busy.status, 'busy')
    pass('Fly chỉ nhận tổ chức bật cờ use_new_zalo_runtime (tắt cờ là về đường cũ); nhận data đầu, data/chiến dịch/tài khoản "đang chạy"; runner khác bị "busy"')

    // Tra số OK (chỉ đọc) → nhắn tin OK (đã giao) → kết bạn lỗi mạng: data hoàn thành, không trả về hàng đợi.
    let r = await report(cl1, [out('zalo_find_phone_user')])
    assert.equal(r.next, 'next_step')
    assert.equal((await mark(cl1, 'zalo_message_stranger')).ok, true)
    r = await report(cl1, [out('zalo_message_stranger')])
    assert.equal(r.next, 'next_step'); assert.equal(r.outcomes[0].deliveryState, 'delivered')
    assert.equal((await mark(cl1, 'zalo_add_friend')).ok, true)
    r = await report(cl1, [out('zalo_add_friend', { ok: false, signal: { errorCode: 'err_network_offline' } })], true)
    assert.equal(r.target.status, 'hoàn thành')
    assert.ok(r.safety.some(s => s.rule === 'no_requeue_after_delivery'))
    assert.equal(r.next, 'stop_campaign') // err_network_offline: chiến dịch "chờ xử lý" như bản cũ
    assert.equal(await val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c1.campaign]), 'chờ xử lý')
    const d1 = await details(c1.ids[0])
    assert.deepEqual(d1.map(d => d.action_code), ['zalo_find_phone_user', 'zalo_message_stranger'])
    const counted = await val(`SELECT count_action_in_day FROM public.auto_account_action_status WHERE account_id = $1 AND action_code = 'zalo_add_friend'`, [c1.account])
    assert.equal(Number(counted), 0, 'lượt kết bạn đã giữ chỗ phải được hoàn lại khi lỗi không tính lượt')
    pass('đã nhắn tin rồi lỗi mạng ở bước kết bạn: data "hoàn thành", không ghi lịch sử kết bạn, hoàn lượt đã giữ, chiến dịch về "chờ xử lý"')

    // Gọi lại cùng result_key: trả đúng quyết định cũ, không ghi trùng.
    const replayKeys = d1.length
    const again = await rpc('aka_agent_engine_report_v1', cl1.targetRunId, cl1.leaseToken,
      JSON.stringify([{ resultKey: `test:${rkSeq - 1}:zalo_message_stranger`, actionCode: 'zalo_message_stranger', ok: true }]), false, false)
    assert.equal(again.ok, true)
    assert.equal(again.outcomes[0].replay, true)
    assert.equal((await details(c1.ids[0])).length, replayKeys)
    assert.equal(again.next, 'ownership_lost') // lượt data đã đóng: không còn quyền tác động chiến dịch
    pass('báo lại cùng result_key (gửi bù từ nhật ký): trả quyết định cũ, không thêm dòng lịch sử')

    // Tra số: không có Zalo (216) → data hoàn thành "không tồn tại", tính lượt tra như bản cũ.
    await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL WHERE id = $1`, [c1.campaign])
    assert.equal((await rpc('aka_agent_engine_release_v1', c1.account, cl1.leaseToken)).ok, true)
    c1.lease = null
    const cl2 = await claim(c1)
    assert.equal(cl2.status, 'claimed'); assert.equal(cl2.target.id, c1.ids[1])
    r = await report(cl2, [out('zalo_find_phone_user', { ok: false, signal: { kind: 'zalo_code', code: '216', message: 'User not found' } })], true)
    assert.equal(r.target.status, 'hoàn thành'); assert.equal(r.next, 'next_target')
    const d2 = await details(c1.ids[1])
    assert.equal(d2[0].status, 'không tồn tại'); assert.equal(d2[0].error_code, 'err_zalo_user_not_found'); assert.equal(d2[0].counts_toward_limit, true)
    assert.match(d2[0].log, /\(Z216\)$/)
    pass('không có Zalo (216): "không tồn tại", tính lượt tra như bản cũ, câu cho khách kèm mã Z216')

    // Tra số: hết lượt (221) → không ghi lịch sử, khoá "tra số" 60 phút, data về hàng đợi, dừng lượt.
    const cl3 = await claim(c1)
    assert.equal(cl3.target.id, c1.ids[2])
    r = await report(cl3, [out('zalo_find_phone_user', { ok: false, signal: { kind: 'zalo_code', code: '221' } })], true)
    assert.equal(r.target.status, 'chờ xử lý'); assert.equal(r.next, 'end_unit')
    assert.equal((await details(c1.ids[2])).length, 0)
    const lock = await one(`SELECT is_disable, disabled_error_code, date_enable > now() + interval '59 minutes' AS ok FROM public.auto_account_action_status
      WHERE account_id = $1 AND action_code = 'zalo_find_phone_user'`, [c1.account])
    assert.equal(lock.is_disable, true); assert.equal(lock.disabled_error_code, 'err_zalo_find_phone_limit'); assert.equal(lock.ok, true)
    const waitClaim = await claim(c1)
    assert.equal(waitClaim.status, 'wait'); assert.equal(waitClaim.wait.gate, 'action_lock')
    assert.equal(await val(`SELECT schedule > now() + interval '59 minutes' FROM public.auto_campaigns WHERE id = $1`, [c1.campaign]), true)
    assert.equal((await target(c1.ids[2])).status, 'chờ xử lý')
    pass('hết lượt tra (221): không ghi lịch sử, khoá đúng "tra số" 60 phút, data về hàng đợi; lần nhận sau chờ và hẹn chiến dịch tới lúc mở khoá')

    // ---- 6. Phục hồi: lease hết hạn, đóng data dở --------------------------------------------
    const expire = async (c, run) => {
      await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '20 minutes' WHERE account_id = $1`, [c.account])
      await db.query(`UPDATE public.auto_engine_target_runs SET started_at = now() - interval '30 minutes' WHERE id = $1`, [run.targetRunId])
    }
    const c2 = await makeCampaign({ targets: 3 })
    const a = await claim(c2)
    assert.equal((await mark(a, 'zalo_message_stranger')).ok, true) // đã ghi dấu "sắp gửi" rồi app chết
    await expire(c2, a)
    const b = await claim(c2, { runnerId: 'fly:replacement' })
    assert.equal(b.status, 'claimed'); assert.equal(b.target.id, c2.ids[1], 'data đang chạy dở không bao giờ bị nhận lại')
    assert.notEqual(b.leaseToken, a.leaseToken)
    // Runner cũ sống lại và gửi bù kết quả thật: data đóng đúng kết quả, nhưng không được tác động chiến dịch.
    const late = await report(a, [out('zalo_message_stranger')], true)
    assert.equal(late.next, 'ownership_lost'); assert.equal(late.target.status, 'hoàn thành')
    assert.equal((await target(c2.ids[0])).status, 'hoàn thành')
    assert.equal(await val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c2.campaign]), 'đang chạy')
    // Runner mới cũng chết sau khi ghi dấu "sắp gửi": pg_cron đóng data bằng SYS02, không gửi lại.
    assert.equal((await mark(b, 'zalo_message_stranger')).ok, true)
    await expire(c2, b)
    assert.equal((await rpc('aka_agent_engine_close_stale_v1', 50)).closedTargets, 1)
    const t1 = await target(c2.ids[1])
    assert.equal(t1.status, 'hoàn thành'); assert.match(t1.note, /\(SYS02\)$/)
    const kinds = async id => [...new Set((await rpc('aka_agent_engine_target_timeline_v1', id)).map(x => x.kind))].sort()
    assert.deepEqual(await kinds(c2.ids[0]), ['completed', 'mark_sending', 'milestone', 'started'])
    assert.deepEqual(await kinds(c2.ids[1]), ['completed', 'interrupted', 'mark_sending', 'started'])
    assert.equal(await val(`SELECT count(*) FROM public.auto_engine_leases WHERE account_id = $1`, [c2.account]), '0')
    assert.equal(await val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c2.campaign]), 'chờ xử lý')
    assert.equal(await val(`SELECT status FROM public.auto_accounts WHERE id = $1`, [c2.account]), 'chờ xử lý')
    pass('app chết: runner mới nhận data kế tiếp; runner cũ gửi bù vẫn đóng đúng kết quả nhưng không đụng chiến dịch; pg_cron đóng data có dấu bằng SYS02, nhả lease, chiến dịch/tài khoản về "chờ xử lý"')

    const c3 = await makeCampaign({ targets: 2 })
    const s1 = await claim(c3)
    await expire(c3, s1)
    await rpc('aka_agent_engine_close_stale_v1', 50)
    const u1 = await target(c3.ids[0])
    assert.equal(u1.status, 'hoàn thành'); assert.match(u1.note, /\(SYS01\)$/)
    await db.query(`UPDATE public.auto_system_settings SET value = 'requeue' WHERE key = 'engine.stale_unsent_target_action'`)
    c3.lease = null
    const s2 = await claim(c3)
    assert.equal(s2.target.id, c3.ids[1])
    await expire(c3, s2)
    await rpc('aka_agent_engine_close_stale_v1', 50)
    assert.equal((await target(c3.ids[1])).status, 'chờ xử lý')
    await db.query(`UPDATE public.auto_system_settings SET value = 'complete' WHERE key = 'engine.stale_unsent_target_action'`)
    pass('data dở chưa có dấu "sắp gửi": mặc định đóng bằng SYS01; đặt engine.stale_unsent_target_action=requeue thì về hàng đợi')

    // ---- 7. Không gửi khi không ghi được dấu; nhận nguyên tử; hai runner cùng lúc ------------
    const c4 = await makeCampaign({ targets: 2 })
    const w = await claim(c4)
    await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '1 second' WHERE account_id = $1`, [c4.account])
    assert.equal((await mark(w, 'zalo_message_stranger')).reason, 'ownership_lost')
    pass('mất quyền giữ chỗ thì mark_sending từ chối: runtime không được gọi Zalo gửi')

    const c5 = await makeCampaign({ targets: 4 })
    const [x1, x2] = await Promise.all([connect(), connect()])
    await x1.query('BEGIN'); await x2.query('BEGIN')
    const p1 = x1.query(`SELECT public.aka_agent_engine_claim_target_v1($1) AS r`, [ctx(c5, { runnerId: 'fly:a' })])
    const p2 = x2.query(`SELECT public.aka_agent_engine_claim_target_v1($1) AS r`, [ctx(c5, { runnerId: 'fly:b' })])
    // Commit ngay khi lời gọi nào xong trước: lời gọi kia đang chờ khoá dòng của lời gọi này.
    const [q1, q2] = await Promise.all([
      p1.then(async res => { await x1.query('COMMIT'); return res.rows[0].r }),
      p2.then(async res => { await x2.query('COMMIT'); return res.rows[0].r })])
    await x1.end(); await x2.end()
    assert.deepEqual([q1.status, q2.status].sort(), ['busy', 'claimed'])
    pass('hai runner nhận cùng lúc một tài khoản: đúng một runner nhận được, runner kia "busy"')

    // ---- 8. Ngưỡng chung: mã tăng chuỗi lỗi không có ngưỡng riêng → theo err_undefined (4) ----
    const c6 = await makeCampaign({ targets: 5 })
    let last
    for (let i = 0; i < 4; i++) {
      const cl = await claim(c6)
      assert.equal(cl.status, 'claimed', `lần ${i + 1}`)
      last = await report(cl, [out('zalo_message_stranger', { ok: false, signal: { kind: 'zalo_code', code: '114', message: 'invalid param' } })], true)
      if (i < 3) { assert.equal(last.next, 'next_target'); assert.equal(last.streak.count, i + 1) }
    }
    assert.equal(last.campaign.effect, 'pause'); assert.equal(last.next, 'stop_campaign')
    const note = await one(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [c6.campaign])
    assert.equal(note.status, 'tạm dừng'); assert.match(note.note, /^Dừng sau 4 data lỗi\/thất bại liên tiếp \(ngưỡng 4\): .*\(Z114\)$/)
    pass('4 data liên tiếp lỗi 114: chiến dịch tạm dừng với ghi chú "Dừng sau 4 data…" như guard err_undefined hiện nay')

    const c7 = await makeCampaign({ targets: 3 })
    for (let i = 0; i < 2; i++) await report(await claim(c7), [out('zalo_message_stranger', { ok: false, signal: { kind: 'zalo_code', code: '114' } })], true)
    const ok7 = await report(await claim(c7), [out('zalo_message_stranger')], true)
    assert.equal(ok7.streak.effect, 'reset'); assert.equal(ok7.streak.count, 0)
    pass('một data thành công đặt lại chuỗi lỗi về 0')

    // ---- 9. Mô phỏng (dry run) không ghi gì ---------------------------------------------------
    const c8 = await makeCampaign({ targets: 1 })
    const d8 = await claim(c8)
    const dry = await report(d8, [out('zalo_message_stranger', { ok: false, signal: { kind: 'zalo_code', code: '802' } })], true, true)
    assert.equal(dry.dryRun, true); assert.equal(dry.target.status, 'chờ xử lý')
    assert.equal((await target(c8.ids[0])).status, 'đang chạy')
    assert.equal(await val(`SELECT count(*) FROM public.auto_engine_outcomes WHERE target_run_id = $1`, [d8.targetRunId]), '0')
    assert.equal(await val(`SELECT count(*) FROM public.auto_account_action_status WHERE account_id = $1 AND is_disable`, [c8.account]), '0')
    pass('report dry_run: trả quyết định (802 → data về hàng đợi) mà không ghi kết quả, khoá hay data')

    // ---- 10. Trạng thái mới chỉ bằng dữ liệu --------------------------------------------------
    await db.query(`INSERT INTO public.auto_status(code, name, status_key, component_type, status_value, parent_status_id, is_terminal)
      SELECT 'campaign_detail_invalid_phone', 'SĐT không hợp lệ', 'invalid_phone', 'campaign_detail', 'sđt không hợp lệ', id, true
        FROM public.auto_status WHERE code = 'campaign_detail_not_found'`)
    await db.query(`INSERT INTO public.auto_status(code, name, status_key, component_type, status_value, parent_status_id, progress_rank)
      SELECT 'campaign_detail_interacted', 'Đã tương tác', 'interacted', 'campaign_detail', 'đã tương tác', id, 50
        FROM public.auto_status WHERE code = 'campaign_detail_success'`)
    const sem = await one(`SELECT s.* FROM public.auto_status a, public.aka_agent_status_semantics(a.id) s WHERE a.code = 'campaign_detail_invalid_phone'`)
    assert.equal(sem.report_group, 'failure'); assert.equal(sem.counts_as_delivered, false); assert.equal(sem.status_value, 'sđt không hợp lệ')
    await db.query(`UPDATE public.auto_outcome_policies SET detail_status_id = (SELECT id FROM public.auto_status WHERE code = 'campaign_detail_invalid_phone')
      WHERE error_code = 'err_zalo_219_find_phone_invalid'`)
    const c9 = await makeCampaign({ targets: 1 })
    const r9 = await report(await claim(c9), [out('zalo_find_phone_user', { ok: false, signal: { kind: 'zalo_code', code: '219' } })], true)
    assert.equal(r9.outcomes[0].statusCode, 'campaign_detail_invalid_phone'); assert.equal(r9.outcomes[0].reportGroup, 'failure')
    assert.equal((await details(c9.ids[0]))[0].status, 'sđt không hợp lệ')
    assert.equal(Number(await val(`SELECT max(revision) FROM public.auto_outcome_policies WHERE error_code = 'err_zalo_219_find_phone_invalid'`)), 2)
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_outcome_policy_history h JOIN public.auto_outcome_policies p ON p.id = h.policy_id
      WHERE p.error_code = 'err_zalo_219_find_phone_invalid' AND h.op = 'update'`)), 1)
    await assert.rejects(db.query(`UPDATE public.auto_status SET parent_status_id = (SELECT id FROM public.auto_status WHERE code = 'campaign_detail_invalid_phone')
      WHERE code = 'campaign_detail_not_found'`), /status_parent_cycle/)
    pass('thêm "SĐT không hợp lệ" (gốc "Không tồn tại") chỉ bằng SQL: kế thừa nhóm báo cáo, trỏ mã 219 sang; có revision/lịch sử; chặn vòng cha–con')

    await db.query(`INSERT INTO public.auto_status_event_rules(event_kind, status_id) SELECT 'zalo.interact', id FROM public.auto_status WHERE code = 'campaign_detail_interacted'`)
    await db.query(`INSERT INTO public.auto_status_event_rules(event_kind, status_id) SELECT 'zalo.seen', id FROM public.auto_status WHERE code = 'campaign_detail_viewed'`)
    const detailId = Number(await val(`SELECT id FROM public.auto_campaign_details WHERE input_data_id = $1 AND status = 'thành công' ORDER BY id LIMIT 1`, [c7.ids[2]]))
    assert.equal((await rpc('aka_agent_engine_apply_status_event_v1', detailId, 'zalo.interact')).applied, true)
    assert.equal((await rpc('aka_agent_engine_apply_status_event_v1', detailId, 'zalo.seen')).applied, false)
    assert.equal(await val(`SELECT s.code FROM public.auto_campaign_details d JOIN public.auto_status s ON s.id = d.sub_status_id WHERE d.id = $1`, [detailId]), 'campaign_detail_interacted')
    pass('sự kiện sau khi gửi: "Đã tương tác" (hạng 50) không bị "Đã xem" (hạng 30) ghi đè')

    // ---- 11. Nhớ mục tiêu hỏng trong tổ chức (chính sách mới, không phải seed) ---------------
    await db.query(`INSERT INTO public.auto_error(error_type, error_code, error_name, public_code, error_class, counts_toward_limit, counts_toward_bad_target)
      VALUES ('engine v2', 'err_fixture_target_permanent', 'Fixture', 'Z901', 'target_permanent', false, false)`)
    const c10 = await makeCampaign({ targets: 1, org: 777 })
    const r10 = await report(await claim(c10), [out('zalo_message_stranger', { ok: false, signal: { errorCode: 'err_fixture_target_permanent' } })], true)
    assert.equal(r10.target.status, 'hoàn thành')
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_target_memory WHERE organization_id = 777`)), 1)
    const c11 = await makeCampaign({ targets: 0, org: 777 })
    await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete)
      OVERRIDING SYSTEM VALUE SELECT $1, $2, 'Trùng số', phone, 'chờ xử lý', false FROM public.auto_campaign_input_data WHERE id = $3`, [++nextId, c11.campaign, c10.ids[0]])
    const m11 = await claim(c11)
    assert.equal(m11.status, 'claimed'); assert.equal(m11.actions.zalo_message_stranger.decision, 'skip')
    assert.equal(m11.actions.zalo_message_stranger.gate, 'target_memory')
    pass('mã mới nhóm target_permanent kế thừa "nhớ 30 ngày trong tổ chức": chiến dịch khác cùng tổ chức bỏ qua bước nhắn cho số đó')

    // ---- 12. Đường Fly: điều kiện nhận lượt như bản cũ ---------------------------------------
    const c12 = await makeCampaign({ targets: 1 })
    await db.query(`UPDATE public.auto_accounts SET is_zalo_server = false WHERE id = $1`, [c12.account])
    assert.equal((await claim(c12)).status, 'runtime_not_owner')
    await db.query(`UPDATE public.auto_accounts SET is_zalo_server = true, login_status = 'chưa đăng nhập' WHERE id = $1`, [c12.account])
    assert.equal((await claim(c12)).status, 'account_logged_out')
    await db.query(`UPDATE public.auto_accounts SET login_status = 'đã đăng nhập' WHERE id = $1`, [c12.account])
    await db.query(`UPDATE public.auto_campaigns SET daily_stop_time = '00:00' WHERE id = $1`, [c12.campaign])
    const b12 = await claim(c12)
    assert.equal(b12.status, 'daily_boundary'); assert.equal(b12.reason, 'daily_stop_due')
    // Qua giờ dừng trong ngày: hẹn tới đúng 0:00 hôm sau giờ Việt Nam (17:00 UTC).
    assert.ok(new Date(b12.nextAt).getTime() > Date.now())
    assert.deepEqual([new Date(b12.nextAt).getUTCHours(), new Date(b12.nextAt).getUTCMinutes()], [17, 0])
    assert.equal((await target(c12.ids[0])).status, 'chờ xử lý')
    await db.query(`UPDATE public.auto_campaigns SET daily_stop_time = NULL WHERE id = $1`, [c12.campaign])
    await db.query(`UPDATE public.auto_engine_leases SET acquired_at = now() - interval '2 days', expires_at = now() + interval '2 minutes' WHERE account_id = $1`, [c12.account])
    const d12 = await claim(c12)
    assert.equal(d12.status, 'daily_boundary'); assert.equal(d12.reason, 'vietnam_day_changed')
    // Qua ngày: chỉ kết thúc lượt, không hẹn sang hôm sau (chạy tiếp khi bảo trì ngày mới xong).
    assert.ok(Math.abs(new Date(d12.nextAt).getTime() - Date.now()) < 60_000, 'nextAt phải là bây giờ, không phải 0:00 hôm sau')
    assert.equal((await rpc('aka_agent_engine_release_v1', c12.account, c12.lease)).ok, true)
    c12.lease = null
    pass('Fly chỉ nhận tài khoản Zalo Server đã đăng nhập; sau giờ dừng trong ngày hoặc lease mở từ hôm trước thì không nhận data (bảo trì ngày mới chạy trước)')

    const c13 = await makeCampaign({ targets: 2 })
    const optional = { actions: [{ code: 'zalo_find_phone_user' },
      { code: 'zalo_message_stranger', required: false, skippableGates: ['quota'] }, { code: 'zalo_add_friend', required: false, skippableGates: ['quota'] }] }
    // Hạn mức lấy từ cài đặt chiến dịch trong DB, không do bộ chạy truyền vào.
    await db.query(`UPDATE public.auto_campaigns SET extra_settings = '{"actionLimits":{"byActionCode":{"zalo_message_stranger":{"dailyLimit":1},"zalo_add_friend":{"dailyLimit":1}}}}'::jsonb WHERE id = $1`, [c13.campaign])
    await db.query(`INSERT INTO public.auto_account_action_status(account_id, action_code, count_action_in_day, count_date)
      SELECT $1, code, 1, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date FROM unnest(ARRAY['zalo_message_stranger', 'zalo_add_friend']) code`, [c13.account])
    const w13 = await claim(c13, { ...optional, requireAny: ['zalo_message_stranger', 'zalo_add_friend'] })
    assert.equal(w13.status, 'wait'); assert.equal(w13.wait.gate, 'quota')
    assert.equal((await target(c13.ids[0])).status, 'chờ xử lý', 'không tra số khi cả nhắn tin và kết bạn đều hết lượt')
    await db.query(`UPDATE public.auto_campaigns SET schedule = now() - interval '1 minute' WHERE id = $1`, [c13.campaign])
    await db.query(`UPDATE public.auto_account_action_status SET count_action_in_day = 0, is_disable = true, date_enable = now() + interval '1 hour', disabled_error_code = 'err_zalo_api_business_failed'
      WHERE account_id = $1 AND action_code = 'zalo_message_stranger'`, [c13.account])
    const l13 = await claim(c13, optional)
    assert.equal(l13.status, 'wait'); assert.equal(l13.wait.gate, 'action_lock', 'đang bị khoá thì không được bỏ qua như hết lượt')
    await db.query(`UPDATE public.auto_campaigns SET schedule = now() - interval '1 minute' WHERE id = $1`, [c13.campaign])
    await db.query(`UPDATE public.auto_account_action_status SET is_disable = false, date_enable = NULL WHERE account_id = $1`, [c13.account])
    const k13 = await claim(c13, { ...optional, requireAny: ['zalo_message_stranger', 'zalo_add_friend'] })
    assert.equal(k13.status, 'claimed'); assert.equal(k13.actions.zalo_add_friend.decision, 'wait'); assert.equal(k13.actions.zalo_message_stranger.decision, 'allow')
    assert.deepEqual(k13.gates.opt_out, { onError: 'open' }, 'claim trả cấu hình cổng; seed giữ "lỗi kiểm vẫn gửi" như hôm nay')
    pass('requireAny: nhắn tin và kết bạn cùng hết lượt thì không nhận data; skippableGates: đang bị khoá vẫn chặn như bắt buộc')

    // Nội dung xoay vòng theo lease (như aka_agent_take_campaign_content_index): data đầu 0, data sau 1, chạy lại cùng data đi tiếp từ data.
    const take = (cl, n = 3) => rpc('aka_agent_engine_take_content_index_v1', cl.targetRunId, cl.leaseToken, 'zalo_message_stranger', n)
    assert.deepEqual(await take(k13), { ok: true, index: 0 })
    assert.deepEqual(await take(k13), { ok: true, index: 1 }, 'cùng data lấy lại thì đi tiếp từ vị trí của data')
    assert.deepEqual(await take(k13, 1), { ok: true, index: 0 })
    assert.equal((await take({ ...k13, leaseToken: '00000000-0000-0000-0000-000000000000' })).reason, 'ownership_lost')
    await report(k13, [out('zalo_find_phone_user'), out('zalo_message_stranger')], true)
    assert.equal((await take(k13)).reason, 'run_closed')
    const k13b = await claim(c13, optional)
    assert.equal(k13b.status, 'claimed')
    assert.deepEqual(await take(k13b), { ok: true, index: 1 }, 'data sau đi tiếp vị trí của chiến dịch')
    pass('nội dung xoay vòng theo chiến dịch/data giữ đúng quy tắc v350, xác thực bằng lease engine')

    // Từ chối nhận tin (cổng): data tạm dừng, không ghi lịch sử, không tính lượt, không nghỉ.
    const o13 = await report(k13b, [out('zalo_message_stranger', { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'recipient_opted_out' } })])
    assert.equal(o13.target.done, true); assert.equal(o13.target.status, 'tạm dừng'); assert.equal(o13.next, 'next_target')
    assert.equal(o13.pace.mode, 'none'); assert.equal(o13.outcomes[0].publicCode, 'OPT01'); assert.equal(o13.outcomes[0].detailId, null)
    assert.match((await target(c13.ids[1])).note, /từ chối nhận tin nhắn Zalo \(OPT01\)/)
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_campaign_details WHERE input_data_id = $1`, [c13.ids[1]])), 0)
    pass('người nhận từ chối nhận tin: data "tạm dừng" kèm OPT01, không ghi lịch sử, không tính lượt, không nghỉ')

    // Mã do app tự đặt và lỗi DB của mình là tín hiệu engine: đổi được bằng luật trong DB, hôm nay ra đúng mã cũ.
    const clsAt = async (action, signal, phase = 'before_send') =>
      (await one(`SELECT * FROM public.aka_agent_engine_classify_signal('zalo', $1, $2, $3::jsonb)`, [action, phase, JSON.stringify(signal)])).error_code
    for (const action of ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend']) {
      assert.equal(await clsAt(action, { kind: 'engine', code: 'target_missing_identity' }), legacyZaloErrorCode('114', action), action)
      // Desktop gửi tin rỗng, zca-js từ chối "Missing message content" (lỗi không mã) → bắt-tất-cả như hôm nay.
      assert.equal(await clsAt(action, { kind: 'engine', code: 'empty_content' }), 'err_zalo_api_business_failed', action)
      assert.equal(await clsAt(action, { kind: 'engine', code: 'find_user_without_uid' }, 'after_send'), legacyZaloErrorCode('216', action), action)
      assert.equal(await clsAt(action, { kind: 'engine', code: 'db_unavailable' }), 'err_engine_runtime_unavailable', action)
      assert.equal(await clsAt(action, { kind: 'engine', code: 'gate_unavailable' }), 'err_engine_gate_unavailable', action)
    }
    const gateDown = (await rpc('aka_agent_engine_simulate_v1', 'zalo_message_phone', 'fly',
      JSON.stringify({ actionCode: 'zalo_message_stranger', ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'gate_unavailable' } }))).policy
    assert.deepEqual([gateDown.detail_mode, gateDown.target_effect, gateDown.run_effect, gateDown.quota_effect], ['suppress', 'requeue', 'end_unit', 'no_count'])
    pass('mã app tự đặt (114/216, tin rỗng) và lỗi DB của mình là tín hiệu engine, ra đúng mã như Desktop hôm nay; cổng đặt đóng khi lỗi → SYS08, về hàng đợi')

    // Hết data: hoàn thành chiến dịch khi còn giữ lease; còn data hẹn sau thì hẹn lại; quyền RPC.
    const n13 = await claim(c13, optional)
    assert.equal(n13.status, 'no_target'); assert.equal(n13.runningTargets, 0)
    const finish = (c, note = null) => rpc('aka_agent_engine_finish_campaign_v1', c.account, c.lease, note)
    assert.equal((await finish({ ...c13, lease: '00000000-0000-0000-0000-000000000000' })).reason, 'ownership_lost')
    const later = ++nextId
    await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete, schedule)
      OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Hẹn sau', '0909111222', 'chờ xử lý', false, now() + interval '2 hours')`, [later, c13.campaign])
    const f13 = await finish(c13)
    assert.equal(f13.reason, 'rescheduled'); assert.equal(await val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c13.campaign]), 'chờ xử lý')
    await db.query(`UPDATE public.auto_campaign_input_data SET is_delete = true WHERE id = $1`, [later])
    const f13b = await finish(c13)
    assert.equal(f13b.reason, 'completed'); assert.equal(await val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c13.campaign]), 'hoàn thành')
    assert.equal((await rpc('aka_agent_engine_release_v1', c13.account, c13.lease)).ok, true)
    assert.equal(await val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c13.campaign]), 'hoàn thành', 'nhả lease không ghi đè "hoàn thành"')
    const c14 = await makeCampaign({ targets: 1 })
    await claim(c14)
    assert.equal((await finish(c14)).reason, 'targets_remaining')
    for (const fn of ['public.aka_agent_engine_take_content_index_v1(bigint,uuid,text,integer)', 'public.aka_agent_engine_finish_campaign_v1(bigint,uuid,text)']) {
      assert.equal(await priv('aka_agent_chat_api', fn), true, fn); assert.equal(await priv('anon', fn), false, fn)
    }
    pass('hết data: hoàn thành chiến dịch (nhả lease không ghi đè); còn data hẹn sau thì hẹn lại; còn data đang chạy thì không; chỉ chủ lease gọi được')

    // ---- 12c. Hạn mức tính trong DB: đúng công thức bộ chạy Desktop/VPS --------------------------
    {
      const lim = async (c, code) => rpc('aka_agent_engine_action_limit', c.campaign, c.account, code)
      const cl = await makeCampaign({ targets: 0, org: 610 })
      assert.deepEqual(await lim(cl, 'zalo_message_stranger'), { daily: 30, windowCount: 9, windowMinutes: 65 }, 'mặc định 30/ngày, 9 lượt/65 phút')
      await db.query(`UPDATE public.auto_campaigns SET extra_settings = $2::jsonb WHERE id = $1`, [cl.campaign,
        JSON.stringify({ actionLimits: { dailyLimit: 50, rateLimitCount: 12, rateLimitMinutes: 70, byActionCode: { zalo_add_friend: { dailyLimit: 20 } } } })])
      assert.deepEqual(await lim(cl, 'zalo_message_stranger'), { daily: 50, windowCount: 12, windowMinutes: 70 }, 'khối chung của chiến dịch')
      assert.deepEqual(await lim(cl, 'zalo_add_friend'), { daily: 20, windowCount: 9, windowMinutes: 65 }, 'cài theo mã thay cả khối chung')
      assert.deepEqual(await lim(cl, 'zalo_find_phone_user'), { daily: 1000, windowCount: 1000, windowMinutes: 70 }, 'Tìm SĐT cố định 1.000, phút theo cài đặt')
      // Nhóm tài khoản đè chiến dịch theo từng trường.
      await db.query(`INSERT INTO public.auto_account_groups(id, settings) VALUES (9610, '{"byActionCode":{"zalo_message_stranger":{"rateLimitCount":5}}}')`)
      await db.query(`UPDATE public.auto_accounts SET account_group_id = 9610 WHERE id = $1`, [cl.account])
      assert.deepEqual(await lim(cl, 'zalo_message_stranger'), { daily: 50, windowCount: 5, windowMinutes: 70 }, 'nhóm đè đúng trường đã đặt')
      // Trần gói Zalo: lấy min với giới hạn ngày; có gói không giới hạn thì không có trần; gói hết hạn không tính.
      await db.query(`INSERT INTO public.org_organization_product(organization_id, product_id, package_type, expiration_date, max_sends_per_day)
        VALUES (610, 16, 'paid', now() + interval '10 days', 40), (610, 18, 'paid', now() - interval '3 days', NULL)`)
      assert.equal((await lim(cl, 'zalo_message_stranger')).daily, 40, 'trần gói 40 < 50')
      assert.equal((await lim(cl, 'zalo_find_phone_user')).daily, 1000, 'Tìm SĐT không có trần gói')
      await db.query(`INSERT INTO public.org_organization_product(organization_id, product_id, package_type, expiration_date, max_sends_per_day)
        VALUES (610, 18, 'paid', now() + interval '10 days', NULL)`)
      assert.equal((await lim(cl, 'zalo_message_stranger')).daily, 50, 'một gói còn hạn không đặt giới hạn: không có trần')
      await db.query(`DELETE FROM public.org_organization_product WHERE organization_id = 610`)
      await db.query(`INSERT INTO public.org_organization_product(organization_id, product_id, package_type, expiration_date, max_sends_per_day)
        VALUES (610, 16, 'demo', now() + interval '2 days', NULL)`)
      assert.equal((await lim(cl, 'zalo_message_stranger')).daily, 30, 'gói demo không đặt giới hạn: trần 30')
      // Claim dùng đúng giới hạn này: hết lượt khung giờ thì chờ tới khi lượt cũ nhất ra khỏi khung (ít nhất 60 giây).
      const cw = await makeCampaign({ targets: 1, org: 611 })
      await db.query(`UPDATE public.auto_campaigns SET extra_settings = '{"actionLimits":{"rateLimitCount":1,"rateLimitMinutes":10}}'::jsonb WHERE id = $1`, [cw.campaign])
      await db.query(`INSERT INTO public.auto_campaign_details(campaign_id, account_id, action_code, action_name, status, created_at, is_delete)
        VALUES ($1, $2, 'zalo_message_stranger', 'Nhắn tin người lạ', 'thành công', now() - interval '9 minutes 30 seconds', true)`, [cw.campaign, cw.account])
      const ww = await claim(cw, { actions: [{ code: 'zalo_message_stranger' }] })
      assert.equal(ww.status, 'wait'); assert.equal(ww.wait.gate, 'quota'); assert.equal(ww.wait.errorCode, 'error_limit_in_hour')
      const waitSec = (new Date(ww.wait.until).getTime() - Date.now()) / 1000
      assert.ok(waitSec >= 55 && waitSec <= 65, `chờ ít nhất 60 giây (được ${waitSec})`)
      pass('hạn mức trong DB: mặc định 30/9/65; chiến dịch (khối chung, theo mã); Tìm SĐT 1.000; nhóm đè từng trường; trần gói Zalo (min, không giới hạn, demo 30, bỏ gói hết hạn); khung giờ đếm cả dòng đã xoá như bộ chạy, chờ ít nhất 60 giây')
    }

    // ---- 12d. Desktop chỉ đụng việc của chính nhân viên đăng nhập ------------------------------------
    {
      await db.query(`CREATE SCHEMA IF NOT EXISTS private`)
      await db.query(`CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('test.desktop_staff', true), '')::bigint $$`)
      const cq = await makeCampaign({ targets: 1, org: 612, server: false })
      await db.query(`SELECT set_config('test.desktop_staff', $1, false)`, [String(cq.staff + 1)])
      assert.equal((await claim(cq, { runtimeTarget: 'desktop', runnerId: 'desktop:test' })).status, 'not_found', 'nhân viên khác không nhận được')
      await db.query(`SELECT set_config('test.desktop_staff', $1, false)`, [String(cq.staff)])
      assert.equal((await claim(cq, { runtimeTarget: 'fly' })).status, 'invalid_request', 'Desktop không nhận lượt dưới vai trò Fly')
      const own = await claim(cq, { runtimeTarget: 'desktop', runnerId: 'desktop:test' })
      assert.equal(own.status, 'claimed')
      await db.query(`SELECT set_config('test.desktop_staff', $1, false)`, [String(cq.staff + 1)])
      assert.deepEqual(await rpc('aka_agent_engine_target_timeline_v1', cq.ids[0]), [], 'dòng thời gian của nhân viên khác trả rỗng')
      await db.query(`SELECT set_config('test.desktop_staff', '', false)`)
      assert.ok((await rpc('aka_agent_engine_target_timeline_v1', cq.ids[0])).length > 0)
      await db.query(`DROP FUNCTION private.aka_agent_staff_scope_for_request()`)
      if (await val(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop')`)) {
        assert.equal(await priv('aka_agent_desktop', 'public.aka_agent_engine_claim_target_v1(jsonb)'), true)
        assert.equal(await priv('aka_agent_desktop', 'public.aka_agent_engine_simulate_v1(text,text,jsonb)'), false)
        assert.equal(await priv('aka_agent_desktop', 'public.aka_agent_engine_action_limit(bigint,bigint,text)'), false)
      }
      pass('Desktop: nhân viên khác không nhận được việc, không đọc được dòng thời gian; không nhận lượt dưới vai trò Fly; chỉ được gọi RPC của một lượt chạy')
    }

    // ---- 12b. Cùng chạy với bộ cũ: không chạy chồng, không đụng data bộ cũ, không giữ cổng bảo trì -------
    {
      // Desktop: bản cài mới tự chạy bộ mới, không xét cờ tổ chức.
      const cd = await makeCampaign({ targets: 1, org: 889, newRuntime: false, server: false })
      assert.equal((await claim(cd, { runtimeTarget: 'desktop', runnerId: 'desktop:test' })).status, 'claimed')
      assert.equal((await claim(cd, { runtimeTarget: 'fly' })).status, 'not_enabled', 'Fly không chạy tổ chức chưa bật cờ')

      // Bộ cũ còn giữ một chiến dịch khác của cùng tài khoản: chờ.
      const ca = await makeCampaign({ targets: 1 })
      const legacyCampaign = ++nextId
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, runtime_claim_token)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Legacy', 'zalo_message_phone', $2, 'đang chạy', now(), false, $3, 501, gen_random_uuid())`, [legacyCampaign, ca.account, ca.staff])
      const busy = await claim(ca)
      assert.equal(busy.status, 'legacy_busy'); assert.equal(busy.scope, 'campaign')
      assert.equal((await target(ca.ids[0])).status, 'chờ xử lý')
      await db.query(`UPDATE public.auto_campaigns SET runtime_claim_token = NULL, status = 'chờ xử lý' WHERE id = $1`, [legacyCampaign])
      // Bộ cũ đang chạy thao tác tài khoản (đổi tên, quét danh bạ…): chờ.
      await db.query(`UPDATE public.auto_accounts SET runtime_operation_claim_token = gen_random_uuid() WHERE id = $1`, [ca.account])
      const busyAccount = await claim(ca)
      assert.equal(busyAccount.status, 'legacy_busy'); assert.equal(busyAccount.scope, 'account')
      await db.query(`UPDATE public.auto_accounts SET runtime_operation_claim_token = NULL WHERE id = $1`, [ca.account])
      const cla = await claim(ca)
      assert.equal(cla.status, 'claimed')
      for (const col of ['runtime_claim_token', 'runtime_unit_token']) {
        assert.equal(await val(`SELECT ${col} FROM public.auto_campaigns WHERE id = $1`, [ca.campaign]), null, 'bộ mới không dùng token của bộ cũ')
      }

      // Lịch còn là ngày cũ: nhận lượt thì ghi lịch hôm nay, nên cổng bảo trì của bộ cũ không đếm chiến dịch này.
      const cy = await makeCampaign({ targets: 1, schedule: "now() - interval '2 days'" })
      assert.equal((await claim(cy)).status, 'claimed')
      const barrier = await val(`SELECT count(*) FROM public.auto_campaigns c WHERE c.id = $1 AND c.status = 'đang chạy'
        AND c.runtime_claim_vietnam_date IS NULL AND c.schedule < (timezone('Asia/Ho_Chi_Minh', now())::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`, [cy.campaign])
      assert.equal(Number(barrier), 0, 'chiến dịch của bộ mới không khớp điều kiện cổng bảo trì của bộ cũ')
      const cs = await makeCampaign({ targets: 1, schedule: "now() + interval '3 hours'" })
      await db.query(`UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = $1`, [cs.campaign])
      assert.equal((await claim(cs)).status, 'claimed')
      assert.ok(await val(`SELECT schedule > now() + interval '2 hours' FROM public.auto_campaigns WHERE id = $1`, [cs.campaign]), 'lịch hôm nay thì giữ nguyên')

      // Bộ cũ nhận lại chiến dịch sau khi lease của bộ mới hết hạn: job dọn không đụng data, chiến dịch, tài khoản.
      const cr = await makeCampaign({ targets: 1 })
      const clr = await claim(cr)
      assert.equal(clr.status, 'claimed')
      await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '1 hour' WHERE account_id = $1`, [cr.account])
      await db.query(`UPDATE public.auto_engine_target_runs SET started_at = now() - interval '1 hour' WHERE id = $1`, [clr.targetRunId])
      await db.query(`UPDATE public.auto_campaigns SET runtime_unit_token = gen_random_uuid() WHERE id = $1`, [cr.campaign])
      await rpc('aka_agent_engine_close_stale_v1', 200)
      assert.equal((await target(cr.ids[0])).status, 'đang chạy', 'data bộ cũ đang chạy giữ nguyên')
      assert.ok(await val(`SELECT completed_at IS NOT NULL FROM public.auto_engine_target_runs WHERE id = $1`, [clr.targetRunId]), 'sổ lượt của bộ mới được đóng')
      assert.equal(await val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [cr.campaign]), 'đang chạy', 'chiến dịch bộ cũ đang chạy giữ nguyên')
      assert.equal(await val(`SELECT status FROM public.auto_accounts WHERE id = $1`, [cr.account]), 'đang chạy', 'tài khoản bộ cũ đang chạy giữ nguyên')
      await db.query(`UPDATE public.auto_campaigns SET runtime_unit_token = NULL WHERE id = $1`, [cr.campaign])
      pass('cùng chạy với bộ cũ: Desktop không xét cờ; chờ khi bộ cũ giữ chiến dịch hay tài khoản; không dùng token cũ; không giữ cổng bảo trì; job dọn không đụng phần bộ cũ đang chạy')
    }

    // ---- 13. Rollback rồi apply lại ----------------------------------------------------------
    await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'test' WHERE completed_at IS NULL`)
    await db.query(`DELETE FROM public.auto_engine_leases`)
    await db.query(ROLLBACK)
    assert.equal(await val(`SELECT to_regclass('public.auto_outcome_policies')`), null)
    assert.equal(Number(await val(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'auto_error' AND column_name = 'public_code'`)), 0)
    const kept = (await db.query(`SELECT error_code, is_active FROM public.auto_error WHERE error_type = 'engine v2' ORDER BY 1`)).rows
    assert.ok(kept.every(k => k.is_active === false), 'mã engine đã được lịch sử tham chiếu thì chỉ tắt')
    pass(`rollback gỡ hết đối tượng/cột V495; ${kept.length} mã engine đã được lịch sử tham chiếu được giữ ở trạng thái tắt`)
    await db.query(`DELETE FROM public.auto_campaign_details WHERE error_code IN (SELECT error_code FROM public.auto_error WHERE error_type = 'engine v2')
        OR status_id IN (SELECT id FROM public.auto_status WHERE code IN ('campaign_detail_invalid_phone', 'campaign_detail_interacted'))
        OR sub_status_id IN (SELECT id FROM public.auto_status WHERE code IN ('campaign_detail_invalid_phone', 'campaign_detail_interacted'));
      UPDATE public.auto_account_action_status SET disabled_error_code = NULL WHERE disabled_error_code IN (SELECT error_code FROM public.auto_error WHERE error_type = 'engine v2');
      DELETE FROM public.auto_error WHERE error_type = 'engine v2';
      DELETE FROM public.auto_status WHERE code IN ('campaign_detail_invalid_phone', 'campaign_detail_interacted')`)
    await db.query(MIGRATION)
    assert.deepEqual((await db.query(`SELECT * FROM public.aka_agent_engine_policy_lint`)).rows, [])
    pass('apply lại sau rollback thành công, lint sạch')
    console.log(`\n${checks} nhóm kiểm tra đạt`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(err => { console.error(err); process.exit(1) })

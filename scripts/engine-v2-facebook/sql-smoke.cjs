// Bộ kiểm SQL của engine v2 Facebook trên PostgreSQL 17 cục bộ (không chạm DB thật):
//   node scripts/engine-v2-facebook/sql-smoke.cjs
// Dựng DB engine như production (tới V532) rồi apply các migration Facebook, kiểm từng hàm, gỡ rồi apply lại.
// LIVE_DUMP=<tệp json> (kết quả đọc pg_get_functiondef của production, chỉ đọc): so md5 thân hàm engine của DB thử với production, để
// preflight md5 của migration thay thân hàm đúng trên cả hai.
'use strict'
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, readMigration } = require('./fixture.cjs')

const PORT = Number(process.env.ENGINE_FB_SMOKE_PORT || 55553)
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.message}`) }
}

async function insertRows(db, table, rows) {
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows
    .map(r => r.column_name)
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols.includes(k))
  const list = keys.map(k => `"${k}"`).join(', ')
  await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`,
    [JSON.stringify(rows)])
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0]
const asDesktop = async (db, staffId, fn) => {
  await db.query('BEGIN')
  try {
    await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [staffId == null ? '' : String(staffId)])
    await db.query('SET LOCAL ROLE aka_agent_desktop')
    const out = await fn()
    await db.query('COMMIT')
    return out
  } catch (error) { await db.query('ROLLBACK'); throw error }
}
const expectError = async (fn, pattern) => {
  let error = null
  try { await fn() } catch (e) { error = e }
  assert.ok(error, 'phải lỗi')
  assert.match(String(error.message), pattern)
}

async function compareLive(db) {
  const file = process.env.LIVE_DUMP
  if (!file) return
  const raw = fs.readFileSync(file, 'utf8')
  const live = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).rows[0].out.functions
  const local = (await db.query(`SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, md5(pg_get_functiondef(p.oid)) AS md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'aka_agent_engine%'`)).rows
  const key = f => `${f.name}(${f.args})`
  const L = new Map(local.map(f => [key(f), f.md5]))
  for (const f of live.filter(x => x.schema === 'public' && x.name.startsWith('aka_agent_engine'))) {
    const m = L.get(key(f))
    console.log(`${m === f.md5 ? 'SAME' : m ? 'DIFF' : 'MISS'} ${key(f)} live=${f.md5} local=${m ?? '-'}`)
  }
}

async function seed(db) {
  await db.query(`INSERT INTO public.org_organization (id, name) VALUES (501, 'FB thử'), (502, 'FB khác') ON CONFLICT DO NOTHING`)
  await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) VALUES (9001, 501, 'fbstaff', 'pw'), (9002, 502, 'other', 'pw2')`)
  await insertRows(db, 'auto_accounts', [
    { id: 95001, name: 'FB 1', flatform_type: 'facebook', login_status: 'đã đăng nhập', status: 'chờ xử lý', is_active: true, is_delete: false,
      staff_id: 9001, organization_id: 501, is_zalo_server: false, is_zalo_show_web: false },
    { id: 95002, name: 'FB 2', flatform_type: 'facebook', login_status: 'đã đăng nhập', status: 'chờ xử lý', is_active: true, is_delete: false,
      staff_id: 9002, organization_id: 502, is_zalo_server: false, is_zalo_show_web: false }])
  await insertRows(db, 'auto_campaigns', [
    { id: 96001, name: 'Đăng nhóm thử', action_id: 'facebook_group_post', account_id: 95001, status: 'chờ xử lý', is_delete: false, staff_id: 9001,
      organization_id: 501, schedule: new Date(Date.now() - 60_000).toISOString(), schedule_type: 'daily', extra_settings: {} }])
  await insertRows(db, 'auto_campaign_input_data', [{ id: 97001, campaign_id: 96001, status: 'đang chạy', uid: 'g1', name: 'Nhóm 1', is_delete: false }])
  const lease = '11111111-1111-4111-8111-111111111111'
  await db.query(`INSERT INTO public.auto_engine_leases (account_id, lease_token, runner_id, runtime_target, campaign_id, expires_at)
    VALUES (95001, $1, 'desktop:test', 'desktop', 96001, now() + interval '3 minutes')`, [lease])
  const run = await one(db, `INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token,
      runner_id, runtime_target) VALUES (97001, 96001, 95001, 9001, 501, $1, 'desktop:test', 'desktop') RETURNING id`, [lease])
  const resultKey = `v2:${run.id}:post`
  await db.query(`INSERT INTO public.auto_engine_outcomes (result_key, target_run_id, input_data_id, campaign_id, account_id, action_code, phase, ok,
      delivery_state, decision, signal) VALUES ($1, $2, 97001, 96001, 95001, 'fb_post_group', 'after_send', true, 'delivered', '{}', '{"runId":"77"}')`,
    [resultKey, run.id])
  await db.query(`INSERT INTO public.auto_runs (id, workflow_id, campaign_id, account_id, status) OVERRIDING SYSTEM VALUE VALUES (77, 1, 96001, 95001, 'completed')`)
  await db.query(`INSERT INTO public.auto_run_steps (run_id, node_id, block_name, status, output) VALUES (77, 'post', 'fb_click_post_button', 'success', '{"ok":true}')`)
  return { lease, runId: Number(run.id), resultKey }
}

// ---------------------------------------------------------------------------------------------------------------------------
// V557 (lượt theo lịch) và V558 (thân hàm engine cho Facebook)
// ---------------------------------------------------------------------------------------------------------------------------
const claimAs = (db, staffId, ctx) => asDesktop(db, staffId, () => one(db, 'SELECT public.aka_agent_engine_claim_target_v1($1) AS r', [ctx]).then(r => r.r))
const reportAs = (db, staffId, runId, lease, outcomes, final) => asDesktop(db, staffId, () => one(db,
  'SELECT public.aka_agent_engine_report_v1($1, $2, $3, $4, false) AS r', [runId, lease, JSON.stringify(outcomes), final]).then(r => r.r))
const releaseAs = (db, staffId, accountId, lease) => asDesktop(db, staffId, () => one(db,
  'SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [accountId, lease]).then(r => r.r))
const markAs = (db, staffId, runId, lease, action, step) => asDesktop(db, staffId, () => one(db,
  'SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [runId, lease, action, step]).then(r => r.r))

async function slotAndFunctionChecks(db) {
  const v557 = ['migration_v557_engine_slot_runs_p1.sql', 'migration_v557_engine_slot_runs_p2a_index.sql',
    'migration_v557_engine_slot_runs_p2b_index.sql', 'migration_v557_engine_slot_runs_p3.sql'].map(readMigration)
  const v558 = readMigration('migration_v558_engine_facebook_functions.sql')
  const r555 = readMigration('rollback_v558_engine_facebook_functions.sql')
  await check('V558 từ chối khi chưa có V557', async () => { await expectError(() => db.query(v558), /chưa chạy V557/); await db.query('ROLLBACK').catch(() => {}) })
  await check('V557 phần 3 từ chối khi chưa có chỉ mục', async () => {
    await db.query(v557[0])
    await expectError(() => db.query(v557[3]), /chưa có đủ hai chỉ mục/)
    await db.query('ROLLBACK').catch(() => {})
  })
  await check('V557 apply (chỉ mục ngoài giao dịch, VALIDATE)', async () => {
    await db.query(v557[1]); await db.query(v557[2]); await db.query(v557[3])
    await expectError(() => db.query(v557[0]), /cột slot_at đã có|đã có trong sổ/)
    await db.query('ROLLBACK').catch(() => {})
  })
  await check('V558 apply, hậu kiểm định nghĩa khớp bản sinh', async () => {
    await db.query(v558)
    await expectError(() => db.query(v558), /V558 đã chạy/)
    await db.query('ROLLBACK').catch(() => {})
  })

  // Dữ liệu: tổ chức 501 (nhân viên 9001) bật Facebook; tài khoản 95001, 95003; đăng nhóm 96010 (2 data), trang cá nhân 96011 (không data).
  const lease0 = '11111111-1111-4111-8111-111111111111'
  await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), final_target_status = 'hoàn thành' WHERE lease_token = $1`, [lease0])
  await db.query(`DELETE FROM public.auto_engine_leases WHERE account_id = 95001`)
  await insertRows(db, 'auto_accounts', [{ id: 95003, name: 'FB 3', flatform_type: 'facebook', login_status: 'đã đăng nhập', status: 'chờ xử lý',
    is_active: true, is_delete: false, staff_id: 9001, organization_id: 501, is_zalo_server: false, is_zalo_show_web: false }])
  const sched = new Date(Date.now() - 60_000).toISOString()
  await insertRows(db, 'auto_campaigns', [
    { id: 96010, name: 'Đăng nhóm engine', action_id: 'facebook_group_post', account_id: 95001, status: 'chờ xử lý', is_delete: false, staff_id: 9001,
      organization_id: 501, schedule: sched, schedule_type: 'daily', extra_settings: {} },
    { id: 96011, name: 'Trang cá nhân engine', action_id: 'facebook_timeline_post', account_id: 95001, status: 'chờ xử lý', is_delete: false,
      staff_id: 9001, organization_id: 501, schedule: sched, schedule_type: 'daily', extra_settings: {} },
    { id: 96012, name: 'Đăng nhóm tài khoản khác', action_id: 'facebook_group_post', account_id: 95003, status: 'đang chạy', is_delete: false,
      staff_id: 9001, organization_id: 501, schedule: sched, schedule_type: 'daily', extra_settings: {} }])
  await insertRows(db, 'auto_campaign_input_data', [
    { id: 97010, campaign_id: 96010, status: 'chờ xử lý', uid: 'g10', name: 'Nhóm 10', is_delete: false },
    { id: 97011, campaign_id: 96010, status: 'chờ xử lý', uid: 'g11', name: 'Nhóm 11', is_delete: false }])
  const ctx = (campaignId, extra = {}) => ({ staffId: 9001, accountId: 95001, campaignId, runnerId: 'desktop:smoke', runtimeTarget: 'desktop',
    actions: [{ code: campaignId === 96011 ? 'fb_post_my_profile' : 'fb_post_group' }], ...extra })
  const setFb = value => db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'engine.facebook'`, [value])

  await check('claim Facebook: tắt → not_enabled; bật mà chưa có gói → entitlement_denied', async () => {
    await setFb('{"mode":"off"}')
    assert.equal((await claimAs(db, 9001, ctx(96010))).status, 'not_enabled')
    await setFb('{"mode":"orgs","organizationIds":[501]}')
    assert.equal((await claimAs(db, 9001, ctx(96010))).status, 'entitlement_denied')
    await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, package_type, expiration_date)
      VALUES (501, 3, 'demo', now() - interval '2 days')`)
    assert.equal((await claimAs(db, 9001, ctx(96010))).status, 'entitlement_denied', 'gói hết hạn')
    await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, package_type, expiration_date)
      VALUES (501, 10, 'demo', now() + interval '10 days')`)
  })
  await check('claim Facebook: giới hạn số tài khoản Facebook chạy cùng lúc', async () => {
    await db.query(`UPDATE public.org_staff SET max_running_facebook_accounts = 1 WHERE id = 9001`)
    const res = await claimAs(db, 9001, ctx(96010))
    assert.equal(res.status, 'concurrency_limit'); assert.equal(res.max, 1)
    await db.query(`UPDATE public.org_staff SET max_running_facebook_accounts = 2 WHERE id = 9001`)
  })
  let claim
  await check('claim Facebook: nhận data, cổng thao tác', async () => {
    claim = await claimAs(db, 9001, ctx(96010))
    assert.equal(claim.status, 'claimed', JSON.stringify(claim))
    assert.equal(Number(claim.target.id), 97010)
    assert.equal(claim.actions.fb_post_group.decision, 'allow')
  })
  await check('trần gói Facebook như bộ cũ; Zalo không đổi', async () => {
    const limit = code => one(db, 'SELECT public.aka_agent_engine_action_limit(96010, 95001, $1) AS r', [code]).then(r => r.r)
    assert.equal((await limit('fb_post_group')).daily, 30, 'demo không đặt số: 30')
    await db.query(`UPDATE public.auto_campaigns SET extra_settings = '{"actionLimits":{"dailyLimit":50}}' WHERE id = 96010`)
    assert.equal((await limit('fb_comment')).daily, 30, 'cấu hình 50 nhưng trần demo 30')
    await db.query(`UPDATE public.org_organization_product SET max_sends_per_day = 45 WHERE organization_id = 501 AND product_id = 10`)
    assert.equal((await limit('fb_post_page')).daily, 45)
    await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, package_type, expiration_date)
      VALUES (501, 3, 'paid', now() + interval '30 days')`)
    assert.equal((await limit('fb_post_group')).daily, 50, 'gói trả phí không đặt số: không giới hạn, theo cấu hình')
    assert.equal((await limit('zalo_message_friend')).daily, 50, 'Zalo không theo gói Facebook')
  })
  await check('report: inherit ghi trạng thái block trả; comment lỗi sau khi đã đăng không cộng chuỗi', async () => {
    await db.query(`INSERT INTO public.auto_outcome_policies (error_code, action_code, detail_mode, quota_effect, target_streak_effect, streak_threshold,
      streak_after_delivery, target_effect, remaining_steps, run_effect, campaign_effect, source)
      VALUES ('err_comment_frequency_limit', 'fb_comment', 'inherit', 'no_count', 'increment', 4, 'ignore', 'complete', 'continue', 'continue', 'pause', 'smoke')`)
    const run = Number(claim.targetRunId)
    assert.equal((await markAs(db, 9001, run, claim.leaseToken, 'fb_post_group', 'post')).ok, true)
    const posted = await reportAs(db, 9001, run, claim.leaseToken, [{ resultKey: `v2:${run}:post`, actionCode: 'fb_post_group', stepKey: 'post', ok: true,
      phase: 'after_send', statusCode: 'campaign_detail_success', data: { runId: '501', postUrl: 'https://www.facebook.com/groups/g1/posts/9/' } }], false)
    assert.equal(posted.ok, true); assert.equal(posted.outcomes[0].deliveryState, 'delivered')
    const postRow = await one(db, `SELECT post_url FROM public.auto_campaign_details WHERE result_key = $1`, [`v2:${run}:post`])
    assert.equal(postRow.post_url, 'https://www.facebook.com/groups/g1/posts/9/', 'link bài ở cột post_url như bộ cũ')
    const bad = await reportAs(db, 9001, run, claim.leaseToken, [{ resultKey: `v2:${run}:comment#0`, actionCode: 'fb_comment', stepKey: 'comment#0', ok: false,
      phase: 'before_send', statusCode: 'campaign_detail_khong_co', signal: { kind: 'block', code: 'err_comment_frequency_limit', errorCode: 'err_comment_frequency_limit' } }], true)
    assert.equal(bad.ok, false); assert.equal(bad.reason, 'status_unknown')
    const trace = { ops: [{ op: 'click', el: 'fb_comment_box', t: 1, ms: 2, ok: false, err: 'Element not found: {fb_comment_box}' }], dropped: 0, sendAttempted: false }
    const res = await reportAs(db, 9001, run, claim.leaseToken, [{ resultKey: `v2:${run}:comment#0`, actionCode: 'fb_comment', stepKey: 'comment#0', ok: false,
      phase: 'before_send', statusCode: 'campaign_detail_error', signal: { kind: 'block', code: 'err_comment_frequency_limit', errorCode: 'err_comment_frequency_limit',
        trace } }], true)
    assert.equal(res.ok, true, JSON.stringify(res))
    assert.equal(res.outcomes[0].errorCode, 'err_comment_frequency_limit')
    assert.equal(res.outcomes[0].statusCode, 'campaign_detail_error', 'trạng thái theo block')
    assert.equal(res.streak.effect, 'reset', 'đăng thành công đặt lại chuỗi, comment lỗi sau đó không cộng (như bộ cũ)')
    assert.equal(res.campaign.effect, 'none', 'hiệu ứng có ngưỡng không áp')
    const detail = await one(db, `SELECT status, data, post_url FROM public.auto_campaign_details WHERE result_key = $1`, [`v2:${run}:comment#0`])
    assert.equal(detail.status, 'lỗi')
    assert.equal(detail.post_url, null)
    assert.equal(detail.data.signal.code, 'err_comment_frequency_limit')
    assert.equal(detail.data.signal.trace, undefined, 'vết thao tác không vào lịch sử khách xem')
    const outcome = await one(db, `SELECT signal FROM public.auto_engine_outcomes WHERE result_key = $1`, [`v2:${run}:comment#0`])
    assert.deepEqual(outcome.signal.trace, trace, 'vết thao tác giữ ở auto_engine_outcomes')
  })
  await check('report: comment lỗi khi chưa gửi gì thì vẫn cộng chuỗi', async () => {
    const next = await claimAs(db, 9001, ctx(96010, { leaseToken: claim.leaseToken }))
    assert.equal(next.status, 'claimed'); assert.equal(Number(next.target.id), 97011)
    const run = Number(next.targetRunId)
    const res = await reportAs(db, 9001, run, next.leaseToken, [{ resultKey: `v2:${run}:comment#0`, actionCode: 'fb_comment', stepKey: 'comment#0', ok: false,
      phase: 'before_send', statusCode: 'campaign_detail_error', signal: { kind: 'block', code: 'err_comment_frequency_limit', errorCode: 'err_comment_frequency_limit' } }], true)
    assert.equal(res.ok, true); assert.equal(res.streak.effect, 'increment')
    assert.equal((await releaseAs(db, 9001, 95001, next.leaseToken)).ok, true)
  })
  let slot
  await check('lượt theo lịch: nhận một lần mỗi mốc', async () => {
    slot = await claimAs(db, 9001, ctx(96011, { mode: 'campaign_slot' }))
    assert.equal(slot.status, 'claimed', JSON.stringify(slot))
    assert.equal(slot.target.id, null); assert.ok(slot.target.slotAt)
    await expectError(() => db.query(`INSERT INTO public.auto_engine_target_runs (campaign_id, account_id, lease_token, runner_id, runtime_target, slot_at)
      VALUES (96011, 95001, gen_random_uuid(), 'x', 'desktop', now())`), /auto_engine_target_runs_slot_open_v557/)
    await expectError(() => db.query(`INSERT INTO public.auto_engine_target_runs (campaign_id, account_id, lease_token, runner_id, runtime_target)
      VALUES (96011, 95001, gen_random_uuid(), 'x', 'desktop')`), /target_or_slot/)
    const run = Number(slot.targetRunId)
    const res = await reportAs(db, 9001, run, slot.leaseToken, [{ resultKey: `v2:${run}:post`, actionCode: 'fb_post_my_profile', stepKey: 'post', ok: true,
      phase: 'after_send' }], true)
    assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.target.done, true)
    const detail = await one(db, `SELECT input_data_id, status FROM public.auto_campaign_details WHERE result_key = $1`, [`v2:${run}:post`])
    assert.equal(detail.input_data_id, null)
    const again = await claimAs(db, 9001, ctx(96011, { mode: 'campaign_slot', leaseToken: slot.leaseToken }))
    assert.equal(again.status, 'no_target'); assert.equal(again.slot, true)
    assert.equal((await releaseAs(db, 9001, 95001, slot.leaseToken)).ok, true)
    assert.equal((await claimAs(db, 9001, ctx(96011, { mode: 'campaign_slot' }))).status, 'no_target', 'mốc đã chạy xong')
  })
  await check('lượt theo lịch: mốc về hàng đợi thì nhận lại được', async () => {
    await db.query(`UPDATE public.auto_engine_target_runs SET final_target_status = 'chờ xử lý' WHERE id = $1`, [Number(slot.targetRunId)])
    await db.query(`DELETE FROM public.auto_engine_leases WHERE account_id = 95001`)
    const retry = await claimAs(db, 9001, ctx(96011, { mode: 'campaign_slot' }))
    assert.equal(retry.status, 'claimed'); assert.notEqual(Number(retry.targetRunId), Number(slot.targetRunId))
    await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), final_target_status = 'hoàn thành' WHERE id = $1`, [Number(retry.targetRunId)])
    await db.query(`DELETE FROM public.auto_engine_leases WHERE account_id = 95001`)
  })
  await check('Zalo: claim không bị nhánh Facebook chặn', async () => {
    await insertRows(db, 'auto_accounts', [{ id: 95100, name: 'Zalo 1', flatform_type: 'zalo', login_status: 'đã đăng nhập', status: 'chờ xử lý',
      is_active: true, is_delete: false, staff_id: 9001, organization_id: 501, is_zalo_server: false, is_zalo_show_web: false }])
    await insertRows(db, 'auto_campaigns', [{ id: 96100, name: 'Zalo', action_id: 'zalo_message_friend', account_id: 95100, status: 'chờ xử lý',
      is_delete: false, staff_id: 9001, organization_id: 501, schedule: sched, schedule_type: 'daily', extra_settings: {} }])
    await insertRows(db, 'auto_campaign_input_data', [{ id: 97100, campaign_id: 96100, status: 'chờ xử lý', uid: 'u1', name: 'Bạn 1', is_delete: false }])
    await setFb('{"mode":"off"}')
    const z = await claimAs(db, 9001, { staffId: 9001, accountId: 95100, campaignId: 96100, runnerId: 'desktop:smoke', runtimeTarget: 'desktop',
      actions: [{ code: 'zalo_message_friend' }] })
    assert.notEqual(z.status, 'not_enabled'); assert.notEqual(z.status, 'entitlement_denied')
    await setFb('{"mode":"orgs","organizationIds":[501]}')
  })
  await check('nhận thêm đúng các data vào lượt (inputDataIds qua claim_batch_v1, cùng lease): nhóm chia sẻ kèm, chốt riêng từng nhóm', async () => {
    await db.query(`UPDATE public.org_staff SET max_running_facebook_accounts = NULL WHERE id = 9001`)
    await insertRows(db, 'auto_accounts', [{ id: 95004, name: 'FB 4', flatform_type: 'facebook', login_status: 'đã đăng nhập', status: 'chờ xử lý',
      is_active: true, is_delete: false, staff_id: 9001, organization_id: 501, is_zalo_server: false, is_zalo_show_web: false }])
    await insertRows(db, 'auto_campaigns', [{ id: 96013, name: 'Đăng nhóm kèm chia sẻ', action_id: 'facebook_group_post', account_id: 95004,
      status: 'chờ xử lý', is_delete: false, staff_id: 9001, organization_id: 501, schedule: sched, schedule_type: 'daily', extra_settings: {} }])
    await insertRows(db, 'auto_campaign_input_data', [20, 21, 22, 23].map(n => ({ id: 97000 + n, campaign_id: 96013, status: 'chờ xử lý',
      uid: 'g' + n, name: 'Nhóm ' + n, is_delete: false })))
    const base = { staffId: 9001, accountId: 95004, campaignId: 96013, runnerId: 'desktop:smoke', runtimeTarget: 'desktop' }
    assert.equal((await claimAs(db, 9001, { ...base, actions: [], inputDataIds: [97021] })).status, 'invalid_request', 'không giữ lease thì không nhận theo danh sách')
    const main = await claimAs(db, 9001, { ...base, actions: [{ code: 'fb_post_group' }] })
    assert.equal(main.status, 'claimed', JSON.stringify(main)); assert.equal(Number(main.target.id), 97020)
    assert.equal((await claimAs(db, 9001, { ...base, leaseToken: main.leaseToken, actions: [], inputDataIds: ['x'] })).status, 'invalid_request')
    assert.equal((await claimAs(db, 9001, { ...base, leaseToken: main.leaseToken, actions: [], mode: 'campaign_slot', inputDataIds: [97021] })).status,
      'invalid_request', 'không cho lượt theo lịch')
    const batch = await asDesktop(db, 9001, () => one(db, 'SELECT public.aka_agent_engine_claim_batch_v1($1) AS r',
      [{ ...base, leaseToken: main.leaseToken, actions: [], inputDataIds: [97023, 97021], maxTargets: 2 }]).then(r => r.r))
    assert.equal(batch.status, 'claimed', JSON.stringify(batch))
    assert.equal(batch.leaseToken, main.leaseToken, 'cùng lease')
    assert.deepEqual(batch.items.map(i => Number(i.target.id)).sort(), [97021, 97023], 'chỉ data trong danh sách')
    assert.deepEqual((await db.query(`SELECT status FROM public.auto_campaign_input_data WHERE campaign_id = 96013 ORDER BY id`)).rows.map(r => r.status),
      ['đang chạy', 'đang chạy', 'chờ xử lý', 'đang chạy'])
    const runOf = id => Number(batch.items.find(i => Number(i.target.id) === id).targetRunId)
    for (const id of [97021, 97023]) assert.equal((await markAs(db, 9001, runOf(id), main.leaseToken, 'fb_post_group', 'share_post')).ok, true)
    const posted = await reportAs(db, 9001, runOf(97021), main.leaseToken, [{ resultKey: `v2:${runOf(97021)}:share_post`, actionCode: 'fb_post_group',
      actionName: 'Đăng bài', stepKey: 'share_post', ok: true, phase: 'after_send', statusCode: 'campaign_detail_success',
      customerLog: 'Đăng bài dạng chia sẻ vào Nhóm 21', data: { shareMode: 'group_composer_add_group', sharedFromInputDataId: 97020 } }], true)
    assert.equal(posted.ok, true, JSON.stringify(posted)); assert.equal(posted.target.status, 'hoàn thành')
    assert.equal(posted.outcomes[0].deliveryState, 'delivered')
    const row = await one(db, `SELECT input_data_id, action_code, action_name, status, log, data FROM public.auto_campaign_details WHERE result_key = $1`,
      [`v2:${runOf(97021)}:share_post`])
    assert.equal(Number(row.input_data_id), 97021, 'dòng lịch sử ghi đúng data của nhóm chia sẻ')
    assert.deepEqual([row.action_code, row.action_name, row.status, row.log], ['fb_post_group', 'Đăng bài', 'thành công', 'Đăng bài dạng chia sẻ vào Nhóm 21'])
    assert.equal(row.data.shareMode, 'group_composer_add_group')
    const back = await reportAs(db, 9001, runOf(97023), main.leaseToken, [{ resultKey: `v2:${runOf(97023)}:share_post`, actionCode: 'fb_post_group',
      stepKey: 'share_post', ok: false, phase: 'before_send',
      signal: { kind: 'engine', code: 'interrupted_before_send', errorCode: 'err_engine_interrupted_before_send' } }], true)
    assert.equal(back.ok, true, JSON.stringify(back)); assert.equal(back.target.status, 'chờ xử lý', 'chưa bấm Đăng: nhóm về hàng đợi')
    assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.auto_campaign_details WHERE result_key = $1`, [`v2:${runOf(97023)}:share_post`])).n, 0)
    assert.equal((await one(db, `SELECT count_action_in_day AS n FROM public.auto_account_action_status WHERE account_id = 95004 AND action_code = 'fb_post_group'`)).n,
      1, 'hai dấu giữ chỗ, nhóm chưa đăng được trả lại lượt')
    assert.equal((await releaseAs(db, 9001, 95004, main.leaseToken)).ok, false, 'data chính chưa chốt thì chưa nhả lease')
    const mainRun = Number(main.targetRunId)
    assert.equal((await reportAs(db, 9001, mainRun, main.leaseToken, [{ resultKey: `v2:${mainRun}:__stopped`, actionCode: 'fb_post_group',
      stepKey: '__stopped', ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'cancelled', errorCode: 'err_engine_cancelled' } }], true)).ok, true)
    assert.equal((await releaseAs(db, 9001, 95004, main.leaseToken)).ok, true)
  })
  await check('kết quả không gắn thao tác (dòng "Tìm data"): chỉ chiến dịch Facebook, phải có tên; không tính lượt, action_code trống', async () => {
    await insertRows(db, 'auto_accounts', [{ id: 95005, name: 'FB 5', flatform_type: 'facebook', login_status: 'đã đăng nhập', status: 'chờ xử lý',
      is_active: true, is_delete: false, staff_id: 9001, organization_id: 501, is_zalo_server: false, is_zalo_show_web: false }])
    await insertRows(db, 'auto_campaigns', [{ id: 96014, name: 'Tìm data trong group', action_id: 'facebook_find_data_group', account_id: 95005,
      status: 'chờ xử lý', is_delete: false, staff_id: 9001, organization_id: 501, schedule: sched, schedule_type: 'daily', extra_settings: {} }])
    await insertRows(db, 'auto_campaign_input_data', [30, 31].map(n => ({ id: 97000 + n, campaign_id: 96014, status: 'chờ xử lý', uid: 'g' + n,
      name: 'Nhóm ' + n, is_delete: false })))
    const base = { staffId: 9001, accountId: 95005, campaignId: 96014, runnerId: 'desktop:smoke', runtimeTarget: 'desktop', actions: [] }
    const first = await claimAs(db, 9001, base)
    assert.equal(first.status, 'claimed', JSON.stringify(first)); assert.deepEqual(first.actions, {}, 'không có thao tác để kiểm')
    const run = Number(first.targetRunId)
    const outcome = (extra = {}) => [{ resultKey: `v2:${run}:find`, actionCode: '', stepKey: 'find', ok: true, phase: 'after_send',
      statusCode: 'campaign_detail_success', customerLog: 'Tìm data trong group Nhóm 30', data: { uids: ['1001'] }, ...extra }]
    const noName = await reportAs(db, 9001, run, first.leaseToken, outcome(), true)
    assert.equal(noName.ok, false); assert.equal(noName.reason, 'action_unknown', 'thiếu tên ghi lịch sử')
    await db.query(`UPDATE public.auto_campaigns SET action_id = 'zalo_message_friend' WHERE id = 96014`)
    const zalo = await reportAs(db, 9001, run, first.leaseToken, outcome({ actionName: 'Tìm data' }), true)
    await db.query(`UPDATE public.auto_campaigns SET action_id = 'facebook_find_data_group' WHERE id = 96014`)
    assert.equal(zalo.ok, false); assert.equal(zalo.reason, 'action_unknown', 'chỉ chiến dịch Facebook')
    const ok = await reportAs(db, 9001, run, first.leaseToken, outcome({ actionName: 'Tìm data' }), true)
    assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(ok.target.status, 'hoàn thành'); assert.equal(ok.outcomes[0].actionCode, null)
    const row = await one(db, `SELECT action_code, action_name, status, log, counts_toward_limit, data FROM public.auto_campaign_details WHERE result_key = $1`,
      [`v2:${run}:find`])
    assert.deepEqual([row.action_code, row.action_name, row.status, row.log, row.counts_toward_limit],
      [null, 'Tìm data', 'thành công', 'Tìm data trong group Nhóm 30', false])
    assert.deepEqual(row.data.uids, ['1001'])
    const next = await claimAs(db, 9001, { ...base, leaseToken: first.leaseToken })
    assert.equal(next.status, 'claimed'); assert.equal(Number(next.target.id), 97031)
    const run2 = Number(next.targetRunId)
    const failed = await reportAs(db, 9001, run2, next.leaseToken, [{ resultKey: `v2:${run2}:find`, actionCode: '', actionName: 'Tìm data', stepKey: 'find',
      ok: false, phase: 'before_send', statusCode: 'campaign_detail_error',
      signal: { kind: 'engine', code: 'x', errorCode: 'err_undefined', message: 'Lỗi tìm data trong group Nhóm 31: hết giờ' } }], true)
    assert.equal(failed.ok, true, JSON.stringify(failed))
    const failRow = await one(db, `SELECT action_code, action_name, counts_toward_limit FROM public.auto_campaign_details WHERE result_key = $1`, [`v2:${run2}:find`])
    if (failRow) assert.deepEqual([failRow.action_code, failRow.action_name, failRow.counts_toward_limit], [null, 'Tìm data', false])
    assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.auto_account_action_status WHERE account_id = 95005`)).n, 0, 'không tính lượt')
    assert.equal((await releaseAs(db, 9001, 95005, next.leaseToken)).ok, true)
  })
  await check('simulate_v1 giải inherit như report_v1', async () => {
    const sim = (await one(db, `SELECT public.aka_agent_engine_simulate_v1('facebook_group_post', 'desktop', $1) AS r`, [JSON.stringify({
      actionCode: 'fb_comment', ok: false, phase: 'before_send', statusCode: 'campaign_detail_error',
      signal: { kind: 'block', code: 'err_comment_frequency_limit', errorCode: 'err_comment_frequency_limit' } })])).r
    assert.equal(sim.policy.detail_mode, 'write')
    assert.equal(Number(sim.policy.detail_status_id), 22)
    assert.equal(sim.policy.streak_after_delivery, 'ignore')
  })
  // Kết thúc lượt: giờ VN hiện tại quyết định khung kế / chạy lại có còn trong ngày. Gần nửa đêm thì bỏ qua (in NOTE).
  const vnMinute = (() => { const d = new Date(Date.now() + 7 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes() })()
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const finishAs = (lease) => asDesktop(db, 9001, () => one(db, 'SELECT public.aka_agent_engine_finish_campaign_v2(95001, $1, NULL) AS r', [lease]).then(r => r.r))
  const freshLease = () => db.query(`DELETE FROM public.auto_engine_leases WHERE account_id = 95001`)
  if (vnMinute > 22 * 60) {
    console.log('NOTE bỏ qua kiểm kết thúc lượt: quá 22:00 giờ VN, khung kế / chạy lại sang ngày mới')
  } else {
    await check('kết thúc lượt: trang cá nhân nhiều khung giờ, không có data → hẹn khung kế, không đặt lại gì', async () => {
      await freshLease()
      const slots = `${hhmm(Math.max(0, vnMinute - 5))}, ${hhmm(vnMinute + 30)}, ${hhmm(vnMinute + 60)}`
      const startVn = new Date(Date.now() - 5 * 60_000).toISOString()
      await insertRows(db, 'auto_campaigns', [{ id: 96033, name: 'Trang cá nhân nhiều khung', action_id: 'facebook_timeline_post', account_id: 95001,
        status: 'chờ xử lý', is_delete: false, staff_id: 9001, organization_id: 501, schedule: startVn, schedule_type: 'daily',
        extra_settings: { multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: slots } }])
      const claimed = await claimAs(db, 9001, ctx(96033, { mode: 'campaign_slot' }))
      assert.equal(claimed.status, 'claimed', JSON.stringify(claimed))
      const run = Number(claimed.targetRunId)
      await reportAs(db, 9001, run, claimed.leaseToken, [{ resultKey: `v2:${run}:post`, actionCode: 'fb_post_my_profile', stepKey: 'post', ok: true,
        phase: 'after_send' }], true)
      assert.equal((await claimAs(db, 9001, ctx(96033, { mode: 'campaign_slot', leaseToken: claimed.leaseToken }))).status, 'no_target')
      const fin = await finishAs(claimed.leaseToken)
      assert.equal(fin.reason, 'slot_advanced', JSON.stringify(fin))
      const camp = await one(db, `SELECT status, schedule FROM public.auto_campaigns WHERE id = 96033`)
      assert.equal(camp.status, 'chờ xử lý')
      assert.ok(new Date(camp.schedule) > new Date(), 'lịch là khung kế')
    })
    await check('kết thúc lượt: Page nhiều khung giờ mà không có data → hoàn thành ("không có page…")', async () => {
      await freshLease()
      const slots = `${hhmm(Math.max(0, vnMinute - 5))}, ${hhmm(vnMinute + 30)}`
      await insertRows(db, 'auto_campaigns', [{ id: 96015, name: 'Page nhiều khung', action_id: 'facebook_page_post', account_id: 95001,
        status: 'chờ xử lý', is_delete: false, staff_id: 9001, organization_id: 501, schedule: new Date(Date.now() - 5 * 60_000).toISOString(),
        schedule_type: 'daily', extra_settings: { multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: slots } }])
      const res = await claimAs(db, 9001, { ...ctx(96015), actions: [{ code: 'fb_post_page' }] })
      assert.equal(res.status, 'no_target', JSON.stringify(res))
      const fin = await finishAs(res.leaseToken)
      assert.equal(fin.reason, 'completed_no_rerun_page', JSON.stringify(fin))
    })
    await check('kết thúc lượt: comment seeding chạy lại sau 1 giờ, đặt lại data (trừ tạm dừng)', async () => {
      await freshLease()
      await insertRows(db, 'auto_campaigns', [{ id: 96034, name: 'Seeding chạy lại', action_id: 'facebook_comment_seeding', account_id: 95001,
        status: 'chờ xử lý', is_delete: false, staff_id: 9001, organization_id: 501, schedule: new Date(Date.now() - 60_000).toISOString(),
        schedule_type: 'daily', extra_settings: { findDataRerunEnabled: true, findDataRerunAfterHours: '1' } }])
      await insertRows(db, 'auto_campaign_input_data', [
        { id: 97014, campaign_id: 96034, status: 'hoàn thành', uid: 'p1', name: 'Bài 1', is_delete: false, note: 'xong' },
        { id: 97015, campaign_id: 96034, status: 'tạm dừng', uid: 'p2', name: 'Bài 2', is_delete: false }])
      const res = await claimAs(db, 9001, { ...ctx(96034), actions: [{ code: 'fb_comment' }] })
      assert.equal(res.status, 'no_target', JSON.stringify(res))
      const fin = await finishAs(res.leaseToken)
      if (vnMinute + 60 >= 23 * 60 + 59) { assert.equal(fin.reason, 'completed_rerun_after_cutoff'); return }
      assert.equal(fin.reason, 'rerun_scheduled', JSON.stringify(fin)); assert.equal(Number(fin.hours), 1)
      const rows = (await db.query(`SELECT id, status, note FROM public.auto_campaign_input_data WHERE campaign_id = 96034 ORDER BY id`)).rows
      assert.deepEqual(rows.map(x => [Number(x.id), x.status, x.note]), [[97014, 'chờ xử lý', ''], [97015, 'tạm dừng', null]])
    })
  }
  await check('gỡ V558 rồi apply lại (từ chối khi còn chính sách inherit)', async () => {
    await expectError(() => db.query(r555), /gỡ V559 .* trước/)
    await db.query('ROLLBACK').catch(() => {})
    await db.query(`UPDATE public.auto_outcome_policies SET is_active = false
      WHERE source = 'smoke' AND (detail_mode = 'inherit' OR streak_after_delivery IS NOT NULL)`)
    await db.query(r555)
    await expectError(() => db.query(r555), /hàm đã là bản trước V558/)
    await db.query('ROLLBACK').catch(() => {})
    await db.query(v558)
  })
}

async function main() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-engine-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    const notes = await buildFacebookFixture(db)
    for (const note of notes) console.log(`NOTE ${note}`)
    await compareLive(db)

    const p1 = readMigration('migration_v556_engine_facebook_p1.sql')
    const p2 = readMigration('migration_v556_engine_facebook_p2.sql')
    const r1 = readMigration('rollback_v556_engine_facebook_p1.sql')
    const r2 = readMigration('rollback_v556_engine_facebook_p2.sql')

    await check('V556 p2 từ chối khi chưa có p1', () => expectError(() => db.query(p2), /chưa chạy phần 1/))
    await db.query('ROLLBACK').catch(() => {})
    await check('V556 p1 apply', () => db.query(p1))
    await check('V556 p1 không apply lại', async () => { await expectError(() => db.query(p1), /bảng mới đã có/); await db.query('ROLLBACK').catch(() => {}) })
    await check('V556 p2 apply', () => db.query(p2))
    await check('V556 p2 không apply lại', async () => { await expectError(() => db.query(p2), /ràng buộc detail_mode khác|đã có/); await db.query('ROLLBACK').catch(() => {}) })
    const data = await seed(db)

    await check('engine.facebook: tắt / orgs / all / sai JSON', async () => {
      const q = org => one(db, 'SELECT public.aka_agent_engine_facebook_org_enabled($1) AS v', [org]).then(r => r.v)
      assert.equal(await q(501), false)
      await db.query(`UPDATE public.auto_system_settings SET value = '{"mode":"orgs","organizationIds":[501,"503"]}' WHERE key = 'engine.facebook'`)
      assert.equal(await q(501), true); assert.equal(await q(503), true); assert.equal(await q(502), false); assert.equal(await q(null), false)
      await db.query(`UPDATE public.auto_system_settings SET value = '{"mode":"all"}' WHERE key = 'engine.facebook'`)
      assert.equal(await q(502), true)
      await db.query(`UPDATE public.auto_system_settings SET value = '{mode: all' WHERE key = 'engine.facebook'`)
      assert.equal(await q(501), false)
      await db.query(`UPDATE public.auto_system_settings SET value = '{"mode":"orgs","organizationIds":[501]}', is_active = false WHERE key = 'engine.facebook'`)
      assert.equal(await q(501), false)
      await db.query(`UPDATE public.auto_system_settings SET is_active = true WHERE key = 'engine.facebook'`)
    })
    await check('Desktop đọc engine.facebook theo phiên', async () => {
      assert.equal(await asDesktop(db, 9001, () => one(db, 'SELECT public.aka_agent_engine_facebook_enabled_v1() AS v').then(r => r.v)), true)
      assert.equal(await asDesktop(db, 9002, () => one(db, 'SELECT public.aka_agent_engine_facebook_enabled_v1() AS v').then(r => r.v)), false)
      assert.equal(await asDesktop(db, null, () => one(db, 'SELECT public.aka_agent_engine_facebook_enabled_v1() AS v').then(r => r.v)), false)
      await expectError(() => asDesktop(db, 9001, () => db.query('SELECT public.aka_agent_engine_facebook_org_enabled(501)')), /permission denied/)
    })
    await check('Desktop đọc danh mục, không đọc bảng khác', async () => {
      await asDesktop(db, 9001, async () => {
        await db.query('SELECT * FROM public.auto_engine_block_steps')
        await db.query('SELECT * FROM public.auto_engine_workflows')
      })
      for (const t of ['auto_engine_block_copies', 'auto_desktop_diagnostic_requests', 'auto_desktop_diagnostic_files']) {
        await expectError(() => asDesktop(db, 9001, () => db.query(`SELECT 1 FROM public.${t}`)), /permission denied/)
      }
      await expectError(() => asDesktop(db, 9001, () => db.query(`INSERT INTO public.auto_engine_workflows (purpose, workflow_id) VALUES ('x_y', 1)`)), /permission denied/)
    })
    await check('trace_v1 trả lượt, kết quả, lượt workflow', async () => {
      const out = (await one(db, 'SELECT public.aka_agent_engine_trace_v1($1) AS r', [97001])).r
      assert.equal(out.ok, true); assert.equal(out.runs.length, 1)
      assert.equal(out.runs[0].outcomes[0].resultKey, data.resultKey)
      assert.equal(out.runs[0].workflowRuns[0].id, 77)
      assert.equal(out.runs[0].workflowRuns[0].steps[0].blockName, 'fb_click_post_button')
      assert.equal(out.runs[0].run.lease_token, undefined)
      assert.equal((await one(db, 'SELECT public.aka_agent_engine_trace_v1() AS r')).r.reason, 'invalid_request')
    })
    await check('health_v1 chạy, thấy chiến dịch đứng của tổ chức bật', async () => {
      await db.query(`UPDATE public.auto_campaigns SET schedule = now() - interval '2 hours' WHERE id = 96001`)
      await db.query(`UPDATE public.auto_engine_target_runs SET started_at = now() - interval '3 hours' WHERE id = $1`, [data.runId])
      const out = (await one(db, 'SELECT public.aka_agent_engine_health_v1(30) AS r')).r
      assert.equal(out.ok, true)
      assert.ok(out.stuckCampaigns.some(c => c.campaignId === 96001), 'phải thấy chiến dịch 96001')
      assert.ok(out.openRuns.some(r => r.targetRunId === data.runId), 'phải thấy lượt mở')
    })
    await check('ảnh lỗi: yêu cầu → presence → nhận → tải → xong → lấy về → dọn', async () => {
      const id = Number((await one(db, `SELECT public.aka_agent_desktop_diagnostic_request_v1(9001, '{"inputDataId":97001}', 'anh') AS id`)).id)
      await expectError(() => db.query(`SELECT public.aka_agent_desktop_diagnostic_request_v1(9001, '{"x":1}', 'anh')`), /khoá lạ/)
      const presence = (await one(db, `SELECT public.aka_agent_device_presence_v2('fbstaff', 'pw', gen_random_uuid(), '{}', false) AS r`)).r
      assert.deepEqual(presence, { ok: true, diagnostics: 1 })
      assert.deepEqual((await one(db, `SELECT public.aka_agent_device_presence_v2('fbstaff', 'sai', gen_random_uuid(), '{}', false) AS r`)).r,
        { ok: false, diagnostics: 0 })
      const next = await asDesktop(db, 9001, () => one(db, 'SELECT public.aka_agent_desktop_diagnostic_next_v1() AS r').then(r => r.r))
      assert.equal(next.requests.length, 1); assert.equal(next.requests[0].id, id)
      assert.equal((await asDesktop(db, 9002, () => one(db, 'SELECT public.aka_agent_desktop_diagnostic_next_v1() AS r').then(r => r.r))).requests.length, 0)
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString('base64')
      const upload = (staff, b64) => asDesktop(db, staff, () => one(db,
        `SELECT public.aka_agent_desktop_diagnostic_upload_v1($1, '33333333-3333-4333-8333-333333333333', '{"url":"https://facebook.com/x"}', $2) AS r`,
        [id, b64]).then(r => r.r))
      assert.equal((await upload(9001, jpeg)).ok, true)
      assert.equal((await upload(9001, Buffer.from('PNG nope').toString('base64'))).reason, 'invalid_image')
      assert.equal((await upload(9002, jpeg)).reason, 'not_found')
      assert.equal((await upload(9001, 'không phải base64!')).reason, 'invalid_request')
      const done = await asDesktop(db, 9001, () => one(db, `SELECT public.aka_agent_desktop_diagnostic_complete_v1($1, '{"status":"done","uploaded":1}') AS r`,
        [id]).then(r => r.r))
      assert.equal(done.status, 'done')
      const files = (await one(db, 'SELECT public.aka_agent_desktop_diagnostic_files_v1($1) AS r', [id])).r
      assert.equal(files.files.length, 1); assert.equal(Buffer.from(files.files[0].base64, 'base64').toString('base64'), jpeg)
      await expectError(() => asDesktop(db, 9001, () => db.query('SELECT public.aka_agent_desktop_diagnostic_files_v1(1)')), /permission denied/)
      await db.query(`UPDATE public.auto_desktop_diagnostic_requests SET created_at = now() - interval '8 days' WHERE id = $1`, [id])
      assert.ok((await one(db, 'SELECT public.aka_agent_desktop_diagnostic_cleanup_v1() AS n')).n >= 1)
      assert.equal((await one(db, 'SELECT count(*)::int AS n FROM public.auto_desktop_diagnostic_files')).n, 0)
    })
    await check('chính sách: detail_mode inherit và streak_after_delivery', async () => {
      await db.query('BEGIN')
      try {
        await db.query(`INSERT INTO public.auto_outcome_policies (error_code, action_code, detail_mode, streak_after_delivery, source)
          SELECT e.error_code, 'fb_comment', 'inherit', 'ignore', 'smoke' FROM public.auto_error e WHERE e.error_code = 'err_fb_comment_box_not_found'`)
        await expectError(() => db.query(`INSERT INTO public.auto_outcome_policies (error_class, detail_mode, source) VALUES ('transient', 'khác', 'smoke')`),
          /detail_mode_check/)
      } finally { await db.query('ROLLBACK') }
    })
    await check('quyền: anon / authenticated không gọi được hàm mới', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.query('BEGIN')
        try {
          await db.query(`SET LOCAL ROLE ${role}`)
          await expectError(() => db.query('SELECT public.aka_agent_engine_facebook_enabled_v1()'), /permission denied/)
        } finally { await db.query('ROLLBACK') }
      }
    })
    await check('gỡ p1 khi còn p2 bị từ chối; gỡ p2 rồi p1; apply lại', async () => {
      await expectError(() => db.query(r1), /gỡ phần 2 trước/)
      await db.query('ROLLBACK').catch(() => {})
      await db.query(r2)
      await db.query(r1)
      assert.equal((await one(db, `SELECT to_regclass('public.auto_engine_block_steps') AS t`)).t, null)
      assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.auto_system_settings WHERE key = 'engine.facebook'`)).n, 0)
      await db.query(p1)
      await db.query(p2)
    })
    await slotAndFunctionChecks(db)
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${passed} đạt, ${failed} lỗi`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })

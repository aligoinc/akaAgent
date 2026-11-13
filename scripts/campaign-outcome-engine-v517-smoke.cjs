// V517: job dọn bảng vận hành engine v2 (giữ engine.retention_days = 30 ngày) và decision gọn (bỏ chính sách đã gộp). Chạy trên
// PostgreSQL 17 cục bộ có đủ chuỗi V495 → … → V507 → V515 rồi V517; pg_cron giả (schema cron tối thiểu) để kiểm phần tạo / gỡ job.
//   1. V517 từ chối khi chưa có V515; apply trong transaction rồi ROLLBACK không đổi gì; apply thật: thân report_v1 / retention_v1 đúng
//      md5, thiết lập, chỉ mục, job, quyền (chỉ service_role); chạy lại bị chặn.
//   2. decision: trước V517 có policy; sau V517 chỉ result + contrib; gọi lại lần chốt (V515) vẫn trả đúng kết quả từ decision gọn.
//   3. Dọn: lượt đã đóng cũ hơn mốc bị xoá kèm kết quả và sự kiện (FK); lượt còn mở, lượt mới giữ nguyên; sự kiện không gắn lượt xoá theo
//      giờ ghi; giới hạn số lượt mỗi lần; thiết lập 60 / sai định dạng / 0 ngày.
//   4. Gỡ V517 trả report_v1 về V515, bỏ hàm / thiết lập / chỉ mục / job; apply lại được.
// Không mạng, không dữ liệu khách. Chạy: node scripts/campaign-outcome-engine-v517-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const v503 = require('./build-v503-sql.cjs')
const v504 = require('./build-v504-sql.cjs')
const v505 = require('./build-v505-sql.cjs')
const v506 = require('./build-v506-sql.cjs')
const v507 = require('./build-v507-sql.cjs')
const v515 = require('./build-v515-sql.cjs')
const v517 = require('./build-v517-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V517_TEST_PORT || 55517)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v517-' })
  const db = await connect()
  try {
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v517.NAME}.sql`), 'utf8'), v517.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v517.ROLLBACK_NAME}.sql`), 'utf8'), v517.rollback, 'file rollback = bản sinh')
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const m of [v501, v503, v504, v505, v506, v507]) await db.query(m.migration)
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rpc = async (fn, ...args) =>
      (await db.query(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS r`, args)).rows[0].r
    const md5Of = async sig => (await val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)`, [sig])) ?? null

    // ---- 1. Thứ tự apply, apply thử, apply thật ------------------------------------------------------------------------------
    await assert.rejects(db.query(v517.migration), /apply V515 trước/)
    await db.query('ROLLBACK')
    await db.query(v515.migration)
    assert.equal(await md5Of(v517.SIG.report), v517.LIVE.report)
    pass('V517 từ chối khi report_v1 chưa là bản V515 (phải apply V515 trước)')

    // Chiến dịch "Nhắn tin theo SĐT" trên tài khoản QR (Desktop), một data đi tra số → nhắn tin.
    let nextId = 950000
    const STAFF = 9717, ORG = 717
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    const makeCampaign = async (targets = 1) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      const extra = { enableMessage: true,
        actionLimits: { byActionCode: { zalo_message_stranger: { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 } } } }
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content,
        extra_settings, images) OVERRIDING SYSTEM VALUE VALUES ($1, 'V517', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false,
        $3, $4, 'Chào #{FULL_NAME}', $5::jsonb, '[]'::jsonb)`, [campaign, account, STAFF, ORG, JSON.stringify(extra)])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Khách ${i + 1}`, `0909${String(id).slice(-6)}`])
        ids.push(id)
      }
      return { account, campaign, ids, lease: null }
    }
    const ctx = c => JSON.stringify({ staffId: STAFF, accountId: c.account, campaignId: c.campaign, runnerId: 'desktop:v517',
      runtimeTarget: 'desktop', leaseToken: c.lease, actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }] })
    let rk = 0
    const out = actionCode => ({ resultKey: `v517-smoke:${++rk}:${actionCode}`, actionCode, ok: true, phase: 'after_send' })
    // Một data: claim → tra số → ghi dấu → nhắn tin (chốt). Trả lượt và kết quả cuối để kiểm gọi lại.
    const runOne = async c => {
      const cl = await rpc('aka_agent_engine_claim_target_v1', ctx(c))
      assert.equal(cl.status, 'claimed', JSON.stringify(cl))
      c.lease = cl.leaseToken
      assert.equal((await rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken, JSON.stringify([out('zalo_find_phone_user')]), false, false)).next, 'next_step')
      assert.equal((await rpc('aka_agent_engine_mark_sending_v1', cl.targetRunId, cl.leaseToken, 'zalo_message_stranger', 'message')).ok, true)
      const last = out('zalo_message_stranger')
      const res = await rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken, JSON.stringify([last]), true, false)
      assert.equal(res.target.done, true)
      return { cl, last, res }
    }
    const decisionKeys = async runId => (await db.query(`SELECT DISTINCT k FROM public.auto_engine_outcomes o, jsonb_object_keys(o.decision) k
      WHERE o.target_run_id = $1 ORDER BY k`, [runId])).rows.map(x => x.k)

    const cA = await makeCampaign()
    const a = await runOne(cA)
    assert.deepEqual(await decisionKeys(a.cl.targetRunId), ['contrib', 'policy', 'result'])
    pass('trước V517: mỗi dòng kết quả lưu cả chính sách đã gộp (decision có policy)')

    // pg_cron giả: đủ cron.job + cron.schedule(text,text,text) + cron.unschedule(bigint) như pg_cron 1.6.
    await db.query(`CREATE SCHEMA cron;
      CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true);
      CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
        ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
      CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = job_id RETURNING true $$;`)

    const state = async () => ({
      report: await md5Of(v517.SIG.report),
      retention: await md5Of(v517.SIG.retention),
      setting: await val(`SELECT count(*)::int FROM public.auto_system_settings WHERE key = $1`, [v517.SETTING]),
      index: await val(`SELECT to_regclass($1)::text`, [`public.${v517.INDEX}`]),
      job: await val(`SELECT count(*)::int FROM cron.job WHERE jobname = $1`, [v517.JOB])
    })
    const s0 = await state()
    await db.query(v517.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.deepEqual(await state(), s0, 'apply trong transaction rồi ROLLBACK không để lại gì')
    await db.query(v517.migration)
    assert.deepEqual(await state(), { report: v517.NEW.report, retention: v517.NEW.retention, setting: 1, index: v517.INDEX, job: 1 })
    assert.equal(await val(`SELECT value FROM public.auto_system_settings WHERE key = $1`, [v517.SETTING]), '30')
    assert.deepEqual((await db.query(`SELECT schedule, command, active FROM cron.job WHERE jobname = $1`, [v517.JOB])).rows[0],
      { schedule: '23 * * * *', command: 'SELECT public.aka_agent_engine_retention_v1()', active: true })
    for (const [role, expected] of [['anon', false], ['authenticated', false], ['aka_agent_chat_api', false], ['aka_agent_desktop', false], ['service_role', true]]) {
      assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, v517.SIG.retention]), expected, `quyền retention của ${role}`)
    }
    for (const role of ['aka_agent_chat_api', 'aka_agent_desktop', 'service_role']) {
      assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, v517.SIG.report]), true, `report_v1 vẫn gọi được bởi ${role}`)
    }
    await assert.rejects(db.query(v517.migration), /V517 đã chạy/)
    await db.query('ROLLBACK')
    pass('apply thử rồi ROLLBACK không đổi gì; apply thật: thân hàm đúng md5, thiết lập 30, chỉ mục, job "23 * * * *", chỉ service_role gọi dọn; chạy lại bị chặn')

    // ---- 2. decision gọn, gọi lại lần chốt vẫn đúng ---------------------------------------------------------------------------
    const cB = await makeCampaign()
    const b = await runOne(cB)
    assert.deepEqual(await decisionKeys(b.cl.targetRunId), ['contrib', 'result'])
    const replay = await rpc('aka_agent_engine_report_v1', b.cl.targetRunId, b.cl.leaseToken, JSON.stringify([b.last]), true, false)
    assert.equal(replay.replay, true)
    assert.equal(replay.next, b.res.next)
    assert.deepEqual(replay.outcomes.map(o => [o.resultKey, o.statusCode, o.deliveryState, o.replay]),
      b.res.outcomes.map(o => [o.resultKey, o.statusCode, o.deliveryState, true]))
    const avg = await val(`SELECT round(avg(pg_column_size(decision)))::int FROM public.auto_engine_outcomes WHERE target_run_id = $1`, [b.cl.targetRunId])
    const avgOld = await val(`SELECT round(avg(pg_column_size(decision)))::int FROM public.auto_engine_outcomes WHERE target_run_id = $1`, [a.cl.targetRunId])
    assert.ok(avg < avgOld, `decision gọn hơn (${avg} < ${avgOld} byte)`)
    pass(`sau V517 decision chỉ còn result + contrib (${avgOld} → ${avg} byte/dòng ở mẫu này); gọi lại lần chốt (V515) vẫn trả đúng kết quả`)

    // ---- 3. Dọn ------------------------------------------------------------------------------------------------------------------
    const days = n => `now() - interval '${n} days'`
    const run = async ({ startedDays, open = false, outcomes = 1, events = 0 }) => {
      const input = ++nextId
      const id = await val(`INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, lease_token, runner_id, runtime_target,
          started_at, completed_at, outcome_count)
        VALUES ($1, $2, $3, gen_random_uuid(), 'desktop:v517', 'desktop', ${days(startedDays)}, ${open ? 'NULL' : days(startedDays)}, $4) RETURNING id`,
      [input, cA.campaign, cA.account, outcomes])
      for (let i = 0; i < outcomes; i++) {
        await db.query(`INSERT INTO public.auto_engine_outcomes (result_key, target_run_id, input_data_id, campaign_id, account_id, action_code, phase, ok,
            delivery_state, decision, created_at)
          VALUES ($1, $2, $3, $4, $5, 'zalo_message_stranger', 'after_send', true, 'delivered', '{"result":{}}'::jsonb, ${days(startedDays)})`,
        [`v517-old:${id}:${i}`, id, input, cA.campaign, cA.account])
      }
      for (let i = 0; i < events; i++) {
        await db.query(`INSERT INTO public.auto_engine_target_events (input_data_id, campaign_id, target_run_id, kind, message, created_at)
          VALUES ($1, $2, $3, 'wait', 'chờ', ${days(startedDays)})`, [input, cA.campaign, id])
      }
      return Number(id)
    }
    const looseEvent = async d => Number(await val(`INSERT INTO public.auto_engine_target_events (input_data_id, campaign_id, target_run_id, kind, message, created_at)
      VALUES ($1, $2, NULL, 'wait', 'chờ trước khi nhận data', ${days(d)}) RETURNING id`, [++nextId, cA.campaign]))
    const exists = async (table, id) => Number(await val(`SELECT count(*) FROM public.${table} WHERE id = $1`, [id])) === 1
    const outcomesOf = async runId => Number(await val(`SELECT count(*) FROM public.auto_engine_outcomes WHERE target_run_id = $1`, [runId]))
    const eventsOf = async runId => Number(await val(`SELECT count(*) FROM public.auto_engine_target_events WHERE target_run_id = $1`, [runId]))

    const old45 = await run({ startedDays: 45, outcomes: 3, events: 1 })
    await db.query(`UPDATE public.auto_engine_target_runs SET started_at = ${days(40)} WHERE id = $1`, [a.cl.targetRunId])
    const old35 = await run({ startedDays: 35, outcomes: 2 })
    const oldOpen = await run({ startedDays: 50, open: true, outcomes: 1 })
    const recent = await run({ startedDays: 5, outcomes: 1, events: 1 })
    const looseOld = await looseEvent(40), looseNew = await looseEvent(1)
    const outcomesA = await outcomesOf(a.cl.targetRunId)
    assert.ok(outcomesA >= 2)

    const r1 = await rpc('aka_agent_engine_retention_v1', 2, 20000)
    assert.deepEqual([r1.retentionDays, r1.runs, r1.outcomes, r1.events, r1.stoppedEarly], [30, 2, 3 + outcomesA, 1, true])
    assert.equal(await exists('auto_engine_target_runs', old45), false)
    assert.equal(await exists('auto_engine_target_runs', a.cl.targetRunId), false)
    assert.equal(await outcomesOf(old45) + await outcomesOf(a.cl.targetRunId) + await eventsOf(old45), 0, 'kết quả và sự kiện của lượt đi theo lượt (FK)')
    assert.equal(await exists('auto_engine_target_runs', old35), true, 'giới hạn 2 lượt mỗi lần: lượt 35 ngày chờ lần sau')
    assert.equal(await exists('auto_engine_target_events', looseOld), false)
    const r2 = await rpc('aka_agent_engine_retention_v1')
    assert.deepEqual([r2.runs, r2.outcomes, r2.events, r2.stoppedEarly], [1, 2, 0, false])
    assert.equal(await exists('auto_engine_target_runs', old35), false)
    assert.equal(await exists('auto_engine_target_runs', oldOpen), true, 'lượt còn mở không bao giờ bị xoá')
    assert.equal(await outcomesOf(oldOpen), 1)
    for (const id of [recent, b.cl.targetRunId]) assert.equal(await exists('auto_engine_target_runs', id), true)
    assert.equal(await eventsOf(recent), 1)
    assert.equal(await exists('auto_engine_target_events', looseNew), true)
    assert.equal((await rpc('aka_agent_engine_retention_v1')).runs, 0, 'không còn gì để dọn')
    pass('dọn lượt đã đóng cũ hơn 30 ngày kèm kết quả và sự kiện; giới hạn số lượt mỗi lần; lượt còn mở, lượt mới, sự kiện mới giữ nguyên')

    const setDays = v => db.query(`UPDATE public.auto_system_settings SET value = $2 WHERE key = $1`, [v517.SETTING, v])
    const old40 = await run({ startedDays: 40 })
    await setDays('60')
    let rr = await rpc('aka_agent_engine_retention_v1')
    assert.deepEqual([rr.retentionDays, rr.runs], [60, 0])
    await setDays('abc')
    rr = await rpc('aka_agent_engine_retention_v1')
    assert.deepEqual([rr.retentionDays, rr.runs], [30, 1])
    assert.equal(await exists('auto_engine_target_runs', old40), false)
    await setDays('0')
    rr = await rpc('aka_agent_engine_retention_v1', 20000, 0)
    assert.deepEqual([rr.retentionDays, rr.runs], [1, 1], 'thiết lập 0 ⇒ 1 ngày; hạn giờ 0 ⇒ 100 ms vẫn chạy')
    assert.equal(await exists('auto_engine_target_runs', recent), false)
    assert.equal(await exists('auto_engine_target_runs', b.cl.targetRunId), true)
    await setDays('30')
    pass('thiết lập 60 ngày giữ lượt 40 ngày; sai định dạng ⇒ 30; 0 ⇒ 1 ngày; hạn giờ quá nhỏ vẫn chạy tối thiểu 100 ms')

    // ---- 4. Gỡ rồi apply lại -------------------------------------------------------------------------------------------------------
    await db.query(v517.rollback)
    assert.deepEqual(await state(), { report: v515.NEW.report, retention: null, setting: 0, index: null, job: 0 })
    const cC = await makeCampaign()
    const c = await runOne(cC)
    assert.deepEqual(await decisionKeys(c.cl.targetRunId), ['contrib', 'policy', 'result'], 'gỡ xong report_v1 lại là bản V515')
    await assert.rejects(db.query(v517.rollback), /chưa có V517/)
    await db.query('ROLLBACK')
    await db.query(v517.migration)
    assert.deepEqual(await state(), { report: v517.NEW.report, retention: v517.NEW.retention, setting: 1, index: v517.INDEX, job: 1 })
    pass('gỡ V517 trả report_v1 về bản V515, bỏ hàm / thiết lập / chỉ mục / job; gỡ lần hai bị chặn; apply lại được')

    console.log(`V517 smoke: ${checks}/${checks} nhóm đạt`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })

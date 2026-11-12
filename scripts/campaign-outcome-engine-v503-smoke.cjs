// V503: gửi dạng chia sẻ (nhận cả lô, báo cả lô) của engine v2. Kiểm trên PostgreSQL 17 cục bộ dùng một lần
// (fixture như campaign-outcome-engine-sql-smoke.cjs, rồi V495 → V499 → V500 → V501 → V503). Không mạng, không dữ liệu khách.
// Chạy: node scripts/campaign-outcome-engine-v503-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const v503 = require('./build-v503-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V503_TEST_PORT || 55502)

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v503-' })
  const db = await connect()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
  const rpc = async (fn, ...args) => val(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)
  try {
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    await db.query(v501.migration)

    // ---- 1. Apply ---------------------------------------------------------------------------------
    const md5Of = sig => val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)`, [sig])
    const CLAIM = 'public.aka_agent_engine_claim_target_v1(jsonb)'
    const REPORT = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'
    const CLAIM_BATCH = 'public.aka_agent_engine_claim_batch_v1(jsonb)'
    const REPORT_BATCH = 'public.aka_agent_engine_report_batch_v1(uuid,jsonb,integer,boolean)'
    assert.equal(await md5Of(CLAIM), v503.LIVE.claim); assert.equal(await md5Of(REPORT), v503.LIVE.report)
    await db.query(v503.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await md5Of(CLAIM), v503.LIVE.claim)
    assert.equal(await val(`SELECT to_regprocedure($1)`, [CLAIM_BATCH]), null)
    await db.query(v503.migration)
    assert.equal(await md5Of(CLAIM), v503.NEW.claim); assert.equal(await md5Of(REPORT), v503.NEW.report)
    assert.equal(await md5Of(CLAIM_BATCH), v503.NEW.claimBatch); assert.equal(await md5Of(REPORT_BATCH), v503.NEW.reportBatch)
    await assert.rejects(db.query(v503.migration), /đã có/)
    await db.query('ROLLBACK')
    const priv = (role, fn) => val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, fn])
    for (const fn of [CLAIM_BATCH, REPORT_BATCH]) {
      for (const role of ['anon', 'authenticated']) assert.equal(await priv(role, fn), false, `${role} ${fn}`)
      for (const role of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) assert.equal(await priv(role, fn), true, `${role} ${fn}`)
    }
    pass('apply trong transaction rồi ROLLBACK không để lại gì; apply thật; apply lần hai bị chặn; quyền hàm mới như các RPC engine khác')

    // ---- Dữ liệu thử ------------------------------------------------------------------------------
    // Mã thử: chỉ khoá thao tác (ưu tiên 1), tạm dừng chiến dịch (ưu tiên 2), lỗi thường không hiệu ứng phụ (cộng chuỗi, không ngưỡng).
    const codes = [['err_test_lock_v503', 'TST11'], ['err_test_pause_v503', 'TST12'], ['err_test_plain_v503', 'TST13'], ['err_test_requeue_v503', 'TST14']]
    for (const [code, pub] of codes) {
      await db.query(`INSERT INTO public.auto_error SELECT (jsonb_populate_record(NULL::public.auto_error,
          to_jsonb(e) || jsonb_build_object('id', (SELECT max(id) + 1 FROM public.auto_error), 'error_code', $1::text, 'public_code', $2::text, 'error_class', 'transient'))).*
        FROM public.auto_error e WHERE e.error_code = 'err_engine_unknown_delivery'`, [code, pub])
    }
    await db.query(`SELECT setval('auto_error_id_seq', (SELECT max(id) FROM public.auto_error))`)
    const failedId = await val(`SELECT id FROM public.auto_status WHERE code = 'campaign_detail_failed' AND component_type = 'campaign_detail' ORDER BY id LIMIT 1`)
    await db.query(`INSERT INTO public.auto_outcome_policies (error_code, detail_mode, detail_status_id, log_template, quota_effect, target_streak_effect, target_effect,
        remaining_steps, lock_action_codes, lock_mode, lock_minutes, run_effect, pace_mode, campaign_effect, account_effect, login_effect, source, description)
      VALUES ('err_test_lock_v503', 'write', $1, 'Khoá thử', 'no_count', 'increment', 'complete', 'skip', '{zalo_message_friend}', 'fixed_minutes', 30, 'end_unit', 'none', 'none', 'none', 'none', 'test', 'test'),
             ('err_test_pause_v503', 'write', $1, 'Tạm dừng thử', 'no_count', 'increment', 'complete', 'skip', '{}', NULL, NULL, 'stop_campaign', 'none', 'pause', 'none', 'none', 'test', 'test'),
             ('err_test_plain_v503', 'write', $1, 'Lỗi thử', 'count', 'increment', 'complete', 'skip', '{}', NULL, NULL, 'continue', 'none', 'none', 'none', 'none', 'test', 'test'),
             ('err_test_requeue_v503', 'suppress', $1, 'Về hàng đợi thử', 'no_count', 'increment', 'requeue', 'skip', '{zalo_message_friend}', 'fixed_minutes', 30, 'end_unit', 'none', 'none', 'none', 'none', 'test', 'test')`,
      [failedId])

    let nextId = 920000
    const makeCampaign = async ({ action = 'zalo_message_friend', targets = 5, extra = {}, staff = 7301, org = 701 } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo thử', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, true, false)`, [account, staff, org])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, schedule_type, continue_next_day, provisioning_state,
          data_target_source_mode, extra_settings, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Chia sẻ thử', $2, $3, 'chờ xử lý', now() - interval '1 minute', 'daily', true, 'ready', 'direct', $4::jsonb, false, $5, $6)`,
        [campaign, action, account, JSON.stringify({ zaloMessageSendMode: 'share', ...extra }), staff, org])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, status, is_delete)
          OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Bạn ${i + 1}`, String(8800000000 + id)])
        ids.push(id)
      }
      return { account, campaign, staff, ids, action, lease: null }
    }
    const ctx = (c, extra = {}) => JSON.stringify({ staffId: c.staff, accountId: c.account, campaignId: c.campaign, runnerId: 'fly:v503',
      runtimeTarget: 'fly', leaseToken: c.lease ?? null, actions: [{ code: c.action }], maxTargets: 50, ...extra })
    const claimBatch = async (c, extra) => { const res = await rpc('aka_agent_engine_claim_batch_v1', ctx(c, extra)); if (res.leaseToken) c.lease = res.leaseToken; return res }
    let rk = 0
    const okOutcome = c => ({ resultKey: `v503-smoke:${++rk}`, actionCode: c.action, stepKey: 'share', ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' })
    const failOutcome = (c, errorCode, extra = {}) => ({ resultKey: `v503-smoke:${++rk}`, actionCode: c.action, stepKey: 'share', ok: false, phase: 'after_send',
      signal: { kind: 'engine', code: 'test', errorCode, message: 'thử' }, ...extra })
    const reportBatch = (c, items, size = null) => rpc('aka_agent_engine_report_batch_v1', c.lease, JSON.stringify(items), size)
    const camp = c => one(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [c.campaign])
    const rowOf = id => one(`SELECT status, note FROM public.auto_campaign_input_data WHERE id = $1`, [id])
    const lockOf = c => val(`SELECT count(*)::int FROM public.auto_account_action_status WHERE account_id = $1 AND is_disable`, [c.account])
    const streakOf = c => val(`SELECT coalesce(max(count_consecutive_bad_targets), 0)::int FROM public.auto_campaign_error_state WHERE campaign_id = $1`, [c.campaign])
    const detailsOf = c => db.query(`SELECT input_data_id, status, log, error_code FROM public.auto_campaign_details WHERE campaign_id = $1 ORDER BY id`, [c.campaign]).then(r => r.rows)

    // ---- 2. Nhận cả lô ----------------------------------------------------------------------------
    const big = await makeCampaign({ targets: 12, extra: { actionLimits: { byActionCode: { zalo_message_friend: { dailyLimit: 100, rateLimitCount: 4, rateLimitMinutes: 60 } } } } })
    const b1 = await claimBatch(big)
    assert.equal(b1.status, 'claimed')
    assert.equal(b1.capacity, 4); assert.equal(b1.items.length, 4, 'lô tự giới hạn theo lượt còn lại trong khung giờ')
    assert.deepEqual(b1.items.map(i => i.target.id), big.ids.slice(0, 4), 'nhận theo thứ tự id như Desktop')
    assert.equal(new Set(b1.items.map(i => i.targetRunId)).size, 4)
    for (const id of big.ids.slice(0, 4)) assert.equal((await rowOf(id)).status, 'đang chạy')
    assert.equal((await rowOf(big.ids[4])).status, 'chờ xử lý')
    assert.equal((await camp(big)).status, 'đang chạy')
    assert.ok(b1.items.every(i => i.actions?.zalo_message_friend?.decision === 'allow'))
    pass('nhận cả lô: tối đa lượt còn lại trong khung giờ (4/12), đúng thứ tự, mỗi data một lượt chạy riêng, data "đang chạy"')

    const daily = await makeCampaign({ targets: 8, extra: { actionLimits: { byActionCode: { zalo_message_friend: { dailyLimit: 3, rateLimitCount: 50, rateLimitMinutes: 60 } } } } })
    await db.query(`INSERT INTO public.auto_account_action_status (account_id, action_code, count_action_in_day, count_date)
      VALUES ($1, 'zalo_message_friend', 1, (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)`, [daily.account])
    const d1 = await claimBatch(daily)
    assert.equal(d1.items.length, 2, 'đã dùng 1/3 lượt trong ngày → lô 2')
    const def = await makeCampaign({ targets: 12 })
    assert.equal((await claimBatch(def)).items.length, 9, 'mặc định 9 lượt / 65 phút như Desktop')
    const empty = await makeCampaign({ targets: 0 })
    const e1 = await claimBatch(empty)
    assert.equal(e1.status, 'no_target', 'lần nhận đầu không được: trả nguyên phản hồi của claim_target_v1')
    assert.equal(e1.items, undefined)
    const capped = await makeCampaign({ targets: 6 })
    assert.equal((await claimBatch(capped, { maxTargets: 2 })).items.length, 2)
    pass('lô theo lượt còn lại trong ngày; mặc định 9 như Desktop; maxTargets; không có data thì trả nguyên no_target')

    await db.query(`INSERT INTO public.auto_system_settings (key, value, is_active) VALUES ('engine.batch_claim_ms', '100', true)`)
    await db.query(`CREATE FUNCTION pg_temp.slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.06); RETURN NEW; END $$`)
    await db.query(`CREATE TRIGGER slow_claim BEFORE INSERT ON public.auto_engine_target_runs FOR EACH ROW EXECUTE FUNCTION pg_temp.slow()`)
    const slow = await makeCampaign({ targets: 9 })
    const s1 = await claimBatch(slow)
    assert.ok(s1.items.length >= 1 && s1.items.length <= 3, `mốc thời gian chung dừng lô sớm (${s1.items.length})`)
    await db.query(`DROP TRIGGER slow_claim ON public.auto_engine_target_runs`)
    await db.query(`DELETE FROM public.auto_system_settings WHERE key = 'engine.batch_claim_ms'`)
    assert.equal(await val(`SELECT current_setting('aka.engine.claim_deadline', true)`), '', 'không để lại mốc của lô sau lời gọi')
    const s2 = await claimBatch(slow)
    assert.equal(s2.items.length, 9 - s1.items.length, 'lô sau cùng lease nhận tiếp các data còn lại')
    pass('cả lô dừng ở mốc thời gian chung (engine.batch_claim_ms); lô sau cùng lease nhận tiếp, không nhận lại data đã nhận')

    // ---- 3. Báo cả lô -----------------------------------------------------------------------------
    // 3a. Lô có người nhận được: lỗi của người khác chỉ ghi cho người đó (không khoá, không tạm dừng, không cộng chuỗi).
    const mixed = await makeCampaign({ targets: 3 })
    const m = await claimBatch(mixed)
    const mr = await reportBatch(mixed, [
      { targetRunId: m.items[0].targetRunId, outcomes: [okOutcome(mixed)] },
      { targetRunId: m.items[1].targetRunId, outcomes: [failOutcome(mixed, 'err_test_pause_v503')] },
      { targetRunId: m.items[2].targetRunId, outcomes: [failOutcome(mixed, 'err_test_lock_v503')] }
    ], 3)
    assert.equal(mr.ok, true); assert.equal(mr.next, 'next_target')
    assert.deepEqual(mr.items.map(i => i.scope), ['target_only', 'target_only', 'target_only'])
    assert.equal(mr.summary.succeeded, 1); assert.equal(mr.summary.paused, false)
    assert.equal((await camp(mixed)).status, 'đang chạy', 'không tạm dừng chiến dịch')
    assert.equal(await lockOf(mixed), 0, 'không khoá thao tác')
    assert.equal(await streakOf(mixed), 0, 'không cộng chuỗi data lỗi')
    const md = await detailsOf(mixed)
    assert.deepEqual(md.map(d => d.status), ['thành công', 'thất bại', 'thất bại'], 'vẫn ghi lịch sử từng người')
    assert.equal((await rowOf(mixed.ids[1])).status, 'hoàn thành')
    pass('lô có người nhận được: lỗi của người khác target_only (ghi lịch sử, không khoá, không tạm dừng, không cộng chuỗi)')

    // 3b. Không ai nhận được: người có hiệu ứng mạnh nhất áp đủ chính sách, người khác batch_followup.
    const allFail = await makeCampaign({ targets: 3 })
    const a = await claimBatch(allFail)
    const ar = await reportBatch(allFail, [
      { targetRunId: a.items[0].targetRunId, outcomes: [failOutcome(allFail, 'err_test_lock_v503')] },
      { targetRunId: a.items[1].targetRunId, outcomes: [failOutcome(allFail, 'err_test_pause_v503')] },
      { targetRunId: a.items[2].targetRunId, outcomes: [failOutcome(allFail, 'err_test_lock_v503')] }
    ], 3)
    assert.deepEqual(ar.items.map(i => i.scope), ['batch_followup', 'full', 'batch_followup'])
    assert.equal(ar.next, 'stop_campaign')
    assert.equal((await camp(allFail)).status, 'tạm dừng', 'chính sách của người mạnh nhất tạm dừng chiến dịch')
    assert.doesNotMatch((await camp(allFail)).note ?? '', /Toàn bộ/, 'đã dừng theo chính sách thì không thêm câu "toàn bộ thất bại"')
    assert.equal(await lockOf(allFail), 0, 'khoá của người batch_followup không áp')
    assert.equal(await streakOf(allFail), 3, 'batch_followup vẫn theo chuỗi data lỗi')
    pass('không ai nhận được: chọn người có hiệu ứng mạnh nhất (tạm dừng 2 > khoá 1) áp đủ; người khác bỏ hiệu ứng phụ, vẫn cộng chuỗi')

    const allLock = await makeCampaign({ targets: 2 })
    const l = await claimBatch(allLock)
    const lr = await reportBatch(allLock, [
      { targetRunId: l.items[0].targetRunId, outcomes: [failOutcome(allLock, 'err_test_plain_v503')] },
      { targetRunId: l.items[1].targetRunId, outcomes: [failOutcome(allLock, 'err_test_lock_v503')] }
    ], 2)
    assert.deepEqual(lr.items.map(i => i.scope), ['batch_followup', 'full'])
    assert.equal(await lockOf(allLock), 1, 'khoá của người mạnh nhất có áp')
    assert.equal(lr.next, 'stop_campaign')
    assert.equal(lr.summary.paused, true)
    const ln = await camp(allLock)
    assert.equal(ln.status, 'tạm dừng')
    assert.equal(ln.note, 'Toàn bộ 2 target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra')
    assert.equal(lr.stopNote, ln.note)
    pass('không ai nhận được và chỉ khoá (không dừng chiến dịch): tạm dừng chiến dịch đúng câu Desktop, khoá của người mạnh nhất vẫn áp')

    const plain = await makeCampaign({ targets: 2 })
    const p = await claimBatch(plain)
    await reportBatch(plain, [
      { targetRunId: p.items[0].targetRunId, outcomes: [failOutcome(plain, 'err_test_plain_v503')] },
      { targetRunId: p.items[1].targetRunId, outcomes: [failOutcome(plain, 'err_test_plain_v503')] }
    ], 5)
    assert.equal((await camp(plain)).note, 'Toàn bộ 5 target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra', 'số trong câu = cỡ lô (kể cả data đã báo riêng)')
    pass('câu tạm dừng dùng cỡ lô do nơi chạy truyền (kể cả data quá giờ đã báo riêng)')

    const stopped = await makeCampaign({ targets: 2 })
    const st = await claimBatch(stopped)
    const sr = await rpc('aka_agent_engine_report_batch_v1', stopped.lease, JSON.stringify([
      { targetRunId: st.items[0].targetRunId, outcomes: [failOutcome(stopped, 'err_test_pause_v503')] },
      { targetRunId: st.items[1].targetRunId, outcomes: [failOutcome(stopped, 'err_test_lock_v503')] }
    ]), 3, true)
    assert.deepEqual(sr.items.map(i => i.scope), ['batch_followup', 'batch_followup'], 'đã dừng khi gửi tệp: không ai áp thêm chính sách')
    assert.equal((await camp(stopped)).status, 'đang chạy', 'không tạm dừng "toàn bộ thất bại"')
    assert.equal(await lockOf(stopped), 0)
    assert.equal(sr.next, 'next_target')
    pass('lô đã dừng khi gửi tệp (p_already_stopped): mọi lỗi batch_followup, không tạm dừng thêm, không khoá thêm')

    // 3c. Giao một phần (đã nhận media) tính là đã nhận được.
    const part = await makeCampaign({ targets: 2 })
    const pt = await claimBatch(part)
    const pr = await reportBatch(part, [
      { targetRunId: pt.items[0].targetRunId, outcomes: [failOutcome(part, 'err_test_plain_v503', { evidence: { partialDelivery: true, partialStage: 'content_after_media' } })] },
      { targetRunId: pt.items[1].targetRunId, outcomes: [failOutcome(part, 'err_test_pause_v503')] }
    ], 2)
    assert.deepEqual(pr.items.map(i => i.scope), ['target_only', 'target_only'])
    assert.equal((await camp(part)).status, 'đang chạy')
    const pd = await detailsOf(part)
    assert.match(pd[0].log, /^Đã gửi file nhưng gửi nội dung thất bại\. /)
    pass('giao một phần (đã nhận media, chữ lỗi) tính là đã nhận được: lỗi của người khác target_only; dòng một phần đúng tiền tố Desktop')

    // 3d. Data về hàng đợi theo chính sách vẫn về hàng đợi (target_only chỉ bỏ hiệu ứng phụ).
    const rq = await makeCampaign({ targets: 2 })
    const q = await claimBatch(rq)
    await reportBatch(rq, [
      { targetRunId: q.items[0].targetRunId, outcomes: [okOutcome(rq)] },
      { targetRunId: q.items[1].targetRunId, outcomes: [failOutcome(rq, 'err_test_requeue_v503')] }
    ], 2)
    assert.equal((await rowOf(rq.ids[1])).status, 'chờ xử lý', 'lỗi do tài khoản / mạng không đốt data (bảng đã duyệt)')
    assert.equal(await lockOf(rq), 0)
    pass('target_only giữ nơi đến của data theo chính sách (về hàng đợi), chỉ bỏ khoá / dừng')

    // 3e. Từ chối: lease sai, mục trùng, một mục bị report_v1 từ chối thì hoàn tác cả lô.
    const rej = await makeCampaign({ targets: 2 })
    const j = await claimBatch(rej)
    assert.equal((await rpc('aka_agent_engine_report_batch_v1', '00000000-0000-0000-0000-000000000000',
      JSON.stringify([{ targetRunId: j.items[0].targetRunId, outcomes: [okOutcome(rej)] }]), null)).reason, 'lease_token_mismatch')
    assert.equal((await reportBatch(rej, [{ targetRunId: j.items[0].targetRunId, outcomes: [okOutcome(rej)] },
      { targetRunId: j.items[0].targetRunId, outcomes: [okOutcome(rej)] }])).reason, 'item_duplicate')
    const bad = await reportBatch(rej, [
      { targetRunId: j.items[0].targetRunId, outcomes: [okOutcome(rej)] },
      { targetRunId: j.items[1].targetRunId, outcomes: [{ ...okOutcome(rej), actionCode: 'khong_co_thao_tac_nay' }] }
    ])
    assert.equal(bad.ok, false); assert.equal(bad.reason, 'item_rejected'); assert.equal(bad.detail.reason, 'action_unknown')
    assert.equal((await detailsOf(rej)).length, 0, 'không ghi phần nào')
    assert.equal((await rowOf(rej.ids[0])).status, 'đang chạy')
    assert.equal(await val(`SELECT current_setting('aka.engine.batch_scope', true)`), '')
    const okAfter = await reportBatch(rej, [{ targetRunId: j.items[0].targetRunId, outcomes: [okOutcome(rej)] },
      { targetRunId: j.items[1].targetRunId, outcomes: [okOutcome(rej)] }])
    assert.equal(okAfter.ok, true)
    assert.equal(okAfter.summary.succeeded, 2)
    pass('lease sai / mục trùng bị từ chối; một mục bị report_v1 từ chối thì hoàn tác cả lô, gửi lại đúng thì ghi bình thường')

    // 3f. Gọi report_v1 thường (không qua lô) vẫn như V501: khoá có áp.
    const single = await makeCampaign({ targets: 1 })
    const sc = await rpc('aka_agent_engine_claim_target_v1', ctx(single))
    single.lease = sc.leaseToken
    await rpc('aka_agent_engine_report_v1', sc.targetRunId, sc.leaseToken, JSON.stringify([failOutcome(single, 'err_test_lock_v503')]), true, false)
    assert.equal(await lockOf(single), 1, 'không qua lô: chính sách áp đủ như V501')
    pass('báo thường không qua lô: chính sách áp đủ như V501 (chế độ lô không rò sang lời gọi khác)')

    // ---- 4. Mã mới --------------------------------------------------------------------------------
    const cfg = await makeCampaign({ targets: 2 })
    const cf = await claimBatch(cfg)
    const cr = await rpc('aka_agent_engine_report_v1', cf.items[0].targetRunId, cfg.lease, JSON.stringify([{ resultKey: `v503-smoke:${++rk}`, actionCode: cfg.action,
      stepKey: '__config', ok: false, phase: 'before_send',
      signal: { kind: 'engine', code: 'CFG17', errorCode: 'err_cfg_share_content_empty', message: 'Vui lòng nhập nội dung hoặc chọn media để gửi Zalo' } }]), true, false)
    assert.equal(cr.next, 'stop_campaign')
    assert.equal((await camp(cfg)).status, 'tạm dừng')
    assert.equal((await camp(cfg)).note, 'Vui lòng nhập nội dung hoặc chọn media để gửi Zalo (CFG17)')
    assert.equal((await rowOf(cfg.ids[0])).status, 'chờ xử lý', 'data về hàng đợi, không đốt data')
    assert.equal((await detailsOf(cfg)).length, 0)
    pass('CFG17: tạm dừng chiến dịch một lần kèm câu Desktop, data về hàng đợi, không ghi lịch sử')

    const intr = await makeCampaign({ targets: 1 })
    const it = await claimBatch(intr)
    await reportBatch(intr, [{ targetRunId: it.items[0].targetRunId, outcomes: [{ resultKey: `v503-smoke:${++rk}`, actionCode: intr.action, stepKey: 'share',
      ok: false, phase: 'after_send', evidence: { partialDelivery: true, partialStage: 'content_after_media' },
      signal: { kind: 'engine', code: 'share_interrupted', message: 'Chiến dịch đã dừng theo policy khi gửi media; chưa chia sẻ phần nội dung.' } }] }], 1)
    const idt = await detailsOf(intr)
    assert.equal(idt[0].error_code, 'err_engine_share_interrupted')
    assert.equal(idt[0].status, 'thất bại')
    assert.equal(idt[0].log, 'Đã gửi file nhưng gửi nội dung thất bại. Chiến dịch đã dừng theo policy khi gửi media; chưa chia sẻ phần nội dung. (SYS09)')
    assert.equal((await rowOf(intr.ids[0])).status, 'hoàn thành')
    pass('SYS09: lô dừng sau khi gửi media → "Đã gửi file nhưng gửi nội dung thất bại. …" (SYS09), data hoàn thành, không gửi lại')

    // ---- 5. Gỡ rồi apply lại ---------------------------------------------------------------------
    await db.query(`DELETE FROM public.auto_campaign_details WHERE error_code IN ('err_cfg_share_content_empty', 'err_engine_share_interrupted')`)
    await db.query(`DELETE FROM public.auto_engine_outcomes WHERE error_code IN ('err_cfg_share_content_empty', 'err_engine_share_interrupted')`)
    await db.query(v503.rollback)
    assert.equal(await md5Of(CLAIM), v503.LIVE.claim); assert.equal(await md5Of(REPORT), v503.LIVE.report)
    assert.equal(await val(`SELECT to_regprocedure($1)`, [CLAIM_BATCH]), null)
    assert.equal(await val(`SELECT count(*)::int FROM public.auto_error WHERE public_code IN ('CFG17', 'SYS09')`), 0)
    await db.query(v503.migration)
    assert.equal(await md5Of(REPORT_BATCH), v503.NEW.reportBatch)
    pass('gỡ trả thân V501, xoá hàm / mã / luật mới; apply lại được')

    console.log(`OK V503: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => undefined)
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })

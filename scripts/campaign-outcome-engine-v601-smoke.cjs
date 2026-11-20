// V601: ghi chú chiến dịch khi cả lô gửi dạng chia sẻ không ai nhận được (câu anh duyệt 20/11/2026).
// PostgreSQL 17 cục bộ dùng một lần, chuỗi V495 → V499 → V500 → V501 → V503 (thân report_batch_v1 đúng md5 production 20/11).
//   1. File = bản sinh; thân / định nghĩa report_batch_v1 trên cụm thử đúng md5 production.
//   2. Preflight: sổ đã có V601 thì chặn; apply thử rồi ROLLBACK không đổi gì; apply thật; chạy lại bị chặn.
//   3. Câu mới: cùng một lý do, khác lý do ("phần lớn do", bằng nhau lấy data đầu), lô 1 data, cỡ lô do nơi chạy truyền, nhắn bạn bè;
//      lô đã dừng theo chính sách thì không ghi câu này; khi nào tạm dừng / khoá / chuỗi không đổi.
//   4. Gỡ V601 trả câu cũ; gỡ lần hai bị chặn.
// Không mạng, không dữ liệu khách. Chạy: LC_ALL=C node scripts/campaign-outcome-engine-v601-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const v503 = require('./build-v503-sql.cjs')
const v601 = require('./build-v601-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V601_TEST_PORT || 55601)
const OLD_NOTE = n => `Toàn bộ ${n} target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra`

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v601-' })
  const db = await connect()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
  const rpc = async (fn, ...args) => val(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)
  try {
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v601.NAME}.sql`), 'utf8'), v601.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v601.ROLLBACK_NAME}.sql`), 'utf8'), v601.rollback, 'file rollback = bản sinh')
    await buildFixture(db, [])
    for (const sql of [MIGRATION, v499.migration, V500]) await db.query(sql)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const sql of [v501.migration, v503.migration]) await db.query(sql)

    // ---- 1–2. Thân nguồn, preflight, apply ------------------------------------------------------------
    const src = () => val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)`, [v601.SIG])
    const def = () => val(`SELECT md5(pg_get_functiondef(to_regprocedure($1)))`, [v601.SIG])
    assert.equal(await src(), v601.LIVE.src); assert.equal(await def(), v601.LIVE.def, 'định nghĩa trên cụm thử = pg_get_functiondef production')
    await db.query(`CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text, name text)`)
    await db.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('1', 'migration_v601_engine_share_batch_fail_note')`)
    await assert.rejects(db.query(v601.migration), /V601 đã có trong sổ migration/)
    await db.query('ROLLBACK')
    await db.query(`DELETE FROM supabase_migrations.schema_migrations`)
    await db.query(v601.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await src(), v601.LIVE.src, 'apply thử rồi ROLLBACK không đổi thân')
    await db.query(v601.migration)
    assert.equal(await src(), v601.NEW.src); assert.equal(await def(), v601.NEW.def)
    await assert.rejects(db.query(v601.migration), /V601 đã chạy/)
    await db.query('ROLLBACK')
    const priv = role => val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, v601.SIG])
    for (const role of ['anon', 'authenticated']) assert.equal(await priv(role), false, role)
    for (const role of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) assert.equal(await priv(role), true, role)
    pass('file = bản sinh; thân / định nghĩa đúng production; sổ đã có thì chặn; apply thử rồi ROLLBACK không đổi; apply thật; chạy lại bị chặn; quyền giữ nguyên')

    // ---- Dữ liệu thử (như smoke V503) -----------------------------------------------------------------
    const codes = [['err_test_lock_v601', 'TST61'], ['err_test_pause_v601', 'TST62'], ['err_test_plain_v601', 'TST63']]
    for (const [code, pub] of codes) {
      await db.query(`INSERT INTO public.auto_error SELECT (jsonb_populate_record(NULL::public.auto_error,
          to_jsonb(e) || jsonb_build_object('id', (SELECT max(id) + 1 FROM public.auto_error), 'error_code', $1::text, 'public_code', $2::text, 'error_class', 'transient'))).*
        FROM public.auto_error e WHERE e.error_code = 'err_engine_unknown_delivery'`, [code, pub])
    }
    await db.query(`SELECT setval('auto_error_id_seq', (SELECT max(id) FROM public.auto_error))`)
    const failedId = await val(`SELECT id FROM public.auto_status WHERE code = 'campaign_detail_failed' AND component_type = 'campaign_detail' ORDER BY id LIMIT 1`)
    await db.query(`INSERT INTO public.auto_outcome_policies (error_code, detail_mode, detail_status_id, log_template, quota_effect, target_streak_effect, target_effect,
        remaining_steps, lock_action_codes, lock_mode, lock_minutes, run_effect, pace_mode, campaign_effect, account_effect, login_effect, source, description)
      VALUES ('err_test_lock_v601', 'write', $1, 'Khoá thử', 'no_count', 'increment', 'complete', 'skip', '{zalo_message_friend,zalo_message_group}', 'fixed_minutes', 30, 'end_unit', 'none', 'none', 'none', 'none', 'test', 'test'),
             ('err_test_pause_v601', 'write', $1, 'Tạm dừng thử', 'no_count', 'increment', 'complete', 'skip', '{}', NULL, NULL, 'stop_campaign', 'none', 'pause', 'none', 'none', 'test', 'test'),
             ('err_test_plain_v601', 'write', $1, 'Đạt giới hạn thử.', 'count', 'increment', 'complete', 'skip', '{}', NULL, NULL, 'continue', 'none', 'none', 'none', 'none', 'test', 'test')`,
      [failedId])

    let nextId = 960000
    const makeCampaign = async ({ action = 'zalo_message_group', targets = 3 } = {}) => {
      const account = ++nextId, campaign = ++nextId, staff = 7601, org = 761
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo thử', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, true, false)`, [account, staff, org])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, schedule_type, continue_next_day, provisioning_state,
          data_target_source_mode, extra_settings, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Chia sẻ thử', $2, $3, 'chờ xử lý', now() - interval '1 minute', 'daily', true, 'ready', 'direct', $4::jsonb, false, $5, $6)`,
        [campaign, action, account, JSON.stringify({ zaloMessageSendMode: 'share' }), staff, org])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, status, is_delete)
          OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Data ${i + 1}`, String(8800000000 + id)])
        ids.push(id)
      }
      return { account, campaign, staff, ids, action, lease: null }
    }
    const ctx = c => JSON.stringify({ staffId: c.staff, accountId: c.account, campaignId: c.campaign, runnerId: 'fly:v601',
      runtimeTarget: 'fly', leaseToken: c.lease ?? null, actions: [{ code: c.action }], maxTargets: 50 })
    const claimBatch = async c => { const res = await rpc('aka_agent_engine_claim_batch_v1', ctx(c)); if (res.leaseToken) c.lease = res.leaseToken; return res }
    let rk = 0
    const fail = (c, errorCode) => ({ resultKey: `v601-smoke:${++rk}`, actionCode: c.action, stepKey: 'share', ok: false, phase: 'after_send',
      signal: { kind: 'engine', code: 'test', errorCode, message: 'thử' } })
    const ok = c => ({ resultKey: `v601-smoke:${++rk}`, actionCode: c.action, stepKey: 'share', ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' })
    const camp = c => one(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [c.campaign])
    const noteOf = id => val(`SELECT note FROM public.auto_campaign_input_data WHERE id = $1`, [id])
    const lockOf = c => val(`SELECT count(*)::int FROM public.auto_account_action_status WHERE account_id = $1 AND is_disable`, [c.account])
    const streakOf = c => val(`SELECT coalesce(max(count_consecutive_bad_targets), 0)::int FROM public.auto_campaign_error_state WHERE campaign_id = $1`, [c.campaign])
    // Chạy một lô: errs[i] = mã lỗi của data i (null = thành công).
    const runBatch = async ({ action = 'zalo_message_group', errs, size = null }) => {
      const c = await makeCampaign({ action, targets: errs.length })
      const b = await claimBatch(c)
      assert.equal(b.items.length, errs.length)
      const res = await rpc('aka_agent_engine_report_batch_v1', c.lease, JSON.stringify(b.items.map((it, i) =>
        ({ targetRunId: it.targetRunId, outcomes: [errs[i] ? fail(c, errs[i]) : ok(c)] }))), size)
      assert.equal(res.ok, true, JSON.stringify(res))
      const notes = []
      for (const id of c.ids) notes.push(await noteOf(id))
      return { c, res, campaign: await camp(c), notes }
    }

    // ---- 3. Câu mới ------------------------------------------------------------------------------------
    const same = await runBatch({ errs: ['err_test_plain_v601', 'err_test_plain_v601', 'err_test_plain_v601'] })
    assert.equal(same.notes[0], 'Đạt giới hạn thử. (TST63)', 'lý do = ghi chú data (cùng câu ở Lịch sử hành động)')
    assert.equal(same.campaign.status, 'tạm dừng')
    assert.equal(same.campaign.note, 'Cả 3 nhóm đều gửi không thành công: Đạt giới hạn thử. (TST63). Chiến dịch đã tạm dừng.')
    assert.equal(same.res.stopNote, same.campaign.note); assert.equal(same.res.next, 'stop_campaign'); assert.equal(same.res.summary.paused, true)
    assert.equal(await streakOf(same.c), 3, 'chuỗi data lỗi như trước V601')
    pass('cả lô cùng một lý do: "Cả 3 nhóm đều gửi không thành công: <ghi chú data>. Chiến dịch đã tạm dừng." (stopNote cùng câu)')

    const mixed = await runBatch({ errs: ['err_test_plain_v601', 'err_test_lock_v601', 'err_test_lock_v601'] })
    assert.deepEqual(mixed.res.items.map(i => i.scope), ['batch_followup', 'full', 'batch_followup'], 'chọn data áp đủ chính sách như trước V601')
    assert.equal(await lockOf(mixed.c), 2, 'khoá của data mạnh nhất vẫn áp (nhắn bạn bè + nhắn nhóm)')
    assert.equal(mixed.campaign.note, `Cả 3 nhóm đều gửi không thành công, phần lớn do: ${mixed.notes[1]}. Chiến dịch đã tạm dừng.`)
    assert.match(mixed.notes[1], /^Khoá thử/)
    const tie = await runBatch({ errs: ['err_test_plain_v601', 'err_test_lock_v601'] })
    assert.equal(tie.campaign.note, 'Cả 2 nhóm đều gửi không thành công, phần lớn do: Đạt giới hạn thử. (TST63). Chiến dịch đã tạm dừng.',
      'số lần bằng nhau: lấy lý do của data đầu')
    pass('khác lý do: ", phần lớn do: <lý do gặp nhiều nhất>"; bằng nhau lấy data đầu; khoá / data áp đủ chính sách không đổi')

    const single = await runBatch({ errs: ['err_test_plain_v601'] })
    assert.equal(single.campaign.note, '1 nhóm gửi không thành công: Đạt giới hạn thử. (TST63). Chiến dịch đã tạm dừng.')
    const sized = await runBatch({ errs: ['err_test_plain_v601', 'err_test_plain_v601'], size: 5 })
    assert.equal(sized.campaign.note, 'Cả 5 nhóm đều gửi không thành công: Đạt giới hạn thử. (TST63). Chiến dịch đã tạm dừng.', 'N = cỡ lô nơi chạy truyền')
    const friend = await runBatch({ action: 'zalo_message_friend', errs: ['err_test_plain_v601', 'err_test_plain_v601'] })
    assert.equal(friend.campaign.note, 'Cả 2 bạn bè đều gửi không thành công: Đạt giới hạn thử. (TST63). Chiến dịch đã tạm dừng.')
    const friendOne = await runBatch({ action: 'zalo_message_friend', errs: ['err_test_lock_v601'] })
    assert.match(friendOne.campaign.note, /^1 bạn bè gửi không thành công: Khoá thử.*\. Chiến dịch đã tạm dừng\.$/)
    pass('lô 1 data: "1 nhóm gửi không thành công: …"; N = cỡ lô truyền vào; nhắn bạn bè dùng "bạn bè"')

    const policy = await runBatch({ errs: ['err_test_lock_v601', 'err_test_pause_v601'] })
    assert.equal(policy.campaign.status, 'tạm dừng')
    assert.doesNotMatch(policy.campaign.note ?? '', /gửi không thành công|Toàn bộ/, 'đã dừng theo chính sách: giữ ghi chú của chính sách')
    const partial = await runBatch({ errs: [null, 'err_test_plain_v601'] })
    assert.equal(partial.campaign.status, 'đang chạy', 'có người nhận được: không tạm dừng')
    assert.equal(partial.res.stopNote, null)
    pass('lô đã dừng theo chính sách giữ ghi chú của chính sách; lô có người nhận được không tạm dừng (như trước V601)')

    // ---- 4. Gỡ -------------------------------------------------------------------------------------------
    await db.query(v601.rollback)
    assert.equal(await src(), v601.LIVE.src); assert.equal(await def(), v601.LIVE.def)
    const back = await runBatch({ errs: ['err_test_plain_v601', 'err_test_plain_v601'] })
    assert.equal(back.campaign.note, OLD_NOTE(2), 'gỡ xong: câu cũ')
    await assert.rejects(db.query(v601.rollback), /Gỡ V601: thân report_batch_v1 đã là bản trước V601/)
    await db.query('ROLLBACK')
    for (const role of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) assert.equal(await priv(role), true, role)
    pass('gỡ V601 trả thân V503 (đúng md5 production) và câu cũ; gỡ lần hai bị chặn; quyền giữ nguyên')

    console.log(`OK V601: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })

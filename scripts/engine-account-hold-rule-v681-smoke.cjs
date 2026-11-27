#!/usr/bin/env node
// V681 engine v2 không để tài khoản kẹt "đang chạy": kiểm trên PostgreSQL 17 cục bộ dùng một lần (không chạm DB thật, không mạng).
//   1. File migration / bản gỡ = bản sinh (scripts/build-v681-sql.cjs).
//   2. DB thử như production: bootstrap bộ kịch bản engine v2 + hàm production trước V670 (fixtures/campaign-parallel-run/setup.cjs), apply
//      V670 p1 → p3, kiểm release_v1 / close_stale_v1 đúng md5 production 27/11 mà V681 lấy làm nguồn.
//   3. Trước V681: tái hiện sự cố 27/11 (claim bỏ qua dấu cũ trên chiến dịch đã xoá, release giữ tài khoản "đang chạy" mãi).
//   4. Dọn một lần lúc apply (anh chốt "Bỏ, dọn một lần"): dữ liệu dựng trước khi apply, kể cả một dòng tài khoản đang bị khoá ở kết nối
//      khác; chỉ tài khoản Zalo Server, đúng luật giữ, apply không chờ dòng bị khoá.
//   5. Sau V681: release / close_stale trả tài khoản theo luật V527; luật giữ của legacy_hold_v1 trùng quyết định của bước nhận lượt trên
//      128 tổ hợp dấu bộ cũ; lý do giữ của account_holder_v1; job close_stale không tự gỡ gì (kết quả đúng khoá cũ); câu dò
//      scripts/engine-v2-stuck-accounts.cjs ra đúng như hàm của V681.
//   6. Chạy lại bị chặn; bản gỡ trả hai hàm về bản sau V670 và xoá hai hàm mới; apply lại được.
// Chạy: LC_ALL=C CHAT_REPO=<akaAgentChatApi> node scripts/engine-account-hold-rule-v681-smoke.cjs (cần PostgreSQL 17 Homebrew và module pg
// của akaAgentChatApi).
'use strict'
process.env.SCENARIO_FACEBOOK_MIGRATIONS = '1'
process.env.SCENARIO_TARGET_CHECK = '1'
process.env.SCENARIO_ORPHAN_RUNS = '1'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { bootstrap } = require('./engine-v2-scenarios/bootstrap.cjs')
const v670 = require('./build-v670-sql.cjs')
const v681 = require('./build-v681-sql.cjs')
const { buildSql: stuckScanSql } = require('./engine-v2-stuck-accounts.cjs')

const PORT = Number(process.env.V681_TEST_PORT || 55681)
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

const STAFF = 6810, ORG = 681
const PHONE_ACTIONS = [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }, { code: 'zalo_add_friend', required: false }]
const JOIN_ACTIONS = [{ code: 'zalo_join_group_link' }]
const CLOSE_STALE_KEYS = ['closedTargets', 'finalizedTargets', 'orphanTargets', 'releasedLeases']

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v681-' })
  const db = await connect()
  const notices = []
  db.on('notice', msg => notices.push(msg.message))
  try {
    // ---- 1. File = bản sinh ----------------------------------------------------------------------------------------------------
    assert.equal(fs.readFileSync(path.join(ROOT, 'migrations', `${v681.NAME}.sql`), 'utf8'), v681.migration, 'migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, 'migrations', `${v681.ROLLBACK_NAME}.sql`), 'utf8'), v681.rollback, 'bản gỡ = bản sinh')
    assert.doesNotMatch(v681.migration, /auto_system_settings|CREATE TABLE/, 'không thêm bảng / thiết lập')
    pass('migration và bản gỡ đúng bản sinh; không thêm bảng, không thêm thiết lập')

    // ---- 2. DB thử như production --------------------------------------------------------------------------------------------
    const notes = []
    await bootstrap(db, notes)
    await require('./fixtures/campaign-parallel-run/setup.cjs').installLive(db, notes)
    await db.query(v670.p1); await db.query(v670.p2); await db.query(v670.p3)
    for (const [key, live] of Object.entries(v681.LIVE)) {
      const got = (await db.query(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS def, md5(p.prosrc) AS src
        FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [live.sig])).rows[0]
      assert.equal(got.def, live.defMd5, `${key}: định nghĩa sau V670 = production`)
      assert.equal(got.src, live.srcMd5, `${key}: thân sau V670 = production`)
    }
    pass('cụm thử có release_v1 / close_stale_v1 đúng bản production 27/11 (sau V670)')

    let nextId = 6810000
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org V681', true)`, [ORG])
    /** Tài khoản Zalo (mặc định QR; server = Zalo Server, facebook = tài khoản Facebook). */
    const account = async ({ server = false, facebook = false, deleted = false } = {}) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
          is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE
        VALUES ($1, 'TK V681', $2, 'đã đăng nhập', 'chờ xử lý', true, $3, $4, $5, $6, false)`,
      [id, facebook ? 'facebook' : 'zalo', deleted, STAFF, ORG, server && !facebook])
      return id
    }
    const campaign = async (accountId, actionId = 'zalo_message_phone', { tick = false, rows = 2 } = {}) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, extra_settings)
        OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', now() - interval '1 minute', false, $5, $6, '{}'::jsonb)`,
        [id, `CD ${id}`, actionId, accountId, STAFF, ORG])
      if (tick) await db.query(`UPDATE public.auto_campaigns SET parallel_run_enabled = true WHERE id = $1`, [id])
      for (let i = 0; i < rows; i++) {
        await db.query(`INSERT INTO public.auto_campaign_input_data(campaign_id, name, phone, uid, status, is_delete)
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, `Data ${i}`, `09${String(id).slice(-6)}${i}`, `uid${id}${i}`])
      }
      return id
    }
    // Chiến dịch bộ cũ còn dấu giữ lượt (claim token, có thể kèm unit lease), lần claim / ghi cuối cách đây claimedMin / updatedMin phút.
    const legacy = async (accountId, { deleted = true, status = 'tạm dừng', claimedMin = 2880, updatedMin = claimedMin, target = 'server',
      unit = false, dataRunning = false } = {}) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id,
          extra_settings, runtime_claim_token, runtime_claim_target, runtime_claimed_at, runtime_claim_vietnam_date, runtime_unit_token,
          runtime_unit_vietnam_date, runtime_unit_claimed_at, updated_at)
        OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'zalo_message_phone', $3, $4, now() - interval '3 days', $5, $6, $7, '{}'::jsonb,
          gen_random_uuid(), $8, now() - make_interval(mins => $9), (now() - make_interval(mins => $9))::date,
          CASE WHEN $10 THEN gen_random_uuid() END, CASE WHEN $10 THEN (now() - make_interval(mins => $9))::date END,
          CASE WHEN $10 THEN now() - make_interval(mins => $9) END, now() - make_interval(mins => $11))`,
      [id, `Bộ cũ ${id}`, accountId, status, deleted, STAFF, ORG, target, claimedMin, unit, updatedMin])
      if (dataRunning) {
        await db.query(`INSERT INTO public.auto_campaign_input_data(campaign_id, name, phone, uid, status, is_delete)
          VALUES ($1, 'Đang chạy', '0900000000', 'uid-running', 'đang chạy', false)`, [id])
      }
      return id
    }
    const claim = async (accountId, campaignId, actions = PHONE_ACTIONS, extra = {}) =>
      (await db.query(`SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r`,
        [JSON.stringify({ staffId: STAFF, accountId, campaignId, runnerId: 'v681-runner', runtimeTarget: 'desktop', actions, ...extra })])).rows[0].r
    const finishRuns = tok => db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported' WHERE lease_token = $1`, [tok])
    const release = async (accountId, tok) => (await db.query(`SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [accountId, tok])).rows[0].r
    const closeStale = async () => (await db.query(`SELECT public.aka_agent_engine_close_stale_v1(200) AS r`)).rows[0].r
    const accountStatus = async id => (await db.query(`SELECT status FROM public.auto_accounts WHERE id = $1`, [id])).rows[0].status
    const claimToken = async id => (await db.query(`SELECT runtime_claim_token AS t FROM public.auto_campaigns WHERE id = $1`, [id])).rows[0].t
    const setRunning = (id, ago = '10 minutes') => db.query(`UPDATE public.auto_accounts SET status = 'đang chạy', updated_at = now() - $2::interval WHERE id = $1`, [id, ago])
    const legacyHold = async id => (await db.query(`SELECT private.aka_agent_engine_legacy_hold_v1($1, clock_timestamp()) AS r`, [id])).rows[0].r
    const holder = async id => (await db.query(`SELECT private.aka_agent_engine_account_holder_v1($1, clock_timestamp()) AS r`, [id])).rows[0].r
    const addLease = id => db.query(`INSERT INTO public.auto_engine_leases(account_id, lease_token, runner_id, runtime_target, expires_at)
      VALUES ($1, gen_random_uuid(), 'v681-test', 'fly', now() + interval '5 minutes')`, [id])
    const aliveCampaign = async (id, ago = '1 hour') => {
      const cd = await campaign(id)
      await db.query(`UPDATE public.auto_campaigns SET status = 'đang chạy', updated_at = now() - $2::interval, last_run_at = now() - $2::interval WHERE id = $1`, [cd, ago])
      return cd
    }
    const stuckScan = async () => (await db.query(stuckScanSql({ graceMinutes: 3, opMinutes: 30 }))).rows[0].report

    // Thời điểm dựng dòng thử phải giữ nguyên (không trigger nào ghi đè updated_at), không thì các bài theo thời gian vô nghĩa.
    {
      const acc = await account()
      const old = await legacy(acc, { claimedMin: 120, updatedMin: 90 })
      const got = (await db.query(`SELECT extract(epoch FROM now() - updated_at) / 60 AS m FROM public.auto_campaigns WHERE id = $1`, [old])).rows[0].m
      assert.ok(Math.abs(Number(got) - 90) < 1, `updated_at giữ đúng (${got})`)
      await setRunning(acc, '10 minutes')
      const ago = (await db.query(`SELECT extract(epoch FROM now() - updated_at) / 60 AS m FROM public.auto_accounts WHERE id = $1`, [acc])).rows[0].m
      assert.ok(Math.abs(Number(ago) - 10) < 1, `auto_accounts.updated_at giữ đúng (${ago})`)
      await db.query(`UPDATE public.auto_accounts SET status = 'chờ xử lý' WHERE id = $1`, [acc])
    }
    pass('dòng thử giữ đúng mốc thời gian dựng (không trigger nào ghi đè updated_at)')

    // ---- 3. Trước V681: tái hiện sự cố ---------------------------------------------------------------------------------------
    const bugAcc = await account()
    {
      await legacy(bugAcc, { deleted: true, status: 'tạm dừng', claimedMin: 3 * 24 * 60 })
      const c = await claim(bugAcc, await campaign(bugAcc))
      assert.equal(c.status, 'claimed', 'claim bỏ qua dấu cũ (V527)')
      assert.equal(await accountStatus(bugAcc), 'đang chạy')
      await finishRuns(c.leaseToken)
      assert.equal((await release(bugAcc, c.leaseToken)).ok, true)
      assert.equal(await accountStatus(bugAcc), 'đang chạy', 'trước V681: release giữ tài khoản "đang chạy" vì dấu cũ')
      await setRunning(bugAcc, '2 hours')
      await closeStale()
      assert.equal(await accountStatus(bugAcc), 'đang chạy', 'trước V681: close_stale cũng không gỡ')
    }
    pass('trước V681 tái hiện đúng sự cố 27/11: một lượt rồi tài khoản kẹt "đang chạy", job dọn không gỡ')

    // ---- 4. Dữ liệu dọn một lần, dựng trước khi apply ------------------------------------------------------------------------
    const S = {}
    S.stuck = await account({ server: true }); await setRunning(S.stuck, '10 minutes')
    S.stuckToken = await legacy(S.stuck, { deleted: true, claimedMin: 3 * 24 * 60 })
    S.stuckPausedToken = await legacy(S.stuck, { deleted: false, status: 'tạm dừng', claimedMin: 2000 })
    S.noToken = await account({ server: true }); await setRunning(S.noToken, '1 hour')
    S.fresh = await account({ server: true }); await setRunning(S.fresh, '1 minute')
    S.op = await account({ server: true }); await setRunning(S.op, '1 hour')
    await db.query(`UPDATE public.auto_accounts SET runtime_operation_claim_token = gen_random_uuid() WHERE id = $1`, [S.op])
    S.lease = await account({ server: true }); await setRunning(S.lease, '1 hour'); await addLease(S.lease)
    S.live = await account({ server: true }); await setRunning(S.live, '1 hour')
    S.liveToken = await legacy(S.live, { deleted: false, status: 'tạm dừng', claimedMin: 5 })
    S.alive = await account({ server: true }); await setRunning(S.alive, '1 hour'); await aliveCampaign(S.alive)
    S.locked = await account({ server: true }); await setRunning(S.locked, '1 hour')
    S.qr = await account(); await setRunning(S.qr, '1 hour')
    S.fb = await account({ facebook: true }); await setRunning(S.fb, '1 hour')
    // Dấu không được xoá: đích desktop, tài khoản đã xoá, unit lease, còn data chạy, chiến dịch chờ xử lý, dấu mới.
    const keepAcc = await account({ server: true })
    S.keep = {
      desktop: await legacy(keepAcc, { deleted: true, claimedMin: 2000, target: 'desktop' }),
      unit: await legacy(keepAcc, { deleted: true, claimedMin: 2000, unit: true }),
      running: await legacy(keepAcc, { deleted: true, claimedMin: 2000, dataRunning: true }),
      pending: await legacy(keepAcc, { deleted: false, status: 'chờ xử lý', claimedMin: 2000 }),
      fresh: await legacy(keepAcc, { deleted: true, claimedMin: 5 }),
      deletedAccount: await legacy(await account({ server: true, deleted: true }), { deleted: true, claimedMin: 2000 }),
      qrAccount: await legacy(S.qr, { deleted: true, claimedMin: 2000 })
    }

    // ---- Apply V681 trong lúc một dòng tài khoản đang bị khoá ở kết nối khác --------------------------------------------------
    {
      const db2 = await connect()
      try {
        await db2.query('BEGIN')
        await db2.query(`SELECT 1 FROM public.auto_accounts WHERE id = $1 FOR UPDATE`, [S.locked])
        notices.length = 0
        const t0 = Date.now()
        await db.query(v681.migration)
        assert.ok(Date.now() - t0 < 3000, `apply không chờ dòng bị khoá (${Date.now() - t0} ms)`)
        await db2.query('COMMIT')
      } finally { await db2.end() }
    }
    for (const [key, sig] of [['release', v681.LIVE.release.sig], ['close_stale', v681.LIVE.close_stale.sig]]) {
      const got = (await db.query(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS def, md5(p.prosrc) AS src FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [sig])).rows[0]
      assert.equal(got.def, v681.NEW[key].def, `${key}: định nghĩa mới`)
      assert.equal(got.src, v681.NEW[key].src, `${key}: thân mới`)
    }
    for (const [key, sig] of [['legacy_hold', v681.LEGACY_HOLD_SIG], ['holder', v681.HOLDER_SIG]]) {
      const got = (await db.query(`SELECT md5(p.prosrc) AS src, has_function_privilege('public', $1, 'EXECUTE') AS pub FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [sig])).rows[0]
      assert.equal(got.src, v681.NEW[key].src, `${key}: thân`)
      assert.equal(got.pub, false, `${key}: PUBLIC không gọi được`)
    }
    for (const role of ['aka_agent_chat_api', 'service_role']) {
      const exists = (await db.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role])).rowCount > 0
      if (exists) assert.equal((await db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, v681.HOLDER_SIG])).rows[0].ok, true, `${role} gọi được holder`)
    }
    for (const role of ['anon', 'authenticated', 'aka_agent_desktop']) {
      const exists = (await db.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role])).rowCount > 0
      if (exists) assert.equal((await db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, v681.HOLDER_SIG])).rows[0].ok, false, `${role} không gọi được holder`)
    }
    const leftovers = (await db.query(`SELECT to_regclass('private.auto_engine_self_heal_log') AS t,
      (SELECT count(*) FROM public.auto_system_settings WHERE key LIKE 'engine.account_%')::int AS s`)).rows[0]
    assert.deepEqual(leftovers, { t: null, s: 0 }, 'không bảng nhật ký, không thiết lập')
    pass('apply V681: md5 release / close_stale / 2 hàm mới, quyền hàm; không bảng, không thiết lập')

    {
      const note = notices.find(n => n.startsWith(`${v681.LABEL} dọn một lần`))
      assert.ok(note, `có dòng báo dọn một lần (${JSON.stringify(notices)})`)
      assert.match(note, /: 2 dấu giữ lượt quá hạn đã xoá, 2 tài khoản về "chờ xử lý"$/, note)
      assert.equal(await accountStatus(S.stuck), 'chờ xử lý', 'Server kẹt có dấu cũ: về chờ xử lý')
      assert.equal(await claimToken(S.stuckToken), null, 'dấu cũ trên chiến dịch đã xoá: xoá')
      assert.equal(await claimToken(S.stuckPausedToken), null, 'dấu cũ trên chiến dịch tạm dừng: xoá')
      assert.equal((await db.query(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [S.stuckPausedToken])).rows[0].status, 'tạm dừng', 'xoá dấu không đổi trạng thái chiến dịch')
      assert.equal(await accountStatus(S.noToken), 'chờ xử lý', 'Server kẹt không dấu: về chờ xử lý')
      for (const [label, id] of [['vừa ghi 1 phút', S.fresh], ['token thao tác', S.op], ['lease', S.lease], ['dấu bộ cũ còn hiệu lực', S.live],
        ['chiến dịch "đang chạy" còn sống', S.alive], ['dòng bị khoá lúc apply', S.locked], ['Zalo QR (ngoài phạm vi)', S.qr],
        ['Facebook (ngoài phạm vi)', S.fb], ['tài khoản của sự cố (Zalo QR, ngoài phạm vi)', bugAcc]]) {
        assert.equal(await accountStatus(id), 'đang chạy', `${label}: không gỡ`)
      }
      assert.notEqual(await claimToken(S.liveToken), null, 'dấu còn hiệu lực: giữ')
      for (const [label, id] of Object.entries(S.keep)) assert.notEqual(await claimToken(id), null, `${label}: giữ dấu`)
    }
    pass('dọn một lần lúc apply: 2 dấu quá hạn + 2 tài khoản Zalo Server kẹt; không đụng tài khoản còn bị giữ, dòng đang khoá, tài khoản ngoài Zalo Server, dấu không quá hạn / không đích server')

    await assert.rejects(db.query(v681.migration), /đã chạy|đã có/, 'chạy lại bị chặn')
    await db.query('ROLLBACK').catch(() => {})
    pass('chạy lại V681 bị chặn')

    // ---- 5a. release_v1 / close_stale_v1 theo luật mới -----------------------------------------------------------------------
    {
      const acc = await account()
      await legacy(acc, { deleted: true, status: 'tạm dừng', claimedMin: 3 * 24 * 60 })
      const c = await claim(acc, await campaign(acc))
      assert.equal(c.status, 'claimed')
      await finishRuns(c.leaseToken)
      assert.equal((await release(acc, c.leaseToken)).ok, true)
      assert.equal(await accountStatus(acc), 'chờ xử lý', 'sau V681: release trả tài khoản về "chờ xử lý" dù còn dấu cũ')
    }
    {
      // Dấu bộ cũ còn hiệu lực (chiến dịch vừa tạm dừng 5 phút): release vẫn giữ "đang chạy" như trước.
      const acc = await account()
      const c = await claim(acc, await campaign(acc))
      assert.equal(c.status, 'claimed')
      await legacy(acc, { deleted: false, status: 'tạm dừng', claimedMin: 5 })
      await finishRuns(c.leaseToken)
      await release(acc, c.leaseToken)
      assert.equal(await accountStatus(acc), 'đang chạy', 'dấu bộ cũ còn hiệu lực: tài khoản vẫn "đang chạy"')
    }
    {
      // Làn khác còn giữ chỗ (V670): release làn chính giữ "đang chạy".
      const acc = await account()
      const m = await claim(acc, await campaign(acc))
      const j = await claim(acc, await campaign(acc, 'zalo_join_group_link', { tick: true }), JOIN_ACTIONS)
      assert.equal(m.status, 'claimed'); assert.equal(j.status, 'claimed')
      await finishRuns(m.leaseToken)
      await release(acc, m.leaseToken)
      assert.equal(await accountStatus(acc), 'đang chạy', 'làn khác còn: vẫn "đang chạy"')
      await finishRuns(j.leaseToken)
      await release(acc, j.leaseToken)
      assert.equal(await accountStatus(acc), 'chờ xử lý', 'nhả nốt làn riêng: "chờ xử lý"')
    }
    {
      // close_stale: lease hết hạn quá lâu, tài khoản có dấu cũ trên chiến dịch đã xoá.
      const acc = await account()
      await legacy(acc, { deleted: true, status: 'tạm dừng', claimedMin: 3 * 24 * 60, target: 'desktop' })
      const c = await claim(acc, await campaign(acc))
      await finishRuns(c.leaseToken)
      await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '2 hours' WHERE lease_token = $1`, [c.leaseToken])
      const r = await closeStale()
      assert.ok(r.releasedLeases >= 1)
      assert.equal(await accountStatus(acc), 'chờ xử lý', 'close_stale dọn lease hết hạn và trả tài khoản dù còn dấu cũ (đích desktop)')
    }
    pass('release / close_stale trả tài khoản theo luật V527; dấu bộ cũ còn hiệu lực và làn khác còn giữ chỗ vẫn giữ tài khoản')

    // ---- 5b. Luật giữ của legacy_hold_v1 = quyết định của bước nhận lượt (128 tổ hợp) ----------------------------------------
    {
      let n = 0
      for (const deleted of [false, true]) for (const status of ['tạm dừng', 'chờ xử lý', 'đang chạy', 'hoàn thành'])
        for (const claimedMin of [5, 120]) for (const updatedMin of [5, 120]) for (const unit of [false, true]) for (const dataRunning of [false, true]) {
          const acc = await account()
          await legacy(acc, { deleted, status, claimedMin, updatedMin, unit, dataRunning, target: n % 2 ? 'server' : 'desktop' })
          const cd = await campaign(acc)
          const hold = await legacyHold(acc)
          const c = await claim(acc, cd)
          const label = JSON.stringify({ deleted, status, claimedMin, updatedMin, unit, dataRunning })
          if (hold) assert.equal(c.status, 'legacy_busy', `giữ ⇒ claim legacy_busy ${label}`)
          else {
            assert.equal(c.status, 'claimed', `không giữ ⇒ claim nhận ${label}`)
            await finishRuns(c.leaseToken)
            await release(acc, c.leaseToken)
            assert.equal(await accountStatus(acc), 'chờ xử lý', `không giữ ⇒ release trả tài khoản ${label}`)
          }
          const expected = !(!unit && (deleted || status === 'tạm dừng') && claimedMin > 30 && updatedMin > 30 && !dataRunning)
          assert.equal(hold, expected, `luật V527 ${label}`)
          n++
        }
      assert.equal(n, 128)
    }
    pass('legacy_hold_v1 trùng quyết định của claim_target_v1 trên 128 tổ hợp dấu bộ cũ; không giữ thì release trả tài khoản')

    // ---- 5c. Lý do giữ của account_holder_v1 (worker Fly và câu dò dùng) -------------------------------------------------------
    const H = {}
    {
      H.none = await account(); await setRunning(H.none, '1 hour')
      H.op = await account(); await setRunning(H.op, '1 hour')
      await db.query(`UPDATE public.auto_accounts SET runtime_operation_claim_token = gen_random_uuid() WHERE id = $1`, [H.op])
      H.lease = await account()
      const lc = await claim(H.lease, await campaign(H.lease))
      assert.equal(lc.status, 'claimed')
      await db.query(`UPDATE public.auto_accounts SET updated_at = now() - interval '1 hour' WHERE id = $1`, [H.lease])
      H.run = await account()
      const rc = await claim(H.run, await campaign(H.run))
      await db.query(`DELETE FROM public.auto_engine_leases WHERE lease_token = $1`, [rc.leaseToken])
      await db.query(`UPDATE public.auto_accounts SET updated_at = now() - interval '1 hour' WHERE id = $1`, [H.run])
      H.live = await account(); await legacy(H.live, { deleted: false, status: 'tạm dừng', claimedMin: 5 }); await setRunning(H.live, '1 hour')
      H.alive = await account(); await aliveCampaign(H.alive, '1 hour'); await setRunning(H.alive, '1 hour')
      H.data = await account()
      const busy = await aliveCampaign(H.data, '9 hours')
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'đang chạy' WHERE id = (SELECT min(id) FROM public.auto_campaign_input_data WHERE campaign_id = $1)`, [busy])
      await setRunning(H.data, '1 hour')
      H.left = await account(); await aliveCampaign(H.left, '9 hours'); await setRunning(H.left, '1 hour')
      H.stale = await account(); await legacy(H.stale, { deleted: true, claimedMin: 2000 }); await setRunning(H.stale, '1 hour')
      const expected = { none: null, op: 'operation', lease: 'lease', run: 'open_run', live: 'legacy_claim', alive: 'campaign_running',
        data: 'campaign_running', left: null, stale: null }
      for (const [k, want] of Object.entries(expected)) assert.equal(await holder(H[k]), want, `holder ${k}`)
      const setting = await db.query(`INSERT INTO public.auto_system_settings(key, value, is_active) VALUES ($1, '12', true) RETURNING id`, [v681.SETTINGS.SETTING_IDLE])
      assert.equal(await holder(H.left), 'campaign_running', 'đổi ngưỡng chiến dịch còn sống lên 12 giờ: chiến dịch 9 giờ còn giữ')
      await db.query(`DELETE FROM public.auto_system_settings WHERE id = $1`, [setting.rows[0].id])
      assert.equal(await holder(H.left), null)
    }
    pass('account_holder_v1: operation / lease / open_run / legacy_claim / campaign_running (còn sống, có data chạy); chiến dịch sót 9 giờ, dấu quá hạn không giữ; ngưỡng đổi được')

    // ---- 5d. Không có bước tự gỡ định kỳ --------------------------------------------------------------------------------------
    {
      const acc = await account({ server: true }); await setRunning(acc, '1 hour')
      assert.equal(await holder(acc), null)
      const r = await closeStale()
      assert.deepEqual(Object.keys(r).sort(), CLOSE_STALE_KEYS, `kết quả close_stale đúng khoá cũ (${JSON.stringify(r)})`)
      assert.equal(await accountStatus(acc), 'đang chạy', 'job close_stale không đổi trạng thái tài khoản không có lease')
      H.serverStuck = acc
    }
    pass('job close_stale không tự gỡ: tài khoản "đang chạy" không lease giữ nguyên, kết quả đúng khoá cũ')

    // ---- 5e. Câu dò = hàm của V681 --------------------------------------------------------------------------------------------
    {
      const report = await stuckScan()
      assert.equal(report.holderFunction, true)
      const want = (await db.query(`SELECT array_agg(id ORDER BY id) AS ids FROM public.auto_accounts
        WHERE status = 'đang chạy' AND coalesce(is_delete, false) = false AND updated_at < clock_timestamp() - interval '3 minutes'
          AND private.aka_agent_engine_account_holder_v1(id, clock_timestamp()) IS NULL`)).rows[0].ids.map(Number)
      const got = report.stuck.map(a => Number(a.id)).sort((x, y) => x - y)
      assert.deepEqual(got, want, 'nhóm (A) của câu dò = các tài khoản holder_v1 trả NULL')
      for (const id of [H.none, H.left, H.stale, H.serverStuck, bugAcc, S.locked, S.qr, S.fb]) assert.ok(got.includes(Number(id)), `câu dò thấy ${id}`)
      const byFn = (await db.query(`SELECT coalesce(private.aka_agent_engine_account_holder_v1(id, clock_timestamp()), 'none') AS h, count(*)::int AS n
        FROM public.auto_accounts WHERE status = 'đang chạy' AND coalesce(is_delete, false) = false GROUP BY 1`)).rows
      assert.deepEqual(Object.fromEntries(byFn.map(r => [r.h, r.n])), Object.fromEntries(Object.entries(report.byHolder).map(([h, n]) => [h, Number(n)])),
        'đếm theo lý do giữ của câu dò = holder_v1')
      const opIds = report.operationHeld.map(a => Number(a.id))
      assert.ok(opIds.includes(Number(H.op)) && opIds.includes(Number(S.op)), 'nhóm (B): tài khoản bị token thao tác giữ quá 30 phút')
      assert.ok(report.stuck.every(a => 'lastActionAt' in a), 'nhóm (A) có lần hành động cuối')
    }
    pass('câu dò scripts/engine-v2-stuck-accounts.cjs: nhóm kẹt và đếm theo lý do trùng holder_v1; nhóm token thao tác giữ lâu')

    // ---- 6. Bản gỡ ---------------------------------------------------------------------------------------------------------
    await db.query(v681.rollback)
    for (const [key, live] of Object.entries(v681.LIVE)) {
      const got = (await db.query(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS def FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [live.sig])).rows[0]
      assert.equal(got.def, live.defMd5, `gỡ: ${key} về bản sau V670`)
    }
    const gone = (await db.query(`SELECT to_regprocedure($1) AS a, to_regprocedure($2) AS b`, [v681.LEGACY_HOLD_SIG, v681.HOLDER_SIG])).rows[0]
    assert.deepEqual(gone, { a: null, b: null })
    const scanAfter = await stuckScan()
    assert.equal(scanAfter.holderFunction, false, 'câu dò chạy được khi chưa có V681')
    await db.query(v681.migration)
    pass('bản gỡ trả hai hàm về bản sau V670, xoá hai hàm mới; câu dò chạy được khi chưa có V681; apply lại được')

    console.log(`\n${checks} nhóm đạt.`)
    if (notes.length) console.log('Ghi chú dựng DB:\n  ' + notes.join('\n  '))
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })

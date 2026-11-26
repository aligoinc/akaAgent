#!/usr/bin/env node
// V670 "Chạy cùng lúc": kiểm trên PostgreSQL 17 cục bộ dùng một lần (không chạm DB thật, không mạng).
//   1. File migration / bản gỡ = bản sinh (scripts/build-v670-sql.cjs).
//   2. DB thử dựng như bộ kịch bản engine v2 (bootstrap.cjs, có V558 / V564 / V571 / V576), rồi cài đúng 6 hàm ở bản V670 dựng trên (md5
//      khớp): claim sau V667 (V666 loại trừ gửi + V667 nơi chạy 'server', scripts/build-v667-sql.cjs) và 5 hàm production 26/11 từ
//      scripts/fixtures/campaign-parallel-run/live-20261126.json, để preflight của V670 chạy như trên production. Apply thật V666 → V667 →
//      V670: scripts/campaign-parallel-run-v670-apply-smoke.cjs.
//   3. Trước V670 ghi lại kết quả các lần nhận lượt của chiến dịch không tích; sau V670 chạy lại đúng chuỗi đó: kết quả phải giống hệt
//      ("không tích thì không đổi gì").
//   4. Sau V670: chiến dịch có tích chạy cạnh chiến dịch thường; mỗi loại một chiến dịch; không tích cùng loại thì chờ; chung thao tác
//      thì chờ; loại chưa bật / tài khoản không phải Zalo giữ làn chính; release / close_stale giữ tài khoản "đang chạy" khi làn khác còn;
//      health không lỗi khi một tài khoản có nhiều lease; create_control_campaign_v2 ghi parallelRunEnabled; update_control_campaign_atomic ghi
//      khoá parallel_run_enabled khi có, không có thì giữ; parallel_wait_v1 giải thích.
//   5. Chạy lại p1 / p2 / p3 bị chặn; bản gỡ trả 6 hàm về bản trước V670 (claim về thân V667) và xoá cột.
// Chạy: node scripts/campaign-parallel-run-v670-smoke.cjs   (cần PostgreSQL 17 Homebrew và module pg của akaAgentChatApi)
'use strict'
process.env.SCENARIO_FACEBOOK_MIGRATIONS = '1'
process.env.SCENARIO_TARGET_CHECK = '1'
process.env.SCENARIO_ORPHAN_RUNS = '1'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { bootstrap } = require('./engine-v2-scenarios/bootstrap.cjs')
const v670 = require('./build-v670-sql.cjs')

const PORT = Number(process.env.V670_TEST_PORT || 55665)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

const STAFF = 6650, ORG = 665
const PHONE_ACTIONS = [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }, { code: 'zalo_add_friend', required: false }]
const GROUP_MEMBER_ACTIONS = [{ code: 'zalo_message_stranger' }, { code: 'zalo_add_friend', required: false }]
const CANCEL_ACTIONS = [{ code: 'zalo_cancel_sent_friend_request', quota: false }]
const JOIN_ACTIONS = [{ code: 'zalo_join_group_link' }]
// Đúng kế hoạch nhận lượt của lõi (zaloAddGroupMemberClaimPlan): "Thêm thành viên" khai thêm Tìm SĐT, không bắt buộc.
const ADD_MEMBER_ACTIONS = [{ code: 'zalo_add_group_member' }, { code: 'zalo_find_phone_user', required: false }]

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v670-' })
  const db = await connect()
  try {
    // ---- 1. File = bản sinh --------------------------------------------------------------------------------------------------
    for (const [key, name] of [['p1', v670.NAMES.p1], ['p2', v670.NAMES.p2], ['p3', v670.NAMES.p3], ['rollback', v670.NAMES.rollback]]) {
      assert.equal(fs.readFileSync(path.join(ROOT, 'migrations', `${name}.sql`), 'utf8'), v670[key], `${name}.sql = bản sinh`)
    }
    pass('3 phần migration và bản gỡ đúng bản sinh')

    // ---- 2. DB thử như production --------------------------------------------------------------------------------------------
    const notes = []
    await bootstrap(db, notes)
    await require('./fixtures/campaign-parallel-run/setup.cjs').installLive(db, notes)
    pass('cụm thử có 6 hàm đúng bản V670 dựng trên (claim sau V667; release, close_stale, health, create_control_campaign_v2, update_control_campaign_atomic production 26/11)')

    let nextId = 6650000
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org V670', true)`, [ORG])
    const account = async ({ platform = 'zalo' } = {}) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
          is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE
        VALUES ($1, 'TK V670', $2, 'đã đăng nhập', 'chờ xử lý', true, false, $3, $4, false, false)`, [id, platform, STAFF, ORG])
      return id
    }
    const campaign = async (accountId, actionId, { tick = false, name = null, rows = 3 } = {}) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, extra_settings)
        OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', now() - interval '1 minute', false, $5, $6, '{}'::jsonb)`,
        [id, name || `CD ${id}`, actionId, accountId, STAFF, ORG])
      if (tick) await db.query(`UPDATE public.auto_campaigns SET parallel_run_enabled = true WHERE id = $1`, [id])
      for (let i = 0; i < rows; i++) {
        await db.query(`INSERT INTO public.auto_campaign_input_data(campaign_id, name, phone, uid, status, is_delete)
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, `Data ${i}`, `09${String(id).slice(-6)}${i}`, `uid${id}${i}`])
      }
      return id
    }
    const claim = async (accountId, campaignId, actions, extra = {}) => (await db.query(`SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r`,
      [JSON.stringify({ staffId: STAFF, accountId, campaignId, runnerId: 'test-runner', runtimeTarget: 'desktop', actions, ...extra })])).rows[0].r
    const leases = async accountId => (await db.query(`SELECT * FROM public.auto_engine_leases WHERE account_id = $1 ORDER BY 1`, [accountId])).rows
    const accountStatus = async id => (await db.query(`SELECT status FROM public.auto_accounts WHERE id = $1`, [id])).rows[0].status
    const norm = r => ({ status: r.status, ...(r.reason ? { reason: r.reason } : {}), ...(r.target ? { target: r.target.name } : {}) })

    // ---- 3. Không tích: chuỗi nhận lượt trước / sau V670 giống hệt ----------------------------------------------------------
    const sequence = async () => {
      const acc = await account()
      const m1 = await campaign(acc, 'zalo_message_phone')
      const m2 = await campaign(acc, 'zalo_message_phone')
      const c1 = await campaign(acc, 'zalo_cancel_sent_friend_request')
      const j1 = await campaign(acc, 'zalo_join_group_link')
      const out = []
      const first = await claim(acc, m1, PHONE_ACTIONS)
      out.push(norm(first))
      out.push(norm(await claim(acc, m2, PHONE_ACTIONS)))
      out.push(norm(await claim(acc, c1, CANCEL_ACTIONS)))
      out.push(norm(await claim(acc, j1, JOIN_ACTIONS)))
      out.push(norm(await claim(acc, m1, PHONE_ACTIONS, { leaseToken: first.leaseToken })))
      out.push((await leases(acc)).length)
      return out
    }
    const before = await sequence()
    assert.deepEqual(before.slice(0, 4).map(x => x.status), ['claimed', 'busy', 'busy', 'busy'])

    // ---- Apply V670 ------------------------------------------------------------------------------------------------------------
    await db.query(v670.p1)
    await db.query(v670.p2)
    await db.query(v670.p3)
    for (const [key, d] of Object.entries(v670.defs)) {
      const got = (await db.query(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m, p.proacl::text AS acl
        FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [d.sig])).rows[0]
      assert.equal(got.m, d.md5, `${key}: md5 bản mới`)
    }
    assert.deepEqual((await db.query(`SELECT id FROM public.auto_campaign_actions WHERE allow_parallel_run ORDER BY id`)).rows.map(r => r.id),
      [...v670.PARALLEL_ACTIONS].sort())
    assert.equal((await db.query(`SELECT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'parallel_run_enabled', 'UPDATE') AS ok`)).rows[0].ok, true)
    assert.equal((await db.query(`SELECT has_function_privilege('aka_agent_desktop', $1, 'EXECUTE') AS ok`, [v670.NEW_SIG])).rows[0].ok, true)
    assert.equal((await db.query(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS ok`, [v670.NEW_SIG])).rows[0].ok, false)
    pass('apply p1 → p2 → p3: md5 6 hàm mới, 3 loại bật, quyền cột Desktop, quyền hàm mới (anon không gọi được)')

    for (const [part, sql] of [['p1', v670.p1], ['p2', v670.p2], ['p3', v670.p3]]) {
      await assert.rejects(db.query(sql), /đã chạy/, `${part} chạy lại bị chặn`)
      await db.query('ROLLBACK').catch(() => {})
    }
    pass('chạy lại p1 / p2 / p3 bị chặn')

    const after = await sequence()
    assert.deepEqual(after, before, 'không tích: kết quả nhận lượt giống hệt trước V670')
    pass(`không tích: chuỗi nhận lượt giống hệt trước V670 (${JSON.stringify(after.slice(0, 4).map(x => x.status))})`)

    // ---- 4. Có tích ------------------------------------------------------------------------------------------------------------
    {
      const acc = await account()
      const msg = await campaign(acc, 'zalo_message_group_member', { name: 'Nhắn tin thành viên nhóm' })
      const cancel1 = await campaign(acc, 'zalo_cancel_sent_friend_request', { tick: true, name: 'Huỷ lời mời đợt 1' })
      const cancel2 = await campaign(acc, 'zalo_cancel_sent_friend_request', { tick: true, name: 'Huỷ lời mời đợt 2' })
      const cancelPlain = await campaign(acc, 'zalo_cancel_sent_friend_request', { name: 'Huỷ lời mời không tích' })
      const add = await campaign(acc, 'zalo_add_group_member', { tick: true })
      const join = await campaign(acc, 'zalo_join_group_link', { tick: true })
      const m = await claim(acc, msg, GROUP_MEMBER_ACTIONS)
      assert.equal(m.status, 'claimed')
      const c1 = await claim(acc, cancel1, CANCEL_ACTIONS)
      assert.equal(c1.status, 'claimed', 'Huỷ lời mời có tích chạy cạnh Nhắn tin thành viên nhóm')
      const a1 = await claim(acc, add, ADD_MEMBER_ACTIONS)
      const j1 = await claim(acc, join, JOIN_ACTIONS)
      assert.equal(a1.status, 'claimed'); assert.equal(j1.status, 'claimed')
      const ls = await leases(acc)
      assert.deepEqual(ls.map(l => l.lane).sort(), ['main', 'zalo_add_group_member', 'zalo_cancel_sent_friend_request', 'zalo_join_group_link'])
      pass('4 làn cùng lúc trên một tài khoản: Nhắn tin thành viên nhóm (main) + Huỷ lời mời + Thêm thành viên + Tham gia group')

      const c2 = await claim(acc, cancel2, CANCEL_ACTIONS)
      assert.equal(c2.status, 'busy', 'Huỷ lời mời có tích thứ hai chờ (cùng làn)')
      pass('mỗi loại một chiến dịch: Huỷ lời mời có tích thứ hai nhận busy')

      // Nhả làn chính (giả nơi chạy đã chốt hết data của lượt): chiến dịch không tích cùng loại với làn đang chạy thì chờ.
      await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported' WHERE lease_token = $1`, [m.leaseToken])
      const rel = (await db.query(`SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [acc, m.leaseToken])).rows[0].r
      assert.equal(rel.ok, true)
      assert.equal(await accountStatus(acc), 'đang chạy', 'nhả làn chính khi làn khác còn: tài khoản vẫn "đang chạy"')
      const plain = await claim(acc, cancelPlain, CANCEL_ACTIONS)
      assert.equal(plain.status, 'parallel_wait'); assert.equal(plain.reason, 'same_type')
      assert.equal(plain.campaignName, 'Huỷ lời mời đợt 1'); assert.equal(plain.campaignId, cancel1)
      assert.equal((await leases(acc)).some(l => l.campaign_id === cancelPlain), false, 'parallel_wait không giữ chỗ')
      const wait = (await db.query(`SELECT public.aka_agent_engine_parallel_wait_v1($1) AS r`, [cancelPlain])).rows[0].r
      assert.equal(wait.reason, 'same_type'); assert.equal(wait.campaignName, 'Huỷ lời mời đợt 1')
      const wait2 = (await db.query(`SELECT public.aka_agent_engine_parallel_wait_v1($1) AS r`, [cancel2])).rows[0].r
      assert.equal(wait2.reason, 'same_type', 'có tích chờ cùng làn: lý do cùng loại')
      assert.equal((await db.query(`SELECT public.aka_agent_engine_parallel_wait_v1($1) AS r`, [msg])).rows[0].r, null, 'chiến dịch không phải chờ: NULL')
      pass('không tích cùng loại với làn đang chạy: parallel_wait same_type, kèm tên chiến dịch đang chạy; không giữ chỗ; parallel_wait_v1 giải thích đúng')

      // Chiến dịch không tích khác loại chạy luôn ở làn chính dù các làn có tích đang chạy.
      const msg2 = await campaign(acc, 'zalo_message_group_member')
      assert.equal((await claim(acc, msg2, GROUP_MEMBER_ACTIONS)).status, 'claimed', 'không tích khác loại: chạy luôn, không chờ làn có tích')
      pass('chiến dịch không tích (loại khác) không chờ chiến dịch có tích')

      const h = (await db.query(`SELECT public.aka_agent_engine_health_v1(60) AS r`)).rows[0].r
      assert.ok(h, 'health trả kết quả')
      pass('health_v1 chạy được khi một tài khoản có nhiều lease')

      // close_stale: lease hết hạn quá lâu của một làn bị dọn, tài khoản vẫn "đang chạy" vì làn khác còn hạn.
      await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported' WHERE lease_token = $1`, [j1.leaseToken])
      await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '2 hours' WHERE lease_token = $1`, [j1.leaseToken])
      await db.query(`SELECT public.aka_agent_engine_close_stale_v1(200)`)
      assert.equal((await leases(acc)).some(l => l.lease_token === j1.leaseToken), false, 'lease hết hạn đã dọn')
      assert.equal(await accountStatus(acc), 'đang chạy')
      pass('close_stale dọn lease hết hạn của một làn, tài khoản vẫn "đang chạy" khi làn khác còn hạn')

      // Mọi làn kết thúc: tài khoản về "chờ xử lý" như trước.
      for (const tok of [c1.leaseToken, a1.leaseToken]) {
        await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported' WHERE lease_token = $1`, [tok])
      }
      const lastMain = (await leases(acc)).find(l => l.lane === 'main')
      await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported' WHERE lease_token = $1`, [lastMain.lease_token])
      for (const tok of [c1.leaseToken, a1.leaseToken, lastMain.lease_token]) {
        assert.equal((await db.query(`SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [acc, tok])).rows[0].r.ok, true)
      }
      assert.equal(await accountStatus(acc), 'chờ xử lý', 'mọi làn nhả: tài khoản về "chờ xử lý"')
      pass('nhả hết các làn: tài khoản về "chờ xử lý" như trước')
    }
    {
      // Cuộc đua (giả lập A, seed 6): một làn nhả chỗ (release / close_stale) đúng lúc làn khác của cùng tài khoản đang nhận lượt. Claim giữ
      // khoá dòng tài khoản tới hết giao dịch và lease mới chưa commit, nên câu trả tài khoản về "chờ xử lý" phải chụp dữ liệu sau khi claim
      // xong, không thì tài khoản về "chờ xử lý" trong khi làn kia đang chạy. Kết nối thứ hai mở giao dịch, gọi claim, chưa commit.
      const db2 = await connect()
      const pid = (await db.query('SELECT pg_backend_pid() AS p')).rows[0].p
      const waitBlocked = async () => {
        for (let i = 0; i < 200; i++) {
          const r = (await db2.query(`SELECT wait_event_type AS w FROM pg_stat_activity WHERE pid = $1`, [pid])).rows[0]
          if (r?.w === 'Lock') return
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error('release / close_stale không chờ khoá dòng tài khoản')
      }
      const claimOpen = async (accountId, campaignId, actions) => {
        await db2.query('BEGIN')
        return (await db2.query(`SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r`,
          [JSON.stringify({ staffId: STAFF, accountId, campaignId, runnerId: 'test-runner-2', runtimeTarget: 'desktop', actions })])).rows[0].r
      }
      const finishRuns = tok => db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported' WHERE lease_token = $1`, [tok])
      try {
        // (a) Làn riêng nhả trong lúc làn chính nhận lượt.
        {
          const acc = await account()
          const join = await campaign(acc, 'zalo_join_group_link', { tick: true })
          const msg = await campaign(acc, 'zalo_message_phone')
          const j = await claim(acc, join, JOIN_ACTIONS)
          assert.equal(j.status, 'claimed')
          await finishRuns(j.leaseToken)
          const m = await claimOpen(acc, msg, PHONE_ACTIONS)
          assert.equal(m.status, 'claimed', JSON.stringify(m))
          const releasing = db.query(`SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [acc, j.leaseToken])
          await waitBlocked()
          await db2.query('COMMIT')
          assert.equal((await releasing).rows[0].r.ok, true)
          assert.equal(await accountStatus(acc), 'đang chạy', '(a) làn chính vừa nhận lượt: tài khoản vẫn "đang chạy"')
        }
        // (b) Làn chính nhả trong lúc chiến dịch có tích nhận lượt đầu ở làn riêng (lease làn riêng chưa có trước đó).
        {
          const acc = await account()
          const msg = await campaign(acc, 'zalo_message_phone')
          const cancel = await campaign(acc, 'zalo_cancel_sent_friend_request', { tick: true })
          const m = await claim(acc, msg, PHONE_ACTIONS)
          assert.equal(m.status, 'claimed')
          await finishRuns(m.leaseToken)
          const c = await claimOpen(acc, cancel, CANCEL_ACTIONS)
          assert.equal(c.status, 'claimed', JSON.stringify(c))
          const releasing = db.query(`SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [acc, m.leaseToken])
          await waitBlocked()
          await db2.query('COMMIT')
          assert.equal((await releasing).rows[0].r.ok, true)
          assert.equal(await accountStatus(acc), 'đang chạy', '(b) làn riêng vừa nhận lượt: tài khoản vẫn "đang chạy"')
        }
        // (c) Job dọn lease hết hạn của một làn trong lúc làn khác nhận lượt: job không chờ khoá dòng tài khoản (giữ khoá cả lô lease, chờ thì
        // có thể khoá chéo với claim), để lease đó cho lần chạy sau; lần chạy sau dọn, tài khoản vẫn "đang chạy" vì làn kia còn lease.
        {
          const acc = await account()
          const join = await campaign(acc, 'zalo_join_group_link', { tick: true })
          const msg = await campaign(acc, 'zalo_message_phone')
          const j = await claim(acc, join, JOIN_ACTIONS)
          assert.equal(j.status, 'claimed')
          await finishRuns(j.leaseToken)
          await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '2 hours' WHERE lease_token = $1`, [j.leaseToken])
          const m = await claimOpen(acc, msg, PHONE_ACTIONS)
          assert.equal(m.status, 'claimed', JSON.stringify(m))
          await db.query(`SET statement_timeout = '3s'`)
          try { await db.query(`SELECT public.aka_agent_engine_close_stale_v1(200) AS r`) } finally { await db.query(`SET statement_timeout = 0`) }
          assert.equal((await leases(acc)).some(l => l.lease_token === j.leaseToken), true, '(c) tài khoản đang bị giữ: để lease cho lần chạy sau')
          await db2.query('COMMIT')
          assert.equal(await accountStatus(acc), 'đang chạy')
          await db.query(`SELECT public.aka_agent_engine_close_stale_v1(200) AS r`)
          assert.equal((await leases(acc)).some(l => l.lease_token === j.leaseToken), false, '(c) lần chạy sau: lease hết hạn đã dọn')
          assert.equal(await accountStatus(acc), 'đang chạy', '(c) làn khác vừa nhận lượt: tài khoản vẫn "đang chạy"')
        }
        // (e) Hai làn nhả cùng lúc: tài khoản về "chờ xử lý" (bản trước sửa: mỗi lần nhả thấy lease của lần nhả kia chưa commit, tài khoản kẹt
        // "đang chạy" khi không còn làn nào).
        {
          const acc = await account()
          const join = await campaign(acc, 'zalo_join_group_link', { tick: true })
          const msg = await campaign(acc, 'zalo_message_phone')
          const j = await claim(acc, join, JOIN_ACTIONS)
          const m = await claim(acc, msg, PHONE_ACTIONS)
          assert.equal(j.status, 'claimed'); assert.equal(m.status, 'claimed')
          await finishRuns(j.leaseToken); await finishRuns(m.leaseToken)
          await db2.query('BEGIN')
          assert.equal((await db2.query(`SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [acc, j.leaseToken])).rows[0].r.ok, true)
          const releasing = db.query(`SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [acc, m.leaseToken])
          await waitBlocked()
          await db2.query('COMMIT')
          assert.equal((await releasing).rows[0].r.ok, true)
          assert.equal((await leases(acc)).length, 0)
          assert.equal(await accountStatus(acc), 'chờ xử lý', '(e) hai làn nhả cùng lúc: tài khoản về "chờ xử lý"')
        }
        // (c2) Job dọn lease làn chính hết hạn đúng lúc chiến dịch có tích nhận lượt đầu ở làn riêng (lease làn riêng chưa commit, tài khoản chưa
        // có lease làn riêng nào khác): tài khoản này chưa có làn riêng nên job khoá dòng tài khoản kiểu chờ (như câu cập nhật cũ), chờ claim xong
        // rồi mới xét, thấy lease làn riêng nên tài khoản vẫn "đang chạy".
        {
          const acc = await account()
          const msg = await campaign(acc, 'zalo_message_phone')
          const cancel = await campaign(acc, 'zalo_cancel_sent_friend_request', { tick: true })
          const m = await claim(acc, msg, PHONE_ACTIONS)
          assert.equal(m.status, 'claimed')
          await finishRuns(m.leaseToken)
          await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '2 hours' WHERE lease_token = $1`, [m.leaseToken])
          const c = await claimOpen(acc, cancel, CANCEL_ACTIONS)
          assert.equal(c.status, 'claimed', JSON.stringify(c))
          const closing = db.query(`SELECT public.aka_agent_engine_close_stale_v1(200) AS r`)
          await waitBlocked()
          await db2.query('COMMIT')
          await closing
          assert.equal((await leases(acc)).some(l => l.lease_token === m.leaseToken), false, '(c2) lease làn chính hết hạn đã dọn')
          assert.equal(await accountStatus(acc), 'đang chạy', '(c2) làn riêng vừa nhận lượt: tài khoản vẫn "đang chạy"')
        }
        // (d) Tài khoản không ở "đang chạy" (câu cập nhật không khớp nên câu cũ không khoá dòng): release không chờ khoá dòng tài khoản dù có
        // giao dịch khác đang giữ, như trước V670.
        {
          const acc = await account()
          const msg = await campaign(acc, 'zalo_message_phone')
          const m = await claim(acc, msg, PHONE_ACTIONS)
          assert.equal(m.status, 'claimed')
          await finishRuns(m.leaseToken)
          await db.query(`UPDATE public.auto_accounts SET status = 'tạm dừng' WHERE id = $1`, [acc])
          await db2.query('BEGIN')
          await db2.query(`SELECT 1 FROM public.auto_accounts WHERE id = $1 FOR UPDATE`, [acc])
          const started = Date.now()
          // Hỏng (release chờ khoá) thì báo lỗi sau 3 giây thay vì treo bài kiểm.
          await db.query(`SET statement_timeout = '3s'`)
          let rel
          try { rel = (await db.query(`SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [acc, m.leaseToken])).rows[0].r } finally {
            await db.query(`SET statement_timeout = 0`)
          }
          assert.equal(rel.ok, true)
          assert.ok(Date.now() - started < 1500, `(d) release không chờ khoá dòng tài khoản (${Date.now() - started} ms)`)
          await db2.query('ROLLBACK')
          assert.equal(await accountStatus(acc), 'tạm dừng')
        }
      } finally {
        await db2.query('ROLLBACK').catch(() => {})
        await db2.end().catch(() => {})
      }
      pass('nhả làn / dọn lease hết hạn đúng lúc làn khác của tài khoản đang nhận lượt: tài khoản vẫn "đang chạy" (4 ca); hai làn nhả cùng lúc về "chờ xử lý"; tài khoản không "đang chạy" thì release không chờ khoá')
    }
    {
      // Có tích khi chiến dịch không tích cùng loại đang chạy ở làn chính: chờ.
      const acc = await account()
      const plain = await campaign(acc, 'zalo_add_group_member')
      const ticked = await campaign(acc, 'zalo_add_group_member', { tick: true })
      assert.equal((await claim(acc, plain, ADD_MEMBER_ACTIONS)).status, 'claimed')
      const r = await claim(acc, ticked, ADD_MEMBER_ACTIONS)
      assert.equal(r.status, 'parallel_wait'); assert.equal(r.reason, 'same_type')
      pass('có tích nhưng chiến dịch không tích cùng loại đang chạy: parallel_wait same_type')
    }
    {
      // "Thêm thành viên" có tích và "Nhắn tin theo SĐT" cùng Tìm SĐT: chờ nhau (anh chọn "Vẫn chờ, sửa lý do", 26/11). "Lý do đang chờ"
      // giải thích đúng cả khi nơi gọi gửi mã thao tác lõi (Desktop) lẫn khi không gửi.
      const acc = await account()
      const phone = await campaign(acc, 'zalo_message_phone', { name: 'Nhắn tin SĐT' })
      const add = await campaign(acc, 'zalo_add_group_member', { tick: true, name: 'Thêm thành viên có tích' })
      const reason = async (id, codes) => (await db.query(codes ? `SELECT public.aka_agent_engine_parallel_wait_v1($1, $2::text[]) AS r`
        : `SELECT public.aka_agent_engine_parallel_wait_v1($1) AS r`, codes ? [id, codes] : [id])).rows[0].r
      const p1 = await claim(acc, phone, PHONE_ACTIONS)
      assert.equal(p1.status, 'claimed')
      const wa = await claim(acc, add, ADD_MEMBER_ACTIONS)
      assert.equal(wa.status, 'parallel_wait'); assert.equal(wa.reason, 'same_action'); assert.deepEqual(wa.actionCodes, ['zalo_find_phone_user'])
      assert.equal(wa.campaignName, 'Nhắn tin SĐT')
      for (const codes of [null, ADD_MEMBER_ACTIONS.map(a => a.code)]) {
        const r = await reason(add, codes)
        assert.equal(r?.campaignId, phone, `lý do chờ (${codes ? 'có' : 'không'} gửi mã): đúng chiến dịch chặn`)
        assert.equal(r.reason, 'same_action'); assert.deepEqual(r.actionCodes, ['zalo_find_phone_user'])
      }
      assert.equal(await reason(add, ['zalo_add_group_member']), null, 'gửi mã thì DB xét đúng các mã đó')
      // Chiều ngược: Thêm thành viên đang chạy, Nhắn tin theo SĐT không tích chờ.
      await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported' WHERE lease_token = $1`, [p1.leaseToken])
      assert.equal((await db.query(`SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [acc, p1.leaseToken])).rows[0].r.ok, true)
      const a1 = await claim(acc, add, ADD_MEMBER_ACTIONS)
      assert.equal(a1.status, 'claimed')
      const phone2 = await campaign(acc, 'zalo_message_phone', { name: 'Nhắn tin SĐT 2' })
      const wp = await claim(acc, phone2, PHONE_ACTIONS)
      assert.equal(wp.status, 'parallel_wait'); assert.equal(wp.reason, 'same_action'); assert.deepEqual(wp.actionCodes, ['zalo_find_phone_user'])
      for (const codes of [null, PHONE_ACTIONS.map(a => a.code)]) {
        const r = await reason(phone2, codes)
        assert.equal(r?.campaignId, add, `chiều ngược (${codes ? 'có' : 'không'} gửi mã): đúng chiến dịch chặn`)
        assert.equal(r.reason, 'same_action'); assert.deepEqual(r.actionCodes, ['zalo_find_phone_user'])
      }
      pass('Thêm thành viên có tích ↔ Nhắn tin theo SĐT: chờ nhau vì cùng Tìm SĐT; Lý do đang chờ giải thích đúng (có / không gửi mã thao tác)')
    }
    {
      // Chung thao tác (bật thử loại nhắn tin cho bài kiểm): làn nhắn tin thành viên nhóm chờ làn nhắn tin SĐT.
      await db.query(`UPDATE public.auto_campaign_actions SET allow_parallel_run = true WHERE id IN ('zalo_message_phone', 'zalo_message_group_member')`)
      const acc = await account()
      const phone = await campaign(acc, 'zalo_message_phone', { tick: true, name: 'SĐT có tích' })
      const member = await campaign(acc, 'zalo_message_group_member', { tick: true })
      assert.equal((await claim(acc, phone, PHONE_ACTIONS)).status, 'claimed')
      const r = await claim(acc, member, GROUP_MEMBER_ACTIONS)
      assert.equal(r.status, 'parallel_wait'); assert.equal(r.reason, 'same_action')
      assert.deepEqual(r.actionCodes, ['zalo_add_friend', 'zalo_message_stranger'])
      const w = (await db.query(`SELECT public.aka_agent_engine_parallel_wait_v1($1) AS r`, [member])).rows[0].r
      assert.equal(w.reason, 'same_action'); assert.deepEqual(w.actionCodes, ['zalo_add_friend', 'zalo_message_stranger'])
      await db.query(`UPDATE public.auto_campaign_actions SET allow_parallel_run = false WHERE id IN ('zalo_message_phone', 'zalo_message_group_member')`)
      pass('chung thao tác: parallel_wait same_action, kèm mã thao tác dùng chung')
    }
    {
      // Có tích nhưng loại chưa bật, hoặc tài khoản không phải Zalo: làn chính như cũ.
      const acc = await account()
      const msg = await campaign(acc, 'zalo_message_phone')
      const tickedNotAllowed = await campaign(acc, 'zalo_message_group_member', { tick: true })
      assert.equal((await claim(acc, msg, PHONE_ACTIONS)).status, 'claimed')
      assert.equal((await claim(acc, tickedNotAllowed, GROUP_MEMBER_ACTIONS)).status, 'busy', 'loại chưa bật: làn chính')
      const fb = await account({ platform: 'web' })
      const webCampaign = await campaign(fb, 'zalo_cancel_sent_friend_request', { tick: true })
      const lane = (await db.query(`SELECT public.aka_agent_engine_parallel_wait_v1($1) AS r`, [webCampaign])).rows[0].r
      assert.equal(lane, null)
      pass('có tích mà loại chưa bật: làn chính (busy); tài khoản không phải Zalo không có làn riêng')
    }
    {
      // Làn của chiến dịch đổi giữa hai lượt (khách bỏ tích / akaBiz tắt loại) khi lượt trước dừng đột ngột, lease làn cũ còn hạn (giả lập A
      // seed 9): busy như lease còn hạn của lượt trước (trước đây parallel_wait mà chiến dịch chặn là chính nó); không chạy ở hai làn cùng lúc.
      for (const change of ['bỏ tích', 'akaBiz tắt loại']) {
        const acc = await account()
        const join = await campaign(acc, 'zalo_join_group_link', { tick: true })
        const j = await claim(acc, join, JOIN_ACTIONS)
        assert.equal(j.status, 'claimed')
        if (change === 'bỏ tích') await db.query(`UPDATE public.auto_campaigns SET parallel_run_enabled = false WHERE id = $1`, [join])
        else await db.query(`UPDATE public.auto_campaign_actions SET allow_parallel_run = false WHERE id = 'zalo_join_group_link'`)
        try {
          const again = await claim(acc, join, JOIN_ACTIONS)
          assert.equal(again.status, 'busy', `${change}: ${JSON.stringify(again)}`)
          assert.equal((await leases(acc)).length, 1, `${change}: không giữ chỗ ở làn chính khi lease làn cũ còn hạn`)
          assert.equal((await db.query(`SELECT public.aka_agent_engine_parallel_wait_v1($1) AS r`, [join])).rows[0].r, null)
          await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported' WHERE lease_token = $1`, [j.leaseToken])
          assert.equal((await db.query(`SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [acc, j.leaseToken])).rows[0].r.ok, true)
          const next = await claim(acc, join, JOIN_ACTIONS)
          assert.equal(next.status, 'claimed', `${change}: lease làn cũ nhả xong thì chạy ở làn chính`)
          assert.deepEqual((await leases(acc)).map(l => l.lane), ['main'])
        } finally {
          await db.query(`UPDATE public.auto_campaign_actions SET allow_parallel_run = true WHERE id = 'zalo_join_group_link'`)
        }
      }
      pass('đổi làn giữa hai lượt khi lease làn cũ còn hạn: busy, không chạy ở hai làn; nhả xong chạy ở làn mới')
    }
    {
      // Web / iOS tạo chiến dịch.
      const acc = await account()
      const mk = async (key, payload) => (await db.query(`SELECT public.create_control_campaign_v2($1, $2, $3, $4::jsonb) AS r`,
        [STAFF, ORG, key, JSON.stringify({ name: key, actionId: 'zalo_cancel_sent_friend_request', accountId: acc, ...payload })])).rows[0].r
      const flag = async r => (await db.query(`SELECT parallel_run_enabled AS v FROM public.auto_campaigns WHERE id = $1`, [r.campaign_id])).rows[0].v
      assert.equal(await flag(await mk('k-true', { parallelRunEnabled: true })), true)
      assert.equal(await flag(await mk('k-false', { parallelRunEnabled: false })), false)
      assert.equal(await flag(await mk('k-none', {})), false)
      pass('create_control_campaign_v2: parallelRunEnabled true → cột true; false / không gửi → false')
    }
    {
      // Web / iOS sửa chiến dịch (update_control_campaign_atomic): khoá parallel_run_enabled có thì ghi, không có thì giữ nguyên.
      const acc = await account()
      const id = await campaign(acc, 'zalo_cancel_sent_friend_request', { rows: 0 })
      await db.query(`UPDATE public.auto_campaigns SET status = 'tạm dừng', updated_at = now() WHERE id = $1`, [id])
      const update = async patch => {
        const at = (await db.query(`SELECT updated_at::text AS t FROM public.auto_campaigns WHERE id = $1`, [id])).rows[0].t
        return (await db.query(`SELECT public.update_control_campaign_atomic($1, $2, $3, $4::timestamptz, $5::jsonb) AS r`,
          [STAFF, ORG, id, at, JSON.stringify(patch)])).rows[0].r
      }
      const flag = async () => (await db.query(`SELECT parallel_run_enabled AS v FROM public.auto_campaigns WHERE id = $1`, [id])).rows[0].v
      assert.equal((await update({ parallel_run_enabled: true })).updated, true)
      assert.equal(await flag(), true, 'gửi true: tích')
      assert.equal((await update({ name: 'Đổi tên' })).updated, true)
      assert.equal(await flag(), true, 'không gửi khoá: giữ nguyên')
      assert.equal((await update({ parallel_run_enabled: false })).updated, true)
      assert.equal(await flag(), false, 'gửi false: bỏ tích')
      pass('update_control_campaign_atomic: gửi khoá thì ghi, không gửi thì giữ nguyên')
    }

    // ---- 4b. Tải của luồng không tích -------------------------------------------------------------------------------------------
    // DB thử theo đúng bộ chỉ mục production của auto_campaigns (đọc 26/11/2026: không có chỉ mục account_id thường, chỉ chỉ mục một phần theo
    // trạng thái) và 20.000 chiến dịch đệm cỡ dòng production, để câu đọc auto_campaigns theo tài khoản mà không dùng được chỉ mục lộ ra bằng
    // số buffer. Đo claim (lease mới), release, close_stale của tài khoản không tích sau V670, rồi sau bản gỡ (bản trước V670), so số buffer.
    const PROD_CAMPAIGN_INDEXES = new Set(['auto_campaigns_pkey', 'auto_campaigns_staff_id_idx', 'idx_auto_campaigns_app_access_held_account',
      'idx_auto_campaigns_data_group', 'idx_auto_campaigns_last_run_at', 'idx_auto_campaigns_secondary_account_id',
      'idx_sms_campaigns_account_status_schedule', 'uq_auto_campaigns_control_idempotency', 'uq_auto_campaigns_creation_bundle_child'])
    const droppedIndexes = []
    for (const r of (await db.query(`SELECT i.relname AS name, EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid) AS backed
        FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indrelid = 'public.auto_campaigns'::regclass`)).rows) {
      if (PROD_CAMPAIGN_INDEXES.has(r.name) || r.backed) continue
      await db.query(`DROP INDEX public."${r.name}"`)
      droppedIndexes.push(r.name)
    }
    await db.query(`CREATE INDEX IF NOT EXISTS idx_auto_campaigns_app_access_held_account ON public.auto_campaigns (account_id)
      WHERE status = 'đang chạy' OR runtime_claim_token IS NOT NULL OR runtime_unit_token IS NOT NULL`)
    await db.query(`SET session_replication_role = replica`)
    try {
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
          is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE
        SELECT 7700000 + g, 'Đệm ' || g, 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $1, $2, false, false FROM generate_series(1, 200) g`, [STAFF, ORG])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, extra_settings)
        OVERRIDING SYSTEM VALUE
        SELECT 7800000 + g, 'Đệm ' || g, 'zalo_message_phone', 7700001 + (g % 200), 'hoàn thành', now() - interval '1 day', false, $1, $2,
          jsonb_build_object('enableMessage', true, 'pad', repeat('x', 900))
        FROM generate_series(1, 20000) g`, [STAFF, ORG])
    } finally { await db.query(`SET session_replication_role = origin`) }
    await db.query(`ANALYZE public.auto_campaigns`)
    await db.query(`ANALYZE public.auto_accounts`)
    const heapPages = Number((await db.query(`SELECT relpages FROM pg_class WHERE oid = 'public.auto_campaigns'::regclass`)).rows[0].relpages)
    const buffersOf = async sql => {
      const plan = (await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)).rows[0]['QUERY PLAN'][0].Plan
      return Number(plan['Shared Hit Blocks'] || 0) + Number(plan['Shared Read Blocks'] || 0)
    }
    const lit = v => `'${String(v).replace(/'/g, "''")}'`
    // Đối chứng: câu kiểu bản V670 trước khi sửa (tài khoản có chiến dịch có tích không) quét cả bảng trên DB thử này, như trên production.
    const control = await buffersOf(`SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = 7700001 AND x.parallel_run_enabled LIMIT 1`)
    assert.ok(control > heapPages / 2, `đối chứng: câu theo account_id không dùng được chỉ mục phải quét bảng (${control} / ${heapPages} trang)`)
    const profile = async () => {
      const runs = { claim: [], release: [], close: [] }
      for (let i = 0; i < 5; i++) {
        const acc = await account()
        const c = await campaign(acc, 'zalo_message_phone', { rows: 2 })
        const ctx = JSON.stringify({ staffId: STAFF, accountId: acc, campaignId: c, runnerId: 'perf-runner', runtimeTarget: 'desktop', actions: PHONE_ACTIONS })
        runs.claim.push(await buffersOf(`SELECT public.aka_agent_engine_claim_target_v1(${lit(ctx)}::jsonb)`))
        const tok = (await db.query(`SELECT lease_token::text AS t FROM public.auto_engine_leases WHERE account_id = $1`, [acc])).rows[0].t
        await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported' WHERE lease_token = $1`, [tok])
        runs.release.push(await buffersOf(`SELECT public.aka_agent_engine_release_v1(${acc}, ${lit(tok)}::uuid)`))
        const acc2 = await account()
        const c2 = await campaign(acc2, 'zalo_message_phone', { rows: 2 })
        const r2 = await claim(acc2, c2, PHONE_ACTIONS)
        await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported' WHERE lease_token = $1`, [r2.leaseToken])
        await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '2 hours' WHERE lease_token = $1`, [r2.leaseToken])
        runs.close.push(await buffersOf(`SELECT public.aka_agent_engine_close_stale_v1(200)`))
      }
      // Hai lượt đầu để hàm dựng sẵn kế hoạch câu lệnh; lấy trung vị ba lượt sau.
      const med = xs => [...xs].slice(2).sort((a, b) => a - b)[1]
      return { claim: med(runs.claim), release: med(runs.release), close: med(runs.close) }
    }
    const loadV670 = await profile()

    // ---- 5. Bản gỡ -------------------------------------------------------------------------------------------------------------
    await db.query(v670.rollback)
    for (const [key, d] of Object.entries(v670.defs)) {
      const got = (await db.query(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m`, [d.sig])).rows[0].m
      assert.equal(got, d.liveMd5, `gỡ: ${key} về bản trước V670`)
    }
    const cols = (await db.query(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = 'public'
      AND ((table_name = 'auto_engine_leases' AND column_name IN ('lane', 'action_id', 'action_codes'))
        OR (table_name = 'auto_campaigns' AND column_name = 'parallel_run_enabled')
        OR (table_name = 'auto_campaign_actions' AND column_name = 'allow_parallel_run'))`)).rows
    assert.deepEqual(cols, [])
    assert.equal((await db.query(`SELECT to_regprocedure($1) AS f`, [v670.NEW_SIG])).rows[0].f, null)
    // Sau khi gỡ: chuỗi không tích vẫn như trước V670.
    assert.deepEqual(await sequence(), before)
    pass('bản gỡ: 6 hàm về bản trước V670 (claim về thân V667), xoá hàm mới và 5 cột; chuỗi không tích như trước V670')

    // ---- 4b (tiếp). Tải bản trước V670 (sau bản gỡ), so với V670 ----------------------------------------------------------------
    const loadBefore = await profile()
    for (const key of ['claim', 'release', 'close']) {
      assert.ok(loadV670[key] - loadBefore[key] <= 40,
        `tải ${key}: V670 ${loadV670[key]} buffer, trước V670 ${loadBefore[key]} (chiến dịch không tích không được tốn thêm quá 40 buffer)`)
    }
    pass(`tải luồng không tích (bảng auto_campaigns ${heapPages} trang, chỉ mục như production${droppedIndexes.length ? `, bỏ ${droppedIndexes.length} chỉ mục chỉ có ở DB thử` : ''}): `
      + `claim ${loadBefore.claim} → ${loadV670.claim}, release ${loadBefore.release} → ${loadV670.release}, close_stale ${loadBefore.close} → ${loadV670.close} buffer; `
      + `đối chứng câu quét bảng ${control} buffer`)
    console.log(`\nV670: ${checks} nhóm đạt. Ghi chú dựng DB: ${notes.length} bước.`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(err => { console.error(err); process.exitCode = 1 })

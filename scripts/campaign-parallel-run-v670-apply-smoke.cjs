#!/usr/bin/env node
// V670 "Chạy cùng lúc" apply đúng thứ tự trên production: V666 (loại trừ gửi) → V667 (engine v2 cho tài khoản Zalo Server trên VPS) → V670.
// DB thử dựng như production 26/11 rồi chạy thật migration V666 và V667 (scripts/fixtures/engine-v2-server/db.cjs, applyV667), không cài
// thân hàm bằng tay, rồi:
//   1. V670 p3 từ chối khi sổ chưa có V667 p2; có thì apply được, md5 6 hàm đúng bản sinh (claim dựng trên thân V667 thật).
//   2. Desktop: chiến dịch có tích chạy ở làn riêng cạnh chiến dịch thường trên tài khoản Zalo QR.
//   3. Bước kiểm loại trừ gửi của V666 vẫn chạy trong claim mới: lõi không báo sendExclusionRunner mà chiến dịch (có tích, làn riêng) có cấu
//      hình cần bản mới thì campaign_paused + ghi chú; lõi báo bản thì nhận lượt.
//   4. Nhánh nơi chạy 'server' của V667 vẫn chạy: công tắc tắt → not_enabled, tổ chức chạy Fly → runtime_not_owner, bật → nhận lượt ở làn
//      'main' với runtime_target 'server', báo xong, kết thúc lượt, nhả.
//   5. Gỡ: bản gỡ V667 từ chối khi V670 còn (claim không phải bản V667); gỡ V670 trả claim về thân V667, rồi gỡ V667 trả claim về thân V666.
// Không mạng, không dữ liệu khách.
//   CHAT_REPO=<thư mục có node_modules/pg> LC_ALL=C node scripts/campaign-parallel-run-v670-apply-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { buildV667Db } = require('./fixtures/engine-v2-server/db.cjs')
const { installLive } = require('./fixtures/campaign-parallel-run/setup.cjs')
const V667 = require('./build-v667-sql.cjs')
const v670 = require('./build-v670-sql.cjs')

let passed = 0
let failed = 0
let currentDb = null
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (e) {
    failed++; console.log(`FAIL ${name}: ${e.stack || e.message}`)
    await currentDb?.query('ROLLBACK').catch(() => {})
  }
}

const ORG = 6691        // tổ chức tắt cờ use_new_zalo_runtime: Server chạy trên VPS (App Server)
const ORG_FLY = 6692    // tổ chức bật cờ: Server chạy trên Fly
const STAFF = 669101
const STAFF_FLY = 669102
const PHONE_ACTIONS = [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }, { code: 'zalo_add_friend', required: false }]
const JOIN_ACTIONS = [{ code: 'zalo_join_group_link' }]
const CANCEL_ACTIONS = [{ code: 'zalo_cancel_sent_friend_request', quota: false }]
const DESKTOP_NOTE = 'akaAgent trên máy này là bản cũ nên chưa chạy được loại trừ theo Nhóm data, chiến dịch đã gửi hoặc nhiều Zalo. Hãy cập nhật akaAgent rồi bấm Tiếp tục.'
let seq = 6690000

async function main() {
  const T = await buildV667Db({ label: 'aka-v670-apply-', applyV667: true })
  const { db, one, q, md5Of } = T
  currentDb = db
  const id = () => ++seq
  const ins = async (table, rows) => {
    rows = Array.isArray(rows) ? rows : [rows]
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).map(r => r.column_name)
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols.includes(k))
    const list = keys.map(k => `"${k}"`).join(', ')
    await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`, [JSON.stringify(rows)])
  }
  const rejects = async (sql, re) => { try { await assert.rejects(db.query(sql), re) } finally { await db.query('ROLLBACK').catch(() => {}) } }
  const setting = async (key, value) => {
    await db.query(`DELETE FROM public.auto_system_settings WHERE key = $1`, [key])
    if (value !== undefined) await db.query(`INSERT INTO public.auto_system_settings (key, value, is_active) VALUES ($1, $2, true)`, [key, value])
  }
  try {
    // ------------------------------------------------------------------ DB: V666 + V667 đã chạy thật
    await check('DB thử: V666 và V667 p1 → p3 đã chạy thật, claim đúng thân V667 mà V670 dựng trên', async () => {
      assert.equal(await md5Of(V667.SIG.claim), v670.V667_CLAIM_MD5)
      assert.equal(v670.defs.claim.liveMd5, v670.V667_CLAIM_MD5)
      assert.ok((await one(`SELECT to_regprocedure('private.aka_agent_send_exclusion_claim_check(bigint,bigint,text)') r`)).r, 'hàm kiểm loại trừ gửi của V666')
    })
    // 5 hàm còn lại ở bản production 26/11 (DB thử của V667 không có hết) cùng cột / hàm phụ; claim giữ bản của V667; không ghi sổ.
    const notes = []
    await installLive(db, notes, { skip: ['claim'], ledger: false })
    for (const actionId of v670.PARALLEL_ACTIONS) {
      if (!(await one(`SELECT 1 AS x FROM public.auto_campaign_actions WHERE id = $1`, [actionId]))) {
        await ins('auto_campaign_actions', { id: actionId, name: actionId, flatform_type: 'zalo', is_active: true })
        notes.push(`thêm loại ${actionId}`)
      }
    }

    // ------------------------------------------------------------------ apply V670
    await check('V670 p3 từ chối khi sổ chưa có V667 p2; có thì apply p1 → p2 → p3 đúng md5 6 hàm', async () => {
      await db.query(v670.p1)
      await db.query(v670.p2)
      await rejects(v670.p3, new RegExp(`cần ${v670.V667_P2} trước`))
      assert.equal(await md5Of(V667.SIG.claim), v670.V667_CLAIM_MD5, 'claim giữ thân V667 khi p3 bị từ chối')
      await db.query(`INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('20261126999901', $1, '{}')`, [v670.V667_P2])
      await db.query(v670.p3)
      for (const [key, d] of Object.entries(v670.defs)) assert.equal(await md5Of(d.sig), d.md5, `md5 ${key}`)
      assert.ok((await one(`SELECT pg_get_functiondef(to_regprocedure($1)) d`, [V667.SIG.claim])).d
        .includes("private.aka_agent_send_exclusion_claim_check(v_campaign_id, v_account_id, p_ctx->>'sendExclusionRunner')"), 'claim còn bước kiểm loại trừ gửi')
    })

    // ------------------------------------------------------------------ dữ liệu nền
    await db.query(`INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES ($1, 'VPS', false), ($2, 'Fly', true) ON CONFLICT (id) DO NOTHING`, [ORG, ORG_FLY])
    await db.query(`UPDATE public.org_organization SET use_new_zalo_runtime = (id = $2) WHERE id IN ($1, $2)`, [ORG, ORG_FLY])
    await ins('org_staff', [{ id: STAFF, organization_id: ORG, username: 'v670a', password: 'pw', is_active: true },
      { id: STAFF_FLY, organization_id: ORG_FLY, username: 'v670b', password: 'pw', is_active: true }])
    const until = new Date(Date.now() + 30 * 86400e3).toISOString()
    for (const org of [ORG, ORG_FLY]) await ins('org_organization_product', { id: id(), organization_id: org, product_id: 16, is_deleted: false, expiration_date: until })
    const acc = async (staff, org, extra = {}) => {
      const accId = id()
      await ins('auto_accounts', { id: accId, name: 'Zalo ' + accId, flatform_type: 'zalo', login_status: 'đã đăng nhập', status: 'chờ xử lý',
        is_active: true, is_delete: false, staff_id: staff, organization_id: org, is_zalo_server: false, is_zalo_show_web: false, ...extra })
      return accId
    }
    const campaign = async (account, staff, org, actionId, { tick = false, extra = {}, rows = 2 } = {}) => {
      const cid = id()
      await ins('auto_campaigns', { id: cid, name: 'C' + cid, action_id: actionId, account_id: account, status: 'chờ xử lý', is_delete: false,
        staff_id: staff, organization_id: org, schedule: new Date(Date.now() - 60000).toISOString(), schedule_type: 'daily',
        extra_settings: { enableMessage: true, ...extra } })
      if (tick) await db.query(`UPDATE public.auto_campaigns SET parallel_run_enabled = true WHERE id = $1`, [cid])
      for (let i = 0; i < rows; i++) {
        const rid = id()
        await ins('auto_campaign_input_data', { id: rid, campaign_id: cid, status: 'chờ xử lý', is_delete: false, phone: `09${String(rid).slice(-8)}`,
          uid: `uid${rid}`, name: 'N' + rid })
      }
      return cid
    }
    const claim = async (staff, account, campaignId, runtime, actions, extra = {}) =>
      (await one('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) r', [JSON.stringify({ staffId: staff, accountId: account, campaignId,
        runnerId: `${runtime}:v670-apply`, runtimeTarget: runtime, actions, ...extra })])).r
    const release = async (account, lease) => (await one(`SELECT public.aka_agent_engine_release_v1($1, $2) r`, [account, lease])).r
    const leases = async account => q(`SELECT lane, runtime_target, campaign_id FROM public.auto_engine_leases WHERE account_id = $1 ORDER BY lane`, [account])
    const statusOf = async cid => one(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [cid])
    const runner = { sendExclusionRunner: '1' }

    // ------------------------------------------------------------------ Desktop: làn riêng
    await check('Desktop (Zalo QR): chiến dịch thường + Tham gia group có tích + Huỷ lời mời có tích nhận lượt cùng lúc, mỗi chiến dịch một làn', async () => {
      const QR = await acc(STAFF, ORG)
      const main = await campaign(QR, STAFF, ORG, 'zalo_message_phone')
      const join = await campaign(QR, STAFF, ORG, 'zalo_join_group_link', { tick: true })
      const cancel = await campaign(QR, STAFF, ORG, 'zalo_cancel_sent_friend_request', { tick: true })
      const a = await claim(STAFF, QR, main, 'desktop', PHONE_ACTIONS, runner)
      const b = await claim(STAFF, QR, join, 'desktop', JOIN_ACTIONS, runner)
      const c = await claim(STAFF, QR, cancel, 'desktop', CANCEL_ACTIONS, runner)
      for (const [label, r] of [['chính', a], ['tham gia group', b], ['huỷ lời mời', c]]) assert.equal(r.status, 'claimed', `${label}: ${JSON.stringify(r)}`)
      assert.deepEqual((await leases(QR)).map(l => [l.lane, l.runtime_target, Number(l.campaign_id)]),
        [['main', 'desktop', main], ['zalo_cancel_sent_friend_request', 'desktop', cancel], ['zalo_join_group_link', 'desktop', join]])
      const plainJoin = await campaign(QR, STAFF, ORG, 'zalo_join_group_link')
      const w = await claim(STAFF, QR, plainJoin, 'desktop', JOIN_ACTIONS, runner)
      assert.equal(w.status, 'busy', 'không tích: làn chính đang giữ, như trước ' + JSON.stringify(w))
    })

    // ------------------------------------------------------------------ V666 trong claim mới
    await check('bước kiểm loại trừ gửi (V666) vẫn chạy ở làn riêng: lõi không báo bản thì campaign_paused + ghi chú; lõi báo bản thì nhận lượt', async () => {
      const QR = await acc(STAFF, ORG)
      const dg = id()
      const selection = { [QR]: { groupId: null, blocklistIds: [], dataGroupIds: [dg] } }
      const old = await campaign(QR, STAFF, ORG, 'zalo_join_group_link', { tick: true })
      const fresh = await campaign(QR, STAFF, ORG, 'zalo_cancel_sent_friend_request', { tick: true })
      // Ghi lựa chọn loại trừ thẳng vào dòng (bỏ qua trigger lưu chiến dịch của V666: bài này chỉ kiểm bước nhận lượt).
      await db.query(`SET session_replication_role = replica`)
      try {
        await db.query(`UPDATE public.auto_campaigns SET extra_settings = extra_settings || jsonb_build_object('zaloSendExclusionsByAccountId', $2::jsonb)
          WHERE id = ANY($1::bigint[])`, [[old, fresh], JSON.stringify(selection)])
      } finally { await db.query(`SET session_replication_role = origin`) }
      const r1 = await claim(STAFF, QR, old, 'desktop', JOIN_ACTIONS)
      assert.equal(r1.status, 'campaign_paused', JSON.stringify(r1))
      assert.deepEqual(await statusOf(old), { status: 'tạm dừng', note: DESKTOP_NOTE })
      assert.equal((await leases(QR)).map(l => l.lane).join(','), 'zalo_join_group_link', 'làn riêng giữ chỗ tới khi bộ chạy nhả')
      assert.equal((await release(QR, r1.leaseToken)).ok, true)
      const r2 = await claim(STAFF, QR, fresh, 'desktop', CANCEL_ACTIONS, runner)
      assert.equal(r2.status, 'claimed', JSON.stringify(r2))
      assert.equal((await statusOf(fresh)).status === 'tạm dừng', false)
    })

    // ------------------------------------------------------------------ nơi chạy server (V667)
    let serverFlow = null
    await check('nơi chạy server (V667) sau V670: tắt → not_enabled; tổ chức chạy Fly → runtime_not_owner; bật → nhận lượt ở làn main, báo xong, nhả', async () => {
      const S1 = await acc(STAFF, ORG, { is_zalo_server: true })
      const AF = await acc(STAFF_FLY, ORG_FLY, { is_zalo_server: true })
      const c = await campaign(S1, STAFF, ORG, 'zalo_message_phone', { rows: 1 })
      await setting(V667.SETTING_KEY, '{"mode":"off","organizationIds":[]}')
      assert.equal((await claim(STAFF, S1, c, 'server', PHONE_ACTIONS, runner)).status, 'not_enabled')
      await setting(V667.SETTING_KEY, JSON.stringify({ mode: 'orgs', organizationIds: [ORG, ORG_FLY] }))
      const cf = await campaign(AF, STAFF_FLY, ORG_FLY, 'zalo_message_phone', { rows: 1 })
      assert.equal((await claim(STAFF_FLY, AF, cf, 'server', PHONE_ACTIONS, runner)).status, 'runtime_not_owner')
      const a = await claim(STAFF, S1, c, 'server', PHONE_ACTIONS, runner)
      assert.equal(a.status, 'claimed', JSON.stringify(a))
      assert.deepEqual((await leases(S1)).map(l => [l.lane, l.runtime_target]), [['main', 'server']])
      const rep = (await one(`SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, true, false) r`, [a.targetRunId, a.leaseToken,
        JSON.stringify([{ resultKey: 'v670-apply:1', actionCode: 'zalo_find_phone_user', ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' }])])).r
      assert.equal(rep.ok, true, JSON.stringify(rep))
      const n = await claim(STAFF, S1, c, 'server', PHONE_ACTIONS, { ...runner, leaseToken: a.leaseToken })
      assert.equal(n.status, 'no_target', JSON.stringify(n))
      const f = (await one(`SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, NULL) r`, [S1, a.leaseToken])).r
      assert.equal(f.ok, true, JSON.stringify(f))
      assert.equal((await release(S1, a.leaseToken)).ok, true)
      assert.equal((await leases(S1)).length, 0)
      await setting(V667.SETTING_KEY, '{"mode":"off","organizationIds":[]}')
      serverFlow = { S1 }
    })

    // ------------------------------------------------------------------ gỡ đúng thứ tự
    await check('gỡ V667 khi V670 còn: bị từ chối (claim không phải bản V667), không đổi gì', async () => {
      const before = await md5Of(V667.SIG.claim)
      await rejects(V667.sql.rollbackP2, /Gỡ V667 p2: định nghĩa không phải bản V667/)
      assert.equal(await md5Of(V667.SIG.claim), before)
    })
    await check('gỡ V670 rồi gỡ V667: claim về thân V667, rồi về thân V666; nhận lượt Desktop vẫn chạy sau mỗi bước', async () => {
      // Lượt engine còn mở (từ các bài trên) phải đóng trước khi gỡ V667 p2 (bản gỡ chặn khi còn lượt nơi chạy server); Desktop thì không.
      assert.ok(serverFlow, 'bài nơi chạy server đã chạy')
      await db.query(v670.rollback)
      for (const [key, d] of Object.entries(v670.defs)) assert.equal(await md5Of(d.sig), d.liveMd5, `gỡ V670: ${key}`)
      assert.equal(await md5Of(V667.SIG.claim), v670.V667_CLAIM_MD5)
      const cols = await q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
        AND ((table_name = 'auto_engine_leases' AND column_name IN ('lane', 'action_id', 'action_codes'))
          OR (table_name = 'auto_campaigns' AND column_name = 'parallel_run_enabled')
          OR (table_name = 'auto_campaign_actions' AND column_name = 'allow_parallel_run'))`)
      assert.deepEqual(cols, [])
      const QR = await acc(STAFF, ORG)
      const c1 = await campaign(QR, STAFF, ORG, 'zalo_message_phone')
      const r1 = await claim(STAFF, QR, c1, 'desktop', PHONE_ACTIONS, runner)
      assert.equal(r1.status, 'claimed', 'sau gỡ V670 ' + JSON.stringify(r1))
      assert.equal((await release(QR, r1.leaseToken)).ok !== undefined, true)
      await db.query(`DELETE FROM public.auto_engine_leases`)
      await db.query(V667.sql.rollbackP2)
      assert.equal(await md5Of(V667.SIG.claim), V667.LIVE_MD5.claim, 'gỡ V667: claim về thân V666')
      const QR2 = await acc(STAFF, ORG)
      const c2 = await campaign(QR2, STAFF, ORG, 'zalo_message_phone')
      const r2 = await claim(STAFF, QR2, c2, 'desktop', PHONE_ACTIONS, runner)
      assert.equal(r2.status, 'claimed', 'sau gỡ V667 ' + JSON.stringify(r2))
    })
    console.log(`\nV670 apply sau V666 → V667: ${passed} nhóm đạt, ${failed} hỏng. Ghi chú dựng DB: ${notes.join('; ')}`)
  } finally { await T.stop() }
  if (failed) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })

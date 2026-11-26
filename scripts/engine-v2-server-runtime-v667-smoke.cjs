#!/usr/bin/env node
// V667: engine v2 cho tài khoản Zalo Server chạy trên VPS (nơi chạy 'server'). Kiểm trên PostgreSQL cục bộ dùng một lần có engine v2 đúng
// thân hàm production: fixture của V657 (claim qua V657), V650 (finish), recover_server_zalo_running_state bản production (fixture V667).
// Không mạng, không dữ liệu khách.
//   CHAT_REPO=<thư mục có node_modules/pg> LC_ALL=C node scripts/engine-v2-server-runtime-v667-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { buildV667Db } = require('./fixtures/engine-v2-server/db.cjs')
const V667 = require('./build-v667-sql.cjs')

let passed = 0
let failed = 0
let currentDb = null
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (e) {
    failed++; console.log(`FAIL ${name}: ${e.stack || e.message}`)
    await currentDb?.query('ROLLBACK').catch(() => {}) // lỗi giữa giao dịch: không để các bước sau hỏng theo
  }
}

const ORG = 801          // tổ chức chạy Server trên VPS (cờ use_new_zalo_runtime tắt)
const ORG_FLY = 802      // tổ chức chạy Server trên Fly (cờ bật + gói Server)
const STAFF = 8101
const STAFF_FLY = 8102
const PHONE_ACTIONS = ['zalo_find_phone_user', 'zalo_message_stranger']
let seq = 880000

async function main() {
  const T = await buildV667Db({ label: 'aka-v667-' })
  const { db, one, q } = T
  currentDb = db
  const id = () => ++seq
  const ins = async (table, rows) => {
    rows = Array.isArray(rows) ? rows : [rows]
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).map(r => r.column_name)
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols.includes(k))
    const list = keys.map(k => `"${k}"`).join(', ')
    await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`, [JSON.stringify(rows)])
  }
  const md5Of = async sig => (await one(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) m`, [sig])).m
  /** Migration có BEGIN … COMMIT: lỗi giữa chừng để lại giao dịch hỏng, phải ROLLBACK trước lệnh kế tiếp. */
  const rejects = async (sql, re) => { try { await assert.rejects(db.query(sql), re) } finally { await db.query('ROLLBACK').catch(() => {}) } }
  const setting = async value => {
    await db.query(`DELETE FROM public.auto_system_settings WHERE key = $1`, [V667.SETTING_KEY])
    if (value !== undefined) await db.query(`INSERT INTO public.auto_system_settings (key, value, is_active) VALUES ($1, $2, true)`, [V667.SETTING_KEY, value])
  }
  try {
    // DB như production 26/11 (claim V657, finish V650, recover / flag_route bản production): scripts/fixtures/engine-v2-server/db.cjs.

    // ------------------------------------------------------------------ dữ liệu nền
    await db.query(`INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES ($1, 'VPS', false), ($2, 'Fly', true) ON CONFLICT (id) DO NOTHING`, [ORG, ORG_FLY])
    await db.query(`UPDATE public.org_organization SET use_new_zalo_runtime = (id = $2) WHERE id IN ($1, $2)`, [ORG, ORG_FLY])
    await ins('org_staff', [{ id: STAFF, organization_id: ORG, username: 'v1', password: 'pw', is_active: true },
      { id: STAFF_FLY, organization_id: ORG_FLY, username: 'v2', password: 'pw', is_active: true }])
    const until = new Date(Date.now() + 30 * 86400e3).toISOString()
    for (const [org, product] of [[ORG, 16], [ORG_FLY, 16]]) {
      await ins('org_organization_product', { id: id(), organization_id: org, product_id: product, is_deleted: false, expiration_date: until })
    }
    const acc = async (staff, org, extra = {}) => {
      const accId = id()
      await ins('auto_accounts', { id: accId, name: 'Zalo ' + accId, flatform_type: 'zalo', login_status: 'đã đăng nhập', status: 'chờ xử lý',
        is_active: true, is_delete: false, staff_id: staff, organization_id: org, is_zalo_server: true, is_zalo_show_web: false, ...extra })
      return accId
    }
    const campaign = async (account, staff, org, extra = {}) => {
      const cid = id()
      await ins('auto_campaigns', { id: cid, name: 'C' + cid, action_id: 'zalo_message_phone', account_id: account, status: 'chờ xử lý', is_delete: false,
        staff_id: staff, organization_id: org, schedule: new Date(Date.now() - 60000).toISOString(), schedule_type: 'daily', extra_settings: { enableMessage: true }, ...extra })
      return cid
    }
    const row = async (campaignId, fields = {}) => {
      const rid = id()
      await ins('auto_campaign_input_data', { id: rid, campaign_id: campaignId, status: 'chờ xử lý', is_delete: false, phone: `09${String(rid).slice(-8)}`, name: 'N' + rid, ...fields })
      return rid
    }
    const ctx = (staff, account, campaignId, runtime, lease = null) => ({ staffId: staff, accountId: account, campaignId, runnerId: `${runtime}:v667`, runtimeTarget: runtime,
      leaseToken: lease, actions: PHONE_ACTIONS.map(code => ({ code })) })
    const claim = async (staff, account, campaignId, runtime, lease = null) =>
      (await one('SELECT public.aka_agent_engine_claim_target_v1($1) r', [ctx(staff, account, campaignId, runtime, lease)])).r
    let rk = 0
    const reportOk = cl => one(`SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, true, false) r`, [cl.targetRunId, cl.leaseToken,
      JSON.stringify([{ resultKey: `v667-smoke:${++rk}`, actionCode: 'zalo_find_phone_user', ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' }])])
    const release = (account, lease) => one(`SELECT public.aka_agent_engine_release_v1($1, $2) r`, [account, lease])
    const checkDef = async name => (await one(`SELECT pg_get_constraintdef(c.oid) d, c.convalidated v FROM pg_constraint c WHERE c.conname = $1`, [name]))

    const A1 = await acc(STAFF, ORG)
    const A2 = await acc(STAFF, ORG)
    const QR = await acc(STAFF, ORG, { is_zalo_server: false })
    const AF = await acc(STAFF_FLY, ORG_FLY)

    // ------------------------------------------------------------------ trước V667
    await check('trước V667: claim từ chối nơi chạy server (invalid_request), không ghi gì', async () => {
      const c = await campaign(A1, STAFF, ORG); await row(c)
      const r = await claim(STAFF, A1, c, 'server')
      assert.equal(r.status, 'invalid_request', JSON.stringify(r))
      assert.equal((await one(`SELECT count(*)::int n FROM public.auto_engine_leases WHERE account_id = $1`, [A1])).n, 0)
    })

    // ------------------------------------------------------------------ p1
    await check('p2 chưa có p1 thì từ chối', async () => {
      await rejects(V667.sql.p2, /ràng buộc .* không như mong đợi/)
    })
    await check('p1: ba ràng buộc nhận server (NOT VALID), apply lại bị chặn', async () => {
      await db.query(V667.sql.p1)
      for (const name of ['auto_engine_leases_runtime_target_check', 'auto_engine_target_runs_runtime_target_check', 'auto_outcome_policies_runtime_target_check']) {
        const d = await checkDef(name)
        assert.match(d.d, /'server'::text/)
        assert.equal(d.v, false)
      }
      await rejects(V667.sql.p1, /không như mong đợi/)
      await assert.rejects(db.query(`INSERT INTO public.auto_engine_leases (account_id, lease_token, runner_id, runtime_target, expires_at)
        VALUES (-1, gen_random_uuid(), 'x', 'vps', now())`), /runtime_target_check/)
    })

    // ------------------------------------------------------------------ p2
    const aclOf = sig => one(`SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef || '|' || coalesce(p.proconfig::text, '') a
      FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [sig]).then(r => r.a)
    const aclBefore = {}
    for (const [k, sig] of Object.entries(V667.SIG)) aclBefore[k] = await aclOf(sig)
    await check('p2 chưa có V666 trong sổ thì từ chối (hai bản cùng thay claim, V667 dựng trên thân V666)', async () => {
      const ledger = await one(`SELECT version FROM supabase_migrations.schema_migrations WHERE name = $1`, [V667.V666_NAME])
      assert.ok(ledger, 'bộ dựng đã ghi V666 vào sổ')
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE name = $1`, [V667.V666_NAME])
      try {
        await rejects(V667.sql.p2, /cần migration_v666_send_exclusion_review_fixes trước/)
        assert.equal(await md5Of(V667.SIG.claim), V667.LIVE_MD5.claim, 'claim giữ thân V666')
      } finally {
        await db.query(`INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ($1, $2, '{}')`, [ledger.version, V667.V666_NAME])
      }
    })
    await check('p2: apply rồi ROLLBACK không để lại gì; apply thật đúng md5; quyền giữ nguyên; apply lần hai bị chặn', async () => {
      await db.query(V667.sql.p2.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
      await db.query('ROLLBACK').catch(() => {})
      for (const k of Object.keys(V667.SIG)) assert.equal(await md5Of(V667.SIG[k]), V667.LIVE_MD5[k], `${k} sau ROLLBACK`)
      assert.equal((await one(`SELECT to_regprocedure($1) r`, [V667.NEW_SIG.closeRuns])).r, null)
      await db.query(V667.sql.p2)
      for (const k of Object.keys(V667.NEW_MD5)) {
        const sig = V667.SIG[k] || V667.NEW_SIG[k]
        assert.equal(await md5Of(sig), V667.NEW_MD5[k], `md5 ${k}`)
      }
      for (const [k, sig] of Object.entries(V667.SIG)) assert.equal(await aclOf(sig), aclBefore[k], `quyền ${k}`)
      await rejects(V667.sql.p2, /đã chạy \(claim\)/)
    })
    await check('p2: quyền bốn hàm mới đúng người gọi', async () => {
      const priv = (role, sig) => one(`SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') p`, [role, sig]).then(r => r.p)
      assert.equal(await priv('service_role', V667.NEW_SIG.enabledOrgs), true)
      assert.equal(await priv('aka_agent_desktop', V667.NEW_SIG.enabledOrgs), false)
      assert.equal(await priv('anon', V667.NEW_SIG.enabledOrgs), false)
      for (const r of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) assert.equal(await priv(r, V667.NEW_SIG.closeRuns), true, r)
      assert.equal(await priv('anon', V667.NEW_SIG.closeRuns), false)
      for (const r of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop', 'anon']) assert.equal(await priv(r, V667.NEW_SIG.orgEnabled), false, r)
      assert.equal(await priv('aka_agent_desktop', V667.NEW_SIG.desktopVps), true)
      for (const r of ['service_role', 'aka_agent_chat_api', 'anon', 'authenticated']) assert.equal(await priv(r, V667.NEW_SIG.desktopVps), false, r)
    })
    await check('p2: chính sách tra số không rõ kết quả có bản server giống bản Desktop; resolve_policy chọn đúng bản', async () => {
      const rows = await q(`SELECT id, runtime_target, source FROM public.auto_outcome_policies WHERE error_code = 'err_engine_unknown_delivery'
        AND action_code = 'zalo_find_phone_user' AND runtime_target IS NOT NULL AND is_active AND NOT is_delete ORDER BY runtime_target`)
      assert.deepEqual(rows.map(r => r.runtime_target), ['desktop', 'fly', 'server'])
      const server = rows.find(r => r.runtime_target === 'server')
      assert.equal(server.source, 'v667')
      for (const [rt, wantId] of [['desktop', 255], ['fly', 256], ['server', Number(server.id)]]) {
        const p = await one(`SELECT public.aka_agent_engine_resolve_policy('err_engine_unknown_delivery', NULL, 'zalo_find_phone_user', NULL, $1, 'in_flight') r`, [rt])
        const text = JSON.stringify(p.r)
        assert.ok(text.includes(String(wantId)), `${rt}: ${text.slice(0, 300)}`)
      }
    })
    await check('công tắc: mặc định off; orgs / all / sai định dạng', async () => {
      const read = async () => (await one(`SELECT public.aka_agent_engine_server_enabled_orgs_v1() r`)).r
      const on = async org => (await one(`SELECT public.aka_agent_engine_server_org_enabled($1) r`, [org])).r
      assert.deepEqual(await read(), { mode: 'off', organizationIds: [] })
      assert.equal(await on(ORG), false)
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG, String(ORG_FLY), 'x', -1, ORG] }))
      const r = await read()
      assert.equal(r.mode, 'orgs'); assert.deepEqual([...r.organizationIds].sort(), [String(ORG), String(ORG_FLY)])
      assert.equal(await on(ORG), true); assert.equal(await on(9999), false)
      await setting('{"mode":"all"}'); assert.deepEqual(await read(), { mode: 'all', organizationIds: [] }); assert.equal(await on(9999), true)
      await setting('{oops'); assert.deepEqual(await read(), { mode: 'off', organizationIds: [] }); assert.equal(await on(ORG), false)
      await setting(undefined); assert.deepEqual(await read(), { mode: 'off', organizationIds: [] })
    })

    // ------------------------------------------------------------------ Desktop (tài khoản Zalo QR / trình duyệt)
    /** Gọi một hàm như phiên Desktop của nhân viên (fixture: phạm vi phiên đọc test.desktop_staff). */
    const asDesktop = async (staff, sql) => {
      await db.query('BEGIN')
      try {
        await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [String(staff)])
        await db.query('SET LOCAL ROLE aka_agent_desktop')
        return (await one(sql)).r
      } finally { await db.query('ROLLBACK').catch(() => {}) }
    }
    const DESKTOP_VPS = `SELECT ${V667.NEW_SIG.desktopVps} r`
    const DESKTOP_V513 = `SELECT public.aka_agent_engine_desktop_enabled_v1() r`
    await check('Desktop: hàm mới theo công tắc; V513 (chọn Fly / App Server cho tài khoản Server) vẫn theo cờ tổ chức', async () => {
      await setting('{"mode":"off","organizationIds":[]}')
      assert.equal(await asDesktop(STAFF, DESKTOP_VPS), false, 'công tắc tắt')
      assert.equal(await asDesktop(STAFF, DESKTOP_V513), false)
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG] }))
      assert.equal(await asDesktop(STAFF, DESKTOP_VPS), true, 'tổ chức có trong danh sách')
      assert.equal(await asDesktop(STAFF, DESKTOP_V513), false, 'V513 không đổi: Desktop vẫn coi tài khoản Server ở App Server')
      assert.equal(await asDesktop(STAFF_FLY, DESKTOP_VPS), false, 'tổ chức khác không có trong danh sách')
      assert.equal(await asDesktop(STAFF_FLY, DESKTOP_V513), true, 'tổ chức bật cờ vẫn chạy Fly như cũ')
      await setting('{"mode":"all"}')
      assert.equal(await asDesktop(STAFF, DESKTOP_VPS), true, 'mode all')
      assert.equal(await asDesktop(STAFF, DESKTOP_V513), false)
      await setting('{oops')
      assert.equal(await asDesktop(STAFF, DESKTOP_VPS), false, 'sai định dạng = tắt')
      // Không có phiên Desktop (không có nhân viên trong phiên): false, không lỗi.
      await setting('{"mode":"all"}')
      assert.equal(await asDesktop('', DESKTOP_VPS), false, 'phiên không có nhân viên')
      await setting(undefined)
      assert.equal(await asDesktop(STAFF, DESKTOP_VPS), false, 'thiếu dòng công tắc')
    })
    await check('Desktop: claim nơi chạy desktop cho tài khoản Zalo QR của tổ chức tắt cờ vẫn nhận như cũ (Desktop tự chọn bộ chạy lúc đăng nhập)', async () => {
      await setting('{"mode":"off","organizationIds":[]}')
      const c = await campaign(QR, STAFF, ORG); const r1 = await row(c)
      await db.query('BEGIN')
      try {
        await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [String(STAFF)])
        await db.query('SET LOCAL ROLE aka_agent_desktop')
        const a = await claim(STAFF, QR, c, 'desktop')
        assert.equal(a.status, 'claimed', JSON.stringify(a))
        assert.equal(Number(a.target.id), r1)
      } finally { await db.query('ROLLBACK').catch(() => {}) }
    })

    // ------------------------------------------------------------------ claim nơi chạy server
    await check('claim server: công tắc tắt → not_enabled, không giữ tài khoản', async () => {
      await setting('{"mode":"off","organizationIds":[]}')
      const c = await campaign(A1, STAFF, ORG); await row(c)
      const r = await claim(STAFF, A1, c, 'server')
      assert.equal(r.status, 'not_enabled', JSON.stringify(r))
      assert.equal((await one(`SELECT count(*)::int n FROM public.auto_engine_leases WHERE account_id = $1`, [A1])).n, 0)
    })
    let flow = null
    await check('claim server: tổ chức bật → nhận data, lease và lượt ghi nơi chạy server; báo xong, kết thúc lượt, nhả', async () => {
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG] }))
      const c = await campaign(A1, STAFF, ORG); const r1 = await row(c); const r2 = await row(c)
      const a = await claim(STAFF, A1, c, 'server')
      assert.equal(a.status, 'claimed', JSON.stringify(a))
      assert.equal(Number(a.target.id), r1)
      const lease = await one(`SELECT runtime_target, runner_id FROM public.auto_engine_leases WHERE account_id = $1`, [A1])
      assert.deepEqual([lease.runtime_target, lease.runner_id], ['server', 'server:v667'])
      assert.equal((await one(`SELECT runtime_target FROM public.auto_engine_target_runs WHERE id = $1`, [a.targetRunId])).runtime_target, 'server')
      const rep = await reportOk(a)
      assert.equal(rep.r.ok, true, JSON.stringify(rep.r))
      const b = await claim(STAFF, A1, c, 'server', a.leaseToken)
      assert.equal(Number(b.target.id), r2)
      await reportOk(b)
      const n = await claim(STAFF, A1, c, 'server', a.leaseToken)
      assert.equal(n.status, 'no_target', JSON.stringify(n))
      const f = (await one(`SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, NULL) r`, [A1, a.leaseToken])).r
      assert.equal(f.ok, true, JSON.stringify(f))
      const rel = (await release(A1, a.leaseToken)).r
      assert.equal(rel.ok, true, JSON.stringify(rel))
      flow = { c, f }
    })
    await check('claim server: tổ chức đang chạy Server trên Fly → runtime_not_owner', async () => {
      await setting(JSON.stringify({ mode: 'orgs', organizationIds: [ORG, ORG_FLY] }))
      assert.equal((await one(`SELECT public.aka_agent_zalo_server_flag_route($1) r`, [ORG_FLY])).r, true, 'fixture: ORG_FLY phải đi Fly')
      const c = await campaign(AF, STAFF_FLY, ORG_FLY); await row(c)
      const r = await claim(STAFF_FLY, AF, c, 'server')
      assert.equal(r.status, 'runtime_not_owner', JSON.stringify(r))
      const fly = await claim(STAFF_FLY, AF, c, 'fly')
      assert.equal(fly.status, 'claimed', `Fly vẫn nhận như cũ: ${JSON.stringify(fly)}`)
      await reportOk(fly); await release(AF, fly.leaseToken)
    })
    await check('claim server: tài khoản không phải Zalo Server → runtime_not_owner; nơi chạy fly / desktop / lạ như cũ', async () => {
      await setting(JSON.stringify({ mode: 'all' }))
      const cq = await campaign(QR, STAFF, ORG); await row(cq)
      assert.equal((await claim(STAFF, QR, cq, 'server')).status, 'runtime_not_owner')
      const c = await campaign(A2, STAFF, ORG); await row(c)
      assert.equal((await claim(STAFF, A2, c, 'fly')).status, 'not_enabled', 'tổ chức tắt cờ thì Fly vẫn không nhận')
      assert.equal((await claim(STAFF, A2, c, 'desktop')).status, 'runtime_not_owner', 'Desktop vẫn không nhận tài khoản Server')
      assert.equal((await claim(STAFF, A2, c, 'vps')).status, 'invalid_request')
    })
    await check('claim server: phiên Desktop không được xưng nơi chạy server', async () => {
      const c = await campaign(A2, STAFF, ORG); await row(c)
      await db.query('BEGIN')
      try {
        // Fixture: phạm vi phiên Desktop đọc test.desktop_staff (private.aka_agent_staff_scope_for_request).
        await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [String(STAFF)])
        await db.query('SET LOCAL ROLE aka_agent_desktop')
        const r = await claim(STAFF, A2, c, 'server')
        assert.equal(r.status, 'invalid_request', JSON.stringify(r))
      } finally { await db.query('ROLLBACK').catch(() => {}) }
    })
    await check('kết thúc lượt: tài khoản Server bị tạm dừng giữa lượt → chiến dịch về chờ xử lý (như Fly), Desktop giữ cách cũ', async () => {
      await setting(JSON.stringify({ mode: 'all' }))
      const run = async runtime => {
        const account = await acc(STAFF, ORG, runtime === 'desktop' ? { is_zalo_server: false } : {})
        const c = await campaign(account, STAFF, ORG); await row(c)
        const a = await claim(STAFF, account, c, runtime)
        assert.equal(a.status, 'claimed', `${runtime}: ${JSON.stringify(a)}`)
        await reportOk(a)
        await db.query(`UPDATE public.auto_accounts SET status = 'tạm dừng' WHERE id = $1`, [account])
        const f = (await one(`SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, NULL) r`, [account, a.leaseToken])).r
        const camp = await one(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c])
        await release(account, a.leaseToken)
        return { f, status: camp.status }
      }
      const server = await run('server')
      assert.deepEqual([server.f.reason, server.status], ['account_control_won', 'chờ xử lý'], JSON.stringify(server))
      const desktop = await run('desktop')
      assert.notEqual(desktop.f.reason, 'account_control_won', JSON.stringify(desktop))
    })

    // ------------------------------------------------------------------ hàm khôi phục của App Server
    await check('recover_server_zalo_running_state: lượt server chưa ghi dấu về hàng đợi, đã ghi dấu hoàn thành không gửi lại, lượt desktop không bị đóng', async () => {
      await setting(JSON.stringify({ mode: 'all' }))
      const B1 = await acc(STAFF, ORG); const B2 = await acc(STAFF, ORG); const D1 = await acc(STAFF, ORG, { is_zalo_server: false })
      const c1 = await campaign(B1, STAFF, ORG); const u1 = await row(c1)
      const c2 = await campaign(B2, STAFF, ORG); const u2 = await row(c2)
      const c3 = await campaign(D1, STAFF, ORG); const u3 = await row(c3)
      const cl = await campaign(await acc(STAFF, ORG), STAFF, ORG); const legacyRow = await row(cl, { status: 'đang chạy' })
      const a1 = await claim(STAFF, B1, c1, 'server')
      const a2 = await claim(STAFF, B2, c2, 'server')
      const a3 = await claim(STAFF, D1, c3, 'desktop')
      for (const a of [a1, a2, a3]) assert.equal(a.status, 'claimed', JSON.stringify(a))
      const mark = (await one(`SELECT public.aka_agent_engine_mark_sending_v1($1, $2, 'zalo_message_stranger', 'send') r`, [a2.targetRunId, a2.leaseToken])).r
      assert.equal(mark.ok, true, JSON.stringify(mark))
      const r = (await one(`SELECT public.recover_server_zalo_running_state($1, NULL, false) r`, [STAFF])).r
      assert.ok(r && typeof r === 'object', JSON.stringify(r))
      const run = async rid => one(`SELECT completed_at IS NOT NULL closed, final_target_status, final_error_code FROM public.auto_engine_target_runs WHERE id = $1`, [rid])
      const data = async rid => one(`SELECT status, note FROM public.auto_campaign_input_data WHERE id = $1`, [rid])
      const via = async rid => (await one(`SELECT data->>'via' v FROM public.auto_engine_target_events WHERE target_run_id = $1 AND kind = 'interrupted' ORDER BY id DESC LIMIT 1`, [rid]))?.v
      const r1 = await run(a1.targetRunId)
      assert.deepEqual([r1.closed, r1.final_target_status, r1.final_error_code], [true, 'chờ xử lý', 'err_engine_interrupted_before_send'])
      assert.equal((await data(u1)).status, 'chờ xử lý')
      assert.equal(await via(a1.targetRunId), V667.RESET_VIA)
      const r2 = await run(a2.targetRunId)
      assert.deepEqual([r2.closed, r2.final_target_status, r2.final_error_code], [true, 'hoàn thành', 'err_engine_interrupted_while_sending'])
      assert.equal((await data(u2)).status, 'hoàn thành')
      assert.equal(await via(a2.targetRunId), V667.RESET_VIA)
      const r3 = await run(a3.targetRunId)
      assert.equal(r3.closed, false, 'lượt desktop không bị hàm khôi phục của Server đóng')
      assert.equal((await data(u3)).status, 'đang chạy', 'data của tài khoản QR không bị đụng')
      assert.deepEqual(await data(legacyRow), { status: 'hoàn thành', note: 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại' }, 'data bộ cũ như trước')
      // Lượt mới nhận lại được data vừa về hàng đợi sau khi lease cũ hết / được nhả.
      await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '1 second' WHERE account_id IN ($1, $2)`, [B1, B2])
      const again = await claim(STAFF, B1, c1, 'server')
      assert.equal(again.status, 'claimed', JSON.stringify(again))
      assert.equal(Number(again.target.id), u1)
      await reportOk(again); await release(B1, again.leaseToken)
      await reportOk(a3); await release(D1, a3.leaseToken)
    })
    await check('close_server_runs_v1: không có lượt mở thì trả 0; nhân viên khác không bị đụng', async () => {
      assert.equal((await one(`SELECT public.aka_agent_engine_close_server_runs_v1($1) n`, [STAFF])).n, 0)
      assert.equal((await one(`SELECT public.aka_agent_engine_close_server_runs_v1(NULL) n`)).n, 0)
    })

    // ------------------------------------------------------------------ p3, gỡ, apply lại
    await check('p3: VALIDATE ba ràng buộc, chạy lại được', async () => {
      await db.query(V667.sql.p3)
      for (const name of ['auto_engine_leases_runtime_target_check', 'auto_engine_target_runs_runtime_target_check', 'auto_outcome_policies_runtime_target_check']) {
        assert.equal((await checkDef(name)).v, true)
      }
      await db.query(V667.sql.p3)
    })
    await check('gỡ p2: còn lượt server mở thì từ chối; không còn thì trả đúng thân cũ, bỏ hàm mới / chính sách / công tắc', async () => {
      await setting(JSON.stringify({ mode: 'all' }))
      const B3 = await acc(STAFF, ORG); const c = await campaign(B3, STAFF, ORG); await row(c)
      const open = await claim(STAFF, B3, c, 'server')
      assert.equal(open.status, 'claimed')
      await rejects(V667.sql.rollbackP2, /còn lượt engine nơi chạy server đang mở/)
      await reportOk(open); await release(B3, open.leaseToken)
      await db.query(V667.sql.rollbackP2)
      for (const k of Object.keys(V667.SIG)) assert.equal(await md5Of(V667.SIG[k]), V667.LIVE_MD5[k], k)
      for (const sig of Object.values(V667.NEW_SIG)) assert.equal((await one(`SELECT to_regprocedure($1) r`, [sig])).r, null, sig)
      assert.equal((await one(`SELECT count(*)::int n FROM public.auto_outcome_policies WHERE runtime_target = 'server'`)).n, 0)
      assert.equal((await one(`SELECT count(*)::int n FROM public.auto_system_settings WHERE key = $1`, [V667.SETTING_KEY])).n, 0)
      for (const [k, sig] of Object.entries(V667.SIG)) assert.equal(await aclOf(sig), aclBefore[k], `quyền ${k} sau khi gỡ`)
    })
    await check('gỡ p1: còn dòng server thì từ chối; dọn xong thì ràng buộc về desktop / fly; apply lại p1 → p2 → p3 được', async () => {
      await rejects(V667.sql.rollbackP1, /còn dòng nơi chạy server/)
      await db.query(`DELETE FROM public.auto_engine_leases WHERE runtime_target = 'server'`)
      await db.query(`DELETE FROM public.auto_engine_target_events WHERE target_run_id IN (SELECT id FROM public.auto_engine_target_runs WHERE runtime_target = 'server')`)
      await db.query(`DELETE FROM public.auto_engine_outcomes WHERE target_run_id IN (SELECT id FROM public.auto_engine_target_runs WHERE runtime_target = 'server')`)
      await db.query(`DELETE FROM public.auto_engine_target_runs WHERE runtime_target = 'server'`)
      await db.query(V667.sql.rollbackP1)
      const d = await checkDef('auto_engine_target_runs_runtime_target_check')
      assert.doesNotMatch(d.d, /server/)
      await db.query(V667.sql.p1); await db.query(V667.sql.p2); await db.query(V667.sql.p3)
      assert.equal(await md5Of(V667.SIG.claim), V667.NEW_MD5.claim)
    })
  } finally {
    await T.stop()
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  if (failed) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exitCode = 1 })

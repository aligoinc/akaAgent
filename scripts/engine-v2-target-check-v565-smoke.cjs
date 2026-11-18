// V565 (engine v2 kiểm SĐT trên toàn hệ thống trước khi gọi Zalo) trên PostgreSQL 17 cục bộ dùng một lần, không chạm DB thật, không gọi Zalo:
//   node scripts/engine-v2-target-check-v565-smoke.cjs        (module pg tìm ở ../akaAgentChatApi, hoặc CHAT_REPO=<thư mục có pg>;
//   V565_DUMP=1 in các dòng tiến trình của lượt chạy lõi thật)
// DB engine như production 18/11/2026 (V495 → V532, V556–V558, V564; normalize_phone thân production), rồi:
//   1. apply / gỡ / chặn chạy lại / quyền;
//   2. nạp lịch sử (hàm nền): SĐT hỏng, thành công lại, quá 365 ngày, dòng do chính việc kiểm ghi, định dạng SĐT khác, mốc 3 phút; chia phần
//      bao nhiêu cũng ra cùng kết quả và cùng số đo;
//   3. claim: từng quyết định skip / không skip (tắt, sai tổ chức, kiêm SMS, mã tắt, quá số ngày, khoá thao tác, hết lượt, chỉ nhắn tin);
//   4. report: dòng lịch sử giống kết quả Zalo thật của cùng mã (trạng thái, câu, data hoàn thành), chỉ khác không tính lượt;
//   5. lõi thật (runUnit + cổng Zalo giả): SĐT đã biết không gọi Zalo, dòng tiến trình giống hệt khi Zalo trả lỗi, không câu nào nhắc việc kiểm.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations } = require('./engine-v2-facebook/fixture.cjs')
const W = require('./engine-v2-scenarios/world.cjs')
const { makePort } = require('./engine-v2-scenarios/port.cjs')
const V = require('./build-v565-sql.cjs')

const PORT = Number(process.env.V565_TEST_PORT || 55565)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
/** normalize_phone(text) của production (md5 pg_get_functiondef đọc chỉ đọc 18/11/2026 = bản chụp V431). */
const NORMALIZE_PHONE_MD5 = 'f6ccb574895043480e6523193f7be007'
const LOOKUP = 'zalo_find_phone_user'
const MESSAGE = 'zalo_message_stranger'
const FRIEND = 'zalo_add_friend'
const Z216 = 'err_zalo_user_not_found'
const Z219 = 'err_zalo_219_find_phone_invalid'
const Z122 = 'err_zalo_receiver_blocks_stranger_message'
const HEARTBEAT_MS = 61_237

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-v565-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

function testClock() {
  const sleeps = []
  return {
    sleeps,
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms !== HEARTBEAT_MS) { sleeps.push(ms); return setImmediate(() => resolve(!signal?.aborted)) }
      signal?.addEventListener('abort', () => resolve(false), { once: true })
    })
  }
}

async function main() {
  const files = {
    p1: fs.readFileSync(path.join(ROOT, `migrations/${V.NAME_P1}.sql`), 'utf8'),
    p2: fs.readFileSync(path.join(ROOT, `migrations/${V.NAME_P2}.sql`), 'utf8'),
    r1: fs.readFileSync(path.join(ROOT, `migrations/${V.ROLLBACK_P1}.sql`), 'utf8'),
    r2: fs.readFileSync(path.join(ROOT, `migrations/${V.ROLLBACK_P2}.sql`), 'utf8')
  }
  assert.equal(md5(files.p1), md5(V.migrationP1), 'p1 khác bản bộ sinh tạo: chạy lại node scripts/build-v565-sql.cjs')
  assert.equal(md5(files.p2), md5(V.migrationP2), 'p2 khác bản bộ sinh tạo')
  assert.equal(md5(files.r1), md5(V.rollbackP1), 'bản gỡ p1 khác bản bộ sinh tạo')
  assert.equal(md5(files.r2), md5(V.rollbackP2), 'bản gỡ p2 khác bản bộ sinh tạo')
  const phoneFn = JSON.parse(fs.readFileSync(path.join(ROOT, 'migrations/snapshots/cooldown-history-v431/phone-dependency.json'), 'utf8'))
    .find(f => f.signature === 'normalize_phone(text)').definition
  assert.equal(md5(phoneFn), NORMALIZE_PHONE_MD5, 'normalize_phone của bản chụp khác production')

  const E = await loadEngine()
  const type = E.zaloCampaignType('zalo_message_phone')
  const cluster = startCluster({ port: PORT, label: 'aka-v565-', timeoutMs: 900_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await db.query(phoneFn)
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const fnMd5 = sig => val(`SELECT md5(pg_get_functiondef(to_regprocedure($1)))`, [sig])
    const ingest = (budget = 60000, chunk = 100000) => val(`SELECT private.aka_agent_engine_phone_results_ingest($1, $2)`, [budget, chunk])
    const setMode = value => db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = $2`, [JSON.stringify(value), V.SETTING_KEY])

    // ---- 1. Apply / gỡ / quyền ---------------------------------------------------------------------------------------------------
    await check('DB thử: claim / report / normalize_phone = bản production 18/11', async () => {
      assert.equal(await fnMd5(V.CLAIM_SIG), V.LIVE.claim)
      assert.equal(await fnMd5(V.REPORT_SIG), V.LIVE.report)
      assert.equal(await fnMd5('public.normalize_phone(text)'), NORMALIZE_PHONE_MD5)
    })
    const columns = () => val(`SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
      AND attname IN ('target_check_enabled', 'target_check_days') AND NOT attisdropped`)
    await check('apply: p2 trước p1 bị chặn; giao dịch huỷ không để lại gì; apply thật; chạy lại bị chặn; gỡ trả đúng thân cũ; apply lại', async () => {
      await assert.rejects(db.query(files.p2), /cần p1/)
      await db.query('ROLLBACK')
      await db.query(files.p1.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
      assert.equal(await columns(), 0)
      await db.query(files.p1)
      assert.equal(await columns(), 2)
      assert.deepEqual((await db.query(`SELECT error_code, action_code, target_check_enabled AS e, target_check_days AS d FROM public.auto_outcome_policies
        WHERE target_check_enabled IS NOT NULL ORDER BY error_code`)).rows,
        [{ error_code: Z122, action_code: MESSAGE, e: true, d: 365 }, { error_code: Z219, action_code: LOOKUP, e: true, d: 365 },
          { error_code: Z216, action_code: LOOKUP, e: true, d: 365 }].sort((a, b) => a.error_code < b.error_code ? -1 : 1))
      // Ràng buộc: chỉ dòng (mã × thao tác) không giới hạn loại chiến dịch / nơi chạy; có cờ thì phải có số ngày.
      await assert.rejects(db.query(`UPDATE public.auto_outcome_policies SET target_check_days = NULL WHERE error_code = $1 AND action_code = $2`, [Z216, LOOKUP]),
        /auto_outcome_policies_target_check_v565/)
      const wide = await val(`SELECT min(id) FROM public.auto_outcome_policies WHERE action_code IS NULL AND error_code IS NOT NULL`)
      assert.ok(wide, 'cần một dòng chính sách không gắn thao tác')
      await assert.rejects(db.query(`UPDATE public.auto_outcome_policies SET target_check_enabled = true, target_check_days = 30 WHERE id = $1`, [wide]),
        /auto_outcome_policies_target_check_v565/)
      await db.query(files.p2.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
      assert.equal(await fnMd5(V.CLAIM_SIG), V.LIVE.claim)
      assert.equal(await val(`SELECT to_regclass('private.auto_engine_phone_results')`), null)
      await db.query(files.p2)
      assert.equal(await fnMd5(V.CLAIM_SIG), V.NEW.claim)
      assert.equal(await fnMd5(V.REPORT_SIG), V.NEW.report)
      await assert.rejects(db.query(files.p1), /đã có/)
      await db.query('ROLLBACK')
      await assert.rejects(db.query(files.p2), /đã/)
      await db.query('ROLLBACK')
      await assert.rejects(db.query(files.r1), /gỡ phần 2 trước/)
      await db.query('ROLLBACK')
      await db.query(files.r2)
      assert.equal(await fnMd5(V.CLAIM_SIG), V.LIVE.claim)
      assert.equal(await fnMd5(V.REPORT_SIG), V.LIVE.report)
      assert.equal(await val(`SELECT to_regclass('private.auto_engine_phone_results')`), null)
      assert.equal(await val(`SELECT count(*)::int FROM public.auto_system_settings WHERE key = $1`, [V.SETTING_KEY]), 0)
      await db.query(files.r1)
      assert.equal(await columns(), 0)
      await db.query(files.p1)
      await db.query(files.p2)
      assert.equal(await fnMd5(V.CLAIM_SIG), V.NEW.claim)
    })
    await check('quyền: bảng bật RLS, không vai trò ứng dụng nào đọc / ghi bảng hay chạy hàm mới; thiết lập mặc định off', async () => {
      for (const t of V.TABLES) assert.equal(await val(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [t]), true, t)
      for (const role of ['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api']) {
        for (const t of V.TABLES) assert.equal(await val(`SELECT has_table_privilege($1, $2, 'SELECT')`, [role, t]), false, `${role} ${t}`)
        for (const f of Object.values(V.FUNCS)) assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, f]), false, `${role} ${f}`)
      }
      assert.equal(await val(`SELECT value FROM public.auto_system_settings WHERE key = $1`, [V.SETTING_KEY]), V.SETTING_VALUE)
      assert.equal(await val(`SELECT private.aka_agent_engine_target_check_on(1)`), false)
    })

    // ---- Thế giới thử ----------------------------------------------------------------------------------------------------------------
    const ORG_A = 5651, ORG_B = 5652, ORG_H = 5650
    for (const [id, name] of [[ORG_H, 'Lịch sử'], [ORG_A, 'Bật kiểm'], [ORG_B, 'Không bật']]) {
      await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, name])
    }
    let nextId = 7_700_000
    const newAccount = async (org, staff) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
          is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $3, $4, false, false)`,
        [id, `Zalo ${id}`, staff, org])
      return id
    }
    const LIMITS = { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 }
    const MSG_FRIEND = { enableMessage: true, enableAddFriend: true, friendRequestMessage: 'Chào bạn', actionLimits: LIMITS }
    const MSG_ONLY = { enableMessage: true, enableAddFriend: false, actionLimits: LIMITS }
    /** Chiến dịch "Nhắn tin theo SĐT" một tài khoản, data theo danh sách SĐT. */
    const makeCampaign = async ({ org = ORG_A, extra = MSG_FRIEND, phones = [] } = {}) => {
      const staff = org * 10 + 1
      const account = await newAccount(org, staff)
      const campaign = ++nextId
      await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, schedule_type,
          content, extra_settings) OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'zalo_message_phone', $3, 'chờ xử lý', now() - interval '1 minute', false, $4, $5, 'daily',
          'Xin chào', $6)`, [campaign, `Kiểm SĐT ${campaign}`, account, staff, org, JSON.stringify(extra)])
      const ids = []
      for (const phone of phones) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Khách ${id}`, phone])
        ids.push(id)
      }
      const cfg = { id: campaign, actionId: 'zalo_message_phone', accountId: account, content: 'Xin chào', extraSettings: extra, images: [], dataTargetSourceMode: null }
      return { org, staff, account, campaign, ids, cfg, extra }
    }

    // Lịch sử của tổ chức khác (mỗi kết quả một data riêng như thật), theo thứ tự thời gian như id của production.
    const hist = await makeCampaign({ org: ORG_H, extra: MSG_FRIEND })
    const P = {
      z216: '0901000001', z219: '0901000002', okAfterBad: '0901000003', badAfterOk: '0901000004', z122: '0901000005', old: '0901000006',
      synthetic: '0901000007', formatted: '0912345678', other: '0901000009', repeat: '0901000011', falseSkip: '0901000012', okOnly: '0901000013',
      noUid: '0901000014', fresh: '0901000015'
    }
    const events = [
      // [ngày trước, SĐT trong lịch sử, thao tác, mã lỗi (null = thành công), mã Zalo gốc, kiểu ghi, dòng do việc kiểm ghi]
      [400, P.old, LOOKUP, Z216, '216', 'old'],
      [40, P.badAfterOk, LOOKUP, null, null, 'engine'],
      [30, P.okAfterBad, LOOKUP, Z216, '216', 'old'],
      [20, P.z219, LOOKUP, Z219, '219', 'engine'],
      [20, P.repeat, LOOKUP, Z216, '216', 'old'],
      [15, P.falseSkip, LOOKUP, Z216, '212', 'old'],
      [12, P.other, LOOKUP, 'err_zalo_api_business_failed', null, 'old'],
      [10, P.z216, LOOKUP, Z216, '216', 'old'],
      [10, P.repeat, LOOKUP, Z216, '216', 'engine'],
      [9, '+84 912 345 678', LOOKUP, Z216, '216', 'engine'],
      [8, P.synthetic, LOOKUP, Z216, null, 'engine', true],
      [6, P.okOnly, LOOKUP, null, null, 'old'],
      [5, P.okAfterBad, LOOKUP, null, null, 'engine'],
      [5, P.falseSkip, LOOKUP, null, null, 'old'],
      [4, P.noUid, LOOKUP, Z216, 'find_user_without_uid', 'engine-signal'],
      [3, P.z122, MESSAGE, Z122, '122', 'engine'],
      [2, P.badAfterOk, LOOKUP, Z216, '216', 'old']
    ]
    const insertHistory = async ([days, phone, action, code, zalo, style, synthetic], createdAt = null) => {
      const inputId = ++nextId
      await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
        VALUES ($1, $2, 'Khách cũ', $3, 'hoàn thành', false)`, [inputId, hist.campaign, phone])
      const ok = code === null
      const data = style === 'old' ? (zalo ? { zalo: { code: zalo } } : {})
        : { engine: 'v2', phase: 'after_send', ...(zalo ? { signal: { kind: style === 'engine-signal' ? 'engine' : 'zalo_code', code: zalo } } : {}) }
      const snapshot = style === 'old' ? null : { engine: 'v2', errorCode: code, v2: synthetic ? { targetCheck: true } : {} }
      await db.query(`INSERT INTO public.auto_campaign_details (input_data_id, campaign_id, account_id, action_name, action_code, status, error_code,
          report_group, counts_toward_limit, data, policy_snapshot, is_delete, created_at)
        VALUES ($1, $2, $3, 'x', $4, $5, $6, $7, true, $8, $9, false, coalesce($10::timestamptz, now() - make_interval(days => $11)))`,
        [inputId, hist.campaign, hist.account, action, ok ? 'thành công' : (code === Z122 ? 'thất bại' : 'không tồn tại'), code,
          style === 'old' ? null : (ok ? 'success' : 'failure'), JSON.stringify(data), snapshot && JSON.stringify(snapshot), createdAt, days])
    }
    for (const e of events) await insertHistory(e)

    // ---- 2. Nạp lịch sử -----------------------------------------------------------------------------------------------------------
    const results = async () => (await db.query(`SELECT phone_key::text AS k, action_code AS a, bad_error_code AS e, bad_zalo_code AS z,
        (ok_at IS NOT NULL AND ok_at > bad_at) AS cleared FROM private.auto_engine_phone_results ORDER BY 1, 2`)).rows
    const keyOf = phone => val(`SELECT private.aka_agent_engine_phone_key($1)::text`, [phone])
    const stats = async () => (await one(`SELECT stats FROM private.auto_engine_phone_results_state WHERE id = 1`)).stats
    let chunked, chunkedStats
    await check('nạp lịch sử: đúng từng loại SĐT (hỏng, thành công lại, quá 365 ngày, dòng do việc kiểm ghi, SĐT khác định dạng, mã Zalo gốc)', async () => {
      const res = await ingest(60000, 3)
      assert.equal(res.status, 'ok')
      assert.equal(res.caughtUp, true)
      chunked = await results()
      chunkedStats = await stats()
      const row = async phone => (await db.query(`SELECT action_code AS a, bad_error_code AS e, bad_zalo_code AS z,
          (ok_at IS NOT NULL AND ok_at > bad_at) AS cleared FROM private.auto_engine_phone_results WHERE phone_key = private.aka_agent_engine_phone_key($1)
          ORDER BY action_code`, [phone])).rows
      assert.deepEqual(await row(P.z216), [{ a: LOOKUP, e: Z216, z: '216', cleared: false }])
      assert.deepEqual(await row(P.z219), [{ a: LOOKUP, e: Z219, z: '219', cleared: false }])
      assert.deepEqual(await row(P.okAfterBad), [{ a: LOOKUP, e: Z216, z: '216', cleared: true }], 'thành công sau lần hỏng: không còn hiệu lực')
      assert.deepEqual(await row(P.badAfterOk), [{ a: LOOKUP, e: Z216, z: '216', cleared: false }], 'thành công cũ rồi hỏng lại: vẫn hỏng')
      assert.deepEqual(await row(P.z122), [{ a: MESSAGE, e: Z122, z: '122', cleared: false }])
      assert.deepEqual(await row(P.old), [], 'quá 365 ngày (+1): bị dọn')
      assert.deepEqual(await row(P.synthetic), [], 'dòng do chính việc kiểm ghi không được nạp')
      assert.deepEqual(await row(P.formatted), [{ a: LOOKUP, e: Z216, z: '216', cleared: false }], '+84 912 345 678 = 0912345678')
      assert.deepEqual(await row(P.other), [], 'mã khác: không nạp')
      assert.deepEqual(await row(P.okOnly), [], 'chỉ thành công: không có dòng')
      assert.deepEqual(await row(P.noUid), [{ a: LOOKUP, e: Z216, z: 'find_user_without_uid', cleared: false }])
      assert.deepEqual(await row(P.falseSkip), [{ a: LOOKUP, e: Z216, z: '212', cleared: true }])
      assert.equal(await keyOf('abc'), null, 'SĐT không có chữ số: không có khoá')
    })
    await check('số đo: đếm mọi kết quả và kết quả "lẽ ra bị bỏ qua" theo mã + tuổi lần hỏng; dòng quá hạn / do việc kiểm ghi không lẫn vào', async () => {
      const s = chunkedStats
      // Kết quả đã nạp (không tính dòng do việc kiểm ghi), đếm từ danh sách lịch sử ở trên.
      const lookupRows = events.filter(e => e[2] === LOOKUP && !e[6])
      assert.equal(s[`${LOOKUP}|all|bad`], lookupRows.filter(e => e[3] === Z216 || e[3] === Z219).length)
      assert.equal(s[`${LOOKUP}|all|ok`], lookupRows.filter(e => e[3] === null).length)
      assert.equal(s[`${LOOKUP}|all|other`], 1)
      assert.equal(s[`${MESSAGE}|all|bad`], 1)
      // P.repeat: hỏng 20 ngày trước rồi hỏng lại 10 ngày sau → 1 lần "đúng" (mã 216, tuổi 10 ngày).
      assert.equal(s[`${LOOKUP}|pred|${Z216}/216|d030|bad`], 1)
      // P.okAfterBad (hỏng 216, 25 ngày sau thành công) và P.falseSkip (hỏng 212, 10 ngày sau thành công): 2 lần "bỏ qua nhầm".
      assert.equal(s[`${LOOKUP}|pred|${Z216}/216|d030|ok`], 1)
      assert.equal(s[`${LOOKUP}|pred|${Z216}/212|d030|ok`], 1)
      const predicted = Object.entries(s).filter(([k]) => k.includes('|pred|')).reduce((n, [, v]) => n + Number(v), 0)
      assert.equal(predicted, 3, JSON.stringify(s))
    })
    await check('nạp lại từ đầu với một phần lớn: cùng bảng, cùng số đo (chia phần không đổi kết quả)', async () => {
      await db.query(`TRUNCATE private.auto_engine_phone_results; UPDATE private.auto_engine_phone_results_state SET last_detail_id = 0, stats = '{}', cleaned_at = NULL`)
      const res = await ingest(60000, 100000)
      assert.equal(res.chunks, 1)
      assert.deepEqual(await results(), chunked)
      assert.deepEqual(await stats(), chunkedStats)
      const again = await ingest(60000, 100000)
      assert.equal(again.rows, 0, 'gọi lại không nạp gì thêm')
      assert.deepEqual(await stats(), chunkedStats)
    })
    await check('mốc 3 phút: dòng vừa ghi chưa nạp; quá 3 phút thì nạp; ingest = false thì job đứng; nạp lần đầu ban ngày chỉ chạy ngân sách nhỏ', async () => {
      await insertHistory([0, P.fresh, LOOKUP, Z216, '216', 'old'], new Date().toISOString())
      const freshId = Number(await val(`SELECT max(id) FROM public.auto_campaign_details`))
      const r1 = await ingest()
      assert.ok(Number(r1.cap) < freshId, JSON.stringify(r1))
      assert.equal((await db.query(`SELECT 1 FROM private.auto_engine_phone_results WHERE phone_key = private.aka_agent_engine_phone_key($1)`, [P.fresh])).rowCount, 0)
      await db.query(`UPDATE public.auto_campaign_details SET created_at = now() - interval '4 minutes' WHERE id = $1`, [freshId])
      await setMode({ mode: 'off', organizationIds: [], ingest: false })
      assert.equal((await val(`SELECT private.aka_agent_engine_phone_results_ingest()`)).status, 'off')
      const r2 = await ingest()
      assert.equal(Number(r2.to), freshId)
      assert.equal((await db.query(`SELECT 1 FROM private.auto_engine_phone_results WHERE phone_key = private.aka_agent_engine_phone_key($1)`, [P.fresh])).rowCount, 1)
      // Nạp lần đầu ban ngày: job (không truyền ngân sách) chỉ chạy backfillDayBudgetMs; gọi tay có ngân sách thì không giới hạn.
      await setMode({ ...JSON.parse(V.SETTING_VALUE), backfillDayHours: [0, 24], backfillThresholdIds: -1, backfillDayBudgetMs: 700 })
      const throttled = await val(`SELECT private.aka_agent_engine_phone_results_ingest()`)
      assert.equal(throttled.throttled, true, JSON.stringify(throttled))
      assert.equal(throttled.budgetMs, 700)
      await setMode({ ...JSON.parse(V.SETTING_VALUE), backfillDayHours: [0, 0] })
      const night = await val(`SELECT private.aka_agent_engine_phone_results_ingest()`)
      assert.equal(night.throttled, false)
      assert.equal(night.budgetMs, 20000)
      assert.equal((await ingest(1500)).throttled, false)
      await setMode(JSON.parse(V.SETTING_VALUE))
      const state = await one(`SELECT runs, last_run FROM private.auto_engine_phone_results_state WHERE id = 1`)
      assert.ok(Number(state.runs) >= 4 && state.last_run.to === freshId, JSON.stringify(state))
    })

    // ---- 3. Claim ------------------------------------------------------------------------------------------------------------------
    const claimOf = async (entry, extraCtx = {}) => rpc(`SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r`, [JSON.stringify({
      runnerId: `desktop:v565:${entry.account}`, runtimeTarget: 'desktop', staffId: entry.staff, accountId: entry.account, campaignId: entry.campaign,
      ...type.claimPlan(entry.cfg), ...extraCtx })])
    const decisions = claim => Object.fromEntries(Object.entries(claim.actions || {}).map(([k, d]) => [k, d.decision === 'skip' ? `skip:${d.gate}:${d.errorCode}` : d.decision]))
    const ON_A = { mode: 'orgs', organizationIds: [ORG_A], ingest: true }
    await setMode(ON_A)
    const expectDecisions = async (label, opts, expected, status = 'claimed') => {
      const entry = await makeCampaign(opts)
      if (opts.before) await opts.before(entry)
      const claim = await claimOf(entry)
      assert.equal(claim.status, status, `${label}: ${JSON.stringify(claim)}`)
      if (expected) assert.deepEqual(decisions(claim), expected, label)
      return { entry, claim }
    }
    const SKIP = code => `skip:target_check:${code}`
    await check('claim: SĐT đã biết hỏng ở bước tìm SĐT → bỏ qua bước tìm (Z216, Z219, không có uid, SĐT khác định dạng)', async () => {
      for (const phone of [P.z216, P.z219, P.noUid, P.formatted, P.badAfterOk, P.fresh]) {
        const code = phone === P.z219 ? Z219 : Z216
        await expectDecisions(phone, { phones: [phone] }, { [LOOKUP]: SKIP(code), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      }
      await expectDecisions('dạng +84', { phones: ['+84901000001'] }, { [LOOKUP]: SKIP(Z216), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
    })
    await check('claim: không bỏ qua khi đã thành công lại, quá hạn, mã khác, chưa có lịch sử, tổ chức không bật, mode off, kiêm SMS', async () => {
      const ALLOW = { [LOOKUP]: 'allow', [MESSAGE]: 'allow', [FRIEND]: 'allow' }
      for (const phone of [P.okAfterBad, P.falseSkip, P.old, P.other, P.okOnly, P.synthetic, '0909999999']) await expectDecisions(phone, { phones: [phone] }, ALLOW)
      await expectDecisions('tổ chức B', { org: ORG_B, phones: [P.z216] }, ALLOW)
      await expectDecisions('kiêm SMS nội bộ', { phones: [P.z216], extra: { ...MSG_FRIEND, internalSmsEnabled: true } }, ALLOW)
      await expectDecisions('kiêm akaBiz Sms', { phones: [P.z216], extra: { ...MSG_FRIEND, externalSmsEnabled: true } }, ALLOW)
      await setMode({ mode: 'off', organizationIds: [ORG_A] })
      await expectDecisions('mode off', { phones: [P.z216] }, ALLOW)
      await setMode({ mode: 'all' })
      await expectDecisions('mode all', { org: ORG_B, phones: [P.z216] }, { [LOOKUP]: SKIP(Z216), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      await db.query(`UPDATE public.auto_system_settings SET value = 'không phải json' WHERE key = $1`, [V.SETTING_KEY])
      await expectDecisions('thiết lập hỏng', { phones: [P.z216] }, ALLOW)
      await setMode(ON_A)
    })
    await check('claim: tắt một mã (target_check_enabled = false) hoặc rút số ngày thì không bỏ qua mã đó', async () => {
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_enabled = false WHERE error_code = $1 AND action_code = $2`, [Z219, LOOKUP])
      await expectDecisions('Z219 tắt', { phones: [P.z219] }, { [LOOKUP]: 'allow', [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      await expectDecisions('Z216 vẫn bật', { phones: [P.z216] }, { [LOOKUP]: SKIP(Z216), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_enabled = true WHERE error_code = $1 AND action_code = $2`, [Z219, LOOKUP])
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_days = 5 WHERE error_code = $1 AND action_code = $2`, [Z216, LOOKUP])
      await expectDecisions('Z216 10 ngày, xét 5 ngày', { phones: [P.z216] }, { [LOOKUP]: 'allow', [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      await expectDecisions('Z216 2 ngày, xét 5 ngày', { phones: [P.badAfterOk] }, { [LOOKUP]: SKIP(Z216), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_days = 365 WHERE error_code = $1 AND action_code = $2`, [Z216, LOOKUP])
    })
    await check('claim: chặn tin người lạ (Z122): chỉ bỏ bước nhắn tin; chiến dịch chỉ nhắn tin thì bỏ cả bước tìm SĐT', async () => {
      await expectDecisions('nhắn + kết bạn', { phones: [P.z122] }, { [LOOKUP]: 'allow', [MESSAGE]: SKIP(Z122), [FRIEND]: 'allow' })
      await expectDecisions('chỉ nhắn tin', { phones: [P.z122], extra: MSG_ONLY }, { [LOOKUP]: SKIP(Z122), [MESSAGE]: 'allow' })
      for (const flag of ['enableZaloTag', 'enableZaloAlias', 'enableAkaBizTag']) {
        await expectDecisions(`nhắn tin + ${flag}`, { phones: [P.z122], extra: { ...MSG_ONLY, [flag]: true } }, { [LOOKUP]: 'allow', [MESSAGE]: SKIP(Z122) })
      }
      await expectDecisions('cờ dạng chuỗi "true" không tính (như lõi: === true)', { phones: [P.z122], extra: { ...MSG_ONLY, enableAddFriend: 'true' } },
        { [LOOKUP]: SKIP(Z122), [MESSAGE]: 'allow' })
      await expectDecisions('chỉ kết bạn: Z122 không liên quan', { phones: [P.z122], extra: { enableMessage: false, enableAddFriend: true, actionLimits: LIMITS } },
        { [LOOKUP]: 'allow', [FRIEND]: 'allow' })
      const canSkip = { ...MSG_FRIEND, actionLimits: { ...LIMITS, continueWhenActionLimitReached: true } }
      await expectDecisions('tiếp tục khi đạt giới hạn', { phones: [P.z122], extra: canSkip }, { [LOOKUP]: 'allow', [MESSAGE]: SKIP(Z122), [FRIEND]: 'allow' })
    })
    const lock = (entry, action, minutes = 30) => db.query(`INSERT INTO public.auto_account_action_status (account_id, action_code, is_disable, date_enable,
      disabled_error_code) VALUES ($1, $2, true, now() + make_interval(mins => $3), 'err_undefined')
      ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable`, [entry.account, action, minutes])
    await check('claim: tìm SĐT đang khoá vẫn bỏ qua SĐT đã biết hỏng; bước gửi đang khoá thì vẫn chờ (không bỏ qua)', async () => {
      await expectDecisions('tìm SĐT khoá + Z216', { phones: [P.z216], before: e => lock(e, LOOKUP) },
        { [LOOKUP]: SKIP(Z216), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      const { claim } = await expectDecisions('tìm SĐT khoá + SĐT lạ', { phones: ['0909999998'], before: e => lock(e, LOOKUP) }, null, 'wait')
      assert.equal(claim.wait.gate, 'action_lock')
      const { claim: w } = await expectDecisions('nhắn tin khoá + Z122', { phones: [P.z122], before: e => lock(e, MESSAGE) }, null, 'wait')
      assert.equal(w.actions[MESSAGE].decision, 'wait')
    })

    // ---- 4. Report -----------------------------------------------------------------------------------------------------------------
    const report = (claim, outcomes, final = false) => rpc(`SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r`,
      [claim.targetRunId, claim.leaseToken, JSON.stringify(outcomes), final])
    const skipOutcome = (claim, action, name, code) => ({ resultKey: `v2:${claim.targetRunId}:${action}`, actionCode: action, actionName: name, stepKey: action,
      ok: true, phase: 'after_send', statusCode: 'campaign_detail_skipped', data: { gate: 'target_check', rememberedErrorCode: code } })
    const zaloError = (claim, action, name, zcode, message) => ({ resultKey: `v2:${claim.targetRunId}:${action}`, actionCode: action, actionName: name,
      stepKey: action, ok: false, phase: 'after_send', signal: { kind: 'zalo_code', code: zcode, message } })
    const detailOf = async claim => one(`SELECT d.action_code, d.action_name, d.status, d.status_id, d.error_code, d.report_group, d.log, d.counts_toward_limit,
        d.data, d.policy_snapshot, i.status AS input_status, i.note AS input_note FROM public.auto_campaign_details d
        JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id WHERE d.input_data_id = $1 ORDER BY d.id DESC LIMIT 1`, [claim.target.id])
    const quota = async (entry, action) => Number(await val(`SELECT coalesce(max(count_action_in_day), 0) FROM public.auto_account_action_status
      WHERE account_id = $1 AND action_code = $2`, [entry.account, action]))
    const comparable = d => ({ action_code: d.action_code, action_name: d.action_name, status: d.status, status_id: d.status_id, error_code: d.error_code,
      report_group: d.report_group, log: d.log, input_status: d.input_status })
    await check('report: bỏ qua bước tìm SĐT (Z216) ghi y như Zalo trả 216 (trạng thái, câu, data hoàn thành), chỉ khác không tính lượt', async () => {
      const real = await makeCampaign({ phones: ['0909000216'] })
      const rc = await claimOf(real)
      assert.equal(rc.actions[LOOKUP].decision, 'allow')
      const rr = await report(rc, [zaloError(rc, LOOKUP, 'Tìm SĐT', '216', 'Số điện thoại không tồn tại')])
      const tc = await makeCampaign({ phones: [P.z216] })
      const tcc = await claimOf(tc)
      const tr = await report(tcc, [skipOutcome(tcc, LOOKUP, 'Tìm SĐT', Z216)])
      assert.equal(tr.ok, true, JSON.stringify(tr))
      // Như lõi: bước sau phụ thuộc bước tìm SĐT nên bỏ, hết bước thì báo chốt (không kết quả mới).
      const rf = rr.target.done ? rr : await report(rc, [], true)
      const tf = tr.target.done ? tr : await report(tcc, [], true)
      assert.equal(rf.target.done, true)
      assert.equal(tf.target.done, true)
      assert.equal(tf.target.status, rf.target.status)
      const pick = res => { const o = res.outcomes[0]; return { ok: o.ok, errorCode: o.errorCode, publicCode: o.publicCode, statusCode: o.statusCode,
        reportGroup: o.reportGroup, log: o.log, actionCode: o.actionCode, actionName: o.actionName, deliveryState: o.deliveryState } }
      assert.deepEqual(pick(tr), pick(rr))
      assert.equal(tr.outcomes[0].countsTowardLimit, false)
      assert.equal(rr.outcomes[0].countsTowardLimit, true, 'Zalo trả 216 thật: tính lượt tìm SĐT')
      assert.equal(tr.target.done, rr.target.done)
      assert.equal(tr.next, rr.next)
      const dr = await detailOf(rc), dt = await detailOf(tcc)
      assert.deepEqual(comparable(dt), comparable(dr))
      assert.equal(dt.input_status, 'hoàn thành')
      assert.equal(dt.counts_toward_limit, false)
      assert.deepEqual(dt.data, { engine: 'v2', phase: 'after_send', deliveryState: 'none' }, 'không ghi tín hiệu / cổng vào dòng lịch sử')
      assert.equal(dt.policy_snapshot.v2.targetCheck, true)
      assert.equal(JSON.stringify(dt).includes('target_check'), false)
      assert.equal(await quota(real, LOOKUP), 1)
      assert.equal(await quota(tc, LOOKUP), 0)
    })
    await check('report: chỉ nhắn tin + Z122 → một dòng "Nhắn tin người lạ" như Zalo trả 122, không có dòng tìm SĐT, data hoàn thành', async () => {
      const tc = await makeCampaign({ phones: [P.z122], extra: MSG_ONLY })
      const c = await claimOf(tc)
      assert.equal(c.actions[LOOKUP].errorCode, Z122)
      const first = await report(c, [skipOutcome(c, LOOKUP, 'Tìm SĐT', Z122)])
      assert.equal(first.outcomes[0].actionCode, MESSAGE)
      assert.equal(first.outcomes[0].actionName, 'Nhắn tin người lạ')
      const res = first.target.done ? first : await report(c, [], true)
      assert.equal(res.target.done, true)
      const rows = (await db.query(`SELECT action_code, action_name, status, error_code, counts_toward_limit FROM public.auto_campaign_details
        WHERE input_data_id = $1 ORDER BY id`, [c.target.id])).rows
      assert.deepEqual(rows, [{ action_code: MESSAGE, action_name: 'Nhắn tin người lạ', status: 'thất bại', error_code: Z122, counts_toward_limit: false }])
      assert.equal(await val(`SELECT status FROM public.auto_campaign_input_data WHERE id = $1`, [c.target.id]), 'hoàn thành')
      // So với Zalo trả 122 thật ở bước nhắn tin (sau khi tìm SĐT thành công).
      const real = await makeCampaign({ phones: ['0909000122'], extra: MSG_ONLY })
      const rc = await claimOf(real)
      await report(rc, [{ resultKey: `v2:${rc.targetRunId}:${LOOKUP}`, actionCode: LOOKUP, actionName: 'Tìm SĐT', stepKey: LOOKUP, ok: true, phase: 'after_send',
        statusCode: 'campaign_detail_success' }])
      const rr = await report(rc, [zaloError(rc, MESSAGE, 'Nhắn tin người lạ', '122', 'Không thể nhận tin nhắn từ bạn.')])
      const pick = o => ({ ok: o.ok, errorCode: o.errorCode, publicCode: o.publicCode, statusCode: o.statusCode, reportGroup: o.reportGroup, log: o.log,
        actionCode: o.actionCode, actionName: o.actionName, deliveryState: o.deliveryState })
      assert.deepEqual(pick(first.outcomes[0]), pick(rr.outcomes[0]))
      assert.equal(first.outcomes[0].countsTowardLimit, false)
    })
    await check('report: nhắn + kết bạn + Z122: dòng nhắn tin như thật, bước kết bạn vẫn chạy; không cộng chuỗi data lỗi, không nghỉ', async () => {
      const tc = await makeCampaign({ phones: [P.z122] })
      const c = await claimOf(tc)
      await report(c, [{ resultKey: `v2:${c.targetRunId}:${LOOKUP}`, actionCode: LOOKUP, actionName: 'Tìm SĐT', stepKey: LOOKUP, ok: true, phase: 'after_send',
        statusCode: 'campaign_detail_success' }])
      const m = await report(c, [skipOutcome(c, MESSAGE, 'Nhắn tin người lạ', Z122)])
      assert.equal(m.outcomes[0].errorCode, Z122)
      assert.equal(m.target.done, false, 'kết bạn còn chạy')
      await rpc(`SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r`, [c.targetRunId, c.leaseToken, FRIEND, FRIEND])
      const f = await report(c, [{ resultKey: `v2:${c.targetRunId}:${FRIEND}`, actionCode: FRIEND, actionName: 'Kết bạn', stepKey: FRIEND, ok: true,
        phase: 'after_send', statusCode: 'campaign_detail_success' }], true)
      assert.equal(f.target.done, true)
      const contrib = await val(`SELECT decision->'contrib' FROM public.auto_engine_outcomes WHERE result_key = $1`, [`v2:${c.targetRunId}:${MESSAGE}`])
      assert.equal(contrib.streak, 'ignore')
      assert.equal(contrib.pace.mode, 'none')
      assert.equal(contrib.campaignEffect, 'none')
      assert.equal(await quota(tc, MESSAGE), 0)
      assert.equal(await quota(tc, FRIEND), 1)
    })
    await check('nạp lịch sử bỏ qua các dòng vừa ghi thay cho bước bỏ qua (không tự nuôi), vẫn nạp kết quả Zalo thật', async () => {
      await db.query(`UPDATE public.auto_campaign_details SET created_at = created_at - interval '5 minutes' WHERE created_at > now() - interval '5 minutes'`)
      const before = await stats()
      await ingest()
      const after = await stats()
      // Mới thật: Zalo trả 216 (0909000216), 122 (0909000122); tìm SĐT thành công của 0909000122 và của chiến dịch nhắn + kết bạn.
      assert.equal(after[`${LOOKUP}|all|bad`] - before[`${LOOKUP}|all|bad`], 1)
      assert.equal(after[`${MESSAGE}|all|bad`] - before[`${MESSAGE}|all|bad`], 1)
      assert.equal(after[`${LOOKUP}|all|ok`] - before[`${LOOKUP}|all|ok`], 2)
    })

    // ---- 5. Lõi thật -------------------------------------------------------------------------------------------------------------
    await check('lõi thật: SĐT đã biết không gọi Zalo; dòng tiến trình giống hệt khi Zalo trả lỗi; không câu nào nhắc việc kiểm; data đều hoàn thành', async () => {
      // Data đầu là SĐT bình thường để có nhịp nghỉ sau nó (lõi chỉ nghỉ khi còn data phía sau).
      const PHONES = { fine: '0907000001', known216: P.z216, new216: '0907000216', known122: P.z122, new122: '0907000122' }
      const entry = await makeCampaign({ phones: Object.values(PHONES), extra: MSG_ONLY })
      const log = { sends: [], events: [], db: [], lines: [], traces: [], units: [] }
      const reads = []
      const hooks = {
        beforeRead: async ctx => {
          reads.push(ctx.target.phone)
          if (ctx.target.phone === PHONES.new216) throw W.renderError(E, { code: '216', message: 'Số điện thoại không tồn tại' }, 'desktop', 'read')
        },
        beforeSend: async (ctx, part) => {
          if (part === 'text' && ctx.target.phone === PHONES.new122) throw W.renderError(E, { code: '122', message: 'Không thể nhận tin nhắn từ bạn.' }, 'desktop', 'send')
        }
      }
      const query = async (sql, params) => (await db.query(sql, params)).rows
      const port = makePort({ E, model: {}, rt: 'desktop', seed: 5, chaos: 0, inject: 0, engineChaos: {}, query, rpc: (sql, args) => rpc(sql, args), log, hooks,
        forceOk: true, entry: { campaignId: entry.campaign, accountId: entry.account, actionId: 'zalo_message_phone', sample: { sampleId: 1 }, universeSize: 3 } })
      const data = {
        claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
        claimBatch: ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
        markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
        report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
        reportBatch: (tok, items, size, stopped) => rpc('SELECT public.aka_agent_engine_report_batch_v1($1, $2::jsonb, $3, $4) AS r', [tok, JSON.stringify(items), size, stopped]),
        heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
        release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
      }
      const lines = []
      const clock = testClock()
      const random = W.mulberry32(5)
      const afterReport = type.afterReport?.(entry.cfg, port, { targetLabel: type.targetLabel }) ?? null
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock, events: { progress: l => lines.push(l), trace: () => {} } }, {
        runnerId: `desktop:v565:${entry.account}`, runtimeTarget: 'desktop', staffId: entry.staff, accountId: entry.account, campaignId: entry.campaign,
        actionId: 'zalo_message_phone', campaignName: 'Kiểm SĐT', accountName: 'Zalo', campaignNote: null, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(entry.cfg),
        buildSteps: () => type.buildSteps(entry.cfg, port, { account: { id: entry.account, name: 'Zalo' }, mediaStepTimeoutMs: 4000, textStepTimeoutMs: 2500,
          aiRewriteTimeoutMs: 1000, random }),
        ...(type.validate ? { validateCampaign: () => type.validate(entry.cfg, { zaloWeb: false }) } : {}),
        ...(afterReport ? { afterReport } : {}),
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, $3) AS r', [entry.account, info.leaseToken, info.note ?? null]),
        formatTime: iso => new Date(iso).toISOString(), pacing: { fullSeconds: 7 }, stepTimeoutMs: 2500, heartbeatMs: HEARTBEAT_MS,
        retry: { callTimeoutMs: 8000, backoffMs: [5, 10, 20] }, drainTimeoutMs: 2000
      }, new AbortController().signal)
      if (process.env.V565_DUMP === '1') for (const l of lines) console.log(`  [${l.inputDataId ?? '-'}] ${l.text}`)
      assert.equal(result.reason, 'no_target', JSON.stringify(result))
      assert.deepEqual(reads.sort(), [PHONES.fine, PHONES.new122, PHONES.new216].sort(), 'chỉ gọi Zalo tìm SĐT cho SĐT chưa biết')
      assert.deepEqual(log.sends.filter(s => s.part === 'text').map(s => s.ident).length, 1, 'chỉ một tin gửi được (SĐT bình thường)')
      const idOf = Object.fromEntries(Object.entries(PHONES).map(([k, phone]) => [k, entry.ids[Object.values(PHONES).indexOf(phone)]]))
      const textsOf = (key, phone) => lines.filter(l => l.inputDataId === idOf[key]).map(l => l.text.split(phone).join('<SĐT>'))
      assert.deepEqual(textsOf('known216', PHONES.known216), textsOf('new216', PHONES.new216), 'Z216 đã biết = Zalo trả 216')
      const new122 = textsOf('new122', PHONES.new122)
      const known122 = textsOf('known122', PHONES.known122)
      assert.deepEqual(known122, new122.filter(t => !/Tìm SĐT/.test(t)), 'Z122 đã biết (chỉ nhắn tin) = Zalo trả 122, trừ dòng tìm SĐT thành công')
      assert.ok(known122.some(t => /Z122/.test(t)), JSON.stringify(known122))
      for (const l of lines) assert.equal(/target_check|kiểm|đã biết|🚫/.test(l.text), false, l.text)
      const statuses = (await db.query(`SELECT status FROM public.auto_campaign_input_data WHERE campaign_id = $1`, [entry.campaign])).rows.map(r => r.status)
      assert.deepEqual([...new Set(statuses)], ['hoàn thành'])
      assert.equal(await quota(entry, LOOKUP), 3, 'tìm SĐT tính 3 lượt (3 SĐT chưa biết)')
      assert.equal(await quota(entry, MESSAGE), 2, 'nhắn tin tính 2 lượt (gửi được + Zalo trả 122 thật)')
      // Nghỉ giữa data: không nghỉ sau data đã biết là hỏng (dòng "⏳ Nghỉ" đứng ngay sau "✅ Hoàn thành" của data đó).
      const pacedAfter = new Set()
      let lastDone = null
      for (const l of lines) {
        if (/^✅ Hoàn thành/.test(l.text)) lastDone = l.inputDataId
        else if (/^⏳ Nghỉ/.test(l.text) && lastDone !== null) pacedAfter.add(lastDone)
      }
      assert.equal(pacedAfter.has(idOf.known216) || pacedAfter.has(idOf.known122), false, JSON.stringify(lines.map(l => l.text)))
      assert.equal(pacedAfter.has(idOf.fine), true, 'vẫn nghỉ sau tin gửi được')
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })

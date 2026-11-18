// V571 (engine v2 kiểm người nhận trên toàn hệ thống trước khi gọi Zalo) trên PostgreSQL 17 cục bộ dùng một lần, không chạm DB thật, không gọi Zalo:
//   node scripts/engine-v2-target-check-v571-smoke.cjs        (module pg tìm ở ../akaAgentChatApi, hoặc CHAT_REPO=<thư mục có pg>;
//   V571_DUMP=1 in các dòng tiến trình của các lượt chạy lõi thật)
// DB engine như production 18/11/2026 (V495 → V532, V556–V558, V564; normalize_phone thân production; zalo_users tối thiểu), rồi:
//   1. apply / gỡ / chặn chạy lại / quyền;
//   2. nạp lịch sử: khoá SĐT và global id, thành công lại (bạn bè không tính), quá hạn, dòng do việc kiểm ghi, SĐT khác định dạng, mã chỉ
//      theo dõi, mốc 3 phút, giới hạn ban ngày; chia phần bao nhiêu cũng ra cùng sổ và cùng số đo;
//   3. claim chiến dịch theo SĐT và theo UID: từng quyết định skip / không skip (tắt, sai tổ chức, kiêm SMS, mã tắt, quá số ngày, bạn bè,
//      không có global id, khoá thao tác, hết lượt), học chéo SĐT ↔ global id, bật mã đã theo dõi có hiệu lực ngay, mọi bước gửi đã biết hỏng;
//   4. report: dòng lịch sử giống kết quả Zalo thật của cùng mã (trạng thái, câu, data hoàn thành), chỉ khác không tính lượt; bỏ bước tìm SĐT
//      tách thành một dòng cho mỗi bước gửi;
//   5. lõi thật (runUnit + cổng Zalo giả), chiến dịch theo SĐT và theo UID: người nhận đã biết không gọi Zalo bước đó, dòng tiến trình giống
//      hệt khi Zalo trả lỗi, không câu nào nhắc việc kiểm.
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
const V = require('./build-v571-sql.cjs')

const PORT = Number(process.env.V571_TEST_PORT || 55565)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
/** normalize_phone(text) của production (md5 pg_get_functiondef đọc chỉ đọc 18/11/2026 = bản chụp V431). */
const NORMALIZE_PHONE_MD5 = 'f6ccb574895043480e6523193f7be007'
/** zalo_users tối thiểu: các cột claim đọc, index duy nhất (account_id, zalo_uid) như production (đọc chỉ đọc 18/11/2026). */
const ZALO_USERS_STUB = `CREATE TABLE public.zalo_users (id bigserial PRIMARY KEY, account_id bigint NOT NULL, zalo_uid text NOT NULL, global_id text,
  is_fr integer, phone_number text);
CREATE UNIQUE INDEX idx_zalo_users_account_uid ON public.zalo_users (account_id, zalo_uid);`
/** Mã nhóm target_permanent như production 18/11 (bản chụp danh mục 06/11 của DB thử chưa có cột này). */
const TARGET_PERMANENT = ['err_zalo_user_not_found', 'err_zalo_219_find_phone_invalid', 'err_zalo_210_target_unavailable',
  'err_zalo_receiver_blocks_stranger_message', 'err_zalo_receiver_blocks_message', 'err_zalo_215_251_add_friend_rejected', 'err_zalo_api_business_failed',
  'err_zalo_invalid_param']
const LOOKUP = 'zalo_find_phone_user'
const MESSAGE = 'zalo_message_stranger'
const FRIEND = 'zalo_add_friend'
const Z216 = 'err_zalo_user_not_found'
const Z219 = 'err_zalo_219_find_phone_invalid'
const Z210 = 'err_zalo_210_target_unavailable'
const Z122 = 'err_zalo_receiver_blocks_stranger_message'
const Z215 = 'err_zalo_215_251_add_friend_rejected'
const HEARTBEAT_MS = 61_237

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-v571-'))
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
  assert.equal(md5(files.p1), md5(V.migrationP1), 'p1 khác bản bộ sinh tạo: chạy lại node scripts/build-v571-sql.cjs')
  assert.equal(md5(files.p2), md5(V.migrationP2), 'p2 khác bản bộ sinh tạo')
  assert.equal(md5(files.r1), md5(V.rollbackP1), 'bản gỡ p1 khác bản bộ sinh tạo')
  assert.equal(md5(files.r2), md5(V.rollbackP2), 'bản gỡ p2 khác bản bộ sinh tạo')
  const phoneFn = JSON.parse(fs.readFileSync(path.join(ROOT, 'migrations/snapshots/cooldown-history-v431/phone-dependency.json'), 'utf8'))
    .find(f => f.signature === 'normalize_phone(text)').definition
  assert.equal(md5(phoneFn), NORMALIZE_PHONE_MD5, 'normalize_phone của bản chụp khác production')

  const E = await loadEngine()
  const phoneType = E.zaloCampaignType('zalo_message_phone')
  const memberType = E.zaloCampaignType('zalo_message_group_member')
  const cluster = startCluster({ port: PORT, label: 'aka-v571-', timeoutMs: 900_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await db.query(phoneFn)
    await db.query(`UPDATE public.auto_error SET error_class = 'target_permanent' WHERE error_code = ANY ($1)`, [TARGET_PERMANENT])
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const fnMd5 = sig => val(`SELECT md5(pg_get_functiondef(to_regprocedure($1)))`, [sig])
    const ingest = (budget = 60000, chunk = 100000) => val(`SELECT private.aka_agent_engine_receiver_results_ingest($1, $2)`, [budget, chunk])
    const setMode = value => db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = $2`, [JSON.stringify(value), V.SETTING_KEY])

    // ---- 1. Apply / gỡ / quyền ---------------------------------------------------------------------------------------------------
    await check('DB thử: claim / report / normalize_phone = bản production 18/11', async () => {
      assert.equal(await fnMd5(V.CLAIM_SIG), V.LIVE.claim)
      assert.equal(await fnMd5(V.REPORT_SIG), V.LIVE.report)
      assert.equal(await fnMd5('public.normalize_phone(text)'), NORMALIZE_PHONE_MD5)
    })
    const columns = () => val(`SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
      AND attname IN ('target_check_enabled', 'target_check_days') AND NOT attisdropped`)
    await check('apply: p2 trước p1 / thiếu zalo_users bị chặn; giao dịch huỷ không để lại gì; chạy lại bị chặn; gỡ trả đúng thân cũ; apply lại', async () => {
      await assert.rejects(db.query(files.p2), /cần p1/)
      await db.query('ROLLBACK')
      await db.query(files.p1.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
      assert.equal(await columns(), 0)
      await db.query(files.p1)
      assert.equal(await columns(), 2)
      assert.deepEqual((await db.query(`SELECT error_code, action_code, target_check_enabled AS e, target_check_days AS d FROM public.auto_outcome_policies
        WHERE target_check_enabled IS NOT NULL ORDER BY error_code`)).rows,
        [{ error_code: Z219, action_code: LOOKUP, e: true, d: 365 }, { error_code: Z122, action_code: MESSAGE, e: true, d: 365 },
          { error_code: Z216, action_code: LOOKUP, e: true, d: 365 }])
      // Ràng buộc: chỉ dòng (mã × thao tác) không giới hạn loại chiến dịch / nơi chạy; có cờ thì phải có số ngày.
      await assert.rejects(db.query(`UPDATE public.auto_outcome_policies SET target_check_days = NULL WHERE error_code = $1 AND action_code = $2`, [Z216, LOOKUP]),
        /auto_outcome_policies_target_check_v571/)
      const wide = await val(`SELECT min(id) FROM public.auto_outcome_policies WHERE action_code IS NULL AND error_code IS NOT NULL`)
      assert.ok(wide, 'cần một dòng chính sách không gắn thao tác')
      await assert.rejects(db.query(`UPDATE public.auto_outcome_policies SET target_check_enabled = true, target_check_days = 30 WHERE id = $1`, [wide]),
        /auto_outcome_policies_target_check_v571/)
      await assert.rejects(db.query(files.p2), /zalo_users/)
      await db.query('ROLLBACK')
      await db.query(ZALO_USERS_STUB)
      await db.query(files.p2.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
      assert.equal(await fnMd5(V.CLAIM_SIG), V.LIVE.claim)
      assert.equal(await val(`SELECT to_regclass('private.auto_engine_receiver_results')`), null)
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
      assert.equal(await val(`SELECT to_regclass('private.auto_engine_receiver_results')`), null)
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
    await check('mã theo dõi: mã Zalo thuộc về người nhận của 3 thao tác, trừ mã chung; cộng mã có target_check', async () => {
      const tracked = (await db.query(`SELECT action_code || '×' || error_code AS k FROM private.aka_agent_engine_target_check_tracked()`)).rows.map(x => x.k)
      for (const a of [LOOKUP, MESSAGE, FRIEND]) for (const e of [Z216, Z219, Z210, Z122, Z215]) assert.ok(tracked.includes(`${a}×${e}`), `${a}×${e}`)
      assert.equal(tracked.some(k => k.endsWith('×err_zalo_api_business_failed') || k.endsWith('×err_zalo_invalid_param')), false)
      assert.equal(tracked.some(k => k.startsWith('zalo_message_group×')), false)
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
    /** Chiến dịch một tài khoản, data theo danh sách { phone, uid, name }. zaloUsers: { uid: { globalId, friend } } cho tài khoản đó. */
    const makeCampaign = async ({ org = ORG_A, actionId = 'zalo_message_phone', extra = MSG_FRIEND, targets = [], zaloUsers = {} } = {}) => {
      const staff = org * 10 + 1
      const account = await newAccount(org, staff)
      const campaign = ++nextId
      await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, schedule_type,
          content, extra_settings) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', now() - interval '1 minute', false, $5, $6, 'daily',
          'Xin chào', $7)`, [campaign, `Kiểm người nhận ${campaign}`, actionId, account, staff, org, JSON.stringify(extra)])
      const ids = []
      for (const t of targets) {
        const id = ++nextId
        const row = typeof t === 'string' ? { phone: t } : t
        await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, phone, uid, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, $5, 'chờ xử lý', false)`, [id, campaign, row.name ?? `Khách ${id}`, row.phone ?? null, row.uid ?? null])
        ids.push(id)
      }
      for (const [uid, z] of Object.entries(zaloUsers)) {
        await db.query(`INSERT INTO public.zalo_users (account_id, zalo_uid, global_id, is_fr) VALUES ($1, $2, $3, $4)`, [account, uid, z.globalId ?? null, z.friend ? 1 : 0])
      }
      const cfg = { id: campaign, actionId, accountId: account, content: 'Xin chào', extraSettings: extra, images: [], dataTargetSourceMode: null }
      return { org, staff, account, campaign, ids, cfg, extra, type: E.zaloCampaignType(actionId) }
    }

    // Lịch sử của tổ chức khác (mỗi kết quả một data riêng), theo thứ tự thời gian như id của production.
    const hist = await makeCampaign({ org: ORG_H })
    const P = {
      z216: '0901000001', z219: '0901000002', okAfterBad: '0901000003', badAfterOk: '0901000004', z122: '0901000005', old: '0901000006',
      synthetic: '0901000007', formatted: '0912345678', other: '0901000009', repeat: '0901000011', falseSkip: '0901000012', okOnly: '0901000013',
      noUid: '0901000014', fresh: '0901000015', z210: '0901000016', g103: '0901000103', g104: '0901000104', both: '0901000201'
    }
    // [ngày trước, SĐT data, thao tác, mã lỗi (null = thành công), mã Zalo gốc, kiểu ghi, { globalId, targetPhone, friend, synthetic }]
    const events = [
      [400, P.old, LOOKUP, Z216, '216', 'old'],
      [40, P.badAfterOk, LOOKUP, null, null, 'engine', { globalId: 'G4' }],
      [30, P.okAfterBad, LOOKUP, Z216, '216', 'old'],
      [20, P.z219, LOOKUP, Z219, '219', 'engine'],
      [20, P.repeat, LOOKUP, Z216, '216', 'old'],
      [15, P.falseSkip, LOOKUP, Z216, '212', 'old'],
      [12, P.other, LOOKUP, 'err_zalo_api_business_failed', null, 'old'],
      [10, P.z216, LOOKUP, Z216, '216', 'old'],
      [10, P.repeat, LOOKUP, Z216, '216', 'engine'],
      [9, '+84 912 345 678', LOOKUP, Z216, '216', 'engine'],
      [8, P.synthetic, LOOKUP, Z216, null, 'engine', { synthetic: true }],
      [8, P.z210, LOOKUP, Z210, '210', 'engine'],
      [6, P.okOnly, LOOKUP, null, null, 'old', { globalId: 'G13' }],
      [6, null, MESSAGE, Z122, '122', 'engine', { globalId: 'G102' }],
      [5, P.okAfterBad, LOOKUP, null, null, 'engine', { globalId: 'G3' }],
      [5, P.falseSkip, LOOKUP, null, null, 'old', { globalId: 'G12' }],
      [5, null, MESSAGE, Z122, '122', 'engine', { globalId: 'G101', friend: false }],
      [4, P.noUid, LOOKUP, Z216, 'find_user_without_uid', 'engine-signal'],
      [4, P.g103, MESSAGE, Z122, '122', 'engine', { globalId: 'G103', targetPhone: P.g103 }],
      [3, P.z122, MESSAGE, Z122, '122', 'engine', { globalId: 'G5', targetPhone: P.z122 }],
      [3, null, MESSAGE, Z122, '122', 'old', { globalId: 'G100', friend: false }],
      [3, P.both, MESSAGE, Z122, '122', 'engine', { globalId: 'G201', targetPhone: P.both }],
      [3, P.both, FRIEND, Z215, '215', 'engine', { globalId: 'G201', targetPhone: P.both }],
      [2, P.badAfterOk, LOOKUP, Z216, '216', 'old'],
      [2, null, MESSAGE, null, null, 'engine', { globalId: 'G101', friend: true }],
      [2, null, MESSAGE, Z122, '122', 'engine', { globalId: 'G104', targetPhone: P.g104, friend: false }],
      [1, null, MESSAGE, null, null, 'engine', { globalId: 'G102', friend: false }]
    ]
    const insertHistory = async ([days, phone, action, code, zalo, style, x = {}], createdAt = null) => {
      const inputId = ++nextId
      await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
        VALUES ($1, $2, 'Khách cũ', $3, 'hoàn thành', false)`, [inputId, hist.campaign, phone])
      const ok = code === null
      const target = x.globalId || x.targetPhone || x.friend !== undefined
        ? { ...(x.globalId ? { globalId: x.globalId } : {}), ...(x.targetPhone ? { phone: x.targetPhone } : {}), ...(x.friend !== undefined ? { isFriend: x.friend } : {}) }
        : null
      const data = style === 'old' ? { ...(zalo ? { zalo: { code: zalo } } : {}), ...(target ? { target } : {}) }
        : { engine: 'v2', phase: 'after_send', ...(zalo ? { signal: { kind: style === 'engine-signal' ? 'engine' : 'zalo_code', code: zalo } } : {}), ...(target ? { target } : {}) }
      const snapshot = style === 'old' ? null : { engine: 'v2', errorCode: code, v2: x.synthetic ? { targetCheck: true } : {} }
      await db.query(`INSERT INTO public.auto_campaign_details (input_data_id, campaign_id, account_id, action_name, action_code, status, error_code,
          report_group, counts_toward_limit, data, policy_snapshot, is_delete, created_at)
        VALUES ($1, $2, $3, 'x', $4, $5, $6, $7, true, $8, $9, false, coalesce($10::timestamptz, now() - make_interval(days => $11)))`,
        [inputId, hist.campaign, hist.account, action, ok ? 'thành công' : (code === Z122 || code === Z215 ? 'thất bại' : 'không tồn tại'), code,
          style === 'old' ? null : (ok ? 'success' : 'failure'), JSON.stringify(data), snapshot && JSON.stringify(snapshot), createdAt, days])
    }
    for (const e of events) await insertHistory(e)

    // ---- 2. Nạp lịch sử -----------------------------------------------------------------------------------------------------------
    const book = async () => (await db.query(`SELECT receiver_key::text AS k, key_kind, action_code AS a, error_code AS e, bad_zalo_code AS z,
        (ok_at IS NOT NULL AND ok_at > bad_at) AS cleared FROM private.auto_engine_receiver_results ORDER BY 1, 3, 4`)).rows
    const stats = async () => (await one(`SELECT stats FROM private.auto_engine_receiver_results_state WHERE id = 1`)).stats
    const rowsOf = async (kind, value) => (await db.query(`SELECT action_code AS a, error_code AS e, bad_zalo_code AS z,
        (ok_at IS NOT NULL AND ok_at > bad_at) AS cleared FROM private.auto_engine_receiver_results
        WHERE receiver_key = private.aka_agent_engine_receiver_key($1, $2) ORDER BY action_code, error_code`, [kind, value])).rows
    let chunked, chunkedStats
    await check('nạp lịch sử: đúng từng người nhận theo SĐT và global id (hỏng, thành công lại, quá hạn, dòng do việc kiểm ghi, định dạng SĐT)', async () => {
      const res = await ingest(60000, 3)
      assert.equal(res.status, 'ok')
      assert.equal(res.caughtUp, true)
      chunked = await book()
      chunkedStats = await stats()
      assert.deepEqual(await rowsOf('phone', P.z216), [{ a: LOOKUP, e: Z216, z: '216', cleared: false }])
      assert.deepEqual(await rowsOf('phone', P.z219), [{ a: LOOKUP, e: Z219, z: '219', cleared: false }])
      assert.deepEqual(await rowsOf('phone', P.okAfterBad), [{ a: LOOKUP, e: Z216, z: '216', cleared: true }], 'thành công sau lần hỏng')
      assert.deepEqual(await rowsOf('phone', P.badAfterOk), [{ a: LOOKUP, e: Z216, z: '216', cleared: false }], 'thành công cũ rồi hỏng lại')
      assert.deepEqual(await rowsOf('phone', P.z122), [{ a: MESSAGE, e: Z122, z: '122', cleared: false }])
      assert.deepEqual(await rowsOf('global', 'G5'), [{ a: MESSAGE, e: Z122, z: '122', cleared: false }], 'cùng kết quả ghi cả khoá global id')
      assert.deepEqual(await rowsOf('phone', P.old), [], 'quá 365 ngày (+1): bị dọn')
      assert.deepEqual(await rowsOf('phone', P.synthetic), [], 'dòng do chính việc kiểm ghi không được nạp')
      assert.deepEqual(await rowsOf('phone', P.formatted), [{ a: LOOKUP, e: Z216, z: '216', cleared: false }], '+84 912 345 678 = 0912345678')
      assert.deepEqual(await rowsOf('phone', P.other), [], 'mã chung: không theo dõi')
      assert.deepEqual(await rowsOf('phone', P.okOnly), [], 'chỉ thành công: không có dòng')
      assert.deepEqual(await rowsOf('phone', P.noUid), [{ a: LOOKUP, e: Z216, z: 'find_user_without_uid', cleared: false }])
      assert.deepEqual(await rowsOf('phone', P.falseSkip), [{ a: LOOKUP, e: Z216, z: '212', cleared: true }])
      assert.deepEqual(await rowsOf('phone', P.z210), [{ a: LOOKUP, e: Z210, z: '210', cleared: false }], 'mã chưa bật vẫn được theo dõi')
      assert.deepEqual(await rowsOf('global', 'G100'), [{ a: MESSAGE, e: Z122, z: '122', cleared: false }])
      assert.deepEqual(await rowsOf('global', 'G101'), [{ a: MESSAGE, e: Z122, z: '122', cleared: false }], 'thành công của bạn bè không xoá Z122')
      assert.deepEqual(await rowsOf('global', 'G102'), [{ a: MESSAGE, e: Z122, z: '122', cleared: true }], 'thành công của người lạ thì xoá')
      assert.deepEqual(await rowsOf('phone', P.g104), [{ a: MESSAGE, e: Z122, z: '122', cleared: false }], 'chiến dịch theo UID có SĐT: ghi cả khoá SĐT')
      assert.deepEqual(await rowsOf('phone', P.both), [{ a: FRIEND, e: Z215, z: '215', cleared: false }, { a: MESSAGE, e: Z122, z: '122', cleared: false }])
      assert.equal(await val(`SELECT private.aka_agent_engine_receiver_key('phone', 'abc')`), null, 'SĐT không có chữ số: không có khoá')
      assert.equal(await val(`SELECT private.aka_agent_engine_receiver_key('global', '  ')`), null)
    })
    await check('số đo: mọi kết quả theo mã, và kết quả "lẽ ra bị bỏ qua" theo mã trước + khoá + tuổi (same / ok / other)', async () => {
      const s = chunkedStats
      const live = events.filter(e => !(e[6] && e[6].synthetic))
      const label = e => e[3] === null ? (e[6] && e[6].friend ? 'other' : 'ok') : (e[3] === 'err_zalo_api_business_failed' ? 'other' : e[3])
      for (const action of [LOOKUP, MESSAGE, FRIEND]) {
        const want = {}
        for (const e of live.filter(x => x[2] === action)) want[label(e)] = (want[label(e)] || 0) + 1
        for (const [k, n] of Object.entries(want)) assert.equal(s[`${action}|all|${k}`], n, `${action}|all|${k}`)
      }
      assert.equal(s[`${LOOKUP}|pred|${Z216}/216|phone|d030|same`], 1, 'P.repeat: hỏng lại đúng mã')
      assert.equal(s[`${LOOKUP}|pred|${Z216}/216|phone|d030|ok`], 1, 'P.okAfterBad: bỏ nhầm')
      assert.equal(s[`${LOOKUP}|pred|${Z216}/212|phone|d030|ok`], 1, 'P.falseSkip (212): bỏ nhầm')
      assert.equal(s[`${MESSAGE}|pred|${Z122}/122|global|d007|ok`], 1, 'G102: người lạ nhắn được sau Z122')
      assert.equal(s[`${MESSAGE}|pred|${Z122}/122|global|d007|other`], 1, 'G101: bạn bè nhắn được (không tính bỏ nhầm)')
      const predicted = Object.entries(s).filter(([k]) => k.includes('|pred|')).reduce((n, [, v]) => n + Number(v), 0)
      assert.equal(predicted, 5, JSON.stringify(s))
    })
    await check('nạp lại từ đầu với một phần lớn: cùng sổ, cùng số đo (chia phần không đổi kết quả); gọi lại không nạp thêm', async () => {
      await db.query(`TRUNCATE private.auto_engine_receiver_results; UPDATE private.auto_engine_receiver_results_state SET last_detail_id = 0, stats = '{}', cleaned_at = NULL`)
      const res = await ingest(60000, 100000)
      assert.equal(res.chunks, 1)
      assert.deepEqual(await book(), chunked)
      assert.deepEqual(await stats(), chunkedStats)
      const again = await ingest(60000, 100000)
      assert.equal(again.rows, 0)
      assert.deepEqual(await stats(), chunkedStats)
    })
    await check('mốc 3 phút; ingest = false thì job đứng; nạp lần đầu ban ngày chỉ chạy ngân sách nhỏ', async () => {
      await insertHistory([0, P.fresh, LOOKUP, Z216, '216', 'old'], new Date().toISOString())
      const freshId = Number(await val(`SELECT max(id) FROM public.auto_campaign_details`))
      const r1 = await ingest()
      assert.ok(Number(r1.cap) < freshId, JSON.stringify(r1))
      assert.deepEqual(await rowsOf('phone', P.fresh), [])
      await db.query(`UPDATE public.auto_campaign_details SET created_at = now() - interval '4 minutes' WHERE id = $1`, [freshId])
      await setMode({ mode: 'off', organizationIds: [], ingest: false })
      assert.equal((await val(`SELECT private.aka_agent_engine_receiver_results_ingest()`)).status, 'off')
      const r2 = await ingest()
      assert.equal(Number(r2.to), freshId)
      assert.equal((await rowsOf('phone', P.fresh)).length, 1)
      await setMode({ ...JSON.parse(V.SETTING_VALUE), backfillDayHours: [0, 24], backfillThresholdIds: -1, backfillDayBudgetMs: 700 })
      const throttled = await val(`SELECT private.aka_agent_engine_receiver_results_ingest()`)
      assert.equal(throttled.throttled, true, JSON.stringify(throttled))
      assert.equal(throttled.budgetMs, 700)
      await setMode({ ...JSON.parse(V.SETTING_VALUE), backfillDayHours: [0, 0] })
      const night = await val(`SELECT private.aka_agent_engine_receiver_results_ingest()`)
      assert.equal(night.throttled, false)
      assert.equal(night.budgetMs, 40000)
      assert.equal((await ingest(1500)).throttled, false)
      await setMode(JSON.parse(V.SETTING_VALUE))
    })
    await check('giữ ít nhất 365 ngày: rút số ngày xét không làm dọn lần hỏng cũ', async () => {
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_days = 5 WHERE target_check_enabled IS NOT NULL`)
      await db.query(`UPDATE private.auto_engine_receiver_results_state SET cleaned_at = NULL`)
      const r = await ingest()
      assert.equal(r.deleted, 0)
      assert.equal((await rowsOf('phone', P.repeat)).length, 1, 'lần hỏng 10 ngày trước vẫn còn')
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_days = 365 WHERE target_check_enabled IS NOT NULL`)
    })

    // ---- 3. Claim ------------------------------------------------------------------------------------------------------------------
    const claimOf = async (entry, extraCtx = {}) => rpc(`SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r`, [JSON.stringify({
      runnerId: `desktop:v571:${entry.account}`, runtimeTarget: 'desktop', staffId: entry.staff, accountId: entry.account, campaignId: entry.campaign,
      ...entry.type.claimPlan(entry.cfg), ...extraCtx })])
    // Mã bỏ bước tìm SĐT vì mọi bước gửi đã biết hỏng là JSON {thao tác: mã}: so theo nội dung (khoá sắp xếp), không theo cách viết.
    const sortedJson = obj => JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a < b ? -1 : 1)))
    const codeText = code => String(code ?? '').startsWith('{') ? sortedJson(JSON.parse(code)) : code
    const decisions = claim => Object.fromEntries(Object.entries(claim.actions || {}).map(([k, d]) => [k, d.decision === 'skip' ? `skip:${d.gate}:${codeText(d.errorCode)}` : d.decision]))
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
    const SKIP_SENDS = codes => `skip:target_check:${sortedJson(codes)}`
    const ALLOW3 = { [LOOKUP]: 'allow', [MESSAGE]: 'allow', [FRIEND]: 'allow' }
    await check('claim theo SĐT: đã biết hỏng ở bước tìm SĐT → bỏ bước tìm (Z216, Z219, không có uid, khác định dạng, +84)', async () => {
      for (const phone of [P.z216, P.z219, P.noUid, P.formatted, P.badAfterOk, P.fresh, '+84901000001']) {
        const code = phone === P.z219 ? Z219 : Z216
        await expectDecisions(phone, { targets: [phone] }, { [LOOKUP]: SKIP(code), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      }
    })
    await check('claim: không bỏ qua khi đã thành công lại, quá hạn, mã chung, chưa có lịch sử, tổ chức không bật, mode off, kiêm SMS, thiết lập hỏng', async () => {
      for (const phone of [P.okAfterBad, P.falseSkip, P.old, P.other, P.okOnly, P.synthetic, '0909999999']) await expectDecisions(phone, { targets: [phone] }, ALLOW3)
      await expectDecisions('tổ chức B', { org: ORG_B, targets: [P.z216] }, ALLOW3)
      await expectDecisions('kiêm SMS nội bộ', { targets: [P.z216], extra: { ...MSG_FRIEND, internalSmsEnabled: true } }, ALLOW3)
      await expectDecisions('kiêm akaBiz Sms', { targets: [P.z216], extra: { ...MSG_FRIEND, externalSmsEnabled: true } }, ALLOW3)
      await setMode({ mode: 'off', organizationIds: [ORG_A] })
      await expectDecisions('mode off', { targets: [P.z216] }, ALLOW3)
      await setMode({ mode: 'all' })
      await expectDecisions('mode all', { org: ORG_B, targets: [P.z216] }, { [LOOKUP]: SKIP(Z216), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      await db.query(`UPDATE public.auto_system_settings SET value = 'không phải json' WHERE key = $1`, [V.SETTING_KEY])
      await expectDecisions('thiết lập hỏng', { targets: [P.z216] }, ALLOW3)
      await setMode(ON_A)
    })
    await check('claim: tắt mã (false) hoặc rút số ngày thì không bỏ qua; bật mã đã theo dõi (Z210) có hiệu lực ngay, không nạp lại', async () => {
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_enabled = false WHERE error_code = $1 AND action_code = $2`, [Z219, LOOKUP])
      await expectDecisions('Z219 tắt', { targets: [P.z219] }, ALLOW3)
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_enabled = true WHERE error_code = $1 AND action_code = $2`, [Z219, LOOKUP])
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_days = 5 WHERE error_code = $1 AND action_code = $2`, [Z216, LOOKUP])
      await expectDecisions('Z216 10 ngày, xét 5 ngày', { targets: [P.z216] }, ALLOW3)
      await expectDecisions('Z216 2 ngày, xét 5 ngày', { targets: [P.badAfterOk] }, { [LOOKUP]: SKIP(Z216), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_days = 365 WHERE error_code = $1 AND action_code = $2`, [Z216, LOOKUP])
      await expectDecisions('Z210 chỉ theo dõi', { targets: [P.z210] }, ALLOW3)
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_enabled = true, target_check_days = 365 WHERE error_code = $1 AND action_code = $2
        AND campaign_action_id IS NULL AND runtime_target IS NULL AND status_id IS NULL`, [Z210, LOOKUP])
      await expectDecisions('Z210 vừa bật', { targets: [P.z210] }, { [LOOKUP]: SKIP(Z210), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_enabled = NULL, target_check_days = NULL WHERE error_code = $1 AND action_code = $2`, [Z210, LOOKUP])
    })
    await check('claim theo SĐT + Z122: chỉ bỏ bước nhắn tin; chỉ nhắn tin thì bỏ cả bước tìm SĐT; có tag / đổi tên / tag akaBiz thì không', async () => {
      await expectDecisions('nhắn + kết bạn', { targets: [P.z122] }, { [LOOKUP]: 'allow', [MESSAGE]: SKIP(Z122), [FRIEND]: 'allow' })
      await expectDecisions('chỉ nhắn tin', { targets: [P.z122], extra: MSG_ONLY }, { [LOOKUP]: SKIP_SENDS({ [MESSAGE]: Z122 }), [MESSAGE]: 'allow' })
      for (const flag of ['enableZaloTag', 'enableZaloAlias', 'enableAkaBizTag']) {
        await expectDecisions(`nhắn tin + ${flag}`, { targets: [P.z122], extra: { ...MSG_ONLY, [flag]: true } }, { [LOOKUP]: 'allow', [MESSAGE]: SKIP(Z122) })
      }
      await expectDecisions('cờ dạng chuỗi "true" không tính (như lõi: === true)', { targets: [P.z122], extra: { ...MSG_ONLY, enableAddFriend: 'true' } },
        { [LOOKUP]: SKIP_SENDS({ [MESSAGE]: Z122 }), [MESSAGE]: 'allow' })
      await expectDecisions('chỉ kết bạn: Z122 không liên quan', { targets: [P.z122], extra: { enableMessage: false, enableAddFriend: true, actionLimits: LIMITS } },
        { [LOOKUP]: 'allow', [FRIEND]: 'allow' })
      const canSkip = { ...MSG_FRIEND, actionLimits: { ...LIMITS, continueWhenActionLimitReached: true } }
      await expectDecisions('tiếp tục khi đạt giới hạn', { targets: [P.z122], extra: canSkip }, { [LOOKUP]: 'allow', [MESSAGE]: SKIP(Z122), [FRIEND]: 'allow' })
      await expectDecisions('học chéo: Z122 ghi ở chiến dịch theo UID có SĐT', { targets: [P.g104], extra: MSG_ONLY }, { [LOOKUP]: SKIP_SENDS({ [MESSAGE]: Z122 }), [MESSAGE]: 'allow' })
    })
    await check('claim theo SĐT + mọi bước gửi đã biết hỏng (nhắn tin Z122, kết bạn Z215 khi bật) → bỏ cả bước tìm SĐT', async () => {
      await expectDecisions('Z215 chưa bật', { targets: [P.both] }, { [LOOKUP]: 'allow', [MESSAGE]: SKIP(Z122), [FRIEND]: 'allow' })
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_enabled = true, target_check_days = 365 WHERE error_code = $1 AND action_code = $2
        AND campaign_action_id IS NULL AND runtime_target IS NULL AND status_id IS NULL`, [Z215, FRIEND])
      await expectDecisions('Z215 bật', { targets: [P.both] }, { [LOOKUP]: SKIP_SENDS({ [FRIEND]: Z215, [MESSAGE]: Z122 }), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
    })
    const lock = (entry, action, minutes = 30) => db.query(`INSERT INTO public.auto_account_action_status (account_id, action_code, is_disable, date_enable,
      disabled_error_code) VALUES ($1, $2, true, now() + make_interval(mins => $3), 'err_undefined')
      ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable`, [entry.account, action, minutes])
    await check('claim: tìm SĐT đang khoá vẫn bỏ qua người nhận đã biết; bước gửi đang khoá thì vẫn chờ (không bỏ qua)', async () => {
      await expectDecisions('tìm SĐT khoá + Z216', { targets: [P.z216], before: e => lock(e, LOOKUP) }, { [LOOKUP]: SKIP(Z216), [MESSAGE]: 'allow', [FRIEND]: 'allow' })
      const { claim } = await expectDecisions('tìm SĐT khoá + SĐT lạ', { targets: ['0909999998'], before: e => lock(e, LOOKUP) }, null, 'wait')
      assert.equal(claim.wait.gate, 'action_lock')
      const { claim: w } = await expectDecisions('nhắn tin khoá + Z122', { targets: [P.z122], before: e => lock(e, MESSAGE) }, null, 'wait')
      assert.equal(w.actions[MESSAGE].decision, 'wait')
    })
    const MEMBER = { enableMessage: true, enableAddFriend: false, actionLimits: LIMITS }
    const MEMBER_FRIEND = { ...MEMBER, enableAddFriend: true }
    await check('claim theo UID (thành viên nhóm): tra global id ở zalo_users theo tài khoản; Z122 bỏ bước nhắn tin trừ khi đã là bạn bè', async () => {
      const m = (uid, z, extra = MEMBER) => ({ actionId: 'zalo_message_group_member', extra, targets: [{ uid, name: `Khách ${uid}` }], zaloUsers: z ? { [uid]: z } : {} })
      await expectDecisions('G100 lạ', m('ua-100', { globalId: 'G100' }), { [MESSAGE]: SKIP(Z122) })
      await expectDecisions('G100 + kết bạn', m('ua-100', { globalId: 'G100' }, MEMBER_FRIEND), { [MESSAGE]: SKIP(Z122), [FRIEND]: 'allow' })
      await expectDecisions('G100 nhưng đã là bạn bè', m('ua-100', { globalId: 'G100', friend: true }), { [MESSAGE]: 'allow' })
      await expectDecisions('G101 (bạn bè từng nhắn được)', m('ua-101', { globalId: 'G101' }), { [MESSAGE]: SKIP(Z122) })
      await expectDecisions('G102 (người lạ nhắn được rồi)', m('ua-102', { globalId: 'G102' }), { [MESSAGE]: 'allow' })
      await expectDecisions('học chéo: G103 ghi ở chiến dịch theo SĐT', m('ua-103', { globalId: 'G103' }), { [MESSAGE]: SKIP(Z122) })
      await expectDecisions('không có global id ở zalo_users', m('ua-100', null), { [MESSAGE]: 'allow' })
      await expectDecisions('zalo_users của tài khoản khác', m('ua-100', null), { [MESSAGE]: 'allow' })
      await expectDecisions('nhóm thời gian thực', { ...m('ua-100', { globalId: 'G100' }), actionId: 'zalo_message_group_realtime' }, { [MESSAGE]: SKIP(Z122) })
      await expectDecisions('khách hàng cũ', { ...m('ua-100', { globalId: 'G100' }), actionId: 'zalo_message_remarketing_customer' }, { [MESSAGE]: SKIP(Z122) })
      await expectDecisions('theo SĐT có UID cũ: thêm khoá global id', { targets: [{ phone: '0909000999', uid: 'ua-103' }], zaloUsers: { 'ua-103': { globalId: 'G103' } } },
        { [LOOKUP]: 'allow', [MESSAGE]: SKIP(Z122), [FRIEND]: 'allow' })
    })

    // ---- 4. Report -----------------------------------------------------------------------------------------------------------------
    const report = (claim, outcomes, final = false) => rpc(`SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r`,
      [claim.targetRunId, claim.leaseToken, JSON.stringify(outcomes), final])
    const skipOutcome = (claim, action, name, code) => ({ resultKey: `v2:${claim.targetRunId}:${action}`, actionCode: action, actionName: name, stepKey: action,
      ok: true, phase: 'after_send', statusCode: 'campaign_detail_skipped', data: { gate: 'target_check', rememberedErrorCode: code } })
    const okOutcome = (claim, action, name) => ({ resultKey: `v2:${claim.targetRunId}:${action}`, actionCode: action, actionName: name, stepKey: action,
      ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' })
    const zaloError = (claim, action, name, zcode, message) => ({ resultKey: `v2:${claim.targetRunId}:${action}`, actionCode: action, actionName: name,
      stepKey: action, ok: false, phase: 'after_send', signal: { kind: 'zalo_code', code: zcode, message } })
    const finish = async (claim, res) => res.target.done ? res : report(claim, [], true)
    const detailsOf = async inputId => (await db.query(`SELECT action_code, action_name, status, status_id, error_code, report_group, log, counts_toward_limit,
        data, policy_snapshot FROM public.auto_campaign_details WHERE input_data_id = $1 ORDER BY id`, [inputId])).rows
    const inputStatus = id => val(`SELECT status FROM public.auto_campaign_input_data WHERE id = $1`, [id])
    const quota = async (entry, action) => Number(await val(`SELECT coalesce(max(count_action_in_day), 0) FROM public.auto_account_action_status
      WHERE account_id = $1 AND action_code = $2`, [entry.account, action]))
    const pick = o => ({ ok: o.ok, errorCode: o.errorCode, publicCode: o.publicCode, statusCode: o.statusCode, reportGroup: o.reportGroup, log: o.log,
      actionCode: o.actionCode, actionName: o.actionName, deliveryState: o.deliveryState })
    const comparable = d => ({ action_code: d.action_code, action_name: d.action_name, status: d.status, status_id: d.status_id, error_code: d.error_code,
      report_group: d.report_group, log: d.log })
    await check('report: bỏ bước tìm SĐT (Z216) ghi y như Zalo trả 216 (trạng thái, câu, data hoàn thành), chỉ khác không tính lượt', async () => {
      const real = await makeCampaign({ targets: ['0909000216'] })
      const rc = await claimOf(real)
      const rr = await report(rc, [zaloError(rc, LOOKUP, 'Tìm SĐT', '216', 'Số điện thoại không tồn tại')])
      const tc = await makeCampaign({ targets: [P.z216] })
      const tcc = await claimOf(tc)
      const tr = await report(tcc, [skipOutcome(tcc, LOOKUP, 'Tìm SĐT', Z216)])
      assert.equal(tr.ok, true, JSON.stringify(tr))
      assert.deepEqual(pick(tr.outcomes[0]), pick(rr.outcomes[0]))
      assert.equal(tr.outcomes[0].countsTowardLimit, false)
      assert.equal(rr.outcomes[0].countsTowardLimit, true, 'Zalo trả 216 thật: tính lượt tìm SĐT')
      const rf = await finish(rc, rr), tf = await finish(tcc, tr)
      assert.equal(tf.target.status, rf.target.status)
      const [dr] = await detailsOf(rc.target.id), [dt] = await detailsOf(tcc.target.id)
      assert.deepEqual(comparable(dt), comparable(dr))
      assert.equal(await inputStatus(tcc.target.id), 'hoàn thành')
      assert.equal(dt.counts_toward_limit, false)
      assert.deepEqual(dt.data, { engine: 'v2', phase: 'after_send', deliveryState: 'none' }, 'không ghi tín hiệu / cổng vào dòng lịch sử')
      assert.equal(dt.policy_snapshot.v2.targetCheck, true)
      assert.equal(JSON.stringify(dt).includes('target_check'), false)
      assert.equal(await quota(real, LOOKUP), 1)
      assert.equal(await quota(tc, LOOKUP), 0)
    })
    await check('report: chỉ nhắn tin + Z122 → một dòng "Nhắn tin người lạ" như Zalo trả 122, không dòng tìm SĐT, data hoàn thành', async () => {
      const tc = await makeCampaign({ targets: [P.z122], extra: MSG_ONLY })
      const c = await claimOf(tc)
      const first = await report(c, [skipOutcome(c, LOOKUP, 'Tìm SĐT', c.actions[LOOKUP].errorCode)])
      assert.equal(first.outcomes.length, 1)
      assert.equal(first.outcomes[0].actionCode, MESSAGE)
      assert.equal(first.outcomes[0].actionName, 'Nhắn tin người lạ')
      const res = await finish(c, first)
      assert.equal(res.target.done, true)
      assert.deepEqual((await detailsOf(c.target.id)).map(d => [d.action_code, d.action_name, d.status, d.error_code, d.counts_toward_limit]),
        [[MESSAGE, 'Nhắn tin người lạ', 'thất bại', Z122, false]])
      assert.equal(await inputStatus(c.target.id), 'hoàn thành')
      const real = await makeCampaign({ targets: ['0909000122'], extra: MSG_ONLY })
      const rc = await claimOf(real)
      await report(rc, [okOutcome(rc, LOOKUP, 'Tìm SĐT')])
      const rr = await report(rc, [zaloError(rc, MESSAGE, 'Nhắn tin người lạ', '122', 'Không thể nhận tin nhắn từ bạn.')])
      assert.deepEqual(pick(first.outcomes[0]), pick(rr.outcomes[0]))
      // Gọi lại cùng resultKey: trả lại đúng kết quả cũ, không ghi thêm dòng.
      const again = await report(c, [skipOutcome(c, LOOKUP, 'Tìm SĐT', c.actions[LOOKUP].errorCode)])
      assert.equal(again.outcomes.length, 1)
      assert.equal((await detailsOf(c.target.id)).length, 1)
    })
    await check('report: mọi bước gửi đã biết hỏng → một lần bỏ bước tìm SĐT thành hai dòng (nhắn tin rồi kết bạn) như thật', async () => {
      const tc = await makeCampaign({ targets: [P.both] })
      const c = await claimOf(tc)
      const res = await finish(c, await report(c, [skipOutcome(c, LOOKUP, 'Tìm SĐT', c.actions[LOOKUP].errorCode)]))
      assert.equal(res.target.done, true)
      const rows = await detailsOf(c.target.id)
      assert.deepEqual(rows.map(d => [d.action_code, d.action_name, d.error_code, d.counts_toward_limit]),
        [[MESSAGE, 'Nhắn tin người lạ', Z122, false], [FRIEND, 'Kết bạn', Z215, false]])
      assert.equal(await inputStatus(c.target.id), 'hoàn thành')
      await db.query(`UPDATE public.auto_outcome_policies SET target_check_enabled = NULL, target_check_days = NULL WHERE error_code = $1 AND action_code = $2`, [Z215, FRIEND])
    })
    await check('report: nhắn + kết bạn + Z122: dòng nhắn tin như thật, kết bạn vẫn chạy; không cộng chuỗi, không nghỉ, không tính lượt', async () => {
      const tc = await makeCampaign({ targets: [P.z122] })
      const c = await claimOf(tc)
      await report(c, [okOutcome(c, LOOKUP, 'Tìm SĐT')])
      const m = await report(c, [skipOutcome(c, MESSAGE, 'Nhắn tin người lạ', Z122)])
      assert.equal(m.outcomes[0].errorCode, Z122)
      assert.equal(m.target.done, false, 'kết bạn còn chạy')
      await rpc(`SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r`, [c.targetRunId, c.leaseToken, FRIEND, FRIEND])
      const f = await report(c, [okOutcome(c, FRIEND, 'Kết bạn')], true)
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
      const d = k => (after[k] || 0) - (before[k] || 0)
      // Mới thật: Zalo trả 216 (0909000216), 122 (0909000122); tìm SĐT thành công của 0909000122 và của chiến dịch nhắn + kết bạn; kết bạn thành công.
      assert.equal(d(`${LOOKUP}|all|${Z216}`), 1)
      assert.equal(d(`${MESSAGE}|all|${Z122}`), 1)
      assert.equal(d(`${LOOKUP}|all|ok`), 2)
      assert.equal(d(`${FRIEND}|all|ok`), 1)
      assert.equal(d(`${FRIEND}|all|${Z215}`), 0, 'dòng kết bạn thay cho bước bỏ qua không được nạp')
    })

    // ---- 5. Lõi thật -------------------------------------------------------------------------------------------------------------
    const realRun = async ({ entry, hooks, reads }) => {
      const log = { sends: [], events: [], db: [], lines: [], traces: [], units: [] }
      const query = async (sql, params) => (await db.query(sql, params)).rows
      const port = makePort({ E, model: {}, rt: 'desktop', seed: 5, chaos: 0, inject: 0, engineChaos: {}, query, rpc: (sql, args) => rpc(sql, args), log,
        hooks: { ...hooks, beforeRead: async (ctx, part) => { reads.push(ctx.target.phone || ctx.target.uid); if (hooks.beforeRead) await hooks.beforeRead(ctx, part) } },
        forceOk: true, entry: { campaignId: entry.campaign, accountId: entry.account, actionId: entry.cfg.actionId, sample: { sampleId: 1 }, universeSize: 3 } })
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
      const type = entry.type
      const afterReport = type.afterReport?.(entry.cfg, port, { targetLabel: type.targetLabel }) ?? null
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock, events: { progress: l => lines.push(l), trace: () => {} } }, {
        runnerId: `desktop:v571:${entry.account}`, runtimeTarget: 'desktop', staffId: entry.staff, accountId: entry.account, campaignId: entry.campaign,
        actionId: entry.cfg.actionId, campaignName: 'Kiểm người nhận', accountName: 'Zalo', campaignNote: null, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(entry.cfg),
        buildSteps: () => type.buildSteps(entry.cfg, port, { account: { id: entry.account, name: 'Zalo' }, mediaStepTimeoutMs: 4000, textStepTimeoutMs: 2500,
          aiRewriteTimeoutMs: 1000, random }),
        ...(type.validate ? { validateCampaign: () => type.validate(entry.cfg, { zaloWeb: false }) } : {}),
        ...(afterReport ? { afterReport } : {}),
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, $3) AS r', [entry.account, info.leaseToken, info.note ?? null]),
        formatTime: iso => new Date(iso).toISOString(), pacing: { fullSeconds: 7 }, stepTimeoutMs: 2500, heartbeatMs: HEARTBEAT_MS,
        retry: { callTimeoutMs: 8000, backoffMs: [5, 10, 20] }, drainTimeoutMs: 2000
      }, new AbortController().signal)
      if (process.env.V571_DUMP === '1') for (const l of lines) console.log(`  [${l.inputDataId ?? '-'}] ${l.text}`)
      return { result, lines, log }
    }
    const pacedAfter = lines => {
      const set = new Set()
      let lastDone = null
      for (const l of lines) {
        if (/^✅ Hoàn thành "/.test(l.text)) lastDone = l.inputDataId
        else if (/^⏳ Nghỉ/.test(l.text) && lastDone !== null) set.add(lastDone)
      }
      return set
    }
    await check('lõi thật, theo SĐT: người nhận đã biết không gọi Zalo; dòng tiến trình giống hệt khi Zalo trả lỗi; không câu nào nhắc việc kiểm', async () => {
      // Data đầu là SĐT bình thường để có nhịp nghỉ sau nó (lõi chỉ nghỉ khi còn data phía sau).
      const PHONES = { fine: '0907000001', known216: P.z216, new216: '0907000216', known122: P.z122, new122: '0907000122' }
      const entry = await makeCampaign({ targets: Object.values(PHONES), extra: MSG_ONLY })
      const reads = []
      const { result, lines, log } = await realRun({ entry, reads, hooks: {
        beforeRead: async ctx => {
          if (ctx.target.phone === PHONES.new216) throw W.renderError(E, { code: '216', message: 'Số điện thoại không tồn tại' }, 'desktop', 'read')
        },
        beforeSend: async (ctx, part) => {
          if (part === 'text' && ctx.target.phone === PHONES.new122) throw W.renderError(E, { code: '122', message: 'Không thể nhận tin nhắn từ bạn.' }, 'desktop', 'send')
        }
      } })
      assert.equal(result.reason, 'no_target', JSON.stringify(result))
      assert.deepEqual(reads.sort(), [PHONES.fine, PHONES.new122, PHONES.new216].sort(), 'chỉ gọi Zalo tìm SĐT cho SĐT chưa biết')
      assert.equal(log.sends.filter(s => s.part === 'text').length, 1, 'chỉ một tin gửi được (SĐT bình thường)')
      const idOf = Object.fromEntries(Object.entries(PHONES).map(([k, phone]) => [k, entry.ids[Object.values(PHONES).indexOf(phone)]]))
      const textsOf = (key, phone) => lines.filter(l => l.inputDataId === idOf[key]).map(l => l.text.split(phone).join('<SĐT>'))
      assert.deepEqual(textsOf('known216', PHONES.known216), textsOf('new216', PHONES.new216), 'Z216 đã biết = Zalo trả 216')
      const known122 = textsOf('known122', PHONES.known122)
      assert.deepEqual(known122, textsOf('new122', PHONES.new122).filter(t => !/Tìm SĐT/.test(t)), 'Z122 đã biết (chỉ nhắn tin) = Zalo trả 122, trừ dòng tìm SĐT')
      assert.ok(known122.some(t => /Z122/.test(t)), JSON.stringify(known122))
      for (const l of lines) assert.equal(/target_check|kiểm|đã biết|🚫/.test(l.text), false, l.text)
      assert.deepEqual([...new Set((await db.query(`SELECT status FROM public.auto_campaign_input_data WHERE campaign_id = $1`, [entry.campaign])).rows.map(r => r.status))], ['hoàn thành'])
      assert.equal(await quota(entry, LOOKUP), 3, 'tìm SĐT tính 3 lượt (3 SĐT chưa biết)')
      assert.equal(await quota(entry, MESSAGE), 2, 'nhắn tin tính 2 lượt (gửi được + Zalo trả 122 thật)')
      const paced = pacedAfter(lines)
      assert.equal(paced.has(idOf.known216) || paced.has(idOf.known122), false, JSON.stringify(lines.map(l => l.text)))
      assert.equal(paced.has(idOf.fine), true, 'vẫn nghỉ sau tin gửi được')
    })
    await check('lõi thật, theo UID (thành viên nhóm): người nhận đã biết Z122 (global id) không nhắn; dòng giống hệt Zalo trả 122; bạn bè vẫn nhắn', async () => {
      const T = { fine: { uid: 'ub-1', name: 'Khách Một' }, known: { uid: 'ub-100', name: 'Khách Hai' }, real122: { uid: 'ub-200', name: 'Khách Ba' },
        friend: { uid: 'ub-101', name: 'Khách Bốn' } }
      const entry = await makeCampaign({ actionId: 'zalo_message_group_member', extra: MEMBER, targets: Object.values(T),
        zaloUsers: { 'ub-100': { globalId: 'G100' }, 'ub-101': { globalId: 'G100', friend: true }, 'ub-200': { globalId: 'G200' } } })
      const reads = []
      const { result, lines, log } = await realRun({ entry, reads, hooks: {
        beforeSend: async (ctx, part) => {
          if (part === 'text' && String(ctx.target.uid) === T.real122.uid) throw W.renderError(E, { code: '122', message: 'Không thể nhận tin nhắn từ bạn.' }, 'desktop', 'send')
        }
      } })
      assert.equal(result.reason, 'no_target', JSON.stringify(result))
      const idOf = Object.fromEntries(Object.entries(T).map(([k, t]) => [k, entry.ids[Object.values(T).indexOf(t)]]))
      const sentTo = log.sends.filter(s => s.part === 'text' && s.ok).map(s => s.inputDataId)
      assert.deepEqual(sentTo.sort(), [idOf.fine, idOf.friend].sort(), 'gửi được cho người bình thường và người đã là bạn bè')
      assert.equal(log.sends.some(s => s.inputDataId === idOf.known), false, 'không gửi cho người nhận đã biết Z122')
      const textsOf = (key, name) => lines.filter(l => l.inputDataId === idOf[key]).map(l => l.text.split(name).join('<TÊN>'))
      assert.deepEqual(textsOf('known', T.known.name), textsOf('real122', T.real122.name), 'Z122 đã biết = Zalo trả 122')
      assert.ok(textsOf('known', T.known.name).some(t => /Z122/.test(t)))
      for (const l of lines) assert.equal(/target_check|kiểm|đã biết|🚫/.test(l.text), false, l.text)
      assert.deepEqual([...new Set((await db.query(`SELECT status FROM public.auto_campaign_input_data WHERE campaign_id = $1`, [entry.campaign])).rows.map(r => r.status))], ['hoàn thành'])
      assert.equal(await quota(entry, MESSAGE), 3, 'nhắn tin tính 3 lượt (2 gửi được + Zalo trả 122 thật)')
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })

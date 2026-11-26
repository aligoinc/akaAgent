// V659 (lỗi mạng / proxy khi mở trang Facebook → NET01 / NET02 "như Zalo", NET02 / NET04 Zalo, câu NET01 chung, vá câu dừng NET02) trên
// PostgreSQL 17 cục bộ, không chạm DB thật:
//   CHAT_REPO=<akaAgentChatApi> node scripts/engine-v2-facebook/v659-smoke.cjs
// Dựng bản sao danh mục engine của production đọc chỉ đọc 26/11/2026 (scripts/fixtures/engine-v2-facebook/engine-catalog-20261126.json:
// cột, chỉ mục, ràng buộc, trigger, dòng của bảng danh mục và thân hàm engine), chạy nguyên văn migration (kiểm trước / sau trong file) rồi
// so toàn bộ quyết định trước / sau: chính sách gộp (mọi mã × thao tác Facebook / Zalo × nơi chạy × pha), phân loại tín hiệu mẫu, câu chờ.
// Chỉ được đổi đúng chỗ anh chốt; bản gỡ trả về như cũ; không apply lại được.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const V659 = require('../build-v659-sql.cjs')
const { makeReplicaBuilder } = require('./catalog-replica.cjs')

const PORT = Number(process.env.ENGINE_FB_V659_PORT || 55659)
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/engine-catalog-20261126.json'), 'utf8'))
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations', `${V659.NAME}.sql`), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations', `${V659.ROLLBACK_NAME}.sql`), 'utf8')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

const buildReplica = makeReplicaBuilder(CATALOG)

const PHASES = ['before_send', 'in_flight', 'after_send']
const ACTIONS = [...V659.FB_ACTIONS.map(a => [a, ['desktop']]), ...V659.ZALO_ACTIONS.map(a => [a, ['desktop', 'fly']])]

/** Mọi quyết định chính sách: mã có trong danh mục × thao tác × nơi chạy × pha (một lần gọi SQL). */
async function policyGrid(db, extraCodes = []) {
  const codes = [...(await db.query(`SELECT error_code FROM public.auto_error WHERE is_active AND NOT is_delete ORDER BY error_code`)).rows.map(r => r.error_code), ...extraCodes]
  const combos = []
  for (const code of codes) for (const [action, rts] of ACTIONS) for (const rt of rts) for (const phase of PHASES) combos.push([code, action, rt, phase])
  const { rows } = await db.query(`SELECT c->>0 AS code, c->>1 AS action, c->>2 AS rt, c->>3 AS phase,
      public.aka_agent_engine_resolve_policy(c->>0, NULL, c->>1, NULL, c->>2, c->>3) AS p
    FROM jsonb_array_elements($1::jsonb) c`, [JSON.stringify(combos)])
  return new Map(rows.map(r => [`${r.code}|${r.action}|${r.rt}|${r.phase}`, r.p]))
}

/** Tín hiệu mẫu (V659.CLASSIFY + giữ nguyên + mẫu khác của production) × pha. */
const EXTRA_SIGNALS = [
  ['facebook', 'fb_post_group', { kind: 'block', code: 'wait:fb_post_button', message: 'waitForSelector timeout: //div' }],
  ['facebook', 'fb_comment', { kind: 'message_like', message: 'bạn đã đạt giới hạn tần suất comment' }],
  ['facebook', 'fb_post_group', { kind: 'exception', message: 'Không dùng được media "a.jpg": local path không tồn tại và không có cloud URL fallback' }],
  ['facebook', 'fb_post_group', { kind: 'block', code: 'identity_switch', errorCode: 'err_fb_identity_switch_failed', message: 'Không tìm thấy nút xem tất cả profile/page' }],
  ['facebook', 'fb_post_group', { kind: 'engine', code: 'block_hang', message: 'Block treo' }],
  ['zalo', 'zalo_message_stranger', { kind: 'message_like', message: 'fetch failed (other side closed)' }],
  ['zalo', 'zalo_message_stranger', { kind: 'message_like', message: 'Request failed with status code 500' }],
  ['zalo', 'zalo_message_group', { kind: 'fly_command', code: 'command_result_unknown', message: 'Không rõ kết quả' }],
  ['zalo', 'zalo_find_phone_user', { kind: 'message_like', message: 'step:lookup: quá 30000 ms' }]
]
const SIGNALS = [...V659.CLASSIFY.map(([platform, action, , signal]) => [platform, action, signal]),
  ...V659.CLASSIFY_UNCHANGED_IN_FLIGHT.map(([platform, action, , signal]) => [platform, action, signal]), ...EXTRA_SIGNALS]
// Khoá theo thứ tự tín hiệu trong SIGNALS (jsonb đổi thứ tự khoá nên không so bằng chuỗi JSON).
const signalKey = (i, phase) => `${i}|${phase}|${SIGNALS[i][0]}|${SIGNALS[i][1]}|${SIGNALS[i][2].message}`
async function classifyGrid(db) {
  const combos = SIGNALS.flatMap(([platform, action, signal], i) => PHASES.map(phase => ({ i, platform, action, phase, signal })))
  const { rows } = await db.query(`SELECT (c->>'i')::int AS i, c->>'phase' AS phase,
      (SELECT s.error_code FROM public.aka_agent_engine_classify_signal(c->>'platform', c->>'action', c->>'phase', c->'signal') s) AS code
    FROM jsonb_array_elements($1::jsonb) c`, [JSON.stringify(combos)])
  return new Map(rows.map(r => [signalKey(r.i, r.phase), r.code]))
}
const indexOf = (platform, action, message, kind) => SIGNALS.findIndex(([p, a, s]) => p === platform && a === action && s.message === message && s.kind === kind)

async function waitNotes(db) {
  const { rows } = await db.query(`SELECT e.error_code, public.aka_agent_engine_wait_note(e.error_code, timestamptz '2026-11-26 10:05:00+07') AS noon,
      public.aka_agent_engine_wait_note(e.error_code, NULL) AS none FROM public.auto_error e ORDER BY e.error_code`)
  return new Map(rows.map(r => [r.error_code, r]))
}

async function tableDump(db) {
  const dump = {}
  for (const table of ['auto_error', 'auto_outcome_policies', 'auto_outcome_signal_rules', 'auto_status', 'auto_system_settings', 'auto_account_actions']) {
    const { rows } = await db.query(`SELECT to_jsonb(t) - 'updated_at' - 'updated_by' - 'revision' AS row FROM public.${table} t ORDER BY id`)
    dump[table] = rows.map(r => r.row)
  }
  return dump
}

const REPORT = `'${V659.REPORT_SIG}'::regprocedure`
const reportDef = async db => (await db.query(`SELECT pg_get_functiondef(${REPORT}) AS d`)).rows[0].d
const strip = (p, keys) => { const o = { ...p }; for (const k of keys) delete o[k]; return o }
const LIKE_ZALO = (locks, log) => ({ target_effect: 'requeue', target_streak_effect: 'increment', streak_threshold: 4, campaign_effect: 'pause',
  lock_minutes: 5, lock_mode: 'fixed_minutes', lock_action_codes: locks, log_template: log, quota_effect: 'no_count', remaining_steps: 'skip',
  run_effect: 'end_unit', pace_mode: 'none', detail_mode: 'suppress' })

async function main() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v659-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    const skipped = await buildReplica(db)
    console.log(`(bản sao: bỏ ${skipped.length} trigger có hàm ngoài danh mục: ${[...new Set(skipped)].join(', ')})`)

    await check('bản sinh trùng file migration / bản gỡ (không sửa tay)', async () => {
      assert.equal(V659.migration, MIGRATION)
      assert.equal(V659.rollback, ROLLBACK)
    })
    await check('bản sao giống production: thân report_v1 tạo lại cho đúng md5 đọc 26/11', async () => {
      assert.equal(md5(await reportDef(db)), V659.REPORT_BEFORE_MD5)
    })

    // Bản sao không có bảng lượt chạy mà thân report_v1 khai %ROWTYPE: tạo lại thân không kiểm bảng (production có đủ bảng).
    await db.query('SET check_function_bodies = off')
    const policiesBefore = await policyGrid(db, [V659.NET04.code])
    const classifyBefore = await classifyGrid(db)
    const notesBefore = await waitNotes(db)
    const tablesBefore = await tableDump(db)

    await check('trước V659: đúng như báo cáo (ERR_CONNECTION_TIMED_OUT ra FB44, proxy Zalo trước lúc gửi ra NET01, lúc gửi ra UNK01)', async () => {
      const at = (platform, action, phase, message, kind = 'block') => classifyBefore.get(signalKey(indexOf(platform, action, message, kind), phase))
      assert.equal(at('facebook', 'fb_post_group', 'before_send', "ERR_CONNECTION_TIMED_OUT (-118) loading 'https://www.facebook.com/groups/1'"), 'err_engine_fb_ui_not_ready')
      assert.equal(at('facebook', 'fb_post_group', 'before_send', "ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://www.facebook.com/groups/1'"), 'err_engine_fb_ui_not_ready')
      assert.equal(at('zalo', 'zalo_find_phone_user', 'before_send', 'net::ERR_TUNNEL_CONNECTION_FAILED', 'message_like'), V659.NET01)
      assert.equal(at('zalo', 'zalo_message_stranger', 'in_flight', 'net::ERR_TUNNEL_CONNECTION_FAILED', 'message_like'), V659.UNK01)
      const net01 = policiesBefore.get(`${V659.NET01}|fb_post_group|desktop|before_send`)
      assert.equal(net01.target_streak_effect, 'ignore'); assert.equal(net01.campaign_effect, 'hold'); assert.equal(net01.lock_minutes ?? null, null)
    })

    await check('sổ migration đã có V659 thì từ chối', async () => {
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('1', '${V659.NAME}')`)
      await assert.rejects(db.query(MIGRATION), /sổ migration đã có migration_v659_/)
      await db.query('ROLLBACK')
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '1'`)
    })

    let applied = false
    await check(`apply V659 (md5 ${md5(MIGRATION).slice(0, 8)}…): kiểm trước / sau trong file đạt`, async () => {
      try { await db.query(MIGRATION); applied = true } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error }
    })
    if (!applied) throw new Error('V659 không apply được trên bản sao, dừng')

    await check('report_v1: chỉ đổi đúng đoạn câu dừng (thêm NET02), md5 sau khớp', async () => {
      const after = await reportDef(db)
      assert.equal(md5(after), V659.REPORT_AFTER_MD5)
      const before = CATALOG.functions.find(f => f.name === 'aka_agent_engine_report_v1').def
      assert.equal(after, before.replace(V659.REPORT_OLD, V659.REPORT_NEW))
    })

    await check('chính sách gộp: chỉ đổi đúng chỗ anh chốt', async () => {
      const after = await policyGrid(db, [V659.NET04.code])
      const changed = []
      for (const [key, before] of policiesBefore) {
        const now = after.get(key)
        const [code, action, , phase] = key.split('|')
        if (JSON.stringify(strip(before, ['policy_ids', 'revisions'])) === JSON.stringify(strip(now, ['policy_ids', 'revisions']))) continue
        const fb = action.startsWith('fb_')
        if (code === V659.NET01 && fb) { assert.deepEqual(strip(now, Object.keys(now).filter(k => !(k in LIKE_ZALO([], ''))) ), LIKE_ZALO(V659.FB_ACTIONS, V659.TEXT.net01), key); continue }
        if (code === V659.NET02 && fb) {
          assert.deepEqual(strip(now, Object.keys(now).filter(k => !(k in LIKE_ZALO([], '')))), LIKE_ZALO(V659.FB_ACTIONS, V659.TEXT.net02), key)
          continue
        }
        if (code === V659.NET02) {
          // Zalo: y NET01 Zalo sau V659 (kể cả dòng chặn của gắn tag / đổi tên gợi nhớ), chỉ khác câu.
          const net01 = after.get(`${V659.NET01}|${action}|${key.split('|')[2]}|${phase}`)
          const drop = ['policy_ids', 'revisions', 'log_template', 'campaign_note_template', 'error_class']
          assert.deepEqual(strip(now, drop), strip(net01, drop), key)
          assert.equal(now.log_template, V659.TEXT.net02, key)
          continue
        }
        if (code === V659.NET01 && !fb) {
          assert.deepEqual(strip(now, ['policy_ids', 'revisions', 'log_template']), strip(before, ['policy_ids', 'revisions', 'log_template']), key)
          assert.equal(before.log_template, V659.TEXT.net01Old, key); assert.equal(now.log_template, V659.TEXT.net01, key)
          continue
        }
        if (code === V659.NET04.code && !fb) {
          const unk = after.get(`${V659.UNK01}|${action}|${key.split('|')[2]}|${phase}`)
          if (action !== 'zalo_find_phone_user') assert.deepEqual(strip(now, ['policy_ids', 'revisions', 'error_class']), strip(unk, ['policy_ids', 'revisions', 'error_class']), key)
          continue
        }
        if (code === V659.NET04.code && fb) continue // mã mới; Facebook không có luật nào ra NET04.
        changed.push(key)
      }
      assert.deepEqual(changed, [])
    })

    await check('NET04 y UNK01 ở mọi thao tác Zalo (trừ tìm SĐT, đi NET02) × nơi chạy × pha; lớp unknown_delivery', async () => {
      const after = await policyGrid(db, [])
      for (const [action, rts] of ACTIONS.filter(([a]) => a.startsWith('zalo_') && a !== 'zalo_find_phone_user')) for (const rt of rts) for (const phase of PHASES) {
        const net04 = after.get(`${V659.NET04.code}|${action}|${rt}|${phase}`)
        const unk = after.get(`${V659.UNK01}|${action}|${rt}|${phase}`)
        assert.deepEqual(strip(net04, ['policy_ids', 'revisions']), strip(unk, ['policy_ids', 'revisions']), `${action} ${rt} ${phase}`)
        assert.equal(net04.error_class, 'unknown_delivery')
      }
    })

    await check('phân loại tín hiệu: chỉ đổi đúng các tín hiệu trong danh sách, đúng mã', async () => {
      const after = await classifyGrid(db)
      // V659.CLASSIFY đứng đầu SIGNALS theo đúng thứ tự.
      const expected = new Map(V659.CLASSIFY.map(([, , phase, , code], i) => [signalKey(i, phase), code]))
      const changes = []
      for (const [key, before] of classifyBefore) {
        const now = after.get(key)
        if (expected.has(key)) { assert.equal(now, expected.get(key), key); continue }
        if (now !== before) changes.push(`${key} : ${before} → ${now}`)
      }
      // Ngoài danh sách chỉ được đổi: cùng câu lỗi mạng / proxy ở pha trước lúc gửi (mọi kiểu tín hiệu), hoặc proxy Zalo lúc đang gửi / sau gửi
      // không đổi; ngoài ra không gì đổi.
      const proxy = /ERR_PROXY|ERR_TUNNEL|Proxy connection/
      const allowed = changes.filter(line => !(/\|before_send\|/.test(line) && /ERR_|Proxy connection/.test(line))
        && !(/\|in_flight\|zalo\|zalo_find_phone_user\|/.test(line) && proxy.test(line) && line.endsWith(`→ ${V659.NET02}`)))
      assert.deepEqual(allowed, [], changes.join('\n'))
    })

    await check('câu chờ: NET01 đổi tên mã cho khớp dòng tiến trình, NET04 mới; mã khác không đổi', async () => {
      const after = await waitNotes(db)
      for (const [code, before] of notesBefore) {
        if (code === V659.NET01) {
          assert.equal(after.get(code).noon, `⏳ ${V659.TEXT.net01Title}, chạy tiếp lúc 10:05 26/11 (NET01)`)
          assert.equal(before.noon, `⏳ ${V659.TEXT.net01TitleOld}, chạy tiếp lúc 10:05 26/11 (NET01)`)
          continue
        }
        assert.deepEqual(after.get(code), before, code)
      }
      assert.equal(after.get(V659.NET04.code).noon, `⏳ ${V659.TEXT.net04}, chạy tiếp lúc 10:05 26/11 (NET04)`)
      assert.equal(after.get(V659.NET02).noon, '⏳ Proxy của tài khoản không kết nối được, chạy tiếp lúc 10:05 26/11 (NET02)')
    })

    await check('không apply lại được', async () => {
      await assert.rejects(db.query(MIGRATION), /đã có mã NET04/)
      await db.query('ROLLBACK')
    })

    await check('bản gỡ trả danh mục, thân report_v1, quyết định về như cũ (dòng mới chỉ tắt)', async () => {
      await db.query(ROLLBACK)
      assert.equal(md5(await reportDef(db)), V659.REPORT_BEFORE_MD5)
      const after = await tableDump(db)
      for (const table of Object.keys(tablesBefore)) {
        const ids = new Set(tablesBefore[table].map(r => r.id))
        const kept = after[table].filter(r => ids.has(r.id))
        assert.deepEqual(kept, tablesBefore[table], table)
        for (const extra of after[table].filter(r => !ids.has(r.id))) assert.equal(extra.is_active, false, `${table} ${extra.id}`)
      }
      const policies = await policyGrid(db, [V659.NET04.code])
      for (const [key, before] of policiesBefore) {
        if (key.startsWith(`${V659.NET04.code}|`)) continue // mã tắt: chính sách gộp theo lớp, không ai phát
        assert.deepEqual(strip(policies.get(key), ['revisions']), strip(before, ['revisions']), key)
      }
      const classify = await classifyGrid(db)
      for (const [key, before] of classifyBefore) assert.equal(classify.get(key), before, key)
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })

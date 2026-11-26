// Bộ kiểm ngẫu nhiên chính sách V669 trên bản sao danh mục production (engine-catalog-*.json, đọc chỉ đọc bằng
// scripts/engine-v2-facebook/export-engine-catalog.cjs): engine v2 (aka_agent_engine_classify_signal / resolve_policy) và bộ chạy cũ (cách chọn
// dòng auto_error của Desktop / App Server: errorPolicyRepository.getZaloErrorPolicyByCode, và của ChatApi: câu SQL getZaloErrorPolicy).
//
//   CHAT_REPO=<akaAgentChatApi> node scripts/zalo-tag-sync/cach-a-policy-fuzz.cjs --seed 1 [--samples 6000] [--signals <signals.json ngoài repo>]
//     [--catalog <engine-catalog.json>]
//   signals.json (tuỳ chọn): tín hiệu engine thật đã gom (action, phase, kind, code, message đã bỏ số dài) đọc chỉ đọc từ auto_engine_outcomes.
//
// Kiểm:
//   P1 V669 chỉ đổi chính sách (120 / 802 × zalo_message_friend) ở mọi nơi chạy / pha; mọi cặp khác (mẫu ngẫu nhiên + quét hết Zalo) giữ nguyên.
//   P2 chính sách mới: hẹn data tới giờ mở khoá người lạ, không tính lượt, không cộng chuỗi, không dừng chiến dịch, chạy tiếp, vẫn khoá người lạ.
//   P3 bộ chạy cũ (Desktop + ChatApi): chỉ (120 / 802 × zalo_message_friend) đổi sang dòng mới (thất bại, không tính lượt / chuỗi).
//   P4 tín hiệu thật (và cùng tín hiệu đó nếu xảy ra trong chiến dịch nhắn tin bạn bè) chỉ đổi kết quả ở 120 / 802 nhắn bạn bè.
//   P5 gỡ V669 trả đúng mọi quyết định cũ; apply lại sau khi gỡ được.
//   P6 danh mục bị làm sai cố ý (mỗi lần một kiểu) thì V669 từ chối, danh mục giữ nguyên từng byte; sai ở dòng không liên quan thì V669 vẫn chạy.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { makeReplicaBuilder } = require('../engine-v2-facebook/catalog-replica.cjs')

const ROOT = path.resolve(__dirname, '../..')
const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const SEED = Number(opt('--seed', 1))
const SAMPLES = Number(opt('--samples', 6000))
const CATALOG = JSON.parse(fs.readFileSync(opt('--catalog', path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/engine-catalog-20261126.json')), 'utf8'))
const SIGNALS = opt('--signals') ? JSON.parse(fs.readFileSync(opt('--signals'), 'utf8')) : []
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/migration_v669_zalo_friend_stranger_restricted.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v669_zalo_friend_stranger_restricted.sql'), 'utf8')
const PORT = Number(process.env.CACH_A_POLICY_PORT || 55670)
const buildReplica = makeReplicaBuilder(CATALOG)

let state = (SEED * 2246822519) >>> 0 || 7
const rnd = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296 }
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const md5 = s => crypto.createHash('md5').update(s).digest('hex')

const FRIEND = 'zalo_message_friend'
const CHANGED = new Set(['err_zalo_120_message_stranger', 'err_zalo_802_message_stranger'])
const NEW_CODE = 'err_zalo_message_friend_stranger_restricted'
const NEW_802 = 'err_zalo_message_friend_stranger_restricted_802'
const NEW_CODES = new Set([NEW_CODE, NEW_802])
const legacyExpected = code => ({ '120': NEW_CODE, '802': NEW_802 })[code] ?? null
const violations = []
const violate = (code, detail) => { violations.push({ code, ...detail }); if (violations.length <= 25) console.log('VI PHẠM', code, JSON.stringify(detail).slice(0, 700)) }

/** Cách chọn của Desktop / App Server (src/main/data/repositories/errorPolicyRepository.ts getZaloErrorPolicyByCode), nguyên văn logic. */
function desktopPick(rows, code, action) {
  const normalizedCode = String(code || '').trim()
  if (!normalizedCode) return null
  const normalizedAction = String(action || '').trim()
  const policies = rows.filter(r => r.is_active === true && r.is_delete === false && Array.isArray(r.zalo_error_codes) && r.zalo_error_codes.includes(normalizedCode))
  const actions = r => Array.isArray(r.zalo_action_codes) ? r.zalo_action_codes : []
  if (normalizedAction) {
    const scoped = policies.find(p => actions(p).includes(normalizedAction))
    if (scoped) return scoped.error_code
  }
  return policies.find(p => actions(p).length === 0)?.error_code ?? null
}

/** Câu SQL của ChatApi (packages/database/src/campaignRuntimeRepository.ts getZaloErrorPolicy), nguyên văn. */
async function chatPick(db, code, action) {
  const r = await db.query(`SELECT error.error_code FROM public.auto_error AS error
    WHERE (error_code = $1 OR $1 = ANY(zalo_error_codes)) AND is_active = true AND COALESCE(is_delete, false) = false
      AND (COALESCE(to_jsonb(error) -> 'zalo_action_codes', '[]'::jsonb) = '[]'::jsonb
        OR ($2::text IS NOT NULL AND COALESCE(to_jsonb(error) -> 'zalo_action_codes', '[]'::jsonb) ? $2::text))
    ORDER BY CASE WHEN $2::text IS NOT NULL AND COALESCE(to_jsonb(error) -> 'zalo_action_codes', '[]'::jsonb) ? $2::text THEN 0 ELSE 1 END,
      CASE WHEN error_code = $1 THEN 0 ELSE 1 END, id LIMIT 1`, [code, action])
  return r.rows[0]?.error_code ?? null
}

async function main() {
  const cluster = startCluster({ port: PORT, label: 'aka-cach-a-policy-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const stats = {}
  try {
    await buildReplica(db)
    await db.query('SET check_function_bodies = off')

    const actions = (await db.query(`SELECT code, flatform_type FROM public.auto_account_actions ORDER BY code`)).rows
    const zaloActions = actions.filter(a => a.flatform_type === 'zalo').map(a => a.code)
    const allActions = actions.map(a => a.code)
    const policyCodes = (await db.query(`SELECT DISTINCT error_code FROM public.auto_outcome_policies WHERE error_code IS NOT NULL
      UNION SELECT DISTINCT error_code FROM public.auto_outcome_signal_rules WHERE error_code IS NOT NULL ORDER BY 1`)).rows.map(r => r.error_code)
    const statuses = (await db.query(`SELECT id FROM public.auto_status ORDER BY id`)).rows.map(r => Number(r.id))
    const RUNTIMES = ['desktop', 'fly']
    const PHASES = ['before_send', 'in_flight', 'after_send']

    // Lưới quyết định: quét hết (mọi mã × thao tác Zalo × nơi chạy × pha, status NULL) + mẫu ngẫu nhiên (thao tác bất kỳ, status bất kỳ).
    const grid = []
    for (const code of policyCodes) for (const action of zaloActions) for (const rt of RUNTIMES) for (const ph of PHASES) grid.push([code, null, action, rt, ph])
    for (let i = 0; i < SAMPLES; i++) {
      grid.push([pick([...policyCodes, null, 'err_khong_co', NEW_CODE, NEW_802]), rnd() < 0.3 ? pick(statuses) : null, pick([...allActions, null, 'khong_co']),
        pick([...RUNTIMES, null]), pick([...PHASES, null])])
    }
    stats.grid = grid.length
    const resolveAll = async () => {
      const r = await db.query(`SELECT (x->>'i')::int AS i, public.aka_agent_engine_resolve_policy(x->>'c', (x->>'s')::bigint, x->>'a', NULL, x->>'r', x->>'p') - 'revisions' AS p
        FROM jsonb_array_elements($1::jsonb) x`, [JSON.stringify(grid.map((g, i) => ({ i, c: g[0], s: g[1], a: g[2], r: g[3], p: g[4] })))])
      return new Map(r.rows.map(x => [x.i, JSON.stringify(x.p)]))
    }

    // Tín hiệu thật: như đã xảy ra, và cùng tín hiệu nếu xảy ra trong chiến dịch nhắn tin bạn bè (Cách A: người lạ trong chiến dịch bạn bè).
    const signals = []
    for (const s of SIGNALS) {
      const signal = { kind: s.k, code: s.c, message: s.m }
      signals.push({ action: s.a, phase: s.p, signal, n: s.n })
      if (s.a === 'zalo_message_stranger') signals.push({ action: FRIEND, phase: s.p, signal, n: s.n, recast: true })
    }
    const replay = async () => {
      if (!signals.length) return new Map()
      const r = await db.query(`SELECT (x->>'i')::int AS i, c.error_code, public.aka_agent_engine_resolve_policy(c.error_code, NULL, x->>'a', NULL, rt.t, x->>'p') - 'revisions' AS p
        FROM jsonb_array_elements($1::jsonb) x
        CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t)
        LEFT JOIN LATERAL public.aka_agent_engine_classify_signal('zalo', x->>'a', x->>'p', x->'s') c ON true
        ORDER BY 1, rt.t`, [JSON.stringify(signals.map((s, i) => ({ i, a: s.action, p: s.phase, s: s.signal })))])
      const m = new Map()
      for (const row of r.rows) m.set(`${row.i}`, [...(m.get(`${row.i}`) || []), JSON.stringify([row.error_code, row.p])])
      return m
    }
    // Cách chọn của bộ chạy cũ: mọi mã Zalo có ở auto_error + mã ngẫu nhiên + chuỗi sai × thao tác Zalo + thao tác rỗng / lạ.
    const errorRows = async () => (await db.query(`SELECT id, error_code, zalo_error_codes, zalo_action_codes, is_active, is_delete,
      detail_status, counts_toward_limit, counts_toward_bad_target FROM public.auto_error ORDER BY id`)).rows
    const zaloCodes = [...new Set((await errorRows()).flatMap(r => r.zalo_error_codes || []))]
    const legacyCodes = [...zaloCodes, '120', '802', ' 120', '120 ', '0120', '-120', '120.0', '', 'abc', ...Array.from({ length: 60 }, () => String(Math.floor(rnd() * 1000) - 100))]
    const legacyActions = [...zaloActions, '', null, 'khong_co']
    const legacyAll = async () => {
      const rows = await errorRows(), out = new Map()
      for (const code of legacyCodes) for (const action of legacyActions) {
        out.set(JSON.stringify([code, action]), JSON.stringify([desktopPick(rows, code, action), await chatPick(db, code, action)]))
      }
      return out
    }
    const dumpTables = async () => {
      const r = await db.query(`SELECT
        (SELECT md5(string_agg((to_jsonb(p) - 'updated_at' - 'revision')::text, '|' ORDER BY id)) FROM public.auto_outcome_policies p) AS policies,
        (SELECT md5(string_agg((to_jsonb(e) - 'updated_at')::text, '|' ORDER BY id)) FROM public.auto_error e) AS errors,
        (SELECT md5(string_agg(to_jsonb(r)::text, '|' ORDER BY id)) FROM public.auto_outcome_signal_rules r) AS rules`)
      return r.rows[0]
    }

    const before = { grid: await resolveAll(), signals: await replay(), legacy: await legacyAll(), tables: await dumpTables() }
    stats.signals = signals.length; stats.legacy = before.legacy.size

    // P6 trước: mẫu danh mục bị làm sai cố ý, mỗi lần một kiểu, chạy trong SAVEPOINT để trả lại nguyên trạng.
    const MUTATIONS = [
      ['row226_threshold', `UPDATE public.auto_outcome_policies SET streak_threshold = 4 WHERE error_code = 'err_zalo_120_message_stranger' AND action_code = '${FRIEND}'`, 'reject'],
      ['row228_campaign', `UPDATE public.auto_outcome_policies SET campaign_effect = 'none' WHERE error_code = 'err_zalo_802_message_stranger' AND action_code = '${FRIEND}'`, 'reject'],
      ['row226_template', `UPDATE public.auto_outcome_policies SET log_template = 'x' WHERE error_code = 'err_zalo_120_message_stranger' AND action_code = '${FRIEND}'`, 'reject'],
      ['row228_source', `UPDATE public.auto_outcome_policies SET source = 'tay' WHERE error_code = 'err_zalo_802_message_stranger' AND action_code = '${FRIEND}'`, 'reject'],
      ['row226_inactive', `UPDATE public.auto_outcome_policies SET is_active = false WHERE error_code = 'err_zalo_120_message_stranger' AND action_code = '${FRIEND}'`, 'reject'],
      ['row228_runtime', `UPDATE public.auto_outcome_policies SET runtime_target = 'fly' WHERE error_code = 'err_zalo_802_message_stranger' AND action_code = '${FRIEND}'`, 'reject'],
      ['legacy_120_friend', `INSERT INTO public.auto_error (error_type, error_code, error_name, zalo_error_codes, zalo_action_codes, is_active, is_delete)
        VALUES ('external zalo', 'err_tay_120_friend', 'tay', ARRAY['120'], ARRAY['${FRIEND}'], true, false)`, 'reject'],
      ['legacy_new_active', `INSERT INTO public.auto_error (error_type, error_code, error_name, is_active, is_delete) VALUES ('external zalo', '${NEW_CODE}', 'tay', true, false)`, 'reject'],
      ['legacy_802_active', `INSERT INTO public.auto_error (error_type, error_code, error_name, is_active, is_delete) VALUES ('external zalo', '${NEW_802}', 'tay', true, false)`, 'reject'],
      ['legacy_802_friend', `INSERT INTO public.auto_error (error_type, error_code, error_name, zalo_error_codes, zalo_action_codes, is_active, is_delete)
        VALUES ('external zalo', 'err_tay_802_friend', 'tay', ARRAY['802'], ARRAY['${FRIEND}'], true, false)`, 'reject'],
      ['row228_missing', `UPDATE public.auto_outcome_policies SET is_delete = true WHERE error_code = 'err_zalo_802_message_stranger' AND action_code = '${FRIEND}'`, 'reject'],
      ['legacy_802_inactive', `INSERT INTO public.auto_error (error_type, error_code, error_name, zalo_error_codes, is_active, is_delete, error_class)
        VALUES ('system', '${NEW_802}', 'cũ', ARRAY['999'], false, true, 'quota')`, 'accept'],
      ['ledger', `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('1', 'migration_v669_zalo_friend_stranger_restricted')`, 'reject'],
      ['legacy_new_inactive', `INSERT INTO public.auto_error (error_type, error_code, error_name, is_active, is_delete) VALUES ('system', '${NEW_CODE}', 'cũ', false, false)`, 'accept'],
      ['unrelated_policy', `UPDATE public.auto_outcome_policies SET streak_threshold = 9 WHERE error_code = 'err_zalo_122_message_stranger' AND action_code IS NULL`, 'accept'],
      ['legacy_120_stranger_extra', `INSERT INTO public.auto_error (error_type, error_code, error_name, zalo_error_codes, zalo_action_codes, is_active, is_delete)
        VALUES ('external zalo', 'err_tay_120_group', 'tay', ARRAY['120'], ARRAY['zalo_message_group'], true, false)`, 'reject_postflight_ok']
    ]
    stats.mutations = 0
    for (const [name, sql, expect] of MUTATIONS) {
      await db.query('BEGIN')
      try {
        await db.query(sql)
        const t0 = await dumpTables()
        const body = MIGRATION.replace(/^BEGIN;\s*$/m, 'SAVEPOINT v669;').replace(/^COMMIT;\s*$/m, 'RELEASE SAVEPOINT v669;')
        let ok = true, err = null
        try { await db.query(body) } catch (e) { ok = false; err = e.message; await db.query('ROLLBACK TO SAVEPOINT v669') }
        const t1 = await dumpTables()
        if (expect === 'reject' && ok) violate('P6', { name, msg: 'V669 lẽ ra phải từ chối' })
        if (expect === 'reject' && !ok && JSON.stringify(t0) !== JSON.stringify(t1)) violate('P6', { name, msg: 'từ chối nhưng danh mục đổi' })
        if (expect === 'accept' && !ok) violate('P6', { name, msg: 'V669 lẽ ra phải chạy', err })
        // Thêm dòng 120 cho thao tác khác (không phải bạn bè): V669 vẫn chạy được nhưng postflight 120 người lạ vẫn phải đúng.
        if (expect === 'reject_postflight_ok' && !ok && !/bộ chạy cũ đã có/.test(err || '')) violate('P6', { name, msg: 'lý do lạ', err })
        stats.mutations++
      } finally { await db.query('ROLLBACK') }
    }
    if (JSON.stringify(await dumpTables()) !== JSON.stringify(before.tables)) violate('P6', { msg: 'danh mục không về nguyên trạng sau thử sai' })

    // Apply V669.
    await db.query(MIGRATION)
    const after = { grid: await resolveAll(), signals: await replay(), legacy: await legacyAll() }

    // P1b: không luật engine nào ra mã mới (mã chỉ dành cho bộ chạy cũ).
    const producing = (await db.query(`SELECT count(*)::int n FROM public.auto_outcome_signal_rules WHERE error_code = ANY($1)`, [[...NEW_CODES]])).rows[0].n
    if (producing) violate('P1b', { producing })
    // P1 + P2
    let changed = 0
    for (const [i, g] of grid.entries()) {
      const [code, status, action, rt, ph] = g
      const a = before.grid.get(i), b = after.grid.get(i)
      const expectChange = CHANGED.has(code) && action === FRIEND && status == null
      if (a !== b) {
        changed++
        // Mã mới chỉ có ở auto_error cho bộ chạy cũ (không luật engine nào ra mã này, kiểm P1b): engine nhận nó theo nhóm account_restricted.
        if (NEW_CODES.has(code)) { if (JSON.parse(b).error_class !== 'account_restricted') violate('P1', { g, after: b }) }
        else if (!CHANGED.has(code) || action !== FRIEND) violate('P1', { g, before: a, after: b })
      }
      if (expectChange) {
        const p = JSON.parse(b)
        const days = code.includes('120') ? 1 : 2
        const ok = p.target_effect === 'requeue_after' && p.quota_effect === 'no_count' && p.target_streak_effect === 'ignore'
          && p.campaign_effect === 'none' && p.run_effect === 'continue' && (p.lock_action_codes || []).includes('zalo_message_stranger')
          && p.lock_mode === 'days_at_time' && Number(p.lock_days) === days && String(p.lock_time).startsWith('09:45')
          && /lúc \{until\}/.test(p.log_template || '') && !/24 giờ|48 giờ/.test(p.log_template || '')
        if (!ok) violate('P2', { g, policy: p })
      }
    }
    stats.gridChanged = changed

    // P3
    let legacyChanged = 0
    for (const [k, a] of before.legacy) {
      const b = after.legacy.get(k)
      const [code, action] = JSON.parse(k)
      const n = String(code).trim()
      if (a !== b) {
        legacyChanged++
        const [desk, chat] = JSON.parse(b)
        const [desk0, chat0] = JSON.parse(a)
        const deskExpected = ['120', '802'].includes(n) && String(action || '').trim() === FRIEND
        const chatExpected = ['120', '802'].includes(code) && action === FRIEND
        if (desk0 !== desk && !(deskExpected && desk === legacyExpected(n))) violate('P3', { k, before: a, after: b, who: 'desktop' })
        if (chat0 !== chat && !(chatExpected && chat === legacyExpected(code))) violate('P3', { k, before: a, after: b, who: 'chatapi' })
      }
      const [desk, chat] = JSON.parse(b)
      if (['120', '802'].includes(n) && String(action || '').trim() === FRIEND && desk !== legacyExpected(n)) violate('P3', { k, desk })
      if (['120', '802'].includes(code) && action === FRIEND && chat !== legacyExpected(code)) violate('P3', { k, chat })
    }
    // Dòng mới của bộ cũ: "thất bại", không tính lượt / chuỗi, không khoá thao tác (bộ cũ gặp khoá thì dừng lượt), mã công khai và nhóm lỗi
    // như dòng nhắn người lạ (42 / 44), không đổi tài khoản / chiến dịch / đăng nhập.
    for (const [code, ref] of [[NEW_CODE, 'err_zalo_120_message_stranger'], [NEW_802, 'err_zalo_802_message_stranger']]) {
      const q = await db.query(`SELECT error_code, disable_action_codes, detail_status, counts_toward_limit, counts_toward_bad_target, public_code, error_class,
        detail_mode, input_effect, update_status_account, update_status_campaign, update_login_status, count_consecutive_errors
        FROM public.auto_error WHERE error_code IN ($1, $2)`, [code, ref])
      const row = q.rows.find(r => r.error_code === code), base = q.rows.find(r => r.error_code === ref)
      const same = k => JSON.stringify(row?.[k]) === JSON.stringify(base?.[k])
      if (!row || row.detail_status !== 'thất bại' || row.counts_toward_limit || row.counts_toward_bad_target || (row.disable_action_codes || []).length
        || row.update_status_account || row.update_status_campaign || row.update_login_status || row.detail_mode || row.input_effect
        || !['public_code', 'error_class'].every(same)) {
        violate('P3', { row, base })
      }
    }
    const statusOk = (await db.query(`SELECT count(*)::int n FROM public.auto_status WHERE name = 'thất bại'`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n
    stats.legacyChanged = legacyChanged

    // P4
    let sigChanged = 0, sigChangedWeight = 0
    for (const [i, s] of signals.entries()) {
      const a = before.signals.get(`${i}`), b = after.signals.get(`${i}`)
      if (JSON.stringify(a) === JSON.stringify(b)) continue
      sigChanged++; sigChangedWeight += s.n
      const codes = b.map(x => JSON.parse(x)[0])
      if (s.action !== FRIEND || !codes.every(c => CHANGED.has(c))) violate('P4', { s, before: a, after: b })
    }
    stats.signalsChanged = sigChanged; stats.signalsChangedOutcomes = sigChangedWeight

    // P5: gỡ rồi apply lại.
    await db.query(ROLLBACK)
    const undone = { grid: await resolveAll(), signals: await replay(), legacy: await legacyAll() }
    for (const [i, a] of before.grid) if (undone.grid.get(i) !== a) { violate('P5', { g: grid[i], before: a, undone: undone.grid.get(i) }); break }
    for (const [k, a] of before.legacy) if (undone.legacy.get(k) !== a) { violate('P5', { k, before: a, undone: undone.legacy.get(k) }); break }
    for (const [k, a] of before.signals) if (JSON.stringify(undone.signals.get(k)) !== JSON.stringify(a)) { violate('P5', { k }); break }
    try {
      await db.query(MIGRATION)
      const again = await resolveAll()
      for (const [i, b] of after.grid) if (again.get(i) !== b) { violate('P5', { msg: 'apply lại khác lần đầu', g: grid[i] }); break }
      const againLegacy = await legacyAll()
      for (const [k, b] of after.legacy) if (againLegacy.get(k) !== b) { violate('P5', { msg: 'apply lại: bộ chạy cũ khác lần đầu', k }); break }
    } catch (e) { violate('P5', { msg: 'apply lại sau khi gỡ không được', err: e.message }) }
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log('Thống kê:', JSON.stringify(stats))
  console.log(`${violations.length} vi phạm${violations.length ? ' (' + [...new Set(violations.map(v => v.code))].join(', ') + ')' : ''}`)
  process.exit(violations.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(2) })

// Phát lại chuỗi khoá thao tác THẬT của engine v2 qua câu ghi khoá trước / sau V671 (chép nguyên văn từ thân report_v1), PostgreSQL cục bộ:
//   node scripts/engine-v2-lock-keep/v671-replay.cjs <seq.json ngoài repo> [--inject N --seed S]
// --inject N: cố ý chèn thêm N lỗi mạng (NET01, khoá mọi thao tác Zalo 5 phút) vào lúc ngẫu nhiên trên tài khoản thật đang có khoá.
// seq.json (đọc chỉ đọc từ production, tài khoản đã đánh số lại): { seq: [[tài khoản, giây, thao tác, mã lỗi, pha, giờ mở khoá (giây)]],
//   pol: [{e, a, p, ld, lf}] (lock_action_codes theo chính sách hiện tại, Desktop / Fly), nl: [[tài khoản, thao tác, mã, giây]] (khoá không thời hạn đang có) }
// Đo cho mỗi bản: số lần khoá đang còn hiệu lực bị rút ngắn; số lượt thật (đã chạy với bản cũ) mà ở bản đó thao tác đang bị khoá lúc chạy
// (= claim sẽ không giao lượt này), theo mã lỗi lượt đó nhận; khoá không thời hạn còn giữ tới cuối. Kết quả DB so với mô hình JS độc lập.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const V671 = require('../build-v671-sql.cjs')

const file = process.argv[2]
const argv = process.argv.slice(3)
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def }
const INJECT = Number(opt('--inject', 0))
let rs = (Number(opt('--seed', 1)) * 2654435761) >>> 0 || 1
const rnd = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296 }
if (!file) { console.error('cần đường dẫn seq.json'); process.exit(2) }
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const PORT = Number(process.env.ENGINE_V671_REPLAY_PORT || 55674)

function lockStatement(def, tail) {
  const end = def.indexOf(tail)
  const start = def.lastIndexOf('INSERT INTO public.auto_account_action_status AS s (account_id, action_code, is_disable', end)
  assert.ok(end > 0 && start > 0 && end - start < 400, 'không thấy câu ghi khoá')
  return def.slice(start, end + tail.length)
}

// Sự kiện ghi khoá theo thứ tự thời gian: khoá không thời hạn đang có (ghi lúc disabled_at) + mọi lần khoá của engine.
const pol = new Map(data.pol.map(p => [`${p.e}|${p.a}|${p.p}`, p]))
const events = []
for (const [acc, action, code, at] of data.nl) events.push({ acc, t: at * 1000, action, code, codes: [action], until: null, seed: true })
let polDiff = 0
for (const [acc, t, action, code, phase, lu] of data.seq) {
  const p = pol.get(`${code}|${action}|${phase}`)
  assert.ok(p, `thiếu chính sách ${code} ${action} ${phase}`)
  if (JSON.stringify(p.ld) !== JSON.stringify(p.lf)) polDiff++
  events.push({ acc, t: Number(t) * 1000, action, code, codes: p.ld || [], until: Number(lu) * 1000 })
}
// Chèn lỗi mạng: tài khoản và lúc lấy theo một lần khoá thật (0–36 giờ sau), chính sách khoá thật của err_network_offline.
const net = data.pol.find(p => p.e === 'err_network_offline' && p.a.startsWith('zalo_'))
const real = events.filter(e => !e.seed && e.until != null && e.action.startsWith('zalo_'))
for (let i = 0; i < INJECT && net && real.length; i++) {
  const base = real[Math.floor(rnd() * real.length)]
  const t = base.t + Math.floor(rnd() * 36 * 3600e3)
  const action = net.ld[Math.floor(rnd() * net.ld.length)]
  events.push({ acc: base.acc, t, action, code: 'err_network_offline', codes: net.ld, until: t + 5 * 60e3, injected: true })
}
events.sort((a, b) => a.t - b.t || (a.seed ? -1 : 1))
assert.equal(polDiff, 0, 'chính sách khoá Desktop / Fly khác nhau')

// Mô hình độc lập.
function model(keepLonger) {
  const st = new Map()
  const out = { shortened: 0, kept: 0, blocked: {}, blockedTotal: 0 }
  for (const e of events) {
    if (!e.seed) {
      const cur = st.get(`${e.acc}|${e.action}`)
      if (cur && cur.dis && (cur.d == null || cur.d > e.t)) { out.blockedTotal++; out.blocked[e.code] = (out.blocked[e.code] || 0) + 1 }
    }
    for (const c of e.codes) {
      const k = `${e.acc}|${c}`; const cur = st.get(k)
      const keep = keepLonger && cur && cur.dis && e.until != null && (cur.d == null || (cur.d > e.t && cur.d > e.until))
      const active = cur && cur.dis && (cur.d == null || cur.d > e.t)
      const longer = active && e.until != null && (cur.d == null || cur.d > e.until)
      if (keep) { out.kept++; continue }
      if (longer) out.shortened++
      st.set(k, { dis: true, d: e.until, code: e.code })
    }
  }
  out.final = st
  return out
}

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v671r-' })
  const db = await connect()
  const result = {}
  try {
    await db.query(`CREATE TABLE public.auto_account_action_status (account_id bigint NOT NULL, action_code text NOT NULL, is_disable boolean NOT NULL DEFAULT false,
        date_enable timestamptz, disabled_error_code text, disabled_reason text, disabled_at timestamptz, count_action_in_day integer DEFAULT 0, count_date date,
        updated_at timestamptz DEFAULT now(), UNIQUE (account_id, action_code));
      CREATE TABLE public.zz_ev (i int, acc bigint, t timestamptz, action text, code text, codes text[], until timestamptz, seed boolean);
      CREATE TABLE public.zz_blocked (i int, code text)`)
    const mk = (name, stmt) => `CREATE FUNCTION public.${name}(r_account_id bigint, v_lc text, v_until timestamptz, v_error_code text, v_log text, v_now timestamptz)
      RETURNS void LANGUAGE plpgsql AS $f$ BEGIN ${stmt.replace(/\br\.account_id\b/g, 'r_account_id')} END $f$`
    await db.query(mk('zz_lock_old', lockStatement(V671.BEFORE_DEF, V671.OLD)))
    await db.query(mk('zz_lock_new', lockStatement(V671.AFTER_DEF, V671.NEW)))
    const iso = ms => (ms == null ? null : new Date(ms).toISOString())
    await db.query(`INSERT INTO public.zz_ev SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(i int, acc bigint, t timestamptz, action text, code text, codes text[], until timestamptz, seed boolean)`,
      [JSON.stringify(events.map((e, i) => ({ i, acc: e.acc, t: iso(e.t), action: e.action, code: e.code, codes: e.codes, until: iso(e.until), seed: !!e.seed })))])
    // Một lượt phát lại: trước mỗi lượt thật đọc khoá của chính thao tác đó (như claim), rồi ghi khoá theo chính sách.
    await db.query(`CREATE FUNCTION public.zz_replay(p_fn text) RETURNS void LANGUAGE plpgsql AS $f$
      DECLARE e record; c text;
      BEGIN
        TRUNCATE public.auto_account_action_status; TRUNCATE public.zz_blocked;
        FOR e IN SELECT * FROM public.zz_ev ORDER BY i LOOP
          IF NOT e.seed AND EXISTS (SELECT 1 FROM public.auto_account_action_status s WHERE s.account_id = e.acc AND s.action_code = e.action
               AND s.is_disable AND (s.date_enable IS NULL OR s.date_enable > e.t)) THEN
            INSERT INTO public.zz_blocked VALUES (e.i, e.code);
          END IF;
          FOREACH c IN ARRAY e.codes LOOP
            EXECUTE format('SELECT public.%I($1, $2, $3, $4, $5, $6)', p_fn) USING e.acc, c, e.until, e.code, e.code, e.t;
          END LOOP;
        END LOOP;
      END $f$`)
    for (const [label, fn, keep] of [['trước V671', 'zz_lock_old', false], ['sau V671', 'zz_lock_new', true]]) {
      await db.query('SELECT public.zz_replay($1)', [fn])
      const m = model(keep)
      const blocked = (await db.query(`SELECT code, count(*)::int n FROM public.zz_blocked GROUP BY code`)).rows
      const dbBlocked = Object.fromEntries(blocked.map(r => [r.code, r.n]))
      assert.deepEqual(dbBlocked, m.blocked, `${label}: lượt bị khoá DB khác mô hình`)
      const fin = (await db.query(`SELECT account_id, action_code, is_disable, extract(epoch FROM date_enable) * 1000 AS d, disabled_error_code FROM public.auto_account_action_status`)).rows
      assert.equal(fin.length, m.final.size, `${label}: số dòng khoá khác mô hình`)
      for (const r of fin) {
        const w = m.final.get(`${r.account_id}|${r.action_code}`)
        assert.ok(w && w.dis === r.is_disable && w.code === r.disabled_error_code && (w.d == null ? r.d == null : Math.round(Number(r.d)) === w.d),
          `${label}: khoá cuối khác mô hình ${JSON.stringify(r)} ${JSON.stringify(w)}`)
      }
      const indefinite = fin.filter(r => r.is_disable && r.d == null).length
      result[label] = { shortened: m.shortened, kept: m.kept, blockedRuns: m.blockedTotal, blockedByCode: m.blocked, indefiniteAtEnd: indefinite }
    }
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  const before = result['trước V671']; const after = result['sau V671']
  console.log(`Sự kiện: ${events.length} (${data.seq.length} lần khoá thật, ${data.nl.length} khoá không thời hạn, ${events.filter(e => e.injected).length} lỗi mạng chèn thêm), tài khoản ${new Set(events.map(e => e.acc)).size}`)
  console.log(JSON.stringify(result, null, 1))
  // Bất biến: sau V671 không rút ngắn khoá nào; bản cũ đã chạy thật nên không lượt thật nào bị khoá ở bản cũ (trừ khoá không thời hạn gieo sẵn).
  const problems = []
  if (after.shortened !== 0) problems.push('sau V671 vẫn rút ngắn khoá')
  // Bản cũ rút ngắn bao nhiêu thì V671 giữ ít nhất bấy nhiêu (sau lần rút ngắn đầu, hai bản đi theo hai trạng thái khác nhau).
  if (after.kept < before.shortened) problems.push(`số khoá giữ (${after.kept}) ít hơn số khoá bản cũ rút ngắn (${before.shortened})`)
  if (before.shortened > 0 && after.blockedRuns <= before.blockedRuns) problems.push('có khoá bị rút ngắn mà V671 không chặn thêm lượt nào')
  if (after.blockedRuns < before.blockedRuns) problems.push('V671 chặn ít lượt hơn bản cũ')
  if (after.indefiniteAtEnd < before.indefiniteAtEnd) problems.push('sau V671 ít khoá không thời hạn hơn')
  console.log(problems.length ? `VẤN ĐỀ: ${problems.join('; ')}` : 'đạt: DB khớp mô hình, sau V671 không rút ngắn khoá nào')
  process.exit(problems.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(2) })

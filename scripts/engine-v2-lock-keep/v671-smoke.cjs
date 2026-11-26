// V671 (khoá thao tác đến sau không ghi đè khoá đang còn hiệu lực và dài hơn) trên PostgreSQL cục bộ, không chạm DB thật:
//   CHAT_REPO=<akaAgentChatApi> node scripts/engine-v2-lock-keep/v671-smoke.cjs [--seed 1] [--cases 20000]
// 1. Migration / bản gỡ chạy nguyên văn trên thân report_v1 production (đọc 26/11, md5 b39e1e9d…): md5 trước / sau đúng, không apply lại,
//    số 671 đã có trong sổ thì từ chối, gỡ trả đúng bản cũ, apply lại sau gỡ được.
// 2. Câu ghi khoá CHÉP NGUYÊN VĂN từ thân hàm trước / sau vá chạy trên bảng thử với hàng chục nghìn ca ngẫu nhiên (khoá cũ không có / tắt /
//    không thời hạn / đã hết / còn hiệu lực, ngắn hơn / bằng / dài hơn, khoá mới không thời hạn, giờ lệch vài mili giây), so với mô hình
//    độc lập: bản sau vá giữ khoá cũ đúng khi khoá cũ còn hiệu lực và dài hơn, còn lại y bản trước vá; bản trước vá luôn ghi đè.
// 3. Bộ kiểm engine đầu-cuối (bộ chạy Desktop thật, khoá thật do report_v1 ghi) là bất biến A8 của scripts/zalo-tag-sync/cach-a-engine-fuzz.cjs.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const V671 = require('../build-v671-sql.cjs')

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const SEED = Number(opt('--seed', 1))
const CASES = Number(opt('--cases', 20000))
const PORT = Number(process.env.ENGINE_V671_PORT || 55673)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let state = (SEED * 2654435761) >>> 0 || 1
const rnd = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]

let passed = 0
let failed = 0
// Migration có BEGIN ... COMMIT: bị từ chối giữa chừng thì phiên còn giao dịch hỏng, phải ROLLBACK.
async function rejectsTx(db, sql, re) {
  await assert.rejects(db.query(sql), re)
  await db.query('ROLLBACK')
}
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

/** Câu INSERT ... ON CONFLICT ghi khoá, chép nguyên văn từ thân hàm (đoạn từ INSERT tới hết đoạn vá). */
function lockStatement(def, tail) {
  const end = def.indexOf(tail)
  assert.ok(end > 0, 'không thấy đoạn ghi khoá')
  const start = def.lastIndexOf('INSERT INTO public.auto_account_action_status AS s (account_id, action_code, is_disable', end)
  assert.ok(start > 0 && end - start < 400, 'không thấy đầu câu INSERT ghi khoá')
  return def.slice(start, end + tail.length)
}

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v671-' })
  const db = await connect()
  try {
    await db.query(`CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
      SET check_function_bodies = off`)
    const fnMd5 = async () => (await db.query(`SELECT md5(pg_get_functiondef('${V671.SIG}'::regprocedure)) AS m`)).rows[0].m
    await db.query(V671.BEFORE_DEF)

    await check('thân report_v1 dựng lại = production 26/11', async () => assert.equal(await fnMd5(), V671.BEFORE_MD5))
    await check('migration nguyên văn: md5 sau đúng', async () => {
      await db.query(V671.migration)
      assert.equal(await fnMd5(), V671.AFTER_MD5)
      const def = (await db.query(`SELECT pg_get_functiondef('${V671.SIG}'::regprocedure) AS d`)).rows[0].d
      assert.equal(def.split('-- V671:').length, 2)
    })
    await check('chạy lại migration bị từ chối, thân hàm giữ nguyên', async () => {
      await rejectsTx(db, V671.migration, /V671: aka_agent_engine_report_v1 đã đổi/)
      assert.equal(await fnMd5(), V671.AFTER_MD5)
    })
    await check('bản gỡ trả đúng bản V659, gỡ lần hai bị từ chối', async () => {
      await db.query(V671.rollback)
      assert.equal(await fnMd5(), V671.BEFORE_MD5)
      await rejectsTx(db, V671.rollback, /V671: aka_agent_engine_report_v1 đã đổi/)
    })
    await check('số 671 đã có trong sổ thì từ chối', async () => {
      await db.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('1', NULL, 'migration_v671_khac')`)
      await rejectsTx(db, V671.migration, /số 671 đã có/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations`)
      // "migration_v6710_..." không phải V671 (gạch dưới trong LIKE đã thoát).
      await db.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('2', NULL, 'migration_v6710_x')`)
      await db.query(V671.migration)
      assert.equal(await fnMd5(), V671.AFTER_MD5)
      await db.query(V671.rollback)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations`)
    })
    await check('apply lại sau khi gỡ', async () => {
      await db.query(V671.migration)
      assert.equal(await fnMd5(), V671.AFTER_MD5)
    })

    // --- 2. câu ghi khoá nguyên văn so với mô hình ---
    const oldStmt = lockStatement(V671.BEFORE_DEF, V671.OLD)
    const newStmt = lockStatement(V671.AFTER_DEF, V671.NEW)
    await db.query(`CREATE TABLE public.auto_account_action_status (account_id bigint NOT NULL, action_code text NOT NULL, is_disable boolean NOT NULL DEFAULT false,
        date_enable timestamptz, disabled_error_code text, disabled_reason text, disabled_at timestamptz, count_action_in_day integer DEFAULT 0, count_date date,
        updated_at timestamptz DEFAULT now(), UNIQUE (account_id, action_code))`)
    const mkFn = (name, stmt) => `CREATE FUNCTION public.${name}(r_account_id bigint, v_lc text, v_until timestamptz, v_error_code text, v_log text, v_now timestamptz)
      RETURNS void LANGUAGE plpgsql AS $f$ BEGIN ${stmt.replace(/\br\.account_id\b/g, 'r_account_id')} END $f$`
    await db.query('RESET check_function_bodies')
    await db.query(mkFn('zz_lock_old', oldStmt))
    await db.query(mkFn('zz_lock_new', newStmt))

    const NOW = Date.parse('2026-11-26T05:00:00Z')
    const iso = ms => (ms == null ? null : new Date(ms).toISOString())
    const offsets = [-86400e3, -3600e3, -1, 0, 1, 5 * 60e3, 5 * 60e3 + 1, 30 * 60e3, 3600e3, 24 * 3600e3, 2 * 86400e3, 30 * 86400e3]
    const genTime = () => (rnd() < 0.12 ? null : NOW + pick(offsets) + (rnd() < 0.3 ? Math.floor(rnd() * 2000) - 1000 : 0))
    const cases = []
    for (let i = 0; i < CASES; i++) {
      const exists = rnd() < 0.85
      cases.push({
        account: 1 + i, action: pick(['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend', 'fb_comment']),
        old: exists ? { is_disable: rnd() < 0.8, date: genTime(), code: pick(['err_zalo_120_message_stranger', 'err_zalo_224_add_friend_full', 'err_network_offline', null]),
          reason: 'cũ', at: NOW - Math.floor(rnd() * 86400e3) } : null,
        until: genTime(), code: pick(['err_network_offline', 'err_zalo_802_message_stranger', 'err_engine_unknown_delivery']), now: NOW + (rnd() < 0.2 ? Math.floor(rnd() * 3000) : 0)
      })
    }
    const seedRows = async () => {
      await db.query('TRUNCATE public.auto_account_action_status')
      const rows = cases.filter(c => c.old).map(c => ({ account_id: c.account, action_code: c.action, is_disable: c.old.is_disable, date_enable: iso(c.old.date),
        disabled_error_code: c.old.code, disabled_reason: c.old.reason, disabled_at: iso(c.old.at), count_action_in_day: 3 }))
      await db.query(`INSERT INTO public.auto_account_action_status (account_id, action_code, is_disable, date_enable, disabled_error_code, disabled_reason, disabled_at, count_action_in_day)
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(account_id bigint, action_code text, is_disable boolean, date_enable timestamptz, disabled_error_code text,
          disabled_reason text, disabled_at timestamptz, count_action_in_day int)`, [JSON.stringify(rows)])
    }
    const runAll = async fn => {
      await seedRows()
      await db.query(`SELECT public.${fn}(c.account, c.action, c.until, c.code, 'mới ' || c.account, c.now)
        FROM jsonb_to_recordset($1::jsonb) AS c(account bigint, action text, until timestamptz, code text, now timestamptz)`,
      [JSON.stringify(cases.map(c => ({ account: c.account, action: c.action, until: iso(c.until), code: c.code, now: iso(c.now) })))])
      const { rows } = await db.query(`SELECT account_id, is_disable, extract(epoch FROM date_enable) * 1000 AS d, disabled_error_code, disabled_reason,
        extract(epoch FROM disabled_at) * 1000 AS at, count_action_in_day FROM public.auto_account_action_status`)
      return new Map(rows.map(r => [Number(r.account_id), r]))
    }
    // Mô hình độc lập.
    const written = c => ({ is_disable: true, d: c.until, code: c.code, reason: `mới ${c.account}`, at: c.now, count: c.old ? 3 : 0 })
    const keptOld = c => ({ is_disable: c.old.is_disable, d: c.old.date, code: c.old.code, reason: c.old.reason, at: c.old.at, count: 3 })
    const keeps = c => !!c.old && c.old.is_disable && c.until != null && (c.old.date == null || (c.old.date > c.now && c.old.date > c.until))
    const same = (got, want) => got && got.is_disable === want.is_disable && (got.d == null ? null : Math.round(Number(got.d))) === want.d
      && got.disabled_error_code === want.code && got.disabled_reason === want.reason && Math.round(Number(got.at)) === want.at
      && Number(got.count_action_in_day) === want.count

    const stats = { cases: CASES, kept: 0, written: 0, keptNoDeadline: 0, expiredReplaced: 0, equalReplaced: 0, newIndefinite: 0 }
    await check(`câu trước vá luôn ghi đè (${CASES} ca)`, async () => {
      const got = await runAll('zz_lock_old')
      const bad = cases.filter(c => !same(got.get(c.account), written(c)))
      assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 3)))
    })
    await check(`câu sau vá giữ khoá còn hiệu lực dài hơn, còn lại như trước (${CASES} ca)`, async () => {
      const got = await runAll('zz_lock_new')
      const bad = []
      for (const c of cases) {
        const keep = keeps(c)
        if (keep) { stats.kept++; if (c.old.date == null) stats.keptNoDeadline++ } else stats.written++
        if (!keep && c.old?.is_disable && c.old.date != null && c.old.date <= c.now) stats.expiredReplaced++
        if (!keep && c.old?.is_disable && c.old.date != null && c.until != null && c.old.date === c.until && c.old.date > c.now) stats.equalReplaced++
        if (c.until == null && c.old?.is_disable) stats.newIndefinite++
        if (!same(got.get(c.account), keep ? keptOld(c) : written(c))) bad.push(c)
      }
      assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 3)))
      for (const k of ['kept', 'written', 'keptNoDeadline', 'expiredReplaced', 'equalReplaced', 'newIndefinite']) assert.ok(stats[k] > 0, `thiếu ca ${k}`)
    })
    await check('NET01 5 phút sau 120 tới 09:45 hôm sau: giữ 120; 802 sau 120: thay bằng khoá dài hơn', async () => {
      await db.query('TRUNCATE public.auto_account_action_status')
      const now = '2026-11-26 14:00:00+07'
      await db.query(`SELECT public.zz_lock_new(7, 'zalo_message_stranger', '2026-11-27 09:45:00+07', 'err_zalo_120_message_stranger', 'Z120', $1)`, [now])
      await db.query(`SELECT public.zz_lock_new(7, 'zalo_message_stranger', timestamptz '2026-11-26 14:05:00+07', 'err_network_offline', 'NET01', $1)`, [now])
      let r = (await db.query(`SELECT date_enable, disabled_error_code FROM public.auto_account_action_status WHERE account_id = 7`)).rows[0]
      assert.equal(r.disabled_error_code, 'err_zalo_120_message_stranger')
      assert.equal(r.date_enable.toISOString(), '2026-11-27T02:45:00.000Z')
      await db.query(`SELECT public.zz_lock_new(7, 'zalo_message_stranger', '2026-11-28 09:45:00+07', 'err_zalo_802_message_stranger', 'Z802', $1)`, [now])
      r = (await db.query(`SELECT date_enable, disabled_error_code FROM public.auto_account_action_status WHERE account_id = 7`)).rows[0]
      assert.equal(r.disabled_error_code, 'err_zalo_802_message_stranger')
      assert.equal(r.date_enable.toISOString(), '2026-11-28T02:45:00.000Z')
    })
    // Ghi đồng thời: nhiều phiên (như nhiều lượt report_v1 song song) cùng ghi khoá một tài khoản, thứ tự ngẫu nhiên. Có V671 thì kết quả
    // cuối không phụ thuộc thứ tự: có khoá không thời hạn thì là nó, không thì khoá còn hiệu lực dài nhất; mọi khoá đã hết hạn thì là một
    // trong số đó. Mã lỗi phải đi đúng với giờ mở khoá (cả dòng giữ nguyên hoặc thay cả dòng). Bản trước vá: lần ghi sau cùng thắng.
    await check('ghi đồng thời 8 phiên: kết quả cuối = khoá dài nhất, không phụ thuộc thứ tự', async () => {
      await db.query('TRUNCATE public.auto_account_action_status')
      const now = NOW
      const ACC = 400
      const writes = []
      const want = new Map()
      for (let a = 1; a <= ACC; a++) {
        const n = 2 + Math.floor(rnd() * 5)
        const list = []
        for (let k = 0; k < n; k++) {
          const r = rnd()
          const until = r < 0.1 ? null : r < 0.3 ? now - Math.floor(rnd() * 86400e3) - 1 : now + 1 + Math.floor(rnd() * 3 * 86400e3)
          list.push({ account: 100000 + a, until, code: `c${a}_${k}` })
        }
        if (rnd() < 0.3) {
          // Khoá đang có trước khi ghi (còn hiệu lực / đã hết / không thời hạn).
          const r = rnd(); const d = r < 0.15 ? null : r < 0.5 ? now - 60e3 : now + Math.floor(rnd() * 2 * 86400e3)
          await db.query(`INSERT INTO public.auto_account_action_status (account_id, action_code, is_disable, date_enable, disabled_error_code, disabled_at)
            VALUES ($1, 'zalo_message_stranger', true, $2, $3, $4)`, [100000 + a, iso(d), `seed${a}`, iso(now - 3600e3)])
          list.push({ account: 100000 + a, until: d, code: `seed${a}`, seeded: true })
        }
        want.set(100000 + a, list)
        for (const w of list) if (!w.seeded) writes.push(w)
      }
      for (let i = writes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [writes[i], writes[j]] = [writes[j], writes[i]] }
      const conns = await Promise.all(Array.from({ length: 8 }, () => connect()))
      try {
        await Promise.all(conns.map((c, ci) => (async () => {
          for (let i = ci; i < writes.length; i += conns.length) {
            const w = writes[i]
            await c.query(`SELECT public.zz_lock_new($1, 'zalo_message_stranger', $2, $3, $3, $4)`, [w.account, iso(w.until), w.code, iso(now)])
          }
        })()))
      } finally { await Promise.all(conns.map(c => c.end().catch(() => {}))) }
      const { rows } = await db.query(`SELECT account_id, extract(epoch FROM date_enable) * 1000 AS d, disabled_error_code FROM public.auto_account_action_status WHERE account_id > 100000`)
      assert.equal(rows.length, ACC)
      const bad = []
      for (const r of rows) {
        const list = want.get(Number(r.account_id))
        const got = r.d == null ? null : Math.round(Number(r.d))
        const owner = list.find(w => w.code === r.disabled_error_code)
        if (!owner || owner.until !== got) { bad.push({ r, list, why: 'mã lệch giờ' }); continue }
        const hasNull = list.some(w => w.until == null)
        const live = list.filter(w => w.until != null && w.until > now).map(w => w.until)
        if (hasNull) { if (got !== null) bad.push({ r, list, why: 'mất khoá không thời hạn' }) } else if (live.length) {
          if (got !== Math.max(...live)) bad.push({ r, list, why: 'không phải khoá dài nhất' })
        } else if (!list.some(w => w.until === got)) bad.push({ r, list, why: 'giá trị lạ' })
      }
      assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 2)))
    })
    console.log('Thống kê:', JSON.stringify(stats))
    console.log(`migration md5 ${md5(V671.migration)}, rollback md5 ${md5(V671.rollback)}`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`${passed} PASS, ${failed} FAIL`)
  process.exit(failed ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(2) })

#!/usr/bin/env node
'use strict'
/*
 * Bộ thử ngẫu nhiên vòng chạy Bot sự kiện: EventBotRuntime thật (src/main/services/eventBotRuntime.ts) + lõi gửi thật
 * (packages/campaign-engine/src/eventBot) nói chuyện với V672 thật trên Postgres cục bộ, Zalo giả. Chèn lỗi:
 *   - RPC hỏng trước khi tới DB (mất mạng) và sau khi DB đã ghi (mất câu trả lời);
 *   - Zalo: gửi được có / không mã tin, từ chối 120 / 802 / 221 / 122 / 114, lỗi mở kết nối, đứt giữa chừng, lỗi chuẩn bị phiên;
 *   - mất phiên tài khoản giữa lượt, app dừng / khởi động lại giữa lúc gửi (mất báo cáo còn treo), máy ngủ (canStartWork = false);
 *   - danh sách bạn bè sinh nhật thật / sai khuôn; dữ liệu nhóm, tag, loại trừ thay đổi giữa lúc bot chạy.
 * Bất biến (kiểm ngay trong lúc Zalo giả nhận lệnh gửi và cuối lượt):
 *   R1 mỗi lệnh gửi ứng với đúng một việc đang `sending` của đúng tài khoản + người nhận; R2 không việc nào gửi hai lần;
 *   R3 không gửi cho người đang bị loại trừ / UID nhóm / tài khoản đang tạm dừng; R4 hết lượt không còn việc `sending` sau job dọn;
 *   R5 việc DB ghi `sent` có đúng mã tin Zalo trả; R6 nội dung gửi không rỗng, không còn biến #{FULL_NAME}/#{SEX{…}};
 *   R7 tick không bao giờ ném lỗi; R8 bot không đụng bảng chiến dịch.
 * Cách chạy: PG_MODULE_DIR=… node scripts/event-bot/fuzz/runtime-fuzz.cjs --seed 1 [--steps 400]
 */
const path = require('path')
const { startCluster, rng: mkRng, buildTs } = require('./cluster.cjs')
const F = require('./db-fuzz.cjs')

const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const SEED = Number(arg('--seed', '1'))
const STEPS = Number(arg('--steps', '400'))
const { EventBotRuntime } = buildTs('src/main/services/eventBotRuntime.ts')
const POOLX = require('./cluster.cjs').loadPool()

const violations = []
const stats = {}
const bump = (k, n = 1) => { stats[k] = (stats[k] || 0) + n }
const violate = (kind, detail) => { bump('violation:' + kind); if (violations.length < 100) violations.push({ kind, ...detail }) }

class ZaloApiError extends Error { constructor(m, code) { super(m); this.name = 'ZaloApiError'; this.code = code } }
const netError = (code, syscall = 'connect') => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`${syscall} ${code}`), { code, syscall }) })
const missing = () => Object.assign(new Error('Could not find the function'), { code: 'PGRST202' })

const core = buildTs('packages/campaign-engine/src/eventBot/index.ts')

/** Dựng nội dung từ mẫu thật + mẫu sai khuôn: không ném lỗi, không sót biến tên / xưng hô, không trả rỗng khi mẫu có chữ. */
function renderFuzz(r) {
  const pool = (require('./cluster.cjs').loadPool() || {}).templates || []
  const extra = ['#{FULL_NAME}', '#{SEX{a-b-c}} #{FULL_NAME}', '{|}', '{a|}', '|', '||x', '#{SEX{anh-chị-anh/chị}', '#{TODAY(DD/MM/YYYY)}', '{{{}}}', '#{FULL_NAME}#{FULL_NAME}', '\\|', '{a|{b|c}}']
  let n = 0
  for (const t of [...pool, ...extra]) for (let k = 0; k < 5; k++) {
    const name = r.pick([null, '', 'Lan', '  Minh  ', '🎉'])
    const profile = r.pick([null, { displayName: 'Hà', originalName: null, gender: r.pick([0, 1, null]) }, { displayName: null, originalName: 'Tuấn', gender: '1' }])
    let out
    try { out = core.renderEventBotMessage(t, { name, profile }, new Date(), () => r.next()) } catch (e) { violate('render_threw', { t: t.slice(0, 80), message: e.message }); continue }
    n++
    if (/#\{\s*(FULL_NAME|ORIGINAL_NAME)\s*\}|#\{SEX\{[^}]*\}\}/.test(out)) violate('render_left_token', { t: t.slice(0, 120), out: out.slice(0, 120) })
    if (t.replace(/[{}|\s]/g, '').length > 0 && !/#\{/.test(t) && !out.trim()) violate('render_empty', { t: t.slice(0, 120) })
    if (typeof out !== 'string') violate('render_type', {})
  }
  bump('render:cases', n)
}

async function main() {
  renderFuzz(mkRng(SEED))
  const cluster = await startCluster()
  const db = await cluster.fresh()
  const c = await db.connect()
  const r = mkRng(SEED * 7919 + 13)
  const G = F.makeGen(r)
  await c.query(`UPDATE auto_system_settings SET value='true' WHERE key='zalo.tag_sync.enabled'`)
  await c.query(`UPDATE auto_system_settings SET value='5' WHERE key='zalo.tag_sync.stale_minutes'`)
  const W = await F.buildWorld(c, r, G)
  await c.query(`UPDATE auto_system_settings SET value = $1 WHERE key = 'event_bot'`, [JSON.stringify({ audience: 'all', runtimes: { desktop: true, server: true, fly: false } })])
  const ctx = { claimed: [], tsCompare: [], extra: [] }
  for (const a of W.accounts) await F.opSave(c, r, G, W, ctx, a)
  for (let k = 0; k < 2; k++) for (const a of W.accounts) if (a.kind !== 'web') await F.opTagSnapshot(c, r, G, W, ctx, a)
  const fp0 = await F.campaignFingerprint(c)

  // Mỗi nơi chạy một kết nối riêng (như một tiến trình).
  const sends = new Map() // jobId → [{ text, msgId }]
  let clockMs = 0
  const held = new Map(W.accounts.map(a => [a.id, a.kind !== 'web' || r.chance(0.5)]))
  const asleep = new Set()

  /** Lỗi RPC: before = không tới DB, after = DB đã chạy, mất câu trả lời. */
  const faulty = (name, fn, box) => async (...a) => {
    if (box && box.dead) throw netError('ECONNREFUSED', 'connect')
    const roll = r.next()
    if (roll < 0.05) { bump('fault:before:' + name); throw netError('ECONNRESET', 'read') }
    if (roll < 0.0505) { bump('fault:missing:' + name); throw missing() }
    const out = await fn(...a)
    if (roll < 0.1) { bump('fault:after:' + name); throw netError('ETIMEDOUT', 'read') }
    return out
  }

  const portFor = (conn, owner) => ({
    async sendText(accountId, uid, text) {
      bump('send:calls')
      const rows = (await conn.query(`SELECT j.*, s.paused_until, s.blocklist_ids FROM auto_event_bot_jobs j JOIN auto_event_bot_settings s ON s.account_id = j.account_id
        WHERE j.account_id = $1 AND j.status = 'sending' AND j.recipient_uid = $2`, [accountId, uid])).rows
      if (rows.length !== 1) violate('R1_send_without_sending_job', { accountId, uid, n: rows.length, owner })
      const job = rows[0]
      if (job) {
        if (sends.has(Number(job.id))) violate('R2_double_send', { jobId: job.id })
        if (job.paused_until && new Date(job.paused_until) > new Date(job.claimed_at)) violate('R3_send_while_paused', { jobId: job.id })
        const ex = (await conn.query('SELECT private.aka_agent_event_bot_excluded($1, $2::bigint[], $3, (SELECT phone FROM auto_account_contacts WHERE id = $4)) x', [accountId, job.blocklist_ids, uid, job.contact_id])).rows[0].x
        if (ex) violate('R3_send_to_excluded', { jobId: job.id })
      }
      if (String(uid).startsWith('g') || !String(uid).trim()) violate('R3_send_to_group', { uid })
      if (!String(text).trim() || /#\{(FULL_NAME|SEX\{|ORIGINAL_NAME)/.test(text)) violate('R6_bad_text', { text: String(text).slice(0, 120) })
      const roll = r.next()
      let outcome
      if (roll < 0.6) outcome = { msgId: 'z' + r.int(1, 1e9) }
      else if (roll < 0.65) outcome = { msgId: null }
      else if (roll < 0.7) outcome = new ZaloApiError('Tài khoản bị hạn chế', r.pick([120, 802]))
      else if (roll < 0.74) outcome = new ZaloApiError('Vượt quá số request cho phép', 221)
      else if (roll < 0.8) outcome = new ZaloApiError('Không thể nhận tin nhắn từ bạn.', r.pick([122, 114, 112]))
      else if (roll < 0.85) outcome = netError('ECONNREFUSED', 'connect')
      else if (roll < 0.9) outcome = netError('ECONNRESET', 'read')
      else if (roll < 0.94) outcome = Object.assign(new Error('Chưa có session Zalo'), { eventBotNotSent: true })
      else outcome = new Error('Request failed with status code 502')
      if (job) sends.set(Number(job.id), { text, outcome: outcome instanceof Error ? { error: outcome.message, code: outcome.code ?? null } : outcome })
      if (owner.box && r.chance(0.04)) { owner.box.dead = true; bump('crash:after_send') }
      if (outcome instanceof Error) throw outcome
      return outcome
    },
    async getProfile() {
      const x = r.next()
      if (x < 0.2) throw new Error('profile failed')
      if (x < 0.3) return null
      return { displayName: r.pick(['', 'Lan', 'Minh 🎉']), originalName: r.pick([null, 'Nguyễn Lan']), gender: r.pick([0, 1, null, '1']) }
    },
    errorHints: e => ({ answered: e instanceof ZaloApiError, notSent: e && e.eventBotNotSent === true }),
    businessNow: async () => new Date()
  })

  const vnDate = async () => (await c.query(`SELECT to_char(timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date, 'YYYY-MM-DD') d`)).rows[0].d
  const friendsFor = async (accountId, count, page) => {
    if (r.chance(0.05)) throw new Error('getAllFriends failed')
    if (r.chance(0.03)) return r.pick([null, {}, 'x'])
    const people = W.contacts.get(accountId) || []
    const d = await vnDate()
    const ddmm = `${d.slice(8, 10)}/${d.slice(5, 7)}`
    const rows = people.slice((page - 1) * count, page * count).map(p => ({
      userId: p.uid, displayName: r.pick(['Bạn ' + p.id, '', null]), zaloName: 'Z' + p.id,
      sdob: r.chance(0.3) ? r.pick([ddmm, ddmm + '/1990', ddmm.slice(0, 5)]) : r.chance(0.5) && POOLX && POOLX.sdob ? r.pick(POOLX.sdob) : r.pick(['01/01/1990', '', null, '31/02', '15/08'])
    }))
    return rows
  }

  function makeRuntime(kind, staff) {
    const box = { dead: false }
    const connP = db.connect()
    let conn = null
    const run = async (sql, params) => { conn = conn || await connP; return kind === 'desktop' ? F.asDesktop(conn, staff, sql, params) : F.call(conn, sql, params) }
    const unwrap = res => { if (res.error) throw res.error; return res.rows[0].r }
    const myAccounts = W.accounts.filter(a => kind === 'desktop' ? a.staff === staff && a.kind !== 'server' : a.kind === 'server').map(a => a.id)
    const deps = {
      source: kind,
      runnerId: `${kind}:${staff ?? 'vps'}:${r.int(1, 1e6)}`,
      active: () => true,
      canStartWork: () => !asleep.has(kind + staff),
      isHeld: id => myAccounts.includes(id) && held.get(id) === true,
      listHeldAccounts: () => myAccounts.filter(id => held.get(id)),
      sync: faulty('sync', async heldIds => unwrap(kind === 'desktop' ? await run('SELECT public.aka_agent_desktop_event_bot_sync_v1() r') : await run(`SELECT public.aka_agent_event_bot_sync_v1('server', $1::bigint[]) r`, [heldIds])), box),
      birthdays: faulty('birthdays', async (accountId, people) => unwrap(kind === 'desktop' ? await run('SELECT public.aka_agent_desktop_event_bot_birthdays_v1($1, $2::jsonb) r', [accountId, JSON.stringify(people)]) : await run(`SELECT public.aka_agent_event_bot_birthdays_v1('server', $1, $2::jsonb) r`, [accountId, JSON.stringify(people)])), box),
      claim: faulty('claim', async (runnerId, ids, limit) => unwrap(kind === 'desktop' ? await run('SELECT public.aka_agent_desktop_event_bot_claim_v1($1, $2::bigint[], $3) r', [runnerId, ids, limit]) : await run(`SELECT public.aka_agent_event_bot_claim_v1('server', $1, $2::bigint[], $3) r`, [runnerId, ids, limit])), box),
      report: faulty('report', async (jobId, token, result) => unwrap(kind === 'desktop' ? await run('SELECT public.aka_agent_desktop_event_bot_report_v1($1, $2::uuid, $3::jsonb) r', [jobId, token, JSON.stringify(result)]) : await run(`SELECT public.aka_agent_event_bot_report_v1('server', $1, $2::uuid, $3::jsonb) r`, [jobId, token, JSON.stringify(result)])), box),
      port: null,
      readFriendsPage: friendsFor,
      vietnamDate: vnDate,
      isRpcMissing: e => e && e.code === 'PGRST202',
      now: () => clockMs,
      wallNow: () => Date.now(),
      sleep: async ms => { clockMs += ms },
      setTimer: () => 1,
      clearTimer: () => {},
      random: () => r.next(),
      warn: k => bump('warn:' + k),
      info: () => {}
    }
    const rt = new EventBotRuntime({ ...deps, port: portFor({ query: async (q, p) => { conn = conn || await connP; return conn.query(q, p) } }, { box }) })
    rt.start()
    return { rt, kind, staff, box, close: async () => { conn = conn || await connP; await conn.end() } }
  }

  const desktopStaff = [...new Set(W.accounts.filter(a => a.kind !== 'server').map(a => a.staff))]
  let runners = [makeRuntime('server', null), ...desktopStaff.map(s => makeRuntime('desktop', s))]

  for (let step = 0; step < STEPS; step++) {
    const roll = r.next()
    for (let i = 0; i < runners.length; i++) if (runners[i].box.dead) { const old = runners[i]; old.rt.stop(); await old.close(); runners[i] = makeRuntime(old.kind, old.staff); bump('runner:replaced_dead') }
    try {
      if (roll < 0.45) {
        const x = r.pick(runners)
        await x.rt.tick().catch(e => violate('R7_tick_threw', { message: e.message }))
        bump('tick')
      } else if (roll < 0.6) { await F.opTagSnapshot(c, r, G, W, ctx); bump('ev:tag') } else if (roll < 0.7) { await F.opGroup(c, r, G, W, ctx); bump('ev:group') } else if (roll < 0.76) {
        await c.query(`UPDATE auto_event_bot_jobs SET send_after = send_after - interval '90 seconds', expires_at = expires_at - interval '90 seconds', claimed_at = claimed_at - interval '90 seconds' WHERE status IN ('pending','sending')`)
        clockMs += 90_000; bump('age')
      } else if (roll < 0.79) {
        await c.query('SELECT private.aka_agent_event_bot_maintenance()'); bump('maintenance')
      } else if (roll < 0.83) {
        const a = r.pick(W.accounts); held.set(a.id, !held.get(a.id)); bump('held:toggle')
      } else if (roll < 0.85) {
        // App dừng có chờ việc đang gửi, hoặc chết ngang (mất báo cáo còn treo): dựng tiến trình mới.
        const i = r.int(0, runners.length - 1)
        const old = runners[i]
        if (r.chance(0.5)) { old.rt.stop(); await old.rt.waitForIdle(1000); bump('runner:stop') } else bump('runner:crash')
        await old.close()
        runners[i] = makeRuntime(old.kind, old.staff)
      } else if (roll < 0.87) {
        const k = r.pick(runners); const key = k.kind + k.staff; if (asleep.has(key)) asleep.delete(key); else asleep.add(key); bump('sleep:toggle')
      } else if (roll < 0.9) {
        await F.opSave(c, r, G, W, ctx); bump('save')
      } else if (roll < 0.93) {
        // Thêm người vào danh sách loại trừ ngay lúc bot đang chạy.
        const a = r.pick(W.accounts); const p = r.pick(W.contacts.get(a.id))
        if (/^\d{8,25}$/.test(p.uid)) await F.control(c, a.staff, a.org, 'exclusion_add', { accountId: a.id, items: [{ kind: 'uid', value: p.uid }] })
        bump('exclusion')
      } else if (roll < 0.95) {
        await c.query(`UPDATE auto_event_bot_settings SET birthday_scanned_on = NULL WHERE account_id = $1`, [r.pick(W.accounts).id]); for (const x of runners) x.rt.refreshSoon(); bump('birthday:reset')
      } else {
        for (const x of runners) await x.rt.tick().catch(e => violate('R7_tick_threw', { message: e.message }))
        bump('tick:all')
      }
    } catch (e) { violate('harness_error', { message: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') }) }
  }
  // Kết thúc: thức dậy, giữ lại phiên, chạy tới khi hết báo cáo treo; job dọn đóng việc đang gửi của tiến trình đã chết.
  asleep.clear()
  for (let k = 0; k < 30; k++) for (const x of runners) await x.rt.tick().catch(e => violate('R7_tick_threw', { message: e.message }))
  for (const x of runners) { x.rt.stop(); await x.rt.waitForIdle(2000) }
  await c.query(`UPDATE auto_event_bot_jobs SET claimed_at = claimed_at - interval '6 minutes' WHERE status = 'sending'`)
  await c.query('SELECT private.aka_agent_event_bot_maintenance()')
  const left = Number((await c.query(`SELECT count(*) n FROM auto_event_bot_jobs WHERE status='sending'`)).rows[0].n)
  if (left) violate('R4_sending_left', { n: left })
  // R5: kết quả DB khớp Zalo giả.
  const rows = (await c.query(`SELECT id, status, reason_code, zalo_msg_id, zalo_error_code FROM auto_event_bot_jobs WHERE id = ANY($1::bigint[])`, [[...sends.keys()]])).rows
  for (const j of rows) {
    const s = sends.get(Number(j.id)).outcome
    bump('final:' + j.status + ':' + (j.reason_code || '-'))
    if (s.msgId && j.status === 'sent' && j.zalo_msg_id !== s.msgId) violate('R5_msg_id', { id: j.id, db: j.zalo_msg_id, zalo: s.msgId })
    if (s.msgId && !['sent', 'unknown'].includes(j.status)) violate('R5_sent_lost', { id: j.id, status: j.status, reason: j.reason_code })
    if (s.msgId && j.status === 'unknown' && j.reason_code !== 'runner_lost') violate('R5_sent_as_unknown', { id: j.id })
    if (s.error && j.status === 'sent') violate('R5_error_as_sent', { id: j.id, error: s.error })
    if (s.msgId === null && j.status === 'sent') violate('R5_no_msgid_sent', { id: j.id })
    if (s.code != null && [120, 802].includes(s.code) && j.status === 'failed' && j.reason_code !== 'account_restricted') violate('R5_restricted_reason', { id: j.id, reason: j.reason_code })
  }
  for (const row of (await c.query(`SELECT event_type, status, COALESCE(reason_code,'-') rc, count(*) n FROM auto_event_bot_jobs GROUP BY 1,2,3`)).rows) stats[`jobs:${row.event_type}:${row.status}:${row.rc}`] = Number(row.n)
  // Việc DB ghi sent phải có lệnh gửi (không có "sent" ma).
  const ghosts = (await c.query(`SELECT id FROM auto_event_bot_jobs WHERE status='sent' AND NOT (id = ANY($1::bigint[]))`, [[...sends.keys()]])).rows
  if (ghosts.length) violate('R5_ghost_sent', { ids: ghosts.map(g => g.id).slice(0, 5) })
  if (await F.campaignFingerprint(c) !== fp0) violate('R8_campaign_tables', {})
  for (const x of runners) { stats['metrics:' + x.kind] = (stats['metrics:' + x.kind] || 0) + x.rt.metrics.jobs; await x.close() }
  await c.end(); await cluster.drop(db.name); await cluster.end()
  for (const v of F.violations) violate('db:' + v.kind, v)
  console.log(JSON.stringify({ seed: SEED, steps: STEPS, sends: sends.size, violations: violations.length, kinds: Object.fromEntries(Object.entries(stats).filter(([k]) => k.startsWith('violation:'))) }))
  if (args.includes('--verbose')) console.log(JSON.stringify(Object.fromEntries(Object.entries(stats).sort()), null, 1))
  for (const v of violations.slice(0, 30)) console.log('VIOLATION', JSON.stringify(v).slice(0, 1200))
  process.exit(violations.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })

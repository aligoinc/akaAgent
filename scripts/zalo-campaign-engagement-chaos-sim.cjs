#!/usr/bin/env node
// Giả lập dài cho theo dõi tương tác Zalo (Desktop / App Server): chạy CODE THẬT của
// src/main/services/zaloCampaignEngagement.ts + src/shared/zaloCampaignEngagement.ts trên một đồng hồ giả,
// với nhịp gửi thật của ngày 20/11/2026 (scripts/fixtures/zalo-engagement-sim/cadence-20261120.json)
// và một DB giả làm theo luật của V510 (từ chối khi tắt / lệch revision, đăng ký trùng bỏ qua).
//
//   node scripts/zalo-campaign-engagement-chaos-sim.cjs [--seeds 4] [--only desktop|vps] [--ref <git ref>] [--json]
//
// Hai kịch bản mỗi hạt giống:
//   healthy: không lỗi, không tắt công tắc: đo tỉ lệ lượt gửi được theo dõi và câu trả lời được ghi.
//   chaos:   đọc cấu hình / RPC chậm, lỗi, treo hẳn (bỏ qua tín hiệu huỷ); mất mạng từng đợt; tắt rồi bật công tắc;
//            giờ máy nhảy. Kiểm các bất biến bên dưới.
// --ref chạy cùng các kịch bản trên bản cũ (git show) để so; khi đó chỉ in số, không khẳng định.
'use strict'
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const { execFileSync } = require('node:child_process')
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf('--' + name); return i < 0 ? fallback : argv[i + 1] }
const SEEDS = Number(arg('seeds', 4)), FROM = Number(arg('from', 1)), REF = arg('ref', ''), ONLY = arg('only', ''), KIND = arg('kind', ''), JSON_OUT = argv.includes('--json')
const RealDate = Date
const DAY0 = RealDate.parse('2026-11-19T17:00:00Z'), H = 3_600_000, MIN = 60_000
const source = file => REF ? execFileSync('git', ['show', `${REF}:${file}`], { encoding: 'utf8' }) : fs.readFileSync(file, 'utf8')
const compile = (file, extra = '') => new vm.Script(ts.transpileModule(source(file) + extra,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { filename: file })
const SHARED = compile('src/shared/zaloCampaignEngagement.ts')
// Đếm số lần luồng ghi bắt đầu một lượt: bận liền nhiều lượt nối tiếp là bình thường lúc tải cao, một lượt chạy mãi mới là kẹt.
function countFlushStarts(code) {
  const at = code.indexOf('async function flush(): Promise<void> {'), w = code.indexOf('writing=true', at)
  if (at < 0 || w < 0) throw new Error('không tìm thấy flush() để gắn bộ đếm')
  return code.slice(0, w) + 'writing=true;testFlushStarts++;' + code.slice(w + 'writing=true'.length)
    + '\nlet testFlushStarts=0;export const testWriting=()=>writing;export const testFlushes=()=>testFlushStarts;'
}
const SERVICE = new vm.Script(ts.transpileModule(countFlushStarts(source('src/main/services/zaloCampaignEngagement.ts')),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { filename: 'zaloCampaignEngagement.ts' })
const cadence = JSON.parse(fs.readFileSync('scripts/fixtures/zalo-engagement-sim/cadence-20261120.json', 'utf8')).owners
  .map(o => { let t = 0; return { kind: o.kind, times: o.d.split(',').map(v => (t += Number(v)) * 1000) } })

function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
class Heap {
  constructor() { this.a = []; this.seq = 0 }
  push(at, fn) { const n = { at, seq: this.seq++, fn, dead: false, unref() { return this }, ref() { return this } }; const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.lt(a[p], a[i])) break; [a[p], a[i]] = [a[i], a[p]]; i = p } return n }
  lt(x, y) { return x.at < y.at || (x.at === y.at && x.seq < y.seq) }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.lt(a[l], a[m])) m = l; if (r < a.length && this.lt(a[r], a[m])) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m } } return top }
  get size() { return this.a.length }
}
function memFs() {
  const files = new Map(), err = code => Object.assign(new Error(code), { code })
  return {
    mkdir: async () => undefined,
    readFile: async file => { if (!files.has(file)) throw err('ENOENT'); return files.get(file) },
    writeFile: async (file, contents) => { files.set(file, String(contents)) },
    rename: async (from, to) => { if (!files.has(from)) throw err('ENOENT'); files.set(to, files.get(from)); files.delete(from) },
    stat: async file => { if (!files.has(file)) throw err('ENOENT'); return { size: Buffer.byteLength(files.get(file)) } },
    readdir: async directory => [...files.keys()].filter(f => path.dirname(f) === directory).map(f => path.basename(f))
  }
}

async function scenario(kind, seed, mode) {
  const rand = rng(seed * 7919 + (kind === 'chaos' ? 1 : 0) + (mode === 'vps' ? 104729 : 0))
  const between = (a, b) => a + rand() * (b - a)
  const heap = new Heap(), env = { now: 0 }
  const setT = (fn, ms) => heap.push(env.now + Math.max(0, Number(ms) || 0), fn)
  const clearT = timer => { if (timer) timer.dead = true }
  const chaos = kind === 'chaos', DAY = 24 * H, END = DAY + 8 * H
  // ---- Lịch lỗi (chỉ trong 24 giờ có gửi; 8 giờ cuối để hàng đợi xả) ----
  const outages = chaos ? Array.from({ length: 4 }, () => { const from = between(1 * H, 22 * H); return { from, to: from + between(1, 8) * MIN } }) : []
  const periods = [{ from: 0, enabled: true, revision: new RealDate(DAY0 - H).toISOString() }]
  if (chaos) for (const off of [between(3 * H, 9 * H), between(13 * H, 20 * H)].sort((a, b) => a - b)) {
    periods.push({ from: off, enabled: false, revision: new RealDate(DAY0 + off).toISOString() })
    const on = off + between(10, 40) * MIN
    periods.push({ from: on, enabled: true, revision: new RealDate(DAY0 + on).toISOString() })
  }
  const skews = chaos ? [[between(2 * H, 8 * H), 2 * H, between(20, 120) * 1000], [between(10 * H, 16 * H), 6 * H, between(20, 120) * 1000], [between(17 * H, 22 * H), -H, 60_000]]
    .map(([at, by, dur]) => ({ at, to: at + dur, by })) : []
  const skew = () => { for (const s of skews) if (env.now >= s.at && env.now < s.to) return s.by; return 0 }
  const live = () => { let p = periods[0]; for (const q of periods) if (q.from <= env.now) p = q; return p }
  const inOutage = (from, to) => outages.some(o => o.from < to && o.to > from)
  const P = chaos ? { hang: { config: 0.004, rpc: 0.0005, owner: 0.002 }, error: 0.01, slow: 0.005 } : { hang: { config: 0, rpc: 0, owner: 0 }, error: 0, slow: 0 }
  const stats = { sends: 0, success: 0, enabledSuccess: 0, tracked: 0, registered: 0, eligibleReplies: 0, recordedReplies: 0, eligibleSeen: 0, recordedSeen: 0,
    trackedWithDetail: 0, registeredClean: 0, trackedClean: 0, maxBlindS: 0, disabledCaptures: 0, maxDisabledCapturesPerProcess: 0, maxDisabledCaptureSpanS: 0, appliedDisabled: 0, lostStaleRevision: 0, lostOther: 0, lostOtherSamples: [], maxDisabledCaptureS: 0, rejectedStale: 0, dupRegister: 0, preRevisionEvents: 0, hangs: 0, throws: 0, unhandled: 0,
    writerMaxBusyS: 0, writerMaxStallS: 0, endBacklog: 0, logs: {} }
  const onUnhandled = () => { stats.unhandled++ }
  process.on('unhandledRejection', onUnhandled)

  // ---- DB giả theo luật V510 ----
  const db = { details: new Map(), byOp: new Map(), rows: new Map(), seq: 0 }
  function call(type, signal, work, proc) {
    const now = env.now
    let fault = 'ok', latency = between(40, type === 'rpc' ? 800 : 400)
    if (inOutage(now, now + 1)) { fault = rand() < 0.6 ? 'slow' : 'error'; latency = fault === 'slow' ? between(4_000, 30_000) : between(20, 200) }
    else if (rand() < P.hang[type]) fault = 'hang'
    else if (rand() < P.error) { fault = 'error'; latency = between(20, 300) }
    else if (rand() < P.slow) { fault = 'slow'; latency = between(6_000, 25_000) }
    return new Promise(resolve => {
      let done = false, applied
      const finish = value => { if (done) return; done = true; resolve(value) }
      if (fault === 'hang') {
        // Bỏ qua cả tín hiệu huỷ, không bao giờ trả lời (ca VPS 18/11); có khi DB đã làm xong.
        stats.hangs++; if (rand() < 0.5) setT(() => { work() }, latency); return
      }
      if (signal) {
        if (signal.aborted) return finish({ data: null, error: { message: 'AbortError: aborted', code: '' } })
        signal.addEventListener('abort', () => finish({ data: null, error: { message: 'TimeoutError: The operation was aborted due to timeout', code: '' } }), { once: true })
      }
      if (fault === 'error') { setT(() => finish({ data: null, error: { message: 'TypeError: fetch failed', code: '' } }), latency); return }
      // DB làm việc khi request tới (giữa chừng); trả lời tới sau. Bị huỷ giữa chừng thì không rõ đã làm hay chưa.
      setT(() => { applied = work() }, latency / 2)
      setT(() => { if (applied && type === 'config' && proc) proc.lastConfigOkAt = env.now; finish(applied) }, latency)
    })
  }
  const settingsRows = () => { const p = live(); return ['enabled', 'flush_interval_seconds', 'batch_size', 'tracking_window_hours']
    .map((k, i) => ({ key: 'zalo.campaign_engagement.' + k, value: [String(p.enabled), '5', '100', '48'][i], updated_at: p.revision, is_active: true, is_secret: false })) }
  const watchOf = row => ({ campaign_detail_id: row.id, account_id: String(row.accountId), account_zalo_uid: row.source.accountZaloUid, target_zalo_uid: row.source.targetZaloUid,
    action_type: 'message', message_ids: row.source.messageIds, sent_at: row.source.sentAt, tracking_until: new RealDate(Date.parse(row.source.sentAt) + 48 * H).toISOString(),
    seen_at: row.seen_at, responded_at: row.responded_at, reacted_at: null, friended_at: null })
  function rpc(name, args) {
    const p = live()
    if (!p.enabled || args.p_revision !== p.revision) { stats.rejectedStale++; return { data: { enabled: false, updated: 0, items: [] }, error: null } }
    const items = args.p_items || []
    if (name.includes('register')) {
      const watches = []
      for (const item of items) {
        const d = db.details.get(Number(item.detailId))
        if (!d || !d.source || d.source.revision !== args.p_revision) continue
        if (db.rows.has(d.id)) stats.dupRegister++
        else db.rows.set(d.id, { ...d, seen_at: null, responded_at: null })
        watches.push(watchOf(db.rows.get(d.id)))
      }
      return { data: { enabled: true, updated: watches.length, items: watches, pending: [] }, error: null }
    }
    if (name.includes('record')) {
      let updated = 0
      for (const e of items) {
        if (Date.parse(e.occurredAt) < Date.parse(p.revision)) { stats.preRevisionEvents++; continue }
        for (const row of db.rows.values()) {
          if (row.source.accountZaloUid !== e.accountZaloUid || row.source.targetZaloUid !== e.targetZaloUid) continue
          if (e.kind === 'message' && !row.responded_at && Date.parse(e.occurredAt) >= Date.parse(row.source.sentAt)) { row.responded_at = e.occurredAt; updated++ }
          if (e.kind === 'seen' && !row.seen_at && row.source.messageIds.includes(e.messageIds[0])) { row.seen_at = e.occurredAt; updated++ }
        }
      }
      return { data: { enabled: true, updated, items: [] }, error: null }
    }
    // read: phục hồi / danh mục / tra thao tác / tra sự kiện
    if (!items.length) return { data: { enabled: true, items: [], pending: [], recoveryDone: true }, error: null }
    if (items[0].catalog) return { data: { enabled: true, items: [...db.rows.values()].filter(r => r.staff === args.p_staff_id).slice(0, 1000).map(watchOf), catalogDone: true }, error: null }
    if (items[0].operation) return { data: { enabled: true, items: [], operations: items.map(({ operation }) => {
      const d = db.byOp.get(operation.operationId)
      return d ? { operationId: operation.operationId, status: 'found', detailId: String(d.id), source: d.source } : { operationId: operation.operationId, status: 'missing' }
    }) }, error: null }
    const found = [...db.rows.values()].filter(r => items.some(e => e.accountZaloUid === r.source.accountZaloUid && e.targetZaloUid === r.source.targetZaloUid)).slice(0, 1001)
    return { data: { enabled: true, items: found.map(watchOf) }, error: null }
  }

  // ---- Tiến trình (Desktop: một nhân viên; App Server: mọi nhân viên chung một tiến trình) ----
  function makeProcess(id, owners, desktop) {
    const proc = { id, lastConfigOkAt: 0, busySince: null, user: null, blindSince: null, flushSeen: -1, stallSince: null }
    class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [DAY0 + env.now + skew()])) } static now() { return DAY0 + env.now + skew() } }
    const globals = { Date: FakeDate, setTimeout: setT, clearTimeout: clearT, performance: { now: () => env.now },
      AbortSignal: { timeout: ms => { const c = new AbortController(); setT(() => c.abort(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), ms); return c.signal } },
      Buffer, console: { ...console, log() {}, info() {}, warn: (line) => { stats.logs[line] = (stats.logs[line] || 0) + 1 }, error: (line) => { stats.logs['error: ' + line] = (stats.logs['error: ' + line] || 0) + 1 } } }
    const shared = { exports: {} }
    SHARED.runInNewContext({ module: shared, exports: shared.exports, require, ...globals })
    const credentials = { username: 'u', password: 'p' }
    const client = {
      from: table => ({ select: () => table === 'org_staff'
        ? { eq() { return this }, abortSignal: signal => ({ maybeSingle: () => call('owner', signal, () => ({ data: { username: 'u', password: 'p' }, error: null })) }) }
        : { in: () => ({ abortSignal: signal => call('config', signal, () => ({ data: settingsRows(), error: null }), proc) }) } }),
      rpc: (name, args) => ({ abortSignal: signal => call('rpc', signal, () => rpc(name, args)) })
    }
    const mocks = {
      electron: { app: { getPath: () => '/sim/' + id } },
      '../data/currentUser': { getCurrentUser: () => proc.user, getCurrentUserCredentials: () => desktop ? credentials : undefined },
      '../data/supabaseClient': { getSupabaseClient: () => client },
      '../data/repositories/runtimeClockRepository': { peekDatabaseRuntimeClock: () => ({ dbNow: new RealDate(DAY0 + env.now).toISOString() }) },
      '../../shared/zaloCampaignEngagement': shared.exports,
      'node:fs/promises': memFs()
    }
    const module = { exports: {} }
    SERVICE.runInNewContext({ module, exports: module.exports, require: key => Object.hasOwn(mocks, key) ? mocks[key] : require(key), ...globals })
    proc.api = module.exports; proc.shared = shared.exports
    if (desktop) proc.user = { staffId: owners[0].staff, organizationId: owners[0].org }
    else for (const o of owners) { proc.user = { staffId: o.staff, organizationId: o.org }; proc.api.attachServerCampaignEngagementOwner(o.staff, o.org) }
    proc.setUser = o => { if (!desktop) proc.user = { staffId: o.staff, organizationId: o.org } }
    // Đăng nhập / gắn chủ thì app đọc cấu hình một lần (như resumeDesktopCampaignEngagement).
    proc.api.campaignEngagementEnabled()
    const sample = () => {
      if (proc.api.testWriting()) {
        proc.busySince ??= env.now; stats.writerMaxBusyS = Math.max(stats.writerMaxBusyS, (env.now - proc.busySince) / 1000)
        const flushes = proc.api.testFlushes()
        if (flushes !== proc.flushSeen) { proc.flushSeen = flushes; proc.stallSince = env.now }
        stats.writerMaxStallS = Math.max(stats.writerMaxStallS, (env.now - proc.stallSince) / 1000)
      } else { proc.busySince = null; proc.stallSince = null }
      if (env.now < END) setT(sample, 15_000)
    }
    setT(sample, 15_000)
    return proc
  }

  function scheduleSend(proc, o, at, index) {
    setT(() => {
      stats.sends++
      proc.setUser(o)
      const target = `t${o.idx}-${index}`, p = live()
      let ctx
      try { ctx = proc.api.beginCampaignEngagementSend({ id: o.accountId, zaloUid: o.uid }, target) } catch { stats.throws++; ctx = { revision: '', sentAt: '' } }
      const capturedWhileDisabled = !!ctx.operationId && !p.enabled
      if (capturedWhileDisabled) {
        stats.disabledCaptures++
        stats.maxDisabledCaptureS = Math.max(stats.maxDisabledCaptureS, Math.round((env.now - p.from) / 1000))
        // Bộ đệm chỉ đọc lại khi được dùng: sau khi tắt, mỗi tiến trình dùng bản cũ cho đúng một lượt (lượt kích lần đọc lại),
        // thêm vài lượt nếu lần đọc đó lỗi. DB từ chối mọi lần ghi của các lượt này (kiểm ở cuối).
        if (!inOutage(p.from, env.now + 1)) {
          const key = proc.id + '|' + p.revision, seen = disabledCaptures.get(key) || { n: 0, first: env.now }
          seen.n++; disabledCaptures.set(key, seen)
          stats.maxDisabledCapturesPerProcess = Math.max(stats.maxDisabledCapturesPerProcess, seen.n)
          stats.maxDisabledCaptureSpanS = Math.max(stats.maxDisabledCaptureSpanS, Math.round((env.now - seen.first) / 1000))
        }
      }
      // Chuỗi lượt gửi liền không được theo dõi trong lúc DB ổn và công tắc bật: phải ngắn (bản cũ kẹt hàng giờ).
      const healthy = p.enabled && !inOutage(env.now - 5 * MIN, env.now + 1) && env.now - p.from > 5 * MIN
      if (healthy && !ctx.operationId) { proc.blindSince ??= env.now; stats.maxBlindS = Math.max(stats.maxBlindS, Math.round((env.now - proc.blindSince) / 1000)) }
      else if (ctx.operationId) proc.blindSince = null
      const ok = rand() < 0.92
      setT(() => {
        proc.setUser(o)
        try {
          if (!ok) { proc.api.abandonCampaignEngagementSend(ctx.operationId); return }
          const msgId = `m${o.idx}-${index}`
          const src = proc.shared.makeEngagementSource(ctx.accountZaloUid, target, 'message', ctx.sentAt, { msgId }, ctx.revision, ctx.operationId)
          stats.success++
          const rec = { at: env.now, period: live(), msgId, target, src, capturedWhileDisabled, processId: proc.id,
            clean: !inOutage(env.now - MIN, env.now + 10 * MIN) && !periods.some(q => q.from > 0 && q.from >= env.now - MIN && q.from <= env.now + 10 * MIN) }
          if (rec.period.enabled && rec.period === p) { stats.enabledSuccess++; if (src) stats.tracked++ }
          proc.api.stageCampaignEngagementSource(src, o.campaignId)
          setT(() => {
            proc.setUser(o)
            proc.api.stageCampaignEngagementSource(src, o.campaignId, true)
            setT(() => {
              proc.setUser(o)
              const transportFail = rand() < 0.003, inserted = !transportFail || rand() < 0.5
              if (inserted) {
                const detail = { id: ++db.seq, source: src, staff: o.staff, accountId: o.accountId }
                db.details.set(detail.id, detail); if (src?.operationId) db.byOp.set(src.operationId, detail); rec.detailId = detail.id
              }
              if (transportFail) proc.api.failCampaignEngagementDetail(src, Object.assign(new Error('fetch failed'), { code: '' }))
              else proc.api.recordCampaignEngagementDetail(rec.detailId, src)
              scheduleReplies(proc, o, rec)
            }, between(50, 600))
          }, 0)
        } catch { stats.throws++ }
      }, between(800, 4_000))
    }, at)
  }
  const tracked = [], disabledCaptures = new Map()
  function scheduleReplies(proc, o, rec) {
    tracked.push(rec)
    const replyAt = rand() < 0.2 ? env.now + (rand() < 0.3 ? between(3, 30) * 1000 : rand() < 0.6 ? between(0.5, 10) * MIN : between(10, 360) * MIN) : null
    const seenAt = rand() < 0.5 ? env.now + between(5, 3600) * 1000 : null
    if (replyAt) setT(() => {
      proc.setUser(o)
      const p = live(); rec.replyEligible = p === rec.period && p.enabled && env.now < DAY + 6 * H
      if (rec.replyEligible) stats.eligibleReplies++
      try { proc.api.receiveCampaignEngagement('message', { type: 0, isSelf: false, data: { uidFrom: rec.target, idTo: o.uid, ts: DAY0 + env.now } }, o.accountId, o.uid) } catch { stats.throws++ }
    }, replyAt - env.now)
    if (seenAt) setT(() => {
      proc.setUser(o)
      const p = live(); rec.seenEligible = p === rec.period && p.enabled && env.now < DAY + 6 * H
      if (rec.seenEligible) stats.eligibleSeen++
      try { proc.api.receiveCampaignEngagement('seen_messages', [{ type: 0, isSelf: false, threadId: rec.target, data: { idTo: rec.target, msgId: rec.msgId } }], o.accountId, o.uid) } catch { stats.throws++ }
    }, seenAt - env.now)
  }

  // ---- Dựng tiến trình theo nhịp gửi thật ----
  const owners = cadence.filter(c => c.kind === mode).map((c, idx) => ({ ...c, idx, staff: 1000 + idx, org: 5000 + idx, accountId: 9000 + idx, uid: 'own' + idx, campaignId: 7000 + idx }))
  const processes = []
  if (mode === 'desktop') for (const o of owners) { const proc = makeProcess('d' + o.idx, [o], true); processes.push(proc); o.times.forEach((t, i) => scheduleSend(proc, o, t, i)) }
  else { const proc = makeProcess('vps', owners, false); processes.push(proc); for (const o of owners) o.times.forEach((t, i) => scheduleSend(proc, o, t, i)) }

  // ---- Chạy ----
  while (heap.size) {
    const timer = heap.pop()
    if (timer.dead) continue
    if (timer.at > END) break
    env.now = timer.at
    timer.fn()
    await new Promise(resolve => setImmediate(resolve))
  }
  for (const rec of tracked) {
    const row = rec.detailId ? db.rows.get(rec.detailId) : undefined
    if (rec.src && rec.detailId) { stats.trackedWithDetail++; if (rec.clean && !rec.capturedWhileDisabled) stats.trackedClean++ }
    if (rec.src && row) { stats.registered++; if (rec.clean && !rec.capturedWhileDisabled) stats.registeredClean++ }
    else if (rec.src && rec.detailId && rec.clean && !rec.capturedWhileDisabled) {
      // Lượt dùng tạm bản cấu hình cũ có revision của lần bật trước (công tắc đã tắt rồi bật lại): DB chặn đúng luật.
      if (rec.src.revision !== rec.period.revision) stats.lostStaleRevision++
      else { stats.lostOther++; if (stats.lostOtherSamples.length < 5) stats.lostOtherSamples.push({ atMin: Math.round(rec.at / MIN), revision: rec.src.revision, detailId: rec.detailId, process: rec.processId }) }
    }
    if (rec.capturedWhileDisabled && row) stats.appliedDisabled++
    if (rec.replyEligible && row?.responded_at) stats.recordedReplies++
    if (rec.seenEligible && row?.seen_at) stats.recordedSeen++
  }
  for (const proc of processes) stats.endBacklog += Number(proc.api.engagementMetrics?.backlog || 0)
  process.off('unhandledRejection', onUnhandled)
  const pct = (a, b) => b ? +(100 * a / b).toFixed(2) : null
  return { kind, seed, mode, sends: stats.sends, trackedPct: pct(stats.tracked, stats.enabledSuccess), registeredPct: pct(stats.registered, stats.trackedWithDetail), registeredCleanPct: pct(stats.registeredClean, stats.trackedClean - stats.lostStaleRevision),
    replyRecordedPct: pct(stats.recordedReplies, stats.eligibleReplies), seenRecordedPct: pct(stats.recordedSeen, stats.eligibleSeen), ...stats }
}

async function main() {
  const modes = ONLY ? [ONLY] : ['desktop', 'vps']
  const results = []
  for (let seed = FROM; seed < FROM + SEEDS; seed++) for (const mode of modes) for (const kind of (KIND ? [KIND] : ['healthy', 'chaos'])) {
    const started = Date.now()
    const r = await scenario(kind, seed, mode)
    r.ms = Date.now() - started
    results.push(r)
    if (!JSON_OUT) console.log(`${(REF || 'worktree').padEnd(12)} seed=${seed} ${mode.padEnd(7)} ${kind.padEnd(7)} sends=${r.sends} theo dõi=${r.trackedPct}% đăng ký=${r.registeredPct}% `
      + `trả lời ghi=${r.replyRecordedPct}% đã xem ghi=${r.seenRecordedPct}% | một lượt ghi dài nhất=${r.writerMaxStallS}s (bận liền ${r.writerMaxBusyS}s) chuỗi không theo dõi dài nhất=${r.maxBlindS}s `
      + `đăng ký lúc ổn=${r.registeredCleanPct}% (mất do revision cũ ${r.lostStaleRevision}, mất khác ${r.lostOther}) giữ chỗ khi đã tắt=${r.disabledCaptures} (tối đa ${r.maxDisabledCapturesPerProcess}/tiến trình trong ${r.maxDisabledCaptureSpanS}s, ghi được ${r.appliedDisabled}) treo=${r.hangs} lỗi JS=${r.throws + r.unhandled} tồn cuối=${r.endBacklog} (${r.ms} ms)`)
  }
  if (JSON_OUT) console.log(JSON.stringify(results, null, 1))
  if (REF) return
  const fail = []
  for (const r of results) {
    const tag = `seed=${r.seed} ${r.mode} ${r.kind}`
    if (r.throws || r.unhandled) fail.push(`${tag}: lỗi JS ${r.throws}/${r.unhandled}`)
    if (r.writerMaxStallS > 120) fail.push(`${tag}: một lượt ghi chạy liền ${r.writerMaxStallS}s`)
    if (r.maxBlindS > 180) fail.push(`${tag}: ${r.maxBlindS}s liền không theo dõi được lượt gửi nào dù DB ổn`)
    if (r.appliedDisabled) fail.push(`${tag}: ${r.appliedDisabled} lượt giữ chỗ sau khi tắt đã được ghi xuống DB`)
    if (r.maxDisabledCaptureSpanS > 120) fail.push(`${tag}: một tiến trình còn giữ chỗ suốt ${r.maxDisabledCaptureSpanS}s sau lượt đầu tiên kể từ khi tắt, dù DB ổn`)
    if (r.registeredCleanPct !== null && r.registeredCleanPct < 99.9) fail.push(`${tag}: lúc DB ổn chỉ đăng ký ${r.registeredCleanPct}%`)
    if (r.endBacklog) fail.push(`${tag}: hàng đợi còn ${r.endBacklog} mục sau 8 giờ xả`)
    if (r.kind === 'healthy' && (r.trackedPct < 99.9 || r.registeredPct < 99.9 || r.replyRecordedPct < 99.5 || r.seenRecordedPct < 99.5))
      fail.push(`${tag}: lúc khoẻ chỉ theo dõi ${r.trackedPct}% / đăng ký ${r.registeredPct}% / trả lời ${r.replyRecordedPct}% / đã xem ${r.seenRecordedPct}%`)
  }
  if (fail.length) { console.error('FAIL:\n' + fail.join('\n')); process.exitCode = 1 }
  else console.log(`PASS: ${results.length} lượt giả lập (hạt giống ${FROM}–${FROM + SEEDS - 1} × ${modes.join('/')} × healthy/chaos): không lỗi JS, luồng ghi không kẹt, `
    + 'không có chuỗi dài lượt gửi không được theo dõi, sau khi tắt không ghi gì xuống DB (tối đa 3 lượt giữ chỗ mỗi tiến trình), hàng đợi xả hết; lúc khoẻ theo dõi ≥ 99,9%')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

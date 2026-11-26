#!/usr/bin/env node
/*
 * Bot sự kiện: bài kiểm phần chạy của Desktop / App Server (src/main/services/eventBotRuntime.ts) và lõi gửi
 * (packages/campaign-engine/src/eventBot) với RPC giả + Zalo giả. Không chạm DB, mạng, Electron.
 * Cách chạy: node scripts/event-bot/desktop/runtime-smoke.cjs
 */
'use strict'
const path = require('path')
const assert = require('assert/strict')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../../..')
const build = entry => {
  const o = esbuild.buildSync({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const m = { exports: {} }
  new Function('module', 'exports', 'require', o.outputFiles[0].text)(m, m.exports, require)
  return m.exports
}
const { EventBotRuntime, parseEventBotSync } = build('src/main/services/eventBotRuntime.ts')
const core = build('packages/campaign-engine/src/eventBot/index.ts')
const { DesktopRuntimeSnapshot } = build('src/main/services/desktopRuntimeSnapshot.ts')

let passed = 0
const cases = []
const test = (name, fn) => cases.push([name, fn])

class FakeZaloApiError extends Error { constructor(message, code) { super(message); this.name = 'ZaloApiError'; this.code = code } }
const netError = (code, syscall) => { const cause = Object.assign(new Error(`${syscall || 'read'} ${code}`), { code, syscall }); return Object.assign(new TypeError('fetch failed'), { cause }) }

/** Môi trường giả: DB làm đúng hợp đồng mục 5 ở mức cần cho bộ chạy. */
function harness(opts = {}) {
  const calls = { sync: [], claim: [], report: [], birthdays: [], send: [], friends: [], profile: [] }
  const env = {
    now: 0,
    enabled: opts.enabled ?? true,
    accounts: opts.accounts ?? [{ accountId: 11, staffId: 5, birthday: { enabled: false, sendTime: '08:30', scanToday: false } }],
    held: new Set(opts.held ?? [11]),
    queue: opts.jobs ?? [],
    sendImpl: opts.sendImpl ?? (async () => ({ msgId: 'm-1' })),
    friends: opts.friends ?? {},
    missing: false,
    reportFail: 0,
    vnDate: opts.vnDate ?? '2026-11-26'
  }
  const missingError = Object.assign(new Error('Could not find the function'), { code: 'PGRST202' })
  const deps = {
    source: opts.source ?? 'desktop',
    runnerId: 'desktop:test',
    active: () => true,
    isHeld: id => env.held.has(id),
    listHeldAccounts: () => [...env.held],
    now: () => env.now,
    wallNow: () => Date.UTC(2026, 10, 26, 2, 0, 0) + env.now,
    random: () => 0,
    sleep: async ms => { calls.sleeps = (calls.sleeps || 0) + 1; calls.sleptMs = (calls.sleptMs || 0) + ms },
    setTimer: () => 1,
    clearTimer: () => {},
    isRpcMissing: e => e && e.code === 'PGRST202',
    warn: () => {},
    sync: async held => { calls.sync.push(held); if (env.missing) throw missingError; return { ok: true, enabled: env.enabled, pollSeconds: 30, accounts: env.accounts } },
    claim: async (runner, ids, limit) => {
      calls.claim.push({ runner, ids, limit })
      if (env.missing) throw missingError
      const jobs = env.queue.filter(j => ids.includes(j.accountId))
      env.queue = env.queue.filter(j => !ids.includes(j.accountId))
      return { ok: true, jobs, paused: [] }
    },
    report: async (jobId, token, result) => {
      if (env.reportFail > 0) { env.reportFail -= 1; throw new Error('fetch failed') }
      calls.report.push({ jobId, token, result }); return { ok: true, status: result.status }
    },
    birthdays: async (accountId, people) => { calls.birthdays.push({ accountId, people }); return { ok: true, created: people.length, skipped: 0 } },
    readFriendsPage: async (accountId, count, page) => { calls.friends.push({ accountId, page }); return (env.friends[accountId] || [])[page - 1] || [] },
    vietnamDate: async () => env.vnDate,
    port: {
      sendText: async (accountId, uid, text) => { calls.send.push({ accountId, uid, text }); return env.sendImpl(accountId, uid, text) },
      getProfile: async (accountId, uid) => { calls.profile.push(uid); return { displayName: 'Lan Zalo', originalName: 'Lan', gender: 1 } },
      errorHints: e => ({ answered: e instanceof FakeZaloApiError, notSent: e && e.preCall === true }),
      businessNow: async () => new Date('2026-11-26T03:00:00Z')
    }
  }
  const rt = new EventBotRuntime(deps)
  return { rt, env, calls, deps }
}
const job = (id, extra = {}) => ({ jobId: id, claimToken: `t-${id}`, accountId: 11, eventType: 'tag_change', direction: 'added',
  recipientUid: `9000${id}`, recipientName: 'Lan', message: 'Chào #{FULL_NAME}!', ...extra })

test('công tắc tắt: chỉ đọc sync, không claim', async () => {
  const { rt, calls } = harness({ enabled: false, jobs: [job(1)] })
  rt.start(); await rt.tick(); await rt.tick()
  assert.equal(calls.sync.length, 1, 'sync chỉ một lần trong 2 phút')
  assert.equal(calls.claim.length, 0)
  assert.equal(rt.snapshot().state, 'off')
})

test('công tắc tắt: đọc lại sau 30 phút, không phải 2 phút', async () => {
  const { rt, env, calls } = harness({ enabled: false })
  rt.start(); await rt.tick()
  env.now += 3 * 60_000; await rt.tick()
  assert.equal(calls.sync.length, 1)
  env.now += 28 * 60_000; await rt.tick()
  assert.equal(calls.sync.length, 2)
})

test('máy vừa thức sau khi ngủ (bộ giữ đang giữ): không nhận việc', async () => {
  const h = harness({ jobs: [job(20)] })
  let allowed = false
  h.deps.canStartWork = () => allowed
  h.rt.start(); await h.rt.tick()
  assert.equal(h.calls.claim.length, 0)
  allowed = true; await h.rt.tick()
  assert.equal(h.calls.claim.length, 1)
  assert.equal(h.calls.report[0].result.status, 'sent')
})

test('không tài khoản nào bật bot: không claim', async () => {
  const { rt, calls } = harness({ accounts: [], jobs: [job(1)] })
  rt.start(); await rt.tick()
  assert.equal(calls.claim.length, 0)
})

test('App Server không giữ tài khoản nào: không gọi sync', async () => {
  const { rt, calls } = harness({ source: 'server', held: [] })
  rt.start(); await rt.tick()
  assert.equal(calls.sync.length, 0)
  assert.equal(calls.claim.length, 0)
})

test('DB chưa có hàm (PGRST202): im lặng, không gọi thêm', async () => {
  const { rt, env, calls } = harness({ jobs: [job(1)] })
  env.missing = true
  rt.start(); await rt.tick(); env.now += 60_000; await rt.tick()
  assert.equal(calls.sync.length, 1)
  assert.equal(calls.claim.length, 0)
})

test('claim → gửi → report sent (dựng #{FULL_NAME}, chỉ tài khoản đang giữ)', async () => {
  const { rt, env, calls } = harness({ jobs: [job(1)], held: [11],
    accounts: [{ accountId: 11, staffId: 5, birthday: { enabled: false, scanToday: false } }, { accountId: 12, staffId: 5, birthday: { enabled: false } }] })
  rt.start(); await rt.tick()
  assert.deepEqual(calls.claim[0].ids, [11], 'chỉ hỏi tài khoản có phiên')
  assert.equal(calls.send[0].text, 'Chào Lan!')
  assert.deepEqual(calls.report[0], { jobId: 1, token: 't-1', result: { status: 'sent', msgId: 'm-1' } })
  assert.equal(rt.snapshot().state, 'running')
  assert.ok(rt.snapshot().lastClaimAt)
  void env
})

test('lỗi Zalo 120 → failed + zaloCode', async () => {
  const { rt, calls } = harness({ jobs: [job(2)], sendImpl: async () => { throw new FakeZaloApiError('Không thể nhắn người lạ', 120) } })
  rt.start(); await rt.tick()
  assert.equal(calls.report[0].result.status, 'failed')
  assert.equal(calls.report[0].result.zaloCode, '120')
})

test('lỗi mạng trước khi gửi (connect ECONNREFUSED) → failed, không mã Zalo', async () => {
  const { rt, calls } = harness({ jobs: [job(3)], sendImpl: async () => { throw netError('ECONNREFUSED', 'connect') } })
  rt.start(); await rt.tick()
  assert.equal(calls.report[0].result.status, 'failed')
  assert.equal(calls.report[0].result.zaloCode, null)
})

test('lỗi bước chuẩn bị trước khi gọi Zalo (dấu preCall) → failed', async () => {
  const { rt, calls } = harness({ jobs: [job(4)], sendImpl: async () => { throw Object.assign(new Error('Chưa có session Zalo'), { preCall: true }) } })
  rt.start(); await rt.tick()
  assert.equal(calls.report[0].result.status, 'failed')
})

test('Zalo trả thành công không msgId → sent, msgId null', async () => {
  const { rt, calls } = harness({ jobs: [job(5)], sendImpl: async () => ({ msgId: null }) })
  rt.start(); await rt.tick()
  assert.deepEqual(calls.report[0].result, { status: 'sent', msgId: null })
})

test('mất mạng giữa chừng (ECONNRESET) → unknown', async () => {
  const { rt, calls } = harness({ jobs: [job(6)], sendImpl: async () => { throw netError('ECONNRESET', 'read') } })
  rt.start(); await rt.tick()
  assert.equal(calls.report[0].result.status, 'unknown')
})

test('báo kết quả lỗi mạng: báo lại ở nhịp sau, không gửi lại', async () => {
  const { rt, env, calls } = harness({ jobs: [job(7)] })
  env.reportFail = 1
  rt.start(); await rt.tick()
  assert.equal(calls.report.length, 0)
  await rt.tick()
  assert.equal(calls.report.length, 1)
  assert.equal(calls.send.length, 1, 'không gửi lại')
})

test('mẫu có #{SEX{…}} thì đọc hồ sơ; spin {a|b}; nhiều mẫu `|`', async () => {
  const { rt, calls } = harness({ jobs: [job(8, { message: '{Chào|Hi} #{SEX{anh-chị}} #{FULL_NAME}|Mẫu hai' })] })
  rt.start(); await rt.tick()
  assert.deepEqual(calls.profile, ['90008'])
  assert.equal(calls.send[0].text, 'Chào chị Lan')
})

test('một tài khoản một tin tại một lúc (gửi lần lượt)', async () => {
  let active = 0; let maxActive = 0
  const { rt, calls } = harness({ jobs: [job(9), job(10), job(11, { accountId: 11 })], sendImpl: async () => {
    active += 1; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 5)); active -= 1; return { msgId: 'x' } } })
  rt.start(); await Promise.all([rt.tick(), rt.tick()])
  assert.equal(maxActive, 1)
  assert.equal(calls.send.length, 3)
  assert.equal(calls.claim.length, 1, 'nhịp chồng nhau dùng chung một lượt')
})

test('dừng giữa lúc gửi: tin đang gửi báo đúng kết quả, việc sau báo failed, không claim nữa', async () => {
  let release
  const { rt, calls } = harness({ jobs: [job(12), job(13)], sendImpl: () => new Promise(r => { release = () => r({ msgId: 'm-12' }) }) })
  rt.start()
  const tick = rt.tick()
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r))
  assert.equal(calls.send.length, 1)
  rt.stop()
  assert.equal(await rt.waitForIdle(5), false, 'còn tin đang gửi')
  release()
  assert.equal(await rt.waitForIdle(1000), true)
  await tick
  assert.deepEqual(calls.report.map(r => [r.jobId, r.result.status]), [[12, 'sent'], [13, 'failed']])
  assert.equal(calls.send.length, 1, 'việc sau không gửi')
  await rt.tick()
  assert.equal(calls.claim.length, 1)
  assert.equal(rt.snapshot().state, 'stopped')
})

test('tài khoản mất phiên sau lúc nhận việc → failed, không gọi Zalo', async () => {
  const h = harness({ jobs: [job(14)] })
  const claim = h.deps.claim
  h.deps.claim = async (...a) => { const r = await claim(...a); h.env.held.delete(11); return r }
  h.rt.start(); await h.rt.tick()
  assert.equal(h.calls.send.length, 0)
  assert.equal(h.calls.report[0].result.status, 'failed')
})

test('sinh nhật: lọc đúng ngày VN của DB, nhiều trang, một lần trong ngày', async () => {
  const page1 = Array.from({ length: 500 }, (_, i) => ({ userId: `u${i}`, displayName: `Bạn ${i}`, sdob: i === 3 ? '26/11/1990' : i === 4 ? '25/11/1991' : '' }))
  const page2 = [{ userId: 'u900', zaloName: 'Hoa', sdob: '26/11' }, { userId: 'u3', displayName: 'Trùng', sdob: '26/11/1990' }, { userId: 'u901', sdob: '27/11' }]
  const { rt, env, calls } = harness({
    accounts: [{ accountId: 11, staffId: 5, birthday: { enabled: true, sendTime: '08:30', scanToday: true } }],
    friends: { 11: [page1, page2] }
  })
  rt.start(); await rt.tick()
  assert.equal(calls.friends.length, 2)
  assert.equal(calls.sleeps, 1, 'nghỉ giữa hai trang')
  assert.deepEqual(calls.birthdays[0], { accountId: 11, people: [{ uid: 'u3', name: 'Bạn 3' }, { uid: 'u900', name: 'Hoa' }] })
  // DB vẫn báo scanToday (chưa kịp đọc lại): không quét lại trong ngày.
  await rt.tick()
  assert.equal(calls.birthdays.length, 1)
  // Sang ngày mới: quét lại.
  env.vnDate = '2026-11-27'; env.now += 3 * 60_000
  await rt.tick()
  assert.equal(calls.birthdays.length, 2)
  assert.deepEqual(calls.birthdays[1].people.map(p => p.uid), ['u901'])
})

test('sinh nhật không ai: vẫn gọi birthdays rỗng để DB ghi đã quét', async () => {
  const { rt, calls } = harness({ accounts: [{ accountId: 11, staffId: 5, birthday: { enabled: true, scanToday: true } }], friends: { 11: [[{ userId: 'a', sdob: '01/01' }]] } })
  rt.start(); await rt.tick()
  assert.deepEqual(calls.birthdays, [{ accountId: 11, people: [] }])
})

test('sinh nhật lỗi đọc bạn bè: thử lại sau 30 phút', async () => {
  const h = harness({ accounts: [{ accountId: 11, staffId: 5, birthday: { enabled: true, scanToday: true } }] })
  let fail = true
  h.deps.readFriendsPage = async () => { h.calls.friends.push(1); if (fail) throw new Error('zalo down'); return [] }
  h.rt.start(); await h.rt.tick(); await h.rt.tick()
  assert.equal(h.calls.friends.length, 1)
  fail = false; h.env.now += 31 * 60_000
  await h.rt.tick()
  assert.equal(h.calls.birthdays.length, 1)
})

test('lõi: xếp loại lỗi', async () => {
  const cls = core.classifyEventBotSendError
  assert.equal(cls(Object.assign(new Error('Request failed with status code 500'))).status, 'unknown')
  assert.equal(cls(new Error('Request failed with status code 429')).status, 'failed')
  assert.equal(cls(new Error('Gửi tin nhắn Zalo đến người dùng quá thời gian chờ (60 giây)')).status, 'unknown')
  assert.deepEqual(cls(new FakeZaloApiError('x', 221), { answered: true }).zaloCode, '221')
  const slow = await core.sendEventBotJob({ jobId: 1, accountId: 1, recipientUid: '1', recipientName: 'A', message: 'Hi' },
    { sendText: () => new Promise(() => {}) }, { sendTimeoutMs: 20 })
  assert.equal(slow.outcome.status, 'unknown', 'hết hạn chờ là không rõ')
  const empty = await core.sendEventBotJob({ jobId: 1, accountId: 1, recipientUid: '1', recipientName: '', message: '#{FULL_NAME}' }, { sendText: async () => ({ msgId: 'x' }) })
  assert.equal(empty.outcome.status, 'failed', 'nội dung rỗng không gửi')
  const group = await core.sendEventBotJob({ jobId: 1, accountId: 1, recipientUid: 'g123', recipientName: '', message: 'Hi' }, { sendText: async () => ({ msgId: 'x' }) })
  assert.equal(group.outcome.status, 'failed')
  assert.equal(core.eventBotBirthdayKey('2026-03-05'), '05/03')
})

test('parseEventBotSync: sai định dạng = tắt; pollSeconds kẹp 10–600', async () => {
  assert.equal(parseEventBotSync(null).enabled, false)
  assert.equal(parseEventBotSync({ ok: false, enabled: true }).enabled, false)
  assert.equal(parseEventBotSync({ ok: true, enabled: true, pollSeconds: 1, accounts: [{ accountId: '7' }] }).pollSeconds, 10)
  assert.equal(parseEventBotSync({ ok: true, enabled: true, pollSeconds: 30, accounts: [{ accountId: '7' }, { accountId: -1 }] }).accounts.length, 1)
})

test('ảnh chụp Desktop: khoá eventBot đứng sau, phần cũ giữ nguyên byte', async () => {
  const source = () => ({ running: true, accounts: [{ id: 1, flatformType: 'zalo', isActive: true, status: 'chờ xử lý', loginStatus: 'đã đăng nhập' }],
    activeAccountIds: [], runningCampaigns: new Map(), isBrowserTabOpen: () => false })
  const fixed = () => new Date('2026-11-26T00:00:00Z')
  const a = new DesktopRuntimeSnapshot(fixed); a.attach(source)
  const b = new DesktopRuntimeSnapshot(fixed); b.attach(source)
  b.attachEventBot(() => ({ state: 'running', accounts: [1], lastClaimAt: '2026-11-26T00:00:00.000Z' }))
  const before = JSON.stringify(a.build()); const after = JSON.stringify(b.build())
  assert.ok(after.startsWith(before.slice(0, -1) + ',"eventBot":'), after)
  const c = new DesktopRuntimeSnapshot(fixed); c.attach(source); c.attachEventBot(() => { throw new Error('x') })
  assert.equal(JSON.stringify(c.build()), before, 'lỗi nguồn bot: bỏ khoá')
})

;(async () => {
  for (const [name, fn] of cases) {
    try { await fn(); passed += 1; console.log('PASS', name) } catch (error) { console.error('FAIL', name, '\n', error); process.exitCode = 1 }
  }
  console.log(`${passed}/${cases.length} đạt`)
})()

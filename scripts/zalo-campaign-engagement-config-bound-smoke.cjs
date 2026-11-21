#!/usr/bin/env node
// Theo dõi tương tác Zalo: lần đọc cấu hình / RPC không bao giờ xong không được làm kẹt cả tiến trình.
// Dựng lại ca App Server 18/11/2026: cấu hình hết hạn đúng lúc lần đọc mới treo, mục register chờ ghi mãi.
//   node scripts/zalo-campaign-engagement-config-bound-smoke.cjs            (bản trong thư mục này, phải PASS)
//   node scripts/zalo-campaign-engagement-config-bound-smoke.cjs --ref <git ref>   (chạy cùng các ca trên bản cũ để xem lỗi)
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const { execFileSync } = require('node:child_process'), ts = require('typescript')
const refIndex = process.argv.indexOf('--ref'), ref = refIndex > 0 ? process.argv[refIndex + 1] : ''
const source = file => ref ? execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' }) : fs.readFileSync(file, 'utf8')
const warnings = []
const capture = { ...console, warn: (...args) => { warnings.push(args); if (process.env.SHOW_LOGS) console.warn(...args) } }
function load(file, mocks = {}, globals = {}, edit = s => s) {
  const module = { exports: {} }
  const extra = file.includes('services/zaloCampaignEngagement') ? '\nexport const testWriting=()=>writing;' : ''
  vm.runInNewContext(ts.transpileModule(edit(source(file)) + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: key => Object.hasOwn(mocks, key) ? mocks[key] : require(key), console: capture, Buffer, AbortSignal, Date, setTimeout, clearTimeout, ...globals }, { filename: file })
  return module.exports
}
const realSettle = async (ms = 0) => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 3)); if (ms) await new Promise(r => setTimeout(r, ms)) }
const revision = '2026-11-18T00:00:00Z'
const READ_BOUND_MS = 60 // giới hạn thật (ms) của lần đọc cấu hình trong bài kiểm; bản chạy là 30 giây

function cacheTests(shared) {
  const results = {}
  const rows = () => shared.ENGAGEMENT_KEYS.map((key, i) => ({ key, value: ['true', '5', '100', '48'][i], updated_at: revision, is_active: true, is_secret: false }))
  return {
    async neverSettles() {
      let now = 0, reads = 0, events = []
      const cache = new shared.EngagementConfigCache(() => { reads++; return reads === 1 ? new Promise(() => {}) : Promise.resolve(rows()) }, () => now,
        { maxReadMs: READ_BOUND_MS, onReadEvent: e => events.push(e.type) })
      const first = cache.get().then(() => 'resolved', e => 'rejected:' + e.message)
      const outcome = await Promise.race([first, new Promise(r => setTimeout(() => r('still pending'), 400))])
      assert.equal(cache.currentOrRefresh(), undefined)
      now += 61_000
      cache.currentOrRefresh(); await realSettle()
      return { outcome, events, reads, enabled: cache.lastKnown()?.enabled === true }
    },
    async lateSettle() {
      let finish, events = []
      const cache = new shared.EngagementConfigCache(() => new Promise(r => { finish = r }), () => 0, { maxReadMs: READ_BOUND_MS, onReadEvent: e => events.push(e.type + (e.outcome ? ':' + e.outcome : '')) })
      await Promise.race([cache.get().catch(() => undefined), new Promise(r => setTimeout(r, 400))])
      finish(rows()); await realSettle()
      return { events, applied: cache.lastKnown() !== undefined }
    },
    async hostClockJump() {
      // Đồng hồ máy nhảy tới 3 ngày đúng lúc một lần đọc lỗi rồi được chỉnh lại; 61 giây thật sau đó phải đọc lại được.
      let mono = 1_000, reads = 0
      const realNow = Date.now, base = realNow()
      const fakePerformance = { now: () => mono }
      const isolated = load('src/shared/zaloCampaignEngagement.ts', {}, { performance: fakePerformance, Date: class extends Date { static now() { return clock() } } })
      let shift = 0; const clock = () => base + shift + mono
      const cache = new isolated.EngagementConfigCache(async () => { reads++; if (reads === 1) { shift = 3 * 86_400_000; throw new Error('offline') } return rows() })
      await Promise.race([cache.get().catch(() => undefined), new Promise(r => setTimeout(r, 400))])
      shift = 0; mono += 61_000
      const second = await Promise.race([cache.get().then(v => 'read again: enabled=' + v.enabled, e => 'rejected:' + e.message), new Promise(r => setTimeout(() => r('still pending'), 400))])
      return { second, reads }
    }
  }
}

function serviceHarness(directory, sharedModule, edits) {
  let now = Date.parse('2026-11-18T07:32:00Z'), timers = [], settingsRead
  const settings = sharedModule.ENGAGEMENT_KEYS.map((key, i) => ({ key, value: ['true', '5', '100', '48'][i], updated_at: revision, is_active: true, is_secret: false }))
  const calls = []; let rpcHang = false
  const ownerQuery = { eq() { return this }, abortSignal() { return this }, async maybeSingle() { return { data: { username: 'owner', password: 'secret' } } } }
  const client = {
    from: table => ({ select: () => table === 'org_staff' ? ownerQuery : { in: () => ({ abortSignal: async () => settingsRead ? settingsRead() : { data: settings } }) } }),
    rpc: (name, args) => ({ abortSignal: () => {
      calls.push({ name, items: args.p_items })
      if (rpcHang) return new Promise(() => {})
      return Promise.resolve({ data: { enabled: true, items: [], pending: [], updated: 1, recoveryDone: true, catalogDone: true } })
    } })
  }
  class Cache extends sharedModule.EngagementConfigCache { constructor(read, _now, options) { super(read, () => now, { ...(options || {}), maxReadMs: READ_BOUND_MS }) } }
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : [now])) } static now() { return now } }
  const user = { staffId: 1, organizationId: 1 }
  const api = load('src/main/services/zaloCampaignEngagement.ts', {
    electron: { app: { getPath: () => directory } },
    '../data/currentUser': { getCurrentUser: () => user, getCurrentUserCredentials: () => ({ username: 'owner', password: 'secret' }) },
    '../data/supabaseClient': { getSupabaseClient: () => client },
    '../data/repositories/runtimeClockRepository': { peekDatabaseRuntimeClock: () => ({ dbNow: new Date(now).toISOString() }) },
    '../../shared/zaloCampaignEngagement': { ...sharedModule, EngagementConfigCache: Cache }
  }, { Date: Clock, setTimeout: (fn, ms) => { const t = { fn, at: now + ms, unref() {} }; timers.push(t); return t }, clearTimeout: t => { timers = timers.filter(v => v !== t) } }, edits)
  const tick = async ms => { now += ms; const due = timers.filter(t => t.at <= now); timers = timers.filter(t => t.at > now); for (const t of due) t.fn(); await realSettle() }
  return { api, calls, tick, read: fn => { settingsRead = fn }, hangRpc: v => { rpcHang = v }, now: () => now,
    journal: () => { try { return JSON.parse(fs.readFileSync(path.join(directory, 'campaign-engagement', '1-1.json'), 'utf8')) } catch { return [] } } }
}

async function serviceTests(shared, root) {
  const out = {}
  // Ca 18/11: lần đọc cấu hình mới treo ngay sau khi cấu hình cũ hết hạn, đúng lúc có một lượt gửi vừa ghi xong.
  {
    const h = serviceHarness(path.join(root, 'stuck-config'), shared, s => s.replace('RPC_MAX_MS = 45_000', 'RPC_MAX_MS = 45_000'))
    await h.api.attachServerCampaignEngagementOwner(1, 1); await realSettle()
    for (let i = 0; i < 6; i++) await h.tick(5_000)
    h.api.campaignEngagementEnabled?.(); await realSettle()
    const send = h.api.beginCampaignEngagementSend({ id: 1, zaloUid: 'own' }, 'target')
    assert.ok(send.operationId, 'cấu hình còn hạn thì lượt gửi phải được giữ chỗ')
    h.read(() => new Promise(() => {}))
    await h.tick(61_000)
    h.api.recordCampaignEngagementDetail(123, { version: 1, operationId: send.operationId, accountZaloUid: 'own', targetZaloUid: 'target', actionType: 'message', sentAt: send.sentAt, messageIds: ['m'], revision: send.revision })
    await h.tick(5_000); await realSettle(READ_BOUND_MS * 3)
    out.writerStuckAfterHang = h.api.testWriting()
    h.read(undefined)
    for (let i = 0; i < 4; i++) { await h.tick(61_000); await realSettle(READ_BOUND_MS) }
    out.registerSent = h.calls.some(c => c.name.includes('register') && c.items.some(item => item.detailId === '123'))
    out.writerStuckAtEnd = h.api.testWriting()
  }
  // RPC ghi không bao giờ xong (bị bỏ qua tín hiệu huỷ): luồng ghi phải tự thả sau giới hạn và gửi lại.
  {
    const h = serviceHarness(path.join(root, 'stuck-rpc'), shared)
    await h.api.attachServerCampaignEngagementOwner(1, 1); await realSettle()
    for (let i = 0; i < 6; i++) await h.tick(5_000)
    const send = h.api.beginCampaignEngagementSend({ id: 1, zaloUid: 'own' }, 'target')
    h.hangRpc(true)
    h.api.recordCampaignEngagementDetail(456, { version: 1, operationId: send.operationId, accountZaloUid: 'own', targetZaloUid: 'target', actionType: 'message', sentAt: send.sentAt, messageIds: ['m'], revision: send.revision })
    await h.tick(5_000)
    const first = h.calls.filter(c => c.name.includes('register')).length
    h.hangRpc(false)
    await h.tick(46_000); await h.tick(1_000); await h.tick(5_000); await h.tick(15_000)
    out.rpcRetried = h.calls.filter(c => c.name.includes('register') && c.items.some(item => item.detailId === '456')).length > first
    out.writerStuckAfterRpc = h.api.testWriting()
  }
  return out
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-bound-'))
  const shared = load('src/shared/zaloCampaignEngagement.ts')
  const cache = cacheTests(shared)
  const result = { neverSettles: await cache.neverSettles(), lateSettle: await cache.lateSettle(), hostClockJump: await cache.hostClockJump(), service: await serviceTests(shared, root) }
  const logs = warnings.map(args => String(args[0]))
  result.logs = [...new Set(logs)]
  fs.rmSync(root, { recursive: true, force: true })
  if (ref) { console.log(JSON.stringify(result, null, 1)); return }
  assert.equal(result.neverSettles.outcome, 'rejected:engagement_config_read_stalled', 'lần đọc treo phải được trả lời trong giới hạn')
  assert.deepEqual(result.neverSettles.events, ['stalled'])
  assert.equal(result.neverSettles.reads, 2, 'hết thời gian chờ thử lại thì đọc lại')
  assert.equal(result.neverSettles.enabled, true)
  assert.deepEqual(result.lateSettle.events, ['stalled', 'late:resolved'])
  assert.equal(result.lateSettle.applied, false, 'kết quả về muộn không được dùng')
  assert.equal(result.hostClockJump.second, 'read again: enabled=true', 'giờ máy nhảy không được đẩy lần đọc sau ra xa')
  assert.equal(result.service.writerStuckAfterHang, false, 'luồng ghi không được kẹt khi lần đọc cấu hình treo')
  assert.equal(result.service.registerSent, true, 'lượt gửi giữ chỗ trước lúc treo vẫn phải được ghi khi cấu hình đọc lại được')
  assert.equal(result.service.writerStuckAtEnd, false)
  assert.equal(result.service.rpcRetried, true, 'RPC treo phải được thả và gửi lại')
  assert.equal(result.service.writerStuckAfterRpc, false)
  for (const line of ['[ZaloEngagement] config read stalled; giving up on it', '[ZaloEngagement] rpc stalled; retrying later'])
    assert.ok(result.logs.includes(line), 'thiếu log: ' + line)
  const stalled = warnings.find(args => args[0] === '[ZaloEngagement] config read stalled; giving up on it')[1]
  assert.equal(stalled.call, 'config'); assert.equal(stalled.requestMs, null, 'mock không qua fetch thật nên chưa có request')
  console.log('PASS: lần đọc cấu hình treo được thả sau giới hạn và đọc lại; kết quả về muộn bị bỏ; giờ máy nhảy không chặn lần đọc sau; ' +
    'luồng ghi không kẹt khi cấu hình treo (ca 18/11) và khi RPC treo; có log bước treo')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

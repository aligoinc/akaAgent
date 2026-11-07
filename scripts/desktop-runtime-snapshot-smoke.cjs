// Offline smoke for the v461/v476 Desktop runtime snapshot: RAM only, no DB/RPC/network.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
let checks = 0
const pass = name => { checks++; console.log(`PASS ${name}`) }

function load(file) {
  const mod = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require, console }, { filename: file })
  return mod.exports
}

const { DesktopRuntimeSnapshot: VmSnapshot, desktopAccountReadiness, desktopRuntimeAccounts, MAX_DESKTOP_RUNTIME_ACCOUNTS } =
  load(path.join(root, 'src/main/services/desktopRuntimeSnapshot.ts'))
// Đối tượng tạo trong vm khác realm: so sánh trên bản JSON giống dữ liệu gửi RPC.
const plain = value => value === null ? null : JSON.parse(JSON.stringify(value))
class DesktopRuntimeSnapshot extends VmSnapshot { build() { return plain(super.build()) } }

const account = (id, extra = {}) => ({
  id, flatformType: 'zalo', isZaloServer: false, isZaloShowWeb: false, isActive: true,
  status: 'chờ xử lý', loginStatus: 'đã đăng nhập', ...extra
})
let clock = Date.parse('2026-11-03T01:00:00.000Z')
const now = () => new Date(clock)

// 1. Không có scheduler gắn vào: không gửi runtime (bản Web/RPC cũ không thấy gì khác).
{
  const snapshot = new DesktopRuntimeSnapshot(now)
  assert.equal(snapshot.build(), null)
  snapshot.attach(() => { throw new Error('boom') })
  assert.equal(snapshot.build(), null)
  pass('missing or failing source yields no runtime payload')
}

// 2. Trạng thái bộ chạy và lý do sẵn sàng khớp scheduler.
{
  const snapshot = new DesktopRuntimeSnapshot(now)
  const tabs = new Set([12])
  let source = {
    running: true,
    accounts: [
      account(11), account(12, { isZaloShowWeb: true }), account(13, { isZaloShowWeb: true }),
      account(14, { loginStatus: 'chưa đăng nhập' }), account(15, { status: 'tạm dừng' }),
      account(16, { isActive: false }), account(17, { isZaloServer: true }),
      { ...account(18), flatformType: 'facebook' }
    ],
    activeAccountIds: [11],
    runningCampaigns: new Map([[11, 501]]),
    isBrowserTabOpen: id => tabs.has(id)
  }
  snapshot.attach(() => source)
  const first = snapshot.build()
  assert.equal(first.v, 1)
  assert.deepEqual(first.scheduler, { state: 'running', since: '2026-11-03T01:00:00.000Z' })
  assert.deepEqual(first.accounts.map(item => [item.id, item.ready, item.reason, item.runningCampaignId]), [
    [11, true, null, 501], [12, true, null, null], [13, false, 'browser_tab_closed', null],
    [14, false, 'not_logged_in', null], [15, false, 'paused', null], [16, false, 'inactive', null],
    [18, false, 'browser_tab_closed', null]
  ])
  pass('readiness covers browser tab, login, pause and inactive; skips Server; Facebook after Zalo')

  clock += 60_000
  source = { ...source, activeAccountIds: [], runningCampaigns: new Map() }
  assert.deepEqual(snapshot.build().scheduler, { state: 'idle', since: '2026-11-03T01:01:00.000Z' })
  clock += 30_000
  assert.equal(snapshot.build().scheduler.since, '2026-11-03T01:01:00.000Z')
  pass('scheduler since changes only on a state transition')

  snapshot.markMaintenanceWaiting(true)
  const waitingSince = new Date(clock).toISOString()
  clock += 600_000
  snapshot.markMaintenanceWaiting(true)
  assert.deepEqual(snapshot.build().scheduler, { state: 'blocked_daily_maintenance', since: waitingSince })
  snapshot.markMaintenanceWaiting(false)
  assert.equal(snapshot.build().scheduler.state, 'idle')
  pass('daily maintenance wait keeps its original start time')

  source = { ...source, running: false }
  const stopped = snapshot.build()
  assert.equal(stopped.scheduler.state, 'stopped')
  assert.deepEqual(stopped.accounts, [])
  pass('stopped scheduler reports no accounts (no data from a previous session)')
}

// 3. Giới hạn kích thước để RPC (≤ 32 KB) luôn lưu được.
{
  const snapshot = new DesktopRuntimeSnapshot(now)
  const many = Array.from({ length: 450 }, (_, index) => account(1000 + index, { isZaloShowWeb: true }))
  snapshot.attach(() => ({ running: true, accounts: many, activeAccountIds: [], runningCampaigns: new Map(), isBrowserTabOpen: () => false }))
  const payload = snapshot.build()
  assert.equal(payload.accounts.length, MAX_DESKTOP_RUNTIME_ACCOUNTS)
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 32768, 'payload exceeds RPC bound')
  pass(`payload bounded to ${MAX_DESKTOP_RUNTIME_ACCOUNTS} accounts and ${Buffer.byteLength(JSON.stringify(payload))} bytes`)
}

// 3b. v476: tài khoản Facebook, phần Zalo giữ nguyên byte như bản v461.
{
  const fb = (id, extra = {}) => account(id, { flatformType: 'facebook', ...extra })
  // Bản v461: chỉ Zalo không phải Server, cắt 200, lý do không có checkpoint.
  const v461 = (accounts, tabs) => accounts
    .filter(item => String(item.flatformType || '').trim().toLowerCase() === 'zalo' && item.isZaloServer !== true)
    .slice(0, MAX_DESKTOP_RUNTIME_ACCOUNTS)
    .map(item => {
      const reason = !item.isActive ? 'inactive' : item.status === 'tạm dừng' ? 'paused'
        : item.loginStatus !== 'đã đăng nhập' ? 'not_logged_in'
          : item.isZaloShowWeb && !tabs.has(item.id) ? 'browser_tab_closed' : null
      return { id: item.id, ready: reason === null, reason, runningCampaignId: null, progress: null }
    })
  const tabs = new Set([21, 31])
  const mixed = [
    fb(31), account(21, { isZaloShowWeb: true }), fb(32), account(22, { loginStatus: 'checkpoint' }),
    fb(33, { loginStatus: 'checkpoint' }), fb(34, { loginStatus: 'chưa đăng nhập' }), fb(35, { status: 'tạm dừng' }),
    fb(36, { isActive: false }), fb(37, { isZaloServer: true, isZaloShowWeb: true }), account(23, { isZaloServer: true }),
    { ...account(24), flatformType: 'email' }, { ...account(38), flatformType: ' Facebook ' }
  ]
  const snapshot = new DesktopRuntimeSnapshot(now)
  snapshot.attach(() => ({ running: true, accounts: mixed, activeAccountIds: [], runningCampaigns: new Map([[32, 777]]),
    isBrowserTabOpen: id => tabs.has(id) }))
  const payload = snapshot.build()
  assert.deepEqual(payload.accounts.map(item => [item.id, item.reason, item.runningCampaignId]), [
    [21, null, null], [22, 'not_logged_in', null],
    [31, null, null], [32, 'browser_tab_closed', 777], [33, 'checkpoint', null], [34, 'not_logged_in', null],
    [35, 'paused', null], [36, 'inactive', null], [37, 'browser_tab_closed', null], [38, 'browser_tab_closed', null]
  ])
  pass('facebook readiness: tab for every account, checkpoint split for Facebook only, Server/email skipped')
  const zaloOnly = payload.accounts.filter(item => item.id < 30)
  assert.deepEqual(zaloOnly, v461(mixed, tabs))
  pass('zalo entries byte-identical to the v461 snapshot')

  const many = [
    ...Array.from({ length: 150 }, (_, index) => fb(5000 + index)),
    ...Array.from({ length: 120 }, (_, index) => account(4000 + index))
  ]
  const capped = plain(desktopRuntimeAccounts(many))
  assert.equal(capped.length, MAX_DESKTOP_RUNTIME_ACCOUNTS)
  assert.deepEqual(capped.slice(0, 120).map(item => item.id), many.slice(150).map(item => item.id))
  assert.equal(capped.filter(item => item.flatformType === 'facebook').length, 80)
  const onlyZalo = Array.from({ length: 450 }, (_, index) => account(6000 + index))
  assert.deepEqual(plain(desktopRuntimeAccounts([...Array.from({ length: 10 }, (_, index) => fb(7000 + index)), ...onlyZalo])).map(item => item.id),
    onlyZalo.slice(0, MAX_DESKTOP_RUNTIME_ACCOUNTS).map(item => item.id))
  const bytes = Buffer.byteLength(JSON.stringify({ v: 1, scheduler: { state: 'idle', since: new Date(clock).toISOString() },
    accounts: capped.map(item => ({ id: item.id, ready: false, reason: 'browser_tab_closed', runningCampaignId: 2147483647, progress: null })) }))
  assert.ok(bytes <= 32768, 'payload exceeds RPC bound')
  pass(`shared ${MAX_DESKTOP_RUNTIME_ACCOUNTS}-account cap keeps Zalo first; worst case ${bytes} bytes`)
}

// 4. Hàm lý do độc lập với instance.
assert.equal(desktopAccountReadiness(account(1), () => false), null)
assert.equal(desktopAccountReadiness(account(2, { isZaloShowWeb: true }), () => false), 'browser_tab_closed')
assert.equal(desktopAccountReadiness(account(3, { flatformType: 'facebook' }), () => false), 'browser_tab_closed')
assert.equal(desktopAccountReadiness(account(4, { flatformType: 'facebook' }), () => true), null)
assert.equal(desktopAccountReadiness(account(5, { flatformType: 'facebook', loginStatus: 'checkpoint' }), () => true), 'checkpoint')
assert.equal(desktopAccountReadiness(account(6, { loginStatus: 'checkpoint' }), () => true), 'not_logged_in')
pass('readiness helper')

// 5. Heartbeat chỉ gắn runtime khi có, và phiên kết thúc vẫn gửi như cũ.
{
  const source = fs.readFileSync(path.join(root, 'src/main/services/devicePresenceService.ts'), 'utf8')
  assert.match(source, /desktopRuntimeSnapshot\.build\(\)/)
  assert.match(source, /\.\.\.\(runtime \? \{ runtime/)
  pass('presence service attaches runtime only when available')
  const scheduler = fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8')
  const randomTurn = scheduler.slice(scheduler.indexOf('this.facebookRandomTurns.set(campaign.id'), scheduler.indexOf('this.facebookRandomTurns.delete(campaign.id)'))
  assert.match(randomTurn, /this\.runtimeCampaignByAccount\.set\(account\.id, campaign\.id\)/)
  assert.match(randomTurn, /finally \{\s*if \(this\.runtimeCampaignByAccount\.get\(account\.id\) === campaign\.id\) this\.runtimeCampaignByAccount\.delete\(account\.id\)/)
  pass('random Facebook turns publish runningCampaignId and clear it after the run')
}

console.log(`OK ${checks} checks`)

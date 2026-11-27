// Offline smoke cho bộ giữ việc mới sau khi máy ngủ (src/main/services/systemSleepGuard.ts, docs/DESKTOP_SLEEP_GUARD.md).
// Chỉ RAM: đồng hồ, thời gian không thao tác và công tắc đều giả; không Electron, không DB.
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

const {
  SystemSleepGuard, parseSleepGuardSwitch, sleepGuardPlatform, DEFAULT_SLEEP_GUARD_SWITCH, SLEEP_GUARD_SETTING_KEY, SLEEP_GUARD_GAP_MS,
  SLEEP_GUARD_STALL_MS, SLEEP_GUARD_WAKE_NOISE_MS
} = load(path.join(root, 'src/main/services/systemSleepGuard.ts'))
const plain = value => value === null ? null : JSON.parse(JSON.stringify(value))

/** Máy giả: đồng hồ treo tường + đồng hồ đơn điệu cùng chạy; ngủ thì cả hai nhảy (bản Electron đo được timer quá hạn lúc thức). */
function machine({ platform = 'mac', idle = () => 3600 } = {}) {
  const state = { wall: Date.parse('2026-11-17T18:00:00.000Z'), mono: 1_000_000, idle, holds: [], releases: [] }
  const guard = new SystemSleepGuard({
    platform,
    wallNow: () => state.wall,
    monoNow: () => state.mono,
    idleSeconds: () => state.idle(),
    onHold: reason => state.holds.push(reason),
    onRelease: reason => state.releases.push(reason)
  })
  const advance = ms => { state.wall += ms; state.mono += ms }
  /** Thức bình thường: mỗi giây một nhịp. */
  const awake = seconds => { for (let i = 0; i < seconds; i++) { advance(1_000); guard.beat() } }
  /** Ngủ: tiến trình bị đóng băng, không nhịp nào chạy. */
  const sleep = ms => advance(ms)
  return { state, guard, advance, awake, sleep }
}

// 1. Công tắc: thiếu / sai = mặc định (Mac bật, Windows tắt, 10 phút, thức liền 60 giây); từng khoá đọc riêng.
{
  assert.equal(SLEEP_GUARD_SETTING_KEY, 'desktop.sleep_guard')
  const DEFAULTS = { mac: true, win: false, awakeMinutes: 10, settleSeconds: 60 }
  assert.deepEqual(plain(DEFAULT_SLEEP_GUARD_SWITCH), DEFAULTS)
  for (const raw of [undefined, null, '', 'không phải json', '[]', '"mac"', '42', '{"mac":"true"}']) {
    assert.deepEqual(plain(parseSleepGuardSwitch(raw)), DEFAULTS, String(raw))
  }
  assert.deepEqual(plain(parseSleepGuardSwitch('{"mac":false}')), { ...DEFAULTS, mac: false })
  assert.deepEqual(plain(parseSleepGuardSwitch('{"win":true,"awakeMinutes":30}')), { ...DEFAULTS, win: true, awakeMinutes: 30 })
  assert.deepEqual(plain(parseSleepGuardSwitch({ mac: false, win: true, awakeMinutes: 1 })), { ...DEFAULTS, mac: false, win: true, awakeMinutes: 1 })
  for (const minutes of [0, 121, 2.5, '10', -5]) {
    assert.equal(parseSleepGuardSwitch({ awakeMinutes: minutes }).awakeMinutes, 10, String(minutes))
  }
  // settleSeconds: 0 (như bản đầu) tới 600; sai thì 60.
  assert.equal(parseSleepGuardSwitch('{"settleSeconds":0}').settleSeconds, 0)
  assert.equal(parseSleepGuardSwitch({ settleSeconds: 120 }).settleSeconds, 120)
  for (const seconds of [-1, 601, 2.5, '60', null]) {
    assert.equal(parseSleepGuardSwitch({ settleSeconds: seconds }).settleSeconds, 60, String(seconds))
  }
  assert.equal(SLEEP_GUARD_STALL_MS, 5_000)
  assert.equal(SLEEP_GUARD_WAKE_NOISE_MS, 5_000)
  assert.equal(sleepGuardPlatform('darwin'), 'mac')
  assert.equal(sleepGuardPlatform('win32'), 'win')
  assert.equal(sleepGuardPlatform('linux'), null)
  pass('switch parsing and platform mapping')
}

// 2. Windows mặc định tắt: ngủ dậy vẫn nhận việc như hôm nay, không ghi trạng thái giữ.
{
  const m = machine({ platform: 'win' })
  m.awake(5)
  m.guard.noteSuspend()
  m.sleep(16 * 60_000)
  assert.equal(m.guard.canStartWork(), true)
  assert.equal(m.guard.snapshot(), null)
  assert.deepEqual(m.state.holds, [])
  const other = new SystemSleepGuard({ platform: null })
  assert.equal(other.canStartWork(), true)
  pass('platform switched off (Windows default, unknown OS) never holds')
}

// 3. Mac thức bình thường (kể cả không ai dùng, chạy chiến dịch qua đêm): không bao giờ giữ.
{
  const m = machine()
  m.awake(3 * 3600)
  assert.equal(m.guard.canStartWork(), true)
  assert.deepEqual(m.state.holds, [])
  // Đồng hồ máy lùi (chỉnh giờ) không phải là ngủ.
  m.state.wall -= 3 * 3600_000
  m.awake(2)
  assert.equal(m.guard.canStartWork(), true)
  assert.deepEqual(m.state.holds, [])
  pass('awake unattended Mac and backward clock change keep running')
}

// 4. Đúng ca đo được 17–18/11: ngủ ~16 phút, thức tạm 4–5 giây, không ai chạm máy ⇒ không nhận việc mới lần nào.
{
  const m = machine()
  m.awake(10)
  for (let wake = 0; wake < 30; wake++) {
    m.sleep(16 * 60_000 + 27_000)
    // Bộ lập lịch hỏi ngay lúc thức, trước cả nhịp đếm (timer quá hạn chạy dồn).
    assert.equal(m.guard.canStartWork(), false, `dark wake ${wake}`)
    for (let second = 0; second < 5; second++) {
      m.advance(1_000)
      m.guard.beat()
      assert.equal(m.guard.canStartWork(), false, `dark wake ${wake} second ${second}`)
    }
  }
  assert.deepEqual(m.state.holds, ['clock_gap'])
  assert.deepEqual(m.state.releases, [])
  assert.equal(m.guard.snapshot().reason, 'clock_gap')
  assert.equal(m.guard.snapshot().since, '2026-11-17T18:16:37.000Z')
  pass('30 dark wakes of 5 s each never start new work')
}

// 5. Người dùng mở máy: có thao tác sau lần thức, hoặc mở khoá màn hình, thì nhận việc lại khi máy đã thức liền 60 giây.
{
  const m = machine()
  m.awake(5)
  m.sleep(40 * 60_000)
  assert.equal(m.guard.canStartWork(), false)
  m.state.idle = () => 0 // người dùng đang gõ / di chuột liên tục
  m.awake(59)
  assert.equal(m.guard.canStartWork(), false, 'chưa đủ 60 giây thức liền')
  assert.deepEqual(m.state.releases, [])
  m.awake(1)
  assert.equal(m.guard.canStartWork(), true)
  assert.deepEqual(m.state.releases, ['user_active'])
  assert.deepEqual(plain(m.guard.releaseSnapshot()), { at: '2026-11-17T18:41:05.000Z', reason: 'user_active',
    heldSince: '2026-11-17T18:40:05.000Z', awakeSeconds: 60 })
  const n = machine()
  n.awake(2)
  n.guard.noteSuspend()
  n.sleep(20 * 60_000)
  assert.equal(n.guard.canStartWork(), false)
  n.guard.noteUserActive()
  assert.equal(n.guard.canStartWork(), false, 'mở khoá chưa đủ: máy mới thức')
  n.awake(59)
  assert.equal(n.guard.canStartWork(), false)
  n.awake(1)
  assert.equal(n.guard.canStartWork(), true)
  assert.deepEqual(n.state.releases, ['user_active'])
  // Thao tác một lần lúc vừa thức (trong 5 giây đầu) rồi bỏ đi: không tính là có người, chờ quy tắc thức đủ 10 phút.
  const o = machine()
  o.awake(2)
  o.sleep(20 * 60_000)
  assert.equal(o.guard.canStartWork(), false)
  const wake = o.state.mono
  o.state.idle = () => Math.floor((o.state.mono - wake - 2_000) / 1000) // thao tác cuối ở giây thứ 2 sau khi thức
  o.awake(9 * 60)
  assert.equal(o.guard.canStartWork(), false)
  o.awake(60)
  assert.equal(o.guard.canStartWork(), true)
  assert.deepEqual(o.state.releases, ['awake'])
  pass('user input after wake or screen unlock releases the hold only after 60 s of continuous wake')
}

// 5b. Máy Mac 10.0.0 của một khách ngày 19/11/2026 (đo bằng edge_logs): 22 lần thức tạm trong buổi chiều, 5 lần dài 4–15 giây đã lọt.
//     Dựng lại cả ba đường nghi ngờ cùng lúc ở MỌI lần thức: sự kiện mở khoá đến ngay lúc thức, bộ đếm "không thao tác" bị hệ điều hành
//     đặt lại 1,5 giây sau khi thức, và máy đứng 20 giây giữa lần thức. Không lần nào được nhận việc mới.
{
  const run = settleSeconds => {
    const m = machine()
    if (settleSeconds !== undefined) m.guard.setSwitch(parseSleepGuardSwitch({ settleSeconds }))
    m.awake(10)
    m.guard.noteSuspend()
    let started = 0
    const durations = [15, 1, 3, 2, 3, 1, 1, 1, 1, 1, 4, 4, 5, 1, 1, 1, 4, 4, 5, 4, 2, 8]
    for (const [index, seconds] of durations.entries()) {
      m.sleep(index === durations.length - 1 ? 3 * 60_000 : 16 * 60_000 + 20_000)
      const wake = m.state.mono
      m.state.idle = () => Math.max(0, Math.floor((m.state.mono - wake - 1_500) / 1000))
      if (m.guard.canStartWork()) started++
      m.guard.noteUserActive()
      for (let second = 0; second < seconds; second++) {
        m.advance(1_000)
        m.guard.beat()
        if (m.guard.canStartWork()) started++
        // Giữa lần thức dài, máy đứng 20 giây rồi chạy tiếp (dưới ngưỡng 60 giây nên không tính là ngủ).
        if (seconds >= 8 && second === 3) { m.advance(20_000); if (m.guard.canStartWork()) started++ }
      }
    }
    return { started, releases: m.state.releases.slice() }
  }
  const fixed = run(undefined)
  assert.deepEqual(fixed, { started: 0, releases: [] })
  // Cùng kịch bản với `settleSeconds: 0` (cách của bản 10.0.0 / 10.1.0): lọt ngay từ lần thức đầu.
  const old = run(0)
  assert.ok(old.started > 0, JSON.stringify(old))
  assert.equal(old.releases[0], 'user_active')
  pass('brief wakes with unlock events, reset idle counter and sub-minute stalls never start work (settleSeconds 0 reproduces the leak)')
}

// 5c. Tiến trình chạy chập chờn lúc máy ngủ (nhịp cách nhau 10–50 giây suốt 30 phút, không nhịp nào trễ tới 60 giây): thời gian đứng
//     không được cộng thành "đã thức 10 phút".
{
  const m = machine()
  m.awake(5)
  m.guard.noteSuspend()
  for (let i = 0; i < 60; i++) {
    m.advance(10_000 + (i % 5) * 10_000)
    assert.equal(m.guard.canStartWork(), false, `nhịp chập chờn ${i}`)
  }
  assert.deepEqual(m.state.releases, [])
  // Thức hẳn và liền mạch: quy tắc 10 phút vẫn chạy.
  m.awake(10 * 60)
  assert.equal(m.guard.canStartWork(), true)
  assert.deepEqual(m.state.releases, ['awake'])
  pass('sporadic beats during sleep do not add up to the awake timer')
}

// 5d. Tắt yêu cầu thức liền mạch từ xa (`settleSeconds: 0`): thôi giữ ngay khi có thao tác / mở khoá như bản đầu.
{
  const m = machine()
  m.guard.setSwitch(parseSleepGuardSwitch({ settleSeconds: 0 }))
  m.awake(5)
  m.sleep(40 * 60_000)
  assert.equal(m.guard.canStartWork(), false)
  m.awake(3)
  assert.equal(m.guard.canStartWork(), false)
  m.state.idle = () => 0
  m.awake(1)
  assert.equal(m.guard.canStartWork(), true)
  const n = machine()
  n.guard.setSwitch(parseSleepGuardSwitch({ settleSeconds: 0 }))
  n.awake(2)
  n.guard.noteSuspend()
  n.sleep(20 * 60_000)
  assert.equal(n.guard.canStartWork(), false)
  n.guard.noteUserActive()
  assert.equal(n.guard.canStartWork(), true)
  assert.equal(n.guard.releaseSnapshot().reason, 'user_active')
  pass('settleSeconds 0 restores immediate release')
}

// 6. Thao tác cuối ngay trước khi ngủ, bộ đếm thời gian không thao tác không tính lúc ngủ, số giây làm tròn xuống:
//    lần thức tạm vẫn không bị coi là có người.
{
  const m = machine()
  m.awake(5)
  m.guard.noteSuspend()
  m.sleep(16 * 60_000)
  let wakeMono = null
  m.state.idle = () => Math.floor(((m.state.mono - (wakeMono ?? m.state.mono)) + 200) / 1000)
  assert.equal(m.guard.canStartWork(), false)
  wakeMono = m.state.mono
  for (let step = 0; step < 100; step++) {
    m.advance(100)
    assert.equal(m.guard.canStartWork(), false, `step ${step}`)
  }
  assert.deepEqual(m.state.releases, [])
  pass('rounded idle seconds right after the last input do not count as a user')
}

// 7. Máy thức hẳn mà không ai chạm (thức theo lịch…): thôi giữ sau awakeMinutes; ngủ lại thì đếm lại từ đầu.
{
  const m = machine()
  m.awake(5)
  m.sleep(60 * 60_000)
  assert.equal(m.guard.canStartWork(), false)
  m.awake(9 * 60)
  assert.equal(m.guard.canStartWork(), false)
  m.sleep(16 * 60_000)
  assert.equal(m.guard.canStartWork(), false)
  m.awake(9 * 60 + 59)
  assert.equal(m.guard.canStartWork(), false)
  m.awake(1)
  assert.equal(m.guard.canStartWork(), true)
  assert.deepEqual(m.state.releases, ['awake'])
  const quick = machine()
  quick.guard.setSwitch(parseSleepGuardSwitch('{"awakeMinutes":2}'))
  quick.awake(1)
  quick.sleep(30 * 60_000)
  assert.equal(quick.guard.canStartWork(), false)
  quick.awake(120)
  assert.equal(quick.guard.canStartWork(), true)
  pass('continuous wake releases after awakeMinutes and restarts after another sleep')
}

// 8. 'suspend' mà máy không ngủ (huỷ ngủ): không kẹt, thôi giữ khi có thao tác hoặc đủ thời gian thức.
{
  const m = machine()
  m.awake(5)
  m.guard.noteSuspend()
  assert.equal(m.guard.canStartWork(), false)
  assert.equal(m.guard.snapshot().reason, 'suspend')
  m.awake(10 * 60)
  assert.equal(m.guard.canStartWork(), true)
  assert.deepEqual(m.state.holds, ['suspend'])
  assert.deepEqual(m.state.releases, ['awake'])
  pass('cancelled sleep does not hold forever')
}

// 9. Tắt từ xa khi đang giữ: thôi giữ ngay (máy đang đứng chờ được cứu mà không cần build).
{
  const m = machine()
  m.awake(5)
  m.sleep(30 * 60_000)
  assert.equal(m.guard.canStartWork(), false)
  m.guard.setSwitch(parseSleepGuardSwitch('{"mac":false}'))
  assert.equal(m.guard.canStartWork(), true)
  assert.equal(m.guard.snapshot(), null)
  assert.deepEqual(m.state.releases, ['disabled'])
  m.sleep(30 * 60_000)
  assert.equal(m.guard.canStartWork(), true)
  pass('remote switch off releases a held machine')
}

// 10. Không đọc được thời gian không thao tác: chỉ thôi giữ theo thời gian thức.
{
  const m = machine({ idle: () => { throw new Error('no idle API') } })
  m.awake(1)
  m.sleep(30 * 60_000)
  assert.equal(m.guard.canStartWork(), false)
  m.awake(10 * 60)
  assert.equal(m.guard.canStartWork(), true)
  const n = machine({ idle: () => null })
  n.awake(1)
  n.sleep(30 * 60_000)
  assert.equal(n.guard.canStartWork(), false)
  n.awake(60)
  assert.equal(n.guard.canStartWork(), false)
  pass('missing idle time falls back to the awake timer')
}

// 11. Nhịp đếm trễ dưới 60 giây (máy bận, timer bị dồn) không phải là ngủ.
{
  const m = machine()
  m.awake(5)
  m.advance(SLEEP_GUARD_GAP_MS - 1)
  assert.equal(m.guard.canStartWork(), true)
  m.advance(SLEEP_GUARD_GAP_MS)
  assert.equal(m.guard.canStartWork(), false)
  pass('gap threshold is 60 seconds')
}

// 12. Đường nối: bộ lập lịch Desktop hỏi bộ giữ ở mọi chỗ bắt đầu việc mới; App Server không truyền bộ giữ.
{
  const scheduler = fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8')
  assert.match(scheduler, /this\.startWorkGate = options\.startWorkGate\n/)
  // Bộ giữ là tuỳ chọn: App Server và các smoke dựng bộ lập lịch không qua constructor không có bộ giữ = luôn nhận việc.
  assert.match(scheduler, /private readonly startWorkGate\?: \(\) => boolean/)
  assert.match(scheduler, /acceptingWork: \(\) => this\.running && !this\.zaloRuntimeStopRequested && this\.startWorkGate\?\.\(\) !== false,/)
  const held = /this\.startWorkGate\?\.\(\) === false/
  const between = (start, end) => {
    const from = scheduler.indexOf(start)
    assert.ok(from >= 0, start)
    const to = scheduler.indexOf(end, from)
    assert.ok(to > from, end)
    return scheduler.slice(from, to)
  }
  const tick = between('  private async tick(): Promise<void> {', '    if (this.dispatching) {')
  assert.match(tick, new RegExp(`if \\(${held.source}\\) return`))
  assert.match(between('  private async tick(): Promise<void> {', 'this.startAccountCampaignQueue(account, queueCampaigns)'),
    new RegExp(`for \\(const account of accounts\\) \\{\\s*if \\(!this\\.running \\|\\| ${held.source}\\) break`))
  const queue = between('  private async runAccountCampaignQueue(', 'const liveAccount = account.flatformType')
  assert.match(queue, new RegExp(`if \\(${held.source}\\) break`))
  const random = between('  private async runFacebookRandomQueue(', '  private randomBatchRemaining(')
  assert.match(random, new RegExp(`while \\(this\\.running\\) \\{\\s*if \\(${held.source}\\) return`))
  assert.match(random, new RegExp(`if \\(!this\\.running \\|\\| ${held.source}\\) return`))
  const handlers = fs.readFileSync(path.join(root, 'src/main/ipc/handlers.ts'), 'utf8')
  assert.match(handlers, /startWorkGate: \(\) => sleepGuard\.canStartWork\(\)/)
  assert.match(handlers, /desktopRuntimeSnapshot\.attachSleepRelease\(\(\) => sleepGuard\.releaseSnapshot\(\)\)/)
  assert.match(handlers, /powerMonitor\.on\('suspend', \(\) => \{[^}]*sleepGuard\.noteSuspend\(\)/)
  assert.match(handlers, /powerMonitor\.on\('unlock-screen', \(\) => sleepGuard\.noteUserActive\(\)\)/)
  assert.match(handlers, /wakeSchedulerAfterSleep = \(\) => setImmediate\(\(\) => campaignScheduler\.wakeNow\('sleep-guard-released'\)\)/)
  for (const file of fs.readdirSync(path.join(root, 'src/server'), { recursive: true })) {
    if (!String(file).endsWith('.ts')) continue
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/server', String(file)), 'utf8'), /startWorkGate|systemSleepGuard/, String(file))
  }
  pass('Desktop scheduler wiring; App Server untouched')
}

console.log(`OK ${checks} checks`)

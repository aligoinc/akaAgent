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
  SystemSleepGuard, parseSleepGuardSwitch, sleepGuardPlatform, DEFAULT_SLEEP_GUARD_SWITCH, SLEEP_GUARD_SETTING_KEY, SLEEP_GUARD_GAP_MS
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

// 1. Công tắc: thiếu / sai = mặc định (Mac bật, Windows tắt, 10 phút); từng khoá đọc riêng.
{
  assert.equal(SLEEP_GUARD_SETTING_KEY, 'desktop.sleep_guard')
  assert.deepEqual(plain(DEFAULT_SLEEP_GUARD_SWITCH), { mac: true, win: false, awakeMinutes: 10 })
  for (const raw of [undefined, null, '', 'không phải json', '[]', '"mac"', '42', '{"mac":"true"}']) {
    assert.deepEqual(plain(parseSleepGuardSwitch(raw)), { mac: true, win: false, awakeMinutes: 10 }, String(raw))
  }
  assert.deepEqual(plain(parseSleepGuardSwitch('{"mac":false}')), { mac: false, win: false, awakeMinutes: 10 })
  assert.deepEqual(plain(parseSleepGuardSwitch('{"win":true,"awakeMinutes":30}')), { mac: true, win: true, awakeMinutes: 30 })
  assert.deepEqual(plain(parseSleepGuardSwitch({ mac: false, win: true, awakeMinutes: 1 })), { mac: false, win: true, awakeMinutes: 1 })
  for (const minutes of [0, 121, 2.5, '10', -5]) {
    assert.equal(parseSleepGuardSwitch({ awakeMinutes: minutes }).awakeMinutes, 10, String(minutes))
  }
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

// 5. Người dùng mở máy: có thao tác sau lần thức thì nhận việc lại ngay; mở khoá màn hình cũng vậy.
{
  const m = machine()
  m.awake(5)
  m.sleep(40 * 60_000)
  assert.equal(m.guard.canStartWork(), false)
  m.awake(3)
  assert.equal(m.guard.canStartWork(), false)
  m.state.idle = () => 0 // vừa di chuột
  m.awake(1)
  assert.equal(m.guard.canStartWork(), true)
  assert.deepEqual(m.state.releases, ['user_active'])
  const n = machine()
  n.awake(2)
  n.guard.noteSuspend()
  n.sleep(20 * 60_000)
  assert.equal(n.guard.canStartWork(), false)
  n.guard.noteUserActive()
  assert.equal(n.guard.canStartWork(), true)
  assert.deepEqual(n.state.releases, ['user_active'])
  pass('user input after wake or screen unlock releases the hold')
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
  assert.match(between('  private async tick(): Promise<void> {', 'this.startAccountCampaignQueue(account, campaigns)'),
    new RegExp(`for \\(const account of accounts\\) \\{\\s*if \\(!this\\.running \\|\\| ${held.source}\\) break`))
  const queue = between('  private async runAccountCampaignQueue(', 'const liveAccount = account.flatformType')
  assert.match(queue, new RegExp(`if \\(${held.source}\\) break`))
  const random = between('  private async runFacebookRandomQueue(', '  private randomBatchRemaining(')
  assert.match(random, new RegExp(`while \\(this\\.running\\) \\{\\s*if \\(${held.source}\\) return`))
  assert.match(random, new RegExp(`if \\(!this\\.running \\|\\| ${held.source}\\) return`))
  const handlers = fs.readFileSync(path.join(root, 'src/main/ipc/handlers.ts'), 'utf8')
  assert.match(handlers, /startWorkGate: \(\) => sleepGuard\.canStartWork\(\)/)
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

// Giảm request REST của App Server (Zalo Server VPS) ngày 10/11/2026.
// Chạy đúng code scheduler/repository thật với đồng hồ giả và DB giả, không mạng.
// Run: node scripts/server-rest-request-reduction-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const compile = code => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const source = file => ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)

const schedulerSource = source('src/main/services/campaignScheduler.ts')
const repositorySource = source('src/main/data/repositories/campaignRepository.ts')
const schedulerClass = schedulerSource.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CampaignScheduler')
assert.ok(schedulerClass, 'CampaignScheduler class')

function method(name) {
  const node = schedulerClass.members.find(n => n.name?.getText(schedulerSource) === name)
  assert.ok(node, `missing scheduler method ${name}`)
  return node.getText(schedulerSource)
}

function topLevel(sf, name) {
  const node = sf.statements.find(n =>
    (ts.isFunctionDeclaration(n) && n.name?.text === name) ||
    (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(sf) === name)))
  assert.ok(node, `missing top-level ${name}`)
  return node.getText(sf)
}

function fakeClock(start = Date.UTC(2026, 10, 10, 3, 0, 0)) {
  const clock = { now: start }
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])) }
    static now() { return clock.now }
  }
  return {
    clock,
    Date: FakeDate,
    setTimeout: (fn, ms = 0) => {
      clock.now += Math.max(0, Number(ms) || 0)
      Promise.resolve().then(fn)
      return 0
    }
  }
}

function load(code, context) {
  const mod = { exports: {} }
  vm.runInNewContext(compile(code), { module: mod, exports: mod.exports, JSON, console, ...context })
  return mod.exports
}

// Values created inside the vm realm have other prototypes; compare plain data.
const plain = value => JSON.parse(JSON.stringify(value))
const same = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message)

const results = []
async function check(name, fn) {
  await fn()
  results.push(name)
}

;(async () => {
  // 1. Janitor toàn cục: một lần mỗi 30 giây cho cả tiến trình.
  await check('enable_due_auto_account_actions chạy tối đa 1 lần/30 giây cho cả tiến trình', async () => {
    const fake = fakeClock()
    const claim = load(`${topLevel(schedulerSource, 'ENABLE_DUE_ACCOUNT_ACTIONS_MIN_INTERVAL_MS')}
${topLevel(schedulerSource, 'enableDueAccountActionsLastStartedAt')}
${topLevel(schedulerSource, 'claimEnableDueAccountActionsSlot')}
module.exports = claimEnableDueAccountActionsSlot`, { Date: fake.Date })
    const t0 = fake.clock.now
    assert.equal(claim(t0), true)
    assert.equal(claim(t0 + 1), false)
    assert.equal(claim(t0 + 29_999), false)
    assert.equal(claim(t0 + 30_000), true)
    assert.equal(claim(t0 + 30_000 - 3_600_000), true, 'đồng hồ lùi không được chặn mãi')
    // 516 runtime staff, mỗi runtime tick 30 giây một lần, trong 10 phút.
    const start = t0 + 10_000_000
    let calls = 0
    let ticks = 0
    for (let ms = 0; ms < 600_000; ms += 1_000) {
      for (let staff = 0; staff < 516; staff++) {
        if ((staff * 58) % 30_000 === ms % 30_000 || (ms % 30_000 === Math.floor(staff * 58 / 1_000) * 1_000)) {
          ticks++
          if (claim(start + ms)) calls++
        }
      }
    }
    assert.ok(ticks >= 516 * 19, `ticks=${ticks}`)
    assert.ok(calls <= 21, `calls=${calls}`)
  })

  // 2. Nghỉ giữa 2 mục tiêu: kiểm 15 giây/lần, vẫn luôn kiểm lần cuối trước mục tiêu kế.
  function sleepHarness(controlAt) {
    const fake = fakeClock()
    const Scheduler = load(`${topLevel(schedulerSource, 'SERVER_ZALO_SLEEP_CONTROL_POLL_MS')}
class Scheduler {
  ${method('sleepBetweenTargets')}
  ${method('isServerZaloBoundaryRequested')}
  ${method('latchServerZaloPause')}
}
module.exports = Scheduler`, { Date: fake.Date, setTimeout: fake.setTimeout })
    const start = fake.clock.now
    const calls = []
    const scheduler = Object.assign(new Scheduler(), {
      running: true,
      serverZaloPauseBoundaries: new Map(),
      isCampaignPauseRequested: () => false,
      checkCampaignRunBoundary: async () => null,
      yieldCampaignAtRunBoundary: async () => true,
      isServerZaloCampaign: () => true,
      getZaloRuntimeStopReason: () => null,
      getServerZaloHardStopMessage: reason => `stop:${reason}`,
      supabase: {
        getZaloServerRunControlState: async () => {
          const at = fake.clock.now - start
          calls.push(at)
          return { campaignStatus: 'đang chạy', accountStatus: 'đang chạy', hardStopReason: null, ...controlAt(at) }
        }
      }
    })
    return { scheduler, calls }
  }
  const campaign = { id: 1, actionId: 'zalo_message_phone' }
  const account = { id: 2 }

  await check('nghỉ 120 giây chỉ gọi run control 9 lần (trước đây 25)', async () => {
    const { scheduler, calls } = sleepHarness(() => ({}))
    const result = await scheduler.sleepBetweenTargets(campaign, 120, account)
    same(result, { status: 'completed' })
    assert.deepEqual(calls, [0, 15_000, 30_000, 45_000, 60_000, 75_000, 90_000, 105_000, 120_000])
  })

  await check('tạm dừng trong lúc nghỉ được nhận trong ≤ 15 giây', async () => {
    const { scheduler, calls } = sleepHarness(at => at >= 20_000 ? { campaignStatus: 'tạm dừng' } : {})
    const result = await scheduler.sleepBetweenTargets(campaign, 120, account)
    same(result, { status: 'paused' })
    assert.equal(calls.at(-1), 30_000)
    assert.equal(scheduler.serverZaloPauseBoundaries.get(1), 'campaign')
  })

  await check('tạm dừng ngay trước khi hết nghỉ vẫn chặn mục tiêu kế (lần kiểm cuối)', async () => {
    const { scheduler, calls } = sleepHarness(at => at >= 5_000 ? { accountStatus: 'tạm dừng' } : {})
    const result = await scheduler.sleepBetweenTargets(campaign, 10, account)
    same(result, { status: 'paused' })
    assert.deepEqual(calls, [0, 10_000])
    assert.equal(scheduler.serverZaloPauseBoundaries.get(1), 'account')
  })

  await check('dừng cứng trong lúc nghỉ trả hard-stop', async () => {
    const { scheduler } = sleepHarness(at => at >= 40_000 ? { hardStopReason: 'account_deleted' } : {})
    const result = await scheduler.sleepBetweenTargets(campaign, 300, account)
    same(result, { status: 'hard-stop', reason: 'stop:account_deleted' })
  })

  // 3. Bỏ qua chiến dịch đang bị chặn hạn mức ổn định.
  function skipHarness() {
    const fake = fakeClock()
    const Scheduler = load(`${topLevel(schedulerSource, 'PRECLAIM_LIMIT_RECHECK_MAX_MS')}
class Scheduler {
  preclaimLimitSkips = new Map()
  ${method('getPreclaimLimitAccountKey')}
  ${method('rememberPreclaimLimitSkip')}
  ${method('shouldSkipPreclaimLimitedCampaign')}
  ${method('prunePreclaimLimitSkips')}
}
module.exports = Scheduler`, { Date: fake.Date })
    return { fake, scheduler: new Scheduler() }
  }
  const zaloAccount = (extra = {}) => ({ id: 2, flatformType: 'zalo', accountGroupSettings: { byActionCode: { zalo_message_stranger: { dailyLimit: 30 } } }, ...extra })
  const blocked = (extra = {}) => ({ id: 10, accountId: 2, updatedAt: '2026-11-10T03:00:00.000+00:00', ...extra })

  await check('chặn theo giờ: bỏ qua tối đa 5 phút rồi kiểm lại', async () => {
    const { fake, scheduler } = skipHarness()
    scheduler.rememberPreclaimLimitSkip(zaloAccount(), blocked(), { ok: false, retryAfterMs: 40 * 60_000 })
    assert.equal(scheduler.shouldSkipPreclaimLimitedCampaign(zaloAccount(), blocked()), true)
    fake.clock.now += 5 * 60_000 - 1
    assert.equal(scheduler.shouldSkipPreclaimLimitedCampaign(zaloAccount(), blocked()), true)
    fake.clock.now += 1
    assert.equal(scheduler.shouldSkipPreclaimLimitedCampaign(zaloAccount(), blocked()), false)
    assert.equal(scheduler.preclaimLimitSkips.size, 0)
  })

  await check('retryAfter ngắn hơn 5 phút được tôn trọng', async () => {
    const { fake, scheduler } = skipHarness()
    scheduler.rememberPreclaimLimitSkip(zaloAccount(), blocked(), { ok: false, retryAfterMs: 90_000 })
    fake.clock.now += 89_999
    assert.equal(scheduler.shouldSkipPreclaimLimitedCampaign(zaloAccount(), blocked()), true)
    fake.clock.now += 1
    assert.equal(scheduler.shouldSkipPreclaimLimitedCampaign(zaloAccount(), blocked()), false)
  })

  await check('sửa chiến dịch, đổi nhóm tài khoản hoặc khác tài khoản thì kiểm lại ngay', async () => {
    const { scheduler } = skipHarness()
    const remember = () => scheduler.rememberPreclaimLimitSkip(zaloAccount(), blocked(), { ok: false, retryAfterMs: 3_600_000 })
    remember()
    assert.equal(scheduler.shouldSkipPreclaimLimitedCampaign(zaloAccount(), blocked({ updatedAt: '2026-11-10T03:00:01.000+00:00' })), false)
    remember()
    assert.equal(scheduler.shouldSkipPreclaimLimitedCampaign(zaloAccount({ accountGroupSettings: { byActionCode: { zalo_message_stranger: { dailyLimit: 60 } } } }), blocked()), false)
    remember()
    assert.equal(scheduler.shouldSkipPreclaimLimitedCampaign(zaloAccount({ id: 3 }), blocked()), false)
  })

  await check('Facebook, retryAfter = 0 hoặc thiếu updatedAt thì không nhớ; thiếu retryAfter dùng 5 phút', async () => {
    const { fake, scheduler } = skipHarness()
    scheduler.rememberPreclaimLimitSkip(zaloAccount({ flatformType: 'facebook' }), blocked(), { ok: false, retryAfterMs: 3_600_000 })
    scheduler.rememberPreclaimLimitSkip(zaloAccount(), blocked({ id: 11 }), { ok: false, retryAfterMs: 0 })
    scheduler.rememberPreclaimLimitSkip(zaloAccount(), blocked({ id: 12, updatedAt: undefined }), { ok: false, retryAfterMs: 3_600_000 })
    assert.equal(scheduler.preclaimLimitSkips.size, 0)
    scheduler.rememberPreclaimLimitSkip(zaloAccount(), blocked({ id: 13 }), { ok: false, isActionDisabled: true })
    fake.clock.now += 5 * 60_000 - 1
    assert.equal(scheduler.shouldSkipPreclaimLimitedCampaign(zaloAccount(), blocked({ id: 13 })), true)
  })

  await check('đồng hồ lùi hoặc hết hạn thì bỏ entry', async () => {
    const { fake, scheduler } = skipHarness()
    scheduler.rememberPreclaimLimitSkip(zaloAccount(), blocked(), { ok: false, retryAfterMs: 3_600_000 })
    scheduler.rememberPreclaimLimitSkip(zaloAccount(), blocked({ id: 20 }), { ok: false, retryAfterMs: 60_000 })
    fake.clock.now -= 3_600_000
    assert.equal(scheduler.shouldSkipPreclaimLimitedCampaign(zaloAccount(), blocked()), false)
    fake.clock.now += 3_600_000 + 60_000
    scheduler.prunePreclaimLimitSkips()
    assert.equal(scheduler.preclaimLimitSkips.size, 0)
  })

  await check('hàng đợi tài khoản không đọc DB cho chiến dịch đang được bỏ qua', async () => {
    const fake = fakeClock()
    const Scheduler = load(`${topLevel(schedulerSource, 'PRECLAIM_LIMIT_RECHECK_MAX_MS')}
class Scheduler {
  preclaimLimitSkips = new Map()
  ${method('getPreclaimLimitAccountKey')}
  ${method('rememberPreclaimLimitSkip')}
  ${method('shouldSkipPreclaimLimitedCampaign')}
  ${method('runAccountCampaignQueue')}
}
module.exports = Scheduler`, { Date: fake.Date })
    const reads = []
    const executed = []
    const rows = new Map([[10, blocked({ status: 'chờ xử lý' })], [11, { id: 11, accountId: 2, status: 'chờ xử lý', updatedAt: 'u2' }]])
    const scheduler = Object.assign(new Scheduler(), {
      running: true,
      runtimeCampaignByAccount: new Map(),
      boundaryStoppedAccountQueues: new Set(),
      activeCampaignRunUnits: new Set(),
      webEnrichment: null,
      getReadyRuntimeClock: async () => ({ dbNow: new Date(fake.clock.now).toISOString() }),
      shouldProcessAccountForRuntime: () => true,
      isRealtimeCampaignDisabledForRuntime: () => false,
      isWithinCampaignDispatchSchedule: () => true,
      hasFailedAccountRun: () => false,
      executeCampaign: async (_account, campaign) => { executed.push(campaign.id) },
      supabase: { getCampaign: async id => { reads.push(id); return { ...rows.get(id), isDelete: false } } }
    })
    const account = zaloAccount()
    scheduler.rememberPreclaimLimitSkip(account, blocked(), { ok: false, retryAfterMs: 3_600_000 })
    await scheduler.runAccountCampaignQueue(account, [blocked(), rows.get(11)])
    assert.deepEqual(reads, [11])
    assert.deepEqual(executed, [11])
    reads.length = 0
    executed.length = 0
    await scheduler.runAccountCampaignQueue(account, [blocked({ updatedAt: 'edited' }), rows.get(11)])
    assert.deepEqual(reads, [10, 11])
    assert.deepEqual(executed, [10, 11])
  })

  await check('chỉ ghi nhớ khi note hạn mức đã khớp (không lưu khi vừa ghi note mới)', async () => {
    const text = method('executeCampaignWithResultContext')
    const steady = /if \(String\(campaign\.note \|\| ''\)\.trim\(\) === preclaimLimitNote\.trim\(\)\) \{\s*this\.rememberPreclaimLimitSkip\(account, campaign, preclaimLimitStatus\)\s*return\s*\}\s*await this\.updateUnclaimedCampaignPreflightNote\(campaign, preclaimLimitNote\)/
    assert.match(text, steady)
    assert.equal((text.match(/rememberPreclaimLimitSkip/g) || []).length, 1)
  })

  // 4. Một câu tra chiến dịch đến hạn cho mọi tài khoản của tick.
  function repositoryHarness(rows, now = '2026-11-10T04:00:00.000Z') {
    const calls = []
    const query = {}
    for (const name of ['select', 'in', 'eq', 'not', 'lte', 'or', 'order', 'limit']) {
      query[name] = (...args) => { calls.push([name, ...args]); return query }
    }
    query.then = (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject)
    const exported = load(`${topLevel(repositorySource, 'SMS_SEND_ACTION_ID')}
${topLevel(repositorySource, 'VOICE_CALL_ACTION_ID')}
${topLevel(repositorySource, 'MOBILE_MANAGED_SMS_ACTION_IDS')}
${topLevel(repositorySource, 'parseDatabaseNow')}
${topLevel(repositorySource, 'PENDING_CAMPAIGNS_BATCH_ROW_LIMIT')}
${topLevel(repositorySource, 'PENDING_CAMPAIGNS_BATCH_MAX_ACCOUNTS')}
${topLevel(repositorySource, 'getPendingCampaigns')}
${topLevel(repositorySource, 'getPendingCampaignsForAccounts')}`, {
      CAMPAIGN_SELECT: '*',
      requireCurrentUser: () => ({ staffId: 7 }),
      mapCampaignFromDB: row => ({ id: row.id, accountId: row.account_id }),
      formatVietnamTimeForQuery: date => new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(11, 19),
      client: () => ({ from: table => { calls.push(['from', table]); return query } })
    })
    return { calls, exported, now }
  }

  await check('câu gộp giữ nguyên bộ lọc/thứ tự của câu từng tài khoản', async () => {
    const one = repositoryHarness([])
    await one.exported.getPendingCampaigns(2, one.now)
    const many = repositoryHarness([])
    await many.exported.getPendingCampaignsForAccounts([2, 3, 2], many.now)
    const normalize = calls => calls.filter(call => !(call[0] === 'eq' && call[1] === 'account_id')
      && !(call[0] === 'in' && call[1] === 'account_id') && call[0] !== 'limit')
    same(normalize(many.calls), normalize(one.calls))
    same(one.calls.find(call => call[1] === 'account_id'), ['eq', 'account_id', 2])
    same(many.calls.find(call => call[1] === 'account_id'), ['in', 'account_id', [2, 3]])
    same(many.calls.at(-1), ['limit', 500])
  })

  await check('kết quả chia đúng theo tài khoản và giữ thứ tự', async () => {
    const rows = [
      { id: 5, account_id: 3 }, { id: 1, account_id: 2 }, { id: 9, account_id: 3 }, { id: 4, account_id: 2 }
    ]
    const { exported, now } = repositoryHarness(rows)
    const map = await exported.getPendingCampaignsForAccounts([2, 3, 4], now)
    same(map.get(2).map(c => c.id), [1, 4])
    same(map.get(3).map(c => c.id), [5, 9])
    same(map.get(4), [])
  })

  await check('trang đầy (có thể bị cắt) hoặc quá 200 tài khoản thì trả null để đọc từng tài khoản', async () => {
    const full = repositoryHarness(Array.from({ length: 500 }, (_, i) => ({ id: i + 1, account_id: 2 })))
    assert.equal(await full.exported.getPendingCampaignsForAccounts([2, 3], full.now), null)
    const many = repositoryHarness([])
    assert.equal(await many.exported.getPendingCampaignsForAccounts(Array.from({ length: 201 }, (_, i) => i + 1), many.now), null)
    assert.equal(many.calls.length, 0)
  })

  await check('23:59 giờ VN trả rỗng, không gọi DB (giống câu từng tài khoản)', async () => {
    const late = repositoryHarness([], '2026-11-10T16:59:30.000Z')
    const map = await late.exported.getPendingCampaignsForAccounts([2, 3], late.now)
    assert.deepEqual([...map.keys()], [2, 3])
    assert.equal(late.calls.length, 0)
  })

  await check('tick chỉ gộp khi có từ 2 tài khoản cần đọc; lỗi thì quay về đọc từng tài khoản', async () => {
    const Scheduler = load(`class Scheduler { ${method('loadPendingCampaignsForTick')} }
module.exports = Scheduler`, {})
    const batchCalls = []
    let failNext = false
    const scheduler = Object.assign(new Scheduler(), {
      shouldProcessAccountForRuntime: account => account.server === true,
      isSmsAccount: account => account.flatformType === 'sms',
      supabase: {
        getPendingCampaignsForAccounts: async (ids, dbNow) => {
          batchCalls.push([ids, dbNow])
          if (failNext) throw new Error('boom')
          return new Map(ids.map(id => [id, []]))
        }
      }
    })
    const now = '2026-11-10T04:00:00.000Z'
    assert.equal(await scheduler.loadPendingCampaignsForTick([{ id: 1, server: true }, { id: 2, server: false }], now), null)
    assert.equal(batchCalls.length, 0)
    const accounts = [
      { id: 1, server: true, flatformType: 'zalo' },
      { id: 2, server: true, flatformType: 'sms' },
      { id: 3, server: false, flatformType: 'zalo' },
      { id: 4, server: true, flatformType: 'zalo' }
    ]
    const map = await scheduler.loadPendingCampaignsForTick(accounts, now)
    same(batchCalls, [[[1, 4], now]])
    assert.deepEqual([...map.keys()], [1, 4])
    failNext = true
    const originalError = console.error
    console.error = () => {}
    try {
      assert.equal(await scheduler.loadPendingCampaignsForTick(accounts, now), null)
    } finally {
      console.error = originalError
    }
    const tickText = method('tick')
    assert.match(tickText, /pendingByAccount\?\.get\(account\.id\)\s*\?\? await this\.supabase\.getPendingCampaigns\(account\.id, accountClock\.dbNow\)/)
    assert.match(tickText, /if \(claimEnableDueAccountActionsSlot\(\)\) \{/)
  })

  for (const name of results) console.log(`ok - ${name}`)
  console.log(`${results.length}/${results.length} passed`)
})().catch(error => {
  console.error(error)
  process.exit(1)
})

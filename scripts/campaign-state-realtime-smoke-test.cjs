// Real notification/lifecycle methods with isolated DB adapters; no sessions or sends.
// Run: node scripts/campaign-state-realtime-smoke-test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const IPC_EVENTS = { CAMPAIGN_STATUS_UPDATED: 'campaign:status-updated', ACCOUNT_STATUS_UPDATED: 'account:status-updated' }
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function methods(file, className, names, globals) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className)
  const body = names.map(name => {
    const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
    assert.ok(method, name)
    return method.getText(source)
  }).join('\n')
  return new Function(...Object.keys(globals), compile(`class Harness { ${body} }`) + '; return Harness')(...Object.values(globals))
}
const format = {}
new Function('exports', compile(fs.readFileSync(path.join(root, 'src/shared/campaignLogFormat.ts'), 'utf8')))(format)
const Scheduler = methods('src/main/services/campaignScheduler.ts', 'CampaignScheduler', [
  'logCampaignProgress', 'broadcastCampaignUpdate', 'broadcastClaimedRuntimeState',
  'updateCampaignAndBroadcast', 'updateRunningCampaignAndBroadcast', 'updateAccountAndBroadcast',
  'completePauseAtBoundary', 'completeCampaignPause', 'releaseRunningAccount',
  'transitionCampaignToCompleted', 'updateUnclaimedCampaignPreflightNote',
  'updateErrorPolicyCampaign', 'updateErrorPolicyAccount', 'requestPauseCampaign'
], { IPC_EVENTS, recordCampaignState() {}, recordAccountLog() {}, CAMPAIGN_PAUSE_PENDING_NOTE: 'pending pause', ...format })
const GroupManager = methods('src/main/services/zaloRealtimeGroupCampaignManager.ts', 'ZaloRealtimeGroupCampaignManager', [
  'enqueueEvent', 'isActiveGeneration', 'broadcastReceivedCampaign',
  'logRealtimeReceiveHistory', 'broadcastCampaign', 'getErrorMessage'
], { IPC_EVENTS, getTriggerLabel: () => 'fixture trigger' })

function fixture(runtimeTarget = 'server') {
  const campaign = { id: 10, accountId: 20, name: 'Fixture', accountName: 'Account', status: 'đang chạy', note: null, updatedAt: 'initial', schedule: null, lastRunAt: null }
  const account = { id: 20, flatformType: 'zalo', status: 'đang chạy', loginStatus: 'đã đăng nhập' }
  const events = [], writes = []
  const update = async (row, patch) => {
    Object.assign(row, patch)
    writes.push({ ...patch })
    return { ...row }
  }
  const mainWindow = { isDestroyed: () => false, webContents: { send: (channel, payload) => events.push({ channel, payload, writes: writes.length }) } }
  const supabase = {
    getCampaign: async () => ({ ...campaign }), getAccount: async () => ({ ...account }),
    appendCampaignLog: async () => update(campaign, { updatedAt: `log-${writes.length}` }),
    updateCampaign: async (_id, patch) => update(campaign, patch),
    updateClaimedZaloServerCampaign: async (_id, patch) => update(campaign, patch),
    updateRunningDesktopCampaign: async (_id, patch) => update(campaign, patch),
    updateAccount: async (_id, patch) => update(account, patch),
    updateClaimedZaloServerAccount: async (_id, patch) => update(account, patch),
    updatePendingUnclaimedCampaignNote: async (_id, _version, note) => update(campaign, { note }),
    setZaloServerCampaignStatus: async (_id, status) => { await update(campaign, { status }); return { ok: true } },
    releaseZaloAccountRuntimeOperation: async () => { await update(account, { status: 'chờ xử lý' }); return true },
    getZaloServerRunControlState: async () => ({ campaignStatus: campaign.status, accountStatus: account.status }),
    finalizeCampaign: async () => { await update(campaign, { status: 'hoàn thành' }); return { completed: true } }
  }
  const scheduler = Object.assign(new Scheduler(), {
    runtimeTarget, supabase, mainWindow,
    sendLog: (message, _action, context) => events.push({ channel: 'campaign:log', payload: { message, ...context } }),
    claimedServerZaloCampaignIds: new Set(runtimeTarget === 'server' ? [10] : []),
    claimedServerZaloAccountIds: new Set(runtimeTarget === 'server' ? [20] : []),
    facebookPageIdentities: new Map(), pauseRequests: new Set(), serverZaloPauseBoundaries: new Map(), failedCampaignRuns: new Map(),
    restoreFacebookPageIdentity: async () => {}, settleActiveCampaignRunUnit: async () => true,
    isServerZaloCampaign: () => runtimeTarget === 'server',
    rememberFailedCampaignRun: (_account, _campaign, error) => { throw error },
    finalizeClaimedServerZaloCampaign: async () => {
      const finalized = await supabase.finalizeCampaign()
      return { finalized, campaign: { ...campaign } }
    }
  })
  return { campaign, account, scheduler, supabase, mainWindow, events, writes }
}
const states = f => f.events.filter(event => event.channel === IPC_EVENTS.CAMPAIGN_STATUS_UPDATED)
const accountStates = f => f.events.filter(event => event.channel === IPC_EVENTS.ACCOUNT_STATUS_UPDATED)

function groupFixture(runtimeTarget = 'server') {
  const f = fixture(runtimeTarget)
  f.campaign.schedule = '2026-09-29T01:00:00Z'
  const item = { campaign: { ...f.campaign }, accountId: 20, groupNamesById: new Map() }
  const enqueued = []
  let readCount = 0
  let inserted = true
  Object.assign(f.supabase, {
    getRuntimeClock: async () => ({ dbNow: '2026-09-28T01:00:00Z', vietnamDateKey: '2026-09-28' }),
    enqueueZaloRealtimeGroupEvent: async request => { enqueued.push(request); return { inserted } },
    getCampaign: async () => { readCount++; return { ...f.campaign } }
  })
  const manager = Object.assign(new GroupManager(), {
    runtimeTarget, supabase: f.supabase, mainWindow: f.mainWindow, generation: 1, running: true,
    isReceivingWindowActive: () => true,
    getNextInputSchedule: () => new Date('2026-09-29T01:00:00Z')
  })
  const receive = () => manager.enqueueEvent(item, {
    groupId: 'fixture', trigger: 'join', targetUid: `target-${enqueued.length}`, targetName: 'Fixture', rawPayload: {}
  })
  return { ...f, item, manager, enqueued, receive, reads: () => readCount, duplicate: () => { inserted = false } }
}

async function verifyGroupReceipts() {
  const f = groupFixture()
  const originalConfig = JSON.stringify(f.item.campaign)
  for (let i = 0; i < 30; i++) await f.receive()
  assert.equal(f.enqueued.length, 30, 'every input still reaches the existing RPC')
  assert.equal(f.writes.length, 30, 'every receipt still persists its log')
  assert.equal(f.reads(), 30, 'no new reads for notification comparisons')
  assert.equal(states(f).length, 0, 'input count and updatedAt alone must not invalidate Server UI')

  let expected = 0
  for (const patch of [
    { schedule: '2026-09-30T01:00:00Z' }, { status: 'chờ xử lý' },
    { note: 'Fixture note' }, { lastRunAt: '2026-09-28T02:00:00Z' },
    { note: null }, { schedule: null }, { lastRunAt: null }
  ]) {
    Object.assign(f.campaign, patch)
    await f.receive()
    expected++
    assert.equal(states(f).length, expected, `notify committed change ${JSON.stringify(patch)}`)
    for (const [key, value] of Object.entries(patch)) assert.equal(states(f).at(-1).payload[key], value)
    await f.receive()
    await f.receive()
    assert.equal(states(f).length, expected, 'compare with the last receipt, not the stale config')
  }
  assert.equal(JSON.stringify(f.item.campaign), originalConfig, 'UI baseline must never mutate receiving config')

  // Concurrent callbacks observing the same committed row still publish once.
  Object.assign(f.campaign, { status: 'đang chạy' })
  await Promise.all([f.receive(), f.receive(), f.receive()])
  assert.equal(states(f).length, ++expected)

  const reads = f.reads()
  f.duplicate()
  await f.receive()
  assert.equal(f.reads(), reads, 'duplicate handling still skips the full campaign read')
  assert.equal(states(f).length, expected)

  const desktop = groupFixture('desktop')
  for (let i = 0; i < 3; i++) await desktop.receive()
  assert.equal(states(desktop).length, 6, 'Desktop retains both log and inserted-input notifications')
  assert.equal(desktop.item.lastReceivedState, undefined)

  const stopped = groupFixture()
  let resolveRead, enteredRead
  const reading = new Promise(resolve => { enteredRead = resolve })
  stopped.supabase.getCampaign = () => {
    enteredRead()
    return new Promise(resolve => { resolveRead = resolve })
  }
  const pending = stopped.receive()
  await reading
  stopped.manager.generation++
  resolveRead({ ...stopped.campaign, status: 'chờ xử lý' })
  await pending
  assert.equal(states(stopped).length, 0, 'ignore a late read from a stopped/replaced generation')
  assert.equal(stopped.item.lastReceivedState, undefined)
}

async function main() {
  // Per-target progress bursts still persist and stream logs, with no Server list invalidation.
  for (const target of ['server', 'desktop']) {
    const f = fixture(target)
    for (let i = 0; i < 30; i++) await f.scheduler.logCampaignProgress(f.campaign, `Progress ${i}`)
    assert.equal(f.writes.length, 30)
    assert.equal(f.events.filter(event => event.channel === 'campaign:log').length, 30)
    assert.equal(states(f).length, target === 'server' ? 0 : 30)
    assert.equal(accountStates(f).length, 0)
    await f.scheduler.logCampaignProgress(f.campaign, 'stored only', { emitRealtime: false })
    assert.equal(f.events.filter(event => event.channel === 'campaign:log').length, 30)
    assert.equal(states(f).length, target === 'server' ? 0 : 31)
    const group = Object.assign(new GroupManager(), { runtimeTarget: target, supabase: f.supabase, mainWindow: f.mainWindow })
    const before = states(f).length
    for (const inserted of [false, true]) {
      await group.logRealtimeReceiveHistory({ campaign: f.campaign, groupNamesById: new Map() },
        { groupId: 'fixture', trigger: 'join', targetUid: 'fixture', targetName: 'Fixture', rawPayload: {} }, inserted)
    }
    assert.equal(states(f).length - before, target === 'server' ? 0 : 2)
  }

  const started = fixture()
  await started.scheduler.broadcastClaimedRuntimeState(10)
  assert.equal(states(started)[0].payload.status, 'đang chạy')
  assert.equal(accountStates(started).length, 1)

  for (const scenario of ['pause', 'account pause', 'complete', 'error', 'reschedule', 'preflight', 'resume']) {
    const f = fixture()
    if (scenario === 'pause') {
      await f.scheduler.requestPauseCampaign(10)
      await f.scheduler.completePauseAtBoundary(f.account, f.campaign)
    } else if (scenario === 'account pause') {
      await f.scheduler.updateAccountAndBroadcast(20, { status: 'tạm dừng' })
      await f.scheduler.completePauseAtBoundary(f.account, f.campaign)
    } else if (scenario === 'complete') {
      assert.equal(await f.scheduler.transitionCampaignToCompleted(f.campaign), true)
      await f.scheduler.releaseRunningAccount(20)
    } else if (scenario === 'error') {
      await f.scheduler.updateErrorPolicyAccount(f.account, f.campaign, { loginStatus: 'chưa đăng nhập' })
      await f.scheduler.updateErrorPolicyCampaign(f.campaign, { status: 'tạm dừng', note: 'Fixture error' })
    } else if (scenario === 'reschedule') {
      await f.scheduler.updateRunningCampaignAndBroadcast(10, { status: 'chờ xử lý', note: null, schedule: '2026-09-29T01:00:00Z' })
    } else if (scenario === 'preflight') {
      f.campaign.status = 'chờ xử lý'
      await f.scheduler.updateUnclaimedCampaignPreflightNote(f.campaign, 'Fixture limit')
    } else {
      f.campaign.status = 'tạm dừng'
      await f.scheduler.updateCampaignAndBroadcast(10, { status: 'chờ xử lý', note: null })
    }
    assert.ok(states(f).length > 0, scenario)
    assert.equal(states(f).at(-1).payload.status, f.campaign.status, scenario)
    assert.equal(states(f).at(-1).payload.note, f.campaign.note, scenario)
    assert.equal(states(f).at(-1).payload.schedule, f.campaign.schedule, scenario)
    assert.ok(states(f).every(event => event.writes > 0), `${scenario}: publish after commit`)
    const before = states(f).length
    await f.scheduler.logCampaignProgress(f.campaign, 'Lifecycle log')
    assert.equal(states(f).length, before, `${scenario}: no duplicate state from log`)
  }
  await verifyGroupReceipts()
  console.log('PASS: Server progress logs and full group receipts, changed UI states only, generation fencing, Desktop compatibility, committed campaign/account lifecycle notifications')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

// Run: node scripts/campaign-failure-cleanup-smoke-test.cjs
// Load the entire real scheduler with local adapters. No network/session/send.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
let clock
// Drain the complete promise chain before moving the fake retry clock.
const flush = () => new Promise(resolve => setImmediate(resolve))
function fakeClock() {
  let now = 0, next = 0
  const tasks = new Map()
  return {
    tasks,
    get now() { return now },
    set(fn, ms) { const id = ++next; tasks.set(id, { fn, at: now + ms }); return id },
    clear(id) { tasks.delete(id) },
    async advance(ms) {
      now += ms
      for (const [id, task] of [...tasks]) if (task.at <= now) { tasks.delete(id); task.fn() }
      await flush()
    }
  }
}
function load(relative, overrides = {}) {
  const file = path.join(root, relative)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports = {}
  function Stub() {}
  const imports = new Proxy({}, { get: (_, key) => {
    if (key === 'getCurrentUser') return () => ({ staffId: 625, organizationId: 604 })
    if (key === 'getErrorMessage') return error => error?.message || String(error)
    if (key === 'IPC_EVENTS' || key === 'IPC_EVENTS_V2') return new Proxy({}, { get: (_, k) => k })
    return Stub
  } })
  vm.runInNewContext(code, {
    exports, require: name => overrides[name] || (['crypto', 'fs', 'os', 'path'].includes(name) ? require(name) : imports),
    AbortController, console: { warn() {}, error() {}, log() {} },
    setTimeout: (fn, ms) => clock.set(fn, ms), clearTimeout: id => clock.clear(id),
    setInterval: () => -1, clearInterval() {}, queueMicrotask, Buffer, URL
  }, { filename: file })
  return exports
}
const cleanupModule = load('src/main/services/campaignFailureCleanup.ts')
const { CampaignScheduler } = load('src/main/services/campaignScheduler.ts', { './campaignFailureCleanup': cleanupModule })
const parent = '10000000-0000-4000-8000-000000000001'
const unit = '20000000-0000-4000-8000-000000000001'
const temporary = () => Object.assign(new Error('schema cache unavailable'), { code: 'PGRST002' })
function fixture(target = 'desktop') {
  clock = fakeClock()
  const stats = { claims: 0, policy: 0, cleanup: 0, settle: 0, sends: 0, details: 0, logs: [], payloads: [] }
  const account = { id: 1, staffId: 625, organizationId: 604, name: 'fixture', flatformType: target === 'server' ? 'zalo' : 'facebook', isZaloServer: target === 'server' }
  const campaign = { id: 2, accountId: 1, staffId: 625, organizationId: 604, name: 'fixture', actionId: 'facebook_message_uid', status: 'chờ xử lý', extraSettings: {} }
  const db = {
    getCampaign: async () => campaign,
    getCampaignAction: async () => ({}),
    claimCampaignRuntimeV2: async (_c, _a, _t, token) => {
      stats.claims++
      return { ok: true, runtimeClaimToken: token, runtimeClaimVietnamDateKey: '2026-09-09', vietnamDateKey: '2026-09-09', dbNow: '2026-09-09T01:00:00Z' }
    },
    getErrorPolicy: async () => { stats.policy++; throw temporary() },
    cleanupFailedCampaignRuntime: async payload => { stats.cleanup++; stats.payloads.push(payload); return { ok: true, reason: 'cleaned' } },
    settleCampaignRunUnitV2: async () => { stats.settle++; return { ok: true } },
    createCampaignDetail: async () => { stats.details++; throw temporary() }
  }
  const scheduler = new CampaignScheduler(db, {}, { webContents: { send() {} } }, undefined, undefined, undefined, { runtimeTarget: target })
  Object.assign(scheduler, {
    running: true,
    getCampaignPreclaimLimitStatus: async () => null,
    createCampaignRunBoundary: (_c, token) => ({ runtimeClaimToken: token, claimedVietnamDateKey: '2026-09-09' }),
    checkCampaignRunBoundaryWithClock: () => ({}),
    stopCampaignAtRunBoundaryIfNeeded: async () => false,
    getServerZaloBoundaryReason: async () => ({}),
    getAccountRunBlockReason: async () => null,
    getFindDataSourceWaitNote: async () => null,
    resolveCampaignWorkflow: () => ({ workflowId: 1 }),
    prepareZaloRealtimeGroupCampaignRun: async () => true,
    getCampaignExecutableActionDescriptors: () => [], getCampaignActionDescriptors: () => [],
    ensureZaloSessionReadyForCampaign: async () => true,
    logCampaignProgress: async () => {}, sendLog: message => stats.logs.push(message),
    reconcileMaintenanceAfterSettledRun: async () => {},
    isNewsfeedDailyCampaign: () => false,
    executeCampaignV2: async () => {},
    getAutomationPage: async () => ({ page: {}, source: 'visible' }),
    createBlockRuntimeHelpers: () => ({}), normalizeRuntimeError: () => ({ errorCode: 'err_undefined' }),
    stopAllBackgroundPreviews() {}, backgroundPages: { destroyAll() {} }
  })
  function lease(ids = [10, 11]) {
    scheduler.campaignRunBoundaries.set(2, { runtimeClaimToken: parent, claimedVietnamDateKey: '2026-09-09' })
    scheduler.activeCampaignRunUnits.set(2, { runtimeUnitToken: unit, inputDataIds: ids, unstartedInputDataIds: new Set(ids), externalWorkStarted: false, aggregateOutcomeUnknown: false, requeueRemainingOnSettle: true })
  }
  return { scheduler, db, stats, account, campaign, lease }
}

async function verifyExecutorPauseBranches() {
  const branches = ['initial', 'zalo-friends', 'zalo-birthday', 'zalo-recommendations', 'zalo-sent-requests', 'facebook-suggested', 'invite-before-batch', 'invite-after-batch']
  for (const branch of branches) {
    for (const failure of ['none', 'update', 'commit-response']) {
      const f = fixture()
      const label = `${branch}/${failure}`
      const order = []
      let reachedPause = false, accountToken, ownerToken
      const isInvite = branch.startsWith('invite-')
      const details = [{ id: 10, uid: '111111', name: 'fixture target', status: 'chờ xử lý' }]
      if (branch.startsWith('zalo-')) {
        f.account.flatformType = 'zalo'
        f.campaign.actionId = 'zalo_message_friend'
      }
      if (isInvite) f.campaign.extraSettings.facebookGroupInviteTargetGroupUrl = 'https://www.facebook.com/groups/fixture'
      const requestPause = () => {
        reachedPause = true
        order.push('request-pause')
        f.scheduler.pauseRequests.add(2)
        return details
      }
      Object.assign(f.scheduler, {
        // Keep the entire dispatch/executor/pause control flow real. Only
        // data-loading and external batch work use deterministic adapters.
        executeCampaignV2: CampaignScheduler.prototype.executeCampaignV2.bind(f.scheduler),
        shouldMaterializeZaloFriendInputData: () => branch === 'zalo-friends',
        materializeZaloFriendInputData: async () => requestPause(),
        isZaloBirthdayCampaign: () => branch === 'zalo-birthday',
        shouldMaterializeZaloBirthdayInputData: () => branch === 'zalo-birthday',
        materializeZaloBirthdayInputData: async () => requestPause(),
        shouldMaterializeZaloFriendRecommendationInputData: () => branch === 'zalo-recommendations',
        materializeZaloFriendRecommendationInputData: async () => requestPause(),
        shouldMaterializeZaloCancelSentFriendRequestInputData: () => branch === 'zalo-sent-requests',
        materializeZaloCancelSentFriendRequestInputData: async () => requestPause(),
        isZaloFriendAutoDataCampaign: () => false,
        isZaloFriendRecommendationCampaign: () => false,
        isZaloCancelSentFriendRequestCampaign: () => false,
        shouldUseSuggestedFriends: () => branch === 'facebook-suggested',
        collectSuggestedFriendInputData: async () => requestPause(),
        getDatabaseBusinessNow: async () => new Date('2026-09-09T01:00:00Z'),
        loadZaloFriendBlocklistContext: async () => null,
        isFormattedContentCampaign: () => false,
        shouldUseZaloShareMessageBatch: () => false,
        shouldUseFacebookGroupInviteBatch: () => isInvite,
        getCampaignExecutableActionDescriptors: () => [{ code: 'fb_group_invite', name: 'Invite' }],
        getFacebookGroupInviteBatchCapacity: async () => ({ ok: true, capacity: 2 }),
        finalizeDataGroupCampaignAtHardEnd: async () => {
          if (branch === 'invite-before-batch') requestPause()
          return false
        },
        stopCampaignBeforeNewUnitIfNeeded: async () => false,
        runFacebookGroupInviteBatch: async () => {
          assert.equal(branch, 'invite-after-batch', label)
          requestPause()
          return { stop: true, paused: true }
        },
        updateCampaignAndBroadcast: async (_id, updates) => {
          order.push('pause-update')
          assert.ok(reachedPause, `${label}: reached the intended pause branch`)
          assert.equal(updates.status, 'tạm dừng', label)
          if (failure !== 'update') Object.assign(f.campaign, updates)
          if (failure !== 'none') throw temporary()
          return f.campaign
        },
        releaseRunningAccount: async () => {
          order.push('release')
          // Model another campaign acquiring the account immediately.
          accountToken = 'next-owner'
        }
      })
      f.db.listCampaignInputData = async () => {
        if (branch === 'initial') requestPause()
        return isInvite ? details : []
      }
      f.db.claimCampaignRuntimeV2 = async (_c, _a, _target, token) => {
        ownerToken = accountToken = token
        f.stats.claims++
        f.campaign.status = 'đang chạy'
        return { ok: true, runtimeClaimToken: token, runtimeClaimVietnamDateKey: '2026-09-09', vietnamDateKey: '2026-09-09', dbNow: '2026-09-09T01:00:00Z' }
      }
      f.db.cleanupFailedCampaignRuntime = async payload => {
        order.push('cleanup'); f.stats.cleanup++
        assert.equal(accountToken, ownerToken, `${label}: account cannot be released before cleanup`)
        assert.equal(payload.runtimeClaimToken, ownerToken, label)
        assert.equal(payload.campaignStatus, 'tạm dừng', label)
        if (f.campaign.status === 'đang chạy') f.campaign.status = payload.campaignStatus
        accountToken = null
        return { ok: true, reason: 'cleaned' }
      }
      await f.scheduler.executeCampaign(f.account, f.campaign)
      assert.ok(reachedPause, label)
      assert.equal(f.campaign.status, 'tạm dừng', label)
      assert.deepEqual(order, ['request-pause', 'pause-update', failure === 'none' ? 'release' : 'cleanup'], label)
      assert.equal(f.stats.cleanup, failure === 'none' ? 0 : 1, label)
      assert.equal(f.stats.policy, failure === 'none' ? 0 : 1, `${label}: policy failure cannot skip cleanup`)
      assert.equal(f.scheduler.failedCampaignRuns.size, 0, label)
      assert.equal(clock.tasks.size, 0, label)
    }
  }
}

async function verifyNestedPauseFailureHandoff() {
  for (const scenario of ['unit-claim-pause', 'daily-boundary-pause']) {
    const f = fixture()
    let unitCalls = 0, pauseWrites = 0, releases = 0
    const details = [{ id: 10, uid: '111111', name: 'target', status: 'chờ xử lý' }]
    f.campaign.extraSettings.facebookGroupInviteTargetGroupUrl = 'https://www.facebook.com/groups/fixture'
    // Exercise the real batch loop, unit claim, boundary/pause helpers and
    // nested catches. External work must never start in these pause races.
    f.scheduler.executeCampaignV2 = async () => f.scheduler.executeFacebookGroupInviteBatchCampaign(
      f.account, f.campaign, 1, details, [{ code: 'fb_group_invite', name: 'Invite' }], []
    )
    f.scheduler.finalizeDataGroupCampaignAtHardEnd = async () => false
    f.scheduler.getFacebookGroupInviteBatchCapacity = async () => ({ ok: true, capacity: 1 })
    f.db.listCampaignInputData = async () => details
    f.db.checkCampaignDailyBoundary = async () => {
      if (scenario === 'unit-claim-pause') return { allowNewUnit: true }
      f.scheduler.pauseRequests.add(2)
      return { allowNewUnit: false, reason: 'daily_drain_due', dbNow: '2026-09-09T16:59:00Z', vietnamDateKey: '2026-09-09' }
    }
    f.db.claimCampaignRunUnitV2 = async (_c, _a, _target, claimToken, dateKey, unitToken, ids) => {
      assert.equal(scenario, 'unit-claim-pause')
      if (++unitCalls === 1) throw temporary() // Commit succeeded, response lost.
      return {
        ok: true, reason: 'already_claimed', claimedCount: ids.length,
        runtimeUnitToken: unitToken, runtimeUnitVietnamDateKey: dateKey,
        runtimeClaimToken: claimToken, runtimeClaimVietnamDateKey: dateKey,
        campaignStatus: 'đang chạy', accountStatus: 'tạm dừng',
        dbNow: '2026-09-09T01:00:00Z', vietnamDateKey: dateKey
      }
    }
    f.scheduler.updateCampaignAndBroadcast = async (_id, updates) => {
      if (++pauseWrites === 1) throw temporary()
      // Previously the boundary catch repeated this write, masking failure.
      return Object.assign(f.campaign, updates)
    }
    // Previously the inner batch catch successfully consumed the pause error,
    // leaving a deferred policy update whose cleanup had never been started.
    f.db.createCampaignDetail = async () => { f.stats.details++; return { id: 1 } }
    f.scheduler.releaseRunningAccount = async () => { releases++ }
    f.scheduler.engineV2.run = async () => { assert.fail('paused batch must not send') }
    f.db.cleanupFailedCampaignRuntime = async payload => {
      f.stats.cleanup++; f.stats.payloads.push(payload)
      assert.equal(payload.runtimeClaimToken, f.scheduler.campaignRunBoundaries.get(2).runtimeClaimToken)
      assert.equal(payload.runtimeUnitToken, null, 'unstarted unit already settled before pause')
      if (scenario === 'daily-boundary-pause') assert.equal(payload.campaignStatus, 'tạm dừng')
      if (f.stats.cleanup === 1) throw temporary()
      return { ok: true, reason: 'cleaned' }
    }
    const execution = f.scheduler.executeCampaign(f.account, f.campaign)
    await flush()
    if (scenario === 'unit-claim-pause') {
      assert.equal(unitCalls, 1)
      await clock.advance(2000)
    }
    assert.equal(f.stats.cleanup, 1, `${scenario}: latched failure must reach outer cleanup`)
    assert.equal(f.stats.details, 0, `${scenario}: inner handler cannot consume a cleanup failure`)
    assert.equal(pauseWrites, 1, `${scenario}: no fallback pause after handoff`)
    assert.equal(releases, 0, `${scenario}: only atomic cleanup may release the account`)
    assert.equal(f.stats.policy, 1, `${scenario}: outer policy failure still reaches cleanup`)
    assert.equal(f.scheduler.tryReserveExternalAccount(1), false)
    await clock.advance(1999); assert.equal(f.stats.cleanup, 1)
    await clock.advance(1); await execution
    assert.equal(f.stats.cleanup, 2)
    assert.strictEqual(f.stats.payloads[0], f.stats.payloads[1])
    assert.equal(f.stats.settle, scenario === 'unit-claim-pause' ? 1 : 0)
    assert.equal(f.scheduler.failedCampaignRuns.size, 0)
    assert.equal(clock.tasks.size, 0)
    assert.equal(pauseWrites, 1)
    assert.equal(releases, 0)
  }

  // A guard read failure without a latched cleanup retains its old fallback.
  const guard = fixture(); guard.lease()
  let yields = 0
  guard.db.checkCampaignDailyBoundary = async () => { throw temporary() }
  guard.scheduler.yieldCampaignAtRunBoundary = async () => { yields++; return true }
  assert.equal(await guard.scheduler.stopCampaignBeforeNewUnitIfNeeded(guard.account, guard.campaign), true)
  assert.equal(yields, 1)
  assert.equal(guard.scheduler.failedCampaignRuns.size, 0)

  // Ordinary batch errors still use the original policy and normal settlement.
  const batch = fixture()
  batch.scheduler.beginCampaignRunUnit = async () => { batch.lease([10]); return true }
  batch.scheduler.engineV2.run = async () => ({ status: 'failed', steps: [], error: 'form failed' })
  batch.db.createCampaignDetail = async () => { batch.stats.details++; return { id: 1 } }
  batch.scheduler.updateCampaignAndBroadcast = async (_id, updates) => Object.assign(batch.campaign, updates)
  const outcome = await batch.scheduler.runFacebookGroupInviteBatch(batch.account, batch.campaign, 1, [{ inputDataId: 10 }], { code: 'fb_group_invite', name: 'Invite' }, {})
  assert.equal(outcome.stop, true)
  assert.equal(batch.stats.details, 1)
  assert.equal(batch.campaign.status, 'tạm dừng')
  assert.equal(batch.stats.settle, 1)
  assert.equal(batch.stats.cleanup, 0)
  assert.equal(batch.scheduler.failedCampaignRuns.size, 0)
}

async function run() {
  await verifyNestedPauseFailureHandoff()
  await verifyExecutorPauseBranches()
  for (const target of ['desktop', 'server']) {
    let f = fixture(target)
    await f.scheduler.executeCampaign(f.account, f.campaign)
    assert.equal(f.stats.claims, 1)
    assert.equal(f.stats.cleanup, 0, 'healthy runs never call failure cleanup')

    f = fixture(target)
    f.scheduler.executeCampaignV2 = async () => { f.lease(); f.scheduler.markCampaignRunUnitStarted(2, [10]); throw new Error('API failed') }
    let inflight = 0
    const starts = []
    f.db.cleanupFailedCampaignRuntime = async payload => {
      assert.equal(inflight++, 0, 'at most one request')
      starts.push(clock.now); f.stats.payloads.push(payload); f.stats.cleanup++
      await Promise.resolve(); inflight--
      if (f.stats.cleanup <= 8) throw temporary()
      return { ok: true, reason: 'already_cleaned' }
    }
    const execution = f.scheduler.executeCampaign(f.account, f.campaign)
    await flush()
    assert.equal(f.stats.policy, 1, 'getErrorPolicy failure does not skip cleanup or replay policy')
    assert.equal(f.stats.cleanup, 1)
    assert.equal(f.scheduler.tryReserveExternalAccount(1), false)
    for (let i = 0; i < 8; i++) {
      const prior = f.stats.cleanup
      await clock.advance(1999); assert.equal(f.stats.cleanup, prior)
      await clock.advance(1); assert.equal(f.stats.cleanup, prior + 1)
    }
    await execution
    assert.deepEqual(starts, Array.from({ length: 9 }, (_, i) => i * 2000))
    assert.equal(f.stats.settle, 0, 'error finally cannot settle before or after atomic cleanup')
    assert.equal(f.stats.policy, 1)
    assert.ok(f.stats.payloads.every(p => p === f.stats.payloads[0] && Object.isFrozen(p)))
    assert.deepEqual([...f.stats.payloads[0].unstartedInputDataIds], [11])
    assert.equal(f.scheduler.failedCampaignRuns.size, 0)
    assert.equal(clock.tasks.size, 0)
    assert.equal(f.stats.logs.length, 2, 'one wait warning and one recovery notification')
  }

  // Even a successful error policy that requests pending must not cancel a
  // Desktop user pause whose original status write failed.
  const pausePolicy = fixture()
  pausePolicy.scheduler.updateCampaignAndBroadcast = async () => { throw temporary() }
  pausePolicy.db.getErrorPolicy = async () => null
  pausePolicy.scheduler.releaseRunningAccount = async () => { assert.fail('failed pause cannot release account') }
  pausePolicy.scheduler.executeCampaignV2 = async () => {
    pausePolicy.scheduler.pauseRequests.add(2)
    await pausePolicy.scheduler.completePauseAtBoundary(pausePolicy.account, pausePolicy.campaign)
  }
  await pausePolicy.scheduler.executeCampaign(pausePolicy.account, pausePolicy.campaign)
  assert.equal(pausePolicy.stats.cleanup, 1)
  assert.equal(pausePolicy.stats.payloads[0].campaignStatus, 'tạm dừng')

  // Preflight/pause failures must keep account ownership until atomic cleanup.
  // Exercise the real outer catch as well as the real boundary helpers.
  for (const target of ['desktop', 'zalo-local', 'server']) {
    for (const branch of ['preflight', 'pause-campaign', ...(target === 'server' ? ['pause-account'] : [])]) {
      for (const failure of ['none', 'update', 'commit-response', 'log', 'release']) {
        if (branch === 'preflight' && failure === 'log') continue
        const f = fixture(target === 'server' ? 'server' : 'desktop')
        if (target !== 'desktop') {
          f.account.flatformType = 'zalo'
          f.campaign.actionId = 'zalo_message_friend'
        }
        const order = []
        let accountToken, ownedToken, releases = 0, pauseLogCalls = 0
        let accountStatus = 'đang chạy', campaignStatus = 'đang chạy'
        f.db.claimCampaignRuntimeV2 = async (_c, _a, _t, token) => {
          ownedToken = accountToken = token
          f.stats.claims++
          return { ok: true, runtimeClaimToken: token, runtimeClaimVietnamDateKey: '2026-09-09', vietnamDateKey: '2026-09-09', dbNow: '2026-09-09T01:00:00Z' }
        }
        if (branch === 'pause-account') accountStatus = 'tạm dừng'
        if (target === 'server' && branch === 'pause-campaign') campaignStatus = 'tạm dừng'
        const failUpdate = failure === 'update' || failure === 'commit-response'
        f.scheduler.updateCampaignAndBroadcast = async (_id, updates) => {
          order.push('campaign-update')
          if (failure !== 'update') campaignStatus = updates.status
          if (failUpdate) throw temporary()
          return { ...f.campaign, status: campaignStatus }
        }
        f.db.getZaloServerRunControlState = async () => ({ campaignStatus, accountStatus })
        // Server campaign-pause reads the already committed DB-first status.
        const getCampaign = f.db.getCampaign
        f.db.getCampaign = async () => {
          if (target === 'server' && branch === 'pause-campaign' && ownedToken) {
            order.push('campaign-read')
            if (failUpdate) throw temporary()
          }
          return getCampaign()
        }
        f.scheduler.releaseRunningAccount = async () => {
          order.push('release'); releases++
          if (failure === 'release') throw temporary()
          assert.notEqual(campaignStatus, 'đang chạy', 'campaign must leave running before account release')
          // A different campaign could acquire the account immediately.
          accountToken = 'new-owner'
        }
        f.scheduler.logCampaignProgress = async (_id, message) => {
          if (!message.includes('tạm dừng')) return
          order.push('pause-log'); pauseLogCalls++
          if (failure === 'log') throw temporary()
        }
        f.scheduler.executeCampaignV2 = async () => {
          if (branch === 'preflight') {
            // Capture a still-active unit as in preflight inside an executor.
            f.scheduler.activeCampaignRunUnits.set(2, { runtimeUnitToken: unit, inputDataIds: [10], unstartedInputDataIds: new Set([10]), requeueRemainingOnSettle: true })
          } else {
            f.scheduler.activeCampaignRunUnits.set(2, { runtimeUnitToken: unit, inputDataIds: [10], unstartedInputDataIds: new Set(), requeueRemainingOnSettle: false })
            if (target === 'server') f.scheduler.serverZaloPauseBoundaries.set(2, branch === 'pause-account' ? 'account' : 'campaign')
            else f.scheduler.pauseRequests.add(2)
          }
          try {
            if (branch === 'preflight') await f.scheduler.releaseClaimedCampaignPreflight(f.account, f.campaign, 'blocked')
            else await f.scheduler.completePauseAtBoundary(f.account, f.campaign)
          } catch (error) {
            assert.ok(f.scheduler.failedCampaignRuns.has(2), 'failure is latched before caller finally can settle')
            throw error
          }
        }
        f.db.cleanupFailedCampaignRuntime = async payload => {
          order.push('cleanup'); f.stats.cleanup++; f.stats.payloads.push(payload)
          assert.equal(accountToken, ownedToken, 'old cleanup still owns the account')
          assert.equal(payload.runtimeClaimToken, ownedToken)
          assert.equal(payload.runtimeUnitToken, branch === 'preflight' ? unit : null)
          if (campaignStatus === 'đang chạy') campaignStatus = payload.campaignStatus || 'chờ xử lý'
          if (accountStatus === 'đang chạy') accountStatus = 'chờ xử lý'
          accountToken = null
          return { ok: true, reason: 'cleaned' }
        }
        await f.scheduler.executeCampaign(f.account, f.campaign)
        const label = `${target}/${branch}/${failure}`
        if (failure === 'none') {
          assert.equal(f.stats.cleanup, 0, `${label}: healthy path uses no cleanup RPC`)
          assert.equal(releases, 1, label)
        } else {
          assert.equal(f.stats.cleanup, 1, `${label}: secondary policy failure still reaches cleanup`)
          assert.equal(f.stats.policy, 1, label)
          assert.equal(releases, failure === 'release' ? 1 : 0, `${label}: never release after an earlier failure`)
          assert.ok(order.slice(order.indexOf('cleanup') + 1).every(step => step === 'campaign-read'), `${label}: only refresh follows cleanup`)
          assert.equal(f.stats.settle, branch === 'preflight' ? 0 : 1, `${label}: failed preflight retains its unit; pause already settled it`)
          if (branch === 'pause-campaign') assert.equal(campaignStatus, 'tạm dừng', `${label}: preserve user pause`)
          if (branch === 'pause-account') assert.equal(accountStatus, 'tạm dừng', `${label}: preserve account pause`)
          assert.equal(clock.tasks.size, 0, label)
        }
        if (branch !== 'preflight') assert.ok(pauseLogCalls <= 1, `${label}: no replay of pause log`)
      }
    }
  }

  // The retry helper remembers terminal results, including failed UI logging.
  fixture()
  const job = new cleanupModule.CampaignFailureCleanup()
  let calls = 0
  const promise = job.run(async () => { calls++; return { ok: true, reason: 'cleaned' } }, () => { throw Error('UI closed') })
  assert.strictEqual(job.run(async () => { throw Error('second request') }, () => {}), promise)
  assert.equal(await promise, 'cleaned'); assert.equal(calls, 1)
  // Delay is measured AFTER request failure, not from request start.
  fixture()
  const delayed = new cleanupModule.CampaignFailureCleanup()
  let rejectRequest, delayedCalls = 0
  const delayedRun = delayed.run(() => {
    delayedCalls++
    return delayedCalls === 1 ? new Promise((_, reject) => { rejectRequest = reject }) : Promise.resolve({ ok: true, reason: 'cleaned' })
  }, () => { throw Error('log unavailable') })
  await clock.advance(5000)
  assert.equal(delayedCalls, 1); assert.equal(clock.tasks.size, 0)
  rejectRequest(temporary()); await flush()
  await clock.advance(1999); assert.equal(delayedCalls, 1)
  await clock.advance(1); assert.equal(await delayedRun, 'cleaned')
  assert.equal(delayedCalls, 2); assert.equal(clock.tasks.size, 0)
  for (const error of [{ code: '42501' }, { code: '22023' }, { code: 'PGRST202' }, Error('bad response')]) {
    fixture(); const task = new cleanupModule.CampaignFailureCleanup()
    assert.equal(await task.run(async () => { throw error }, () => {}), 'recovery_required')
    assert.equal(clock.tasks.size, 0)
  }
  for (const reason of ['not_owner', 'insufficient_ownership']) {
    const f = fixture(); f.lease()
    f.db.cleanupFailedCampaignRuntime = async () => ({ ok: false, reason })
    await f.scheduler.cleanupFailedCampaignRun(f.scheduler.rememberFailedCampaignRun(f.account, f.campaign, Error('failed')))
    assert.equal(f.scheduler.failedCampaignRuns.size, reason === 'not_owner' ? 0 : 1)
    assert.equal(clock.tasks.size, 0)
  }

  // Shutdown aborts only the new retry wait; recovery clears only a proven scope.
  const f = fixture('server'); f.lease()
  f.db.cleanupFailedCampaignRuntime = async () => { f.stats.cleanup++; throw temporary() }
  const saved = f.scheduler.rememberFailedCampaignRun(f.account, f.campaign, Error('failed'))
  const waiting = f.scheduler.cleanupFailedCampaignRun(saved)
  await flush(); assert.equal(clock.tasks.size, 1)
  f.scheduler.stop(); await waiting
  assert.equal(clock.tasks.size, 0)
  assert.equal(f.scheduler.failedCampaignRuns.size, 1)
  f.scheduler.running = true
  f.scheduler.startAccountCampaignQueue(f.account, [f.campaign])
  await clock.advance(20_000)
  assert.equal(f.stats.cleanup, 1, 'start/poll cannot resurrect stopped retry')
  assert.equal(f.stats.claims, 0)
  f.scheduler.clearRecoveredCampaignCleanups(999)
  f.scheduler.clearRecoveredCampaignCleanups(625, 'non_zalo')
  assert.equal(f.scheduler.failedCampaignRuns.size, 1)
  f.scheduler.clearRecoveredCampaignCleanups(625, 'zalo')
  assert.equal(f.scheduler.failedCampaignRuns.size, 0)

  const inFlight = fixture(); inFlight.lease()
  inFlight.db.cleanupFailedCampaignRuntime = (_payload, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Error('request aborted')), { once: true })
  })
  const inFlightWait = inFlight.scheduler.cleanupFailedCampaignRun(inFlight.scheduler.rememberFailedCampaignRun(inFlight.account, inFlight.campaign, Error('failed')))
  await flush()
  inFlight.scheduler.stop()
  await inFlightWait
  assert.equal(inFlight.scheduler.failedCampaignRuns.size, 1, 'aborted response stays held for recovery')
  assert.equal(clock.tasks.size, 0)

  // Real nested finally blocks: an error in their error handler retains lease.
  const nested = fixture()
  nested.scheduler.beginCampaignRunUnit = async (_a, _c, ids) => { nested.lease(ids); return true }
  nested.scheduler.engineV2.run = async () => ({ status: 'failed', steps: [], error: 'API failed' })
  await assert.rejects(nested.scheduler.runFacebookGroupInviteBatch(nested.account, nested.campaign, 1, [{ inputDataId: 10 }, { inputDataId: 11 }], { code: 'invite' }, {}))
  assert.equal(nested.stats.details, 1, 'secondary failure cannot repeat the FB error handler')
  assert.equal(nested.stats.settle, 0)
  assert.equal(nested.scheduler.activeCampaignRunUnits.size, 1)
  assert.equal(nested.scheduler.failedCampaignRuns.get(2).payload.pauseUnknownOutcome, true)
  const aggregate = fixture()
  aggregate.scheduler.beginCampaignRunUnit = async (_a, _c, ids) => { aggregate.lease(ids); return true }
  aggregate.scheduler.engineV2.run = async () => { throw Error('aggregate failed') }
  await assert.rejects(aggregate.scheduler.collectSuggestedFriendInputData(aggregate.account, aggregate.campaign, 1))
  assert.equal(aggregate.stats.settle, 0)
  assert.equal(aggregate.scheduler.failedCampaignRuns.get(2).payload.pauseUnknownOutcome, true)

  // Refresh throws after committed cleanup; no new cleanup or settlement.
  const refreshed = fixture(); refreshed.lease()
  refreshed.scheduler.mainWindow.webContents.send = () => { throw Error('closed UI') }
  refreshed.scheduler.broadcastClaimedRuntimeState = async () => { throw Error('refresh unavailable') }
  await refreshed.scheduler.cleanupFailedCampaignRun(refreshed.scheduler.rememberFailedCampaignRun(refreshed.account, refreshed.campaign, Error('failed')))
  assert.equal(refreshed.stats.cleanup, 1)
  assert.equal(refreshed.scheduler.failedCampaignRuns.size, 0)

  // A user pause during retry is a token-CAS control write. It must not edit
  // the frozen retry payload or cause a second cleanup task.
  const paused = fixture(); paused.lease(); paused.campaign.status = 'đang chạy'
  const pending = paused.scheduler.rememberFailedCampaignRun(paused.account, paused.campaign, Error('failed'))
  Object.freeze(pending.payload)
  paused.db.updateRunningDesktopCampaign = async (id, updates, token) => {
    assert.equal(id, 2); assert.equal(token, parent)
    return Object.assign(paused.campaign, updates)
  }
  assert.equal((await paused.scheduler.requestPauseCampaign(2)).status, 'tạm dừng')
  assert.equal(pending.payload.campaignStatus, null)
  assert.equal(paused.scheduler.failedCampaignRuns.size, 1)

  // Policy status writes on the outer error path are deferred; no tokenless
  // campaign/account release can race atomic cleanup.
  const policy = fixture(); policy.lease()
  const policyRun = policy.scheduler.rememberFailedCampaignRun(policy.account, policy.campaign, Error('failed'))
  await policy.scheduler.updateErrorPolicyCampaign(policy.campaign, { status: 'tạm dừng', note: 'policy pause' })
  assert.equal(policyRun.payload.campaignStatus, 'tạm dừng')
  assert.equal(policyRun.payload.note, 'policy pause')
  await assert.rejects(policy.scheduler.handleCampaignBadTarget(policy.account, policy.campaign, null, 'err_undefined'))
  await assert.rejects(policy.scheduler.handleCampaignBadTarget(policy.account, policy.campaign, null, 'err_undefined'))
  assert.equal(policy.stats.policy, 1, 'cached policy failure also blocks a nested retry')

  // The actual DAG runner drains sibling nodes before propagating an error.
  // Otherwise Promise.all can release the campaign while a sibling sends.
  const { WorkflowEngineV2 } = load('src/main/v2/runtime/workflowEngine.ts')
  const engine = new WorkflowEngineV2()
  const nodes = [{ id: 'failed' }, { id: 'still-sending' }]
  let releaseSend, returned = false, readyCount = 0
  engine.loadBlocks = async () => new Map()
  engine.computeReady = () => readyCount++ === 0 ? nodes : []
  engine.executeNode = async ({ node }) => {
    if (node.id === 'failed') throw Error('node callback failed')
    await new Promise(resolve => { releaseSend = resolve })
  }
  const drain = engine.run({ nodes, edges: [] }, {}, null, { persist: false }).catch(error => {
    returned = true; assert.match(error.message, /node callback failed/)
  })
  await flush(); assert.equal(returned, false)
  releaseSend(); await drain; assert.equal(returned, true)

  // Normal retry loops are compared to the checked-in implementation, not a copy.
  const file = 'src/main/services/campaignScheduler.ts'
  const baseline = execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8' })
  const current = fs.readFileSync(path.join(root, file), 'utf8')
  function methods(text) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const klass = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CampaignScheduler')
    return new Map(klass.members.filter(ts.isMethodDeclaration).map(m => [m.name.getText(source), { m, source }]))
  }
  const before = methods(baseline), after = methods(current)
  for (const name of ['settleActiveCampaignRunUnit', 'releaseRunningAccount']) {
    assert.equal(after.get(name).m.getText(after.get(name).source), before.get(name).m.getText(before.get(name).source), `${name} stays unchanged`)
  }
  for (const name of ['executeCampaign', 'beginCampaignRunUnit']) {
    function loop(pair) { let found; function visit(n) { if (!found && ts.isWhileStatement(n)) found = n.getText(pair.source); ts.forEachChild(n, visit) } visit(pair.m); return found }
    assert.equal(loop(after.get(name)), loop(before.get(name)), `${name} retry loop stays unchanged`)
  }
  console.log('PASS: Desktop/Server cleanup, both nested pause failure handoffs, all 8 executor pause branches (24 cases), preflight/pause ownership handoff, 9 attempts, 2s spacing, no overlap/replay, nested finally, shutdown, ownership, refresh, unchanged claim/settle')
}
let completed = false
process.once('beforeExit', () => {
  if (!completed) {
    console.error('FAIL: cleanup smoke test left an unresolved promise')
    process.exitCode = 1
  }
})
run().then(() => { completed = true }, error => { completed = true; console.error(error); process.exitCode = 1 })

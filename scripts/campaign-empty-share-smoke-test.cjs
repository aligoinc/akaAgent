// Real scheduler methods with isolated DB/runtime adapters; no network or Zalo commands.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const file = path.resolve(__dirname, '../src/main/services/campaignScheduler.ts')
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
const methods = [
  'executeZaloShareMessageBatchCampaign', 'handleCampaignCompletion', 'transitionCampaignToCompleted',
  'getDatabaseBusinessNow', 'getFutureInputSchedule', 'deferCampaignUntilFutureInput',
  'handleMultiDailyTimeSlotAfterCompletion', 'updateRunningCampaignAndBroadcast'
].map(name => {
  const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
  assert.ok(method, name)
  return method.getText(source)
}).join('\n')
const globals = {
  ZALO_MESSAGE_FRIEND_ACTION_ID: 'zalo_message_friend', ZALO_MESSAGE_GROUP_ACTION_ID: 'zalo_message_group',
  PAGE_POST_ACTION_ID: 'facebook_page_post',
  MULTI_DAILY_TIME_SLOT_ACTION_IDS: new Set(['zalo_message_friend', 'zalo_message_group'])
}
const compiled = ts.transpileModule(`class Harness { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText
const Scheduler = new Function(...Object.keys(globals), `${compiled}; return Harness`)(...Object.values(globals))
const repositoryFile = path.resolve(__dirname, '../src/main/data/repositories/campaignRepository.ts')
const repositorySource = ts.createSourceFile(repositoryFile, fs.readFileSync(repositoryFile, 'utf8'), ts.ScriptTarget.Latest, true)
const repositoryMethods = ['updateRunningDesktopCampaign', 'updateClaimedZaloServerCampaign'].map(name => {
  const method = repositorySource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(method, name)
  return method.getText(repositorySource).replace(/^export /, '')
}).join('\n')
const createGuardedRepository = new Function('client', 'requireCurrentUser', 'getCampaign', 'mapCampaignFromDB', 'CAMPAIGN_SELECT',
  ts.transpileModule(repositoryMethods, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText +
  '; return { updateRunningDesktopCampaign, updateClaimedZaloServerCampaign }')
const now = '2026-09-22T01:00:00.000Z'

function fixture({ actionId = 'zalo_message_friend', server = false, rich = false, advanced = false,
  reason = 'completed', mode = 'direct', details = [], extra = {} } = {}) {
  const campaign = { id: 1, accountId: 2, name: 'Fixture', actionId, status: 'đang chạy', schedule: now,
    dataTargetSourceMode: mode, extraSettings: { zaloMessageSendMode: 'share', formattedContentEnabled: rich, ...extra } }
  const calls = []
  const forbid = () => { throw new Error('Unexpected target/content work for empty campaign') }
  const finalize = async kind => {
    calls.push(kind)
    if (reason === 'error') throw new Error('fixture finalizer unavailable')
    campaign.status = reason === 'completed' ? 'hoàn thành'
      : ['campaign_control_won', 'account_control_won'].includes(reason) ? 'tạm dừng' : 'chờ xử lý'
    return { completed: reason === 'completed', reason, pendingInputCount: reason === 'pending_input_remaining' ? 1 : 0 }
  }
  // Execute the real repository query builder against an isolated row so a
  // missing schedule payload or running-status predicate cannot pass unnoticed.
  const guardedRepository = createGuardedRepository(() => ({ from: table => {
    assert.equal(table, 'auto_campaigns')
    let patch
    const filters = {}
    const query = {
      update: value => { patch = value; calls.push({ guardedUpdate: value }); return query },
      eq: (key, value) => { filters[key] = value; return query },
      select: () => query,
      maybeSingle: async () => {
        assert.equal(filters.id, campaign.id)
        assert.equal(filters.staff_id, 830)
        assert.equal(filters.status, 'đang chạy')
        if (campaign.status !== filters.status) return { data: null, error: null }
        Object.assign(campaign, patch)
        return { data: campaign, error: null }
      }
    }
    return query
  } }), () => ({ staffId: 830 }), async () => campaign,
  value => ({ ...value, schedule: value.schedule?.replace('Z', '+00:00') }), '*')
  const scheduler = Object.assign(new Scheduler(), {
    running: true, zaloRuntime: { forwardMessageToUsers: forbid, forwardMessageToGroups: forbid },
    runtimeTarget: server ? 'server' : 'desktop',
    claimedServerZaloCampaignIds: new Set(server ? [1] : []),
    claimedServerZaloAccountIds: new Set(server ? [2] : []),
    isServerZaloCampaign: () => server,
    getZaloShareMessageActionDescriptor: () => ({ code: actionId }),
    shouldUseAdvancedContent: () => advanced,
    getAdvancedContentConfigError: forbid, getRawCampaignContentForIndex: forbid, resolveCampaignMediaForIndex: forbid,
    restoreFacebookPageIdentity: async () => {},
    handleZaloRealtimeGroupCompletion: async () => false, handleRerunAfterCompletion: async () => false,
    dataGroupRuntimeContext: () => ({ runtimeTarget: server ? 'server' : 'desktop' }),
    supabase: {
      getRuntimeClock: async () => ({ dbNow: now }), getCampaign: async () => campaign,
      listCampaignInputData: async () => details,
      ...guardedRepository,
      resetCampaignInputDataForRerun: async () => calls.push('reset-inputs'),
      advanceZaloServerMultiDailySlot: async (_id, _accountId, schedule) => {
        calls.push('advance-slot')
        Object.assign(campaign, { status: 'chờ xử lý', schedule })
        return { ok: true }
      },
      finalizeCampaign: async () => finalize('finalize'),
      finalizeDataGroupCampaign: async () => finalize('finalize-group')
    },
    finalizeClaimedServerZaloCampaign: async () => ({ finalized: await finalize('finalize-server'), campaign }),
    finishServerZaloFinalizationBoundary: async () => calls.push('boundary'),
    broadcastCampaignUpdate: value => calls.push(`broadcast:${value.status}`),
    logCampaignProgress: async (_id, message) => calls.push(message),
    releaseRunningAccount: async () => calls.push('release'),
    isCampaignPauseRequested: () => false,
    cleanupCampaignMediaTempFiles: () => calls.push('cleanup'), isCampaignMediaResolveError: () => false,
    updateCampaignAndBroadcast: async (_id, patch) => { calls.push(patch); Object.assign(campaign, patch) },
    stopCampaignAtRunBoundaryIfNeeded: async () => false, finalizeDataGroupCampaignAtHardEnd: async () => false,
    getZaloRuntimeStopReason: () => null, getServerZaloBoundaryReason: async () => ({ paused: false }),
    getAccountRunBlockReason: async () => null, getZaloShareMessageBatchCapacity: async () => ({ ok: true, capacity: 50 }),
    requiresDataGroupHardEndCheck: () => false, formatVietnamDateTime: date => date.toISOString(),
    normalizeMultiDailyTimeSlots: () => ['08:00', '10:00'], isSameVietnamDay: () => true,
    getVietnamDateTimeParts: () => ({ hour: 8, minute: 0 }),
    getTimeSlotMinute: slot => Number(slot.split(':')[0]) * 60,
    withVietnamTimeSlot: () => new Date('2026-09-22T03:00:00.000Z'),
    isAtOrAfterCampaignDispatchCutoff: () => false
  })
  return { campaign, calls, scheduler, run: () => scheduler.executeZaloShareMessageBatchCampaign({ id: 2 }, campaign, details, [], [], null) }
}

async function main() {
  let cases = 0
  for (const actionId of ['zalo_message_friend', 'zalo_message_group']) {
    for (const server of [false, true]) for (const rich of [false, true]) for (const advanced of [false, true]) {
      const value = fixture({ actionId, server, rich, advanced })
      await value.run()
      assert.equal(value.campaign.status, 'hoàn thành')
      assert.equal(value.calls.filter(call => call === (server ? 'finalize-server' : 'finalize')).length, 1)
      assert.equal(value.calls.filter(call => call === 'release').length, 1)
      assert(value.calls.indexOf('release') > value.calls.indexOf('broadcast:hoàn thành'))
      assert.equal(value.calls.filter(call => typeof call === 'object').length, 0)
      cases++
    }
  }
  for (const server of [false, true]) {
    for (const reason of ['pending_input_remaining', 'campaign_control_won', 'account_control_won']) {
      const value = fixture({ server, reason })
      await value.run()
      assert.equal(value.campaign.status, reason === 'pending_input_remaining' ? 'chờ xử lý' : 'tạm dừng')
      assert(!value.calls.some(call => typeof call === 'string' && call.includes('Hoàn thành chiến dịch')))
      assert.equal(value.calls.filter(call => typeof call === 'object').length, 0)
      cases++
    }
    for (const reason of ['waiting_for_data', 'completed']) {
      const value = fixture({ server, mode: 'data_group', reason })
      await value.run()
      assert(value.calls.includes('finalize-group'))
      assert.equal(value.campaign.status, reason === 'completed' ? 'hoàn thành' : 'chờ xử lý')
      cases++
    }
    const multi = fixture({ server, extra: { multiDailyTimeSlotsEnabled: true } })
    await multi.run()
    assert.equal(multi.campaign.status, 'hoàn thành')
    assert.equal(multi.campaign.schedule, now)
    cases++

    const failed = fixture({ server, reason: 'error' })
    await assert.rejects(failed.run(), /fixture finalizer unavailable/)
    assert(!failed.calls.includes('release'))
    assert(failed.calls.includes('cleanup'))
    cases++

    const future = fixture({ server, details: [{ id: 3, status: 'chờ xử lý', schedule: '2026-09-22T03:00:00.000Z' }] })
    Object.assign(future.scheduler, { getRawCampaignContentForIndex: () => 'Fixture',
      isFormattedContentCampaign: () => false, resolveCampaignMediaForIndex: async () => [] })
    await future.run()
    assert.equal(future.campaign.status, 'chờ xử lý')
    assert.equal(future.campaign.schedule, '2026-09-22T03:00:00.000Z')
    assert(!future.calls.some(call => typeof call === 'string' && call.startsWith('finalize')))
    cases++

    for (const schedule of [null, '2026-09-22T00:30:00.000Z', now]) {
      for (const paused of [false, true]) {
        const race = fixture({ server, extra: { multiDailyTimeSlotsEnabled: true } })
        const newInput = { id: 9, status: 'chờ xử lý', schedule }
        const original = { ...newInput }
        race.scheduler.supabase.listCampaignInputData = async () => {
          if (paused) race.campaign.status = 'tạm dừng'
          return [newInput, { id: 10, status: 'chờ xử lý', schedule: '2026-09-22T02:00:00.000Z' }]
        }
        await race.run()
        assert.equal(race.campaign.status, paused ? 'tạm dừng' : 'chờ xử lý')
        assert.equal(race.campaign.schedule, now)
        assert.deepEqual(newInput, original)
        assert(!race.calls.includes('reset-inputs'))
        assert(!race.calls.some(call => typeof call === 'string' && call.includes('hẹn chạy lại')))
        assert.equal(race.calls.filter(call => call.guardedUpdate).length, 1)
        cases++
      }
    }

    for (const schedule of ['2026-09-22T02:00:00.000Z', '2026-09-22T04:00:00.000Z']) {
      for (const paused of [false, true]) {
        const race = fixture({ server, extra: { multiDailyTimeSlotsEnabled: true } })
        const newInputs = [
          { id: 8, status: 'chờ xử lý', schedule: '2026-09-22T05:00:00.000Z' },
          { id: 9, status: 'chờ xử lý', schedule },
          { id: 10, status: 'hoàn thành', schedule: '2026-09-22T01:10:00.000Z' },
          { id: 11, status: 'tạm dừng', schedule: '2026-09-22T01:20:00.000Z' },
          { id: 12, status: 'chờ xử lý', schedule: '2026-09-22T01:30:00.000Z', isDelete: true }
        ]
        const originalInputs = structuredClone(newInputs)
        race.scheduler.supabase.listCampaignInputData = async () => {
          if (paused) race.campaign.status = 'tạm dừng'
          return newInputs
        }
        await race.run()
        assert.equal(race.campaign.status, paused ? 'tạm dừng' : 'chờ xử lý')
        assert.equal(race.campaign.schedule, paused ? now : schedule)
        assert.deepEqual(newInputs, originalInputs)
        assert(!race.calls.includes('reset-inputs'))
        assert(!race.calls.includes('advance-slot'))
        assert(!race.calls.some(call => typeof call === 'string' && call.startsWith('finalize')))
        assert.equal(race.calls.filter(call => call.guardedUpdate).length, 1)
        assert.equal(race.calls.some(call => typeof call === 'string' && call.includes('Hẹn chạy tiếp')), !paused)
        cases++
      }
    }

    const deferFailure = fixture({ server, extra: { multiDailyTimeSlotsEnabled: true } })
    deferFailure.scheduler.supabase.listCampaignInputData = async () => [
      { id: 9, status: 'chờ xử lý', schedule: '2026-09-22T02:00:00.000Z' }
    ]
    deferFailure.scheduler.supabase[server ? 'updateClaimedZaloServerCampaign' : 'updateRunningDesktopCampaign'] = async () => {
      throw new Error('fixture schedule update unavailable')
    }
    await assert.rejects(deferFailure.run(), /fixture schedule update unavailable/)
    assert(!deferFailure.calls.includes('release'))
    assert(!deferFailure.calls.includes('reset-inputs'))
    assert(!deferFailure.calls.includes('advance-slot'))
    assert(deferFailure.calls.includes('cleanup'))
    cases++

    const completed = fixture({ server, extra: { multiDailyTimeSlotsEnabled: true } })
    completed.scheduler.supabase.listCampaignInputData = async () => [
      { id: 9, status: 'hoàn thành' }, { id: 10, status: 'chờ xử lý', isDelete: true }
    ]
    await completed.run()
    assert.equal(completed.campaign.schedule, '2026-09-22T03:00:00.000Z')
    assert(completed.calls.includes(server ? 'advance-slot' : 'reset-inputs'))
    assert(!completed.calls.some(call => call.guardedUpdate))
    cases++
  }
  console.log(`PASS ${cases} empty-share cases: Local/Server, friend/group, rich/basic/advanced, raced due/future inputs, guarded repository writes, pause guards, live groups, slots and finalizer/update errors`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })

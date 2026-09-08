// Run: node scripts/page-inbox-campaign-run-smoke-test.cjs
// Exercise the actual scheduler target loop and migrated open block with local
// DB/browser adapters. No account session, network request or production write.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

const schedulerPath = resolve(__dirname, '../src/main/services/campaignScheduler.ts')
const source = ts.createSourceFile(schedulerPath, readFileSync(schedulerPath, 'utf8'), ts.ScriptTarget.Latest, true)
const schedulerClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
const targetLoop = schedulerClass?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'executeCampaignV2')
assert.ok(targetLoop, 'exercise the real campaign execution method')
const globals = {
  AbortController, setInterval, clearInterval,
  ZALO_MESSAGE_OPT_OUT_ACTION_IDS: new Set(),
  isRecentDeliveryCooldownEnabled: () => false
}
for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isStringLiteral(declaration.initializer)) {
      globals[declaration.name.text] = declaration.initializer.text
    }
  }
}
const compiled = ts.transpileModule(`class CampaignRunHarness { ${targetLoop.getText(source)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText
const CampaignRunHarness = new Function(...Object.keys(globals), `${compiled}; return CampaignRunHarness`)(...Object.values(globals))
const migration = readFileSync(resolve(__dirname, '../migrations/migration_v265_facebook_page_inbox_campaign_run_start.sql'), 'utf8')
const openCode = migration.match(/\$block_code\$([\s\S]*?)\$block_code\$/)?.[1]
assert.ok(openCode)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const openBlock = new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', openCode)

function fixture(options = {}) {
  const scheduler = new CampaignRunHarness()
  const account = { id: 1, flatformType: 'facebook' }
  const campaign = { id: 100, name: 'Inbox test', actionId: options.actionId || 'facebook_page_to_message', extraSettings: {}, status: 'đang chạy' }
  const stats = { flags: [], navigations: [], sends: 0, claimed: false }
  let details = []
  let currentUrl = 'https://business.facebook.com/latest/inbox/all?asset_id=999'
  let engineCalls = 0
  const page = {
    getURL: () => currentUrl,
    navigate: async url => {
      assert.equal(stats.claimed, true, 'navigation follows the scheduler unit claim')
      stats.navigations.push(url)
      if (options.firstOpenFails && stats.navigations.length === 1) throw new Error('Navigation failed')
      currentUrl = url
    }
  }

  // Disable unrelated campaign branches while retaining the actual target loop,
  // claim ordering, per-run variable lifetime, workflow result and error paths.
  for (const name of [
    'isCampaignPauseRequested', 'isServerZaloCampaign', 'isZaloBirthdayCampaign',
    'isZaloFriendAutoDataCampaign', 'isZaloFriendRecommendationCampaign',
    'isZaloCancelSentFriendRequestCampaign', 'isFormattedContentCampaign',
    'isBrowserlessCampaign', 'isZaloFriendBlockedByBlocklist', 'isNewsfeedDailyCampaign',
    'isRunUnitStartCancelled', 'requiresDataGroupHardEndCheck',
    'shouldMaterializeZaloFriendInputData', 'shouldMaterializeZaloBirthdayInputData',
    'shouldMaterializeZaloFriendRecommendationInputData', 'shouldMaterializeZaloCancelSentFriendRequestInputData',
    'shouldUseSuggestedFriends', 'shouldUseZaloShareMessageBatch', 'shouldUseFacebookGroupInviteBatch',
    'stopCampaignAtRunBoundaryIfNeeded', 'finalizeDataGroupCampaignAtHardEnd'
  ]) scheduler[name] = () => false
  for (const name of [
    'logCampaignProgress', 'logSkippedLimitActionsOnce', 'releaseRunningAccount',
    'handleCampaignCompletion', 'resetCampaignBadTargetCount', 'completeCampaignPause',
    'cleanupCampaignMediaTempFiles', 'startBackgroundPreview', 'stopBackgroundPreview'
  ]) scheduler[name] = async () => {}
  Object.assign(scheduler, {
    activeV2Aborts: new Map(), serverZaloPauseBoundaries: new Map(),
    zaloMessageOptOutContexts: new Map(), pauseRequests: new Set(),
    supabase: {
      listCampaignInputData: async () => details,
      getCampaign: async () => campaign,
      updateCampaignInputData: async (id, patch) => Object.assign(details.find(item => item.id === id), patch)
    },
    loadZaloFriendBlocklistContext: async () => null,
    getAdvancedContentConfigError: () => null,
    getServerZaloBoundaryReason: async () => ({ paused: false }),
    getAccountRunBlockReason: async () => null,
    resolveGroupPostApprovalForTarget: async () => ({}),
    checkActionDisabled: async () => null,
    checkActionLimitsForContinuation: async () => ({ runnableActionDescriptors: [], skippedLimitStatuses: [] }),
    getSkippedLimitActionCodeSet: () => new Set(),
    getAutomationPage: async () => ({ page, source: 'background' }),
    resolveGroupPostShareQuotaCapacity: async () => 0,
    buildGroupPostShareTargets: async () => [],
    resolveCampaignContentRotation: () => ({ index: 0, count: 1 }),
    buildVariablesV2: async () => ({ pageInboxPageUid: '999', facebookStepMs: 1000 }),
    beginCampaignRunUnit: async () => { stats.claimed = true; return true },
    settleActiveCampaignRunUnit: async () => { stats.claimed = false; return true },
    getInputDataDisplayName: (_campaign, detail) => detail.name,
    createBlockRuntimeHelpers: () => ({}),
    logMilestonesV2: async () => ({}),
    withZaloMessageOptOutWarnings: value => value,
    zaloMessageOptOutContextKey: (campaignId, inputId) => `${campaignId}:${inputId}`,
    getEffectiveSleepBetweenActions: () => 0,
    normalizeRuntimeError: (_campaign, _steps, error) => ({ errorCode: 'err_undefined', message: error }),
    handleCampaignBadTarget: async () => ({ triggered: false }),
    engineV2: {
      run: async (_workflowId, variables, _page, ctx) => {
        assert.equal(stats.claimed, true)
        stats.flags.push(variables.pageInboxForceNavigate)
        engineCalls++
        if (campaign.actionId !== 'facebook_page_to_message') return { status: 'completed', steps: [] }
        try {
          await openBlock(page, { log: () => {}, sleep: async () => {} }, variables, {}, ctx.signal)
        } catch (error) {
          return { status: 'failed', error: error.message, steps: [{ blockName: 'fb_page_inbox_open', status: 'error' }] }
        }
        const steps = [{ blockName: 'fb_page_inbox_open', status: 'success' }]
        if (options.firstSendFails && engineCalls === 1) return { status: 'failed', error: 'Send failed', steps }
        stats.sends++
        return { status: 'completed', steps }
      }
    }
  })
  return {
    scheduler, stats,
    run: async (statuses = ['hoàn thành', 'chờ xử lý', 'chờ xử lý']) => {
      details = statuses.map((status, index) => ({ id: index + 1, name: `Customer ${index + 1}`, status }))
      await scheduler.executeCampaignV2(account, campaign, 227, [], [])
      assert.equal(stats.claimed, false, 'all claimed units are settled')
    }
  }
}

async function main() {
  const repeated = fixture()
  await repeated.run()
  assert.deepEqual(repeated.stats.flags, [true, false], 'completed rows do not consume the first-open flag')
  assert.equal(repeated.stats.navigations.length, 1)
  await repeated.run()
  assert.deepEqual(repeated.stats.flags, [true, false, true, false])
  assert.equal(repeated.stats.navigations.length, 2)
  assert.equal(repeated.stats.sends, 4)
  console.log('PASS campaign starts reopen once; later customers reuse Inbox; a new execution of the same campaign reopens again')

  const sendFailure = fixture({ firstSendFails: true })
  await sendFailure.run()
  assert.deepEqual(sendFailure.stats.flags, [true, false])
  assert.equal(sendFailure.stats.navigations.length, 1)
  assert.equal(sendFailure.stats.sends, 1)
  console.log('PASS a later send failure does not turn campaign-start navigation back on')

  const openFailure = fixture({ firstOpenFails: true })
  await openFailure.run(['chờ xử lý', 'chờ xử lý', 'chờ xử lý'])
  assert.deepEqual(openFailure.stats.flags, [true, true, false])
  assert.equal(openFailure.stats.navigations.length, 2)
  assert.equal(openFailure.stats.sends, 2)
  console.log('PASS failed opening keeps initialization pending until the first successful open')

  const paused = fixture()
  paused.scheduler.isCampaignPauseRequested = () => true
  await paused.run()
  assert.equal(paused.stats.navigations.length, 0)
  paused.scheduler.isCampaignPauseRequested = () => false
  await paused.run()
  assert.deepEqual(paused.stats.flags, [true, false])
  console.log('PASS a pause before the first target produces no navigation and resume starts fresh')

  const other = fixture({ actionId: 'facebook_message_friend' })
  await other.run()
  assert.deepEqual(other.stats.flags, [undefined, undefined])
  assert.equal(other.stats.navigations.length, 0)
  console.log('PASS other campaign actions receive no Page Inbox navigation flag')
}

main().catch(error => { console.error(error); process.exitCode = 1 })

// Run: node scripts/facebook-page-content-rotation-smoke-test.cjs
// Real scheduler loop/content selection with isolated DB, media and workflow adapters.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const loadShared = file => {
  const exports = {}
  new Function('exports', transpile(read(file)))(exports)
  return exports
}
const spin = loadShared('src/shared/contentSpin.ts')
const advanced = loadShared('src/shared/advancedContent.ts')
const source = ts.createSourceFile('scheduler.ts', read('src/main/services/campaignScheduler.ts'), ts.ScriptTarget.Latest, true)
const schedulerClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
const methodNames = [
  'executeCampaignV2', 'buildVariablesV2', 'resolveCampaignContentRotation', 'advanceCampaignContentRotation',
  'isAdvancedContentEnabled', 'shouldUseAdvancedContent', 'shouldUseAdvancedCommentContent',
  'campaignUsesMainContent', 'campaignUsesMainMedia', 'campaignUsesMessageMedia', 'campaignUsesCommentIterations',
  'getRawCampaignContentForIndex', 'resolveCampaignMediaForIndex'
]
const methods = methodNames.map(name => {
  const method = schedulerClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
  assert.ok(method, name)
  return method.getText(source)
}).join('\n')
const globals = {
  MOBILE_MANAGED_SMS_ACTION_IDS: new Set(['sms_send', 'voice_call']),
  getWorkflow: async () => ({ defaultVariables: {} }),
  ...advanced, ZALO_MESSAGE_OPT_OUT_ACTION_IDS: new Set(),
  isRecentDeliveryCooldownEnabled: (_action, extra) => extra.recentDeliveryCooldownEnabled === true,
  supportsFacebookRestBrowse: () => false,
  isImageMediaSource: () => true, isImageOrVideoMediaSource: () => true,
  splitSharedContentVariants: spin.splitContentVariants
}
for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isStringLiteral(declaration.initializer)) {
      globals[declaration.name.text] = declaration.initializer.text
    }
  }
}
const Scheduler = new Function(...Object.keys(globals), `${transpile(`class Harness { ${methods} }`)}; return Harness`)(...Object.values(globals))
const repository = ts.createSourceFile('repository.ts', read('src/main/data/repositories/campaignRepository.ts'), ts.ScriptTarget.Latest, true)
const cloneStatement = repository.statements.find(node => ts.isVariableStatement(node) &&
  node.declarationList.declarations.some(declaration => declaration.name.getText(repository) === 'sanitizeClonedCampaignExtraSettings'))
assert.ok(cloneStatement)
const sanitizeClone = new Function('shouldSkipCloneCampaignInputData',
  `${transpile(cloneStatement.getText(repository))}; return sanitizeClonedCampaignExtraSettings`)(() => false)

function fixture(options = {}) {
  const items = Array.from({ length: 42 }, (_, i) => ({ id: `item-${i}`, content: `Content ${i + 1}`,
    mediaOption: 'all', mediaItems: [{ url: `https://fixture.invalid/${i + 1}.jpg` }] }))
  let saved = { id: 1, name: 'Page rotation', actionId: options.actionId || 'facebook_page_post', status: 'đang chạy',
    content: options.simple ? 'First | Second | Third' : '', extraSettings: {
      advancedContentEnabled: !options.simple, advancedContentItems: items,
      pagePostMode: options.mode || 'api', contentRotationIndex: 0, ...options.extra
    } }
  let current, details
  const stats = { variables: [], writes: [], claimed: false, errors: [] }
  const scheduler = new Scheduler()
  for (const name of [
    'isCampaignPauseRequested', 'isServerZaloCampaign', 'isZaloBirthdayCampaign', 'isZaloFriendAutoDataCampaign',
    'isZaloFriendRecommendationCampaign', 'isZaloCancelSentFriendRequestCampaign', 'isFormattedContentCampaign',
    'isBrowserlessCampaign', 'isZaloFriendBlockedByBlocklist', 'isNewsfeedDailyCampaign', 'isRunUnitStartCancelled',
    'requiresDataGroupHardEndCheck', 'shouldMaterializeZaloFriendInputData', 'shouldMaterializeZaloBirthdayInputData',
    'shouldMaterializeZaloFriendRecommendationInputData', 'shouldMaterializeZaloCancelSentFriendRequestInputData',
    'shouldUseSuggestedFriends', 'shouldUseZaloShareMessageBatch', 'shouldUseFacebookGroupInviteBatch',
    'stopCampaignAtRunBoundaryIfNeeded', 'finalizeDataGroupCampaignAtHardEnd',
    'shouldSkipMessageByLimit', 'shouldSkipAddFriendByLimit', 'isCampaignMediaResolveError'
  ]) scheduler[name] = () => false
  for (const name of [
    'logCampaignProgress', 'logSkippedLimitActionsOnce', 'releaseRunningAccount', 'handleCampaignCompletion',
    'resetCampaignBadTargetCount', 'completePauseAtBoundary', 'cleanupCampaignMediaTempFiles',
    'startBackgroundPreview', 'stopBackgroundPreview', 'markCampaignRunUnitStarted', 'logRecentDeliveryCooldownPauses'
  ]) scheduler[name] = async () => {}
  Object.assign(scheduler, {
    campaignContentPreparationRuns: new Set(), campaignContentMediaPaths: new Map(),
    running: true, activeV2Aborts: new Map(), serverZaloPauseBoundaries: new Map(), sendExclusionLabels: new Map(),
    facebookPageIdentities: new Map(), attemptedRunErrorPolicies: new Set(), zaloMessageOptOutContexts: new Map(), pauseRequests: new Set(),
    splitContentVariants: spin.splitContentVariants,
    cycleVariant: (values, i) => values[i % values.length] || '', renderSpinContent: text => text,
    firstNonEmptyString: value => value || '',
    resolveMediaSelection: async media => media.map(item => item.url),
    supabase: {
      listCampaignInputData: async () => details,
      getCampaign: async () => structuredClone(saved),
      updateCampaignInputData: async (id, patch) => Object.assign(details.find(item => item.id === id), patch)
    },
    updateCampaignAndBroadcast: async (_id, patch) => {
      stats.writes.push(structuredClone(patch))
      saved = { ...saved, ...structuredClone(patch) }
      return structuredClone(saved)
    },
    loadZaloFriendBlocklistContext: async () => null, getAdvancedContentConfigError: () => null,
    getServerZaloBoundaryReason: async () => ({ paused: false }), getAccountRunBlockReason: async () => null,
    resolveGroupPostApprovalForTarget: async () => ({}), checkActionDisabled: async () => null,
    checkActionLimitsForContinuation: async () => ({ runnableActionDescriptors: [], skippedLimitStatuses: [] }),
    getSkippedLimitActionCodeSet: () => new Set(), getAutomationPage: async () => ({ page: null, source: 'background' }),
    resolveGroupPostShareQuotaCapacity: async () => 0, buildGroupPostShareTargets: async () => [],
    beginCampaignRunUnit: async () => { stats.claimed = true; return true },
    settleActiveCampaignRunUnit: async () => { stats.claimed = false; return true },
    getInputDataDisplayName: (_campaign, detail) => detail.name, createBlockRuntimeHelpers: () => ({}),
    logMilestonesV2: async () => ({}), withZaloMessageOptOutWarnings: value => value,
    zaloMessageOptOutContextKey: (campaignId, inputId) => `${campaignId}:${inputId}`,
    getEffectiveSleepBetweenActions: () => 0,
    normalizeRuntimeError: (_campaign, _steps, error) => ({ errorCode: 'err_undefined', message: error }),
    handleCampaignBadTarget: async (_account, _campaign, _id, _code, _action, error) => {
      stats.errors.push(error.message)
      return { triggered: false }
    },
    applyRecentDeliveryCooldown: async () => ({ allowedInputDataIds: new Set(), pausedInputDataIds: new Set([1]) }),
    engineV2: { run: async (_workflowId, variables) => {
      assert.equal(stats.claimed, true, 'content is only published inside a claimed unit')
      stats.variables.push(structuredClone(variables))
      options.beforeResult?.(saved)
      return options.result || { status: 'completed', steps: [{
        blockName: options.mode === 'ui' ? 'fb_post_current_identity_ui' : 'fb_page_post_api',
        status: 'success', output: options.mode === 'ui' ? { posted: true } : { ok: true }
      }] }
    } }
  })
  return { scheduler, stats, saved: () => saved, run: async (statuses = ['chờ xử lý']) => {
    current = structuredClone(saved)
    details = statuses.map((status, i) => ({ id: i + 1, name: `Page ${i + 1}`, uid: `${100 + i}`, status }))
    await scheduler.executeCampaignV2({ id: 2, flatformType: 'facebook' }, current, 1, [], [])
    assert.equal(stats.claimed, false, 'claims settle on every path')
  } }
}

async function main() {
  const repeated = fixture()
  for (let i = 0; i < 43; i++) await repeated.run()
  assert.deepEqual(repeated.stats.variables.map(v => v.campaignContent),
    Array.from({ length: 43 }, (_, i) => `Content ${i % 42 + 1}`), 'one Page rotates across scheduled runs and wraps after 42')
  repeated.stats.variables.forEach((v, i) => assert.deepEqual(v.images, [`https://fixture.invalid/${i % 42 + 1}.jpg`], 'media follows the content variant'))
  assert.equal(repeated.saved().extraSettings.contentRotationIndex, 1)
  assert.deepEqual(repeated.stats.errors, [])

  const multiple = fixture({ extra: { copyContentFromSource: true, sourceLinks: 'https://fixture.invalid/a,https://fixture.invalid/b' } })
  await multiple.run(['hoàn thành', 'chờ xử lý', 'tạm dừng', 'chờ xử lý'])
  await multiple.run()
  assert.deepEqual(multiple.stats.variables.map(v => v.campaignContent), ['Content 1', 'Content 2', 'Content 3'], 'completed/skipped Pages do not consume content; source-link writes preserve the cursor')
  assert.deepEqual(multiple.stats.variables.map(v => v.sourceLink), ['https://fixture.invalid/a', 'https://fixture.invalid/b', 'https://fixture.invalid/a'])

  const simple = fixture({ simple: true, mode: 'ui' })
  for (let i = 0; i < 4; i++) await simple.run()
  assert.deepEqual(simple.stats.variables.map(v => v.campaignContent), ['First', 'Second', 'Third', 'First'])

  for (const result of [
    { status: 'completed', steps: [{ blockName: 'fb_page_post_api', status: 'success', output: { ok: false } }] },
    { status: 'completed', steps: [{ blockName: 'fb_post_current_identity_ui', status: 'success', output: { posted: false } }] },
    { status: 'failed', error: 'fixture failure', steps: [{ blockName: 'fb_page_post_api', status: 'error', output: { ok: true } }] },
    { status: 'cancelled', error: 'fixture cancelled', steps: [] },
    { status: 'completed', steps: [] }
  ]) {
    const failed = fixture({ result })
    await failed.run()
    assert.equal(failed.saved().extraSettings.contentRotationIndex, 0, 'no confirmed publish means no cursor advance')
    assert.equal(failed.stats.writes.length, 0)
  }
  const restoreFailure = fixture({ result: { status: 'failed', error: 'fixture restore failure', steps: [
    { blockName: 'fb_post_current_identity_ui', status: 'success', output: { posted: true } },
    { blockName: 'fb_switch_identity_by_name', status: 'error' }
  ] } })
  await restoreFailure.run()
  assert.equal(restoreFailure.saved().extraSettings.contentRotationIndex, 1, 'published content is consumed even if identity restoration fails')

  const blocked = fixture({ extra: { recentDeliveryCooldownEnabled: true } })
  await blocked.run()
  assert.equal(blocked.stats.variables.length, 0)
  assert.equal(blocked.stats.writes.length, 0, 'cooldown does not advance the cursor')

  const edited = fixture({ beforeResult: saved => { saved.extraSettings.contentRotationIndex = 12 } })
  await edited.run()
  assert.equal(edited.saved().extraSettings.contentRotationIndex, 12, 'a changed cursor is preserved')
  assert.equal(edited.stats.writes.length, 0)

  const timeline = fixture({ actionId: 'facebook_timeline_post' })
  await timeline.run([]); await timeline.run([])
  assert.deepEqual(timeline.stats.variables.map(v => v.campaignContent), ['Content 1', 'Content 2'])
  const other = fixture({ actionId: 'facebook_message_friend' })
  await other.run(['hoàn thành', 'chờ xử lý'])
  assert.equal(other.stats.variables[0].campaignContent, 'Content 2', 'other actions keep input-index selection')
  assert.equal(other.stats.writes.length, 0)

  for (const action of ['facebook_page_post', 'facebook_timeline_post']) {
    const original = { contentRotationIndex: 25, advancedContentItems: [{ content: 'snapshot' }] }
    const cloned = sanitizeClone(action, original)
    assert.equal(cloned.contentRotationIndex, 0, 'cloning starts at the first variant')
    assert.deepEqual(cloned.advancedContentItems, original.advancedContentItems)
    assert.equal(original.contentRotationIndex, 25, 'cloning preserves the source cursor')
  }

  console.log('PASS: 42-variant Fanpage rotation, content/media pairing, restart, multiple Pages/source links, API/UI success and failure, cooldown, cursor edits and other actions')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

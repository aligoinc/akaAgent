// Production repository -> IPC result -> store -> editor retry, with fake HTTP only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const compile = text => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
} }).outputText
const parse = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
const findNode = (node, predicate) => {
  if (predicate(node)) return node
  return ts.forEachChild(node, child => findNode(child, predicate))
}
const shared = {}
vm.runInNewContext(compile(read('src/shared/campaignConfigSave.ts')), { exports: shared, Error, WeakMap, Map })
const { CampaignConfigSaveError, createCampaignConfigSaver } = shared
const repoTree = parse('src/main/data/repositories/campaignRepository.ts')
const names = ['updateCampaign', 'smsMaterializationUpdateRequested', 'smsMaterializationTouched',
  'getSmsExtraSettingsMaterializationFingerprint', 'rematerializeSmsInputData']
const repoCode = compile(names.map(name => repoTree.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === name).getText(repoTree)).join('\n'))
const ipcTree = parse('src/main/ipc/handlers/campaignHandlers.ts')
const callback = findNode(ipcTree, node => ts.isCallExpression(node) &&
  node.expression.getText(ipcTree) === 'ipcMain.handle' &&
  node.arguments[0]?.getText(ipcTree) === 'IPC_EVENTS.DB_UPDATE_CAMPAIGN').arguments[1]
const ipcCode = compile(`exports.update = ${callback.getText(ipcTree)}`)
const storeTree = parse('src/renderer/src/stores/campaignStore.ts')
const storeWriter = findNode(storeTree, node => ts.isPropertyAssignment(node) &&
  node.name.getText(storeTree) === 'updateCampaign')
const storeCode = compile(`exports.store = { ${storeWriter.getText(storeTree)} }`)

function fixture(actionId = 'sms_send') {
  let version = 0
  const state = {
    row: { id: 91, staff_id: 1, is_delete: false, status: 'tạm dừng', updated_at: 'v0',
      runtime_claim_token: null, runtime_unit_token: null, action_id: actionId, content: 'old',
      schedule: '2026-10-17T01:00:00Z', extra_settings: {} },
    inputs: [11, 12].map(id => ({ id, campaign_id: 91, is_delete: false, status: 'chờ xử lý', content: 'old' })),
    configWrites: 0, inputWrites: 0, inputFailures: 1, legacyPauses: 0, ipcArgs: [], refreshes: 0
  }
  const map = row => ({ ...row, actionId: row.action_id, updatedAt: row.updated_at,
    originalSchedule: row.original_schedule, extraSettings: row.extra_settings })
  const repo = {}
  const scope = {
    exports: repo, CampaignConfigSaveError, Error, console: { error() {} },
    Date: class extends Date { constructor() { super(1700000000000 + version++) } },
    requireCurrentUser: () => ({ staffId: 1, organizationId: 7 }),
    SMS_SEND_ACTION_ID: 'sms_send', VOICE_CALL_ACTION_ID: 'voice_call', CAMPAIGN_SELECT: '*',
    isMobileManagedSmsCampaignAction: action => ['sms_send', 'voice_call'].includes(action),
    touchesRestrictedCampaignConfig: () => false,
    getCampaignActionIdForCurrentUser: async () => state.row.action_id,
    getCampaignExtraSettingsForCurrentUser: async () => state.row.extra_settings,
    loadCurrentUserEffectiveEntitlements: async () => ({}),
    clampCampaignExtraSettingsDailyLimits: value => value,
    assertAdvancedContentPersistenceContract() {}, getAdvancedContentItems: extra => extra?.advancedContentItems || [],
    mapCampaignFromDB: map,
    listCampaignInputData: async () => state.inputs,
    renderMobileManagedInputContent: campaign => `${campaign.content}:${campaign.extraSettings.smsUseUnicode === true}`,
    normalizeCampaignInputPhoneCarrier: () => null,
    pauseCampaignAfterMobileContentUpdateFailure: async () => { state.legacyPauses++; return true },
    getMobileContentUpdateFailureMessage: () => 'legacy materialization failure',
    client: () => ({ from: table => {
      let patch
      const filters = []
      const run = async () => {
        const candidates = table === 'auto_campaigns' ? [state.row] : state.inputs
        const matches = candidates.filter(row => filters.every(test => test(row)))
        if (!matches.length) return { data: null, error: { message: 'version/ownership conflict' } }
        if (table === 'auto_campaign_input_data') {
          state.inputWrites++
          if (matches[0].id === 12 && state.inputFailures-- > 0) return { error: { message: 'input write failed' } }
        } else state.configWrites++
        matches.forEach(row => Object.assign(row, patch))
        return { data: { ...matches[0] }, error: null }
      }
      const query = {
        update: value => (patch = value, query),
        eq: (key, value) => (filters.push(row => row[key] === value), query),
        is: (key, value) => (filters.push(row => row[key] === value), query),
        in: (key, values) => (filters.push(row => values.includes(row[key])), query),
        select: () => query, single: run, then: (resolve, reject) => run().then(resolve, reject)
      }
      return query
    } })
  }
  vm.runInNewContext(repoCode, scope)
  const ipc = {}
  vm.runInNewContext(ipcCode, {
    exports: ipc, CampaignConfigSaveError, Error,
    isStatusOnlyCampaignUpdate: () => false,
    assertCanUpdateCampaignFromRenderer: async () => {},
    realtimeRefreshController: { refreshSoon() { state.refreshes++ } },
    supabase: {
      updateCampaign: repo.updateCampaign,
      getCampaignConfig: async () => ({ editReady: state.row.status === 'tạm dừng' &&
        state.row.runtime_claim_token === null && state.row.runtime_unit_token === null })
    }
  })
  const store = {}
  vm.runInNewContext(storeCode, {
    exports: store, CampaignConfigSaveError, campaignSourcesInvalidationVersion: 0,
    set: callback => callback({ campaignConfigs: {}, campaignLogs: {} }),
    get: () => ({ loadCampaigns: async () => {} }),
    window: { electronAPI: { updateCampaign: async (...args) => {
      state.ipcArgs.push(args)
      // Structured clone represents the Electron boundary: no custom Error fields.
      return structuredClone(await ipc.update(null, ...args))
    } } }
  })
  return { state, repo, save: createCampaignConfigSaver(store.store.updateCampaign) }
}

async function main() {
  for (const action of ['sms_send', 'voice_call']) {
    const { state, save } = fixture(action)
    const session = new AbortController()
    await assert.rejects(save(91, { content: 'new' }, 'v0', session.signal), CampaignConfigSaveError)
    assert.equal(state.row.content, 'new')
    assert.equal(state.legacyPauses, 0)
    const committed = state.row.updated_at
    await save(91, { content: 'new' }, 'v0', session.signal)
    assert.equal(state.ipcArgs[1][3], committed, 'retry uses only its own committed version')
    assert.equal(state.inputs.every(row => row.content === 'new:false'), true)
    assert.equal(state.row.status, 'tạm dừng', 'config retry never resumes')
  }

  // Identical extraSettings would normally skip SMS materialization on retry.
  for (const patch of [{ extraSettings: { smsUseUnicode: true } }, { schedule: '2026-10-18T02:00:00Z' }]) {
    const { state, save } = fixture()
    const session = new AbortController()
    state.inputFailures = 2
    await assert.rejects(save(91, patch, 'v0', session.signal), CampaignConfigSaveError)
    await assert.rejects(save(91, { extraSettings: state.row.extra_settings }, 'v0', session.signal), CampaignConfigSaveError)
    await save(91, { extraSettings: state.row.extra_settings }, 'v0', session.signal)
    assert.equal(state.inputWrites, 6, 'all pending inputs retried even when settings now match')
    if (patch.schedule) assert(state.inputs.every(row => row.schedule === patch.schedule), 'keep original schedule retry intent')
  }

  for (const change of [{ updated_at: 'other-editor', content: 'other-editor' }, { status: 'chờ xử lý' },
    { runtime_claim_token: 'other-owner' }, { runtime_unit_token: 'other-unit' }, { staff_id: 2 }, { is_delete: true }]) {
    const { state, save } = fixture()
    const session = new AbortController()
    await assert.rejects(save(91, { content: 'new' }, 'v0', session.signal), CampaignConfigSaveError)
    Object.assign(state.row, change)
    const writes = state.inputWrites
    await assert.rejects(save(91, { content: 'retry' }, 'v0', session.signal), /conflict|tạm dừng/)
    assert.equal(state.configWrites, 1)
    assert.equal(state.inputWrites, writes)
  }

  const { state, save } = fixture()
  const first = new AbortController()
  await assert.rejects(save(91, { content: 'new' }, 'v0', first.signal), CampaignConfigSaveError)
  await assert.rejects(save(91, { content: 'second editor' }, 'v0', new AbortController().signal), /conflict/)
  first.abort()
  await assert.rejects(save(91, { content: 'closed' }, 'v0', first.signal), /đã đóng/)
  assert.equal(state.configWrites, 1)

  // An ordinary write failure must not advance the form's expected version.
  const conflict = fixture()
  conflict.state.row.updated_at = 'other-editor'
  const session = new AbortController()
  await assert.rejects(conflict.save(91, { content: 'new' }, 'v0', session.signal), /conflict/)
  await assert.rejects(conflict.save(91, { content: 'new' }, 'v0', session.signal), /conflict/)
  assert.equal(conflict.state.configWrites, 0)

  // A response arriving after close/logout must not grant the next editor a retry version.
  let failLate
  const lateOptions = []
  const saveLate = createCampaignConfigSaver(async (_id, _patch, options) => {
    lateOptions.push(options)
    if (lateOptions.length === 1) await new Promise((_resolve, reject) => { failLate = reject })
  })
  const closed = new AbortController()
  const pending = saveLate(91, { content: 'new' }, 'v0', closed.signal)
  closed.abort()
  failLate(new CampaignConfigSaveError({ code: 'campaign_input_materialization_failed', campaignId: 91,
    updatedAt: 'late-version', updateSmsSchedule: true, message: 'late failure' }))
  await assert.rejects(pending, /late failure/)
  await saveLate(91, { content: 'new session' }, 'v0', new AbortController().signal)
  assert.equal(lateOptions[1].expectedUpdatedAt, 'v0')
  assert.equal(lateOptions[1].retrySmsInputSchedule, undefined)

  const legacy = fixture()
  await assert.rejects(legacy.repo.updateCampaign(91, { content: 'new' }), /legacy materialization failure/)
  assert.equal(legacy.state.legacyPauses, 1, 'legacy/internal callers keep the old failure contract')
  console.log('PASS SMS/voice: partial writes retry through repository/IPC/store; repeated failures, unchanged settings, schedule intent, version/ownership conflicts, separate editors, closed session and legacy behavior')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

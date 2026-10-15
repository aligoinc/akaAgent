const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

// Execute the actual form continuation with isolated IPC. No database or runtime.
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx'), 'utf8')
const start = source.indexOf('      let nextMainItemIndex = 0')
const end = source.indexOf('\n    } catch (err) {', start)
assert(start > 0 && end > start)
const compiled = ts.transpileModule(`async function save() { ${source.slice(start, end)} } save()`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText

async function fixture(status, failConfig = false, cancel = false) {
  const calls = { config: 0, preflight: 0, bind: 0, links: 0, resume: 0, success: 0 }
  const session = new AbortController()
  let completion = null
  let storedVersion = 'version-from-form'
  const savedIds = []
  const scope = {
    saveSignal: session.signal,
    campaign: { id: 91, dataGroupId: 3, updatedAt: storedVersion },
    saveBundleItems: [{ campaignPayload: { name: 'edited', dataTargetSourceMode: 'data_group', dataGroupId: 4 }, details: [] }],
    campaignWorkItemCount: 1, creationBundle: null, isEditingSavedCampaign: true,
    savedCampaignIds: savedIds, savedCampaignPayloadById: new Map(), saveRequestId: 'stable-bind-request',
    isFindDataCampaign: false, targetFindDataField: null,
    selectedSaveStatus: status, savedDraftForCreation: null, emptySnapshotCampaigns: [],
    dataGroupBundleRequestIdRef: { current: null }, dataGroupBundleFingerprintRef: { current: null }, dataGroupBundleRetryStorageKey: null,
    clearStoredDataGroupBundleRequestId() {}, updateCampaignWorkProgress() {}, updateCampaignWorkPhase() {},
    completeCampaignLinkSyncProgress() {}, updateSaveProgress() {}, setTimeout() {}, onClose() {},
    showAlert() { calls.success++ },
    loadCampaigns: async () => {}, resumeStagedCampaigns: async () => {},
    updateCampaign: async (_id, _patch, options) => {
      calls.config++
      assert.equal(options.requireEditReady, true)
      assert.equal(options.expectedUpdatedAt, storedVersion, 'must never replay the committed config with the old version')
      if (failConfig) throw Error('config conflict')
      storedVersion = 'committed-version'
    },
    saveCampaignConfig: async (id, patch, expectedUpdatedAt) => scope.updateCampaign(id, patch, {
      refresh: false, requireEditReady: true, expectedUpdatedAt
    }),
    window: { electronAPI: {
      preflightCampaignDataGroupChange: async () => { calls.preflight++; return { allowed: true } },
      bindCampaignDataGroupSource: async request => {
        calls.bind++
        assert.equal(request.requestId, 'stable-bind-request:91')
        assert.equal(request.groupId, 4)
        if (calls.bind === 1) throw Error('bind failed')
      }
    } },
    syncFindDataSourceCampaignLinks: async ids => {
      calls.links++
      assert.deepEqual(ids, [91])
      if (calls.links === 1) throw Error('links failed')
    },
    resumeAfterCampaignSave: async ids => {
      calls.resume++
      assert.deepEqual(Array.from(ids), [91])
      assert.equal(calls.links, 2, 'resume only after all link writes succeed')
      if (calls.resume === 1) throw Error('resume failed')
    },
    saveCompletion: {
      checkpoint(action) { completion = action },
      async finish(action) { completion = action; await action(); completion = null }
    }
  }
  const initial = vm.runInNewContext(compiled, scope)
  await assert.rejects(initial, failConfig ? /config conflict/ : /bind failed/)
  if (failConfig) { assert.equal(completion, null); return }
  assert.equal(typeof completion, 'function')
  assert.equal(calls.resume, 0)
  if (cancel) {
    session.abort()
    await scope.saveCompletion.finish(completion)
    assert.deepEqual(calls, { config: 1, preflight: 1, bind: 1, links: 0, resume: 0, success: 0 })
    return
  }
  await assert.rejects(scope.saveCompletion.finish(completion), /links failed/)
  assert.equal(calls.config, 1)
  if (status === 'chờ xử lý') {
    await assert.rejects(scope.saveCompletion.finish(completion), /resume failed/)
    assert.equal(calls.config, 1)
    assert.equal(calls.bind, 2)
  }
  await scope.saveCompletion.finish(completion)
  assert.equal(completion, null)
  assert.deepEqual(calls, { config: 1, preflight: 1, bind: 2, links: 2, resume: status === 'chờ xử lý' ? 2 : 0, success: 1 })
  assert.deepEqual(savedIds, [91])
}

async function linkedDraftFixture() {
  const start = source.indexOf('      const savedLinkedDraftItems = new Map')
  const end = source.indexOf('      const patchSavedSourceCampaignTargets', start)
  assert(start > 0 && end > start)
  const code = ts.transpileModule(`${source.slice(start, end)}\nexports.persist = persistDraftByTempId`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const calls = []; const exports = {}
  const draft = { tempId: -1, items: [1, 2].map(id => ({ campaignPayload: { name: `child-${id}` }, details: [] })) }
  vm.runInNewContext(code, {
    exports, preparedLinkedDrafts: new Map([[-1, draft]]), linkedDraftProgressStartIndexByTempId: new Map(),
    createCampaignWithInputDataSafely: async payload => {
      calls.push(payload.name)
      if (calls.length === 2) throw Error('second linked campaign failed')
      return { id: payload.name === 'child-1' ? 201 : 202 }
    }
  })
  await assert.rejects(exports.persist(-1), /second linked/)
  assert.deepEqual(Array.from(await exports.persist(-1)), [201, 202])
  assert.deepEqual(Array.from(await exports.persist(-1)), [201, 202])
  assert.deepEqual(calls, ['child-1', 'child-2', 'child-2'])
}

;(async () => {
  await fixture('tạm dừng', true)
  await fixture('tạm dừng')
  await fixture('chờ xử lý')
  await fixture('chờ xử lý', false, true)
  await linkedDraftFixture()
  console.log('PASS actual Desktop form: initial CAS failure stays editable; bind/link retries skip committed config; resume waits for links; linked drafts are not recreated')
})().catch(error => { console.error(error); process.exitCode = 1 })

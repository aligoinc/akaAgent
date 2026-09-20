// Exercise the actual scheduler and Local/Server runtime methods with isolated adapters.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cache = new Map()
let zca
function load(file) {
  const absolute = path.resolve(root, file)
  if (cache.has(absolute)) return cache.get(absolute)
  const exports = {}; cache.set(absolute, exports)
  const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  new Function('exports', 'require', compiled)(exports, name => name === 'zca-js' ? zca
    : name.startsWith('.') ? load(path.resolve(path.dirname(absolute), name + '.ts')) : require(name))
  return exports
}
function harness(file, className, names, globals) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className)
  const methods = names.map(name => {
    const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
    assert.ok(method, name); return method.getText(source)
  }).join('\n')
  const compiled = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(globals), compiled + '; return Harness')(...Object.values(globals))
}
async function main() {
  zca = await import('zca-js')
  const html = load('src/shared/formattedContent.ts')
  const spin = load('src/shared/contentSpin.ts')
  const { convertHtmlToZaloMessage } = load('src/main/services/zaloFormattedContent.ts')
  const { buildZaloForwardMessageInfo } = load('src/shared/zaloForwardMessage.ts')
  const Runtime = harness('src/main/services/zaloRuntimeService.ts', 'ZaloRuntimeService', [
    'forwardMessageToUsers', 'forwardMessageToGroups', 'forwardMessage', 'forwardMessageRaw', 'normalizeForwardMessageResult'
  ], { ...zca, buildZaloForwardMessageInfo, ZALO_MESSAGE_SEND_TIMEOUT_MS: 90000,
    normalizeRecord: value => value && typeof value === 'object' ? value : {} })
  const Scheduler = harness('src/main/services/campaignScheduler.ts', 'CampaignScheduler', [
    'shouldUseZaloShareMessageBatch', 'isFormattedContentCampaign', 'getZaloShareMessageForBatch',
    'getZaloOutgoingMessageText', 'processZaloShareMessageBatch', 'findZaloForwardTargetResult',
    'executeZaloShareMessageBatchCampaign'
  ], { ...html, ...spin, convertHtmlToZaloMessage, isRecentDeliveryCooldownEnabled: () => false,
    ZALO_MESSAGE_SEND_MODE_SHARE: 'share', ZALO_MESSAGE_FRIEND_ACTION_ID: 'zalo_message_friend', ZALO_MESSAGE_GROUP_ACTION_ID: 'zalo_message_group',
    callAiUsing: () => { throw new Error('Rich share must not call AI') } })
  for (const isGroup of [false, true]) {
    const calls = []
    const api = { zpwServiceMap: { file: ['https://zalo.invalid'] }, getOwnId: () => 'self',
      custom(name, callback) { this[name] = props => callback({ props, ctx: { imei: 'fixture' }, utils: {
        makeURL: url => url, encodeAES: raw => raw, resolve: response => response,
        request: async (url, options) => {
          const params = JSON.parse(options.body.get('params')); calls.push({ url, params })
          const targets = params.grids || params.toIds
          return { success: targets.slice(0, 45).map(row => ({ clientId: String(row.clientId) })),
            fail: targets.slice(45).map(row => ({ clientId: String(row.clientId), error_code: '123' })) }
        }
      } }) }
    }
    const runtime = Object.assign(new Runtime(), { ensureApi: async () => api, withTimeout: async promise => promise })
    const scheduler = Object.assign(new Scheduler(), {
      zaloRuntime: runtime, renderSpinContent: value => spin.renderContentSpin(value, { rng: () => 0 }),
      getZaloRuntimeStopReason: () => null, markCampaignRunUnitStarted: () => {},
      createZaloShareSuccessDetail: () => ({ status: 'thành công' }),
      createZaloForwardFailureDetail: async (...args) => { assert.equal(args.at(-1), 'target-only'); return { status: 'lỗi', countsTowardBadTarget: false } },
      recordZaloShareActionDetail: async (_campaign, _detail, _id, result) => result,
      updateZaloShareInputStatus: async () => {}, resetCampaignBadTargetCount: async () => {},
      normalizeZaloDetailStatus: value => value, logCampaignProgress: async () => {}
    })
    const campaign = { id: 1, actionId: isGroup ? 'zalo_message_group' : 'zalo_message_friend',
      extraSettings: { formattedContentEnabled: true, zaloMessageSendMode: 'share', rewriteContentEachRun: true } }
    assert.equal(scheduler.shouldUseZaloShareMessageBatch(campaign), true)
    const message = await scheduler.getZaloShareMessageForBatch({}, campaign, '<p><strong>{Chào|Hi} 😀 #{FULL_NAME}</strong></p>')
    assert.deepEqual(message, { msg: 'Chào 😀 #{FULL_NAME}', styles: [{ start: 0, len: 20, st: 'b' }] })
    const batch = Array.from({ length: 50 }, (_, index) => ({ detail: { id: index + 1 }, threadId: String(index + 1), target: {}, inputData: {} }))
    const result = await scheduler.processZaloShareMessageBatch({ id: 1 }, campaign, batch, [], { code: campaign.actionId }, message, [], new Map())
    assert.equal(result.stopAfterBatch, false)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].params.totalIds, 50)
    assert.ok(calls[0].url.endsWith(`/api/${isGroup ? 'group' : 'message'}/mforward`))
    assert.deepEqual(JSON.parse(calls[0].params.msgInfo), { message: message.msg, rtfProps: JSON.stringify({ styles: message.styles, ver: 0 }) })
    assert.equal(new Set((calls[0].params.grids || calls[0].params.toIds).map(row => row.clientId)).size, 50)
    if (!isGroup) {
      const self = await runtime.forwardMessageToUsers(1, ['self', 'friend'], ' plain ')
      assert.equal(self.results[0].errorCode, '114')
      assert.deepEqual(JSON.parse(calls[1].params.msgInfo), { message: 'plain' })
      assert.equal(calls[1].params.totalIds, 1)
    }
    const forwardsBeforeMedia = calls.length
    let mediaSends = 0
    runtime.sendMessageToUser = runtime.sendMessageToGroup = async () => { mediaSends++; return {} }
    const mediaOnly = await scheduler.processZaloShareMessageBatch({ id: 1 }, campaign, batch, [], { code: campaign.actionId }, { msg: '' }, ['/tmp/fixture.jpg'], new Map())
    assert.equal(mediaOnly.stopAfterBatch, false)
    assert.equal(mediaSends, 50)
    assert.equal(calls.length, forwardsBeforeMedia)

    for (const formatted of [false, true]) {
      const value = { ...campaign, extraSettings: { ...campaign.extraSettings, formattedContentEnabled: formatted, rewriteContentEachRun: false } }
      for (const [raw, expected] of [
        ['{|Hi}', 'Hi'], ['{   |Hi}', 'Hi'], ['{|{ |Hi}}', 'Hi'], ['{|}{|Hi}', 'Hi'],
        ['{|Hi\\|there}', 'Hi|there'], ['{|#{FULL_NAME}}', '#{FULL_NAME}'],
        ['Xin chào {|bạn}', 'Xin chào'], ['{ |{|\n}}', '']
      ]) {
        const rendered = await scheduler.getZaloShareMessageForBatch({}, value, formatted ? `<p><strong>${raw}</strong></p>` : raw)
        assert.equal(scheduler.getZaloOutgoingMessageText(rendered).trim(), expected)
        if (formatted && expected === 'Hi') assert.deepEqual(rendered.styles, [{ start: 0, len: 2, st: 'b' }])
      }
      for (const server of [false, true]) {
        for (const advanced of [false, true]) {
          for (const scenario of ['fallback', 'media', 'all-empty']) {
            const raw = scenario === 'all-empty' ? '{ |{ |}}' : '{|Hi}'
            const content = formatted ? `<p><strong>${raw}</strong></p>` : raw
            const attachments = scenario === 'media' ? ['/tmp/fixture.jpg'] : []
            const details = batch.map(item => ({ ...item.detail, status: 'chờ xử lý' }))
            const recorded = [], updates = [], campaignUpdates = []
            let claims = 0, completions = 0, releases = 0, cleanups = 0
            const before = calls.length, mediaBefore = mediaSends
            const execution = Object.assign(new Scheduler(), scheduler, {
              running: true, isServerZaloCampaign: () => server,
              getZaloShareMessageActionDescriptor: () => ({ code: value.actionId }),
              shouldUseAdvancedContent: () => advanced, getAdvancedContentConfigError: () => null,
              getRawCampaignContentForIndex: () => content, resolveCampaignMediaForIndex: async () => attachments,
              stopCampaignAtRunBoundaryIfNeeded: async () => false, finalizeDataGroupCampaignAtHardEnd: async () => false,
              requiresDataGroupHardEndCheck: () => false, getServerZaloBoundaryReason: async () => ({ paused: false }),
              supabase: { getCampaign: async () => ({ status: 'đang chạy' }), getZaloServerRunControlState: async () => ({}) },
              isCampaignPauseRequested: () => false, getAccountRunBlockReason: async () => null,
              getZaloShareMessageBatchCapacity: async () => ({ ok: true, capacity: 50 }),
              isZaloFriendBlockedByBlocklist: () => false, preflightZaloMessageOptOut: async () => ({ blocked: false }),
              createZaloShareMessageTarget: (_campaign, detail) => ({ detail, threadId: String(detail.id), target: {}, inputData: {} }),
              resolveZaloFriendMessageTarget: async () => ({}), upsertZaloResolvedProfileTarget: async () => {},
              beginCampaignRunUnit: async () => { claims++; return true }, settleActiveCampaignRunUnit: async () => true,
              handleCampaignCompletion: async () => { completions++ }, releaseRunningAccount: async () => { releases++ },
              cleanupCampaignMediaTempFiles: () => { cleanups++ }, isCampaignMediaResolveError: () => false,
              updateRunningCampaignAndBroadcast: async (_id, patch) => { campaignUpdates.push(patch) },
              recordZaloShareActionDetail: async (_campaign, _detail, _id, result) => { recorded.push(result); return result },
              updateZaloShareInputStatus: async (...args) => { updates.push(args) }
            })
            await execution.executeZaloShareMessageBatchCampaign({ id: 1 }, value, details, [], [], null)
            assert.equal(releases, 1); assert.equal(cleanups, 1)
            if (scenario === 'all-empty') {
              assert.equal(calls.length, before); assert.equal(mediaSends, mediaBefore)
              assert.equal(claims, 0); assert.equal(completions, 0)
              assert.equal(recorded.length, 0); assert.equal(updates.length, 0)
              assert.ok(details.every(detail => detail.status === 'chờ xử lý'))
              assert.deepEqual(campaignUpdates, [{ status: 'chờ xử lý', note: 'Vui lòng nhập nội dung hoặc chọn media để gửi Zalo' }])
            } else {
              assert.equal(claims, 1); assert.equal(completions, 1)
              assert.equal(recorded.length, 50); assert.equal(updates.length, 50)
              assert.equal(calls.length - before, scenario === 'fallback' ? 1 : 0)
              assert.equal(mediaSends - mediaBefore, scenario === 'media' ? 50 : 0)
              if (scenario === 'fallback') {
                assert.equal(calls[before].params.totalIds, 50)
                assert.deepEqual(JSON.parse(calls[before].params.msgInfo), formatted
                  ? { message: 'Hi', rtfProps: JSON.stringify({ styles: [{ start: 0, len: 2, st: 'b' }], ver: 0 }) }
                  : { message: 'Hi' })
              }
            }
          }
        }
      }
    }
    const wholeMessage = await scheduler.getZaloShareMessageForBatch({}, campaign, '<p><strong>Hello</strong><em>{|Hi}</em></p>')
    assert.deepEqual(wholeMessage, { msg: 'Hello', styles: [{ start: 0, len: 5, st: 'b' }] })
    const recomputed = await scheduler.getZaloShareMessageForBatch({}, campaign, '<p><strong>{|}</strong><em>{|Hi}</em></p>')
    assert.deepEqual(recomputed, { msg: 'Hi', styles: [{ start: 0, len: 2, st: 'i' }] })
  }
  const rich = { msg: '  😀 Đậm cuối \n', styles: [{ start: 2, len: 6, st: 'b' }, { start: 0, len: 50, st: 'ind_$', indentSize: 2 }] }
  assert.deepEqual(JSON.parse(buildZaloForwardMessageInfo(rich).rtfProps), { styles: [{ start: 0, len: 6, st: 'b' }, { start: 0, len: 11, st: 'ind_20' }], ver: 0 })
  console.log('PASS: Local/Server friend/group share, 50-target forwards, empty-spin recovery, optional branches, media-only, all-empty inputs, advanced content, mixed results and UTF-16 styles')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

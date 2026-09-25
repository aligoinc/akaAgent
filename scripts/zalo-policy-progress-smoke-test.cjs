// Real scheduler methods with in-memory adapters; no DB or Zalo commands.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const sourceText = fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8')
const source = ts.createSourceFile('scheduler.ts', sourceText, ts.ScriptTarget.Latest, true)
const schedulerClass = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CampaignScheduler')
const compile = code => ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText
function methods(names, globals = {}) {
  const code = names.map(name => {
    const node = schedulerClass.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(source) === name)
    assert(node, name)
    return node.getText(source)
  }).join('\n')
  return new Function(...Object.keys(globals), compile('class Harness {' + code + '}') + ';return Harness')(...Object.values(globals))
}
const formatModule = {exports: {}}
new Function('exports', compile(fs.readFileSync(path.join(root, 'src/shared/campaignLogFormat.ts'), 'utf8')))(formatModule.exports)
const Harness = methods([
  'recordZaloShareActionDetail', 'formatZaloProgressLog', 'logCampaignProgress',
  'createMilestoneSummary', 'getZaloActionDetailFromStep', 'logZaloMessagePhoneMilestones'
], {formatCampaignLogMessage: formatModule.exports.formatCampaignLogMessage, ZALO_FIND_PHONE_ACTION_CODE: 'zalo_find_phone_user'})

async function verifyStopNotes() {
  const StopHarness = methods([
    'handleCampaignBadTarget', 'applyRuntimeErrorPolicy', 'completePauseAtBoundary', 'completeCampaignPause',
    'updateUnclaimedCampaignPreflightNote', 'stopCampaignForAccountCondition'
  ], { PAGE_INBOX_MESSAGE_ACTION_ID: 'facebook_page_inbox_message', recordAccountLog() {}, IPC_EVENTS: {} })
  for (const runtime of ['desktop', 'server']) {
    let count = 0
    const campaign = {id: 10, name: 'Campaign', status: 'đang chạy', note: null, actionId: 'zalo_message_group'}
    const logs = [], writes = []
    const policy = {errorCode: 'err_undefined', notiCampaign: 'Có lỗi xảy ra', notiRunningProcess: 'Có lỗi xảy ra',
      countConsecutiveErrors: 5, updateStatusCampaign: 'tạm dừng', disableActionCodes: []}
    const h = Object.assign(new StopHarness(), {
      supabase: {
        getErrorPolicy: async () => policy,
        incrementCampaignBadTargetCount: async () => ({countConsecutiveBadTargets: ++count}),
        getCampaign: async () => ({...campaign}),
        getZaloServerRunControlState: async () => ({campaignStatus: campaign.status, accountStatus: 'đang chạy'})
      },
      runCampaignErrorPolicy: async (_id, operation) => operation(),
      getPolicyThreshold: p => p?.countConsecutiveErrors,
      renderPolicyMessage: template => template || '', addActionContextToMessage: message => message,
      diagnoseUndefinedErrorWithScreenshot: async () => null,
      updateErrorPolicyCampaign: async (_campaign, updates) => {writes.push(updates); Object.assign(campaign, updates)},
      updateCampaignAndBroadcast: async (_id, updates) => {Object.assign(campaign, updates); return {...campaign}},
      logCampaignProgress: async (_campaign, message) => logs.push(message),
      settleActiveCampaignRunUnit: async () => true, releaseRunningAccount: async () => {},
      isServerZaloCampaign: () => runtime === 'server', broadcastCampaignUpdate() {},
      pauseRequests: new Set(), serverZaloPauseBoundaries: new Map(), mainWindow: {webContents: {send() {}}}
    })
    for (let i = 1; i <= 5; i++) {
      const result = await h.handleCampaignBadTarget({id: 20}, campaign, i, 'err_undefined', 'zalo_message_group',
        {message: 'Nhắn nhóm thất bại', thresholdReason: 'Người nhận chặn tin nhắn'})
      assert.equal(result.triggered, i === 5, runtime)
      if (i < 5) {
        assert.equal(campaign.note, null)
        assert.equal(writes.length, 0)
      } else {
        assert.match(campaign.note, /5.*liên tiếp.*Người nhận chặn tin nhắn/, runtime)
        assert.equal(result.message, campaign.note, 'batch stop result must carry the complete note')
        const savedNote = campaign.note
        await h.completePauseAtBoundary({id: 20}, campaign, savedNote)
        assert.equal(campaign.note, savedNote, 'final pause must preserve the reason')
      }
    }
    assert(logs.includes('⚠️ Chiến dịch đã lỗi/thất bại liên tiếp 5 lần: Người nhận chặn tin nhắn'))
    assert(logs.includes('⚠️ Dừng chiến dịch "Campaign": Có lỗi xảy ra'), 'existing policy log stays unchanged')

    // Engine failures provide message without a separate thresholdReason.
    count = 4
    campaign.status = 'đang chạy'
    await h.handleCampaignBadTarget({id: 20}, campaign, 6, 'err_undefined', undefined,
      {message: 'Không đọc được kết quả hành động'})
    assert.match(campaign.note, /5.*Không đọc được kết quả hành động/)

    // Keep the existing one-retry rule for Page inbox: 5 => retry, 10 => stop.
    count = 4
    campaign.actionId = 'facebook_page_inbox_message'
    await h.handleCampaignBadTarget({id: 20}, campaign, 7, 'err_undefined', undefined, {message: 'Hộp thư lỗi'})
    assert.equal(campaign.status, 'chờ xử lý')
    assert.match(campaign.note, /Tự chạy lại thêm 1 lần sau 5/)
    count = 9
    campaign.status = 'đang chạy'
    await h.handleCampaignBadTarget({id: 20}, campaign, 8, 'err_undefined', undefined, {message: 'Hộp thư lỗi'})
    assert.equal(campaign.status, 'tạm dừng')
    assert.match(campaign.note, /10.*ngưỡng 10.*Hộp thư lỗi/)
    campaign.actionId = 'zalo_message_group'

    // An account pause can arrive during the same target/batch as a lock policy.
    campaign.status = 'đang chạy'
    const policyNote = 'Policy 120: xem thời điểm mở khóa trong tài khoản'
    h.supabase.getZaloServerRunControlState = async () => ({campaignStatus: 'đang chạy', accountStatus: 'tạm dừng'})
    await h.completePauseAtBoundary({id: 20}, campaign, policyNote)
    assert.equal(campaign.note, policyNote, `${runtime}: pause must not erase the policy note`)
    campaign.status = 'đang chạy'
    await h.completePauseAtBoundary({id: 20}, campaign)
    assert.equal(campaign.note, null, 'manual pause without a policy retains existing behavior')

    logs.length = 0
    h.supabase.updatePendingUnclaimedCampaignNote = async (_id, _revision, note) => ({...campaign, note})
    await h.updateUnclaimedCampaignPreflightNote(campaign, policyNote)
    h.supabase.updatePendingUnclaimedCampaignNote = async () => null
    await h.updateUnclaimedCampaignPreflightNote(campaign, policyNote)
    assert.deepEqual(logs, [`⚠️ Chưa thể chạy chiến dịch: ${policyNote}`], 'only the successful CAS may log a blocked preclaim')
    const sessionNote = 'Zalo đã bị đăng xuất. Vui lòng đăng nhập lại để chiến dịch chạy tiếp'
    h.supabase.getErrorPolicy = async () => ({...policy, updateStatusCampaign: null,
      notiCampaign: null, notiRunningProcess: 'Tài khoản bị đăng xuất'})
    await h.stopCampaignForAccountCondition({id: 20}, campaign, 'Tài khoản bị đăng xuất', sessionNote)
    assert.equal(campaign.note, sessionNote, 'account guard retains the recovery guidance of policy 600')
    assert(logs.includes('⚠️ Dừng chiến dịch "Campaign": Tài khoản bị đăng xuất'), 'existing logout log stays unchanged')
  }
}

async function main() {
  await verifyStopNotes()
  const campaign = {id: 10, name: 'Campaign', accountId: 20, accountName: 'Account', extraSettings: {}}
  for (const status of [null, 'thất bại', 'thành công']) {
    const stored = [], details = [], emitted = []
    const h = Object.assign(new Harness(), {
      supabase: {
        appendCampaignLog: async (_id, message) => { stored.push(message); return campaign },
        createCampaignDetail: async detail => { details.push(detail); return detail }
      },
      broadcastCampaignUpdate() {}, sendLog: (message, _action, context) => emitted.push({message, ...context}),
      getAccountActionName: code => code, pushZaloDetailToExternalSmsIfNeeded: async () => {}
    })
    const action = {actionCode: 'zalo_message_group', actionName: 'Nhắn tin nhóm', status,
      createDetail: status !== null, log: status === 'thành công' ? 'Đã gửi tin' : 'Bị hạn chế nhắn nhóm (221)',
      countsTowardLimit: false, countsTowardBadTarget: false}
    const batchLogs = new Set()
    await h.recordZaloShareActionDetail(campaign, {id: 1}, 20, action, batchLogs)
    await h.recordZaloShareActionDetail(campaign, {id: 2}, 20, action, batchLogs)
    assert.equal(details.length, status === null ? 0 : 2)
    assert.equal(stored.length, status === 'thành công' ? 0 : 1, 'identical batch failures log once; success stays aggregate-only')
    if (status !== 'thành công') {
      assert(stored[0].includes('221'))
      assert.equal(emitted[0].accountId, campaign.accountId)
    }
    stored.length = 0
    await h.logZaloMessagePhoneMilestones(campaign, {id: 1}, 20, [{blockName: 'zalo_message_group', output: {detail: action}}])
    assert.equal(stored.length, 1, 'normal path must retain one existing action log')
    assert.equal(stored[0], `${status ? '' : '⚠️ '}Nhắn tin nhóm: ${action.log}`)
  }

  const events = []
  const h = Object.assign(new Harness(), {
    supabase: {appendCampaignLog: async () => {throw new Error('mock DB outage')}},
    sendLog: (message, _action, context) => events.push({message, ...context})
  })
  const originalError = console.error
  console.error = () => {}
  try {
    await h.logCampaignProgress(campaign, 'Existing error text')
    await h.logCampaignProgress(campaign, 'Stored-only entry', {emitRealtime: false})
  } finally { console.error = originalError }
  assert.equal(events.length, 1)
  assert.equal(events[0].accountId, 20, 'fallback survives the account filter')
  assert.equal(events[0].campaignId, 10)
  assert(events[0].message.includes('Existing error text'))

  const PolicyHarness = methods(['applyZaloPolicySideEffects'])
  const disabled = []
  const policyHarness = Object.assign(new PolicyHarness(), {
    runCampaignErrorPolicy: async (_id, operation) => operation(), throwIfZaloRuntimeStopping() {},
    resolvePolicyActionDisableContext: async () => ({}),
    supabase: {disableAccountActions: async (...args) => disabled.push(args)},
    mainWindow: {webContents: {send() {}}}
  })
  const effect = await policyHarness.applyZaloPolicySideEffects({id: 20}, campaign,
    {disableActionCodes: ['zalo_message_group'], timeDisableActions: 60, errorCode: 'group221'},
    {runningProcess: 'Short notice', campaign: 'Full campaign notice with recovery instructions'})
  assert.equal(effect.stopAfterTarget, true)
  assert.deepEqual(disabled[0].slice(0, 3), [20, ['zalo_message_group'], 60])
  assert.equal(disabled[0][3].reason, 'Full campaign notice with recovery instructions')
  assert(sourceText.includes('`✅ Hoàn thành "${this.getInputDataDisplayName(campaign, detail)}"`'), 'preserve existing completion wording')
  console.log('PASS threshold notes through final pause, raw reason, Page inbox retry, preclaim CAS logs, policy-only/share logs, per-batch dedupe, unchanged normal logs, outage context and lock reasons')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

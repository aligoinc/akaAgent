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

async function main() {
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
  console.log('PASS policy-only/share logs, per-batch dedupe, unchanged normal logs, outage filter context, complete lock reason and existing completion wording')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

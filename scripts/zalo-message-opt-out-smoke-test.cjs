// Run actual pure renderers and scheduler methods with local adapters; no DB/Zalo calls.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cache = new Map()
function load(file) {
  const absolute = path.resolve(root, file)
  if (cache.has(absolute)) return cache.get(absolute)
  const exports = {}
  cache.set(absolute, exports)
  const source = fs.readFileSync(absolute, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const localRequire = name => {
    if (name === 'zca-js') return { TextStyle: { Bold: 'b', Italic: 'i', Underline: 'u', StrikeThrough: 's', Big: 'big', Indent: 'indent', OrderedList: 'ordered', UnorderedList: 'unordered' } }
    return name.startsWith('.') ? load(path.resolve(path.dirname(absolute), name + '.ts')) : require(name)
  }
  new Function('exports', 'require', compiled)(exports, localRequire)
  return exports
}
const core = load('src/shared/zaloMessageOptOut.ts')
const spin = load('src/shared/contentSpin.ts')
const html = load('src/shared/formattedContent.ts')
const { convertHtmlToZaloMessage } = load('src/main/services/zaloFormattedContent.ts')
const source = ts.createSourceFile('scheduler.ts', fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const scheduler = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
const names = ['renderZaloTemplate', 'renderZaloTemplateText', 'buildZaloOutgoingMessage', 'getRawCampaignContentForIndex', 'cycleVariant', 'splitContentVariants']
const methods = names.map(name => {
  const method = scheduler.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
  assert.ok(method, name)
  return method.getText(source)
}).join('\n')
const globals = { ...core, ...html, convertHtmlToZaloMessage, ZALO_MESSAGE_OPT_OUT_ACTION_IDS: new Set(['zalo_message_friend']), ZALO_MESSAGE_SEND_MODE_SHARE: 'share', splitSharedContentVariants: spin.splitContentVariants }
const compiled = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const Harness = new Function(...Object.keys(globals), compiled + '; return Harness')(...Object.values(globals))
const id = core.STOP_MESSAGES_PREVIEW_ID
const link = core.buildStopMessagesLink(id)
const token = core.STOP_MESSAGES_LINK_TOKEN

async function render(content, options = {}) {
  const instance = new Harness()
  const aiInputs = []
  let spins = 0
  Object.assign(instance, {
    isFormattedContentCampaign: () => !!options.rich,
    shouldUseAdvancedContent: () => false,
    getTemplateBusinessNow: async () => undefined,
    renderSpinContent: value => { spins++; return spin.renderContentSpin(value, { rng: () => options.rng ?? 0 }) },
    firstNormalizedVietnamMobilePhone: () => '',
    zaloMessageOptOutContexts: new Map(options.missing ? [] : [['1:2', { linkId: id }]]),
    zaloMessageOptOutContextKey: (a, b) => `${a}:${b}`,
    rewriteZaloMessageForRun: async (_account, _campaign, message) => { aiInputs.push(message); return options.ai ?? message }
  })
  const campaign = { id: 1, actionId: 'zalo_message_friend', content, extraSettings: { zaloOptOutLinkEnabled: options.enabled !== false } }
  const selected = instance.getRawCampaignContentForIndex(campaign, options.index || 0)
  const result = await instance.buildZaloOutgoingMessage({}, campaign, selected, { id: 2, info5: '' }, { displayName: 'Lan' })
  return { result, aiInputs, spins }
}

async function main() {
  for (const action of ['zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation']) {
    for (const advanced of [false, true]) {
      const settings = { enableMessage: false, zaloOptOutLinkEnabled: false, advancedContentEnabled: advanced, advancedContentItems: [{ content: 'First' }, { content: token }] }
      assert.equal(core.validateStopMessagesSettings(token, settings, action), null)
      assert.equal(core.validateStopMessagesSettings(token, { ...settings, enableMessage: true }, action), core.STOP_MESSAGES_CHECKBOX_ERROR)
    }
  }
  for (const action of ['zalo_message_friend', 'zalo_message_birthday']) {
    assert.equal(core.validateStopMessagesSettings(token, { enableMessage: false }, action), core.STOP_MESSAGES_CHECKBOX_ERROR)
  }
  assert.equal(core.encodeStopMessagesId(id), 'VQ6EAOKbQdSnFkRmVUQAAA')
  assert.equal(core.decodeStopMessagesToken('VQ6EAOKbQdSnFkRmVUQAAB'), null)
  for (const tail of [' ', '\t', '\n', '\r\n', '\n\n\n', ' \t\r\n ']) {
    const { result } = await render('  Chào\nLan' + tail)
    assert.equal(result, `  Chào\nLan\n\nTừ chối nhận tin: ${link}`)
  }
  assert.equal((await render('Hi #{INFO5}\n')).result, `Hi\n\nTừ chối nhận tin: ${link}`)
  assert.equal((await render('')).result, `Từ chối nhận tin: ${link}`)
  assert.equal((await render('Bạn chọn: ' + token, { missing: true })).result, 'Bạn chọn: ' + core.STOP_MESSAGES_ERROR_URL)
  assert.equal((await render('Hi', { missing: true })).result, 'Hi')
  assert.equal((await render('Hi', { enabled: false })).result, 'Hi')
  const selected = await render('Unused|{Hi #{FULL_NAME}|Bạn chọn: ' + token + '}', { index: 1, rng: 0.99, ai: 'AI removed link' })
  assert.equal(selected.spins, 1)
  assert.deepEqual(selected.aiInputs, ['Bạn chọn: ' + link])
  assert.equal(selected.result, 'AI removed link')
  const rich = await render('<p><strong>Chọn: ' + token + '</strong> cuối</p>', { rich: true, missing: true })
  assert.equal(rich.result.msg, 'Chọn: ' + core.STOP_MESSAGES_ERROR_URL + ' cuối')
  assert.deepEqual(rich.result.styles, [{ start: 0, len: ('Chọn: ' + core.STOP_MESSAGES_ERROR_URL).length, st: 'b' }])
  assert.deepEqual(rich.aiInputs, [])
  const richFooter = await render('<p><strong>Hi  </strong></p><p><br></p>', { rich: true })
  assert.equal(richFooter.result.msg, `Hi\n\nTừ chối nhận tin: ${link}`)
  assert.deepEqual(richFooter.result.styles, [{ start: 0, len: 2, st: 'b' }])
  console.log('PASS: active-source validation, short link codec, selected/spun content, whitespace, fallback, rich styles, AI order')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

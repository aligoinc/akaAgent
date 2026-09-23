// Execute actual runtime/scheduler methods with isolated API adapters; no network.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const contract = {}
new Function('exports', compile(fs.readFileSync(path.join(root, 'src/shared/zaloAuxiliaryActions.ts'), 'utf8')))(contract)
function harness(file, className, names) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const klass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className)
  const methods = names.map(name => klass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name).getText(source))
  return new Function(...Object.keys(contract), compile(`class Harness { ${methods.join('\n')} }`) + '; return Harness')(...Object.values(contract))
}
const Runtime = harness('src/main/services/zaloRuntimeService.ts', 'ZaloRuntimeService', ['applyLabelToUser'])
const Scheduler = harness('src/main/services/campaignScheduler.ts', 'CampaignScheduler', ['resolveZaloAuxiliaryFriendStatus', 'zaloApplyContactTag', 'zaloChangeContactAlias', 'createBlockRuntimeHelpers', 'runZaloCampaignHelper'])
const labels = () => [{ id: 7, text: 'Mới', conversations: [] }, { id: 8, text: 'VIP', conversations: ['u1', 'u2'] }, { id: 9, text: 'Cũ', conversations: ['u3'] }]
async function main() {
  for (const raw of [{ isFr: 1 }, { is_fr: '1' }, { profile: { isFr: true } }, { user: { isFr: 1 } }, { is_friend: 1 }]) assert.equal(contract.readZaloApiFriendStatus(raw), true)
  for (const raw of [undefined, {}, { isFriend: true }, { isFr: null }, { isFr: '' }, { isFr: 2 }]) assert.equal(contract.readZaloApiFriendStatus(raw), null)
  assert.equal(contract.readZaloApiFriendStatus({ profile: { isFr: 0 }, isFr: 1 }), false)
  for (const exclusions of [['9', '8'], ['9'], []]) {
    let reads = 0; const writes = []; const original = labels()
    const runtime = new Runtime()
    runtime.ensureApi = async () => ({ getLabels: async () => { reads++; return { labelData: original, version: 13 } }, updateLabels: async value => writes.push(value) })
    const result = await runtime.applyLabelToUser(1, 'u1', 7, exclusions)
    assert.equal(reads, 1)
    if (exclusions.includes('8')) {
      assert.equal(result.skipped, true); assert.equal(writes.length, 0); assert.deepEqual(original, labels())
    } else {
      assert.equal(result.id, 7); assert.equal(writes.length, 1); assert.equal(writes[0].version, 13)
      assert.deepEqual(writes[0].labelData[0].conversations, ['u1'])
      assert.deepEqual(writes[0].labelData[1].conversations, ['u2'])
    }
  }
  for (const raw of [{ isFr: 1 }, { profile: { isFr: '1' } }, { isFr: 0 }, {}, undefined]) {
    const calls = []; const logs = []; const scheduler = new Scheduler(); let reads = 0
    Object.assign(scheduler, {
      zaloRuntime: { getFriendRequestStatus: async () => { reads++; return { isFriend: false, raw: {} } }, applyLabelToUser: async (...args) => { calls.push(['tag', ...args]); return { id: 7, text: 'Mới' } }, changeUserAlias: async () => calls.push(['alias']) },
      supabase: { appendZaloTagsToExistingContacts: async () => calls.push(['mirror']) },
      throwIfZaloRuntimeStopping: () => {}, getZaloTargetLabel: target => target.uid,
      logCampaignProgress: async (_id, log) => logs.push(log), getTemplateBusinessNow: async () => undefined,
      renderZaloTemplate: text => text, createZaloSuccessDetail: data => data
    })
    const target = { uid: 'u1', isFriend: true, raw }
    const campaign = { id: 1, extraSettings: { zaloTagSkipIfFriend: true, zaloAliasSkipIfFriend: true } }
    const checks = new Map()
    const tag = await scheduler.zaloApplyContactTag({ id: 1 }, campaign, { enabled: true, target, labelId: 7 }, checks)
    const alias = await scheduler.zaloChangeContactAlias({ id: 1 }, campaign, { enabled: true, target, alias: 'Tên mới' }, checks)
    const friend = contract.readZaloApiFriendStatus(raw) === true
    assert.equal(!!tag.skipped, friend); assert.equal(!!alias.skipped, friend)
    const unknown = contract.readZaloApiFriendStatus(raw) === null
    assert.equal(calls.length, friend ? 0 : 3); assert.equal(logs.length, friend ? 2 : unknown ? 1 : 0)
    assert.equal(reads, unknown ? 1 : 0)
    if (friend) { assert.equal(tag.detail, undefined); assert.equal(alias.detail, undefined) }
    // A matched tag skips tagging independently of renaming; unknown friend state stays actionable.
    scheduler.zaloRuntime.applyLabelToUser = async (_a, _u, _l, ids) => { assert.deepEqual(ids, ['9', '8']); return contract.findZaloExcludedLabels(labels(), 'u1', ids) }
    campaign.extraSettings = { zaloTagSkipIfHasSelectedTags: true, zaloTagSkipTagIds: [9, '8'] }
    const skipped = await scheduler.zaloApplyContactTag({ id: 1 }, campaign, { enabled: true, target, labelId: 7 })
    assert.equal(skipped.skipped, true); assert.equal(skipped.detail, undefined)
    const priorCalls = calls.length
    await scheduler.zaloChangeContactAlias({ id: 1 }, campaign, { enabled: true, target, alias: 'Tên mới' })
    assert.equal(calls.length, priorCalls + 1)
  }
  // Real block helper boundaries may clone the target between nodes. Cache by account/UID
  // within one input's helper instance, including failures; never carry it to the next input.
  for (const actionId of ['zalo_message_phone', 'zalo_message_friend', 'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation']) {
    for (const reply of [{ is_friend: 1 }, { is_friend: 0, is_requesting: 1 }, {}, new Error('offline')]) {
      let reads = 0; const calls = []; const logs = []; const scheduler = new Scheduler()
      Object.assign(scheduler, {
        zaloRuntime: {
          getFriendRequestStatus: async (accountId, uid) => {
            assert.equal(accountId, 11); assert.equal(uid, 'u1'); reads++
            if (reply instanceof Error) throw reply
            return { isFriend: reply.is_friend === 1, raw: reply }
          },
          applyLabelToUser: async () => { calls.push('tag'); return { id: 7, text: 'Mới' } },
          changeUserAlias: async () => calls.push('alias')
        },
        supabase: { appendZaloTagsToExistingContacts: async () => calls.push('mirror') },
        throwIfZaloRuntimeStopping: () => {}, getZaloTargetLabel: target => target.uid,
        logCampaignProgress: async (_id, log) => logs.push(log), getTemplateBusinessNow: async () => undefined,
        renderZaloTemplate: text => text, createZaloSuccessDetail: data => data
      })
      const campaign = { id: 1, actionId, extraSettings: { zaloTagSkipIfFriend: true, zaloAliasSkipIfFriend: true } }
      // UserBasic shape recorded from campaign #17543: lookup returns identity but no friendship.
      const target = { uid: 'u1', raw: { uid: 'u1', gender: 0, display_name: 'Khách', zalo_name: 'Khách', globalId: 'g1' } }
      const helpers = scheduler.createBlockRuntimeHelpers({ id: 11 }, campaign, { id: 100 }, null)
      const tag = await helpers.zaloApplyContactTag({ enabled: true, target: structuredClone(target), labelId: 7 })
      const alias = await helpers.zaloChangeContactAlias({ enabled: true, target: structuredClone(target), alias: 'Tên mới' })
      assert.equal(reads, 1)
      const friend = reply.is_friend === 1
      assert.equal(!!tag.skipped, friend); assert.equal(!!alias.skipped, friend)
      assert.deepEqual(calls, friend ? [] : ['tag', 'mirror', 'alias'])
      assert.equal(logs.filter(log => log.includes('Không xác định')).length, reply.is_friend === undefined ? 1 : 0)
      const nextInput = scheduler.createBlockRuntimeHelpers({ id: 11 }, campaign, { id: 101 }, null)
      await nextInput.zaloChangeContactAlias({ enabled: true, target, alias: 'Tên mới' })
      assert.equal(reads, 2)
      campaign.extraSettings = {}
      await helpers.zaloApplyContactTag({ enabled: true, target, labelId: 7 })
      await helpers.zaloChangeContactAlias({ enabled: true, target, alias: 'Tên mới' })
      assert.equal(reads, 2, 'disabled conditions must not read friendship')
      campaign.extraSettings = { zaloTagSkipIfFriend: true, zaloAliasSkipIfFriend: true }
      await helpers.zaloApplyContactTag({ enabled: false, target: { uid: 'u2' }, labelId: 7 })
      await helpers.zaloChangeContactAlias({ enabled: false, target: { uid: 'u2' }, alias: 'Tên mới' })
      assert.equal(reads, 2, 'disabled actions must not read friendship')
      if (friend) {
        let stopped = false
        scheduler.zaloRuntime.getFriendRequestStatus = async () => { stopped = true; return { raw: { is_friend: 0 } } }
        scheduler.throwIfZaloRuntimeStopping = () => { if (stopped) throw new Error('runtime stopped') }
        const stopping = scheduler.createBlockRuntimeHelpers({ id: 11 }, campaign, { id: 102 }, null)
        const before = calls.length
        await assert.rejects(stopping.zaloApplyContactTag({ enabled: true, target, labelId: 7 }), /runtime stopped/)
        assert.equal(calls.length, before, 'no mutation after a stop during the read')
      }
    }
  }
  const settings = {
    '1': { zaloTagId: '7', zaloTagName: 'A', zaloTagSkipTagIds: ['8'], zaloTagSkipTagNames: ['VIP A'] },
    '2': { zaloTagId: '17', zaloTagName: 'B', zaloTagSkipTagIds: ['18'], zaloTagSkipTagNames: ['VIP B'] }
  }
  for (const accountId of [1, 2, 3]) {
    const calls = []; const logs = []; const scheduler = new Scheduler()
    Object.assign(scheduler, {
      zaloRuntime: { applyLabelToUser: async (...args) => { calls.push(args); return { text: 'Tag' } } },
      supabase: { appendZaloTagsToExistingContacts: async (...args) => calls.push(['mirror', ...args]) },
      throwIfZaloRuntimeStopping: () => {}, getZaloTargetLabel: target => target.uid,
      logCampaignProgress: async (_id, log) => logs.push(log), createZaloSuccessDetail: data => data
    })
    const result = await scheduler.zaloApplyContactTag({ id: accountId }, { id: 1, accountId: 1, extraSettings: {
      zaloTagId: 7, zaloTagSkipIfHasSelectedTags: true, zaloTagSkipTagIds: [8], zaloTagSettingsByAccountId: settings
    } }, { enabled: true, target: { uid: 'u1', raw: {} }, labelId: 7, labelName: 'A' })
    if (accountId === 3) {
      assert.equal(result.skipped, true); assert.equal(result.detail, undefined)
      assert.equal(calls.length, 0); assert.match(logs[0], /chưa cấu hình đầy đủ tag/)
    } else {
      assert.deepEqual(calls[0], [accountId, 'u1', settings[accountId].zaloTagId, settings[accountId].zaloTagSkipTagIds])
      assert.equal(calls[1][1], accountId)
    }
  }
  assert.deepEqual(contract.pickZaloAccountTagSettings(settings, [2]), { '2': settings['2'] })
  assert.equal(contract.resolveZaloAccountTagSettings({ zaloTagId: 7, zaloTagSettingsByAccountId: {} }, 1), null)
  assert.equal(contract.resolveZaloAccountTagSettings({ zaloTagId: 7 }, 1).zaloTagId, '7')
  // Editing an internal draft bundle must merge every child account, not just the first payload.
  const formSource = ts.createSourceFile('form.tsx', fs.readFileSync(path.join(root, 'src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx'), 'utf8'), ts.ScriptTarget.Latest, true)
  let previewInitializer
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(formSource) === 'buildDraftCampaignPreview') previewInitializer = node.initializer.getText(formSource)
    ts.forEachChild(node, visit)
  }
  visit(formSource)
  const buildPreview = new Function(...Object.keys(contract), 'accounts', 'campaignActions', 'getDraftCampaignAccountIds',
    compile(`const build = ${previewInitializer};`) + '; return build')(...Object.values(contract), [], [], draft => draft.items.map(item => item.campaignPayload.accountId))
  const preview = buildPreview({ tempId: -1, actionId: 'zalo_message_phone', items: [1, 2].map(accountId => ({ campaignPayload: {
    accountId, extraSettings: { enableZaloTag: true, zaloTagSettingsByAccountId: { [accountId]: settings[accountId] } }
  } })) })
  assert.deepEqual(preview.extraSettings.zaloTagSettingsByAccountId, settings)
  console.log('PASS: API friendship, OR exclusions, one read/no mutation on skip, account-scoped main/fallback tags, missing-account isolation and legacy compatibility')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

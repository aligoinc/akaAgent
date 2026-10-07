// Real scheduler and repository, in-memory transport only. Never sends to Zalo.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const modules = new Map()
let user = { staffId: 7, organizationId: 9 }, credentials = null
let calls = [], queries = [], errors = []
const client = {
  from(table) {
    const q = { table, filters: [] }; queries.push(q)
    const chain = { select() { return this }, eq(k, v) { q.filters.push([k, v]); return this },
      in(k, v) { q.filters.push([k, v]); return this },
      then(resolve) { return Promise.resolve({ data: [{ id: 100 }], error: null }).then(resolve) } }
    return chain
  },
  rpc(name, params) {
    calls.push({ name, params })
    const promise = Promise.resolve({ data: { success: true, count: 1 }, error: errors.shift() || null })
    promise.abortSignal = () => { throw new Error('Tag calls must use the shared transport timeout, like Local') }
    return promise
  }
}
function load(relative) {
  const filename = path.resolve(root, relative)
  if (modules.has(filename)) return modules.get(filename)
  const module = { exports: {} }; modules.set(filename, module.exports)
  const generic = new Proxy({}, { get: (_, key) => {
    if (key === 'getCurrentUser') return () => user
    if (key === 'requireCurrentUser') return () => { if (!user) throw new Error('no user'); return user }
    if (key === 'getCurrentUserCredentials') return () => credentials
    if (key === 'getSupabaseClient') return () => client
    if (key === 'IPC_EVENTS' || key === 'IPC_EVENTS_V2') return new Proxy({}, { get: (_, k) => k })
    return class Stub {}
  } })
  const localRequire = id => {
    if (['crypto', 'node:crypto', 'path', 'fs', 'os'].includes(id)) return require(id)
    if (id === '../../shared/campaignSendExclusion') return load('src/shared/campaignSendExclusion.ts')
    return generic
  }
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports)
  return module.exports
}
const repo = load('src/main/data/repositories/contactTagRepository.ts')
const { CampaignScheduler } = load('src/main/services/campaignScheduler.ts')
const claim = 'a3520000-0000-4000-8000-000000000001'
const unit = 'a3520000-0000-4000-8000-000000000002'
const account = { id: 71, isZaloServer: true }
const campaign = { id: 72, actionId: 'zalo_message_phone', extraSettings: { enableAkaBizTag: true, akaBizTagIds: [8, 8] } }
const inputData = { id: 73, uid: 'u1', phone: '0900000352' }
const target = { uid: 'u1', displayName: 'Fixture' }
function fixture(runtimeTarget = 'server') {
  calls = []; queries = []; errors = []
  const logs = [], events = [], runtime = { sends: 0 }
  const scheduler = new CampaignScheduler({
    applyZaloServerCampaignTags: repo.applyZaloServerCampaignTags,
    applyAkaBizTagsToContactTargets: repo.applyAkaBizTagsToContactTargets,
    updateCampaignInputData: async (id, values) => { assert.equal(id, inputData.id); events.push(['input', values.uid]) }
  }, {}, { webContents: { send() {} } }, undefined, {}, undefined, { runtimeTarget })
  Object.assign(scheduler, {
    shouldUseZaloShareMessageBatch: () => false,
    throwIfZaloRuntimeStopping() {}, logCampaignProgress: async (_c, text) => logs.push(text),
    getCachedZaloMessageOptOutTarget: () => null,
    resolveZaloFriendMessageTarget: async (_a, t) => t,
    upsertZaloResolvedProfileTarget: async () => {},
    prepareZaloOutgoingContent: async () => ({ content: 'fixture', media: [] }),
    dispatchZaloMessage: async () => { runtime.sends++; return {} },
    createZaloSuccessDetail: d => d
  })
  scheduler.campaignRunBoundaries.set(72, { runtimeClaimToken: claim })
  scheduler.activeCampaignRunUnits.set(72, { runtimeUnitToken: unit })
  return { scheduler, logs, runtime, events }
}
async function main() {
  const f = fixture()
  await f.scheduler.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person', 73)
  assert.equal(calls.length, 1); assert.equal(queries.length, 0)
  assert.deepEqual(calls[0], { name: 'aka_agent_apply_zalo_server_campaign_tags', params: {
    p_staff_id: 7, p_organization_id: 9, p_campaign_id: 72, p_account_id: 71,
    p_runtime_claim_token: claim, p_runtime_unit_token: unit, p_input_data_id: 73,
    p_contact_type: 'person', p_target_uid: 'u1', p_tag_ids: [8]
  } })
  assert(f.logs[0].includes('Đã gắn tag'))
  for (const missing of ['claim', 'unit', 'input']) {
    const f = fixture()
    if (missing === 'claim') f.scheduler.campaignRunBoundaries.clear()
    if (missing === 'unit') f.scheduler.activeCampaignRunUnits.clear()
    await f.scheduler.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person', missing === 'input' ? NaN : 73)
    assert.equal(calls.length, 0); assert.equal(queries.length, 0)
    assert(f.logs[0].includes('server_campaign_tag_claim_required'))
  }
  for (const code of ['P0001', 'PGRST002', '57014', '08006']) {
    const f = fixture(); errors = [{ code, message: 'fixture tag failure' }]
    await f.scheduler.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person', 73)
    assert.equal(calls.length, 1, 'no replay for auth/network/timeout failures')
    assert(f.logs[0].includes('fixture tag failure'))
  }
  const retry = fixture(); errors = [{ code: '40P01', message: 'rolled back' }, { code: '40001', message: 'rolled back' }]
  await retry.scheduler.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person', 73)
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0], calls[2])
  const desktop = fixture('desktop'); credentials = { username: 'fixture', password: 'fixture-only' }
  await desktop.scheduler.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person', NaN)
  assert.equal(calls[0].name, 'aka_agent_mutate_contact_tags')
  assert.equal(calls[0].params.p_auth_username, 'fixture')
  assert.equal(calls[0].params.p_auth_password, 'fixture-only')
  assert(!('p_runtime_claim_token' in calls[0].params))
  credentials = null
  for (const method of ['zaloResolveGroupMemberTarget', 'zaloResolveRemarketingCustomerTarget', 'zaloResolveFriendRecommendationTarget']) {
    const f = fixture()
    await f.scheduler[method](account, campaign, { inputData })
    assert.equal(calls[0].params.p_input_data_id, 73, method)
  }
  const phone = fixture()
  phone.scheduler.getCachedZaloMessageOptOutTarget = () => target
  const tagPhone = phone.scheduler.supabase.applyZaloServerCampaignTags
  phone.scheduler.supabase.applyZaloServerCampaignTags = async value => {
    assert.deepEqual(phone.events, [['input', 'u1']], 'resolved phone UID must be persisted before RPC validation')
    return tagPhone(value)
  }
  await phone.scheduler.zaloFindPhoneUser(account, campaign, { phone: inputData.phone, inputData })
  assert.equal(calls[0].params.p_input_data_id, 73)
  const friend = fixture()
  // Stop immediately after tagging to inspect the real friend-send callsite,
  // before media preparation or any external send.
  friend.scheduler.prepareZaloOutgoingContent = async () => { throw new Error('fixture stop after tag') }
  await assert.rejects(friend.scheduler.zaloSendFriendMessage(account,
    { ...campaign, actionId: 'zalo_message_friend' }, { inputData }, { campaignInputDataId: 74 }), /fixture stop after tag/)
  assert.equal(calls[0].params.p_input_data_id, 74)
  // A failed group tag cannot cause the successful external send to run twice.
  const group = fixture(); errors = [{ code: 'P0001', message: 'lost tag claim' }]
  const result = await group.scheduler.zaloSendGroupMessage(account,
    { ...campaign, actionId: 'zalo_message_group' }, { inputData: { ...inputData, uid: 'g123' } }, { campaignInputDataId: 74 })
  assert.equal(result.ok, true); assert.equal(group.runtime.sends, 1)
  assert.equal(calls[0].params.p_input_data_id, 74); assert.equal(calls[0].params.p_target_uid, 'g123')
  const disabled = fixture()
  await disabled.scheduler.applyAkaBizTagsToZaloTarget(account, { ...campaign, extraSettings: {} }, target, 'person', 73)
  await disabled.scheduler.applyAkaBizTagsToZaloTarget(account, { ...campaign, actionId: 'zalo_message_birthday' }, target, 'person', 73)
  disabled.scheduler.shouldUseZaloShareMessageBatch = () => true
  await disabled.scheduler.applyAkaBizTagsToZaloTarget(account, campaign, target, 'person', 73)
  assert.equal(calls.length, 0)
  console.log('PASS: actual scheduler/repository Server claims without credentials or lookup; Desktop routing; missing claims; bounded rollback-only retry; all resolver input IDs; group send is not retried on tag error; disabled/birthday/share unchanged.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

// Run real loader/repositories with in-memory DB and Zalo transports only.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const ts = require('typescript')
const root = resolve(__dirname, '..')
const modules = new Map()
let db
function loadSource(relativePath) {
  const filename = resolve(root, relativePath)
  if (modules.has(filename)) return modules.get(filename)
  const module = { exports: {} }
  modules.set(filename, module.exports)
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  const localRequire = id => {
    if (id === 'electron') return {}
    if (id.endsWith('/supabaseClient')) return { getSupabaseClient: () => db }
    if (id.endsWith('/backgroundPageManager')) return { BackgroundPageManager: class {} }
    if (id.endsWith('/workflowEngine')) return { WorkflowEngineV2: class {} }
    if (!id.startsWith('.')) return require(id)
    const path = resolve(dirname(filename), `${id}.ts`)
    if (path.includes('/shared/') || path.endsWith('/currentUser.ts') || path.endsWith('/mappers.ts')) return loadSource(path)
    return {}
  }
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports)
  return module.exports
}
const auth = loadSource('src/main/data/currentUser.ts')
const accounts = loadSource('src/main/data/repositories/accountRepository.ts')
const contacts = loadSource('src/main/data/repositories/accountContactRepository.ts')
const { ContactLoader } = loadSource('src/main/services/contactLoader.ts')
const user = { staffId: 7, organizationId: 9 }
const account = { id: 71, staffId: 7, organizationId: 9, flatformType: 'zalo', isZaloServer: true, isZaloShowWeb: false, isActive: true, loginStatus: 'đã đăng nhập', status: 'tạm dừng' }
const input = { accountId: 71, scanType: 'zalo_group_members', contactType: 'person', sourceKey: 'group-1', name: 'Group members', status: 'completed', contactUids: [' member-1 ', 'member-1', 'member-2'], dataTypeCategoryItemId: 5 }
const token = 'aa000000-0000-4000-8000-000000000001'
function fixture(options = {}) {
  const steps = [], calls = [], datasets = []
  let heldToken = null, loader, saved = 0
  db = { rpc: async (name, params) => {
    calls.push({ name, params })
    assert.equal(params.p_staff_id, user.staffId)
    if (name === 'claim_zalo_account_runtime_operation') {
      steps.push('claim')
      if (options.claimDenied) return { data: { claimed: false, reason: 'runtime_not_owner' }, error: null }
      heldToken = params.p_claim_token || null
      if (options.server !== false) {
        assert.equal(params.p_runtime_target, 'server')
        assert.equal(params.p_requires_login, true)
        assert.equal(params.p_previous_status, 'tạm dừng')
        assert.ok(heldToken)
      } else assert.equal(heldToken, null)
      return { data: { claimed: true, account_id: 71, previous_status: 'tạm dừng', claim_token: heldToken }, error: null }
    }
    if (name === 'release_zalo_account_runtime_operation') {
      steps.push('release')
      assert.equal(params.p_previous_status, 'tạm dừng')
      if (options.server !== false) assert.equal(params.p_claim_token, heldToken)
      heldToken = null
      return { data: true, error: null }
    }
    assert.equal(params.p_organization_id, user.organizationId)
    if (name === 'aka_agent_finalize_zalo_server_contact_dataset') {
      assert.ok(heldToken, 'finalize must precede release')
      assert.equal(params.p_claim_token, heldToken)
      assert.equal('p_auth_username' in params, false)
      assert.equal('p_auth_password' in params, false)
    } else {
      assert.equal(name, 'aka_agent_finalize_contact_dataset')
      assert.equal(params.p_auth_username, 'desktop-test')
      assert.equal(params.p_auth_password, 'test-only')
    }
    steps.push('finalize')
    datasets.push(params)
    if (options.finalizeError) return { data: null, error: { message: 'server_contact_dataset_claim_invalid' } }
    return { data: options.empty ? [] : [{ id: 19, contact_count: saved }], error: null }
  } }
  const service = {
    getAccount: async () => ({ ...account, isZaloServer: options.server !== false || options.chat === true }),
    claimZaloServerContactScan: accounts.claimZaloServerContactScan,
    claimZaloAccountRuntimeOperation: accounts.claimZaloAccountRuntimeOperation,
    releaseZaloAccountRuntimeOperation: accounts.releaseZaloAccountRuntimeOperation,
    listDataTypeCategoryItems: async () => [{ code: 'zalo_person', id: 5 }],
    finalizeZaloServerContactDataset: contacts.finalizeZaloServerContactDataset,
    finalizeContactDataset: contacts.finalizeContactDataset,
    upsertZaloGroupMemberContacts: async value => {
      steps.push('save-contacts'); saved = value.members.length
      if (options.cancelAfterSave) loader.cancelLoad(71)
      return saved
    }
  }
  const result = { group: { groupId: 'group-1', name: 'Test group' }, members: options.empty ? [] : [{ zaloUid: 'member-1' }, { zaloUid: 'member-2' }] }
  const runtime = {
    checkSession: async () => ({ loggedIn: true }),
    getJoinedGroupMembers: async () => { steps.push('read-zalo'); return result },
    getGroupMembersByLink: async () => { steps.push('read-link'); return result }
  }
  loader = new ContactLoader(service, {}, { webContents: { send() {} } }, undefined, runtime, { zaloRuntimeTarget: options.server === false && !options.chat ? 'desktop' : 'server', ...(options.server === false ? {} : { contactDatasetAuth: 'server_claim' }) })
  return { loader, steps, calls, datasets, saved: () => saved }
}
let passed = 0
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`) }
async function main() {
  auth.setCurrentUser(null)
  auth.setCurrentUserCredentials(null)
  await check('Server scan succeeds without desktop credentials, then releases the same token', async () => {
    const f = fixture()
    const result = await auth.runWithCurrentUser(user, () => f.loader.loadZaloGroupMembers(71, { mode: 'joined_group', zaloGroupId: 'group-1' }))
    assert.equal(result.success, true); assert.equal(result.count, 2); assert.equal(result.datasetId, 19)
    assert.deepEqual(f.steps, ['claim', 'read-zalo', 'save-contacts', 'finalize', 'release'])
    assert.equal(f.datasets[0].p_status, 'completed')
    assert.equal(auth.getCurrentUserCredentials(), null)
  })
  await check('Group-link scans use the same Server finalizer', async () => {
    const f = fixture()
    const result = await auth.runWithCurrentUser(user, () => f.loader.loadZaloGroupMembers(71, { mode: 'group_link', link: 'https://zalo.me/g/testgroup' }))
    assert.equal(result.success, true); assert.ok(f.steps.includes('read-link'))
    assert.equal(f.datasets[0].p_source_key, 'group-1')
  })
  await check('Cancellation after saving finalizes only a partial snapshot', async () => {
    const f = fixture({ cancelAfterSave: true })
    const result = await auth.runWithCurrentUser(user, () => f.loader.loadZaloGroupMembers(71, { mode: 'joined_group', zaloGroupId: 'group-1' }))
    assert.equal(result.success, true); assert.equal(result.stopped, true)
    assert.equal(f.datasets[0].p_status, 'partial'); assert.equal(f.steps.at(-1), 'release')
  })
  await check('An empty completed scan can return no dataset', async () => {
    const f = fixture({ empty: true })
    const result = await auth.runWithCurrentUser(user, () => f.loader.loadZaloGroupMembers(71, { mode: 'joined_group', zaloGroupId: 'group-1' }))
    assert.equal(result.success, true); assert.equal(result.count, 0); assert.equal(result.datasetId, undefined)
  })
  await check('A rejected claim prevents all reads and writes', async () => {
    const f = fixture({ claimDenied: true })
    const result = await auth.runWithCurrentUser(user, () => f.loader.loadZaloGroupMembers(71, { mode: 'joined_group', zaloGroupId: 'group-1' }))
    assert.equal(result.success, false); assert.deepEqual(f.steps, ['claim'])
  })
  await check('Finalization errors remain visible after contacts were saved', async () => {
    const f = fixture({ finalizeError: true })
    const result = await auth.runWithCurrentUser(user, () => f.loader.loadZaloGroupMembers(71, { mode: 'joined_group', zaloGroupId: 'group-1' }))
    assert.equal(result.success, false); assert.equal(f.saved(), 2)
    assert.match(result.error, /server_contact_dataset_claim_invalid/); assert.equal(f.steps.at(-1), 'release')
  })
  for (const chat of [false, true]) await check(`${chat ? 'Desktop Chat' : 'Desktop local'} scans still require their own credentials`, async () => {
    const f = fixture({ server: false, chat })
    auth.setCurrentUser(user); auth.setCurrentUserCredentials({ username: 'desktop-test', password: 'test-only' })
    const result = await f.loader.loadZaloGroupMembers(71, { mode: 'joined_group', zaloGroupId: 'group-1' })
    assert.equal(result.success, true)
    assert.equal(f.calls.some(call => call.name === 'aka_agent_finalize_zalo_server_contact_dataset'), false)
    auth.setCurrentUserCredentials(null)
    await assert.rejects(contacts.finalizeContactDataset(input), /Phiên xác thực/)
    auth.setCurrentUser(null)
  })
  await check('Server finalizer rejects missing claim or unsupported scan and requires user scope', async () => {
    let calls = 0
    db = { rpc() { calls++; throw new Error('Unexpected RPC') } }
    await assert.rejects(auth.runWithCurrentUser(user, () => contacts.finalizeZaloServerContactDataset(input, '')), /không hợp lệ/)
    await assert.rejects(auth.runWithCurrentUser(user, () => contacts.finalizeZaloServerContactDataset({ ...input, scanType: 'facebook_group_members' }, token)), /không hợp lệ/)
    await assert.rejects(contacts.finalizeZaloServerContactDataset(input, token), /Chưa đăng nhập/)
    assert.equal(calls, 0)
  })
  await check('Concurrent staff contexts remain isolated and normalized UIDs are deduplicated', async () => {
    const seen = []
    db = { rpc: async (name, params) => { await new Promise(resolve => setImmediate(resolve)); seen.push(params); return { data: [], error: null } } }
    await Promise.all([
      auth.runWithCurrentUser(user, () => contacts.finalizeZaloServerContactDataset(input, token)),
      auth.runWithCurrentUser({ staffId: 8, organizationId: 10 }, () => contacts.finalizeZaloServerContactDataset({ ...input, accountId: 72 }, token))
    ])
    assert.deepEqual(seen.map(p => [p.p_staff_id, p.p_organization_id, p.p_account_id]), [[7, 9, 71], [8, 10, 72]])
    assert.deepEqual(seen[0].p_contact_uids, ['member-1', 'member-2'])
  })
  await check('Subtype-change claim still permits inactive accounts without requiring login', async () => {
    db = { rpc: async (name, p) => { assert.equal(p.p_requires_login, false); return { data: { claimed: true, account_id: 71, previous_status: 'tạm dừng', claim_token: p.p_claim_token }, error: null } } }
    const claim = await auth.runWithCurrentUser(user, () => accounts.claimZaloAccountTypeChange(71, 'server', 'tạm dừng'))
    assert.equal(claim.claimed, true)
  })
  console.log(`${passed} Zalo Server contact dataset checks passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })

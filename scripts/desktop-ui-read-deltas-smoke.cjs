// Real parsing/runtime methods with in-memory adapters; no DB/runtime connections.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function moduleAt(file) {
  const exports = {}
  new Function('exports', 'require', compile(fs.readFileSync(path.join(root, file), 'utf8')))(exports, require)
  return exports
}
function methods(file, className, names, globals) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className)
  const code = names.map(name => cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name).getText(source)).join('\n')
  return new Function(...Object.keys(globals), compile(`class Harness { ${code} }`) + ';return Harness')(...Object.values(globals))
}
const { logCursor, reconstructLog } = moduleAt('src/main/data/campaignLogDelta.ts')
const { zaloServerUiSnapshotKey } = moduleAt('src/shared/zaloServerUiSnapshot.ts')
function delta(previous, current) {
  const cursor = logCursor(previous), chars = Array.from(current), tail = Array.from(cursor.tail)
  const index = current.indexOf(cursor.tail)
  if (index < 0) return { mode: 'replace', log: current, version: logCursor(current).version }
  const end = Array.from(current.slice(0, index)).length + tail.length
  const prefix = chars.slice(0, Math.min(256, end)).join('')
  return { mode: 'delta', prefix, keepChars: end - Array.from(prefix).length, append: chars.slice(end).join(''), version: logCursor(current).version }
}
async function main() {
  const old = Array.from({ length: 1500 }, (_, i) => `Dòng ${i}: Tiếng Việt ${String.fromCodePoint(128512)}\n`).join('')
  for (const current of [old + 'new', '[Đã cắt lịch sử]\n' + Array.from(old).slice(1000).join('') + 'new', '', 'replaced']) {
    assert.equal(reconstructLog(old, delta(old, current)), current)
  }
  assert.equal(reconstructLog(old, { mode: 'unchanged', version: logCursor(old).version }), old)
  assert.equal(reconstructLog(undefined, { mode: 'unchanged', version: logCursor(old).version }), null)
  const corrupted = old.slice(0, 600) + 'CHANGED IN MIDDLE' + old.slice(600)
  assert.equal(reconstructLog(old, delta(old, corrupted)), null, 'ambiguous/replaced overlap requires full resync')
  assert.equal(reconstructLog(old, { ...delta(old, old + 'new'), keepChars: -1 }), null)
  assert.equal(reconstructLog(old, { mode: 'replace', log: 'unverified', version: '0'.repeat(32) }), null)
  console.log('PASS log delta: Unicode, rolling tail, unchanged, replacement and checksum rejection')

  const IPC_EVENTS = { CAMPAIGN_LOG: 'campaign:log', CAMPAIGN_LOG_UPDATED: 'campaign:log-updated' }
  const LogHarness = methods('src/main/services/campaignScheduler.ts', 'CampaignScheduler', ['logCampaignProgress'], {
    IPC_EVENTS, formatCampaignLogMessage: value => value
  })
  for (const runtimeTarget of ['desktop', 'server']) {
    const signals = [], logs = [], writes = []
    const scheduler = Object.assign(new LogHarness(), { runtimeTarget,
      supabase: { appendCampaignLog: async (id, text) => { writes.push([id, text]); return { id, name: 'Campaign', accountId: 2, accountName: 'Account' } } },
      mainWindow: { webContents: { send: (...args) => signals.push(args) } },
      broadcastCampaignUpdate: () => { throw new Error('log must not broadcast state') },
      sendLog: (...args) => logs.push(args)
    })
    await scheduler.logCampaignProgress({ id: 1, name: 'Campaign' }, 'unchanged message')
    assert.deepEqual(writes, [[1, 'unchanged message']])
    assert.equal(logs.length, 1)
    assert.deepEqual(signals, runtimeTarget === 'desktop' ? [['campaign:log-updated', { id: 1 }]] : [])
    await scheduler.logCampaignProgress(1, 'silent', { emitRealtime: false })
    assert.equal(logs.length, 1, 'preserve silent progress behavior')
  }
  console.log('PASS local log signal is separate; persisted text and Server behavior preserved')

  const ClientHarness = methods('src/main/services/zaloServerClient.ts', 'ZaloServerClient', ['handleMessage'], {
    zaloServerUiSnapshotKey, IPC_EVENTS, ZALO_SERVER_OPERATION_UPDATED_CHANNEL: 'operation'
  })
  let refreshes = 0, scheduled = 0, forwarded = 0
  const client = Object.assign(new ClientHarness(), { user: { staffId: 7, organizationId: 9 }, lastSequence: 0,
    isCurrentSocket: () => true, updateRuntimeStartedAt() {}, reconcileOperationSnapshots() {}, publishOperationState() {},
    refreshDatabaseSnapshot: async () => { refreshes++ }, scheduleDatabaseSnapshotRefresh: () => { scheduled++ },
    forwardRuntimeEvent: () => { forwarded++ }, markRuntimeEventSeen() {}
  })
  const snapshot = { state: 'running', startedAt: 'server', vietnamTime: 'one', connectedClients: 1,
    staffs: [{ staffId: 7, organizationId: 9, state: 'running', startedAt: 'staff', lastError: null }] }
  const send = object => client.handleMessage(JSON.stringify(object), {}, 1)
  await send({ type: 'hello', snapshot, events: [], operations: [] })
  await send({ type: 'snapshot', snapshot: { ...snapshot, vietnamTime: 'two', connectedClients: 200, recentEvents: [1] } })
  await send({ type: 'snapshot', snapshot: { ...snapshot, staffs: [...snapshot.staffs, { staffId: 8, organizationId: 9, state: 'error' }] } })
  assert.equal(scheduled, 0)
  await send({ type: 'snapshot', snapshot: { ...snapshot, staffs: [{ ...snapshot.staffs[0], startedAt: 'new runtime' }] } })
  assert.equal(scheduled, 1)
  await send({ type: 'hello', snapshot, events: [], operations: [] })
  assert.equal(refreshes, 2, 'every reconnect revalidates DB even with unchanged snapshot')
  await send({ type: 'runtime-event', event: { channel: 'campaign:status-updated' } })
  assert.equal(forwarded, 1, 'live state events remain immediate')
  console.log('PASS periodic/other-staff snapshots do not reload; runtime change, reconnect and live state preserved')
  const repositoryFile = 'src/main/data/repositories/campaignRepository.ts'
  const sourceText = fs.readFileSync(path.join(root, repositoryFile), 'utf8')
  const source = ts.createSourceFile(repositoryFile, sourceText, ts.ScriptTarget.Latest, true)
  const variables = ['CAMPAIGN_PRIMARY_ACCOUNT_RELATION', 'CAMPAIGN_RELATIONS', 'CAMPAIGN_LIST_ITEM_SELECT', 'CAMPAIGN_PAGE_ITEM_SELECT']
  const declarations = source.statements.filter(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(d => variables.includes(d.name.getText(source)))).map(node => node.getText(source)).join('\n')
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'listCampaignSummariesForPage')
  const calls = []
  const builder = {
    select(value) { calls.push(['select', value]); return this },
    eq(key, value) { calls.push(['eq', key, value]); return this },
    in(key, value) { calls.push(['in', key, value]); return this },
    async order() { return { data: [{ id: 1, secondaryAccountId: 55, primary_account: { flatform_type: 'facebook' } }], error: null } }
  }
  const globals = {
    client: () => ({ from: name => { calls.push(['from', name]); return builder } }),
    requireCurrentUser: () => ({ staffId: 7, organizationId: 9 }),
    loadCurrentUserEffectiveEntitlements: async () => ({}), loadCurrentUserZaloAccountCapabilities: () => ({}),
    mapCampaignListItemFromDB: row => row, filterCampaignsByEntitlements: rows => rows,
    attachCampaignDataGroupSourceSummaries: async rows => rows, attachCampaignInputDataProgress: async rows => rows
  }
  const exports = {}
  new Function('exports', ...Object.keys(globals), compile(declarations + '\n' + fn.getText(source)))(exports, ...Object.values(globals))
  const rows = await exports.listCampaignSummariesForPage([1], [{ id: 55, name: 'Secondary name' }])
  assert.equal(rows[0].secondaryAccountName, 'Secondary name')
  assert.deepEqual(calls.filter(c => c[0] === 'from'), [['from', 'auto_campaigns']], 'no duplicate account-name query')
  const select = calls.find(c => c[0] === 'select')[1]
  assert(!select.includes('find_uid_target_campaign_ids'))
  assert(!select.includes('is_find_phone'))
  assert(select.includes('email_check_link_clicks') && select.includes('primary_account:'))
  assert(calls.some(c => c[0] === 'eq' && c[1] === 'staff_id' && c[2] === 7))
  assert(calls.some(c => c[0] === 'eq' && c[1] === 'organization_id' && c[2] === 9))
  console.log('PASS page projection omits detail-only fields, reuses secondary names and retains tenant predicates')

}
main().catch(error => { console.error(error); process.exitCode = 1 })

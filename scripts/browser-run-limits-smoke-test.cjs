// Real scheduler/repository/IPC methods with controlled data, no DB/network.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const shared = { exports: {} }
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/shared/browserRunLimits.ts'), 'utf8')), { exports: shared.exports })
const { browserRunLimitWaitNote, parseBrowserRunLimit, isBrowserRunLimits } = shared.exports
for (const [value, result] of [['', null], ['  ', null], ['2', 2], ['2147483647', 2147483647]]) assert.equal(parseBrowserRunLimit(value), result)
for (const value of ['0', '-1', '1.5', '1e2', 'Infinity', '2147483648', 'x']) assert.throws(() => parseBrowserRunLimit(value))
assert.equal(isBrowserRunLimits({ zaloWebMax: null, facebookMax: 2, revision: 0 }), true)
assert.equal(isBrowserRunLimits({ zaloWebMax: 0, facebookMax: 2, revision: 0 }), false)
const account = { id: 10, flatformType: 'facebook', isZaloShowWeb: false, isZaloServer: false }
assert.match(browserRunLimitWaitNote(account), /Facebook/)
assert.match(browserRunLimitWaitNote({ ...account, flatformType: 'zalo', isZaloShowWeb: true }), /Zalo \(trình duyệt\)/)
assert.equal(browserRunLimitWaitNote({ ...account, flatformType: 'zalo' }), null)
assert.equal(browserRunLimitWaitNote({ ...account, flatformType: 'zalo', isZaloServer: true }), null)
const filename = path.join(root, 'src/main/services/campaignScheduler.ts')
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CampaignScheduler')
const methods = ['executeCampaign', 'runAccountCampaignQueue', 'updateUnclaimedCampaignPreflightNote'].map(name => cls.members.find(n => n.name?.getText(source) === name).getText(source)).join('\n')
const mod = { exports: {} }
vm.runInNewContext(compile(`class Scheduler { ${methods} }; module.exports = Scheduler;`), {
  module: mod, console, browserRunLimitWaitNote, randomUUID: require('node:crypto').randomUUID,
  clearAccountCampaignLogContext: () => {}, recordAccountLog: () => {}
})
function fixture(note = null, reason = 'concurrency_limit_reached') {
  const state = { row: { id: 1, accountId: 10, status: 'chờ xử lý', schedule: '2026-10-02T00:00:00Z', name: 'Fixture', note, updatedAt: 'revision' }, claims: 0, writes: 0, logs: [], broadcasts: [] }
  const scheduler = Object.assign(new mod.exports(), {
    running: true, runtimeTarget: 'desktop', isAccountStartupPending: () => false,
    getReadyRuntimeClock: async () => ({ dbNow: '2026-10-02T01:00:00Z' }), shouldProcessAccountForRuntime: () => true,
    isRealtimeCampaignDisabledForRuntime: () => false, isAtOrAfterCampaignDispatchCutoff: () => false,
    hasFailedAccountRun: () => false, restoreFacebookPageIdentity: async () => {}, clearZaloSmsPushKeysForCampaign: () => {},
    logCampaignProgress: async (_row, text) => state.logs.push(text), broadcastCampaignUpdate: row => state.broadcasts.push(row),
    supabase: {
      getCampaign: async id => ({ ...state.row, id }), getCampaignAction: async () => null,
      claimCampaignRuntimeV2: async () => { state.claims++; return { ok: false, reason } },
      updatePendingUnclaimedCampaignNote: async (_id, revision, text) => {
        state.writes++; assert.equal(revision, 'revision'); state.row.note = text; return { ...state.row }
      }
    }
  })
  for (const key of ['activeZaloCampaignRuns', 'activeZaloRunGenerations', 'activeZaloRunStopReasons', 'serverZaloPauseBoundaries', 'claimedServerZaloCampaignIds', 'claimedServerZaloAccountIds', 'sendExclusionRuns', 'sendExclusionLabels', 'failedCampaignRuns', 'activeCampaignRunUnits', 'campaignRunBoundaries', 'attemptedRunErrorPolicies', 'failedRunErrorPolicies', 'facebookPageIdentities', 'facebookPageRestoreFailures', 'boundaryStoppedAccountQueues']) scheduler[key] = new Map()
  return { state, scheduler }
}
async function main() {
  let f = fixture()
  await f.scheduler.runAccountCampaignQueue(account, [{ id: 1 }, { id: 2 }])
  assert.equal(f.state.claims, 1, 'full account skips the rest of its queue this tick')
  assert.equal(f.state.row.status, 'chờ xử lý'); assert.equal(f.state.writes, 1); assert.equal(f.state.logs.length, 1)
  assert.equal(f.state.row.note, browserRunLimitWaitNote(account))
  await f.scheduler.runAccountCampaignQueue(account, [{ id: 1 }, { id: 2 }])
  assert.equal(f.state.claims, 2, 'next existing tick retries'); assert.equal(f.state.writes, 1, 'unchanged note is not rewritten'); assert.equal(f.state.logs.length, 1)
  // Action limits take precedence, so the two wait reasons never alternate
  // while the same hourly/daily block remains in effect.
  for (const quotaNote of ['Đã đạt giới hạn giờ', 'Đã đạt giới hạn ngày']) {
    f = fixture()
    let quotaBlocked = true
    f.scheduler.supabase.getCampaignAction = async () => ({})
    f.scheduler.getCampaignPreclaimLimitStatus = async () => quotaBlocked ? { ok: false } : null
    f.scheduler.buildLimitPreflightNote = async () => quotaNote
    await f.scheduler.runAccountCampaignQueue(account, [{ id: 1 }])
    await f.scheduler.runAccountCampaignQueue(account, [{ id: 1 }])
    assert.equal(f.state.claims, 0, 'blocked action never asks for a concurrency slot')
    assert.equal(f.state.row.note, quotaNote)
    assert.equal(f.state.writes, 1); assert.equal(f.state.logs.length, 1)
    quotaBlocked = false
    await f.scheduler.runAccountCampaignQueue(account, [{ id: 1 }])
    await f.scheduler.runAccountCampaignQueue(account, [{ id: 1 }])
    assert.equal(f.state.row.note, browserRunLimitWaitNote(account))
    assert.equal(f.state.writes, 2, 'wait reason changes once after action capacity returns')
    assert.equal(f.state.logs.length, 2)
  }
  f = fixture(null, 'claim_rejected')
  await f.scheduler.runAccountCampaignQueue(account, [{ id: 1 }, { id: 2 }])
  assert.equal(f.state.claims, 2, 'other rejection keeps prior queue behavior'); assert.equal(f.state.writes, 0)
  f = fixture()
  f.scheduler.supabase.updatePendingUnclaimedCampaignNote = async () => { f.state.row = { ...f.state.row, status: 'đang chạy', note: null }; return null }
  await f.scheduler.executeCampaign(account, f.state.row)
  assert.equal(f.state.logs.length, 0); assert.equal(f.state.broadcasts[0].status, 'đang chạy', 'CAS loser publishes winning run, never overwrites it')
  // Repository passes credentials only from main and ignores stale auth responses.
  let user = { staffId: 7, organizationId: 8 }, credentials = { username: 'fixture', password: 'fixture' }, request, response
  const repo = { exports: {} }
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/main/data/repositories/browserRunLimitsRepository.ts'), 'utf8')), {
    exports: repo.exports, AbortSignal, require: id => id.includes('shared/browserRunLimits') ? shared.exports
      : id.includes('currentUser') ? { requireCurrentUser: () => user, getCurrentUser: () => user, requireCurrentUserCredentials: () => credentials, getCurrentUserCredentials: () => credentials }
      : { getSupabaseClient: () => ({ rpc: (_name, payload) => { request = payload; return { abortSignal: async () => response() } } }) }
  })
  const settings = { zaloWebMax: null, facebookMax: 2, revision: 1 }
  response = () => ({ data: { ok: true, settings } })
  assert.equal((await repo.exports.getBrowserRunLimits()).facebookMax, 2)
  assert.equal(request.p_staff_id, 7); assert.equal(request.p_auth_password, 'fixture')
  await assert.rejects(repo.exports.saveBrowserRunLimits({ ...settings, facebookMax: 0 }))
  response = () => ({ data: { ok: false, reason: 'conflict' } })
  assert.equal((await repo.exports.saveBrowserRunLimits(settings)).reason, 'conflict')
  response = () => { credentials = { ...credentials }; return { data: { ok: true, settings } } }
  await assert.rejects(repo.exports.getBrowserRunLimits(), /Phiên đăng nhập đã thay đổi/)
  const handlers = new Map(), mainFrame = {}, webContents = { mainFrame }, handlerModule = { exports: {} }
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/main/ipc/handlers/browserRunLimitsHandlers.ts'), 'utf8')), {
    exports: handlerModule.exports, require: id => id === 'electron' ? { ipcMain: { handle: (key, fn) => handlers.set(key, fn) } }
      : id.includes('shared/browserRunLimits') ? shared.exports : { getBrowserRunLimits: () => settings, saveBrowserRunLimits: () => ({ ok: true, settings }) }
  })
  handlerModule.exports.registerBrowserRunLimitsHandlers({ webContents })
  const get = handlers.get(shared.exports.BROWSER_RUN_LIMITS_IPC.get)
  assert.throws(() => get({ sender: {}, senderFrame: mainFrame }))
  assert.throws(() => get({ sender: webContents, senderFrame: {} }))
  assert.equal(get({ sender: webContents, senderFrame: mainFrame }), settings)
  console.log('PASS shared validation, real scheduler action-limit priority/wait/dedup/queue/CAS, repository identity/session fencing, main-frame IPC')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

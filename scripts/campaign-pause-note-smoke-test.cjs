// Real scheduler methods + repository predicate; controlled async DB, no network.
// Run: node scripts/campaign-pause-note-smoke-test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const pendingNote = 'Đang chờ tạm dừng'
const oldToken = '10000000-0000-4000-8000-000000000001'
const newToken = '10000000-0000-4000-8000-000000000002'
const compile = code => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const source = file => ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
const schedulerSource = source('src/main/services/campaignScheduler.ts')
const schedulerClass = schedulerSource.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CampaignScheduler')
const methods = ['requestPauseCampaign', 'markCampaignPausePending', 'isCampaignPauseRequested',
  'completeCampaignPause', 'updateCampaignAndBroadcast'].map(name => {
  const method = schedulerClass.members.find(n => n.name?.getText(schedulerSource) === name)
  assert.ok(method, name)
  return method.getText(schedulerSource)
}).join('\n')
const repositorySource = source('src/main/data/repositories/campaignRepository.ts')
const noteFunction = repositorySource.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'updateRunningDesktopCampaignPauseNote')
assert.ok(noteFunction)

function gate() {
  let enter, release
  const entered = new Promise(resolve => { enter = resolve })
  const released = new Promise(resolve => { release = resolve })
  return { entered, release, wait: async () => { enter(); await released } }
}

function fixture() {
  const row = { id: 1, staff_id: 7, accountId: 2, name: 'offline fixture', actionId: 'facebook_group_post',
    status: 'đang chạy', note: null, is_delete: false, runtime_claim_token: oldToken }
  const events = [], logs = [], writes = []
  const state = { row, events, logs, writes, queries: 0, closed: 0, beforeWrite: null, afterWrite: null }
  const mod = { exports: {} }
  vm.runInNewContext(compile(`class Scheduler { ${methods} }; module.exports = Scheduler`), {
    module: mod, CAMPAIGN_PAUSE_PENDING_NOTE: pendingNote,
    NEWSFEED_INTERACTION_ACTION_ID: 'facebook_newsfeed_interaction', recordAccountLog: event => logs.push(event)
  })
  const exported = {}
  vm.runInNewContext(compile(noteFunction.getText(repositorySource)), {
    exports: exported, CAMPAIGN_SELECT: '*', requireCurrentUser: () => ({ staffId: 7 }), mapCampaignFromDB: value => value,
    client: () => ({ from: table => {
      assert.equal(table, 'auto_campaigns'); state.queries++
      const filters = {}, query = {
        update: patch => { query.patch = patch; return query },
        eq: (key, value) => { filters[key] = value; return query },
        select: () => query,
        maybeSingle: async () => {
          if (state.beforeWrite) await state.beforeWrite.wait()
          assert.deepEqual(filters, { id: 1, staff_id: 7, status: 'đang chạy', runtime_claim_token: oldToken, is_delete: false })
          assert.deepEqual(Object.keys(query.patch).sort(), ['note', 'updated_at'], 'hint must never change status or schedule')
          let data = null
          if (Object.entries(filters).every(([key, value]) => row[key] === value)) {
            Object.assign(row, query.patch); writes.push({ ...query.patch }); data = { ...row }
          }
          if (state.afterWrite) await state.afterWrite.wait()
          return { data, error: null }
        }
      }
      return query
    } })
  })
  const abort = new AbortController()
  abort.signal.addEventListener('abort', () => { state.closed++ })
  const supabase = {
    getCampaign: async () => ({ ...row }),
    updateCampaign: async (_id, patch) => {
      assert(!(patch.note === pendingNote && patch.status === undefined), 'unconditional pause-note write')
      Object.assign(row, patch); writes.push({ ...patch }); return { ...row }
    },
    updateRunningDesktopCampaignPauseNote: exported.updateRunningDesktopCampaignPauseNote
  }
  const scheduler = Object.assign(new mod.exports(), {
    runtimeTarget: 'desktop', supabase, pauseRequests: new Set(),
    activeFacebookRestBrowses: new Set([1]), activeV2Aborts: new Map([[1, abort]]),
    failedCampaignRuns: new Map(), claimedServerZaloCampaignIds: new Set(),
    campaignRunBoundaries: new Map([[1, { runtimeClaimToken: oldToken }]]),
    restoreFacebookPageIdentity: async () => {}, logCampaignProgress: async () => {},
    broadcastCampaignUpdate: value => events.push({ ...value })
  })
  return Object.assign(state, { scheduler, supabase, abort,
    pause: () => scheduler.requestPauseCampaign(1),
    finish: async () => { await scheduler.completeCampaignPause({ ...row }); scheduler.campaignRunBoundaries.delete(1) }
  })
}
const assertPaused = (f, result) => {
  assert.equal(result.status, 'tạm dừng'); assert.equal(result.note, null)
  assert.equal(f.row.status, 'tạm dừng'); assert.equal(f.row.note, null)
  assert.equal(f.events.at(-1).status, 'tạm dừng'); assert.equal(f.events.at(-1).note, null)
  assert.equal(f.closed, 1, 'cancel browsing/rest immediately')
}

async function main() {
  let f = fixture()
  const pending = await f.pause()
  assert.equal(pending.status, 'đang chạy'); assert.equal(pending.note, pendingNote)
  assert.equal(f.logs.length, 1); assert.equal(f.closed, 1)
  await f.finish(); assert.equal(f.row.note, null)

  // Reproduce the screenshot: pause completion commits before the hint UPDATE.
  f = fixture(); f.beforeWrite = gate()
  let request = f.pause(); await f.beforeWrite.entered
  assert.equal(f.closed, 1, 'abort must not wait on DB')
  await f.finish(); f.beforeWrite.release()
  assertPaused(f, await request); assert.equal(f.logs.length, 0)

  // A successful hint response can also arrive after completion.
  f = fixture(); f.afterWrite = gate()
  request = f.pause(); await f.afterWrite.entered
  await f.finish(); f.afterWrite.release()
  assertPaused(f, await request); assert.equal(f.logs.length, 0, 'do not announce an obsolete pending pause')

  // Pause is already complete when requestPauseCampaign's first read returns.
  f = fixture(); const read = gate()
  f.supabase.getCampaign = async () => { await read.wait(); return { ...f.row } }
  request = f.pause(); await read.entered
  await f.finish(); read.release()
  assertPaused(f, await request); assert.equal(f.queries, 0)

  // The first read may return an old running snapshot after cleanup.
  f = fixture(); const staleRead = gate(); let first = true
  f.supabase.getCampaign = async () => {
    const snapshot = { ...f.row }
    if (first) { first = false; await staleRead.wait() }
    return snapshot
  }
  request = f.pause(); await staleRead.entered
  await f.finish(); staleRead.release()
  assertPaused(f, await request)

  // A delayed request must not annotate a resumed run with a new claim.
  for (const phase of ['beforeWrite', 'afterWrite']) {
    f = fixture(); f[phase] = gate()
    request = f.pause(); await f[phase].entered
    await f.finish()
    Object.assign(f.row, { status: 'đang chạy', runtime_claim_token: newToken, note: 'new run' })
    f.scheduler.campaignRunBoundaries.set(1, { runtimeClaimToken: newToken })
    f[phase].release()
    const result = await request
    assert.equal(result.note, 'new run'); assert.equal(result.status, 'đang chạy')
    assert.equal(f.row.note, 'new run'); assert.equal(f.events.at(-1).note, 'new run')
    assert.equal(f.scheduler.pauseRequests.has(1), false); assert.equal(f.logs.length, 0)
  }

  // Missing local ownership must not fall back to a tokenless UPDATE.
  f = fixture(); f.scheduler.campaignRunBoundaries.clear()
  assert.equal((await f.pause()).note, null); assert.equal(f.queries, 0)
  assert.equal(f.scheduler.pauseRequests.has(1), true, 'normal pause boundary remains latched')

  // A settled run can still hold its claim while status is pending.
  f = fixture(); f.row.status = 'chờ xử lý'
  f.supabase.setDesktopCampaignStatusV2 = async () => ({ ok: false, reason: 'runtime_busy' })
  assert.equal((await f.pause()).note, null)
  assert.equal(f.scheduler.pauseRequests.has(1), true); assert.equal(f.writes.length, 0)

  // Repository guards also reject other tenants, soft-deleted and terminal rows.
  for (const patch of [{ staff_id: 8 }, { is_delete: true }, { status: 'hoàn thành' },
    { status: 'tạm dừng' }, { status: 'chờ xử lý' }, { runtime_claim_token: null }]) {
    f = fixture(); Object.assign(f.row, patch)
    assert.equal(await f.supabase.updateRunningDesktopCampaignPauseNote(1, oldToken, pendingNote), null)
    assert.equal(f.writes.length, 0)
  }
  f = fixture()
  assert.equal(await f.supabase.updateRunningDesktopCampaignPauseNote(1, '', pendingNote), null)
  assert.equal(f.queries, 0)
  console.log('PASS pause note: same-claim CAS, late write/response, fast pause, stale read, resumed run, missing ownership, pending release and tenant/delete/status guards')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

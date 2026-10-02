// Offline lifecycle/deadline tests. No DB or Facebook requests.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

class Clock {
  now = 0; next = 1; timers = new Map()
  set = (callback, ms, interval = false) => {
    const id = this.next++; this.timers.set(id, { callback, at: this.now + Math.max(1, ms), interval: interval ? ms : 0 }); return id
  }
  clear = id => this.timers.delete(id)
  async flush() { for (let i = 0; i < 40; i++) await Promise.resolve() }
  async tick(ms) {
    await this.flush()
    const end = this.now + ms
    while (true) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [id, timer] = next; this.now = timer.at
      if (timer.interval) timer.at += timer.interval; else this.timers.delete(id)
      timer.callback(); await this.flush()
    }
    this.now = end; await this.flush()
  }
}

function load(file, globals = {}, imports = {}) {
  const mod = { exports: {} }
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: name => imports[name] || require(name),
    AbortController, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, performance, ...globals }, { filename: file })
  return mod.exports
}
const shared = load('src/shared/facebookRestBrowse.ts')
const settings = { ...shared.FACEBOOK_REST_BROWSE_DEFAULTS, enabled: true, browseSeconds: 4, restSeconds: 1 }
const clone = value => JSON.parse(JSON.stringify(value))
const pending = () => new Promise(() => {})

function fixture(overrides = {}) {
  const clock = new Clock(), events = [], controller = new AbortController()
  const NativeDate = Date
  const globals = { setTimeout: (cb, ms) => clock.set(cb, ms), clearTimeout: clock.clear,
    setInterval: (cb, ms) => clock.set(cb, ms, true), clearInterval: clock.clear,
    performance: { now: () => clock.now }, Date: class extends NativeDate { static now() { return 1_800_000_000_000 + clock.now } } }
  const { runFacebookRestBrowse } = load('src/main/services/facebookRestBrowse.ts', globals, { '../../shared/facebookRestBrowse': shared })
  const options = {
    settings, targetUrl: 'https://www.facebook.com/groups/123/', signal: controller.signal,
    isCancelled: () => false, checkControl: async () => ({ allowed: true, remainingMs: 60_000 }),
    loadWorkflow: async () => ({ id: 1, nodes: [], edges: [] }),
    createPage: () => { events.push('create'); return { page: { navigate: async url => events.push(url), evaluate: async () => true }, destroy: () => events.push('destroy') } },
    preview: page => events.push(page ? 'preview' : 'clear-preview'),
    log: line => events.push(line),
    runWorkflow: async (_workflow, variables, page, signal, onStarted) => {
      onStarted(); events.push(['vars', clone(variables)]); await page.navigate('https://www.facebook.com/');
      await new Promise(resolve => clock.set(resolve, 4900)); events.push('finished'); return { status: 'completed' }
    }, ...overrides
  }
  return { clock, events, options, controller, run: () => runFacebookRestBrowse(options) }
}

async function main() {
  for (const id of ['facebook_group_post', 'facebook_comment_seeding', 'facebook_message_uid']) assert(shared.supportsFacebookRestBrowse(id))
  for (const id of ['facebook_comment_seeding_post', 'facebook_message_friend', 'facebook_page_to_message', 'facebook_newsfeed_interaction', 'zalo_message_phone']) assert(!shared.supportsFacebookRestBrowse(id))
  assert.equal(shared.facebookRestBrowseSettings().enabled, false)
  assert.equal(shared.validateFacebookRestBrowse(settings), null)
  for (const patch of [{ browseSeconds: 0 }, { browseSeconds: 1.5 }, { restSeconds: -1 }, { restSeconds: Infinity }, { browseTarget: false, browseHome: false }]) {
    assert(shared.validateFacebookRestBrowse({ ...settings, ...patch }))
  }
  assert.deepEqual(clone(shared.facebookRestBrowseSegments(settings, 'target')).map(item => item.durationMs), [2000, 2000])
  assert.deepEqual(clone(shared.facebookRestBrowseSegments({ ...settings, browseHome: false }, 'target')).map(item => item.durationMs), [4000])
  assert.deepEqual(clone(shared.facebookRestBrowseSegments(settings, null)).map(item => item.durationMs), [2000])
  assert.equal(shared.facebookRestBrowseTarget('facebook_group_post', '123'), 'https://www.facebook.com/groups/123/')
  assert.equal(shared.facebookRestBrowseTarget('facebook_group_post', 'groups/123'), 'https://www.facebook.com/groups/123/')
  assert.equal(shared.facebookRestBrowseTarget('facebook_message_uid', 'https://www.facebook.com/profile.php?id=12'), 'https://www.facebook.com/profile.php?id=12')
  for (const url of ['https://evil.test/a', 'https://facebook.com.evil.test/a', 'https://a:secret@facebook.com/a', 'https://facebook.com/login']) assert.equal(shared.facebookRestBrowseTarget('facebook_message_uid', url), null)

  let f = fixture(); let result = f.run(); await f.clock.tick(5000)
  assert.equal(await result, 'completed'); assert(f.events.indexOf('destroy') > f.events.indexOf('finished')); assert.equal(f.clock.timers.size, 0)
  for (const patch of [{ settings: { ...settings, enabled: false } }, { settings: { ...settings, browseTarget: true, browseHome: false }, targetUrl: null }, { loadWorkflow: async () => null }, { loadWorkflow: async () => { throw Error('offline') } }]) {
    f = fixture(patch); result = f.run(); await f.clock.tick(1); assert.equal(await result, 'skipped'); assert(!f.events.includes('create')); assert.equal(f.clock.timers.size, 0)
  }
  f = fixture({ log: () => { throw Error('log failed') } }); result = f.run(); await f.clock.tick(5000); assert.equal(await result, 'completed')
  f = fixture({ settings: { ...settings, browseSeconds: 180 }, loadWorkflow: pending }); result = f.run(); await f.clock.tick(10_000); assert.equal(await result, 'skipped'); assert(!f.events.includes('create'))
  f = fixture({ settings: { ...settings, browseSeconds: 180 }, runWorkflow: pending }); result = f.run(); await f.clock.tick(10_000); assert.equal(await result, 'skipped'); assert(f.events.includes('destroy'))
  let latePage, resolveNavigation
  f = fixture({ settings: { ...settings, browseSeconds: 180 },
    createPage: () => ({ page: { navigate: () => new Promise(resolve => { resolveNavigation = resolve }) }, destroy: () => f.events.push('destroy') }),
    runWorkflow: async (_w, _v, page, _signal, onStarted) => { onStarted(); latePage = page; await page.navigate('first'); await page.navigate('late'); return { status: 'completed' } }
  }); result = f.run(); await f.clock.tick(10_000); assert.equal(await result, 'skipped'); assert(f.events.includes('destroy'))
  resolveNavigation(); await f.clock.flush(); await assert.rejects(latePage.navigate('late'))
  for (const reason of ['pause', 'stop', 'logout']) {
    f = fixture(); result = f.run(); await f.clock.tick(400); f.controller.abort(reason); await f.clock.flush()
    assert.equal(await result, 'cancelled'); assert(f.events.includes('destroy')); assert(f.events.includes('clear-preview'))
  }
  f = fixture({ checkControl: async () => ({ allowed: false, remainingMs: 0 }) }); result = f.run(); await f.clock.tick(1); assert.equal(await result, 'cancelled'); assert(!f.events.includes('create'))
  f = fixture({ checkControl: async () => ({ allowed: true, remainingMs: 700 }) }); result = f.run(); await f.clock.tick(1000); assert.notEqual(await result, 'completed'); assert(f.events.includes('destroy'))
  f = fixture({ checkControl: pending }); result = f.run(); await f.clock.tick(5000); assert.equal(await result, 'skipped'); assert(!f.events.includes('create'))

  await schedulerSmoke()
  await targetLoopSmoke()
  console.log('PASS Facebook rest/browse: settings, targets, split, deadlines, hung IO, late callbacks, cancellation and scheduler lifecycle')
}

async function targetLoopSmoke() {
  const { fixture: loopFixture } = require('./page-inbox-campaign-run-smoke-test.cjs')
  for (const actionId of ['facebook_group_post', 'facebook_comment_seeding', 'facebook_message_uid']) {
    for (const mode of ['hour', 'preclaim-race', 'day', 'partial', 'complete']) {
      const f = loopFixture({ actionId }), events = []
      f.campaign.extraSettings.facebookRestBrowse = settings
      let checks = 0
      f.scheduler.checkActionLimitsForContinuation = async () => {
        checks++
        return { runnableActionDescriptors: [], skippedLimitStatuses: mode === 'partial' ? [{ errorCode: 'error_limit_in_hour' }] : [],
          limitStatus: mode === 'preclaim-race' || checks > 1 && ['hour', 'day'].includes(mode)
            ? { errorCode: mode === 'day' ? 'error_limit_in_day' : 'error_limit_in_hour' } : null }
      }
      f.scheduler.browseFacebookBeforeHourlyWait = async (_a, c, limit, last) => {
        if (last && limit.errorCode === 'error_limit_in_hour') {
          assert.equal(c.status, 'đang chạy'); assert.equal(last.id, 1); assert.equal(f.stats.claimed, false, 'previous input was fully settled')
          events.push('browse-rest')
        }
        return false
      }
      f.scheduler.handleLimitStatus = async () => { events.push('limit'); f.campaign.status = 'chờ xử lý' }
      f.scheduler.handleCampaignCompletion = async () => events.push('complete')
      f.scheduler.releaseRunningAccount = async () => events.push('release')
      await f.run(mode === 'complete' ? ['chờ xử lý'] : ['chờ xử lý', 'chờ xử lý', 'chờ xử lý'])
      assert.deepEqual(events, mode === 'hour' ? ['browse-rest', 'limit', 'release']
        : ['preclaim-race', 'day'].includes(mode) ? ['limit', 'release'] : ['complete', 'release'])
      assert.equal(f.stats.flags.length, mode === 'hour' || mode === 'day' || mode === 'complete' ? 1 : mode === 'preclaim-race' ? 0 : 3)
    }
  }
  console.log('PASS real scheduler target loop: hourly one-shot ordering, pre-first-target race, daily limit, partial continuation and exhausted data')
}

async function schedulerSmoke() {
  const filename = path.join(root, 'src/main/services/campaignScheduler.ts')
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
  const names = ['browseFacebookBeforeHourlyWait', 'handleLimitStatus', 'updateErrorPolicyCampaign']
  const body = names.map(name => declaration.members.find(member => member.name?.getText(source) === name).getText(source)).join('\n')
  const js = ts.transpileModule(`class Scheduler { ${body} }; module.exports = Scheduler`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let childRuns = 0, onRun
  const mod = { exports: {} }
  vm.runInNewContext(js, { module: mod, ...shared, AbortController, LIMIT_IN_HOUR_ERROR_CODE: 'error_limit_in_hour',
    getWorkflowByName: async () => ({}), runFacebookRestBrowse: async options => { childRuns++; if (onRun) await onRun(options) } })
  const Scheduler = mod.exports
  const campaign = { id: 1, actionId: 'facebook_group_post', status: 'đang chạy', extraSettings: { facebookRestBrowse: settings } }
  const account = { id: 2, flatformType: 'facebook', status: 'đang chạy' }
  const hourly = { errorCode: 'error_limit_in_hour', actionCode: 'fb_post_group' }
  const events = []
  let pause = false, boundary = false
  const scheduler = Object.assign(new Scheduler(), { running: true, activeFacebookRestBrowses: new Set(), activeV2Aborts: new Map(),
    isCampaignPauseRequested: () => pause,
    completePauseAtBoundary: async () => { events.push('pause'); campaign.status = 'tạm dừng' },
    stopCampaignAtRunBoundaryIfNeeded: async () => boundary,
    releaseRunningAccount: async () => events.push('release'),
    stopCampaignForAccountCondition: async () => events.push('account-stop'),
    getLimitActionName: () => 'Đăng bài', buildLimitReplacements: () => ({}), addActionContextToMessage: text => text,
    handleRuntimeError: async () => { events.push('limit-policy'); campaign.status = 'chờ xử lý' }
  })
  const target = { uid: '123' }
  for (const [c, a, status, last] of [
    [campaign, account, hourly, null], [campaign, account, { errorCode: 'error_limit_in_day' }, target],
    [campaign, account, { ...hourly, isActionDisabled: true }, target],
    [{ ...campaign, actionId: 'facebook_comment_seeding_post' }, account, hourly, target],
    [{ ...campaign, extraSettings: {} }, account, hourly, target]
  ]) assert.equal(await scheduler.browseFacebookBeforeHourlyWait(a, c, status, last), false)
  assert.equal(childRuns, 0)
  onRun = async options => { assert.equal(campaign.status, 'đang chạy'); assert.equal(account.status, 'đang chạy'); assert.equal(options.targetUrl, 'https://www.facebook.com/groups/123/'); events.push('browse-rest') }
  assert.equal(await scheduler.browseFacebookBeforeHourlyWait(account, campaign, hourly, target), false)
  await scheduler.handleLimitStatus(account, campaign, hourly)
  assert.deepEqual(events, ['browse-rest', 'limit-policy']); assert.equal(campaign.status, 'chờ xử lý'); assert.equal(scheduler.activeV2Aborts.size, 0)
  campaign.status = 'đang chạy'; events.length = 0
  onRun = async () => { throw Error('optional failure') }
  assert.equal(await scheduler.browseFacebookBeforeHourlyWait(account, campaign, hourly, target), false)
  assert.equal(campaign.status, 'đang chạy')
  onRun = async () => { pause = true }
  assert.equal(await scheduler.browseFacebookBeforeHourlyWait(account, campaign, hourly, target), true)
  assert.equal(campaign.status, 'tạm dừng'); assert.deepEqual(events, ['pause']); pause = false
  onRun = async () => { boundary = true }
  assert.equal(await scheduler.browseFacebookBeforeHourlyWait(account, campaign, hourly, target), true); boundary = false
  onRun = async () => { scheduler.running = false }
  assert.equal(await scheduler.browseFacebookBeforeHourlyWait(account, campaign, hourly, target), true)

  // Exercise the real repository CAS, including pause/token changes while the
  // original Page identity is being restored at the end of the auxiliary run.
  const repositoryFile = path.join(root, 'src/main/data/repositories/campaignRepository.ts')
  const repositorySource = ts.createSourceFile(repositoryFile, fs.readFileSync(repositoryFile, 'utf8'), ts.ScriptTarget.Latest, true)
  const repositoryMethod = repositorySource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'updateRunningDesktopCampaign')
  const repositoryJs = ts.transpileModule(repositoryMethod.getText(repositorySource), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}, row = { id: 1, staff_id: 7, status: 'đang chạy', is_delete: false, runtime_claim_token: 'owned' }
  vm.runInNewContext(repositoryJs, { exports, CAMPAIGN_SELECT: '*', requireCurrentUser: () => ({ staffId: 7 }), mapCampaignFromDB: value => value,
    getCampaign: async () => ({ ...row }), client: () => ({ from: () => {
      const filters = {}, query = { update: patch => { query.patch = patch; return query }, eq: (key, value) => { filters[key] = value; return query },
        select: () => query, maybeSingle: async () => {
          assert.equal(filters.runtime_claim_token, 'owned'); assert.equal(filters.staff_id, 7); assert.equal(filters.status, 'đang chạy')
          if (!Object.entries(filters).every(([key, value]) => row[key] === value)) return { data: null }
          Object.assign(row, query.patch); return { data: { ...row } }
        } }; return query
    } }) })
  Object.assign(scheduler, { failedCampaignRuns: new Map(), campaignRunBoundaries: new Map([[1, { runtimeClaimToken: 'owned' }]]),
    restoreFacebookPageIdentity: async () => {}, broadcastCampaignUpdate: () => {}, supabase: exports })
  pause = false
  await scheduler.updateErrorPolicyCampaign(campaign, { status: 'chờ xử lý' }, true); assert.equal(row.status, 'chờ xử lý')
  row.status = 'đang chạy'; scheduler.restoreFacebookPageIdentity = async () => { row.status = 'tạm dừng' }
  await scheduler.updateErrorPolicyCampaign(campaign, { status: 'chờ xử lý' }, true); assert.equal(row.status, 'tạm dừng')
  row.status = 'đang chạy'; scheduler.restoreFacebookPageIdentity = async () => { row.runtime_claim_token = 'new-owner' }
  await scheduler.updateErrorPolicyCampaign(campaign, { status: 'chờ xử lý' }, true); assert.equal(row.status, 'đang chạy')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

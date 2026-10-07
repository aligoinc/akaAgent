// Offline regression: actual SDK upload/send, runtime and scheduler methods.
// No login, external requests, SQL connection or real Zalo action.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const flush = () => new Promise(resolve => setImmediate(resolve))
async function waitForUploadCallback(ctx) {
  // SDK attachment setup reads real files. A fixed number of setImmediate
  // turns can finish before filesystem I/O under concurrent typecheck/build.
  const deadline = Date.now() + 5000
  while (!ctx.uploadCallbacks.size && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(ctx.uploadCallbacks.size, 1, 'SDK must register the fixture upload callback')
}
function fakeClock() {
  let now = 0
  const tasks = new Set()
  return {
    tasks,
    set(fn, ms) { const task = { fn, at: now + ms, unref() {} }; tasks.add(task); return task },
    clear(task) { tasks.delete(task) },
    async advance(ms) { now += ms; for (const task of [...tasks]) if (task.at <= now) { tasks.delete(task); task.fn() }; await flush() }
  }
}
const clock = fakeClock()
function load(file, imports) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, require: imports, Error, Map, Set, WeakMap, AbortController, AbortSignal, Request, Response,
    Buffer, URL, console, process, setImmediate, queueMicrotask,
    setTimeout: (fn, ms) => clock.set(fn, ms), clearTimeout: task => clock.clear(task), setInterval, clearInterval
  }, { filename: file })
  return exports
}
const media = load('src/main/services/campaignMediaExecution.ts', require)
const timeout = () => new media.CampaignMediaTimeoutError(180000)
function harness(file, name, methods, globals) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === name)
  const body = methods.map(name => {
    const node = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
    assert.ok(node, name); return node.getText(source)
  }).join('\n')
  const code = ts.transpileModule(`class Harness { ${body} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(globals), code + '; return Harness')(...Object.values(globals))
}

async function runtimeCases(zca) {
  const sdkRoot = pathToFileURL(path.join(root, 'node_modules/zca-js/dist') + path.sep)
  const { createContext } = await import(new URL('context.js', sdkRoot))
  const { uploadAttachmentFactory } = await import(new URL('apis/uploadAttachment.js', sdkRoot))
  const { sendMessageFactory } = await import(new URL('apis/sendMessage.js', sdkRoot))
  const { encodeAES } = await import(new URL('utils.js', sdkRoot))
  const Runtime = harness('src/main/services/zaloRuntimeService.ts', 'ZaloRuntimeService', [
    'sendMessageToUser', 'sendMessageToGroup', 'sendMessage', 'getCampaignMediaExecution',
    'invalidateAccount', 'clearQrAccountRuntimeCache'
  ], { ...zca, ...media, requiresZaloUploadCallback: file => /\.mp4$/.test(file), isZaloWebSupportedAttachment: () => true,
    ZALO_FILE_MESSAGE_SEND_TIMEOUT_MS: 180000, ZALO_MESSAGE_SEND_TIMEOUT_MS: 90000, ZALO_LISTENER_REFRESH_AFTER_MS: 1800000 })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-media-fixture-'))
  const video = path.join(dir, 'video.mp4'); fs.writeFileSync(video, 'offline-video')
  try {
    for (const type of ['user', 'group']) {
      const ctx = createContext()
      Object.assign(ctx, { secretKey: Buffer.alloc(16, 1).toString('base64'), uid: 'fixture', imei: 'fixture',
        userAgent: 'fixture', language: 'vi', settings: { features: { sharefile: {
          max_file: 10, max_size_share_file_v3: 100, restricted_ext_file: [], chunk_size_file: 1024
        } } } })
      let fileId = 0, stopped = 0
      const requests = [], signals = [], proxy = { fixture: true }
      ctx.options.agent = proxy
      const originalFetcher = async (url, options) => {
        requests.push(String(url)); signals.push(options.signal)
        assert.equal(options.agent, proxy, 'keep existing proxy transport options')
        let data
        if (String(url).includes('/asyncfile/upload?')) data = { fileId: String(++fileId) }
        else if (String(url).includes('/asyncfile/msg?')) data = { msgId: 'sent' }
        else throw new Error('Unexpected offline request')
        return Response.json({ error_code: 0, data: encodeAES(ctx.secretKey, JSON.stringify({ error_code: 0, data })) })
      }
      ctx.options.polyfill = originalFetcher
      const api = { getContext: () => ctx,
        zpwServiceMap: { file: ['https://file.test'], chat: ['https://chat.test'], group: ['https://group.test'] } }
      api.uploadAttachment = uploadAttachmentFactory(ctx, api)
      api.sendMessage = sendMessageFactory(ctx, api)
      const runtime = Object.assign(new Runtime(), {
        campaignMediaExecutions: new WeakMap(), ensureApi: async () => api,
        apiCache: new Map([[1, { api }]]), apiLoginInflight: new Map(), verifyInflight: new Map(), accountCacheVersions: new Map(),
        getAccountCacheVersion: () => 0, webRuntime: { invalidateApi() {} }, stopZaloListener: () => { stopped++ },
        supabase: { getAccount: async () => ({ flatformType: 'zalo' }) }, ensureZaloListenerReady: async () => {},
        withTimeout: async promise => promise
      })
      const send = () => type === 'user' ? runtime.sendMessageToUser(1, 'recipient', '', [video], true)
        : runtime.sendMessageToGroup(1, 'recipient', '', [video], true)
      const failed = assert.rejects(send(), error => error.code === media.CAMPAIGN_MEDIA_TIMEOUT_CODE)
      await waitForUploadCallback(ctx)
      assert.equal(ctx.uploadCallbacks.size, 1)
      const late = ctx.uploadCallbacks.get('1')
      assert.equal(requests.length, 1)
      await clock.advance(180000); await failed
      assert.equal(ctx.uploadCallbacks.size, 0)
      assert.equal(stopped, 0, 'healthy listener stays open after deadline')
      assert.ok(signals[0].aborted)
      await late({ fileId: '1', fileUrl: 'https://file.test/file1' }); await flush()
      assert.equal(requests.length, 1, 'late file_done must not deliver')
      const next = send()
      await waitForUploadCallback(ctx)
      await ctx.uploadCallbacks.get('2')({ fileId: '2', fileUrl: 'https://file.test/file2' })
      assert.ok((await next).attachment.length)
      assert.equal(requests.length, 3)
      assert.equal(clock.tasks.size, 0)
      // Active invalidation fences SDK continuation and reports uncertainty.
      const cancelled = assert.rejects(send(), error => error.code === 'command_result_unknown')
      await waitForUploadCallback(ctx)
      runtime.invalidateAccount(1); await cancelled
      assert.equal(ctx.uploadCallbacks.size, 0)
      assert.equal(clock.tasks.size, 0)
      // No scope: preserve the original transport/signal for manual requests.
      await ctx.options.polyfill('https://file.test/asyncfile/upload?', { agent: proxy })
      assert.equal(signals.at(-1), undefined)
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }

  // Image and manual/Web paths retain their configured time budgets/scope.
  for (const scenario of ['image', 'manual', 'web', 'stale']) {
    let sends = 0, outerTimeout = 0
    const ctx = { options: { polyfill: async () => new Response('offline') }, uploadCallbacks: new Map() }
    const api = { getContext: () => ctx, sendMessage: () => { sends++; return new Promise(() => {}) } }
    const runtime = Object.assign(new Runtime(), {
      campaignMediaExecutions: new WeakMap(), apiCache: new Map([[1, { api }]]),
      ensureApi: async () => api, ensureZaloListenerReady: async () => {},
      supabase: { getAccount: async () => {
        if (scenario === 'stale') runtime.apiCache.clear()
        return { flatformType: 'zalo', isZaloShowWeb: scenario === 'web' }
      } },
      withTimeout: (_promise, ms) => { outerTimeout = ms; return {} }
    })
    const operation = runtime.sendMessageToUser(1, 'fixture', '', ['image.jpg'], scenario !== 'manual')
    if (scenario === 'image') {
      const failed = assert.rejects(operation, error => error.code === media.CAMPAIGN_MEDIA_TIMEOUT_CODE)
      await flush(); await clock.advance(89999)
      assert.equal(clock.tasks.size, 1)
      await clock.advance(1); await failed; assert.equal(sends, 1); assert.equal(outerTimeout, 0)
    } else if (scenario === 'stale') {
      await assert.rejects(operation, error => error.code === 'campaign_runtime_unavailable')
      assert.equal(sends, 0)
    } else {
      await operation; assert.equal(outerTimeout, 90000); assert.equal(sends, 1)
      assert.equal(runtime.campaignMediaExecutions.has(api), false)
    }
  }

  // In-flight HTTP is aborted; already-running callbacks and Promise.all
  // siblings cannot start another request after the scope is closed.
  let calls = 0, resolveLate
  const late = new Promise(resolve => { resolveLate = resolve })
  const execution = new media.CampaignMediaExecution(async (_url, init) => {
    calls++
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
  })
  const rejected = assert.rejects(execution.run(() => Promise.all([
    execution.fetch('https://fixture.test/upload'),
    late.then(() => execution.fetch('https://fixture.test/deliver'))
  ]), 20), error => error.code === media.CAMPAIGN_MEDIA_TIMEOUT_CODE)
  await flush(); await clock.advance(20); await rejected; resolveLate(); await flush()
  assert.equal(calls, 1)
  let releaseSibling, siblingCalls = 0
  const sibling = new Promise(resolve => { releaseSibling = resolve })
  const ordinary = new media.CampaignMediaExecution(async () => { siblingCalls++; return new Response('offline') })
  const error = Object.assign(new Error('SDK policy failure'), { code: 120 })
  await assert.rejects(ordinary.run(() => Promise.all([
    Promise.reject(error), sibling.then(() => ordinary.fetch('https://fixture.test/deliver'))
  ]), 180000), e => e === error)
  releaseSibling(); await flush(); assert.equal(siblingCalls, 0)
  assert.equal(clock.tasks.size, 0)
}

function schedulerClass(zca) {
  function Stub() {}
  const placeholders = new Proxy({}, { get: (_, key) => {
    if (key === 'getCurrentUser') return () => ({ staffId: 3, organizationId: 4 })
    if (key === 'getErrorMessage') return error => error?.message || String(error)
    if (key === 'beginCampaignEngagementSend') return () => ({ operationId: 'offline' })
    if (key === 'IPC_EVENTS') return {}
    return Stub
  } })
  return load('src/main/services/campaignScheduler.ts', name =>
    name === 'zca-js' ? zca : name === './campaignMediaExecution' ? media
      : ['crypto', 'path', 'fs', 'os'].includes(name) ? require(name) : placeholders).CampaignScheduler
}
function fixture(Scheduler, { threshold = 4, initial = 0, explicit = null, target = 'desktop', group = true } = {}) {
  let count = initial
  const attempts = [], details = [], updates = [], increments = [], effects = [], forwards = []
  const campaign = { id: 10, status: 'đang chạy', actionId: group ? 'zalo_message_group' : 'zalo_message_friend', extraSettings: {}, name: 'fixture' }
  const account = { id: 20, flatformType: 'zalo', isZaloServer: target === 'server' }
  const policy = { errorCode: 'err_zalo_api_business_failed', errorName: 'Lỗi Zalo', detailStatus: 'thất bại', countsTowardBadTarget: true,
    countsTowardLimit: true, disableActionCodes: [], countConsecutiveErrors: null }
  const db = {
    getZaloErrorPolicyByCode: async code => code === media.CAMPAIGN_MEDIA_TIMEOUT_CODE ? explicit : null,
    getErrorPolicy: async code => code === 'err_undefined' ? { ...policy, errorCode: code, countConsecutiveErrors: threshold, updateStatusCampaign: 'tạm dừng' } : policy,
    createCampaignDetail: async data => { details.push(data); return { ...data, id: details.length } },
    updateCampaignInputData: async (id, patch) => { updates.push({ id, ...patch }) },
    incrementCampaignBadTargetCount: async (_id, input) => { increments.push(input); return { countConsecutiveBadTargets: ++count } },
    resetCampaignBadTargetCount: async () => { count = 0 },
    createZaloApiErrorLog: async () => {}, getCampaign: async () => campaign
  }
  const scheduler = new Scheduler(db, {}, { webContents: { send() {} } }, undefined, undefined, undefined, { runtimeTarget: target })
  scheduler.activeCampaignRunUnits.set(campaign.id, { unstartedInputDataIds: new Set(), externalWorkStarted: false })
  Object.assign(scheduler, {
    logCampaignProgress: async () => {}, logZaloApiError: async () => {}, diagnoseUndefinedErrorWithScreenshot: async () => null,
    updateErrorPolicyCampaign: async (_campaign, patch) => { Object.assign(campaign, patch) },
    updateErrorPolicyAccount: async () => {},
    zaloRuntime: {
      sendMessageToUser: async (_account, thread, _text, _files, scoped) => { assert.equal(scoped, true); attempts.push(Number(thread)); throw timeout() },
      sendMessageToGroup: async (...args) => scheduler.zaloRuntime.sendMessageToUser(...args),
      forwardMessageToUsers: async (_id, ids) => { forwards.push(ids); return { results: ids.map(threadId => ({ threadId, ok: true })) } },
      forwardMessageToGroups: async (...args) => scheduler.zaloRuntime.forwardMessageToUsers(...args)
    }
  })
  const original = scheduler.applyZaloPolicySideEffects.bind(scheduler)
  scheduler.applyZaloPolicySideEffects = async (...args) => { effects.push(args); return original(...args) }
  const rows = n => Array.from({ length: n }, (_, index) => ({ detail: { id: 100 + index }, threadId: String(index), target: { uid: String(index) }, inputData: {} }))
  const run = async (outcomes, text = true) => {
    const batch = rows(outcomes.length)
    scheduler.activeCampaignRunUnits.get(campaign.id).unstartedInputDataIds = new Set(batch.map(item => item.detail.id))
    scheduler.zaloRuntime.sendMessageToUser = async (_id, thread, _message, _files, scoped) => {
      assert.equal(scoped, true); attempts.push(Number(thread))
      if (outcomes[Number(thread)] === 'T') throw timeout()
      return {}
    }
    return scheduler.processZaloShareMessageBatch(account, campaign, batch, [], { code: campaign.actionId, name: 'Nhắn tin' },
      text ? { msg: 'Xin chào', styles: [{ start: 0, len: 8, st: 'b' }] } : '', ['fixture.mp4'], new Map())
  }
  return { scheduler, account, campaign, db, attempts, details, updates, increments, effects, forwards, rows, run, count: () => count }
}
async function schedulerCases(Scheduler) {
  const cases = [
    ['TTTTSS', 4, 0, 4, 4, true], ['TTSS', 2, 0, 2, 2, true], ['TSTTTTSS', 4, 0, 6, 4, true],
    ['STTTTS', 4, 3, 5, 4, true], ['STT', 4, 0, 3, 2, false], ['TTS', 4, 0, 3, 0, false],
    ['TT', 4, 0, 2, 2, false], ['TSS', 4, 3, 1, 4, true]
  ]
  for (const target of ['desktop', 'server']) for (const group of [true, false]) for (const [outcomes, threshold, initial, sent, count, stop] of cases) {
    const f = fixture(Scheduler, { target, group, threshold, initial })
    const result = await f.run(outcomes)
    assert.equal(f.attempts.length, sent, `${target}/${group}/${outcomes}`)
    assert.equal(f.count(), count, outcomes)
    assert.equal(result.stopAfterBatch, stop, outcomes)
    assert.equal(result.pauseAfterBatch, false)
    assert.equal(f.campaign.status, stop ? 'tạm dừng' : 'đang chạy')
    const failedIds = [...outcomes].slice(0, sent).flatMap((outcome, index) => outcome === 'T' ? [100 + index] : [])
    assert.deepEqual(f.increments, failedIds)
    assert.equal(f.details.length, sent)
    for (let i = 0; i < outcomes.length; i++) {
      const status = f.updates.filter(update => update.id === i + 100).at(-1)?.status
      assert.equal(status, i < sent ? 'hoàn thành' : 'chờ xử lý')
    }
    assert.deepEqual([...f.scheduler.activeCampaignRunUnits.get(10).unstartedInputDataIds], f.rows(outcomes.length).slice(sent).map(item => item.detail.id))
    if (stop) assert.equal(f.forwards.length, 0, 'no forward after policy stop')
  }
  for (const detailStatus of [null, 'thất bại']) {
    const f = fixture(Scheduler, { explicit: { errorCode: media.CAMPAIGN_MEDIA_TIMEOUT_CODE, detailStatus,
      countsTowardBadTarget: false, disableActionCodes: [], updateStatusCampaign: 'tạm dừng' } })
    assert.equal((await f.run('TSS')).stopAfterBatch, true)
    assert.equal(f.attempts.length, 1); assert.equal(f.increments.length, 0)
    assert.equal(f.details.length, detailStatus ? 1 : 0)
    assert.equal(f.updates.find(update => update.id === 100).status, 'hoàn thành')
  }
  const noncounting = fixture(Scheduler, { explicit: { detailStatus: 'thất bại', countsTowardBadTarget: false, disableActionCodes: [] } })
  assert.equal((await noncounting.run('TT')).stopAfterBatch, false)
  assert.equal(noncounting.count(), 0)
  // DB failures escape once; the next target remains unstarted.
  for (const name of ['getZaloErrorPolicyByCode', 'createCampaignDetail', 'updateCampaignInputData', 'incrementCampaignBadTargetCount', 'resetCampaignBadTargetCount']) {
    const f = fixture(Scheduler)
    const error = Object.assign(new Error('database response lost'), { code: '08006' })
    f.db[name] = async () => { throw error }
    await assert.rejects(f.run(name === 'resetCampaignBadTargetCount' ? 'STS' : 'TSS'), e => e === error)
    assert.equal(f.attempts.length, name === 'resetCampaignBadTargetCount' ? 2 : 1)
    assert.ok(f.scheduler.activeCampaignRunUnits.get(10).unstartedInputDataIds.has(102))
  }

  // Normal workflow helpers share one input scope. A fenced timeout must not
  // invoke add-friend/tag/alias helpers later, even for a policy-only result.
  for (const detailStatus of [null, 'thất bại']) {
    const f = fixture(Scheduler, { explicit: { detailStatus, countsTowardBadTarget: true, disableActionCodes: [] } })
    let downstream = 0
    f.scheduler.zaloSendFriendMessage = async () => ({ ok: false, zaloTarget: { uid: 'recipient' },
      detail: await f.scheduler.createZaloErrorDetail(f.account, f.campaign, timeout(), 'zalo_message_friend', 'Nhắn tin') })
    for (const method of ['zaloSendPhoneFriendRequest', 'zaloApplyContactTag', 'zaloChangeContactAlias'])
      f.scheduler[method] = async () => { downstream++; return { ok: true } }
    const helpers = f.scheduler.createBlockRuntimeHelpers(f.account, f.campaign, { id: 100 }, null)
    const result = await helpers.zaloSendFriendMessage({})
    assert.equal(result.detail.preventInputRetry, true)
    assert.equal(result.detail.resetInputToPending, false)
    await helpers.zaloSendPhoneFriendRequest({}); await helpers.zaloApplyContactTag({}); await helpers.zaloChangeContactAlias({})
    assert.equal(downstream, 0)
    const next = f.scheduler.createBlockRuntimeHelpers(f.account, f.campaign, { id: 101 }, null)
    await next.zaloSendPhoneFriendRequest({}); assert.equal(downstream, 1)
  }
  // Real message sequencing: rich text succeeds, media times out; keep one
  // failed detail, original timeout diagnostic, existing counter eligibility.
  const f = fixture(Scheduler)
  let steps = 0
  f.scheduler.zaloRuntime.sendMessageToUser = async (_id, _thread, _text, files, scoped) => {
    assert.equal(scoped, true); steps++
    if (files.length) throw timeout()
    return {}
  }
  let failure
  try { await f.scheduler.dispatchZaloMessage(20, 'recipient', false, { msg: 'Hi', styles: [] }, ['fixture.mp4']) } catch (error) { failure = error }
  assert.equal(steps, 2)
  const detail = await f.scheduler.createZaloPartialSendDetail(f.account, f.campaign, failure, 'zalo_message_friend', 'Nhắn tin', {})
  assert.equal(detail.status, 'thất bại'); assert.equal(detail.countsTowardBadTarget, true)
  assert.equal(detail.preventInputRetry, true); assert.equal(detail.stopRemainingActions, true)
  assert.match(detail.log, /kết quả gửi chưa xác định/)
  f.scheduler.pushZaloDetailToExternalSmsIfNeeded = async () => {}
  const lookup = { actionCode: 'zalo_find_phone_user', actionName: 'Tìm SĐT', status: 'thành công', createDetail: true, countsTowardBadTarget: true }
  const summary = await f.scheduler.logZaloMessagePhoneMilestones(f.campaign, { id: 100 }, 20, [
    { blockName: 'zalo_find_phone_user', nodeId: 'lookup', output: { detail: lookup } },
    { blockName: 'zalo_send_message', nodeId: 'send', output: { detail } }
  ])
  assert.equal(summary.hasSuccess, true)
  assert.equal(summary.hasHardFailure, true, 'successful lookup must not erase the timed-out media')
  assert.equal(summary.preventInputRetry, true)
  assert.equal(Boolean(summary.resetInputToPending), false)
  assert.match(summary.inputCompletionNote, /kết quả gửi chưa xác định/)
}

async function sharePolicyStopCases(Scheduler) {
  for (const target of ['desktop', 'server']) for (const group of [true, false]) {
    for (const stopReason of ['threshold', 'media-policy']) {
      const f = fixture(Scheduler, { target, group, initial: stopReason === 'threshold' ? 3 : 0 })
      const earlierPolicy = { errorCode: 'earlier_media_error', detailStatus: 'thất bại', countsTowardBadTarget: true,
        disableActionCodes: [], updateStatusCampaign: 'chờ xử lý', notiCampaign: 'Earlier media policy' }
      const mediaPolicy = { ...earlierPolicy, errorCode: media.CAMPAIGN_MEDIA_TIMEOUT_CODE,
        countsTowardBadTarget: false, updateStatusCampaign: 'tạm dừng', notiCampaign: 'Media stop policy' }
      f.db.getZaloErrorPolicyByCode = async code => code === 'OTHER' ? earlierPolicy
        : code === media.CAMPAIGN_MEDIA_TIMEOUT_CODE && stopReason === 'media-policy' ? mediaPolicy : null
      f.scheduler.zaloRuntime.sendMessageToUser = async (_id, thread) => {
        f.attempts.push(Number(thread))
        if (thread === '0') throw Object.assign(new Error('earlier media error'), { code: 'OTHER' })
        throw timeout()
      }
      const batch = f.rows(3)
      f.scheduler.activeCampaignRunUnits.get(10).unstartedInputDataIds = new Set(batch.map(item => item.detail.id))
      const result = await f.scheduler.processZaloShareMessageBatch(f.account, f.campaign, batch, [],
        { code: f.campaign.actionId, name: 'Nhắn tin' }, 'content', ['fixture.mp4'], new Map())
      assert.equal(f.campaign.status, 'tạm dừng', `${target}/${group}/${stopReason}: summary must preserve the media stop`)
      assert.equal(result.stopAfterBatch, true)
      assert.equal(result.stopNote, f.campaign.note)
      assert.match(result.stopNote, stopReason === 'threshold' ? /Dừng sau 4/ : /Media stop policy/)
      assert.equal(f.count(), stopReason === 'threshold' ? 4 : 0)
      assert.deepEqual(f.increments, stopReason === 'threshold' ? [101] : [])
      assert.equal(f.effects.length, 1, 'summary must not apply the earlier policy after a media stop')
      assert.deepEqual(f.attempts, [0, 1])
      assert.equal(f.forwards.length, 0)
      assert.equal(f.details.length, 2, 'both attempted failures still have details')
      assert.equal(f.updates.find(update => update.id === 102).status, 'chờ xử lý')
      assert.deepEqual([...f.scheduler.activeCampaignRunUnits.get(10).unstartedInputDataIds], [102])
    }

    for (const hasMedia of [false, true]) {
      const f = fixture(Scheduler, { target, group, initial: 2 })
      const immediatePolicy = { errorCode: 'err_zalo_message_too_long', detailStatus: 'thất bại', countsTowardBadTarget: true,
        disableActionCodes: [], updateStatusCampaign: 'tạm dừng', notiCampaign: 'Nội dung quá dài' }
      f.db.getZaloErrorPolicyByCode = async code => code === '118' ? immediatePolicy : null
      f.scheduler.zaloRuntime.sendMessageToUser = async (_id, thread) => {
        f.attempts.push(Number(thread))
        throw Object.assign(new Error('ordinary media error'), { code: thread === '0' ? '118' : '114' })
      }
      f.scheduler.zaloRuntime.forwardMessageToUsers = async (_id, ids) => ({ results: ids.map((threadId, i) => ({
        threadId, ok: false, errorCode: i === 0 ? '118' : '114'
      })) })
      const result = await f.scheduler.processZaloShareMessageBatch(f.account, f.campaign, f.rows(2), [],
        { code: f.campaign.actionId, name: 'Nhắn tin' }, 'content', hasMedia ? ['fixture.mp4'] : [], new Map())
      assert.deepEqual(f.increments, [100, 101], `${target}/${group}/${hasMedia}: preserve ordinary batch counting`)
      assert.equal(f.count(), 4)
      assert.equal(f.campaign.status, 'tạm dừng')
      assert.match(result.stopNote, /Dừng sau 4/)
      assert.equal(result.stopAfterBatch, true)
      assert.equal(f.effects.length, 1, 'ordinary batch still applies one immediate policy')
      assert.equal(f.details.length, 2)
    }

    // A timeout below the threshold must not suppress later ordinary failures.
    const f = fixture(Scheduler, { target, group, initial: 2 })
    f.scheduler.zaloRuntime.sendMessageToUser = async (_id, thread) => {
      if (thread === '0') throw timeout()
      throw Object.assign(new Error('ordinary media error'), { code: '114' })
    }
    const result = await f.scheduler.processZaloShareMessageBatch(f.account, f.campaign, f.rows(2), [],
      { code: f.campaign.actionId, name: 'Nhắn tin' }, 'content', ['fixture.mp4'], new Map())
    assert.deepEqual(f.increments, [100, 101], 'count timeout once and keep the remaining eligible failure')
    assert.equal(f.count(), 4)
    assert.equal(result.stopAfterBatch, true)
  }
}

async function main() {
  const zca = await import('zca-js')
  await runtimeCases(zca)
  const Scheduler = schedulerClass(zca)
  await schedulerCases(Scheduler)
  await sharePolicyStopCases(Scheduler)
  console.log('PASS: Desktop/Server media deadlines, real SDK late file_done fence, proxy transport, next send, invalidation, share thresholds/order/policy/DB failures, 20 share stop-policy regressions, normal downstream skip and partial rich text')
}
module.exports = { schedulerClass, fixture, timeout, media }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })

const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { buildSync, build } = require('esbuild')
const root = path.resolve(__dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-ai-smoke-'))
const compile = file => {
  const output = path.join(directory, path.basename(file) + '.cjs')
  buildSync({ entryPoints: [path.join(root, file)], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  return require(output)
}
async function main() {
  const s = compile('src/shared/campaignScheduleAi.ts')
  const mixed = compile('src/shared/campaignLimitsAi.ts')
  assert.deepEqual(mixed.limitsAiWindowSnapshot(65, [60, 30, 60], false), { rateLimitMinutes: null, rateLimitMinuteValues: [30, 60] })
  assert.deepEqual(mixed.limitsAiWindowSnapshot(45, [30, 60], true), { rateLimitMinutes: 45 })
  assert.deepEqual(mixed.limitsAiWindowSnapshot(65, [30, 30], false), { rateLimitMinutes: 30 })
  const mixedRequest = { requestId: '13ee6afe-448b-40fc-83b4-17ef14bc4648', description: 'giữ nguyên khung',
    context: { actionId: 'zalo_message_friend', dataTargetSourceMode: 'direct', accountGroupOverrides: false },
    limits: { sleepBetweenActions: 30, continueWhenActionLimitReached: false, postsPerTarget: 1,
      actions: [{ actionCode: 'zalo_message_friend', label: 'Nhắn tin', unit: 'tin', dailyLimit: 100, rateLimitCount: 15,
        ...mixed.limitsAiWindowSnapshot(65, [30, 60], false) }] } }
  assert.deepEqual(mixed.validateLimitsAiRequest(mixedRequest), mixedRequest)
  for (const invalidWindow of [{ rateLimitMinutes: null }, { rateLimitMinutes: null, rateLimitMinuteValues: [30, 30] },
    { rateLimitMinutes: null, rateLimitMinuteValues: [30, '60'] }, { rateLimitMinutes: 65, rateLimitMinuteValues: [30, 60] }]) {
    assert.throws(() => mixed.validateLimitsAiRequest({ ...mixedRequest, limits: { ...mixedRequest.limits,
      actions: [{ ...mixedRequest.limits.actions[0], rateLimitMinuteValues: undefined, ...invalidWindow }] } }))
  }
  const schedule = { scheduleType: 'daily', startDate: '2026-10-14', startTime: '09:00', scheduleEndDate: '2026-10-21',
    scheduleDays: '', scheduleWeekDays: '', useDailyStopTime: false, dailyStopTime: '18:00', continueNextDay: true,
    refreshData: true, findDataRerunEnabled: false, findDataRerunAfterHours: 1, multiDailyTimeSlotsEnabled: false, multiDailyTimeSlots: '' }
  const request = { requestId: '13ee6afe-448b-40fc-83b4-17ef14bc4648', description: 'thứ 2,4,6 lúc 8h',
    context: { actionId: 'facebook_timeline_post', dataTargetSourceMode: 'direct' }, schedule }
  const response = (patch, status = 'ok', reason = '') => JSON.stringify({ status, reason,
    changes: { ...Object.fromEntries(Object.keys(schedule).map(key => [key, null])), ...patch } })
  const parse = (patch, input = request) => s.parseScheduleAiResponse(response(patch), input)
  assert.deepEqual(parse({}), { ok: true, patch: {} }, 'an already matching schedule succeeds without changes')
  assert.deepEqual(parse({ startTime: schedule.startTime }), { ok: true, patch: { startTime: schedule.startTime } })
  assert.deepEqual(parse({ scheduleType: 'weekly', scheduleWeekDays: '6,2,4,2', startTime: '08:00' }),
    { ok: true, patch: { scheduleType: 'weekly', scheduleWeekDays: '2,4,6', startTime: '08:00' } })
  assert.equal(s.applyScheduleAiPatch({ schedule: '2026-10-14T09:00', scheduleEndDate: '2026-10-21', name: 'keep' },
    parse({ startTime: '08:00' }).patch).schedule, '2026-10-14T08:00')
  assert.deepEqual(parse({ startTime: '20:00', dailyStopTime: '18:00' }).patch,
    { startTime: '20:00', dailyStopTime: '18:00', useDailyStopTime: true })
  for (const patch of [{ startTime: '23:59' }, { scheduleType: 'weekly', scheduleEndDate: '2020-01-01' },
    { multiDailyTimeSlots: '09:00' }]) assert.equal(parse(patch).ok, true, 'business validation must stay at Save')
  assert.equal(parse({ scheduleType: 'monthly', scheduleDays: '31,1,15' }).patch.scheduleDays, '1,15,31')
  assert.equal(parse({ scheduleType: 'weekly', scheduleWeekDays: '8,2' }).patch.scheduleWeekDays, '2,8')
  assert.equal(parse({ multiDailyTimeSlots: '18:00, 08:00, 08:00' }).patch.multiDailyTimeSlots, '08:00, 18:00')
  assert.equal(parse({ scheduleType: 'weekly', scheduleEndDate: '' }).ok, true)
  for (const patch of [{ startDate: '2026-02-30' }, { startTime: '25:00' }, { scheduleType: 'cron' },
    { scheduleType: 'weekly', scheduleWeekDays: '0,9' }, { useDailyStopTime: 'true' }]) assert.equal(parse(patch).code, 'invalid')
  assert.equal(s.parseScheduleAiResponse('{broken', request).code, 'invalid')
  assert.equal(s.parseScheduleAiResponse(response({ name: 'injected' }), request).code, 'invalid')
  assert.deepEqual(s.parseScheduleAiResponse(response({}, 'unclear'), request),
    { ok: false, code: 'unclear', message: s.SCHEDULE_AI_MESSAGES.unclear })
  assert.equal(s.parseScheduleAiResponse(response({}, 'unclear', '  Bạn muốn chạy lúc mấy giờ buổi sáng?  '), request).message,
    s.SCHEDULE_AI_MESSAGES.unclear + ' Bạn muốn chạy lúc mấy giờ buổi sáng?')
  assert.equal(s.parseScheduleAiResponse(response({}, 'unclear', 'x'.repeat(301)), request).code, 'invalid')
  assert.equal(s.parseScheduleAiResponse(response({ startTime: '08:00' }, 'unclear', 'Cần làm rõ.'), request).code, 'invalid')
  assert.equal(s.parseScheduleAiResponse(response({}, 'unsupported', 'Không hỗ trợ mỗi thứ một giờ.'), request).code, 'unsupported')
  for (const id of ['sms_send', 'voice_call', 'zalo_message_group_realtime']) {
    assert.equal(parse({ scheduleType: 'weekly', scheduleWeekDays: '2' }, { ...request, context: { ...request.context, actionId: id } }).code, 'unsupported')
  }
  assert.equal(parse({ multiDailyTimeSlots: '08:00, 14:00' }, { ...request, context: { ...request.context, dataTargetSourceMode: 'data_group' } }).code, 'unsupported')
  assert.equal(parse({ findDataRerunAfterHours: 0 }, { ...request, context: { ...request.context, actionId: 'facebook_find_data_search' } }).ok, true)
  assert.equal(parse({ refreshData: true }).code, 'unsupported', 'daily has no refresh checkbox')
  assert.deepEqual(s.validateScheduleAiRequest({ ...request, bodyOverrides: { model: 'wrong' }, context: { ...request.context, secret: 'drop' } }), request)
  for (const description of ['', 'x'.repeat(2001)]) assert.throws(() => s.validateScheduleAiRequest({ ...request, description }))
  for (const zone of ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles']) {
    process.env.TZ = zone
    assert.equal(s.formatScheduleVietnam(new Date('2026-10-13T18:00:00Z')), '2026-10-14T01:00')
    assert.equal(s.scheduleVietnamToIso('2026-10-14T08:00'), '2026-10-14T01:00:00.000Z')
  }
  console.log('PASS JSON boundaries, preservation, form capabilities, Sunday/monthly/multi-slots, Vietnam timezone, Save-only business checks')

  // Real IPC handler/deadline/current-user code; fake only Electron and AI I/O.
  const mock = global.__scheduleAiMock = { handlers: {}, pending: [], credentials: {}, user: { staffId: 7, organizationId: 9 } }
  const output = path.join(directory, 'handler.cjs')
  await build({ entryPoints: [path.join(root, 'src/main/ipc/handlers/campaignFormAiHandlers.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'fixtures', setup(build) {
      build.onResolve({ filter: /^(electron)$|\/campaign(?:Schedule|Limits)AiService$|\/currentUser$|\/aiRepository$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'electron'
        ? `export const ipcMain={handle:(k,v)=>global.__scheduleAiMock.handlers[k]=v}`
        : args.path.endsWith('aiRepository')
          ? `export const listFormAiAvailability=async()=>[];`
        : args.path.endsWith('currentUser')
          ? `const m=global.__scheduleAiMock; export const requireCurrentUser=()=>m.user; export const requireCurrentUserCredentials=()=>m.credentials; export const getCurrentUserCredentials=()=>m.credentials; export const runWithCurrentUser=(_,fn)=>fn();`
          : `export const generateCampaignSchedule=(request,signal)=>new Promise((resolve,reject)=>global.__scheduleAiMock.pending.push({request,signal,resolve,reject})); export const generateCampaignLimits=generateCampaignSchedule;` }))
      build.onLoad({ filter: /campaignFormAiHandlers\.ts$/ }, args => ({ loader: 'ts', contents: fs.readFileSync(args.path, 'utf8').replace('signal => generate(request, signal), CAMPAIGN_FORM_AI_TIMEOUT)', 'signal => generate(request, signal), 40)') }))
    } }] })
  const wc = { mainFrame: {}, once: () => {} }, event = { sender: wc, senderFrame: wc.mainFrame }
  const registration = require(output).registerCampaignFormAiHandlers({ webContents: wc, isDestroyed: () => false })
  const generate = input => mock.handlers[s.CAMPAIGN_SCHEDULE_AI_IPC.generate](event, input)
  const cancel = id => mock.handlers[s.CAMPAIGN_SCHEDULE_AI_IPC.cancel](event, id)
  const flush = () => new Promise(resolve => setImmediate(resolve))
  await assert.rejects(() => mock.handlers[s.CAMPAIGN_SCHEDULE_AI_IPC.generate]({ ...event, senderFrame: {} }, request))
  let task = generate(request); await flush()
  assert.equal((await generate(request)).code, 'unavailable'); assert.equal(mock.pending.length, 1)
  cancel('different-id'); assert.equal(mock.pending[0].signal.aborted, false)
  cancel(request.requestId); assert.equal((await task).code, 'cancelled'); assert.equal(mock.pending[0].signal.aborted, true)
  mock.pending.shift().resolve({ ok: true, patch: { startTime: '23:59' } })
  task = generate(request); await flush(); const owned = mock.pending.shift()
  owned.resolve({ ok: true, patch: { startTime: '08:00' } }); assert.equal((await task).ok, true)
  task = generate(request); await flush(); mock.credentials = {}; mock.pending.shift().resolve({ ok: true, patch: {} })
  assert.equal((await task).code, 'cancelled')
  task = generate(request); await flush(); registration.stop(); assert.equal((await task).code, 'cancelled')
  mock.pending.shift().resolve({ ok: true, patch: {} })
  assert.equal((await generate(request)).code, 'unavailable', 'deadline must unlock without a provider response')
  assert.equal(mock.pending.shift().signal.aborted, true)
  task = generate(request); await flush(); mock.pending.shift().resolve({ ok: true, patch: { startTime: '09:00' } }); assert.equal((await task).ok, true)
  console.log('PASS main-frame IPC, duplicate request, scoped cancellation, auth change, shutdown, deadline, retry after unlock')
  const l = compile('src/shared/campaignLimitsAi.ts')
  const limitsRequest = { requestId: request.requestId, description: 'mỗi ngày 50 tin, mỗi nửa giờ 8 tin',
    context: { actionId: 'zalo_message_friend', dataTargetSourceMode: 'direct', accountGroupOverrides: false },
    limits: { sleepBetweenActions: 30, continueWhenActionLimitReached: false, postsPerTarget: 3,
      actions: [{ actionCode: 'zalo_message_friend', label: 'Nhắn tin bạn bè', unit: 'tin nhắn', dailyLimit: 30, rateLimitCount: 9, rateLimitMinutes: 65 }] } }
  const limitsResponse = (changes, status = 'ok', reason = '') => JSON.stringify({ status, reason,
    changes: { sleepBetweenActions: null, continueWhenActionLimitReached: null, postsPerTarget: null, actions: [], ...changes } })
  const limitItem = patch => ({ actionCode: 'zalo_message_friend', dailyLimit: null, rateLimitCount: null, rateLimitMinutes: null, ...patch })
  const parseLimits = changes => l.parseLimitsAiResponse(limitsResponse(changes), limitsRequest)
  assert.deepEqual(parseLimits({}), { ok: true, patch: { actions: [] } }, 'an already matching limit succeeds without changes')
  assert.deepEqual(parseLimits({ actions: [limitItem({})] }), { ok: true, patch: { actions: [] } })
  assert.deepEqual(parseLimits({ actions: [limitItem({ dailyLimit: 30 })] }),
    { ok: true, patch: { actions: [{ actionCode: 'zalo_message_friend', dailyLimit: 30 }] } })
  assert.deepEqual(parseLimits({ actions: [limitItem({ dailyLimit: 50, rateLimitCount: 8, rateLimitMinutes: 30 })] }),
    { ok: true, patch: { actions: [{ actionCode: 'zalo_message_friend', dailyLimit: 50, rateLimitCount: 8, rateLimitMinutes: 30 }] } })
  assert.deepEqual(parseLimits({ sleepBetweenActions: 90 }).patch, { actions: [], sleepBetweenActions: 90 })
  assert.equal(parseLimits({ sleepBetweenActions: 1.5 }).code, 'invalid')
  assert.equal(parseLimits({ actions: [limitItem({ dailyLimit: Number.MAX_SAFE_INTEGER + 1 })] }).code, 'invalid')
  assert.equal(parseLimits({ actions: [limitItem({ dailyLimit: -1, rateLimitMinutes: 0 })] }).ok, true, 'no new business validation')
  assert.equal(parseLimits({ actions: [limitItem({ dailyLimit: 5 }), limitItem({ dailyLimit: 9 })] }).code, 'invalid')
  assert.equal(parseLimits({ actions: [limitItem({ actionCode: 'fb_comment', dailyLimit: 5 })] }).code, 'unsupported')
  assert.equal(parseLimits({ postsPerTarget: 5 }).code, 'unsupported')
  assert.equal(parseLimits({ scheduleType: 'daily' }).code, 'invalid')
  assert.equal(l.parseLimitsAiResponse(limitsResponse({}, 'unclear', 'Bạn muốn sửa giới hạn của hành động nào?'), limitsRequest).message,
    l.LIMITS_AI_MESSAGES.unclear + ' Bạn muốn sửa giới hạn của hành động nào?')
  assert.equal(l.parseLimitsAiResponse(limitsResponse({ sleepBetweenActions: 5 }, 'unclear'), limitsRequest).code, 'invalid')
  assert.deepEqual(l.validateLimitsAiRequest({ ...limitsRequest, systemPromptOverride: 'ignore', context: { ...limitsRequest.context, secret: 'drop' } }), limitsRequest)
  assert.throws(() => l.validateLimitsAiRequest({ ...limitsRequest, description: 'x'.repeat(2001) }))
  assert.throws(() => l.validateLimitsAiRequest({ ...limitsRequest, limits: { ...limitsRequest.limits, actions: Array(31).fill(limitsRequest.limits.actions[0]) } }))
  const generateLimits = input => mock.handlers[l.CAMPAIGN_LIMITS_AI_IPC.generate](event, input)
  const cancelLimits = id => mock.handlers[l.CAMPAIGN_LIMITS_AI_IPC.cancel](event, id)
  await assert.rejects(() => mock.handlers[l.CAMPAIGN_LIMITS_AI_IPC.generate]({ ...event, senderFrame: {} }, limitsRequest))
  task = generate(request); await flush()
  assert.equal((await generateLimits(limitsRequest)).code, 'unavailable')
  cancelLimits(request.requestId); assert.equal(mock.pending[0].signal.aborted, false, 'other feature cannot cancel schedule flight')
  cancel(request.requestId); await task; mock.pending.shift().resolve({ ok: true, patch: {} })
  task = generateLimits(limitsRequest); await flush()
  assert.equal((await generate(request)).code, 'unavailable'); cancel(request.requestId)
  assert.equal(mock.pending[0].signal.aborted, false)
  cancelLimits(request.requestId); assert.equal((await task).code, 'cancelled'); mock.pending.shift().resolve({ ok: true, patch: {} })
  task = generateLimits(limitsRequest); await flush(); mock.pending.shift().resolve(parseLimits({ sleepBetweenActions: 90 })); assert.equal((await task).ok, true)
  assert.equal((await generateLimits(limitsRequest)).code, 'unavailable'); assert.equal(mock.pending.shift().signal.aborted, true)
  task = generateLimits(limitsRequest); await flush(); mock.credentials = {}; mock.pending.shift().resolve(parseLimits({ sleepBetweenActions: 90 }))
  assert.equal((await task).code, 'cancelled')
  console.log('PASS limits JSON/allowlist/preservation/clarification and shared cross-section flight, cancel, deadline, auth guards')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => fs.rmSync(directory, { recursive: true, force: true }))

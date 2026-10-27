const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'form-ai-v416-'))
const snapshot = require('../migrations/snapshots/ai-form-configs-v416/source.json')
const schemas = require('../migrations/snapshots/ai-form-configs-v416/schemas.json')
const clone = v => JSON.parse(JSON.stringify(v))
const model = { id: 21, provider: 'openai', model: 'gpt-6.1-sol', code: 'test', endpoint: 'https://ai.example.test/v1/responses',
  api_key: 'fixture-only', default_body: { reasoning: { effort: 'low' } }, is_active: true, organization_id: null }
const rows = snapshot.source.map((s, i) => ({
  ...s.using, ...s.prompt, id: i + 101, model_id: s.using.model_id,
  timeout_ms: s.using.timeout_ms, request_options: s.using.request_options,
  desktop_section_id: s.using.code.endsWith('schedule') ? 'campaign.schedule' : 'campaign.action_limits',
  campaign_scope: 'all', campaign_action_ids: [], output_schema: schemas[s.using.code]
}))
let currentRows, currentModel, output, calls = [], logs = [], reads = []
function reset() { currentRows = clone(rows); currentModel = clone(model); calls = []; logs = []; reads = [] }
global.__formDb = { from(table) {
  reads.push(table)
  let filters = [], single = false, insert, signal
  const query = {
    select() { return query }, eq(k, v) { filters.push(r => r[k] === v); return query },
    not(k, _op, v) { filters.push(r => r[k] !== v); return query },
    abortSignal(s) { signal = s; return query }, maybeSingle() { single = true; return query },
    single() { single = true; return query }, returns() { return query }, insert(row) { insert = row; return query },
    then(ok, fail) { return Promise.resolve().then(() => {
      signal?.throwIfAborted()
      if (insert) { logs.push(insert); return { data: { id: logs.length }, error: null } }
      const list = table === 'ai_form_configs' ? currentRows : table === 'ai_model' ? [currentModel]
        : table === 'ai_using' ? snapshot.source.map(s => s.using)
        : table === 'ai_prompt' ? snapshot.source.map(s => s.prompt) : []
      const found = list.filter(r => filters.every(f => f(r)))
      return { data: single ? found[0] || null : found, error: null }
    }).then(ok, fail) }
  }
  return query
} }
global.fetch = async (_url, options) => {
  options.signal?.throwIfAborted()
  calls.push(JSON.parse(options.body))
  return new Response(JSON.stringify({ output_text: output }), { status: 200 })
}
async function main() {
  await build({ stdin: { contents: `
    export * from './src/main/services/campaignScheduleAiService'
    export * from './src/main/services/campaignLimitsAiService'
    export * from './src/main/services/aiRuntimeService'
    export * from './src/main/data/repositories/aiRepository'
    export * from './src/shared/campaignScheduleAi'
    export * from './src/shared/campaignLimitsAi'
    export * from './src/shared/campaignFormAiConfig'
  `, resolveDir: root }, outfile: path.join(tmp, 'entry.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'fixture-dependencies', setup(b) {
      b.onLoad({ filter: /\/supabaseClient\.ts$/ }, () => ({ contents: 'export const isTrustedServerSupabaseConfigured = () => true; export const desktopSession = { token: async () => null }; export const getSupabaseClient = () => globalThis.__formDb', loader: 'ts' }))
      b.onLoad({ filter: /\/currentUser\.ts$/ }, () => ({ contents: 'export const getCurrentUser = () => ({organizationId:9}); export const requireCurrentUser = getCurrentUser;', loader: 'ts' }))
      b.onLoad({ filter: /\/runtimeClockRepository\.ts$/ }, () => ({ contents: "export const peekDatabaseRuntimeClock = () => ({dbNow:Date.parse('2026-10-20T03:00:00Z')})", loader: 'ts' }))
    } }]
  })
  const m = require(path.join(tmp, 'entry.cjs'))
  assert.deepEqual(m.SCHEDULE_AI_SCHEMA, schemas.app_campaign_schedule)
  assert.deepEqual(m.LIMITS_AI_SCHEMA, schemas.app_campaign_action_limits)
  const signal = new AbortController().signal
  const request = {
    requestId: '13ee6afe-448b-40fc-83b4-17ef14bc4648', description: 'Giữ nguyên',
    context: { actionId: 'zalo_message_friend', dataTargetSourceMode: 'direct', accountGroupOverrides: false },
    schedule: { scheduleType: 'daily', startDate: '2026-10-20', startTime: '09:00', scheduleEndDate: '2026-10-27',
      scheduleDays: '', scheduleWeekDays: '', useDailyStopTime: false, dailyStopTime: '18:00', continueNextDay: true,
      refreshData: false, findDataRerunEnabled: false, findDataRerunAfterHours: 1, multiDailyTimeSlotsEnabled: false, multiDailyTimeSlots: '' },
    limits: { sleepBetweenActions: 10, continueWhenActionLimitReached: false, postsPerTarget: 1,
      actions: [{ actionCode: 'zalo_message_friend', label: 'Nhắn tin', unit: 'tin', dailyLimit: 100, rateLimitCount: 15,
        rateLimitMinutes: null, rateLimitMinuteValues: [30, 60] }] }
  }
  const empty = kind => JSON.stringify({ status: 'ok', reason: '', changes: Object.fromEntries(
    Object.keys(schemas[kind].properties.changes.properties).map(k => [k, k === 'actions' ? [] : null])) })
  for (const [kind, generate, contextKey, schemaName] of [
    ['app_campaign_schedule', m.generateCampaignSchedule, 'scheduleContext', 'campaign_schedule'],
    ['app_campaign_action_limits', m.generateCampaignLimits, 'limitsContext', 'campaign_action_limits']
  ]) {
    reset(); output = empty(kind)
    assert.equal((await generate(request, signal)).ok, true)
    assert.deepEqual(reads, ['ai_form_configs', 'ai_model', 'ai_log'])
    const newBody = calls[0], newLog = logs[0]
    const source = snapshot.source.find(s => s.using.code === kind)
    assert.equal(newBody.instructions, source.prompt.prompt_system)
    assert.deepEqual(newBody.text.format.schema, schemas[kind])
    assert.equal(newLog.using_id, null); assert.equal(newLog.prompt_id, null)
    assert.equal(newLog.form_config_id, rows.find(r => r.code === kind).id)
    await m.callAiUsing(kind, { [contextKey]: newBody.input[0].content[0].text,
      bodyOverrides: { store: false, text: { format: { type: 'json_schema', name: schemaName, strict: true, schema: schemas[kind] } } }
    }, { organizationId: 9 }, { signal, expectedModel: 'gpt-6.1-sol' })
    assert.deepEqual(calls[1], newBody, `${kind}: legacy and new request exactly equal`)
    assert.equal(logs[1].using_id, source.using.id); assert.equal(logs[1].form_config_id, undefined)
    for (const change of [
      row => { row.is_active = false },
      row => { row.campaign_scope = 'selected'; row.campaign_action_ids = ['sms_send'] },
      row => { row.output_schema = { type: 'object' } }
    ]) {
      reset(); change(currentRows.find(r => r.code === kind))
      await assert.rejects(generate(request, signal)); assert.equal(calls.length, 0)
    }
    reset(); currentRows.find(r => r.code === kind).campaign_scope = 'selected'
    currentRows.find(r => r.code === kind).campaign_action_ids = [request.context.actionId]
    currentRows.find(r => r.code === kind).model_id = 987
    currentModel.id = 987
    currentModel.model = 'compatible-model-fixture'
    assert.equal((await generate(request, signal)).ok, true)
    assert.equal(calls[0].model, 'compatible-model-fixture')
    reset(); currentModel.endpoint = 'https://ai.example.test/v1/chat/completions'
    assert.equal((await generate(request, signal)).ok, true)
    assert.deepEqual(calls[0].response_format.json_schema.schema, schemas[kind]); assert.equal(calls[0].text, undefined)
    reset(); currentModel.provider = 'unsupported-fixture'
    await assert.rejects(generate(request, signal)); assert.equal(calls.length, 0)
    reset(); currentModel.is_active = false
    await assert.rejects(generate(request, signal)); assert.equal(calls.length, 0)
    reset(); output = '{"status":"ok","reason":"","changes":{"unexpected":true}}'
    assert.equal((await generate(request, signal)).ok, false)
    assert.equal(logs[0].status, 'error')
    reset(); const cancel = new AbortController(); cancel.abort()
    await assert.rejects(generate(request, cancel.signal)); assert.equal(calls.length, 0)
  }
  reset()
  const metadata = await m.listFormAiAvailability(signal)
  assert.equal(metadata.length, 2); assert.equal(JSON.stringify(metadata).includes('prompt'), false)
  assert.equal(m.formAiAvailable(metadata, 'campaign.schedule', ''), false)
  assert.equal(m.formAiAvailable(metadata, 'campaign.schedule', 'sms_send'), true)
  currentRows[0].is_active = false
  assert.equal((await m.listFormAiAvailability(signal)).length, 1)
  console.log('PASS V416: both schemas unchanged; exact legacy/new provider payload parity; metadata, scope, model switching, logs, invalid output and abort')
}
main().finally(() => fs.rmSync(tmp, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1 })

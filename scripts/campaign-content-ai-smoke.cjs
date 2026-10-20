const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { build } = require('esbuild')
const root = path.resolve(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-ai-'))
let row, model, output, calls, logs
const signal = new AbortController().signal
const request = { requestId: '13ee6afe-448b-40fc-83b4-17ef14bc4648', description: 'Sửa ngắn và thêm biến thể', context: { actionId: 'zalo_message_friend', mode: 'advanced', format: 'plain' }, items: [{ content: 'Chào {{name}}', emailSubject: null }] }
const patch = { edits: [{ index: 0, content: 'Xin chào {{name}}', emailSubject: null }], additions: [{ sourceIndex: 0, content: 'Chào bạn {{name}}', emailSubject: null }] }
const response = changes => JSON.stringify({ status: 'ok', reason: '', changes })
global.__contentDb = { from(table) {
  let filters = [], single = false, insert, s
  const q = { select: () => q, eq: (k, v) => { filters.push(r => r[k] === v); return q },
    not: (k, _op, v) => { filters.push(r => r[k] !== v); return q },
    abortSignal: v => { s = v; return q }, single: () => { single = true; return q }, maybeSingle: () => { single = true; return q },
    insert: v => { insert = v; return q }, then: (ok, fail) => Promise.resolve().then(() => {
      s?.throwIfAborted()
      if (insert) { logs.push(insert); return { data: { id: 10 }, error: null } }
      const list = (table === 'ai_form_configs' ? [row] : [model]).filter(r => filters.every(f => f(r)))
      return { data: single ? list[0] || null : list, error: null }
    }).then(ok, fail) }
  return q
} }
async function main() {
  await build({ stdin: { contents: `export * from './src/shared/campaignContentAi'; export * from './src/shared/campaignContentAiForm'; export * from './src/shared/formAiClaude'; export * from './src/main/services/campaignContentAiService'; export * from './src/main/data/repositories/aiRepository'; export * from './src/shared/campaignFormAiConfig';`, resolveDir: root }, outfile: path.join(tmp, 'm.cjs'), bundle: true, platform: 'node', logLevel: 'silent', plugins: [{ name: 'fixtures', setup(b) {
    b.onLoad({ filter: /\/supabaseClient\.ts$/ }, () => ({ contents: 'export const getSupabaseClient = () => globalThis.__contentDb', loader: 'ts' }))
    b.onLoad({ filter: /\/currentUser\.ts$/ }, () => ({ contents: 'export const getCurrentUser = () => ({organizationId:9}); export const requireCurrentUser = getCurrentUser;', loader: 'ts' }))
  } }] })
  const m = require(path.join(tmp, 'm.cjs'))
  const reset = () => {
    row = { id: 100, code: 'app_campaign_content', name: 'Nội dung', desktop_section_id: 'campaign.content', model_id: 100,
      is_active: true, campaign_scope: 'all', campaign_action_ids: [], prompt_system: 'Fixture system', prompt_user: '{{contentContext}}',
      output_schema: m.CONTENT_AI_SCHEMA, timeout_ms: 120000, request_options: {} }
    model = { id: 100, code: 'haiku-fixture', provider: 'claude', model: 'claude-haiku-5-5', endpoint: 'https://ai.example.test/v1/messages',
      is_active: true, organization_id: null, api_key: 'fixture-only', default_body: { max_tokens: 16384 } }
    output = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: response(patch) }], usage: { input_tokens: 12, output_tokens: 23 } }
    calls = []; logs = []
  }
  global.fetch = async (url, options) => { options.signal.throwIfAborted(); calls.push({ url, ...options, body: JSON.parse(options.body) }); return new Response(JSON.stringify(output)) }
  assert.deepEqual(m.validateContentAiRequest({ ...request, model_id: 7, prompt: 'injected' }), request)
  assert.deepEqual(m.parseContentAiResponse(response(patch), request), { ok: true, patch })
  for (const bad of [ { ...patch, mediaOption: 'all' }, { ...patch, edits: [...patch.edits, ...patch.edits] },
    { ...patch, edits: [{ ...patch.edits[0], index: 5 }] }, { ...patch, additions: [{ ...patch.additions[0], sourceIndex: -1 }] },
    { ...patch, additions: [{ ...patch.additions[0], emailSubject: 'Forbidden' }] },
    { ...patch, additions: Array(21).fill(patch.additions[0]) } ]) assert.equal(m.parseContentAiResponse(response(bad), request).ok, false)
  assert.equal(m.parseContentAiResponse(JSON.stringify({ status: 'unclear', reason: 'Cần chủ đề', changes: { edits: [], additions: [] } }), request).code, 'unclear')
  assert.throws(() => m.validateContentAiRequest({ ...request, items: Array(101).fill(request.items[0]) }))
  assert.throws(() => m.validateContentAiRequest({ ...request, items: [{ ...request.items[0], emailSubject: 'No email' }] }))
  const items = [{ id: 'a', ...request.items[0], mediaOption: 'random', mediaItems: [{ id: 9, url: 'private' }], randomMediaCount: 2 },
    { id: 'b', content: 'Giữ nguyên', mediaOption: 'none', mediaItems: [] }]
  const applied = m.applyContentAiItems(items, patch, src => ({ ...src, id: 'new' }))
  assert.equal(applied[0].content, patch.edits[0].content); assert.strictEqual(applied[1], items[1])
  assert.deepEqual(applied[0].mediaItems, items[0].mediaItems); assert.deepEqual(applied[2].mediaItems, items[0].mediaItems)
  assert.equal(applied[2].randomMediaCount, 2); assert.equal(items[0].content, request.items[0].content)
  const basic = m.applyBasicContentAiPatch('A {x|y} {{name}}|B', false, null, { edits: [], additions: [{ sourceIndex: 0, content: 'C | D {{name}}', emailSubject: null }] })
  assert.equal(basic.content, 'A {x|y} {{name}}|B|C \\| D {{name}}')
  assert.equal(m.applyBasicContentAiPatch('  keep exact  ', false, null, { edits: [], additions: [] }).content, '  keep exact  ')
  const email = { ...request, context: { actionId: 'email_send', mode: 'basic', format: 'html' }, items: [{ content: '<b>A</b>', emailSubject: 'A' }] }
  assert.equal(m.parseContentAiResponse(response({ edits: [{ index: 0, content: null, emailSubject: 'B' }], additions: [] }), email).ok, true)
  assert.equal(m.parseContentAiResponse(response({ edits: [], additions: [{ sourceIndex: 0, content: 'B', emailSubject: 'B' }] }), email).ok, false)
  reset(); assert.deepEqual(await m.generateCampaignContent(request, signal), { ok: true, patch })
  assert.equal(calls.length, 1); const call = calls[0]
  assert.equal(call.headers['x-api-key'], 'fixture-only'); assert.equal(call.headers.authorization, undefined)
  assert.equal(call.headers['anthropic-version'], '2023-06-01'); assert.equal(call.body.model, 'claude-haiku-5-5')
  assert.equal(call.body.system, 'Fixture system'); assert.deepEqual(JSON.parse(call.body.messages[0].content), { description: request.description, ...request.context, items: request.items })
  assert.deepEqual(call.body.output_config.format.schema, m.CONTENT_AI_SCHEMA)
  for (const key of ['temperature', 'top_p', 'top_k', 'store', 'response_format', 'attachments']) assert.equal(call.body[key], undefined)
  assert.equal(logs[0].form_config_id, 100); assert.equal(logs[0].prompt_id, null); assert.equal(logs[0].using_id, null)
  assert.equal((await m.listFormAiAvailability(signal))[0].sectionId, 'campaign.content')
  for (const [defaultEffort, configuredEffort] of [['low', undefined], [undefined, 'high'], ['low', 'high']]) {
    reset()
    model.default_body.output_config = { ...(defaultEffort ? { effort: defaultEffort } : {}), format: { type: 'text' } }
    row.request_options = { max_tokens: 8192, output_config: { ...(configuredEffort ? { effort: configuredEffort } : {}), format: { type: 'text' } } }
    const before = structuredClone({ defaults: model.default_body, options: row.request_options })
    assert.equal((await m.generateCampaignContent(request, signal)).ok, true)
    assert.deepEqual(calls[0].body.output_config, { effort: configuredEffort || defaultEffort, format: { type: 'json_schema', schema: m.CONTENT_AI_SCHEMA } })
    assert.equal(calls[0].body.max_tokens, 8192)
    assert.deepEqual({ defaults: model.default_body, options: row.request_options }, before)
  }
  for (const change of [() => { row.is_active = false }, () => { row.campaign_scope = 'selected'; row.campaign_action_ids = ['sms_send'] },
    () => { model.is_active = false }, () => { model.organization_id = 1 }, () => { row.output_schema = {} }]) {
    reset(); change(); await assert.rejects(m.generateCampaignContent(request, signal)); assert.equal(calls.length, 0)
  }
  reset(); row.campaign_scope = 'selected'; row.campaign_action_ids = [request.context.actionId]
  assert.equal((await m.generateCampaignContent(request, signal)).ok, true)
  for (const stop_reason of ['max_tokens', 'refusal', 'tool_use']) {
    reset(); output.stop_reason = stop_reason
    assert.equal((await m.generateCampaignContent(request, signal)).ok, false); assert.equal(logs[0].status, 'error')
  }
  reset(); output.content = [{ type: 'text', text: '{"media":[]}' }]
  assert.equal((await m.generateCampaignContent(request, signal)).ok, false)
  reset(); const abort = new AbortController(); abort.abort()
  await assert.rejects(m.generateCampaignContent(request, abort.signal)); assert.equal(calls.length, 0)
  console.log('PASS content AI: native Claude payload/options precedence, JSON/indices/capabilities, token/variant roundtrip, media preservation, no-op, email, scope/model/schema, log, incomplete output, abort')
}
main().finally(() => fs.rmSync(tmp, { recursive: true, force: true })).catch(e => { console.error(e); process.exitCode = 1 })

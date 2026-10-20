const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { build } = require('esbuild')
const root = path.resolve(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exclusion-ai-'))
const fixture = require('./fixtures/send-exclusion-ui-page.json')
const request = { requestId: '13ee6afe-448b-40fc-83b4-17ef14bc4648', description: 'Loại trừ VIP hoặc gửi trong 7 ngày',
  context: { actionId: 'zalo_message_friend', accountId: 100, enableMessage: true } }
const changes = { name: 'VIP hoặc đã gửi gần đây', matchMode: 'or',
  rules: [{ fieldId: 2, operatorId: 3, values: ['7'] }, { fieldId: 4, operatorId: 5, values: [7] }] }
const response = (patch = changes) => JSON.stringify({ status: 'ok', reason: '', changes: patch })
let row, model, output, calls, logs, reads, page, rpcError, rpcHook
const user = { staffId: 7, organizationId: 9 }, credentials = { username: 'fixture', password: 'fixture' }
global.__exclusionAuth = { user, credentials }
global.__exclusionDb = {
  rpc(name, args) {
    return { abortSignal: async signal => {
      signal.throwIfAborted(); reads.push({ name, args })
      assert.equal(name, 'aka_agent_send_exclusion_groups'); assert.equal(args.p_operation, 'list')
      assert.equal(args.p_staff_id, user.staffId); assert.equal(args.p_organization_id, user.organizationId)
      assert.equal(args.p_auth_username, credentials.username)
      if (rpcHook) await rpcHook(signal)
      signal.throwIfAborted()
      return { data: page, error: rpcError || (args.p_account_id !== 100 ? { message: 'not_found' } : null) }
    } }
  },
  from(table) {
    let filters = [], single = false, insert, signal
    const q = { select: () => q, eq: (key, value) => { filters.push(row => row[key] === value); return q },
      not: (key, _, value) => { filters.push(row => row[key] !== value); return q },
      abortSignal: value => { signal = value; return q }, maybeSingle: () => { single = true; return q },
      insert: value => { insert = value; return q }, then: (ok, fail) => Promise.resolve().then(() => {
        signal?.throwIfAborted()
        if (insert) { assert.equal(table, 'ai_log'); logs.push(insert); return { data: { id: 10 }, error: null } }
        const rows = (table === 'ai_form_configs' ? [row] : [model]).filter(row => filters.every(filter => filter(row)))
        return { data: single ? rows[0] || null : rows, error: null }
      }).then(ok, fail) }
    return q
  }
}
async function main() {
  await build({ stdin: { contents: `export * from './src/shared/campaignExclusionAi'; export * from './src/main/services/campaignExclusionAiService'; export * from './src/main/data/repositories/aiRepository';`, resolveDir: root },
    outfile: path.join(tmp, 'm.cjs'), bundle: true, platform: 'node', logLevel: 'silent', plugins: [{ name: 'fixtures', setup(b) {
      b.onLoad({ filter: /\/supabaseClient\.ts$/ }, () => ({ contents: 'export const getSupabaseClient = () => globalThis.__exclusionDb', loader: 'ts' }))
      b.onLoad({ filter: /\/currentUser\.ts$/ }, () => ({ contents: `const a=globalThis.__exclusionAuth;
        export const getCurrentUser=()=>a.user; export const requireCurrentUser=getCurrentUser;
        export const getCurrentUserCredentials=()=>a.credentials; export const requireCurrentUserCredentials=getCurrentUserCredentials;`, loader: 'ts' }))
    } }] })
  const m = require(path.join(tmp, 'm.cjs'))
  const reset = () => {
    page = structuredClone(fixture); calls = []; logs = []; reads = []; rpcError = null; rpcHook = null
    global.__exclusionAuth.credentials = credentials
    row = { id: 101, code: 'app_campaign_send_exclusions', desktop_section_id: 'campaign.send_exclusions',
      model_id: 21, is_active: true, campaign_scope: 'selected', campaign_action_ids: ['zalo_message_friend'],
      prompt_system: 'Fixture system', prompt_user: '{{exclusionContext}}', output_schema: m.EXCLUSION_AI_SCHEMA,
      timeout_ms: 120000, request_options: {} }
    model = { id: 21, provider: 'openai', model: 'gpt-6.1-sol', endpoint: 'https://ai.example.test/v1/responses',
      is_active: true, organization_id: null, api_key: 'fixture-only', default_body: { reasoning: { effort: 'low' } } }
    output = { status: 'completed', output_text: response(), usage: { input_tokens: 12, output_tokens: 23 } }
  }
  global.fetch = async (url, options) => {
    options.signal.throwIfAborted(); calls.push({ url, body: JSON.parse(options.body) })
    return new Response(JSON.stringify(output))
  }
  reset()
  assert.deepEqual(m.validateExclusionAiRequest(request), request)
  for (const input of [{ ...request, model_id: 21 }, { ...request, description: ' ' },
    { ...request, context: { ...request.context, accountId: -1 } },
    { ...request, context: { ...request.context, actionId: 'facebook_timeline_post' } },
    { ...request, context: { ...request.context, actionId: 'zalo_message_phone', enableMessage: false } }]) {
    assert.throws(() => m.validateExclusionAiRequest(input))
  }
  const parsed = m.parseExclusionAiResponse(response(), page)
  assert.equal(parsed.ok, true); assert.equal(parsed.patch.rules[0].value[0], '7')
  assert.equal(parsed.patch.rules[1].value, 7)
  for (const patch of [
    { ...changes, rules: [] }, { ...changes, groupId: 1 }, { ...changes, name: '' },
    { ...changes, rules: [...changes.rules, changes.rules[0]] },
    ...[{ fieldId: 999, operatorId: 3, values: ['7'] }, { fieldId: 2, operatorId: 1, values: ['7'] },
      { fieldId: 2, operatorId: 3, values: ['missing'] }, { fieldId: 2, operatorId: 3, values: ['7','7'] },
      { fieldId: 4, operatorId: 5, values: [0] }, { fieldId: 4, operatorId: 5, values: [7,8] },
      { fieldId: 4, operatorId: 5, values: ['7'] }, { fieldId: 1, operatorId: 1, values: ['invented'] }]
      .map(rule => ({ ...changes, rules: [rule] }))
  ]) assert.equal(m.parseExclusionAiResponse(response(patch), page).ok, false)
  assert.equal(m.parseExclusionAiResponse(response({ ...changes, rules: [{ fieldId: 5, operatorId: 1, values: [1] }] }), page).ok, true, 'catalog extension is metadata-driven')
  page.catalog.fields.find(field => field.id === 5).isActive = false
  assert.equal(m.parseExclusionAiResponse(response({ ...changes, rules: [{ fieldId: 5, operatorId: 1, values: [1] }] }), page).ok, false)
  for (const status of ['unclear', 'unsupported']) {
    assert.equal(m.parseExclusionAiResponse(JSON.stringify({ status, reason: 'Cần làm rõ', changes: { name: '', matchMode: 'and', rules: [] } }), page).code, status)
    assert.equal(m.parseExclusionAiResponse(JSON.stringify({ status, reason: '', changes }), page).code, 'invalid')
  }
  reset()
  assert.deepEqual(await m.generateCampaignExclusion(request, new AbortController().signal), parsed)
  assert.equal(reads.length, 1); assert.equal(calls.length, 1)
  assert.equal(calls[0].body.model, 'gpt-6.1-sol'); assert.equal(calls[0].body.store, false)
  assert.deepEqual(calls[0].body.text.format.schema, m.EXCLUSION_AI_SCHEMA)
  const payload = JSON.stringify(calls[0].body)
  assert(!payload.includes('"accountId"')); assert(!payload.includes('"blocklists"')); assert(!payload.includes('Đã sửa'))
  assert.equal(logs[0].form_config_id, 101); assert.equal(logs[0].using_id, null)
  assert.equal((await m.listFormAiAvailability(new AbortController().signal))[0].sectionId, 'campaign.send_exclusions')
  for (const change of [() => { row.is_active = false }, () => { row.campaign_action_ids = ['sms_send'] },
    () => { model.is_active = false }, () => { model.organization_id = 1 }, () => { row.output_schema = {} },
    () => { rpcError = { message: 'not_found' } }, () => { rpcHook = () => { global.__exclusionAuth.credentials = {} } }]) {
    reset(); change(); await assert.rejects(m.generateCampaignExclusion(request, new AbortController().signal))
    assert.equal(calls.length, 0)
  }
  reset()
  await assert.rejects(m.generateCampaignExclusion({ ...request, context: { ...request.context, accountId: 101 } }, new AbortController().signal))
  assert.equal(calls.length, 0)
  reset()
  const abort = new AbortController(); rpcHook = () => abort.abort()
  await assert.rejects(m.generateCampaignExclusion(request, abort.signal)); assert.equal(calls.length, 0)
  reset(); output.output_text = response({ ...changes, rules: [{ fieldId: 2, operatorId: 3, values: ['missing'] }] })
  assert.equal((await m.generateCampaignExclusion(request, new AbortController().signal)).ok, false)
  console.log('PASS exclusion AI: scoped account RPC, metadata/IDs/options/types, no recipient data, new draft only, provider schema, log, scope/model/schema, cancellation/auth')
}
main().finally(() => fs.rmSync(tmp, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1 })

// V643: khuôn box "Điều kiện tìm kiếm bài post" sau khi bỏ enum của commentPostSort vẫn qua bước kiểm khuôn của app (compileFormAiSchema)
// và câu trả lời Sonnet 5.5 thử thật 24/11 qua được kiểm khuôn + parseFacebookAiResponse; lựa chọn ngoài danh sách vẫn bị từ chối.
// Chạy: node scripts/fb-ai-filter/v643-schema-check.cjs
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { resolve } = require('node:path')
const root = resolve(__dirname, '../..')
function load(entry) {
  const out = buildSync({ entryPoints: [resolve(root, entry)], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', nodePaths: [resolve(root, 'node_modules')] })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require)
  return module.exports
}
const { compileFormAiSchema, formAiStructuredOptions } = load('src/main/services/formAiSchema.ts')
const { parseFacebookAiResponse } = load('src/shared/campaignFacebookAi.ts')
const live = require(resolve(root, 'scripts/fixtures/fb-ai-filter/form-config-17-live-20261124.json')).output_schema
const next = JSON.parse(JSON.stringify(live)); delete next.properties.changes.properties.commentPostSort.enum
let n = 0; const ok = (name, fn) => { fn(); n += 1; console.log('ok -', name) }
const section = 'campaign.facebook.post_search'
const request = { kind: 'postSearch', actionId: 'facebook_comment_seeding', description: 'x', current: {}, lockedFields: [], eligibleAccountIds: [], secondaryAccountId: null }
ok('khuôn cũ và mới đều qua bước kiểm khuôn của app', () => { compileFormAiSchema(live, section); compileFormAiSchema(next, section) })
ok('Claude nhận khuôn qua output_config.format', () => assert.deepEqual(formAiStructuredOptions('claude', 'https://api.anthropic.com/v1/messages', next, section), { output_config: { format: { type: 'json_schema', schema: next } } }))
const answers = [
  '{"reason":"","status":"ok","changes":{"postKeywords":null,"postContentAI":"Bài của người đang cần thuê phòng trọ ở Hà Nội; bỏ qua bài của môi giới và bài tìm người ở ghép","commentPostSort":"new_posts","isFindPostByKeywords":null,"commentOnlyLatestPost":true,"isFindPostByContentAI":true}}',
  '{"reason":"","status":"ok","changes":{"postKeywords":"thuê trọ, tìm phòng, cần phòng","postContentAI":null,"commentPostSort":null,"isFindPostByKeywords":true,"commentOnlyLatestPost":null,"isFindPostByContentAI":null}}'
]
const validate = compileFormAiSchema(next, section)
ok('câu trả lời Sonnet 5.5 thử thật qua kiểm khuôn và được áp vào form', () => {
  for (const a of answers) { assert.equal(validate(a), true); const r = parseFacebookAiResponse(a, request); assert.equal(r.ok, true, JSON.stringify(r)) }
})
ok('lựa chọn sắp xếp ngoài danh sách: khuôn mới cho qua nhưng app vẫn từ chối cả câu trả lời', () => {
  const bad = answers[0].replace('"new_posts"', '"newest_first"')
  assert.equal(validate(bad), true)
  assert.equal(compileFormAiSchema(live, section)(bad), false)
  assert.equal(parseFacebookAiResponse(bad, request).ok, false)
})
console.log(`PASS ${n} kiểm`)

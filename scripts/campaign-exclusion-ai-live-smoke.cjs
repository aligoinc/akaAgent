// Billable provider check with synthetic account catalog. DB config/model/log and service/parser are real.
// The existing account/catalog RPC is fixture-backed; no customer data or exclusion groups are written.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..')
const snapshot = path.join(root, 'migrations/snapshots/campaign-send-exclusion-ai')
async function main() {
  assert(process.argv.includes('--live'), 'Pass --live for billable provider calls')
  const naturalLanguage = process.argv.includes('--natural-language')
  const arg = name => process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
  const candidatePath = arg('--candidate')
  const receiptPath = arg('--receipt') || path.join(snapshot, naturalLanguage
    ? `natural-language/${candidatePath ? 'candidate' : 'live'}-smoke.json` : 'live-smoke.json')
  assert(!fs.existsSync(receiptPath), 'Receipt already exists; choose a new --receipt path')
  global.__exclusionPromptCandidate = candidatePath ? JSON.parse(fs.readFileSync(candidatePath, 'utf8')).prompt_system : null
  if (candidatePath) assert.equal(typeof global.__exclusionPromptCandidate, 'string')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exclusion-ai-live-'))
  try {
    global.__exclusionPage = structuredClone(require('./fixtures/send-exclusion-ui-page.json'))
    global.__exclusionPage.catalog.fields = global.__exclusionPage.catalog.fields.filter(field => field.id !== 5)
    global.__exclusionPage.groups = []
    global.__exclusionPage.blocklists = []
    if (naturalLanguage) global.__exclusionPage.options.push(
      { fieldId: 2, code: '6', label: 'Đồng nghiệp', value: '6', isActive: true, sortOrder: 0 })
    await build({ stdin: { contents: `export * from './src/main/services/campaignExclusionAiService'; export {setCurrentUser} from './src/main/data/currentUser';`, resolveDir: root },
      outfile: path.join(dir, 'live.cjs'), bundle: true, platform: 'node', logLevel: 'silent', plugins: [{
        name: 'synthetic-account', setup(b) {
          b.onLoad({ filter: /\/campaignSendExclusionRepository\.ts$/ }, () => ({
            contents: 'export const listSendExclusionGroups = async () => globalThis.__exclusionPage', loader: 'ts'
          }))
          b.onLoad({ filter: /\/campaignExclusionAiService\.ts$/ }, args => ({
            contents: fs.readFileSync(args.path, 'utf8')
              .replace('const validate = compileFormAiSchema', 'if (globalThis.__exclusionPromptCandidate) config.prompt.promptSystem = globalThis.__exclusionPromptCandidate;\n  const validate = compileFormAiSchema')
              .replace("if (!result.ok)", "globalThis.__exclusionLogId = result.logId;\n  if (!result.ok)"), loader: 'ts'
          }))
        }
      }] })
    const service = require(path.join(dir, 'live.cjs')); service.setCurrentUser({ staffId: 0, organizationId: null })
    const rules = result => { assert.equal(result.ok, true); return result.patch.rules }
    const cases = naturalLanguage ? require('./campaign-exclusion-ai-natural-cases.cjs') : [
      { name: 'tag-or-recent', description: 'Tạo nhóm loại trừ khách có tag Zalo VIP hoặc đã nhận tin trong 7 ngày gần nhất.',
        check: result => {
          const rows = rules(result); assert.equal(result.patch.matchMode, 'or'); assert.equal(rows.length, 2)
          assert.deepEqual(rows.find(row => row.fieldId === 2)?.value, ['7'])
          assert.equal(rows.find(row => row.fieldId === 4)?.value, 7)
        } },
      { name: 'friend-and-not-tag', description: 'Loại trừ những người đồng thời là Bạn bè và không có tag Zalo VIP. Tên nhóm là Bạn bè không VIP.',
        check: result => {
          const rows = rules(result); assert.equal(result.patch.matchMode, 'and'); assert.equal(rows.length, 2)
          assert.equal(rows.find(row => row.fieldId === 1)?.operatorId, 1); assert.equal(rows.find(row => row.fieldId === 1)?.value, 'friend')
          assert.equal(rows.find(row => row.fieldId === 2)?.operatorId, 4); assert.deepEqual(rows.find(row => row.fieldId === 2)?.value, ['7'])
        } },
      { name: 'unknown-tag', description: 'Loại trừ khách có tag Zalo Kim Cương, chỉ tag này.',
        check: result => { assert.equal(result.ok, false); assert.equal(result.code, 'unclear') } },
      { name: 'fixed-opt-out', description: 'Bỏ loại trừ khách đã từ chối nhận tin để vẫn gửi cho họ.',
        check: result => { assert.equal(result.ok, false); assert.equal(result.code, 'unsupported') } },
      { name: 'nested-condition', description: 'Loại trừ khi (là Bạn bè VÀ có tag Zalo VIP) HOẶC đã nhận tin trong 7 ngày gần nhất. Phải giữ chính xác logic này.',
        check: result => { assert.equal(result.ok, false); assert.equal(result.code, 'unsupported') } },
      { name: 'no-gender-in-catalog', description: 'Loại trừ toàn bộ khách hàng nữ.',
        check: result => { assert.equal(result.ok, false); assert.equal(result.code, 'unsupported') } }
    ]
    const results = []
    for (const fixture of cases.filter(test => !arg('--case') || test.name === arg('--case'))) {
      const originalOptions = global.__exclusionPage.options
      if (fixture.extraOptions) global.__exclusionPage.options = [...originalOptions, ...fixture.extraOptions]
      const result = await service.generateCampaignExclusion({ requestId: crypto.randomUUID(), description: fixture.description,
        context: { actionId: 'zalo_message_friend', accountId: 100, enableMessage: true } }, AbortSignal.timeout(120000))
      global.__exclusionPage.options = originalOptions
      const entry = { name: fixture.name, description: fixture.description, logId: global.__exclusionLogId, result }
      results.push(entry)
      try { fixture.check(result); entry.passed = true; console.log('PASS', fixture.name) }
      catch (error) { entry.passed = false; entry.failure = error.message; console.log('FAIL', fixture.name, JSON.stringify(result)) }
    }
    assert(results.length, 'No cases selected')
    const receipt = { at: new Date().toISOString(), model: 'gpt-6.1-sol', syntheticCatalog: true,
      candidatePrompt: Boolean(candidatePath),
      candidatePromptMd5: candidatePath ? crypto.createHash('md5').update(global.__exclusionPromptCandidate).digest('hex') : null,
      migrationSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, naturalLanguage
        ? 'migrations/20261020153804_campaign_send_exclusion_ai_natural_language.sql'
        : 'migrations/20261020151724_campaign_send_exclusion_ai.sql'))).digest('hex'),
      passed: results.every(row => row.passed), results }
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
    assert(receipt.passed, 'See receipt')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

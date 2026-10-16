// Actual config reader/writer and Supabase HTTP client; all rows live in memory.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const { buildSync } = require('esbuild')
const { createClient } = require('@supabase/supabase-js')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-edit-version-'))
buildSync({ entryPoints: [path.join(root, 'src/main/data/mappers.ts')], outfile: path.join(dir, 'mappers.cjs'), bundle: true, platform: 'node', format: 'cjs' })
const { mapCampaignConfigFromDB, mapCampaignFromDB } = require(path.join(dir, 'mappers.cjs'))
const source = ts.createSourceFile('repository.ts', fs.readFileSync(path.join(root, 'src/main/data/repositories/campaignRepository.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const code = ts.transpileModule(['getCampaignConfig', 'updateCampaign'].map(name => source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(source)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const ipcSource = ts.createSourceFile('handlers.ts', fs.readFileSync(path.join(root, 'src/main/ipc/handlers/campaignHandlers.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const find = node => (ts.isCallExpression(node) && node.expression.getText(ipcSource) === 'ipcMain.handle' && node.arguments[0]?.getText(ipcSource) === 'IPC_EVENTS.DB_UPDATE_CAMPAIGN')
  ? node.arguments[1] : ts.forEachChild(node, find)
const ipcCode = ts.transpileModule(`exports.update = ${find(ipcSource).getText(ipcSource)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function fixture() {
  const state = { row: { id: 91, staff_id: 7, organization_id: 9, is_delete: false, status: 'tạm dừng',
    runtime_claim_token: null, runtime_unit_token: null, updated_at: '2026-10-16T01:00:00.123456+00:00',
    name: 'Original', action_id: 'zalo_message_friend', account_id: 11, content: 'old',
    schedule: '2026-10-17T01:00:00+00:00', extra_settings: { a: 1, b: { c: 2, d: 3 } }, images: [] }, writes: 0, beforeWrite: null, requests: [] }
  const client = createClient('http://campaign-edit.test', 'fixture-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (url, init) => {
    assert.equal(new URL(url).pathname, '/rest/v1/auto_campaigns')
    const params = new URL(url).searchParams
    state.requests.push({ method: init.method, params })
    if (init.method === 'PATCH') state.beforeWrite?.()
    const matches = Array.from(params).filter(([key]) => key !== 'select').every(([key, value]) =>
      value === 'is.null' ? state.row[key] === null : value === `eq.${state.row[key]}`)
    if (matches && init.method === 'PATCH') { state.writes++; Object.assign(state.row, JSON.parse(init.body)) }
    const singular = new Headers(init.headers).get('accept')?.includes('vnd.pgrst.object')
    if (!matches && singular) return new Response(JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'Cannot coerce the result to a single JSON object' }), { status: 406, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify(singular ? { ...state.row } : matches ? [{ ...state.row }] : []), { headers: { 'content-type': 'application/json' } })
  } } })
  const repo = {}
  vm.runInNewContext(code, { exports: repo, client: () => client, requireCurrentUser: () => ({ staffId: 7, organizationId: 9 }),
    CAMPAIGN_CONFIG_SELECT: '*', CAMPAIGN_SELECT: '*', mapCampaignConfigFromDB, mapCampaignFromDB,
    attachCampaignSecondaryAccountNames: async rows => rows, attachCampaignDataGroupSourceSummaries: async rows => rows,
    touchesRestrictedCampaignConfig: () => false, smsMaterializationUpdateRequested: () => false,
    isMobileManagedSmsCampaignAction: () => false, SMS_SEND_ACTION_ID: 'sms_send',
    getCampaignEditVersion: row => mapCampaignConfigFromDB(row).editVersion,
  })
  const ipc = {}
  vm.runInNewContext(ipcCode, { exports: ipc, supabase: repo, isStatusOnlyCampaignUpdate: () => false,
    assertCanUpdateCampaignFromRenderer: async () => {}, realtimeRefreshController: null,
    CampaignConfigSaveError: class extends Error {} })
  const save = (opened, patch = { name: 'Saved' }) => ipc.update(null, 91, patch, true, opened.updatedAt, undefined, opened.editVersion)
  return { state, repo, save }
}

async function main() {
  const { state, repo, save } = fixture()
  const opened = await repo.getCampaignConfig(91)
  // Normal pause cleanup appends a log AFTER releasing this campaign's runtime.
  state.row.log = 'Đã hoàn thành lượt hiện tại và tạm dừng chiến dịch.'
  state.row.note = 'Tạm dừng theo yêu cầu'
  state.row.updated_at = '2026-10-16T01:00:01.654321+00:00'
  const freshTime = state.row.updated_at
  const saved = await save(opened)
  assert.equal(saved.name, 'Saved', 'a log append must not invalidate the open editor')
  assert.equal(state.writes, 1)
  assert.equal(state.requests.find(r => r.method === 'PATCH').params.get('updated_at'), `eq.${freshTime}`, 'keep the exact microsecond timestamp for the final atomic write')
  assert.equal(state.requests.filter(r => r.method === 'GET').length, 2, 'only open + existing pre-save readiness read')

  for (const change of [
    { name: 'Other name' }, { content: 'Other content' }, { schedule: '2026-10-20T01:00:00+00:00' },
    { original_schedule: '2026-10-20T01:00:00+00:00' }, { extra_settings: { dailyLimit: 10 } },
    { images: ['other.png'] }, { account_id: 12 }, { secondary_account_id: 13 },
    { data_group_id: 123 }, { data_target_source_mode: 'data_group' }, { provisioning_state: 'staged' }
  ]) {
    const test = fixture(), original = await test.repo.getCampaignConfig(91)
    Object.assign(test.state.row, change, { updated_at: '2026-10-16T02:00:00.111111+00:00' })
    await assert.rejects(test.save(original), /Cấu hình chiến dịch đã thay đổi/)
    assert.equal(test.state.writes, 0, JSON.stringify(change))
  }
  const reordered = fixture(), original = await reordered.repo.getCampaignConfig(91)
  reordered.state.row.extra_settings = { b: { d: 3, c: 2 }, a: 1 }
  reordered.state.row.updated_at = '2026-10-16T02:00:00.111111+00:00'
  await reordered.save(original)
  for (const change of [{ status: 'chờ xử lý' }, { runtime_claim_token: 'new-owner' }, { runtime_unit_token: 'new-unit' }]) {
    const test = fixture(), original = await test.repo.getCampaignConfig(91)
    Object.assign(test.state.row, change)
    await assert.rejects(test.save(original), /chưa tạm dừng/)
    assert.equal(test.state.writes, 0)
  }
  // The configuration check does not replace the final atomic ownership/CAS guard.
  for (const change of [{ status: 'chờ xử lý' }, { runtime_claim_token: 'new-owner' }, { runtime_unit_token: 'new-unit' },
    { updated_at: '2026-10-16T02:00:00.111111+00:00', content: 'concurrent' }, { staff_id: 8 }, { is_delete: true }]) {
    const test = fixture(), original = await test.repo.getCampaignConfig(91)
    test.state.beforeWrite = () => Object.assign(test.state.row, change)
    await assert.rejects(test.save(original), /Chiến dịch đã thay đổi hoặc không còn sẵn sàng sửa/)
    assert.equal(test.state.writes, 0)
  }
  console.log('PASS Desktop: pause log after open, exact HTTP CAS, no extra reads, config conflicts, JSON key order, readiness and concurrent write guards')
}
main().finally(() => fs.rmSync(dir, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1 })

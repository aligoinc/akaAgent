const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')
async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-detail-page-'))
  try {
    const output = join(directory, 'page.cjs')
    await build({ stdin: { contents: `
      export { listCampaignDetailsPage } from './src/main/data/repositories/campaignRepository';
      export { setCurrentUser, setCurrentUserCredentials } from './src/main/data/currentUser';
    `, resolveDir: resolve(__dirname, '..') }, outfile: output, bundle: true, platform: 'node', format: 'cjs', target: 'node20',
      external: ['electron', 'better-sqlite3'], logLevel: 'warning',
      plugins: [{ name: 'detail-page-db', setup(plugin) {
        plugin.onResolve({ filter: /\/supabaseClient$/ }, () => ({ path: 'db', namespace: 'detail-page' }))
        plugin.onLoad({ filter: /.*/, namespace: 'detail-page' }, () => ({ contents: `
          export const getSupabaseClient = () => globalThis.detailPageDb;
          export const getSupabaseUrl = () => 'https://mock.invalid';` }))
      } }] })
    const { listCampaignDetailsPage: load, setCurrentUser, setCurrentUserCredentials } = require(output)
    setCurrentUser({ staffId: 7, organizationId: 9 })
    setCurrentUserCredentials({ username: 'fixture-user', password: 'fixture-password' })
    const rows = [32, 31].map(id => ({ id, campaign_id: 17, input_data_id: 100 + id,
      created_at: '2026-01-02T00:00:00.000900Z', action_name: 'Fixture action', status: 'lỗi',
      is_delete: false, log: `log-${id}`, data: { fixture: id } }))
    let response = { data: { items: rows, total: 251 }, error: null }
    const calls = []
    globalThis.detailPageDb = {
      async rpc(name, args) {
        calls.push({ name, args })
        if (name === 'aka_agent_list_campaign_details_page') return response
        assert.equal(name, 'aka_agent_list_campaign_detail_automation_triggers')
        assert.deepEqual(args.p_campaign_detail_ids, [32, 31])
        return { data: [{ source_campaign_detail_id: 32, automation_detail_id: 4, automation_id: 3, automation_name: 'Fixture automation' }], error: null }
      },
      from(table) {
        assert.equal(table, 'auto_campaign_input_data', 'No direct full-row results paging or separate ownership query')
        let ids, campaign
        const builder = {
          select() { return builder }, in(column, value) { assert.equal(column, 'id'); ids = value; return builder },
          eq(column, value) { assert.equal(column, 'campaign_id'); campaign = value; return builder },
          then(resolve) { assert.equal(campaign, 17); assert.deepEqual(ids, [132, 131]); return Promise.resolve({ data: ids.map(id => ({ id, name: `input-${id}` })), error: null }).then(resolve) }
        }
        return builder
      }
    }
    const result = await load({ campaignId: 17, offset: 100, limit: 100, sort: 'created_asc', search: '  Tên,(x)*%  ', status: ' lỗi ', dateFrom: '2026-01-01', dateTo: '2026-01-03' })
    assert.equal(result.total, 251)
    assert.deepEqual(result.items.map(x => x.id), [32, 31], 'Preserve database microsecond/tie order')
    assert.equal(result.items[0].log, 'log-32')
    assert.equal(result.items[0].inputData.name, 'input-132')
    assert.equal(result.items[0].triggeredAutomations[0].automationName, 'Fixture automation')
    assert.deepEqual(calls[0].args, { p_staff_id: 7, p_organization_id: 9, p_campaign_id: 17,
      p_search: 'Tên x', p_status: 'lỗi', p_date_from: '2026-01-01T00:00:00.000Z', p_date_to: '2026-01-03T00:00:00.000Z',
      p_offset: 100, p_limit: 100, p_sort: 'created_asc', p_auth_username: 'fixture-user', p_auth_password: 'fixture-password' })
    response = { data: { items: [], total: 251 }, error: null }
    calls.length = 0
    assert.deepEqual(await load({ campaignId: 17, offset: 900 }), { items: [], total: 251 })
    assert.equal(calls.length, 1, 'Empty page must keep exact total and skip enrichment')
    assert.equal(calls[0].args.p_sort, 'created_desc')
    response = { data: null, error: { message: 'campaign_not_found' } }
    await assert.rejects(load({ campaignId: 17 }), /campaign_not_found/)
    response = { data: { items: [], total: 'bad' }, error: null }
    await assert.rejects(load({ campaignId: 17 }), /phân trang/)
    await assert.rejects(load({ campaignId: 17, sort: 'processed_desc' }), /sắp xếp/)
    await assert.rejects(load({ campaignId: 17, dateFrom: '2026-02-01', dateTo: '2026-01-01' }), /Khoảng thời gian/)
    console.log('PASS actual repository RPC args, normalization, payload/order, input and automation enrichment, empty-page totals, failures')
  } finally { delete globalThis.detailPageDb; rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

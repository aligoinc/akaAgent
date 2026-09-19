const { match: matches, compare, value: fieldValue } = require('./fixtures/report-postgrest.cjs')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const root = resolve(__dirname, '..'), directory = mkdtempSync(join(tmpdir(), 'aka-report-'))
  try {
    await build({
      entryPoints: [join(root, 'src/main/data/repositories/reportRepository.ts')],
      outfile: join(directory, 'repository.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning',
      plugins: [{ name: 'isolated-report', setup(builder) {
        builder.onResolve({ filter: /\/(supabaseClient|currentUser|accountActionRepository|entitlementRepository)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: {
          supabaseClient: 'export const getSupabaseClient = () => globalThis.reportDb',
          currentUser: 'export const requireCurrentUser = () => ({staffId:7,organizationId:9}); export const runWithCurrentUser = (_user, run) => run()',
          accountActionRepository: 'export const listAccountActions = async () => globalThis.reportActions',
          entitlementRepository: 'export const loadCurrentUserEffectiveEntitlements = async () => ({}); export const canUseAccountPlatformWithEntitlements = () => true'
        }[args.path] }))
      } }]
    })
    await build({ entryPoints: [join(root, 'src/main/domain/reports/reportReadFlights.ts')], outfile: join(directory, 'flights.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
    const { ReportReadFlights, reportFlightKey } = require(join(directory, 'flights.cjs'))
    const flights = new ReportReadFlights()
    let release
    const gate = new Promise(resolve => { release = resolve })
    const first = flights.run('first', () => gate)
    assert.strictEqual(first, flights.run('first', () => { throw new Error('Duplicate load') }))
    const second = flights.run('second', () => gate)
    await assert.rejects(flights.run('third', async () => 3), /Đang tải báo cáo khác/)
    release(1)
    await Promise.all([first, second])
    await assert.rejects(flights.run('failed', async () => { throw new Error('Fixture failure') }), /Fixture failure/)
    assert.equal(await flights.run('failed', async () => 2), 2, 'failure releases capacity for explicit retry')
    assert.notEqual(reportFlightKey('summary', [7,9], {}), reportFlightKey('summary', [8,9], {}), 'never share a tenant read')
    assert.notEqual(reportFlightKey('summary', [7,9], {}), reportFlightKey('summary', [7,9], { accountIds: [] }), 'empty selection differs from all accounts')
    const query = { startIso: '2026-09-18T17:00:00.000Z', endIso: '2026-09-19T17:00:00.000Z', flatformType: 'zalo' }
    const accounts = [{ id: 11, name: 'Zalo', flatform_type: 'zalo', staff_id: 7, organization_id: 9, is_delete: false }]
    globalThis.reportActions = [
      { code: 'zalo_find_phone_user', name: 'Tìm SĐT', flatformType: 'zalo' },
      { code: 'zalo_message_stranger', name: 'Nhắn tin', flatformType: 'zalo' },
      { code: 'zalo_add_friend', name: 'Kết bạn', flatformType: 'zalo' }
    ]
    const campaign = (id, overrides = {}) => ({ id, name: `Campaign ${id}`, account_id: 11, staff_id: 7, organization_id: 9, is_delete: false, action_id: 'zalo_message_phone', schedule: query.startIso, extra_settings: { enableMessage: true, enableAddFriend: false }, ...overrides })
    const campaigns = [campaign(1), campaign(2, { schedule: '2020-01-01T00:00:00Z' }), campaign(3, { account_id: 22 }), campaign(4, { staff_id: 8 }), campaign(5, { organization_id: 10 }), campaign(6, { is_delete: true }), campaign(7, { action_id: 'zalo_message_group' })]
    // Ensure campaign scope itself is paged beyond PostgREST's 1,000 row cap.
    campaigns.push(...Array.from({ length: 1001 }, (_, i) => campaign(100 + i, { action_id: 'zalo_message_group' })))
    const input = (id, campaignId = 1, schedule = null, overrides = {}) => ({ id, campaign_id: campaignId, schedule, is_delete: false, status: 'chờ xử lý', name: `Target ${id}`, ...overrides })
    const inputs = Array.from({ length: 1205 }, (_, i) => input(i + 1))
    inputs.push(input(2001, 2, query.startIso), input(2002, 1, query.endIso), input(2003, 2), input(2004, 1, query.startIso, { is_delete: true }), input(2005, 1, query.startIso, { status: 'hoàn thành' }), input(2006, 3), input(2007, 4), input(2008, 5), input(2009, 6), input(2010, 7))
    // Old inputs should never cross the network for today's report.
    inputs.push(...Array.from({ length: 1500 }, (_, i) => input(3000 + i, 1, '2020-01-01T00:00:00Z')))
    const details = [{ id: 1, account_id: 11, action_code: 'zalo_message_stranger', status: 'lỗi', is_delete: false, created_at: query.startIso }]
    const calls = []; let failPending = false
    globalThis.reportDb = createClient('https://fixture.invalid', 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (urlValue, options) => {
        const url = new URL(urlValue), p = url.searchParams, table = url.pathname.split('/').pop()
        assert.equal(url.hostname, 'fixture.invalid'); assert.ok(['GET','HEAD'].includes(options.method))
        let rows = ({ auto_accounts: accounts, auto_campaigns: campaigns, auto_campaign_input_data: inputs, auto_campaign_details: details })[table]
        assert.ok(rows, table)
        rows = rows.map(row => {
          const input = inputs.find(input => input.id === row.input_data_id)
          return { ...row, auto_campaigns: campaigns.find(c => c.id === row.campaign_id),
            report_input: input ? { ...input, auto_campaigns: campaigns.find(c => c.id === input.campaign_id) } : null }
        })
        for (const [key, expression] of p) {
          if (['select', 'order', 'limit', 'offset'].includes(key)) continue
          const predicate = key === 'or' ? `or${expression}` : `${key}.${expression}`
          const leftAlias = key.startsWith('report_input.') ? 'report_input'
            : key.startsWith('auto_campaigns.') && p.get('select').includes('auto_campaigns(id,') ? 'auto_campaigns' : null
          if (leftAlias) rows = rows.map(row => matches(row, predicate) ? row : { ...row, [leftAlias]: null })
          else rows = rows.filter(row => matches(row, predicate))
        }
        const order = (p.get('order') || 'id.asc').split(',').map(x => x.split('.'))
        rows.sort((a, b) => {
          for (const [key, direction] of order) {
            const delta = compare(fieldValue(a,key), fieldValue(b,key)) * (direction === 'desc' ? -1 : 1)
            if (delta) return delta
          }
          return 0
        })
        const total = rows.length
        rows = rows.slice(Number(p.get('offset') || 0), Number(p.get('offset') || 0) + Number(p.get('limit') || 1000))
        calls.push({ table, p, method: options.method, prefer: new Headers(options.headers).get("prefer"), count: options.method === "HEAD" ? 0 : rows.length })
        if (table === 'auto_campaign_input_data') {
          assert.equal(p.get('auto_campaigns.staff_id'), 'eq.7')
          assert.equal(p.get('auto_campaigns.organization_id'), 'eq.9')
          if (p.get('status') === 'eq.chờ xử lý') assert.equal(p.get('auto_campaigns.is_delete'), 'eq.false')
          if (!p.get('select').includes('name')) {
            assert.ok(p.has('campaign_id'), 'root campaign scope prevents global pending scan')
            assert.ok(p.has('schedule') || p.has('or'), 'date filter must happen before paging')
            assert.equal(p.has('offset'), false)
          }
          if (failPending) return new Response(JSON.stringify({ message: 'Fixture timeout' }), { status: 500 })
        }
        const single = new Headers(options.headers).get('accept')?.includes('vnd.pgrst.object')
        return new Response(options.method === 'HEAD' ? null : JSON.stringify(single ? rows[0] : rows), { headers: { 'content-type': 'application/json', 'content-range': `0-${rows.length - 1}/${total}` } })
      } }
    })
    const repo = require(join(directory, 'repository.cjs'))
    const report = await repo.getAccountActionReport(query)
    assert.equal(report.rows[0].countsByActionCode.zalo_message_stranger.pendingCount, 1206)
    assert.equal(report.rows[0].countsByActionCode.zalo_find_phone_user.pendingCount, 1206)
    assert.equal(report.rows[0].countsByActionCode.zalo_add_friend.pendingCount, 0)
    assert.equal(report.rows[0].countsByActionCode.zalo_message_stranger.failureCount, 1)
    assert.equal(calls.filter(c => c.table === 'auto_campaign_input_data').reduce((n,c) => n+c.count,0), 1206)
    assert.equal(calls.filter(c => c.table === 'auto_campaigns').length, 2)
    calls.length = 0
    const detailQuery = { ...query, accountId: 11, actionCode: 'zalo_message_stranger', statusBucket: 'pending', page: 13, pageSize: 100 }
    const detail = await repo.getAccountActionReportDetails(detailQuery)
    assert.equal(detail.total, 1206)
    assert.deepEqual(detail.rows.map(r => Number(r.id.split(':')[1])), [1201,1202,1203,1204,1205,2001])
    const hydrated = calls.filter(c => c.table === 'auto_campaign_input_data' && c.p.get('select').includes('name'))
    assert.equal(hydrated.reduce((n,c) => n+c.count,0), 6, 'hydrate only selected target rows')
    calls.length = 0
    const empty = await repo.getAccountActionReport({ ...query, accountIds: [] })
    assert.equal(empty.rows.length, 0); assert.equal(calls.length, 0)
    failPending = true
    await assert.rejects(() => repo.getAccountActionReport(query), /Fixture timeout/)
    failPending = false
    assert.equal((await repo.getAccountActionReport(query)).rows[0].countsByActionCode.zalo_message_stranger.pendingCount, 1206)
    // Coalesce only identical in-flight requests; explicit later reload remains fresh.
    calls.length = 0
    const selectedCodes = globalThis.reportActions.map(a => a.code)
    const [sharedA, sharedB] = await Promise.all([
      repo.getAccountActionReport({ ...query, actionCodes: selectedCodes }),
      repo.getAccountActionReport({ ...query, actionCodes: [...selectedCodes].reverse() })
    ])
    assert.strictEqual(sharedA, sharedB)
    assert.equal(calls.filter(c => c.table === 'auto_accounts').length, 1)
    await repo.getAccountActionReport({ ...query, actionCodes: selectedCodes })
    assert.equal(calls.filter(c => c.table === 'auto_accounts').length, 2)

    calls.length = 0
    const exportedPending = await repo.getAccountActionReportDetails({ ...detailQuery, exportAll: true })
    assert.equal(exportedPending.total, 1206)
    assert.equal(new Set(exportedPending.rows.map(r => r.id)).size, 1206)
    assert.ok(calls.filter(c => c.table === 'auto_campaign_input_data').every(c => c.method === 'GET' && !c.prefer?.includes('count=exact') && !c.p.has('offset')))

    details.length = 0
    for (let i = 0; i < 2005; i++) {
      inputs.push(input(6000 + i, 1, '2020-01-01T00:00:00Z', { name: `Export ${i}`, status: 'hoàn thành' }))
      details.push({ id: i + 1, campaign_id: 1, input_data_id: 6000 + i, account_id: 11, action_code: 'zalo_message_stranger', status: 'thành công', is_delete: false,
        created_at: i < 1000 ? '2026-09-19T00:00:00.123457+00:00' : '2026-09-19T00:00:00.123456+00:00' })
    }
    calls.length = 0
    const exported = await repo.getAccountActionReportDetails({ ...detailQuery, statusBucket: 'success', exportAll: true })
    assert.equal(exported.total, 2005)
    assert.equal(new Set(exported.rows.map(r => r.id)).size, 2005)
    assert.ok(exported.rows.every(r => r.targetName?.startsWith('Export ')), 'all target fields survive the 1,000-row API cap')
    const exportedReads = calls.filter(c => c.table === 'auto_campaign_details')
    assert.equal(exportedReads.length, 3)
    assert.ok(exportedReads.every(c => !c.p.has('offset') && !c.prefer?.includes('count=exact')))
    assert.ok(exportedReads[1].p.get('or').includes('.123457+00:00'), 'cursor preserves PostgreSQL microseconds')
    assert.equal(calls.filter(c => c.table === 'auto_campaign_input_data').length, 0, 'target metadata is embedded, with no extra reads')
    assert.ok(exportedReads.every(c => c.p.get('report_input.auto_campaigns.staff_id') === 'eq.7' && c.p.get('report_input.auto_campaigns.organization_id') === 'eq.9'))
    details.length = 0
    inputs.push(input(9001, 6, null, { name: 'Deleted target', is_delete: true }), input(9002, 5, null, { name: 'Foreign private target' }))
    for (let i = 0; i < 3; i++) details.push({ id: i + 1, campaign_id: i === 2 ? null : 6, input_data_id: 9001 + i, account_id: 11,
      action_code: 'zalo_message_stranger', status: 'thành công', is_delete: false, created_at: query.startIso, data: { targetName: 'Historical fallback' } })
    const historical = await repo.getAccountActionReportDetails({ ...detailQuery, statusBucket: 'success', page: 1 })
    assert.equal(historical.total, 3)
    assert.deepEqual(historical.rows.map(r => r.targetName), ['Historical fallback', 'Historical fallback', 'Deleted target'])
    assert.deepEqual(historical.rows.map(r => r.campaignName), [null, 'Campaign 6', 'Campaign 6'])
    console.log('PASS reports: DB pending paging, >1000 rows, date fallback, tenant/action guards, microsecond export cursors, complete target hydration, in-flight dedupe and retry; no live DB')
  } finally { rmSync(directory, { recursive: true, force: true }); delete globalThis.reportDb; delete globalThis.reportActions }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

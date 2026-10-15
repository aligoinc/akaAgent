const statusCatalogTables = require('./fixtures/action-status-report.json')
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
    assert.notEqual(reportFlightKey('summary', [7,9], {}), reportFlightKey('status-summary', [7,9], {}), 'report modes have independent flights')
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
        let rows = ({ ...statusCatalogTables, auto_accounts: accounts, auto_campaigns: campaigns, auto_campaign_input_data: inputs, auto_campaign_details: details })[table]
        assert.ok(rows, table)
        rows = rows.map(row => {
          const input = inputs.find(input => input.id === row.input_data_id)
          const pending = details.filter(d => d.input_data_id === row.id && Array.from(p).every(([key, expression]) =>
            !key.startsWith('pending_result.') || matches(d, `${key.slice('pending_result.'.length)}.${expression}`)))
          return { ...row, auto_campaigns: campaigns.find(c => c.id === row.campaign_id),
            pending_result: pending.length ? pending : null,
            report_input: input ? { ...input, auto_campaigns: campaigns.find(c => c.id === input.campaign_id) } : null }
        })
        for (const [key, expression] of p) {
          if (key.startsWith('pending_result.')) continue
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
    // New report: real PostgREST builder, shared pending reader, independent status filters.
    details.length = 0
    const resultRow = (id, overrides = {}) => ({ id, campaign_id: 1, account_id: 11, action_code: 'zalo_message_stranger', status: 'thành công',
      status_id: 20, sub_status_id: 34, report_group: 'success', is_delete: false, created_at: '2026-09-19T00:00:00.123456+00:00', ...overrides })
    details.push(...Array.from({ length: 1005 }, (_, i) => resultRow(i + 1, { status_id: i % 2 ? 20 : null })))
    const longLegacy = 'Kết quả cũ, \"nguyên văn\" \\ '.repeat(20)
    details.push(resultRow(1109, { status_id: null, status: longLegacy, report_group: null }))
    details.push(resultRow(1100, { status_id: 21 }), resultRow(1101, { status_id: null, status: 'Kết quả, "đặc biệt"', report_group: null }),
      resultRow(1102, { status_id: 55, status: 'Trạng thái cũ' }), resultRow(1103, { report_group: 'pending', input_data_id: 1 }),
      resultRow(1104, { report_group: 'pending', input_data_id: null }), resultRow(1105, { status_id: null, status: 'trùng', report_group: null }),
      resultRow(1106, { account_id: 22 }), resultRow(1107, { is_delete: true }), resultRow(1108, { created_at: query.endIso }))
    calls.length = 0
    const statuses = await repo.getAccountActionStatusReport(query)
    const selectedAction = statuses.actions.find(a => a.code === 'zalo_message_stranger')
    const statusCounts = statuses.rows[0].countsByActionCode.zalo_message_stranger
    assert.equal(statusCounts.pending, 1207, 'pending result/input counted once, result with no input retained')
    assert.equal(statusCounts['status:20'], 1005, 'canonical ID and exact legacy value merge; secondary status never adds a count')
    assert.equal(statusCounts['status:21'], 1, 'stored main ID wins over text')
    assert.equal(statusCounts['status:22'], 0, 'configured zero columns retained')
    assert.equal(statusCounts['status:30'], 0)
    assert.equal(statusCounts['status:55'], 1, 'retired historical status retained')
    assert.equal(selectedAction.statuses.filter(c => c.key === 'status:20').length, 1)
    assert.equal(selectedAction.statuses.some(c => c.key === 'status:34'), false, 'unrelated wildcard and secondary tracking are excluded')
    const exactQuery = { ...query, accountId: 11, actionCode: 'zalo_message_stranger', page: 1, pageSize: 100 }
    for (const column of selectedAction.statuses) {
      const exported = await repo.getAccountActionStatusReportDetails({ ...exactQuery, selector: column.selector, exportAll: true })
      assert.equal(exported.total, statusCounts[column.key], `export parity: ${column.label}`)
      assert.equal(new Set(exported.rows.map(r => r.id)).size, exported.total)
    }
    const longColumn = selectedAction.statuses.find(column => column.selector.kind === 'legacy' && column.selector.status === longLegacy)
    assert.ok(longColumn, 'long legacy status is preserved exactly in summary')
    const longPage = await repo.getAccountActionStatusReportDetails({ ...exactQuery, selector: longColumn.selector })
    assert.equal(longPage.total, 1)
    assert.equal(longPage.rows[0].status, longLegacy, 'long/escaped legacy detail matches summary and export')
    const pendingPage = await repo.getAccountActionStatusReportDetails({ ...exactQuery, selector: { kind: 'pending' }, pageSize: 3 })
    assert.equal(pendingPage.total, 1207)
    assert.deepEqual(pendingPage.rows.map(r => r.source), ['campaign_detail', 'campaign_detail', 'campaign_input_data'])
    assert.equal(pendingPage.rows[2].id, 'pending:2:zalo_message_stranger')
    assert.ok(calls.filter(c => c.table === 'auto_campaign_details' && c.p.get('or')?.includes('status_id')).every(c => !c.p.get('or').includes('sub_status_id')))
    await assert.rejects(repo.getAccountActionStatusReportDetails({ ...exactQuery, selector: { kind: 'status', statusId: 20, status: 'thành công' } }), /Trạng thái báo cáo/)
    await assert.rejects(repo.getAccountActionStatusReportDetails({ ...exactQuery, accountId: 22, selector: { kind: 'pending' } }), /Không tìm thấy tài khoản/)
    const commonAfter = await repo.getAccountActionReport(query)
    assert.equal(commonAfter.rows[0].countsByActionCode.zalo_message_stranger.successCount, 1007, 'general report keeps stored report_group semantics')
    // Use the real PostgREST literal grammar, including controls and look-alike text.
    assert.equal(matches({ status: 'oldnstate' }, 'status.eq."old\\nstate"'), true)
    assert.equal(matches({ status: 'old\nstate' }, 'status.eq."old\\nstate"'), false)
    const rawStates = ['old\nstate', 'old\r\nstate', 'old\tstate', 'old\\nstate', 'oldnstate', ' ",or(account_id.eq.22),\\tail ']
    const canonicalRaw = 'catalog\nstate\r\n\t"quoted"\\tail'
    statusCatalogTables.auto_status.push({ id: 88, name: 'Catalog fixture', status_value: canonicalRaw,
      flatform_type: 'zalo', component_type: 'campaign_detail', is_active: true, is_delete: false })
    details.length = 0; inputs.length = 0
    let nextId = 1
    rawStates.forEach((status, i) => {
      for (let j = 0; j < (i === 0 ? 1001 : 1); j++) details.push(resultRow(nextId++, { status_id: null, status, report_group: null }))
    })
    details.push(resultRow(nextId++, { status_id: null, status: canonicalRaw, report_group: null }),
      resultRow(nextId++, { status_id: 88, status: 'stored canonical result', report_group: null }))
    const controlReport = await repo.getAccountActionStatusReport(query)
    const controlAction = controlReport.actions.find(a => a.code === exactQuery.actionCode)
    for (const [i, raw] of [...rawStates, canonicalRaw].entries()) {
      const column = controlAction.statuses.find(c => raw === canonicalRaw
        ? c.selector.kind === 'status' && c.selector.statusId === 88
        : c.selector.kind === 'legacy' && c.selector.status === raw)
      assert.ok(column, 'summary preserves raw status identity')
      const expected = raw === canonicalRaw ? 2 : i === 0 ? 1001 : 1
      assert.equal(controlReport.rows[0].countsByActionCode[exactQuery.actionCode][column.key], expected)
      const page = await repo.getAccountActionStatusReportDetails({ ...exactQuery, selector: column.selector, pageSize: 2 })
      assert.equal(page.total, expected, 'control-character detail matches summary')
      const exported = await repo.getAccountActionStatusReportDetails({ ...exactQuery, selector: column.selector, exportAll: true })
      assert.equal(exported.total, expected, 'control-character export matches summary')
      assert.equal(exported.rows.length, expected)
      assert.equal(new Set(exported.rows.map(row => row.id)).size, expected)
      assert.ok(exported.rows.every(row => row.status === raw || (raw === canonicalRaw && row.status === 'stored canonical result')))
      if (i === 0) {
        const lastPage = await repo.getAccountActionStatusReportDetails({ ...exactQuery, selector: column.selector, page: 11 })
        assert.equal(lastPage.rows.length, 1)
        assert.equal(lastPage.total, 1001)
      }
    }
    // Real catalog loader must recognize types whose quota list is empty or omits likes.
    accounts[0].flatform_type = 'facebook'
    campaigns.length = 0; inputs.length = 0; details.length = 0
    for (const [campaignId, actionCodes, quotaCodes] of [
      ['facebook_timeline_post', ['fb_post_my_profile', 'fb_comment', 'fb_like_post'], []],
      ['facebook_group_post', ['fb_post_group', 'fb_comment', 'fb_like_post'], ['fb_post_group']],
      ['facebook_comment_seeding', ['fb_comment', 'fb_like_post'], ['fb_comment']],
      ['facebook_comment_seeding_post', ['fb_comment', 'fb_like_post'], ['fb_comment']],
      ['facebook_newsfeed_interaction', ['fb_comment', 'fb_like_post'], []]
    ]) {
      statusCatalogTables.auto_campaign_actions = [
        { id: campaignId, limit_check_action_codes: quotaCodes, is_active: true, is_delete: false },
        { id: 'facebook_message_friend', limit_check_action_codes: [], is_active: true, is_delete: false }
      ]
      statusCatalogTables.auto_campaign_action_detail_statuses = [20,21,22].map((statusId, i) => ({
        id: i + 1, campaign_action_id: campaignId, action_code: null, status_id: statusId, sort_order: i,
        is_active: true, is_delete: false
      }))
      statusCatalogTables.auto_campaign_action_detail_statuses.push({ id: 4, campaign_action_id: 'facebook_message_friend',
        action_code: null, status_id: 34, is_active: true, is_delete: false })
      globalThis.reportActions = actionCodes.map(code => ({ code, name: code, flatformType: 'facebook' }))
      const report = await repo.getAccountActionStatusReport({ ...query, flatformType: 'facebook' })
      assert.equal(report.actions.length, actionCodes.length)
      for (const action of report.actions) {
        assert.deepEqual(action.statuses.map(c => c.key), ['pending', 'status:20', 'status:21', 'status:22'], campaignId + ':' + action.code)
        assert.deepEqual(Object.values(report.rows[0].countsByActionCode[action.code]), [0,0,0,0])
      }
    }
    await build({ entryPoints: [join(root, 'src/main/domain/campaigns/campaignActionDescriptors.ts')], outfile: join(directory, 'actions.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
    const descriptors = require(join(directory, 'actions.cjs'))
    assert.deepEqual(descriptors.getCampaignExecutableActionDescriptors({ actionId: 'facebook_newsfeed_interaction' }), [], 'type capabilities must not enable runtime options')
    assert.deepEqual(descriptors.getCampaignExecutableActionDescriptors({ actionId: 'facebook_timeline_post' }).map(a => a.code), ['fb_post_my_profile'])
    assert.deepEqual(descriptors.getCampaignActionDescriptors({ actionId: 'facebook_timeline_post' }, { limitCheckActionCodes: [] }), [], 'quota behavior stays unchanged')
    console.log('PASS reports: DB pending paging, >1000 rows, date fallback, tenant/action guards, microsecond export cursors, complete target hydration, in-flight dedupe and retry; action-status columns, unmetered/optional wildcards, long legacy/history, pending union, main-only counts and detail/export parity; no live DB')
  } finally { rmSync(directory, { recursive: true, force: true }); delete globalThis.reportDb; delete globalThis.reportActions }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

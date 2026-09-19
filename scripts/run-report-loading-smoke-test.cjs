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
          currentUser: 'export const requireCurrentUser = () => ({staffId:7,organizationId:9})',
          accountActionRepository: 'export const listAccountActions = async () => globalThis.reportActions',
          entitlementRepository: 'export const loadCurrentUserEffectiveEntitlements = async () => ({}); export const canUseAccountPlatformWithEntitlements = () => true'
        }[args.path] }))
      } }]
    })
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
    const value = (row, key) => key.startsWith('auto_campaigns.') ? row.auto_campaigns?.[key.split('.')[1]] : row[key]
    globalThis.reportDb = createClient('https://fixture.invalid', 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (urlValue, options) => {
        const url = new URL(urlValue), p = url.searchParams, table = url.pathname.split('/').pop()
        assert.equal(url.hostname, 'fixture.invalid'); assert.equal(options.method, 'GET')
        let rows = ({ auto_accounts: accounts, auto_campaigns: campaigns, auto_campaign_input_data: inputs, auto_campaign_details: details })[table]
        assert.ok(rows, table)
        rows = rows.map(row => ({ ...row, ...(table === 'auto_campaign_input_data' ? { auto_campaigns: campaigns.find(c => c.id === row.campaign_id) } : {}) }))
        for (const [key, expression] of p) {
          if (['select', 'order', 'limit', 'offset'].includes(key)) continue
          const dot = expression.indexOf('.'), operator = expression.slice(0, dot), raw = expression.slice(dot + 1)
          rows = rows.filter(row => {
            const v = value(row, key)
            if (operator === 'eq') return String(v) === raw
            if (operator === 'in') return raw.slice(1, -1).split(',').map(x => x.replace(/^"|"$/g, '')).includes(String(v))
            if (operator === 'is') return raw === 'null' && v == null
            if (v == null) return false
            if (operator === 'gt') return Number(v) > Number(raw)
            if (operator === 'gte') return Date.parse(v) >= Date.parse(raw)
            if (operator === 'lt') return Date.parse(v) < Date.parse(raw)
            throw new Error(`Unsupported filter ${key} ${expression}`)
          })
        }
        rows.sort((a, b) => a.id - b.id)
        const total = rows.length
        rows = rows.slice(Number(p.get('offset') || 0), Number(p.get('offset') || 0) + Number(p.get('limit') || 1000))
        calls.push({ table, p, count: rows.length })
        if (table === 'auto_campaign_input_data') {
          assert.equal(p.get('auto_campaigns.staff_id'), 'eq.7')
          assert.equal(p.get('auto_campaigns.organization_id'), 'eq.9')
          assert.equal(p.get('auto_campaigns.is_delete'), 'eq.false')
          if (!p.get('select').includes('name')) {
            assert.ok(p.has('campaign_id'), 'root campaign scope prevents global pending scan')
            assert.ok(p.has('schedule'), 'date filter must happen before paging')
            assert.equal(p.has('offset'), false)
          }
          if (failPending) return new Response(JSON.stringify({ message: 'Fixture timeout' }), { status: 500 })
        }
        const single = new Headers(options.headers).get('accept')?.includes('vnd.pgrst.object')
        return new Response(JSON.stringify(single ? rows[0] : rows), { headers: { 'content-type': 'application/json', 'content-range': `0-${rows.length - 1}/${total}` } })
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
    console.log('PASS report summary/detail: scoped keyset paging, >1000 rows, date fallback, action matrix, errors and explicit retry; no live DB')
  } finally { rmSync(directory, { recursive: true, force: true }); delete globalThis.reportDb; delete globalThis.reportActions }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

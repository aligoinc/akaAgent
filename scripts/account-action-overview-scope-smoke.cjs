const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-overview-scope-'))
  const clock = { dbNow: '2035-01-01T17:30:00.000Z', vietnamDateKey: '2035-01-02' }
  const calls = []
  let clockCalls = 0
  let deniedCodes = []
  let denyPlatform = false
  let tables
  const reset = () => {
    calls.length = 0; clockCalls = 0; deniedCodes = []; denyPlatform = false
    tables = {
      auto_accounts: [{ id: 41, staff_id: 7, is_delete: false, flatform_type: 'facebook', rate_limit_minutes: 65,
        auto_account_groups: { settings: { byActionCode: { fb_comment: { rateLimitMinutes: 90 } } } } }],
      auto_account_actions: [
        ['fb_post_group', 'facebook'], ['fb_comment', 'facebook'], ['fb_like_post', 'facebook'],
        ['zalo_tag_contact', 'zalo'], ['zalo_change_alias', 'zalo'], ['voice_call', 'sms']
      ].map(([code, flatform_type], index) => ({ id: index + 1, code, name: code, flatform_type, is_active: true, is_delete: false })),
      auto_account_action_status: ['fb_post_group', 'fb_comment', 'fb_like_post'].map((action_code, index) => ({
        id: index + 1, account_id: 41, action_code, count_date: clock.vietnamDateKey,
        count_action_in_day: 12, is_disable: true, date_enable: '2035-01-03T00:00:00Z'
      })),
      auto_campaign_details: [
        [41, 'fb_comment', '2035-01-01T16:00:00.000Z', true, 'lỗi'], // inclusive group window boundary
        [41, 'fb_comment', clock.dbNow, null, 'thành công'],
        [41, 'fb_comment', clock.dbNow, null, 'thất bại'],
        [41, 'fb_comment', clock.dbNow, null, 'lỗi'],
        [41, 'fb_comment', clock.dbNow, false, 'thành công'],
        [41, 'fb_comment', '2035-01-01T15:59:59.999Z', true, 'thành công'],
        [42, 'fb_comment', clock.dbNow, true, 'thành công'],
        [41, 'voice_call', clock.dbNow, null, 'lỗi']
      ].map(([account_id, action_code, created_at, counts_toward_limit, status]) =>
        ({ account_id, action_code, created_at, counts_toward_limit, status }))
    }
  }
  // Use the real PostgREST client, with a local transport that records every URL/body.
  const client = createClient('http://127.0.0.1:54321', 'fixture-only', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, options = {}) => {
      const url = new URL(String(input))
      const table = url.pathname.split('/').pop()
      const method = options.method || 'GET'
      const body = options.body ? JSON.parse(options.body) : undefined
      calls.push({ table, method, params: url.searchParams, body })
      if (url.pathname.includes('/rpc/')) {
        assert.equal(table, 'enable_due_auto_account_actions', 'existing due-unlock maintenance only')
        return new Response('null', { status: 200 })
      }
      assert.ok(tables[table], `Unexpected table ${table}`)
      const matches = row => [...url.searchParams].every(([field, filter]) => {
        if (['select', 'order', 'on_conflict'].includes(field)) return true
        const dot = filter.indexOf('.')
        const op = filter.slice(0, dot), value = filter.slice(dot + 1)
        if (op === 'eq') return String(row[field]) === value
        if (op === 'is') return value === 'null' && row[field] == null
        if (op === 'in') return value.slice(1, -1).split(',').map(v => v.replace(/^"|"$/g, '')).includes(String(row[field]))
        if (op === 'lt') return row[field] < value
        if (op === 'gte') return row[field] >= value
        throw new Error(`Unexpected filter ${filter}`)
      })
      if (method === 'POST') {
        for (const row of body) {
          if (!tables[table].some(old => old.account_id === row.account_id && old.action_code === row.action_code)) {
            tables[table].push({ id: 100 + tables[table].length, is_disable: false, ...row })
          }
        }
        return new Response(null, { status: 201 })
      }
      if (method === 'PATCH') {
        tables[table].filter(matches).forEach(row => Object.assign(row, body))
        return new Response(null, { status: 204 })
      }
      const rows = tables[table].filter(matches)
      if (method === 'HEAD') {
        assert.equal(table, 'auto_campaign_details')
        return new Response(null, { headers: { 'content-range': `0-0/${rows.length}` } })
      }
      return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } })
    } }
  })
  globalThis.overviewScopeMock = {
    client, clock: () => { clockCalls++; return clock },
    allowedAction: code => !deniedCodes.includes(code), allowedPlatform: () => !denyPlatform
  }
  const stubs = {
    supabaseClient: 'export const getSupabaseClient = () => globalThis.overviewScopeMock.client',
    accountRepository: 'export const getAccount = async () => ({id:41})',
    currentUser: 'export const requireCurrentUser = () => ({staffId:7}); export const getCurrentUser = requireCurrentUser',
    runtimeClockRepository: 'export const getDatabaseRuntimeClock = async () => globalThis.overviewScopeMock.clock(); export const parseDatabaseRuntimeClock = x => x',
    entitlementRepository: `export const canUseAccountActionWithEntitlements = code => globalThis.overviewScopeMock.allowedAction(code);
      export const canUseAccountPlatformWithEntitlements = () => globalThis.overviewScopeMock.allowedPlatform();
      export const emptyAuthEntitlements = () => ({}); export const loadCurrentUserEffectiveEntitlements = async () => ({})`
  }
  try {
    const output = join(directory, 'repository.cjs')
    await build({ entryPoints: [resolve(__dirname, '../src/main/data/repositories/accountActionRepository.ts')], outfile: output,
      bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning', plugins: [{ name: 'overview-scope-fixture', setup(plugin) {
        plugin.onResolve({ filter: /(?:supabaseClient|accountRepository|currentUser|runtimeClockRepository|entitlementRepository)$/ }, args =>
          ({ path: args.path.split('/').pop(), namespace: 'fixture' }))
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }))
      } }] })
    const { listAccountActionOverview: overview } = require(output)
    const counts = () => calls.filter(c => c.table === 'auto_campaign_details')
    const statuses = () => calls.filter(c => c.table === 'auto_account_action_status')
    const catalog = () => calls.find(c => c.table === 'auto_account_actions')

    reset()
    const scoped = await overview(41, ['fb_comment', 'fb_comment'])
    assert.deepEqual(scoped.map(row => row.action.code), ['fb_comment'])
    assert.equal(scoped[0].windowActionCount, 3, 'retain explicit/legacy, account and time boundaries')
    assert.equal(scoped[0].windowMinutes, 90, 'retain account-group window')
    assert.equal(scoped[0].status.isDisable, true, 'retain unlock state')
    assert.equal(scoped[0].status.countActionInDay, 12)
    assert.equal(catalog().params.get('code'), 'in.(fb_comment)', 'filter the catalog on the server')
    assert.equal(statuses()[0].params.get('action_code'), 'in.(fb_comment)')
    assert.equal(counts().length, 2, 'only two count requests for one unique displayed action')
    for (const call of counts()) {
      assert.equal(call.method, 'HEAD'); assert.equal(call.params.get('action_code'), 'eq.fb_comment')
      assert.equal(call.params.get('account_id'), 'eq.41')
    }

    reset()
    assert.equal((await overview(41)).length, 3, 'full account view stays compatible')
    assert.equal(catalog().params.has('code'), false)
    assert.equal(counts().length, 6)

    reset()
    assert.deepEqual(await overview(41, []), [])
    assert.equal(calls.length, 0); assert.equal(clockCalls, 0, 'empty scope does no work')
    for (const bad of [null, 'fb_comment', [''], [1], ['a,b'], Array(33).fill('fb_comment')]) {
      await assert.rejects(overview(41, bad), /không hợp lệ/)
    }
    await assert.rejects(overview(-1, ['fb_comment']), /không hợp lệ/)
    assert.equal(calls.length, 0, 'invalid input cannot widen the query')

    reset()
    tables.auto_account_actions[1].is_active = false
    tables.auto_account_actions[2].is_delete = true
    assert.deepEqual(await overview(41, ['missing_code', 'zalo_tag_contact', 'fb_comment', 'fb_like_post']), [])
    assert.equal(statuses().length, 0); assert.equal(counts().length, 0); assert.equal(clockCalls, 0)

    reset()
    deniedCodes = ['fb_comment']
    assert.deepEqual(await overview(41, ['fb_comment']), [])
    assert.equal(statuses().length, 0); assert.equal(counts().length, 0)
    reset()
    denyPlatform = true
    assert.deepEqual(await overview(41, ['fb_comment']), [])
    assert.equal(catalog(), undefined); assert.equal(counts().length, 0)
    reset()
    tables.auto_accounts[0].staff_id = 8
    await assert.rejects(overview(41, ['fb_comment']), /Không tìm thấy/)
    assert.equal(calls.length, 1, 'ownership checked before maintenance, catalog or counts')

    reset()
    tables.auto_account_action_status[0].count_date = '2035-01-01'
    tables.auto_account_action_status[1].count_date = '2035-01-01'
    await overview(41, ['fb_comment'])
    assert.equal(tables.auto_account_action_status[0].count_action_in_day, 12, 'hidden stale status is untouched')
    assert.equal(tables.auto_account_action_status[1].count_action_in_day, 0)
    assert.equal(statuses().find(c => c.method === 'PATCH').params.get('id'), 'in.(2)')

    reset()
    tables.auto_account_action_status = []
    await overview(41, ['fb_comment'])
    assert.deepEqual(statuses().find(c => c.method === 'POST').body.map(row => row.action_code), ['fb_comment'])
    assert.equal(counts().length, 2)

    reset()
    tables.auto_account_action_status[1].count_date = '2035-01-03'
    await assert.rejects(overview(41, ['fb_comment']), /ahead of DB/)
    assert.equal(counts().length, 0)
    assert.ok(statuses().every(c => c.method === 'GET'))

    reset()
    tables.auto_accounts[0].flatform_type = 'zalo'
    assert.deepEqual((await overview(41, ['zalo_tag_contact', 'zalo_change_alias'])).map(row => row.action.code), ['zalo_tag_contact', 'zalo_change_alias'])
    assert.equal(counts().length, 4)
    reset()
    tables.auto_accounts[0].flatform_type = 'sms'
    const [voice] = await overview(41, ['voice_call'])
    assert.equal(voice.windowMinutes, 60); assert.equal(voice.windowActionCount, 1, 'retain mobile legacy counting')
    console.log('PASS scoped overview: server catalog/status filters; 2 count queries per visible action; full/empty/invalid scopes; ownership/entitlements; scoped rollover/create; DB clock; Zalo auxiliaries; voice legacy semantics.')
  } finally {
    delete globalThis.overviewScopeMock
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })

const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'campaign-account-snapshot-'))
  const clock = { dbNow: '2035-01-01T17:30:00Z', vietnamDateKey: '2035-01-02' }
  const calls = [], listeners = new Set()
  let tables, user, failStatus, changeSession, deniedCodes, deniedAccounts, clockCalls, clockReader
  const reset = () => {
    calls.length = 0; clockCalls = 0; failStatus = false; changeSession = false
    clockReader = () => clock
    deniedCodes = []; deniedAccounts = false
    user = { staffId: 7, organizationId: 9, chatWebSessionId: 'session-a' }
    tables = {
      auto_account_actions: [['fb_comment', 'facebook'], ['fb_like_post', 'facebook'], ['zalo_add_friend', 'zalo']]
        .map(([code, flatform_type]) => ({ code, flatform_type, is_active: true, is_delete: false })),
      auto_accounts: [
        { id: 1 }, { id: 2 }, { id: 3, staff_id: 8 }, { id: 4, organization_id: 8 },
        { id: 5, is_delete: true }, { id: 6, flatform_type: 'zalo', is_zalo_server: true },
        { id: 7, flatform_type: 'zalo' }
      ].map(row => ({ staff_id: 7, organization_id: 9, is_delete: false, flatform_type: 'facebook', ...row })),
      auto_account_action_status: [
        { account_id: 1, action_code: 'fb_comment', count_action_in_day: 128 },
        { account_id: 1, action_code: 'fb_like_post', count_action_in_day: 150, is_disable: true, date_enable: '2035-01-01T17:48:00Z' },
        { account_id: 2, action_code: 'fb_comment', count_action_in_day: 99, count_date: '2035-01-01', is_disable: true },
        { account_id: 7, action_code: 'zalo_add_friend', count_action_in_day: 30, is_disable: true, date_enable: clock.dbNow }
      ].map(row => ({ count_date: clock.vietnamDateKey, is_disable: false, date_enable: null, ...row }))
    }
  }
  const client = createClient('http://127.0.0.1:54321', 'offline-fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, options = {}) => {
      const url = new URL(String(input)), table = url.pathname.split('/').pop()
      assert.ok(tables[table], `Unexpected table/RPC ${table}`)
      assert.equal(options.method || 'GET', 'GET', 'only SELECT, no writes/count HEADs')
      calls.push({ table, params: url.searchParams })
      if (table === 'auto_account_action_status') {
        if (changeSession) { changeSession = false; user = { ...user, chatWebSessionId: 'session-b' }; listeners.forEach(fn => fn()) }
        if (failStatus) return new Response(JSON.stringify({ message: 'fixture offline' }), { status: 400 })
      }
      const rows = tables[table].filter(row => [...url.searchParams].every(([field, expression]) => {
        if (field === 'select') return true
        const index = expression.indexOf('.'), op = expression.slice(0, index), value = expression.slice(index + 1)
        if (op === 'eq') return String(row[field]) === value
        if (op === 'in') return value.slice(1, -1).split(',').map(v => v.replace(/^"|"$/g, '')).includes(String(row[field]))
        throw new Error(`Unknown filter ${expression}`)
      }))
      if (table === 'auto_account_action_status') assert.ok(rows.length <= 500, 'bounded response fits the row cap')
      const columns = url.searchParams.get('select').split(',')
      return new Response(JSON.stringify(rows.map(row => Object.fromEntries(columns.map(column => [column, row[column]])))),
        { headers: { 'content-type': 'application/json' } })
    } }
  })
  globalThis.snapshotFixture = {
    client, user: () => user, clock: () => { clockCalls++; return clockReader() },
    onSession: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    actionAllowed: code => !deniedCodes.includes(code),
    accountAllowed: account => !deniedAccounts && !account.isZaloServer
  }
  const stubs = {
    supabaseClient: 'export const getSupabaseClient = () => globalThis.snapshotFixture.client',
    currentUser: 'export const requireCurrentUser = () => globalThis.snapshotFixture.user(); export const onCurrentUserSessionChanged = fn => globalThis.snapshotFixture.onSession(fn)',
    runtimeClockRepository: 'export const getDatabaseRuntimeClock = async () => globalThis.snapshotFixture.clock()',
    entitlementRepository: `export const loadCurrentUserEffectiveEntitlements = async () => ({});
      export const loadCurrentUserZaloAccountCapabilities = () => ({});
      export const canUseAccountActionWithEntitlements = code => globalThis.snapshotFixture.actionAllowed(code);
      export const canUseAccountWithEntitlementsAndCapabilities = account => globalThis.snapshotFixture.accountAllowed(account)`
  }
  try {
    const output = join(directory, 'repository.cjs')
    await build({ entryPoints: [resolve(__dirname, '../src/main/data/repositories/campaignAccountActionSnapshotRepository.ts')],
      outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning', plugins: [{ name: 'snapshot-fixture', setup(plugin) {
        plugin.onResolve({ filter: /(?:supabaseClient|currentUser|runtimeClockRepository|entitlementRepository)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'fixture' }))
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }))
      } }] })
    const { getCampaignAccountActionSnapshot: read } = require(output)
    const scope = [{ accountIds: [1, 2, 3, 4, 5, 6, 7], actionCodes: ['fb_comment', 'fb_like_post', 'zalo_add_friend'] }]
    reset()
    const snapshot = await read(scope)
    assert.deepEqual(snapshot.accounts.map(row => row.accountId), [1, 2, 7], 'tenant, staff, deleted and capability guards')
    const row = (id, code) => snapshot.accounts.find(account => account.accountId === id).actions.find(action => action.actionCode === code)
    assert.deepEqual(row(1, 'fb_comment'), { actionCode: 'fb_comment', dailyActionCount: 128, isDisable: false, remainingMinutes: null })
    assert.equal(row(1, 'fb_like_post').remainingMinutes, 18)
    assert.deepEqual(row(2, 'fb_comment'), { actionCode: 'fb_comment', dailyActionCount: 0, isDisable: true, remainingMinutes: null }, 'stale day resets display only; preserve indefinite disable')
    assert.equal(row(2, 'fb_like_post').dailyActionCount, 0, 'missing row is normal zero only after successful scoped read')
    assert.equal(row(7, 'zalo_add_friend').isDisable, false, 'due cooldown follows database time without writes')
    assert.equal(tables.auto_account_action_status[2].count_action_in_day, 99)
    assert.equal(tables.auto_account_action_status[3].is_disable, true)
    assert.equal(clockCalls, 1)
    assert.equal(calls.length, 4, 'one catalog, one account batch, two platform status batches')
    assert.equal(calls.find(call => call.table === 'auto_accounts').params.get('select'), 'id,flatform_type,is_zalo_show_web,is_zalo_server')
    for (const query of calls.filter(call => call.table === 'auto_account_action_status')) {
      assert.equal(query.params.get('select'), 'account_id,action_code,count_action_in_day,count_date,is_disable,date_enable')
      assert.ok(query.params.get('account_id')); assert.ok(query.params.get('action_code'))
    }
    reset(); assert.deepEqual(await read([]), { capturedAt: null, accounts: [] }); await read([{ accountIds: [1], actionCodes: [] }]); await read([{ accountIds: [], actionCodes: ['fb_comment'] }]); assert.equal(calls.length, 0)
    for (const value of [null, {}, [{ accountIds: [-1], actionCodes: [] }], [{ accountIds: [1], actionCodes: ['bad,or='] }], [{ accountIds: [1], actionCodes: Array(33).fill('fb_comment') }]]) await assert.rejects(read(value), /không hợp lệ/)
    assert.equal(calls.length, 0)
    reset(); deniedCodes = ['fb_like_post']; const restricted = await read(scope)
    assert.ok(restricted.accounts.every(account => account.actions.every(action => action.actionCode !== 'fb_like_post')))
    assert.ok(calls.filter(call => call.table === 'auto_account_action_status').every(call => !call.params.get('action_code').includes('fb_like_post')))
    reset(); deniedAccounts = true; assert.equal((await read(scope)).accounts.length, 0); assert.equal(clockCalls, 0)
    reset(); tables.auto_account_action_status[0].count_date = '2035-01-03'; await assert.rejects(read(scope), /vượt quá/)
    reset(); tables.auto_account_action_status[1].date_enable = 'invalid'; assert.equal((await read(scope)).accounts[0].actions[1].remainingMinutes, null)
    reset(); failStatus = true; await assert.rejects(read(scope), /fixture offline/); assert.equal(calls.filter(call => call.table === 'auto_account_action_status').length, 1, 'no retry or later batch after failure')
    reset(); changeSession = true; await assert.rejects(read(scope)); assert.equal(listeners.size, 0, 'unsubscribe even after session abort')
    // The DB clock is shared: settle the form's wait promptly, but leave other callers intact.
    for (const cause of ['timeout', 'session']) {
      reset()
      let resolveClock, rejectClock, enteredClock, watchdog
      const clockStarted = new Promise(resolve => { enteredClock = resolve })
      const pendingClock = new Promise((resolve, reject) => { resolveClock = resolve; rejectClock = reject })
      const independentWait = pendingClock.then(value => ({ value }), error => ({ error }))
      clockReader = () => { enteredClock(); return pendingClock }
      const request = read(scope).then(value => ({ value }), error => ({ error }))
      try {
        await clockStarted
        if (cause === 'session') {
          user = { ...user, chatWebSessionId: 'session-b' }
          listeners.forEach(listener => listener())
        }
        const outcome = await Promise.race([request, new Promise((_, reject) => {
          watchdog = setTimeout(() => reject(new Error(`${cause}: form still waiting for DB clock`)), cause === 'timeout' ? 17_000 : 1_000)
        })])
        assert.equal(outcome.error?.name, 'AbortError', `${cause} rejects before the clock returns`)
        assert.equal(listeners.size, 0, 'session listener is cleaned up while clock is pending')
        assert.equal(clockCalls, 1, 'no separate clock request or retry')
        assert.equal(calls.filter(call => call.table === 'auto_account_action_status').length, 0)
        if (cause === 'timeout') {
          resolveClock(clock)
          assert.deepEqual(await independentWait, { value: clock }, 'another clock consumer can still complete')
        } else {
          const lateError = new Error('late shared-clock failure')
          rejectClock(lateError)
          assert.deepEqual(await independentWait, { error: lateError })
        }
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(calls.filter(call => call.table === 'auto_account_action_status').length, 0, 'late clock completion cannot resume the aborted snapshot')
      } finally {
        clearTimeout(watchdog)
        resolveClock(clock)
        await request
      }
    }
    reset(); const codes = Array.from({ length: 32 }, (_, index) => `fb_test_${index}`)
    tables.auto_account_actions = codes.map(code => ({ code, flatform_type: 'facebook', is_active: true, is_delete: false }))
    tables.auto_accounts = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, staff_id: 7, organization_id: 9, is_delete: false, flatform_type: 'facebook' }))
    tables.auto_account_action_status = tables.auto_accounts.flatMap(account => codes.map(action_code => ({ account_id: account.id, action_code, count_date: clock.vietnamDateKey, count_action_in_day: account.id, is_disable: false })))
    const large = await read([{ accountIds: tables.auto_accounts.map(row => row.id), actionCodes: codes }])
    assert.equal(large.accounts.length, 101); assert.equal(large.accounts.at(-1).actions.at(-1).dailyActionCount, 101)
    assert.equal(calls.filter(call => call.table === 'auto_accounts').length, 2)
    assert.equal(calls.filter(call => call.table === 'auto_account_action_status').length, 7)
    assert.equal(listeners.size, 0)
    console.log('PASS snapshot repository: real PostgREST URLs, minimal projection, read-only, ownership/capability, missing/stale/future days, timed/indefinite/expired cooldowns, real 15-second clock deadline/session abort/late completion, no retry/history counts, 3,232 rows without truncation.')
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

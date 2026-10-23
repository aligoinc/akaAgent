// Real IPC/repository callbacks and PostgREST client; offline transport only.
// Run: node scripts/account-mutation-status-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')
const root = path.resolve(__dirname, '..')
const read = file => ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
const repoSource = read('src/main/data/repositories/accountRepository.ts')
const ipcSource = read('src/main/ipc/handlers/accountHandlers.ts')
const repoCode = ['getAccountIgnoringCapability', 'getAccount', 'updateAccount', 'deleteAccount'].map(name =>
  repoSource.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(repoSource)
).join('\n')
const callbacks = {}
function visit(n) {
  if (ts.isCallExpression(n) && n.expression.getText(ipcSource) === 'ipcMain.handle') {
    const name = n.arguments[0].getText(ipcSource)
    if (['IPC_EVENTS.DB_UPDATE_ACCOUNT', 'IPC_EVENTS.DB_DELETE_ACCOUNT'].includes(name)) callbacks[name] = n.arguments[1].getText(ipcSource)
  }
  ts.forEachChild(n, visit)
}
visit(ipcSource)
const compile = code => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText

function fixture(status = 'chờ xử lý') {
  const state = {
    row: { id: 41, staff_id: 7, flatform_type: 'facebook', is_zalo_server: false, is_zalo_show_web: false,
      name: 'Offline', status, is_active: true, is_delete: false },
    calls: [], effects: [], allowed: true, beforePatch: null, patchError: false
  }
  const client = createClient('http://127.0.0.1:54321', 'fixture-only', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, options) => {
      const url = new URL(String(input)), method = options.method || 'GET'
      assert.equal(url.pathname, '/rest/v1/auto_accounts', 'No additional tables or RPCs')
      state.calls.push({ method, params: url.searchParams })
      if (method === 'PATCH') {
        state.beforePatch?.()
        if (state.patchError) return new Response(JSON.stringify({ message: 'offline write failure' }), { status: 500 })
      }
      const row = state.row
      const matchesTerm = term => {
        const [key, op, ...parts] = term.split('.')
        const value = parts.join('.')
        if (op === 'is') return value === 'null' && row[key] == null
        if (op === 'eq') return String(row[key]) === value
        if (op === 'neq') return row[key] != null && String(row[key]) !== value
        throw new Error(`Unexpected filter: ${term}`)
      }
      const matches = row && [...url.searchParams].every(([key, value]) => {
        if (key === 'select') return true
        if (key === 'or') return value.slice(1, -1).split(',').some(matchesTerm)
        return matchesTerm(`${key}.${value}`)
      })
      if (method === 'PATCH' && matches) {
        Object.assign(row, JSON.parse(options.body))
        state.effects.push('write')
      }
      const headers = new Headers(options.headers)
      if (headers.get('Accept') === 'application/vnd.pgrst.object+json') {
        if (!matches) return new Response(JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'No rows' }), { status: 406 })
        return new Response(JSON.stringify(row), { status: 200 })
      }
      return new Response(JSON.stringify(matches ? [row] : []), { status: 200 })
    } }
  })
  const map = row => ({ ...row, flatformType: row.flatform_type, isActive: row.is_active,
    isZaloServer: row.is_zalo_server, isZaloShowWeb: row.is_zalo_show_web })
  const context = {
    exports: {}, client: () => client, requireCurrentUser: () => ({ staffId: 7 }), ACCOUNT_SELECT: '*',
    mapAccountFromDB: map, toDbRow: row => row, rememberAccountLogSnapshot: row => row, recordAccountState: row => row,
    loadCurrentUserEffectiveEntitlements: async () => ({}), loadCurrentUserZaloAccountCapabilities: () => ({}),
    canUseAccountWithEntitlementsAndCapabilities: () => state.allowed,
    ensureCurrentUserCanUseAccountPlatform: async () => {}, ensureCurrentUserCanUseZaloAccountType: async () => {},
    ACCOUNT_RUNNING_MUTATION_REASON: 'Tài khoản đang chạy. Vui lòng tạm dừng trước khi xoá hoặc vô hiệu hoá.',
    preemptWebEnrichment: () => state.effects.push('preempt'),
    webviewRegistry: { isRegistered: () => true, unregister: () => state.effects.push('unregister') },
    shouldRouteZaloAccountToChatApi: () => false,
    zaloRuntime: { invalidateAccount: () => state.effects.push('invalidate'), detachWebSession: () => state.effects.push('detach') }
  }
  vm.createContext(context)
  vm.runInContext(compile(repoCode), context)
  context.supabase = context.exports
  vm.runInContext(compile(`var remove = ${callbacks['IPC_EVENTS.DB_DELETE_ACCOUNT']}; var update = ${callbacks['IPC_EVENTS.DB_UPDATE_ACCOUNT']}`), context)
  return { state, remove: () => context.remove(null, 41), disable: () => context.update(null, 41, { isActive: false, status: 'tạm dừng' }),
    update: patch => context.update(null, 41, patch), repository: context.exports }
}

async function main() {
  let count = 0
  const test = async (name, run) => { await run(); count++; console.log(`PASS ${name}`) }
  for (const action of ['remove', 'disable']) {
    await test(`${action}: running rejected before writes/cleanup`, async () => {
      const f = fixture('đang chạy')
      await assert.rejects(f[action](), /Tài khoản đang chạy/)
      assert.deepEqual(f.state.effects, [])
    })
    await test(`${action}: starts running immediately before PATCH`, async () => {
      const f = fixture()
      f.state.beforePatch = () => { f.state.row.status = 'đang chạy' }
      await assert.rejects(f[action](), /Tài khoản đang chạy/)
      assert.equal(f.state.row.is_delete, false)
      assert.equal(f.state.row.is_active, true)
      assert.equal(f.state.row.status, 'đang chạy')
      assert.deepEqual(f.state.effects, [])
      assert.equal(f.state.calls.filter(c => c.method === 'PATCH').length, 1)
    })
    await test(`${action}: capability-filtered null rejected`, async () => {
      const f = fixture('đang chạy'); f.state.allowed = false
      await assert.rejects(f[action](), /Không tìm thấy tài khoản/)
      assert.equal(f.state.row.is_delete, false)
      assert.equal(f.state.calls.length, 1)
      assert.deepEqual(f.state.effects, [])
    })
    await test(`${action}: account disappears before PATCH`, async () => {
      const f = fixture(); f.state.beforePatch = () => { f.state.row = null }
      await assert.rejects(f[action](), /không còn khả dụng/)
      assert.deepEqual(f.state.effects, [])
    })
    await test(`${action}: ownership changes before PATCH`, async () => {
      const f = fixture(); f.state.beforePatch = () => { f.state.row.staff_id = 8 }
      await assert.rejects(f[action](), /không còn khả dụng/)
      assert.deepEqual(f.state.effects, [])
    })
    await test(`${action}: failed PATCH does not clean up`, async () => {
      const f = fixture(); f.state.patchError = true
      await assert.rejects(f[action](), /offline write failure/)
      assert.deepEqual(f.state.effects, [])
    })
    for (const status of ['tạm dừng', 'chờ xử lý', 'giới hạn giờ', 'lỗi', null]) {
      await test(`${action}: ${status} allowed, cleanup follows write`, async () => {
        const f = fixture(status)
        await f[action]()
        assert.equal(f.state.effects[0], 'write')
        assert.equal(f.state.effects[1], 'preempt')
        assert.equal(action === 'remove' ? f.state.row.is_delete : !f.state.row.is_active, true)
      })
    }
  }
  await test('direct repository calls also reject running accounts', async () => {
    const f = fixture('đang chạy')
    await assert.rejects(f.repository.deleteAccount(41), /Tài khoản đang chạy/)
    await assert.rejects(f.repository.updateAccount(41, { isActive: false }), /Tài khoản đang chạy/)
    assert.deepEqual(f.state.effects, [])
  })
  for (const patch of [{ status: 'tạm dừng' }, { name: 'Renamed' }, { isActive: true }]) {
    await test(`ordinary update remains allowed: ${JSON.stringify(patch)}`, async () => {
      const f = fixture('đang chạy'); await f.update(patch)
      assert.ok(f.state.effects.includes('write'))
      assert.equal(f.state.calls.find(c => c.method === 'PATCH').params.has('or'), false)
    })
  }
  console.log(`PASS ${count} account mutation cases; no network, production data or schema changes.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })

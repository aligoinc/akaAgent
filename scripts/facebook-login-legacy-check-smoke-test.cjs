const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const IPC_EVENTS = new Proxy({}, { get: (_, key) => key })
function load(file, stubs, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: name => {
    assert(Object.hasOwn(stubs, name), `Unexpected dependency: ${name}`)
    return stubs[name]
  }, console: { ...console, log() {} }, setTimeout, clearTimeout, ...globals }, { filename: file })
  return exports
}
function page({ cookie = '', checkpoint = false, url = 'https://www.facebook.com/', fail = false } = {}) {
  return { scripts: [], getURL: () => url, isDestroyed: () => false,
    async executeJavaScript(script) {
      this.scripts.push(script)
      if (fail) throw Error('Legacy page unavailable')
      // Execute the actual legacy snippet, preserving cookie-before-checkpoint precedence.
      return vm.runInNewContext(script, { document: { cookie, querySelector(selector) {
        assert.equal(selector, '#checkpoint_title', 'No new DOM selector is introduced')
        return checkpoint ? {} : null
      } }, window: { location: { href: url } } })
    }
  }
}
const account = (id, managed, loginStatus = 'chưa đăng nhập') => ({ id, staffId: 1, flatformType: 'facebook',
  facebookLoginManaged: managed, loginStatus })

async function manualChecks() {
  const handlers = new Map(), writes = [], automatic = []
  const accounts = new Map([
    [1, account(1, undefined)], [2, account(2, false)], [3, account(3, false, 'đã đăng nhập')],
    [4, account(4, false)], [5, account(5, true)], [6, account(6, false)], [7, account(7, false)]
  ])
  const pages = new Map([
    [1, page({ cookie: 'c_user=111; xs=fixture', checkpoint: true })],
    [2, page({ checkpoint: true })], [3, page()], [6, page({ fail: true })]
  ])
  const service = { async checkAccount(id) { automatic.push(id); return { loggedIn: true, status: 'đã đăng nhập' } } }
  const { registerAccountHandlers } = load('src/main/ipc/handlers/accountHandlers.ts', {
    electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, webContents: { fromId: id => pages.get(id) } },
    '../../../shared/types': { IPC_EVENTS }, '../../data/repositories/entitlementRepository': {}
  })
  registerAccountHandlers({ getAccount: async id => accounts.get(id), updateAccount: async (id, value) => writes.push({ id, ...value }) },
    { getWebContentsId: id => pages.has(id) || id === 7 ? id : undefined }, {},
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, service)
  const check = handlers.get(IPC_EVENTS.ACCOUNT_CHECK_FB_LOGIN)
  assert.equal((await check({}, 1)).loggedIn, true)
  assert.equal((await check({}, 2)).status, 'checkpoint')
  assert.equal((await check({}, 3)).status, 'chưa đăng nhập')
  assert.equal((await check({}, 4)).reason, 'Tab trình duyệt chưa được mở')
  assert.equal((await check({}, 7)).reason, 'Tab trình duyệt không khả dụng')
  assert.equal((await check({}, 6)).reason, 'Legacy page unavailable')
  assert.equal((await check({}, 6)).status, 'chưa đăng nhập')
  assert.deepEqual(writes, [{ id: 1, loginStatus: 'đã đăng nhập' }, { id: 2, loginStatus: 'checkpoint' }, { id: 3, loginStatus: 'chưa đăng nhập' }])
  assert.equal(automatic.length, 0, 'Manual/old accounts never call the automatic login verifier')
  assert.equal((await check({}, 5)).loggedIn, true, 'Imported accounts can still verify without a tab')
  assert.deepEqual(automatic, [5])
  service.checkAccount = async () => { throw Error('New verifier unavailable') }
  assert.equal((await check({}, 1)).loggedIn, true, 'New verifier failure must not affect legacy checks')
  assert.equal((await check({}, 5)).status, 'chưa xác minh')
}

async function pollingChecks() {
  let tick, recoveries = 0, failAutomatic = true, loggingIn = null
  const writes = [], automatic = [], events = []
  const accounts = [account(10, true), account(1, undefined), account(2, false), account(3, false, 'đã đăng nhập'), account(4, false)]
  const pages = new Map([
    [10, { isDestroyed: () => false, executeJavaScript: () => assert.fail('Imported accounts must not use legacy DOM checks') }],
    [1, page({ cookie: 'c_user=111; xs=fixture' })], [2, page({ checkpoint: true })],
    [3, page()], [4, page({ url: 'https://example.test/' })]
  ])
  const { startAccountPoller } = load('src/main/domain/accounts/accountPoller.ts', {
    electron: { webContents: { fromId: id => pages.get(id) } }, '../../../shared/types': { IPC_EVENTS },
    '../../data/currentUser': { getCurrentUser: () => ({ staffId: 1 }) },
    '../../data/repositories/accountRepository': { listAccounts: async () => accounts, updateAccount: async (id, value) => {
      writes.push({ id, ...value }); Object.assign(accounts.find(a => a.id === id), value)
    } },
    '../../data/repositories/zaloRuntimeModeRepository': { getZaloRuntimeRestartRequired: () => false, isZaloLocalStartupHandoffBlocked: () => false }
  }, { setInterval(fn, ms) { assert.equal(ms, 30000); tick = fn } })
  startAccountPoller({ listRegistered: () => accounts.map(a => ({ accountId: a.id, connected: true })), getWebContentsId: id => id },
    { webContents: { send: event => events.push(event) } }, undefined,
    { isLoggingIn: id => id === loggingIn, recoverPending() { recoveries++ }, async observe(a) { assert.equal(a.facebookLoginManaged, true); automatic.push(a.id); if (failAutomatic) throw Error('HTTP failed'); return false } })
  await tick()
  assert.deepEqual(writes, [{ id: 1, loginStatus: 'đã đăng nhập' }, { id: 2, loginStatus: 'checkpoint' }, { id: 3, loginStatus: 'chưa đăng nhập' }])
  assert.deepEqual(automatic, [10]); assert.equal(recoveries, 1); assert.equal(events.length, 1)
  failAutomatic = false; await tick()
  assert.equal(writes.length, 3, 'Unchanged legacy state causes no extra write')
  assert.equal(pages.get(1).scripts.length, 2, 'The existing 30-second legacy check still runs')
  assert.equal(pages.get(4).scripts.length, 0)
  assert.equal(recoveries, 2)
  loggingIn = 1; await tick()
  assert.equal(pages.get(1).scripts.length, 2, 'Explicit login owns manual account checks until it finishes')
  loggingIn = null; await tick()
  assert.equal(pages.get(1).scripts.length, 3, 'Legacy check resumes after failed explicit login')
}
Promise.all([manualChecks(), pollingChecks()]).then(() => {
  console.log('PASS legacy Facebook login checks: old/manual accounts keep existing cookie/DOM rules, no new selectors/HTTP dependency, unchanged state skips DB write, imported accounts retain HTTP verification and recovery')
}).catch(error => { console.error(error); process.exitCode = 1 })

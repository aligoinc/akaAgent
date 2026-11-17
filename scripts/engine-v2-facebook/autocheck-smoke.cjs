// Vá AutoCheck (Q6, 16/11/2026): tài khoản Facebook đang "checkpoint" còn cookie c_user không bị nâng về "đã đăng nhập" theo cookie; chỉ
// nâng khi hỏi thẳng Facebook thấy đã hết checkpoint, tối đa 5 phút một lần. Tài khoản khác giữ nguyên cách kiểm cũ.
// Chạy: node scripts/engine-v2-facebook/autocheck-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const ROOT = path.resolve(__dirname, '../..')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

const STUBS = {
  electron: `module.exports = { webContents: { fromId: id => globalThis.__ac.wcs.get(id) || null }, BrowserWindow: function () {} }`,
  accountRepository: `module.exports = { updateAccount: async (id, patch) => { globalThis.__ac.updates.push([id, patch.loginStatus]) }, listAccounts: async () => [] }`,
  currentUser: `module.exports = { getCurrentUser: () => ({ staffId: 1 }) }`,
  zaloRuntimeModeRepository: `module.exports = { getZaloRuntimeRestartRequired: () => false, isZaloLocalStartupHandoffBlocked: () => false }`,
  accountOperationRegistry: `module.exports = { accountOperationRegistry: { has: () => false } }`
}

async function main() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-autocheck-'))
  const outfile = path.join(out, 'poller.cjs')
  await build({ entryPoints: [path.join(ROOT, 'src/main/domain/accounts/accountPoller.ts')], outfile, bundle: true, platform: 'node', format: 'cjs',
    logLevel: 'error', plugins: [{ name: 'ac', setup(plugin) {
      plugin.onResolve({ filter: /^electron$|(\/accountRepository|\/currentUser|\/zaloRuntimeModeRepository|\/accountOperationRegistry)$/ },
        args => ({ path: args.path === 'electron' ? 'electron' : args.path.split('/').pop(), namespace: 'stub' }))
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: STUBS[args.path], loader: 'js' }))
    } }] })
  const { checkFacebookWebviewAccounts } = require(outfile)
  try {
    const wc = { isDestroyed: () => false, getURL: () => 'https://www.facebook.com/', executeJavaScript: async () => ({ loggedIn: true }) }
    globalThis.__ac = { wcs: new Map([[11, wc], [12, wc]]), updates: [] }
    const registry = { listRegistered: () => [{ accountId: 1, connected: true }, { accountId: 2, connected: true }],
      getWebContentsId: id => (id === 1 ? 11 : 12) }
    let cleared = false, asked = 0
    const login = { isLoggingIn: () => false, observe: async () => false, checkpointCleared: async () => { asked++; return cleared } }
    const accounts = [
      { id: 1, flatformType: 'facebook', loginStatus: 'checkpoint', facebookLoginManaged: false },
      { id: 2, flatformType: 'facebook', loginStatus: 'chưa đăng nhập', facebookLoginManaged: false }
    ]
    const realNow = Date.now
    let now = 1_800_000_000_000
    Date.now = () => now
    try {
      await checkFacebookWebviewAccounts(accounts, registry, login)
      assert.deepEqual(globalThis.__ac.updates, [[2, 'đã đăng nhập']], 'tài khoản thường vẫn theo cookie như cũ')
      assert.equal(asked, 1, 'checkpoint: hỏi thẳng Facebook')
      pass('checkpoint còn cookie c_user: không nâng theo cookie; tài khoản thường giữ cách kiểm cũ')
      globalThis.__ac.updates = []
      await checkFacebookWebviewAccounts(accounts, registry, login)
      assert.equal(asked, 1, 'chưa tới 5 phút thì không hỏi lại'); assert.deepEqual(globalThis.__ac.updates, [[2, 'đã đăng nhập']])
      pass('hỏi Facebook tối đa 5 phút một lần mỗi tài khoản')
      now += 5 * 60_000 + 1
      cleared = true
      globalThis.__ac.updates = []
      await checkFacebookWebviewAccounts(accounts.slice(0, 1), registry, login)
      assert.equal(asked, 2); assert.deepEqual(globalThis.__ac.updates, [[1, 'đã đăng nhập']])
      pass('Facebook xác nhận đã hết checkpoint: nâng về "đã đăng nhập"')
      globalThis.__ac.updates = []
      await checkFacebookWebviewAccounts(accounts.slice(0, 1), registry, undefined)
      assert.deepEqual(globalThis.__ac.updates, [])
      pass('không có dịch vụ đăng nhập Facebook: giữ "checkpoint"')
    } finally { Date.now = realNow }
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
  console.log(`\n${checks} nhóm kiểm tra đạt`)
}
main().catch(error => { console.error(error); process.exit(1) })

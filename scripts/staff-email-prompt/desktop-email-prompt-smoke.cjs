// Smoke: phần tiến trình chính của form xin email sau khi đăng nhập (V652, docs/STAFF_EMAIL_PROMPT_PLAN.md mục 5.2).
// Kiểm hợp đồng chép nguyên văn từ WebApp, repository + handler IPC với Supabase / Electron giả:
// tự gắn client desktop, chặn lệnh lạ, PGRST202 → not_installed, lỗi mạng → unavailable, đọc kết quả từng lệnh.
// Chạy: node scripts/staff-email-prompt/desktop-email-prompt-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const ROOT = resolve(__dirname, '../..')
const CONTRACT_MD5 = 'efb4547bd891af491b7a12c5951e78f5'
let failed = 0
let passed = 0

async function group(label, run) {
  try {
    await run()
    passed++
    console.log('PASS', label)
  } catch (error) {
    failed++
    console.log('FAIL', label)
    console.log('  ', error && error.message ? error.message : error)
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-email-prompt-'))
  try {
    const fakeClient = join(dir, 'fakeSupabaseClient.js')
    writeFileSync(fakeClient, `
      exports.getSupabaseClient = () => ({
        rpc(name, args) {
          globalThis.__calls.push({ name, args })
          const answer = Promise.resolve().then(() => globalThis.__rpc(name, args))
          return { abortSignal: () => answer, then: (a, b) => answer.then(a, b) }
        }
      })
    `)
    const fakeUser = join(dir, 'fakeCurrentUser.js')
    writeFileSync(fakeUser, `exports.requireCurrentUser = () => { if (globalThis.__noUser) throw new Error('Chưa đăng nhập'); return { staffId: 7, organizationId: 3 } }`)
    const fakeElectron = join(dir, 'fakeElectron.js')
    writeFileSync(fakeElectron, `
      globalThis.__handlers = {}
      exports.ipcMain = { handle(channel, fn) { globalThis.__handlers[channel] = fn } }
    `)
    const redirect = {
      name: 'redirect',
      setup(b) {
        b.onResolve({ filter: /(^|\/)supabaseClient$/ }, () => ({ path: fakeClient }))
        b.onResolve({ filter: /(^|\/)currentUser$/ }, () => ({ path: fakeUser }))
        b.onResolve({ filter: /^electron$/ }, () => ({ path: fakeElectron }))
      }
    }
    const entry = join(dir, 'entry.ts')
    writeFileSync(entry, `
      export * from ${JSON.stringify(join(ROOT, 'src/main/data/repositories/emailPromptRepository.ts'))}
      export * from ${JSON.stringify(join(ROOT, 'src/main/ipc/handlers/emailPromptHandlers.ts'))}
      export * from ${JSON.stringify(join(ROOT, 'src/shared/emailPromptDesktop.ts'))}
    `)
    const outfile = join(dir, 'bundle.cjs')
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', plugins: [redirect] })
    const m = require(outfile)
    const warn = console.warn
    console.warn = () => {}

    const reset = handler => { globalThis.__calls = []; globalThis.__rpc = handler; globalThis.__noUser = false }

    // Handler IPC với cửa sổ chính giả.
    const mainFrame = {}
    const webContents = { mainFrame }
    m.registerEmailPromptHandlers({ webContents })
    const handler = globalThis.__handlers[m.EMAIL_PROMPT_IPC]
    const invoke = request => handler({ sender: webContents, senderFrame: mainFrame }, request)

    await group('hợp đồng emailPrompt.ts chép nguyên văn từ WebApp', () => {
      const source = readFileSync(join(ROOT, 'src/shared/emailPrompt.ts'))
      assert.equal(createHash('md5').update(source).digest('hex'), CONTRACT_MD5)
      const web = resolve(ROOT, '../akaAgentWebApp/packages/control-api/src/emailPrompt.ts')
      if (existsSync(web)) assert.ok(source.equals(readFileSync(web)), 'khác WebApp')
    })

    await group('kênh IPC đúng tên và chỉ một kênh', () => {
      assert.equal(m.EMAIL_PROMPT_IPC, 'email-prompt:call')
      assert.deepEqual(Object.keys(globalThis.__handlers), ['email-prompt:call'])
    })

    await group('state: gọi đúng RPC, payload rỗng, đọc kết quả', async () => {
      reset(() => ({ data: { ok: true, enabled: true, show: 'enter', reason: 'no_email', chip: true, username: 'hoangmai', isAdmin: true }, error: null }))
      const result = await invoke({ action: 'state' })
      assert.deepEqual(globalThis.__calls, [{ name: 'aka_agent_email_prompt', args: { p_action: 'state', p_payload: {} } }])
      assert.equal(result.ok, true)
      assert.equal(result.data.show, 'enter')
      assert.equal(result.data.chip, true)
      assert.equal(result.data.username, 'hoangmai')
      assert.equal(result.data.email, null)
    })

    await group('state: công tắc tắt → enabled false, không chip', async () => {
      reset(() => ({ data: { ok: true, enabled: false, show: 'none', reason: 'disabled' }, error: null }))
      const result = await invoke({ action: 'state', payload: { client: 'web' } })
      assert.deepEqual(globalThis.__calls[0].args, { p_action: 'state', p_payload: {} })
      assert.equal(result.ok, true)
      assert.equal(result.data.enabled, false)
      assert.equal(result.data.chip, false)
    })

    await group('dismiss và save tự gắn client desktop, bỏ khóa lạ, renderer không đổi được client', async () => {
      reset(() => ({ data: { ok: true, dismissed: true }, error: null }))
      const dismissed = await invoke({ action: 'dismiss', payload: { client: 'web', staffId: 99 } })
      assert.deepEqual(globalThis.__calls[0].args, { p_action: 'dismiss', p_payload: { client: 'desktop' } })
      assert.deepEqual(dismissed, { ok: true, data: { dismissed: true } })

      reset(() => ({ data: { ok: true, saved: true, email: 'an@gmail.com', isAdmin: false, verified: false }, error: null }))
      const saved = await invoke({ action: 'save', payload: { email: '  an@gmail.com ', client: 'ios', staffId: 1, allowTypo: 'yes' } })
      assert.deepEqual(globalThis.__calls[0].args, { p_action: 'save', p_payload: { client: 'desktop', email: 'an@gmail.com' } })
      assert.deepEqual(saved, { ok: true, data: { email: 'an@gmail.com', isAdmin: false, verified: false } })

      reset(() => ({ data: { ok: true, saved: true, email: 'an@gmial.com', isAdmin: false, verified: false }, error: null }))
      await invoke({ action: 'save', payload: { email: 'an@gmial.com', allowTypo: true } })
      assert.deepEqual(globalThis.__calls[0].args.p_payload, { client: 'desktop', email: 'an@gmial.com', allowTypo: true })

      reset(() => ({ data: { ok: true, saved: true, email: 'x@y.vn', isAdmin: true, verified: true }, error: null }))
      await invoke({ action: 'save', payload: { confirm: true, email: 'khac@y.vn' } })
      assert.deepEqual(globalThis.__calls[0].args.p_payload, { client: 'desktop', confirm: true })
    })

    await group('save: lỗi nghiệp vụ của DB giữ mã và gợi ý', async () => {
      reset(() => ({ data: { ok: false, code: 'email_typo', suggestion: 'an@gmail.com' }, error: null }))
      const typo = await invoke({ action: 'save', payload: { email: 'an@gmial.com' } })
      assert.equal(typo.ok, false)
      assert.equal(typo.code, 'email_typo')
      assert.equal(typo.suggestion, 'an@gmail.com')
      reset(() => ({ data: { ok: false, code: 'rate_limited' }, error: null }))
      const limited = await invoke({ action: 'save', payload: { email: 'an@gmail.com' } })
      assert.equal(limited.code, 'rate_limited')
      assert.match(limited.message, /nhiều lần/)
      reset(() => ({ data: { ok: false, code: 'lạ' }, error: null }))
      assert.equal((await invoke({ action: 'save', payload: { email: 'an@gmail.com' } })).code, 'unavailable')
    })

    await group('save thiếu email / quá dài → email_invalid, không gọi DB', async () => {
      reset(() => { throw new Error('không được gọi') })
      assert.equal((await invoke({ action: 'save', payload: {} })).code, 'email_invalid')
      assert.equal((await invoke({ action: 'save', payload: { email: '   ' } })).code, 'email_invalid')
      assert.equal((await invoke({ action: 'save', payload: { email: 'a'.repeat(321) } })).code, 'email_invalid')
      assert.equal((await invoke({ action: 'save' })).code, 'email_invalid')
      assert.equal(globalThis.__calls.length, 0)
    })

    await group('lệnh lạ / yêu cầu sai dạng → invalid_action, không gọi DB', async () => {
      reset(() => { throw new Error('không được gọi') })
      for (const request of [{ action: 'claim' }, { action: 'sent' }, { action: 'STATE' }, { action: 1 }, null, 'state', [], {}]) {
        const result = await invoke(request)
        assert.equal(result.ok, false, JSON.stringify(request))
        assert.equal(result.code, 'invalid_action', JSON.stringify(request))
      }
      assert.equal(globalThis.__calls.length, 0)
    })

    await group('PGRST202 / 42883 → not_installed; lỗi khác, ném lỗi, dữ liệu sai dạng → unavailable', async () => {
      reset(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }))
      assert.equal((await invoke({ action: 'state' })).code, 'not_installed')
      reset(() => ({ data: null, error: { code: '42883', message: 'function does not exist' } }))
      assert.equal((await invoke({ action: 'profile' })).code, 'not_installed')
      reset(() => ({ data: null, error: { code: '57014', message: 'timeout' } }))
      assert.equal((await invoke({ action: 'state' })).code, 'unavailable')
      reset(() => { throw new TypeError('fetch failed') })
      assert.equal((await invoke({ action: 'dismiss' })).code, 'unavailable')
      reset(() => ({ data: 'không phải object', error: null }))
      assert.equal((await invoke({ action: 'state' })).code, 'unavailable')
      reset(() => ({ data: { ok: true, saved: false }, error: null }))
      assert.equal((await invoke({ action: 'save', payload: { email: 'an@gmail.com' } })).code, 'unavailable')
    })

    await group('chưa đăng nhập → no_session, không gọi DB', async () => {
      reset(() => { throw new Error('không được gọi') })
      globalThis.__noUser = true
      assert.equal((await invoke({ action: 'state' })).code, 'no_session')
      assert.equal(globalThis.__calls.length, 0)
    })

    await group('profile: đọc email, danh sách, xác nhận', async () => {
      reset(() => ({ data: { ok: true, enabled: true, email: 'an@gmail.com', emailList: ['an@gmail.com', 'cu@yahoo.com', 3], isAdmin: true, verified: true }, error: null }))
      const result = await invoke({ action: 'profile' })
      assert.deepEqual(globalThis.__calls[0].args, { p_action: 'profile', p_payload: {} })
      assert.deepEqual(result, { ok: true, data: { enabled: true, email: 'an@gmail.com', emailList: ['an@gmail.com', 'cu@yahoo.com'], isAdmin: true, verified: true } })
    })

    await group('yêu cầu từ khung / cửa sổ khác bị từ chối', async () => {
      reset(() => ({ data: { ok: true }, error: null }))
      await assert.rejects(() => handler({ sender: {}, senderFrame: mainFrame }, { action: 'state' }))
      await assert.rejects(() => handler({ sender: webContents, senderFrame: {} }, { action: 'state' }))
      assert.equal(globalThis.__calls.length, 0)
    })

    console.warn = warn
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })

// Smoke (không DB, không Electron): "Nâng cấp và mua gói" trên Desktop (docs/UPGRADE_PORTAL_DESKTOP.md).
// Kiểm hợp đồng chép nguyên văn từ WebApp, hàm dựng link (có vé / không vé / chưa đăng nhập), các kênh IPC `upgrade-portal:*`
// chạy trên mã thật của `renewalWebHandlers.ts` + `renewalWebService.ts` + `renewalReminderService.ts` với electron giả,
// store của giao diện và các câu báo "tính năng chưa kích hoạt".
// Chạy: node scripts/upgrade-portal-desktop-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const ROOT = resolve(__dirname, '..')
const CONTRACT_MD5 = '967dafaa8211a6034b08869411ee4071'
const TICKET = 'a'.repeat(64)
const PARTITION = 'akaagent_renewal'
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
    console.log('  ', error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n   ') : error)
  }
}

const tick = () => new Promise(resolvePromise => setImmediate(resolvePromise))
async function settle(rounds = 6) { for (let i = 0; i < rounds; i++) await tick() }

const product = (organizationProductId, overrides = {}) => ({
  organizationProductId, feature: 'zalo', productId: 16, productName: 'akaAgent Zalo', packageName: 'akaAgent Zalo - 1 năm',
  packageType: 'year', displayName: 'Zalo', displayOrder: 1, expirationDate: '2027-01-01T16:59:59+00:00', maxAccounts: 5,
  isActive: true, durationDays: 366, ...overrides
})
const userOf = (staffId, products) => ({ staffId, organizationId: 9, name: 'Demo', accountProducts: products })

// ------------------------------------------------------------------ electron giả

function makeSession() {
  const downloads = []
  const fake = {
    cleared: 0,
    downloads,
    webRequest: { onBeforeRequest(handler) { fake.beforeRequest = handler } },
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    on(name, handler) { if (name === 'will-download') downloads.push(handler) },
    removeListener(name, handler) { const at = downloads.indexOf(handler); if (name === 'will-download' && at >= 0) downloads.splice(at, 1) },
    clearStorageData: async () => { fake.cleared++ },
    clearCache: async () => {},
    closeAllConnections: async () => {}
  }
  return fake
}

function makeWindow() {
  const listeners = {}
  const sent = []
  const webContents = {
    mainFrame: { name: 'main' },
    on(name, handler) { (listeners[name] ||= []).push(handler) },
    removeListener(name, handler) { listeners[name] = (listeners[name] || []).filter(item => item !== handler) },
    send(channel, payload) { sent.push({ channel, payload: JSON.parse(JSON.stringify(payload)) }) },
    isDestroyed: () => false,
    emit(name, ...args) { for (const handler of [...(listeners[name] || [])]) handler(...args) },
    count: name => (listeners[name] || []).length
  }
  return { webContents, sent, isDestroyed: () => false, once() {} }
}

function makeGuest(session) {
  const listeners = {}
  const guest = {
    session, loaded: [], closed: false, windowOpenHandler: null,
    on(name, handler) { (listeners[name] ||= []).push(handler); return guest },
    once(name, handler) { (listeners[name] ||= []).push(handler); return guest },
    setWindowOpenHandler(handler) { guest.windowOpenHandler = handler },
    loadURL: async url => { guest.loaded.push(url) },
    isDestroyed: () => guest.closed,
    close() { guest.closed = true },
    emit(name, ...args) { for (const handler of [...(listeners[name] || [])]) handler(...args) }
  }
  return guest
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-upgrade-portal-'))
  try {
    const stub = (name, source) => { const path = join(dir, name); writeFileSync(path, source); return path }
    const fakeElectron = stub('fakeElectron.js', `
      exports.ipcMain = { handle(name, handler) { globalThis.__up.handlers.set(name, handler) } }
      exports.shell = { openExternal: async url => { globalThis.__up.external.push(url); if (globalThis.__up.externalFails) throw new Error('no browser') } }
      exports.session = { fromPartition(partition) { globalThis.__up.partitions.push(partition); return globalThis.__up.session } }
    `)
    const fakeUser = stub('fakeCurrentUser.js', `
      const listeners = new Set()
      exports.getCurrentUser = () => globalThis.__up.user
      exports.getCurrentUserCredentials = () => null
      exports.onCurrentUserSessionChanged = listener => { listeners.add(listener); return () => listeners.delete(listener) }
      globalThis.__up.sessionChanged = () => { for (const listener of listeners) listener() }
    `)
    const fakeRepository = stub('fakeRenewalReminderRepository.js', `
      exports.loadRenewalReminderServerState = async () => null
      exports.issueRenewalLinkTicket = async organizationProductId => {
        globalThis.__up.ticketCalls.push(organizationProductId)
        return globalThis.__up.ticket(organizationProductId)
      }
    `)
    const fakeAuthHandlers = stub('fakeAuthHandlers.js', `exports.RENEWAL_ENDED_MESSAGE = 'Phiên gia hạn đã kết thúc. Vui lòng đăng nhập lại.'`)
    const redirect = {
      name: 'redirect',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: fakeElectron }))
        b.onResolve({ filter: /(^|\/)currentUser$/ }, () => ({ path: fakeUser }))
        b.onResolve({ filter: /(^|\/)renewalReminderRepository$/ }, () => ({ path: fakeRepository }))
        b.onResolve({ filter: /(^|\/)authHandlers$/ }, () => ({ path: fakeAuthHandlers }))
      }
    }
    const entry = join(dir, 'entry.ts')
    writeFileSync(entry, `
      export * from ${JSON.stringify(join(ROOT, 'src/shared/upgradePortal.ts'))}
      export * from ${JSON.stringify(join(ROOT, 'src/shared/upgradePortalDesktop.ts'))}
      export { isRenewalPortalUrl, RENEWAL_ORDER_COMPLETED_TITLE } from ${JSON.stringify(join(ROOT, 'src/shared/renewalPortal.ts'))}
      export { RENEWAL_REMINDER_IPC } from ${JSON.stringify(join(ROOT, 'src/shared/renewalReminderDesktop.ts'))}
      export { registerRenewalWebHandlers } from ${JSON.stringify(join(ROOT, 'src/main/ipc/handlers/renewalWebHandlers.ts'))}
      export { createUpgradePortalWebControl } from ${JSON.stringify(join(ROOT, 'src/main/ipc/handlers/upgradePortalHandlers.ts'))}
      export { renewalReminderService } from ${JSON.stringify(join(ROOT, 'src/main/services/renewalReminderService.ts'))}
    `)
    const outfile = join(dir, 'bundle.cjs')
    globalThis.__up = {
      handlers: new Map(), external: [], externalFails: false, partitions: [], session: makeSession(),
      user: null, ticketCalls: [], ticket: () => ({ ok: true, token: TICKET, expiresAt: '2026-11-19T10:10:00Z' }), sessionChanged: () => {}
    }
    const up = globalThis.__up
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', plugins: [redirect] })
    const m = require(outfile)
    const warn = console.warn
    console.warn = () => {}

    // ------------------------------------------------------------------ 1. Hợp đồng

    await group('hợp đồng upgradePortal.ts chép nguyên văn từ WebApp', () => {
      const source = readFileSync(join(ROOT, 'src/shared/upgradePortal.ts'))
      assert.equal(createHash('md5').update(source).digest('hex'), CONTRACT_MD5)
      const web = process.env.WEBAPP_REPO
        ? resolve(process.env.WEBAPP_REPO, 'packages/control-api/src/upgradePortal.ts')
        : resolve(ROOT, '../akaAgentWebApp/packages/control-api/src/upgradePortal.ts')
      if (existsSync(web)) assert.ok(source.equals(readFileSync(web)), 'khác WebApp')
      else console.log('   (không có checkout WebApp: chỉ kiểm md5)')
      assert.equal(m.UPGRADE_PORTAL_MENU_LABEL, 'Nâng cấp và mua gói')
      assert.equal(m.UPGRADE_PORTAL_IPC.open, 'upgrade-portal:open')
    })

    // ------------------------------------------------------------------ 2. Dựng link

    const linkOf = async input => {
      const calls = []
      const link = await m.buildUpgradePortalDesktopLink({
        issueTicket: async id => { calls.push(id); return typeof input.answer === 'function' ? input.answer() : input.answer },
        ...input
      })
      return { link, url: new URL(link.url), calls }
    }

    await group('link có vé: menu mở chế độ mua hàng, gói của mình thì vé mang sản phẩm (không gửi next)', async () => {
      const menu = await linkOf({ from: 'menu', ownedEntitlementIds: [501], answer: { ok: true, token: TICKET } })
      assert.equal(menu.link.signed, true)
      assert.deepEqual(menu.calls, [null])
      assert.equal(`${menu.url.origin}${menu.url.pathname}`, 'https://crm.akabiz.net/gia-han')
      assert.equal(menu.url.searchParams.get('t'), TICKET)
      assert.equal(menu.url.searchParams.get('next'), '/gia-han/nang-cap?shop=1')
      assert.equal(menu.url.searchParams.get('src'), 'desktop.m1')

      const own = await linkOf({ from: 'account', entitlementId: 501, ownedEntitlementIds: [501, 502], answer: { ok: true, token: TICKET } })
      assert.deepEqual(own.calls, [501])
      assert.equal(own.link.signed, true)
      assert.equal(own.url.searchParams.has('next'), false)
      assert.equal(own.url.searchParams.get('src'), 'desktop.m2')

      // Sản phẩm không thuộc gói của phiên: không gửi cho DB, mở chế độ mua hàng.
      const foreign = await linkOf({ from: 'account', entitlementId: 999, ownedEntitlementIds: [501], answer: { ok: true, token: TICKET } })
      assert.deepEqual(foreign.calls, [null])
      assert.equal(foreign.url.searchParams.get('next'), '/gia-han/nang-cap?shop=1')

      assert.equal((await linkOf({ from: 'banner', ownedEntitlementIds: [], answer: { ok: true, token: TICKET } })).url.searchParams.get('src'), 'desktop.b1')
      assert.equal((await linkOf({ from: 'feature', ownedEntitlementIds: [], answer: { ok: true, token: TICKET } })).url.searchParams.get('src'), 'desktop.f1')
    })

    await group('link không có vé: DB chưa có hàm, quá hạn mức, mã sai dạng, lỗi gọi → link thường đúng trang', async () => {
      const answers = [null, { ok: false, reason: 'rate_limited' }, { ok: true, token: 'abc' }, { ok: true }, 'x', () => { throw new Error('mạng') }]
      for (const answer of answers) {
        const menu = await linkOf({ from: 'menu', ownedEntitlementIds: [501], answer })
        assert.equal(menu.link.signed, false)
        assert.equal(menu.url.searchParams.has('t'), false)
        assert.equal(menu.url.searchParams.get('next'), '/gia-han/nang-cap?shop=1')
        const own = await linkOf({ from: 'account', entitlementId: 501, ownedEntitlementIds: [501], answer })
        assert.equal(own.link.signed, false)
        assert.equal(own.url.searchParams.get('next'), '/gia-han/nang-cap?product=501')
        assert.equal(own.calls.length, 1)
      }
    })

    await group('chưa đăng nhập: không xin vé, không gọi DB, link thường từ màn đăng nhập', async () => {
      const login = await linkOf({ from: 'login', entitlementId: 501, ownedEntitlementIds: null, answer: { ok: true, token: TICKET } })
      assert.deepEqual(login.calls, [])
      assert.equal(login.link.signed, false)
      assert.equal(login.url.searchParams.has('t'), false)
      assert.equal(login.url.searchParams.get('next'), '/gia-han/nang-cap?shop=1')
      assert.equal(login.url.searchParams.get('src'), 'desktop.l1')
    })

    await group('mọi link dựng ra đều qua được chốt điều hướng của form; link ngoài cổng thì không', async () => {
      for (const from of m.UPGRADE_PORTAL_ENTRIES) {
        for (const answer of [{ ok: true, token: TICKET }, null]) {
          const { link } = await linkOf({ from, entitlementId: 501, ownedEntitlementIds: [501], answer })
          assert.ok(m.isRenewalPortalUrl(link.url), link.url)
          assert.ok(m.isUpgradePortalUrl(link.url), link.url)
        }
      }
      for (const url of ['https://akabiz.net/bang-gia', 'https://crm.akabiz.net/gt/ABC', 'http://crm.akabiz.net/gia-han', 'https://crm.akabiz.net.evil.vn/gia-han', '', null]) {
        assert.equal(m.isUpgradePortalUrl(url), false, String(url))
      }
      assert.equal(m.isUpgradePortalUrl('https://crm.akabiz.net/gia-han'), true)
      assert.equal(m.isUpgradePortalUrl('https://crm.akabiz.net/gia-han?next=%2Fgia-han%2Fhet-han-goi&src=banner.d7'), true)
    })

    // ------------------------------------------------------------------ 3. IPC trên mã thật của main

    const win = makeWindow()
    const frameEvent = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
    const state = { renewalId: null, refreshCalls: 0, nextProducts: null, refreshFails: false }
    const renewalControl = {
      currentRenewalId: () => state.renewalId,
      onRenewalChanged: () => () => {},
      createRenewalLink: async () => ({ url: 'https://crm.akabiz.net/gia-han', signed: false }),
      offerSessionRenewal: async () => {}
    }
    const reminderControl = {
      currentSessionId: () => m.renewalReminderService.currentSessionId(),
      onSessionChanged: listener => m.renewalReminderService.onSessionChanged(listener),
      hasReminder: () => true,
      createLink: async () => ({ url: `https://crm.akabiz.net/gia-han?t=${'b'.repeat(64)}`, signed: true }),
      orderCompleted() {},
      windowClosed() {}
    }
    const refreshEntitlements = async () => {
      state.refreshCalls++
      if (state.refreshFails) throw new Error('db')
      if (state.nextProducts && up.user) up.user = { ...up.user, accountProducts: state.nextProducts }
    }
    m.registerRenewalWebHandlers(win, renewalControl, reminderControl, m.createUpgradePortalWebControl(refreshEntitlements))
    const call = (channel, ...args) => up.handlers.get(channel)(frameEvent, ...args)
    const IPC = m.UPGRADE_PORTAL_IPC

    const login = async user => { up.user = user; up.sessionChanged(); await settle() }
    const attach = () => {
      const guest = makeGuest(up.session)
      let prevented = false
      win.webContents.emit('will-attach-webview', { preventDefault() { prevented = true } }, { partition: PARTITION }, { src: 'about:blank' })
      if (prevented) return { prevented: true, guest: null }
      win.webContents.emit('did-attach-webview', {}, guest)
      return { prevented: false, guest }
    }
    const reset = () => { up.ticketCalls.length = 0; up.external.length = 0; win.sent.length = 0; state.refreshCalls = 0; state.nextProducts = null; state.refreshFails = false }
    const rendererSaw = () => JSON.stringify(win.sent)

    await group('đủ 5 kênh IPC; yêu cầu sai dạng và khung lạ bị từ chối', async () => {
      for (const channel of Object.values(IPC)) if (channel !== IPC.webState) assert.ok(up.handlers.has(channel), channel)
      await login(userOf(7, [product(501), product(502)]))
      for (const bad of [null, {}, { from: 'khác' }, 'menu']) {
        assert.deepEqual(await call(IPC.open, bad), { ok: false, code: 'invalid_request', message: m.UPGRADE_PORTAL_OPEN_ERROR })
      }
      await assert.rejects(async () => up.handlers.get(IPC.open)({ sender: win.webContents, senderFrame: { name: 'guest' } }, { from: 'menu' }))
      await assert.rejects(async () => up.handlers.get(IPC.open)({ sender: {}, senderFrame: win.webContents.mainFrame }, { from: 'menu' }))
      assert.equal(win.webContents.count('will-attach-webview'), 0, 'chưa mở form nào')
    })

    await group('mở từ menu khi đang đăng nhập: 1 lượt xin vé, vé chỉ đi trong main, không tới giao diện', async () => {
      reset()
      const result = await call(IPC.open, { from: 'menu' })
      assert.deepEqual(result, { ok: true, partition: PARTITION, url: 'about:blank' })
      assert.deepEqual(up.ticketCalls, [], 'chưa gắn webview thì chưa xin vé')
      const { guest } = attach()
      await settle()
      assert.deepEqual(up.ticketCalls, [null])
      assert.equal(guest.loaded.length, 1)
      const url = new URL(guest.loaded[0])
      assert.equal(url.searchParams.get('t'), TICKET)
      assert.equal(url.searchParams.get('src'), 'desktop.m1')
      assert.equal(url.searchParams.get('next'), '/gia-han/nang-cap?shop=1')
      assert.ok(!JSON.stringify(result).includes(TICKET))
      assert.ok(!rendererSaw().includes(TICKET), 'vé lọt xuống giao diện')
      assert.ok(!rendererSaw().includes('crm.akabiz.net'), 'link lọt xuống giao diện')
      assert.ok(win.sent.length > 0 && win.sent.every(item => item.channel === IPC.webState), 'trạng thái phải đi kênh riêng của form')
      assert.equal(win.sent.at(-1).payload.status, 'ready')
      assert.equal(win.sent.at(-1).payload.signed, true)
      assert.equal(state.refreshCalls, 0, 'mở form không đọc lại gói')
    })

    await group('hai lối bấm liên tiếp dùng lại một form (không tạo webview thứ hai, không xin thêm vé)', async () => {
      const again = await call(IPC.open, { from: 'account', entitlementId: 501 })
      assert.deepEqual(again, { ok: true, partition: PARTITION, url: 'about:blank' })
      const both = await Promise.all([call(IPC.open, { from: 'feature' }), call(IPC.open, { from: 'banner' })])
      assert.ok(both.every(item => item.ok))
      await settle()
      assert.equal(win.webContents.count('will-attach-webview'), 1)
      assert.deepEqual(up.ticketCalls, [null])
    })

    await group('chốt an toàn giữ nguyên: link ngoài cổng mở trình duyệt, không vào form; chặn tải file; "Tải lại" xin vé mới', async () => {
      const { guest } = attach()
      await settle()
      up.external.length = 0
      let prevented = false
      guest.emit('will-navigate', { preventDefault() { prevented = true } }, 'https://akabiz.net/huong-dan')
      assert.equal(prevented, true)
      assert.deepEqual(up.external, ['https://akabiz.net/huong-dan'])
      prevented = false
      guest.emit('will-navigate', { preventDefault() { prevented = true } }, 'https://crm.akabiz.net/gia-han/nang-cap?shop=1')
      assert.equal(prevented, false, 'điều hướng trong cổng phải được phép')
      assert.deepEqual(guest.windowOpenHandler({ url: 'https://zalo.me/akabiz' }), { action: 'deny' })
      assert.equal(up.external.at(-1), 'https://zalo.me/akabiz')
      let downloadBlocked = false
      for (const handler of up.session.downloads) handler({ preventDefault() { downloadBlocked = true } })
      assert.equal(downloadBlocked, true)

      const before = up.ticketCalls.length
      const snapshot = await call(IPC.webReload)
      assert.equal(typeof snapshot.revision, 'number')
      await settle()
      assert.equal(up.ticketCalls.length, before + 1, 'tải lại phải xin vé mới (vé dùng một lần)')
      assert.ok(!rendererSaw().includes(TICKET))
    })

    await group('trang CRM báo "Đã kích hoạt gói": đọc lại gói ngay, đúng một lượt', async () => {
      const { guest } = attach()
      await settle()
      state.refreshCalls = 0
      guest.emit('page-title-updated', {}, m.RENEWAL_ORDER_COMPLETED_TITLE)
      guest.emit('page-title-updated', {}, m.RENEWAL_ORDER_COMPLETED_TITLE)
      await settle()
      assert.equal(state.refreshCalls, 1)
      assert.equal(win.sent.at(-1).payload.orderCompleted, true)
    })

    await group('đóng form: xoá dữ liệu phiên cổng, đọc lại gói một lượt, báo gói có đổi hay không', async () => {
      state.refreshCalls = 0
      const cleared = up.session.cleared
      assert.deepEqual(await call(IPC.close), { updated: false })
      assert.equal(state.refreshCalls, 1)
      assert.equal(up.session.cleared, cleared + 1)
      assert.equal(win.webContents.count('will-attach-webview'), 0)
      // Đóng lần nữa khi không còn form: không làm gì.
      assert.deepEqual(await call(IPC.close), { updated: false })
      assert.equal(state.refreshCalls, 1)

      // Bật dùng thử sản phẩm khác rồi đóng: trang không đổi tiêu đề, gói mới nhận được ở lượt đọc lại khi đóng.
      reset()
      assert.equal((await call(IPC.open, { from: 'account' })).ok, true)
      attach()
      await settle()
      state.nextProducts = [product(501), product(502), product(777, { productId: 3, displayName: 'Facebook', packageType: 'demo' })]
      assert.deepEqual(await call(IPC.close), { updated: true })
      assert.equal(state.refreshCalls, 1)

      // Đọc lại gói lỗi: không báo "đã cập nhật".
      reset()
      assert.equal((await call(IPC.open, { from: 'menu' })).ok, true)
      state.refreshFails = true
      assert.deepEqual(await call(IPC.close), { updated: false })
    })

    await group('nút của một gói: vé xin đúng sản phẩm đó; sản phẩm lạ thì mở chế độ mua hàng', async () => {
      reset()
      assert.equal((await call(IPC.open, { from: 'account', entitlementId: 502 })).ok, true)
      let attached = attach()
      await settle()
      assert.deepEqual(up.ticketCalls, [502])
      let url = new URL(attached.guest.loaded[0])
      assert.equal(url.searchParams.has('next'), false)
      assert.equal(url.searchParams.get('src'), 'desktop.m2')
      await call(IPC.close)

      reset()
      assert.equal((await call(IPC.open, { from: 'account', entitlementId: 999 })).ok, true)
      attached = attach()
      await settle()
      assert.deepEqual(up.ticketCalls, [null])
      url = new URL(attached.guest.loaded[0])
      assert.equal(url.searchParams.get('next'), '/gia-han/nang-cap?shop=1')
      await call(IPC.close)
    })

    await group('không có vé (quá hạn mức): form vẫn mở bằng link thường, giao diện biết signed = false', async () => {
      reset()
      up.ticket = () => ({ ok: false, reason: 'rate_limited' })
      assert.equal((await call(IPC.open, { from: 'feature' })).ok, true)
      const { guest } = attach()
      await settle()
      const url = new URL(guest.loaded[0])
      assert.equal(url.searchParams.has('t'), false)
      assert.equal(url.searchParams.get('src'), 'desktop.f1')
      assert.equal(win.sent.at(-1).payload.signed, false)
      await call(IPC.close)
      up.ticket = () => ({ ok: true, token: TICKET, expiresAt: '2026-11-19T10:10:00Z' })
    })

    await group('đổi phiên trong lúc chờ vé: bỏ link, không nạp vào form, form đóng', async () => {
      reset()
      let release
      up.ticket = () => new Promise(resolvePromise => { release = resolvePromise })
      assert.equal((await call(IPC.open, { from: 'menu' })).ok, true)
      const { guest } = attach()
      await settle()
      assert.equal(up.ticketCalls.length, 1)
      const cleared = up.session.cleared
      await login(userOf(8, [product(601)]))
      release({ ok: true, token: TICKET })
      await settle()
      assert.deepEqual(guest.loaded, [], 'link của phiên cũ không được nạp')
      assert.equal(guest.closed, true)
      assert.equal(up.session.cleared, cleared + 1)
      assert.equal(win.webContents.count('will-attach-webview'), 0)
      assert.ok(!rendererSaw().includes(TICKET))
      // Phiên cũ không còn điều khiển được form.
      await assert.rejects(async () => call(IPC.webReload))
      assert.deepEqual(await call(IPC.close), { updated: false })
      assert.equal(state.refreshCalls, 0)
      up.ticket = () => ({ ok: true, token: TICKET, expiresAt: '2026-11-19T10:10:00Z' })
    })

    await group('đăng xuất thì form đóng; webview gắn muộn không được nạp link nào', async () => {
      reset()
      assert.equal((await call(IPC.open, { from: 'menu' })).ok, true)
      const { guest } = attach()
      await settle()
      const cleared = up.session.cleared
      await login(null)
      assert.equal(guest.closed, true)
      assert.equal(up.session.cleared, cleared + 1)
      assert.equal(win.webContents.count('will-attach-webview'), 0)
      const ticketsBefore = up.ticketCalls.length
      const late = attach()
      await settle()
      assert.deepEqual(late.guest ? late.guest.loaded : [], [])
      assert.equal(up.ticketCalls.length, ticketsBefore)
      await assert.rejects(async () => call(IPC.webReload))
    })

    await group('chưa đăng nhập: chỉ lối ở màn đăng nhập; mở KHÔNG vé, 0 lượt DB; đóng không đọc lại gói', async () => {
      reset()
      for (const from of ['menu', 'account', 'banner', 'feature']) {
        assert.equal((await call(IPC.open, { from })).code, 'not_logged_in', from)
      }
      const result = await call(IPC.open, { from: 'login' })
      assert.deepEqual(result, { ok: true, partition: PARTITION, url: 'about:blank' })
      const { guest } = attach()
      await settle()
      assert.deepEqual(up.ticketCalls, [])
      const url = new URL(guest.loaded[0])
      assert.equal(url.searchParams.has('t'), false)
      assert.equal(url.searchParams.get('src'), 'desktop.l1')
      assert.equal(url.searchParams.get('next'), '/gia-han/nang-cap?shop=1')
      assert.equal(win.sent.at(-1).payload.signed, false)
      guest.emit('page-title-updated', {}, m.RENEWAL_ORDER_COMPLETED_TITLE)
      await settle()
      assert.deepEqual(await call(IPC.close), { updated: false })
      assert.equal(state.refreshCalls, 0)
      assert.deepEqual(up.ticketCalls, [])
    })

    await group('form mở từ màn đăng nhập đóng khi khách đăng nhập; đang ở màn Gia hạn trước đăng nhập thì không mở form', async () => {
      reset()
      assert.equal((await call(IPC.open, { from: 'login' })).ok, true)
      const { guest } = attach()
      await settle()
      await login(userOf(7, [product(501), product(502)]))
      assert.equal(guest.closed, true)
      assert.equal(win.webContents.count('will-attach-webview'), 0)
      await login(null)
      state.renewalId = 5
      assert.equal((await call(IPC.open, { from: 'login' })).code, 'busy')
      state.renewalId = null
    })

    await group('cửa sổ "Gia hạn gói" đang mở: không mở thêm form, cửa sổ đang mở giữ nguyên', async () => {
      reset()
      await login(userOf(7, [product(501), product(502)]))
      assert.equal((await call(m.RENEWAL_REMINDER_IPC.open, { reminderKey: 'k' })).ok, true)
      const busy = await call(IPC.open, { from: 'menu' })
      assert.deepEqual(busy, { ok: false, code: 'busy', message: m.UPGRADE_PORTAL_BUSY_MESSAGE })
      assert.equal(win.webContents.count('will-attach-webview'), 1)
      assert.equal(typeof (await call(m.RENEWAL_REMINDER_IPC.webReload)).revision, 'number', 'cửa sổ gia hạn vẫn hoạt động')
      // Kênh của form không điều khiển được cửa sổ gia hạn.
      await assert.rejects(async () => call(IPC.webReload))
      assert.deepEqual(await call(IPC.close), { updated: false })
      assert.equal(win.webContents.count('will-attach-webview'), 1)
      await call(m.RENEWAL_REMINDER_IPC.close)
      assert.equal(win.webContents.count('will-attach-webview'), 0)
      // Ngược lại: form đang mở mà lời nhắc mở cửa sổ gia hạn thì form nhường chỗ (không bao giờ có hai webview).
      assert.equal((await call(IPC.open, { from: 'menu' })).ok, true)
      assert.equal((await call(m.RENEWAL_REMINDER_IPC.open, { reminderKey: 'k' })).ok, true)
      assert.equal(win.webContents.count('will-attach-webview'), 1)
      await assert.rejects(async () => call(IPC.webReload))
      await call(m.RENEWAL_REMINDER_IPC.close)
    })

    await group('"Mở bằng trình duyệt": main tự mở link của cổng, giao diện chỉ nhận { ok, signed }', async () => {
      reset()
      const result = await call(IPC.openExternal, { from: 'menu' })
      assert.deepEqual(result, { ok: true, signed: true })
      assert.equal(up.external.length, 1)
      assert.ok(m.isUpgradePortalUrl(up.external[0]))
      assert.equal(new URL(up.external[0]).searchParams.get('t'), TICKET)
      up.externalFails = true
      assert.deepEqual(await call(IPC.openExternal, { from: 'menu' }), { ok: false, code: 'unavailable', message: m.UPGRADE_PORTAL_EXTERNAL_ERROR })
      up.externalFails = false
      assert.equal((await call(IPC.openExternal, { from: 'khác' })).code, 'invalid_request')
      await login(null)
      assert.equal((await call(IPC.openExternal, { from: 'menu' })).code, 'not_logged_in')
      reset()
      assert.deepEqual(await call(IPC.openExternal, { from: 'login' }), { ok: true, signed: false })
      assert.deepEqual(up.ticketCalls, [])
      assert.equal(new URL(up.external[0]).searchParams.has('t'), false)
    })

    // ------------------------------------------------------------------ 4. Giao diện: store và câu báo tính năng

    await group('store giao diện: bấm hai lối liên tiếp giữ một form; cửa sổ gia hạn đang mở thì dùng lại; đóng thì báo gói đã cập nhật', async () => {
      const closes = []
      globalThis.window = {
        electronAPI: { closeUpgradePortal: async () => { closes.push(1); return { updated: closes.length === 1 } } },
        localStorage: { getItem: () => null, setItem() {} },
        dispatchEvent() {}, addEventListener() {}, removeEventListener() {}
      }
      const storeEntry = join(dir, 'store-entry.ts')
      writeFileSync(storeEntry, `
        export { useUpgradePortalStore } from ${JSON.stringify(join(ROOT, 'src/renderer/src/stores/upgradePortalStore.ts'))}
        export { useRenewalReminderStore } from ${JSON.stringify(join(ROOT, 'src/renderer/src/stores/renewalReminderStore.ts'))}
        export { useUiStore } from ${JSON.stringify(join(ROOT, 'src/renderer/src/stores/uiStore.ts'))}
      `)
      const storeOut = join(dir, 'store.cjs')
      await build({ entryPoints: [storeEntry], bundle: true, platform: 'node', format: 'cjs', outfile: storeOut, logLevel: 'silent' })
      const s = require(storeOut)
      const shop = s.useUpgradePortalStore
      shop.getState().open({ from: 'menu' })
      shop.getState().open({ from: 'account', entitlementId: 501 })
      assert.deepEqual(shop.getState().request, { from: 'menu', entitlementId: null })
      assert.equal(shop.getState().openSeq, 1)
      shop.getState().close()
      shop.getState().close()
      await settle()
      assert.equal(closes.length, 1)
      assert.equal(shop.getState().request, null)
      assert.deepEqual({ ...s.useUiStore.getState().alert, action: undefined }, { isOpen: true, type: 'success', message: m.UPGRADE_PORTAL_UPDATED_TEXT, action: undefined })
      s.useUiStore.getState().closeAlert()

      shop.getState().open({ from: 'account', entitlementId: 502 })
      assert.deepEqual(shop.getState().request, { from: 'account', entitlementId: 502 })
      assert.equal(shop.getState().openSeq, 2)
      shop.getState().close()
      await settle()
      assert.equal(s.useUiStore.getState().alert.isOpen, false, 'gói không đổi thì không báo')

      s.useRenewalReminderStore.setState({ windowOpen: true })
      shop.getState().open({ from: 'menu' })
      assert.equal(shop.getState().request, null, 'cửa sổ Gia hạn gói đang mở: dùng lại cửa sổ đó')
      s.useRenewalReminderStore.setState({ windowOpen: false })
      shop.getState().open({ from: 'banner' })
      shop.getState().reset()
      await settle()
      assert.equal(shop.getState().request, null)
      assert.equal(closes.length, 2, 'đổi phiên: main tự đóng, giao diện không gọi đóng')
      delete globalThis.window
    })

    await group('mọi câu "… chưa được kích hoạt hoặc đã hết hạn" trong mã đều có nút "Mua hoặc dùng thử"', () => {
      const files = []
      const walk = directory => {
        for (const name of readdirSync(directory)) {
          const path = join(directory, name)
          if (statSync(path).isDirectory()) walk(path)
          else if (/\.(ts|tsx)$/.test(name)) files.push(path)
        }
      }
      walk(join(ROOT, 'src/renderer/src'))
      walk(join(ROOT, 'src/main/data/repositories'))
      const messages = new Set()
      for (const file of files) {
        for (const match of readFileSync(file, 'utf8').matchAll(/'([^'\n]*chưa được kích hoạt hoặc đã hết hạn[^'\n]*)'/g)) messages.add(match[1])
      }
      assert.ok(messages.size >= 6, `chỉ thấy ${messages.size} câu`)
      for (const message of messages) assert.equal(m.isUpgradePortalFeatureMessage(message), true, message)
      for (const other of ['Tài khoản của bạn đã hết hạn', 'Gói hiện tại không hỗ trợ tài khoản Zalo (mã QR).', '', null, 42]) {
        assert.equal(m.isUpgradePortalFeatureMessage(other), false, String(other))
      }
      const alertModal = readFileSync(join(ROOT, 'src/renderer/src/components/CampaignPanels/AlertModal.tsx'), 'utf8')
      assert.ok(alertModal.includes('isUpgradePortalFeatureMessage(alert.message)') && alertModal.includes("open({ from: 'feature' })"))
      const groupModal = readFileSync(join(ROOT, 'src/renderer/src/components/CampaignPanels/AccountGroupManagerModal.tsx'), 'utf8')
      assert.ok(groupModal.includes('isUpgradePortalFeatureMessage(error)') && groupModal.includes("open({ from: 'feature' })"))
    })

    await group('các lối vào trong giao diện gọi đúng một hàm mở form; link và vé không có trong preload', () => {
      const read = path => readFileSync(join(ROOT, path), 'utf8')
      const topBar = read('src/renderer/src/components/TopBar/TopBar.tsx')
      const accountInfo = topBar.indexOf('<span>Thông tin tài khoản</span>')
      const menuItem = topBar.indexOf("open({ from: 'menu' })")
      const updateItem = topBar.indexOf('onClick={handleCheckUpdate}')
      assert.ok(accountInfo > 0 && menuItem > accountInfo && menuItem < updateItem, 'mục menu phải nằm ngay dưới "Thông tin tài khoản"')
      assert.ok(topBar.includes('{UPGRADE_PORTAL_MENU_LABEL}') && topBar.includes('{UPGRADE_PORTAL_MENU_CAPTION}'))
      const profile = read('src/renderer/src/components/Settings/AccountProfileModal.tsx')
      assert.ok(profile.includes("open({ from: 'account', entitlementId })"))
      assert.ok(profile.includes('openUpgradePortal(product.organizationProductId)') && profile.includes('openUpgradePortal(null)'))
      assert.ok(profile.includes('openRenewalWindow()'), 'gói đang được nhắc giữ nút cũ')
      const loginPanel = read('src/renderer/src/components/Login/LoginInformationPanel.tsx')
      assert.ok(loginPanel.includes("key === 'upgradePayment' && isUpgradePortalUrl(links[key])") && loginPanel.includes("open({ from: 'login' })"))
      const banner = read('src/renderer/src/components/AppNotificationBar/AppNotificationBar.tsx')
      assert.ok(banner.includes('isUpgradePortalUrl(linkUrl)') && banner.includes("open({ from: 'banner' })"))
      const preload = read('src/preload/index.ts')
      for (const name of ['openUpgradePortal', 'reloadUpgradePortal', 'closeUpgradePortal', 'openUpgradePortalExternal', 'onUpgradePortalWebState']) {
        assert.ok(preload.includes(`${name}:`), name)
      }
      // Tiến trình chính không ghi link hay vé ra log.
      for (const path of ['src/main/ipc/handlers/upgradePortalHandlers.ts', 'src/shared/upgradePortalDesktop.ts']) {
        assert.ok(!/console\.(log|info|warn|error)/.test(read(path)), path)
      }
    })

    console.warn = warn
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${passed} nhóm đạt, ${failed} nhóm lỗi`)
  if (failed) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })

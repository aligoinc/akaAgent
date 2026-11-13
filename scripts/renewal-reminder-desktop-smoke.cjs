// Smoke test (không DB, không Electron) của nhắc gia hạn Desktop: chuyển accountProducts, kiểm kết quả RPC và dự phòng khi
// RPC chưa có, trạng thái gửi renderer không có ngày đăng nhập, quyết định bỏ thông báo kiểu cũ, dựng link ký số/link thường.
// Chạy: node scripts/renewal-reminder-desktop-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const stubs = {
  currentUser: `
    const listeners = new Set()
    export const getCurrentUser = () => globalThis.__user
    export const getCurrentUserCredentials = () => globalThis.__credentials
    export const onCurrentUserSessionChanged = listener => { listeners.add(listener); return () => listeners.delete(listener) }
    globalThis.__sessionChanged = () => { for (const listener of listeners) listener() }`,
  renewalReminderRepository: `
    export const loadRenewalReminderServerState = async () => { globalThis.__rpcCalls += 1; return globalThis.__rpc() }`
}

const DAY_MS = 86_400_000
const vnDay = ms => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10)
const expiryIn = days => `${vnDay(Date.now() + days * DAY_MS)}T16:59:59+00:00`

async function bundle(dir, entry, name, withStubs) {
  const outfile = path.join(dir, `${name}.cjs`)
  await build({
    entryPoints: [path.resolve(__dirname, entry)], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: withStubs ? [{
      name: 'stubs',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /(^|\/)(currentUser|renewalReminderRepository)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
        pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }))
      }
    }] : []
  })
  return require(outfile)
}

function product(overrides) {
  return {
    organizationProductId: 101, feature: 'zalo', productId: 16, productName: 'akaAgent Zalo', packageName: 'akaAgent Zalo Desktop(QR) - 2 tháng',
    packageType: 'month', displayName: 'Zalo', displayOrder: 3, expirationDate: expiryIn(7), maxAccounts: 5, isActive: true, durationDays: 60,
    ...overrides
  }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-reminder-'))
  let passed = 0
  const ok = label => { passed += 1; console.log(`PASS ${label}`) }
  try {
    const shared = await bundle(dir, '../src/shared/renewalReminderDesktop.ts', 'shared', false)
    const rule = await bundle(dir, '../src/shared/renewalReminder.ts', 'rule', false)
    const svcModule = await bundle(dir, '../src/main/services/renewalReminderService.ts', 'service', true)

    // 1. accountProducts → sản phẩm của quy tắc
    const mapped = shared.toRenewalReminderProducts([
      product({}),
      product({ organizationProductId: 102, productId: 3, feature: 'facebookCore', displayName: 'Facebook', packageName: '', packageType: 'demo', durationDays: 3 }),
      product({ organizationProductId: 103, productId: 17, feature: 'sms', displayName: 'akaAgent SMS', packageType: null, durationDays: null }),
      product({ organizationProductId: 104, productId: 13, isActive: false }),
      product({ organizationProductId: 105, productId: 13, expirationDate: null })
    ])
    assert.equal(mapped.length, 3)
    assert.deepEqual(mapped.map(item => item.group), ['zalo', 'facebook', 'sms'])
    assert.deepEqual(mapped.map(item => item.displayName), ['akaAgent Zalo', 'akaAgent Facebook', 'akaAgent SMS'])
    assert.deepEqual(mapped.map(item => item.isTrial), [false, true, true])
    assert.deepEqual(mapped.map(item => item.durationDays), [60, 3, null])
    assert.equal(mapped[1].packageName, null)
    ok('chuyển accountProducts (bỏ gói hết hạn/thiếu hạn, nhóm, dùng thử, tên hiển thị, thời hạn)')

    // 2. Kiểm kết quả RPC
    const now = Date.now()
    const today = vnDay(now)
    const good = { today, serverTime: new Date(now + 5_000).toISOString(), loginDays: [today, vnDay(now - 7 * DAY_MS)], offers: [{ organizationProductId: null, minDaysBeforeExpiry: 7, bonusDays: 7, discountType: null, discountValue: null }] }
    const parsed = shared.parseRenewalReminderServerState(good, now)
    assert.ok(parsed)
    assert.equal(parsed.today, today)
    assert.ok(Math.abs(parsed.serverTimeOffsetMs - 5_000) < 5)
    assert.equal(parsed.loginDays.length, 2)
    assert.equal(parsed.offers.length, 1)
    for (const bad of [
      null, [], 'x', { ...good, today: '2026-13-01' }, { ...good, today: vnDay(now - DAY_MS) },
      { ...good, serverTime: 'abc' }, { ...good, loginDays: ['2026-02-30'] }, { ...good, loginDays: Array.from({ length: 401 }, () => today) },
      { ...good, offers: Array.from({ length: 51 }, () => good.offers[0]) }, { ...good, offers: [{ ...good.offers[0], bonusDays: Number.NaN }] },
      { ...good, offers: [{ ...good.offers[0], discountType: 'free' }] }, { ...good, offers: [{ ...good.offers[0], organizationProductId: 1.5 }] }
    ]) assert.equal(shared.parseRenewalReminderServerState(bad, now), null, JSON.stringify(bad)?.slice(0, 80))
    const fallback = shared.fallbackRenewalReminderServerState(now)
    assert.deepEqual(fallback, { today, serverTimeOffsetMs: 0, loginDays: [], offers: [] })
    ok('kiểm chặt kết quả RPC + dự phòng ngày theo đồng hồ máy')

    // 3. Bỏ thông báo kiểu cũ
    const legacy = JSON.stringify({ kind: 'renewal_reminder', title: 'Gói còn 7 ngày', message: 'x', level: 'warning' })
    const other = JSON.stringify({ title: 'Bảo trì', message: 'y' })
    assert.equal(shared.shouldSkipLegacyRenewalNotice(true, legacy), true)
    assert.equal(shared.shouldSkipLegacyRenewalNotice(false, legacy), false)
    assert.equal(shared.shouldSkipLegacyRenewalNotice(true, other), false)
    assert.equal(shared.shouldSkipLegacyRenewalNotice(true, null), false)
    ok('chỉ bỏ thông báo nhắc gia hạn kiểu cũ khi giao diện mới bật')

    // 4. Link: ký số và dự phòng
    const reminder = rule.computeRenewalReminder({ products: mapped, today, settings: rule.parseRenewalReminderSettings({ audience: 'all' }) })
    assert.ok(reminder && reminder.kind === 'paid' && reminder.daysLeft === 7)
    const signedCalls = []
    const signed = await shared.buildRenewalReminderLink(reminder, async opid => { signedCalls.push(opid); return 'https://crm.akabiz.net/gia-han?t=abc.def.ghi' })
    assert.equal(signed.signed, true)
    assert.deepEqual(signedCalls, [101])
    const signedUrl = new URL(signed.url)
    assert.equal(signedUrl.searchParams.get('t'), 'abc.def.ghi')
    assert.equal(signedUrl.searchParams.get('next'), '/gia-han/het-han-goi')
    assert.equal(signedUrl.searchParams.get('src'), 'desktop.d7')
    for (const signer of [async () => { throw new Error('400') }, async () => 'https://evil.example/gia-han?t=x', async () => 'https://crm.akabiz.net/gia-han']) {
      const plain = await shared.buildRenewalReminderLink(reminder, signer)
      assert.equal(plain.signed, false)
      assert.equal(plain.url, 'https://crm.akabiz.net/gia-han?next=%2Fgia-han%2Fhet-han-goi&src=desktop.d7')
    }
    ok('link ký số (opid + next + src) và link thường khi ký lỗi/link lạ')

    // 5. Service: cài đặt, RPC, trạng thái công khai, link
    const sent = []
    globalThis.__rpcCalls = 0
    globalThis.__user = { staffId: 7, organizationId: 9, isAdminAkabiz: false, isAdmin: false, accountProducts: [product({})] }
    globalThis.__credentials = { username: 'u', password: 'p' }
    const loginDay = vnDay(now - 3 * DAY_MS)
    globalThis.__rpc = () => ({ today, serverTime: new Date().toISOString(), loginDays: [loginDay, vnDay(now - 6 * DAY_MS), vnDay(now - 9 * DAY_MS)], offers: [] })
    const service = new svcModule.RenewalReminderService()
    service.attach({ send: state => sent.push(state), sign: async () => { throw new Error('Edge chưa có renewal_link') }, refreshEntitlements: async () => {} })
    const scope = service.currentScope()
    assert.equal(scope, '9:7')

    service.applySettings(scope, rule.parseRenewalReminderSettings(null))
    assert.equal(globalThis.__rpcCalls, 0)
    assert.equal(service.getState().enabled, false)
    service.applySettings(scope, rule.parseRenewalReminderSettings({ audience: 'admin_akabiz' }))
    assert.equal(globalThis.__rpcCalls, 0, 'không thuộc nhóm thấy thì không gọi RPC')
    ok('tắt hoặc ngoài nhóm thấy: không gọi RPC, không hiện gì')

    service.applySettings(scope, rule.parseRenewalReminderSettings('{"audience":"all"}'))
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(globalThis.__rpcCalls, 1)
    const state = service.getState()
    assert.equal(state.enabled, true)
    assert.equal(state.today, today)
    assert.ok(state.reminder && state.reminder.daysLeft === 7)
    assert.deepEqual(Object.keys(state).sort(), ['enabled', 'reminder', 'serverTimeMs', 'today'])
    const publicText = JSON.stringify(sent)
    assert.ok(!publicText.includes('loginDays') && !publicText.includes(loginDay), 'trạng thái gửi renderer không có ngày đăng nhập')
    assert.ok(sent.every(item => !item.reminder || (item.reminder.early === false && !/^[ed]/.test(item.reminder.stageKey))))
    service.checkDay()
    service.productsChanged()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(globalThis.__rpcCalls, 1, 'cùng ngày thì không đọc lại RPC')
    ok('bật: một lượt RPC, trạng thái chỉ có 4 trường, không ngày đăng nhập, không dấu nhắc sớm')

    // Nhắc sớm theo thói quen: link vẫn mang mã nguồn đúng, trạng thái công khai không lộ.
    globalThis.__user = { ...globalThis.__user, accountProducts: [product({ expirationDate: expiryIn(10) })] }
    service.productsChanged()
    const earlyState = service.getState()
    assert.ok(earlyState.reminder, 'chu kỳ 3 ngày, còn 10 ngày → nhắc sớm')
    assert.equal(earlyState.reminder.early, false)
    assert.equal(service.currentReminder().early, true)
    const earlyLink = await service.resolveLink(earlyState.reminder.key)
    assert.equal(earlyLink.signed, false)
    assert.equal(new URL(earlyLink.url).searchParams.get('src'), 'desktop.e10')
    ok('nhắc sớm: renderer không biết, link vẫn ghi nguồn e10 (link thường khi chưa ký được)')

    service.attach({ sign: async (credentials, opid) => { assert.equal(credentials.username, 'u'); assert.equal(opid, 101); return 'https://crm.akabiz.net/gia-han?t=tok' } })
    const signedLink = await service.resolveLink('khóa-cũ-không-khớp')
    assert.equal(signedLink.signed, true)
    assert.equal(new URL(signedLink.url).searchParams.get('t'), 'tok')
    ok('resolveLink bỏ qua khóa cũ, dùng thông báo hiện tại, ký với opid')

    globalThis.__user = { ...globalThis.__user, accountProducts: [product({ expirationDate: expiryIn(200) })] }
    service.productsChanged()
    assert.equal(service.getState().reminder, null)
    await assert.rejects(service.resolveLink('x'), error => error.code === 'no_reminder')
    ok('đã gia hạn xa: thông báo tự mất, mở cửa sổ trả lỗi no_reminder')

    // Đăng xuất / đổi phiên: xoá dữ liệu trong RAM
    const sessionBefore = service.currentSessionId()
    // Giống setCurrentUser: báo đổi phiên trước, gán người dùng sau.
    globalThis.__sessionChanged()
    globalThis.__user = null
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(service.currentSessionId(), null)
    assert.equal(service.getState().enabled, false)
    // Cùng nhân viên đăng nhập lại: vẫn phải là phiên mới (cài đặt cũ không được giữ).
    globalThis.__sessionChanged()
    globalThis.__user = { staffId: 7, organizationId: 9, isAdminAkabiz: false, isAdmin: false, accountProducts: [product({})] }
    assert.notEqual(service.currentSessionId(), sessionBefore)
    assert.equal(service.getState().enabled, false, 'phiên mới chưa có cài đặt thì tắt')
    await assert.rejects(service.resolveLink('x'), error => error.code === 'no_reminder')
    ok('đổi phiên: cài đặt và dữ liệu máy chủ bị xoá')

    // RPC chưa có (PGRST202 → null): dùng ngày theo đồng hồ máy, vẫn nhắc theo mốc ngày
    globalThis.__rpcCalls = 0
    globalThis.__rpc = () => null
    service.applySettings(service.currentScope(), rule.parseRenewalReminderSettings({ audience: 'all' }))
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(globalThis.__rpcCalls, 1)
    const fallbackState = service.getState()
    assert.equal(fallbackState.today, today)
    assert.equal(fallbackState.reminder?.daysLeft, 7)
    await service.refresh('focus')
    await service.refresh('focus')
    assert.equal(globalThis.__rpcCalls, 2, 'refresh khi focus tối đa 1 lượt/20 giây')
    ok('RPC chưa có: dùng ngày theo đồng hồ máy, nhắc theo mốc ngày; refresh có giới hạn')

    // Đổi mật khẩu (cùng nhân viên, chỉ đổi thông tin đăng nhập): phiên đổi để cửa sổ gia hạn đóng lại, nhưng cài đặt
    // được giữ vì renderer chỉ đọc cài đặt một lần mỗi phiên.
    const sessionBeforePassword = service.currentSessionId()
    let sessionChangedCalls = 0
    const stopListening = service.onSessionChanged(() => { sessionChangedCalls += 1 })
    globalThis.__sessionChanged()
    await new Promise(resolve => setTimeout(resolve, 0))
    stopListening()
    assert.notEqual(service.currentSessionId(), sessionBeforePassword)
    assert.equal(sessionChangedCalls, 1)
    assert.equal(service.getState().enabled, true, 'đổi mật khẩu không được làm mất thông báo nhắc')
    assert.equal(service.getState().reminder?.daysLeft, 7)
    ok('đổi mật khẩu: phiên đổi, cài đặt và thông báo được giữ')

    console.log(`\n${passed} nhóm đạt.`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })

// Smoke: Desktop chọn nơi chạy tài khoản Zalo Server lúc đăng nhập theo cờ engine v2 (src/shared/zaloServerOnFly.ts, 14/11/2026).
// Bật cờ = Fly (ChatApi), tắt = App Server; không xét gói. Kèm ca gói Server đến giữa phiên: lượt đọc lại gói 30 giây chỉ thay quyền,
// giữ zaloServerOnFly lúc đăng nhập.
// Chạy: node scripts/zalo-server-on-fly-login-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const ROOT = resolve(__dirname, '..')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-server-on-fly-'))
  try {
    const outfile = join(dir, 'zaloServerOnFly.cjs')
    await build({ entryPoints: [join(ROOT, 'src/shared/zaloServerOnFly.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' })
    const { resolveZaloServerOnFlyAtLogin: pick, serverAccountsUseChatApi } = require(outfile)

    assert.equal(pick({ isChatSync: false, separateAccess: false, orgEngineFlag: true }), true)
    assert.equal(pick({ isChatSync: false, separateAccess: false, orgEngineFlag: false }), false)
    pass('bật cờ = Fly, tắt cờ = App Server')

    assert.equal(pick({ isChatSync: true, separateAccess: false, orgEngineFlag: true }), false)
    assert.equal(pick({ isChatSync: false, separateAccess: true, orgEngineFlag: true }), false)
    pass('tổ chức có Chat hoặc tách quyền app: không dùng cờ này')

    const user = (zaloServerOnFly, server, over = {}) => ({
      zaloServerOnFly, isChatSync: false, appAccess: { separateAccess: false }, entitlements: { zalo: true },
      zaloAccountCapabilities: { qr: true, web: false, server }, ...over
    })
    const flagOn = pick({ isChatSync: false, separateAccess: false, orgEngineFlag: true })
    const flagOff = pick({ isChatSync: false, separateAccess: false, orgEngineFlag: false })
    assert.equal(serverAccountsUseChatApi(user(flagOn, true)), true, 'cờ bật, có gói Server: ChatApi')
    assert.equal(serverAccountsUseChatApi(user(flagOff, true)), false, 'cờ tắt, có gói Server: App Server')
    pass('có gói Server lúc đăng nhập: theo cờ')

    // Đăng nhập khi chưa có gói Server; gói đến giữa phiên (handlers.ts runSessionExpiryCheck thay quyền rồi khởi động lại kết nối).
    assert.equal(serverAccountsUseChatApi(user(flagOn, false)), false, 'chưa có gói Server: chưa có tài khoản Server để chuyển')
    assert.equal(serverAccountsUseChatApi(user(flagOn, true)), true, 'gói Server đến giữa phiên, cờ bật: ChatApi ngay')
    assert.equal(serverAccountsUseChatApi(user(flagOff, true)), false, 'gói Server đến giữa phiên, cờ tắt: App Server')
    pass('gói Server đến giữa phiên: cờ bật thì sang ChatApi ngay, không cần đăng nhập lại')

    assert.equal(serverAccountsUseChatApi(user(false, true, { isChatSync: true })), true, 'tổ chức có Chat luôn đi ChatApi')
    assert.equal(serverAccountsUseChatApi(null), false)
    pass('tổ chức có Chat luôn đi ChatApi')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(err => { console.error(err); process.exit(1) })

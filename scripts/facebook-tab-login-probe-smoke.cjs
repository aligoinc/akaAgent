// Bước kiểm đăng nhập 30 giây của tab Facebook (src/main/domain/accounts/facebookTabLoginProbe.ts): chạy đoạn JS thật trên
// Chromium của Playwright. Trang Facebook giả qua route (không ra mạng), trang lỗi thật bằng --host-resolver-rules.
// Bản cũ hạ tài khoản xuống "chưa đăng nhập" khi tab đang hiện trang lỗi; bản mới giữ nguyên (null).
//   node scripts/facebook-tab-login-probe-smoke.cjs
const esbuild = require('esbuild')
const { chromium } = require('playwright')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-tab-login-probe-'))
// Đoạn JS của accountPoller trước bản sửa, để đối chứng.
const LEGACY_PROBE = `
  (function() {
    try {
      const cookies = document.cookie;
      if (cookies.includes('c_user=')) return { loggedIn: true };
      if (document.querySelector('#checkpoint_title') || window.location.href.includes('checkpoint'))
        return { loggedIn: false, checkpoint: true };
      return { loggedIn: false };
    } catch(e) { return { loggedIn: false }; }
  })()
`

;(async () => {
  const out = path.join(dir, 'probe.cjs')
  await esbuild.build({ entryPoints: [path.join(root, 'src/main/domain/accounts/facebookTabLoginProbe.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
  const { FACEBOOK_TAB_LOGIN_PROBE, facebookTabLoginStatus } = require(out)
  let checks = 0
  const ok = name => { checks += 1; console.log(`PASS ${name}`) }

  assert.equal(facebookTabLoginStatus(null), null)
  assert.equal(facebookTabLoginStatus({ unknown: true }), null)
  assert.equal(facebookTabLoginStatus({ loggedIn: true }), 'đã đăng nhập')
  assert.equal(facebookTabLoginStatus({ loggedIn: false, checkpoint: true }), 'checkpoint')
  assert.equal(facebookTabLoginStatus({ loggedIn: false }), 'chưa đăng nhập')
  ok('đổi kết quả sang trạng thái đăng nhập')

  let browser
  // Chặn tên miền như khi thử app dev: Chromium hiện trang lỗi thật (route.abort không đổi trang).
  const args = ['--host-resolver-rules=MAP business.facebook.com ~NOTFOUND']
  try { browser = await chromium.launch({ headless: true, args }) } catch { browser = await chromium.launch({ headless: true, channel: 'chrome', args }) }
  try {
    const context = await browser.newContext()
    await context.route(/^https:\/\/(www\.)?facebook\.com\//, route => {
      const checkpoint = route.request().url().includes('/checkpoint/')
      route.fulfill({ status: 200, contentType: 'text/html', body: checkpoint ? '<h2 id="checkpoint_title">Xác minh</h2>' : '<div>Facebook</div>' })
    })
    await context.route(/^https:\/\/example\.com\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>x</p>' }))
    const page = await context.newPage()
    const probe = async () => facebookTabLoginStatus(await page.evaluate(FACEBOOK_TAB_LOGIN_PROBE))

    await page.goto('https://www.facebook.com/')
    assert.equal(await probe(), 'chưa đăng nhập')
    await context.addCookies([{ name: 'c_user', value: '100000000000001', domain: '.facebook.com', path: '/', secure: true }])
    await page.goto('https://www.facebook.com/')
    assert.equal(await probe(), 'đã đăng nhập')
    ok('trang facebook.com: có c_user = đã đăng nhập, không có = chưa đăng nhập')

    await context.clearCookies()
    await page.goto('https://www.facebook.com/checkpoint/123/')
    assert.equal(await probe(), 'checkpoint')
    ok('trang checkpoint vẫn ra checkpoint')

    // Trang lỗi thật: tab vừa nạp business.facebook.com không được (như khi bị chặn / mất mạng). Context riêng không có
    // route: khi bật chặn request, Chromium không chuyển sang trang lỗi.
    const errorContext = await browser.newContext()
    await errorContext.addCookies([{ name: 'c_user', value: '100000000000001', domain: '.facebook.com', path: '/', secure: true }])
    const errorPage = await errorContext.newPage()
    await errorPage.goto('https://business.facebook.com/content_management').catch(() => {})
    for (let i = 0; i < 50 && !/^chrome-error:/.test(errorPage.url()); i++) await errorPage.waitForTimeout(100)
    assert.match(errorPage.url(), /^chrome-error:/, `trang lỗi phải là chrome-error, đang là ${errorPage.url()}`)
    assert.equal(facebookTabLoginStatus(await errorPage.evaluate(LEGACY_PROBE)), 'chưa đăng nhập', 'bản cũ hạ nhầm tài khoản khi tab đang hiện trang lỗi')
    assert.equal(facebookTabLoginStatus(await errorPage.evaluate(FACEBOOK_TAB_LOGIN_PROBE)), null)
    await errorContext.close()
    ok('trang lỗi: bản cũ ra "chưa đăng nhập", bản mới giữ nguyên (null)')

    await page.goto('about:blank')
    assert.equal(await probe(), null)
    await page.goto('https://example.com/')
    assert.equal(await probe(), null)
    ok('trang không thuộc facebook.com: giữ nguyên (null)')
  } finally {
    await browser.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
  console.log(`OK ${checks} nhóm`)
})().catch(error => { console.error(error); process.exit(1) })

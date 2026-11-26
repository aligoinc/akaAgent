// Mục "Tin nhắn Facebook" trên menu bên trái: số đoạn chat chưa đọc ở góc biểu tượng (menu thu gọn) / cuối dòng
// (menu mở rộng) và ô hiện khi rê chuột. Dựng TopBar thật bằng esbuild rồi mở bằng Chromium của Playwright.
//   node scripts/run-facebook-messages-menu-ui-smoke.cjs
//   FB_MENU_UI_SHOTS=<thư mục> node scripts/run-facebook-messages-menu-ui-smoke.cjs   # kiểm + chụp màn hình
//   FB_MENU_UI_CHROMIUM=<đường dẫn Chrome> ...                                          # khi chưa cài Chromium của Playwright
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { chromium } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-fb-menu-ui-'))
  const shots = process.env.FB_MENU_UI_SHOTS || ''
  if (shots) mkdirSync(shots, { recursive: true })
  await build({ entryPoints: [join(__dirname, 'facebook-messages-menu-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    // TopBar lấy ảnh biểu tượng bằng `new URL(..., import.meta.url)`; bản dựng iife không có import.meta nên cho một địa chỉ giả.
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"file:///akaagent/smoke/TopBar.tsx"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="facebook-messages-menu-ui-smoke.css"><body><div id="root"></div><script src="facebook-messages-menu-ui-smoke.js"></script></body></html>')
  const chromiumPath = process.env.FB_MENU_UI_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : {})
  let cases = 0
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, locale: 'vi-VN' })
    await context.route(/^https?:/, route => route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    await page.goto(`file://${join(directory, 'index.html')}`)
    await page.waitForFunction(() => window.menuSmoke)
    // App mặc định giao diện sáng (themeStore thêm class này vào body).
    await page.evaluate(() => document.body.classList.add('theme-light'))
    const smoke = (method, ...args) => page.evaluate(([name, params]) => window.menuSmoke[name](...params), [method, args])
    const shot = async name => { if (shots) await page.screenshot({ path: join(shots, `fb-menu-${name}.png`) }) }
    const ok = name => { cases += 1; console.log(`PASS ${name}`) }

    const item = page.locator('.app-sidebar-nav-item').filter({ hasText: 'Tin nhắn Facebook' })
    const iconBadge = item.locator('.app-sidebar-icon-badge')
    const rowBadge = item.locator('.app-sidebar-item-badge')
    const tooltip = page.locator('#app-sidebar-fb-messages-tooltip')
    const visible = locator => locator.evaluate(node => {
      const style = getComputedStyle(node)
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
    })
    await item.waitFor()

    // 1. Trang chưa gửi số (chưa chọn tài khoản, vừa mở app): không số, title như các mục khác.
    assert.equal(await iconBadge.count(), 0)
    assert.equal(await tooltip.count(), 0)
    assert.equal(await item.getAttribute('title'), 'Tin nhắn Facebook')
    assert.equal(await item.getAttribute('aria-label'), 'Tin nhắn Facebook')
    ok('chưa có số: không hiện gì thêm')

    // 2. Ba tài khoản: 5 + 7, một tài khoản chưa đăng nhập. Menu thu gọn: số ở góc biểu tượng, ô rê chuột ẩn.
    const accounts = [
      { id: 1, name: 'fb LD', loggedIn: true },
      { id: 2, name: 'fb QN', loggedIn: true },
      { id: 3, name: 'fb AB', loggedIn: false }
    ]
    await smoke('setSummary', accounts, [[1, 5], [2, 7]])
    await iconBadge.waitFor()
    assert.equal(await iconBadge.innerText(), '12')
    assert.equal(await visible(iconBadge), true)
    assert.equal(await visible(rowBadge), false, 'menu thu gọn không hiện số cuối dòng')
    assert.equal(await item.getAttribute('aria-label'), 'Tin nhắn Facebook, 12 đoạn chat chưa đọc')
    assert.equal(await item.getAttribute('title'), null, 'có ô rê chuột thì bỏ title của trình duyệt')
    assert.equal(await item.getAttribute('aria-describedby'), 'app-sidebar-fb-messages-tooltip')
    assert.equal(await visible(tooltip), false, 'ô rê chuột ẩn khi chưa rê')
    ok('menu thu gọn: số 12 ở góc biểu tượng')

    // 3. Rê chuột: ô hiện tổng và từng tài khoản; tài khoản chưa đăng nhập ghi rõ.
    await item.hover()
    await page.waitForFunction(() => {
      const node = document.getElementById('app-sidebar-fb-messages-tooltip')
      return node && getComputedStyle(node).visibility === 'visible' && Number(getComputedStyle(node).opacity) === 1
    })
    assert.equal(await tooltip.locator('.fb-messages-nav-tooltip-total').innerText(), '12 đoạn chat chưa đọc')
    const rows = (await tooltip.locator('.fb-messages-nav-tooltip-row').allInnerTexts()).map(text => text.replace(/\s+/g, ' ').trim())
    assert.deepEqual(rows, ['FL fb LD 5', 'FQ fb QN 7', 'FA fb AB Chưa đăng nhập'])
    const box = await tooltip.boundingBox()
    const itemBox = await item.boundingBox()
    assert.ok(box.x > itemBox.x + itemBox.width, 'ô nằm bên phải mục menu')
    await shot('collapsed-hover')
    await page.mouse.move(600, 600)
    await page.waitForFunction(() => getComputedStyle(document.getElementById('app-sidebar-fb-messages-tooltip')).visibility === 'hidden')
    ok('rê chuột: ô hiện tổng và số từng tài khoản')

    // 3b. Bấm vào mục: sang trang Tin nhắn Facebook (cột trái đã có số từng tài khoản) thì ô mất, số vẫn còn.
    await item.hover()
    await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('app-sidebar-fb-messages-tooltip')).opacity) === 1)
    await item.click()
    await page.waitForFunction(() => document.querySelector('.app-sidebar-nav-item.active')?.textContent?.includes('Tin nhắn Facebook'))
    assert.equal(await tooltip.count(), 0, 'đang ở trang Tin nhắn thì không có ô')
    assert.equal(await iconBadge.innerText(), '12')
    assert.equal(await item.getAttribute('title'), 'Tin nhắn Facebook')
    await page.getByRole('button', { name: 'Chiến dịch' }).click()
    await tooltip.waitFor({ state: 'attached' })
    assert.equal(await visible(tooltip), false, 'rời trang Tin nhắn: ô có lại nhưng ẩn tới khi rê chuột')
    ok('bấm vào mục: ô mất, số vẫn còn')

    // 3c. Bấm chuột xong rời chuột đi thì ô không bị giữ lại vì nút còn được chọn; dùng phím Tab thì ô vẫn hiện.
    await page.mouse.move(600, 600)
    await page.getByRole('button', { name: 'Trình duyệt' }).focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-describedby')), 'app-sidebar-fb-messages-tooltip')
    await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('app-sidebar-fb-messages-tooltip')).opacity) === 1)
    await page.getByRole('button', { name: 'Chiến dịch' }).click()
    await page.mouse.move(600, 600)
    await page.waitForFunction(() => getComputedStyle(document.getElementById('app-sidebar-fb-messages-tooltip')).visibility === 'hidden')
    ok('phím Tab: ô hiện; chuột rời đi: ô ẩn')

    // 4. Menu mở rộng: số cuối dòng, số ở góc biểu tượng ẩn.
    await page.getByRole('button', { name: 'Mở rộng menu' }).click()
    await page.locator('.app-sidebar.is-expanded').waitFor()
    // Menu trượt ra có hiệu ứng: chờ đủ rộng rồi mới đo / chụp.
    await page.waitForFunction(() => document.querySelector('.app-sidebar').getBoundingClientRect().width >= 239)
    assert.equal(await visible(rowBadge), true)
    assert.equal(await rowBadge.innerText(), '12')
    assert.equal(await visible(iconBadge), false)
    const rowBox = await rowBadge.boundingBox()
    const expandedBox = await item.boundingBox()
    assert.ok(rowBox.x + rowBox.width > expandedBox.x + expandedBox.width - 20, 'số nằm sát mép phải dòng')
    await shot('expanded')
    await page.getByRole('button', { name: 'Thu gọn menu' }).click()
    await page.locator('.app-sidebar.is-collapsed').waitFor()
    ok('menu mở rộng: số cuối dòng')

    // 5. Từ 100 trở lên: 99+.
    await smoke('setSummary', accounts, [[1, 60], [2, 45]])
    await page.waitForFunction(() => document.querySelector('.app-sidebar-icon-badge')?.textContent === '99+')
    assert.equal(await item.getAttribute('aria-label'), 'Tin nhắn Facebook, hơn 99 đoạn chat chưa đọc')
    await item.hover()
    await page.waitForFunction(() => getComputedStyle(document.getElementById('app-sidebar-fb-messages-tooltip')).visibility === 'visible')
    assert.equal(await tooltip.locator('.fb-messages-nav-tooltip-total').innerText(), '105 đoạn chat chưa đọc')
    await page.mouse.move(600, 600)
    ok('từ 100: hiện 99+, ô rê chuột ghi số thật')

    // 6. Không có tin mới / đang tải: không hiện số, ô rê chuột vẫn có.
    await smoke('setSummary', accounts, [[1, 0]])
    await page.waitForFunction(() => !document.querySelector('.app-sidebar-icon-badge'))
    assert.equal(await rowBadge.count(), 0)
    assert.equal(await item.getAttribute('aria-label'), 'Tin nhắn Facebook')
    assert.equal(await tooltip.locator('.fb-messages-nav-tooltip-total').innerText(), 'Không có tin mới')
    const zeroRows = (await tooltip.locator('.fb-messages-nav-tooltip-row').allInnerTexts()).map(text => text.replace(/\s+/g, ' ').trim())
    assert.deepEqual(zeroRows, ['FL fb LD 0', 'FQ fb QN Đang tải...', 'FA fb AB Chưa đăng nhập'])
    ok('không có tin mới: không hiện số (kể cả 0)')

    // 7. Nhiều tài khoản: ô rê chuột hiện 8 dòng + "+N tài khoản khác".
    const many = Array.from({ length: 11 }, (_, index) => ({ id: index + 1, name: `fb ${index + 1}`, loggedIn: true }))
    await smoke('setSummary', many, many.map(account => [account.id, 1]))
    await page.waitForFunction(() => document.querySelector('.app-sidebar-icon-badge')?.textContent === '11')
    assert.equal(await tooltip.locator('.fb-messages-nav-tooltip-row').count(), 8)
    assert.equal(await tooltip.locator('.fb-messages-nav-tooltip-more').innerText(), '+3 tài khoản khác')
    ok('nhiều tài khoản: 8 dòng + số tài khoản còn lại')

    // 8. Trang gỡ (đăng xuất): về như chưa có số.
    await smoke('clearSummary')
    await page.waitForFunction(() => !document.querySelector('.app-sidebar-icon-badge'))
    assert.equal(await tooltip.count(), 0)
    assert.equal(await item.getAttribute('title'), 'Tin nhắn Facebook')
    ok('trang gỡ: bỏ số và ô rê chuột')

    // 9. Giao diện tối vẫn đọc được.
    await page.evaluate(() => document.body.classList.remove('theme-light'))
    await smoke('setSummary', accounts, [[1, 5], [2, 7]])
    await iconBadge.waitFor()
    await item.hover()
    await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('app-sidebar-fb-messages-tooltip')).opacity) === 1)
    await shot('dark-hover')
    ok('giao diện tối')

    const errors = await page.evaluate(() => window.menuSmoke.errors)
    assert.deepEqual(errors, [])
    ok('không có lỗi trang')
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
  console.log(`\n${cases} nhóm đạt`)
}

main().catch(error => {
  console.error('FAIL', error)
  process.exit(1)
})

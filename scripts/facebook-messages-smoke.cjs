#!/usr/bin/env node
/**
 * Kiểm phần dùng chung của trang "Tin nhắn Facebook" (src/shared/facebookMessages.ts):
 * - đọc danh sách tài khoản đã chọn từ localStorage;
 * - đoạn script đếm đoạn chat chưa đọc, chạy trên trang giả dựng theo DOM
 *   facebook.com/messages thật (xem 20/11/2026).
 *
 * Chạy: CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/facebook-messages-smoke.cjs
 * Không có CHROMIUM_PATH thì bỏ qua phần chạy script trên trang.
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-messages-smoke-'))
const outfile = path.join(outDir, 'facebookMessages.cjs')
buildSync({
  entryPoints: [path.join(root, 'src/shared/facebookMessages.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile,
  logLevel: 'warning'
})
const shared = require(outfile)

let passed = 0
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed += 1
    console.log(`PASS ${name}`)
  })
}

const UNREAD_ROW = (id, name, e2ee = false) => `
  <a href="/messages/${e2ee ? 'e2ee/' : ''}t/${id}/" role="link">
    <span>${name}</span>
    <div style="position:absolute;clip:rect(0,0,0,0);width:1px;height:1px">Tin nhắn chưa đọc:</div>
    <span>Tin mới</span>
  </a>`
const READ_ROW = (id, name) => `
  <a href="/messages/t/${id}/" role="link"><span>${name}</span><span>Bạn: đã xem · 2 ngày</span></a>`

const FAKE_MESSENGER = `<!doctype html><html lang="vi"><body>
  <div role="navigation"><a href="/messages/t/">Đoạn chat</a></div>
  <div role="tablist"><div role="tab"><span>Tất cả</span></div><div role="tab"><span>Chưa đọc</span></div></div>
  <div role="grid">
    ${UNREAD_ROW('1001', 'Khách A')}
    ${UNREAD_ROW('1002', 'Khách B', true)}
    ${READ_ROW('1003', 'Khách C')}
    ${READ_ROW('1004', 'Tin nhắn chưa đọc: là chữ khách gõ')}
    ${UNREAD_ROW('1001', 'Khách A (dòng lặp)')}
  </div>
</body></html>`

async function main() {
  await check('đọc danh sách đã chọn: bỏ id sai, bỏ trùng', () => {
    assert.deepEqual(shared.parseFacebookMessagesSelection('[3,"4",3,-1,"x",5.5,0]'), [3, 4])
    assert.deepEqual(shared.parseFacebookMessagesSelection('{"a":1}'), [])
    assert.deepEqual(shared.parseFacebookMessagesSelection('không phải json'), [])
    assert.deepEqual(shared.parseFacebookMessagesSelection(null), [])
  })

  await check('khoá lưu theo tổ chức + nhân viên', () => {
    assert.equal(shared.facebookMessagesSelectionKey(1, 4), 'aka.fbMessages.selectedAccountIds.v1:1:4')
  })

  await check('số trên huy hiệu', () => {
    assert.equal(shared.formatFacebookUnreadBadge(0), '0')
    assert.equal(shared.formatFacebookUnreadBadge(99), '99')
    assert.equal(shared.formatFacebookUnreadBadge(100), '99+')
  })

  await check('chuẩn hoá kết quả script', () => {
    assert.equal(shared.normalizeFacebookUnreadCount(3), 3)
    assert.equal(shared.normalizeFacebookUnreadCount(0), 0)
    assert.equal(shared.normalizeFacebookUnreadCount(null), null)
    assert.equal(shared.normalizeFacebookUnreadCount(-1), null)
    assert.equal(shared.normalizeFacebookUnreadCount('3'), null)
  })

  await check('script đếm là JS hợp lệ (regex còn dấu \\)', () => {
    assert.ok(shared.FACEBOOK_UNREAD_COUNT_SCRIPT.includes('/^\\/messages\\/(e2ee\\/)?t\\/?$/'))
    // eslint-disable-next-line no-new-func
    new Function(`return ${shared.FACEBOOK_UNREAD_COUNT_SCRIPT}`)
  })

  const chromiumPath = process.env.CHROMIUM_PATH
  if (!chromiumPath) {
    console.log('SKIP chạy script trên trang giả (chưa đặt CHROMIUM_PATH)')
  } else {
    const { chromium } = require(path.join(root, 'node_modules/playwright'))
    const browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
    try {
      const page = await browser.newPage()
      const run = () => page.evaluate(script => (0, eval)(script), shared.FACEBOOK_UNREAD_COUNT_SCRIPT)

      await check('trang Messenger giả: 2 đoạn chưa đọc (tab "Chưa đọc", link gốc, dòng lặp, chữ khách gõ không tính)', async () => {
        await page.setContent(FAKE_MESSENGER)
        assert.equal(await run(), 2)
      })

      await check('mọi đoạn đã đọc: 0', async () => {
        await page.setContent(`<body>${READ_ROW('2001', 'A')}${READ_ROW('2002', 'B')}</body>`)
        assert.equal(await run(), 0)
      })

      await check('trang khác (không có danh sách đoạn chat): null để giữ số cũ', async () => {
        await page.setContent('<body><a href="/messages/t/">Đoạn chat</a><a href="/thichmon/">Trang cá nhân</a></body>')
        assert.equal(await run(), null)
      })

      await check('giao diện tiếng Anh: "Unread message:"', async () => {
        await page.setContent(`<body><a href="/messages/t/3001/"><span>A</span><div>Unread message:</div></a>${READ_ROW('3002', 'B')}</body>`)
        assert.equal(await run(), 1)
      })
    } finally {
      await browser.close()
    }
  }

  fs.rmSync(outDir, { recursive: true, force: true })
  console.log(`\n${passed} nhóm đạt`)
}

main().catch(error => {
  console.error('FAIL', error)
  process.exit(1)
})

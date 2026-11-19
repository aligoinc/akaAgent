// Ảnh đính kèm câu hỏi của Hỏi đáp AI trên Desktop: giao diện thật (form hỏi + tab Trợ lý) với IPC giả lập.
// Dựng renderer bằng esbuild rồi mở bằng Chromium của Playwright (cùng nhân với Electron), không cần binary Electron, không ra mạng.
//   node scripts/run-ai-chat-images-ui-smoke.cjs
//   AI_CHAT_UI_SHOTS=<thư mục> node scripts/run-ai-chat-images-ui-smoke.cjs   # kiểm + chụp màn hình
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const zlib = require('node:zlib')
const { build } = require('esbuild')
const { chromium } = require('playwright')

/** PNG một màu (RGB) dựng bằng tay, đủ để trình duyệt giải mã và thu nhỏ. */
function png(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0).map((_, i) => [r, g, b][i % 3])])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
/** BMP 24 bit một màu: định dạng app không nhận, giao diện phải tự chuyển sang JPG. */
function bmp(width, height, [r, g, b]) {
  const rowSize = Math.ceil(width * 3 / 4) * 4
  const data = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set([b, g, r], y * rowSize + x * 3)
  const header = Buffer.alloc(54)
  header.write('BM'); header.writeUInt32LE(54 + data.length, 2); header.writeUInt32LE(54, 10); header.writeUInt32LE(40, 14)
  header.writeInt32LE(width, 18); header.writeInt32LE(height, 22); header.writeUInt16LE(1, 26); header.writeUInt16LE(24, 28); header.writeUInt32LE(data.length, 34)
  return Buffer.concat([header, data])
}

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-ai-chat-images-ui-'))
  const shots = process.env.AI_CHAT_UI_SHOTS || ''
  if (shots) mkdirSync(shots, { recursive: true })
  await build({ entryPoints: [join(__dirname, 'ai-chat-images-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="ai-chat-images-ui-smoke.css"><body><div id="root"></div><script src="ai-chat-images-ui-smoke.js"></script></body></html>')
  const files = {
    a: join(directory, 'man-hinh-loi.png'), b: join(directory, 'cai-dat.png'), c: join(directory, 'ket-qua.png'), d: join(directory, 'thua.png'),
    bmp: join(directory, 'anh-chup.bmp'), text: join(directory, 'ghi-chu.txt')
  }
  writeFileSync(files.a, png(320, 200, [220, 80, 60])); writeFileSync(files.b, png(320, 200, [60, 140, 220])); writeFileSync(files.c, png(320, 200, [70, 170, 90]))
  writeFileSync(files.d, png(64, 64, [120, 120, 120])); writeFileSync(files.bmp, bmp(200, 120, [240, 190, 40])); writeFileSync(files.text, 'không phải ảnh')
  const chromiumPath = process.env.AI_CHAT_UI_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : {})
  let cases = 0
  try {
    const context = await browser.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: shots ? 2 : 1, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' })
    const page = await context.newPage()
    // Ảnh của câu đã gửi hiện bằng URL của kho media: trả lại đúng tệp mà "tiến trình chính" giả đã nhận. Mọi địa chỉ khác bị chặn.
    await context.route(/^https?:/, async route => {
      const stored = await page.evaluate(url => window.aiChatSmoke.file(url), route.request().url()).catch(() => null)
      if (!stored) return route.abort()
      const [contentType, base64] = stored.split(';')
      return route.fulfill({ status: 200, contentType, body: Buffer.from(base64, 'base64') })
    })
    page.setDefaultTimeout(10000)
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(String(error.message)))
    page.on('console', message => { if (message.type() === 'error' && !/net::ERR_FAILED/.test(message.text())) pageErrors.push(message.text().slice(0, 400)) })
    await page.goto(`file://${join(directory, 'index.html')}`)
    await page.waitForFunction(() => window.aiChatSmoke)
    const reset = options => page.evaluate(value => window.aiChatSmoke.reset(value), options || {})
    const lastCall = action => page.evaluate(value => window.aiChatSmoke.lastCall(value), action)
    const uploads = () => page.evaluate(() => window.aiChatSmoke.server.uploads)
    const shot = async name => { if (shots) await page.screenshot({ path: join(shots, `desktop-${name}.png`) }) }
    const ok = name => { cases += 1; console.log(`PASS ${name}`) }
    const openModal = async () => { await page.locator('#open-modal:not([disabled])').click(); await modal.waitFor() }
    const modal = page.locator('.ai-chat-start-modal')
    const panel = page.locator('.ai-chat-panel')
    const send = modal.getByRole('button', { name: 'Gửi câu hỏi' })
    const ready = scope => scope.locator('.ai-chat-attachment.ready')

    // 1. Database chưa nhận ảnh (lõi chưa vá): không có nút đính ảnh, hỏi như trước.
    await reset({ maxImages: 0 })
    await openModal()
    assert.equal(await modal.getByRole('button', { name: 'Đính kèm ảnh' }).count(), 0)
    assert.equal(await modal.locator('.ai-chat-attach-row').count(), 0)
    await modal.locator('textarea').fill('Vì sao chiến dịch chưa chạy?')
    await send.click()
    await panel.locator('.ai-chat-turn').waitFor()
    assert.equal(await panel.getByRole('button', { name: 'Đính kèm ảnh' }).count(), 0)
    assert.equal('images' in (await lastCall('open')), false, 'lệnh open không có khóa images')
    ok('database chưa nhận ảnh: không hiện nút đính ảnh ở form hỏi lẫn ô hỏi tiếp')

    // 2. Form hỏi: đính 2 ảnh, gửi kèm câu hỏi; ảnh hiện trong hội thoại.
    await reset({ maxImages: 3 })
    await openModal()
    await modal.getByRole('button', { name: 'Đính kèm ảnh' }).waitFor()
    assert.match(await modal.locator('.ai-chat-attach-row').innerText(), /Tối đa 3 ảnh, mỗi ảnh 5 MB/)
    await modal.locator('input[type=file]').setInputFiles([files.a, files.b])
    await page.waitForFunction(() => document.querySelectorAll('.ai-chat-start-modal .ai-chat-attachment.ready').length === 2)
    await modal.locator('textarea').fill('Chiến dịch báo lỗi như trong ảnh, xử lý thế nào?')
    await shot('form-hoi-2-anh')
    await send.click()
    await panel.locator('.ai-chat-message-images img').first().waitFor()
    const opened = await lastCall('open')
    assert.equal(opened.images.length, 2)
    assert.ok(opened.images.every(url => /^https:\/\/pub-smoke\.r2\.dev\/aka-agent\/ai-chat\/1\/1\/[0-9a-f-]{36}\.png$/.test(url)))
    assert.equal(await panel.locator('.ai-chat-message-images img').count(), 2)
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.ai-chat-message-images img')).every(img => img.complete && img.naturalWidth > 0))
    assert.equal(await panel.locator('.ai-chat-message-images a').first().getAttribute('target'), '_blank')
    await shot('hoi-thoai-cau-co-anh')
    ok('form hỏi: đính 2 ảnh, gửi kèm câu hỏi, ảnh hiện trong hội thoại (bấm mở bằng trình duyệt ngoài)')

    // 3. Ô hỏi tiếp: câu đang chờ thì khoá nút; dừng câu rồi gửi chỉ có ảnh.
    const attach = panel.getByRole('button', { name: 'Đính kèm ảnh' })
    assert.equal(await attach.isDisabled(), true, 'đang chờ câu trả lời thì không đính ảnh được')
    await panel.getByRole('button', { name: 'Dừng' }).click()
    await page.waitForFunction(() => !document.querySelector('.ai-chat-panel .ai-chat-attach-button')?.disabled)
    await panel.locator('input[type=file]').setInputFiles([files.c])
    await ready(panel).first().waitFor()
    await shot('hoi-tiep-co-anh')
    await panel.locator('.assistant-chat-send').click()
    await page.waitForFunction(() => document.querySelectorAll('.ai-chat-turn').length === 2)
    const asked = await lastCall('ask')
    assert.equal(asked.question, '')
    assert.equal(asked.images.length, 1)
    assert.match(await panel.locator('.ai-chat-turn').nth(1).innerText(), /\[Gửi 1 ảnh\]/)
    assert.equal(await panel.locator('.ai-chat-attachment').count(), 0, 'gửi xong thì bỏ ảnh đang đính')
    ok('ô hỏi tiếp: khoá khi đang chờ, gửi được câu chỉ có ảnh')

    // 4. Quá số ảnh: chỉ nhận đủ 3, báo rõ, nút đính ảnh khoá.
    await reset({ maxImages: 3 })
    await openModal()
    await modal.locator('input[type=file]').setInputFiles([files.a, files.b, files.c, files.d])
    await page.waitForFunction(() => document.querySelectorAll('.ai-chat-start-modal .ai-chat-attachment.ready').length === 3)
    assert.match(await modal.locator('.ai-chat-attachment-note').innerText(), /tối đa 3 ảnh/)
    assert.equal(await modal.getByRole('button', { name: 'Đính kèm ảnh' }).isDisabled(), true)
    assert.equal((await uploads()).length, 3, 'ảnh thứ tư không được tải lên')
    await modal.getByRole('button', { name: /Bỏ ảnh cai-dat\.png/ }).click()
    assert.equal(await modal.locator('.ai-chat-attachment').count(), 2)
    assert.equal(await modal.getByRole('button', { name: 'Đính kèm ảnh' }).isDisabled(), false)
    ok('quá 3 ảnh: chỉ nhận 3, báo rõ; bỏ bớt thì đính tiếp được')

    // 5. Chỉ có ảnh, không chữ: vẫn gửi được.
    await modal.locator('textarea').fill('')
    assert.equal(await send.isDisabled(), false)
    await send.click()
    await panel.locator('.ai-chat-turn').waitFor()
    const imageOnly = await lastCall('open')
    assert.equal(imageOnly.question, '')
    assert.equal(imageOnly.images.length, 2)
    ok('form hỏi: gửi được câu chỉ có ảnh')

    // 6. Định dạng khác (BMP) được chuyển sang JPG trong app; tệp không phải ảnh thì báo lỗi và chặn gửi.
    await reset({ maxImages: 3 })
    await openModal()
    await modal.locator('input[type=file]').setInputFiles([files.bmp])
    await ready(modal).first().waitFor()
    assert.equal((await uploads())[0].mimeType, 'image/jpeg')
    await modal.locator('input[type=file]').setInputFiles([files.text])
    await modal.locator('.ai-chat-attachment.error').waitFor()
    assert.match(await modal.locator('.ai-chat-attachment-note.error').innerText(), /Bỏ ảnh lỗi rồi chọn lại/)
    assert.equal((await uploads()).length, 1, 'tệp không phải ảnh không được tải lên')
    await modal.locator('textarea').fill('Có một tệp lỗi')
    await send.click()
    assert.match(await modal.locator('.assistant-inline-error').innerText(), /Có ảnh chưa tải lên được/)
    assert.equal(await lastCall('open'), null, 'còn ảnh lỗi thì chưa gửi câu hỏi')
    await shot('form-hoi-anh-loi')
    await modal.getByRole('button', { name: /Bỏ ảnh ghi-chu\.txt/ }).click()
    await send.click()
    await panel.locator('.ai-chat-turn').waitFor()
    assert.equal((await lastCall('open')).images.length, 1)
    ok('BMP được chuyển sang JPG; tệp không phải ảnh bị báo lỗi và phải bỏ ra mới gửi được')

    // 7. Đang tải ảnh thì chưa gửi được; kho lỗi thì báo lỗi của ảnh.
    await reset({ maxImages: 3, uploadDelayMs: 1500 })
    await openModal()
    await modal.locator('textarea').fill('Chờ ảnh tải xong')
    await modal.locator('input[type=file]').setInputFiles([files.a])
    await modal.locator('.ai-chat-attachment.uploading').waitFor()
    assert.equal(await send.isDisabled(), true, 'đang tải ảnh thì nút Gửi khoá')
    await ready(modal).first().waitFor()
    assert.equal(await send.isDisabled(), false)
    await modal.getByRole('button', { name: 'Huỷ' }).click()
    await reset({ maxImages: 3, failUpload: 'ai_chat_image_upload_failed' })
    await openModal()
    await modal.locator('input[type=file]').setInputFiles([files.a])
    await modal.locator('.ai-chat-attachment.error').waitFor()
    assert.match(await modal.locator('.ai-chat-attachment-note.error').innerText(), /Không tải được ảnh lên/)
    ok('đang tải ảnh thì khoá nút Gửi; kho lỗi thì báo ngay trên ảnh')

    // 8. Dán ảnh chụp màn hình vào ô câu hỏi.
    await reset({ maxImages: 3 })
    await openModal()
    await modal.locator('textarea').focus()
    await page.evaluate(async bytes => {
      const data = new DataTransfer()
      data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }))
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, Array.from(png(120, 80, [150, 90, 200])))
    await ready(modal).first().waitFor()
    assert.equal((await uploads()).length, 1)
    ok('dán ảnh chụp màn hình vào ô câu hỏi: ảnh được đính kèm')

    assert.deepEqual(pageErrors, [], 'không có lỗi console/trang trong suốt bài kiểm')
    console.log(`PASS (${cases} nhóm)`)
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })

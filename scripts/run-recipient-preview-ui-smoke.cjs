// Kiểm thử giao diện khung "Khách sẽ nhận" trên form chiến dịch Desktop thật (Electron, IPC giả, chặn mạng).
// Chạy: node scripts/run-recipient-preview-ui-smoke.cjs   (container không có màn hình: xvfb-run -a node …)
// Ảnh chụp: RECIPIENT_PREVIEW_ARTIFACTS_DIR (mặc định thư mục tạm, xoá khi xong).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { _electron } = require('playwright')

const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipient-preview-ui-'))
const artifacts = process.env.RECIPIENT_PREVIEW_ARTIFACTS_DIR || path.join(dir, 'artifacts')
fs.mkdirSync(artifacts, { recursive: true })
const flat = (text) => String(text || '').replace(/\s+/g, ' ').trim()

async function main() {
  let app
  try {
    await build({
      entryPoints: [path.join(__dirname, 'recipient-preview-ui-smoke.tsx')], outdir: dir, bundle: true, platform: 'browser', format: 'iife',
      jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning'
    })
    fs.writeFileSync(path.join(dir, 'index.html'), '<html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="recipient-preview-ui-smoke.css"><body><div id="root"></div><script src="recipient-preview-ui-smoke.js"></script></body></html>')
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:true,width:1600,height:1000,enableLargerThanScreen:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});w.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir, 'index.html'))})})`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: ['--force-device-scale-factor=2', path.join(dir, 'main.cjs')], cwd: root, env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    page.on('pageerror', (error) => console.error(`[renderer] ${error.stack || error.message}`))
    page.on('console', (message) => { if (message.type() === 'error') console.error(`[renderer console] ${message.text()}`) })
    await page.waitForFunction(() => !!window.rpSmoke)
    const panel = page.locator('aside.rp-panel')
    const toggle = page.getByRole('button', { name: /^Xem trước khách sẽ nhận/ })
    const saveDraft = page.getByRole('button', { name: 'Lưu nháp', exact: true })
    const open = async (scenario, agent = false) => {
      await page.evaluate(({ scenario, agent }) => window.rpSmoke.open(scenario, agent), { scenario, agent })
      await page.locator('.campaign-full-modal').waitFor()
      await page.waitForTimeout(300)
    }
    const closedForm = () => page.getByText('Đã đóng', { exact: true }).waitFor()
    // Cửa sổ phải hiện (trong container là màn hình ảo xvfb): cửa sổ ẩn thì page.screenshot treo còn
    // webContents.capturePage trả khung hình cũ, ảnh chụp không khớp DOM đã kiểm.
    const shot = async (name) => {
      await page.waitForTimeout(150)
      await page.screenshot({ path: path.join(artifacts, name), timeout: 30000 })
    }

    // 1. Nháp giống hệt dù khung mở hay đóng: khung chỉ đọc state form.
    await open('zalo')
    await panel.waitFor()
    await saveDraft.click()
    await closedForm()
    await open('zalo')
    await panel.waitFor()
    await toggle.click()
    await panel.waitFor({ state: 'detached' })
    await saveDraft.click()
    await closedForm()
    const payloads = await page.evaluate(() => window.rpSmoke.state.savedPayloads)
    assert.equal(payloads.length, 2)
    assert.deepEqual(payloads[1], payloads[0], 'draft payload must not depend on the preview panel')
    assert.equal(JSON.stringify(payloads[0]).includes('recipient'), false, 'no preview state in the draft')

    // 2. Lựa chọn đóng được nhớ (chỉ trên máy này); mở lại thì nhớ là mở.
    await open('zalo')
    assert.equal(await panel.count(), 0, 'panel stays closed after the user closed it')
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
    await toggle.click()
    await panel.waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('aka.campaignForm.preview.v1')), '1')
    assert.equal(await page.locator('.campaign-full-modal.has-recipient-preview').count(), 1, 'modal widens for the dock')
    assert.equal(await panel.evaluate(el => el.classList.contains('is-dock')), true)

    // 3. Thứ tự khách nhận, media theo đúng runtime (2 ảnh đọc được + 1 file thiếu), chữ đã điền khách mẫu.
    const steps = panel.locator('.rp-steps button')
    assert.equal(await steps.count(), 2)
    assert.equal(flat(await steps.nth(0).innerText()), '1 Tin nhắn 3')
    assert.equal(flat(await steps.nth(1).innerText()), '2 Lời mời kết bạn 1')
    await panel.locator('.rp-phone .rp-album img').nth(1).waitFor()
    assert.equal(await panel.locator('.rp-phone .rp-album.count-3').count(), 1)
    assert.equal(await panel.locator('.rp-phone .rp-album img').count(), 2)
    assert.match(await panel.locator('.rp-phone .rp-album img').first().getAttribute('src'), /^data:image\/png;base64,/)
    assert.equal(flat(await panel.locator('.rp-phone .rp-media-tile.is-local').innerText()), 'File xem trước không còn tồn tại.', 'IPC error prefix is stripped')
    assert.equal(flat(await panel.locator('.rp-caption-line').innerText()), 'Khách nhận 3 media trước, rồi tới chữ.')
    const textBubble = panel.locator('.rp-phone .rp-bubble:not(.is-media)').first()
    assert.equal(flat(await textBubble.innerText()), 'Chào chị Nguyễn Minh Anh, shop vừa về mẫu mới')
    const reads = await page.evaluate(() => window.rpSmoke.state.localReads.slice())
    assert.deepEqual([...new Set(reads)].sort(), ['/Users/thao/anh/ao-len.png', '/Users/thao/anh/missing-quan.png'])
    await shot('desktop-zalo-dock.png')

    // 4. Gõ ở ô nội dung: chỉ khung đọc lại nội dung (form không vẽ lại), và khung đi theo con trỏ.
    const textarea = page.locator('textarea.message-content-textarea')
    const caretTo = async (needle, offset = 0) => {
      await textarea.evaluate((el, { needle, offset }) => {
        el.focus()
        const at = el.value.indexOf(needle) + offset
        el.setSelectionRange(at, at)
      }, { needle, offset })
      // Phím mũi tên để React nhận sự kiện chọn như người dùng thật.
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowLeft')
    }
    await caretTo(' | Xin chào')
    await page.keyboard.type(' XYZ')
    await page.waitForFunction(() => document.querySelector('aside.rp-panel .rp-phone')?.textContent?.includes('mẫu mới XYZ'))
    assert.equal(flat(await panel.locator('.rp-pager span').innerText()), 'Nội dung 1 / 3')
    await caretTo('Xin chào', 3)
    await page.waitForFunction(() => document.querySelector('aside.rp-panel .rp-pager span')?.textContent === 'Nội dung 2 / 3')
    // Spin {anh|chị} theo hạt giống của khung; ngày mai tính từ Lịch chạy 01/01/2035.
    assert.match(flat(await textBubble.innerText()), /^Xin chào (anh|chị) Khách VIP, ưu đãi tới 02\/01$/)
    assert.match(flat(await panel.locator('.rp-meta-row').innerText()), /ký tự · 3 ảnh/)

    // 5. Cảnh báo biến lạ: nút Sửa đưa con trỏ tới đúng phiên bản trong ô nội dung.
    const warning = panel.locator('.rp-warning').filter({ hasText: '#{TEN}' })
    assert.equal(flat(await warning.locator('span').innerText()), 'Nội dung 3 có #{TEN}: khách sẽ thấy nguyên chữ này.')
    await warning.getByRole('button', { name: 'Sửa', exact: true }).click()
    await page.waitForFunction(() => {
      const el = document.querySelector('textarea.message-content-textarea')
      return document.activeElement === el && el.value.slice(el.selectionStart, el.selectionEnd) === 'Bản 3 cho #{TEN}'
    })
    assert.equal(flat(await panel.locator('.rp-pager span').innerText()), 'Nội dung 3 / 3')

    // 6. Đổi chế độ xem theo dòng data: biến hồ sơ Zalo chờ lúc gửi, dữ liệu trống được đánh dấu.
    await panel.getByLabel('Xem như').selectOption('row:1')
    await page.waitForFunction(() => document.querySelector('aside.rp-panel .rp-hint.is-accent')?.textContent?.includes('Dòng 2 nhận Nội dung 2'))
    assert.equal(await panel.locator('.rp-phone .rp-token.is-empty').count(), 1, 'INFO1 is empty on row 2')
    await panel.getByLabel('Xem như').selectOption('sample')

    // 7. Nút Xem trước của lời mời kết bạn mở đúng màn lời mời.
    await page.locator('.message-personalization-field-title').filter({ hasText: 'Nội dung kết bạn' }).getByRole('button', { name: 'Xem trước', exact: true }).click()
    await panel.locator('.rp-friend-card').waitFor()
    assert.match(flat(await panel.locator('.rp-friend-message').innerText()), /^Chào Nguyễn Minh Anh, em là Thảo/)
    assert.match(flat(await panel.locator('.rp-meta-row').innerText()), /\/150 ký tự sau khi điền/)
    await shot('desktop-zalo-friend-request.png')

    // 8. Xem tất cả: lưới thẻ, Esc đóng lưới mà khung vẫn mở.
    await steps.nth(0).click()
    await panel.getByRole('button', { name: 'Xem tất cả', exact: true }).click()
    const gallery = page.getByRole('dialog', { name: 'Tất cả phiên bản khách có thể nhận' })
    await gallery.waitFor()
    assert.equal(await gallery.locator('.rp-card').count(), 3)
    // Nội dung 2 dùng INFO1 mà dòng 2 trống; Nội dung 3 có biến lạ #{TEN}.
    assert.equal(await gallery.locator('.rp-card.has-warning').count(), 2)
    assert.equal(await gallery.locator('.rp-card').nth(2).locator('.rp-card-warning').filter({ hasText: '#{TEN}' }).count(), 1)
    assert.equal(await gallery.locator('.rp-card').nth(1).locator('.rp-card-warning').filter({ hasText: 'INFO1' }).count(), 1)
    await page.waitForTimeout(300)
    await shot('desktop-zalo-gallery.png')
    await page.keyboard.press('Escape')
    await gallery.waitFor({ state: 'detached' })
    assert.equal(await panel.count(), 1)

    // 9. SMS: màn tin nhắn SMS, đếm tin theo luật sẵn có, cảnh báo khách nhận bản không dấu.
    await page.evaluate(() => window.rpSmoke.close())
    await open('sms')
    await panel.waitFor()
    assert.equal(flat(await panel.locator('.rp-channel').innerText()), 'SMS')
    assert.equal(await panel.locator('.rp-screen.is-sms').count(), 1)
    assert.equal(flat(await panel.locator('.rp-phone .rp-bubble').first().innerText()),
      'Chao Tran Quoc Bao, uu dai 20% cho don trong tuan nay. Goi 0987654321 de dat hang')
    assert.match(flat(await panel.locator('.rp-meta-row').innerText()), /^\d+ ký tự · 1 tin · không dấu/)
    assert.equal(await panel.locator('.rp-warning').filter({ hasText: 'Đang tắt “Tiếng Việt có dấu”: khách nhận bản không dấu.' }).count(), 1)
    await shot('desktop-sms-dock.png')

    // 10. Facebook giữ bản xem trước cũ: không có nút và không có khung mới.
    await page.evaluate(() => window.rpSmoke.close())
    await open('facebook')
    assert.equal(await toggle.count(), 0)
    assert.equal(await panel.count(), 0)

    // 11. Form Agent: khung mặc định đóng, mở thì nổi trên vùng chat.
    await page.evaluate(() => window.rpSmoke.close())
    await open('zalo', true)
    assert.equal(await panel.count(), 0, 'agent form starts with the preview closed')
    await toggle.click()
    await panel.waitFor()
    assert.equal(await panel.evaluate(el => el.classList.contains('is-overlay')), true)
    await panel.locator('.rp-phone .rp-album img').nth(1).waitFor()
    await page.waitForTimeout(200)
    await shot('desktop-agent-overlay.png')
    await panel.getByRole('button', { name: 'Đóng khung xem trước', exact: true }).click()
    await panel.waitFor({ state: 'detached' })

    // 12. Nội dung nâng cao: khung theo từng mục, ô xem trước trong modal dùng cùng luật (media trước rồi chữ).
    await page.evaluate(() => window.rpSmoke.close())
    await open('zaloAdvanced')
    await panel.waitFor()
    assert.equal(flat(await panel.locator('.rp-pager span').innerText()), 'Nội dung 1 / 2')
    await panel.locator('.rp-phone .rp-album img').nth(1).waitFor()
    assert.equal(flat(await panel.locator('.rp-caption-line').innerText()), 'Khách nhận 2 media trước, rồi tới chữ.')
    assert.equal(await panel.locator('.rp-chip').filter({ hasText: 'Theo con trỏ' }).count(), 0, 'no caret follow for advanced content')
    await page.getByRole('button', { name: 'Thêm nội dung', exact: true }).click()
    const manualModal = page.locator('.campaign-manual-content-modal')
    await manualModal.waitFor()
    const itemPreview = manualModal.locator('.rp-item-preview')
    await itemPreview.locator('.rp-album img').nth(1).waitFor()
    assert.equal(flat(await itemPreview.locator('.rp-bubble:not(.is-media)').innerText()), 'Mục một cho Nguyễn Minh Anh')
    assert.equal(flat(await itemPreview.locator('.rp-caption-line').innerText()), 'Khách nhận 2 media trước, rồi tới chữ.')
    await manualModal.getByLabel('Điền dữ liệu khách mẫu').uncheck()
    assert.equal(flat(await itemPreview.locator('.rp-token.is-raw').innerText()), 'Tên Zalo')
    await shot('desktop-advanced-modal.png')
    await page.keyboard.press('Escape')
    await manualModal.waitFor({ state: 'detached' })
    // Nút Sửa của Nội dung 2 mở modal ở đúng mục.
    await panel.getByRole('button', { name: 'Phiên bản sau', exact: true }).click()
    await panel.locator('.rp-meta-row').getByRole('button', { name: 'Sửa', exact: true }).click()
    await manualModal.waitFor()
    assert.equal(await manualModal.locator('.campaign-manual-content-rail-select[aria-pressed="true"] .campaign-manual-content-rail-number').innerText(), '2')
    await page.keyboard.press('Escape')
    await manualModal.waitFor({ state: 'detached' })

    // 13. Tab Preview nội dung của chi tiết chiến dịch: lưới phiên bản trong trang, một lần đọc tối đa 3 dòng data.
    await page.evaluate(() => window.rpSmoke.close())
    await page.evaluate(() => window.rpSmoke.open('tab'))
    const tab = page.locator('.campaign-content-preview')
    await tab.locator('.rp-browser.is-inline').waitFor()
    await page.waitForFunction(() => document.querySelector('.campaign-content-preview-badge')?.textContent === 'Đã điền biến theo data')
    assert.deepEqual(await page.evaluate(() => window.rpSmoke.state.inputPageQueries), [{ campaignId: 77, offset: 0, limit: 3 }])
    assert.equal(flat(await tab.locator('.rp-segmented button').first().innerText()), 'Tin nhắn · 2')
    assert.equal(await tab.locator('.rp-card').count(), 2)
    assert.match(flat(await tab.locator('.campaign-content-preview-notes').innerText()), /3 data đầu tiên/)
    await tab.locator('.rp-card').first().locator('.rp-album img').first().waitFor()
    await shot('desktop-detail-tab.png')

    // 14. Sửa nhanh nội dung: ngăn kéo bên phải đọc state đang sửa; bấm trong ngăn kéo không đóng hộp.
    await page.evaluate(() => window.rpSmoke.close())
    await page.evaluate(() => window.rpSmoke.open('quick'))
    const quick = page.locator('.campaign-quick-edit-modal')
    await quick.waitFor()
    assert.equal(await panel.count(), 0, 'quick edit starts with the preview closed')
    await toggle.click()
    await panel.waitFor()
    assert.equal(await panel.evaluate(el => el.classList.contains('is-drawer')), true)
    assert.equal(await page.locator('.campaign-quick-edit-overlay.has-recipient-preview').count(), 1)
    await quick.locator('textarea').first().fill('Nội dung sửa nhanh cho #{FULL_NAME}')
    await page.waitForFunction(() => document.querySelector('aside.rp-panel .rp-phone')?.textContent?.includes('Nội dung sửa nhanh cho Nguyễn Minh Anh'))
    await panel.getByRole('button', { name: 'Nam', exact: true }).click()
    assert.equal(await quick.count(), 1, 'clicking inside the drawer keeps the quick edit open')
    await panel.locator('.rp-phone .rp-album img').first().waitFor()
    await shot('desktop-quick-edit-drawer.png')
    await panel.getByRole('button', { name: 'Đóng khung xem trước', exact: true }).click()
    await panel.waitFor({ state: 'detached' })

    // 15. Xem trước mẫu nội dung Zalo: cùng bộ vẽ, đổi biến thể bằng tab.
    await page.evaluate(() => window.rpSmoke.close())
    await page.evaluate(() => window.rpSmoke.open('template'))
    const template = page.locator('.ctw-preview-panel')
    await template.locator('.rp-phone .rp-album img').nth(1).waitFor()
    assert.equal(flat(await template.locator('.rp-bubble:not(.is-media)').innerText()), 'Chào Nguyễn Minh Anh, mẫu thu đông đã về')
    await template.getByRole('button', { name: 'Nội dung 2', exact: true }).click()
    assert.equal(flat(await template.locator('.rp-bubble:not(.is-media)').innerText()), 'Bản hai cho Nguyễn Minh Anh')

    const errors = await page.evaluate(() => window.rpSmoke.state.errors)
    assert.deepEqual(errors, [], 'no renderer errors')
    console.log(`PASS recipient preview UI · ảnh chụp: ${artifacts}`)
  } finally {
    await app?.close().catch(() => {})
    if (!process.env.RECIPIENT_PREVIEW_ARTIFACTS_DIR) fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

// Giao diện khung "Sau khi chạy: đưa khách vào nhóm" (Desktop) và thẻ Tự động hóa › Từ chiến dịch, IPC giả lập.
// Dựng renderer bằng esbuild rồi mở bằng Chromium của Playwright, không cần binary Electron, không kết nối mạng.
//   node scripts/run-campaign-result-groups-ui-smoke.cjs
//   CRG_UI_SHOTS=<thư mục> node scripts/run-campaign-result-groups-ui-smoke.cjs   # kèm chụp màn hình
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { chromium } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-crg-ui-'))
  const shots = process.env.CRG_UI_SHOTS || ''
  if (shots) mkdirSync(shots, { recursive: true })
  await build({ entryPoints: [join(__dirname, 'campaign-result-groups-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"file:///akaagent/smoke/x.tsx"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-result-groups-ui-smoke.css"><body><div id="root"></div><script src="campaign-result-groups-ui-smoke.js"></script></body></html>')
  const chromiumPath = process.env.CRG_UI_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : {})
  let cases = 0
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' })
    await context.route(/^https?:/, route => route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`file://${join(directory, 'index.html')}`)
    await page.waitForFunction(() => window.crgSmoke && window.crgSmoke.save)
    const smoke = (method, ...args) => page.evaluate(([name, params]) => window.crgSmoke[name](...params), [method, args])
    const calls = action => page.evaluate(name => window.crgSmoke.state.calls.filter(call => call.action === name).map(call => call.payload), action)
    const setState = values => page.evaluate(next => Object.assign(window.crgSmoke.state, next), values)
    const shot = async name => { if (shots) await page.screenshot({ path: join(shots, `crg-${name}.png`), fullPage: true }) }
    const ok = name => { cases += 1; console.log(`PASS ${name}`) }

    // 1. Đăng nhóm Facebook: câu theo đối tượng group; chưa bấm thêm dòng thì không gọi gì.
    await page.locator('.crg').waitFor()
    assert.equal(await page.locator('#crg-title').innerText(), 'Sau khi chạy: đưa group vào nhóm')
    assert.match(await page.locator('.crg-lead').innerText(), /^Group đạt một trong các kết quả bạn chọn sẽ tự được đưa vào nhóm data/)
    assert.equal((await page.evaluate(() => window.crgSmoke.state.calls.length)), 0, 'chưa dùng khung thì không gọi API')
    ok('đăng nhóm Facebook: câu "đưa group vào nhóm", không gọi API khi chưa thêm dòng')

    // 2. Thêm nhóm: 1 lượt options + đọc nhóm; chỉ nhóm Facebook Group được chọn; Comment ẩn khi chưa bật Kiêm comment.
    await page.getByRole('button', { name: 'Thêm nhóm' }).click()
    await page.locator('.crg-chip').first().waitFor()
    assert.equal((await calls('options')).length, 1)
    assert.deepEqual((await calls('options'))[0], { actionId: 'facebook_group_post', accountIds: [11] })
    const options = await page.locator('.crg-row select option').allInnerTexts()
    assert.ok(options.some(text => text.startsWith('Group đăng OK · Group Facebook')), options.join(' | '))
    assert.equal(options.some(text => text.startsWith('Khách SĐT')), false, 'nhóm SĐT không nhận group')
    assert.deepEqual(await page.locator('.crg-action-name').allInnerTexts(), ['Đăng bài'])
    await page.evaluate(() => window.crgSmoke.setEnableComment(true))
    await page.waitForFunction(() => document.querySelectorAll('.crg-action-name').length === 2)
    await shot('them-dong')
    ok('thêm dòng: một lượt options, chỉ nhóm loại Group Facebook, Comment theo Kiêm comment')

    // 3. Kiểm lỗi chặn lưu (chưa chọn nhóm / kết quả), rồi chọn đủ thì hết lỗi; nháp giữ dòng.
    const error = await smoke('validate')
    assert.ok(error && /Nhóm 1/.test(error), String(error))
    await page.locator('.crg-row select').selectOption('701')
    await page.getByRole('button', { name: 'Thành công' }).first().click()
    assert.equal(await smoke('validate'), null)
    assert.match(await page.locator('.crg-summary').innerText(), /^Group vào nhóm khi:/)
    const draft = await smoke('draft')
    assert.equal(draft.length, 1)
    assert.equal(draft[0].groupId, 701)
    assert.deepEqual(draft[0].keys, ['fb_post_group::thành công'])
    ok('kiểm lỗi chặn lưu, chọn đủ thì hết lỗi; nháp lưu dòng dưới khóa campaignResultGroups')

    // 4. Lưu: mỗi (chiến dịch, nhóm) một lượt, mã yêu cầu cố định theo lần lưu.
    assert.equal(await smoke('save', [55, 56]), 'ok')
    const saves = await calls('save')
    assert.deepEqual(saves.map(item => [item.campaignId, item.requestId, item.rows[0].groupId, item.includeExisting]),
      [[55, 'batch1:55:701:result-groups', 701, false], [56, 'batch1:56:701:result-groups', 701, false]])
    ok('lưu: mỗi (chiến dịch, nhóm) một lượt, mã yêu cầu theo lần lưu')

    // 5. Lỗi bật đồng bộ: ném lỗi mang mã nhóm, bảng chân form; "Chọn nhóm khác" đổi dòng; "Bỏ nhóm này và chạy" bỏ dòng rồi thử lại.
    await setState({ failSaveFor: 701 })
    assert.equal(await smoke('save', [57]), 'CampaignResultGroupSaveError:701')
    await page.locator('.crg-save-issue').waitFor()
    assert.match(await page.locator('.crg-save-issue').innerText(), /Chưa bật xong đồng bộ vào nhóm “Group đăng OK”/)
    await shot('loi-luu')
    await page.locator('.crg-save-issue').getByRole('button', { name: 'Chọn nhóm khác' }).click()
    await page.locator('.crg-save-issue select').selectOption('703')
    assert.equal((await smoke('draft'))[0].groupId, 703)
    await setState({ failSaveFor: 703 })
    assert.equal(await smoke('save', [57]), 'CampaignResultGroupSaveError:703')
    await page.locator('.crg-save-issue').getByRole('button', { name: 'Bỏ nhóm này và chạy' }).click()
    assert.equal((await smoke('draft')).length, 0)
    assert.equal(await page.evaluate(() => window.crgSmoke.state.retries), 1)
    assert.equal(await page.locator('.crg-save-issue').count(), 0)
    ok('lỗi bật đồng bộ: bảng ba nút, chọn nhóm khác đổi dòng, bỏ nhóm rồi thử lại')

    // 6. Loại chiến dịch không có khung (đăng trang cá nhân) thì ẩn; Zalo nhắn SĐT thì câu "đưa khách vào nhóm khách hàng".
    await page.evaluate(() => window.crgSmoke.setActionId('facebook_timeline_post'))
    await page.waitForFunction(() => !document.querySelector('.crg'))
    assert.equal(await smoke('visible'), false)
    await page.evaluate(() => window.crgSmoke.setActionId('zalo_message_phone'))
    await page.locator('.crg').waitFor()
    assert.match(await page.locator('.crg-lead').innerText(), /^Khách đạt một trong các kết quả bạn chọn sẽ tự được đưa vào nhóm khách hàng/)
    ok('loại không có khung thì ẩn; Zalo nhắn SĐT dùng câu của Web')

    // 7. API chưa có đường của Desktop: thêm dòng thì báo và chặn lưu cho tới khi bỏ dòng; bỏ hết thì khung ẩn.
    await setState({ notReady: true })
    await page.evaluate(() => window.crgSmoke.setActionId('sms_send'))
    await page.getByRole('button', { name: 'Thêm nhóm' }).click()
    await page.locator('.crg-error', { hasText: 'Máy chủ chưa hỗ trợ đưa khách vào nhóm' }).waitFor()
    assert.match(String(await smoke('validate')), /Máy chủ chưa hỗ trợ/)
    await page.getByRole('button', { name: 'Bỏ nhóm 1' }).click()
    await page.waitForFunction(() => !document.querySelector('.crg'))
    assert.equal(await smoke('visible'), false)
    await setState({ notReady: false })
    ok('API chưa sẵn sàng: báo, chặn lưu khi còn dòng, bỏ hết thì ẩn khung')

    // 8. Thẻ Từ chiến dịch: một lượt đọc, lọc, Tắt có hiệu lực ngay tại dòng.
    await setState({ items: [
      { id: 1, journeyId: 90, campaignId: 55, groupId: 701, groupName: 'Group đăng OK', groupType: 'facebook_group', groupDeleted: false, keys: ['fb_post_group::thành công'],
        state: 'active', reason: null, reasonAt: null, pausedAt: null, createdAt: '2026-11-22T03:00:00Z', added: 4, pending: 1, campaignName: 'Đăng nhóm BĐS', accountName: 'fb LD' },
      { id: 2, journeyId: 91, campaignId: 56, groupId: 702, groupName: 'Khách SĐT', groupType: 'phone', groupDeleted: false, keys: ['zalo_message_stranger::thành công'],
        state: 'paused', reason: 'user', reasonAt: null, pausedAt: null, createdAt: '2026-11-22T03:00:00Z', added: 0, pending: 0, campaignName: 'Nhắn SĐT', accountName: 'Zalo A' }
    ] })
    const before = (await calls('listAll')).length
    await page.evaluate(() => window.crgSmoke.setTab(true))
    await page.locator('.from-campaigns-kpis').waitFor()
    assert.equal((await calls('listAll')).length, before + 1)
    assert.match(await page.locator('.crg-row-existing').first().innerText(), /đã đưa 4 group vào nhóm/)
    await page.getByRole('button', { name: /Đã tắt · 1/ }).click()
    assert.equal(await page.locator('.crg-row-existing').count(), 1)
    await page.getByRole('button', { name: /Tất cả · 2/ }).click()
    await page.getByRole('switch', { name: 'Đồng bộ vào nhóm Group đăng OK' }).click()
    await page.waitForFunction(() => window.crgSmoke.state.calls.some(call => call.action === 'setStatus'))
    assert.deepEqual((await calls('setStatus'))[0], { campaignId: 55, journeyId: 90, action: 'pause' })
    await page.getByRole('button', { name: /Đã tắt · 2/ }).waitFor()
    await shot('tu-chien-dich')
    ok('thẻ Từ chiến dịch: một lượt đọc, lọc theo trạng thái, Tắt có hiệu lực ngay')

    assert.deepEqual(errors, [], errors.join('\n'))
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
  console.log(`\n${cases} PASS`)
}

main().catch(error => { console.error(error); process.exit(1) })

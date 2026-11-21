#!/usr/bin/env node
// Form "Tìm data" website và tab "Data tìm được" trên Electron ẩn (component thật, IPC giả lập, chặn mọi request http):
//   node scripts/web-scan/form-ui-smoke.cjs            (WEB_FORM_SHOTS=<thư mục> để chụp màn hình; WEB_FORM_EXPLORE=1 in nội dung form)
'use strict'
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-web-form-ui-'))
  await build({ entryPoints: [join(__dirname, 'form-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"file:///fixture.js"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="form-ui-smoke.css"><body><div id="root"></div><script src="form-ui-smoke.js"></script></body></html>')
  writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
    const win = new BrowserWindow({ show: false, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
    win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
  });`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '../..'), env })
  const shots = process.env.WEB_FORM_SHOTS
  if (shots) mkdirSync(shots, { recursive: true })
  let page
  let cases = 0
  const pass = name => { cases++; console.log('PASS', name) }
  try {
    page = await app.firstWindow(); page.setDefaultTimeout(15000)
    await page.waitForFunction(() => window.webScanSmoke)
    const open = (actionId, mode, extra, details) => page.evaluate(args => window.webScanSmoke.open(...args), [actionId, mode || 'new', extra || {}, details || []])
    const body = () => page.evaluate(() => document.body.innerText)
    const shot = async name => { if (shots) await page.screenshot({ path: join(shots, name + '.png'), fullPage: true }) }
    const errors = () => page.evaluate(() => window.webScanSmoke.state.errors)
    const calls = method => page.evaluate(m => window.webScanSmoke.state.calls.filter(call => call.method === m).map(call => call.args), method)
    const alerts = () => page.evaluate(() => window.webScanSmoke.state.alerts.filter(alert => alert.type !== 'success'))
    if (process.env.WEB_FORM_EXPLORE) {
      const ex = process.env.WEB_FORM_EXPLORE
      await open(ex === '1' || ex.startsWith('chip:') ? null : ex)
      await page.waitForTimeout(1500)
      if (ex.startsWith('chip:')) {
        await page.getByRole('button', { name: 'Website', exact: true }).click()
        await page.locator('select').first().selectOption({ label: ex.slice(5) })
        await page.waitForTimeout(1500)
      }
      if (process.env.WEB_FORM_INPUTS) {
        console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')].map(el => {
          const group = el.closest('.stepper-form-group, label, .form-group, div')
          const label = (el.closest('label')?.innerText || el.closest('.stepper-form-group')?.querySelector('label')?.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 70)
          return [el.tagName, el.type || '', label, el.value?.slice?.(0, 30), el.checked ? 'checked' : '', el.disabled ? 'disabled' : '']
        })), null, 0))
        return
      }
      console.log((await body()).slice(0, 4000))
      console.log('BUTTONS', JSON.stringify(await page.getByRole('button').allInnerTexts()).slice(0, 3000))
      await shot('explore')
      return
    }

    const input = label => page.locator('.stepper-form-group').filter({ has: page.locator('label', { hasText: label }) }).locator('input, select, textarea').first()
    const kw = () => page.locator('textarea.stepper-textarea').first()
    const save = async () => {
      await page.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click()
      // Lưu xong khi có thông báo (thành công hoặc lỗi).
      await page.waitForFunction(() => window.webScanSmoke.state.alerts.length > 0, null, { timeout: 20000 })
    }

    // 1. Nút nền tảng "Website": chỉ ba loại Tìm data của web; chọn loại thì form đổi sang phần của trang đó, không có phần nội dung.
    await open(null)
    await page.getByRole('button', { name: 'Website', exact: true }).click()
    const options = await page.locator('select').first().locator('option').allInnerTexts()
    assert.deepEqual(options.filter(o => !o.startsWith('--')).sort(), ['Tìm data Batdongsan', 'Tìm data Nhà Tốt', 'Tìm data Trang Vàng'])
    await page.locator('select').first().selectOption({ label: 'Tìm data Trang Vàng' })
    await page.getByText('Tỉnh / thành', { exact: true }).waitFor()
    await page.getByText('Từ khoá hoặc link ngành / link tìm kiếm Trang Vàng').waitFor()
    assert.equal(await page.getByText('Lấy SĐT của').count(), 0)
    await page.locator('select').first().selectOption({ label: 'Tìm data Nhà Tốt' })
    await page.getByText('Lấy SĐT của').waitFor()
    assert.equal(await page.getByText('Tỉnh / thành', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Nội dung tin nhắn').count(), 0)
    assert.deepEqual(await errors(), [])
    pass('nút Website: đúng ba loại, đổi loại thì đổi phần cấu hình của trang')

    // 2. nhatot tạo mới: mặc định (môi giới, 100 / ngày, nghỉ 15 giây), từ khoá thành data, lưu đủ cài đặt.
    await open('web_find_data_nhatot')
    assert.equal(await input('Lấy SĐT của').inputValue(), 'broker')
    assert.equal(await input('Nghỉ giữa 2 lần mở trang / bấm hiện số').inputValue(), '15')
    assert.equal(await input('Giới hạn trong ngày').inputValue(), '100')
    await page.getByPlaceholder('Nhập tên chiến dịch...').fill('Môi giới Q7')
    await kw().fill('nhà quận 7\ncăn hộ Thủ Đức\n\nnhà quận 7\n')
    await page.getByText('2 từ khoá.').waitFor()
    await input('Số trang tối đa mỗi lần tìm').fill('3')
    await page.getByRole('checkbox', { name: 'Hướng', exact: true }).check()
    await shot('nhatot-new')
    await save()
    assert.deepEqual(await alerts(), [])
    const created = (await calls('createCampaign'))[0][0]
    assert.equal(created.actionId, 'web_find_data_nhatot')
    assert.equal(created.extraSettings.webScan.site, 'nhatot')
    assert.equal(created.extraSettings.webScan.poster, 'broker')
    assert.equal(created.extraSettings.webScan.pagesPerSearch, 3)
    assert.ok(created.extraSettings.webScan.fields.includes('direction') || created.extraSettings.webScan.fields.length > 10, JSON.stringify(created.extraSettings.webScan.fields))
    assert.equal(created.extraSettings.isFindPhone, true)
    assert.equal(created.extraSettings.actionLimits.sleepBetweenActions, 15)
    assert.equal(Number(created.extraSettings.actionLimits.byActionCode.web_nhatot_phone.dailyLimit), 100)
    const rows = (await calls('createCampaignInputDataBatch')).flatMap(args => args[0])
    assert.deepEqual(rows.map(r => r.uid || r.name), ['nhà quận 7', 'căn hộ Thủ Đức'])
    assert.deepEqual(await errors(), [])
    pass('nhatot tạo mới: mặc định đúng, từ khoá bỏ trùng thành data, lưu đủ cài đặt web')

    // 3. Kẹp theo DB: nghỉ dưới 10 giây lưu thành 10, giới hạn ngày quá 500 không lưu được quá 500.
    await open('web_find_data_batdongsan')
    await page.getByPlaceholder('Nhập tên chiến dịch...').fill('BĐS Q7')
    await kw().fill('quận 7')
    await input('Nghỉ giữa 2 lần mở trang / bấm hiện số').fill('3')
    await input('Giới hạn trong ngày').fill('900')
    await save()
    const al = await alerts()
    const bds = (await calls('createCampaign'))[0]?.[0]
    if (bds) {
      assert.ok(bds.extraSettings.actionLimits.sleepBetweenActions >= 10, 'nghỉ ' + bds.extraSettings.actionLimits.sleepBetweenActions)
      assert.ok(Number(bds.extraSettings.actionLimits.byActionCode.web_batdongsan_phone.dailyLimit) <= 500, 'giới hạn ' + bds.extraSettings.actionLimits.byActionCode.web_batdongsan_phone.dailyLimit)
      assert.equal(bds.extraSettings.webScan.site, 'batdongsan')
    } else {
      assert.ok(al.length > 0)
    }
    console.log('   kẹp: thông báo', JSON.stringify(al), 'lưu', bds ? JSON.stringify(bds.extraSettings.actionLimits) : 'không')
    pass('batdongsan: nghỉ / giới hạn ngày bị kẹp theo mức của DB')

    // 4. Trang Vàng: tỉnh + link; link không phải trang ngành / tìm kiếm bị báo, không lưu.
    await open('web_find_data_yellowpages')
    await page.getByPlaceholder('Nhập tên chiến dịch...').fill('Bao bì')
    await page.getByRole('checkbox', { name: 'TP. Hồ Chí Minh (TPHCM)' }).check()
    await kw().fill('bao bì nhựa\nhttps://www.yellowpages.vn/lgs/1187/abc.html')
    await page.getByText(/Link không phải trang ngành/).waitFor()
    await save()
    assert.ok((await alerts()).some(a => /link/i.test(a.message)), JSON.stringify(await alerts()))
    assert.equal((await calls('createCampaign')).length, 0)
    await kw().fill('bao bì nhựa\nhttps://www.yellowpages.vn/cls/394110/bao-bi-nhua.html')
    await page.getByRole('checkbox', { name: /Mở trang chi tiết từng doanh nghiệp/ }).check()
    await page.getByRole('checkbox', { name: 'Mã số thuế', exact: true }).check()
    await page.evaluate(() => { window.webScanSmoke.state.alerts = [] })
    await save()
    assert.deepEqual(await alerts(), [])
    const tv = (await calls('createCampaign'))[0][0]
    assert.deepEqual(tv.extraSettings.webScan.provinces, ['TP. Hồ Chí Minh (TPHCM)'])
    assert.equal(tv.extraSettings.webScan.openDetail, true)
    assert.ok(tv.extraSettings.webScan.fields.includes('taxCode'))
    const tvRows = (await calls('createCampaignInputDataBatch')).flatMap(args => args[0]).map(r => r.uid || r.name)
    assert.deepEqual(tvRows, ['bao bì nhựa', 'https://www.yellowpages.vn/cls/394110/bao-bi-nhua.html'])
    pass('Trang Vàng: tỉnh, link ngành, mở trang chi tiết; link sai bị chặn')

    // 5. Sửa chiến dịch đã lưu: đọc lại từ khoá và cài đặt.
    await open('web_find_data_batdongsan', 'edit', { webScan: { site: 'batdongsan', pagesPerSearch: 4, openDetail: true },
      actionLimits: { sleepBetweenActions: 20, byActionCode: { web_batdongsan_phone: { dailyLimit: 60 } } } },
      [{ id: 1, campaignId: 9, uid: 'quận 7', name: 'quận 7', status: 'hoàn thành', isDelete: false },
        { id: 2, campaignId: 9, uid: 'Vinhomes Grand Park', name: 'Vinhomes Grand Park', status: 'chờ xử lý', isDelete: false }])
    // Khi sửa, từ khoá đã lưu hiện ở bảng data (thêm từ khoá bằng "Thêm data"), như Tìm data Facebook.
    await page.getByRole('cell', { name: 'Vinhomes Grand Park' }).waitFor()
    await page.getByRole('cell', { name: 'quận 7', exact: true }).waitFor()
    assert.equal(await kw().count(), 0)
    assert.equal(await input('Số trang tối đa mỗi lần tìm').inputValue(), '4')
    assert.equal(await input('Nghỉ giữa 2 lần mở trang / bấm hiện số').inputValue(), '20')
    assert.equal(await input('Giới hạn trong ngày').inputValue(), '60')
    await shot('batdongsan-edit')
    assert.deepEqual(await errors(), [])
    pass('sửa chiến dịch: đọc lại từ khoá, số trang, nghỉ, giới hạn')

    // 7. Sửa nhanh: "Cập nhật giới hạn gửi" kẹp nghỉ theo mức của DB; "Cập nhật nội dung + media" không có ô nội dung cho chiến dịch web.
    const quickExtra = { webScan: { site: 'batdongsan' }, actionLimits: { sleepBetweenActions: 20, enabledActionCodes: ['web_batdongsan_phone'],
      byActionCode: { web_batdongsan_phone: { dailyLimit: 60, rateLimitCount: 60, rateLimitMinutes: 65 } } } }
    await open('web_find_data_batdongsan', 'limit', quickExtra)
    await page.getByText('Nghỉ giữa 2 lần mở trang / bấm hiện số (thấp nhất 10 giây)').waitFor()
    await input('Nghỉ giữa 2 lần mở trang / bấm hiện số').fill('3')
    await page.getByRole('button', { name: 'Lưu', exact: true }).click()
    await page.waitForTimeout(300)
    await page.evaluate(() => window.webScanSmoke.selectSaveStatus('tạm dừng'))
    await page.waitForFunction(() => window.webScanSmoke.state.calls.some(call => call.method === 'updateCampaign'))
    const limitUpdate = (await calls('updateCampaign'))[0][1]
    assert.equal(limitUpdate.extraSettings.actionLimits.sleepBetweenActions, 10)
    assert.equal(limitUpdate.extraSettings.webScan.site, 'batdongsan', 'giữ cài đặt quét')
    await open('web_find_data_batdongsan', 'content', quickExtra)
    await page.getByText('Cập nhật nội dung + media').waitFor()
    assert.equal(await page.locator('textarea').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Lưu', exact: true }).isDisabled(), true)
    await shot('quick-content')
    assert.deepEqual(await errors(), [])
    pass('sửa nhanh: nghỉ kẹp 10 giây, giữ cài đặt quét; không có ô nội dung')

    // 8. Xử lý data tìm được: chọn chiến dịch "Nhắn tin theo SĐT" và Nhóm data loại SĐT, lưu đúng khoá mà bộ chạy đọc
    //    (findPhoneZaloMessagePhoneTargetCampaignIds, findDataTargetDataGroups.phone; scripts/web-scan/push-smoke.cjs kiểm phần đẩy).
    await open('web_find_data_nhatot')
    await page.getByPlaceholder('Nhập tên chiến dịch...').fill('Môi giới Q7 đẩy Zalo')
    await kw().fill('nhà quận 7')
    await page.getByRole('checkbox', { name: 'Đẩy SĐT sang chiến dịch Zalo gửi tin nhắn, kết bạn' }).check()
    await page.getByRole('button', { name: 'Chọn chiến dịch', exact: true }).click()
    await page.locator('.campaign-picker-modal').getByText('Nhắn tin khách BĐS').click()
    await page.locator('.campaign-picker-confirm-button').click()
    await page.locator('.campaign-picker-modal').waitFor({ state: 'detached' })
    await page.getByRole('checkbox', { name: 'Đẩy SĐT sang Nhóm data' }).check()
    await page.getByRole('button', { name: 'Chọn nhóm', exact: true }).click()
    await page.locator('.data-group-manager-picker-footer').waitFor()
    await page.getByText('Nhóm SĐT', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Chọn nhóm data', exact: true }).click()
    await page.locator('.data-group-manager-picker-footer').waitFor({ state: 'detached' })
    await page.locator('.campaign-data-group-control').getByText('Nhóm SĐT', { exact: true }).waitFor()
    await shot('nhatot-push-targets')
    await save()
    assert.deepEqual(await alerts(), [])
    const pushed = (await calls('createCampaign'))[0][0].extraSettings
    assert.equal(pushed.isFindPhone, true)
    assert.deepEqual(pushed.findPhoneZaloMessagePhoneTargetCampaignIds, [301])
    assert.equal(pushed.findDataTargetDataGroups?.phone?.groupId, 77)
    assert.deepEqual(await errors(), [])
    pass('xử lý data tìm được: chọn chiến dịch Zalo đích và Nhóm data SĐT, lưu đúng khoá bộ chạy đọc')

    // 9. Sửa chiến dịch đã có đích: hiện lại đích đã chọn, lưu không mất.
    await open('web_find_data_nhatot', 'edit', { webScan: { site: 'nhatot' }, isFindPhone: true, findPhoneZaloMessagePhoneTargetCampaignIds: [301],
      findDataTargetDataGroups: { phone: { groupId: 77, groupName: 'Nhóm SĐT' } } },
      [{ id: 3, campaignId: 9, uid: 'nhà quận 7', name: 'nhà quận 7', status: 'chờ xử lý', isDelete: false }])
    await page.getByRole('cell', { name: 'nhà quận 7', exact: true }).waitFor()
    assert.equal(await page.getByRole('checkbox', { name: 'Đẩy SĐT sang chiến dịch Zalo gửi tin nhắn, kết bạn' }).isChecked(), true)
    assert.equal(await page.getByRole('checkbox', { name: 'Đẩy SĐT sang Nhóm data' }).isChecked(), true)
    await page.getByText('Nhắn tin khách BĐS').first().waitFor()
    await page.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click()
    await page.waitForTimeout(300)
    await page.evaluate(() => window.webScanSmoke.selectSaveStatus('tạm dừng'))
    await page.waitForFunction(() => window.webScanSmoke.state.calls.some(call => call.method === 'updateCampaign'), null, { timeout: 20000 })
    const kept = (await calls('updateCampaign'))[0][1].extraSettings
    assert.deepEqual(kept.findPhoneZaloMessagePhoneTargetCampaignIds, [301])
    assert.equal(kept.findDataTargetDataGroups?.phone?.groupId, 77)
    assert.equal(kept.isFindPhone, true)
    assert.deepEqual(await errors(), [])
    pass('sửa chiến dịch web có đích: hiện lại và giữ chiến dịch Zalo đích, Nhóm data')

    // 6. Data tìm được: mỗi SĐT một dòng (số trùng ở dòng sau bỏ), số dùng lại giữ cờ, Excel đúng cột mẫu Nhóm data.
    const found = await page.evaluate(() => window.webScanSmoke.foundData())
    assert.deepEqual(found.records.map(r => r.phone), ['0901000001', '0901000002', '0901000003'])
    assert.equal(found.records[2].reused, true)
    assert.deepEqual(found.rows[0].slice(0, 11), ['Tên', 'Uid', 'Sđt', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5', 'Từ khoá', 'Ngày tìm'])
    assert.deepEqual(found.rows[1].slice(2, 10), ['0901000001', '', 'Quận 7', '5 tỷ', '', '', 'Nhà 01', 'nhà quận 7'])
    pass('Data tìm được: bỏ trùng theo SĐT, giữ số dùng lại, Excel theo mẫu Nhóm data')
    console.log(`\n${cases} ca đạt`)
  } catch (error) {
    try {
      console.error('alerts:', JSON.stringify(await page.evaluate(() => window.webScanSmoke?.state.alerts)))
      console.error('calls:', JSON.stringify(await page.evaluate(() => window.webScanSmoke?.state.calls.map(call => call.method).slice(-30))))
      console.error('body:', (await page.evaluate(() => document.body.innerText)).slice(0, 1500))
      console.error('errors:', JSON.stringify(await page.evaluate(() => window.webScanSmoke?.state.errors)).slice(0, 800))
    } catch {}
    throw error
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

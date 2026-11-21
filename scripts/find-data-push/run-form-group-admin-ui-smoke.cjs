// Chạy form thật trên Electron (IPC giả) cho hai ô đẩy UID / SĐT quản trị viên group sang Nhóm data và nút "Tạo nhóm mới".
//   ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/find-data-push/run-form-group-admin-ui-smoke.cjs
const { mkdtempSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

const root = resolve(__dirname, '../..')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'akaagent-form-admin-'))
  let app
  try {
    await build({ entryPoints: [join(__dirname, 'form-group-admin-ui-smoke.tsx')], outdir: dir, bundle: true, platform: 'browser', format: 'iife',
      jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"file:///smoke/"' },
      loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'error' })
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="form-group-admin-ui-smoke.css"><body><div id="root"></div><script src="form-group-admin-ui-smoke.js"></script></body></html>')
    writeFileSync(join(dir, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^https?:/.test(d.url) }));
      win.loadFile(${JSON.stringify(join(dir, 'index.html'))});
    });`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(dir, 'main.cjs')], cwd: root, env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    await page.waitForFunction(() => !!window.adminSmoke)
    const results = []
    const check = (ok, label, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `\n  ${JSON.stringify(info).slice(0, 1500)}`}`) }
    const smoke = () => page.evaluate(() => ({ ...window.adminSmoke.state, groups: window.adminSmoke.state.groups, campaigns: window.adminSmoke.campaigns() }))
    const form = page.locator('.campaign-full-modal')
    const save = form.getByRole('button', { name: 'Tạo chiến dịch', exact: true })
    // Mục tìm group cũng dùng lớp này (bọc ngoài): lấy khối trong cùng.
    const optionOf = label => form.locator('.extra-comment-options').filter({ has: page.getByText(label, { exact: true }) }).last()
    const uidLabel = 'Đẩy UID quản trị viên sang Nhóm data'
    const phoneLabel = 'Đẩy SĐT quản trị viên sang Nhóm data'
    const openStep = async () => {
      // Hai ô nằm ở mục cấu hình tìm group: mở mục đó nếu form dạng từng bước.
      for (let i = 0; i < 6; i += 1) {
        if (await form.getByText(uidLabel, { exact: true }).count()) return
        const next = form.getByRole('button', { name: /Tiếp/ })
        if (!(await next.count())) return
        await next.first().click()
      }
    }

    // Ca 1: bật cả hai, tạo nhóm mới cho từng ô, lưu.
    await page.evaluate(() => { window.adminSmoke.reset(); window.adminSmoke.open(true) })
    await save.waitFor()
    await openStep()
    check(await form.getByText(uidLabel, { exact: true }).count() === 1 && await form.getByText(phoneLabel, { exact: true }).count() === 1,
      'bật "Lấy thông tin quản trị viên": hiện hai ô đẩy UID / SĐT quản trị viên', {})
    await form.getByRole('checkbox', { name: uidLabel }).check()
    await optionOf(uidLabel).getByRole('button', { name: 'Tạo nhóm mới' }).click()
    const dialog = page.getByRole('dialog', { name: 'Tạo nhóm data' })
    await dialog.waitFor()
    await page.waitForFunction(() => document.querySelector('.data-group-form-modal')?.textContent?.includes('User Facebook'))
    check(await dialog.getByText('User Facebook').count() >= 1, 'hộp tạo nhóm: loại khoá User Facebook', {})
    await dialog.getByLabel(/Tên nhóm/).fill('UID admin mới')
    await dialog.getByRole('button', { name: 'Tạo và chọn nhóm' }).click()
    await dialog.waitFor({ state: 'detached' })
    let s = await smoke()
    const createUid = s.calls.find(c => c.method === 'createDataGroup')
    check(createUid && createUid.args[0].dataTypeCategoryItemId === 38 && createUid.args[0].name === 'UID admin mới' && createUid.args[0].boundZaloAccountId === null,
      'tạo nhóm UID đúng loại (38), không gắn tài khoản Zalo', { createUid })
    check(await optionOf(uidLabel).getByText('UID admin mới').count() >= 1, 'ô UID tự chọn nhóm vừa tạo', { alerts: s.alerts })
    check(s.alerts.some(a => a.message === 'Đã tạo nhóm data và chọn cho ô này.'), 'báo đã tạo và chọn', { alerts: s.alerts })

    await form.getByRole('checkbox', { name: phoneLabel }).check()
    await optionOf(phoneLabel).getByRole('button', { name: 'Tạo nhóm mới' }).click()
    await dialog.waitFor()
    await page.waitForFunction(() => document.querySelector('.data-group-form-modal')?.textContent?.includes('Số điện thoại'))
    await dialog.getByRole('button', { name: 'Tạo và chọn nhóm' }).click()
    await dialog.waitFor({ state: 'detached' })
    s = await smoke()
    const creates = s.calls.filter(c => c.method === 'createDataGroup')
    check(creates.length === 2 && creates[1].args[0].dataTypeCategoryItemId === 40 && /^SĐT quản trị viên group/.test(creates[1].args[0].name),
      'tạo nhóm SĐT đúng loại (40), tên điền sẵn', { creates })

    await save.click()
    await page.waitForFunction(() => window.adminSmoke.campaigns().length > 0 || window.adminSmoke.state.alerts.some(a => a.type === 'error'), null, { timeout: 30000 })
    s = await smoke()
    const saved = s.campaigns[0]
    const dest = saved?.extraSettings?.findDataTargetDataGroups || {}
    check(dest.facebook_group_admin_uid?.groupId === 8100 && dest.facebook_group_admin_phone?.groupId === 8101 && saved.extraSettings.isFindFacebookGroupAdmins === true,
      'lưu: hai nơi nhận quản trị viên vào cài đặt chiến dịch', { dest, alerts: s.alerts })
    check(s.errors.length === 0, 'không lỗi giao diện', { errors: s.errors })

    // Ca 2: bật ô UID mà chưa chọn nhóm thì báo.
    await page.evaluate(() => { window.adminSmoke.reset(); window.adminSmoke.open(true) })
    await save.waitFor()
    await openStep()
    await form.getByRole('checkbox', { name: uidLabel }).check()
    await save.click()
    await page.waitForFunction(() => window.adminSmoke.state.alerts.length > 0, null, { timeout: 30000 })
    s = await smoke()
    check(s.alerts.some(a => a.message === 'Vui lòng chọn Nhóm data nhận UID quản trị viên.') && s.campaigns.length === 0,
      'bật ô mà chưa chọn nhóm: báo và không lưu', { alerts: s.alerts })

    // Ca 3: tắt "Lấy thông tin quản trị viên": không hiện hai ô.
    await page.evaluate(() => { window.adminSmoke.reset(); window.adminSmoke.open(false) })
    await save.waitFor()
    await openStep()
    check(await form.getByText(uidLabel, { exact: true }).count() === 0, 'tắt lấy quản trị viên: không hiện hai ô', {})

    const failed = results.filter(ok => !ok).length
    console.log(`== ${results.length - failed}/${results.length} PASS`)
    if (failed) process.exitCode = 1
  } finally {
    if (app) await app.close().catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exit(1) })

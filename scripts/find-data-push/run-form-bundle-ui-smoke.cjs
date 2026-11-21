// Chạy form thật trên Electron (IPC giả theo luật DB) cho ca lưu chiến dịch tìm data chạy bằng Nhóm data kèm chiến dịch đích tạo kèm.
//   ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/find-data-push/run-form-bundle-ui-smoke.cjs [--form <đường dẫn CampaignFormModal.tsx khác>]
// --form: chạy bản form khác (ví dụ bản trước bản sửa, lấy bằng git show) để thấy bài kiểm bắt được lỗi cũ.
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, copyFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

const root = resolve(__dirname, '../..')
const formArg = process.argv.indexOf('--form')
const altForm = formArg >= 0 ? resolve(process.argv[formArg + 1]) : null
const realForm = join(root, 'src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'akaagent-form-bundle-'))
  let app
  let page
  const tmpForm = join(root, 'src/renderer/src/components/CampaignPanels/CampaignFormModal.__smoke_alt.tsx')
  try {
    const plugins = []
    if (altForm) {
      copyFileSync(altForm, tmpForm)
      plugins.push({ name: 'alt-form', setup(b) {
        b.onResolve({ filter: /CampaignPanels\/CampaignFormModal$/ }, () => ({ path: tmpForm }))
      } })
    }
    await build({ entryPoints: [join(__dirname, 'form-bundle-ui-smoke.tsx')], outdir: dir, bundle: true, platform: 'browser', format: 'iife',
      jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"file:///smoke/"' },
      loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'error', plugins })
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="form-bundle-ui-smoke.css"><body><div id="root"></div><script src="form-bundle-ui-smoke.js"></script></body></html>')
    writeFileSync(join(dir, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^https?:/.test(d.url) }));
      win.loadFile(${JSON.stringify(join(dir, 'index.html'))});
    });`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(dir, 'main.cjs')], cwd: root, env })
    page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    await page.waitForFunction(() => !!window.bundleSmoke)
    const form = page.locator('.campaign-full-modal')
    const save = form.getByRole('button', { name: 'Tạo chiến dịch', exact: true })
    const smoke = () => page.evaluate(() => ({ ...window.bundleSmoke.state, campaigns: window.bundleSmoke.campaigns() }))
    const waitSettled = () => page.waitForFunction(() => {
      const s = window.bundleSmoke.state
      return s.alerts.length > 0 || !document.querySelector('.campaign-full-modal')
    }, null, { timeout: 30000 })
    const results = []
    const check = (ok, label, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `\n  ${JSON.stringify(info).slice(0, 1500)}`}`) }

    // Ca 1: đích tạo kèm nhập data trực tiếp (cách form mới cho phép).
    await page.evaluate(() => { window.bundleSmoke.reset(); window.bundleSmoke.open('direct') })
    await save.waitFor()
    await save.click()
    await waitSettled()
    let s = await smoke()
    const live = s.campaigns.filter(c => !c.isDelete)
    const source = live.find(c => c.actionId === 'facebook_find_data_group')
    const target = live.find(c => c.actionId === 'facebook_message_uid')
    const bindErrors = s.alerts.filter(a => /bundle_child_invalid|Failed to bind/.test(a.message))
    check(!!source && !!target && bindErrors.length === 0, 'đích nhập trực tiếp: lưu được cả nguồn lẫn đích, không lỗi gắn Nhóm data', { alerts: s.alerts, live })
    check(source && source.creationBundleId === 3020 && source.dataGroupSourceBound === 7357, 'nguồn thuộc gói 3020, gắn Nhóm data 7357', { source })
    check(target && target.creationBundleId == null && !target.dataGroupSourceBound, 'đích không thuộc gói, không gắn Nhóm data', { target })
    check(source && JSON.stringify(source.extraSettings?.findUidTargetCampaignIds) === JSON.stringify([target?.id]), 'nguồn trỏ đúng id đích', { extra: source?.extraSettings })

    // Ca 2: nháp cũ có đích tạo kèm chạy bằng Nhóm data (cách khách 2481 đã chọn).
    await page.evaluate(() => { window.bundleSmoke.reset(); window.bundleSmoke.open('data_group') })
    await save.waitFor()
    await save.click()
    await waitSettled()
    s = await smoke()
    const live2 = s.campaigns.filter(c => !c.isDelete)
    const bindErrors2 = s.alerts.filter(a => /bundle_child_invalid/.test(a.message))
    check(bindErrors2.length === 0, 'nháp cũ (đích chạy bằng Nhóm data): không còn lỗi campaign_creation_bundle_child_invalid', { alerts: s.alerts })
    const leftovers = s.campaigns.filter(c => c.actionId === 'facebook_message_uid')
    check(leftovers.length <= 1, 'không tạo thừa chiến dịch đích', { leftovers })
    const binds2 = s.binds.map(b => ({ campaignId: b.campaignId, bundleId: b.bundleId ?? null, groupId: b.groupId }))
    check(binds2.every(b => (s.campaigns.find(c => c.id === b.campaignId)?.creationBundleId ?? null) === b.bundleId), 'mỗi lần gắn Nhóm data gửi đúng mã gói của chiến dịch đó', { binds2 })
    const target2 = live2.find(c => c.actionId === 'facebook_message_uid')
    check(!!target2 && target2.dataTargetSourceMode === 'direct' && !target2.dataGroupSourceBound,
      'nháp cũ: đích tạo kèm được lưu nhập data trực tiếp (để nhận data tìm được)', { target2, alerts: s.alerts })
    console.log(`  ghi chú ca 2: ${live2.length} chiến dịch còn, ${s.alerts.map(a => a.message.slice(0, 160)).join(' | ')}`)

    // Ca 3: lỗi mạng khi gắn Nhóm data của nguồn lần đầu, bấm lưu lại: không thừa chiến dịch đích.
    await page.evaluate(() => { window.bundleSmoke.reset(); window.bundleSmoke.state.failBindOnce = true; window.bundleSmoke.open('direct') })
    await save.waitFor()
    await save.click()
    await waitSettled()
    const firstTry = await smoke()
    console.log(`  ca 3 lần 1: ${firstTry.alerts.map(a => a.message.slice(0, 200)).join(' | ')}`)
    await page.evaluate(() => { window.bundleSmoke.state.alerts = [] })
    // Sau lỗi, nút lưu của form đổi thành "Lưu chiến dịch" (form giữ phần việc còn lại): bấm như khách.
    const retry = form.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).first()
    const callsBefore = (await smoke()).calls.length
    await retry.click()
    await page.waitForTimeout(3000)
    const afterRetry = await smoke()
    console.log(`  ca 3 sau Thử lại: ${afterRetry.calls.slice(callsBefore).map(c => c.method).join(', ')} | alerts: ${afterRetry.alerts.map(a => a.message.slice(0, 120)).join(' | ')}`)
    await page.waitForFunction(() => {
      const st = window.bundleSmoke.state
      return st.alerts.length > 0 || window.bundleSmoke.campaigns().some(c => c.actionId === 'facebook_message_uid' && !c.isDelete)
    }, null, { timeout: 30000 })
    await page.waitForTimeout(1500)
    s = await smoke()
    const targets3 = s.campaigns.filter(c => c.actionId === 'facebook_message_uid' && !c.isDelete)
    const sources3 = s.campaigns.filter(c => c.actionId === 'facebook_find_data_group' && !c.isDelete)
    check(targets3.length === 1 && sources3.length === 1, 'lưu lại sau lỗi mạng: đúng 1 nguồn + 1 đích còn lại', { campaigns: s.campaigns.map(c => [c.id, c.actionId, c.isDelete, c.creationBundleId]), alerts: s.alerts })
    check(s.errors.length === 0, 'không lỗi giao diện', { errors: s.errors })
    if (results.some(r => !r)) process.exitCode = 1
    console.log(`${results.filter(Boolean).length}/${results.length} đạt`)
  } catch (error) {
    if (page) console.error((await page.locator('body').innerText().catch(() => '')).slice(-4000))
    throw error
  } finally {
    if (app) await app.close()
    rmSync(dir, { recursive: true, force: true })
    if (altForm) rmSync(tmpForm, { force: true })
  }
}
main().catch(error => { console.error(error); process.exit(1) })

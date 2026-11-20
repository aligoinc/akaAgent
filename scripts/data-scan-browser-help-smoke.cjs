// Quét data: câu lỗi cho khách + nút "Mở trình duyệt" (anh duyệt câu 20/11/2026).
// Phần 1 kiểm bộ nhận diện src/shared/dataScanBrowserHelp.ts trên Node. Phần 2 dựng cửa sổ Quét data thật + AlertModal thật
// bằng esbuild, IPC giả, mở bằng Chromium của Playwright: không tài khoản thật, không mạng.
//   node scripts/data-scan-browser-help-smoke.cjs
//   DATA_SCAN_HELP_SHOTS=<thư mục> node scripts/data-scan-browser-help-smoke.cjs   # kiểm + chụp màn hình
const esbuild = require('esbuild')
const { chromium } = require('playwright')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-scan-browser-help-'))
const shots = process.env.DATA_SCAN_HELP_SHOTS || ''
if (shots) fs.mkdirSync(shots, { recursive: true })
let checks = 0
const ok = name => { checks += 1; console.log(`PASS ${name}`) }

async function classifierChecks() {
  const out = path.join(dir, 'help.cjs')
  await esbuild.build({ entryPoints: [path.join(root, 'src/shared/dataScanBrowserHelp.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
  const { describeDataScanError, DATA_SCAN_TEXT: T } = require(out)
  const fb = { flatformType: 'facebook', loginStatus: 'đã đăng nhập', proxyId: null }
  const fbProxy = { ...fb, proxyId: 7 }
  const zweb = { flatformType: 'zalo', isZaloShowWeb: true, loginStatus: 'đã đăng nhập' }
  const zqr = { flatformType: 'zalo', isZaloShowWeb: false, loginStatus: 'đã đăng nhập' }
  const zsrv = { flatformType: 'zalo', isZaloShowWeb: false, isZaloServer: true }

  // Lỗi mở trang: câu ngắn, mở đúng trang lỗi; "Đã lưu 0 data." của bản cũ bị bỏ, N > 0 thì giữ.
  assert.deepEqual(describeDataScanError("ERR_CONNECTION_TIMED_OUT (-118) loading 'https://business.facebook.com/content_management'. Đã lưu 0 data.", fb),
    { message: T.facebookPageUnreachable, openUrl: 'https://business.facebook.com/content_management' })
  assert.deepEqual(describeDataScanError("ERR_CONNECTION_RESET (-101) loading 'https://www.facebook.com/groups/joins/'. Đã lưu 12 data.", fb),
    { message: `${T.facebookPageUnreachable} Đã lưu 12 data.`, openUrl: 'https://www.facebook.com/groups/joins/' })
  assert.deepEqual(describeDataScanError("Lỗi block nav_to_url: ERR_NAME_NOT_RESOLVED (-105) loading 'https://www.facebook.com/friends/list'", fb),
    { message: T.facebookPageUnreachable, openUrl: 'https://www.facebook.com/friends/list' })
  // Trang không phải Facebook / không https: giữ nguyên câu, không nút.
  assert.deepEqual(describeDataScanError("ERR_FAILED (-2) loading 'about:blank'", fb), { message: "ERR_FAILED (-2) loading 'about:blank'" })
  assert.deepEqual(describeDataScanError("ERR_FAILED (-2) loading 'https://example.com/'", fb), { message: "ERR_FAILED (-2) loading 'https://example.com/'" })
  ok('lỗi mở trang Facebook: câu ngắn + mở đúng trang, giữ "Đã lưu N data." khi N > 0')

  // Proxy: chỉ khi tài khoản có proxy; câu riêng, không nút. Không proxy thì như lỗi mở trang.
  for (const code of ['ERR_PROXY_CONNECTION_FAILED (-130)', 'ERR_TUNNEL_CONNECTION_FAILED (-111)', 'ERR_NO_SUPPORTED_PROXIES (-336)', 'ERR_SOCKS_CONNECTION_FAILED (-120)']) {
    assert.deepEqual(describeDataScanError(`${code} loading 'https://www.facebook.com/'`, fbProxy), { message: T.facebookProxyUnreachable })
  }
  assert.deepEqual(describeDataScanError("ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://www.facebook.com/'", fb),
    { message: T.facebookPageUnreachable, openUrl: 'https://www.facebook.com/' })
  ok('lỗi proxy: câu riêng không nút khi tài khoản có proxy')

  // Mã xác minh Business: câu của tiến trình chính (quét hộp thư page) và câu của block quét page (V589), cả bản bọc IPC.
  const verifyMain = 'Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm chuột phải vào tài khoản, chọn "Kiểm tra nhập mã xác minh Fanpage", nhập mã rồi tìm data lại.'
  const verifyBlock = 'Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm chuột phải vào tài khoản, chọn "Kiểm tra nhập mã xác minh Fanpage", nhập mã rồi tải page lại.'
  for (const raw of [verifyMain, verifyBlock, `Error invoking remote method 'contacts:load-pages': Error: ${verifyBlock}`]) {
    assert.deepEqual(describeDataScanError(raw, fb), { message: T.facebookVerificationCode, openUrl: 'https://business.facebook.com/content_management' })
  }
  ok('mã xác minh Business: câu mới + mở trang Business (cả câu block V589 và lỗi bọc IPC)')

  // Chưa đăng nhập: tách theo trạng thái.
  assert.deepEqual(describeDataScanError('Tài khoản chưa đăng nhập Facebook', fb), { message: T.facebookNotLoggedIn, openUrl: 'https://www.facebook.com/' })
  assert.deepEqual(describeDataScanError('Tài khoản chưa đăng nhập Facebook', { ...fb, loginStatus: 'checkpoint' }), { message: T.facebookCheckpoint, openUrl: 'https://www.facebook.com/' })
  ok('chưa đăng nhập Facebook: câu riêng cho checkpoint')

  // Zalo trình duyệt.
  for (const raw of [
    'Chưa xác minh được phiên Zalo Web: Chưa xác minh được phiên Zalo Web; hãy bấm Kiểm tra đăng nhập để thử lại',
    'Chưa xác minh được phiên Zalo Web: zpw_sek bị thiếu hoặc không đúng (123)',
    'Hãy mở tab Zalo Web trước khi chạy tác vụ',
    'Bộ theo dõi phiên Zalo Web chưa sẵn sàng; hãy tải lại tab Zalo'
  ]) assert.deepEqual(describeDataScanError(raw, zweb), { message: T.zaloWebNotReady, openUrl: 'https://chat.zalo.me/' })
  for (const raw of ['Tài khoản chưa đăng nhập Zalo', 'Zalo Web đã đăng xuất', 'Chưa xác minh được phiên Zalo Web: Zalo Web đã đăng xuất']) {
    assert.deepEqual(describeDataScanError(raw, zweb), { message: T.zaloWebLoggedOut, openUrl: 'https://chat.zalo.me/' })
  }
  ok('Zalo trình duyệt: câu chưa sẵn sàng / chưa đăng nhập + tải lại chat.zalo.me')

  // Không đổi: Zalo QR, Zalo Server, lỗi khác, không có tài khoản.
  for (const [raw, account] of [
    ['Tài khoản chưa đăng nhập Zalo', zqr], ['Tài khoản chưa đăng nhập Zalo', zsrv],
    ['Chưa xác minh được phiên Zalo Web: x', zqr], ['Không tìm thấy group nào', fb],
    ['Không đọc được người like bài viết', fb], ['Tài khoản chưa đăng nhập Facebook', undefined],
    ['Tài khoản đang chạy chiến dịch hoặc quét data, vui lòng đợi hoàn tất hoặc tạm dừng tác vụ hiện tại.', fb]
  ]) assert.deepEqual(describeDataScanError(raw, account), { message: raw })
  ok('không đổi các lỗi khác (Zalo QR / Server, không thấy data, tài khoản đang chạy)')
}

const app = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import Scan from './src/renderer/src/components/DataScan/DataScanModal';
import AlertModal from './src/renderer/src/components/CampaignPanels/AlertModal';
import {useCampaignStore} from './src/renderer/src/stores/campaignStore';
import {useAuthStore} from './src/renderer/src/stores/authStore';
import {useBrowserOpenStore} from './src/renderer/src/stores/browserOpenStore';
import './src/renderer/src/styles/global.css';
const accounts=[
 {id:13,name:'FB thường',flatformType:'facebook',loginStatus:'đã đăng nhập',status:'chờ xử lý',isActive:true,isDelete:false,proxyId:null},
 {id:14,name:'FB checkpoint',flatformType:'facebook',loginStatus:'checkpoint',status:'chờ xử lý',isActive:true,isDelete:false,proxyId:null},
 {id:15,name:'FB proxy',flatformType:'facebook',loginStatus:'đã đăng nhập',status:'chờ xử lý',isActive:true,isDelete:false,proxyId:7},
 {id:16,name:'Zalo trình duyệt',flatformType:'zalo',isZaloShowWeb:true,isZaloServer:false,loginStatus:'đã đăng nhập',status:'chờ xử lý',isActive:true,isDelete:false}
];
window.results={};window.opened=[];window.shown=0;window.sequence=0;
const known={
 listAccounts:async()=>accounts,listDataGroups:async()=>({groups:[],total:0}),listDataTypeCategoryItems:async()=>[],
 listContactDatasets:async()=>[],getAkaBizContactTags:async()=>[],listAkaBizContactTags:async()=>[],getZaloServerOperationStates:async()=>[],
 listContacts:async()=>[],cancelDataColumnFilters:async()=>true,
 readDataColumnFilters:async()=>({available:true,total:0,contacts:[],members:[],ids:[]}),
 loadFriends:async id=>window.results[id]
};
window.electronAPI=new Proxy(known,{get(t,name){if(name in t)return t[name];if(typeof name!=='string')return undefined;return name.startsWith('on')?()=>()=>{}:async()=>[]}});
// Gán người dùng trước: đổi phiên thì kho chiến dịch xoá danh sách tài khoản.
useAuthStore.setState({user:{staffId:1,organizationId:1,entitlements:{facebookCore:true,facebookFanpage:true,zalo:true}}});
useCampaignStore.setState({accounts,loadAccounts:async()=>{}});
// Như App: open() chỉ cho tab tải trang khi showPage false; showPage() chuyển sang trang Trình duyệt.
useBrowserOpenStore.getState().setHandler({
 open:request=>{window.opened.push(request);if(request.showPage!==false)document.body.dataset.activePage='browsers'},
 showPage:()=>{window.shown++;document.body.dataset.activePage='browsers'}
});
const view=createRoot(document.getElementById('root'));
window.openScan=(action,accountId,nested)=>{
 document.body.dataset.activePage='campaigns';
 const scan=<Scan key={++window.sequence} initialAction={action} initialAccountId={accountId} lockAction lockAccount
   onClose={()=>view.render(<AlertModal/>)} onSelect={nested?(()=>{}):undefined}/>;
 view.render(<>{nested?<div className="modal-overlay campaign-form-modal-overlay" id="host-form">{scan}</div>:scan}<AlertModal/></>);
};
`

async function uiChecks() {
  await esbuild.build({ stdin: { contents: app, resolveDir: root, loader: 'tsx' }, bundle: true, format: 'iife', outfile: path.join(dir, 'app.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file', '.png': 'file' }, logLevel: 'warning' })
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
  const server = http.createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1)
    if (name.includes('..') || !fs.existsSync(path.join(dir, name))) { res.writeHead(404); res.end(); return }
    res.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html')
    res.end(fs.readFileSync(path.join(dir, name)))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try { browser = await chromium.launch({ headless: true }) } catch { browser = await chromium.launch({ headless: true, channel: 'chrome' }) }
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.setDefaultTimeout(10000)
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction(() => window.openScan)
    const alertBox = page.locator('.campaign-feedback-modal')
    const shot = async name => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }) }
    const scanWith = async (action, accountId, error, nested = false) => {
      await page.evaluate(([id, e]) => { window.results[id] = { success: false, count: 0, error: e } }, [accountId, error])
      await page.evaluate(([a, id, n]) => window.openScan(a, id, n), [action, accountId, nested])
      await page.locator('.data-scan-load-button').click()
      await alertBox.waitFor()
      return (await alertBox.locator('.campaign-modal-body').innerText()).trim()
    }
    const buttons = async () => (await alertBox.locator('.modal-footer button').allInnerTexts()).map(t => t.trim())
    const activePage = () => page.evaluate(() => document.body.dataset.activePage)
    // Bấm "Mở trình duyệt": nút khoá, hiện "Đang mở…"; tab được yêu cầu tải trang ngay nhưng chưa chuyển trang.
    const clickOpen = async expected => {
      const shownBefore = await page.evaluate(() => window.shown)
      const started = Date.now()
      await alertBox.getByRole('button', { name: 'Mở trình duyệt' }).click()
      const pending = alertBox.locator('.modal-footer button.btn-primary')
      assert.equal((await pending.innerText()).trim(), 'Đang mở…')
      assert.equal(await pending.isDisabled(), true)
      assert.equal(await pending.locator('svg.spin').count(), 1, 'có vòng xoay')
      assert.deepEqual(await page.evaluate(() => window.opened.at(-1)), { ...expected, showPage: false })
      assert.equal(await activePage(), 'campaigns', 'chưa chuyển trang khi đang chờ')
      return { shownBefore, started }
    }
    const waitSwitched = async ({ shownBefore, started }) => {
      await alertBox.waitFor({ state: 'detached', timeout: 8000 })
      const waited = Date.now() - started
      assert.ok(waited >= 2800, `chờ đủ khoảng 3 giây trước khi chuyển (${waited} ms)`)
      assert.equal(await page.evaluate(() => window.shown), shownBefore + 1)
      assert.equal(await activePage(), 'browsers')
      return waited
    }

    // 1. Lỗi mở trang (cửa sổ đứng riêng): câu ngắn, hai nút; bấm mở tab đúng trang, cửa sổ thu nhỏ có nút Mở rộng form.
    let text = await scanWith('facebook_friends', 13, "ERR_CONNECTION_TIMED_OUT (-118) loading 'https://www.facebook.com/friends/list'. Đã lưu 0 data.")
    assert.equal(text, 'Không mở được trang Facebook. Bấm "Mở trình duyệt" để kiểm tra.')
    assert.deepEqual(await buttons(), ['Đóng', 'Mở trình duyệt'])
    await shot('1-loi-mo-trang')
    let pending = await clickOpen({ accountId: 13, openUrl: 'https://www.facebook.com/friends/list' })
    assert.equal(await page.locator('.data-scan-modal.minimized').count(), 0, 'chưa thu nhỏ khi đang chờ')
    await shot('1-dang-mo')
    const waited = await waitSwitched(pending)
    await page.locator('.data-scan-modal.minimized').waitFor()
    assert.equal(await page.locator('.data-scan-minimized-title').count(), 0, 'không hiện "Đang tải data" khi không quét')
    await shot('1-thu-nho')
    await page.locator('.data-scan-minimized-body').getByRole('button', { name: 'Mở rộng form' }).click()
    await page.locator('.data-scan-load-button').waitFor()
    ok(`lỗi mở trang: câu ngắn; bấm nút thì "Đang mở…" + vòng xoay, tab tải trang, ${waited} ms sau mới chuyển; cửa sổ thu nhỏ rồi mở rộng lại được`)

    // 1b. Đóng trong lúc chờ: huỷ việc chuyển trang, cửa sổ quét giữ nguyên.
    await scanWith('facebook_friends', 13, "ERR_CONNECTION_TIMED_OUT (-118) loading 'https://www.facebook.com/friends/list'")
    pending = await clickOpen({ accountId: 13, openUrl: 'https://www.facebook.com/friends/list' })
    assert.equal(await alertBox.getByRole('button', { name: 'Đóng' }).isDisabled(), false, 'Đóng vẫn bấm được khi đang chờ')
    await alertBox.getByRole('button', { name: 'Đóng' }).click()
    await alertBox.waitFor({ state: 'detached', timeout: 1000 })
    await page.waitForTimeout(3600)
    assert.equal(await page.evaluate(() => window.shown), pending.shownBefore, 'không chuyển trang sau khi Đóng')
    assert.equal(await activePage(), 'campaigns')
    assert.equal(await page.locator('.data-scan-modal.minimized').count(), 0)
    // X cũng huỷ.
    await scanWith('facebook_friends', 13, "ERR_CONNECTION_TIMED_OUT (-118) loading 'https://www.facebook.com/friends/list'")
    pending = await clickOpen({ accountId: 13, openUrl: 'https://www.facebook.com/friends/list' })
    await alertBox.locator('.campaign-modal-top .btn-icon').click()
    await alertBox.waitFor({ state: 'detached', timeout: 1000 })
    await page.waitForTimeout(3600)
    assert.equal(await page.evaluate(() => window.shown), pending.shownBefore, 'không chuyển trang sau khi bấm X')
    ok('Đóng / X trong lúc chờ: huỷ chuyển trang, cửa sổ quét giữ nguyên')

    // 2. Đóng: không mở tab.
    const before = await page.evaluate(() => window.opened.length)
    await page.evaluate(() => { document.body.dataset.activePage = 'campaigns' })
    text = await scanWith('facebook_friends', 13, 'Tài khoản chưa đăng nhập Facebook')
    assert.equal(text, 'Tài khoản chưa đăng nhập Facebook. Bấm "Mở trình duyệt" để đăng nhập, rồi quét lại.')
    await alertBox.getByRole('button', { name: 'Đóng' }).click()
    assert.equal(await page.evaluate(() => window.opened.length), before)
    assert.equal(await page.locator('.data-scan-modal.minimized').count(), 0)
    ok('chưa đăng nhập Facebook: câu mới; bấm Đóng không mở tab')

    // 3. Checkpoint.
    text = await scanWith('facebook_friends', 14, 'Tài khoản chưa đăng nhập Facebook')
    assert.equal(text, 'Facebook đang yêu cầu xác minh tài khoản này. Bấm "Mở trình duyệt" để xử lý, rồi quét lại.')
    await waitSwitched(await clickOpen({ accountId: 14, openUrl: 'https://www.facebook.com/' }))
    ok('checkpoint: câu riêng, nút mở facebook.com')

    // 4. Proxy: chỉ nút Đóng.
    text = await scanWith('facebook_friends', 15, "ERR_TUNNEL_CONNECTION_FAILED (-111) loading 'https://www.facebook.com/friends/list'")
    assert.equal(text, 'Không kết nối được proxy của tài khoản nên không mở được trang Facebook. Vui lòng kiểm tra lại proxy.')
    assert.deepEqual(await buttons(), ['Đóng'])
    await alertBox.getByRole('button', { name: 'Đóng' }).click()
    ok('lỗi proxy: câu riêng, chỉ nút Đóng')

    // 5. Zalo trình duyệt: tải lại chat.zalo.me.
    text = await scanWith('zalo_friends', 16, 'Chưa xác minh được phiên Zalo Web: Chưa xác minh được phiên Zalo Web; hãy bấm Kiểm tra đăng nhập để thử lại')
    assert.equal(text, 'Zalo trên trình duyệt của tài khoản này chưa sẵn sàng. Bấm "Mở trình duyệt" để tải lại trang Zalo, rồi quét lại.')
    await shot('5-zalo-web')
    await waitSwitched(await clickOpen({ accountId: 16, openUrl: 'https://chat.zalo.me/' }))
    ok('Zalo trình duyệt: câu mới, nút tải lại chat.zalo.me')

    // 6. Lỗi khác: giữ câu, chỉ nút Đóng.
    text = await scanWith('facebook_friends', 13, 'Không tìm thấy bạn bè nào')
    assert.equal(text, 'Không tìm thấy bạn bè nào')
    assert.deepEqual(await buttons(), ['Đóng'])
    await alertBox.getByRole('button', { name: 'Đóng' }).click()
    ok('không thấy data: giữ câu, chỉ nút Đóng')

    // 7. Trong form chiến dịch: form bị ẩn ở trang Trình duyệt (cùng cửa sổ quét, không thu nhỏ), quay lại thì hiện như cũ.
    text = await scanWith('facebook_friends', 13, 'Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm chuột phải vào tài khoản, chọn "Kiểm tra nhập mã xác minh Fanpage", nhập mã rồi tìm data lại.', true)
    assert.equal(text, 'Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm "Mở trình duyệt", nhập mã rồi quét lại.')
    await shot('7-ma-xac-minh')
    pending = await clickOpen({ accountId: 13, openUrl: 'https://business.facebook.com/content_management' })
    assert.notEqual(await page.locator('#host-form').evaluate(el => getComputedStyle(el).display), 'none', 'form còn hiện khi đang chờ')
    await waitSwitched(pending)
    assert.equal(await page.locator('#host-form').evaluate(el => getComputedStyle(el).display), 'none')
    assert.equal(await page.locator('.data-scan-modal.minimized').count(), 0)
    await page.evaluate(() => { document.body.dataset.activePage = 'campaigns' })
    assert.notEqual(await page.locator('#host-form').evaluate(el => getComputedStyle(el).display), 'none')
    await page.locator('.data-scan-load-button').waitFor()
    ok('trong form chiến dịch: ẩn ở trang Trình duyệt, quay lại hiện nguyên cửa sổ quét')

    assert.deepEqual(errors, [], `lỗi trang: ${errors.join(' | ')}`)
  } finally {
    await browser.close()
    server.close()
  }
}

;(async () => {
  try {
    await classifierChecks()
    await uiChecks()
    console.log(`OK ${checks} nhóm`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exit(1) })

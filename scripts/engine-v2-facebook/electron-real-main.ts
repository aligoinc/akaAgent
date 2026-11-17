// Chạy TRONG tiến trình chính của Electron thật (bởi electron-real-smoke.cjs). Phần chỉ Chromium thật kiểm được (phương án mục 9.5):
// PageController + vết thao tác trên DOM thật, code block thật lấy từ ảnh chụp DB với XPath thật, đọc chữ trên trang cho dấu hiệu lỗi,
// chụp ảnh trên cửa sổ chạy ngầm ẩn và huỷ cửa sổ khi block treo. Trang Facebook là trang giả phục vụ từ máy (không chạm Facebook).
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { PageController } from '../../src/main/v2/runtime/pageController'
import { BlockExecutor } from '../../src/main/v2/runtime/blockExecutor'
import { PageTrace, isNotDispatchedError, tracePage } from '../../src/main/engineAdapters/facebook/pageTrace'
import { matchPageSign, parseFacebookErrorSigns, PAGE_SIGN_TEXTS_SCRIPT } from '../../src/main/engineAdapters/facebook/errorSigns'

interface Fixture { elements: Record<string, string>; blocks: Array<{ id: number; name: string; md5: string; code: string }> }
const fixture = JSON.parse(fs.readFileSync(String(process.env.FB_ELECTRON_FIXTURE), 'utf8')) as Fixture
const signs = parseFacebookErrorSigns(process.env.FB_ELECTRON_SIGNS ?? '[]')

let passed = 0
let failed = 0
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${(error as Error)?.stack ?? error}`) }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

// Trang giả theo đúng XPath thật (fb_composer_button, fb_composer_dialog, fb_post_button); thanh bên có chữ dễ nhầm để kiểm bản đọc trang.
const SIDEBAR = '<div role="navigation"><span>Lối tắt của bạn</span><span>Bạn hiện không xem được nội dung này</span></div>'
const GROUP_OK = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Nhóm thử</title></head><body>${SIDEBAR}
<div role="main"><h1>Nhóm thử</h1><div role="button" id="composer" style="padding:8px">Bạn viết gì đi...</div></div>
<script>
document.getElementById('composer').addEventListener('click', () => {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.innerHTML = '<h2 role="heading">Tạo bài viết</h2><form method="POST"><div contenteditable="true" class="notranslate" role="textbox" style="min-height:40px"></div>'
    + '<div role="button" aria-label="Đăng" id="post" style="padding:8px">Đăng</div></form>'
  document.body.appendChild(dialog)
  dialog.querySelector('#post').addEventListener('click', () => { window.__posted = (window.__posted || 0) + 1; setTimeout(() => dialog.remove(), 300) })
})
</script></body></html>`
const GROUP_UNAVAILABLE = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Facebook</title></head><body>${SIDEBAR}
<div role="main"><div><h2><span>Bạn hiện không xem được nội dung này</span></h2>
<span>Lỗi này thường do chủ sở hữu chỉ chia sẻ nội dung với một nhóm nhỏ, thay đổi người được xem hoặc đã xóa nội dung.</span>
<div role="button" aria-label="Đi đến Bảng feed">Đi đến Bảng feed</div></div></div></body></html>`
const PAGES: Record<string, string> = { '/groups/ok': GROUP_OK, '/groups/unavailable': GROUP_UNAVAILABLE, '/blank': '<!doctype html><html><body>trống</body></html>' }
// /never: máy chủ giữ kết nối, không trả lời (điều hướng treo).

/** Cửa sổ chạy ngầm cấu hình y như BackgroundPageManager.getOrCreate (ẩn, offscreen, không giảm tốc khi ẩn). */
function backgroundWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1920, height: 1080, show: false, skipTaskbar: true, frame: false, paintWhenInitiallyHidden: true,
    webPreferences: { partition: 'persist:account_electron_test', sandbox: false, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, offscreen: true }
  })
  win.webContents.setBackgroundThrottling(false)
  return win
}

async function runBlock(name: string, page: PageController, trace: PageTrace, input: Record<string, unknown> = {}) {
  const block = fixture.blocks.find(item => item.name === name)
  assert(block, `ảnh chụp thiếu block ${name}`)
  return await new BlockExecutor().execute({ code: block.code, blockName: name, timeoutMs: 120_000 }, {
    input, page, vars: {}, signal: new AbortController().signal,
    runtimeHelpers: {
      observeElement: (element, selector) => trace.noteElement(element, selector),
      observeSleep: phase => { if (phase === 'start') trace.sleepStart(); else trace.sleepEnd() }
    }
  })
}

async function main(): Promise<void> {
  const server = http.createServer((req, res) => {
    if (String(req.url ?? '').startsWith('/never')) return
    const html = PAGES[String(req.url ?? '').split('?')[0]]
    res.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html ?? 'không có')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const win = backgroundWindow()
  const page = new PageController(win.webContents)
  const trace = new PageTrace()
  const traced = tracePage(page, trace)

  await check('block thật 27 trên trang nhóm có ô đăng bài, cửa sổ ẩn như app: mở được hộp đăng bài, vết ghi theo tên phần tử', async () => {
    await page.navigate(`${base}/groups/ok`)
    trace.beginBlock([])
    const result = await runBlock('fb_open_composer', traced, trace, { composerActionCode: 'fb_post_group' })
    assert(result.success && (result.output as { opened?: boolean }).opened === true, `kết quả ${JSON.stringify(result.output ?? result.error)}`)
    const ops = trace.snapshot().ops.map(op => `${op.op}:${op.el ?? op.sel ?? ''}:${op.ok}`)
    for (const want of ['wait:fb_composer_button:true', 'click:fb_composer_button:true', 'wait:fb_composer_dialog:true']) {
      assert(ops.includes(want), `vết thiếu ${want}: ${ops.join(', ')}`)
    }
    const texts = await page.evaluate<string[]>(PAGE_SIGN_TEXTS_SCRIPT)
    assert(matchPageSign(signs, { actionCode: 'fb_post_group', phase: 'before_send', currentErrorCode: 'err_fb_group_composer_editor_not_found' }, texts) === null,
      'trang nhóm bình thường không được khớp dấu hiệu FB14 (chữ ở thanh bên không tính)')
  })

  await check('block thật 30 bấm Đăng trong hộp đăng bài: trang nhận đúng một cú bấm, vết báo cú bấm gửi đã chạy (mức 2)', async () => {
    trace.beginBlock(['click:fb_post_button'])
    const result = await runBlock('fb_click_post_button', traced, trace)
    assert(result.success && (result.output as { posted?: boolean }).posted === true, `kết quả ${JSON.stringify(result.output ?? result.error)}`)
    assert(trace.sendAttempted, 'vết phải báo cú bấm gửi đã chạy')
    assert(await page.evaluate<number>('return window.__posted || 0') === 1, 'trang phải nhận đúng một cú bấm Đăng')
    const ops = trace.snapshot().ops
    assert(ops.some(op => op.op === 'query' && op.el === 'FbComposerNextButton' && op.ok), 'thao tác thử nút Tiếp (không có) không phải lỗi')
  })

  await check('nhóm không còn xem được: block 27 trả FB40 sau khi chờ ô đăng bài, chữ trên trang khớp dấu hiệu FB14, thanh bên không bị đọc', async () => {
    await page.navigate(`${base}/groups/unavailable`)
    trace.beginBlock([])
    const result = await runBlock('fb_open_composer', traced, trace, { composerActionCode: 'fb_post_group' })
    const output = result.output as { opened?: boolean; actionResult?: { errorCode?: string; operationState?: string } }
    assert(result.success && output.opened === false, `kết quả ${JSON.stringify(output ?? result.error)}`)
    assert(output.actionResult?.errorCode === 'err_fb_group_composer_editor_not_found' && output.actionResult.operationState === 'not_committed',
      `mã ${JSON.stringify(output.actionResult)}`)
    const texts = await page.evaluate<string[]>(PAGE_SIGN_TEXTS_SCRIPT)
    assert(texts.includes('Bạn hiện không xem được nội dung này'), `chữ đọc được: ${JSON.stringify(texts)}`)
    assert(!texts.includes('Lối tắt của bạn'), 'không đọc thanh bên')
    const sign = matchPageSign(signs, { actionCode: 'fb_post_group', phase: 'before_send', currentErrorCode: 'err_fb_group_composer_editor_not_found' }, texts)
    assert(sign?.code === 'err_fb_group_cannot_post_unavailable', `dấu hiệu ${JSON.stringify(sign)}`)
  })

  await check('ảnh lỗi chụp được trên cửa sổ chạy ngầm đang ẩn (offscreen), là JPEG', async () => {
    const jpeg = await page.captureJpeg(70, 1280)
    assert(Buffer.isBuffer(jpeg) && jpeg.length > 1000 && jpeg[0] === 0xff && jpeg[1] === 0xd8, `ảnh ${jpeg?.length ?? 0} byte`)
  })

  await check('block treo (Q20): huỷ cửa sổ KHÔNG làm lời gọi đang chờ kết thúc; vết thao tác của engine kết thúc chúng (abandonPending) như bộ lập lịch làm', async () => {
    const hangWin = backgroundWindow()
    const hangPage = new PageController(hangWin.webContents)
    await hangPage.navigate(`${base}/blank`)
    const hangTrace = new PageTrace()
    hangTrace.beginBlock(['evaluate'])
    const hangTraced = tracePage(hangPage, hangTrace)
    const tag = (promise: Promise<unknown>) => promise.then(() => 'xong', (error: Error) => `lỗi: ${error.message}`)
    const raw = tag(hangPage.evaluate('return new Promise(() => {})'))
    const viaTrace = tag(hangTraced.evaluate('return new Promise(() => {})'))
    const navigation = tag(hangTraced.navigate(`${base}/never`))
    await sleep(500)
    hangWin.destroy()
    const wait = Number(process.env.FB_ELECTRON_HANG_WAIT_MS || 3_000)
    const rawAfter = await Promise.race([raw, sleep(wait).then(() => 'vẫn chờ')])
    const navAfter = await Promise.race([navigation, sleep(50).then(() => 'vẫn chờ')])
    console.log(`  Electron sau ${wait} ms kể từ khi huỷ cửa sổ: evaluate ${rawAfter}; navigate ${navAfter}`)
    // Như bộ lập lịch khi nhận ra block treo / cửa sổ đã đóng.
    const abandoned = hangTrace.abandonPending('Thao tác trên Facebook không phản hồi, đã đóng cửa sổ chạy ngầm')
    const settled = await Promise.race([viaTrace, sleep(1_000).then(() => 'vẫn chờ')])
    assert(settled === 'lỗi: Thao tác trên Facebook không phản hồi, đã đóng cửa sổ chạy ngầm', `qua vết thao tác: ${settled}`)
    assert(abandoned >= 1, `số lời gọi được kết thúc: ${abandoned}`)
    assert(hangTrace.sendAttempted, 'lời gọi gửi đang dở bị cắt thì coi như có thể đã gửi (không gửi lại)')
    const ops = hangTrace.snapshot().ops.filter(op => op.op === 'evaluate')
    assert(ops.some(op => !op.ok && op.err?.includes('không phản hồi')), 'vết ghi thao tác bị cắt')
    const after = await hangPage.click('//body').then(() => 'không lỗi', (error: Error) => error.message)
    assert(isNotDispatchedError(after), `thao tác sau khi huỷ: ${after}`)
  })

  win.destroy()
  server.closeAllConnections()
  server.close()
  console.log(`\n${passed} nhóm kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  app.exit(failed ? 1 : 0)
}

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-electron-')))
app.dock?.hide()
app.on('window-all-closed', () => { /* chạy tiếp tới khi main gọi app.exit */ })
app.whenReady().then(main).catch(error => { console.log(`FAIL khởi chạy: ${error?.stack ?? error}`); app.exit(1) })

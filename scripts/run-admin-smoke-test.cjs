const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { createServer: createHttpServer } = require('node:http')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-admin-smoke-'))
  const { createServer } = await import('vite')
  let server, permissionServer, app
  const errors = []
  try {
    await build({ entryPoints: ['admin', 'adminNotification', 'appNotification', 'adminCron'].map(name => join(root, 'src/shared', `${name}.ts`)),
      outdir: join(directory, 'shared'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
    const { canAccessAdmin } = require(join(directory, 'shared/admin.js'))
    const { readNotificationDraft, writeNotificationDraft, vietnamDateInput } = require(join(directory, 'shared/adminNotification.js'))
    const { parseAppNotification } = require(join(directory, 'shared/appNotification.js'))
    const { describeCronSchedule } = require(join(directory, 'shared/adminCron.js'))
    assert.equal(describeCronSchedule('* * * * *'), 'Mỗi phút')
    assert.equal(describeCronSchedule('*/5 * * * *'), 'Mỗi 5 phút')
    assert.equal(describeCronSchedule('0 * * * *'), 'Mỗi giờ, vào phút 00')
    assert.equal(describeCronSchedule('0 5,11 * * *'), '05:00, 11:00 · hằng ngày')
    assert.equal(describeCronSchedule('30 1 * * 1'), '01:30 · Thứ 2')
    assert.equal(describeCronSchedule('30 seconds'), 'Mỗi 30 giây')
    for (const identity of [null, { organizationId: 1 }, { organizationId: 1, isAdmin: null, isAdminAkabiz: true }, { organizationId: 2, isAdmin: true }]) assert.equal(canAccessAdmin(identity), false)
    assert.equal(canAccessAdmin({ organizationId: 1, isAdmin: true, isAdminAkabiz: false }), true)
    assert.equal(readNotificationDraft('Legacy text').message, 'Legacy text')
    const futureRaw = JSON.stringify({ message: 'Future', starts_at: '2999-01-01T00:00:00Z', custom: 'preserved' })
    const futureDraft = readNotificationDraft(futureRaw)
    assert.equal(futureDraft.message, 'Future')
    assert.equal(parseAppNotification(1, undefined, futureRaw), null)
    const revised = JSON.parse(writeNotificationDraft(futureRaw, { ...futureDraft, startsAt: '' }))
    assert.equal(revised.custom, 'preserved'); assert.equal(revised.starts_at, undefined)
    assert.equal(parseAppNotification(1, undefined, JSON.stringify(revised)).message, 'Future')
    assert.equal(vietnamDateInput('2026-09-20T01:00:00Z'), '2026-09-20T08:00')
    assert.throws(() => writeNotificationDraft('', { ...futureDraft, linkUrl: 'javascript:alert(1)' }))
    assert.throws(() => writeNotificationDraft('', { ...futureDraft, endsAt: '2020-01-01' }))
    console.log('PASS strict admin gate and legacy/future notification compatibility')
    await build({ entryPoints: [join(__dirname, 'admin-electron-fixture.ts')], outfile: join(directory, 'main.cjs'),
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'warning', plugins: [{
        name: 'no-production-database', setup(builder) {
          builder.onResolve({ filter: /\/supabaseClient$/ }, args => ({ path: args.path, namespace: 'admin-fixture-db' }))
          builder.onLoad({ filter: /.*/, namespace: 'admin-fixture-db' }, () => ({ contents: 'export const getSupabaseClient = () => globalThis.adminSmokeClient', loader: 'js' }))
        }
      }] })
    await build({ entryPoints: [join(__dirname, 'admin-fixture-preload.ts')], outfile: join(directory, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'warning' })
    server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'error', esbuild: { jsx: 'automatic' },
      server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'admin-smoke-pages', configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url === '/admin-fixture') {
            res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="vi"><head><meta charset="utf-8"></head><body class="theme-light"><div id="root"></div><script type="module" src="/scripts/admin-ui-fixture.tsx"></script></body></html>'); return
          }
          if (req.url?.startsWith('/admin-doc-')) {
            res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body><h1>Developer portal fixture</h1><form id="login"><input name="username"><button>Login fixture</button></form><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.cookie="fixture=logged-in;path=/";localStorage.setItem("login","yes")}</script></body></html>'); return
          }
          next()
        })
      } }] })
    await server.listen()
    const base = `http://127.0.0.1:${server.httpServer.address().port}`
    permissionServer = createHttpServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end('<!doctype html><html><body><script>navigator.permissions.query({name:"clipboard-write"}).then(result=>parent.postMessage({kind:"clipboard-permission",state:result.state},"*")).catch(error=>parent.postMessage({kind:"clipboard-permission",state:error.message},"*"))</script></body></html>')
    })
    await new Promise(resolve => permissionServer.listen(0, '127.0.0.1', resolve))
    const foreignOrigin = `http://127.0.0.1:${permissionServer.address().port}`
    const env = { ...process.env, AKA_ADMIN_FIXTURE_DIRECTORY: directory, AKA_ADMIN_FIXTURE_URL: base }
    delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: root, env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20000)
    page.on('pageerror', error => errors.push(error.message))
    const guestInfo = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(view => view.getType() === 'webview').map(view => ({ id: view.id, url: view.getURL() })))
    const waitGuest = async path => {
      await page.waitForFunction(() => !!document.querySelector('webview') && !document.querySelector('.admin-webview-cover'))
      for (let i=0;i<60;i++) {
        const guests=await guestInfo()
        if (guests.length===1 && guests[0].url.endsWith(path)) return guests[0].id
        await page.waitForTimeout(100)
      }
      throw new Error(`Guest did not load ${path}: ${JSON.stringify(await guestInfo())}`)
    }
    const guestEval = (id, source) => app.evaluate(({ webContents }, { id, source }) => webContents.fromId(id).executeJavaScript(source), { id, source })
    const selectMenu = name => page.getByRole('navigation', { name: 'Menu Admin akaBiz' }).getByRole('button', { name, exact: true }).click()
    const state = () => app.evaluate(() => globalThis.adminSmoke.state())
    const calls = () => app.evaluate(() => globalThis.adminSmoke.calls)
    const dialog = () => page.getByRole('dialog')

    let id = await waitGuest('/admin-doc-1')
    assert.equal(await guestEval(id, 'typeof window.require'), 'undefined')
    // Query permissions without reading/writing the user's clipboard or focusing the window.
    assert.equal(await guestEval(id, 'navigator.permissions.query({name:"clipboard-write"}).then(result=>result.state)'), 'granted')
    assert.equal(await guestEval(id, 'navigator.permissions.query({name:"clipboard-read"}).then(result=>result.state)'), 'denied')
    assert.equal(await guestEval(id, 'navigator.permissions.query({name:"geolocation"}).then(result=>result.state)'), 'denied')
    const foreignPermission = await guestEval(id, `new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Permission iframe did not respond')); }, 5000);
      const receive = event => {
        if (event.source !== frame.contentWindow || event.origin !== ${JSON.stringify(foreignOrigin)} || event.data?.kind !== 'clipboard-permission') return;
        cleanup(); resolve(event.data.state);
      };
      const cleanup = () => { clearTimeout(timeout); removeEventListener('message', receive); frame.remove(); };
      addEventListener('message', receive);
      frame.allow = 'clipboard-write'; frame.src = ${JSON.stringify(`${foreignOrigin}/admin-permission-frame`)};
      document.body.append(frame);
    })`)
    assert.equal(foreignPermission, 'denied')
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
    console.log('PASS document clipboard write only, foreign-origin/read/device denial and no window activation')
    await guestEval(id, 'document.querySelector("input").value="fixture";document.querySelector("form").requestSubmit()')
    assert.equal(await guestEval(id, 'localStorage.getItem("login")'), 'yes')
    await page.getByRole('button', { name: /^API fixture 2/ }).click()
    id = await waitGuest('/admin-doc-2')
    assert.equal(await guestEval(id, 'document.cookie'), '')
    assert.equal(await guestEval(id, 'localStorage.getItem("login")'), null)
    await page.getByRole('button', { name: /^API fixture 1/ }).click()
    id = await waitGuest('/admin-doc-1')
    assert.match(await guestEval(id, 'document.cookie'), /logged-in/)
    await guestEval(id, 'window.open(location.href + "?popup=1"); undefined')
    await page.waitForTimeout(300)
    const popupPreferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.getParentWindow()).map(window => window.webContents.getLastWebPreferences()))
    assert.equal(popupPreferences.length, 1)
    assert.equal(popupPreferences[0].sandbox, true)
    assert.equal(popupPreferences[0].nodeIntegration, false)
    assert(!popupPreferences[0].preload)
    await page.getByRole('button', { name: /^API fixture 2/ }).click()
    await waitGuest('/admin-doc-2')
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.getParentWindow()).length), 0)
    await page.getByRole('button', { name: /^API fixture 1/ }).click()
    id = await waitGuest('/admin-doc-1')
    await page.screenshot({ path: '/tmp/akaagent-admin-docs-smoke.png' })
    await app.evaluate(({ webContents }, guestId) => webContents.fromId(guestId).forcefullyCrashRenderer(), id)
    await page.getByRole('button', { name: 'Thử lại', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
    id = await waitGuest('/admin-doc-1')
    assert.match(await guestEval(id, 'document.cookie'), /logged-in/)
    assert(!(await calls()).some(call => ['cron','settings','triggers'].includes(call.resource)))
    console.log('PASS isolated guest, manual login persistence, lazy queries, real crash/retry')

    await page.getByRole('button', { name: 'Thêm', exact: true }).click()
    await dialog().getByLabel('Tên hiển thị', { exact: true }).fill('API thêm mới')
    await dialog().getByLabel('URL', { exact: true }).fill(`${base}/admin-doc-3`)
    await dialog().getByLabel('Thứ tự', { exact: true }).fill('0')
    await dialog().getByRole('button', { name: 'Lưu', exact: true }).dblclick()
    await dialog().waitFor({ state: 'detached' })
    assert.equal((await state()).docs.filter(doc => doc.name==='API thêm mới').length, 1)
    await page.getByRole('button', { name: 'Sửa API thêm mới', exact: true }).click()
    await dialog().getByLabel('Bật tài liệu').uncheck()
    await dialog().getByRole('button', { name: 'Lưu', exact: true }).click()
    await dialog().waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Xóa API thêm mới', exact: true }).click()
    await dialog().getByRole('button', { name: 'Xóa', exact: true }).click()
    await dialog().waitFor({ state: 'detached' })
    assert(!(await state()).docs.some(doc => doc.name==='API thêm mới'))
    console.log('PASS document add/edit/disable/delete and duplicate-click mutex')

    await selectMenu('Cài đặt hệ thống')
    await page.getByText('fixture.secret', { exact: true }).waitFor()
    assert.equal((await guestInfo()).length, 0)
    assert(!(await page.locator('body').innerText()).includes('private-fixture-key'))
    const secretRow = page.getByRole('row').filter({ hasText: 'fixture.secret' })
    await secretRow.getByRole('button', { name: 'Sửa' }).click()
    await dialog().getByLabel('Mô tả', { exact: true }).fill('Mô tả mới')
    await dialog().getByRole('button', { name: 'Lưu', exact: true }).click()
    await dialog().waitFor({ state: 'detached' })
    assert.equal((await state()).settings[1].value, 'private-fixture-key')
    assert.equal((await calls()).filter(call => call.resource==='settings' && call.action==='save').at(-1).input.value, undefined)
    await secretRow.getByRole('button', { name: 'Sửa' }).click()
    await dialog().getByRole('button', { name: 'Hiện giá trị' }).click()
    assert.equal(await dialog().getByLabel('Giá trị', { exact: true }).inputValue(), 'private-fixture-key')
    const bounds = await dialog().boundingBox()
    assert(bounds.x > 100 && bounds.y > 20, 'Dialog must be centered, not pinned at screen origin')
    await dialog().getByRole('button', { name: 'Ẩn giá trị' }).click()
    assert.equal(await dialog().getByLabel('Giá trị', { exact: true }).inputValue(), '')
    await dialog().getByRole('button', { name: 'Hủy', exact: true }).click()
    console.log('PASS secret masking, explicit reveal, hidden-state clearing and description-only save')

    // A late reveal must not replace a new value, including an intentional empty value.
    await app.evaluate(() => globalThis.adminSmoke.delay('settings', true))
    for (const nextValue of ['replacement-fixture-key', '']) {
      await secretRow.getByRole('button', { name: 'Sửa' }).click()
      await dialog().getByRole('button', { name: 'Hiện giá trị' }).click()
      const valueInput = dialog().getByLabel('Giá trị', { exact: true })
      await valueInput.fill('draft-fixture-key')
      await valueInput.fill(nextValue)
      await dialog().getByRole('button', { name: 'Ẩn giá trị' }).waitFor()
      assert.equal(await valueInput.inputValue(), nextValue)
      await dialog().getByRole('button', { name: 'Ẩn giá trị' }).click()
      await dialog().getByRole('button', { name: 'Hiện giá trị' }).click()
      assert.equal(await valueInput.inputValue(), nextValue)
      await dialog().getByRole('button', { name: 'Lưu', exact: true }).click()
      await dialog().waitFor({ state: 'detached' })
      assert.equal((await state()).settings[1].value, nextValue)
    }
    await app.evaluate(() => globalThis.adminSmoke.delay('settings', false))
    console.log('PASS delayed secret reveal preserves and saves both typed and cleared drafts')

    await selectMenu('Thông báo trên Web/App')
    await page.getByText('Thông báo fixture', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Thêm', exact: true }).click()
    await dialog().getByLabel('Username').fill('customer')
    assert.match(await dialog().innerText(), /Chọn khách hàng nhận thông báo/)
    assert(!/\bstaff\b/i.test(await dialog().innerText()))
    const inputBounds = await dialog().getByLabel('Username').boundingBox()
    const searchBounds = await dialog().getByRole('button', { name: 'Tìm', exact: true }).boundingBox()
    assert(Math.abs(inputBounds.y + inputBounds.height - searchBounds.y - searchBounds.height) <= 1, 'Search button must align with the username input')
    await page.screenshot({ path: '/tmp/akaagent-admin-customer-picker-smoke.png' })
    await dialog().getByRole('button', { name: 'Tìm', exact: true }).click()
    await dialog().getByRole('button', { name: /customer-fixture/ }).click()
    await dialog().getByLabel('Nội dung thông báo').fill('Thông báo cho khách hàng')
    await dialog().getByRole('button', { name: 'Lưu thông báo' }).click()
    await dialog().waitFor({ state: 'detached' })
    assert.equal(JSON.parse((await state()).staff.raw_value).message, 'Thông báo cho khách hàng')
    await page.getByRole('row').filter({ hasText: 'customer-fixture' }).getByRole('button', { name: 'Xóa', exact: true }).click()
    await dialog().getByRole('button', { name: 'Xóa nội dung' }).click()
    await dialog().waitFor({ state: 'detached' })
    assert.equal((await state()).staff.raw_value, '')
    console.log('PASS cross-organization staff lookup, notification save and clearing without deletion')

    await selectMenu('Cron job Supabase')
    await page.getByRole('button', { name: 'Xem', exact: true }).waitFor()
    await page.getByText('Mỗi 5 phút', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Trang tiếp' }).click()
    await page.waitForFunction(() => !document.querySelector('.admin-pagination button:last-child:not(:disabled)'))
    assert((await calls()).some(call => call.resource==='cron' && call.input.cursor==='100'))
    await page.getByRole('button', { name: 'Xem', exact: true }).click()
    await dialog().getByText('SELECT fixture();', { exact: true }).waitFor()
    await dialog().getByRole('button', { name: 'Đóng', exact: true }).click()
    await page.screenshot({ path: '/tmp/akaagent-admin-cron-smoke.png' })
    await app.evaluate(() => globalThis.adminSmoke.fail('cron:runs'))
    await page.getByRole('button', { name: 'Job đã tắt', exact: true }).click()
    await page.getByRole('button', { name: 'Thử tải lại log', exact: true }).waitFor()
    assert.equal(await page.getByText('Không có lịch sử phù hợp.', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Thử tải lại log', exact: true }).click()
    await page.getByText('Không có lịch sử phù hợp.', { exact: true }).waitFor()
    await selectMenu('Function from Trigger')
    await page.getByRole('button', { name: 'Xem body hàm' }).click()
    await dialog().locator('.monaco-editor').waitFor()
    assert((await calls()).some(call => call.resource==='triggers' && call.action==='detail'))
    await dialog().getByRole('button', { name: 'Đóng', exact: true }).click()
    console.log('PASS cron paging/detail and lazy read-only Monaco function viewer')

    await app.evaluate(() => globalThis.adminSmoke.delay('doc',true))
    await selectMenu('Doc API')
    await page.waitForFunction(() => !!document.querySelector('.admin-doc-layout'))
    await selectMenu('Cài đặt hệ thống')
    await page.waitForTimeout(800)
    assert.equal((await guestInfo()).length,0)
    await app.evaluate(() => globalThis.adminSmoke.delay('doc',false))
    await selectMenu('Doc API')
    await waitGuest('/admin-doc-1')
    await app.evaluate(() => globalThis.adminSmoke.revoke())
    await page.waitForFunction(() => !document.querySelector('.admin-page'))
    assert.equal((await guestInfo()).length,0)
    const denied = await page.evaluate(async () => { try { await window.electronAPI.admin.listDocs(); return false } catch { return true } })
    assert(denied)
    await app.evaluate(() => globalThis.adminSmoke.restore())
    await waitGuest('/admin-doc-1')
    await app.evaluate(() => globalThis.adminSmoke.reset())
    assert.equal((await guestInfo()).length, 0)
    const blockedDuringLogout = await page.evaluate(async () => { try { await window.electronAPI.admin.prepareDoc(1, 'during-logout'); return false } catch { return true } })
    assert(blockedDuringLogout, 'Cleanup must deny reopen even before credentials/user are cleared')
    assert.equal((await guestInfo()).length, 0)
    assert.equal(errors.length,0,errors.join('\n'))
    console.log('PASS late prepare, permission revocation and logout cleanup block guest reopen and IPC')
  } catch (error) {
    if (app) {
      const page = await app.firstWindow().catch(()=>null)
      if (page) { await page.screenshot({path:'/tmp/akaagent-admin-smoke-failure.png'}).catch(()=>{}); console.error((await page.locator('body').innerText().catch(()=>'' )).slice(0,5000)) }
    }
    throw error
  } finally {
    if (app) await app.close()
    if (server) await server.close()
    if (permissionServer) await new Promise(resolve => permissionServer.close(resolve))
    rmSync(directory,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})

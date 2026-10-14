const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-pending-ui-'))
  let app, page
  try {
    await build({ entryPoints: [join(__dirname, 'campaign-pending-reason-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-pending-reason-ui-smoke.css"><body><div id="root"></div><script src="campaign-pending-reason-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1300, height: 850, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
    page = await app.firstWindow()
    page.setDefaultTimeout(12000)
    await page.waitForFunction(() => !!window.pendingSmoke)
    const row = id => page.locator('.campaign-table-row').filter({ has: page.getByText(`Chiến dịch ${id}`, { exact: true }) })
    const button = id => row(id).getByRole('button', { name: 'Tại sao CD không chạy?', exact: true })
    const note = id => row(id).locator('.campaign-note-line')
    const checks = () => page.evaluate(() => window.pendingSmoke.state.calls.filter(c => c.method === 'checkCampaignPendingReason').length)
    const release = () => page.evaluate(() => window.pendingSmoke.release())
    const patch = (id, patch) => page.evaluate(({ id, patch }) => window.pendingSmoke.patch(id, patch), { id, patch })
    const waitNote = async (id, message) => {
      await note(id).filter({ hasText: message }).waitFor()
      assert.equal(await note(id).innerText(), message)
    }
    await button(91).waitFor()
    assert.equal(await button(91).count(), 1)
    assert.equal(await button(92).count(), 1)
    assert.equal(await button(93).count(), 0)
    assert.equal(await button(94).count(), 0)
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    const selected = await page.evaluate(() => window.pendingSmoke.store.getState().selectedCampaignId)
    await button(91).dispatchEvent('click')
    await row(91).getByRole('button', { name: 'Đang kiểm tra…' }).waitFor()
    assert.equal(await button(92).isDisabled(), true)
    await row(91).getByRole('button', { name: 'Đang kiểm tra…' }).dispatchEvent('click')
    assert.equal(await checks(), 1, 'rapid clicks must not create parallel requests')
    assert.equal(await page.evaluate(() => window.pendingSmoke.store.getState().selectedCampaignId), selected)
    await page.clock.fastForward(120000) // The TTL starts after response, not after click.
    await release()
    await waitNote(91, 'Chưa có data đến giờ chạy. Data gần nhất được hẹn lúc 11:00 12/10/2026.')
    assert.equal(await page.evaluate(() => window.pendingSmoke.store.getState().campaigns.find(c => c.id === 91).note), null)
    const styles = await page.evaluate(() => Array.from(document.querySelectorAll('.campaign-note-line')).map(el => {
      const s = getComputedStyle(el); return [s.color, s.backgroundColor, s.fontSize, s.fontWeight, s.padding, s.borderRadius]
    }))
    assert.deepEqual(styles[0], styles[1], 'temporary and real notes must have identical presentation')
    await page.evaluate(() => window.pendingSmoke.refresh())
    await waitNote(91, 'Chưa có data đến giờ chạy. Data gần nhất được hẹn lúc 11:00 12/10/2026.')
    await page.clock.fastForward(299999)
    assert.equal(await note(91).count(), 1)
    const callsBeforeExpiry = await page.evaluate(() => window.pendingSmoke.state.calls.length)
    await page.clock.fastForward(1)
    await button(91).waitFor()
    assert.equal(await page.evaluate(() => window.pendingSmoke.state.calls.length), callsBeforeExpiry, 'expiry must not call IPC')
    assert.equal(await checks(), 1)
    console.log('PASS eligibility, label, dedup, exact note style, RAM-only TTL from completion, no expiry requests')

    await button(91).dispatchEvent('click'); await release(); await note(91).waitFor()
    const beforeRandomChange = await checks()
    await page.evaluate(() => window.pendingSmoke.store.setState(s => ({accounts:s.accounts.map(a=>({...a,facebookRandomRunEnabled:true,facebookRandomRunRevision:1}))})))
    await button(91).waitFor(); assert.equal(await note(91).count(),0); assert.equal(await checks(),beforeRandomChange)
    await button(91).dispatchEvent('click')
    await page.evaluate(() => window.pendingSmoke.store.setState(s => ({accounts:s.accounts.map(a=>({...a,facebookRandomRunRevision:2}))})))
    await release(); await button(91).waitFor(); assert.equal(await note(91).count(),0)
    console.log('PASS random configuration invalidates cached and in-flight notes without new requests')

    await button(91).dispatchEvent('click'); await release(); await waitNote(91, 'Chưa có data đến giờ chạy. Data gần nhất được hẹn lúc 11:00 12/10/2026.')
    await patch(91, { note: 'Note thật vừa xuất hiện.' }); await waitNote(91, 'Note thật vừa xuất hiện.')
    await patch(91, { note: null }); await button(91).waitFor()
    assert.equal(await note(91).count(), 0, 'discarded temporary note must never resurface')
    await button(91).dispatchEvent('click')
    await patch(91, { note: 'Note thật trong lúc kiểm tra.' }); await release()
    await waitNote(91, 'Note thật trong lúc kiểm tra.')
    await patch(91, { note: null }); await button(91).waitFor()
    await button(91).dispatchEvent('click')
    await patch(91, { status: 'đang chạy' }); await release()
    assert.equal(await note(91).count(), 0)
    await patch(91, { status: 'chờ xử lý' }); await button(91).waitFor()
    await button(91).dispatchEvent('click')
    await page.evaluate(() => window.pendingSmoke.switchAuth()); await release()
    await button(91).waitFor()
    assert.equal(await note(91).count(), 0, 'logout/relogin must reject the old result even with identical staff IDs')
    await page.evaluate(() => { window.pendingSmoke.state.reject = true })
    await button(91).dispatchEvent('click')
    await waitNote(91, 'Chưa thể kiểm tra đầy đủ do lỗi kết nối hoặc tải dữ liệu. Vui lòng thử lại.')
    assert.equal(await page.getByText('Private transport failure must not reach the note').count(), 0)
    await page.evaluate(() => { window.pendingSmoke.state.reject = false })
    await page.clock.fastForward(300000); await button(91).waitFor()
    await button(91).dispatchEvent('click'); await release(); await waitNote(91, 'Chưa có data đến giờ chạy. Data gần nhất được hẹn lúc 11:00 12/10/2026.')
    assert.deepEqual(await page.evaluate(() => window.pendingSmoke.state.errors), [])
    const mutations = await page.evaluate(() => window.pendingSmoke.state.calls.filter(c => /^(update|set|start|run|execute|claim|save|create|delete)/.test(c.method)))
    assert.deepEqual(mutations, [], 'the button must never mutate or run campaigns')
    await page.screenshot({ path: '/tmp/akaagent-campaign-pending-reason-ui.png' })
    console.log('PASS real-note precedence and disposal, status/auth races, sanitized failures, no mutation; screenshot /tmp/akaagent-campaign-pending-reason-ui.png')
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({ errors: window.pendingSmoke?.state.errors,
      calls: window.pendingSmoke?.state.calls.slice(-5), text: document.body.innerText.slice(0, 2000) })))
    throw error
  } finally {
    if (app) await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

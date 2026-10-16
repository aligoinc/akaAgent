const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-history-ui-'))
  let app
  let page
  try {
    await build({ entryPoints: [join(__dirname, 'campaign-history-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning',
      plugins: [{ name: 'capture-excel', setup(build) {
        build.onResolve({ filter: /^xlsx$/ }, () => ({ path: 'xlsx', namespace: 'smoke' }))
        build.onLoad({ filter: /.*/, namespace: 'smoke' }, () => ({ contents: `
          export const read = () => ({});
          export const utils = { aoa_to_sheet: rows => rows, json_to_sheet: rows => rows,
            book_new: () => ({}), book_append_sheet: (book, rows) => { book.rows = rows } };
          export const writeFile = book => window.sortSmoke.state.exports.push(book.rows);` }))
      } }] })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-history-ui-smoke.css"><body><div id="root"></div><script src="campaign-history-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1600, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
    page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    await page.waitForFunction(() => !!window.sortSmoke)
    await page.getByText('Sort campaign 91', { exact: true }).first().click()
    const tab = name => page.locator('.detail-dock-tab').filter({ hasText: name })
    await tab('Lịch sử chạy').click()
    const history = () => page.evaluate(() => window.sortSmoke.store.getState().campaignLogs[91])
    await page.waitForFunction(() => window.sortSmoke.store.getState().campaignLogs[91]?.items.length === 100)
    assert.equal((await history()).items[0].id, '205')
    assert.equal(await page.locator('.campaign-detail-log-cell').first().innerText(), 'History 91/205 😀\nContinuation')
    await page.getByRole('button', { name: 'Tải lịch sử cũ hơn' }).click()
    await page.waitForFunction(() => window.sortSmoke.store.getState().campaignLogs[91]?.items.length === 200)
    assert.equal((await history()).items.at(-1).id, '6')
    await page.evaluate(() => {
      window.sortSmoke.history.histories.get(91).push({ id: '206', log: 'Fresh without campaign updatedAt', createdAt: new Date().toISOString() })
      window.sortSmoke.history.emit('onCampaignLogUpdated', { id: 91 })
    })
    await page.getByText('Fresh without campaign updatedAt', { exact: true }).waitFor()
    assert.equal((await history()).newestId, '206')
    assert.equal((await history()).items.length, 200)
    console.log('PASS real Electron initial 100, older page, multiline Unicode, log signal with unchanged campaign timestamp')
    // Hold an older page, leave and reopen: late response must not publish.
    await page.evaluate(() => { window.sortSmoke.history.hold = true })
    await page.getByRole('button', { name: 'Tải lịch sử cũ hơn' }).click()
    await page.waitForFunction(() => !!window.sortSmoke.history.release)
    await tab('Thông tin').first().click()
    await page.evaluate(() => { window.sortSmoke.history.hold = false; window.sortSmoke.history.release() })
    await page.waitForFunction(() => !window.sortSmoke.store.getState().loadingCampaignLogIds[91])
    assert.equal((await history()).items.length, 200)
    await tab('Lịch sử chạy').click()
    await page.getByRole('button', { name: 'Tải lịch sử cũ hơn' }).click()
    await page.waitForFunction(() => window.sortSmoke.store.getState().campaignLogs[91]?.items.length === 206)
    assert.equal((await history()).hasOlder, false)
    assert.equal(await page.getByRole('button', { name: 'Tải lịch sử cũ hơn' }).count(), 0)
    await page.screenshot({ path: resolve(__dirname, '../docs/audits/campaign-logs-v408/desktop-history.png') })
    // A pending read for campaign 92 cannot restore private history after logout.
    await page.evaluate(() => { window.sortSmoke.history.hold = true; window.sortSmoke.history.release = null })
    await page.getByText('Sort campaign 92', { exact: true }).first().click()
    await tab('Lịch sử chạy').click()
    await page.waitForFunction(() => !!window.sortSmoke.history.release)
    await page.evaluate(() => { window.sortSmoke.history.auth.setState({ user: null }); window.sortSmoke.history.hold = false; window.sortSmoke.history.release() })
    await page.waitForFunction(() => Object.keys(window.sortSmoke.store.getState().campaignLogs).length === 0)
    assert.deepEqual(await page.evaluate(() => window.sortSmoke.state.errors), [])
    console.log('PASS tab cancellation, history retained through older pagination, logout fence; screenshot saved')
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({ errors: window.sortSmoke?.state.errors, calls: window.sortSmoke?.history.calls.slice(-6), text: document.body.innerText.slice(-1200) })))
    throw error
  } finally {
    if (app) await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

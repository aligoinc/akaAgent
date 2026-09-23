const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-sort-ui-'))
  let app
  let page
  try {
    await build({ entryPoints: [join(__dirname, 'campaign-data-sort-ui-smoke.tsx')], outdir: directory,
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
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-data-sort-ui-smoke.css"><body><div id="root"></div><script src="campaign-data-sort-ui-smoke.js"></script></body></html>')
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
    const sortButton = () => page.getByRole('button', { name: /^Sắp xếp (data ban đầu|kết quả chạy):/ })
    const choose = async name => {
      await sortButton().scrollIntoViewIfNeeded()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await sortButton().click()
      await page.getByRole('menuitemradio', { name, exact: true }).click()
    }
    const inputIds = () => page.evaluate(() => window.sortSmoke.store.getState().campaignInputData.map(row => row.id))
    const waitInput = id => page.waitForFunction(id => !window.sortSmoke.store.getState().loadingCampaignInputData
      && window.sortSmoke.store.getState().campaignInputData[0]?.id === id, id)
    await tab('Data ban đầu').click()
    await waitInput(205)
    const assertTwoRowToolbar = async (placeholder, tabName) => {
      for (const width of [850, 1024, 1600]) {
        await page.setViewportSize({ width, height: 1100 })
        const sort = await sortButton().boundingBox()
        const search = await page.getByPlaceholder(placeholder).locator('..').boundingBox()
        const actions = await page.locator('.campaign-data-toolbar-actions').boundingBox()
        const fields = await page.locator('.campaign-data-filter-fields').boundingBox()
        assert.ok(sort.y >= search.y + search.height, 'sort must be below search')
        assert.ok(Math.abs(sort.x - actions.x) <= 1, 'sort must align to the left edge')
        assert.ok(Math.abs(search.x + search.width - fields.x - fields.width) <= 1, 'search must align to the right edge')
        await page.locator('.campaign-data-filter-bar').screenshot({ path: `/tmp/akaagent-toolbar-${tabName}-${width}.png` })
      }
    }
    await assertTwoRowToolbar('Tìm tên, UID, SĐT, email, key...', 'input')
    await sortButton().click()
    assert.equal(await page.getByRole('menuitemradio').count(), 4)
    assert.equal(await page.getByRole('menuitemradio', { name: 'Tạo mới nhất' }).getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Escape')
    // Select on page 1 and page 2; changing order must preserve both IDs.
    await page.locator('.detail-dock-tab-content tbody tr').first().getByRole('checkbox').check()
    await page.locator('.campaign-input-data-pager button').last().click()
    await waitInput(105)
    await page.locator('.detail-dock-tab-content tbody tr').first().getByRole('checkbox').check()
    await choose('Tạo cũ nhất')
    await waitInput(1)
    assert.equal(await page.locator('.campaign-input-data-pager').innerText().then(text => text.includes('1/3')), true)
    await page.getByTitle('Hành động với data đã chọn').click()
    await page.getByRole('button', { name: 'Xuất Excel', exact: true }).click()
    await page.waitForFunction(() => window.sortSmoke.state.exports.length === 1)
    const exportedNames = await page.evaluate(() => window.sortSmoke.state.exports[0].slice(1).map(row => row[0]))
    assert.deepEqual(exportedNames, ['Data 105', 'Data 205'])
    const selectionCalls = await page.evaluate(() => window.sortSmoke.state.calls
      .filter(c => c.method === 'listCampaignInputDataPage' && c.args[0].inputDataIds))
    assert.equal(selectionCalls.length, 1)
    assert.deepEqual(selectionCalls[0].args[0].inputDataIds, [205, 105])
    assert.equal(selectionCalls[0].args[0].offset, 0)
    // A stale/deleted selected ID must abort the export, not write a partial file.
    await page.evaluate(() => { window.sortSmoke.state.dropSelectionId = 105 })
    await page.getByTitle('Hành động với data đã chọn').click()
    await page.getByRole('button', { name: 'Xuất Excel', exact: true }).click()
    await page.waitForFunction(() => window.sortSmoke.state.errors.some(error => error.includes('Không thể tải đủ data đã chọn')))
    assert.equal(await page.evaluate(() => window.sortSmoke.state.exports.length), 1)
    await page.evaluate(() => { window.sortSmoke.state.dropSelectionId = null; window.sortSmoke.state.errors.length = 0 })
    console.log('PASS default/menu/pagination, preserved selections, cross-page Excel order')

    await choose('Cập nhật gần nhất')
    await waitInput(2)
    await choose('Cập nhật xa nhất')
    await waitInput(1)
    await page.evaluate(() => window.sortSmoke.refresh())
    assert.equal(await sortButton().innerText().then(text => text.includes('Cập nhật xa nhất')), true)
    assert.equal(await page.evaluate(() => window.sortSmoke.state.calls.filter(c => c.method === 'listCampaignInputDataPage').at(-1).args[0].sort), 'processed_asc')
    // Hold an old request, resolve the new order first, then release the old response.
    await page.evaluate(() => { window.sortSmoke.state.hold = 'created_asc' })
    await choose('Tạo cũ nhất')
    await page.waitForFunction(() => !!window.sortSmoke.state.release)
    await choose('Tạo mới nhất')
    await waitInput(205)
    await page.evaluate(() => { window.sortSmoke.state.hold = null; window.sortSmoke.state.release() })
    await page.waitForFunction(() => !window.sortSmoke.store.getState().loadingCampaignInputData)
    assert.equal((await inputIds())[0], 205)
    console.log('PASS processed ordering, refresh, stale response protection')

    const search = page.getByPlaceholder('Tìm tên, UID, SĐT, email, key...')
    await search.fill('Data 2')
    await page.waitForFunction(() => window.sortSmoke.store.getState().campaignInputDataTotal === 17)
    await choose('Tạo cũ nhất')
    await waitInput(2)
    assert.equal(await search.inputValue(), 'Data 2')
    await tab('Kết quả chạy').click()
    await page.waitForFunction(() => window.sortSmoke.store.getState().campaignDetailPageItems[0]?.id === 205)
    await assertTwoRowToolbar('Tìm hành động, trạng thái, nội dung, link...', 'results')
    await sortButton().click()
    assert.equal(await page.getByRole('menuitemradio').count(), 2)
    await page.getByRole('menuitemradio', { name: 'Tạo cũ nhất', exact: true }).click()
    await page.waitForFunction(() => window.sortSmoke.store.getState().campaignDetailPageItems[0]?.id === 1)
    await page.getByTitle('Tải lại kết quả chạy').click()
    await page.getByTitle('Xuất lịch sử hành động ra Excel').click()
    await page.waitForFunction(() => window.sortSmoke.state.exports.length === 2)
    const resultNames = await page.evaluate(() => window.sortSmoke.state.exports[1].map(row => row['Hành động']))
    assert.equal(resultNames[0], 'Result 1'); assert.equal(resultNames.at(-1), 'Result 205')
    await tab('Data ban đầu').click()
    assert.equal(await sortButton().innerText().then(text => text.includes('Tạo cũ nhất')), true)
    await page.getByText('Sort campaign 92', { exact: true }).first().click()
    await tab('Data ban đầu').click()
    await waitInput(205)
    assert.equal(await sortButton().innerText().then(text => text.includes('Tạo mới nhất')), true)
    assert.deepEqual(await page.evaluate(() => window.sortSmoke.state.errors), [])
    await sortButton().click()
    await page.screenshot({ path: '/tmp/akaagent-campaign-data-sort-ui.png' })
    console.log('PASS filters, independent tabs, results reload/export, campaign reset; screenshot /tmp/akaagent-campaign-data-sort-ui.png')
  } catch (error) {
    if (page) {
      console.error(await page.evaluate(() => ({ errors: window.sortSmoke?.state.errors, calls: window.sortSmoke?.state.calls.slice(-6), text: document.body.innerText.slice(-1800) })))
      await page.screenshot({ path: '/tmp/akaagent-campaign-data-sort-ui-failure.png' })
    }
    throw error
  } finally {
    if (app) await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

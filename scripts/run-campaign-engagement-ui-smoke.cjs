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
    await build({ entryPoints: [join(__dirname, 'campaign-engagement-ui-smoke.tsx')], outdir: directory,
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
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-engagement-ui-smoke.css"><body><div id="root"></div><script src="campaign-engagement-ui-smoke.js"></script></body></html>')
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
    await tab('Kết quả chạy').click()
    const handle=await page.locator('.detail-dock-resize-handle').boundingBox()
    assert(handle)
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2)
    await page.mouse.down()
    await page.mouse.move(handle.x+handle.width/2,handle.y-400,{steps:10})
    await page.mouse.up()
    await page.getByRole('columnheader',{name:'Tương tác Zalo'}).waitFor()
    for (const text of ['Đã xem:','Đã phản hồi:','Đã thả cảm xúc:','Đã kết bạn:']) await page.getByRole('cell').filter({hasText:text}).first().waitFor()
    const engagementColumn = await page.getByRole('columnheader',{name:'Tương tác Zalo'}).evaluate(el=>el.cellIndex)
    const engagementCells = page.locator('.detail-dock-tab-content tbody tr').locator(`td:nth-child(${engagementColumn+1})`)
    assert.equal(await engagementCells.filter({hasText:/Không áp dụng|Không theo dõi|Chưa ghi nhận|Hết thời gian theo dõi/}).count(),0)
    assert.equal(await engagementCells.filter({hasText:/^$/}).count(),3)
    const filter=page.getByLabel('Tương tác Zalo',{exact:true})
    for (const value of ['seen','reacted','friended','none']) {
      await filter.selectOption(value)
      await page.waitForFunction(value=>window.sortSmoke.state.calls.some(c=>c.method==='listCampaignDetailsPage' && c.args[0].engagementFilter===value),value)
      await page.waitForFunction(()=>document.querySelectorAll('.detail-dock-tab-content tbody tr').length===1)
      if(value==='none') assert.equal(await engagementCells.first().innerText(),'')
    }
    await filter.selectOption('responded')
    await page.waitForFunction(()=>document.querySelectorAll('.detail-dock-tab-content tbody tr').length===100)
    await page.getByTitle('Xuất lịch sử hành động ra Excel').click()
    await page.waitForFunction(()=>window.sortSmoke.state.exports.length>0)
    const rows=await page.evaluate(()=>window.sortSmoke.state.exports[0])
    assert.equal(rows.length,200)
    assert.equal(rows[0]['Đã phản hồi lúc'],'2026-10-01T01:00:00Z')
    for(const field of ['Đã xem lúc','Đã thả cảm xúc lúc','Đã kết bạn lúc','Theo dõi đến']) assert.ok(field in rows[0])
    await filter.selectOption('all')
    await page.getByRole('cell').filter({hasText:'Đã xem:'}).first().waitFor()
    for (const width of [1600,850]) {
      await page.setViewportSize({width,height:1100})
      const bar=page.locator('.campaign-data-filter-bar')
      assert(await bar.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'toolbar overflow')
      await page.getByRole('cell').filter({hasText:'Đã xem:'}).first().scrollIntoViewIfNeeded()
      await page.screenshot({path:`/tmp/akaagent-engagement-${width}.png`})
    }
    assert.deepEqual(await page.evaluate(()=>window.sortSmoke.state.errors),[])
    console.log('PASS Desktop engagement UI: independent marks/states, filtered paging, complete Excel, 1600/850px, no network')
  } finally { if(app) await app.close(); rmSync(directory,{recursive:true,force:true}) }
}
main().catch(error=>{console.error(error);process.exitCode=1})

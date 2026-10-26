// Real DataScan React form, deterministic IPC fixtures, no account or network writes.
const esbuild = require('esbuild'), { chromium } = require('playwright')
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'page-inbox-ui-'))
const code = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import Scan from './src/renderer/src/components/DataScan/DataScanModal';
import {useCampaignStore} from './src/renderer/src/stores/campaignStore';
import {useAuthStore} from './src/renderer/src/stores/authStore';
import {useUiStore} from './src/renderer/src/stores/uiStore';
import './src/renderer/src/styles/global.css';
const accounts=[{id:13,name:'Facebook fixture',flatformType:'facebook',isDelete:false}];
const contacts=Array.from({length:15211},(_,i)=>({id:i+1,accountId:13,contactType:'page_inbox_customer',name:'Khách '+(i+1),uid:String(100000+i),extraData:{pageUid:'999',pageName:'Page fixture',phone:'0901234567',lastMessageAt:'2026-10-26T01:00:00Z',lastMessageText:'Tin mới',messageHistory:'Tin cũ cần giữ',messages:[{text:'Tin cũ cần giữ'}]}}));
window.calls=[];window.receipts=[];window.closed=0;window.sequence=0;
const select=q=>{let rows=contacts;if(q.ids?.length)rows=rows.filter(c=>q.ids.includes(c.id));if(q.excludeIds?.length)rows=rows.filter(c=>!q.excludeIds.includes(c.id));return rows.slice(q.offset||0,q.limit?(q.offset||0)+q.limit:undefined)};
const project=(rows,q)=>q.projection==='campaign'?rows.map(c=>({...c,extraData:{pageUid:c.extraData.pageUid,pageName:c.extraData.pageName,phone:c.extraData.phone}})):rows;
window.electronAPI={
 listAccounts:async()=>accounts,listDataGroups:async()=>({groups:[],total:0}),listDataTypeCategoryItems:async()=>[],
 listContactDatasets:async()=>[],getAkaBizContactTags:async()=>[],listAkaBizContactTags:async()=>[],getZaloServerOperationStates:async()=>[],
 listContacts:async()=>[{id:999,accountId:13,contactType:'page',uid:'999',name:'Page fixture'}],
 getPageInboxScanInfo:async()=>({latestMessageAt:'2026-10-26T01:00:00Z',estimatedSecondsPer20000:2400}),
 onContactsLoadProgress:()=>()=>{},onContactsLoadComplete:()=>()=>{},onZaloServerOperationState:()=>()=>{},
 cancelDataColumnFilters:async()=>true,
 readDataColumnFilters:async r=>{window.calls.push(['read',r]);return {available:true,total:contacts.length,contacts:select(r.query),members:[],ids:[]}},
 exportDataColumnFilters:async r=>{window.calls.push(['export',r]);if(window.failExport)throw new Error('Lỗi fixture');return {available:!window.fallback,total:contacts.length,contacts:window.fallback?[]:project(select(r.query),r.query),members:[],ids:[]}},
 exportPageInboxContacts:async(id,q)=>{window.calls.push(['legacy',q]);return project(select(q),q)}
};
useCampaignStore.setState({accounts,loadAccounts:async()=>{}});
useAuthStore.setState({user:{staffId:1,organizationId:1,entitlements:{facebookCore:true,facebookFanpage:true,zalo:true}}});
useUiStore.setState({showAlert:(message,type)=>window.calls.push(['alert',message,type])});
const view=createRoot(document.getElementById('root'));
window.openScan=(target=false)=>view.render(<Scan key={++window.sequence} initialAction="facebook_page_inbox_customers" initialAccountId={13} lockAction lockAccount targetDataGroup={target?{id:1,name:'Nhóm fixture',color:'#000'}:undefined} onClose={()=>{window.closed++;view.render(null)}} onSelect={(rows,context)=>{window.receipts.push({rows,context})}}/>);
window.openScan();
`
;(async () => {
  await esbuild.build({ stdin: { contents: code, resolveDir: root, loader: 'tsx' }, bundle: true, format: 'iife', outfile: dir + '/app.js', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file', '.png': 'file' } })
  fs.writeFileSync(dir + '/index.html', '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
  const server = http.createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1)
    if (name.includes('..') || !fs.existsSync(path.join(dir, name))) { res.writeHead(404); res.end(); return }
    res.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html')
    res.end(fs.readFileSync(path.join(dir, name)))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try { browser = await chromium.launch({ headless: true }) } catch { browser = await chromium.launch({ headless: true, channel: 'chrome' }) }
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  let checks = 0
  async function ready() { await page.getByRole('cell', { name: 'Khách 1', exact: true }).waitFor() }
  async function range(start, end) {
    const inputs = page.locator('.data-scan-range input')
    await inputs.nth(0).fill(String(start)); await inputs.nth(1).fill(String(end))
    await page.getByRole('button', { name: 'Tích chọn', exact: true }).click()
  }
  async function choose(count, firstId = 1) {
    await page.getByRole('button', { name: 'Chọn', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.data-scan-overlay'))
    const receipt = await page.evaluate(() => window.receipts.at(-1))
    assert.equal(receipt.rows.length, count); assert.equal(new Set(receipt.rows.map(c => c.id)).size, count)
    assert.equal(receipt.rows[0].id, firstId); assert.equal(receipt.rows.at(-1).id, firstId + count - 1)
    assert.equal(receipt.context.action, 'facebook_page_inbox_customers')
    checks++
  }
  try {
    await page.goto('http://127.0.0.1:' + server.address().port); await ready()
    await range(1001, 6000); await choose(5000, 1001)
    assert.equal(await page.evaluate(() => window.calls.filter(c => c[0] === 'export').at(-1)[1].query.projection), 'campaign'); checks++
    await page.evaluate(() => window.openScan()); await ready(); await range(1, 10000); await choose(10000)
    assert.equal(await page.evaluate(() => window.receipts.at(-1).rows.some(c => c.extraData.messages || c.extraData.messageHistory)), false); checks++
    await page.evaluate(() => { window.fallback = true; window.openScan() }); await ready(); await range(1, 5000); await choose(5000)
    assert.equal(await page.evaluate(() => window.calls.filter(c => c[0] === 'legacy').at(-1)[1].projection), 'campaign'); checks++
    await page.evaluate(() => { window.fallback = false; window.openScan() }); await ready()
    await page.getByRole('checkbox', { name: 'Chọn hoặc bỏ chọn tất cả data phù hợp bộ lọc', exact: true }).check()
    await choose(15211)
    // A failed bulk read must not submit partial rows or close the picker.
    await page.evaluate(() => { window.failExport = true; window.openScan() }); await ready(); await range(1, 10000)
    const before = await page.evaluate(() => window.receipts.length)
    await page.getByRole('button', { name: 'Chọn', exact: true }).click()
    await page.waitForFunction(() => window.calls.some(c => c[0] === 'alert' && c[1] === 'Không thể chọn data.'))
    assert.equal(await page.evaluate(() => window.receipts.length), before)
    assert.ok(await page.locator('.data-scan-overlay').isVisible()); checks++
    await page.evaluate(() => { window.failExport = false; window.openScan() }); await ready(); await range(1, 100)
    const [download] = await Promise.all([
      page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất Excel', exact: true }).click()
    ])
    const workbook = require('xlsx').readFile(await download.path())
    const rows = require('xlsx').utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
    assert.equal(rows.length, 100); assert.equal(rows[0]['Tin nhắn cuối'], 'Tin mới')
    assert.equal(await page.evaluate(() => window.calls.filter(c => c[0] === 'export').at(-1)[1].query.projection), undefined); checks++
    await page.evaluate(() => { window.failExport = false; window.openScan(true) }); await ready(); await range(1, 100)
    const groupButton = page.locator('.data-scan-modal > .modal-footer .btn-primary')
    await groupButton.click(); await page.waitForFunction(n => window.receipts.length > n, before)
    assert.equal(await page.evaluate(() => window.calls.filter(c => c[0] === 'export').at(-1)[1].query.projection), undefined)
    assert.equal(await page.evaluate(() => window.receipts.at(-1).rows[0].extraData.messageHistory), 'Tin cũ cần giữ'); checks++
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ checks, errors }))
  } finally { await browser.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})().catch(error => { console.error(error); process.exitCode = 1 })

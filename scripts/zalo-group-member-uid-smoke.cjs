// Real importer IPC and renderer, isolated from production data and Zalo sends.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const XLSX = require('xlsx')
const { build } = require('esbuild')
const { _electron } = require('playwright')

const actionId = 'zalo_message_group_member'
const uid = '1234567890123456789'
const uid2 = '9876543210987654321'
const handlers = new Map()
const cache = new Map()
let aiRows = []
let sheetBytes
let authenticated = true
function loadTs(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file)
  const mod = { exports: {} }
  cache.set(file, mod.exports)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
    Buffer, URL, AbortSignal, TextDecoder,
    fetch: async () => ({
      ok: true, headers: new Headers({ 'content-type': 'text/csv' }),
      arrayBuffer: async () => sheetBytes
    })
  })((id) => {
    if (id === 'electron') return { ipcMain: { handle: (key, fn) => handlers.set(key, fn) } }
    if (id.endsWith('/currentUser')) return { requireCurrentUser: () => {
      if (!authenticated) throw new Error('Not authenticated')
      return { staffId: 7 }
    } }
    if (id.endsWith('/aiRuntimeService')) return { callAiUsing: async (_code, payload) => {
      assert.equal(payload.actionId, actionId)
      return { ok: true, content: JSON.stringify(aiRows) }
    } }
    if (id.startsWith('.')) return loadTs(path.resolve(path.dirname(file), `${id}.ts`))
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}
const types = loadTs('src/shared/types.ts')
loadTs('src/main/ipc/handlers/campaignImportHandlers.ts').registerCampaignImportHandlers()
const loadSheet = request => handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_LOAD_SHEET)(null, request)
const extractImage = request => handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_EXTRACT_IMAGE)(null, request)
const plain = value => JSON.parse(JSON.stringify(value))
const csv = `Fullname,Uid,Mobile,Email,Info1,Info2,Info3,Info4,Info5\nAn,${uid},0912345678,,ghi chú,,,,\nTrùng,${uid},,,,,,,\nSai,abc,,,,,,,\nBình,${uid2},,,,,,,`

async function main() {
  sheetBytes = Buffer.from(csv)
  let rows = await loadSheet({ platform: 'zalo', actionId, linkSheet: 'https://fixture.invalid/data.csv' })
  assert.deepEqual(plain(rows.map(row => row.uid)), [uid, uid2])
  assert.equal(rows[0].phone, '')
  assert.equal(rows[0].info1, 'ghi chú')
  rows = await loadSheet({ platform: 'zalo', actionId: 'zalo_message_phone', linkSheet: 'https://fixture.invalid/data.csv' })
  assert.deepEqual(plain(rows.map(row => row.phone)), ['0912345678'])
  aiRows = [{ uid, name: 'An' }, { uid }, { uid: Number(uid) }, { phone: '0912345678' }, { uid: 'invalid' }]
  rows = await extractImage({ platform: 'zalo', actionId, imageDataUrl: 'data:image/png;base64,AA==' })
  assert.deepEqual(plain(rows.map(row => row.uid)), [uid])
  const sourceImage = await extractImage({ platform: 'zalo', actionId, imageDataUrl: 'data:image/png;base64,AA==', responseMode: 'source' })
  assert.equal(sourceImage.rows.length, 5, 'source mode preserves invalid and duplicate AI rows')
  assert.equal(typeof sourceImage.rows[2].data.uid, 'number', 'unsafe numeric UID evidence is preserved')
  const sourceSheet = await loadSheet({ platform: 'zalo', actionId, linkSheet: 'https://fixture.invalid/data.csv', responseMode: 'source' })
  assert.equal(sourceSheet.tables[0].rows.length, 5, 'source mode preserves header, invalid and duplicate Sheet rows')
  assert.equal(sourceSheet.tables[0].rows[1][1].value, uid)
  authenticated = false
  await assert.rejects(loadSheet({ platform: 'zalo', actionId, linkSheet: 'https://fixture.invalid' }), /authenticated/)
  await assert.rejects(loadSheet({ platform: 'zalo', actionId, linkSheet: 'https://fixture.invalid', responseMode: 'source' }), /authenticated/)
  authenticated = true
  console.log('PASS IPC: exact UID, deduplication, invalid/unsafe numbers, phone regression, auth')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-zalo-uid-'))
  let app
  try {
    const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Form from './src/renderer/src/components/CampaignPanels/CampaignFormModal';
import Upload from './src/renderer/src/components/CampaignPanels/CampaignDataUploadModal';
import {AddDataToCurrentCampaignModal as Append} from './src/renderer/src/components/CampaignPanels/CampaignPanel';
import {useCampaignStore} from './src/renderer/src/stores/campaignStore';
import {useAuthStore} from './src/renderer/src/stores/authStore';
import {useUiStore} from './src/renderer/src/stores/uiStore';
import {normalizeEntitlements} from './src/renderer/src/utils/entitlements';
import './src/renderer/src/styles/global.css';
const state={calls:[],alerts:[],rows:[],nextId:100};
const account={id:11,name:'Zalo fixture',flatformType:'zalo',isActive:true,isDelete:false,isZaloServer:true,loginStatus:'đã đăng nhập'};
const action={id:'${actionId}',name:'Zalo - Nhắn tin, kết bạn đến thành viên group/người lạ',flatformType:'zalo',isActive:true,isDelete:false};
const api={
  platform:'darwin',fileExists:()=>true,getCampaignInputDataLimit:()=>10000,
  getAkaBizIntegrations:()=>({}),getStaffIntegrations:()=>({}),
  listSendExclusionGroups:()=>({groups:[],blocklists:[],options:[],catalog:{fields:[],operators:[],fieldOperators:[]}}),
  listDataGroups:()=>({groups:[],total:0}),listAccounts:()=>[account],
  createCampaign:p=>({...p,id:state.nextId++}),createCampaignInputDataBatch:r=>r.length,
  loadCampaignDataFromSheet:r=>window.loadSheetFixture(r),
  extractCampaignDataFromImage:r=>window.extractImageFixture(r)
};
window.electronAPI=new Proxy(api,{get(target,key){
  if(key in target && typeof target[key]!=='function') return target[key];
  if(key.startsWith('on')) return ()=>()=>{};
  if(key==='fileExists') return target[key];
  return async (...args)=>{state.calls.push({method:key,args});return key in target?target[key](...args):key.startsWith('get')?null:[]};
}});
useAuthStore.setState({user:{staffId:7,organizationId:9,entitlements:normalizeEntitlements({zalo:true}),zaloAccountCapabilities:{qr:true,web:true,server:true}}});
useCampaignStore.setState({accounts:[account],campaignActions:[action],campaigns:[],
 loadCampaigns:async()=>{},loadAccounts:async()=>{},loadAccountGroups:async()=>{},loadCampaignActions:async()=>{}});
useUiStore.setState({showAlert:(message,type)=>state.alerts.push({message,type}),showConfirm:(_m,confirm)=>confirm()});
const campaign={id:51,accountId:11,actionId:action.id,name:'UID fixture',status:'tạm dừng',schedule:'2035-01-01T09:00:00+07:00',dataTargetSourceMode:'direct'};
function App(){
 const [view,setView]=useState({mode:'upload',generation:0,actionId:action.id});
 window.uidSmoke={state,open:(mode,id=action.id)=>{state.calls=[];state.alerts=[];state.rows=[];setView(v=>({mode,actionId:id,generation:v.generation+1}));}};
 const close=()=>setView(v=>({...v,mode:'closed'}));
 if(view.mode==='closed')return <div>Đã đóng</div>;
 if(view.mode==='form'){
  const formData={name:'UID fixture',actionId:action.id,accountIds:[11],schedule:'2035-01-01T09:00',content:'Fixture',enableMessage:true,enableAddFriend:true,zaloFriendBlocklistEnabled:false,enableAkaBizTag:false};
  return <Form key={view.generation} campaign={null} savedDraft={{id:'61b21e19-7ed9-419f-af2c-fc124eea4c81',revision:1,...formData,payload:{version:1,values:{formData,details:[{uid:'5555555555555555555',name:'Thành viên group có sẵn'}]}}}} onClose={close}/>;
 }
 if(view.mode==='append')return <Append key={view.generation} campaign={campaign} campaignAction={action} account={account}
 onSubmit={async r=>{state.calls.push({method:'append',args:[r]});return {insertedCount:r.rows.length,skippedInvalidCount:0,skippedBatchDuplicateCount:0,skippedExistingCount:0}}}
 onSnapshotDataGroup={async()=>({insertedCount:0})} onRefresh={async()=>{}} onClose={close}/>;
 return <Upload key={view.generation} platform="zalo" actionId={view.actionId} accountIds={[11]} showDatasetName={false} onClose={close} onInsert={()=>{}}
 onSubmitRows={({rows})=>{state.rows=rows}}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
`
    await build({
      stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' },
      outfile: path.join(dir, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.BASE_URL': '"/"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' },
      plugins: [{ name: 'expose-existing-modal-for-smoke', setup(build) {
        build.onLoad({ filter: /\/CampaignPanel\.tsx$/ }, args => ({
          contents: fs.readFileSync(args.path, 'utf8') + '\nexport { AddDataToCurrentCampaignModal };',
          loader: 'tsx', resolveDir: path.dirname(args.path)
        }))
      } }], logLevel: 'warning'
    })
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body><div id="root"></div><script src="app.js"></script></body></html>')
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{
      const win=new BrowserWindow({show:false,width:1550,height:1100,webPreferences:{sandbox:true,contextIsolation:true}});
      win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)}));
      win.loadFile(${JSON.stringify(path.join(dir, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(dir, 'main.cjs')], env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.exposeFunction('loadSheetFixture', loadSheet)
    await page.exposeFunction('extractImageFixture', extractImage)
    await page.waitForFunction(() => !!window.uidSmoke)
    const open = mode => page.evaluate(m => window.uidSmoke.open(m), mode)
    const upload = page.locator('.campaign-import-modal')
    const format = () => upload.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).click()
    const insert = async () => {
      await upload.locator('.modal-footer .btn-primary').click()
      await upload.waitFor({ state: 'detached' })
    }
    const snapshot = () => page.evaluate(() => window.uidSmoke.state)
    await upload.locator('textarea').fill(`${uid}\n${uid},abc,https://zalo.me/12345,${uid2}`)
    await format()
    assert.equal(await upload.locator('tbody tr').count(), 2)
    assert.equal(await upload.getByRole('columnheader', { name: 'UID Zalo', exact: true }).count(), 1)
    await insert()
    assert.deepEqual((await snapshot()).rows.map(r => r.uid), [uid, uid2])

    for (const tab of ['File Excel/CSV của khách hàng', 'Từ template Excel akaBiz', 'Link sheet', 'Ảnh']) {
      await open('upload')
      await upload.getByRole('tab', { name: tab, exact: true }).click()
      if (tab.includes('Excel')) {
        const selector = tab.startsWith('Từ template') ? '#campaign-import-akabiz-template-file' : 'input[type=file]'
        await upload.locator(selector).setInputFiles({ name: 'uids.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
        if (tab.startsWith('Từ template')) await upload.locator('.campaign-import-results').waitFor()
        else await format()
      } else if (tab === 'Link sheet') {
        await upload.getByPlaceholder('Nhập link sheet').fill('https://fixture.invalid/data.csv')
        await upload.getByRole('button', { name: 'Đọc dữ liệu', exact: true }).click()
        await upload.getByLabel('Cột UID Zalo', { exact: true }).waitFor()
        await format()
      } else {
        aiRows = [{ name: 'An', uid }, { name: 'Bình', uid: uid2 }]
        await upload.locator('input[type=file]').setInputFiles({ name: 'uids.png', mimeType: 'image/png',
          buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afo0AAAAASUVORK5CYII=', 'base64') })
        await format()
      }
      await insert()
      assert.deepEqual((await snapshot()).rows.map(r => r.uid), [uid, uid2], tab)
      assert((await snapshot()).rows.every(r => !r.phone))
    }
    // Excel numeric precision must not silently change the recipient.
    await open('upload')
    await upload.getByRole('tab', { name: 'Từ template Excel akaBiz', exact: true }).click()
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      csv.split('\n')[0].split(','),
      ['Unsafe', Number(uid)], ['Exact', uid2]
    ]), 'UID')
    await upload.locator('#campaign-import-akabiz-template-file').setInputFiles({
      name: 'uids.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    })
    await upload.locator('.campaign-import-results').waitFor()
    await insert()
    assert.deepEqual((await snapshot()).rows.map(r => r.uid), [uid2])
    console.log('PASS UI: TXT, CSV, Excel template, sheet, image; no UID rounding')

    // Keep displayed Excel values outside UID, including blanks before the data.
    const formattedWorkbook = XLSX.utils.book_new()
    const formattedSheet = XLSX.utils.aoa_to_sheet([
      csv.split('\n')[0].split(','),
      [],
      ['An', uid, '', '', 46315, 12.75, 0.125, 123, 123456],
      ['Unsafe', Number(uid)]
    ])
    formattedSheet.E3.z = 'dd/mm/yyyy'
    formattedSheet.F3.z = '0.00'
    formattedSheet.G3.z = '0.0%'
    formattedSheet.H3.z = '000000'
    formattedSheet.I3.z = '0.00E+00'
    XLSX.utils.book_append_sheet(formattedWorkbook, formattedSheet, 'UID')
    const formattedFile = {
      name: 'formatted-uids.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: XLSX.write(formattedWorkbook, { type: 'buffer', bookType: 'xlsx' })
    }
    const expectedInfo = ['20/10/2026', '12.75', '12.5%', '000123', '1.23E+05']
    for (const tab of ['Từ template Excel akaBiz', 'File Excel/CSV của khách hàng']) {
      await open('upload')
      await upload.getByRole('tab', { name: tab, exact: true }).click()
      const isTemplate = tab.startsWith('Từ template')
      await upload.locator(isTemplate ? '#campaign-import-akabiz-template-file' : 'input[type=file]').setInputFiles(formattedFile)
      if (isTemplate) {
        await upload.locator('.campaign-import-results').waitFor()
      } else {
        await upload.locator('.campaign-import-column-field select').first().selectOption('0')
        for (let index = 0; index < 5; index++) {
          await upload.locator('.campaign-import-column-field select').nth(index + 2)
            .selectOption(String(4 + index))
        }
        await format()
      }
      for (const value of expectedInfo) {
        assert.equal(await upload.locator('.campaign-import-preview-table').getByRole('cell', { name: value, exact: true }).count(), 1, `${tab}: preview ${value}`)
      }
      await insert()
      const savedRows = (await snapshot()).rows
      assert.deepEqual(savedRows.map(row => row.uid), [uid], `${tab}: preserve UID and reject unsafe number`)
      assert.equal(savedRows[0].name, 'An')
      assert.deepEqual(expectedInfo.map((_, index) => savedRows[0][`info${index + 1}`]), expectedInfo, `${tab}: formatted fields`)
    }
    console.log('PASS Excel formatting: dates, decimals, percentages, leading zeros, scientific notation; both import tabs')

    await open('form')
    const form = page.locator('.campaign-full-modal')
    await form.getByRole('button', { name: 'Thêm data', exact: true }).click()
    await upload.locator('textarea').fill(uid)
    await format()
    await insert()
    // Keep the original group source control available alongside direct UID data.
    assert(await form.getByRole('button', { name: /thành viên group/i }).count() > 0)
    await page.screenshot({ path: '/tmp/aka-zalo-group-member-uid-form.png' })
    await form.getByRole('button', { name: 'Tạo chiến dịch', exact: true }).click()
    await page.waitForFunction(() => window.uidSmoke.state.calls.some(c => c.method === 'createCampaignInputDataBatch'))
    const saved = (await snapshot()).calls.find(c => c.method === 'createCampaignInputDataBatch').args[0]
    assert.deepEqual(saved.map(r => r.uid), ['5555555555555555555', uid])
    assert(saved.every(r => !r.phone))
    await form.waitFor({ state: 'detached' })
    console.log('PASS create campaign: existing member + direct UID persist together')

    await open('append')
    const append = page.locator('.add-current-data-modal')
    await append.getByRole('button', { name: 'Nhập/import data', exact: true }).click()
    await upload.locator('textarea').fill(uid2)
    await format()
    await insert()
    assert.equal(await append.getByRole('button', { name: 'Chọn thành viên group Zalo', exact: true }).count(), 1)
    await append.getByRole('button', { name: 'Thêm', exact: true }).click()
    await append.waitFor({ state: 'detached' })
    const request = (await snapshot()).calls.find(c => c.method === 'append').args[0]
    assert.deepEqual(request.rows.map(r => r.uid), [uid2])
    assert.equal(request.campaignStatus, 'tạm dừng')
    assert.equal(request.skipExistingInCampaign, true)
    assert.deepEqual(errors, [])
    console.log('PASS existing campaign: UID append and group picker; preserve pause/dedupe controls')
  } finally {
    if (app) await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

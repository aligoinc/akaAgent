// Real Electron UI of the Desktop "Thêm data" duplicate check (11/2026, port of Web #209) with a local IPC fixture; never
// connects to any service. Covers: check block (in this campaign / other campaigns), preview IPC (once per new key, retry,
// disabled, stale results), list filter + column, Excel files, pending-list dedupe, "Kiểm tra trùng" dialog (scope, window,
// chunked sequential checks, cancel, failure, Bỏ N số / Giữ nguyên / Xong), Upload option 2/3 marking phones as checked,
// footer summary + submit label, submit payload, non-phone campaigns, a 3.000-row list.
// Run: node scripts/campaign-add-data-duplicates-ui-smoke.cjs (as root in the cloud container: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node ...)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const XLSX = require('xlsx')
const { build } = require('esbuild')
const { _electron } = require('playwright')

const harness = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import AddData from './src/renderer/src/components/CampaignPanels/AddDataToCurrentCampaignModal';
import {classifyAppendInputData,appendInputDataDedupeKeys} from './src/shared/campaignAppendData';
import {useUiStore} from './src/renderer/src/stores/uiStore';
import {useAuthStore} from './src/renderer/src/stores/authStore';
import {useCampaignStore} from './src/renderer/src/stores/campaignStore';
import './src/renderer/src/styles/global.css';
const clone=v=>JSON.parse(JSON.stringify(v));
const latest={campaignId:77,campaignName:'Khách cũ tháng 10',campaignDeleted:false,accountId:12,accountName:'Zalo Bán hàng',uploadedAt:'2026-11-07T03:15:00Z',status:'hoàn thành',processed:true};
const state={alerts:[],exports:[],submitted:null,previewCalls:[],dupCalls:[],settingCalls:0,previewMode:'ok',dupMode:'ok',pendingPreview:[],pendingDup:[],
  setting:{ok:true,data:{audience:'all',defaultDays:30,maxDays:365}},
  campaignRows:{},otherCampaign:{'0912345678':{matchCount:3,campaignCount:2,latest},'0909000003':{matchCount:1,campaignCount:1,latest:{...latest,campaignName:'Chiến dịch đã xoá',campaignDeleted:true}}},
  submitResult:{insertedCount:3,skippedBatchDuplicateCount:0,skippedExistingCount:2,skippedInvalidCount:0},closed:0};
const previewAnswer=r=>{
  const actionId=state.actionId;
  const existing=new Set((state.campaignRows[r.campaignId]||[]).flatMap(row=>appendInputDataDedupeKeys(row,actionId)));
  const c=classifyAppendInputData(actionId,r.items,existing,{skipExisting:true});
  return {ok:true,data:{checkedAt:'2026-11-12T03:00:00Z',campaignInputCount:(state.campaignRows[r.campaignId]||[]).length,itemCount:r.items.length,
    existingIndexes:c.existingIndexes,batchDuplicateIndexes:c.batchDuplicateIndexes,invalidIndexes:c.invalidIndexes}}};
const dupAnswer=r=>({ok:true,data:{checkedAt:'2026-11-12T03:30:00Z',since:'2026-10-12T17:00:00Z',days:r.days,accountCount:r.accountIds.length,phoneCount:r.phones.length,
  items:r.phones.filter(p=>state.otherCampaign[p]).map(p=>({phone:p,...clone(state.otherCampaign[p])}))}});
window.electronAPI={
  campaignInputDuplicates:async request=>{
    if(request.kind==='setting'){state.settingCalls++;return clone(state.setting)}
    state.dupCalls.push(clone(request.request));
    if(state.dupMode==='fail')return {ok:false,code:'input_duplicates_unavailable',message:'Hệ thống chưa đối chiếu được dữ liệu.'};
    if(state.dupMode==='delay')return new Promise(resolve=>state.pendingDup.push(()=>resolve(dupAnswer(request.request))));
    return dupAnswer(request.request)},
  campaignAddDataPreview:async request=>{
    state.previewCalls.push(clone(request));
    if(state.previewMode==='fail')return {ok:false,code:'append_preview_failed',message:'Chưa kiểm tra được.'};
    if(state.previewMode==='disabled')return {ok:false,code:'append_preview_disabled',message:'Tắt.'};
    if(state.previewMode==='delay')return new Promise(resolve=>state.pendingPreview.push(()=>resolve(previewAnswer(request))));
    return previewAnswer(request)}};
useUiStore.setState({showAlert:(message,type)=>state.alerts.push({message,type})});
useAuthStore.setState({user:{staffId:7,organizationId:9,isAdminAkabiz:false}});
const zalo=(id,name,group,extra={})=>({id,name,flatformType:'zalo',isDelete:false,accountGroupName:group,isZaloShowWeb:false,isZaloServer:false,...extra});
useCampaignStore.setState({accounts:[zalo(11,'Zalo CSKH','CSKH'),zalo(12,'Zalo Bán hàng','Sale'),zalo(13,'Zalo Kho','Sale',{isZaloShowWeb:true}),
  zalo(14,'Zalo đã xóa','Sale',{isDelete:true}),{id:15,name:'Facebook Shop',flatformType:'facebook',isDelete:false,accountGroupName:''}]});
const ACTIONS={zalo_message_phone:'zalo',zalo_add_group_member:'zalo',email_send:'email',facebook_group_post:'facebook'};
function App(){
  const [view,setView]=useState({kind:'closed',key:0});
  window.addSmoke={state,
    open:(o={})=>{const actionId=o.actionId||'zalo_message_phone';state.actionId=actionId;state.alerts=[];state.exports=[];state.submitted=null;state.previewCalls=[];state.dupCalls=[];
      setView(v=>({kind:'modal',key:v.key+1,actionId}))},
    captureExport:(book,name)=>state.exports.push({book,name})};
  if(view.kind==='closed')return <div id="closed">Đã đóng</div>;
  const campaign={id:42,name:'Chiến dịch tháng 11',actionId:view.actionId,status:'tạm dừng',schedule:'2026-11-12T03:00:00.000Z',originalSchedule:'2026-11-12T03:00:00.000Z',
    dataTargetSourceMode:'direct',extraSettings:{},accountId:11};
  return <AddData key={view.key} campaign={campaign} campaignAction={{id:view.actionId,name:'Loại '+view.actionId,flatformType:ACTIONS[view.actionId]}}
    account={{id:11,name:'Zalo CSKH',flatformType:'zalo'}}
    onSubmit={async request=>{state.submitted=clone(request);return clone(state.submitResult)}}
    onSnapshotDataGroup={async()=>({insertedCount:0,alreadySeenCount:0,incompatibleCount:0,conflictCount:0})} onRefresh={async()=>{}}
    onClose={()=>{state.closed++;setView(v=>({...v,kind:'closed'}))}}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
`

const CAPTURED = ['AddDataToCurrentCampaignModal.tsx', 'CampaignAddDataDuplicateDialog.tsx', 'CampaignDataUploadModal.tsx']

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-add-data-ui-'))
  let app
  try {
    await build({
      stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: harness }, outfile: path.join(dir, 'app.js'), bundle: true, platform: 'browser',
      format: 'iife', jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning',
      plugins: [{ name: 'capture-export', setup(b) {
        b.onLoad({ filter: /CampaignPanels\/(AddDataToCurrentCampaignModal|CampaignAddDataDuplicateDialog|CampaignDataUploadModal)\.tsx$/ }, args => {
          const source = fs.readFileSync(args.path, 'utf8')
          assert(CAMPAIGN_FILE(args.path), args.path)
          const replaced = source.replace(/\bwriteFile\(/g, ';(window as any).addSmoke.captureExport(')
          assert.notEqual(replaced, source, `expected writeFile( in ${args.path}`)
          return { loader: 'tsx', contents: replaced }
        })
      } }]
    })
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body><div id="root"></div><script src="app.js"></script></body></html>')
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1400,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,c)=>c({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir, 'index.html'))})})`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(dir, 'main.cjs')], cwd: process.cwd(), env })
    const page = await app.firstWindow(); page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()) })
    await page.locator('#closed').waitFor()

    let passed = 0
    const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }
    const smoke = (fn, arg) => page.evaluate(fn, arg)
    const state = () => smoke(() => {
      const s = window.addSmoke.state
      return { alerts: s.alerts, previewCalls: s.previewCalls, dupCalls: s.dupCalls, settingCalls: s.settingCalls, submitted: s.submitted, exportCount: s.exports.length,
        pendingPreview: s.pendingPreview.length, pendingDup: s.pendingDup.length, closed: s.closed }
    })
    const settle = () => smoke(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => setTimeout(resolve, 0)), 0))))
    const setFixture = patch => smoke(p => Object.assign(window.addSmoke.state, p), patch)
    const flush = kind => smoke(k => { const list = window.addSmoke.state[k]; window.addSmoke.state[k] = []; list.forEach(resolve => resolve()) }, kind)
    const lastAlert = async () => (await state()).alerts.at(-1)
    const exported = async index => {
      const item = (await smoke(() => window.addSmoke.state.exports))[index]
      const book = XLSX.read(XLSX.write(item.book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
      return { name: item.name, sheet: book.SheetNames[0], rows: XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: false, defval: '' }) }
    }

    const modal = page.locator('.add-current-data-modal')
    const check = modal.locator('.add-data-check')
    const rowIn = check.locator('.add-data-check-row').nth(0)
    const rowOther = check.locator('.add-data-check-row').nth(1)
    const statusIn = rowIn.locator('[role=status]')
    const statusOther = rowOther.locator('[role=status]')
    const summary = modal.locator('.add-current-data-summary')
    const submit = modal.locator('.add-current-data-footer .btn-primary')
    const skip = rowIn.locator('input[type=checkbox]')
    const filter = modal.locator('.add-data-filter')
    const tableRows = modal.locator('.add-current-data-preview tbody tr')
    const header = modal.locator('.add-current-data-preview thead th')
    const upload = page.locator('.campaign-import-modal')
    const uploadText = upload.locator('textarea')
    const dialog = page.locator('.add-data-dup-dialog')

    const open = async (options = {}) => {
      await smoke(o => window.addSmoke.open(o), options)
      await modal.waitFor()
      await settle()
    }
    const importText = async (text, scope) => {
      await modal.getByRole('button', { name: 'Nhập/import data' }).click()
      await uploadText.waitFor()
      await settle()
      if (scope) {
        await upload.locator('fieldset.campaign-import-dedup').waitFor()
        await upload.getByRole('radio', { name: scope }).check()
      }
      await uploadText.fill(text)
      await upload.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).click()
      await upload.locator('.campaign-import-results').waitFor()
      await upload.locator('.modal-footer .btn-primary').click()
      const confirm = page.getByRole('alertdialog', { name: 'Xác nhận nhập dữ liệu' })
      if (scope) { await confirm.waitFor(); await confirm.locator('.btn-primary').click() }
      await upload.waitFor({ state: 'detached' })
      await settle()
    }
    const ready = async () => { await page.waitForFunction(() => !document.querySelector('.add-data-check .spin')); await settle() }

    // 1. Empty form: no check block, "Thêm" disabled, one switch read.
    await open()
    assert.equal(await check.count(), 0)
    assert.equal(await submit.innerText(), 'Thêm')
    assert(await submit.isDisabled())
    assert.equal(await summary.innerText(), '')
    assert.match(await modal.locator('.add-current-data-meta').innerText(), /Chiến dịch: Chiến dịch tháng 11\s+Tài khoản: Zalo CSKH/)
    assert.equal((await state()).settingCalls, 1)
    assert.equal(await modal.locator('.add-current-data-checkbox').count(), 0, 'old bottom checkbox replaced by the check block')
    ok('empty form: no check block, Thêm disabled, campaign + account shown, switch read once')

    // 2. Import 6 lines (one repeated in the file, one invalid): preview once, 2/5 already in the campaign.
    await setFixture({ campaignRows: { 42: [{ phone: '0912345678' }, { phone: '84987654321' }, { phone: '0900000001' }] } })
    await importText('0912345678\n0987654321\n0909000003\n0909000004\n+84 909 000 005\n0909000004\nbad')
    await ready()
    let s = await state()
    assert.deepEqual(s.alerts.at(-1), { message: 'Đã thêm 5 data vào danh sách chờ thêm.', type: 'success' })
    assert.equal(s.previewCalls.length, 1)
    assert.deepEqual(s.previewCalls[0].campaignId, 42)
    assert.deepEqual(s.previewCalls[0].items.map(item => item.phone), ['0912345678', '0987654321', '0909000003', '0909000004', '0909000005'])
    assert.equal(await statusIn.innerText(), '2/5 data đã có trong chiến dịch này · sẽ bỏ qua khi thêm.')
    assert.equal(await statusOther.innerText(), '5 số chưa đối chiếu với chiến dịch khác.')
    assert.equal(await summary.innerText(), 'Sẽ thêm 3 data · bỏ qua 2 data đã có trong chiến dịch.')
    assert.equal(await submit.innerText(), 'Thêm 3 data')
    assert.deepEqual(await header.allInnerTexts(), ['STT', 'Tên', 'Số điện thoại', 'Kiểm tra trùng', ''])
    assert.equal(await modal.locator('.add-current-data-count').innerText(), ' · 5')
    assert.deepEqual(await tableRows.locator('.campaign-import-status-pill').allInnerTexts(), ['Đã có trong chiến dịch', 'Đã có trong chiến dịch'])
    assert.deepEqual(await filter.locator('button').allInnerTexts(), ['Tất cả · 5', 'Chưa có · 3', 'Đã có trong chiến dịch · 2'])
    ok('import → one preview of 5 phones; "2/5 đã có", row 2 "5 số chưa đối chiếu", summary + "Thêm 3 data", phone-only columns + check column')

    // 3. Filter, Xem, Excel of the rows already in the campaign.
    await filter.getByRole('button', { name: 'Chưa có · 3' }).click()
    assert.deepEqual(await tableRows.locator('td:nth-child(3)').allInnerTexts(), ['0909000003', '0909000004', '0909000005'])
    await rowIn.getByRole('button', { name: 'Xem', exact: true }).click()
    assert.equal(await filter.getByRole('button', { name: 'Đã có trong chiến dịch · 2' }).getAttribute('aria-pressed'), 'true')
    assert.deepEqual(await tableRows.locator('td:nth-child(3)').allInnerTexts(), ['0912345678', '0987654321'])
    assert.deepEqual(await tableRows.locator('td:first-child').allInnerTexts(), ['1', '2'], 'STT keeps the position in the full list')
    await rowIn.getByRole('button', { name: 'Tải Excel data đã có trong chiến dịch này' }).click()
    let file = await exported(0)
    assert.match(file.name, /^data-da-co-trong-chien-dich-.*\.xlsx$/)
    assert.equal(file.sheet, 'Đã có trong chiến dịch')
    assert.deepEqual(file.rows, [['Fullname', 'Uid', 'Mobile', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5'],
      ['', '', '0912345678', '', '', '', '', '', ''], ['', '', '0987654321', '', '', '', '', '', '']])
    await filter.getByRole('button', { name: 'Tất cả · 5' }).click()
    ok('filter pills + Xem; STT stays the list position; Excel "Đã có trong chiến dịch" = template columns, re-importable')

    // 4. Unchecking "Bỏ qua khi thêm" changes the wording, summary and button; nothing is re-read.
    await skip.uncheck()
    assert.equal(await statusIn.innerText(), '2/5 data đã có trong chiến dịch này · sẽ được thêm lại.')
    assert.equal(await summary.innerText(), 'Sẽ thêm 5 data, gồm 2 data đã có trong chiến dịch.')
    assert.equal(await submit.innerText(), 'Thêm 5 data')
    await skip.check()
    assert.equal((await state()).previewCalls.length, 1)
    ok('"Bỏ qua khi thêm" off → "sẽ được thêm lại", Thêm 5 data; on again; no extra preview')

    // 5. Second import overlapping the list: pending dedupe, preview only the new key; removing rows never re-reads.
    await importText('0909000004\n0909000006\n0912345678')
    await ready()
    s = await state()
    assert.deepEqual(s.alerts.at(-1), { message: 'Đã thêm 1 data vào danh sách chờ thêm. Bỏ 2 data đã có trong danh sách.', type: 'success' })
    assert.equal(s.previewCalls.length, 2)
    assert.deepEqual(s.previewCalls[1].items.map(item => item.phone), ['0909000006'])
    assert.equal(await statusIn.innerText(), '2/6 data đã có trong chiến dịch này · sẽ bỏ qua khi thêm.')
    await tableRows.nth(1).getByRole('button', { name: 'Xoá data' }).click()
    await settle()
    assert.equal(await statusIn.innerText(), '1/5 data đã có trong chiến dịch này · sẽ bỏ qua khi thêm.')
    assert.equal(await summary.innerText(), 'Sẽ thêm 4 data · bỏ qua 1 data đã có trong chiến dịch.')
    await tableRows.nth(0).getByRole('button', { name: 'Xoá data' }).click()
    await settle()
    assert.equal(await statusIn.innerText(), 'Không có data nào đã có trong chiến dịch này.')
    assert.equal(await filter.count(), 0)
    assert.deepEqual(await header.allInnerTexts(), ['STT', 'Tên', 'Số điện thoại', ''])
    assert.equal((await state()).previewCalls.length, 2)
    ok('repeat import keeps one row per phone ("Bỏ 2 data đã có trong danh sách"), previews only the new phone; deleting rows updates counts without a request')

    // 6. "Kiểm tra trùng" dialog: picked accounts by default, chunked checks, result, Excel, "Bỏ N số".
    await rowOther.getByRole('button', { name: 'Kiểm tra trùng' }).click()
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Đối chiếu 4 số đang chờ thêm/)
    assert(await dialog.getByRole('radio', { name: /Các tài khoản Zalo bạn chọn/ }).isChecked())
    assert.match(await dialog.getByRole('button', { name: /Chọn tài khoản/ }).innerText(), /3\/3/)
    assert.match(await dialog.innerText(), /Zalo CSKH, Zalo Bán hàng, Zalo Kho/)
    assert.equal(await dialog.getByRole('button', { name: '30 ngày', exact: true }).getAttribute('aria-pressed'), 'true')
    await dialog.getByRole('button', { name: '14 ngày', exact: true }).click()
    await dialog.getByRole('button', { name: 'Kiểm tra 4 số' }).click()
    await dialog.locator('.add-data-dup-total').waitFor()
    s = await state()
    assert.deepEqual(s.dupCalls, [{ actionId: 'zalo_message_phone', accountIds: [11, 12, 13], days: 14, phones: ['0909000003', '0909000004', '0909000005', '0909000006'], excludeCampaignId: 42 }])
    assert.equal(await dialog.locator('.add-data-dup-total strong').innerText(), '1')
    assert.match(await dialog.locator('.add-data-dup-total').innerText(), /số đã có ở chiến dịch khác, trên 4 số đã đối chiếu\.[\s\S]*Trong 14 ngày \(13\/10\/2026 – hôm nay\) · 3 tài khoản Zalo · đối chiếu lúc 10:30\./)
    assert.match(await dialog.locator('tbody').innerText(), /0909000003\s+Chiến dịch đã xoá \(đã xóa\)\s+Zalo Bán hàng\s+07\/11\/2026\s+Đã chạy/)
    assert.match(await dialog.innerText(), /Bỏ 1 số này thì còn 3 data chờ thêm\. Giữ nguyên thì cả 4 data vẫn ở lại danh sách\./)
    await dialog.getByRole('button', { name: 'Tải Excel 1 số' }).click()
    file = await exported(1)
    assert.equal(file.sheet, 'Đã có ở chiến dịch khác')
    assert.deepEqual(file.rows[1], ['', '', '0909000003', '', '', '', '', '', '', 'Chiến dịch đã xoá (đã xóa)', 'Zalo Bán hàng', '07/11/2026 10:15', 'Đã chạy · chiến dịch đã xóa', '1', '1'])
    await dialog.getByRole('button', { name: 'Bỏ 1 số' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await lastAlert(), { message: 'Đã bỏ 1 số đã có ở chiến dịch khác.', type: 'success' })
    assert.equal(await statusOther.innerText(), 'Đã lọc trùng với dữ liệu 14 ngày của 3 tài khoản Zalo lúc 10:30 · đã bỏ 1 số đã có ở chiến dịch khác.')
    assert.deepEqual(await tableRows.locator('td:nth-child(3)').allInnerTexts(), ['0909000004', '0909000005', '0909000006'])
    assert.equal(await rowOther.getByRole('button', { name: 'Kiểm tra lại' }).count(), 1)
    assert.deepEqual(await smoke(() => JSON.parse(localStorage.getItem('aka.campaignImportDuplicates.v1:9:7'))), { days: 14 })
    ok('dialog: picked accounts preselected, 14 days, one request excluding this campaign, result + Excel, "Bỏ 1 số" removes it; row 2 done; days remembered')

    // 7. Kiểm tra lại with "Chỉ tài khoản của chiến dịch này": cancel mid-run, failure, nothing found → Xong.
    await setFixture({ dupMode: 'delay' })
    await rowOther.getByRole('button', { name: 'Kiểm tra lại' }).click()
    await dialog.waitFor()
    assert.equal(await dialog.getByRole('button', { name: '14 ngày', exact: true }).getAttribute('aria-pressed'), 'true', 'days remembered')
    await dialog.getByRole('radio', { name: /Chỉ tài khoản của chiến dịch này/ }).check()
    await dialog.getByRole('button', { name: 'Kiểm tra 3 số' }).click()
    await dialog.getByRole('button', { name: 'Hủy kiểm tra' }).waitFor()
    assert(await dialog.getByRole('button', { name: 'Đóng' }).isDisabled())
    await dialog.getByRole('button', { name: 'Hủy kiểm tra' }).click()
    await flush('pendingDup'); await settle()
    assert.equal(await dialog.locator('.add-data-dup-total').count(), 0, 'cancelled result is discarded')
    await setFixture({ dupMode: 'fail' })
    await dialog.getByRole('button', { name: 'Kiểm tra 3 số' }).click()
    await dialog.locator('.campaign-import-dedup-error').waitFor()
    assert.match(await dialog.locator('.campaign-import-dedup-error').innerText(), /Hệ thống chưa đối chiếu được dữ liệu\. Danh sách chờ thêm vẫn giữ nguyên\./)
    await setFixture({ dupMode: 'ok' })
    await dialog.getByRole('button', { name: 'Thử lại' }).click()
    await dialog.locator('.add-data-dup-total').waitFor()
    s = await state()
    assert.deepEqual(s.dupCalls.at(-1), { actionId: 'zalo_message_phone', accountIds: [11], days: 14, phones: ['0909000004', '0909000005', '0909000006'], excludeCampaignId: 42 })
    assert.match(await dialog.locator('.add-data-dup-total').innerText(), /Không có số nào trong 3 số đã có ở chiến dịch khác\./)
    await dialog.getByRole('button', { name: 'Xong' }).click()
    await dialog.waitFor({ state: 'detached' })
    // "Đã bỏ" counts every check of this form (the 1 number removed at step 6), scope/window/time are the latest check's.
    assert.equal(await statusOther.innerText(), 'Đã lọc trùng với dữ liệu 14 ngày của tài khoản Zalo CSKH lúc 10:30 · đã bỏ 1 số đã có ở chiến dịch khác.')
    ok('Kiểm tra lại: only this account; cancel discards, failure keeps list + Thử lại, nothing found → Xong; row 2 keeps the total removed')

    // 8. "Giữ nguyên" keeps the numbers and row 2 reports them; a new phone makes row 2 pending again.
    await setFixture({ otherCampaign: { '0909000005': { matchCount: 1, campaignCount: 1, latest: { campaignId: 78, campaignName: 'Tháng 9', campaignDeleted: false, accountId: 11, accountName: 'Zalo CSKH', uploadedAt: '2026-11-01T03:15:00Z', status: 'chờ xử lý', processed: false } } } })
    await rowOther.getByRole('button', { name: 'Kiểm tra lại' }).click()
    await dialog.getByRole('button', { name: 'Kiểm tra 3 số' }).click()
    await dialog.getByRole('button', { name: 'Giữ nguyên' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.match(await statusOther.innerText(), /· giữ lại 1 số đã có ở chiến dịch khác\.$/)
    assert.equal(await tableRows.count(), 3)
    await importText('0909000007')
    await ready()
    assert.equal(await statusOther.innerText(), 'Đã lọc 3 số lúc 10:30 · còn 1 số chưa đối chiếu.')
    assert.equal(await rowOther.getByRole('button', { name: 'Kiểm tra trùng' }).count(), 1)
    ok('"Giữ nguyên" → row 2 "giữ lại 1 số"; a newly added phone → "còn 1 số chưa đối chiếu" and Kiểm tra trùng again')

    // 9. Upload with option 3 marks the imported phones as checked and counts what it skipped.
    const latest = { campaignId: 77, campaignName: 'Khách cũ tháng 10', campaignDeleted: false, accountId: 12, accountName: 'Zalo Bán hàng', uploadedAt: '2026-11-07T03:15:00Z', status: 'hoàn thành', processed: true }
    await setFixture({ otherCampaign: { '0909000009': { matchCount: 1, campaignCount: 1, latest } } })
    await importText('0909000008\n0909000009', /^Với các tài khoản Zalo bạn chọn/)
    await ready()
    s = await state()
    assert.deepEqual(s.alerts.at(-1), { message: 'Đã thêm 1 data vào danh sách chờ thêm. Bỏ qua 1 số đã có ở chiến dịch khác.', type: 'success' })
    assert.equal(await statusOther.innerText(), 'Đã lọc 4 số lúc 10:30 · còn 1 số chưa đối chiếu.')
    assert.equal(await upload.count(), 0)
    ok('Upload option 3 → imported phones count as checked, skipped number reported in the toast')

    // 10. Submit: payload, toast, close.
    await setFixture({ submitResult: { insertedCount: 5, skippedBatchDuplicateCount: 0, skippedExistingCount: 0, skippedInvalidCount: 0 } })
    assert.equal(await submit.innerText(), 'Thêm 5 data')
    await submit.click()
    await page.locator('#closed').waitFor()
    s = await state()
    assert.deepEqual(s.submitted.rows.map(row => row.phone), ['0909000004', '0909000005', '0909000006', '0909000007', '0909000008'])
    assert.equal(s.submitted.skipExistingInCampaign, true)
    assert.equal(s.submitted.campaignId, 42)
    assert.equal(s.submitted.campaignStatus, 'tạm dừng')
    assert.deepEqual(s.alerts.at(-1), { message: 'Đã thêm 5 data vào chiến dịch.', type: 'success' })
    ok('submit sends the list, skip flag, schedule/status; toast and close')

    // 11. Preview failure → warn + Thử lại; disabled → info text and no further requests; stale result discarded.
    await setFixture({ previewMode: 'fail' })
    await open()
    await importText('0912345678\n0909000003')
    await ready()
    assert.equal(await statusIn.innerText(), 'Chưa xem trước được. Khi bấm Thêm, hệ thống vẫn bỏ qua data đã có trong chiến dịch.')
    assert.equal(await summary.innerText(), '')
    assert.equal(await submit.innerText(), 'Thêm')
    assert(!(await submit.isDisabled()), 'can still add; the write path filters')
    await setFixture({ previewMode: 'ok' })
    await rowIn.getByRole('button', { name: 'Thử lại' }).click()
    await ready()
    assert.equal(await statusIn.innerText(), '1/2 data đã có trong chiến dịch này · sẽ bỏ qua khi thêm.')
    await setFixture({ previewMode: 'delay' })
    await importText('0909000010')
    assert.equal(await statusIn.innerText(), 'Đang kiểm tra data đã có trong chiến dịch này…')
    assert.equal(await summary.innerText(), '')
    await tableRows.nth(2).getByRole('button', { name: 'Xoá data' }).click()
    await flush('pendingPreview'); await ready()
    assert.equal(await statusIn.innerText(), '1/2 data đã có trong chiến dịch này · sẽ bỏ qua khi thêm.')
    await setFixture({ previewMode: 'disabled' })
    await importText('0909000011')
    await ready()
    assert.equal(await statusIn.innerText(), 'Khi bấm Thêm, hệ thống bỏ qua data đã có trong chiến dịch này.')
    const callsWhenDisabled = (await state()).previewCalls.length
    await importText('0909000012')
    assert.equal((await state()).previewCalls.length, callsWhenDisabled, 'switch off → no more previews in this form')
    await skip.uncheck()
    assert.equal(await statusIn.innerText(), 'Data đã có trong chiến dịch này sẽ được thêm lại; chỉ lọc trùng trong danh sách vừa chọn.')
    await modal.getByRole('button', { name: 'Huỷ' }).click()
    await page.locator('#closed').waitFor()
    ok('preview failure → warning + Thử lại (still addable); in-flight result for an edited list is dropped; switch off → info text, no more requests')

    // 12. Switch for other campaigns off → no row 2; Zalo add-member (phone or UID) and email campaigns.
    await setFixture({ previewMode: 'ok', setting: { ok: true, data: { audience: 'off', defaultDays: 30, maxDays: 365 } } })
    await open()
    await importText('0912345678\n0909000003')
    await ready()
    assert.equal(await check.locator('.add-data-check-row').count(), 1, 'switch off → no "Với chiến dịch khác" row')
    await modal.getByRole('button', { name: 'Huỷ' }).click()
    await setFixture({ setting: { ok: true, data: { audience: 'all', defaultDays: 30, maxDays: 365 } },
      campaignRows: { 42: [{ email: 'khach1@gmail.com' }] } })
    await open({ actionId: 'email_send' })
    await importText('Khach1@Gmail.com\nkhach2@gmail.com\nkhach2@gmail.com')
    await ready()
    s = await state()
    assert.deepEqual(s.previewCalls.at(-1).items.map(item => item.email), ['khach1@gmail.com', 'khach2@gmail.com'])
    assert.equal(await statusIn.innerText(), '1/2 data đã có trong chiến dịch này · sẽ bỏ qua khi thêm.')
    assert.deepEqual(await header.allInnerTexts(), ['STT', 'Tên', 'Email', 'Kiểm tra trùng', ''])
    assert.equal(await check.locator('.add-data-check-row').count(), 1, 'email campaign has no other-campaign row')
    await modal.getByRole('button', { name: 'Huỷ' }).click()
    // Desktop Upload imports phones only for add-member (UID comes from the scan sources); existing rows may hold either.
    await setFixture({ campaignRows: { 42: [{ uid: '1234567890123' }, { phone: '84909000020' }] } })
    await open({ actionId: 'zalo_add_group_member' })
    await importText('0909000020\n0909000021')
    await ready()
    assert.equal(await statusIn.innerText(), '1/2 data đã có trong chiến dịch này · sẽ bỏ qua khi thêm.')
    assert.deepEqual(await header.allInnerTexts(), ['STT', 'Tên', 'Số điện thoại', 'UID/link', 'Kiểm tra trùng', ''])
    assert.equal(await check.locator('.add-data-check-row').count(), 1, 'add-member is not a phone message campaign')
    await modal.getByRole('button', { name: 'Huỷ' }).click()
    ok('other-campaign row only for SĐT message campaigns with the switch on; email (lower-case keys) and phone-or-UID campaigns preview correctly')

    // 13. 3.000-row list: one preview request, render and counts.
    const many = Array.from({ length: 3000 }, (_, index) => `09${String(10000000 + index)}`)
    await setFixture({ campaignRows: { 42: many.filter((_, index) => index % 3 === 0).map(phone => ({ phone })) } })
    await open()
    await modal.getByRole('button', { name: 'Nhập/import data' }).click()
    await uploadText.waitFor()
    await upload.locator('input[type=file][accept*=".txt"], input[type=file]').first().setInputFiles({ name: 'so.txt', mimeType: 'text/plain', buffer: Buffer.from(many.join('\n')) })
    await page.waitForFunction(() => (document.querySelector('.campaign-import-modal textarea')?.value || '').length > 30000)
    await upload.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).click()
    await upload.locator('.campaign-import-results').waitFor()
    const started = Date.now()
    await upload.locator('.modal-footer .btn-primary').click()
    await upload.waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.querySelector('.add-data-check [role=status]')?.textContent?.includes('1.000/3.000'))
    const elapsed = Date.now() - started
    s = await state()
    assert.equal(s.previewCalls.at(-1).items.length, 3000)
    assert.equal(await summary.innerText(), 'Sẽ thêm 2.000 data · bỏ qua 1.000 data đã có trong chiến dịch.')
    assert.equal(await submit.innerText(), 'Thêm 2.000 data')
    console.log(`   3.000 rows: insert → preview → render ${elapsed} ms`)
    await modal.getByRole('button', { name: 'Huỷ' }).click()
    ok('3.000 rows: one preview request, "1.000/3.000", Thêm 2.000 data')

    assert.deepEqual(errors, [])
    ok('no page errors')
    console.log(`PASS ${passed} checks`)
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function CAMPAIGN_FILE(file) { return CAPTURED.some(name => file.endsWith(name)) }

main().catch(error => { console.error(error); process.exitCode = 1 })

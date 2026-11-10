// Real Electron UI of the Desktop "Lọc trùng dữ liệu" (V491 via V493) with a local IPC fixture; never connects to any service.
// Covers: switch gate, three options, account picker, days window + memory, chunked sequential requests, cancel, failure
// (Thử lại / Chỉ lọc trong file), "Đã có ở chiến dịch khác" group + Excel, final confirmation, submission summary,
// template tab, and the form note "Kiểm tra lại" after changing accounts.
// Run: node scripts/campaign-input-duplicates-ui-smoke.cjs (as root in the cloud container: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node ...)
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
import Upload from './src/renderer/src/components/CampaignPanels/CampaignDataUploadModal';
import {InputDuplicateFormNote} from './src/renderer/src/components/CampaignPanels/InputDuplicateFormNote';
import {useUiStore} from './src/renderer/src/stores/uiStore';
import {useAuthStore} from './src/renderer/src/stores/authStore';
import {useCampaignStore} from './src/renderer/src/stores/campaignStore';
import './src/renderer/src/styles/global.css';
const clone=v=>JSON.parse(JSON.stringify(v));
const latest={campaignId:77,campaignName:'Khách cũ tháng 10',campaignDeleted:false,accountId:12,accountName:'Zalo Bán hàng',uploadedAt:'2026-11-07T03:15:00Z',status:'hoàn thành',processed:true};
const NOTE_PHONES=['0912345678','+84 912 345 678','0987654321',null,'bad'];
const state={alerts:[],confirms:[],exports:[],submitted:null,calls:[],settingCalls:0,mode:'ok',pending:[],
  setting:{ok:true,data:{audience:'all',defaultDays:30,maxDays:365}},
  known:{'0912345678':{matchCount:3,campaignCount:2,latest}}};
const answer=r=>({ok:true,data:{checkedAt:'2026-11-10T15:30:00Z',since:'2026-10-27T17:00:00Z',days:r.days,accountCount:r.accountIds.length,phoneCount:r.phones.length,
  items:r.phones.filter(p=>state.known[p]).map(p=>({phone:p,...clone(state.known[p])}))}});
window.electronAPI={campaignInputDuplicates:async request=>{
  if(request.kind==='setting'){state.settingCalls++;return clone(state.setting)}
  state.calls.push(clone(request));
  if(state.mode==='fail')return {ok:false,code:'input_duplicates_unavailable',message:'Hệ thống chưa đối chiếu được dữ liệu.'};
  if(state.mode==='delay')return new Promise(resolve=>state.pending.push(()=>resolve(answer(request.request))));
  return answer(request.request)}};
useUiStore.setState({showAlert:(message,type)=>state.alerts.push({message,type}),showConfirm:(message,onConfirm,options)=>state.confirms.push({message,onConfirm,options})});
const user=isAdminAkabiz=>({staffId:7,organizationId:9,isAdminAkabiz});
useAuthStore.setState({user:user(false)});
const zalo=(id,name,group,extra={})=>({id,name,flatformType:'zalo',isDelete:false,accountGroupName:group,isZaloShowWeb:false,isZaloServer:false,...extra});
useCampaignStore.setState({accounts:[zalo(11,'Zalo CSKH','CSKH'),zalo(12,'Zalo Bán hàng','Sale',{isZaloServer:true}),zalo(13,'Zalo Kho','Sale',{isZaloShowWeb:true}),
  zalo(14,'Zalo đã xóa','Sale',{isDelete:true}),{id:15,name:'Facebook Shop',flatformType:'facebook',isDelete:false,accountGroupName:''},zalo(16,'Zalo lẻ',null)]});
function App(){
  const [view,setView]=useState({kind:'closed',key:0});
  const [phones,setPhones]=useState(NOTE_PHONES);
  window.dupSmoke={state,
    open:(o={})=>{state.alerts=[];state.exports=[];state.submitted=null;state.calls=[];
      setView(v=>({kind:'upload',key:v.key+1,actionId:o.actionId||'zalo_message_phone',check:o.check===undefined?{currentAccounts:[{id:11,name:'Zalo CSKH'}]}:o.check}))},
    note:(note,accountIds)=>{state.alerts=[];state.confirms=[];state.calls=[];setPhones(NOTE_PHONES);setView(v=>({kind:'note',key:v.key+1,note,accountIds}))},
    accounts:accountIds=>setView(v=>({...v,accountIds})),
    admin:flag=>useAuthStore.setState({user:user(flag)}),
    captureExport:(book,name)=>state.exports.push({book,name})};
  if(view.kind==='note')return <div style={{padding:16}}><InputDuplicateFormNote key={view.key} note={view.note} actionId="zalo_message_phone" accountIds={view.accountIds}
    phones={()=>phones} removeRows={shouldRemove=>setPhones(list=>list.filter(phone=>!shouldRemove(phone)))} onNoteChange={note=>setView(v=>({...v,note}))}/>
    <pre id="note-state">{JSON.stringify({note:view.note,phones})}</pre></div>;
  if(view.kind==='closed')return <div id="closed">Đã đóng</div>;
  return <Upload key={view.key} platform="zalo" actionId={view.actionId} accountIds={[]} showDatasetName={false} duplicateCheck={view.check||undefined}
    onClose={()=>setView(v=>({...v,kind:'closed'}))} onInsert={()=>{}} onSubmitRows={submission=>{state.submitted=clone(submission)}}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
`

const templateHeaders = ['Fullname', 'Uid', 'Mobile', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']
const xlsxFile = (rows, name = 'template.xlsx') => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Data')
  return { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-input-dup-ui-'))
  let app
  try {
    await build({
      stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: harness }, outfile: path.join(dir, 'app.js'), bundle: true, platform: 'browser',
      format: 'iife', jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning',
      plugins: [{ name: 'capture-export', setup(b) {
        b.onLoad({ filter: /CampaignDataUploadModal\.tsx$/ }, args => {
          const source = fs.readFileSync(args.path, 'utf8')
          assert.equal(source.split('writeFile(book,').length, 2, 'expected exactly one writeFile(book, call')
          return { loader: 'tsx', contents: source.replace('writeFile(book,', ';(window as any).dupSmoke.captureExport(book,') }
        })
      } }]
    })
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body><div id="root"></div><script src="app.js"></script></body></html>')
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1500,height:1200,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,c)=>c({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir, 'index.html'))})})`)
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
      const s = window.dupSmoke.state
      return { alerts: s.alerts, calls: s.calls, settingCalls: s.settingCalls, submitted: s.submitted, exportCount: s.exports.length, pending: s.pending.length,
        confirms: s.confirms.map(c => ({ message: c.message, options: c.options })) }
    })
    const settle = () => smoke(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => setTimeout(resolve, 0)), 0))))
    const setFixture = patch => smoke(p => Object.assign(window.dupSmoke.state, p), patch)
    const modal = page.locator('.campaign-import-modal')
    const dedup = modal.locator('fieldset.campaign-import-dedup')
    const results = modal.locator('.campaign-import-results')
    const textarea = modal.locator('textarea')
    const radio = name => dedup.getByRole('radio', { name })
    const fileOnly = () => radio(/Chỉ trong file này/), current = () => radio(/Với tài khoản đang chọn/), picked = () => radio(/Với các tài khoản Zalo bạn chọn/)
    const preset = days => dedup.getByRole('button', { name: `${days} ngày`, exact: true })
    const pickButton = dedup.getByRole('button', { name: /Chọn tài khoản/ })
    const checkButton = modal.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true })
    const insertButton = modal.locator('.modal-footer .btn-primary')
    const footerHint = modal.locator('.modal-footer .campaign-import-submit-hint')
    const counts = async () => (await modal.locator('.campaign-import-result-group strong').allTextContents()).map(text => Number(text.replace(/\D/g, '')))
    const groupLabels = async () => modal.locator('.campaign-import-result-group > button:first-child span').allTextContents()
    const picker = page.getByRole('dialog', { name: 'Chọn tài khoản để đối chiếu' })
    const pickAccount = name => picker.getByRole('checkbox', { name: new RegExp(`^${name}`) })
    const groupBox = name => picker.getByRole('checkbox', { name: `Chọn cả nhóm ${name}` })
    const confirm = page.getByRole('alertdialog', { name: 'Xác nhận nhập dữ liệu' })
    const memory = () => smoke(() => JSON.parse(localStorage.getItem('aka.campaignImportDuplicates.v1:9:7') || 'null'))
    const open = async (options = {}, expectSetting = true) => {
      const before = (await state()).settingCalls
      await smoke(o => window.dupSmoke.open(o), options)
      await textarea.waitFor()
      if (expectSetting) await page.waitForFunction(n => window.dupSmoke.state.settingCalls > n, before)
      await settle()
    }
    const check = async () => { await checkButton.click(); await results.waitFor() }

    // 1. Default: frame shown for a supported action, "Chỉ trong file này" selected, no window, one setting read.
    await open()
    await dedup.waitFor()
    assert.equal((await state()).settingCalls, 1)
    assert.equal(await dedup.locator('legend').innerText(), 'Lọc trùng dữ liệu')
    assert(await fileOnly().isChecked())
    assert.equal(await dedup.locator('.campaign-import-dedup-window').count(), 0)
    await textarea.fill('0987654321\n0912345678\n0912345678\nbad')
    await check()
    assert.deepEqual(await counts(), [2, 1, 1])
    assert.deepEqual(await groupLabels(), ['Hợp lệ', 'Lỗi/bị loại', 'Trùng'])
    assert.equal((await state()).calls.length, 0)
    assert.match(await results.innerText(), /Trùng chỉ tính trong lần upload này/)
    ok('frame visible with "Chỉ trong file này" by default; in-file check sends no request')

    // 2. Option 2 shows the campaign's accounts and the default window; option 3 starts with every Zalo account of the staff.
    await current().check()
    assert.equal(await results.count(), 0, 'changing the option invalidates the previous result')
    assert.deepEqual(await dedup.locator('.campaign-import-dedup-chip').allInnerTexts(), ['Zalo CSKH'])
    assert.deepEqual(await dedup.locator('.campaign-import-dedup-preset').allInnerTexts(), ['7 ngày', '14 ngày', '30 ngày', '90 ngày'])
    assert.equal(await preset(30).getAttribute('aria-pressed'), 'true')
    assert.match(await dedup.innerText(), /Chỉ đối chiếu chiến dịch cùng loại/)
    assert.doesNotMatch(await dedup.innerText(), /Không tính chính chiến dịch này/)
    await picked().check()
    assert.match(await pickButton.innerText(), /Chọn tài khoản · 4\/4/)
    assert.match(await dedup.innerText(), /Zalo CSKH, Zalo Bán hàng, Zalo Kho và 1 tài khoản khác/)
    ok('option 2 shows current accounts; option 3 preselects all 4 Zalo accounts (deleted and Facebook excluded)')

    // 3. Account picker: groups, labels, search without accents, group checkbox, cancel discards, Xong saves.
    await pickButton.click()
    await picker.waitFor()
    const zIndex = selector => smoke(s => Number(getComputedStyle(document.querySelector(s)).zIndex), selector)
    assert(await zIndex('.modal-overlay:has(.input-dup-picker)') > await zIndex('.modal-overlay:has(.campaign-import-modal)'))
    assert.match(await picker.getByRole('status').innerText(), /4\/4/)
    assert.deepEqual(await picker.locator('[role=group]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['CSKH', 'Sale', 'Chưa có nhóm'])
    assert.deepEqual(await picker.locator('.input-dup-picker-account-name strong').allInnerTexts(), ['Zalo CSKH', 'Zalo Bán hàng', 'Zalo Kho', 'Zalo lẻ'])
    assert.deepEqual(await picker.locator('.input-dup-picker-account-name > span').allInnerTexts(), ['Zalo (mã QR)', 'Zalo (web) - Chạy trên server', 'Zalo (trình duyệt)', 'Zalo (mã QR)'])
    assert.equal(await picker.locator('.input-dup-picker-current').count(), 1)
    assert.match(await picker.locator('.input-dup-picker-account', { has: page.locator('.input-dup-picker-current') }).innerText(), /Zalo CSKH/)
    await pickAccount('Zalo Kho').uncheck(); await pickAccount('Zalo lẻ').uncheck()
    assert.match(await picker.getByRole('status').innerText(), /2\/4/)
    assert.equal(await groupBox('Sale').evaluate(node => node.indeterminate && !node.checked), true)
    assert.equal(await groupBox('CSKH').evaluate(node => node.checked && !node.indeterminate), true)
    assert.equal(await groupBox('Chưa có nhóm').evaluate(node => node.checked || node.indeterminate), false)
    const search = picker.getByRole('searchbox', { name: 'Tìm tài khoản' })
    await search.fill('ban hang')
    assert.deepEqual(await picker.locator('.input-dup-picker-account-name strong').allInnerTexts(), ['Zalo Bán hàng'])
    await search.fill('xyz')
    assert.match(await picker.locator('.input-dup-picker-empty').innerText(), /Không có tài khoản nào khớp “xyz”/)
    await search.fill('')
    await picker.getByRole('button', { name: 'Bỏ chọn tất cả' }).click()
    assert(await picker.getByRole('button', { name: 'Chọn ít nhất 1 tài khoản' }).isDisabled())
    await groupBox('CSKH').check(); await pickAccount('Zalo Bán hàng').check()
    await picker.getByRole('button', { name: 'Xong · 2 tài khoản' }).click()
    await picker.waitFor({ state: 'detached' })
    assert.match(await pickButton.innerText(), /2\/4/)
    assert.match(await dedup.innerText(), /Zalo CSKH, Zalo Bán hàng(?! và)/)
    await pickButton.click(); await picker.waitFor()
    await picker.getByRole('button', { name: 'Bỏ chọn tất cả' }).click()
    await picker.getByRole('button', { name: 'Hủy' }).click(); await picker.waitFor({ state: 'detached' })
    assert.match(await pickButton.innerText(), /2\/4/)
    assert.deepEqual(await memory(), { pickedIds: [11, 12] })
    ok('picker: grouped/sorted, type labels, current badge, accent-free search, group tri-state, Hủy discards, Xong saves and remembers')

    // 4. Check: one request with the picked accounts and window, "Đã có ở chiến dịch khác" group, Excel, confirmation, submission.
    await preset(14).click()
    assert.equal(await preset(14).getAttribute('aria-pressed'), 'true')
    await check()
    let s = await state()
    assert.deepEqual(s.calls, [{ kind: 'check', request: { actionId: 'zalo_message_phone', accountIds: [11, 12], days: 14, phones: ['0987654321', '0912345678'], excludeCampaignId: null } }])
    assert.deepEqual(await groupLabels(), ['Hợp lệ', 'Đã có ở chiến dịch khác', 'Lỗi/bị loại', 'Trùng'])
    assert.deepEqual(await counts(), [1, 1, 1, 1])
    assert.equal(await modal.getByRole('button', { name: 'Dữ liệu đã có ở chiến dịch khác: 1' }).getAttribute('aria-pressed'), 'true')
    const table = modal.locator('.campaign-import-preview-table')
    assert.match(await table.locator('thead').innerText(), /Đã có ở chiến dịch\s+Tài khoản\s+Ngày tải lên\s+Trạng thái/)
    const row = await table.locator('tbody tr').first().innerText()
    for (const text of ['0912345678', 'Khách cũ tháng 10 · +1 chiến dịch', 'Zalo Bán hàng', '07/11/2026', 'Đã chạy']) assert(row.includes(text), `${text} missing in ${row}`)
    assert.match(await results.innerText(), /Đã đối chiếu với dữ liệu tải lên từ 28\/10\/2026 đến hôm nay của 2 tài khoản Zalo lúc 22:30\./)
    assert.equal(await footerHint.innerText(), 'Sẽ chèn 1 dữ liệu mới · bỏ qua 1 đã có ở chiến dịch khác.')
    assert.deepEqual(s.alerts.at(-1), { message: 'Đã kiểm tra: 1 hợp lệ · 1 lỗi/bị loại · 1 trùng · 1 đã có ở chiến dịch khác.', type: 'success' })
    await modal.getByRole('button', { name: 'Tải Excel Dữ liệu đã có ở chiến dịch khác', exact: true }).click()
    const exported = (await smoke(() => window.dupSmoke.state.exports))[0]
    assert.match(exported.name, /^du-lieu-da-co-o-chien-dich-khac-.*\.xlsx$/)
    const book = XLSX.read(XLSX.write(exported.book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    assert.deepEqual(book.SheetNames, ['Đã có ở chiến dịch khác'])
    const sheetRows = XLSX.utils.sheet_to_json(book.Sheets['Đã có ở chiến dịch khác'], { header: 1, raw: false, defval: '' })
    assert.equal(sheetRows.length, 2)
    assert.deepEqual(sheetRows[0].slice(0, 3), ['Fullname', 'Uid', 'Mobile'])
    assert.equal(sheetRows[1][2], '0912345678')
    assert.deepEqual(sheetRows[1].slice(13), ['Khách cũ tháng 10', 'Zalo Bán hàng', '07/11/2026 10:15', 'Đã chạy', '2', '3'])
    await insertButton.click()
    await confirm.waitFor()
    const confirmText = await confirm.innerText()
    assert.equal(await confirm.locator('.campaign-import-confirm-total strong').innerText(), '1')
    for (const pattern of [/số mới sẽ được chèn vào danh sách/, /Sẽ bỏ qua 3 số/, /1 số đã có ở chiến dịch khác/, /Trong 14 ngày \(28\/10\/2026 – hôm nay\) · 2 tài khoản Zalo/,
      /1 số trùng trong file/, /1 dòng lỗi\/bị loại/, /Kết quả đối chiếu lúc 22:30/]) assert.match(confirmText, pattern)
    await confirm.getByRole('button', { name: 'Quay lại' }).click()
    await confirm.waitFor({ state: 'detached' })
    assert.equal((await state()).submitted, null)
    await insertButton.click(); await confirm.waitFor()
    await confirm.getByRole('button', { name: 'Tải Excel số đã có ở chiến dịch khác' }).click()
    assert.equal((await state()).exportCount, 2)
    await confirm.getByRole('button', { name: 'Nhập 1 số', exact: true }).click()
    await modal.waitFor({ state: 'detached' })
    s = await state()
    assert.deepEqual(s.submitted.rows.map(item => item.phone), ['0987654321'])
    assert.equal(s.submitted.importSource, 'textbox')
    assert.deepEqual(s.submitted.duplicates, { scope: 'picked', days: 14, accountIds: [11, 12], checkedAt: '2026-11-10T15:30:00Z', since: '2026-10-27T17:00:00Z', skipped: 1 })
    assert.deepEqual(await memory(), { pickedIds: [11, 12], days: 14 })
    ok('check → existing group/table/summary/Excel; confirm (Quay lại, Excel, Nhập 1 số) → only new rows + summary submitted')

    // 5. Memory, option 2 with several accounts and the edited campaign excluded, all-existing result, custom days.
    await open({ check: { currentAccounts: [{ id: 11, name: 'Zalo CSKH' }, { id: 12, name: 'Zalo Bán hàng' }], excludeCampaignId: 501 } })
    assert(await fileOnly().isChecked(), 'the option itself is not remembered')
    await current().check()
    assert.deepEqual(await dedup.locator('.campaign-import-dedup-chip').allInnerTexts(), ['Zalo CSKH', 'Zalo Bán hàng'])
    assert.equal(await preset(14).getAttribute('aria-pressed'), 'true')
    assert.match(await dedup.innerText(), /Không tính chính chiến dịch này\./)
    await textarea.fill('0912345678')
    await check()
    assert.deepEqual((await state()).calls.map(call => call.request), [{ actionId: 'zalo_message_phone', accountIds: [11, 12], days: 14, phones: ['0912345678'], excludeCampaignId: 501 }])
    assert.deepEqual(await counts(), [0, 1, 0, 0])
    assert(await insertButton.isDisabled())
    assert.equal(await footerHint.innerText(), 'Mọi số hợp lệ đều đã có ở chiến dịch khác. Bạn vẫn có thể tải danh sách.')
    assert.match(await results.innerText(), /của 2 tài khoản đang chọn lúc 22:30/)
    await picked().check()
    assert.match(await pickButton.innerText(), /2\/4/)
    const daysInput = dedup.getByRole('spinbutton', { name: 'Số ngày kiểm tra trùng' })
    await daysInput.fill('45')
    assert.deepEqual(await dedup.locator('.campaign-import-dedup-preset[aria-pressed=true]').count(), 0)
    assert.equal((await memory()).days, 45)
    for (const bad of ['400', '0', '2.5']) {
      await daysInput.fill(bad)
      assert.equal(await dedup.getByRole('alert').innerText(), 'Số ngày phải từ 1 đến 365.')
      assert(await checkButton.isDisabled())
    }
    await daysInput.fill('')
    assert.equal(await daysInput.inputValue(), '45')
    assert.equal(await dedup.getByRole('alert').count(), 0)
    await check()
    assert.deepEqual((await state()).calls.at(-1).request, { actionId: 'zalo_message_phone', accountIds: [11, 12], days: 45, phones: ['0912345678'], excludeCampaignId: 501 })
    ok('remembered days/accounts, option 2 with 2 accounts + excluded campaign, all-existing result, custom days 1..max')

    // 6. maxDays from the switch filters presets and caps remembered days.
    await setFixture({ setting: { ok: true, data: { audience: 'all', defaultDays: 30, maxDays: 40 } } })
    await open()
    await current().check()
    assert.deepEqual(await dedup.locator('.campaign-import-dedup-preset').allInnerTexts(), ['7 ngày', '14 ngày', '30 ngày'])
    assert.equal(await preset(30).getAttribute('aria-pressed'), 'true', 'remembered 45 > maxDays 40 falls back to defaultDays')
    await dedup.getByRole('spinbutton', { name: 'Số ngày kiểm tra trùng' }).fill('41')
    assert.equal(await dedup.getByRole('alert').innerText(), 'Số ngày phải từ 1 đến 40.')
    await setFixture({ setting: { ok: true, data: { audience: 'all', defaultDays: 30, maxDays: 365 } } })
    ok('switch maxDays limits presets/custom days; remembered days above it fall back to defaultDays')

    // 7. Failure: nothing inserted, Thử lại succeeds; another failure then "Chỉ lọc trong file" keeps the in-file result.
    await open()
    await textarea.fill('0987654321\n0912345678\nbad')
    await current().check()
    await setFixture({ mode: 'fail' })
    await checkButton.click()
    const failure = modal.locator('.campaign-import-dedup-error')
    await failure.waitFor()
    assert.match(await failure.innerText(), /Chưa đối chiếu được với dữ liệu đã tải lên/)
    assert.match(await failure.innerText(), /Hệ thống chưa đối chiếu được dữ liệu\. Chưa có dữ liệu nào được chèn\./)
    assert.equal(await results.count(), 0)
    assert(await insertButton.isDisabled())
    assert.match(await footerHint.innerText(), /Chưa đối chiếu được với chiến dịch khác/)
    await setFixture({ mode: 'ok' })
    await failure.getByRole('button', { name: 'Thử lại' }).click()
    await results.waitFor()
    assert.equal(await failure.count(), 0)
    assert.deepEqual(await counts(), [1, 1, 1, 0])
    assert.equal((await state()).calls.length, 2)
    await setFixture({ mode: 'fail' })
    await checkButton.click(); await failure.waitFor()
    await failure.getByRole('button', { name: 'Chỉ lọc trong file' }).click()
    await results.waitFor()
    assert.deepEqual(await groupLabels(), ['Hợp lệ', 'Lỗi/bị loại', 'Trùng'])
    assert.deepEqual(await counts(), [2, 1, 0])
    assert(await fileOnly().isChecked())
    await setFixture({ mode: 'ok' })
    await insertButton.click()
    await modal.waitFor({ state: 'detached' })
    s = await state()
    assert.deepEqual(s.submitted.rows.map(item => item.phone), ['0987654321', '0912345678'])
    assert.equal('duplicates' in s.submitted, false)
    ok('failure blocks insertion; Thử lại re-checks; "Chỉ lọc trong file" inserts without a summary (no confirm)')

    // 8. 2,500 numbers: sequential 2,000 + 500 requests with progress; Hủy kiểm tra discards the in-flight answer; rerun merges.
    await open()
    // Typing 2,500 lines with fill() goes through Chromium's text insertion and is very slow: load a .txt file as customers do.
    const many = Array.from({ length: 2500 }, (_, i) => `090${String(i).padStart(7, '0')}`)
    await modal.locator('input[type=file][accept=".txt"]').setInputFiles({ name: '2500.txt', mimeType: 'text/plain', buffer: Buffer.from(many.join('\n')) })
    await page.waitForFunction(() => document.querySelector('#campaign-import-textbox')?.value.split('\n').length === 2500)
    await current().check()
    await setFixture({ mode: 'delay' })
    await checkButton.click()
    await page.waitForFunction(() => window.dupSmoke.state.pending.length === 1)
    const progress = modal.locator('.campaign-import-dedup-progress')
    assert.match(await progress.innerText(), /0\/2\.500 số/)
    assert.equal(await progress.getByRole('progressbar').getAttribute('aria-valuemax'), '2500')
    assert.equal(await modal.locator('.modal-footer .btn-ghost').isDisabled(), false, 'the modal can be closed while checking')
    await smoke(() => window.dupSmoke.state.pending.shift()())
    await page.waitForFunction(() => window.dupSmoke.state.pending.length === 1)
    assert.match(await progress.innerText(), /2\.000\/2\.500 số/)
    assert.equal(await progress.getByRole('progressbar').getAttribute('aria-valuenow'), '2000')
    await progress.getByRole('button', { name: 'Hủy kiểm tra' }).click()
    await progress.waitFor({ state: 'detached' })
    await smoke(() => window.dupSmoke.state.pending.shift()())
    await settle()
    assert.equal(await results.count(), 0)
    assert.equal(await checkButton.isDisabled(), false)
    assert.deepEqual((await state()).calls.map(call => call.request.phones.length), [2000, 500])
    await smoke(() => {
      const s = window.dupSmoke.state, latest = s.known['0912345678'].latest
      s.known['0900000005'] = { matchCount: 1, campaignCount: 1, latest: { ...latest, campaignName: 'Chiến dịch cũ', campaignDeleted: true } }
      s.known['0900002100'] = { matchCount: 1, campaignCount: 1, latest: { ...latest, status: 'đang chạy', processed: false } }
    })
    await setFixture({ mode: 'ok' })
    await check()
    s = await state()
    assert.deepEqual(s.calls.slice(2).map(call => call.request.phones.length), [2000, 500])
    assert.equal(s.calls[3].request.phones[0], '0900002000')
    assert.deepEqual(await counts(), [2498, 2, 0, 0])
    const existingRows = await table.locator('tbody tr').allInnerTexts()
    assert.equal(existingRows.length, 2)
    assert.match(existingRows[0], /0900000005[\s\S]*Chiến dịch cũ \(đã xóa\)[\s\S]*Đã chạy · chiến dịch đã xóa/)
    assert.match(existingRows[1], /0900002100[\s\S]*Đang chạy/)
    ok('2,500 numbers → 2,000 + 500 sequential requests with progress; cancel discards the late answer; results merged')

    // 9. Template tab: with dedup active the template waits for "Kiểm tra dữ liệu"; back to "Chỉ trong file này" it verifies at once.
    await open()
    await current().check()
    await modal.getByRole('tab', { name: 'Từ template Excel akaBiz', exact: true }).click()
    await modal.locator('#campaign-import-akabiz-template-file').setInputFiles(xlsxFile([templateHeaders, ['An', '', '0912345678'], ['Bình', '', '0987654321']]))
    await modal.locator('.campaign-import-template-status.success').waitFor()
    assert.equal(await results.count(), 0)
    await check()
    assert.deepEqual((await state()).calls.at(-1).request.phones, ['0912345678', '0987654321'])
    assert.deepEqual(await counts(), [1, 1, 0, 0])
    await fileOnly().check()
    await results.waitFor()
    assert.deepEqual(await counts(), [2, 0, 0])
    assert.equal(await checkButton.count(), 0)
    ok('template tab waits for the check while dedup is active; switching back verifies immediately in-file only')

    // 10. Gate: switch off, admin-only (non-admin vs admin), read error, unsupported campaign type, caller without duplicateCheck.
    await setFixture({ setting: { ok: true, data: { audience: 'off', defaultDays: 30, maxDays: 365 } } })
    await open()
    assert.equal(await dedup.count(), 0)
    await setFixture({ setting: { ok: true, data: { audience: 'admin_akabiz', defaultDays: 30, maxDays: 365 } } })
    await open()
    assert.equal(await dedup.count(), 0)
    await smoke(() => window.dupSmoke.admin(true))
    await dedup.waitFor()
    await smoke(() => window.dupSmoke.admin(false))
    await dedup.waitFor({ state: 'detached' })
    await setFixture({ setting: { ok: false, code: 'session_invalid', message: 'Phiên đăng nhập đã hết hạn.' } })
    await open()
    assert.equal(await dedup.count(), 0)
    await setFixture({ setting: { ok: true, data: { audience: 'all', defaultDays: 30, maxDays: 365 } } })
    const before = (await state()).settingCalls
    await open({ actionId: 'zalo_add_group_member' }, false)
    await open({ check: null }, false)
    assert.equal(await dedup.count(), 0)
    assert.equal((await state()).settingCalls, before, 'no switch read for unsupported types or callers without duplicateCheck')
    await open()
    await dedup.waitFor()
    ok('hidden when off / admin-only for a non-admin / read error; no read for other types or data-group style callers')

    // 11. Form note: changing accounts after "Với tài khoản đang chọn" warns; Kiểm tra lại → confirm → rows removed, note updated.
    await smoke(() => window.dupSmoke.note({ scope: 'current', days: 30, accountIds: [11], checkedAt: '2026-11-10T15:30:00Z', since: '2026-10-11T17:00:00Z', skipped: 2 }, [11]))
    const note = page.locator('.campaign-import-dedup-form-note')
    const warning = page.locator('.campaign-import-dedup-form-warning')
    const noteState = async () => JSON.parse(await page.locator('#note-state').innerText())
    await note.waitFor()
    assert.match(await note.innerText(), /Đã lọc trùng với dữ liệu 30 ngày của 1 tài khoản đang chọn lúc 22:30 · bỏ qua 2 số đã có ở chiến dịch khác\./)
    assert.equal(await warning.count(), 0)
    await smoke(() => window.dupSmoke.accounts([12, 11]))
    await warning.waitFor()
    assert.match(await warning.innerText(), /Danh sách chưa được đối chiếu với tài khoản đang chọn hiện tại\./)
    await warning.getByRole('button', { name: 'Kiểm tra lại' }).click()
    await page.waitForFunction(() => window.dupSmoke.state.confirms.length === 1)
    s = await state()
    assert.deepEqual(s.calls.map(call => call.request), [{ actionId: 'zalo_message_phone', accountIds: [12, 11], days: 30, phones: ['0912345678', '0987654321'], excludeCampaignId: null }])
    assert.equal(s.confirms[0].message, '1 số trong danh sách đã có ở chiến dịch khác của các tài khoản đang chọn trong 30 ngày. Bỏ các số này khỏi danh sách?')
    assert.deepEqual(s.confirms[0].options, { title: 'Kiểm tra lại trùng dữ liệu', confirmText: 'Bỏ 1 số', cancelText: 'Giữ nguyên' })
    assert.equal(await warning.count(), 1, 'nothing changes until the customer confirms')
    await smoke(() => window.dupSmoke.state.confirms[0].onConfirm())
    await warning.waitFor({ state: 'detached' })
    let ns = await noteState()
    assert.deepEqual(ns.phones, ['0987654321', null, 'bad'])
    assert.deepEqual(ns.note, { scope: 'current', days: 30, accountIds: [12, 11], checkedAt: '2026-11-10T15:30:00Z', since: '2026-10-27T17:00:00Z', skipped: 3 })
    assert.deepEqual((await state()).alerts.at(-1), { message: 'Đã bỏ 1 số đã có ở chiến dịch khác.', type: 'success' })
    await smoke(() => window.dupSmoke.accounts([13]))
    await warning.waitFor()
    await warning.getByRole('button', { name: 'Để sau' }).click()
    await warning.waitFor({ state: 'detached' })
    await smoke(() => window.dupSmoke.accounts([12]))
    await warning.waitFor()
    await warning.getByRole('button', { name: 'Kiểm tra lại' }).click()
    await page.waitForFunction(() => window.dupSmoke.state.alerts.length >= 2)
    assert.deepEqual((await state()).alerts.at(-1), { message: 'Không có số nào đã có ở chiến dịch của các tài khoản đang chọn.', type: 'success' })
    await warning.waitFor({ state: 'detached' })
    ns = await noteState()
    assert.deepEqual(ns.note.accountIds, [12]); assert.equal(ns.note.skipped, 3)
    await setFixture({ mode: 'fail' })
    await smoke(() => window.dupSmoke.accounts([16]))
    await warning.getByRole('button', { name: 'Kiểm tra lại' }).click()
    await page.waitForFunction(() => window.dupSmoke.state.alerts.some(alert => alert.type === 'error'))
    assert.equal((await state()).alerts.at(-1).message, 'Hệ thống chưa đối chiếu được dữ liệu.')
    assert.deepEqual((await noteState()).note.accountIds, [12])
    assert.equal(await warning.count(), 1)
    await setFixture({ mode: 'ok' })
    await smoke(() => window.dupSmoke.note({ scope: 'picked', days: 14, accountIds: [11, 12], checkedAt: '2026-11-10T15:30:00Z', since: '2026-10-27T17:00:00Z', skipped: 1 }, [13]))
    await note.waitFor()
    assert.match(await note.innerText(), /dữ liệu 14 ngày của 2 tài khoản Zalo/)
    assert.equal(await warning.count(), 0, 'picked accounts do not depend on the campaign accounts')
    ok('form note: warning after account change, Kiểm tra lại → confirm removes rows + updates note; Để sau; none found; failure; picked never warns')

    if (process.env.UI_SMOKE_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.UI_SMOKE_SCREENSHOT_DIR, { recursive: true })
      await open()
      await textarea.fill('0987654321\n0912345678\n0912345678\nbad')
      await picked().check()
      await check()
      await page.screenshot({ path: path.join(process.env.UI_SMOKE_SCREENSHOT_DIR, 'desktop-input-duplicates-results.png') })
      await insertButton.click(); await confirm.waitFor()
      await page.screenshot({ path: path.join(process.env.UI_SMOKE_SCREENSHOT_DIR, 'desktop-input-duplicates-confirm.png') })
    }

    assert.deepEqual(errors, [])
    console.log(`campaign input duplicates UI: ${passed}/${passed} passed`)
  } finally {
    if (app) await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => {
  // Playwright call logs echo the filled text; keep the head (what failed) and the tail (why it waited).
  const text = String(error && error.stack || error).replace(/\n(?:\u001b\[2m)?09\d{8}(?:\u001b\[22m)?(?=\n)/g, '')
  console.error(text.length > 4000 ? `${text.slice(0, 1500)}\n...\n${text.slice(-2500)}` : text)
  process.exitCode = 1
})

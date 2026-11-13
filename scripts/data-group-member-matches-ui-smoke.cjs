// Real Electron UI of the Desktop data-group import window with "Bỏ data đã có trong nhóm này / ở nhóm data khác"
// (V519 via V522) and a local IPC fixture; never connects to any service.
// Covers: switch gate, two checkboxes, group picker (lazy load), chunked sequential requests, cancel, failure
// (Thử lại / Thêm không đối chiếu), silent fallback when the reader is not ready, result groups + Excel, confirmation,
// dataset name of a filtered file, template tab (check at submit), member step before the campaign step, UID lists.
// Run: node scripts/data-group-member-matches-ui-smoke.cjs (as root in the cloud container: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node ...)
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
import Manager from './src/renderer/src/components/DataScan/DataGroupManagerModal';
import {useUiStore} from './src/renderer/src/stores/uiStore';
import {useAuthStore} from './src/renderer/src/stores/authStore';
import {useCampaignStore} from './src/renderer/src/stores/campaignStore';
import './src/renderer/src/styles/global.css';
const clone=v=>JSON.parse(JSON.stringify(v));
const OTHER={id:44,name:'Khách đã mua',addedAt:'2026-11-01T03:00:00Z'};
const latest={campaignId:77,campaignName:'Khách cũ tháng 10',campaignDeleted:false,accountId:12,accountName:'Zalo Bán hàng',uploadedAt:'2026-11-07T03:15:00Z',status:'hoàn thành',processed:true};
const state={alerts:[],exports:[],submitted:null,memberCalls:[],campaignCalls:[],settingCalls:0,groupLoads:0,mode:'ok',pending:[],
  setting:{ok:true,data:{enabled:true}},groups:[{id:44,name:'Khách đã mua',memberCount:1200},{id:45,name:'Đã chăm sóc tháng 10',memberCount:80},{id:46,name:'Khách Hà Nội',memberCount:5}],groupsPartial:false,
  // Định danh đã có: SĐT đã chuẩn hóa, UID hoặc link. inGroup = có trong nhóm đang nhập; other = số nhóm khác có nó.
  known:{'0912000001':{inGroup:true,other:0},'0912000002':{inGroup:true,other:1},'0912000003':{inGroup:false,other:2},'2254071234567890123':{inGroup:true,other:0},'https://zalo.me/g/abc123':{inGroup:false,other:1}},
  campaignKnown:{'0912000004':{matchCount:1,campaignCount:1,latest}}};
const norm=v=>String(v).replace(/^\\+84/,'0').replace(/\\s+/g,'');
const answer=r=>{const scoped=r.otherGroups==='none'?()=>0:Array.isArray(r.otherGroups)?n=>Math.min(n,r.otherGroups.length):n=>n;
  const items=[];r.values.forEach((value,index)=>{const hit=state.known[norm(value)];if(!hit)return;const other=scoped(hit.other);
    if(hit.inGroup||other>0)items.push({index,inGroup:hit.inGroup,otherGroupCount:other,otherGroup:other>0?clone(OTHER):null})});
  return {ok:true,data:{checkedAt:'2026-11-13T03:42:00Z',valueCount:r.values.length,items}}};
window.electronAPI={
  dataGroupMemberMatches:async request=>{
    if(request.kind==='setting'){state.settingCalls++;return clone(state.setting)}
    state.memberCalls.push(clone(request));
    if(state.mode==='fail')return {ok:false,code:'data_group_matches_unavailable',message:'Chưa đối chiếu được với data đã có trong nhóm. Vui lòng thử lại.'};
    if(state.mode==='notReady')return {ok:false,code:'data_group_matches_not_ready',message:'Đối chiếu với data đã có trong nhóm đang được cập nhật.'};
    if(state.mode==='delay')return new Promise(resolve=>state.pending.push(()=>resolve(answer(request.request))));
    return answer(request.request)},
  campaignInputDuplicates:async request=>{
    if(request.kind==='setting')return {ok:true,data:{audience:'all',defaultDays:30,maxDays:365}};
    state.campaignCalls.push(clone(request));
    const r=request.request;
    return {ok:true,data:{checkedAt:'2026-11-13T03:43:00Z',since:'2026-10-13T17:00:00Z',days:r.days,accountCount:r.accountIds.length,phoneCount:r.phones.length,
      items:r.phones.filter(p=>state.campaignKnown[p]).map(p=>({phone:p,...clone(state.campaignKnown[p])}))}}}};
// Cửa sổ "Quản lý nhóm data" thật (ca 13): IPC giả tối thiểu để cửa sổ dựng được và nhận lượt nạp.
const types=[{id:103,code:'phone',name:'Số điện thoại'},{id:101,code:'zalo_person',name:'Zalo · User theo UID'}];
const group=(id,name,extra={})=>({id,name,color:'#10b981',revision:1,dataTypeCode:'phone',dataTypeName:'Số điện thoại',dataTypeCategoryItemId:103,boundZaloAccountId:null,boundZaloAccountName:null,activeMembershipCount:2,isDelete:false,datasetSyncMode:'manual',...extra});
const managerGroups=[group(31,'Khách tháng 11'),group(44,'Khách đã mua',{activeMembershipCount:1200}),group(45,'Nhóm được chia sẻ',{access:{role:'shared'}}),group(46,'Khách Hà Nội',{activeMembershipCount:5})];
state.groupQueries=[];state.ingests=[];
Object.assign(window.electronAPI,{
  listAccounts:async()=>[],listDataTypeCategoryItems:async()=>types,
  getDataGroupAccountOptions:async()=>[{accountId:null,accountName:'Không gắn tài khoản',disabledReason:null}],
  listDataGroups:async(query={})=>{state.groupQueries.push(clone(query));const list=managerGroups.filter(g=>!query.ownedOnly||g.access?.role!=='shared');
    const offset=query.offset||0;return {groups:clone(list.slice(offset,offset+(query.limit||50))),total:list.length}},
  listDataGroupMembers:async()=>({members:[],total:0}),listDataGroupDatasets:async()=>[],getDataGroupLatestIngestStats:async()=>({}),
  getDataGroupPanel:async id=>({group:{...managerGroups.find(g=>g.id===id),creatorName:'Người kiểm thử'},summary:{activeMembershipCount:2,runCount:0,campaignCount:0},quality:{withLinkCount:0,withPhoneCount:2,withUidCount:0,duplicateCount:0},sourceBreakdown:[],dataTypeBreakdown:[],accountBreakdown:[],tags:[],history:[],campaigns:[]}),
  getDataGroupDynamicFilter:async id=>({groupId:id,boundZaloAccountId:null,isEnabled:false,revision:1,matchedCount:0,lastEnteredCount:0,lastExitedCount:0,rules:[],catalog:{fields:[],operators:[],scopes:[],joins:[]},values:[],accounts:[]}),
  ingestDataGroup:async request=>{state.ingests.push(clone(request));return {requestId:request.requestId,groupId:request.groupId,groupRevision:2,insertedMembershipCount:request.rows.length,reactivatedMembershipCount:0,
    alreadyMemberCount:0,insertedInputCount:0,alreadySeenInputCount:0,incompatibleCount:0,conflictCount:0,invalidCount:0,conflicts:[]}}});
useUiStore.setState({showAlert:(message,type)=>state.alerts.push({message,type})});
useAuthStore.setState({user:{staffId:7,organizationId:9,isAdminAkabiz:false}});
useCampaignStore.setState({accounts:[{id:11,name:'Zalo CSKH',flatformType:'zalo',isDelete:false,accountGroupName:'CSKH',isZaloShowWeb:false,isZaloServer:false}],loadAccounts:async()=>{}});
const TARGETS={phone:{actionId:'zalo_message_phone',contactType:'phone'},uid:{actionId:'data_group_zalo_person_uid',contactType:'person'},link:{actionId:'zalo_join_group_link',contactType:'group'}};
function App(){
  const [view,setView]=useState({kind:'closed',key:0});
  window.groupSmoke={state,
    open:(o={})=>{state.alerts=[];state.exports=[];state.submitted=null;state.memberCalls=[];state.campaignCalls=[];state.pending=[];
      setView(v=>({kind:'upload',key:v.key+1,target:o.target||'phone',member:o.member!==false,bound:Boolean(o.bound),campaign:o.campaign!==false}))},
    manager:()=>{state.alerts=[];state.memberCalls=[];state.campaignCalls=[];state.groupQueries=[];state.ingests=[];setView(v=>({kind:'manager',key:v.key+1}))},
    captureExport:(book,name)=>state.exports.push({book,name})};
  if(view.kind==='closed')return <div id="closed">Đã đóng</div>;
  if(view.kind==='manager')return <Manager key={view.key} initialGroupId={31} onClose={()=>{}}/>;
  const target=TARGETS[view.target];
  const memberCheck=view.member?{groupId:31,contactType:target.contactType,loadOtherGroups:async()=>{state.groupLoads++;return {groups:clone(state.groups),partial:state.groupsPartial}}}:undefined;
  const destination={kind:'dataGroup',name:'Khách tháng 11',skipsExistingMembers:view.bound,memberCheck,
    duplicateNote:!memberCheck?'hệ thống bỏ dòng lặp trong file. Loại data này chưa đối chiếu được với data đã có trong nhóm.'
      :view.bound?'hệ thống bỏ dòng lặp trong file và data đã có trong nhóm.'
      :'hệ thống bỏ dòng lặp trong file. Nhóm không gắn tài khoản Zalo nên data đã có trong nhóm từ lần nhập khác vẫn được thêm thành dòng mới.'};
  const duplicateCheck=view.campaign&&target.contactType==='phone'?{currentAccounts:view.bound?[{id:11,name:'Zalo CSKH'}]:[]}:undefined;
  return <Upload key={view.key} platform="zalo" actionId={target.actionId} accountIds={[]} title="Thêm data từ file" showDatasetName={false} layout="data-group"
    submitLabel="Thêm vào nhóm" duplicateCheck={duplicateCheck} destination={destination}
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-group-matches-ui-'))
  let app
  try {
    await build({
      stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: harness }, outfile: path.join(dir, 'app.js'), bundle: true, platform: 'browser',
      format: 'iife', jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning',
      plugins: [{ name: 'capture-export', setup(b) {
        b.onLoad({ filter: /CampaignDataUploadModal\.tsx$/ }, args => {
          const source = fs.readFileSync(args.path, 'utf8')
          assert.equal(source.split('writeFile(book,').length, 2, 'expected exactly one writeFile(book, call')
          return { loader: 'tsx', contents: source.replace('writeFile(book,', ';(window as any).groupSmoke.captureExport(book,') }
        })
      } }]
    })
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body><div id="root"></div><script src="app.js"></script></body></html>')
    const show = process.env.AKA_UI_SMOKE_SHOW === '1'
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:${show},width:1500,height:1200,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,c)=>c({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir, 'index.html'))})})`)
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
      const s = window.groupSmoke.state
      return { alerts: s.alerts, memberCalls: s.memberCalls, campaignCalls: s.campaignCalls, settingCalls: s.settingCalls, groupLoads: s.groupLoads,
        submitted: s.submitted, exportCount: s.exports.length, pending: s.pending.length, groupQueries: s.groupQueries, ingests: s.ingests }
    })
    const settle = () => smoke(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => setTimeout(resolve, 0)), 0))))
    const setFixture = patch => smoke(p => Object.assign(window.groupSmoke.state, p), patch)
    const modal = page.locator('.campaign-import-modal')
    const dedup = modal.locator('fieldset.campaign-import-dedup')
    const results = modal.locator('.campaign-import-results')
    const textarea = modal.locator('textarea')
    const inGroupBox = dedup.getByRole('checkbox', { name: /^Bỏ data đã có trong nhóm này/ })
    const otherBox = dedup.getByRole('checkbox', { name: /^Bỏ data đã có ở nhóm data khác/ })
    const pickGroupsButton = dedup.getByRole('button', { name: /Chọn nhóm/ })
    const radio = name => dedup.getByRole('radio', { name })
    const checkButton = modal.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true })
    const insertButton = modal.locator('.modal-footer .btn-primary')
    const footerHint = modal.locator('.modal-footer .campaign-import-submit-hint')
    const counts = async () => (await modal.locator('.campaign-import-result-group strong').allTextContents()).map(text => Number(text.replace(/\D/g, '')))
    const groupLabels = async () => modal.locator('.campaign-import-result-group > button:first-child span').allTextContents()
    const picker = page.getByRole('dialog', { name: 'Chọn nhóm data để đối chiếu' })
    const confirm = page.getByRole('alertdialog', { name: 'Xác nhận thêm vào nhóm' })
    const failure = modal.locator('.campaign-import-dedup-error')
    const open = async (options = {}) => {
      const before = (await state()).settingCalls
      await smoke(o => window.groupSmoke.open(o), options)
      await textarea.waitFor()
      if (options.member !== false) await page.waitForFunction(n => window.groupSmoke.state.settingCalls > n, before)
      await settle()
    }
    const check = async () => { await checkButton.click(); await results.waitFor() }
    const exportedSheet = async index => {
      const exported = (await smoke(() => window.groupSmoke.state.exports))[index]
      const book = XLSX.read(XLSX.write(exported.book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
      return { name: exported.name, sheetNames: book.SheetNames, rows: XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: false, defval: '' }) }
    }

    // 1. Unbound phone group: two sections; "trong nhóm này" on by default, "nhóm khác" off; one switch read; no request before a click.
    await open()
    await dedup.waitFor()
    assert.equal((await state()).settingCalls, 1)
    assert.deepEqual(await dedup.locator('.campaign-import-dedup-section').allInnerTexts(), ['Với nhóm data', 'Với chiến dịch nhắn tin'])
    assert(await inGroupBox.isChecked()); assert.equal(await otherBox.isChecked(), false)
    assert.match(await dedup.innerText(), /Data đã có trong nhóm “Khách tháng 11” không được thêm lần nữa/)
    assert.equal(await radio(/tài khoản gắn với nhóm/).count(), 0, 'no bound account: option 2 hidden')
    assert(await radio(/Chỉ trong file này/).isChecked())
    assert.equal(await pickGroupsButton.count(), 0)
    assert.equal(await footerHint.innerText(), 'Kiểm tra dữ liệu để xem kết quả trước khi thêm.')
    await textarea.fill('0912000001\n+84 912 000 002\n0912000003\n0912000009\n0912000009\nbad')
    assert.equal((await state()).memberCalls.length, 0)
    await check()
    let s = await state()
    assert.deepEqual(s.memberCalls, [{ kind: 'check', groupId: 31, request: { contactType: 'phone', values: ['0912000001', '0912000002', '0912000003', '0912000009'], otherGroups: 'none' } }])
    assert.equal(s.campaignCalls.length, 0)
    assert.deepEqual(await groupLabels(), ['Hợp lệ', 'Đã có trong nhóm này', 'Lỗi/bị loại', 'Trùng'])
    assert.deepEqual(await counts(), [2, 2, 1, 1])
    assert.equal(await modal.getByRole('button', { name: 'Dữ liệu đã có trong nhóm này: 2' }).getAttribute('aria-pressed'), 'true')
    assert.match(await results.innerText(), /Đã đối chiếu với data trong nhóm này lúc 10:42\./)
    assert.equal(await footerHint.innerText(), 'Sẽ thêm 2 số mới vào nhóm · bỏ qua 2 đã có trong nhóm này.')
    assert.deepEqual(s.alerts.at(-1), { message: 'Đã kiểm tra: 2 hợp lệ · 1 lỗi/bị loại · 1 trùng · 2 đã có trong nhóm này.', type: 'success' })
    ok('phone group: both sections, defaults, one member request on "Kiểm tra dữ liệu" with normalized valid rows, result group + hint')

    // 2. Confirmation names the group; pasted rows are additive ("manual"), so the list keeps its name; submission carries the summary.
    await insertButton.click()
    await confirm.waitFor()
    let confirmText = await confirm.innerText()
    assert.equal(await confirm.locator('.campaign-import-confirm-total strong').innerText(), '2')
    for (const pattern of [/số mới sẽ được thêm vào nhóm “Khách tháng 11”/, /Sẽ bỏ qua 4 số/, /2 số đã có trong nhóm này/, /1 số trùng trong file/, /1 dòng lỗi\/bị loại/,
      /Data đã có trong nhóm từ các lần nhập trước được giữ nguyên, không bị gỡ/, /Kết quả đối chiếu với nhóm data lúc 10:42/]) assert.match(confirmText, pattern)
    assert.doesNotMatch(confirmText, /Lưu thành danh sách mới/)
    await confirm.getByRole('button', { name: 'Quay lại' }).click()
    await confirm.waitFor({ state: 'detached' })
    assert.equal((await state()).submitted, null)
    await insertButton.click(); await confirm.waitFor()
    await confirm.getByRole('button', { name: 'Thêm 2 số' }).click()
    await page.locator('#closed').waitFor()
    s = await state()
    assert.equal(s.submitted.datasetName, 'Nhập thủ công')
    assert.equal(s.submitted.importSource, 'textbox')
    assert.deepEqual(s.submitted.rows.map(row => row.phone), ['0912000003', '0912000009'])
    assert.deepEqual(s.submitted.members, { checkedAt: '2026-11-13T03:42:00Z', inGroup: 2, otherGroups: 0 })
    assert.equal('duplicates' in s.submitted, false)
    ok('confirmation lists what is skipped; Quay lại sends nothing; submission = new rows + member summary, pasted list keeps its name')

    // 3. "Nhóm khác": changing an option invalidates the result; all other groups by default; table columns and Excel of both groups.
    await open()
    await textarea.fill('0912000001\n+84 912 000 002\n0912000003\n0912000009')
    await check()
    await otherBox.check()
    assert.equal(await results.count(), 0, 'changing the option invalidates the previous result')
    assert.match(await pickGroupsButton.innerText(), /Chọn nhóm · tất cả/)
    assert.match(await dedup.innerText(), /Tất cả nhóm data khác của bạn/)
    assert.equal((await state()).groupLoads, 0, 'group list is loaded only when the picker opens')
    await check()
    s = await state()
    assert.equal(s.memberCalls.at(-1).request.otherGroups, 'all')
    assert.deepEqual(await groupLabels(), ['Hợp lệ', 'Đã có trong nhóm này', 'Đã có ở nhóm khác', 'Lỗi/bị loại', 'Trùng'])
    assert.deepEqual(await counts(), [1, 2, 1, 0, 0])
    assert.match(await modal.locator('.campaign-import-result-groups').getAttribute('class'), /has-many/)
    assert.match(await results.innerText(), /Đã đối chiếu với data trong nhóm này và ở tất cả nhóm khác của bạn lúc 10:42\./)
    await modal.getByRole('button', { name: 'Dữ liệu đã có ở nhóm data khác: 1' }).click()
    const table = modal.locator('.campaign-import-preview-table')
    assert.match(await table.locator('thead').innerText(), /Đã có ở nhóm\s+Ngày vào nhóm/)
    const row = await table.locator('tbody tr').first().innerText()
    for (const text of ['0912000003', 'Khách đã mua · +1 nhóm', '01/11/2026']) assert(row.includes(text), `${text} missing in ${row}`)
    await modal.getByRole('button', { name: 'Tải Excel Dữ liệu đã có ở nhóm data khác', exact: true }).click()
    await modal.getByRole('button', { name: 'Tải Excel Dữ liệu đã có trong nhóm này', exact: true }).click()
    let sheet = await exportedSheet(0)
    assert.match(sheet.name, /^du-lieu-da-co-o-nhom-khac-.*\.xlsx$/)
    assert.deepEqual(sheet.sheetNames, ['Đã có ở nhóm khác'])
    assert.deepEqual(sheet.rows[0].slice(13), ['Đã có ở nhóm (gần nhất)', 'Ngày vào nhóm', 'Số nhóm khác có data này'])
    assert.equal(sheet.rows[1][2], '0912000003'); assert.deepEqual(sheet.rows[1].slice(13), ['Khách đã mua', '01/11/2026 10:00', '2'])
    sheet = await exportedSheet(1)
    assert.match(sheet.name, /^du-lieu-da-co-trong-nhom-nay-.*\.xlsx$/)
    assert.equal(sheet.rows.length, 3); assert.equal(sheet.rows[0].length, 13)
    assert.equal(await footerHint.innerText(), 'Sẽ thêm 1 số mới vào nhóm · bỏ qua 2 đã có trong nhóm này, 1 đã có ở nhóm khác.')
    ok('"nhóm khác": all groups by default, in-group wins over other groups, extra columns in the table and Excel')

    // 4. Group picker: loaded when opened, accent-free search, Hủy discards, Xong sends the picked ids; all picked = "tất cả".
    await pickGroupsButton.click()
    await picker.waitFor()
    await picker.locator('.input-dup-picker-account').first().waitFor()
    assert.equal((await state()).groupLoads, 1)
    const zIndex = selector => smoke(sel => Number(getComputedStyle(document.querySelector(sel)).zIndex), selector)
    assert(await zIndex('.modal-overlay:has(.input-dup-picker)') > await zIndex('.modal-overlay:has(.campaign-import-modal)'))
    assert.match(await picker.getByRole('status').first().innerText(), /3\/3/)
    assert.deepEqual(await picker.locator('.input-dup-picker-account-name strong').allInnerTexts(), ['Khách đã mua', 'Đã chăm sóc tháng 10', 'Khách Hà Nội'])
    assert.match(await picker.locator('.input-dup-picker-account-name > span').first().innerText(), /1\.200 data/)
    const search = picker.getByRole('searchbox', { name: 'Tìm nhóm data' })
    await search.fill('ha noi')
    assert.deepEqual(await picker.locator('.input-dup-picker-account-name strong').allInnerTexts(), ['Khách Hà Nội'])
    await search.fill('')
    await picker.getByRole('button', { name: 'Bỏ chọn tất cả' }).click()
    assert(await picker.getByRole('button', { name: 'Chọn ít nhất 1 nhóm' }).isDisabled())
    await picker.getByRole('button', { name: 'Hủy' }).click(); await picker.waitFor({ state: 'detached' })
    assert.match(await pickGroupsButton.innerText(), /tất cả/)
    assert.equal(await results.count(), 1, 'Hủy keeps the result')
    await pickGroupsButton.click(); await picker.waitFor(); await picker.locator('.input-dup-picker-account').first().waitFor()
    await picker.getByRole('checkbox', { name: /^Khách đã mua/ }).uncheck()
    await picker.getByRole('button', { name: 'Xong · 2 nhóm' }).click()
    await picker.waitFor({ state: 'detached' })
    assert.match(await pickGroupsButton.innerText(), /Chọn nhóm · 2 nhóm/)
    assert.match(await dedup.innerText(), /Đã chăm sóc tháng 10, Khách Hà Nội/)
    assert.equal(await results.count(), 0)
    await check()
    assert.deepEqual((await state()).memberCalls.at(-1).request.otherGroups, [45, 46])
    assert.match(await results.innerText(), /ở 2 nhóm khác đã chọn/)
    await pickGroupsButton.click(); await picker.waitFor(); await picker.locator('.input-dup-picker-account').first().waitFor()
    await picker.getByRole('button', { name: 'Chọn tất cả', exact: true }).click()
    await picker.getByRole('button', { name: 'Xong · tất cả 3 nhóm' }).click()
    await picker.waitFor({ state: 'detached' })
    assert.match(await pickGroupsButton.innerText(), /tất cả/)
    await setFixture({ groupsPartial: true })
    await pickGroupsButton.click(); await picker.waitFor(); await picker.locator('.input-dup-picker-account').first().waitFor()
    assert.match(await picker.innerText(), /Bạn có nhiều nhóm hơn danh sách này/)
    await picker.getByRole('button', { name: 'Xong · 3 nhóm' }).click()
    await picker.waitFor({ state: 'detached' })
    assert.match(await pickGroupsButton.innerText(), /Chọn nhóm · 3 nhóm/, 'a partial list never means "all other groups"')
    await setFixture({ groupsPartial: false })
    ok('picker: lazy load, search, Hủy discards, Xong sends ids; full list = "tất cả", partial list stays an explicit selection')

    // 5. File: rows were filtered → the rest is saved under a new list name (DB would otherwise remove members of the old list).
    await open()
    await modal.getByRole('tab', { name: 'File Excel/CSV của khách hàng', exact: true }).click()
    await modal.locator('input[type=file][accept=".xlsx,.xls,.csv"]').last().setInputFiles(xlsxFile([['Tên', 'Số điện thoại'], ['An', '0912000001'], ['Bình', '0912000009'], ['Chi', '0912000008']], 'khach.xlsx'))
    await modal.locator('.campaign-import-table-options').waitFor()
    await check()
    assert.deepEqual(await counts(), [2, 1, 0, 0])
    await insertButton.click(); await confirm.waitFor()
    confirmText = await confirm.innerText()
    assert.match(confirmText, /Lưu thành danh sách mới/)
    assert.match(confirmText, /khach\.xlsx · đã lọc trùng 13\/11 10:42/)
    await confirm.getByRole('button', { name: 'Thêm 2 số' }).click()
    await page.locator('#closed').waitFor()
    s = await state()
    assert.equal(s.submitted.datasetName, 'khach.xlsx · đã lọc trùng 13/11 10:42')
    assert.equal(s.submitted.importSource, 'excel')
    assert.deepEqual(s.submitted.rows.map(item => item.phone), ['0912000009', '0912000008'])
    // Nothing filtered: the file keeps its name and is added without a confirmation.
    await open()
    await modal.getByRole('tab', { name: 'File Excel/CSV của khách hàng', exact: true }).click()
    await modal.locator('input[type=file][accept=".xlsx,.xls,.csv"]').last().setInputFiles(xlsxFile([['Tên', 'Số điện thoại'], ['Bình', '0912000009'], ['Chi', '0912000008']], 'khach.xlsx'))
    await modal.locator('.campaign-import-table-options').waitFor()
    await check()
    assert.deepEqual(await counts(), [2, 0, 0, 0])
    assert.equal(await footerHint.innerText(), 'Sẽ thêm 2 dữ liệu hợp lệ vào nhóm.')
    await insertButton.click()
    await page.locator('#closed').waitFor()
    s = await state()
    assert.equal(s.submitted.datasetName, 'khach.xlsx')
    assert.deepEqual(s.submitted.members, { checkedAt: '2026-11-13T03:42:00Z', inGroup: 0, otherGroups: 0 })
    ok('file with filtered rows is saved as "<file> · đã lọc trùng dd/mm HH:MM"; nothing filtered keeps the name and needs no confirmation')

    // 6. Template tab verifies locally; the member check runs when "Thêm vào nhóm" is pressed (confirm only if rows were dropped).
    await open()
    await modal.getByRole('tab', { name: 'Từ template Excel akaBiz', exact: true }).click()
    await modal.locator('#campaign-import-akabiz-template-file').setInputFiles(xlsxFile([templateHeaders, ['An', '', '0912000001'], ['Bình', '', '0912000009']], 'mau.xlsx'))
    await results.waitFor()
    assert.equal((await state()).memberCalls.length, 0)
    assert.match(await results.innerText(), /Chưa đối chiếu với data đã có trong nhóm\./)
    assert.equal(await footerHint.innerText(), 'Bấm “Thêm vào nhóm” để đối chiếu 2 dữ liệu hợp lệ với data đã có trong nhóm rồi thêm.')
    assert.equal(await checkButton.count(), 1, 'the template tab offers "Kiểm tra dữ liệu" while a member option is on')
    await insertButton.click()
    await confirm.waitFor()
    assert.equal((await state()).memberCalls.length, 1)
    assert.equal((await state()).submitted, null)
    assert.match(await confirm.innerText(), /mau\.xlsx · đã lọc trùng 13\/11 10:42/)
    await confirm.getByRole('button', { name: 'Thêm 1 số' }).click()
    await page.locator('#closed').waitFor()
    assert.deepEqual((await state()).submitted.rows.map(item => item.phone), ['0912000009'])
    await open()
    await modal.getByRole('tab', { name: 'Từ template Excel akaBiz', exact: true }).click()
    await modal.locator('#campaign-import-akabiz-template-file').setInputFiles(xlsxFile([templateHeaders, ['Bình', '', '0912000009']], 'mau.xlsx'))
    await results.waitFor()
    await insertButton.click()
    await page.locator('#closed').waitFor()
    s = await state()
    assert.equal(s.memberCalls.length, 1); assert.equal(s.submitted.datasetName, 'mau.xlsx')
    // Both options off: the template is added as before, no request.
    await open()
    await inGroupBox.uncheck()
    await modal.getByRole('tab', { name: 'Từ template Excel akaBiz', exact: true }).click()
    await modal.locator('#campaign-import-akabiz-template-file').setInputFiles(xlsxFile([templateHeaders, ['An', '', '0912000001']], 'mau.xlsx'))
    await results.waitFor()
    assert.equal(await checkButton.count(), 0)
    await insertButton.click()
    await page.locator('#closed').waitFor()
    s = await state()
    assert.equal(s.memberCalls.length, 0); assert.equal('members' in s.submitted, false); assert.equal(s.submitted.rows.length, 1)
    ok('template: checked at submit, confirmation only when rows were dropped; both options off = no request, added as before')

    // 7. Reader not ready (no function / no grant / switch just turned off): silent fallback to the previous behaviour.
    await setFixture({ mode: 'notReady' })
    await open()
    await textarea.fill('0912000001\n0912000009')
    await check()
    assert.equal(await inGroupBox.count(), 0, 'the two options disappear')
    assert.equal(await failure.count(), 0)
    assert.deepEqual(await groupLabels(), ['Hợp lệ', 'Lỗi/bị loại', 'Trùng'])
    assert.deepEqual(await counts(), [2, 0, 0])
    assert.match(await dedup.innerText(), /Nhóm không gắn tài khoản Zalo: số đã có trong nhóm từ lần nhập khác vẫn được thêm thành dòng mới\./)
    await insertButton.click()
    await page.locator('#closed').waitFor()
    s = await state()
    assert.equal(s.memberCalls.length, 1); assert.equal('members' in s.submitted, false); assert.equal(s.submitted.rows.length, 2)
    ok('reader not ready: options hidden without an error, rows added as before, honest note about existing members')

    // 8. Other failures block the import: Thử lại re-checks, "Thêm không đối chiếu" adds without the member step.
    await setFixture({ mode: 'fail' })
    await open()
    await textarea.fill('0912000001\n0912000009')
    await checkButton.click()
    await failure.waitFor()
    assert.match(await failure.innerText(), /Chưa đối chiếu được với data đã có trong nhóm/)
    assert.match(await failure.innerText(), /Chưa có data nào được thêm vào nhóm\./)
    assert.equal(await results.count(), 0)
    assert(await insertButton.isDisabled())
    assert.equal(await footerHint.innerText(), 'Chưa đối chiếu được với data đã có trong nhóm. Thử lại hoặc chọn “Thêm không đối chiếu”.')
    await setFixture({ mode: 'ok' })
    await failure.getByRole('button', { name: 'Thử lại' }).click()
    await results.waitFor()
    assert.deepEqual(await counts(), [1, 1, 0, 0])
    await setFixture({ mode: 'fail' })
    await open()
    await textarea.fill('0912000001\n0912000009')
    await checkButton.click()
    await failure.waitFor()
    await failure.getByRole('button', { name: 'Thêm không đối chiếu' }).click()
    await results.waitFor()
    assert.deepEqual(await groupLabels(), ['Hợp lệ', 'Lỗi/bị loại', 'Trùng'])
    assert.equal(await footerHint.innerText(), 'Sẽ thêm 2 dữ liệu hợp lệ vào nhóm.')
    await insertButton.click()
    await page.locator('#closed').waitFor()
    s = await state()
    assert.equal(s.submitted.rows.length, 2); assert.equal('members' in s.submitted, false)
    await setFixture({ mode: 'ok' })
    ok('failure blocks the import; Thử lại re-checks; "Thêm không đối chiếu" adds every valid row without a summary')

    // 9. 2,500 rows: sequential 1,000 + 1,000 + 500 with progress; Hủy kiểm tra discards the in-flight answer; rerun maps indexes.
    await open()
    const many = Array.from({ length: 2500 }, (_, i) => i === 1500 ? '0912000001' : `090${String(i).padStart(7, '0')}`)
    await modal.locator('input[type=file][accept=".txt"]').setInputFiles({ name: '2500.txt', mimeType: 'text/plain', buffer: Buffer.from(many.join('\n')) })
    await page.waitForFunction(() => document.querySelector('#campaign-import-textbox')?.value.split('\n').length === 2500)
    await setFixture({ mode: 'delay' })
    await checkButton.click()
    await page.waitForFunction(() => window.groupSmoke.state.pending.length === 1)
    const progress = modal.locator('.campaign-import-dedup-progress')
    assert.match(await progress.innerText(), /Đang đối chiếu với data đã có trong nhóm 0\/2\.500 số/)
    assert.equal(await modal.locator('.modal-footer .btn-ghost').isDisabled(), false, 'the window can be closed while checking')
    await progress.getByRole('button', { name: 'Hủy kiểm tra' }).click()
    await smoke(() => window.groupSmoke.state.pending.splice(0).forEach(resolve => resolve()))
    await settle()
    assert.equal(await results.count(), 0); assert.equal(await progress.count(), 0)
    assert.equal((await state()).memberCalls.length, 1, 'no further chunk after cancel')
    await setFixture({ mode: 'ok', memberCalls: [] })
    await check()
    s = await state()
    assert.deepEqual(s.memberCalls.map(call => call.request.values.length), [1000, 1000, 500])
    assert.deepEqual(await counts(), [2499, 1, 0, 0])
    await modal.getByRole('button', { name: 'Dữ liệu đã có trong nhóm này: 1' }).click()
    assert.match(await modal.locator('.campaign-import-preview-table tbody tr').first().innerText(), /0912000001/)
    ok('2,500 rows: 1,000 + 1,000 + 500 sequential requests, cancel stops before the next chunk, a match in chunk 2 lands on the right row')

    // 10. Bound group + campaign option: member step first, the campaign step only gets what is left; six result groups.
    await open({ bound: true })
    assert.equal(await radio(/Với tài khoản gắn với nhóm/).count(), 1)
    await otherBox.check()
    await radio(/Với tài khoản gắn với nhóm/).check()
    await textarea.fill('0912000001\n0912000003\n0912000004\n0912000009\n0912000009\nbad')
    await check()
    s = await state()
    assert.deepEqual(s.memberCalls.at(-1).request.values, ['0912000001', '0912000003', '0912000004', '0912000009'])
    assert.equal(s.campaignCalls.length, 1)
    assert.deepEqual(s.campaignCalls[0].request, { actionId: 'zalo_message_phone', accountIds: [11], days: 30, phones: ['0912000004', '0912000009'], excludeCampaignId: null })
    assert.deepEqual(await groupLabels(), ['Hợp lệ', 'Đã có trong nhóm này', 'Đã có ở nhóm khác', 'Đã có ở chiến dịch khác', 'Lỗi/bị loại', 'Trùng'])
    assert.deepEqual(await counts(), [1, 1, 1, 1, 1, 1])
    assert.equal(await footerHint.innerText(), 'Sẽ thêm 1 số mới vào nhóm · bỏ qua 1 đã có trong nhóm này, 1 đã có ở nhóm khác, 1 số đã có ở chiến dịch khác.')
    await insertButton.click(); await confirm.waitFor()
    confirmText = await confirm.innerText()
    for (const pattern of [/Sẽ bỏ qua 5 số/, /1 số đã có trong nhóm này/, /1 số đã có ở nhóm data khác/, /Tất cả nhóm data khác của bạn/, /1 số đã có ở chiến dịch khác/,
      /tài khoản gắn với nhóm/]) assert.match(confirmText, pattern)
    await confirm.getByRole('button', { name: 'Thêm 1 số' }).click()
    await page.locator('#closed').waitFor()
    s = await state()
    assert.deepEqual(s.submitted.rows.map(item => item.phone), ['0912000009'])
    assert.deepEqual(s.submitted.members, { checkedAt: '2026-11-13T03:42:00Z', inGroup: 1, otherGroups: 1 })
    assert.equal(s.submitted.duplicates.skipped, 1)
    ok('bound group: member step first, campaign step gets only the remaining numbers, six groups, both summaries submitted')

    // 11. UID and group-link lists: no campaign options, "dòng" instead of "số", values sent as typed.
    await open({ target: 'uid' })
    await dedup.waitFor()
    assert.equal(await dedup.locator('.campaign-import-dedup-section').count(), 0)
    assert.equal(await dedup.getByRole('radio').count(), 0)
    assert.match(await dedup.innerText(), /Loại data này chưa đối chiếu được với chiến dịch\./)
    await textarea.fill('2254071234567890123\n3344556677889900112')
    await check()
    assert.deepEqual((await state()).memberCalls.at(-1).request, { contactType: 'person', values: ['2254071234567890123', '3344556677889900112'], otherGroups: 'none' })
    assert.deepEqual(await counts(), [1, 1, 0, 0])
    assert.equal(await footerHint.innerText(), 'Sẽ thêm 1 dòng mới vào nhóm · bỏ qua 1 đã có trong nhóm này.')
    await insertButton.click(); await confirm.waitFor()
    assert.match(await confirm.innerText(), /1 dòng đã có trong nhóm này/)
    await confirm.getByRole('button', { name: 'Thêm 1 dòng' }).click()
    await page.locator('#closed').waitFor()
    await open({ target: 'link' })
    await otherBox.check()
    await textarea.fill('https://zalo.me/g/abc123\nhttps://zalo.me/g/khac99')
    await check()
    assert.deepEqual((await state()).memberCalls.at(-1).request, { contactType: 'group', values: ['https://zalo.me/g/abc123', 'https://zalo.me/g/khac99'], otherGroups: 'all' })
    assert.deepEqual(await groupLabels(), ['Hợp lệ', 'Đã có trong nhóm này', 'Đã có ở nhóm khác', 'Lỗi/bị loại', 'Trùng'])
    assert.deepEqual(await counts(), [1, 0, 1, 0, 0])
    ok('UID and group-link lists: member options only, unit "dòng", identities sent as typed')

    // 12. Gates: switch off, switch unreadable, list type that cannot be matched, caller without a destination.
    await setFixture({ setting: { ok: true, data: { enabled: false } } })
    await open()
    assert.equal(await inGroupBox.count(), 0)
    assert.match(await dedup.innerText(), /Nhóm không gắn tài khoản Zalo: số đã có trong nhóm từ lần nhập khác vẫn được thêm thành dòng mới\./)
    await open({ target: 'uid' })
    assert.equal(await dedup.count(), 0)
    assert.match(await modal.locator('.campaign-import-dedup-info').innerText(), /Lọc trùng: hệ thống bỏ dòng lặp trong file\. Nhóm không gắn tài khoản Zalo/)
    await textarea.fill('2254071234567890123')
    await check()
    assert.equal((await state()).memberCalls.length, 0)
    await setFixture({ setting: { ok: false, code: 'session_invalid', message: 'x' } })
    await open()
    assert.equal(await inGroupBox.count(), 0)
    await setFixture({ setting: { ok: true, data: { enabled: true } } })
    const settingBefore = (await state()).settingCalls
    await open({ member: false, campaign: false })
    assert.equal((await state()).settingCalls, settingBefore, 'no switch read without a member check')
    assert.equal(await dedup.count(), 0)
    assert.match(await modal.locator('.campaign-import-dedup-info').innerText(), /Loại data này chưa đối chiếu được với data đã có trong nhóm\./)
    await textarea.fill('0912000001')
    await check()
    await insertButton.click()
    await page.locator('#closed').waitFor()
    s = await state()
    assert.equal(s.memberCalls.length, 0); assert.equal(s.submitted.rows.length, 1)
    ok('gates: switch off or unreadable hides the options; unsupported list types get one honest note and import as before')

    // 13. The real "Quản lý nhóm data" window: options offered for a phone group, other groups = own groups only (no shared,
    // not the current one), a filtered file is sent under the new list name, the toast names what was skipped.
    await smoke(() => window.groupSmoke.manager())
    const manager = page.getByRole('dialog', { name: 'Quản lý nhóm data', exact: true })
    await manager.waitFor()
    await page.locator('.data-group-manager-add-button').click()
    await page.getByRole('button', { name: /Thêm từ file data/ }).click()
    await textarea.waitFor()
    await inGroupBox.waitFor()
    assert.deepEqual(await dedup.locator('.campaign-import-dedup-section').allInnerTexts(), ['Với nhóm data', 'Với chiến dịch nhắn tin'])
    assert.match(await dedup.innerText(), /Data đã có trong nhóm “Khách tháng 11” không được thêm lần nữa/)
    assert.equal(await radio(/tài khoản gắn với nhóm/).count(), 0)
    await otherBox.check()
    const queriesBefore = (await state()).groupQueries.length
    await pickGroupsButton.click(); await picker.waitFor(); await picker.locator('.input-dup-picker-account').first().waitFor()
    s = await state()
    assert.deepEqual(s.groupQueries.slice(queriesBefore), [{ ownedOnly: true, offset: 0, limit: 100 }])
    assert.deepEqual(await picker.locator('.input-dup-picker-account-name strong').allInnerTexts(), ['Khách đã mua', 'Khách Hà Nội'])
    await picker.getByRole('button', { name: 'Hủy' }).click(); await picker.waitFor({ state: 'detached' })
    await otherBox.uncheck()
    await modal.getByRole('tab', { name: 'File Excel/CSV của khách hàng', exact: true }).click()
    await modal.locator('input[type=file][accept=".xlsx,.xls,.csv"]').last().setInputFiles(xlsxFile([['Tên', 'Số điện thoại'], ['An', '0912000001'], ['Bình', '0912000009'], ['Chi', '0912000008']], 'khach.xlsx'))
    await modal.locator('.campaign-import-table-options').waitFor()
    await check()
    assert.equal((await state()).memberCalls.at(-1).groupId, 31)
    assert.deepEqual(await counts(), [2, 1, 0, 0])
    await insertButton.click(); await confirm.waitFor()
    await confirm.getByRole('button', { name: 'Thêm 2 số' }).click()
    await page.waitForFunction(() => window.groupSmoke.state.ingests.length === 1)
    await modal.waitFor({ state: 'detached' })
    s = await state()
    const ingest = s.ingests[0]
    assert.equal(ingest.groupId, 31); assert.equal(ingest.kind, 'upload'); assert.equal(ingest.importSource, 'excel')
    assert.equal(ingest.datasetName, 'khach.xlsx · đã lọc trùng 13/11 10:42')
    assert.deepEqual(ingest.rows.map(item => [item.phone, item.contactType]), [['0912000009', 'phone'], ['0912000008', 'phone']])
    assert.deepEqual(s.alerts.at(-1), { message: 'Đã thêm 2 data vào nhóm · đã bỏ qua 1 data đã có trong nhóm.', type: 'success' })
    ok('real data-group window: options wired, picker lists own groups only, filtered file sent under the new list name, toast names skipped rows')

    if (process.env.UI_SMOKE_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.UI_SMOKE_SCREENSHOT_DIR, { recursive: true })
      const shot = name => page.screenshot({ path: path.join(process.env.UI_SMOKE_SCREENSHOT_DIR, name) })
      await open({ bound: true })
      await otherBox.check()
      await textarea.fill('0912000001\n0912000003\n0912000004\n0912000009\n0912000009\nbad')
      await shot('desktop-group-matches-options.png')
      await radio(/Với tài khoản gắn với nhóm/).check()
      await check()
      await shot('desktop-group-matches-results.png')
      await insertButton.click(); await confirm.waitFor()
      await shot('desktop-group-matches-confirm.png')
      await confirm.getByRole('button', { name: 'Quay lại' }).click()
      await pickGroupsButton.click(); await picker.waitFor(); await picker.locator('.input-dup-picker-account').first().waitFor()
      await shot('desktop-group-matches-picker.png')
      await picker.getByRole('button', { name: 'Hủy' }).click()
      await open()
      await modal.getByRole('tab', { name: 'File Excel/CSV của khách hàng', exact: true }).click()
      await modal.locator('input[type=file][accept=".xlsx,.xls,.csv"]').last().setInputFiles(xlsxFile([['Tên', 'Số điện thoại'], ['An', '0912000001'], ['Bình', '0912000009']], 'khach.xlsx'))
      await modal.locator('.campaign-import-table-options').waitFor()
      await check()
      await insertButton.click(); await confirm.waitFor()
      await shot('desktop-group-matches-confirm-file.png')
      await setFixture({ mode: 'fail' })
      await open()
      await textarea.fill('0912000001\n0912000009')
      await checkButton.click(); await failure.waitFor()
      await shot('desktop-group-matches-failure.png')
      await setFixture({ mode: 'ok' })
    }

    assert.deepEqual(errors, [])
    console.log(`data group member matches UI: ${passed}/${passed} passed`)
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

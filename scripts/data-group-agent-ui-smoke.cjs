// Real Electron UI of the Desktop "Thêm nhóm data bằng Agent" (Quản lý nhóm data) and "Agent chọn bạn bè" (campaign form hook)
// with a local IPC fixture; never connects to any service, never calls AI.
// Covers: switch gate (off / admin_akabiz / all / campaignForm false), one switch read, account default, redacted message,
// confirm → one preview read → create with the shown filter, manager reload + alert, in-dialog "Bỏ cuộc trò chuyện?" layer,
// Stop → cancel IPC, campaign purpose (no data type, locked single account, multi-account note), recipients appended to the
// form list with the source note.
// Run: node scripts/data-group-agent-ui-smoke.cjs (as root in the cloud container: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node ...)
// Screenshots: AKA_UI_SMOKE_SHOW=1 UI_SMOKE_SCREENSHOT_DIR=<dir> (a hidden window does not paint).
// Contract: docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { _electron } = require('playwright')

const harness = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Manager from './src/renderer/src/components/DataScan/DataGroupManagerModal';
import {useCampaignFriendAgent} from './src/renderer/src/components/DataGroups/dataGroupAgent/useCampaignFriendAgent';
import {useUiStore} from './src/renderer/src/stores/uiStore';
import {useAuthStore} from './src/renderer/src/stores/authStore';
import {useCampaignStore} from './src/renderer/src/stores/campaignStore';
import './src/renderer/src/styles/global.css';
const clone=v=>JSON.parse(JSON.stringify(v));
const state={alerts:[],agentCalls:[],cancels:[],appended:[],scanOpened:0,settingCalls:0,groupQueries:[],delayTurn:false,pendingTurns:[],
  setting:{audience:'all',campaignForm:true}};
const accounts=[
  {id:9,name:'Shop Hoa Mai',kind:'desktop',available:true,friendCount:1725,friendsUpdatedAt:'2026-11-13T14:30:00Z'},
  {id:10,name:'Zalo Server mới',kind:'server',available:true,friendCount:0,friendsUpdatedAt:null},
  {id:11,name:'Zalo trình duyệt',kind:'web',available:false,friendCount:20,friendsUpdatedAt:'2026-11-13T14:30:00Z'}];
const filter=accountId=>({version:1,source:'zalo_friends',accountId,match:'all',excludeOptedOut:true,excludeBlocked:true,sort:null,limit:null,
  groups:[{match:'all',conditions:[{field:'zalo_tag',op:'has_any',tagIds:['7']}]}]});
const reply=request=>({ok:true,reply:{status:'confirm',message:'Mình sẽ lấy bạn bè có tag VIP 2025. Bạn xem số người khớp rồi bấm nút ở dưới nhé.',
  questions:[],assumptions:['Không tính người đã từ chối nhận tin'],filter:filter(request.accountId),
  groupName:request.purpose==='campaign_recipients'?null:'Khách VIP lâu chưa nhắn',
  summary:['Bạn bè của Shop Hoa Mai','Tag Zalo: có VIP 2025','Luôn loại: khách đã từ chối nhận tin, người đã bị chặn'],
  summaryLines:[{text:'Bạn bè của Shop Hoa Mai',level:0},{text:'Tag Zalo: có VIP 2025',level:0},{text:'Luôn loại: khách đã từ chối nhận tin, người đã bị chặn',level:0}],
  notes:['Một số tag, nhóm khách hàng hoặc chiến dịch Agent nêu không có trong danh mục của tài khoản nên đã bỏ.']}});
const rows=[{contactId:11,uid:'1001',name:'Lan Shop',zaloOriginalName:'Lan',zaloTags:[{id:'7',name:'VIP 2025'}],gender:'female',lastSentAt:'2026-11-10T03:00:00Z',latestStage:'seen'},
  {contactId:12,uid:'1002',name:'Minh',zaloOriginalName:null,zaloTags:[{id:'7',name:'VIP 2025'}],gender:'male',lastSentAt:null,latestStage:'never_sent'},
  {contactId:13,uid:'1003',name:null,zaloOriginalName:'Hoa',zaloTags:[{id:'7',name:'VIP 2025'}],gender:null,lastSentAt:null,latestStage:'never_sent'}];
window.electronAPI={
  dataGroupAgent:async request=>{
    if(request.kind==='setting'){state.settingCalls++;return {ok:true,data:clone(state.setting)}}
    state.agentCalls.push(clone(request));
    if(request.kind==='accounts')return {ok:true,data:{accounts:clone(accounts)}};
    if(request.kind==='turn'){
      if(state.delayTurn)return new Promise(resolve=>state.pendingTurns.push(()=>resolve({ok:true,data:reply(request.request)})));
      return {ok:true,data:reply(request.request)}}
    if(request.kind==='filter')return {ok:true,data:{version:1,mode:'page',accountId:request.request.filter.accountId,totalFriends:1725,matched:3,
      notes:[{code:'tracking_partial',count:2}],evaluatedAt:'2026-11-14T10:00:00Z',rows:clone(rows),
      coverage:{messagesSince:'2026-06-03T02:00:00Z',trackingSince:'2026-10-02T03:00:00Z',factsFrom:'2026-06-03T02:00:00Z',deliveredAvailable:false}}};
    if(request.kind==='recipients')return {ok:true,data:{version:1,accountId:request.request.filter.accountId,totalFriends:1725,matched:3,
      recipients:rows.map(r=>({contactId:r.contactId,uid:r.uid,name:r.name})),missing:0,notes:[],evaluatedAt:'2026-11-14T10:00:00Z'}};
    if(request.kind==='create')return {ok:true,data:{groupId:99,filterId:5,matched:3,inserted:3,replayed:false}};
    return {ok:false,code:'unavailable',message:'?'}},
  cancelDataGroupAgent:async requestId=>{state.cancels.push(requestId)}};
const types=[{id:101,code:'zalo_person',name:'Zalo · User theo UID'}];
const group=(id,name,extra={})=>({id,name,color:'#10b981',revision:1,dataTypeCode:'zalo_person',dataTypeName:'Zalo · User theo UID',dataTypeCategoryItemId:101,boundZaloAccountId:null,boundZaloAccountName:null,activeMembershipCount:2,isDelete:false,datasetSyncMode:'manual',...extra});
const managerGroups=[group(31,'Khách tháng 11')];
Object.assign(window.electronAPI,{
  listAccounts:async()=>[],listDataTypeCategoryItems:async()=>types,
  getDataGroupAccountOptions:async()=>[{accountId:null,accountName:'Không gắn tài khoản',disabledReason:null}],
  listDataGroups:async(query={})=>{state.groupQueries.push(clone(query));return {groups:clone(managerGroups),total:managerGroups.length}},
  listDataGroupMembers:async()=>({members:[],total:0}),listDataGroupDatasets:async()=>[],getDataGroupLatestIngestStats:async()=>({}),
  getDataGroupPanel:async id=>({group:{...(managerGroups.find(g=>g.id===id)||managerGroups[0]),creatorName:'Người kiểm thử'},summary:{activeMembershipCount:2,runCount:0,campaignCount:0},quality:{withLinkCount:0,withPhoneCount:0,withUidCount:2,duplicateCount:0},sourceBreakdown:[],dataTypeBreakdown:[],accountBreakdown:[],tags:[],history:[],campaigns:[]}),
  getDataGroupDynamicFilter:async id=>({groupId:id,boundZaloAccountId:null,isEnabled:false,revision:1,matchedCount:0,lastEnteredCount:0,lastExitedCount:0,rules:[],catalog:{fields:[],operators:[],scopes:[],joins:[]},values:[],accounts:[]})});
useUiStore.setState({showAlert:(message,type)=>state.alerts.push({message,type})});
useAuthStore.setState({user:{staffId:7,organizationId:9,isAdminAkabiz:false}});
useCampaignStore.setState({accounts:[],loadAccounts:async()=>{}});
function FormHarness({eligible,accountIds}){
  const [list,setList]=useState([]);
  const appendRows=add=>{const seen=new Set(list.map(r=>r.uid));const fresh=add.filter(r=>!seen.has(r.uid));state.appended.push(...clone(fresh));setList(c=>[...c,...fresh]);return fresh.length};
  const agent=useCampaignFriendAgent({eligible,rowCount:list.length,accountIds,appendRows,onOpenScan:()=>{state.scanOpened++}});
  return <div className="form-harness" style={{padding:24}}><div className="stepper-grid-toolbar" style={{display:'flex',gap:8}}>
    <button type="button" className="btn btn-secondary">Chọn bạn bè Zalo</button>{agent.button}</div>{agent.note}
    <div id="form-rows">{list.length} dòng</div>{agent.dialog}</div>;
}
function App(){
  const [view,setView]=useState({kind:'closed',key:0});
  window.agentSmoke={state,
    manager:()=>{state.alerts=[];state.agentCalls=[];state.groupQueries=[];setView(v=>({kind:'manager',key:v.key+1}))},
    form:(o={})=>{state.alerts=[];state.agentCalls=[];state.appended=[];setView(v=>({kind:'form',key:v.key+1,eligible:o.eligible!==false,accountIds:o.accountIds||[9]}))}};
  if(view.kind==='closed')return <div id="closed">Đã đóng</div>;
  if(view.kind==='manager')return <Manager key={view.key} initialGroupId={31} onClose={()=>{}}/>;
  return <FormHarness key={view.key} eligible={view.eligible} accountIds={view.accountIds}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
`

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-group-agent-ui-'))
  const shots = process.env.UI_SMOKE_SCREENSHOT_DIR
  let app
  try {
    await build({
      stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: harness }, outfile: path.join(dir, 'app.js'), bundle: true, platform: 'browser',
      format: 'iife', jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning'
    })
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body><div id="root"></div><script src="app.js"></script></body></html>')
    const show = process.env.AKA_UI_SMOKE_SHOW === '1'
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:${show},width:1440,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,c)=>c({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir, 'index.html'))})})`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(dir, 'main.cjs')], cwd: process.cwd(), env })
    const page = await app.firstWindow(); page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    // Cửa sổ Quản lý nhóm data có sẵn log console khi lượt đọc thành viên bị hủy lúc bài dựng lại cửa sổ liên tục (không báo cho người dùng).
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|Đã hủy lượt lọc dữ liệu/.test(message.text())) errors.push(message.text()) })
    await page.locator('#closed').waitFor()

    let passed = 0
    const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }
    const smoke = (fn, arg) => page.evaluate(fn, arg)
    const state = () => smoke(() => JSON.parse(JSON.stringify(window.agentSmoke.state)))
    const setFixture = patch => smoke(p => Object.assign(window.agentSmoke.state, p), patch)
    const settle = () => smoke(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => setTimeout(resolve, 0)), 0))))
    const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${name}.png`) }) } }
    const dialog = name => page.getByRole('dialog', { name })
    const openManager = async () => { await smoke(() => window.agentSmoke.manager()); await page.getByRole('dialog', { name: 'Quản lý nhóm data' }).waitFor(); await settle() }
    const agentButton = page.getByRole('button', { name: 'Thêm nhóm bằng Agent' })

    // 1. Công tắc tắt / chỉ admin akaBiz: không có nút; một lượt đọc công tắc mỗi lần mở cửa sổ.
    await setFixture({ setting: { audience: 'off', campaignForm: true }, settingCalls: 0 })
    await openManager()
    await page.waitForFunction(() => window.agentSmoke.state.settingCalls === 1)
    await settle()
    assert.equal(await agentButton.count(), 0)
    await setFixture({ setting: { audience: 'admin_akabiz', campaignForm: true } })
    await openManager()
    await page.waitForFunction(() => window.agentSmoke.state.settingCalls === 2)
    await settle()
    assert.equal(await agentButton.count(), 0, 'admin_akabiz, staff is not admin akaBiz')
    ok('switch off / admin_akabiz for a normal staff: no button; one switch read per opening')

    // 2. Mở cho mọi người: nút dưới "Thêm nhóm"; cửa sổ Agent; tài khoản mặc định là tài khoản có danh bạ.
    await setFixture({ setting: { audience: 'all', campaignForm: true } })
    await openManager()
    await agentButton.waitFor()
    await shot('01-manager-button')
    await agentButton.click()
    const agentDialog = dialog('Thêm nhóm data bằng Agent')
    await agentDialog.waitFor()
    assert.equal(await page.getByRole('dialog', { name: 'Quản lý nhóm data' }).getAttribute('inert'), '', 'manager is inert behind the agent window')
    const accountSelect = agentDialog.getByRole('combobox', { name: 'Tài khoản Zalo' })
    await page.waitForFunction(() => window.agentSmoke.state.agentCalls.some(c => c.kind === 'accounts'))
    await settle()
    assert.equal(await accountSelect.inputValue(), '9')
    assert.equal(await agentDialog.getByRole('combobox', { name: 'Loại dữ liệu' }).isDisabled(), true)
    assert.match(await agentDialog.locator('.dg-agent-banner').first().innerText(), /Zalo Desktop · 1\.725 bạn bè, danh bạ cập nhật/)
    assert.equal(await accountSelect.locator('option[value="11"]').evaluate(option => option.disabled), true, 'account outside the package is disabled')
    await shot('02-manager-dialog-empty')
    ok('switch all: "Thêm nhóm bằng Agent" under "Thêm nhóm", window opens, manager inert, account with friends selected')

    // 3. Gửi mô tả: một lượt chat, SĐT bị che trước khi rời renderer; trả lời xác nhận → một lượt đếm thử 20 người.
    const input = agentDialog.getByRole('textbox', { name: 'Mô tả nhóm data' })
    await input.fill('Bạn bè có tag VIP, gọi 0912 345 678 trước')
    await input.press('Enter')
    await agentDialog.getByText('Khớp 3').waitFor()
    let s = await state()
    const turn = s.agentCalls.find(c => c.kind === 'turn').request
    assert.equal(turn.purpose, 'data_group'); assert.equal(turn.accountId, 9); assert.equal(turn.groupName, null)
    assert.equal(turn.message, 'Bạn bè có tag VIP, gọi [số điện thoại] trước')
    const preview = s.agentCalls.filter(c => c.kind === 'filter')
    assert.equal(preview.length, 1); assert.equal(preview[0].request.mode, 'page'); assert.equal(preview[0].request.limit, 20)
    assert.match(await agentDialog.locator('.dg-agent-filter').innerText(), /Tag Zalo: có VIP 2025/)
    assert.match((await agentDialog.locator('.dg-agent-count').textContent()).replace(/\s+/g, ' '), /Khớp 3 \/ 1\.725 bạn bè/)
    assert.match(await agentDialog.locator('.agent-turn.assistant').last().innerText(), /nhóm data hoặc chiến dịch Agent nêu không có/, 'shared message reworded to Desktop vocabulary')
    assert.equal(await agentDialog.getByRole('textbox', { name: 'Tên nhóm data' }).inputValue(), 'Khách VIP lâu chưa nhắn')
    await shot('03-manager-dialog-confirm')
    ok('one turn with the phone number masked, confirm → one 20-row preview, summary and suggested group name shown')

    // 4. Tạo nhóm: gửi đúng bộ lọc đã hiện; cửa sổ đóng, danh sách nhóm tải lại, báo đã tạo.
    const queriesBefore = s.groupQueries.length
    await agentDialog.getByRole('button', { name: 'Tạo nhóm 3 bạn bè' }).click()
    await agentDialog.waitFor({ state: 'detached' })
    s = await state()
    const create = s.agentCalls.find(c => c.kind === 'create').request
    assert.deepEqual(create.filter, preview[0].request.filter)
    assert.equal(create.name, 'Khách VIP lâu chưa nhắn'); assert.equal(create.color, null); assert.equal(create.summary.length, 3)
    assert.match(create.requestId, /^[0-9a-f-]{36}$/)
    assert.deepEqual(s.alerts.at(-1), { message: 'Đã tạo nhóm "Khách VIP lâu chưa nhắn" với 3 bạn bè.', type: 'success' })
    await page.waitForFunction(n => window.agentSmoke.state.groupQueries.length > n, queriesBefore)
    ok('"Tạo nhóm 3 bạn bè" sends the shown filter + name + summary with a request id, closes, reloads groups, success alert')

    // 5. Đóng khi đang có hội thoại: hỏi lại ngay trong cửa sổ (bấm được); Ở lại / Đồng ý. Dừng lượt chat → báo main hủy.
    await agentButton.click()
    await agentDialog.waitFor()
    await page.waitForFunction(() => window.agentSmoke.state.agentCalls.filter(c => c.kind === 'accounts').length >= 2)
    await setFixture({ delayTurn: true, pendingTurns: [], cancels: [] })
    await input.fill('Bạn bè nữ')
    await input.press('Enter')
    await agentDialog.getByRole('button', { name: 'Dừng' }).click()
    await agentDialog.getByText('Đã dừng. Bạn có thể gửi lại hoặc mô tả khác.').waitFor()
    s = await state()
    const stopped = s.agentCalls.filter(c => c.kind === 'turn').at(-1).request.requestId
    assert.deepEqual(s.cancels, [stopped])
    await setFixture({ delayTurn: false })
    await agentDialog.getByRole('button', { name: 'Đóng form nhóm data' }).click()
    const layer = page.getByRole('alertdialog', { name: 'Bỏ cuộc trò chuyện?' })
    await layer.waitFor()
    await shot('04-manager-confirm-layer')
    await layer.getByRole('button', { name: 'Ở lại' }).click()
    await layer.waitFor({ state: 'detached' })
    assert(await agentDialog.isVisible())
    await agentDialog.getByRole('button', { name: 'Đóng form nhóm data' }).click()
    await layer.getByRole('button', { name: 'Đồng ý' }).click()
    await agentDialog.waitFor({ state: 'detached' })
    ok('Stop sends cancel for the running turn; closing asks inside the window (Ở lại keeps it, Đồng ý closes)')

    // 6. Form chiến dịch: không đủ điều kiện → không có nút; campaignForm false → không có nút.
    await setFixture({ settingCalls: 0 })
    await smoke(() => window.agentSmoke.form({ eligible: false }))
    await page.locator('#form-rows').waitFor(); await settle()
    assert.equal(await page.getByRole('button', { name: 'Agent chọn bạn bè' }).count(), 0)
    assert.equal((await state()).settingCalls, 0, 'not eligible: no switch read')
    await setFixture({ setting: { audience: 'all', campaignForm: false } })
    await smoke(() => window.agentSmoke.form())
    await page.waitForFunction(() => window.agentSmoke.state.settingCalls === 1); await settle()
    assert.equal(await page.getByRole('button', { name: 'Agent chọn bạn bè' }).count(), 0)
    ok('campaign form: not eligible → no button, no switch read; campaignForm false → no button')

    // 7. Một tài khoản: cửa sổ campaign_recipients, không có "Loại dữ liệu", tài khoản khóa; thêm người nhận vào danh sách.
    await setFixture({ setting: { audience: 'all', campaignForm: true } })
    await smoke(() => window.agentSmoke.form())
    const friendButton = page.getByRole('button', { name: 'Agent chọn bạn bè' })
    await friendButton.waitFor()
    assert.match(await page.locator('.campaign-friend-agent-hint').innerText(), /tả bằng lời để Agent lọc giúp/)
    await shot('05-form-button')
    await friendButton.click()
    const friendDialog = dialog('Agent chọn bạn bè')
    await friendDialog.waitFor()
    await page.waitForFunction(() => window.agentSmoke.state.agentCalls.some(c => c.kind === 'accounts')); await settle()
    assert.equal(await friendDialog.getByRole('combobox', { name: 'Loại dữ liệu' }).count(), 0)
    const formAccount = friendDialog.getByRole('combobox', { name: 'Tài khoản Zalo' })
    assert.equal(await formAccount.isDisabled(), true)
    assert.equal(await formAccount.locator('option').count(), 1)
    assert.match(await friendDialog.innerText(), /Tài khoản của chiến dịch/)
    const formInput = friendDialog.getByRole('textbox', { name: 'Mô tả bạn bè muốn gửi' })
    await formInput.fill('Bạn bè có tag VIP')
    await formInput.press('Enter')
    const addButton = friendDialog.getByRole('button', { name: 'Thêm 3 bạn bè vào danh sách' })
    await addButton.waitFor()
    s = await state()
    const formTurn = s.agentCalls.find(c => c.kind === 'turn').request
    assert.equal(formTurn.purpose, 'campaign_recipients'); assert.equal(formTurn.groupName, null)
    assert.equal(await friendDialog.getByRole('textbox', { name: 'Tên nhóm data' }).count(), 0)
    assert.match(await friendDialog.locator('.dg-agent-footer-note').innerText(), /được thêm vào danh sách data của chiến dịch/)
    await shot('06-form-dialog-confirm')
    await addButton.click()
    await friendDialog.waitFor({ state: 'detached' })
    s = await state()
    assert.equal(s.agentCalls.filter(c => c.kind === 'recipients').length, 1)
    assert.equal(s.agentCalls.filter(c => c.kind === 'create').length, 0, 'campaign purpose never creates a group')
    assert.deepEqual(s.appended.map(r => [r.uid, r.name]), [['1001', 'Lan Shop'], ['1002', 'Minh'], ['1003', '']])
    assert.equal(await page.locator('#form-rows').innerText(), '3 dòng')
    assert.deepEqual(s.alerts.at(-1), { message: 'Đã thêm 3 bạn bè vào danh sách.', type: 'success' })
    assert.match(await page.locator('.campaign-friend-agent-notes').innerText(), /Agent đã thêm 3 bạn bè lúc \d\d:\d\d từ tài khoản Shop Hoa Mai: tag Zalo: có VIP 2025\./)
    await shot('07-form-after-add')
    ok('campaign purpose: no data type, locked account, no group name, recipients appended (UID + name), source note, no group created')

    // 8. Nhiều tài khoản trong form: chỉ liệt kê tài khoản của form theo thứ tự, có dòng nhắc; đổi được tài khoản.
    await smoke(() => window.agentSmoke.form({ accountIds: [10, 9] }))
    await friendButton.click()
    await friendDialog.waitFor()
    await page.waitForFunction(() => window.agentSmoke.state.agentCalls.some(c => c.kind === 'accounts')); await settle()
    assert.deepEqual(await formAccount.locator('option').evaluateAll(options => options.map(o => o.value)), ['10', '9'])
    assert.equal(await formAccount.isDisabled(), false)
    assert.equal(await formAccount.inputValue(), '10', 'first account of the form is the default')
    assert.match(await friendDialog.locator('.dg-agent-banner.is-note').innerText(), /Chiến dịch đang chọn 2 tài khoản/)
    assert.match(await friendDialog.locator('.dg-agent-banner').first().innerText(), /Chưa có danh bạ bạn bè/)
    assert.equal(await friendDialog.getByRole('textbox', { name: 'Mô tả bạn bè muốn gửi' }).isDisabled(), true, 'no friends: input disabled')
    await friendDialog.getByRole('button', { name: 'Quét bạn bè Zalo' }).click()
    await friendDialog.waitFor({ state: 'detached' })
    assert.equal((await state()).scanOpened, 1)
    ok('multi-account form: only form accounts in form order, note, no-friends account → "Quét bạn bè Zalo" opens the picker')

    assert.deepEqual(errors, [])
    ok('no renderer errors')
    console.log(`\nAll ${passed} checks passed.`)
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })

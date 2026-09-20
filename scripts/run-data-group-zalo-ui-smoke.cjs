// Isolated renderer smoke: mocked IPC, no account login or production writes.
const esbuild = require(process.cwd()+'/node_modules/esbuild')
const {chromium}=require(process.cwd()+'/node_modules/playwright')
const fs=require('fs'),http=require('http'),assert=require('node:assert/strict')
const dir=fs.mkdtempSync(require('path').join(require('os').tmpdir(),'aka-data-group-ui-'))
fs.mkdirSync(dir,{recursive:true})
const code=`
import React from 'react'; import {createRoot} from 'react-dom/client';
import Modal from './src/renderer/src/components/DataScan/DataGroupManagerModal';
import {useCampaignStore} from './src/renderer/src/stores/campaignStore';
import {useUiStore} from './src/renderer/src/stores/uiStore';
import './src/renderer/src/styles/global.css';
const accounts=[{id:11,name:'Zalo A',flatformType:'zalo',isDelete:false},{id:12,name:'Zalo B',flatformType:'zalo',isDelete:false},{id:13,name:'Facebook C',flatformType:'facebook',isDelete:false},{id:14,name:'Zalo hết quyền',flatformType:'zalo',isDelete:false}];
const types=[{id:101,code:'zalo_person',name:'Zalo · User theo UID'},{id:102,code:'zalo_group',name:'Zalo · Group/link'},{id:103,code:'phone',name:'Số điện thoại'}];
let groups=[{id:1,name:'Khách Zalo',color:'#10b981',revision:1,dataTypeCode:'zalo_person',dataTypeName:types[0].name,dataTypeCategoryItemId:101,boundZaloAccountId:11,boundZaloAccountName:'Zalo A',activeMembershipCount:1,isDelete:false,datasetSyncMode:'manual'}];
groups.push({...groups[0],id:2,name:'Quét Zalo A',boundZaloAccountId:null,boundZaloAccountName:null,datasetSyncMode:'dataset_auto'}, {...groups[0],id:3,name:'Nhóm nhiều tài khoản',boundZaloAccountId:null,boundZaloAccountName:null});
const members=[{id:1,contactId:1,groupId:1,name:'Tên cũ',zaloName:'Nguyễn An',displayName:'An - cửa hàng',zaloFriendStatus:'request_received',contactType:'person',flatformType:'zalo',sourceAccountId:11,uid:'123456',isDelete:false,provenance:[]}];
window.calls=[];
const fields=[['zalo_tag','Tag Zalo'],['akabiz_tag','Tag akaBiz'],['zalo_friend_status','Trạng thái bạn bè Zalo']].map(([code,name],id)=>({id,code,name,metadata:{},sortOrder:id}));
const values=[{key:'11:1',label:'Khách mới',fieldCode:'zalo_tag',accountId:11,accountName:'Zalo A'}, ...[['friend','Bạn bè'],['request_sent','Gửi lời mời kết bạn'],['request_received','Nhận kết bạn'],['stranger','Người lạ']].map(([key,label])=>({key,label,fieldCode:'zalo_friend_status',accountId:null}))];
const configs={};
window.electronAPI={
 listAccounts:async()=>accounts,listDataTypeCategoryItems:async()=>types,
 getDataGroupAccountOptions:async q=>{
  window.calls.push(['accountOptions',q]);
  if(window.rejectAccountOptions){window.rejectAccountOptions=false;throw new Error('Không tải được tài khoản thử nghiệm')}
  const result=[{accountId:null,accountName:'Không gắn tài khoản',disabledReason:null},...accounts.filter(a=>a.flatformType==='zalo').map(a=>({accountId:a.id,accountName:a.name,
   disabledReason:a.id===14?'Tài khoản không còn quyền sử dụng':q.groupId===3?'Có data khác tài khoản':(q.groupId===1||q.groupId===2)&&a.id===12?'Không khớp tài khoản nguồn':null}))];
  if(window.deferAccountOptions) return await new Promise(resolve=>window.pendingAccountOptions.push({groupId:q.groupId,resolve:()=>resolve(result)}));
  return result;
 },
 listDataGroups:async()=>({groups,total:groups.length}),
 listDataGroupMembers:async q=>{window.calls.push(['listMembers',q]);return {members:q.groupId===1?members:[],total:q.groupId===1?1:0}},
 listDataGroupDatasets:async()=>[],getDataGroupLatestIngestStats:async()=>({}),
 getDataGroupPanel:async id=>({group:{...groups.find(g=>g.id===id),creatorName:'Người kiểm thử'},summary:{activeMembershipCount:1,runCount:0,campaignCount:0},quality:{withLinkCount:0,withPhoneCount:0,withUidCount:1,duplicateCount:0},sourceBreakdown:[],dataTypeBreakdown:[],accountBreakdown:[],tags:[],history:[],campaigns:[]}),
 getDataGroupDynamicFilter:async id=>{window.calls.push(['getFilter',id]);return configs[id]||{groupId:id,boundZaloAccountId:groups.find(g=>g.id===id).boundZaloAccountId,isEnabled:false,revision:1,matchedCount:0,lastEnteredCount:0,lastExitedCount:0,rules:[],catalog:{fields,operators:[],scopes:[],joins:[]},values,accounts}},
 saveDataGroupDynamicFilter:async r=>{window.calls.push(['saveFilter',r]);return configs[r.groupId]={...await window.electronAPI.getDataGroupDynamicFilter(r.groupId),...r}},
 createDataGroup:async r=>{window.calls.push(['createGroup',r]);if(window.deferGroupSave)await new Promise(resolve=>window.finishGroupSave=resolve);const t=types.find(t=>t.id===r.dataTypeCategoryItemId);const g={...r,id:groups.length+1,dataTypeCode:t?.code,dataTypeName:t?.name,activeMembershipCount:0,isDelete:false};groups=[g,...groups];return g},
 updateDataGroup:async r=>{window.calls.push(['updateGroup',r]);let g=groups.find(g=>g.id===r.groupId);Object.assign(g,r);return {...g}}
};
useCampaignStore.setState({accounts,loadAccounts:async()=>{}});
useUiStore.setState({showAlert:(message,type)=>window.calls.push(['alert',message,type])});
createRoot(document.getElementById('root')).render(<Modal initialGroupId={1} onClose={()=>{}} />);
`
;(async()=>{
 await esbuild.build({stdin:{contents:code,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',outfile:dir+'/app.js',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},loader:{'.woff2':'file','.woff':'file','.ttf':'file','.svg':'file','.png':'file'}})
 fs.writeFileSync(dir+'/index.html','<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
 const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(name.includes('..')){res.writeHead(400);res.end();return}const file=dir+'/'+name;if(!fs.existsSync(file)){res.writeHead(404);res.end();return}res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))})
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); const url='http://127.0.0.1:'+server.address().port;
 let browser;
 try { browser=await chromium.launch({headless:true}) } catch {
   try { browser=await chromium.launch({headless:true,channel:'chrome'}) } catch(error) { server.close(); throw error }
 }
 const page=await browser.newPage({viewport:{width:1500,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try {
 await page.clock.install();
 await page.goto(url);await page.getByRole('columnheader',{name:'Tên hiển thị',exact:true}).waitFor();
 assert.equal(await page.getByRole('cell',{name:'Nguyễn An',exact:true}).count(),1);assert.equal(await page.getByRole('cell',{name:'An - cửa hàng',exact:true}).count(),1);assert.equal(await page.getByRole('cell',{name:'Nhận kết bạn',exact:true}).count(),1);
 const editor=page.getByRole('dialog',{name:'Sửa nhóm data',exact:true});
 // Existing manual and dataset-derived groups use the same selectable options.
 for(const [groupName,id] of [['Khách Zalo',1],['Quét Zalo A',2]]){
  const row=page.locator('.data-group-manager-group-row').nth(id-1);
  await row.getByTitle('Sửa nhóm',{exact:true}).click();
  const select=editor.getByRole('combobox',{name:'Tài khoản Zalo của nhóm',exact:true});
  await select.locator('option[value="12"]').waitFor({state:'attached'});
  assert.equal(await select.isEnabled(),true);
  assert.equal(await select.locator('option[value="12"]').isDisabled(),true);
  assert.equal(await select.locator('option[value="14"]').isDisabled(),true);
  assert.match(await select.locator('option[value="12"]').textContent(),/Không khớp/);
  await select.selectOption('11');
  await editor.getByRole('button',{name:'Lưu nhóm',exact:true}).click();
  await editor.waitFor({state:'hidden'});
  if(id===2) assert.equal(await page.evaluate(()=>window.calls.some(c=>c[0]==='updateGroup'&&c[1].groupId===2&&c[1].boundZaloAccountId===11)),true);
 }
 const mixedRow=page.locator('.data-group-manager-group-row').nth(2);
 await mixedRow.getByTitle('Sửa nhóm',{exact:true}).click();
 const mixedSelect=editor.getByRole('combobox',{name:'Tài khoản Zalo của nhóm',exact:true});
 await mixedSelect.locator('option[value="12"]').waitFor({state:'attached'});
 assert.equal(await mixedSelect.locator('option[value="11"]').isDisabled(),true);
 assert.equal(await mixedSelect.locator('option[value="12"]').isDisabled(),true);
 assert.equal(await mixedSelect.locator('option[value=""]').isEnabled(),true);
 const accountReads=await page.evaluate(()=>window.calls.filter(c=>c[0]==='accountOptions').length);
 await page.clock.fastForward(90_000);
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c[0]==='accountOptions').length),accountReads,'Account options must not poll');
 await editor.getByRole('button',{name:'Huỷ',exact:true}).click();
 // Failed availability loads keep the selector disabled until an explicit retry succeeds.
 await page.evaluate(()=>window.rejectAccountOptions=true);
 const firstRow=page.locator('.data-group-manager-group-row').nth(0);
 await firstRow.getByTitle('Sửa nhóm',{exact:true}).click();
 await editor.getByRole('alert').waitFor();
 assert.equal(await editor.getByRole('combobox',{name:'Tài khoản Zalo của nhóm',exact:true}).isDisabled(),true);
 await editor.getByRole('button',{name:'Thử lại',exact:true}).click();
 await editor.locator('option[value="12"]').waitFor({state:'attached'});
 assert.equal(await editor.getByRole('combobox',{name:'Tài khoản Zalo của nhóm',exact:true}).isEnabled(),true);
 await editor.getByRole('button',{name:'Huỷ',exact:true}).click();
 // A response for a closed editor cannot replace the newly opened group's options.
 await page.evaluate(()=>{window.deferAccountOptions=true;window.pendingAccountOptions=[]});
 await firstRow.getByTitle('Sửa nhóm',{exact:true}).click();
 await page.waitForFunction(()=>window.pendingAccountOptions.length===1);
 await editor.getByRole('button',{name:'Huỷ',exact:true}).click();
 await mixedRow.getByTitle('Sửa nhóm',{exact:true}).click();
 await page.waitForFunction(()=>window.pendingAccountOptions.length===2);
 await page.evaluate(()=>window.pendingAccountOptions[1].resolve());
 await mixedSelect.locator('option[value="11"]').waitFor({state:'attached'});
 await page.evaluate(()=>window.pendingAccountOptions[0].resolve());
 assert.equal(await mixedSelect.locator('option[value="11"]').isDisabled(),true);
 await editor.getByRole('button',{name:'Huỷ',exact:true}).click();
 await page.evaluate(()=>window.deferAccountOptions=false);
 // The info-panel pencil opens the same editor and does not duplicate fields.
 await page.locator('.data-group-info-overview').getByTitle('Sửa nhóm',{exact:true}).click();
 await editor.waitFor();
 assert.equal(await page.locator('.data-group-manager-modal input#data-group-manager-new-name').count(),0);
 await page.keyboard.press('Escape');
 await editor.waitFor({state:'hidden'});
 const createButton=page.getByRole('button',{name:'Thêm nhóm',exact:true});
 await createButton.click();
 const createDialog=page.getByRole('dialog',{name:'Tạo nhóm data',exact:true});
 await createDialog.waitFor();
 assert.equal(await createDialog.locator('#data-group-manager-new-name').evaluate(el=>el===document.activeElement),true);
 await createDialog.getByRole('button',{name:'Đóng form nhóm data'}).focus();
 await page.keyboard.press('Shift+Tab');
 assert.equal(await createDialog.getByRole('button',{name:'Tạo nhóm',exact:true}).evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Escape');
 await createDialog.waitFor({state:'hidden'});
 assert.equal(await createButton.evaluate(el=>el===document.activeElement),true);
 await createButton.click();
 assert.equal(await page.locator('#data-group-manager-new-account').count(),0);
 await page.locator('#data-group-manager-new-type').selectOption('101');
 assert.equal(await page.locator('#data-group-manager-new-account').inputValue(),'');
 await page.locator('#data-group-manager-new-account option[value="14"]').waitFor({state:'attached'});assert.equal(await page.locator('#data-group-manager-new-account option').count(),4);assert.equal(await page.locator('#data-group-manager-new-account option[value="14"]').isDisabled(),true);
 await page.locator('#data-group-manager-new-account').selectOption('11');
 await page.screenshot({path:dir+'/create.png',fullPage:true});
 await page.locator('#data-group-manager-new-type').selectOption('103');assert.equal(await page.locator('#data-group-manager-new-account').count(),0);
 await page.locator('#data-group-manager-new-type').selectOption('101');assert.equal(await page.locator('#data-group-manager-new-account').inputValue(),'');
 await page.locator('#data-group-manager-new-account').selectOption('11');await page.locator('#data-group-manager-new-name').fill('Nhóm gắn A');await page.evaluate(()=>window.deferGroupSave=true);
 await createDialog.getByRole('button',{name:'Tạo nhóm',exact:true}).click();
 await page.waitForFunction(()=>!!window.finishGroupSave);
 assert.equal(await createDialog.getByRole('button',{name:'Đóng form nhóm data'}).isDisabled(),true);
 await page.keyboard.press('Escape');
 assert.equal(await createDialog.isVisible(),true,'Saving must keep the modal open');
 await page.locator('.data-group-form-backdrop').click({position:{x:5,y:5}});
 assert.equal(await createDialog.isVisible(),true);
 await page.evaluate(()=>window.finishGroupSave());
 await createDialog.waitFor({state:'hidden'});
 await page.getByRole('tab',{name:/Bộ lọc động/}).click();await page.getByRole('switch').waitFor();
 const initialFilterReads=await page.evaluate(()=>window.calls.filter(c=>c[0]==='getFilter').length);
 await page.clock.fastForward(90_000);
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c[0]==='getFilter').length),initialFilterReads,'Idle dynamic filter must not poll');
 await page.getByRole('button',{name:'Làm mới',exact:true}).click();
 await page.waitForFunction(count=>window.calls.filter(c=>c[0]==='getFilter').length===count+1,initialFilterReads);
 await page.getByRole('switch').click();
 assert.equal(await page.getByRole('button',{name:'Làm mới',exact:true}).isDisabled(),true,'Refresh must not discard unsaved rules');
 await page.getByRole('button',{name:/Thêm điều kiện/}).first().click();
 await page.getByRole('dialog',{name:'Thêm điều kiện bộ lọc động'}).waitFor();assert.equal(await page.locator('.data-group-dynamic-editor-locked').getByText('Zalo A',{exact:true}).count(),1);
 await page.locator('.data-group-dynamic-field-list').getByRole('button',{name:/Trạng thái bạn bè Zalo/}).click();
 for(const name of ['Bạn bè','Gửi lời mời kết bạn','Nhận kết bạn','Người lạ']) assert.equal(await page.locator('.data-group-dynamic-value-list').getByRole('button',{name,exact:true}).count(),1);
 await page.screenshot({path:dir+'/filter.png',fullPage:true});
 await page.locator('.data-group-dynamic-editor footer').getByRole('button',{name:'Thêm điều kiện',exact:true}).click();await page.getByRole('button',{name:'Lưu bộ lọc',exact:true}).click();
 const calls=await page.evaluate(()=>window.calls);assert.equal(calls.find(c=>c[0]==='createGroup')[1].boundZaloAccountId,11);assert.equal(calls.find(c=>c[0]==='saveFilter')[1].rules[0].accountId,null);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:['create/edit modal from sidebar and info panel','focus trap and return','busy close protection','account eligibility for manual/auto/mixed groups','disabled reasons before save','account availability retry','stale response fence','names/status table','optional account/type visibility/reset','Zalo-only options','create payload','inherited dynamic account','four friendship choices','no idle polling','manual refresh','unsaved rule protection','filter save'],screenshots:[dir+'/create.png',dir+'/filter.png']}));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1})

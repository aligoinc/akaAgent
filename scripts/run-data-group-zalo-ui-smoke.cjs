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
const accounts=[{id:11,name:'Zalo A',flatformType:'zalo',isDelete:false},{id:12,name:'Zalo B',flatformType:'zalo',isDelete:false},{id:13,name:'Facebook C',flatformType:'facebook',isDelete:false}];
const types=[{id:101,code:'zalo_person',name:'Zalo · User theo UID'},{id:102,code:'zalo_group',name:'Zalo · Group/link'},{id:103,code:'phone',name:'Số điện thoại'}];
let groups=[{id:1,name:'Khách Zalo',color:'#10b981',revision:1,dataTypeCode:'zalo_person',dataTypeName:types[0].name,dataTypeCategoryItemId:101,boundZaloAccountId:11,boundZaloAccountName:'Zalo A',activeMembershipCount:1,isDelete:false,datasetSyncMode:'manual'}];
const members=[{id:1,contactId:1,groupId:1,name:'Tên cũ',zaloName:'Nguyễn An',displayName:'An - cửa hàng',zaloFriendStatus:'request_received',contactType:'person',flatformType:'zalo',sourceAccountId:11,uid:'123456',isDelete:false,provenance:[]}];
window.calls=[];
const fields=[['zalo_tag','Tag Zalo'],['akabiz_tag','Tag akaBiz'],['zalo_friend_status','Trạng thái bạn bè Zalo']].map(([code,name],id)=>({id,code,name,metadata:{},sortOrder:id}));
const values=[{key:'11:1',label:'Khách mới',fieldCode:'zalo_tag',accountId:11,accountName:'Zalo A'}, ...[['friend','Bạn bè'],['request_sent','Gửi lời mời kết bạn'],['request_received','Nhận kết bạn'],['stranger','Người lạ']].map(([key,label])=>({key,label,fieldCode:'zalo_friend_status',accountId:null}))];
const configs={};
window.electronAPI={
 listAccounts:async()=>accounts,listDataTypeCategoryItems:async()=>types,
 listDataGroups:async()=>({groups,total:groups.length}),
 listDataGroupMembers:async q=>{window.calls.push(['listMembers',q]);return {members:q.groupId===1?members:[],total:q.groupId===1?1:0}},
 listDataGroupDatasets:async()=>[],getDataGroupLatestIngestStats:async()=>({}),
 getDataGroupPanel:async id=>({group:{...groups.find(g=>g.id===id),creatorName:'Người kiểm thử'},summary:{activeMembershipCount:1,runCount:0,campaignCount:0},quality:{withLinkCount:0,withPhoneCount:0,withUidCount:1,duplicateCount:0},sourceBreakdown:[],dataTypeBreakdown:[],accountBreakdown:[],tags:[],history:[],campaigns:[]}),
 getDataGroupDynamicFilter:async id=>{window.calls.push(['getFilter',id]);return configs[id]||{groupId:id,boundZaloAccountId:groups.find(g=>g.id===id).boundZaloAccountId,isEnabled:false,revision:1,matchedCount:0,lastEnteredCount:0,lastExitedCount:0,rules:[],catalog:{fields,operators:[],scopes:[],joins:[]},values,accounts}},
 saveDataGroupDynamicFilter:async r=>{window.calls.push(['saveFilter',r]);return configs[r.groupId]={...await window.electronAPI.getDataGroupDynamicFilter(r.groupId),...r}},
 createDataGroup:async r=>{window.calls.push(['createGroup',r]);const t=types.find(t=>t.id===r.dataTypeCategoryItemId);const g={...r,id:groups.length+1,dataTypeCode:t?.code,dataTypeName:t?.name,activeMembershipCount:0,isDelete:false};groups=[g,...groups];return g},
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
 await page.getByRole('button',{name:'Thêm nhóm',exact:true}).click();
 assert.equal(await page.locator('#data-group-manager-new-account').count(),0);
 await page.locator('#data-group-manager-new-type').selectOption('101');
 assert.equal(await page.locator('#data-group-manager-new-account').inputValue(),'');
 assert.equal(await page.locator('#data-group-manager-new-account option').count(),3);
 await page.locator('#data-group-manager-new-account').selectOption('11');
 await page.screenshot({path:dir+'/create.png',fullPage:true});
 await page.locator('#data-group-manager-new-type').selectOption('103');assert.equal(await page.locator('#data-group-manager-new-account').count(),0);
 await page.locator('#data-group-manager-new-type').selectOption('101');assert.equal(await page.locator('#data-group-manager-new-account').inputValue(),'');
 await page.locator('#data-group-manager-new-account').selectOption('11');await page.locator('#data-group-manager-new-name').fill('Nhóm gắn A');await page.getByRole('button',{name:'Tạo',exact:true}).click();
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
 console.log(JSON.stringify({passed:true,checks:['names/status table','optional account/type visibility/reset','Zalo-only options','create payload','inherited dynamic account','four friendship choices','no idle polling','manual refresh','unsaved rule protection','filter save'],screenshots:[dir+'/create.png',dir+'/filter.png']}));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1})

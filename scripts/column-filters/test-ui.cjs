// Real React forms in Chromium with deterministic IPC fixtures; no account or network traffic.
const esbuild=require('esbuild'),{chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'column-filters-ui-'))
let code=fs.readFileSync(path.join(root,'scripts/run-data-group-zalo-ui-smoke.cjs'),'utf8').match(/const code=`([\s\S]*?)`\n;\(async/)[1]
code=code.replace("import React from 'react';", "import React from 'react'; import Scan from './src/renderer/src/components/DataScan/DataScanModal'; import {useAuthStore} from './src/renderer/src/stores/authStore';")
code=code.replace("createRoot(document.getElementById('root')).render(<Modal initialGroupId={1} onClose={()=>{}} />);",`
const data=Array.from({length:250},(_,n)=>({...members[0],id:1000+n,contactId:2000+n,name:'Khách '+n,zaloName:n<150?'Nguyễn An '+n:'Bình '+n,displayName:'Khách '+n,uid:'00'+n,phone:'090'+String(n).padStart(7,'0')}));
window.electronAPI.cancelDataColumnFilters=async(formId,requestId)=>{window.calls.push(['cancel',formId,requestId]);return true};
const filtered=q=>data.filter(row=>(q.columnFilters?.filters||[]).every(f=>f.field==='name'?row.zaloName.toLocaleLowerCase('vi').includes(String(f.value).toLocaleLowerCase('vi')):f.field==='uid'?row.uid===f.value:true));
window.electronAPI.readDataColumnFilters=async request=>{
 window.calls.push(['filtered',request]);
 if(window.failRead)throw new Error('Truy vấn lọc quá thời gian cho phép. Hãy thu hẹp điều kiện rồi thử lại.');
 if(window.deferRead)await new Promise(resolve=>window.resolveRead=resolve);
 if(window.backendAbsent)return {available:false,contacts:[],members:[],ids:[],total:0};
 const rows=filtered(request.query),page=rows.slice(request.query.offset||0,(request.query.offset||0)+(request.query.limit||100));
 return {available:true,total:rows.length,members:request.source==='data_group'?page:[],contacts:request.source==='data_group'?[]:page.map(r=>({...r,name:r.zaloName,accountId:13,contactType:'person'})),ids:[]};
};
window.electronAPI.exportDataColumnFilters=async(request,idsOnly)=>{window.calls.push(['filteredExport',request,idsOnly]);const rows=filtered(request.query);return {available:true,total:rows.length,members:rows,contacts:rows,ids:idsOnly?rows.map(r=>r.id):[]}};
window.electronAPI.listDataGroupMemberIds=async()=>({ids:[1],total:1});
window.electronAPI.listContactsPage=async()=>({contacts:[],total:0});
window.electronAPI.listContactDatasets=async()=>[];
window.electronAPI.listContacts=async()=>[];
window.electronAPI.getAkaBizContactTags=async()=>[];
window.electronAPI.listAkaBizContactTags=async()=>[];
window.electronAPI.getZaloServerOperationStates=async()=>[];
window.electronAPI.onContactsLoadProgress=()=>()=>{};
window.electronAPI.onContactsLoadComplete=()=>()=>{};
window.electronAPI.onZaloServerOperationState=()=>()=>{};
useAuthStore.setState({user:{staffId:1,organizationId:1,entitlements:{facebookCore:true,facebookFanpage:true,zalo:true}}});
const view=createRoot(document.getElementById('root'));
window.showGroup=()=>view.render(<Modal key="group" initialGroupId={1} onClose={()=>view.render(null)}/>);
window.showScan=()=>view.render(<Scan key="scan" initialAction="facebook_friends" initialAccountId={13} lockAction onClose={()=>view.render(null)}/>);
window.showGroup();
`)
;(async()=>{
 await esbuild.build({stdin:{contents:code,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',outfile:dir+'/app.js',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},loader:{'.woff2':'file','.woff':'file','.ttf':'file','.svg':'file','.png':'file'}})
 fs.writeFileSync(dir+'/index.html','<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
 const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(name.includes('..')){res.writeHead(400);return res.end()}const file=path.join(dir,name);if(!fs.existsSync(file)){res.writeHead(404);return res.end()}res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser
 try{browser=await chromium.launch({headless:true})}catch{browser=await chromium.launch({headless:true,channel:'chrome'})}
 const page=await browser.newPage({viewport:{width:1500,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let checks=0
 const open=async label=>{await page.getByRole('button',{name:'Lọc cột '+label,exact:true}).click();return page.getByRole('dialog',{name:'Lọc '+label,exact:true})}
 try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('cell',{name:'Nguyễn An 0',exact:true}).waitFor();
 // A rejected column draft must leave the existing filter, selection and request intact.
 await page.getByRole('combobox',{name:'Hiển thị',exact:true}).selectOption('friend');
 await page.waitForFunction(()=>window.calls.filter(c=>c[0]==='filtered').at(-1)[1].query.status==='friend');
 await page.locator('.data-group-manager-table tbody input[type=checkbox]').first().check();
 const statusDialog=await open('Trạng thái');
 const beforeInvalid=await page.evaluate(()=>window.calls.filter(c=>['filtered','cancel'].includes(c[0])));
 await statusDialog.getByRole('button',{name:'Áp dụng',exact:true}).click();await statusDialog.getByRole('alert').waitFor();
 assert.equal(await page.getByRole('combobox',{name:'Hiển thị',exact:true}).inputValue(),'friend');
 assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>['filtered','cancel'].includes(c[0]))),beforeInvalid);
 assert.equal(await page.locator('.data-group-manager-table tbody input[type=checkbox]:checked').count(),1);checks++;
 await statusDialog.press('Escape');assert.equal(await page.getByRole('combobox',{name:'Hiển thị',exact:true}).inputValue(),'friend');checks++;
 const validStatus=await open('Trạng thái');await validStatus.getByRole('checkbox',{name:'Gửi lời mời kết bạn',exact:true}).check();
 await validStatus.getByRole('button',{name:'Áp dụng',exact:true}).click();
 await page.waitForFunction(()=>{const q=window.calls.filter(c=>c[0]==='filtered').at(-1)[1].query;return q.status==='all'&&q.columnFilters.filters.some(f=>f.field==='status'&&f.value[0]==='request_sent')});
 assert.equal(await page.locator('.data-group-manager-table tbody input[type=checkbox]:checked').count(),0);checks++;
 await page.getByRole('button',{name:'Bỏ điều kiện Trạng thái',exact:true}).click();
 await page.waitForFunction(()=>window.calls.filter(c=>c[0]==='filtered').at(-1)[1].query.columnFilters.filters.length===0);
 let dialog=await open('Tên');await dialog.getByLabel('Giá trị',{exact:true}).fill('nguyễn');let before=await page.evaluate(()=>window.calls.filter(c=>c[0]==='filtered').length);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c[0]==='filtered').length),before);checks++
 await dialog.getByRole('button',{name:'Áp dụng',exact:true}).click();await page.getByRole('button',{name:'Bỏ điều kiện Tên',exact:true}).waitFor();await page.waitForFunction(()=>window.calls.filter(c=>c[0]==='filtered').at(-1)[1].query.columnFilters.filters[0]?.value==='nguyễn');checks++
 // Check native checkbox selects every filtered membership, including later pages.
 await page.locator('.data-group-manager-table thead input[type=checkbox]').check();await page.waitForFunction(()=>window.calls.some(c=>c[0]==='filteredExport'&&c[2]===true));assert.equal(await page.evaluate(()=>window.calls.filter(c=>c[0]==='filteredExport').at(-1)[1].query.columnFilters.filters[0].value),'nguyễn');checks++
 dialog=await open('UID');await dialog.getByLabel('Điều kiện',{exact:true}).selectOption('eq');await dialog.getByLabel('Giá trị',{exact:true}).fill('001');await dialog.getByRole('button',{name:'Áp dụng',exact:true}).click();await page.waitForFunction(()=>window.calls.filter(c=>c[0]==='filtered').at(-1)[1].query.columnFilters.filters.length===2);assert.equal(await page.locator('.data-group-manager-table tbody input[type=checkbox]:checked').count(),0);checks++
 await page.getByRole('button',{name:'Bỏ điều kiện UID',exact:true}).click();await page.getByRole('button',{name:'Xóa lọc cột',exact:true}).click();await page.waitForFunction(()=>window.calls.filter(c=>c[0]==='filtered').at(-1)[1].query.columnFilters.filters.length===0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c[0]==='filtered').at(-1)[1].query.groupId),1);checks++
 dialog=await open('Tên');await dialog.getByLabel('Giá trị',{exact:true}).fill('chưa áp dụng');await dialog.press('Escape');assert.equal(await page.getByRole('dialog',{name:'Lọc Tên',exact:true}).count(),0);assert.equal(await page.getByRole('dialog',{name:'Quản lý nhóm data',exact:true}).count(),1);checks++
 await page.evaluate(()=>window.showScan());await page.getByRole('cell',{name:'Nguyễn An 0',exact:true}).waitFor();dialog=await open('Tên');await dialog.getByLabel('Giá trị',{exact:true}).fill('Bình');await dialog.getByRole('button',{name:'Áp dụng',exact:true}).click();await page.getByRole('cell',{name:'Bình 150',exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'Nguyễn An 0',exact:true}).count(),0);checks++
 dialog=await open('Tên');await page.screenshot({path:dir+'/scan-filter.png',fullPage:true});const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=1500);checks++
 await dialog.press('Escape');
 await page.evaluate(()=>window.failRead=true);dialog=await open('Tên');await dialog.getByLabel('Giá trị',{exact:true}).fill('Timeout');await dialog.getByRole('button',{name:'Áp dụng',exact:true}).click();await page.waitForFunction(()=>window.calls.some(c=>c[0]==='alert'&&String(c[1]).includes('quá thời gian')));assert.equal(await page.getByRole('cell',{name:'Bình 150',exact:true}).count(),0);await page.getByRole('button',{name:'Bỏ điều kiện Tên',exact:true}).waitFor();checks++;
 await page.evaluate(()=>window.failRead=false);dialog=await open('Tên');await dialog.getByLabel('Giá trị',{exact:true}).fill('Bình');await dialog.getByRole('button',{name:'Áp dụng',exact:true}).click();await page.getByRole('cell',{name:'Bình 150',exact:true}).waitFor();checks++;
 // A response from the unmounted scan form must not replace the newly opened Data form.
 await page.evaluate(()=>window.deferRead=true);dialog=await open('Tên');await dialog.getByLabel('Giá trị',{exact:true}).fill('Nguyễn');await dialog.getByRole('button',{name:'Áp dụng',exact:true}).click();await page.waitForFunction(()=>!!window.resolveRead);await page.evaluate(()=>{window.deferRead=false;window.showGroup()});await page.getByRole('cell',{name:'Nguyễn An 0',exact:true}).waitFor();await page.evaluate(()=>window.resolveRead());await page.waitForTimeout(50);assert.equal(await page.getByRole('dialog',{name:'Quản lý nhóm data',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Bỏ điều kiện Tên',exact:true}).count(),0);checks++;
 await page.evaluate(()=>window.showScan());await page.getByRole('cell',{name:'Nguyễn An 0',exact:true}).waitFor();await page.evaluate(()=>{window.backendAbsent=true;window.showGroup()});await page.getByText('Bộ lọc cột cần cập nhật backend.',{exact:false}).waitFor();assert.ok(await page.getByRole('button',{name:'Lọc cột Tên',exact:true}).isDisabled());await page.getByRole('cell',{name:'Nguyễn An',exact:true}).waitFor();checks++
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,screenshot:dir+'/scan-filter.png',errors}))
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1})

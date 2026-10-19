const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const requireRepo = require('node:module').createRequire(path.join(root,'package.json'));
const {build}=requireRepo('esbuild');
const {_electron}=requireRepo('playwright');
const ts=requireRepo('typescript');
const vm=require('node:vm');
const repoText=fs.readFileSync(path.join(root,'src/main/data/repositories/campaignRepository.ts'),'utf8');
const guardStart=repoText.indexOf('export async function createCampaign(');
const guardEnd=repoText.indexOf('  const secondaryAccountId =',guardStart);
const guardCode=ts.transpileModule(repoText.slice(guardStart,guardEnd)+'\nreturn {accountId};\n}',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const guard={exports:{},requireCurrentUser:()=>({staffId:41}),ensureCurrentUserCanUseCampaignAction:async()=>{},accountRepo:{getAccount:async id=>[41,42].includes(id)?{id}:null}};
vm.runInNewContext(guardCode,guard);
const source=`
import React from 'react';
import {root} from './scripts/campaign-pending-reason-ui-smoke';
import CampaignPanel from './src/renderer/src/components/CampaignPanels/CampaignPanel';
import CampaignEditDialogs from './src/renderer/src/components/CampaignPanels/CampaignEditDialogs';
import AlertModal from './src/renderer/src/components/CampaignPanels/AlertModal';
import {useAuthStore} from './src/renderer/src/stores/authStore';
import {normalizeEntitlements} from './src/renderer/src/utils/entitlements';
const base=(window as any).pendingSmoke;
const state:any={configReads:[],createAttempts:[],writes:[],dataWrites:[],pauses:0};
const old=window.electronAPI;
base.patch(91,{accountId:6271,accountName:'Tài khoản đã xóa',actionId:'zalo_message_phone',name:'Clone account deleted',scheduleType:'daily',dataTargetSourceMode:'direct',content:'Nội dung kiểm thử',images:[],extraSettings:{enableMessage:true,advancedContentEnabled:true,advancedContentSource:'manual'}});
useAuthStore.setState({user:{staffId:41,organizationId:1,entitlements:normalizeEntitlements({zalo:true,facebookCore:true}),zaloAccountCapabilities:{qr:true,web:true,server:false}} as any});
base.store.setState({accountCatalogVersion:'fixture-v1',loadingAccounts:false,accounts:[{id:41,name:'Tài khoản còn hoạt động',flatformType:'zalo',isActive:true,isDelete:false,isZaloShowWeb:false,isZaloServer:false,staffId:41,organizationId:1,loginStatus:'đã đăng nhập',status:'chờ xử lý'}],campaignActions:[{id:'zalo_message_phone',name:'Zalo - Nhắn tin, kết bạn đến SĐT',flatformType:'zalo',isActive:true,isDelete:false,allowMultipleAccounts:true,allowSecondaryAccount:true}]});
window.electronAPI=new Proxy(old,{get(target,key){
 if(key==='getDesktopCampaignConfig')return async(id:number)=>{state.configReads.push(id);return {...base.store.getState().campaigns.find((c:any)=>c.id===id)};};
 if(key==='listCampaignInputData')return async()=>[{id:1,phone:'0901234567',name:'Khách thử',status:'chờ xử lý'}];
 if(key==='getCampaignInputDataLimit')return async()=>10000;
 if(key==='getCampaignActionUsage')return async()=>[];
 if(key==='listSendExclusionGroups')return async()=>({groups:[],blocklists:[],options:[],catalog:{fields:[],operators:[],fieldOperators:[]}});
 if(key==='createCampaign')return async(payload:any)=>{state.createAttempts.push(payload);await (window as any).cloneGuard(payload);return {...payload,id:101+state.createAttempts.length};};
 if(key==='createCampaignInputDataBatch')return async(rows:any[])=>{state.dataWrites.push(rows);return rows.length;};
 if(key==='updateCampaign')return async(id:number,payload:any)=>{state.writes.push({id,...payload});if(id===91){state.pauses++;throw Error('UNEXPECTED_SOURCE_UPDATE');}return {id,...payload};};
 return Reflect.get(target,key);
}});
(window as any).cloneRepro={state,base,account:base.store.getState().accounts[0]};
root.render(<><div style={{height:'100vh'}}><CampaignPanel isActive/></div><CampaignEditDialogs/><AlertModal/></>);
`;
(async()=>{
 const dir=fs.mkdtempSync('/tmp/aka-clone-repro-');let app,page;
 try{
  await build({stdin:{contents:source,resolveDir:root,sourcefile:'clone-repro.tsx',loader:'tsx'},outfile:path.join(dir,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',target:'chrome120',define:{'process.env.NODE_ENV':'"development"'},loader:{'.png':'dataurl','.svg':'dataurl'},logLevel:'warning'});
  fs.writeFileSync(path.join(dir,'index.html'),'<html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body><div id="root"></div><script src="app.js"></script></body></html>');
  fs.writeFileSync(path.join(dir,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,c)=>c({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir,'index.html'))})});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:requireRepo('electron'),args:[path.join(dir,'main.cjs')],cwd:root,env});
  page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>console.error('PAGE_ERROR',e.stack));page.on('console',msg=>{if(msg.type()==='error')console.error('UI_ERROR',msg.text());});
  await page.exposeFunction('cloneGuard',async payload=>{await guard.exports.createCampaign(payload);return true;});
  const wait = () => page.waitForFunction(()=>!!window.cloneRepro);
  const open = async () => {
    const row=page.locator('.campaign-table-row').filter({has:page.getByText('Clone account deleted',{exact:true})});
    await row.getByRole('button',{name:'Hành động',exact:true}).click();
    await page.getByText('Nhân bản',{exact:true}).click();
    await page.getByRole('button',{name:'Lưu chiến dịch',exact:true}).waitFor();
  };
  const save = async () => {
    await page.getByRole('button',{name:'Cơ bản',exact:true}).click();
    await page.getByRole('button',{name:'Lưu chiến dịch',exact:true}).click();
    await page.getByRole('dialog',{name:'Trạng thái sau khi lưu',exact:true}).getByRole('button',{name:'Tạm dừng',exact:true}).click();
    await page.getByText('Lưu chiến dịch thành công!',{exact:true}).waitFor();
    const s=await page.evaluate(()=>window.cloneRepro.state);
    assert.equal(s.pauses,0);assert(s.createAttempts.every(p=>[41,42].includes(p.accountId)));
    assert(s.dataWrites.length>0);assert.equal(s.writes.length,0);
    return s;
  };
  const cases=[];
  for (const mode of ['deleted','secondary-deleted','secondary-only','multiple','valid','delayed-valid','delayed-empty','load-failed']) {
    if(cases.length)await page.reload();await wait();
    await page.evaluate(mode=>{
      const {base}=window.cloneRepro;
      if(mode==='valid'||mode==='delayed-valid'||mode==='secondary-only')base.patch(91,{accountId:41});
      if(mode==='secondary-deleted'||mode==='secondary-only')base.patch(91,{secondaryAccountId:6272});
      if(mode==='multiple')base.store.setState({accounts:[window.cloneRepro.account,{...window.cloneRepro.account,id:42,name:'Tài khoản thứ hai'}]});
      if(mode.startsWith('delayed')||mode==='load-failed')base.store.setState({accounts:[],accountCatalogVersion:undefined,loadingAccounts:mode!=='load-failed',accountsReadAt:Date.now()});
    },mode);
    await open();
    if(mode.startsWith('delayed')||mode==='load-failed') {
      await page.getByText('Đã chọn 1 tài khoản',{exact:true}).waitFor();
      assert.equal(await page.getByText('Tài khoản của chiến dịch gốc không còn khả dụng. Vui lòng chọn tài khoản khác.',{exact:true}).count(),0);
      if(mode==='load-failed') {
        await page.getByRole('button',{name:'Lưu chiến dịch',exact:true}).click();
        await page.getByText('Chưa tải xong danh sách tài khoản. Vui lòng tải lại danh sách trước khi lưu chiến dịch.',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.cloneRepro.state.createAttempts.length),0);
        cases.push(mode);continue;
      }
      await page.evaluate(mode=>{
        const {base,account}=window.cloneRepro;
        base.store.setState({accounts:mode==='delayed-valid'?[account]:[],accountCatalogVersion:'fixture-ready',loadingAccounts:false});
      },mode);
      if(mode==='delayed-empty') {
        await page.getByText('-- Chọn tài khoản --',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Lưu chiến dịch',exact:true}).click();
        await page.getByText('Vui lòng nhập Tên, Hành động và Tài khoản.',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.cloneRepro.state.createAttempts.length),0);
        cases.push(mode);continue;
      }
    }
    if(mode==='deleted'||mode==='secondary-deleted'||mode==='multiple') {
      await page.getByText('Tài khoản của chiến dịch gốc không còn khả dụng. Vui lòng chọn tài khoản khác.',{exact:true}).waitFor();
      await page.getByText('-- Chọn tài khoản --',{exact:true}).click();
      await page.locator('.account-select-account-row').filter({hasText:'Tài khoản còn hoạt động'}).getByRole('checkbox').check();
      if(mode==='multiple') {
        await page.locator('.account-select-account-row').filter({hasText:'Tài khoản thứ hai'}).getByRole('checkbox').check();
        await page.getByText('Đã chọn 2 tài khoản',{exact:true}).click();
      } else {
        await page.locator('.stepper-input').filter({hasText:'Tài khoản còn hoạt động —'}).click();
        assert.equal(await page.getByText('Đã chọn 2 tài khoản',{exact:true}).count(),0);
      }
    }
    const s=await save();
    assert.equal(s.createAttempts.length,mode==='multiple'?2:1);assert.equal(s.createAttempts[0].accountId,41);
    if(mode==='multiple')assert.equal(s.createAttempts[1].accountId,42);
    assert.equal(s.createAttempts[0].secondaryAccountId,null);
    cases.push(mode);
  }
  console.log(JSON.stringify({result:'PASS',cases}));
 }catch(e){if(page){console.error((await page.locator('body').innerText()).slice(-7000));console.error(await page.evaluate(()=>window.cloneRepro?.base.state.errors));}throw e;}
 finally{if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

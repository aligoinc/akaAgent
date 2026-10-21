// Real Electron importer UI with local IPC fixtures; never connects to customer services.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const XLSX = require('xlsx')
const { build } = require('esbuild')
const { _electron } = require('playwright')
const headers = ['Fullname','Uid','Mobile','Email','Info1','Info2','Info3','Info4','Info5']
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afo0AAAAASUVORK5CYII=', 'base64')
const file = (sheets, name = 'source.xlsx') => {
  const book = XLSX.utils.book_new()
  for (const [name, rows, configure] of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(rows); if (configure) configure(sheet)
    XLSX.utils.book_append_sheet(book, sheet, name)
  }
  return { name, mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, {type:'buffer',bookType:'xlsx'}) }
}
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'aka-import-ui-'))
  let app
  try {
    await build({ stdin: {resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Upload from './src/renderer/src/components/CampaignPanels/CampaignDataUploadModal';
import {useUiStore} from './src/renderer/src/stores/uiStore';
import {imageImportRows} from './src/shared/campaignImportVerification';
import './src/renderer/src/styles/global.css';
const state={alerts:[],exports:[],inserted:[],sheetCalls:0,imageCalls:0,delaySheet:false,delayImage:false};
const table={name:'Sheet từ link',rows:[['Tên','SĐT','Info1'],['An','0912345678','Căn 12'],['Trùng','+84912345678','Căn 14'],['Sai','bad','']].map(r=>r.map(v=>({value:v,text:v}))),rowNumbers:[1,2,3,4]};
const image=r=>({rows:imageImportRows(state.imageRows||[{phone:'0912345678',name:'An'},{phone:'+84912345678'},{phone:'bad'},{name:'Thiếu'}],r.platform,r.actionId)});
window.electronAPI={
 loadCampaignDataFromSheet:async r=>{if(r.responseMode!=='source')throw Error('Missing source mode');state.sheetCalls++;if(state.delaySheet)return new Promise((resolve,reject)=>{state.finishSheet=()=>resolve({tables:[table]});state.failSheet=()=>reject(Error('old sheet error'))});return {tables:[table]}},
 extractCampaignDataFromImage:async r=>{if(r.responseMode!=='source')throw Error('Missing source mode');state.imageCalls++;if(state.delayImage)return new Promise((resolve,reject)=>{state.finishImage=()=>resolve(image(r));state.failImage=()=>reject(Error('old image error'))});return image(r)}
};
useUiStore.setState({showAlert:(message,type)=>state.alerts.push({message,type})});
function App(){
 const [view,setView]=useState({key:0,actionId:'zalo_message_phone',open:true});
 window.importSmoke={state,open:(actionId='zalo_message_phone')=>{state.alerts=[];state.exports=[];state.inserted=[];setView(v=>({key:v.key+1,actionId,open:true}))},changeAction:actionId=>setView(v=>({...v,actionId})),close:()=>setView(v=>({...v,open:false})),captureExport:(book,name)=>state.exports.push({book,name})};
 return view.open?<Upload key={view.key} platform="zalo" actionId={view.actionId} accountIds={[]} showDatasetName={false} onClose={()=>setView(v=>({...v,open:false}))} onInsert={()=>{}} onSubmitRows={({rows})=>{state.inserted=rows}}/>:<div>Đã đóng</div>;
}
createRoot(document.getElementById('root')).render(<App/>);
` }, outfile:path.join(dir,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',target:'chrome120',define:{'process.env.NODE_ENV':'"development"'},logLevel:'warning',
      plugins:[{name:'capture-real-export-workbook',setup(b){b.onLoad({filter:/CampaignDataUploadModal\.tsx$/},args=>({loader:'tsx',contents:fs.readFileSync(args.path,'utf8').replace('writeFile(book,',';(window as any).importSmoke.captureExport(book,')}))}}] })
    fs.writeFileSync(path.join(dir,'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body><div id="root"></div><script src="app.js"></script></body></html>')
    fs.writeFileSync(path.join(dir,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1500,height:1200,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,c)=>c({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir,'index.html'))})})`)
    const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE
    app=await _electron.launch({executablePath:require('electron'),args:[path.join(dir,'main.cjs')],cwd:process.cwd(),env})
    const page=await app.firstWindow(); page.setDefaultTimeout(15000)
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    const modal=page.locator('.campaign-import-modal')
    await modal.waitFor()
    const open=async actionId=>{await page.evaluate(id=>window.importSmoke.open(id),actionId);await modal.locator('textarea').waitFor();await page.waitForFunction(()=>document.querySelector('#campaign-import-textbox')?.value==='')}
    const tab=label=>modal.getByRole('tab',{name:label,exact:true}).click()
    const verify=async()=>{
      await modal.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click()
      try {await modal.locator('.campaign-import-results').waitFor()}
      catch(error){console.error('Verification alerts:',JSON.stringify(await page.evaluate(()=>window.importSmoke.state.alerts)));throw error}
    }
    const resultCounts=async()=> (await modal.locator('.campaign-import-result-group strong').allTextContents()).map(text=>Number(text.replace(/\D/g,'')))
    const checkCounts=async expected=>assert.deepEqual(await resultCounts(),expected)
    const insertButton=modal.locator('.modal-footer .btn-primary')
    const state=()=>page.evaluate(()=>window.importSmoke.state)
    const validPreview=modal.locator('.campaign-import-preview-table')
    const exportGroup=index=>modal.locator('.campaign-import-result-group').nth(index).getByRole('button',{name:/Tải Excel/}).click()
    const uploadFile=payload=>modal.locator('input[type=file]').setInputFiles(payload)

    await modal.locator('textarea').fill('0912345678,0987654321;bad\n+84912345678')
    await verify();await checkCounts([2,1,1])
    assert.match(await modal.locator('.campaign-import-results').innerText(),/2 dòng nguồn · 4 mục sau tách/)
    for(let i=0;i<3;i++)await exportGroup(i)
    const exports=(await state()).exports
    assert.equal(exports.length,3)
    for(let i=0;i<3;i++){
      assert.match(exports[i].name,[/^du-lieu-hop-le-.*\.xlsx$/, /^du-lieu-bi-loai-.*\.xlsx$/, /^du-lieu-trung-.*\.xlsx$/][i])
      const book=XLSX.read(XLSX.write(exports[i].book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'})
      const rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,raw:true})
      assert.equal(rows.length-1,[2,1,1][i]);assert.equal(book.Sheets[book.SheetNames[0]].C2.t,'s')
    }
    await modal.locator('.campaign-import-result-group').nth(2).getByRole('button').first().click()
    assert.match(await validPreview.innerText(),/Trùng dữ liệu sau chuẩn hóa/)
    await insertButton.click();await modal.waitFor({state:'detached'})
    assert.deepEqual((await state()).inserted.map(row=>row.phone),['0912345678','0987654321'])
    console.log('PASS UI: counts, lineage, three separate Excel files, valid-only insertion')

    await open();await modal.locator('textarea').fill('bad\nwrong');await verify();await checkCounts([0,2,0])
    assert(await insertButton.isDisabled());assert(await modal.locator('.campaign-import-result-group').first().getByRole('button',{name:/Tải Excel/}).isDisabled())
    await exportGroup(1)
    await modal.locator('textarea').fill('0912345678');assert.equal(await modal.locator('.campaign-import-results').count(),0);assert(await insertButton.isDisabled())
    console.log('PASS UI: zero valid report/download and edit invalidation')

    await open();await tab('File Excel/CSV của khách hàng')
    await uploadFile(file([['Data',[['SĐT'],['0912345678'],['error']],sheet=>{sheet.A3={t:'e',v:15,f:'1/0'}}]]))
    await verify();await checkCounts([1,1,0])
    assert.match(await modal.locator('.campaign-import-results').innerText(),/2 dòng nguồn · 2 mục sau tách/)
    await modal.locator('.campaign-import-result-group').nth(1).getByRole('button').first().click()
    assert.match(await validPreview.innerText(),/#VALUE!/);assert.match(await validPreview.innerText(),/lỗi Excel/);assert.match(await validPreview.innerText(),/dòng 3/)
    await exportGroup(1)
    const errorExport=XLSX.read(XLSX.write((await state()).exports[0].book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}).Sheets['Bị loại']
    assert.equal(errorExport.C2.v,'#VALUE!');assert.equal(errorExport.C2.t,'s');assert.equal(errorExport.N2.v,'#VALUE!');assert.match(errorExport.Q2.v,/lỗi Excel #VALUE!/)
    await insertButton.click();await modal.waitFor({state:'detached'});assert.deepEqual((await state()).inserted.map(row=>row.phone),['0912345678'])
    await open();await tab('Từ template Excel akaBiz')
    await uploadFile(file([['Data',[headers,['','','error']],sheet=>{sheet.C2={t:'e',v:42}}]]))
    await modal.locator('.campaign-import-results').waitFor();await checkCounts([0,1,0]);assert(await insertButton.isDisabled());await exportGroup(1)
    assert.equal((await state()).exports[0].book.Sheets['Bị loại'].C2.v,'#N/A')
    console.log('PASS UI: Excel error rows counted/rejected/exported with evidence; valid-only insertion and all-error template report')

    const legacyBook=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(legacyBook,XLSX.utils.aoa_to_sheet([headers,['An','','0912345678','','000123','a,b;c','','','']]),'Data')
    for(const [bookType,tabName] of [['xml','File Excel/CSV của khách hàng'],['xml','Từ template Excel akaBiz'],['biff2','File Excel/CSV của khách hàng'],['biff8','File Excel/CSV của khách hàng']]){
      await open();await tab(tabName)
      await uploadFile({name:'customer.xls',mimeType:'application/vnd.ms-excel',buffer:XLSX.write(legacyBook,{type:'buffer',bookType})})
      if(tabName==='Từ template Excel akaBiz')await modal.locator('.campaign-import-results').waitFor();else await verify()
      await checkCounts([1,0,0]);assert.equal((await state()).alerts.some(a=>a.type==='error'),false)
      await insertButton.click();await modal.waitFor({state:'detached'})
      assert.deepEqual((await state()).inserted.map(({name,phone,info1,info2})=>({name,phone,info1,info2})),[{name:'An',phone:'0912345678',info1:'000123',info2:'a,b;c'}])
    }
    await open();await tab('File Excel/CSV của khách hàng')
    await uploadFile({name:'broken.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('not an XLSX archive')})
    await page.waitForFunction(()=>window.importSmoke.state.alerts.some(a=>a.type==='error'));assert(await insertButton.isDisabled())
    console.log('PASS UI: XML XLS customer/template, BIFF2/8, exact recipient/metadata insertion and corrupt XLSX guard')

    await open();await modal.locator('textarea').fill('SĐT\n0912345678;0987654321')
    assert(await modal.getByRole('checkbox',{name:/Bỏ qua dòng đầu/}).isChecked())
    await verify();await checkCounts([2,0,0])
    await modal.getByRole('checkbox',{name:/Bỏ qua dòng đầu/}).uncheck();assert.equal(await modal.locator('.campaign-import-results').count(),0)
    await verify();await checkCounts([2,1,0])
    console.log('PASS UI: TXT header detection and explicit override')

    await open();await modal.locator('textarea').fill(Array.from({length:251},(_,i)=>`090${String(i).padStart(7,'0')}`).join('\n'));await verify();await checkCounts([251,0,0])
    assert.equal(await validPreview.locator('tbody tr').count(),100)
    await modal.getByRole('button',{name:'Trang sau',exact:true}).click();assert.equal(await validPreview.locator('tbody tr').count(),100)
    await modal.getByRole('button',{name:'Trang sau',exact:true}).click();assert.equal(await validPreview.locator('tbody tr').count(),51)
    await insertButton.click();await modal.waitFor({state:'detached'});assert.equal((await state()).inserted.length,251)
    console.log('PASS UI: pagination does not truncate insertion')

    await open();await tab('File Excel/CSV của khách hàng')
    const multi=file([
      ['First',[['Tên KH','Điện thoại','Info1','Info2'],['First','0841234567','Căn 9','000001']]],
      ['Second',[['Tên KH','Điện thoại','Info1','Info2'],['Bình',84912345678,46315,123],['An','bad;0987654321;0901234567','Căn 12',''],['Dup','+84912345678','','']],s=>{s.B2.z='0.00000E+00';s.C2.z='dd/mm/yyyy';s.D2.z='000000'}]
    ])
    await uploadFile(multi);await modal.getByLabel('Sheet đang đọc',{exact:true}).selectOption('1');await verify();await checkCounts([2,2,1])
    assert.match(await validPreview.innerText(),/0912345678/);assert.match(await validPreview.innerText(),/20\/10\/2026/);assert.match(await validPreview.innerText(),/000123/)
    assert(!/0912300000/.test(await validPreview.innerText()))
    await modal.getByRole('radio',{name:/Lấy tất cả SĐT/}).check();assert.equal(await modal.locator('.campaign-import-results').count(),0);await verify();await checkCounts([3,1,1])
    await modal.getByRole('radio',{name:'Bỏ dòng có nhiều SĐT',exact:true}).check();await verify();await checkCounts([1,3,1])
    await modal.getByRole('radio',{name:'Lấy SĐT hợp lệ đầu tiên',exact:true}).check();await verify();await checkCounts([2,2,1])
    fs.mkdirSync('/tmp/akaagent-import-verification',{recursive:true});await modal.screenshot({path:'/tmp/akaagent-import-verification/report.png'})
    await insertButton.click();await modal.waitFor({state:'detached'});assert.deepEqual((await state()).inserted.map(row=>row.phone),['0912345678','0987654321'])
    console.log('PASS UI: sheet choice, raw numbers, displayed metadata, three phone policies')

    await open();await tab('File Excel/CSV của khách hàng');await uploadFile(file([['Data',[['0912345678'],['0987654321']]]]))
    assert.equal(await modal.getByRole('checkbox',{name:/Bỏ qua dòng đầu/}).isChecked(),false);await verify();await checkCounts([2,0,0])
    await uploadFile(file([['Data',[['SĐT','Phone'],['0912345678','0987654321']]]]))
    await modal.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click();await page.waitForFunction(()=>window.importSmoke.state.alerts.some(a=>a.message.includes('Vui lòng chọn cột')))
    assert.equal(await modal.locator('.campaign-import-results').count(),0)
    console.log('PASS UI: no-header first row and ambiguous required column')

    await open();await tab('File Excel/CSV của khách hàng')
    const multiCsvPhones=['0900000000','0900000001','0900000002','0900000003']
    await uploadFile({name:'multi.csv',mimeType:'text/csv',buffer:Buffer.from(`Tên,SĐT\nAn,${multiCsvPhones.join(';')}`)})
    await verify();await checkCounts([1,3,0])
    await modal.getByRole('radio',{name:/Lấy tất cả SĐT/}).check();await verify();await checkCounts([4,0,0])
    await insertButton.click();await modal.waitFor({state:'detached'})
    assert.deepEqual((await state()).inserted.map(row=>row.phone),multiCsvPhones)
    assert((await state()).inserted.every(row=>row.name==='An'))
    await open();await tab('File Excel/CSV của khách hàng')
    await uploadFile({name:'ambiguous.csv',mimeType:'text/csv',buffer:Buffer.from(`An,${multiCsvPhones.join(';')}`)})
    await page.waitForFunction(()=>window.importSmoke.state.alerts.some(a=>a.message.includes('Không xác định được dấu phân cột CSV')))
    assert(await insertButton.isDisabled());assert.equal(await modal.locator('.campaign-import-results').count(),0)
    console.log('PASS UI: CSV phone lists keep the correct columns; ambiguous CSV cannot silently insert partial data')

    await open('facebook_message_uid');await tab('File Excel/CSV của khách hàng')
    await uploadFile({name:'uids.csv',mimeType:'text/csv',buffer:Buffer.from('UID\n0.100123456789012E+15\n100123456789012\n1.00123E+14\n1.00123456789012E+14')})
    await verify();await checkCounts([1,1,2])
    assert.match(await validPreview.innerText(),/100123456789012/)
    for(let i=0;i<3;i++)await exportGroup(i)
    const uidExports=(await state()).exports
    assert.equal(uidExports[0].book.Sheets['Hợp lệ'].B2.v,'100123456789012')
    assert.equal(uidExports[1].book.Sheets['Bị loại'].B2.v,'1.00123E+14')
    assert.match(uidExports[1].book.Sheets['Bị loại'].Q2.v,/nhập số đầy đủ/)
    assert.match(uidExports[2].book.Sheets['Trùng'].R2.v,/dòng 2/)
    await insertButton.click();await modal.waitFor({state:'detached'})
    assert.deepEqual((await state()).inserted.map(row=>row.uid),['100123456789012'])
    await open('facebook_message_uid');await tab('Từ template Excel akaBiz')
    await uploadFile({name:uidExports[0].name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(uidExports[0].book,{type:'buffer',bookType:'xlsx'})})
    await modal.locator('.campaign-import-results').waitFor();await checkCounts([1,0,0])
    console.log('PASS UI: scientific UID including zero mantissa, dedup/rejection, three exports, valid-only sink and template reimport')

    await open();await modal.locator('textarea').fill('Tên\tSĐT\tInfo1\nAn\t0912345678;0987654321\tCăn 12')
    await verify();await checkCounts([2,0,0]);assert.equal(await modal.locator('.campaign-import-phone-policy').count(),0)
    await insertButton.click();await modal.waitFor({state:'detached'});assert((await state()).inserted.every(row=>row.name==='An'&&row.info1==='Căn 12'))
    console.log('PASS UI: TSV paste mapping preserves metadata and takes all phones')

    await open();await tab('Link sheet');await modal.getByPlaceholder('Nhập link sheet').fill('https://fixture.invalid/data.csv')
    await modal.getByRole('button',{name:'Đọc dữ liệu',exact:true}).click();await modal.getByLabel('Cột Số điện thoại',{exact:true}).waitFor()
    const calls=(await state()).sheetCalls;await verify();await checkCounts([1,1,1])
    await modal.getByLabel('Cột Tên',{exact:true}).selectOption('');assert.equal(await modal.locator('.campaign-import-results').count(),0)
    await verify();await exportGroup(1);assert.equal((await state()).sheetCalls,calls)
    console.log('PASS UI: Sheet mapping/verification/export reuses one fetch')

    await open();await tab('Từ template Excel akaBiz')
    for(const prefix of ['Danh sách khách hàng\n','""\n','Báo cáo, tháng 10\n""\n']){
      await uploadFile({name:'preface.csv',mimeType:'text/csv',buffer:Buffer.from(prefix+headers.join(';')+'\nAn;;0912345678;;Căn 12;000123;;;')})
      await modal.locator('.campaign-import-results').waitFor();await checkCounts([1,0,0])
      assert.match(await validPreview.innerText(),/An/);assert.match(await validPreview.innerText(),/Căn 12/);assert.match(await validPreview.innerText(),/000123/)
      assert.equal(await modal.getByRole('button',{name:'Chuyển sang File Excel/CSV của khách hàng',exact:true}).count(),0)
    }
    await insertButton.click();await modal.waitFor({state:'detached'})
    assert.deepEqual((await state()).inserted.map(({name,phone,info1,info2})=>({name,phone,info1,info2})),[{name:'An',phone:'0912345678',info1:'Căn 12',info2:'000123'}])
    console.log('PASS UI: CSV template accepts prefaces/quoted-empty rows and preserves name/phone/Info through insertion')

    await open();await tab('Từ template Excel akaBiz')
    await uploadFile(file([['Data',[['Tên','SĐT'],['An','0912345678']]]]))
    await modal.getByRole('button',{name:'Chuyển sang File Excel/CSV của khách hàng',exact:true}).click();await verify();await checkCounts([1,0,0])
    await open();await tab('Từ template Excel akaBiz')
    await uploadFile(file([['Invalid',[headers,['Sai','','bad']]],['Valid',[headers,['An','','0912345678;0987654321']]]]))
    await modal.locator('.campaign-import-results').waitFor();await checkCounts([0,1,0]);assert(await insertButton.isDisabled());await exportGroup(1)
    await modal.getByLabel('Sheet đang đọc',{exact:true}).selectOption('1');await checkCounts([1,1,0])
    await modal.getByRole('radio',{name:/Lấy tất cả SĐT/}).check();await checkCounts([2,0,0])
    await open();await tab('File Excel/CSV của khách hàng');assert(await modal.getByRole('radio',{name:'Lấy SĐT hợp lệ đầu tiên',exact:true}).isChecked())
    console.log('PASS UI: template fallback, all-invalid report, automatic reverify, default reset')

    await open();await tab('Ảnh');await uploadFile({name:'fixture.png',mimeType:'image/png',buffer:png});await verify();await checkCounts([1,2,1])
    const imageCalls=(await state()).imageCalls;await exportGroup(0);await exportGroup(1);await exportGroup(2);assert.equal((await state()).imageCalls,imageCalls)
    console.log('PASS UI: image report covers unfiltered AI results without re-extraction on export')

    await open('zalo_join_group_link');await page.evaluate(()=>{window.importSmoke.state.imageRows=[{zaloGroupLink:'https://zalo.me/g/abc123'},{name:'https://zalo.me/g/abc123'},{unrecognized:'Cần đối chiếu'}]})
    await tab('Ảnh');await uploadFile({name:'aliases.png',mimeType:'image/png',buffer:png});await verify();await checkCounts([1,1,1])
    await exportGroup(1)
    assert.match((await state()).exports[0].book.Sheets['Bị loại'].N2.v,/Cần đối chiếu/)
    await page.evaluate(()=>{delete window.importSmoke.state.imageRows})
    console.log('PASS UI: image aliases/name fallback and unknown-record evidence')

    await open();await tab('File Excel/CSV của khách hàng')
    await uploadFile({name:'unicode.csv',mimeType:'text/csv',buffer:Buffer.from('\ufeffTên,SĐT,Info1\r\nNguyễn An,0912345678,Căn 12','utf16le')})
    await verify();await checkCounts([1,0,0]);assert.match(await validPreview.innerText(),/Nguyễn An/);assert.match(await validPreview.innerText(),/Căn 12/)
    console.log('PASS UI: UTF16 CSV')
    const longPhones=Array.from({length:3000},(_,i)=>`090${String(i).padStart(7,'0')}`).join(';')
    await uploadFile({name:'long.csv',mimeType:'text/csv',buffer:Buffer.from(`Tên,SĐT\nAn,${longPhones}\nTrùng,${longPhones}`)})
    await verify();await checkCounts([1,5998,1])
    for(let i=0;i<3;i++)await exportGroup(i)
    const longExports=(await state()).exports
    assert.equal(longExports.length,3)
    for(let i=0;i<3;i++){
      const parsed=XLSX.read(XLSX.write(longExports[i].book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'})
      assert.equal(XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]],{header:1}).length-1,[1,5998,1][i])
      const content=XLSX.utils.sheet_to_json(parsed.Sheets['Nội dung dài'],{header:1}).slice(1)
      assert.equal(content.length,2);assert.equal(content.map(row=>row[2]).join(''),longPhones)
    }
    await open();await tab('Từ template Excel akaBiz')
    await uploadFile({name:longExports[0].name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(longExports[0].book,{type:'buffer',bookType:'xlsx'})})
    await modal.locator('.campaign-import-results').waitFor();await checkCounts([1,0,0])
    assert.equal(await modal.getByLabel('Sheet đang đọc',{exact:true}).locator('option').count(),1)
    console.log('PASS UI: UTF16 CSV, long-source exports for all groups and valid-file template reimport')

    for(const source of ['sheet','image'])for(const fail of [false,true]){
      await open();await page.evaluate(source=>{window.importSmoke.state[source==='sheet'?'delaySheet':'delayImage']=true},source)
      if(source==='sheet'){
        await tab('Link sheet');await modal.getByPlaceholder('Nhập link sheet').fill('https://fixture.invalid/late.csv');await modal.getByRole('button',{name:'Đọc dữ liệu',exact:true}).click()
        await page.waitForFunction(()=>!!window.importSmoke.state.finishSheet)
      }else{
        await tab('Ảnh');await uploadFile({name:'late.png',mimeType:'image/png',buffer:png});await modal.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click();await page.waitForFunction(()=>!!window.importSmoke.state.finishImage)
      }
      await open();await modal.locator('textarea').fill('0841234567');await verify()
      await page.evaluate(({source,fail})=>{const s=window.importSmoke.state;s[source==='sheet'?'delaySheet':'delayImage']=false;s[(fail?'fail':'finish')+(source==='sheet'?'Sheet':'Image')]();delete s[source==='sheet'?'finishSheet':'finishImage']},{source,fail})
      await page.waitForFunction(()=>!document.querySelector('.campaign-import-format-row button:disabled'))
      await checkCounts([1,0,0]);assert.match(await validPreview.innerText(),/0841234567/);assert(!(await state()).alerts.some(a=>/old .* error/.test(a.message)))
    }
    console.log('PASS UI: late Sheet/image success and failure cannot replace a new session')

    await open();await page.evaluate(()=>{window.importSmoke.state.delaySheet=true})
    await tab('Link sheet');await modal.getByPlaceholder('Nhập link sheet').fill('https://fixture.invalid/action.csv');await modal.getByRole('button',{name:'Đọc dữ liệu',exact:true}).click()
    await page.waitForFunction(()=>!!window.importSmoke.state.finishSheet)
    await page.evaluate(()=>window.importSmoke.changeAction('zalo_message_group_member'))
    await modal.locator('textarea').fill('1234567890123456789');await verify()
    await page.evaluate(()=>{window.importSmoke.state.delaySheet=false;window.importSmoke.state.finishSheet()})
    await checkCounts([1,0,0]);assert.match(await validPreview.innerText(),/1234567890123456789/)
    console.log('PASS UI: action changes invalidate pending requests within the same modal')

    await open();await uploadFile({name:'10001.txt',mimeType:'text/plain',buffer:Buffer.from(Array.from({length:10001},(_,i)=>`090${String(i).padStart(7,'0')}`).join('\n'))})
    await modal.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click();await page.waitForFunction(()=>window.importSmoke.state.alerts.some(a=>a.message.includes('10.000')));assert(await insertButton.isDisabled())
    await open();await tab('File Excel/CSV của khách hàng')
    await uploadFile(file([['Data',[['SĐT'],...Array.from({length:10000},(_,i)=>[`090${String(i).padStart(7,'0')}${i===0?';0987654321':''}`])]]]))
    await modal.getByRole('radio',{name:/Lấy tất cả SĐT/}).check();await verify();await checkCounts([10001,0,0]);assert(await insertButton.isDisabled())
    assert.match(await modal.getByRole('alert').innerText(),/10.000/)
    console.log('PASS UI: source and expanded limits block insertion without truncating the report')
    assert.deepEqual(errors,[])
    console.log('PASS importer UI end to end')
  } finally {if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(error=>{console.error(String(error).slice(0,1600));process.exitCode=1})

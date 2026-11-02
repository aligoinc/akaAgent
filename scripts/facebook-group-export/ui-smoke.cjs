const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {build}=require('esbuild'),{_electron}=require('playwright'),XLSX=require('xlsx')
const root=path.resolve(__dirname,'../..')
async function run(mode){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fb-export-ui-'));let app,page
 try{
  const xlsxModule=path.join(path.dirname(require.resolve('xlsx')),'xlsx.mjs')
  await build({entryPoints:[path.join(__dirname,mode+'-ui.tsx')],outdir:dir,bundle:true,platform:'browser',format:'iife',jsx:'automatic',target:'chrome120',
   define:{'process.env.NODE_ENV':'"development"','import.meta.env.BASE_URL':'"/"'},loader:{'.png':'dataurl','.svg':'dataurl'},logLevel:'warning',
   plugins:[{name:'xlsx-capture',setup(b){b.onResolve({filter:/^xlsx$/},()=>({path:'xlsx',namespace:'capture'}));b.onLoad({filter:/.*/,namespace:'capture'},()=>({resolveDir:root,contents:`export * from ${JSON.stringify(xlsxModule)};import {write} from ${JSON.stringify(xlsxModule)};export const writeFile=(book,filename)=>window.fbExportSmoke.exports.push({filename,bytes:write(book,{type:'base64',bookType:'xlsx'})});`}))}}]})
  fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="${mode}-ui.css"><body><div id="root"></div><script src="${mode}-ui.js"></script></body></html>`)
  fs.writeFileSync(path.join(dir,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const win=new BrowserWindow({show:false,width:1700,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.session.webRequest.onBeforeRequest((d,c)=>c({cancel:/^https?:/.test(d.url)}));win.loadFile(${JSON.stringify(path.join(dir,'index.html'))});});`)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(dir,'main.cjs')],cwd:root,env});page=await app.firstWindow();page.setDefaultTimeout(15000)
  await page.waitForFunction(()=>!!window.fbExportSmoke)
  if(mode==='campaign'){await page.getByText('Sort campaign 91',{exact:true}).first().click();await page.locator('.detail-dock-tab').filter({hasText:'Kết quả chạy'}).click()}
  const exportButton=page.getByRole('button',{name:'Xuất Excel',exact:true}).first()
  async function exportRows(){const n=await page.evaluate(()=>window.fbExportSmoke.exports.length);await exportButton.click();await page.waitForFunction(n=>window.fbExportSmoke.exports.length>n,n);const output=await page.evaluate(()=>window.fbExportSmoke.exports.at(-1));const book=XLSX.read(output.bytes,{type:'base64'});return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:''})}
  let rows=await exportRows();const header=rows[0]
  assert.deepEqual(header.slice(-4),['Số thành viên','Số bài','Đơn vị bài','Privacy']);assert.ok(!header.includes('Loại nhóm AI'))
  if(mode==='campaign'){
   assert.equal(rows.length,502);assert.deepEqual(rows.at(-1).slice(-4),[0,2,'ngày','Công khai']);assert.equal(rows[1][header.indexOf('Trạng thái phụ')],'Chờ duyệt bài')
   const calls=await page.evaluate(()=>window.fbExportSmoke.calls.filter(c=>c.method==='metadataPage').map(c=>c.query))
   assert.ok(calls.some(c=>!c.includeFacebookGroupMetadata));assert.deepEqual(calls.filter(c=>c.includeFacebookGroupMetadata).map(c=>c.offset),[0,500])
  }else{assert.equal(rows.length,4);assert.deepEqual(rows[1].slice(-4),['','','','']);assert.deepEqual(rows[2].slice(-4),[0,5,'ngày','Riêng tư']);assert.deepEqual(rows[3].slice(-4),['','','',''])}
  await page.evaluate(()=>{window.fbExportSmoke.empty=true});rows=await exportRows();assert.ok(!rows[0].includes('Privacy'));assert.ok(!rows[0].includes('Số thành viên'))
  await page.evaluate(()=>{window.fbExportSmoke.empty=false;window.fbExportSmoke.privacyOnly=true});rows=await exportRows();assert.equal(rows[0].at(-1),'Privacy');assert.ok(!rows[0].includes('Số bài'))
  if(mode==='campaign'){
   await page.getByText('Sort campaign 92',{exact:true}).first().click();await page.locator('.detail-dock-tab').filter({hasText:'Kết quả chạy'}).click();rows=await exportRows();assert.ok(!rows[0].includes('Privacy'))
   assert.ok((await page.evaluate(()=>window.fbExportSmoke.calls.filter(c=>c.method==='metadataPage'&&c.query.campaignId===92))).every(c=>!c.query.includeFacebookGroupMetadata))
  }else{
   await page.locator('.data-group-manager-table tbody input[type=checkbox]').first().check();rows=await exportRows();assert.equal(rows.length,2);assert.ok(!rows[0].includes('Privacy'))
   assert.deepEqual(await page.evaluate(()=>window.fbExportSmoke.calls.at(-1).query.ids),[11])
  }
  assert.deepEqual(await page.evaluate(()=>window.fbExportSmoke.errors),[])
  console.log('PASS real '+mode+' UI + XLSX: mixed/empty/partial metadata, scope, action gate/paging and existing columns')
 }catch(e){if(page){console.error(await page.evaluate(()=>({errors:window.fbExportSmoke?.errors,body:document.body.innerText.slice(0,1800)})))}throw e}
 finally{if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true})}
}
(async()=>{await run('campaign');await run('group')})().catch(e=>{console.error(e);process.exitCode=1})

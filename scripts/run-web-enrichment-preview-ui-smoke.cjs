const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { build } = require('esbuild'), { _electron } = require('playwright-core')
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-enrichment-preview-ui-'))
  let app
  try {
    await build({entryPoints:[path.join(__dirname,'web-enrichment-preview-ui-smoke.tsx')],outdir:dir,bundle:true,platform:'browser',format:'iife',jsx:'automatic',target:'chrome120',define:{'process.env.NODE_ENV':'"development"'},loader:{'.woff2':'file','.woff':'file'}})
    fs.writeFileSync(path.join(dir,'index.html'),'<html data-theme="dark"><link rel="stylesheet" href="web-enrichment-preview-ui-smoke.css"><style>#root{display:flex;height:100vh}</style><div id="root"></div><script src="web-enrichment-preview-ui-smoke.js"></script></html>')
    fs.writeFileSync(path.join(dir,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir,'index.html'))})})`)
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    app=await _electron.launch({executablePath:require('electron'),args:[path.join(dir,'main.cjs')],env})
    const page=await app.firstWindow();page.setDefaultTimeout(10000)
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.getByText('Tài khoản kiểm thử 1',{exact:true}).waitFor()
    // Real page pixels; BrowserPage remains the production React component.
    const image=await app.evaluate(async({BrowserWindow})=>{
      const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{sandbox:true}})
      await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<body style="font:24px system-ui;background:#f8fafc;padding:80px;color:#14203a"><h1>Trang web kiểm thử</h1><p>Đang đọc và cuộn trang trong phiên lướt web.</p></body>'))
      const data=(await w.webContents.capturePage()).toDataURL();w.destroy();return data
    })
    const web={accountId:1,context:'web-enrichment',runId:'first',active:true,title:'Làm giàu lịch sử Web',timestamp:new Date().toISOString()}
    const emit=event=>page.evaluate(value=>window.webPreviewFixture.emit(value),event)
    await emit(web)
    await page.getByText('Đang tải hình ảnh trình duyệt...',{exact:true}).waitFor()
    await emit({...web,image})
    const preview=page.locator('.browser-background-preview'),frame=preview.getByRole('img',{name:web.title,exact:true})
    await frame.waitFor();assert.equal(await frame.getAttribute('src'),image)
    await page.getByText('Tài khoản kiểm thử 2',{exact:true}).click()
    assert.equal(await preview.count(),0,'another account does not inherit the image')
    await page.getByText('Tài khoản kiểm thử 1',{exact:true}).click();await frame.waitFor()
    const output=path.resolve(process.env.WEB_PREVIEW_UI_OUTPUT_DIR||'/tmp/akaagent-web-enrichment-preview')
    fs.mkdirSync(output,{recursive:true})
    await page.screenshot({path:path.join(output,'browser-dark.png')})
    const dark=await page.locator('.browser-tabs-bar').evaluate(el=>getComputedStyle(el).backgroundColor)
    await page.evaluate(()=>document.body.classList.add('theme-light'))
    assert.notEqual(await page.locator('.browser-tabs-bar').evaluate(el=>getComputedStyle(el).backgroundColor),dark)
    await page.setViewportSize({width:900,height:650})
    await page.screenshot({path:path.join(output,'browser-light-900.png')})
    await emit({...web,runId:'next',image:undefined})
    await page.getByText('Đang tải hình ảnh trình duyệt...',{exact:true}).waitFor()
    assert.equal(await preview.locator('img').count(),0,'a new session must not show the old image')
    await emit({...web,active:false});assert.equal(await preview.count(),1,'late old cleanup cannot hide new session')
    await emit({...web,runId:'next',active:false});await preview.waitFor({state:'detached'})
    const campaign={accountId:1,campaignId:9,active:true,image,timestamp:new Date().toISOString()}
    await emit(campaign);await preview.getByText('Đang chạy nền',{exact:true}).waitFor()
    await emit({...web,runId:'next',active:false});assert.equal(await preview.count(),1,'web cleanup preserves campaign preview')
    await emit({...campaign,active:false});await preview.waitFor({state:'detached'})
    assert.deepEqual(errors,[])
    console.log('PASS BrowserPage: live image, loading, account tabs, dark/light/900px, late cleanup, campaign handoff; screenshots: '+output)
  } finally { if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true}) }
}
main().catch(error=>{console.error(error);process.exitCode=1})

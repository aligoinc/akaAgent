import { app, BrowserWindow, session } from 'electron'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { BackgroundPageManager } from '../src/main/v2/runtime/backgroundPageManager'
import { runWebEnrichmentBrowser } from '../src/main/services/webEnrichmentBrowser'
import { attachWebEnrichmentPreview } from '../src/main/services/webEnrichmentPreview'
import type { BrowserPreview } from '../src/shared/browserPreview'

app.setPath('userData', process.env.WEB_SMOKE_PROFILE!)
app.on('window-all-closed', () => {})
async function main() {
  await app.whenReady()
  const server = createServer((req, res) => {
    if (req.url === '/hang') return
    if (req.url === '/error') { res.writeHead(503); res.end('Unavailable'); return }
    res.setHeader('Content-Type', 'text/html')
    res.end('<div id="search"><a href="https://ordinary.example/"><h3>Result</h3></a><div data-text-ad><a href="https://advertisement.example"><h3>Ad</h3></a></div></div><div style="height:5000px">Local browser fixture</div>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as {port:number}).port, url = `http://127.0.0.1:${port}`
  const pages = new BackgroundPageManager()
  const ses = session.fromPartition('persist:account_398')
  await ses.cookies.set({url, name:'web-fixture',value:'same-partition'})
  let facade: any, destroys = 0, runNumber = 0
  const previews: BrowserPreview[] = []
  const nextFrame = async () => {
    const start = previews.length, deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      const frame = previews.slice(start).find(event => event.active && event.image)
      if (frame) return frame.image
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('No live frame from the actual offscreen page')
  }
  const create = () => {
    const entry = attachWebEnrichmentPreview(pages.createTemporary(398, 'facebook', true),
      { accountId: 398, runId: `fixture-${++runNumber}` }, event => previews.push(event))
    return {...entry, destroy: () => { destroys++; entry.destroy() }}
  }
  try {
    await runWebEnrichmentBrowser({signal:new AbortController().signal,budgetMs:10000,createPage:create,run:async page=>{
      await page.navigate(url)
      assert.match(await page.evaluate<string>('return document.cookie'),/web-fixture=same-partition/)
      assert.equal(await page.evaluate<string>('return document.querySelector("h3").textContent'),'Result')
      const sql = readFileSync(process.env.WEB_SMOKE_SQL!, 'utf8')
      const block = sql.match(/\$browse\$([\s\S]*?)\$browse\$/)![1]
      const source = runInNewContext('`' + block.match(/async function results\(\)[\s\S]*?page.evaluate\(`([\s\S]*?)`, selectors\)/)![1] + '`')
      const selectors = Object.fromEntries(['result','captcha'].map(name => [ `fb_web_enrichment_${name}`,
        sql.match(new RegExp("\\('fb_web_enrichment_" + name + "',\\$xpath\\$([\\s\\S]*?)\\$xpath\\$"))![1] ]))
      assert.deepEqual(await page.evaluate(source, selectors), {captcha:false,links:['https://ordinary.example/']})
      const firstFrame = await nextFrame()
      assert.match(firstFrame!, /^data:image\/png;base64,./)
      await page.evaluate('window.scrollBy(0,500); document.body.style.background="lightblue"')
      assert.ok(await page.evaluate<number>('return window.scrollY')>0)
      assert.notEqual(await nextFrame(), firstFrame, 'preview follows the real page after scrolling')
    }})
    assert.equal(BrowserWindow.getAllWindows().length,0)
    await assert.rejects(runWebEnrichmentBrowser({signal:new AbortController().signal,budgetMs:5000,operationTimeoutMs:100,createPage:create,run:async page=>{
      facade=page;await page.navigate(url+'/hang');await page.evaluate('window.late=true')
    }}))
    await assert.rejects(facade.evaluate('window.late=true'))
    assert.equal(BrowserWindow.getAllWindows().length,0)
    await assert.rejects(runWebEnrichmentBrowser({signal:new AbortController().signal,budgetMs:5000,createPage:create,run:async page=>{await page.navigate(url+'/error')}}))
    await assert.rejects(runWebEnrichmentBrowser({signal:new AbortController().signal,budgetMs:5000,createPage:create,run:async page=>{
      await page.navigate(url);BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer();await new Promise(()=>{})
    }}))
    const paused = new AbortController()
    await assert.rejects(runWebEnrichmentBrowser({signal:paused.signal,budgetMs:5000,createPage:create,run:async page=>{
      await page.navigate(url);paused.abort();await new Promise(()=>{})
    }}))
    assert.equal(BrowserWindow.getAllWindows().length,0);assert.equal(destroys,5)
    for (let i=1;i<=runNumber;i++) {
      const events=previews.filter(event=>event.runId===`fixture-${i}`)
      assert.ok(events[0].active)
      assert.equal(events.at(-1)!.active,false,'completion/error/timeout/crash/pause clears preview')
      assert.equal(events.filter(event=>!event.active).length,1)
    }
    console.log('PASS Electron browser: live frames follow actual page/scroll, preview cleanup on completion/timeout/HTTP error/crash/pause, shared partition, late call fenced')
  } finally { pages.destroyAll();server.closeAllConnections();server.close() }
}
main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1)})

const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript')
const timers = new Set()
function load(file) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, Date, setInterval: callback => { timers.add(callback); return callback }, clearInterval: callback => timers.delete(callback) })
  return exports
}
const { attachWebEnrichmentPreview } = load('src/main/services/webEnrichmentPreview.ts')
const { mergeBrowserPreview } = load('src/shared/browserPreview.ts')
const flush = () => new Promise(resolve => setImmediate(resolve))

// Exercise the actual contact-scan producer together with the shared UI receiver.
function contactPreviewFixture(receive) {
  const file = path.resolve(__dirname, '../src/main/services/contactLoader.ts')
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ContactLoader')
  const methods = ['startBackgroundPreview', 'stopBackgroundPreview', 'stopAllBackgroundPreviews'].map(name =>
    cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name).getText(source)).join('\n')
  const code = ts.transpileModule(`class Harness { ${methods} }`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const Harness = new Function('IPC_EVENTS', 'setInterval', 'clearInterval', code + ';return Harness')(
    {CAMPAIGN_BROWSER_PREVIEW:'campaign:browser-preview'},
    callback => {timers.add(callback);return callback}, callback => timers.delete(callback))
  return Object.assign(new Harness(), {backgroundPreviewTimers:new Map(), backgroundPreviewCapturing:new Set(),
    mainWindow:{webContents:{send:(_channel,event)=>receive(event)}}})
}

async function scanHandoffCases() {
  for (const stop of ['stopBackgroundPreview', 'stopAllBackgroundPreviews']) {
    let resolveCapture, state
    const receive = event => {state=mergeBrowserPreview(state,event)}
    const loader=contactPreviewFixture(receive)
    loader.startBackgroundPreview(1,{isConnected:()=>true,screenshot:()=>new Promise(resolve=>{resolveCapture=resolve})},'Quét cũ')
    loader[stop](1)
    const web={accountId:1,context:'web-enrichment',runId:'new',active:true,image:'web-frame'}
    receive(web)
    resolveCapture('late-scan');await flush()
    assert.equal(state.context,'web-enrichment',`${stop}: a stopped scan must not overwrite Web with a late frame`)
    assert.equal(state.image,'web-frame')
    receive({...web,active:false})
    assert.equal(state.active,false,`${stop}: no stale scan overlay after Web ends`)
    assert.equal(timers.size,0)
  }
  for (const failOldCapture of [false,true]) {
    let finishOld, finishNew, newCaptures=0
    const events=[],loader=contactPreviewFixture(event=>events.push(event))
    loader.startBackgroundPreview(1,{isConnected:()=>true,screenshot:()=>new Promise((resolve,reject)=>{
      finishOld=()=>failOldCapture?reject(Error('old capture failed')):resolve('old-frame')
    })},'Quét cũ')
    loader.stopBackgroundPreview(1)
    loader.startBackgroundPreview(1,{isConnected:()=>true,screenshot:()=>{
      newCaptures++;return new Promise(resolve=>{finishNew=resolve})
    }},'Quét mới')
    finishOld();await flush()
    assert.ok(loader.backgroundPreviewCapturing.has(1),'old capture finally must not clear the new capture lock')
    for(const timer of timers)timer()
    assert.equal(newCaptures,1,'at most one capture of the new scan')
    finishNew('new-frame');await flush()
    assert.equal(events.filter(event=>event.active).length,1,'only the new scan can emit a frame')
    assert.equal(events.at(-1).title,'Quét mới')
    loader.stopBackgroundPreview(1);assert.equal(timers.size,0)
  }
}
async function main() {
  await scanHandoffCases()
  let resolveCapture, captures = 0, closed = 0, onClosed
  const events = []
  const entry = { page: { isConnected: () => true, screenshot: () => { captures++; return new Promise(resolve => { resolveCapture = resolve }) } },
    destroy() { closed++; onClosed?.() }, onClosed(listener) { onClosed = listener; return () => { onClosed = undefined } } }
  const page = attachWebEnrichmentPreview(entry, {accountId:1,runId:'old'}, event => events.push(event))
  assert.equal(events[0].active,true,'show running before the first image arrives')
  for (const timer of timers) timer()
  assert.equal(captures,1,'at most one capture even when screenshot hangs')
  page.destroy()
  assert.equal(timers.size,0,'do not wait for screenshot to clear the timer')
  assert.equal(events.at(-1).active,false)
  resolveCapture('late');await flush()
  assert.equal(events.length,2,'a frame arriving after destruction is discarded')
  assert.equal(closed,1)

  let reject = true
  const failing = attachWebEnrichmentPreview({page:{isConnected:()=>true,screenshot:async()=>{
    if(reject)throw Error('capture failed');return 'new-frame'
  }},destroy(){closed++}}, {accountId:1,runId:'next'}, event=>events.push(event))
  await flush();reject=false
  for(const timer of timers)timer()
  await flush();assert.equal(events.at(-1).image,'data:image/png;base64,new-frame','capture failure can recover')
  failing.destroy();assert.equal(timers.size,0)
  const brokenRenderer = attachWebEnrichmentPreview({page:{isConnected:()=>false},destroy(){closed++}},
    {accountId:1,runId:'broken'},()=>{throw Error('renderer closed')})
  brokenRenderer.destroy();assert.equal(closed,3);assert.equal(timers.size,0,'IPC failures cannot leak the page or timer')

  const old={accountId:1,context:'web-enrichment',runId:'old',active:true,image:'old-frame'}
  const next={...old,runId:'new',image:'new-frame'}
  const campaign={accountId:1,campaignId:12,active:true,image:'campaign-frame'}
  const scan={accountId:1,campaignId:0,context:'contact-scan',active:true,image:'scan-frame'}
  assert.equal(mergeBrowserPreview(next,{...old,active:false}),next,'old session cannot clear the next session')
  for(const owner of [campaign,scan]) {
    assert.equal(mergeBrowserPreview(owner,{...old,active:false}),owner,'web cleanup cannot clear another operation')
    assert.equal(mergeBrowserPreview(next,{...owner,active:false}),next,'other cleanup cannot clear web preview')
    assert.equal(mergeBrowserPreview(owner,{...next,image:undefined}).image,undefined,'never label an old source image as the new source')
  }
  assert.equal(mergeBrowserPreview(next,{...next,image:undefined}).image,'new-frame')
  const cleared=mergeBrowserPreview(next,{...next,active:false})
  assert.equal(cleared.active,false);assert.equal(cleared.image,undefined)

  // Exercise the production scheduler's page factory and IPC wiring as well.
  const { schedulerClass } = require('./campaign-media-timeout-smoke-test.cjs')
  let factory, created, destroyed=0
  const sent=[]
  const Scheduler=schedulerClass({}, {
    './webEnrichmentPreview': {attachWebEnrichmentPreview},
    './webEnrichmentService': {WebEnrichmentService:class {constructor(deps){factory=deps.createPage}}},
    '../v2/runtime/backgroundPageManager': {BackgroundPageManager:class {createTemporary(...args){
      created=args;return {page:{isConnected:()=>true,screenshot:async()=> 'scheduler-frame'},destroy(){destroyed++}}
    }}},
    '../../shared/types': {IPC_EVENTS:{CAMPAIGN_BROWSER_PREVIEW:'campaign:browser-preview'}}
  })
  new Scheduler({}, {}, {webContents:{send:(...args)=>sent.push(args)}}, {})
  const scheduled=factory({id:1},'scheduler-run')
  await flush()
  assert.deepEqual(Array.from(created),[1,'facebook',true])
  assert.equal(sent[0][0],'campaign:browser-preview')
  assert.equal(sent[1][1].runId,'scheduler-run')
  assert.equal(sent[1][1].image,'data:image/png;base64,scheduler-frame')
  scheduled.destroy();assert.equal(destroyed,1);assert.equal(sent.at(-1)[1].active,false);assert.equal(timers.size,0)
  console.log('PASS preview: scan stop/stop-all → Web handoff, scan restart with late success/failure, scheduler factory/IPC wiring, hanging/late capture, bounded concurrency, capture/IPC failures, timer cleanup, session/campaign/scan ownership')
}
main().catch(error=>{console.error(error);process.exitCode=1})

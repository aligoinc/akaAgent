const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
const { EventEmitter } = require('node:events')
const { runInNewContext } = require('node:vm')
const { build } = require('esbuild')
const { _electron } = require('playwright')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'zalo-server-admin-ui-'))
  let app
  try {
    await build({ entryPoints: [join(root, 'src/server/main/zaloServerAdminUpdates.ts')], outfile: join(directory, 'updates.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
    const { ZaloServerAdminUpdates } = require(join(directory, 'updates.cjs'))
    const messages = [], reads = []
    let visible = true, minimized = false
    const window = { isDestroyed: () => false, isVisible: () => visible, isMinimized: () => minimized,
      webContents: { isDestroyed: () => false, send: (channel, value) => messages.push({ channel, value }) } }
    const updates = new ZaloServerAdminUpdates(() => window, includeEvents => {
      reads.push(includeEvents)
      return { recentEvents: includeEvents ? [{ sequence: 9000 }] : [], staffs: [] }
    })
    const events = () => messages.filter(m => m.channel === 'zalo-server:runtime-event')
    updates.visibilityChanged()
    for (let sequence = 1; sequence <= 5000; sequence++) {
      updates.pushEvent({ sequence })
      updates.requestSnapshot()
    }
    await sleep(320)
    assert.equal(events().length, 1, 'burst must use one local IPC batch')
    assert.equal(events()[0].value.length, 1000, 'IPC buffer stays bounded')
    assert.equal(events()[0].value[0].sequence, 4001)
    assert.deepEqual(reads, [true])
    updates.requestSnapshot()
    await sleep(320)
    assert.deepEqual(reads, [true, false], 'routine snapshots omit log history')
    updates.pushEvent({ sequence: 5001 })
    minimized = true
    updates.visibilityChanged()
    const hiddenCount = messages.length
    for (let sequence = 5002; sequence <= 9000; sequence++) updates.pushEvent({ sequence })
    updates.requestSnapshot()
    await sleep(320)
    assert.equal(messages.length, hiddenCount, 'no events/snapshots while minimized')
    minimized = false
    updates.visibilityChanged()
    await sleep(320)
    assert.equal(reads.at(-1), true, 'restore resyncs the existing bounded history')
    assert.equal(events().length, 1, 'hidden events are not queued a second time')
    visible = false
    updates.visibilityChanged()
    const hideCount = messages.length
    updates.pushEvent({ sequence: 9001 })
    await sleep(320)
    assert.equal(messages.length, hideCount, 'hide is handled independently of minimize')
    visible = true
    updates.visibilityChanged()
    updates.pushEvent({ sequence: 10001 })
    updates.clearThrough(10001)
    updates.pushEvent({ sequence: 10002 })
    await sleep(320)
    assert.deepEqual(events().at(-1).value.map(e => e.sequence), [10002])
    updates.pushEvent({ sequence: 10003 })
    updates.dispose()
    const disposedCount = messages.length
    await sleep(320)
    assert.equal(messages.length, disposedCount, 'shutdown cancels pending UI work')
    console.log('PASS main: bounded/coalesced IPC, hidden/minimized recovery, clear and disposal')

    await build({ entryPoints:[join(root,'src/server/preload/index.ts')], outfile:join(directory,'preload.cjs'), bundle:true, platform:'node', format:'cjs', external:['electron'], logLevel:'warning' })
    const ipc = new EventEmitter()
    let bridge
    runInNewContext(readFileSync(join(directory,'preload.cjs'),'utf8'), {
      require: name => {
        assert.equal(name,'electron')
        return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld: (_name, value) => {bridge=value}}}
      }
    })
    const delivered=[],visibility=[]
    const unsubscribeEvent=bridge.onRuntimeEvent(event=>delivered.push(event.sequence))
    const unsubscribeVisibility=bridge.onVisibilityUpdated(value=>visibility.push(value))
    ipc.emit('zalo-server:runtime-event',{},[{sequence:1},{sequence:2}])
    ipc.emit('zalo-server:runtime-event',{},{sequence:3})
    ipc.emit('zalo-server:visibility-updated',{},false)
    assert.deepEqual(delivered,[1,2,3])
    assert.deepEqual(visibility,[false])
    unsubscribeEvent();unsubscribeVisibility()
    assert.equal(ipc.listenerCount('zalo-server:runtime-event'),0)
    assert.equal(ipc.listenerCount('zalo-server:visibility-updated'),0)
    console.log('PASS preload: batched/single event compatibility, visibility and unsubscribe')

    await build({ entryPoints: [join(root, 'src/server/renderer/index.ts')], outfile: join(directory, 'ui.js'), bundle: true, platform: 'browser', format: 'iife', logLevel: 'warning' })
    const html = readFileSync(join(root, 'src/server/renderer/index.html'), 'utf8').replace('<script type="module" src="./index.ts"></script>', '<script src="./fixture.js"></script><script src="./ui.js"></script>')
    writeFileSync(join(directory, 'index.html'), html)
    copyFileSync(join(root, 'src/server/renderer/styles.css'), join(directory, 'styles.css'))
    writeFileSync(join(directory, 'fixture.js'), `
      let eventListener, snapshotListener, visibilityListener, clearResolve;
      const event = sequence => ({ sequence, timestamp: new Date(Date.UTC(2026, 0, 1) + sequence * 1000).toISOString(), staffId: sequence % 300 + 1, organizationId: 1, channel: 'campaign:log', payload: 'message-' + sequence });
      const fixtureSnapshot = { state: 'running', startedAt: '2026-01-01T00:00:00Z', vietnamTime: '2026-01-01T01:00:00Z', timeZoneOk: true, listeningAt: 'http://fixture', connectedClients: 10, runtimeCount: 300,
        staffs: Array.from({length: 300}, (_, i) => ({staffId: i+1, organizationId: 1, staffName: 'Staff '+(i+1), organizationName: 'Fixture', state: 'running', startedAt: null, lastError: null})), recentEvents: Array.from({length: 1000}, (_,i) => event(i+1)) };
      window.confirm = () => true;
      let hidden = false;
      Object.defineProperty(document, 'hidden', { get: () => hidden });
      window.zaloServerAdmin = {
        getSnapshot: async () => structuredClone(fixtureSnapshot),
        clearLogs: () => new Promise(resolve => { clearResolve = resolve }),
        onRuntimeEvent: cb => {eventListener=cb; return () => {}},
        onSnapshotUpdated: cb => {snapshotListener=cb; return () => {}},
        onVisibilityUpdated: cb => {visibilityListener=cb; return () => {}}
      };
      window.fixture = { event, snapshot: fixtureSnapshot,
        emit: (from, count) => {for(let i=from;i<from+count;i++) eventListener(event(i))},
        emitRaw: e => eventListener(e),
        snapshotChanged: s => snapshotListener(structuredClone(s)),
        visible: value => visibilityListener(value),
        hidden: value => {hidden=value;document.dispatchEvent(new Event('visibilitychange'))},
        finishClear: seq => clearResolve({clearedThroughSequence:seq})
      };
      window.metrics = { added:0, removed:0, batches:0 };
      new MutationObserver(records => {window.metrics.batches++;for(const r of records){window.metrics.added+=r.addedNodes.length;window.metrics.removed+=r.removedNodes.length}}).observe(document.getElementById('log-list'),{childList:true});
    `)
    writeFileSync(join(directory, 'main.cjs'), `
      const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
      app.whenReady().then(() => {
        const win = new BrowserWindow({show:false,width:1450,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
        win.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({cancel:/^https?:/.test(details.url)}));
        win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
      });
    `)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: root, env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const rowCount = () => page.locator('#log-list .log-row').count()
    const settle = () => page.waitForTimeout(250)
    await page.waitForFunction(() => document.querySelectorAll('.log-row').length === 1000)
    assert.equal(await page.locator('#staff-table-body tr').count(), 300)
    // Each new log should add one node, rather than reconstructing 1000 old rows.
    await page.evaluate(() => {
      window.savedRow = [...document.querySelectorAll('.log-row')].find(row => row.querySelector('.log-message').textContent === 'message-900')
      window.savedOption = document.querySelector('#filter-staff option[value="1"]')
      window.savedStaff = document.querySelector('#staff-table-body tr')
      window.metrics = {added:0,removed:0,batches:0}
      fixture.emit(1001, 1)
    })
    await settle()
    assert.equal(await rowCount(), 1000)
    assert.deepEqual(await page.evaluate(() => ({ added: metrics.added, removed: metrics.removed, sameRow: savedRow.isConnected, sameOption: savedOption === document.querySelector('#filter-staff option[value="1"]') })), {added:1,removed:1,sameRow:true,sameOption:true})
    await page.evaluate(() => fixture.snapshotChanged({...fixture.snapshot, recentEvents:[]}))
    await settle()
    assert.equal(await page.evaluate(() => savedStaff === document.querySelector('#staff-table-body tr')), true)
    // Off-screen reader position must stay anchored when old rows are evicted.
    await page.evaluate(() => {
      const list=document.getElementById('log-list'); list.scrollTop=1200
      const top=list.getBoundingClientRect().top
      window.anchor=[...list.children].find(row => row.getBoundingClientRect().bottom>top)
      window.anchorY=anchor.getBoundingClientRect().top
      fixture.emit(1002, 5)
    })
    await settle()
    assert(await page.evaluate(() => Math.abs(anchor.getBoundingClientRect().top-anchorY)<2), 'scroll anchor must stay stable')
    await page.evaluate(() => {
      const list=document.getElementById('log-list'); list.scrollTop=list.scrollHeight
      fixture.emit(1007, 1)
    })
    await settle()
    assert(await page.evaluate(() => {const e=document.getElementById('log-list'); return e.scrollHeight-e.scrollTop-e.clientHeight<2}), 'tail follower should stay at bottom')
    console.log('PASS renderer: node/option/staff reuse, bounded history and stable scroll/tail')

    await page.evaluate(() => {
      const text=document.getElementById('filter-text'); text.value='message-1007';text.dispatchEvent(new Event('input'))
    })
    await settle()
    assert.equal(await rowCount(), 1)
    await page.evaluate(() => {
      document.getElementById('filter-text').value=''; document.getElementById('filter-text').dispatchEvent(new Event('input'))
      document.getElementById('filter-staff').value='1'; document.getElementById('filter-staff').dispatchEvent(new Event('change'))
    })
    await settle()
    assert(await page.evaluate(() => [...document.querySelectorAll('.log-staff')].every(e => e.textContent==='Staff #1')))
    await page.evaluate(() => {const e=document.getElementById('filter-staff');e.value='';e.dispatchEvent(new Event('change'))})
    await settle()
    await page.evaluate(() => {
      fixture.visible(false);window.metrics={added:0,removed:0,batches:0};fixture.emit(2000,10000)
      fixture.snapshotChanged({...fixture.snapshot, recentEvents:[], connectedClients:99})
    })
    await settle()
    assert.deepEqual(await page.evaluate(() => metrics), {added:0,removed:0,batches:0})
    await page.evaluate(() => fixture.visible(true))
    await settle()
    assert.equal(await rowCount(), 1000)
    assert.equal(await page.locator('.log-message').last().innerText(), 'message-11999')
    assert.equal(await page.locator('#metric-clients').innerText(), '99')
    await page.evaluate(() => {fixture.hidden(true);window.metrics={added:0,removed:0,batches:0};fixture.emit(12000,1)})
    await settle()
    assert.equal(await page.evaluate(() => metrics.added), 0)
    await page.evaluate(() => fixture.hidden(false))
    await settle()
    assert.equal(await page.locator('.log-message').last().innerText(), 'message-12000')
    console.log('PASS renderer: filters, 10,000 hidden events, bounded recovery and document visibility')

    // Delayed old snapshot/IPC and new events during the clear response must be fenced.
    await page.evaluate(() => {
      document.getElementById('clear-logs').click()
      fixture.emit(12001,1)
      fixture.finishClear(12000)
    })
    await settle()
    await page.evaluate(() => {fixture.snapshotChanged(fixture.snapshot); fixture.emit(11999,2)})
    await settle()
    assert.equal(await rowCount(), 1)
    assert.equal(await page.locator('.log-message').innerText(), 'message-12001')
    await page.evaluate(() => fixture.emitRaw({...fixture.event(12002),channel:'campaign:status-updated'}))
    await settle()
    assert.equal(await rowCount(), 1)
    assert.deepEqual(errors, [])
    console.log('PASS renderer: clear watermark rejects old snapshots/batches and preserves post-clear events')

    if (process.argv.includes('--compare-base')) {
      const baseline = execFileSync('git', ['show','origin/dev_3:src/server/renderer/index.ts'], {cwd:root,encoding:'utf8'})
      await build({ stdin:{contents:baseline,resolveDir:join(root,'src/server/renderer'),loader:'ts'}, outfile:join(directory,'baseline.js'),bundle:true,platform:'browser',format:'iife',logLevel:'warning' })
      writeFileSync(join(directory,'baseline.html'),html.replace('./ui.js','./baseline.js'))
      const results = []
      for (const variant of ['index','baseline']) {
        await page.goto(pathToFileURL(join(directory,variant+'.html')).href)
        await page.waitForFunction(() => document.querySelectorAll('.log-row').length===1000)
        const producerMs = await page.evaluate(() => {window.metrics={added:0,removed:0,batches:0};const start=performance.now();fixture.emit(1001,200);return performance.now()-start})
        await settle()
        results.push({variant,producerMs:Math.round(producerMs),...await page.evaluate(() => metrics)})
      }
      assert.equal(results[0].added,200)
      assert.equal(results[1].added,200000)
      console.log('BENCHMARK 300 staff + 1000 retained rows + 200 events:',JSON.stringify(results))
    }
  } finally {
    if (app) await app.close()
    rmSync(directory, {recursive:true,force:true})
  }
}
main().catch(error => {console.error(error);process.exitCode=1})

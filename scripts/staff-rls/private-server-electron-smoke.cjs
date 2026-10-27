// Exercise the packaged Main/preload/renderer and bundled credential on local
// Electron. Replace only startServer to prevent customer runtime/DB mutations.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const asar = require('@electron/asar')
const ts = require('typescript')
const { _electron } = require('playwright')
const root = path.resolve(__dirname, '../..')
const directory = path.resolve(process.argv[2] || '')
const resources = path.join(directory, 'win-unpacked/resources')
const archive = path.join(resources, 'app.asar')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-server-packaged-smoke-'))
let app

async function main() {
  try {
    for (const name of asar.listPackage(archive)) {
      const relative = name.replace(/^\//, '')
      if (!relative.startsWith('out-server/') || asar.statFile(archive, relative).files) continue
      const target = path.resolve(tmp, relative)
      assert(target.startsWith(tmp + path.sep))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, asar.extractFile(archive, relative))
    }
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir')
    const mainFile = path.join(tmp, 'out-server/main/index.js')
    const source = fs.readFileSync(mainFile, 'utf8')
    const ast = ts.createSourceFile(mainFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const starts = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'startServer')
    assert.equal(starts.length, 1)
    const body = starts[0].body
    // All actual loader/client/startup and renderer code is kept byte-for-byte.
    fs.writeFileSync(mainFile, source.slice(0, body.getStart(ast)) + '{ await globalThis.__testPrivateServer(getSupabaseClient()); }' + source.slice(body.end))
    fs.writeFileSync(path.join(tmp, 'boot.cjs'), `
      const {app,BrowserWindow,ipcMain,dialog}=require('electron');
      const path=require('node:path');
      app.setPath('userData',path.join(__dirname,'profile'));
      Object.defineProperty(app,'isPackaged',{value:true});
      Object.defineProperty(process,'resourcesPath',{value:${JSON.stringify(resources)}});
      BrowserWindow.prototype.show=function(){};
      dialog.showErrorBox=()=>{globalThis.__privateTest={error:'credential startup dialog'};app.exit(1)};
      const fetchOriginal=globalThis.fetch;
      const allowed=new Set([
        'GET /rest/v1/org_staff?select=id&limit=0',
        'GET /rest/v1/org_organization?select=id&limit=0',
        'POST /rest/v1/rpc/aka_agent_staff_security_status',
        'POST /rest/v1/rpc/aka_agent_staff_client'
      ]);
      let calls=0;
      globalThis.fetch=async(input,options)=>{
        const url=new URL(typeof input==='string'?input:input.url||input);
        const method=String(options?.method||'GET').toUpperCase();
        if(url.origin!=='https://cgjbsmqtfhqvttudyjzq.supabase.co'||!allowed.has(method+' '+url.pathname+url.search))throw Error('Smoke blocked unexpected network request');
        if(url.pathname.endsWith('/aka_agent_staff_client')){
          const body=JSON.parse(options.body);
          if(body.p_action!=='read'||body.p_username!=='__private_server_smoke_invalid__')throw Error('Smoke blocked unexpected RPC action');
        }
        calls++;
        return fetchOriginal(input,options);
      };
      globalThis.__privateTest={done:false};
      globalThis.__testPrivateServer=async client=>{
        const snapshot={state:'running',startedAt:new Date().toISOString(),vietnamTime:new Date().toISOString(),timeZoneOk:true,listeningAt:'test:runtime-disabled',connectedClients:0,runtimeCount:0,staffs:[],recentEvents:[]};
        ipcMain.handle('zalo-server:get-snapshot',()=>snapshot);
        const status=await client.rpc('aka_agent_staff_security_status').abortSignal(AbortSignal.timeout(15000));
        if(status.error||status.data?.legacyRecoveryAllowed!==true)throw Error('Security status check failed');
        for(const table of ['org_staff','org_organization']){
          const result=await client.from(table).select('id').limit(0).abortSignal(AbortSignal.timeout(15000));
          if(result.error||!Array.isArray(result.data)||result.data.length!==0)throw Error('Empty table read failed: '+table);
        }
        const rejected=await client.rpc('aka_agent_staff_client',{p_username:'__private_server_smoke_invalid__',p_password:'invalid-test-password',p_action:'read',p_data:{}}).abortSignal(AbortSignal.timeout(15000));
        if(!rejected.error||rejected.error.message!=='staff_client_auth_invalid')throw Error('Invalid login was not rejected');
        globalThis.__privateTest={done:true,live_readonly_requests:calls,legacyRecoveryAllowed:true,runtime_started:false};
      };
      require('./out-server/main/index.js');
    `)
    const env = { ...process.env }
    for (const key of ['ELECTRON_RUN_AS_NODE', 'AKA_AGENT_SERVER_SUPABASE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ELECTRON_RENDERER_URL']) delete env[key]
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(tmp, 'boot.cjs')], cwd: tmp, env })
    const logChunks = []
    app.process().stdout.on('data', data => logChunks.push(data.toString()))
    app.process().stderr.on('data', data => logChunks.push(data.toString()))
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => typeof window.zaloServerAdmin?.getSnapshot === 'function', undefined, { timeout: 20000 })
    const snapshot = await page.evaluate(() => window.zaloServerAdmin.getSnapshot())
    assert.equal(snapshot.runtimeCount, 0)
    const deadline = Date.now() + 60000
    let state
    while (Date.now() < deadline) {
      state = await app.evaluate(() => globalThis.__privateTest)
      if (state.done || state.error) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert(state?.done, 'Packaged Main did not complete read-only backend checks')
    assert.equal(state.live_readonly_requests, 4)
    const secret = fs.readFileSync(path.join(resources, 'server-private/supabase-server-secret.key'), 'utf8').trim()
    const rendered = await page.content()
    assert(!rendered.includes(secret) && !JSON.stringify(snapshot).includes(secret), 'Credential leaked to renderer')
    await app.close(); app = null
    assert(!logChunks.join('').includes(secret), 'Credential leaked to process logs')
    const receipt = { tested_at: new Date().toISOString(), host: process.platform,
      packaged_main_loader_client: true, packaged_preload_renderer: true, clean_user_data: true,
      key_from_installer_resources: true, live_readonly_requests: 4, invalid_login_rejected: true,
      key_absent_from_renderer_ipc_logs: true, runtime_started: false, windows_runtime_tested: false }
    fs.writeFileSync(path.join(directory, 'electron-packaged-smoke.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
    console.log(JSON.stringify(receipt, null, 2))
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

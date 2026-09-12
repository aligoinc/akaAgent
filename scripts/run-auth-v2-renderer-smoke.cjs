const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
const root = resolve(__dirname, '..')
const directory = mkdtempSync(join(tmpdir(), 'aka-auth-renderer-'))
try {
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import LoginPage from ${JSON.stringify(join(root,'src/renderer/src/pages/LoginPage.tsx'))};
    import { useAuthStore } from ${JSON.stringify(join(root,'src/renderer/src/stores/authStore.ts'))};
    let options={rememberLogin:true,autoLogin:false,startupEnabled:true};
    let remembered={username:'dummy-user',hasCredential:true};
    const calls=[];
    const snapshot=()=>({loginOptions:{...options},rememberedLogin:remembered,warningMessage:null});
    window.electronAPI={
      updateLoginPreferences:async updates=>{
        options={...options,...updates};
        if(updates.autoLogin===true) options.rememberLogin=true;
        if(updates.rememberLogin===false){options.autoLogin=false;remembered=null;}
        calls.push('options'); return {user:null,...snapshot()};
      },
      cancelPendingLogin:async()=>{calls.push('cancel')},
      loginRemembered:async username=>{calls.push('remembered:'+username);return {status:'authenticated',user:{staffId:1},loginState:snapshot()}},
      login:async()=>{calls.push('manual');return {status:'authenticated',user:{staffId:1},loginState:snapshot()}},
      recoverDeviceCredentials:async()=>snapshot()
    };
    window.authFixture={calls, state:()=>useAuthStore.getState()};
    useAuthStore.setState({initializing:false,...snapshot()});
    createRoot(document.getElementById('root')).render(<LoginPage/>);
  `
  buildSync({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, outfile: join(directory,'renderer.js'),
    bundle:true, platform:'browser', format:'esm', jsx:'automatic', logLevel:'warning' })
  writeFileSync(join(directory,'index.html'), '<html><body><div id="root"></div><script type="module" src="renderer.js"></script></body></html>')
  writeFileSync(join(directory,'test.cjs'), `
    const {app,BrowserWindow}=require('electron');
    const assert=require('node:assert/strict');
    const {join}=require('node:path');
    app.setPath('userData',join(__dirname,'user-data'));
    const delay=()=>new Promise(r=>setTimeout(r,80));
    app.whenReady().then(async()=>{
      const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=3&&!message.includes('ERR_FILE_NOT_FOUND'))errors.push(message)});
      const run=code=>win.webContents.executeJavaScript(code);
      await win.loadFile(join(__dirname,'index.html'));
      for(let i=0;i<50;i++){if(await run('!!document.querySelector("#login-username")'))break;await delay()}
      await delay();
      assert.equal(await run('document.querySelector("#login-username").value'),'dummy-user');
      assert.equal(await run('document.querySelector("#login-password").value'),'','remembered password is never populated into DOM');
      assert.equal(await run('document.querySelector(".login-submit").disabled'),false);
      await run('document.querySelector(".login-submit").click()');await delay();
      assert.equal(await run('window.authFixture.calls.filter(v=>v.startsWith("remembered:")).length'),1);
      await run('Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(document.querySelector("#login-username"),"other-user");document.querySelector("#login-username").dispatchEvent(new Event("input",{bubbles:true}))');await delay();
      assert.equal(await run('document.querySelector(".login-submit").disabled'),true,'changed username cannot use prior credential');
      await run('document.querySelectorAll(".login-option input")[0].click()');await delay();
      assert.equal(await run('window.authFixture.state().loginOptions.rememberLogin'),false);
      assert.equal(await run('window.authFixture.state().loginOptions.autoLogin'),false);
      await run('document.querySelectorAll(".login-option input")[1].click()');await delay();
      assert.equal(await run('window.authFixture.state().loginOptions.rememberLogin'),true);
      assert.equal(await run('window.authFixture.state().loginOptions.autoLogin'),true);
      assert.equal(errors.length,0,errors.join('\\n'));
      console.log('Auth renderer smoke passed: remembered login, empty password DOM, username switch, immediate checkbox changes.');
      win.destroy();app.exit(0);
    }).catch(e=>{console.error(e);app.exit(1)});
  `)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const result=spawnSync(require('electron'),[join(directory,'test.cjs')],{cwd:root,env,stdio:'inherit',timeout:60000})
  if(result.error)throw result.error
  process.exitCode=result.status??1
}finally{rmSync(directory,{recursive:true,force:true})}

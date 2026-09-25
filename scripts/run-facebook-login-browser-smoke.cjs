const {build}=require('esbuild')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const {spawn,execFileSync}=require('node:child_process')
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aka-facebook-electron-'))
async function main(){
  // Match electron-vite's external dependency loading. Bundling node-fetch would
  // hide an ESM-only dependency being required by Electron's CommonJS main process.
  fs.symlinkSync(path.resolve(__dirname,'../node_modules'),path.join(directory,'node_modules'),process.platform==='win32'?'junction':'dir')
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem'),'-days','1','-subj','/CN=www.facebook.com','-addext','subjectAltName=DNS:www.facebook.com,DNS:m.facebook.com'],{stdio:'ignore'})
  const bundle=path.join(directory,'browser.cjs')
  await build({entryPoints:[path.resolve(__dirname,'../src/main/services/facebookLoginSession.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',external:['electron','node-fetch'],logLevel:'warning'})
  const serviceBundle=path.join(directory,'service.cjs')
  const stubs={
    '../data/currentUser': 'export const getCurrentUser=()=>globalThis.facebookServiceFixture.user; export const requireCurrentUser=getCurrentUser; export const getCurrentUserCredentials=()=>globalThis.facebookServiceFixture.credentials;',
    '../data/repositories/facebookLoginRepository': 'export const facebookRpc=(...args)=>globalThis.facebookServiceFixture.rpc(...args); export class FacebookDataError extends Error {}',
    '../data/repositories/accountRepository': 'export const getAccount=async()=>globalThis.facebookServiceFixture.account; export const listAccounts=async()=>globalThis.facebookServiceFixture.startupAccounts||[]; export const claimNonZaloAccountRuntimeOperation=async()=>{await globalThis.facebookServiceFixture.onClaim?.();return{claimed:true,claimToken:"fixture",staffId:1,previousStatus:"tạm dừng"}}; export const releaseNonZaloAccountRuntimeOperation=async()=>{globalThis.facebookServiceFixture.released++;return true};',
    '../data/repositories/proxyRepository': 'export const getProxy=async()=>globalThis.facebookServiceFixture.proxy||null;'
  }
  await build({entryPoints:[path.resolve(__dirname,'../src/main/services/facebookLoginService.ts')],outfile:serviceBundle,bundle:true,platform:'node',format:'cjs',external:['electron','node-fetch'],logLevel:'warning',plugins:[{
    name:'facebook-service-fixture',setup(build){
      build.onResolve({filter:/data\//},args=>stubs[args.path]?{path:args.path,namespace:'facebook-fixture'}:undefined)
      build.onLoad({filter:/.*/,namespace:'facebook-fixture'},args=>({contents:stubs[args.path],loader:'js'}))
    }
  }]})
  const env={...process.env,NODE_EXTRA_CA_CERTS:path.join(directory,'cert.pem'),FACEBOOK_SMOKE_DIRECTORY:directory,FACEBOOK_SMOKE_BROWSER_BUNDLE:bundle,FACEBOOK_SMOKE_SERVICE_BUNDLE:serviceBundle};delete env.ELECTRON_RUN_AS_NODE
  const child=spawn(require('electron'),[path.join(__dirname,'fixtures/facebook-login-electron.cjs')],{env,stdio:'inherit'})
  const timer=setTimeout(()=>child.kill('SIGTERM'),60000)
  const exit=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer)
  if(exit!==0)throw new Error('Electron Facebook smoke failed: '+exit)
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(directory,{recursive:true,force:true}))

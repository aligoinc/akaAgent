const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{build}=require('esbuild'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-local-data-'))
async function main(){try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir')
 const user=path.join(dir,'user.ts');fs.writeFileSync(user,'export const requireCurrentUser=()=>globalThis.agentDataUser')
 await build({entryPoints:[path.join(__dirname,'campaign-agent-data-smoke.ts')],outfile:path.join(dir,'main.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron','tesseract.js'],
   plugins:[{name:'identity',setup(b){b.onResolve({filter:/\/currentUser$/},()=>({path:user}))}}],logLevel:'warning'})
 const env={...process.env,AKA_AGENT_DATA_SMOKE_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE
 let entry=path.join(dir,'main.cjs')
 if(process.argv.includes('--asar')) {
   const stage=path.join(dir,'packed');fs.mkdirSync(stage)
   fs.copyFileSync(entry,path.join(stage,'main.cjs'));fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:'ocr-smoke',version:'1.0.0',main:'main.cjs'}))
   for(const name of ['tesseract.js','tesseract.js-core','wasm-feature-detect','bmp-js','is-url','regenerator-runtime','node-fetch','whatwg-url','tr46','webidl-conversions','zlibjs','idb-keyval','@tesseract.js-data/eng','@tesseract.js-data/vie']) {
     const to=path.join(stage,'node_modules',name);fs.mkdirSync(path.dirname(to),{recursive:true});fs.cpSync(path.dirname(require.resolve(name+'/package.json')),to,{recursive:true})
   }
   entry=path.join(dir,'app.asar')
   await require('@electron/asar').createPackageWithOptions(stage,entry,{unpackDir:require('../package.json').build.asarUnpack.at(-1)})
 }
 const result=spawnSync(require('electron'),[entry],{env,stdio:'inherit',timeout:120000});if(result.error)throw result.error;process.exitCode=result.status??1
}finally{fs.rmSync(dir,{recursive:true,force:true})}}
main().catch(error=>{console.error(error);process.exitCode=1})

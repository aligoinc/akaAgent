const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process'),{buildSync}=require('esbuild')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'web-enrichment-browser-'))
try{
 const file=path.join(dir,'main.cjs')
 buildSync({entryPoints:[path.join(__dirname,'web-enrichment-browser-smoke.ts')],outfile:file,bundle:true,platform:'node',format:'cjs',external:['electron']})
 const env={...process.env,WEB_SMOKE_PROFILE:path.join(dir,'profile'),WEB_SMOKE_SQL:path.resolve(__dirname,'../migrations/migration_v398_facebook_web_enrichment.sql')};delete env.ELECTRON_RUN_AS_NODE
 const result=spawnSync(require('electron'),[file],{env,encoding:'utf8',timeout:30000})
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'')
 if(result.error)throw result.error
 if(result.status!==0)process.exitCode=1
}finally{fs.rmSync(dir,{recursive:true,force:true})}

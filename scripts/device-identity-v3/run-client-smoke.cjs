const {buildSync}=require('esbuild'),{mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),{spawnSync}=require('node:child_process')
const tmp=mkdtempSync(join(tmpdir(),'aka-v3-test-'))
try{const output=join(tmp,'test.cjs');buildSync({entryPoints:[join(__dirname,'client-smoke.ts')],bundle:true,platform:'node',format:'cjs',outfile:output,target:'node20',logLevel:'warning'});const result=spawnSync(process.execPath,[output],{stdio:'inherit'});process.exitCode=result.status??1}finally{rmSync(tmp,{recursive:true,force:true})}

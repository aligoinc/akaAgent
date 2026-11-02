const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{build}=require('esbuild'),{spawnSync}=require('node:child_process')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-images-'))
async function main(){try{
 const source=path.resolve(__dirname,'campaign-agent-images-smoke.ts'),outfile=path.join(dir,'main.cjs')
 // Only the current identity is mocked; Electron decoding and disk storage use production code.
 const entry=fs.readFileSync(source,'utf8')
 const user=path.join(dir,'user.ts');fs.writeFileSync(user,'export const requireCurrentUser=()=>globalThis.agentImageUser')
 await build({stdin:{contents:entry,loader:'ts',resolveDir:__dirname},outfile,bundle:true,platform:'node',format:'cjs',external:['electron'],plugins:[{name:'identity',setup(b){b.onResolve({filter:/\/currentUser$/},()=>({path:user}))}}],logLevel:'warning'})
 const env={...process.env,AKA_AGENT_IMAGE_SMOKE_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE
 const result=spawnSync(require('electron'),[outfile],{env,stdio:'inherit',timeout:30000});if(result.error)throw result.error;process.exitCode=result.status??1
}finally{fs.rmSync(dir,{recursive:true,force:true})}

}
main().catch(error=>{console.error(error);process.exitCode=1})

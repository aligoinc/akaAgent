const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..')
async function main(){
 if(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim()!=='cgjbsmqtfhqvttudyjzq')throw Error('Wrong project')
 const exports={},code=ts.transpileModule(fs.readFileSync(path.join(root,'src/main/data/supabaseClient.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 vm.runInNewContext(code,{exports,require,process,console})
 assert.equal(exports.getSupabaseUrl(),'https://cgjbsmqtfhqvttudyjzq.supabase.co')
 const client=exports.getSupabaseClient(),params={p_staff_id:-398,p_organization_id:-398,p_account_id:-398,p_operation:'get'}
 for(const auth of [{p_auth_username:null,p_auth_password:null},{p_auth_username:'invalid-v398',p_auth_password:'invalid-v398'}]){
  const {error}=await client.rpc('aka_agent_facebook_web_enrichment_settings',{...params,...auth}).abortSignal(AbortSignal.timeout(15000))
  assert.match(error?.message||'',/automation_auth_(required|invalid)/)
 }
 const {data,error}=await client.from('auto_accounts').select('facebook_web_enrichment_enabled,facebook_web_enrichment_config').limit(0).abortSignal(AbortSignal.timeout(15000))
 assert.equal(error,null);assert.deepEqual(data,[])
 const result={rpcReachable:true,credentialGuards:true,newColumnsVisible:true,accountDataRead:0,accountWrites:0}
 fs.writeFileSync(path.join(root,'docs/audits/web-enrichment-v398/api.json'),JSON.stringify(result,null,2)+'\n')
 console.log('PASS API: new RPC and columns visible; missing/wrong credentials denied; no account data read or written')
}
main().catch(error=>{console.error(error.message);process.exitCode=1})

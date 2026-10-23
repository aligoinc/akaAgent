const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {build}=require('esbuild'),{createClient}=require('@supabase/supabase-js')
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aka-visibility-repo-'));let user,credentials,entitlements,reply,afterRead,beforeRead,calls=[]
 const snapshot={organizationId:9,revision:1,hiddenActionIds:['sms_send'],updatedAt:null,canEdit:true}
 const reset=()=>{user={staffId:7,organizationId:9};credentials={username:'fixture',password:'fixture'};entitlements={zalo:true,sms:true};reply={...snapshot};afterRead=null;beforeRead=null;calls=[]}
 const client=createClient('http://127.0.0.1:54321','fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,options)=>{
   calls.push({url:String(input),body:JSON.parse(options.body),signal:options.signal});afterRead?.()
   return new Response(JSON.stringify(reply),{status:reply.message?400:200,headers:{'content-type':'application/json'}})
 }}})
 globalThis.visibilityRepositoryFixture={client,user:()=>user,credentials:()=>credentials,entitlements:async()=>{await beforeRead?.();return entitlements}}
 const stubs={
  supabaseClient:'export const getSupabaseClient=()=>globalThis.visibilityRepositoryFixture.client',
  currentUser:'export const getCurrentUser=()=>globalThis.visibilityRepositoryFixture.user();export const requireCurrentUser=getCurrentUser;export const getCurrentUserCredentials=()=>globalThis.visibilityRepositoryFixture.credentials();export const requireCurrentUserCredentials=getCurrentUserCredentials;',
  entitlementRepository:'export const loadCurrentUserEffectiveEntitlements=()=>globalThis.visibilityRepositoryFixture.entitlements();export const loadCurrentUserZaloAccountCapabilities=()=>({qr:true,web:false,server:true})'
 }
 try{
  const out=path.join(dir,'repository.cjs')
  await build({entryPoints:[path.resolve(__dirname,'../src/main/data/repositories/campaignTypeVisibilityRepository.ts')],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'warning',plugins:[{name:'offline',setup(plugin){
   plugin.onResolve({filter:/(?:supabaseClient|currentUser|entitlementRepository)$/},args=>({path:args.path.split('/').pop(),namespace:'fixture'}))
   plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js'}))
  }}]})
  const {getCampaignTypeVisibility:read,patchCampaignTypeVisibility:patch}=require(out)
  reset();await read();assert.equal(calls.length,1);assert.equal(calls[0].body.p_include_catalog,false);assert.equal(calls[0].body.p_staff_id,7);assert.equal(calls[0].body.p_organization_id,9);assert(calls[0].signal instanceof AbortSignal)
  reset();reply.catalog=[];await read(true);assert.equal(calls.length,1);assert.equal(calls[0].body.p_include_catalog,true);assert.deepEqual(calls[0].body.p_access,{zalo:true,sms:true,qr:true,web:false,server:true})
  reset();await patch([{actionId:'sms_send',visible:false}]);assert.deepEqual(calls[0].body.p_changes,[{actionId:'sms_send',visible:false}]);assert.equal(calls[0].body.p_operation,'patch')
  reset();await assert.rejects(patch([{actionId:'sms_send',visible:'false'}]));assert.equal(calls.length,0)
  reset();reply={message:'visibility_access_denied'};await assert.rejects(patch([{actionId:'sms_send',visible:false}]),/quản trị/)
  reset();reply={message:'SQL internal secret'};await assert.rejects(read(),error=>!error.message.includes('secret'))
  reset();reply={...snapshot,organizationId:10};await assert.rejects(read(),/Không thể tải/)
  reset();afterRead=()=>{credentials={username:'fixture',password:'new'}};await assert.rejects(read(),/Phiên/)
  reset();beforeRead=()=>{credentials={username:'other',password:'fixture'}};await assert.rejects(patch([{actionId:'sms_send',visible:false}]),/Phiên/);assert.equal(calls.length,0)
  reset();await assert.rejects(read(true),/danh mục/)
  console.log('PASS 10 Desktop repository cases through Supabase HTTP serialization: scope, capabilities, snapshot/count, partial patch, errors and session fencing')
 }finally{delete globalThis.visibilityRepositoryFixture;fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1})

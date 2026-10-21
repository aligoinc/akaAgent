// Live read-only API probes. Credentials and row contents are never persisted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..'),mode=process.argv[2],ref='cgjbsmqtfhqvttudyjzq'
assert(['before','after'].includes(mode))
const client=fs.readFileSync(path.join(root,'src/main/data/supabaseClient.ts'),'utf8')
const key=client.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).ref,ref)
const base='https://'+ref+'.supabase.co/rest/v1/',headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'}
const checks=[]
async function probe(endpoint,body){
 const start=Date.now(),response=await fetch(base+endpoint,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(65000)})
 const data=await response.json();return {status:response.status,data,durationMs:Date.now()-start}
}
;(async()=>{
 const q=new URLSearchParams({select:'*, zalo_user:zalo_users!auto_account_contacts_zalo_user_id_fkey(gender)',account_id:'eq.1174',staff_id:'eq.308',is_delete:'eq.false',order:'id.desc',limit:'10'})
 const r=await probe('auto_account_contacts?'+q);assert.equal(r.status,200);assert.equal(r.data.length,10)
 checks.push({case:'legacy_contact_relationship',status:r.status,rows:r.data.length,checksum:crypto.createHash('sha256').update(JSON.stringify(r.data)).digest('hex'),durationMs:r.durationMs})
 const identity={p_staff_id:0,p_organization_id:0,p_auth_username:null,p_auth_password:null}
 for(const [rpc,patch] of [
  ['aka_agent_group_sharing',{p_action:'data_members',p_data:{kind:'data',groupId:0}}],
  ['aka_agent_list_data_group_members_v2',{p_group_id:0,p_search:null,p_account_ids:null,p_include_accountless:true,p_contact_types:null,p_flatform_types:null,p_status:'all',p_dataset_ids:null,p_data_type_category_item_ids:null,p_ids:null,p_exclude_ids:null,p_offset:0,p_limit:1}],
  ...['contacts','group','remarketing'].map(source=>['aka_agent_read_filtered_'+source+'_v1',{p_query:{accountId:1174,groupId:5006,limit:1,columnFilters:{version:1,filters:[]}},...(source==='contacts'?{p_source:'contacts'}:{})}])
 ]){
  const r=await probe('rpc/'+rpc,{...identity,...patch})
  const newReader=rpc.startsWith('aka_agent_read_filtered_')
  if(mode==='before'&&newReader)assert.equal(r.data.code,'PGRST202')
  else {assert.equal(r.data.code,'P0001');assert.equal(r.data.message,'automation_auth_required')}
  checks.push({case:rpc,status:r.status,code:r.data.code,message:newReader&&mode==='before'?'RPC not installed':r.data.message,durationMs:r.durationMs})
 }
 const result={project:ref,at:new Date().toISOString(),mode,readOnly:true,checks}
 fs.writeFileSync(path.join(root,'migrations/snapshots/column-filters-v421/production-http-'+mode+'.json'),JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result))
})().catch(e=>{console.error(e.message);process.exitCode=1})

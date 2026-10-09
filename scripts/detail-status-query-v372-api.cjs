// Invalid-auth API probes only; no credential or detail payload is persisted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const v=require('./detail-status-query-v372.cjs')
async function main(){
  const key=fs.readFileSync(path.join(v.root,'src/main/data/supabaseClient.ts'),'utf8').match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},checks=[]
  for(const suffix of ['', '_v2']){
    const rpc='aka_agent_list_campaign_details_page'+suffix
    const body={p_staff_id:0,p_organization_id:0,p_campaign_id:0,p_search:null,p_status:'đã xem',p_date_from:null,p_date_to:null,p_offset:0,p_limit:1,p_sort:'created_desc',p_auth_username:null,p_auth_password:null,...(suffix?{p_engagement_filter:null}:{})}
    const response=await fetch(`https://${v.ref}.supabase.co/rest/v1/rpc/${rpc}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
    const data=await response.json();assert.equal(data.code,'P0001');assert.equal(data.message,'automation_auth_required')
    checks.push({rpc,status:response.status,rejected:data.message})
  }
  const response=await fetch(`https://${v.ref}.supabase.co/rest/v1/auto_campaign_details?select=id,main_status:auto_status!auto_detail_status_fk(name,status_value),sub_status:auto_status!auto_detail_sub_status_fk(name,status_value)&limit=1`,{headers,signal:AbortSignal.timeout(10000)})
  assert.equal(response.status,200);assert(Array.isArray(await response.json()));checks.push({relation:'main/sub status',status:200})
  const receipt={at:new Date().toISOString(),project_ref:v.ref,checks,external_operations:0}
  v.save('api-after.json',receipt);console.log(receipt)
}
main().catch(error=>{console.error(error.message);process.exitCode=1})

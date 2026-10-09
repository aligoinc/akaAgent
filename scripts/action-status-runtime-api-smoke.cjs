const fs=require('fs'),path=require('path'),assert=require('assert/strict'),m=require('./action-status-policy-migration.cjs');
async function main(){const key=fs.readFileSync(path.join(m.root,'src/main/data/supabaseClient.ts'),'utf8').match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1];const checks=[];
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
for(const rpc of ['aka_agent_write_action_result_v1','aka_agent_settle_action_results_v1']){
 const common={p_staff_id:0,p_campaign_id:0,p_account_id:0,p_claim_token:null,p_unit_token:null};
 const body=rpc.includes('write_')?{...common,p_result_key:null,p_detail:{}}:{...common,p_input_data_id:null,p_detail_ids:[],p_input_patch:null,p_reason:null};
 const response=await fetch(`https://${m.ref}.supabase.co/rest/v1/rpc/${rpc}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=await response.json();assert.equal(data.code,'P0001');assert.match(data.message,/action_result_/);checks.push({rpc,http_status:response.status,rejected:data.message});
}
const response=await fetch(`https://${m.ref}.supabase.co/rest/v1/auto_campaign_details?select=id,main_status:auto_status!auto_detail_status_fk(name),sub_status:auto_status!auto_detail_sub_status_fk(name)&limit=1`,{headers,signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);assert(Array.isArray(await response.json()));checks.push({relationship:'main/sub result catalog',http_status:200});
fs.writeFileSync(path.join(m.root,'migrations/snapshots/action-status-policies-v363/api-after.json'),JSON.stringify({at:new Date().toISOString(),project_ref:m.ref,checks,external_operations:0},null,2)+'\n');console.log(JSON.stringify({checks}));}
main().catch(e=>{console.error(e);process.exitCode=1});

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const m = require('./action-status-policy-migration.cjs')
async function main() {
  const source = fs.readFileSync(path.join(m.root,'src/main/data/supabaseClient.ts'),'utf8')
  const key = source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  const checks=[]
  const prepared=process.argv.includes('--prepared')
  for (const table of ['auto_status','auto_error','auto_campaign_details','auto_campaign_action_detail_statuses',...(prepared?[m.newTable]:[])]) {
    const start=Date.now()
    const response=await fetch(`https://${m.ref}.supabase.co/rest/v1/${table}?select=*&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)})
    const body=await response.json()
    assert.equal(response.status,200,`${table}: ${JSON.stringify(body)}`)
    assert(Array.isArray(body));assert(body.length===1,table)
    const columns=Object.keys(body[0])
    if(prepared && table==='auto_campaign_details') for(const c of ['status_id','sub_status_id','action_status_policy_id','report_group','policy_snapshot','result_key']) assert(columns.includes(c),c)
    if(prepared && table==='auto_status') assert(columns.includes('status_value') && columns.includes('color'))
    checks.push({table,http_status:response.status,elapsed_ms:Date.now()-start,columns})
  }
  const result={at:new Date().toISOString(),project_ref:m.ref,prepared,checks}
  m.write(prepared?'api-after.json':'api-before.json',result,false)
  console.log(JSON.stringify({prepared,checks:checks.map(({table,http_status,elapsed_ms})=>({table,http_status,elapsed_ms}))}))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})

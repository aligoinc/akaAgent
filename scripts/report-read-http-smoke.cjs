// Read-only production probes. Credentials stay in process memory and are never printed/saved.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),ref='cgjbsmqtfhqvttudyjzq'
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),ref)
const source=fs.readFileSync(path.join(root,'src/main/data/supabaseClient.ts'),'utf8')
const key=source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
function query(sql){return JSON.parse(execFileSync('supabase',['db','query','--linked',sql,'--output','json'],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']})).rows}
async function main(){
 const evidence=[],pendingMode=process.argv.includes('--pending')
 for(const accountId of (pendingMode ? [3348,7596] : [4011,3037])){
  const [actor]=query(`select a.id,a.staff_id,a.organization_id,s.username,s.password,(select jsonb_agg(code) from public.auto_account_actions where flatform_type=a.flatform_type) as actions,(select jsonb_agg(id) from (select c.id from public.auto_campaigns c where c.account_id=a.id and c.staff_id=a.staff_id and c.organization_id=a.organization_id and c.is_delete=false order by c.id limit 200) selected_campaigns) as campaigns from public.auto_accounts a join public.org_staff s on s.id=a.staff_id and s.organization_id=a.organization_id where a.id=${accountId} and not a.is_delete and s.is_active`)
  assert(actor)
  const q={source:'results',view:'summary',accountIds:[actor.id],actionCodes:actor.actions,startIso:'2026-09-15T17:00:00Z',endIso:'2026-10-15T17:00:00Z',limit:1000}
  if(pendingMode) Object.assign(q,{source:'pending',campaignIds:actor.campaigns || [],ownSchedule:false,startIso:'2020-01-01T00:00:00Z',endIso:'2030-01-01T00:00:00Z'})
  const args={p_staff_id:actor.staff_id,p_organization_id:actor.organization_id,p_auth_username:actor.username,p_auth_password:actor.password,p_query:q}
  const start=Date.now()
  const response=await fetch(`https://${ref}.supabase.co/rest/v1/rpc/aka_agent_read_report_page`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(65000)})
  const result=await response.json()
  assert.equal(response.status,200,`RPC failed: ${result.code || response.status} ${result.message || ''}`)
  assert(Array.isArray(result.rows));assert(result.rows.length<=1000)
  evidence.push({probe:pendingMode?'anon_pending_fallback':'anon_results_30_days',httpStatus:response.status,ms:Date.now()-start,rows:result.rows.length})
  // A subsequent export cursor must preserve microseconds and not repeat a result.
  if(result.rows.length===1000){
   const last=result.rows.at(-1);args.p_query={...q,afterId:last.id,...(pendingMode?{afterCampaignId:last.campaign_id}:{afterCreatedAt:last.created_at})}
   const next=await fetch(`https://${ref}.supabase.co/rest/v1/rpc/aka_agent_read_report_page`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(65000)})
   const page=await next.json();assert.equal(next.status,200);const ids=new Set(result.rows.map(r=>r.id));assert(page.rows.every(r=>!ids.has(r.id)))
   evidence.push({probe:'anon_second_page',httpStatus:next.status,rows:page.rows.length,noDuplicates:true})
  }
  args.p_auth_password='invalid-smoke-password';args.p_query=q
  const denied=await fetch(`https://${ref}.supabase.co/rest/v1/rpc/aka_agent_read_report_page`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(65000)})
  assert(denied.status>=400);evidence.push({probe:'invalid_credentials',httpStatus:denied.status})
 }
 const output={at:new Date().toISOString(),project:ref,readOnly:true,evidence}
 fs.writeFileSync(path.join(root,`migrations/snapshots/report-read-timeout/http-${pendingMode?'pending-':''}smoke.json`),JSON.stringify(output,null,2)+'\n')
 console.log(JSON.stringify(output))
}
main().catch(error=>{console.error(error.message);process.exitCode=1})

// Schema/ACL probe only: no real staff credentials or account data are read.
const fs=require('node:fs')
const path=require('node:path')
const assert=require('node:assert/strict')
async function main(){
  const source=fs.readFileSync(path.resolve(__dirname,'../src/main/data/supabaseClient.ts'),'utf8')
  const url=source.match(/const SUPABASE_URL = .*?\|\| '([^']+)'/)[1]
  const key=source.match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  assert.equal(new URL(url).hostname,'cgjbsmqtfhqvttudyjzq.supabase.co')
  const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'}
  const rpc=await fetch(`${url}/rest/v1/rpc/aka_agent_facebook_login`,{method:'POST',headers,body:JSON.stringify({p_staff_id:0,p_username:'__schema_probe__',p_password:'__invalid__',p_action:'preview',p_data:{uids:[]}}),signal:AbortSignal.timeout(15000)})
  const rejection=await rpc.json()
  assert.equal(rpc.status,400);assert.equal(rejection.message,'staff_auth_invalid')
  const accounts=await fetch(`${url}/rest/v1/auto_accounts?select=id,facebook_uid,facebook_login_managed&limit=0`,{headers,signal:AbortSignal.timeout(15000)})
  assert.equal(accounts.status,200);assert.deepEqual(await accounts.json(),[])
  for(const table of ['auto_facebook_login_sessions','auto_facebook_login_imports']){
    const result=await fetch(`${url}/rest/v1/${table}?select=*&limit=0`,{headers,signal:AbortSignal.timeout(15000)})
    const error=await result.json();assert.equal(error.code,'42501',`${table} must deny direct reads`)
  }
  console.log('PASS linked production HTTP schema, invalid-credential rejection, public account columns and restricted secret/reservation tables')
}
main().catch(error=>{console.error(error);process.exitCode=1})

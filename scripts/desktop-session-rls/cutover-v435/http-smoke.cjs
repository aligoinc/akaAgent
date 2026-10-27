// Read-only gateway smoke. Keys remain in memory; never print request headers.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'../../..'),dir=path.join(root,'migrations/snapshots/desktop-cutover-v435')
const old=execFileSync('git',['show','e1c16165:src/main/data/supabaseClient.ts'],{cwd:root,encoding:'utf8'})
const legacy=(old.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]).find(x=>JSON.parse(Buffer.from(x.split('.')[1],'base64url')).role==='anon')
assert(legacy,'verified legacy anon key')
const current=fs.readFileSync(path.join(root,'src/main/data/supabaseClient.ts'),'utf8')
const publishable=current.match(/sb_publishable_[A-Za-z0-9_-]+/)[0]
const url='https://cgjbsmqtfhqvttudyjzq.supabase.co',results=[]
async function request(key,label,resource,options={}){
 const r=await fetch(url+resource,{...options,headers:{apikey:key,...(key===legacy?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)})
 const data=await r.json();results.push({label,status:r.status,code:data.code||null,rows:Array.isArray(data)?data.length:null});return {r,data}
}
async function main(){
 for(const [label,key] of [['legacy-anon',legacy],['publishable',publishable]]){
  for(const table of ['org_staff','org_organization','auto_accounts','auto_campaigns','ai_model']){
   const {r,data}=await request(key,label+' denies '+table,'/rest/v1/'+table+'?select='+ (table==='ai_model'?'api_key':'id')+'&limit=0')
   assert([401,403].includes(r.status)&&data.code==='42501',label+' '+table+' must reject at database ACL')
  }
  const {r,data}=await request(key,label+' old startup query','/rest/v1/auto_system_settings?select=value&key=eq.desktop.updates.startup_prompt_max_version&is_active=eq.true&is_secret=eq.false')
  assert.equal(r.status,200);assert.equal(data.length,1)
  const visible=await request(key,label+' settings row filter','/rest/v1/auto_system_settings?select=key')
  assert.equal(visible.r.status,200);assert.deepEqual(visible.data.map(x=>x.key),['desktop.updates.startup_prompt_max_version'])
  const startup=await request(key,label+' new startup RPC','/rest/v1/rpc/aka_agent_desktop_startup_policy',{method:'POST',body:'{}'})
  assert.equal(startup.r.status,200)
 }
 for(const name of ['version_win','version_mac','version_mac_intel']){
  const r=await fetch('https://akabiz.net/UpdateAutoSqlite/akaAgent/'+name+'.txt',{signal:AbortSignal.timeout(15000)});const version=(await r.text()).trim();assert.equal(version,'9.1.0');results.push({label:name,status:r.status,version})
 }
 const h=await fetch('https://agent.akabiz.net/healthz',{signal:AbortSignal.timeout(15000)});assert.equal(h.status,200);results.push({label:'backend health',status:h.status})
 fs.writeFileSync(path.join(dir,'http-test.json'),JSON.stringify({at:new Date().toISOString(),results},null,2)+'\n')
 console.log(JSON.stringify({checks:results.length,status:'passed',results}))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})

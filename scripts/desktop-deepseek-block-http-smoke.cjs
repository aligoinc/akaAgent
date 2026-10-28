// Read-only HTTP checks; public keys stay in memory and are never printed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),dir=path.join(root,'migrations/snapshots/desktop-deepseek-block')
const old=execFileSync('git',['show','e1c16165:src/main/data/supabaseClient.ts'],{cwd:root,encoding:'utf8'})
const legacy=(old.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]).find(x=>JSON.parse(Buffer.from(x.split('.')[1],'base64url')).role==='anon')
const publishable=fs.readFileSync(path.join(root,'src/main/data/supabaseClient.ts'),'utf8').match(/sb_publishable_[A-Za-z0-9_-]+/)[0]
assert(legacy&&publishable)
const url='https://cgjbsmqtfhqvttudyjzq.supabase.co',results=[]
async function request(key,label,resource,options={}) {
 const response=await fetch(url+resource,{...options,headers:{apikey:key,...(key===legacy?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)})
 const data=await response.json();assert.equal(response.status,200,label)
 results.push({label,status:response.status,rows:Array.isArray(data)?data.length:null});return data
}
async function main(){
 for(const [label,key] of [['legacy-anon',legacy],['publishable',publishable]]){
  const secret=await request(key,label+' DeepSeek hidden','/rest/v1/auto_system_settings?select=value&key=eq.ai.deepseek.api_key')
  assert.equal(Array.isArray(secret)&&secret.length===0,true,'DeepSeek must be absent')
  const startup=await request(key,label+' old updater','/rest/v1/auto_system_settings?select=value&key=eq.desktop.updates.startup_prompt_max_version&is_active=eq.true&is_secret=eq.false')
  assert.equal(startup.length,1)
  await request(key,label+' startup RPC','/rest/v1/rpc/aka_agent_desktop_startup_policy',{method:'POST',body:'{}'})
  await request(key,label+' login content','/rest/v1/rpc/aka_agent_desktop_login_content',{method:'POST',body:'{}'})
 }
 for(const name of ['version_win','version_mac','version_mac_intel']){
  const r=await fetch('https://akabiz.net/UpdateAutoSqlite/akaAgent/'+name+'.txt',{signal:AbortSignal.timeout(15000)})
  assert.equal(r.status,200);const version=(await r.text()).trim();assert.equal(version,'9.1.0');results.push({label:name,status:r.status,version})
 }
 const health=await fetch('https://agent.akabiz.net/healthz',{signal:AbortSignal.timeout(15000)});assert.equal(health.status,200);results.push({label:'backend health',status:health.status})
 const report={at:new Date().toISOString(),status:'passed',checks:results.length,results};fs.writeFileSync(path.join(dir,'http-test.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})

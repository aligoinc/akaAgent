// Reuses the linked Management API. No SQL pool or auxiliary DDL setup.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const v=require('./email-status-observations-v368.cjs'),{m}=v
const {functionRows,checkFunctions}=require('./apply-action-status-compatibility-v367.cjs')
const write=(file,value)=>fs.writeFileSync(path.join(v.dir,file),JSON.stringify(value,null,2)+'\n',{flag:'wx'})
const testSQL=()=>fs.readFileSync(path.join(m.root,'migrations/tests',v.name+'_smoke.sql'),'utf8')
function backup(){
  const before=v.read('before-apply.json'),manifest=v.read('before-apply-manifest.json')
  assert.equal(manifest.project_ref,m.ref)
  assert.equal(manifest.before_sha256,m.hash(fs.readFileSync(path.join(v.dir,'before-apply.json'))))
  assert.equal(manifest.migration_sha256,m.hash(v.migration()))
  assert.equal(manifest.smoke_sha256,m.hash(testSQL()))
  m.validateSnapshot(before)
  return before
}
function capture(){
  const local=v.read('local-smoke.json');assert.equal(local.migration_sha256,m.hash(v.migration()))
  const before=m.snapshot();m.validateSnapshot(before)
  assert(!before.recent_migrations.some(x=>/^migration_v368_/.test(x.name||'')),'v368 already applied')
  checkFunctions(m.query(`SELECT ${functionRows(v.functions)} functions`)[0].functions,v.functions)
  write('before-apply.json',before)
  write('before-apply-manifest.json',{project_ref:m.ref,at:new Date().toISOString(),
    before_sha256:m.hash(fs.readFileSync(path.join(v.dir,'before-apply.json'))),
    migration_sha256:m.hash(v.migration()),smoke_sha256:m.hash(testSQL())})
  backup();console.log('Backup re-read; all rows, columns and checksums verified')
}
function smoke(applied=false){
  backup()
  const prefix=applied?`BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s'; DO $$ BEGIN ${v.guards(v.targets)} END $$;`:v.migration().replace(/COMMIT;\s*$/,'')
  const result=m.query(`${prefix} SAVEPOINT fixture; ${testSQL()} ROLLBACK TO fixture;
    SELECT true verified,clock_timestamp()-transaction_timestamp() duration,${functionRows(v.targets)} functions; ROLLBACK;`)[0]
  assert.equal(result.verified,true);checkFunctions(result.functions,v.targets)
  checkFunctions(m.query(`SELECT ${functionRows(applied?v.targets:v.functions)} functions`)[0].functions,applied?v.targets:v.functions)
  write(applied?'live-post-apply-smoke.json':'live-rollback-smoke.json',{
    at:new Date().toISOString(),project_ref:m.ref,rolled_back:true,external_operations:0,
    migration_sha256:m.hash(v.migration()),smoke_sha256:m.hash(testSQL()),...result})
  console.log({verified:true,rolled_back:true,duration:result.duration})
}
function apply(){
  backup();assert(!fs.existsSync(path.join(v.dir,'apply.json')),'Already applied: verify, do not reapply')
  const rehearsal=v.read('live-rollback-smoke.json')
  assert.equal(rehearsal.migration_sha256,m.hash(v.migration()));assert.equal(rehearsal.smoke_sha256,m.hash(testSQL()))
  const history=new Date().toISOString().replace(/\D/g,'').slice(0,14),sql=v.migration()
  const result=m.query(sql.replace(/COMMIT;\s*$/,()=>`DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v368_%') THEN RAISE EXCEPTION 'v368 already recorded'; END IF;
    ${v.guards(v.targets)} END $$;
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${m.quote(history)},${m.quote(v.name)},ARRAY[${m.quote(sql)}]);
    SELECT true applied; COMMIT;`))
  assert.equal(result[0].applied,true)
  write('apply.json',{at:new Date().toISOString(),project_ref:m.ref,name:v.name,history_version:history,migration_sha256:m.hash(sql)})
  verify()
}
function verify(){
  const before=backup(),after=m.snapshot();m.validateSnapshot(after)
  checkFunctions(m.query(`SELECT ${functionRows(v.targets)} functions`)[0].functions,v.targets)
  for(const f of before.functions.filter(f=>!v.targets.some(t=>t.signature===f.signature)))assert.equal(after.functions.find(x=>x.signature===f.signature)?.md5,f.md5,'Unrelated function changed: '+f.signature)
  const independentChanges=m.originalRowsUnchanged(before,after)
  for(const table of Object.keys(before.tables))assert.equal(after.tables[table].count,before.tables[table].count,'Catalog row count changed: '+table)
  const withoutSequencePosition=s=>({...s,sequence:s.sequence?{...s.sequence,last_value:null}:s.sequence})
  assert.deepEqual(after.schema.map(withoutSequencePosition),before.schema.map(withoutSequencePosition),'Schema/ACL/index/constraint changed')
  write('after.json',after)
  write('after-manifest.json',{at:new Date().toISOString(),project_ref:m.ref,after_sha256:m.hash(fs.readFileSync(path.join(v.dir,'after.json'))),rollback_sha256:m.hash(v.rollback()),independentChanges,verified:true})
  console.log({verified:true,history:v.read('apply.json').history_version,functions:v.targets.length,independentChanges})
}
async function api(){
  const key=fs.readFileSync(path.join(m.root,'src/main/data/supabaseClient.ts'),'utf8').match(/const SUPABASE_ANON_KEY = .*?\|\| '([^']+)'/)[1]
  const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},checks=[]
  for(const kind of ['open','click']){
    const rpc='aka_agent_mark_email_'+kind
    const response=await fetch(`https://${m.ref}.supabase.co/rest/v1/rpc/${rpc}`,{method:'POST',headers,body:JSON.stringify({['p_'+kind+'_token']:'not-a-token'}),signal:AbortSignal.timeout(10000)})
    assert.equal(response.status,200);const data=await response.json();assert.equal(data[0]?.ok,false)
    checks.push({rpc,status:response.status,invalid_token_rejected:true})
  }
  const response=await fetch(`https://${m.ref}.supabase.co/rest/v1/auto_campaign_details?select=id,main_status:auto_status!auto_detail_status_fk(name),sub_status:auto_status!auto_detail_sub_status_fk(name)&limit=1`,{headers,signal:AbortSignal.timeout(10000)})
  assert.equal(response.status,200);assert(Array.isArray(await response.json()))
  checks.push({relation:'main/sub status',status:200})
  write('api-after.json',{at:new Date().toISOString(),project_ref:m.ref,checks,external_operations:0});console.log(checks)
}
const commands={capture,smoke,apply,verify,'post-smoke':()=>smoke(true),api}
if(require.main===module){assert(commands[process.argv[2]],'capture|smoke|apply|verify|post-smoke|api');Promise.resolve(commands[process.argv[2]]()).catch(e=>{console.error(e.message);process.exitCode=1})}

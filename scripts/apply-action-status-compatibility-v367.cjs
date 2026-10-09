// Single-purpose linked Management API runner; never opens a SQL pool.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const v = require('./action-status-compatibility-v367.cjs'), { m } = v
const write = (file, value) => fs.writeFileSync(path.join(v.dir,file),JSON.stringify(value,null,2)+'\n',{flag:'wx'})
const source = v.functions.filter(f => v.targets.some(t => t.signature===f.signature))
const functionRows = expected => `(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text)) FROM pg_proc p WHERE p.oid IN (${expected.map(f=>`to_regprocedure(${m.quote('public.'+f.signature)})`).join(',')}))`
function checkFunctions(actual,expected) {
  assert.equal(actual.length,expected.length)
  for(const f of expected) {
    const found=actual.find(a=>a.signature===f.signature); assert(found,f.signature)
    for(const key of ['definition','md5','owner','security_definer','volatility','settings','acl']) assert.deepEqual(found[key],f[key],f.signature+': '+key)
  }
}
function capture() {
  assert.equal(v.read('local-smoke.json').migration_sha256,m.hash(v.migration()))
  const snap=m.snapshot();m.validateSnapshot(snap)
  assert(!snap.recent_migrations.some(row=>/^migration_v367_/.test(row.name||'')),'v367 already applied')
  checkFunctions(m.query(`SELECT ${functionRows(source)} functions`)[0].functions,source)
  assert(!snap.schema.find(s=>s.table==='auto_campaign_details').indexes.some(i=>i.indexname===v.indexName),'Index exists before this run; inspect ownership')
  write('before-apply.json',snap)
  write('before-apply-manifest.json',{project_ref:m.ref,at:new Date().toISOString(),sha256:m.hash(fs.readFileSync(path.join(v.dir,'before-apply.json'))),migration_sha256:m.hash(v.migration())})
  backup(); console.log('Pre-apply backup re-read and verified')
}
function backup() {
  const snap=v.read('before-apply.json'),manifest=v.read('before-apply-manifest.json')
  assert.equal(manifest.project_ref,m.ref);assert.equal(manifest.sha256,m.hash(fs.readFileSync(path.join(v.dir,'before-apply.json'))))
  assert.equal(manifest.migration_sha256,m.hash(v.migration()));m.validateSnapshot(snap);return snap
}
function index() {
  backup()
  assert(!fs.existsSync(path.join(v.dir,'index-after.json')),'Index step already completed')
  const present=m.query(`SELECT to_regclass('public.${v.indexName}') present`)[0].present
  assert.equal(present,null,'Index already exists; inspect unknown outcome instead of retrying')
  write('index-intent.json',{at:new Date().toISOString(),project_ref:m.ref,definition:v.indexDefinition,timeout:'Existing linked API statement_timeout=2min; no connection/settings changes'})
  const start=Date.now()
  // One statement, no SET/BEGIN batch: CONCURRENTLY cannot run in a transaction.
  m.query(v.indexSQL.replace('CREATE INDEX ','CREATE INDEX CONCURRENTLY '))
  const result=m.query(`SELECT i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) definition,pg_size_pretty(pg_relation_size(i.indexrelid)) size FROM pg_index i WHERE i.indexrelid=to_regclass('public.${v.indexName}')`)[0]
  assert.equal(result.definition,v.indexDefinition);assert(result.indisvalid&&result.indisready)
  write('index-after.json',{at:new Date().toISOString(),elapsed_ms:Date.now()-start,...result});console.log(result)
}
function smoke(applied=false) {
  backup()
  const tests=fs.readFileSync(path.join(m.root,'migrations/tests/migration_v367_action_status_compatibility_smoke.sql'),'utf8')
  const prefix=applied?`BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s'; DO $$ BEGIN ${v.guards(v.targets)} END $$;`:v.migration().replace(/COMMIT;\s*$/,'')
  const rows=m.query(`${prefix} SAVEPOINT fixture; ${tests} ROLLBACK TO fixture; SELECT true verified,clock_timestamp()-transaction_timestamp() duration,${functionRows(v.targets)} functions; ROLLBACK;`)
  const result=rows[0];assert.equal(result.verified,true);checkFunctions(result.functions,v.targets)
  write(applied?'live-post-apply-smoke.json':'live-rollback-smoke.json',{at:new Date().toISOString(),project_ref:m.ref,migration_sha256:m.hash(v.migration()),rolled_back:true,external_operations:0,...result})
  // Rehearsal did not leave the function replacement behind.
  checkFunctions(m.query(`SELECT ${functionRows(applied?v.targets:source)} functions`)[0].functions,applied?v.targets:source)
  console.log({verified:true,rolled_back:true,duration:result.duration,functions:result.functions.length})
}
function apply() {
  backup();assert(!fs.existsSync(path.join(v.dir,'apply.json')),'Already applied: verify, do not reapply')
  assert.equal(v.read('live-rollback-smoke.json').migration_sha256,m.hash(v.migration()))
  const history=new Date().toISOString().replace(/\D/g,'').slice(0,14),sql=v.migration()
  const result=m.query(sql.replace(/COMMIT;\s*$/,()=>`DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v367_%') THEN RAISE EXCEPTION 'v367 already recorded'; END IF; ${v.guards(v.targets)} END $$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${m.quote(history)},${m.quote(v.name)},ARRAY[${m.quote(sql)}]); SELECT true applied; COMMIT;`))
  assert.equal(result[0].applied,true)
  write('apply.json',{at:new Date().toISOString(),project_ref:m.ref,name:v.name,history_version:history,migration_sha256:m.hash(sql)})
  verify()
}
function verify() {
  const prior=backup(),after=m.snapshot();m.validateSnapshot(after)
  checkFunctions(m.query(`SELECT ${functionRows(v.targets)} functions`)[0].functions,v.targets)
  for(const f of prior.functions.filter(f=>!v.targets.some(t=>t.signature===f.signature))) assert.equal(after.functions.find(a=>a.signature===f.signature)?.md5,f.md5,'Unrelated RPC drift '+f.signature)
  const independentChanges=m.originalRowsUnchanged(prior,after)
  for(const table of Object.keys(prior.tables)) assert.equal(after.tables[table].count,prior.tables[table].count,'Catalog row count changed: '+table)
  write('after.json',after)
  write('after-manifest.json',{at:new Date().toISOString(),project_ref:m.ref,sha256:m.hash(fs.readFileSync(path.join(v.dir,'after.json'))),rollback_sha256:m.hash(v.rollback()),independentChanges,verified:true})
  console.log({verified:true,history:v.read('apply.json').history_version,functions:v.targets.length,independentChanges})
}
const commands={capture,index,smoke,'post-smoke':()=>smoke(true),apply,verify}
if(require.main===module){assert(commands[process.argv[2]],'capture|index|smoke|apply|verify|post-smoke');commands[process.argv[2]]()}
module.exports={checkFunctions,functionRows}

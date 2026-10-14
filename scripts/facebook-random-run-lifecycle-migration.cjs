// Explicit v389 audit/rollback-smoke/apply/verify. Existing linked Management API only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),dir=path.join(root,'migrations/snapshots/facebook-random-run-v389'),name='migration_v389_facebook_random_run_lifecycle'
const file=path.join(root,'migrations',name+'.sql'),sql=()=>fs.readFileSync(file,'utf8'),quote=s=>"'"+s.replaceAll("'","''")+"'",hash=s=>crypto.createHash('sha256').update(s).digest('hex')
const source=JSON.parse(fs.readFileSync(path.join(dir,'source.json')))
function query(statement){
 assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'cgjbsmqtfhqvttudyjzq')
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v389-sql-'))
 try{
  const f=path.join(tmp,'query.sql');fs.writeFileSync(f,statement)
  const r=spawnSync('supabase',['db','query','--linked','--file',f],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:12*1024*1024})
  if(r.status!==0)throw Error(r.stderr||r.error?.message||'SQL failed')
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1)).rows
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
const metadata=`SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,md5(pg_get_functiondef(p.oid)) md5,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname IN (${[...new Set(source.map(f=>f.signature.split('(')[0])),'aka_agent_facebook_random_run'].map(quote).join(',')})) OR (n.nspname='private' AND p.proname LIKE 'facebook_random_%') ORDER BY 1;`
function save(file,data){fs.writeFileSync(path.join(dir,file),JSON.stringify(data,null,2)+'\n')}
function attributesUnchanged(target){for(const before of source){const after=target.find(t=>t.signature===before.signature);assert(after,before.signature);for(const attr of ['owner','prosecdef','provolatile','proconfig','proacl'])assert.deepEqual(after[attr],before[attr],before.signature+' '+attr)}}
function rollbackSmoke(){
 const body=fs.readFileSync(path.join(root,'migrations/tests/migration_v389_facebook_random_run_lifecycle_rollback.sql'),'utf8')
 const result=query(body);save('rollback-smoke.json',{at:new Date().toISOString(),result,migration_sha256:hash(sql()),external_operations:0});return result
}
const command=process.argv[2]
if(command==='audit'){
 const result=query(sql().replace('COMMIT;',()=>metadata+'\nROLLBACK;'))
 attributesUnchanged(result);save('target.json',result);save('audit.json',{at:new Date().toISOString(),migration_sha256:hash(sql()),attributes_preserved:true})
 const smoke=query(sql().replace('COMMIT;','')+fs.readFileSync(path.join(root,'migrations/tests/migration_v389_facebook_random_run_lifecycle_rollback.sql'),'utf8').replace('BEGIN;',''))
 save('preapply-smoke.json',{at:new Date().toISOString(),result:smoke,migration_sha256:hash(sql()),external_operations:0})
 console.log({audit:'PASS',functions:result.length,smoke})
}else if(command==='apply'){
 const audit=JSON.parse(fs.readFileSync(path.join(dir,'audit.json'))),smoke=JSON.parse(fs.readFileSync(path.join(dir,'preapply-smoke.json')))
 assert.equal(audit.migration_sha256,hash(sql()));assert.equal(smoke.migration_sha256,hash(sql()))
 const live=query(metadata);for(const old of source)assert.deepEqual(live.find(r=>r.signature===old.signature),old,'Live metadata drift: '+old.signature)
 const version=new Date().toISOString().replace(/\D/g,'').slice(0,14)
 const migration=sql()
 const statement=migration.replace('BEGIN;',()=>`BEGIN; DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}) THEN RAISE EXCEPTION 'v389 already applied'; END IF; END $$;`)
  .replace('COMMIT;',()=>`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(migration)}]); COMMIT;`)
 query(statement)
 save('apply.json',{at:new Date().toISOString(),project_ref:'cgjbsmqtfhqvttudyjzq',version,name,migration_sha256:hash(migration)})
 console.log({applied:true,version,name})
}else if(command==='verify'){
 const target=JSON.parse(fs.readFileSync(path.join(dir,'target.json'))),live=query(metadata)
 for(const expected of target)assert.deepEqual(live.find(r=>r.signature===expected.signature),expected,'Target drift: '+expected.signature)
 attributesUnchanged(live)
 const history=query(`SELECT version,name FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`);assert.equal(history.length,1)
 const shape=query("SELECT count(*) FILTER(WHERE facebook_random_run_enabled) enabled_accounts,(SELECT count(*) FROM public.auto_account_random_run_days) day_rows FROM public.auto_accounts;")
 const triggers=query("SELECT tgname,tgenabled,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='public.auto_campaigns'::regclass AND tgname='facebook_random_finalize_on_release';")
 assert.equal(triggers.length,1);assert.equal(triggers[0].tgenabled,'O');assert.match(triggers[0].definition,/AFTER UPDATE OF status, runtime_claim_token, runtime_unit_token/)
 const access=query("SELECT has_table_privilege('anon','public.auto_account_random_run_days','SELECT') anon_read,has_table_privilege('authenticated','public.auto_account_random_run_days','UPDATE') authenticated_write;")[0]
 assert.equal(access.anon_read,false);assert.equal(access.authenticated_write,false)
 save('after.json',{at:new Date().toISOString(),project_ref:'cgjbsmqtfhqvttudyjzq',history,functions:live,shape,triggers,access,migration_sha256:hash(sql())})
 console.log({verified:true,history,shape,smoke:rollbackSmoke()})
}else throw Error('Use audit | apply | verify')

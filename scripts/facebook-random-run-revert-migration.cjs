// Explicit V391 rollback of V389 only. Reuses the linked Management API.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),dir=path.join(root,'migrations/snapshots/facebook-random-run-revert-v391'),name='migration_v391_revert_facebook_random_run_lifecycle'
const file=path.join(root,'migrations',name+'.sql'),sql=()=>fs.readFileSync(file,'utf8'),quote=s=>"'"+s.replaceAll("'","''")+"'",hash=s=>crypto.createHash('sha256').update(s).digest('hex')
const source=JSON.parse(fs.readFileSync(path.join(dir,'source.json'))),expected=JSON.parse(fs.readFileSync(path.join(dir,'expected.json')))
const normalize=r=>({...r,proacl:typeof r.proacl==='string'?r.proacl.slice(1,-1).split(','):r.proacl})
function query(statement){
 assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'cgjbsmqtfhqvttudyjzq')
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v391-sql-'))
 try{
  const f=path.join(tmp,'query.sql');fs.writeFileSync(f,statement)
  const r=spawnSync('supabase',['db','query','--linked','--file',f],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:12*1024*1024})
  if(r.status!==0)throw Error(r.stderr||r.error?.message||'SQL failed')
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1)).rows
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
const metadata=`SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,md5(pg_get_functiondef(p.oid)) md5,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl FROM pg_proc p WHERE p.oid IN (SELECT to_regprocedure(x) FROM unnest(ARRAY[${source.map(f=>quote(f.signature)).join(',')}]) x) ORDER BY 1;`
const smokeSql=()=>fs.readFileSync(path.join(root,'migrations/tests/migration_v391_revert_facebook_random_run_lifecycle_rollback.sql'),'utf8')
function save(file,data){fs.writeFileSync(path.join(dir,file),JSON.stringify(data,null,2)+'\n')}
function compare(actual,wanted){assert.equal(actual.length,wanted.length);for(const row of wanted)assert.deepEqual(actual.find(x=>x.signature===row.signature),row,'Function metadata mismatch: '+row.signature)}
function replaceCommit(body,tail){return body.replace(/\nCOMMIT;\s*$/,()=>`\n${tail}\n`)}
const command=process.argv[2]
if(command==='audit'){
 const target=query(replaceCommit(sql(),metadata+'\nROLLBACK;')).map(normalize);compare(target,expected)
 save('target.json',target);save('audit.json',{at:new Date().toISOString(),migration_sha256:hash(sql()),attributes_preserved:true,source_matches_v389:true,target_matches_v387:true})
 const smoke=query(replaceCommit(sql(),'')+smokeSql().replace('BEGIN;',''))
 save('preapply-smoke.json',{at:new Date().toISOString(),result:smoke,migration_sha256:hash(sql()),external_operations:0})
 console.log({audit:'PASS',functions:target.length,smoke})
}else if(command==='apply'){
 for(const receipt of ['audit.json','preapply-smoke.json'])assert.equal(JSON.parse(fs.readFileSync(path.join(dir,receipt))).migration_sha256,hash(sql()))
 compare(query(metadata).map(normalize),source)
 const version=new Date().toISOString().replace(/\D/g,'').slice(0,14),body=sql()
 const statement=replaceCommit(body.replace('BEGIN;',()=>`BEGIN; DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}) THEN RAISE EXCEPTION 'v391 already applied'; END IF; END $$;`),`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(body)}]); COMMIT;`)
 query(statement);save('apply.json',{at:new Date().toISOString(),project_ref:'cgjbsmqtfhqvttudyjzq',version,name,migration_sha256:hash(body)})
 console.log({applied:true,version,name})
}else if(command==='verify'){
 const live=query(metadata).map(normalize);compare(live,expected)
 const history=query(`SELECT version,name FROM supabase_migrations.schema_migrations WHERE name IN (${quote(name)},'migration_v389_facebook_random_run_lifecycle') ORDER BY version;`);assert.equal(history.length,2)
 const shape=query("SELECT count(*) FILTER(WHERE facebook_random_run_enabled) enabled_accounts,(SELECT count(*) FROM public.auto_account_random_run_days) day_rows,(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.auto_campaigns'::regclass AND tgname='facebook_random_finalize_on_release') removed_trigger_count FROM public.auto_accounts;");assert.equal(Number(shape[0].removed_trigger_count),0)
 const smoke=query(smokeSql());save('rollback-smoke.json',{at:new Date().toISOString(),result:smoke,migration_sha256:hash(sql()),external_operations:0})
 save('after.json',{at:new Date().toISOString(),project_ref:'cgjbsmqtfhqvttudyjzq',history,functions:live,shape,migration_sha256:hash(sql())})
 console.log({verified:true,history,shape,smoke})
}else throw Error('Use audit | apply | verify')

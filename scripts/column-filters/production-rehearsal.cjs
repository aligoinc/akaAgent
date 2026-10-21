const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),linked='/Users/lequangnhut/Repos/akaAgent',ref='cgjbsmqtfhqvttudyjzq'
assert.equal(fs.readFileSync(path.join(linked,'supabase/.temp/project-ref'),'utf8').trim(),ref)
const migration=fs.readFileSync(path.join(root,'migrations/migration_v421_data_column_filters.sql'),'utf8')
const rollback=fs.readFileSync(path.join(root,'migrations/rollback_v421_data_column_filters.sql'),'utf8')
const audit=JSON.parse(fs.readFileSync(path.join(root,'scripts/column-filters/local-migration-audit.json'),'utf8'))
const smoke=fs.readFileSync(path.join(root,'scripts/column-filters/production-smoke.sql'),'utf8')
const quote=v=>"'"+v.replaceAll("'","''")+"'"
const targetChecks=audit.local_target_functions.map(f=>`IF to_regprocedure(${quote(f.signature)}) IS NULL OR (SELECT jsonb_build_object('checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'prosecdef',p.prosecdef,'provolatile',p.provolatile,'proconfig',p.proconfig,'proacl',p.proacl::text) FROM pg_proc p WHERE p.oid=to_regprocedure(${quote(f.signature)})) IS DISTINCT FROM ${quote(JSON.stringify(Object.fromEntries(['checksum','owner','prosecdef','provolatile','proconfig','proacl'].map(k=>[k,f[k]]))))}::jsonb THEN RAISE EXCEPTION 'target attributes mismatch: ${f.name}'; END IF;`).join('\n')
const mode=process.argv[2];assert(['rehearsal','post-smoke','rollback-smoke'].includes(mode))
let sql
if(mode==='rehearsal')sql=migration.replace('BEGIN;',"BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='60s';").replace(/COMMIT;\s*$/,'')+'\n'+smoke+'\nDO $verify$ BEGIN '+targetChecks+' END $verify$;\nROLLBACK;'
else if(mode==='post-smoke')sql="BEGIN READ ONLY; SET LOCAL statement_timeout='60s';\n"+smoke+'\nDO $verify$ BEGIN '+targetChecks+' END $verify$;\nROLLBACK;'
else sql=rollback.replace('BEGIN;',"BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='60s';").replace(/COMMIT;\s*$/,'')+'\n'+smoke+"\nSELECT NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=ANY(ARRAY["+audit.local_target_functions.map(f=>'to_regprocedure('+quote(f.signature)+')').join(',')+"])) all_targets_removed;\nROLLBACK;"
const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'column-filters-'+mode+'-'))
try{
 const file=path.join(dir,'probe.sql');fs.writeFileSync(file,sql)
 const started=Date.now(),output=execFileSync('supabase',['db','query','--linked','--file',file,'--output','json'],{cwd:linked,encoding:'utf8',maxBuffer:5*1024*1024,timeout:90000,stdio:['ignore','pipe','pipe']})
 const data=JSON.parse(output.slice(output.indexOf('{'),output.lastIndexOf('}')+1))
 assert(Array.isArray(data.rows))
 const receipt={project:ref,mode,at:new Date().toISOString(),durationMs:Date.now()-started,rolledBack:true,businessWrites:0,rows:data.rows}
 fs.writeFileSync(path.join(root,'migrations/snapshots/column-filters-v421/production-'+mode+'.json'),JSON.stringify(receipt,null,2)+'\n')
 console.log(JSON.stringify(receipt))
}finally{fs.rmSync(dir,{recursive:true,force:true})}

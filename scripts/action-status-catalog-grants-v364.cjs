const fs=require('fs'),path=require('path'),assert=require('assert/strict'),m=require('./action-status-policy-migration.cjs');
const dir=path.join(m.root,'migrations/snapshots/action-status-policies-v364'),beforePath=path.join(dir,'before.json');
const before=JSON.parse(fs.readFileSync(beforePath,'utf8'));assert.equal(before.project_ref,m.ref);assert.equal(before.column_grants,null);
const name='migration_v364_action_status_catalog_grants';
const sql=`BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF has_table_privilege('aka_agent_chat_api','public.auto_account_actions','SELECT') OR EXISTS(SELECT 1 FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='auto_account_actions' AND grantee='aka_agent_chat_api') THEN RAISE EXCEPTION 'v364 prior column grants drift'; END IF;
 IF (SELECT relrowsecurity FROM pg_class WHERE oid='public.auto_account_actions'::regclass) THEN RAISE EXCEPTION 'v364 catalog security drift'; END IF;
END $$;
GRANT SELECT(code,is_active,is_delete) ON public.auto_account_actions TO aka_agent_chat_api;
COMMIT;
`;
const rollback=`BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF (SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='auto_account_actions' AND grantee='aka_agent_chat_api' AND privilege_type='SELECT') IS DISTINCT FROM ARRAY['code','is_active','is_delete'] THEN RAISE EXCEPTION 'v364 grants changed'; END IF;
END $$;
REVOKE SELECT(code,is_active,is_delete) ON public.auto_account_actions FROM aka_agent_chat_api;
-- Restore only after the new Chat writer is stopped/reverted; retain history.
COMMIT;
`;
fs.writeFileSync(path.join(m.root,'migrations',name+'.sql'),sql);fs.writeFileSync(path.join(m.root,'migrations/tests',name+'_rollback.sql'),rollback);
const write=(file,data)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const mode=process.argv[2];
if(mode==='prepare') {
 if(!fs.existsSync(path.join(dir,'manifest.json')))write('manifest.json',{project_ref:m.ref,before_sha256:m.hash(fs.readFileSync(beforePath)),migration_sha256:m.hash(sql),rollback_sha256:m.hash(rollback)});
 const smoke=m.query(sql.replace('COMMIT;',`SELECT bool_and(has_column_privilege('aka_agent_chat_api','public.auto_account_actions',c,'SELECT')) columns_readable FROM unnest(ARRAY['code','is_active','is_delete']) c;ROLLBACK;`));assert.equal(smoke[0].columns_readable,true);write('smoke.json',{at:new Date().toISOString(),columns_readable:smoke[0].columns_readable,rolled_back:true,migration_sha256:m.hash(sql)});console.log(JSON.stringify({prepared:true,columns:3,columns_readable:smoke[0].columns_readable}));
} else {
 assert(['apply','verify'].includes(mode));if(mode==='apply'){assert(!fs.existsSync(path.join(dir,'apply.json')));
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),smoke=JSON.parse(fs.readFileSync(path.join(dir,'smoke.json')));assert.equal(manifest.before_sha256,m.hash(fs.readFileSync(beforePath)));assert.equal(smoke.migration_sha256,m.hash(sql));
 const version=new Date().toISOString().replace(/\D/g,'').slice(0,14);
 m.query(sql.replace('COMMIT;',`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${m.quote(version)},${m.quote(name)},ARRAY[${m.quote(sql)}]);COMMIT;`));
 write('apply.json',{at:new Date().toISOString(),project_ref:m.ref,history_version:version,name,migration_sha256:m.hash(sql)});}
 const after=m.query("BEGIN READ ONLY;SELECT (SELECT bool_and(has_column_privilege('aka_agent_chat_api','public.auto_account_actions',c,'SELECT')) FROM unnest(ARRAY['code','is_active','is_delete']) c) columns_readable,has_table_privilege('aka_agent_chat_api','public.auto_account_actions','UPDATE') can_update,has_table_privilege('aka_agent_chat_api','public.auto_account_actions','SELECT') full_read;ROLLBACK;");assert.equal(after[0].columns_readable,true);assert.equal(after[0].can_update,false);assert.equal(after[0].full_read,false);write('after.json',{at:new Date().toISOString(),checks:after});console.log(JSON.stringify({verified:true,columns:3,full_table_read:false,config_write:false}));
}

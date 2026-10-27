// Disposable PostgreSQL17 with captured definitions/ACLs and synthetic rows.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {createFixture}=require('./desktop-session-rls/full-fixture.cjs')
const f=createFixture(),{sql,quote:q,root}=f
const m=JSON.parse(fs.readFileSync(process.env.CROSS_REPO_CAPTURE || (()=>{throw Error('Set CROSS_REPO_CAPTURE to the current metadata-only catalog snapshot')})())),id=s=>'"'+s.replaceAll('"','""')+'"'
const obj=r=>id(r.schema)+'.'+id(r.name)
const sig=f=>f.signature.startsWith('private.')||f.signature.startsWith('aka_agent_desktop_internal.')?f.signature:'public.'+f.signature
let checks=0
const pass=s=>{checks++;console.log('PASS',s)}
const perms={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',U:'USAGE',X:'EXECUTE'}
try{
 const existing=new Set(JSON.parse(sql('SELECT jsonb_agg(rolname) FROM pg_roles')))
 for(const r of m.roles)if(!existing.has(r.name))sql(`CREATE ROLE ${id(r.name)} ${r.bypassrls?'BYPASSRLS':''} ${r.inherit?'INHERIT':'NOINHERIT'};`)
 sql('CREATE SCHEMA aka_agent_desktop_internal; CREATE DOMAIN public.vector AS text; CREATE DOMAIN extensions.vector AS text;')
 // Add current identity tables/rowtypes missing in the historical schema fixture.
 for(const r of m.relations.filter(r=>['r','p'].includes(r.kind))){
  if(sql(`SELECT to_regclass(${q(r.schema+'.'+r.name)}) IS NOT NULL`)==='t')continue
  sql(`CREATE TABLE ${obj(r)} (${r.columns.map(c=>id(c.name)+' '+c.type).join(',')});`)
 }
 for(const r of m.relations.filter(r=>r.kind==='S'))if(sql(`SELECT to_regclass(${q(r.schema+'.'+r.name)}) IS NOT NULL`)!=='t')sql(`CREATE SEQUENCE ${obj(r)};`)
 const definitions=m.functions.filter(x=>!x.extension)
 sql('SET check_function_bodies=off;\n'+definitions.map(x=>x.definition+';').join('\n'))
 for(const r of m.relations.filter(r=>r.kind==='v'))sql(`CREATE OR REPLACE VIEW ${obj(r)}${r.options?.length?' WITH ('+r.options.join(',')+')':''} AS ${r.view}`)
 // Restore current defaults so write paths exercise the real timestamps/flags.
 sql(m.relations.filter(r=>['r','p'].includes(r.kind)).flatMap(r=>r.columns.filter(c=>c.default&&!c.generated).map(c=>`ALTER TABLE ${obj(r)} ALTER COLUMN ${id(c.name)} SET DEFAULT ${c.default};`)).join('\n'));
 // Current partial uniqueness is required by the existing ingest ON CONFLICT path.
 const indexes=JSON.parse(fs.readFileSync(path.join(root,'migrations/tests/cross_repo_http_permissions_indexes.json'),'utf8'));
 for(const index of indexes)if(sql(`SELECT to_regclass(${q(index.schemaname+'.'+index.indexname)}) IS NULL`)==='t')sql(index.indexdef+';');
 for(const trigger of m.triggers.filter(t=>/^auto_account_contact|^auto_data_|^auto_campaign_data_group_sources/.test(t.relation))) {
  sql(`DROP TRIGGER IF EXISTS ${id(trigger.name)} ON ${id(trigger.schema)}.${id(trigger.relation)}; ${trigger.definition};`);
 }
 const allRoles=['PUBLIC',...m.roles.map(r=>id(r.name))].join(',')
 const acl=[]
 function restore(kind,object,value,owner,column){
  acl.push(`REVOKE ALL PRIVILEGES${column?' ('+id(column)+')':''} ON ${kind} ${object} FROM ${allRoles};`)
  const entries=value===null?(kind==='FUNCTION'?['=X/'+owner,owner+'=X/'+owner]:[]):value.slice(1,-1).split(',').filter(Boolean)
  for(const e of entries){const [who,rest]=e.split('='),pv=rest.split('/')[0];
   const plain=[...pv].filter(c=>c!=='*').map(c=>perms[c]+(column?' ('+id(column)+')':''))
   if(plain.length)acl.push(`GRANT ${plain.join(',')} ON ${kind} ${object} TO ${who?id(who):'PUBLIC'}${pv.includes('*')?' WITH GRANT OPTION':''};`)
  }
 }
 for(const r of m.relations){
  if(!['r','p','v','S'].includes(r.kind))continue
  restore(r.kind==='S'?'SEQUENCE':'TABLE',obj(r),r.acl,r.owner)
  if(['r','p'].includes(r.kind))acl.push(`ALTER TABLE ${obj(r)} ${r.rls?'ENABLE':'DISABLE'} ROW LEVEL SECURITY;`)
  for(const c of r.columns)if(c.acl)restore('TABLE',obj(r),c.acl,r.owner,c.name)
 }
 for(const fn of definitions)restore('FUNCTION',sig(fn),fn.acl,fn.owner)
 sql(acl.join('\n'))
 sql(`GRANT USAGE ON SCHEMA public,private,aka_agent_desktop_internal TO ${m.roles.map(r=>id(r.name)).join(',')};`)
 const existingPolicies=JSON.parse(sql('SELECT coalesce(jsonb_agg(to_jsonb(p)),\'[]\') FROM pg_policies p'))
 sql(existingPolicies.map(p=>`DROP POLICY ${id(p.policyname)} ON ${id(p.schemaname)}.${id(p.tablename)};`).join('\n'))
 sql(m.policies.map(p=>`CREATE POLICY ${id(p.policyname)} ON ${id(p.schemaname)}.${id(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(x=>x==='public'?'PUBLIC':id(x)).join(',')}${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''};`).join('\n'))

 // Capture exact current owners as well as ACLs.
 sql(definitions.map(fn=>`ALTER FUNCTION ${sig(fn)} OWNER TO ${id(fn.owner)};`).join('\n'));
 sql(m.relations.filter(r=>['r','p','v','S'].includes(r.kind)).map(r=>`ALTER ${r.kind==='S'?'SEQUENCE':r.kind==='v'?'VIEW':'TABLE'} ${obj(r)} OWNER TO ${id(r.owner)};`).join('\n'));
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261027173856_cross_repo_http_permissions.sql'),'utf8');
 const before=sql("SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_array(md5(pg_get_functiondef(p.oid)),p.proacl::text,p.proconfig,p.prosecdef,p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')");
 sql('BEGIN;'+migration+'ROLLBACK;');
 assert.equal(sql("SELECT to_regprocedure('public.aka_agent_chat_aux_settings(text)') IS NULL"),'t');pass('candidate transaction rolls back');
 // Reject a dependency metadata change before creating any wrapper.
 try { sql("BEGIN; ALTER FUNCTION public.auto_assert_automation_identity(bigint,bigint,text,text) SET lock_timeout='9s';"+migration+'ROLLBACK;'); throw Error('expected drift rejection'); }
 catch(e){assert.match(e.message,/cross_repo_http_dependency_drift/);pass('dependency drift rejected');}
 sql('BEGIN;'+migration+'COMMIT;');
 const originalFunctions=JSON.parse(before),after=JSON.parse(sql("SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_array(md5(pg_get_functiondef(p.oid)),p.proacl::text,p.proconfig,p.prosecdef,p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')"));
 for(const [signature,metadata] of Object.entries(originalFunctions))assert.deepEqual(after[signature],metadata,signature);
 pass('all existing function bodies, ACLs, config, security modes and owners unchanged');
 try { sql('BEGIN;'+migration+'ROLLBACK;');throw Error('expected repeat rejection'); }
 catch(e){assert.match(e.message,/cross_repo_http_target_already_exists/);pass('repeat apply rejected');}
 console.log(sql(fs.readFileSync(path.join(root,'migrations/tests/cross_repo_http_permissions_smoke.sql'),'utf8')));
 const rollback=fs.readFileSync(path.join(root,'migrations/rollback_cross_repo_http_permissions.sql'),'utf8');
 try {sql('BEGIN;'+rollback+'ROLLBACK;');throw Error('expected rollback gate');}
 catch(e){assert.match(e.message,/cross_repo_http_rollback_requires_stopped_callers/);pass('rollback requires explicit stopped-caller gate');}
 try {sql("BEGIN; SET LOCAL aka_agent.cross_repo_http_rollback='approved-after-callers-stopped'; ALTER FUNCTION public.akamap_data_group_types(jsonb) SET lock_timeout='9s';"+rollback+'ROLLBACK;');throw Error('expected rollback drift');}
 catch(e){assert.match(e.message,/cross_repo_http_rollback_drift/);pass('rollback rejects newer function metadata');}
 sql("BEGIN; SET LOCAL aka_agent.cross_repo_http_rollback='approved-after-callers-stopped';"+rollback+'ROLLBACK;');
 pass('guarded rollback rehearsal preserves installed functions');
 console.log(sql("SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'checksum',md5(pg_get_functiondef(p.oid)),'config',p.proconfig,'acl',p.proacl::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN ('aka_agent_chat_aux_settings','akamap_data_group_types','akamap_create_data_group','akamap_list_data_groups','akamap_list_data_group_datasets','akamap_ingest_data_group','akamap_assert_data_group_identity') AND n.nspname IN ('public','private')"));
 sql("BEGIN; SET LOCAL aka_agent.cross_repo_http_rollback='approved-after-callers-stopped';"+rollback+'COMMIT;');
 const reverted=JSON.parse(sql("SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_array(md5(pg_get_functiondef(p.oid)),p.proacl::text,p.proconfig,p.prosecdef,p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal')"));
 assert.deepEqual(reverted,originalFunctions);pass('rollback restores exact original function metadata without opening anon');
}finally{f.close()}

// ACL-only change derived from a fresh production metadata capture.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..'),dir=path.join(root,'migrations/snapshots/desktop-block-workflow-readonly')
const before=JSON.parse(fs.readFileSync(path.join(dir,'before.json'),'utf8'))
const q=s=>"'"+String(s).replaceAll("'","''")+"'",id=s=>'"'+s.replaceAll('"','""')+'"'
const names=['auto_blocks','auto_workflows'],tables=names.map(n=>'public.'+id(n)).join(',')
const relationsSql=`SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname) FROM pg_class c WHERE c.oid IN ('public.auto_blocks'::regclass,'public.auto_workflows'::regclass)`
const contract=relations=>relations.map(r=>({name:r.name,owner:r.owner,acl:r.acl,rls:r.rls,force:r.force,columns:r.columns.map(c=>({name:c.name,acl:c.acl}))}))
const guard=relations=>`IF (${relationsSql}) IS DISTINCT FROM ${q(JSON.stringify(contract(relations)))}::jsonb THEN RAISE EXCEPTION 'block/workflow ACL source drift'; END IF;`
const postcheck=`DO $check$ DECLARE t regclass; BEGIN
 FOREACH t IN ARRAY ARRAY['public.auto_blocks'::regclass,'public.auto_workflows'::regclass] LOOP
  IF NOT has_table_privilege('aka_agent_desktop',t,'SELECT')
   OR has_any_column_privilege('aka_agent_desktop',t,'INSERT')
   OR has_any_column_privilege('aka_agent_desktop',t,'UPDATE')
   OR has_table_privilege('aka_agent_desktop',t,'DELETE')
   OR has_table_privilege('aka_agent_desktop',t,'TRUNCATE') THEN
   RAISE EXCEPTION 'Desktop must retain read-only block/workflow access'; END IF;
 END LOOP;
END $check$;`
const migration=`-- Revoke definition writes only; runtime SELECT and all other roles are preserved.
-- PostgreSQL REVOKE at table level also removes corresponding column grants.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN ${guard(before.relations)} END $guard$;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON TABLE ${tables} FROM aka_agent_desktop;
${postcheck}
NOTIFY pgrst,'reload schema';
`
const migrationPath=path.join(root,'supabase/migrations/20261027190936_desktop_block_workflow_readonly.sql')
const effectiveSql=`SELECT md5(string_agg(r.rolname||':'||c.relname||':'||a.attname||':'||p.priv||':'||has_column_privilege(r.oid,c.oid,a.attnum,p.priv)::text,',' ORDER BY r.rolname,c.relname,a.attnum,p.priv)) FROM pg_roles r CROSS JOIN pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(priv) WHERE c.oid IN ('public.auto_blocks'::regclass,'public.auto_workflows'::regclass) AND r.rolname<>'aka_agent_desktop'`
const tableEffectiveSql=`SELECT md5(string_agg(r.rolname||':'||c.relname||':'||p.priv||':'||has_table_privilege(r.oid,c.oid,p.priv)::text,',' ORDER BY r.rolname,c.relname,p.priv)) FROM pg_roles r CROSS JOIN pg_class c CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv) WHERE c.oid IN ('public.auto_blocks'::regclass,'public.auto_workflows'::regclass) AND r.rolname<>'aka_agent_desktop'`
const captureSql=`SELECT jsonb_build_object(
 'relations',(${relationsSql}),
 'other_role_column_permissions',(${effectiveSql}),
 'other_role_table_permissions',(${tableEffectiveSql}),
 'functions',(SELECT md5(string_agg(md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,'')||p.proowner::text,',' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND p.prokind='f'),
 'other_relation_permissions',(SELECT md5(string_agg(c.oid::text||coalesce(c.relacl::text,'')||coalesce(a.attacl::text,''),',' ORDER BY c.oid,a.attnum)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND c.oid NOT IN ('public.auto_blocks'::regclass,'public.auto_workflows'::regclass)),
 'policies',(SELECT md5(string_agg(to_jsonb(p)::text,',' ORDER BY schemaname,tablename,policyname)) FROM pg_policies p),
 'triggers',(SELECT md5(string_agg(pg_get_triggerdef(oid),',' ORDER BY oid)) FROM pg_trigger WHERE NOT tgisinternal),
 'roles',(SELECT md5(string_agg(to_jsonb(r)::text,',' ORDER BY oid)) FROM pg_roles r),
 'memberships',(SELECT md5(string_agg(to_jsonb(m)::text,',' ORDER BY roleid,member,grantor)) FROM pg_auth_members m),
 'default_acl',(SELECT md5(string_agg(to_jsonb(a)::text,',' ORDER BY oid)) FROM pg_default_acl a),
 'blocks',(SELECT jsonb_build_object('count',count(*),'checksum',md5(string_agg(md5(to_jsonb(b)::text),'' ORDER BY id))) FROM public.auto_blocks b),
 'workflows',(SELECT jsonb_build_object('count',count(*),'checksum',md5(string_agg(md5(to_jsonb(w)::text),'' ORDER BY id))) FROM public.auto_workflows w)
) AS state`
function rollback(target){
 const grants=before.relations.map(r=>{
  assert.equal(r.acl,'{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_desktop=rd/postgres}')
  const columns=r.columns.filter(c=>c.acl);for(const c of columns)assert.equal(c.acl,'{aka_agent_desktop=aw/postgres}')
  const list=columns.map(c=>id(c.name)).join(',')
  return `GRANT DELETE ON public.${id(r.name)} TO aka_agent_desktop;\nGRANT INSERT (${list}),UPDATE (${list}) ON public.${id(r.name)} TO aka_agent_desktop;`
 }).join('\n')
 return `SET LOCAL lock_timeout='5s';\nDO $guard$ BEGIN
 IF current_setting('aka_agent.block_workflow_rollback',true) IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'block/workflow rollback requires explicit approval'; END IF;
 ${guard(target)} END $guard$;\n${grants}\nDO $restore$ BEGIN ${guard(before.relations)} END $restore$;\nNOTIFY pgrst,'reload schema';\n`
}
function trial(undo){
 const verify=exact=>`DO $verify$ DECLARE v_before jsonb; v_after jsonb; BEGIN
 SELECT state INTO v_before FROM pg_temp.block_workflow_before;
 SELECT state INTO v_after FROM (${captureSql}) audit_state;
 IF ${exact?'v_after IS DISTINCT FROM v_before':"(v_after-'relations') IS DISTINCT FROM (v_before-'relations')"} THEN RAISE EXCEPTION 'Unexpected block/workflow metadata or data change';END IF;END $verify$;`
 const reads=names.map(t=>`SELECT md5(string_agg(md5(to_jsonb(x)::text),'' ORDER BY id)) AS ${t}_read_checksum FROM public.${t} x;`).join('\n')
 const deny=`DO $denial$ DECLARE t text; denied boolean; BEGIN FOREACH t IN ARRAY ARRAY['auto_blocks','auto_workflows'] LOOP
 denied:=false;BEGIN EXECUTE format('UPDATE public.%I SET name=name WHERE false',t);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Desktop update unexpectedly allowed';END IF;
 denied:=false;BEGIN EXECUTE format('DELETE FROM public.%I WHERE false',t);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Desktop delete unexpectedly allowed';END IF;END LOOP;END $denial$;`
 return `BEGIN;SET LOCAL statement_timeout='30s';CREATE TEMP TABLE block_workflow_before ON COMMIT DROP AS ${captureSql};
 ${migration}${verify(false)}SET LOCAL ROLE aka_agent_desktop;${reads}${deny}
 RESET ROLE;SET LOCAL aka_agent.block_workflow_rollback='approved';${undo}${verify(true)}
 SELECT true AS trial_passed;ROLLBACK;\n`
}
if(require.main===module){fs.writeFileSync(migrationPath,migration);fs.writeFileSync(path.join(dir,'capture.sql'),captureSql+';\n');console.log(migrationPath)}
module.exports={root,dir,before,names,q,id,guard,contract,relationsSql,migration,migrationPath,captureSql,rollback,postcheck,trial}

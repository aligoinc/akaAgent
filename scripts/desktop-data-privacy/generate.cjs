// SQL-only hardening. Source app, legacy grants and existing RPC bodies stay intact.
const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const c = require('./config.cjs'), { quote:q, ident:id } = c
const m = JSON.parse(fs.readFileSync(c.before()))
assert.equal(m.project, 'cgjbsmqtfhqvttudyjzq')
const signature = f => f.schema + '.' + f.signature.replace(/^(public|private|aka_agent_desktop_internal)\./,'')
const definitions = [
`CREATE FUNCTION private.aka_agent_desktop_data_context()
RETURNS TABLE(staff_id bigint, organization_id bigint, system_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public
AS $function$
 SELECT s.id, s.organization_id,
   COALESCE(s.is_admin_akabiz AND s.is_active AND s.deleted_at IS NULL,false)
 FROM public.org_staff s
 WHERE current_setting('role',true)='aka_agent_desktop'
   AND s.id=(SELECT private.aka_agent_staff_scope_for_request());
$function$;`,
`CREATE FUNCTION private.aka_agent_desktop_shared_content_groups()
RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public
AS $function$
 SELECT COALESCE(array_agg(g.id),ARRAY[]::bigint[])
 FROM private.aka_agent_desktop_data_context() ctx
 JOIN public.auto_content_groups g ON g.organization_id=ctx.organization_id
 WHERE g.staff_id<>ctx.staff_id AND NOT g.is_delete AND g.sharing_scope IN ('organization','selected')
   AND private.group_access('content',g.id,ctx.staff_id,ctx.organization_id) IS NOT NULL;
$function$;`,
`CREATE FUNCTION private.aka_agent_guard_desktop_data_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public
AS $function$
DECLARE ctx record; previous jsonb; next_row jsonb; column_name text; parent_staff bigint;
  target_id bigint; target_kind text; parent_columns text[]; parent_kinds text[]; i integer;
BEGIN
 -- current_user is the definer inside RPCs; the authenticated DB role is retained.
 IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 SELECT * INTO ctx FROM private.aka_agent_desktop_data_context();
 IF ctx.staff_id IS NULL OR ctx.staff_id<=0 THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_data_identity_required';
 END IF;
 IF TG_OP<>'INSERT' THEN previous:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN next_row:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='auto_system_settings' THEN
   IF NOT ctx.system_admin THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_settings_admin_required'; END IF;
 ELSIF TG_TABLE_NAME='auto_elements' THEN
   IF NOT ctx.system_admin AND (
     (TG_OP<>'INSERT' AND ((previous->>'staff_id')::bigint IS DISTINCT FROM ctx.staff_id OR COALESCE((previous->>'is_builtin')::boolean,false))) OR
     (TG_OP<>'DELETE' AND ((next_row->>'staff_id')::bigint IS DISTINCT FROM ctx.staff_id OR COALESCE((next_row->>'is_builtin')::boolean,false)))) THEN
     RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_element_owner_required';
   END IF;
   IF NOT ctx.system_admin AND TG_OP<>'DELETE' AND
     (TG_OP='INSERT' OR next_row->'organization_id' IS DISTINCT FROM previous->'organization_id') AND
     (next_row->>'organization_id')::bigint IS DISTINCT FROM ctx.organization_id THEN
     RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_data_organization_denied';
   END IF;
 ELSIF TG_TABLE_NAME IN ('auto_account_contact_group_members','auto_media_group_items') THEN
   IF TG_OP<>'INSERT' THEN
     IF TG_TABLE_NAME='auto_account_contact_group_members' THEN
       SELECT staff_id INTO parent_staff FROM public.auto_account_contact_groups WHERE id=(previous->>'group_id')::bigint;
     ELSE SELECT staff_id INTO parent_staff FROM public.auto_media_groups WHERE id=(previous->>'group_id')::bigint; END IF;
     IF parent_staff IS DISTINCT FROM ctx.staff_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_membership_owner_denied'; END IF;
   END IF;
   IF TG_TABLE_NAME='auto_account_contact_group_members' THEN parent_columns:=ARRAY['group_id','contact_id']; parent_kinds:=ARRAY['data_group','contact'];
   ELSE parent_columns:=ARRAY['group_id','media_file_id']; parent_kinds:=ARRAY['media_group','media']; END IF;
 ELSE
   IF (TG_OP<>'INSERT' AND (previous->>'staff_id')::bigint IS DISTINCT FROM ctx.staff_id) OR
      (TG_OP<>'DELETE' AND (next_row->>'staff_id')::bigint IS DISTINCT FROM ctx.staff_id) THEN
     RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_data_owner_denied';
   END IF;
   -- Preserve legacy org values on unrelated updates, as in the account/campaign guard.
   IF TG_OP<>'DELETE' AND (TG_OP='INSERT' OR next_row->'organization_id' IS DISTINCT FROM previous->'organization_id')
      AND (next_row->>'organization_id')::bigint IS DISTINCT FROM ctx.organization_id THEN
     RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_data_organization_denied';
   END IF;
   CASE TG_TABLE_NAME
     WHEN 'auto_account_contacts' THEN parent_columns:=ARRAY['account_id']; parent_kinds:=ARRAY['account'];
     WHEN 'auto_account_contact_groups' THEN parent_columns:=ARRAY['account_id','bound_zalo_account_id']; parent_kinds:=ARRAY['account','account'];
     WHEN 'auto_contact_tags' THEN parent_columns:=ARRAY['auto_account_id']; parent_kinds:=ARRAY['account'];
     WHEN 'auto_content_templates' THEN parent_columns:=ARRAY['group_id']; parent_kinds:=ARRAY['content_group'];
     ELSE parent_columns:=ARRAY[]::text[]; parent_kinds:=ARRAY[]::text[];
   END CASE;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF parent_columns IS NOT NULL THEN
   FOR i IN 1..cardinality(parent_columns) LOOP
     column_name:=parent_columns[i]; target_kind:=parent_kinds[i]; target_id:=(next_row->>column_name)::bigint;
     IF target_id IS NULL OR (TG_OP='UPDATE' AND next_row->column_name IS NOT DISTINCT FROM previous->column_name) THEN CONTINUE; END IF;
     CASE target_kind
       WHEN 'account' THEN SELECT staff_id INTO parent_staff FROM public.auto_accounts WHERE id=target_id;
       WHEN 'data_group' THEN SELECT staff_id INTO parent_staff FROM public.auto_account_contact_groups WHERE id=target_id;
       WHEN 'contact' THEN SELECT staff_id INTO parent_staff FROM public.auto_account_contacts WHERE id=target_id;
       WHEN 'content_group' THEN SELECT staff_id INTO parent_staff FROM public.auto_content_groups WHERE id=target_id;
       WHEN 'media_group' THEN SELECT staff_id INTO parent_staff FROM public.auto_media_groups WHERE id=target_id;
       WHEN 'media' THEN SELECT staff_id INTO parent_staff FROM public.auto_media_files WHERE id=target_id;
       ELSE RAISE EXCEPTION 'unknown privacy reference';
     END CASE;
     IF parent_staff IS DISTINCT FROM ctx.staff_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_data_reference_denied'; END IF;
   END LOOP;
 END IF;
 IF TG_TABLE_NAME='auto_content_templates' AND (TG_OP='INSERT' OR next_row->'secondary_group_ids' IS DISTINCT FROM previous->'secondary_group_ids') THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF(next_row->'secondary_group_ids','null'::jsonb),'[]'::jsonb)) member(id)
     LEFT JOIN public.auto_content_groups g ON g.id=member.id::bigint WHERE g.staff_id IS DISTINCT FROM ctx.staff_id) THEN
     RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_content_group_scope_denied';
   END IF;
 END IF;
 IF TG_TABLE_NAME='auto_account_contacts' AND (TG_OP='INSERT' OR next_row->'akabiz_tag_ids' IS DISTINCT FROM previous->'akabiz_tag_ids') THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF(next_row->'akabiz_tag_ids','null'::jsonb),'[]'::jsonb)) tag(id)
     LEFT JOIN public.auto_contact_tags t ON t.id=tag.id::bigint WHERE t.staff_id IS DISTINCT FROM ctx.staff_id) THEN
     RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_contact_tag_scope_denied';
   END IF;
 END IF;
 RETURN NEW;
END;
$function$;`
]
const newFunctions = ['private.aka_agent_desktop_data_context()', 'private.aka_agent_desktop_shared_content_groups()', 'private.aka_agent_guard_desktop_data_write()']
const staff='(SELECT private.aka_agent_staff_scope_for_request())'
const org='(SELECT organization_id FROM private.aka_agent_desktop_data_context())'
const admin='COALESCE((SELECT system_admin FROM private.aka_agent_desktop_data_context()),false)'
const own=`staff_id=${staff}`
const shared='(SELECT unnest(private.aka_agent_desktop_shared_content_groups()))'
const policies=[]
function policy(table, command, using, check, suffix='scope') { policies.push({table,name:`v436_${suffix}_${command.toLowerCase()}`,command,using,check}) }
for(const table of c.roots){
  if(['auto_content_groups','auto_content_templates'].includes(table)){
    const read=table==='auto_content_groups'?`${own} OR id IN ${shared}`:
      `${own} OR EXISTS(SELECT 1 FROM public.auto_content_groups g WHERE g.id=auto_content_templates.group_id AND g.id IN ${shared} AND g.staff_id=auto_content_templates.staff_id AND g.organization_id=auto_content_templates.organization_id AND g.is_active AND NOT auto_content_templates.is_delete)`
    policy(table,'SELECT',read,null)
    policy(table,'INSERT',null,own);policy(table,'UPDATE',own,own);policy(table,'DELETE',own,null)
  }else policy(table,'ALL',own,own)
}
for(const table of c.members){
  const parent=table==='auto_account_contact_group_members'?'auto_account_contact_groups':'auto_media_groups'
  const owner=`EXISTS(SELECT 1 FROM public.${parent} g WHERE g.id=${table}.group_id AND g.staff_id=${staff})`
  policy(table,'ALL',owner,owner)
}
for(const cmd of ['INSERT','UPDATE','DELETE']){
  policy('auto_system_settings',cmd,cmd==='INSERT'?null:admin,cmd==='DELETE'?null:admin,'admin')
  const element=`${admin} OR (${own} AND NOT COALESCE(is_builtin,false))`
  policy('auto_elements',cmd,cmd==='INSERT'?null:element,cmd==='DELETE'?null:element,'owner')
}
policy('org_organization','SELECT',`id=${org} OR is_admin_akabiz IS TRUE`,null)
policy('org_organization_product','SELECT',`organization_id=${org}`,null)
const triggerTables=[...c.roots,...c.members,'auto_elements','auto_system_settings']
const organizationColumns=['id','name','staff_admin_id','is_admin_akabiz']
const relevant=m.functions.filter(f=>c.tables.some(t=>new RegExp('\\b'+t+'\\b').test(f.definition)) || ['aka_agent_staff_scope_for_request','auto_assert_automation_identity'].includes(f.name))
const functionGuard=relevant.map(f=>({signature:signature(f),checksum:f.checksum,owner:f.owner,acl:f.acl,config:f.config,security_definer:f.security_definer,volatility:f.volatility}))
const relGuard=m.relations.filter(r=>r.schema==='public'&&c.tables.includes(r.name)).map(r=>({name:r.name,rls:r.rls,force:r.force,acl:r.acl,owner:r.owner,columns:r.columns.map(x=>({name:x.name,type:x.type,acl:x.acl}))}))
const policyGuard=m.policies.filter(p=>p.schemaname==='public'&&c.tables.includes(p.tablename))
const triggerGuard=m.triggers.filter(t=>t.schema==='public'&&c.tables.includes(t.relation))
const existingGuard=`DO $guard$
DECLARE e jsonb; actual jsonb; dependency_oid regprocedure;
BEGIN
 FOR e IN SELECT value FROM jsonb_array_elements(${q(JSON.stringify(functionGuard))}::jsonb) LOOP
   dependency_oid:=to_regprocedure(e->>'signature');
   SELECT jsonb_build_object('signature',e->>'signature','checksum',md5(pg_get_functiondef(oid)),'owner',pg_get_userbyid(proowner),'acl',proacl::text,'config',proconfig,'security_definer',prosecdef,'volatility',provolatile) INTO actual FROM pg_proc WHERE oid=dependency_oid;
   IF actual IS DISTINCT FROM e THEN RAISE EXCEPTION 'V436 dependency drift: %',e->>'signature'; END IF;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(${q(JSON.stringify(relGuard))}::jsonb) LOOP
   SELECT jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text,'owner',pg_get_userbyid(c.relowner),
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'acl',a.attacl::text) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) INTO actual
    FROM pg_class c WHERE c.oid=to_regclass('public.'||(e->>'name'));
   IF actual IS DISTINCT FROM e THEN RAISE EXCEPTION 'V436 relation drift: %',e->>'name'; END IF;
 END LOOP;
 SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname),'[]'::jsonb) INTO actual FROM pg_policies p WHERE schemaname='public' AND tablename=ANY(ARRAY[${c.tables.map(q)}]);
 IF actual IS DISTINCT FROM ${q(JSON.stringify(policyGuard))}::jsonb THEN RAISE EXCEPTION 'V436 policy drift'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',t.tgname,'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,'definition',pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb) INTO actual FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname=ANY(ARRAY[${c.tables.map(q)}]);
 IF actual IS DISTINCT FROM ${q(JSON.stringify(triggerGuard))}::jsonb THEN RAISE EXCEPTION 'V436 trigger drift'; END IF;
 ${newFunctions.map(s=>`IF to_regprocedure(${q(s)}) IS NOT NULL THEN RAISE EXCEPTION 'V436 helper already exists'; END IF;`).join('\n ')}
END $guard$;`
const policySql=policies.map(p=>`CREATE POLICY ${id(p.name)} ON public.${id(p.table)} AS RESTRICTIVE FOR ${p.command} TO aka_agent_desktop${p.using?' USING ('+p.using+')':''}${p.check?' WITH CHECK ('+p.check+')':''};`).join('\n')
const triggers=triggerTables.map(t=>`CREATE TRIGGER aaa_v436_desktop_data_owner BEFORE INSERT OR UPDATE OR DELETE ON public.${id(t)} FOR EACH ROW EXECUTE FUNCTION private.aka_agent_guard_desktop_data_write();`).join('\n')
const permissionSql=newFunctions.map((s,i)=>`REVOKE ALL ON FUNCTION ${s} FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api;${i<2?'\nGRANT EXECUTE ON FUNCTION '+s+' TO aka_agent_desktop;':''}`).join('\n')
const body=[`-- V436: preserve owner/shared workflows; no client changes or legacy access restoration.
-- Derived from akachat capture ${m.captured_at}; private capture stays outside Git.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';`,existingGuard,...definitions,permissionSql,policySql,triggers,
`REVOKE SELECT ON public.org_organization FROM aka_agent_desktop;
GRANT SELECT (${organizationColumns.map(id)}) ON public.org_organization TO aka_agent_desktop;`].join('\n\n')+'\n'
fs.mkdirSync(c.dir,{recursive:true})
fs.writeFileSync(c.migration,body)
fs.writeFileSync(c.dir+'/plan.json',JSON.stringify({capturedAt:m.captured_at,tables:c.tables,roots:c.roots,members:c.members,policies,triggerTables,newFunctions,organizationColumns,dependencyFunctions:functionGuard,sourceRelations:relGuard,sourcePolicies:policyGuard,sourceTriggers:triggerGuard,migrationSha256:crypto.createHash('sha256').update(body).digest('hex')},null,2)+'\n')
// A guarded rollback is generated after the target metadata has been captured locally.
console.log(JSON.stringify({migration:c.migration,policies:policies.length,triggers:triggerTables.length,newFunctions:newFunctions.length,guardedDependencies:relevant.length,bytes:Buffer.byteLength(body)}))

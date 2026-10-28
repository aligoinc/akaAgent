// Build only from the live metadata captured for this change.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {privateSecurityAsset}=require('../desktop-session-rls/private-security-assets.cjs')
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'migrations/snapshots/staff-self-access')
const m=JSON.parse(fs.readFileSync(privateSecurityAsset('migrations/snapshots/staff-self-access/full-before.json')))
const q=s=>"'"+String(s).replaceAll("'","''")+"'"
const names=['aka_agent_staff_runtime_scope','aka_agent_staff_time_allowed','aka_agent_group_sharing','group_access']
const admin=['aka_agent_admin_cron','aka_agent_admin_docs','aka_agent_admin_notifications','aka_agent_admin_settings','aka_agent_admin_triggers','aka_agent_staff_management']
const targets=m.functions.filter(f=>names.includes(f.name)||admin.includes(f.name))
assert.equal(targets.length,10)
const fullsig=f=>f.signature.startsWith('private.')?f.signature:'public.'+f.signature
const guard=targets.map(f=>` IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(${q(fullsig(f))}) AND md5(pg_get_functiondef(oid))=${q(f.checksum)} AND pg_get_userbyid(proowner)=${q(f.owner)} AND proacl::text IS NOT DISTINCT FROM ${f.acl?q(f.acl):'NULL'}) THEN RAISE EXCEPTION 'staff self-access source drift: %',${q(fullsig(f))}; END IF;`).join('\n')
const view=m.relations.find(r=>r.name==='aka_agent_staff_runtime_profile')
const viewguard=` IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.aka_agent_staff_runtime_profile') AND pg_get_viewdef(oid,true)=${q(view.view)} AND relacl::text=${q(view.acl)} AND pg_get_userbyid(relowner)=${q(view.owner)} AND reloptions=ARRAY['security_barrier=true']) THEN RAISE EXCEPTION 'staff self-access runtime view drift'; END IF;`
const helper=`CREATE FUNCTION private.aka_agent_staff_scope_for_request()
 RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_claims jsonb; v_user uuid; v_staff bigint;
BEGIN
 -- SET ROLE is retained across SECURITY DEFINER calls; current_user is not.
 IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN NULL; END IF;
 BEGIN
  v_claims := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  IF v_claims->>'role' IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN 0; END IF;
  v_user := NULLIF(v_claims->>'sub','')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN 0;
 END;
 SELECT staff_id INTO v_staff FROM private.aka_agent_desktop_users WHERE auth_user_id=v_user;
 RETURN COALESCE(v_staff,0);
END;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_staff_scope_for_request() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.aka_agent_staff_scope_for_request() TO aka_agent_desktop,service_role,aka_agent_chat_api;`
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,'unique patch anchor');return s.replace(a,b)}
const patches=targets.filter(f=>names.includes(f.name)).map(f=>{
 let d=f.definition
 if(f.name==='aka_agent_staff_runtime_scope')d=replace(d," IF p_lock='share' THEN",` IF private.aka_agent_staff_scope_for_request() IS NOT NULL
    AND p_staff_id IS DISTINCT FROM private.aka_agent_staff_scope_for_request() THEN RETURN; END IF;
 IF p_lock='share' THEN`)
 if(f.name==='aka_agent_staff_time_allowed')d=replace(d,'WHERE s.id=p_staff_id),false);',`WHERE s.id=p_staff_id
      AND ((SELECT private.aka_agent_staff_scope_for_request()) IS NULL
        OR s.id=(SELECT private.aka_agent_staff_scope_for_request()))),false);`)
 if(f.name==='aka_agent_group_sharing'){
  d=replace(d,'BEGIN\n  PERFORM public.auto_assert_automation_identity',`BEGIN
  IF private.aka_agent_staff_scope_for_request() IS NOT NULL
    AND p_staff_id IS DISTINCT FROM private.aka_agent_staff_scope_for_request() THEN
    RAISE EXCEPTION 'group_sharing_access_denied';
  END IF;
  PERFORM public.auto_assert_automation_identity`)
  d=replace(d,"  IF p_action='staff' THEN",`  IF p_action='staff' THEN
    IF private.aka_agent_staff_scope_for_request() IS NOT NULL THEN RETURN '[]'::jsonb; END IF;`)
 }
 if(f.name==='group_access')d=replace(d,"COALESCE(NULLIF(owner.name,''),'Nhân viên #'||owner.id)",`CASE WHEN (SELECT private.aka_agent_staff_scope_for_request()) IS NOT NULL
      AND owner.id IS DISTINCT FROM (SELECT private.aka_agent_staff_scope_for_request())
      THEN 'Nhân viên #'||owner.id ELSE COALESCE(NULLIF(owner.name,''),'Nhân viên #'||owner.id) END`)
 return {...f,target_definition:d}
})
const newview=view.view.trim().replace(/;$/,'')+`\n WHERE (SELECT private.aka_agent_staff_scope_for_request()) IS NULL\n    OR id=(SELECT private.aka_agent_staff_scope_for_request());`
const sql=`-- akachat only. Server-side Desktop staff privacy; no client update or business-row edits.
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NOT NULL THEN RAISE EXCEPTION 'staff self-access helper already exists'; END IF;
${guard}
${viewguard}
END $guard$;
${helper}
CREATE OR REPLACE VIEW public.aka_agent_staff_runtime_profile WITH (security_barrier=true) AS ${newview}
${patches.map(f=>f.target_definition+';').join('\n')}
${targets.filter(f=>admin.includes(f.name)).map(f=>`REVOKE EXECUTE ON FUNCTION ${fullsig(f)} FROM aka_agent_desktop;`).join('\n')}
NOTIFY pgrst,'reload schema';
`
fs.writeFileSync(path.join(root,'supabase/migrations/20261027175514_desktop_staff_self_access.sql'),sql)
fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify({functions:patches,revoked:targets.filter(f=>admin.includes(f.name)),view,newview},null,2)+'\n')
console.log('Generated guarded migration: 4 function patches, 6 Desktop revokes, 1 view filter, 1 private helper')

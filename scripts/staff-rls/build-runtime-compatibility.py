import json,re
from pathlib import Path
source=json.loads(Path('migrations/snapshots/staff-rls/source.json').read_text())
columns='id,organization_id,name,phone,username,is_active,is_admin,is_admin_akabiz,use_test_workflow,deleted_at,expiration_date,max_running_zalo_web_accounts,max_running_facebook_accounts'
select=','.join('s.'+c for c in columns.split(','))
out=['''-- PHASE B: read-only runtime projection and existing invoker compatibility.
-- Candidate, NOT applied. No RLS/grant change on org_staff in this migration.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('public.aka_agent_staff_runtime_profile') IS NOT NULL
 OR to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'staff runtime compatibility objects already exist; re-audit';
 END IF;
END;
$preflight$;
''', f'''-- Intentional definer view: only the metadata already returned by Server
-- discovery/capability RPCs. No passwords, device hashes, CRM fields or writes.
CREATE VIEW public.aka_agent_staff_runtime_profile WITH (security_barrier=true) AS
 SELECT {columns} FROM public.org_staff;
ALTER VIEW public.aka_agent_staff_runtime_profile OWNER TO postgres;
REVOKE ALL ON public.aka_agent_staff_runtime_profile FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.aka_agent_staff_runtime_profile TO anon,authenticated,service_role;

-- Locks the same staff row, in the same position in each original RPC's lock
-- order. Only this narrow helper runs as owner; campaign/account writes still
-- run as the caller and retain their original RLS, tokens and CAS guards.
CREATE FUNCTION public.aka_agent_staff_runtime_scope(p_staff_id bigint,p_lock text)
RETURNS SETOF public.aka_agent_staff_runtime_profile
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s'
AS $function$
BEGIN
 IF p_staff_id IS NULL OR p_staff_id<=0 OR p_lock IS NULL OR p_lock NOT IN ('share','update') THEN
  RAISE EXCEPTION 'staff_runtime_scope_invalid';
 END IF;
 IF p_lock='share' THEN
  RETURN QUERY SELECT {select} FROM public.org_staff s WHERE s.id=p_staff_id FOR SHARE OF s;
 ELSE
  RETURN QUERY SELECT {select} FROM public.org_staff s WHERE s.id=p_staff_id FOR UPDATE OF s;
 END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_staff_runtime_scope(bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_staff_runtime_scope(bigint,text) TO anon,authenticated,service_role;
''']
changed=[]
for f in source:
 if f['prosecdef'] or f['signature'].startswith(('get_managed_staff(', 'fn_opp_ctx(')): continue
 body=f['definition']
 # Each target has a single staff relation. Never alter predicates or locks on
 # account/campaign/input rows, even when nested under the same statement.
 matches=list(re.finditer(r'FROM public\.org_staff(?P<alias> AS staff| staff)?(?P<predicate>[\s\S]*?)FOR (?P<mode>SHARE|UPDATE)(?: OF staff)?;',body,re.I))
 if matches:
  assert len(matches)==1,f['signature']
  m=matches[0]
  assert 'p_staff_id' in m.group('predicate'),f['signature']
  replacement="FROM public.aka_agent_staff_runtime_scope(p_staff_id, '%s')%s%s;"%(m.group('mode').lower(),m.group('alias') or '',m.group('predicate'))
  body=body[:m.start()]+replacement+body[m.end():]
 body=body.replace('public.org_staff AS staff','public.aka_agent_staff_runtime_profile AS staff')
 assert 'public.org_staff' not in body,f['signature']
 sig='public.'+f['signature']
 quote=lambda v:"'"+v.replace("'","''")+"'"
 out.append('''DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(%s)
  AND md5(pg_get_functiondef(oid))=%s AND prosecdef=false
  AND pg_get_userbyid(proowner)=%s AND provolatile=%s
  AND proconfig::text IS NOT DISTINCT FROM %s AND proacl::text IS NOT DISTINCT FROM %s) THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %%',%s;
 END IF;
END;
$preflight$;
'''%(quote(sig),quote(f['checksum']),quote(f['owner']),quote(f['provolatile']),quote('{'+','.join('"'+v.replace('"','\\"')+'"' for v in f['proconfig'])+'}') if f['proconfig'] else 'NULL',quote(f['proacl']) if f['proacl'] else 'NULL',quote(sig)))
 # config::text representation differs for unquoted simple values; compare as
 # arrays instead to retain exact metadata without serialization assumptions.
 out[-1]=out[-1].replace('proconfig::text IS NOT DISTINCT FROM '+(quote('{'+','.join('"'+v.replace('"','\\"')+'"' for v in f['proconfig'])+'}') if f['proconfig'] else 'NULL'), 'proconfig IS NOT DISTINCT FROM '+('ARRAY['+','.join(quote(v) for v in f['proconfig'])+']::text[]' if f['proconfig'] else 'NULL::text[]'))
 out.append(body.rstrip()+';\n')
 changed.append(dict(f,target_definition=body))
out.append("NOTIFY pgrst, 'reload schema';\nCOMMIT;\n")
Path('supabase/migrations/20261027044627_staff_rls_runtime_compatibility.sql').write_text('\n'.join(out))
Path('migrations/snapshots/staff-rls/runtime-patches.json').write_text(json.dumps(changed,indent=2)+'\n')
print('Prepared',len(changed),'exact-source patches; locking helpers:',sum('runtime_scope(' in f['target_definition'] for f in changed))

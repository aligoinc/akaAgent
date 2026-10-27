"""Generate checksum gates/rollback from the locally validated target receipt."""
import json
from pathlib import Path
base=Path('migrations/snapshots/staff-rls')
target=sorted(json.loads((base/'local-target.json').read_text()),key=lambda f:f['signature'])
timeout_target=Path('migrations/snapshots/staff-runtime-lock-timeout/local-target.json')
if timeout_target.exists():
 by={f['signature']:f for f in target}
 for f in json.loads(timeout_target.read_text()):
  by[f['signature']]=f
 target=sorted(by.values(),key=lambda f:f['signature'])
patches=json.loads((base/'runtime-patches.json').read_text())
source=json.loads((base/'source.json').read_text())
q=lambda x:"'"+x.replace("'","''")+"'"
def guard(rows):
 out=['DO $targets$ BEGIN']
 for f in rows:
  sig=f['signature'] if '.' in f['signature'].split('(')[0] else 'public.'+f['signature']
  config='ARRAY['+','.join(q(x) for x in f['config'])+']::text[]' if f['config'] else 'NULL::text[]'
  out.append(f" IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure({q(sig)}) AND md5(pg_get_functiondef(oid))={q(f['checksum'])} AND pg_get_userbyid(proowner)={q(f['owner'])} AND prosecdef={'true' if f['securityDefiner'] else 'false'} AND provolatile={q(f['volatility'])} AND proconfig IS NOT DISTINCT FROM {config} AND proacl::text IS NOT DISTINCT FROM {q(f['acl']) if f['acl'] else 'NULL'}) THEN RAISE EXCEPTION 'staff RLS prepared function drift: %',{q(sig)}; END IF;")
 return '\n'.join(out+['END; $targets$;'])
view=json.loads((base/'local-view.json').read_text())
gate=guard(target)
# Owner defaults are server-version dependent (PG17 adds MAINTAIN). Compare
# semantic ACL sets, retaining exact grantors/options and SELECT-only clients.
# Do not ignore MAINTAIN globally: granting it to a client must fail this gate.
gate += f"""
DO $view$ BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM pg_class c
  WHERE c.oid=to_regclass('public.aka_agent_staff_runtime_profile') AND c.relkind='v'
   AND md5(pg_get_viewdef(c.oid,true))={q(view['checksum'])}
   AND pg_get_userbyid(c.relowner)={q(view['owner'])}
   AND c.reloptions=ARRAY['security_barrier=true']::text[]
   AND NOT EXISTS (
    WITH actual AS (
     SELECT * FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner)))
    ), expected AS (
     SELECT * FROM aclexplode(acldefault('r',c.relowner))
     UNION ALL
     SELECT c.relowner,r.oid,'SELECT'::text,false
     FROM (VALUES ('anon'::regrole::oid),('authenticated'::regrole::oid),('service_role'::regrole::oid)) r(oid)
    )
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    UNION ALL
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
   )
   AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
    WHERE a.attrelid=c.oid
   )
 ) OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.org_staff'::regclass AND tgname='aka_agent_invalidate_staff_recovery' AND tgfoid=to_regprocedure('private.aka_agent_invalidate_staff_recovery()') AND tgenabled='O') THEN
  RAISE EXCEPTION 'staff recovery/view protection changed; re-audit';
 END IF;
END; $view$;"""
p=Path('supabase/migrations/20261027044628_staff_rls_activation.sql')
s=p.read_text();start='-- BEGIN GENERATED TARGET GUARD';end='-- END GENERATED TARGET GUARD'
if start in s:s=s[:s.index(start)]+s[s.index(end)+len(end):].lstrip('\n')
s=s.replace('-- No client policy:',start+'\n'+gate+'\n'+end+'\n\n-- No client policy:')
p.write_text(s)
rollback=['-- MANUAL rollback of phase C only. Retains APIs, recovery and runtime compatibility.', '-- Restores the old insecure public table access. Operator decision required.',"BEGIN; SET LOCAL lock_timeout='3s';", "DO $gate$ BEGIN IF current_setting('aka_agent.staff_rls_rollback',true) IS DISTINCT FROM 'approved-restore-legacy-access' THEN RAISE EXCEPTION 'STOP: explicit rollback approval required'; END IF; IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.org_staff'::regclass AND relrowsecurity AND NOT relforcerowsecurity) OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.org_staff'::regclass) OR has_table_privilege('anon','public.org_staff','SELECT') OR has_table_privilege('authenticated','public.org_staff','UPDATE') THEN RAISE EXCEPTION 'staff protection changed; re-audit rollback'; END IF; END; $gate$;",gate,'ALTER TABLE public.org_staff DISABLE ROW LEVEL SECURITY;','GRANT ALL ON public.org_staff TO anon,authenticated;','GRANT EXECUTE ON FUNCTION public.get_managed_staff(bigint) TO PUBLIC,anon,authenticated;',"NOTIFY pgrst, 'reload schema'; COMMIT;"]
(base/'rollback-activation.sql').write_text('\n'.join(rollback)+'\n')
onlypatches=[f for f in target if f['signature'].removeprefix('public.') in {p['signature'] for p in patches}]
rollback=['-- Optional phase B rollback, only after clients have legacy table access again.', 'BEGIN;', "DO $gate$ BEGIN IF EXISTS(SELECT 1 FROM pg_class WHERE oid='public.org_staff'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'Rollback phase C before runtime compatibility'; END IF; END; $gate$;",guard(onlypatches)]
rollback += [f['definition'].rstrip()+';' for f in patches]
rollback += ['DROP FUNCTION public.aka_agent_staff_runtime_scope(bigint,text);','DROP VIEW public.aka_agent_staff_runtime_profile;',"NOTIFY pgrst, 'reload schema'; COMMIT;"]
(base/'rollback-runtime.sql').write_text('\n'.join(rollback)+'\n')
print('Generated cutover guard for',len(target),'functions and guarded rollbacks')

#!/usr/bin/env python3
"""Generate guarded rollout from a locally rehearsed candidate. Does not query/apply DB."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'migrations/snapshots/app-access/verified-candidate.json').read_text())
baseline=json.loads((root/'migrations/snapshots/app-access/rpc-baseline.json').read_text())
def quote(x): return 'NULL' if x is None else "'"+str(x).replace("'","''")+"'"
def guard(f):
 return f"""  IF to_regprocedure({quote(f['signature'])}) IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure({quote(f['signature'])})
      AND md5(pg_get_functiondef(p.oid))={quote(f['checksum'])}
      AND pg_get_userbyid(p.proowner)={quote(f['owner'])} AND p.proacl::text IS NOT DISTINCT FROM {quote(f['acl'])}
      AND p.prosecdef={str(f['security_definer']).lower()} AND p.provolatile={quote(f['volatility'])}
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM {quote(json.dumps(f['config']))}::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %',{quote(f['signature'])}; END IF;"""
assert len(manifest['privateTarget'])==2, 'Rehearse both private auth patches before generating activation'
head="BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='60s';\n"
policy_guard="  IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM (SELECT policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='auto_accounts') p) IS DISTINCT FROM "+quote(json.dumps(manifest['accountPolicies']))+"::jsonb OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.auto_accounts'::regclass) THEN RAISE EXCEPTION 'app_access_policy_drift'; END IF;"
view=manifest['runtimeProfileView']
view_guard=f"""  IF NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.aka_agent_staff_runtime_profile')
      AND c.relkind='v' AND pg_get_userbyid(c.relowner)={quote(view['owner'])}
      AND md5(pg_get_viewdef(c.oid,true))={quote(view['checksum'])}
      AND c.relacl::text IS NOT DISTINCT FROM {quote(view['relacl'])}
      AND to_jsonb(c.reloptions) IS NOT DISTINCT FROM {quote(json.dumps(view['reloptions']))}::jsonb
      AND has_table_privilege('aka_agent_desktop',c.oid,'SELECT')
  ) THEN RAISE EXCEPTION 'app_access_view_drift'; END IF;"""
checks=policy_guard+'\n'+view_guard+'\n'+'\n'.join(guard(f) for f in manifest['target']+manifest['privateTarget']+manifest.get('runtimeDependencies',[]))
activation="-- Separate deployment step, AFTER backend/runtime/UI and private auth patches. Never bulk-push.\n"+head+"DO $preflight$ BEGIN\n"+checks+"\nEND $preflight$;\n"
activation+="""-- Block product/staff/account writers only for the final capture and gate flip.
LOCK TABLE public.org_organization_product,public.org_staff,public.auto_accounts IN SHARE ROW EXCLUSIVE MODE;
SELECT private.app_access_capture_rollout();
CREATE OR REPLACE FUNCTION private.app_access_policy_enabled() RETURNS boolean LANGUAGE sql STABLE
SET search_path=pg_catalog AS $$ SELECT true $$;
DO $postflight$ BEGIN
  IF NOT private.app_access_policy_enabled() THEN RAISE EXCEPTION 'app_access_activation_failed'; END IF;
END $postflight$;
COMMIT;
"""
(root/'migrations/migration_v447_app_access_activate.sql').write_text(activation)
sigs={f['signature'] for f in manifest['source']}
rollback="""-- Pre-activation rollback only. Retain columns/receipts and all user decisions.
-- After activation, roll forward: reverting entitlement guards would reopen revoked access.
"""+head+"DO $preflight$ BEGIN\n  IF private.app_access_policy_enabled() THEN RAISE EXCEPTION 'app_access_active_requires_roll_forward'; END IF;\n"
rollback+='\n'.join(guard(f) for f in manifest['target'] if f['signature'] in sigs)+"\nEND $preflight$;\n"
rollback+='\n\n'.join(f['definition'].rstrip().rstrip(';')+';' for f in baseline if f['signature'] in sigs)
rollback+='\nDO $postflight$ BEGIN\n'+'\n'.join(guard(f) for f in manifest['source'])+"\nEND $postflight$;\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n"
(root/'migrations/rollback/app_access_pre_activation.sql').write_text(rollback)
(root/'migrations/snapshots/app-access/source-metadata.json').write_text(json.dumps(manifest['source'],ensure_ascii=False,indent=2)+'\n')
print('Generated activation and guarded pre-activation rollback; no database changed.')
# Sensitive auth bodies stay in the existing private asset directory.
import os
private_dir=os.environ.get('AKA_AGENT_APP_ACCESS_PRIVATE_DIR')
if private_dir:
 private_path=Path(private_dir)
 for name in ['ip-pre-request','desktop-admin']:
  source=json.loads((private_path/f'{name}.json').read_text())[0]
  target=next(f for f in manifest['privateTarget'] if f['signature']==source['signature'])
  text=head+"DO $preflight$ BEGIN\n  IF private.app_access_policy_enabled() THEN RAISE EXCEPTION 'app_access_active_requires_roll_forward'; END IF;\n"+guard(target)+"\nEND $preflight$;\n"+source['definition'].rstrip().rstrip(';')+';'+"\nDO $postflight$ BEGIN\n"+guard(source)+"\nEND $postflight$;\nCOMMIT;\n"
  (private_path/f'{name}-rollback.sql').write_text(text)
 print('Prepared private auth rollback assets outside Git.')

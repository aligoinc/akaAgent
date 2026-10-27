"""Build only from the captured live definitions. Does not connect to any database."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
rows=json.loads((root/'migrations/snapshots/device-identity-v3/source.json').read_text())
by={r['signature']:r for r in rows}
q=lambda x:"'"+x.replace("'","''")+"'"
def replace(s,a,b):
 assert s.count(a)==1,a
 return s.replace(a,b)
client=by['aka_agent_staff_client(text,text,text,jsonb)']['definition']
client=replace(client,'  kind text;','  kind text;\n  device_result jsonb;\n  lock_key bigint;')
client=replace(client,"'save_integration','register_recovery')", "'save_integration','register_recovery','prepare_device_v3','bind_device_v3')")
client=replace(client,"    WHEN 'bind_device' THEN", "    WHEN 'prepare_device_v3' THEN ARRAY['staffId','fingerprintHash','legacyHash','source']\n    WHEN 'bind_device_v3' THEN ARRAY['staffId','fingerprintHash','legacyHash','source','requestId','expected']\n    WHEN 'bind_device' THEN")
client=replace(client,"(p_action<>'read' AND NOT p_data ? 'staffId')", "(p_action NOT IN ('read','prepare_device_v3') AND NOT p_data ? 'staffId')")
client=replace(client,"  IF p_action='read' THEN", """  -- All fingerprint locks precede staff locks, including proof recovery and old API enrollment.
  IF p_action IN ('prepare_device_v3','bind_device_v3','bind_device','register_recovery') THEN
    IF jsonb_typeof(p_data->'fingerprintHash') IS DISTINCT FROM 'string'
      OR p_data->>'fingerprintHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    FOR lock_key IN SELECT DISTINCT hashtextextended(k,73103) FROM unnest(ARRAY[
      s.aka_agent_device_identity_version::text||':'||s.aka_agent_device_fingerprint_hash,
      (CASE WHEN p_action IN ('prepare_device_v3','bind_device_v3') THEN '3' ELSE s.aka_agent_device_identity_version::text END)||':'||(p_data->>'fingerprintHash')
    ]) k WHERE k IS NOT NULL ORDER BY 1 LOOP
      PERFORM pg_advisory_xact_lock(lock_key);
    END LOOP;
  END IF;
  IF p_action='read' THEN""")
client=replace(client,"('bind_device','accept_policy','register_recovery')", "('bind_device','accept_policy','register_recovery','prepare_device_v3','bind_device_v3')")
client=replace(client,"  IF p_action='register_recovery' THEN", """  IF p_action IN ('prepare_device_v3','bind_device_v3') THEN
    device_result := private.aka_agent_device_v3(s.id,p_action,p_data);
    SELECT * INTO s FROM public.org_staff WHERE id=s.id;
  ELSIF p_action='register_recovery' THEN""")
client=replace(client,'    INSERT INTO private.aka_agent_staff_recovery AS r', """    IF private.aka_agent_device_ambiguous(s.aka_agent_device_identity_version,s.aka_agent_device_fingerprint_hash,s.id,false) THEN
      DELETE FROM private.aka_agent_staff_recovery WHERE staff_id=s.id;
    ELSE
    INSERT INTO private.aka_agent_staff_recovery AS r""")
client=replace(client,"  ELSIF p_action='bind_device' THEN", "  END IF;\n  ELSIF p_action='bind_device' THEN\n    IF s.aka_agent_device_identity_version=3 THEN RAISE EXCEPTION 'staff_client_device_locked'; END IF;")
client=replace(client,"  ELSIF p_action='accept_policy' THEN", "    PERFORM private.aka_agent_device_ambiguous(2::smallint,s.aka_agent_device_fingerprint_hash,s.id,false);\n  ELSIF p_action='accept_policy' THEN")
client=replace(client,"'aka_agent_device_fingerprint_hash',s.aka_agent_device_fingerprint_hash,", "'aka_agent_device_fingerprint_hash',s.aka_agent_device_fingerprint_hash,\n    'aka_agent_device_identity_version',s.aka_agent_device_identity_version,'deviceV3',device_result,")
recovery=by['aka_agent_recover_staff_credentials(text,text)']['definition']
recovery=replace(recovery,'  SELECT * INTO s FROM public.org_staff WHERE id=r.staff_id FOR SHARE;', """  -- Same hash -> staff -> proof order as enrollment; no recovery concurrent with a new collision.
  PERFORM pg_advisory_xact_lock(hashtextextended('2:'||p_fingerprint_hash,73103));
  PERFORM pg_advisory_xact_lock(hashtextextended('3:'||p_fingerprint_hash,73103));
  SELECT * INTO s FROM public.org_staff WHERE id=r.staff_id FOR SHARE;""")
# Use sorted lock keys even when v2/v3 hash happens to be identical.
recovery=replace(recovery,'DECLARE s public.org_staff%ROWTYPE; r private.aka_agent_staff_recovery%ROWTYPE;', 'DECLARE s public.org_staff%ROWTYPE; r private.aka_agent_staff_recovery%ROWTYPE; lock_key bigint;')
recovery=replace(recovery,"  PERFORM pg_advisory_xact_lock(hashtextextended('2:'||p_fingerprint_hash,73103));\n  PERFORM pg_advisory_xact_lock(hashtextextended('3:'||p_fingerprint_hash,73103));", "  FOR lock_key IN SELECT DISTINCT hashtextextended(k,73103) FROM unnest(ARRAY['2:'||p_fingerprint_hash,'3:'||p_fingerprint_hash]) k ORDER BY 1 LOOP PERFORM pg_advisory_xact_lock(lock_key); END LOOP;")
recovery=replace(recovery,"    OR (SELECT count(*) FROM public.org_staff WHERE aka_agent_device_fingerprint_hash=p_fingerprint_hash)<>1 THEN", "    THEN")
recovery=replace(recovery,"  RETURN jsonb_build_object('username',s.username,'password',s.password);", """  IF private.aka_agent_device_ambiguous(s.aka_agent_device_identity_version,p_fingerprint_hash,s.id,false) THEN
    RETURN jsonb_build_object('status','manual_login_required');
  END IF;
  RETURN jsonb_build_object('username',s.username,'password',s.password);""")
guard=['DO $preflight$ BEGIN']
for r in rows:
 sig=r['signature'] if r['signature'].startswith('private.') else 'public.'+r['signature']
 config='ARRAY['+','.join(map(q,r['config'] or []))+']::text[]' if r['config'] else 'NULL::text[]'
 guard.append(f" IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure({q(sig)}) AND md5(pg_get_functiondef(oid))={q(r['checksum'])} AND pg_get_userbyid(proowner)={q(r['owner'])} AND prosecdef={'true' if r['security_definer'] else 'false'} AND provolatile={q(r['volatility'])} AND proconfig IS NOT DISTINCT FROM {config} AND proacl::text IS NOT DISTINCT FROM {q(r['acl']) if r['acl'] else 'NULL'}) THEN RAISE EXCEPTION 'device v3 source drift: %',{q(sig)}; END IF;")
guard+= [" IF to_regclass('private.aka_agent_device_collisions') IS NOT NULL OR to_regclass('private.aka_agent_device_migrations') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.org_staff'::regclass AND attname IN ('aka_agent_device_identity_version','aka_agent_device_binding_revision') AND NOT attisdropped) THEN RAISE EXCEPTION 'device v3 already installed; audit before reapply'; END IF;",'END; $preflight$;']
head='''-- Candidate only: deploy before the v3 client, do not apply RLS phase C here.
BEGIN;
SET LOCAL lock_timeout='3s';
'''+ '\n'.join(guard)+'\n'
body=(root/'scripts/device-identity-v3/schema.sql').read_text()
out=head+body+'\n'+client+';\n'+recovery+";\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n"
(root/'supabase/migrations/20261027071650_device_identity_v3.sql').write_text(out)
print('Generated v3 migration from 7 live signatures; two public RPC bodies patched.')

-- Run inside BEGIN ... ROLLBACK, after the candidate for a dry run or on live v3.
-- No customer credentials are returned and no customer binding is mutated.
SET LOCAL statement_timeout='15s';
DO $smoke$
DECLARE
 s record; d jsonb; h text; denied boolean; action text;
 before_bindings text; before_collisions bigint; before_receipts bigint;
BEGIN
 IF (SELECT relrowsecurity FROM pg_class WHERE oid='public.org_staff'::regclass) THEN
  RAISE EXCEPTION 'RLS C must remain disabled';
 END IF;
 IF to_regclass('public.org_staff_aka_agent_device_identity_idx') IS NULL THEN RAISE EXCEPTION 'v3 index missing'; END IF;
 IF (SELECT count(*) FROM pg_class WHERE oid IN ('private.aka_agent_device_collisions'::regclass,'private.aka_agent_device_migrations'::regclass) AND relrowsecurity)=2 IS NOT TRUE THEN RAISE EXCEPTION 'private table RLS missing'; END IF;
 IF has_table_privilege('anon','private.aka_agent_device_collisions','SELECT')
 OR has_table_privilege('authenticated','private.aka_agent_device_migrations','SELECT')
 OR has_function_privilege('anon','private.aka_agent_device_v3(bigint,text,jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','private.aka_agent_device_ambiguous(smallint,text,bigint,boolean)','EXECUTE') THEN RAISE EXCEPTION 'private ACL leak'; END IF;
 IF EXISTS(SELECT 1 FROM public.org_staff GROUP BY aka_agent_device_identity_version,aka_agent_device_fingerprint_hash
  HAVING aka_agent_device_fingerprint_hash IS NOT NULL AND count(*)>1 AND NOT EXISTS(
   SELECT 1 FROM private.aka_agent_device_collisions c WHERE c.version=aka_agent_device_identity_version AND c.fingerprint_hash=aka_agent_device_fingerprint_hash)) THEN RAISE EXCEPTION 'duplicate group not marked'; END IF;
 SELECT md5(jsonb_agg(jsonb_build_array(id,organization_id,aka_agent_device_fingerprint_hash,aka_agent_device_identity_version,aka_agent_device_binding_revision,device_changes_remaining) ORDER BY id)::text) INTO before_bindings FROM public.org_staff;
 SELECT count(*) INTO before_collisions FROM private.aka_agent_device_collisions;
 SELECT count(*) INTO before_receipts FROM private.aka_agent_device_migrations;
 -- Read-only prepare decisions, without reading/using any customer's password.
 SELECT id,aka_agent_device_fingerprint_hash AS hash INTO STRICT s FROM public.org_staff x
 WHERE aka_agent_device_identity_version=2 AND aka_agent_device_fingerprint_hash IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM private.aka_agent_device_collisions c WHERE c.version=2 AND c.fingerprint_hash=x.aka_agent_device_fingerprint_hash) LIMIT 1;
 h:=encode(extensions.digest('device-v3-rollback-smoke:'||s.id::text,'sha256'),'hex');
 d:=private.aka_agent_device_v3(s.id,'prepare_device_v3',jsonb_build_object('fingerprintHash',h,'legacyHash',s.hash,'source','automatic'));
 IF d->>'decision'<>'allowed' OR (d->>'automaticAllowed')::boolean IS NOT TRUE OR (d->>'needsBinding')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'clean v2 preparation failed'; END IF;
 SELECT id,aka_agent_device_fingerprint_hash AS hash INTO STRICT s FROM public.org_staff x
 WHERE aka_agent_device_identity_version=2 AND EXISTS(SELECT 1 FROM private.aka_agent_device_collisions c WHERE c.version=2 AND c.fingerprint_hash=x.aka_agent_device_fingerprint_hash) LIMIT 1;
 h:=encode(extensions.digest('device-v3-rollback-smoke:'||s.id::text,'sha256'),'hex');
 d:=private.aka_agent_device_v3(s.id,'prepare_device_v3',jsonb_build_object('fingerprintHash',h,'legacyHash',s.hash,'source','automatic'));
 IF d->>'decision'<>'manual_login_required' THEN RAISE EXCEPTION 'duplicate automatic login accepted'; END IF;
 d:=private.aka_agent_device_v3(s.id,'prepare_device_v3',jsonb_build_object('fingerprintHash',h,'legacyHash',s.hash,'source','manual'));
 IF d->>'decision'<>'allowed' THEN RAISE EXCEPTION 'duplicate manual preparation rejected'; END IF;
 d:=private.aka_agent_device_v3(s.id,'prepare_device_v3',jsonb_build_object('fingerprintHash',h,'legacyHash',NULL,'source','manual'));
 IF d->>'decision'<>'device_locked' THEN RAISE EXCEPTION 'wrong old binding accepted'; END IF;
 IF before_bindings IS DISTINCT FROM (SELECT md5(jsonb_agg(jsonb_build_array(id,organization_id,aka_agent_device_fingerprint_hash,aka_agent_device_identity_version,aka_agent_device_binding_revision,device_changes_remaining) ORDER BY id)::text) FROM public.org_staff)
 OR before_collisions<>(SELECT count(*) FROM private.aka_agent_device_collisions)
 OR before_receipts<>(SELECT count(*) FROM private.aka_agent_device_migrations) THEN RAISE EXCEPTION 'smoke changed customer state'; END IF;
END $smoke$;
SET LOCAL ROLE anon;
DO $anon$
DECLARE action text; denied boolean; data jsonb;
BEGIN
 FOREACH action IN ARRAY ARRAY['read','prepare_device_v3','bind_device_v3','bind_device','register_recovery'] LOOP
  data:=CASE action WHEN 'read' THEN '{}'::jsonb WHEN 'prepare_device_v3' THEN jsonb_build_object('fingerprintHash',repeat('a',64),'legacyHash',NULL,'source','automatic') ELSE jsonb_build_object('staffId',9223372036854775807,'fingerprintHash',repeat('a',64)) END;
  denied:=false;
  BEGIN PERFORM public.aka_agent_staff_client('',NULL,action,data);
   EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM='staff_client_auth_invalid' THEN denied:=true; ELSE RAISE; END IF;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'missing credentials accepted: %',action; END IF;
 END LOOP;
 denied:=false;
 BEGIN PERFORM public.aka_agent_recover_staff_credentials('',repeat('a',64));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM='staff_recovery_invalid' THEN denied:=true; ELSE RAISE; END IF;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'fingerprint-only recovery accepted'; END IF;
 IF public.aka_agent_staff_security_status()->>'legacyRecoveryAllowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'RLS C/security status unexpectedly changed'; END IF;
END $anon$;
RESET ROLE;

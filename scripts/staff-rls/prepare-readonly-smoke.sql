-- Read-only production smoke for preparation phases A/B. Requires org_staff RLS still disabled.
-- Customer credentials are used only inside the database for a read; no credential/profile is returned.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';

DO $smoke$
DECLARE s record; profile jsonb; n integer; denied boolean;
BEGIN
 SELECT id,organization_id,username,password INTO s FROM public.org_staff
 WHERE is_active=true AND deleted_at IS NULL AND username IS NOT NULL AND password IS NOT NULL AND password<>'' ORDER BY id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'No active staff available for read-only smoke'; END IF;
 EXECUTE 'SET LOCAL ROLE anon';
 profile:=public.aka_agent_staff_client(s.username,s.password,'read',jsonb_build_object('staffId',s.id));
 IF (profile->>'id')::bigint<>s.id OR (profile->>'organization_id')::bigint<>s.organization_id OR profile ? 'password' THEN RAISE EXCEPTION 'Profile projection/auth failed'; END IF;
 denied:=false;
 BEGIN PERFORM public.aka_agent_staff_client(s.username,s.password||'__invalid_smoke__','read','{}'::jsonb);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='staff_client_auth_invalid' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'Wrong password accepted'; END IF;
 denied:=false;
 BEGIN PERFORM public.aka_agent_staff_client(s.username,s.password,'read',jsonb_build_object('staffId',s.id,'organization_id',1));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='staff_client_invalid_input' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'Extra mutation field accepted'; END IF;
 denied:=false;
 BEGIN PERFORM public.aka_agent_staff_client(s.username,s.password,'read',jsonb_build_object('staffId',-1));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='staff_client_invalid_input' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid staff ID accepted'; END IF;
 denied:=false;
 BEGIN PERFORM public.aka_agent_recover_staff_credentials('invalid-smoke-proof','invalid-smoke-fingerprint');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='staff_recovery_invalid' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid recovery proof accepted'; END IF;
 IF public.aka_agent_staff_security_status()->>'legacyRecoveryAllowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Legacy recovery disabled too soon'; END IF;
 SELECT count(*) INTO n FROM public.aka_agent_staff_runtime_scope(s.id,'share') WHERE id=s.id AND organization_id=s.organization_id;
 IF n<>1 THEN RAISE EXCEPTION 'Runtime shared scope mismatch'; END IF;
 SELECT count(*) INTO n FROM public.aka_agent_staff_runtime_scope(9007199254740991,'update');
 IF n<>0 THEN RAISE EXCEPTION 'Missing staff scope not empty'; END IF;
 denied:=false;
 BEGIN PERFORM * FROM public.aka_agent_staff_runtime_scope(s.id,'invalid-lock');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='staff_runtime_scope_invalid' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid lock mode accepted'; END IF;
 SELECT count(*) INTO n FROM public.org_staff WHERE id=s.id;
 IF n<>1 THEN RAISE EXCEPTION 'Legacy staff read blocked'; END IF;
 IF NOT has_table_privilege(current_user,'public.org_staff','UPDATE') THEN RAISE EXCEPTION 'Legacy staff write revoked'; END IF;
 IF has_table_privilege(current_user,'public.aka_agent_staff_runtime_profile','UPDATE') OR has_table_privilege(current_user,'private.aka_agent_staff_recovery','SELECT') THEN RAISE EXCEPTION 'New object has unexpected public privileges'; END IF;
 EXECUTE 'RESET ROLE';
END; $smoke$;
ROLLBACK;

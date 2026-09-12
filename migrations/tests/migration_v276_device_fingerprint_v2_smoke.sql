-- All fixtures and changes are rolled back; no customer binding is migrated.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $smoke$
#variable_conflict use_variable
DECLARE
  staff constant bigint := 8800276000000001;
  username constant text := '__v276_device_smoke__';
  password constant text := '__v276_rollback_only__';
  tenant bigint;
  binding jsonb;
  result jsonb;
  request uuid := gen_random_uuid();
  instance uuid := gen_random_uuid();
  device jsonb := jsonb_build_object('fingerprintHash',repeat('b',64),'label','v2 smoke','platform','win','appVersion','test');
  other_device jsonb := jsonb_build_object('fingerprintHash',repeat('c',64),'label','other','platform','mac','appVersion','test');
  legacy jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-v276-smoke',0));
  IF EXISTS(SELECT 1 FROM org_staff WHERE id=staff OR org_staff.username=username) THEN RAISE EXCEPTION 'Fixture collision'; END IF;
  SELECT organization_id INTO STRICT tenant FROM org_staff WHERE is_active ORDER BY id LIMIT 1;
  INSERT INTO org_staff(id,organization_id,name,phone,username,password,is_active)
    OVERRIDING SYSTEM VALUE VALUES(staff,tenant,username,'8800276000000001',username,password,true);
  UPDATE org_staff SET device_fingerprint_hash=repeat('a',64),device_label='legacy',device_platform='win',
    device_bound_at=clock_timestamp(),device_last_seen_at=clock_timestamp(),aka_agent_device_fingerprint_hash=repeat('b',64) WHERE id=staff;
  SELECT jsonb_build_array(device_fingerprint_hash,device_label,device_platform,device_bound_at,device_last_seen_at) INTO legacy FROM org_staff WHERE id=staff;
  INSERT INTO auto_staff_device_login_settings(staff_id,organization_id,device_fingerprint_hash,remember_login,auto_login)
    VALUES(staff,tenant,repeat('a',64),true,true);
  binding := aka_agent_prepare_device_change_v2(username)->'binding';
  ASSERT binding->>'version'='2' AND binding->>'hash'=repeat('b',64), 'v2 prepare';
  ASSERT aka_agent_device_presence(username,password,instance,device,false), 'presence register';
  ASSERT aka_agent_reset_device_binding_v2(username,NULL,'login',request,binding,other_device)->>'code'='device_online', 'Online guard';
  ASSERT aka_agent_reset_device_binding_v2(username,'wrong','account_menu',request,binding,device)->>'code'='not_authorized', 'password guard';
  ASSERT aka_agent_reset_device_binding_v2(username,password,'account_menu',request,binding,other_device)->>'code'='not_authorized', 'menu device guard';
  result := aka_agent_reset_device_binding_v2(username,password,'account_menu',request,binding,device);
  ASSERT result->>'code'='changed' AND (result->>'remainingChanges')::int=4, 'quota debit';
  ASSERT (SELECT aka_agent_device_fingerprint_hash IS NULL FROM org_staff WHERE id=staff), 'v2 unbound';
  ASSERT (SELECT jsonb_build_array(device_fingerprint_hash,device_label,device_platform,device_bound_at,device_last_seen_at)=legacy FROM org_staff WHERE id=staff), 'legacy columns preserved';
  ASSERT (SELECT remember_login AND auto_login FROM auto_staff_device_login_settings WHERE staff_id=staff AND device_fingerprint_hash=repeat('a',64)), 'legacy preferences preserved';
  ASSERT (SELECT ended_at IS NULL FROM auto_staff_device_presence WHERE instance_id=instance), 'presence observational';
  UPDATE org_staff SET aka_agent_device_fingerprint_hash=repeat('c',64) WHERE id=staff;
  ASSERT aka_agent_reset_device_binding_v2(username,password,'account_menu',request,binding,device)=result, 'replay survives rebind';
  ASSERT (SELECT aka_agent_device_fingerprint_hash=repeat('c',64) AND device_changes_remaining=4 FROM org_staff WHERE id=staff), 'replay preserves new binding and quota';
  ASSERT aka_agent_reset_device_binding_v2(username,NULL,'login',gen_random_uuid(),binding,other_device)->>'code'='binding_conflict', 'stale snapshot';
  ASSERT (SELECT count(*)=1 FROM auto_staff_device_change_history WHERE staff_id=staff), 'one history';
  binding := aka_agent_prepare_device_change_v2(username)->'binding';
  UPDATE auto_staff_device_presence SET last_seen_at=clock_timestamp()-interval '121 seconds' WHERE instance_id=instance;
  ASSERT aka_agent_reset_device_binding_v2(username,NULL,'login',gen_random_uuid(),binding,other_device)->>'code'='changed', 'offline reset';
  UPDATE org_staff SET aka_agent_device_fingerprint_hash=repeat('b',64),device_changes_remaining=0 WHERE id=staff;
  binding := aka_agent_prepare_device_change_v2(username)->'binding';
  ASSERT aka_agent_reset_device_binding_v2(username,NULL,'login',gen_random_uuid(),binding,device)->>'code'='quota_exhausted', 'zero quota';
  UPDATE org_staff SET device_changes_remaining=NULL WHERE id=staff;
  binding := aka_agent_prepare_device_change_v2(username)->'binding';
  ASSERT (aka_agent_reset_device_binding_v2(username,NULL,'login',gen_random_uuid(),binding,device)->>'remainingChanges')::int=4, 'null quota fallback';
  EXECUTE 'SET LOCAL ROLE anon';
  ASSERT aka_agent_prepare_device_change_v2(username)->>'code'='prepared', 'anon API grant';
  ASSERT aka_agent_reset_device_binding_v2(username,NULL,'login',gen_random_uuid(),aka_agent_prepare_device_change_v2(username)->'binding',device)->>'code'='already_unbound', 'anon v2 reset contract';
  EXECUTE 'RESET ROLE';
  ASSERT md5(pg_get_functiondef('public.aka_agent_prepare_device_change(text)'::regprocedure))='4752e10a9ab45fee879d9f55d4c2817b', 'legacy prepare unchanged';
  ASSERT md5(pg_get_functiondef('public.aka_agent_reset_device_binding(text,text,text,uuid,jsonb,jsonb)'::regprocedure))='84bf195ed63d67eb35b718b19a6fed4c', 'legacy reset unchanged';
  ASSERT md5(pg_get_functiondef('public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)'::regprocedure))='b504f4928a9dd271dec783796a7a0374', 'presence unchanged';
END;
$smoke$;
SELECT 'passed' AS device_fingerprint_v2_smoke;
ROLLBACK;

-- Run on the verified linked project; all fixtures and writes are rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $smoke$
#variable_conflict use_variable
DECLARE
  staff constant bigint := 8800262000000001;
  tenant bigint;
  username constant text := '__v262_device_change_smoke__';
  password constant text := '__v262_rollback_only__';
  device jsonb := jsonb_build_object('fingerprintHash',repeat('a',64),'label','Smoke old','platform','mac','appVersion','test');
  new_device jsonb := jsonb_build_object('fingerprintHash',repeat('b',64),'label','Smoke new','platform','win','appVersion','test');
  binding jsonb;
  result jsonb;
  request uuid := gen_random_uuid();
  instance uuid := gen_random_uuid();
  end_first uuid := gen_random_uuid();
  stamp timestamptz;
  elapsed numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-v262-smoke',0));
  IF EXISTS (SELECT 1 FROM public.org_staff WHERE id=staff OR org_staff.username=username) THEN
    RAISE EXCEPTION 'Fixture collision';
  END IF;
  SELECT organization_id INTO STRICT tenant FROM public.org_staff WHERE is_active ORDER BY id LIMIT 1;
  INSERT INTO public.org_staff(id,organization_id,name,phone,username,password,is_active)
    OVERRIDING SYSTEM VALUE VALUES(staff,tenant,username,'8800262000000001',username,password,true);
  ASSERT (SELECT device_changes_remaining=5 FROM public.org_staff WHERE id=staff), 'default quota';
  UPDATE public.org_staff SET device_fingerprint_hash=repeat('a',64),device_bound_at=clock_timestamp() WHERE id=staff;
  INSERT INTO public.auto_staff_device_login_settings(staff_id,organization_id,device_fingerprint_hash,remember_login,auto_login)
    VALUES(staff,tenant,repeat('a',64),true,true);
  binding := public.aka_agent_prepare_device_change(username)->'binding';

  ASSERT public.aka_agent_device_presence(username,password,instance,device,false), 'register';
  ASSERT NOT public.aka_agent_device_presence(username,'wrong',gen_random_uuid(),device,false), 'presence credentials';
  result := public.aka_agent_reset_device_binding(username,NULL,'login',request,binding,new_device);
  ASSERT result->>'code'='device_online', 'login blocks Online';
  ASSERT (SELECT device_changes_remaining=5 FROM public.org_staff WHERE id=staff), 'denial preserves quota';
  ASSERT NOT EXISTS(SELECT 1 FROM public.auto_staff_device_change_history WHERE staff_id=staff), 'denial has no history';
  ASSERT public.aka_agent_reset_device_binding(username,'wrong','account_menu',request,binding,device)->>'code'='not_authorized', 'menu credentials';
  ASSERT public.aka_agent_reset_device_binding(username,password,'account_menu',request,binding,new_device)->>'code'='not_authorized', 'menu device';

  result := public.aka_agent_reset_device_binding(username,password,'account_menu',request,binding,device);
  ASSERT result->>'code'='changed' AND (result->>'remainingChanges')::int=4, 'menu ignores Online';
  ASSERT (SELECT device_fingerprint_hash IS NULL AND device_changes_remaining=4 FROM public.org_staff WHERE id=staff), 'binding and quota';
  ASSERT (SELECT NOT remember_login AND NOT auto_login FROM public.auto_staff_device_login_settings WHERE staff_id=staff AND device_fingerprint_hash=repeat('a',64)), 'remember disabled';
  ASSERT (SELECT ended_at IS NULL FROM public.auto_staff_device_presence WHERE instance_id=instance), 'menu does not end presence';
  ASSERT public.aka_agent_device_presence(username,password,instance,device,false), 'heartbeat after unbind';
  ASSERT public.aka_agent_reset_device_binding(username,NULL,'login',gen_random_uuid(),binding,new_device)->>'code'='already_unbound', 'no-op';

  -- Replay must survive a later binding, return the original result and leave it intact.
  UPDATE public.org_staff SET device_fingerprint_hash=repeat('b',64),device_bound_at=clock_timestamp() WHERE id=staff;
  ASSERT public.aka_agent_reset_device_binding(username,password,'account_menu',request,binding,device)=result, 'committed replay';
  ASSERT (SELECT device_fingerprint_hash=repeat('b',64) AND device_changes_remaining=4 FROM public.org_staff WHERE id=staff), 'replay preserves newer binding';
  ASSERT (SELECT count(*)=1 FROM public.auto_staff_device_change_history WHERE staff_id=staff), 'one history';
  ASSERT public.aka_agent_reset_device_binding(username,NULL,'login',gen_random_uuid(),binding,new_device)->>'code'='binding_conflict', 'stale snapshot';

  binding := public.aka_agent_prepare_device_change(username)->'binding';
  ASSERT public.aka_agent_reset_device_binding(username,NULL,'login',gen_random_uuid(),binding,new_device)->>'code'='device_online', 'old binding presence still blocks';
  UPDATE public.auto_staff_device_presence SET last_seen_at=clock_timestamp()-interval '119 seconds' WHERE instance_id=instance;
  ASSERT public.aka_agent_reset_device_binding(username,NULL,'login',gen_random_uuid(),binding,new_device)->>'code'='device_online', 'recent boundary';
  UPDATE public.auto_staff_device_presence SET last_seen_at=clock_timestamp()-interval '120 seconds' WHERE instance_id=instance;
  ASSERT public.aka_agent_reset_device_binding(username,NULL,'login',gen_random_uuid(),binding,new_device)->>'code'='changed', 'stale boundary';
  ASSERT public.aka_agent_device_presence(username,password,instance,device,false), 'reconnect same instance despite binding';
  ASSERT public.aka_agent_device_presence(username,password,instance,device,true), 'end';
  ASSERT NOT public.aka_agent_device_presence(username,password,instance,device,false), 'late heartbeat cannot resurrect';
  ASSERT public.aka_agent_device_presence(username,password,end_first,device,true), 'end before registration';
  ASSERT NOT public.aka_agent_device_presence(username,password,end_first,device,false), 'late registration tombstone';

  UPDATE public.org_staff SET device_fingerprint_hash=repeat('a',64),device_bound_at=clock_timestamp(),device_changes_remaining=1 WHERE id=staff;
  binding := public.aka_agent_prepare_device_change(username)->'binding';
  result := public.aka_agent_reset_device_binding(username,NULL,'login',gen_random_uuid(),binding,new_device);
  ASSERT result->>'code'='changed' AND (result->>'remainingChanges')::int=0, 'ended permits last turn';
  -- These direct updates represent akaBiz/legacy behavior and remain unrestricted.
  UPDATE public.org_staff SET device_fingerprint_hash=repeat('a',64),device_bound_at=clock_timestamp() WHERE id=staff;
  binding := public.aka_agent_prepare_device_change(username)->'binding';
  ASSERT public.aka_agent_reset_device_binding(username,NULL,'login',gen_random_uuid(),binding,new_device)->>'code'='quota_exhausted', 'zero quota';
  UPDATE public.org_staff SET device_fingerprint_hash=NULL WHERE id=staff;
  ASSERT (SELECT device_changes_remaining=0 FROM public.org_staff WHERE id=staff), 'admin reset at zero';
  UPDATE public.org_staff SET device_fingerprint_hash=repeat('a',64),device_bound_at=clock_timestamp(),device_changes_remaining=NULL WHERE id=staff;
  binding := public.aka_agent_prepare_device_change(username)->'binding';
  DELETE FROM public.auto_staff_device_presence WHERE staff_id=staff;
  result := public.aka_agent_reset_device_binding(username,NULL,'login',gen_random_uuid(),binding,new_device);
  ASSERT result->>'code'='changed' AND (result->>'remainingChanges')::int=4, 'no presence and null fallback';
  UPDATE public.org_staff SET device_changes_remaining=-1 WHERE id=staff;
  ASSERT (SELECT device_changes_remaining=-1 FROM public.org_staff WHERE id=staff), 'no quota check constraint';

  -- Warm heartbeat write cost (DB execution only, not end-to-end network capacity).
  stamp := clock_timestamp();
  FOR i IN 1..1000 LOOP
    PERFORM public.aka_agent_device_presence(username,password,instance,device,false);
  END LOOP;
  elapsed := extract(epoch FROM clock_timestamp()-stamp)*1000;
  ASSERT (SELECT count(*)=1 FROM public.auto_staff_device_presence WHERE staff_id=staff), 'heartbeat updates one row';
  PERFORM set_config('aka_agent_smoke.heartbeat_ms',round(elapsed,2)::text,true);
  RAISE NOTICE 'v262: 1000 heartbeat updates took % ms in DB', round(elapsed,2);

  -- Restricted table access; credential and username RPCs remain callable.
  EXECUTE 'SET LOCAL ROLE anon';
  ASSERT public.aka_agent_prepare_device_change(username)->>'code'='prepared', 'anon can call prepare';
  ASSERT public.aka_agent_device_presence(username,password,instance,device,false), 'anon credential RPC';
  BEGIN
    PERFORM 1 FROM public.auto_staff_device_presence LIMIT 1;
    RAISE EXCEPTION 'anon has unexpected presence table access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.auto_staff_device_change_history LIMIT 1;
    RAISE EXCEPTION 'anon has unexpected history table access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'v262 device-change/presence smoke passed';
END;
$smoke$;
SELECT 'passed' AS device_change_presence_smoke, current_setting('aka_agent_smoke.heartbeat_ms') AS heartbeat_1000_db_ms;
ROLLBACK;

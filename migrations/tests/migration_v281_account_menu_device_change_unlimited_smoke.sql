-- All fixtures and binding/quota changes are rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
DO $smoke$
#variable_conflict use_variable
DECLARE
  staff constant bigint := 8800281000000001;
  username constant text := '__v281_device_menu_smoke__';
  password constant text := '__v281_rollback_only__';
  tenant bigint;
  version integer;
  quota integer;
  iteration integer;
  prepare_name text;
  reset_name text;
  binding_column text;
  binding jsonb;
  newer_binding jsonb;
  result jsonb;
  replay jsonb;
  request uuid;
  instance uuid := gen_random_uuid();
  history_count bigint;
  device jsonb := jsonb_build_object('fingerprintHash',repeat('a',64),'label','Menu smoke','platform','mac','appVersion','test');
  other_device jsonb := jsonb_build_object('fingerprintHash',repeat('b',64),'label','Other smoke','platform','win','appVersion','test');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-v281-smoke',0));
  IF EXISTS (SELECT 1 FROM public.org_staff WHERE id=staff OR org_staff.username=username) THEN
    RAISE EXCEPTION 'Fixture collision';
  END IF;
  SELECT organization_id INTO STRICT tenant FROM public.org_staff WHERE is_active ORDER BY id LIMIT 1;
  INSERT INTO public.org_staff(id,organization_id,name,phone,username,password,is_active)
    OVERRIDING SYSTEM VALUE VALUES(staff,tenant,username,'8800281000000001',username,password,true);

  FOR version IN 1..2 LOOP
    prepare_name := CASE version WHEN 1 THEN 'aka_agent_prepare_device_change' ELSE 'aka_agent_prepare_device_change_v2' END;
    reset_name := CASE version WHEN 1 THEN 'aka_agent_reset_device_binding' ELSE 'aka_agent_reset_device_binding_v2' END;
    binding_column := CASE version WHEN 1 THEN 'device_fingerprint_hash' ELSE 'aka_agent_device_fingerprint_hash' END;
    FOREACH quota IN ARRAY ARRAY[5,1,0,-1,NULL]::integer[] LOOP
      -- More than the original five changes, including repeated changes with zero quota.
      FOR iteration IN 1..7 LOOP
        EXECUTE format('UPDATE public.org_staff SET %I=$1, device_bound_at=clock_timestamp(), device_changes_remaining=$2 WHERE id=$3',binding_column)
          USING device->>'fingerprintHash',quota,staff;
        EXECUTE format('SELECT public.%I($1)->''binding''',prepare_name) INTO binding USING username;
        request := gen_random_uuid();
        SELECT count(*) INTO history_count FROM public.auto_staff_device_change_history WHERE staff_id=staff;
        EXECUTE format('SELECT public.%I($1,$2,''account_menu'',$3,$4,$5)',reset_name)
          INTO result USING username,password,request,binding,device;
        ASSERT result->>'code'='changed' AND (result->>'remainingChanges')::integer=coalesce(quota,5), 'menu succeeds without debit';
        ASSERT (SELECT device_changes_remaining IS NOT DISTINCT FROM quota FROM public.org_staff WHERE id=staff), 'preserve exact stored quota including NULL';
        ASSERT (SELECT remaining_before=coalesce(quota,5) AND remaining_after=coalesce(quota,5)
          FROM public.auto_staff_device_change_history WHERE request_id=request), 'history records no debit';
        EXECUTE format('SELECT public.%I($1)->''binding''',prepare_name) INTO newer_binding USING username;
        ASSERT newer_binding->>'hash' IS NULL, 'binding removed';
        EXECUTE format('SELECT public.%I($1,$2,''account_menu'',$3,$4,$5)',reset_name)
          INTO replay USING username,password,gen_random_uuid(),newer_binding,device;
        ASSERT replay->>'code'='already_unbound', 'unbound at any quota is a no-op';

        -- Replays must preserve a newer binding; a new request with stale CAS must fail.
        EXECUTE format('UPDATE public.org_staff SET %I=$1, device_bound_at=clock_timestamp() WHERE id=$2',binding_column)
          USING other_device->>'fingerprintHash',staff;
        EXECUTE format('SELECT public.%I($1,$2,''account_menu'',$3,$4,$5)',reset_name)
          INTO replay USING username,password,request,binding,device;
        ASSERT replay=result, 'replay returns committed result';
        EXECUTE format('SELECT public.%I($1)->''binding''',prepare_name) INTO newer_binding USING username;
        ASSERT newer_binding->>'hash'=other_device->>'fingerprintHash', 'replay preserves newer binding';
        EXECUTE format('SELECT public.%I($1,$2,''account_menu'',$3,$4,$5)',reset_name)
          INTO replay USING username,password,gen_random_uuid(),binding,other_device;
        ASSERT replay->>'code'='binding_conflict', 'stale CAS rejected';
        ASSERT (SELECT count(*)=history_count+1 FROM public.auto_staff_device_change_history WHERE staff_id=staff), 'one history per change';
      END LOOP;
    END LOOP;

    EXECUTE format('UPDATE public.org_staff SET %I=$1, device_bound_at=clock_timestamp(), device_changes_remaining=0 WHERE id=$2',binding_column)
      USING device->>'fingerprintHash',staff;
    EXECUTE format('SELECT public.%I($1)->''binding''',prepare_name) INTO binding USING username;
    -- Real client role still requires credentials and the authorized machine, even at zero quota.
    EXECUTE 'SET LOCAL ROLE anon';
    EXECUTE format('SELECT public.%I($1,$2,''account_menu'',$3,$4,$5)',reset_name)
      INTO result USING username,'wrong',gen_random_uuid(),binding,device;
    ASSERT result->>'code'='not_authorized', 'password guard';
    EXECUTE format('SELECT public.%I($1,$2,''account_menu'',$3,$4,$5)',reset_name)
      INTO result USING username,password,gen_random_uuid(),binding,other_device;
    ASSERT result->>'code'='not_authorized', 'device guard';
    EXECUTE format('SELECT public.%I($1,NULL,''login'',$2,$3,$4)',reset_name)
      INTO result USING username,gen_random_uuid(),binding,other_device;
    ASSERT result->>'code'='quota_exhausted', 'login still blocks zero quota';
    EXECUTE format('SELECT public.%I($1,$2,''account_menu'',$3,$4,$5)',reset_name)
      INTO result USING username,password,gen_random_uuid(),binding,device;
    ASSERT result->>'code'='changed' AND (result->>'remainingChanges')::integer=0, 'anon menu works at zero';
    EXECUTE 'RESET ROLE';

    EXECUTE format('UPDATE public.org_staff SET %I=$1, device_bound_at=clock_timestamp(), device_changes_remaining=1 WHERE id=$2',binding_column)
      USING device->>'fingerprintHash',staff;
    EXECUTE format('SELECT public.%I($1)->''binding''',prepare_name) INTO binding USING username;
    instance := gen_random_uuid();
    ASSERT public.aka_agent_device_presence(username,password,instance,device,false), 'register presence';
    EXECUTE format('SELECT public.%I($1,NULL,''login'',$2,$3,$4)',reset_name)
      INTO result USING username,gen_random_uuid(),binding,other_device;
    ASSERT result->>'code'='device_online', 'login preserves Online guard';
    UPDATE public.auto_staff_device_presence SET last_seen_at=clock_timestamp()-interval '121 seconds' WHERE instance_id=instance;
    EXECUTE format('SELECT public.%I($1,NULL,''login'',$2,$3,$4)',reset_name)
      INTO result USING username,gen_random_uuid(),binding,other_device;
    ASSERT result->>'code'='changed' AND (result->>'remainingChanges')::integer=0, 'login still debits last change';
    ASSERT (SELECT device_changes_remaining=0 FROM public.org_staff WHERE id=staff), 'login debit stored';
    UPDATE public.auto_staff_device_presence SET ended_at=clock_timestamp() WHERE instance_id=instance;
  END LOOP;
END;
$smoke$;
SELECT 'passed' AS unlimited_menu_device_change_smoke;
ROLLBACK;

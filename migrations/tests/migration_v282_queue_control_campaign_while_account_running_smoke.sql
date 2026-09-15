-- All accounts, campaigns and inputs below are synthetic and rolled back.
-- No runtime worker can see the fixtures, and no message is sent.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $smoke$
DECLARE
  owner_fixture record;
  foreign_owner record;
  case_fixture record;
  account_id bigint;
  operation_account_id bigint;
  independent_status_account_id bigint;
  independent_status_campaign_id bigint;
  invalid_account_id bigint;
  running_campaign_id bigint;
  queued_campaign_id bigint;
  legacy_campaign_id bigint;
  paused_campaign_id bigint;
  operation_campaign_id bigint;
  operation_token uuid := gen_random_uuid();
  prefix text := 'v282-smoke-' || txid_current()::text;
  payload jsonb;
  result jsonb;
  account_before jsonb;
  account_after jsonb;
  error_message text;
BEGIN
  SELECT a.staff_id, a.organization_id INTO owner_fixture
  FROM public.auto_accounts a
  JOIN public.org_staff s ON s.id=a.staff_id
    AND s.organization_id=a.organization_id AND s.is_active=true
  CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(a.organization_id) caps
  WHERE a.is_zalo_server=true AND a.is_zalo_show_web=false
    AND a.is_delete=false AND caps.qr_enabled AND caps.server_enabled AND caps.web_enabled
  ORDER BY a.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'v282_smoke:no_server_owner_fixture'; END IF;

  SELECT id, organization_id INTO foreign_owner FROM public.org_staff
  WHERE is_active=true AND organization_id IS NOT NULL
    AND organization_id<>owner_fixture.organization_id
  ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'v282_smoke:no_foreign_owner_fixture'; END IF;

  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
  VALUES (prefix,'zalo',owner_fixture.staff_id,owner_fixture.organization_id,
    true,false,true,false,'đã đăng nhập','chờ xử lý') RETURNING id INTO account_id;

  payload := jsonb_build_object('name',prefix,'accountId',account_id,
    'actionId','zalo_message_phone','schedule',now()-interval '1 minute');
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-first',payload,'[]'::jsonb,'chờ xử lý');
  running_campaign_id := (result->>'campaign_id')::bigint;
  IF result->>'created' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'v282_smoke:idle_create_failed';
  END IF;

  SET LOCAL ROLE anon;
  IF NOT public.claim_campaign_runtime(running_campaign_id,account_id,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v282_smoke:first_claim_failed';
  END IF;
  RESET ROLE;
  SELECT to_jsonb(a) INTO account_before FROM public.auto_accounts a WHERE id=account_id;

  -- Reproduce the user-facing v2 path while another campaign owns the account.
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-queued',payload,jsonb_build_array(jsonb_build_object('phone','0900000001')),'chờ xử lý');
  queued_campaign_id := (result->>'campaign_id')::bigint;
  IF result->>'created' IS DISTINCT FROM 'true' OR result->>'input_count' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'v282_smoke:busy_create_failed';
  END IF;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-queued',payload,jsonb_build_array(jsonb_build_object('phone','0900000001')),'chờ xử lý');
  IF result->>'created' IS DISTINCT FROM 'false'
    OR (result->>'campaign_id')::bigint IS DISTINCT FROM queued_campaign_id
    OR result->>'input_count' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'v282_smoke:idempotency_failed';
  END IF;
  result := public.create_control_campaign(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-legacy',payload,'[]'::jsonb);
  legacy_campaign_id := (result->>'campaign_id')::bigint;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-paused',payload,'[]'::jsonb,'tạm dừng');
  paused_campaign_id := (result->>'campaign_id')::bigint;
  RESET ROLE;

  SELECT to_jsonb(a) INTO account_after FROM public.auto_accounts a WHERE id=account_id;
  IF account_after IS DISTINCT FROM account_before THEN
    RAISE EXCEPTION 'v282_smoke:creation_modified_busy_account';
  END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id=running_campaign_id) IS DISTINCT FROM 'đang chạy'
    OR (SELECT status FROM public.auto_campaigns WHERE id=queued_campaign_id) IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_campaigns WHERE id=legacy_campaign_id) IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_campaigns WHERE id=paused_campaign_id) IS DISTINCT FROM 'tạm dừng'
    OR (SELECT COUNT(*) FROM public.auto_campaign_input_data WHERE campaign_id=queued_campaign_id)<>1
  THEN RAISE EXCEPTION 'v282_smoke:campaign_or_input_state'; END IF;

  SET LOCAL ROLE anon;
  IF public.claim_campaign_runtime(queued_campaign_id,account_id,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v282_smoke:queued_campaign_stole_busy_account';
  END IF;
  RESET ROLE;

  -- Model the first worker's completion, then let the real claim RPC pick up
  -- exactly one queued campaign. The other campaign must still wait.
  UPDATE public.auto_campaigns SET status='hoàn thành' WHERE id=running_campaign_id;
  UPDATE public.auto_accounts SET status='chờ xử lý' WHERE id=account_id;
  SET LOCAL ROLE anon;
  IF NOT public.claim_campaign_runtime(queued_campaign_id,account_id,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v282_smoke:queue_did_not_resume_when_idle';
  END IF;
  IF public.claim_campaign_runtime(legacy_campaign_id,account_id,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v282_smoke:two_campaigns_claimed_same_account';
  END IF;
  RESET ROLE;

  -- A scan/type-change operation's ownership token must also survive creation.
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
  VALUES (prefix || '-operation','zalo',owner_fixture.staff_id,owner_fixture.organization_id,
    true,false,true,false,'đã đăng nhập','tạm dừng') RETURNING id INTO operation_account_id;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-paused-account',payload || jsonb_build_object('accountId',operation_account_id),'[]'::jsonb);
  IF result->>'created' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'v282_smoke:paused_account_create_failed';
  END IF;
  SET LOCAL ROLE anon;
  result := public.claim_zalo_account_runtime_operation(operation_account_id,owner_fixture.staff_id,
    'server','tạm dừng',operation_token,true);
  IF result->>'claimed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v282_smoke:operation_claim_failed'; END IF;
  RESET ROLE;
  SELECT to_jsonb(a) INTO account_before FROM public.auto_accounts a WHERE id=operation_account_id;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-during-operation',payload || jsonb_build_object('accountId',operation_account_id),'[]'::jsonb);
  operation_campaign_id := (result->>'campaign_id')::bigint;
  RESET ROLE;
  SELECT to_jsonb(a) INTO account_after FROM public.auto_accounts a WHERE id=operation_account_id;
  IF result->>'created' IS DISTINCT FROM 'true' OR account_after IS DISTINCT FROM account_before THEN
    RAISE EXCEPTION 'v282_smoke:operation_ownership_not_preserved';
  END IF;
  SET LOCAL ROLE anon;
  IF public.claim_campaign_runtime(operation_campaign_id,operation_account_id,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v282_smoke:campaign_stole_operation_account';
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(operation_account_id,owner_fixture.staff_id,
    'server','tạm dừng',operation_token) THEN RAISE EXCEPTION 'v282_smoke:operation_release_failed'; END IF;
  RESET ROLE;

  -- Account status is text. Creation must not depend on a list of runtime states,
  -- including when a future runtime introduces a state unknown to this migration.
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
  VALUES (prefix || '-independent-status','zalo',owner_fixture.staff_id,owner_fixture.organization_id,
    true,false,true,false,'đã đăng nhập','v282-runtime-state') RETURNING id INTO independent_status_account_id;
  SELECT to_jsonb(a) INTO account_before FROM public.auto_accounts a WHERE id=independent_status_account_id;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-independent-core',payload || jsonb_build_object('accountId',independent_status_account_id),'[]'::jsonb);
  IF result->>'created' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'v282_smoke:core_still_depends_on_account_status';
  END IF;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-independent-v2',payload || jsonb_build_object('accountId',independent_status_account_id),'[]'::jsonb);
  independent_status_campaign_id := (result->>'campaign_id')::bigint;
  IF result->>'created' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'v282_smoke:v2_still_depends_on_account_status';
  END IF;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-independent-v2',payload || jsonb_build_object('accountId',independent_status_account_id),'[]'::jsonb);
  IF result->>'created' IS DISTINCT FROM 'false'
    OR (result->>'campaign_id')::bigint IS DISTINCT FROM independent_status_campaign_id THEN
    RAISE EXCEPTION 'v282_smoke:independent_status_idempotency_failed';
  END IF;
  RESET ROLE;
  SELECT to_jsonb(a) INTO account_after FROM public.auto_accounts a WHERE id=independent_status_account_id;
  IF account_after IS DISTINCT FROM account_before THEN
    RAISE EXCEPTION 'v282_smoke:creation_modified_account_status';
  END IF;
  SET LOCAL ROLE anon;
  IF public.claim_campaign_runtime(independent_status_campaign_id,independent_status_account_id,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v282_smoke:scheduler_accepted_non_idle_account';
  END IF;
  RESET ROLE;

  -- Rejected accounts remain rejected even when their status is running.
  FOR case_fixture IN SELECT * FROM (VALUES
    ('inactive','zalo',true,false,false,false),
    ('deleted','zalo',true,false,true,true),
    ('local','zalo',false,false,true,false),
    ('web','zalo',false,true,true,false),
    ('facebook','facebook',false,false,true,false)
  ) AS cases(name,platform,server,web,active,deleted)
  LOOP
    INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
      is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
    VALUES (prefix || '-' || case_fixture.name,case_fixture.platform,
      owner_fixture.staff_id,owner_fixture.organization_id,case_fixture.server,case_fixture.web,
      case_fixture.active,case_fixture.deleted,'đã đăng nhập','đang chạy') RETURNING id INTO invalid_account_id;
    SET LOCAL ROLE service_role;
    BEGIN
      PERFORM public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
        prefix || '-invalid-' || case_fixture.name,payload || jsonb_build_object('accountId',invalid_account_id),'[]'::jsonb);
      RAISE EXCEPTION 'v282_smoke:invalid_account_accepted:%',case_fixture.name;
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
      IF error_message<>'control_account_not_found' THEN RAISE; END IF;
    END;
    RESET ROLE;
  END LOOP;

  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.create_control_campaign_v2(foreign_owner.id,foreign_owner.organization_id,
      prefix || '-foreign',payload,'[]'::jsonb);
    RAISE EXCEPTION 'v282_smoke:foreign_owner_accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
    IF error_message<>'control_account_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
      prefix || '-missing',payload || jsonb_build_object('accountId',9223372036854775807::bigint),'[]'::jsonb);
    RAISE EXCEPTION 'v282_smoke:missing_account_accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
    IF error_message<>'control_account_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
      prefix || '-wrong-action',payload || jsonb_build_object('actionId','facebook_message_uid'),'[]'::jsonb);
    RAISE EXCEPTION 'v282_smoke:wrong_action_accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
    IF error_message<>'control_action_not_allowed' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- SMS continues using its existing branch of the same creation RPC.
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
  VALUES (prefix || '-sms','sms',owner_fixture.staff_id,owner_fixture.organization_id,
    false,false,true,false,'đã đăng nhập','đang chạy') RETURNING id INTO invalid_account_id;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-sms',payload || jsonb_build_object('accountId',invalid_account_id,'actionId','sms_send'),'[]'::jsonb);
  IF result->>'created' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v282_smoke:sms_regression'; END IF;
  RESET ROLE;

  IF has_function_privilege('anon','public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'v282_smoke:control_acl_widened';
  END IF;
END;
$smoke$;

ROLLBACK;
SELECT 'v282 smoke PASS; fixtures rolled back' AS result;

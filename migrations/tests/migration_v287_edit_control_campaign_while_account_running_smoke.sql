-- Only synthetic accounts/campaigns are mutated. The entire test rolls back;
-- workers cannot see the fixtures and no Zalo message is sent.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $smoke$
DECLARE
  owner_fixture record;
  foreign_owner record;
  case_fixture record;
  current_campaign public.auto_campaigns%ROWTYPE;
  account_id bigint;
  target_account_id bigint;
  old_account_id bigint;
  invalid_account_id bigint;
  running_campaign_id bigint;
  paused_campaign_id bigint;
  queued_campaign_id bigint;
  repair_campaign_id bigint;
  invalid_campaign_id bigint;
  sms_campaign_id bigint;
  sms_input_id bigint;
  old_version text;
  old_timestamp timestamptz;
  operation_token uuid := gen_random_uuid();
  prefix text := 'v287-smoke-' || txid_current()::text;
  payload jsonb;
  patch jsonb;
  result jsonb;
  account_before jsonb;
  target_before jsonb;
  running_before jsonb;
  campaign_before jsonb;
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
  IF NOT FOUND THEN RAISE EXCEPTION 'v287_smoke:no_server_owner_fixture'; END IF;
  -- Read only an existing foreign account ID to test a same-platform tenant
  -- rejection; the update must reject it before locking or mutating that row.
  SELECT s.id, s.organization_id, a.id AS account_id INTO foreign_owner
  FROM public.org_staff s JOIN public.auto_accounts a
    ON a.staff_id=s.id AND a.organization_id=s.organization_id
  WHERE s.is_active=true AND s.organization_id<>owner_fixture.organization_id
    AND a.flatform_type='zalo' AND a.is_zalo_server=true AND a.is_zalo_show_web=false
    AND a.is_active=true AND a.is_delete=false ORDER BY a.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'v287_smoke:no_foreign_owner_fixture'; END IF;

  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
  VALUES (prefix,'zalo',owner_fixture.staff_id,owner_fixture.organization_id,
    true,false,true,false,'đã đăng nhập','chờ xử lý') RETURNING id INTO account_id;
  payload := jsonb_build_object('name',prefix,'accountId',account_id,
    'actionId','zalo_message_group','schedule',now()-interval '1 minute','content','fixture');
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-running',payload,'[]'::jsonb,'chờ xử lý');
  running_campaign_id := (result->>'campaign_id')::bigint;
  SET LOCAL ROLE anon;
  IF NOT public.claim_campaign_runtime(running_campaign_id,account_id,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v287_smoke:running_fixture_claim_failed';
  END IF;
  RESET ROLE;
  SELECT to_jsonb(a) INTO account_before FROM public.auto_accounts a WHERE id=account_id;
  SELECT to_jsonb(c) INTO running_before FROM public.auto_campaigns c WHERE id=running_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-paused',payload,'[]'::jsonb,'tạm dừng');
  paused_campaign_id := (result->>'campaign_id')::bigint;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-queued',payload,'[]'::jsonb,'chờ xử lý');
  queued_campaign_id := (result->>'campaign_id')::bigint;
  RESET ROLE;

  -- Exact Web form path: config version + explicitly selected SAME busy account.
  -- This is the first assertion, and must fail with not_found before v287.
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=paused_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_by_config_version_atomic(
    owner_fixture.staff_id,owner_fixture.organization_id,paused_campaign_id,current_campaign.updated_at,
    jsonb_build_object('_expected_config_version',public.aka_agent_campaign_config_version(current_campaign),
      'account_id',account_id,'content','saved while another campaign runs'));
  RESET ROLE;
  IF result->>'updated' IS DISTINCT FROM 'true'
    OR (SELECT content FROM public.auto_campaigns WHERE id=paused_campaign_id)<>'saved while another campaign runs'
    OR (SELECT status FROM public.auto_campaigns WHERE id=paused_campaign_id)<>'tạm dừng' THEN
    RAISE EXCEPTION 'v287_smoke:busy_account_edit_failed:%',result;
  END IF;

  -- Legacy/quick edit also works, and a status field cannot start a Zalo campaign.
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=queued_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    queued_campaign_id,current_campaign.updated_at,'{"name":"v287 quick edit","status":"đang chạy"}'::jsonb);
  RESET ROLE;
  IF result->>'updated' IS DISTINCT FROM 'true'
    OR (SELECT status FROM public.auto_campaigns WHERE id=queued_campaign_id)<>'chờ xử lý' THEN
    RAISE EXCEPTION 'v287_smoke:legacy_edit_or_status_regression:%',result;
  END IF;

  -- Runtime timestamp updates are allowed; genuine config races remain rejected.
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=paused_campaign_id;
  old_version := public.aka_agent_campaign_config_version(current_campaign);
  old_timestamp := current_campaign.updated_at;
  UPDATE public.auto_campaigns SET note='runtime-only',updated_at=old_timestamp+interval '1 second'
  WHERE id=paused_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_by_config_version_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    paused_campaign_id,old_timestamp,jsonb_build_object('_expected_config_version',old_version,'name','v287 after runtime'));
  RESET ROLE;
  IF result->>'updated' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v287_smoke:runtime_race:%',result; END IF;
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=paused_campaign_id;
  old_version := public.aka_agent_campaign_config_version(current_campaign);
  old_timestamp := current_campaign.updated_at;
  UPDATE public.auto_campaigns SET content='concurrent config',updated_at=old_timestamp+interval '1 second'
  WHERE id=paused_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_by_config_version_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    paused_campaign_id,old_timestamp,jsonb_build_object('_expected_config_version',old_version,'content','must not save'));
  IF result->>'reason' IS DISTINCT FROM 'version_conflict' THEN RAISE EXCEPTION 'v287_smoke:config_conflict:%',result; END IF;
  result := public.update_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    paused_campaign_id,old_timestamp,'{"content":"must not save"}'::jsonb);
  IF result->>'reason' IS DISTINCT FROM 'version_conflict' THEN RAISE EXCEPTION 'v287_smoke:timestamp_conflict:%',result; END IF;
  RESET ROLE;

  -- The campaign that actually owns the runtime must still reject edits.
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=running_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_by_config_version_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    running_campaign_id,current_campaign.updated_at,jsonb_build_object(
      '_expected_config_version',public.aka_agent_campaign_config_version(current_campaign),'content','must not save'));
  IF result->>'reason' IS DISTINCT FROM 'campaign_running' THEN RAISE EXCEPTION 'v287_smoke:running_campaign_guard:%',result; END IF;
  RESET ROLE;

  -- Preserve append input counts and durable idempotency on a busy account.
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=paused_campaign_id;
  patch := jsonb_build_object('_expected_config_version',public.aka_agent_campaign_config_version(current_campaign),'name','v287 append');
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_by_config_version_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    paused_campaign_id,current_campaign.updated_at,patch,NULL,false,prefix || '-append',0,'[{"uid":"v287-fixture-group"}]'::jsonb);
  IF result->>'updated' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v287_smoke:append:%',result; END IF;
  result := public.update_control_campaign_by_config_version_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    paused_campaign_id,current_campaign.updated_at,patch,NULL,false,prefix || '-append',0,'[{"uid":"v287-fixture-group"}]'::jsonb);
  IF result->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v287_smoke:append_retry:%',result; END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=paused_campaign_id)<>1 THEN
    RAISE EXCEPTION 'v287_smoke:duplicate_inputs';
  END IF;
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=paused_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    paused_campaign_id,current_campaign.updated_at,'{}'::jsonb,NULL,false,prefix || '-wrong-count',0,'[{"uid":"another-fixture"}]'::jsonb);
  IF result->>'reason' IS DISTINCT FROM 'input_count_conflict' THEN RAISE EXCEPTION 'v287_smoke:input_count_guard:%',result; END IF;
  RESET ROLE;

  -- Verify no edited campaign stole the first account's existing runtime.
  IF (SELECT to_jsonb(a) FROM public.auto_accounts a WHERE id=account_id) IS DISTINCT FROM account_before
    OR (SELECT to_jsonb(c) FROM public.auto_campaigns c WHERE id=running_campaign_id) IS DISTINCT FROM running_before THEN
    RAISE EXCEPTION 'v287_smoke:running_ownership_modified';
  END IF;
  SET LOCAL ROLE anon;
  IF public.claim_campaign_runtime(queued_campaign_id,account_id,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v287_smoke:busy_account_claimed';
  END IF;
  RESET ROLE;

  -- Switch to an account occupied by a scan; its ownership token stays intact.
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
  VALUES (prefix || '-scan','zalo',owner_fixture.staff_id,owner_fixture.organization_id,
    true,false,true,false,'đã đăng nhập','tạm dừng') RETURNING id INTO target_account_id;
  SET LOCAL ROLE anon;
  result := public.claim_zalo_account_runtime_operation(target_account_id,owner_fixture.staff_id,
    'server','tạm dừng',operation_token,true);
  IF result->>'claimed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'v287_smoke:operation_claim:%',result; END IF;
  RESET ROLE;
  SELECT to_jsonb(a) INTO target_before FROM public.auto_accounts a WHERE id=target_account_id;
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=paused_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_by_config_version_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    paused_campaign_id,current_campaign.updated_at,jsonb_build_object(
      '_expected_config_version',public.aka_agent_campaign_config_version(current_campaign),'account_id',target_account_id));
  RESET ROLE;
  IF result->>'updated' IS DISTINCT FROM 'true'
    OR (SELECT c.account_id FROM public.auto_campaigns c WHERE id=paused_campaign_id)<>target_account_id THEN
    RAISE EXCEPTION 'v287_smoke:busy_target_switch:%',result;
  END IF;

  -- Preserve the September orphan-account repair, now accepting a busy target.
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status)
  VALUES (prefix || '-old','zalo',owner_fixture.staff_id,owner_fixture.organization_id,
    true,false,true,false,'đã đăng nhập','chờ xử lý') RETURNING id INTO old_account_id;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-repair',payload || jsonb_build_object('accountId',old_account_id),'[]'::jsonb,'tạm dừng');
  repair_campaign_id := (result->>'campaign_id')::bigint;
  RESET ROLE;
  UPDATE public.auto_accounts SET is_delete=true WHERE id=old_account_id;
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=repair_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    repair_campaign_id,current_campaign.updated_at,'{}'::jsonb);
  IF result->>'reason' IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'v287_smoke:orphan_without_replacement:%',result; END IF;
  result := public.update_control_campaign_by_config_version_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    repair_campaign_id,current_campaign.updated_at,jsonb_build_object(
      '_expected_config_version',public.aka_agent_campaign_config_version(current_campaign),'account_id',target_account_id));
  RESET ROLE;
  IF result->>'updated' IS DISTINCT FROM 'true'
    OR (SELECT c.account_id FROM public.auto_campaigns c WHERE id=repair_campaign_id)<>target_account_id
    OR (SELECT to_jsonb(a) FROM public.auto_accounts a WHERE id=target_account_id) IS DISTINCT FROM target_before THEN
    RAISE EXCEPTION 'v287_smoke:busy_orphan_repair:%',result;
  END IF;
  SET LOCAL ROLE anon;
  IF public.claim_campaign_runtime(repair_campaign_id,target_account_id,owner_fixture.staff_id,'server') THEN
    RAISE EXCEPTION 'v287_smoke:scan_ownership_stolen';
  END IF;
  RESET ROLE;

  -- Do not replace the removed predicate with another runtime-state allowlist.
  UPDATE public.auto_accounts SET status='v287-future-runtime-state' WHERE id=target_account_id;
  SELECT to_jsonb(a) INTO target_before FROM public.auto_accounts a WHERE id=target_account_id;
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=repair_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    repair_campaign_id,current_campaign.updated_at,jsonb_build_object('account_id',target_account_id,'name','v287 independent status'));
  RESET ROLE;
  IF result->>'updated' IS DISTINCT FROM 'true'
    OR (SELECT to_jsonb(a) FROM public.auto_accounts a WHERE id=target_account_id) IS DISTINCT FROM target_before THEN
    RAISE EXCEPTION 'v287_smoke:status_allowlist_or_account_mutation:%',result;
  END IF;

  -- Invalid CURRENT and TARGET accounts remain unavailable with a busy status.
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
    VALUES (prefix || '-' || case_fixture.name,case_fixture.platform,owner_fixture.staff_id,owner_fixture.organization_id,
      case_fixture.server,case_fixture.web,case_fixture.active,case_fixture.deleted,'đã đăng nhập','đang chạy')
    RETURNING id INTO invalid_account_id;
    INSERT INTO public.auto_campaigns(name,action_id,account_id,status,staff_id,organization_id,is_delete)
    VALUES (prefix || '-invalid','zalo_message_group',invalid_account_id,'tạm dừng',
      owner_fixture.staff_id,owner_fixture.organization_id,false) RETURNING id INTO invalid_campaign_id;
    SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=invalid_campaign_id;
    SET LOCAL ROLE service_role;
    result := public.update_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
      invalid_campaign_id,current_campaign.updated_at,'{}'::jsonb);
    IF result->>'reason' IS DISTINCT FROM 'not_found' THEN
      RAISE EXCEPTION 'v287_smoke:invalid_current_accepted:%:%',case_fixture.name,result;
    END IF;
    RESET ROLE;
    SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=paused_campaign_id;
    SET LOCAL ROLE service_role;
    BEGIN
      PERFORM public.update_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
        paused_campaign_id,current_campaign.updated_at,jsonb_build_object('account_id',invalid_account_id));
      RAISE EXCEPTION 'v287_smoke:invalid_target_accepted:%',case_fixture.name;
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
      IF error_message<>'control_account_not_found' THEN RAISE; END IF;
    END;
    RESET ROLE;
  END LOOP;

  -- Campaign and account tenancy are checked independently.
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=paused_campaign_id;
  campaign_before := to_jsonb(current_campaign);
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_atomic(foreign_owner.id,foreign_owner.organization_id,
    paused_campaign_id,current_campaign.updated_at,'{}'::jsonb);
  IF result->>'reason' IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'v287_smoke:foreign_campaign_accepted:%',result; END IF;
  result := public.update_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    9223372036854775807,now(),'{}'::jsonb);
  IF result->>'reason' IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'v287_smoke:missing_campaign_accepted:%',result; END IF;
  RESET ROLE;
  -- A valid same-platform account owned by somebody else cannot be selected.
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.update_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
      paused_campaign_id,current_campaign.updated_at,jsonb_build_object('account_id',foreign_owner.account_id));
    RAISE EXCEPTION 'v287_smoke:foreign_target_accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
    IF error_message<>'control_account_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.update_control_campaign_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
      paused_campaign_id,current_campaign.updated_at,jsonb_build_object('account_id',9223372036854775807::bigint));
    RAISE EXCEPTION 'v287_smoke:missing_target_accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
    IF error_message<>'control_account_not_found' THEN RAISE; END IF;
  END;
  RESET ROLE;
  IF (SELECT to_jsonb(c) FROM public.auto_campaigns c WHERE id=paused_campaign_id) IS DISTINCT FROM campaign_before THEN
    RAISE EXCEPTION 'v287_smoke:rejected_edit_modified_campaign';
  END IF;
  UPDATE public.auto_campaigns SET is_delete=true WHERE id=repair_campaign_id;
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=repair_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_by_config_version_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    repair_campaign_id,current_campaign.updated_at,jsonb_build_object('_expected_config_version',public.aka_agent_campaign_config_version(current_campaign)));
  IF result->>'reason' IS DISTINCT FROM 'not_found' THEN RAISE EXCEPTION 'v287_smoke:deleted_campaign_accepted:%',result; END IF;
  RESET ROLE;

  -- SMS rematerialization still uses the same core without a Zalo status gate.
  INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,
    is_zalo_server,is_zalo_show_web,is_active,is_delete,status)
  VALUES (prefix || '-sms','sms',owner_fixture.staff_id,owner_fixture.organization_id,
    false,false,true,false,'đang chạy') RETURNING id INTO invalid_account_id;
  SET LOCAL ROLE service_role;
  result := public.create_control_campaign_v2(owner_fixture.staff_id,owner_fixture.organization_id,
    prefix || '-sms',payload || jsonb_build_object('accountId',invalid_account_id,'actionId','sms_send'),
    '[{"phone":"0900000001","content":"old"}]'::jsonb,'tạm dừng');
  sms_campaign_id := (result->>'campaign_id')::bigint;
  RESET ROLE;
  SELECT id INTO sms_input_id FROM public.auto_campaign_input_data WHERE campaign_id=sms_campaign_id;
  SELECT * INTO current_campaign FROM public.auto_campaigns WHERE id=sms_campaign_id;
  SET LOCAL ROLE service_role;
  result := public.update_control_campaign_by_config_version_atomic(owner_fixture.staff_id,owner_fixture.organization_id,
    sms_campaign_id,current_campaign.updated_at,jsonb_build_object(
      '_expected_config_version',public.aka_agent_campaign_config_version(current_campaign),'content','new sms'),
    jsonb_build_array(jsonb_build_object('id',sms_input_id,'phone','0900000001','content','new sms')));
  RESET ROLE;
  IF result->>'updated' IS DISTINCT FROM 'true' OR result->>'updated_input_count' IS DISTINCT FROM '1'
    OR (SELECT content FROM public.auto_campaign_input_data WHERE id=sms_input_id)<>'new sms' THEN
    RAISE EXCEPTION 'v287_smoke:sms_materialization:%',result;
  END IF;

  -- These production functions must be byte-for-byte unchanged by this fix.
  FOR case_fixture IN SELECT * FROM (VALUES
    ('public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)','c1673974d0982ce6a731741072ca5338'),
    ('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)','1b04e01063f2d59e23e063794a4574d2'),
    ('public.claim_campaign_runtime(bigint,bigint,bigint,text)','e6b1889cda717cb0bea6f7d801633c75')
  ) AS cases(signature,checksum)
  LOOP
    IF md5(pg_get_functiondef(to_regprocedure(case_fixture.signature))) IS DISTINCT FROM case_fixture.checksum THEN
      RAISE EXCEPTION 'v287_smoke:unrelated_function_changed:%',case_fixture.signature;
    END IF;
  END LOOP;
  FOR case_fixture IN SELECT * FROM (VALUES
    ('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)'),
    ('public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)')
  ) AS cases(signature)
  LOOP
    IF has_function_privilege('anon',case_fixture.signature,'EXECUTE')
      OR has_function_privilege('authenticated',case_fixture.signature,'EXECUTE')
      OR NOT has_function_privilege('service_role',case_fixture.signature,'EXECUTE') THEN
      RAISE EXCEPTION 'v287_smoke:control_acl_changed:%',case_fixture.signature;
    END IF;
  END LOOP;
END;
$smoke$;

ROLLBACK;
SELECT 'v287 smoke PASS; fixtures rolled back' AS result;

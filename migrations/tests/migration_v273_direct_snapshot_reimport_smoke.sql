-- v273: retain the v243 runtime/ownership smoke, then test edit/reimport/retry.
-- The credentialed wrapper must snapshot both Desktop and Server direct
-- campaigns, restore the caller GUC, and retain fail-closed core ownership.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_wrapper_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_core_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_wrapper_definition text;
  v_core_definition text;
BEGIN
  IF v_wrapper_signature IS NULL OR v_core_signature IS NULL THEN
    RAISE EXCEPTION 'v243_smoke: direct snapshot function missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_wrapper_signature),
         pg_catalog.pg_get_functiondef(v_core_signature)
  INTO v_wrapper_definition, v_core_definition;

  IF pg_catalog.strpos(v_wrapper_definition, 'v_previous_target text') = 0
    OR pg_catalog.strpos(v_wrapper_definition, 'account.is_zalo_server') = 0
    OR pg_catalog.strpos(v_wrapper_definition, 'committed request returns its') = 0
    OR pg_catalog.strpos(v_wrapper_definition, 'aka_agent_data_group_type_compatible') = 0
    OR pg_catalog.strpos(v_core_definition, 'v_account_runtime_target text') = 0
    OR pg_catalog.strpos(v_core_definition, $$v_runtime_target NOT IN ('desktop', 'server')$$) = 0
    OR pg_catalog.strpos(v_core_definition, 'direct_campaign_runtime_not_owner') = 0
    OR pg_catalog.strpos(v_core_definition, 'aka_agent_lock_campaign_input_serialization') = 0
    OR pg_catalog.strpos(v_core_definition, 'Reuse order for one-time snapshots:') = 0
    OR pg_catalog.strpos(v_core_definition, 'v226: Facebook UID/URL targets') = 0
    OR pg_catalog.strpos(v_core_definition, 'v227: snapshot Facebook routes') = 0
    OR pg_catalog.strpos(v_core_definition, 'v228: valid-phone routes') = 0
  THEN
    RAISE EXCEPTION 'v243_smoke: routing or preserved core patch missing';
  END IF;

  IF pg_catalog.strpos(
      v_core_definition,
      'Return a committed response before consulting mutable campaign/group state.'
    ) >= pg_catalog.strpos(
      v_core_definition,
      'Match the shared Data Group lock hierarchy'
    )
    OR pg_catalog.strpos(
      v_core_definition,
      'Match the shared Data Group lock hierarchy'
    ) >= pg_catalog.strpos(
      v_core_definition,
      'aka_agent_lock_campaign_input_serialization'
    )
    OR pg_catalog.strpos(
      v_core_definition,
      'aka_agent_lock_campaign_input_serialization'
    ) >= pg_catalog.strpos(v_core_definition, 'SELECT campaign.*')
    OR pg_catalog.strpos(
      v_core_definition,
      'SELECT campaign.*'
    ) >= pg_catalog.strpos(
      v_core_definition,
      'runtime ownership decision'
    )
  THEN
    RAISE EXCEPTION 'v243_smoke: snapshot lock/retry order changed';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'anon', v_wrapper_signature, 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated', v_wrapper_signature, 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', v_wrapper_signature, 'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) AS privilege
    WHERE routine.oid = v_wrapper_signature
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'v243_smoke: wrapper ACL is wrong';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon', v_core_signature, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', v_core_signature, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'service_role', v_core_signature, 'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) AS privilege
    WHERE routine.oid = v_core_signature
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'v243_smoke: core ACL is wrong';
  END IF;
END;
$metadata$;

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_auth_username text;
  v_auth_password text;
  v_group_id constant bigint := 8800243000000001;
  v_local_account_id constant bigint := 8800243000000002;
  v_server_account_id constant bigint := 8800243000000003;
  v_local_campaign_id constant bigint := 8800243000000004;
  v_server_campaign_id constant bigint := 8800243000000005;
  v_local_request_id text;
  v_server_request_id text;
  v_mismatch_local_request_id text;
  v_mismatch_server_request_id text;
  v_error_request_id text;
  v_result jsonb;
  v_replayed jsonb;
  v_input_id bigint;
  v_target_key text;
  v_test_campaign bigint;
  v_rejected boolean;
BEGIN
  SELECT staff.id, staff.organization_id, staff.username, staff.password
  INTO v_staff_id, v_organization_id, v_auth_username, v_auth_password
  FROM public.org_staff AS staff
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
    AND staff.username IS NOT NULL
    AND staff.password IS NOT NULL
  ORDER BY staff.id
  LIMIT 1;

  IF v_staff_id IS NULL OR v_organization_id IS NULL
    OR v_auth_username IS NULL OR v_auth_password IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.auto_campaign_actions AS action
      WHERE action.id = 'zalo_message_phone'
        AND action.is_active = true
        AND COALESCE(action.is_delete, false) = false
    )
  THEN
    RAISE EXCEPTION 'v273_smoke: active fixture tenant/action missing';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aka-agent-v243-server-direct-snapshot-smoke', 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups WHERE id = v_group_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_accounts
    WHERE id IN (v_local_account_id, v_server_account_id)
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaigns
    WHERE id IN (v_local_campaign_id, v_server_campaign_id)
  ) THEN
    RAISE EXCEPTION 'v243_smoke: reserved fixture ID collision';
  END IF;

  v_local_request_id := '__v243_snapshot_local__' || v_staff_id::text;
  v_server_request_id := '__v243_snapshot_server__' || v_staff_id::text;
  v_mismatch_local_request_id := '__v243_mismatch_local__' || v_staff_id::text;
  v_mismatch_server_request_id := '__v243_mismatch_server__' || v_staff_id::text;
  v_error_request_id := '__v243_error_restore__' || v_staff_id::text;

  INSERT INTO public.auto_account_contact_groups (
    id, account_id, contact_type, name, purpose,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_group_id, NULL, NULL, '__v243_data_group__', 'data_group',
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_local_account_id, '__v243_local_account__', 'zalo', false, false,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false
    ),
    (
      v_server_account_id, '__v243_server_account__', 'zalo', false, true,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false
    );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    provisioning_state, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_local_campaign_id, '__v243_local_campaign__', 'zalo_message_phone',
      v_local_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    ),
    (
      v_server_campaign_id, '__v243_server_campaign__', 'zalo_message_phone',
      v_server_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    );

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'server', true
  );
  v_result := public.aka_agent_snapshot_data_group_to_direct_campaign(
    v_staff_id, v_organization_id, v_local_request_id,
    v_local_campaign_id, v_group_id, now(), 'tạm dừng',
    v_auth_username, v_auth_password
  );
  IF (v_result->>'campaign_id')::bigint IS DISTINCT FROM v_local_campaign_id
    OR (v_result->>'active_membership_count')::integer IS DISTINCT FROM 0
    OR current_setting('aka_agent.zalo_runtime_target', true) <> 'server'
  THEN
    RAISE EXCEPTION 'v243_smoke: local wrapper snapshot/restore failed: %', v_result;
  END IF;

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'desktop', true
  );
  v_result := public.aka_agent_snapshot_data_group_to_direct_campaign(
    v_staff_id, v_organization_id, v_server_request_id,
    v_server_campaign_id, v_group_id, now(), 'tạm dừng',
    v_auth_username, v_auth_password
  );
  IF (v_result->>'campaign_id')::bigint IS DISTINCT FROM v_server_campaign_id
    OR (v_result->>'active_membership_count')::integer IS DISTINCT FROM 0
    OR current_setting('aka_agent.zalo_runtime_target', true) <> 'desktop'
  THEN
    RAISE EXCEPTION 'v243_smoke: Server wrapper snapshot/restore failed: %', v_result;
  END IF;

  IF (
    SELECT count(*)
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = v_staff_id
      AND batch.organization_id = v_organization_id
      AND batch.request_id IN (v_local_request_id, v_server_request_id)
      AND batch.operation = 'snapshot_campaign'
      AND batch.status = 'completed'
      AND batch.result IS NOT NULL
  ) IS DISTINCT FROM 2::bigint THEN
    RAISE EXCEPTION 'v243_smoke: successful snapshot batch missing';
  END IF;

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'server', true
  );
  v_rejected := false;
  BEGIN
    PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
      v_staff_id, v_organization_id, v_mismatch_local_request_id,
      v_local_campaign_id, v_group_id, now(), 'tạm dừng',
      v_auth_username, v_auth_password
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'direct_campaign_runtime_not_owner';
  END;
  IF NOT v_rejected OR EXISTS (
    SELECT 1
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = v_staff_id
      AND batch.organization_id = v_organization_id
      AND batch.request_id = v_mismatch_local_request_id
  ) THEN
    RAISE EXCEPTION 'v243_smoke: Server target mutated a Desktop campaign';
  END IF;

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'desktop', true
  );
  v_rejected := false;
  BEGIN
    PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
      v_staff_id, v_organization_id, v_mismatch_server_request_id,
      v_server_campaign_id, v_group_id, now(), 'tạm dừng',
      v_auth_username, v_auth_password
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'direct_campaign_runtime_not_owner';
  END;
  IF NOT v_rejected OR EXISTS (
    SELECT 1
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = v_staff_id
      AND batch.organization_id = v_organization_id
      AND batch.request_id = v_mismatch_server_request_id
  ) THEN
    RAISE EXCEPTION 'v243_smoke: Desktop target mutated a Server campaign';
  END IF;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy'
  WHERE id = v_local_campaign_id;

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'server', true
  );
  v_rejected := false;
  BEGIN
    PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign(
      v_staff_id, v_organization_id, v_error_request_id,
      v_local_campaign_id, v_group_id, now(), 'tạm dừng',
      v_auth_username, v_auth_password
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'campaign_not_direct_snapshot_eligible';
  END;
  IF NOT v_rejected
    OR current_setting('aka_agent.zalo_runtime_target', true) <> 'server'
    OR EXISTS (
      SELECT 1
      FROM public.auto_data_ingest_batches AS batch
      WHERE batch.staff_id = v_staff_id
        AND batch.organization_id = v_organization_id
        AND batch.request_id = v_error_request_id
    )
  THEN
    RAISE EXCEPTION 'v243_smoke: wrapper error restore or fail-closed guard failed';
  END IF;

  UPDATE public.auto_campaigns SET status='tạm dừng' WHERE id=v_local_campaign_id;
  UPDATE public.auto_account_contact_groups
  SET data_type_category_item_id=public.aka_agent_data_type_category_item_id('phone') WHERE id=v_group_id;
  IF EXISTS (SELECT 1 FROM public.auto_account_contacts WHERE id=8800273000000900)
    OR EXISTS (SELECT 1 FROM public.auto_account_contact_group_members WHERE id=8800273000000901)
  THEN RAISE EXCEPTION 'v273_smoke: source fixture collision'; END IF;
  INSERT INTO public.auto_account_contacts
    (id,account_id,contact_type,name,phone,flatform_type,staff_id,organization_id,is_delete)
  OVERRIDING SYSTEM VALUE VALUES
    (8800273000000900,NULL,'person','__v273_source__','0900000000','zalo',v_staff_id,v_organization_id,false);
  INSERT INTO public.auto_account_contact_group_members(id,group_id,contact_id,is_delete)
  OVERRIDING SYSTEM VALUE VALUES (8800273000000901,v_group_id,8800273000000900,false);

  FOREACH v_test_campaign IN ARRAY ARRAY[v_local_campaign_id,v_server_campaign_id] LOOP
    v_result:=public.aka_agent_snapshot_data_group_to_direct_campaign(
      v_staff_id,v_organization_id,'__v273_first__:'||v_test_campaign,v_test_campaign,v_group_id,
      now(),'tạm dừng',v_auth_username,v_auth_password);
    IF (v_result->>'inserted_count')::int IS DISTINCT FROM 1
    THEN RAISE EXCEPTION 'v273_smoke: first import failed: %',v_result; END IF;
    SELECT id,canonical_target_key INTO STRICT v_input_id,v_target_key
    FROM public.auto_campaign_input_data WHERE campaign_id=v_test_campaign AND is_delete=false;
    UPDATE public.auto_campaign_input_data SET name='User edit',uid='resolved-zalo-uid',
      info1='User info',content='User content' WHERE id=v_input_id;
    v_result:=public.aka_agent_snapshot_data_group_to_direct_campaign(
      v_staff_id,v_organization_id,'__v273_repeat__:'||v_test_campaign,v_test_campaign,v_group_id,
      now(),'tạm dừng',v_auth_username,v_auth_password);
    IF (v_result->>'inserted_count')::int IS DISTINCT FROM 0
      OR (v_result->>'already_seen_count')::int IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id=v_input_id AND name='User edit' AND content='User content')
    THEN RAISE EXCEPTION 'v273_smoke: reimport overwrote metadata or lost dedupe'; END IF;

    UPDATE public.auto_campaign_input_data SET phone='0911111111' WHERE id=v_input_id;
    -- Model an alias seen by a concurrent snapshot before the edit committed.
    INSERT INTO public.auto_campaign_input_target_aliases(campaign_id,alias_key,canonical_target_key,input_data_id)
    VALUES(v_test_campaign,v_target_key,v_target_key,v_input_id);
    v_result:=public.aka_agent_snapshot_data_group_to_direct_campaign(
      v_staff_id,v_organization_id,'__v273_after_edit__:'||v_test_campaign,v_test_campaign,v_group_id,
      now(),'tạm dừng',v_auth_username,v_auth_password);
    IF (v_result->>'inserted_count')::int IS DISTINCT FROM 1
      OR (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=v_test_campaign AND is_delete=false)<>2
      OR NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id=v_input_id AND phone='0911111111' AND canonical_target_key IS NULL)
      OR EXISTS (SELECT 1 FROM public.auto_campaign_input_target_aliases WHERE input_data_id=v_input_id)
      OR NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_origins WHERE input_data_id=v_input_id
        AND payload_snapshot->>'phone'='0900000000')
    THEN RAISE EXCEPTION 'v273_smoke: reimport reused an edited target or damaged its history'; END IF;
    v_replayed:=public.aka_agent_snapshot_data_group_to_direct_campaign(
      v_staff_id,v_organization_id,'__v273_after_edit__:'||v_test_campaign,v_test_campaign,v_group_id,
      now(),'tạm dừng',v_auth_username,v_auth_password);
    IF v_replayed IS DISTINCT FROM v_result
      OR (SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id=v_test_campaign AND is_delete=false)<>2
    THEN RAISE EXCEPTION 'v273_smoke: request replay lost idempotency'; END IF;
  END LOOP;

END;
$behavior$;

SELECT 'PASS: local/server snapshot, metadata retention, stale-alias rejection after target edit, origin preservation, idempotent retry and ownership guards' AS result;
ROLLBACK;

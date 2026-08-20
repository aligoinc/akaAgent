-- Rollback smoke for migration_v243_zalo_server_direct_data_group_snapshot.sql.
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
    RAISE NOTICE 'v243_smoke: active fixture tenant/action missing; behavior fixture skipped';
    RETURN;
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
END;
$behavior$;

ROLLBACK;

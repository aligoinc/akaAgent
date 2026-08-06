-- Rollback smoke test for migration_v219_zalo_per_account_server_runtime.sql.
-- Validates additive Product capability, legacy global-mode compatibility,
-- omitted-field backfill, shared quota, per-account ownership and tokenized
-- subtype-conversion claims.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $preflight$
DECLARE
  v_signature text;
  v_function_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_accounts'
      AND column_name = 'is_zalo_server'
      AND data_type = 'boolean'
      AND is_nullable = 'NO'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'v219_smoke: auto_accounts.is_zalo_server contract is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.auto_accounts'::regclass
      AND trigger_row.tgname = 'trg_normalize_legacy_zalo_account_server_owner'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'v219_smoke: omitted-field compatibility trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.auto_accounts'::regclass
      AND trigger_row.tgname = 'trg_validate_zalo_account_capability_and_quota'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'v219_smoke: authoritative account capability trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.auto_accounts'::regclass
      AND trigger_row.tgname = 'trg_lock_auto_account_control_resources'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'v219_smoke: account resource assignment lock trigger is missing';
  END IF;
  SELECT pg_get_functiondef(
    'public.lock_auto_account_control_resources()'::regprocedure
  ) INTO v_function_definition;
  IF position('pg_advisory_xact_lock_shared' IN v_function_definition) = 0
    OR position('OLD.account_group_id' IN v_function_definition) = 0
    OR position('NEW.proxy_id' IN v_function_definition) = 0
  THEN
    RAISE EXCEPTION 'v219_smoke: account resource assignment trigger is not serializing old/new references';
  END IF;

  SELECT pg_get_functiondef(
    'public.enforce_zalo_account_capability_and_quota()'::regprocedure
  ) INTO v_function_definition;
  IF position('OLD.staff_id IS DISTINCT FROM NEW.staff_id' IN v_function_definition) = 0
    OR position('OLD.organization_id IS DISTINCT FROM NEW.organization_id' IN v_function_definition) = 0
    OR position('v_is_existing_subtype_change' IN v_function_definition) = 0
    OR position('v_is_claimed_subtype_cas' IN v_function_definition) = 0
    OR position(
      'IF v_is_existing_subtype_change AND NOT v_is_claimed_subtype_cas THEN'
      IN v_function_definition
    ) = 0
    OR position('zalo_account_subtype_change_claim_required' IN v_function_definition) = 0
    OR position('zalo_account_subtype_change_claim_required' IN v_function_definition)
      > position('FOR SHARE OF staff' IN v_function_definition)
    OR position('IF v_is_claimed_subtype_cas THEN' IN v_function_definition) = 0
    OR position('OLD.id IS NOT DISTINCT FROM NEW.id' IN v_function_definition) = 0
    OR position('OLD.flatform_type IS NOT DISTINCT FROM NEW.flatform_type' IN v_function_definition) = 0
    OR position('OLD.status = ''đang chạy''' IN v_function_definition) = 0
    OR position('NEW.status = ''đang chạy''' IN v_function_definition) = 0
    OR position('OLD.runtime_operation_claim_token IS NOT NULL' IN v_function_definition) = 0
    OR position('OLD.runtime_operation_claim_token' IN v_function_definition) = 0
    OR position(
      'IS NOT DISTINCT FROM NEW.runtime_operation_claim_token'
      IN v_function_definition
    ) = 0
    OR position('FOR SHARE OF staff' IN v_function_definition) = 0
    OR position('pg_advisory_xact_lock(' IN v_function_definition) = 0
    OR position('resolve_organization_zalo_account_capabilities' IN v_function_definition) = 0
  THEN
    RAISE EXCEPTION 'v219_smoke: account trigger does not revalidate reassignment/capability/quota';
  END IF;
  IF has_function_privilege(
    'service_role',
    'public.enforce_zalo_account_capability_and_quota()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'v219_smoke: trigger helper is exposed as an RPC';
  END IF;
  IF has_function_privilege(
    'service_role',
    'public.lock_auto_account_control_resources()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'v219_smoke: resource-lock trigger helper is exposed as an RPC';
  END IF;

  SELECT pg_get_functiondef(
    'public.create_control_zalo_account_atomic(bigint,bigint,integer,jsonb)'::regprocedure
  ) INTO v_function_definition;
  IF position('control-zalo-account-group:' IN v_function_definition) = 0
    OR position('control-zalo-proxy:' IN v_function_definition) = 0
    OR position('aka-agent-zalo-runtime-entitlement-mutation' IN v_function_definition) = 0
    OR position('control-zalo-account:' IN v_function_definition) = 0
    OR position('control-zalo-account-group:' IN v_function_definition)
      > position('aka-agent-zalo-runtime-entitlement-mutation' IN v_function_definition)
    OR position('control-zalo-proxy:' IN v_function_definition)
      > position('aka-agent-zalo-runtime-entitlement-mutation' IN v_function_definition)
    OR position('aka-agent-zalo-runtime-entitlement-mutation' IN v_function_definition)
      > position('control-zalo-account:' IN v_function_definition)
  THEN
    RAISE EXCEPTION 'v219_smoke: control account create lock order must be resource, entitlement, staff quota';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_accounts'::regclass
      AND conname = 'chk_auto_accounts_zalo_server_platform'
      AND convalidated = true
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_accounts'::regclass
      AND conname = 'chk_auto_accounts_zalo_runtime_subtype'
      AND convalidated = true
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.org_organization_product'::regclass
      AND conname = 'chk_org_product_zalo_server_product16_18'
      AND convalidated = true
  ) THEN
    RAISE EXCEPTION 'v219_smoke: account/product subtype constraints are missing';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.resolve_organization_zalo_runtime_mode(bigint)',
    'public.get_staff_zalo_runtime_mode(bigint)',
    'public.discover_zalo_server_runtime_users(bigint,integer)',
    'public.resolve_organization_zalo_account_capabilities(bigint)',
    'public.get_staff_zalo_account_capabilities(bigint)',
    'public.discover_zalo_server_account_runtime_users(bigint,integer)',
    'public.inspect_staff_zalo_running_state(bigint)',
    'public.reset_desktop_running_statuses(bigint,boolean,boolean)',
    'public.reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)',
    'public.recover_server_zalo_running_state(bigint,text,boolean)',
    'public.aka_agent_lock_campaign_input_serialization(bigint)',
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)',
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)',
    'public.materialize_auto_automation_detail(bigint,bigint,bigint,text,jsonb,text,text)',
    'public.materialize_auto_automation_detail_v188_serialized_internal(bigint,bigint,bigint,text,jsonb,text,text)',
    'public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)',
    'public.aka_agent_finalize_data_group_campaign(bigint,bigint,bigint,text)',
    'public.aka_agent_finalize_data_group_campaign(bigint,bigint,bigint,text,text,text)',
    'public.aka_agent_finalize_expired_data_group_campaigns(bigint,bigint,integer)',
    'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)',
    'public.claim_campaign_runtime(bigint,bigint,bigint,text)',
    'public.claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)',
    'public.release_zalo_account_runtime_operation(bigint,bigint,text,text)',
    'public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)',
    'public.release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)',
    'public.aka_agent_set_zalo_server_campaign_status(bigint,bigint,text)',
    'public.aka_agent_set_zalo_server_account_status(bigint,bigint,text)',
    'public.aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)',
    'public.aka_agent_claim_zalo_server_run_unit(bigint,bigint,bigint,bigint[])',
    'public.aka_agent_finalize_zalo_server_campaign(bigint,bigint,text,boolean)',
    'public.aka_agent_advance_zalo_server_multi_daily_slot(bigint,bigint,bigint,timestamptz)',
    'public.enqueue_campaign_zalo_realtime_group_event(bigint,bigint,bigint,text,text,text,text,text,text,timestamptz,timestamptz,jsonb)',
    'public.create_control_zalo_account_atomic(bigint,bigint,integer,jsonb)',
    'public.aka_agent_authenticate_control_session(text)',
    'public.aka_agent_internal_require_zalo_server_data_group_runtime(bigint,bigint,text)',
    'public.aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)',
    'public.aka_agent_finalize_expired_zalo_server_data_group_campaigns(bigint,bigint,text,integer)',
    'public.aka_agent_internal_require_zalo_server_runtime(bigint,bigint,text)',
    'public.aka_agent_internal_finalize_zalo_server_maintenance_guard(bigint,bigint,bigint,text,boolean,text)',
    'public.aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)',
    'public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)',
    'public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)',
    'public.append_control_campaign_inputs(bigint,bigint,bigint,text,integer,jsonb)',
    'public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)',
    'public.delete_control_campaign_atomic(bigint,bigint,bigint)',
    'public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)',
    'public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)',
    'public.update_control_zalo_account_group_atomic(bigint,bigint,bigint,timestamptz,jsonb)',
    'public.delete_control_zalo_account_group_atomic(bigint,bigint,bigint)',
    'public.update_control_zalo_proxy_atomic(bigint,bigint,bigint,timestamptz,jsonb)',
    'public.delete_control_zalo_proxy_atomic(bigint,bigint,bigint)',
    'public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint)',
    'public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint,text,text)',
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)',
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint,text,text)',
    'public.aka_agent_get_campaign_data_group_source(bigint,bigint,bigint)',
    'public.aka_agent_get_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)',
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)',
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer)',
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text)',
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer)',
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text,text)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'v219_smoke: missing RPC %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_campaign_runtime(bigint,bigint,bigint,text)',
    'public.aka_agent_set_zalo_server_campaign_status(bigint,bigint,text)',
    'public.aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)',
    'public.aka_agent_finalize_expired_zalo_server_data_group_campaigns(bigint,bigint,text,integer)',
    'public.aka_agent_internal_finalize_zalo_server_maintenance_guard(bigint,bigint,bigint,text,boolean,text)',
    'public.aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_function_definition;
    IF position('is_zalo_server' IN v_function_definition) = 0 THEN
      RAISE EXCEPTION 'v219_smoke: ownership guard missing from %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)',
    'public.append_control_campaign_inputs(bigint,bigint,bigint,text,integer,jsonb)',
    'public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)',
    'public.delete_control_campaign_atomic(bigint,bigint,bigint)',
    'public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)',
    'public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)',
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)',
    'public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_function_definition;
    IF position('is_zalo_server' IN v_function_definition) = 0
      OR position('is_zalo_show_web' IN v_function_definition) = 0
    THEN
      RAISE EXCEPTION 'v219_smoke: exact Server guard missing from %', v_signature;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)'
  )) INTO v_function_definition;
  IF position('aka_agent_internal_finalize_data_group_campaign_v219' IN v_function_definition) = 0
    OR position('aka_agent_internal_finalize_data_group_campaign_v219' IN v_function_definition)
      < position('FOR UPDATE OF campaign, account' IN v_function_definition)
  THEN
    RAISE EXCEPTION 'v219_smoke: Server Data Group wrapper does not delegate to the private core after ownership locks';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)'
  )) INTO v_function_definition;
  IF position('FOR UPDATE OF campaign, account' IN v_function_definition) = 0
    OR position('action_id = v_target_action_id' IN v_function_definition) = 0
    OR position('WHEN v_account_platform = ''zalo'' THEN campaign.status' IN v_function_definition) = 0
    OR position('campaign.updated_at IS NOT DISTINCT FROM p_expected_updated_at' IN v_function_definition) = 0
  THEN
    RAISE EXCEPTION 'v219_smoke: atomic control update hardening is incomplete';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_lock_campaign_input_serialization(bigint)'
  )) INTO v_function_definition;
  IF position('SECURITY DEFINER' IN v_function_definition) = 0
    OR position('pg_advisory_xact_lock' IN v_function_definition) = 0
    OR position('aka-agent-campaign-input-serialization:' IN v_function_definition) = 0
  THEN
    RAISE EXCEPTION 'v219_smoke: campaign/input serialization helper is incomplete';
  END IF;
  IF NOT has_function_privilege(
      'anon',
      'public.aka_agent_lock_campaign_input_serialization(bigint)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'authenticated',
      'public.aka_agent_lock_campaign_input_serialization(bigint)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.aka_agent_lock_campaign_input_serialization(bigint)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v219_smoke: campaign/input serialization helper runtime grants are missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) AS acl_entry
    WHERE routine.oid = to_regprocedure(
      'public.aka_agent_lock_campaign_input_serialization(bigint)'
    )
      AND acl_entry.grantee = 0
      AND acl_entry.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'v219_smoke: campaign/input serialization helper is exposed to PUBLIC';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
  )) INTO v_function_definition;
  IF position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) > 0
    OR position('aka_agent_snapshot_data_group_to_direct_campaign_v205_internal' IN v_function_definition) = 0
  THEN
    RAISE EXCEPTION 'v219_smoke: direct snapshot wrapper takes barrier before the preserved group lock';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
  )) INTO v_function_definition;
  IF position('direct_campaign_runtime_not_owner' IN v_function_definition) = 0
    OR position('is_zalo_server' IN v_function_definition) = 0
    OR position('SELECT contact_group.*' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
    OR position('SELECT campaign.*' IN v_function_definition) = 0
    OR position('FOR SHARE OF account' IN v_function_definition) = 0
    OR position(
      'FOR UPDATE;'
      IN substring(
        v_function_definition
        FROM position('SELECT contact_group.*' IN v_function_definition)
      )
    ) = 0
    OR position(
      'FOR UPDATE;'
      IN substring(
        v_function_definition
        FROM position('SELECT contact_group.*' IN v_function_definition)
      )
    ) > position(
      'aka_agent_lock_campaign_input_serialization'
      IN substring(
        v_function_definition
        FROM position('SELECT contact_group.*' IN v_function_definition)
      )
    )
    OR position(
      'aka_agent_lock_campaign_input_serialization'
      IN substring(
        v_function_definition
        FROM position('SELECT contact_group.*' IN v_function_definition)
      )
    ) > position(
      'SELECT campaign.*'
      IN substring(
        v_function_definition
        FROM position('SELECT contact_group.*' IN v_function_definition)
      )
    )
    OR position(
      'FOR UPDATE;'
      IN substring(
        v_function_definition
        FROM position('SELECT campaign.*' IN v_function_definition)
      )
    ) = 0
    OR position(
      'FOR UPDATE;'
      IN substring(
        v_function_definition
        FROM position('SELECT campaign.*' IN v_function_definition)
      )
    ) > position(
      'FOR SHARE OF account'
      IN substring(
        v_function_definition
        FROM position('SELECT campaign.*' IN v_function_definition)
      )
    )
  THEN
    RAISE EXCEPTION 'v219_smoke: direct snapshot core is not group/barrier/campaign/account ordered';
  END IF;
  IF has_function_privilege(
      'anon',
      'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v219_smoke: preserved direct snapshot core is callable as an RPC';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.reset_desktop_running_statuses(bigint,boolean,boolean)',
    'public.reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)',
    'public.recover_server_zalo_running_state(bigint,text,boolean)'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_function_definition;
    IF position('aka-agent-zalo-runtime-entitlement-mutation' IN v_function_definition) = 0
      OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
      OR position('ORDER BY campaign.id' IN v_function_definition) = 0
      OR position('UPDATE public.auto_campaign_input_data' IN v_function_definition) = 0
      OR position('aka-agent-zalo-runtime-entitlement-mutation' IN v_function_definition)
        > position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
        > position('UPDATE public.auto_campaign_input_data' IN v_function_definition)
    THEN
      RAISE EXCEPTION 'v219_smoke: recovery does not serialize campaigns deterministically before child locks in %', v_signature;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.materialize_auto_automation_detail(bigint,bigint,bigint,text,jsonb,text,text)'
  )) INTO v_function_definition;
  IF position('FOR UPDATE OF automation' IN v_function_definition) = 0
    OR position('FOR UPDATE OF detail' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
    OR position('materialize_auto_automation_detail_v188_serialized_internal' IN v_function_definition) = 0
    OR position('FOR UPDATE OF automation' IN v_function_definition)
      > position('FOR UPDATE OF detail' IN v_function_definition)
    OR position('FOR UPDATE OF detail' IN v_function_definition)
      > position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      > position('materialize_auto_automation_detail_v188_serialized_internal' IN v_function_definition)
  THEN
    RAISE EXCEPTION 'v219_smoke: v188 materializer is not automation/detail/barrier/delegate ordered';
  END IF;
  IF has_function_privilege(
      'anon',
      'public.materialize_auto_automation_detail_v188_serialized_internal(bigint,bigint,bigint,text,jsonb,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.materialize_auto_automation_detail_v188_serialized_internal(bigint,bigint,bigint,text,jsonb,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.materialize_auto_automation_detail_v188_serialized_internal(bigint,bigint,bigint,text,jsonb,text,text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v219_smoke: preserved v188 materializer core is callable as an RPC';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'
  )) INTO v_function_definition;
  IF position('aka_agent_data_group_membership_semantic_compatible' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
    OR position('aka_agent_internal_finalize_data_group_campaign_v219' IN v_function_definition) = 0
    OR position('campaign_hard_ended' IN v_function_definition) = 0
    OR position('aka_agent_internal_route_data_group_member_v205_internal' IN v_function_definition) = 0
    OR position('FOR UPDATE OF campaign' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      > position('FOR UPDATE OF campaign' IN v_function_definition)
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      > position('aka_agent_internal_route_data_group_member_v205_internal' IN v_function_definition)
  THEN
    RAISE EXCEPTION 'v219_smoke: legacy Data Group route is not serialized before delegation';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)'
  )) INTO v_function_definition;
  IF position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
    OR position('FOR UPDATE' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      > position('FOR UPDATE' IN v_function_definition)
  THEN
    RAISE EXCEPTION 'v219_smoke: internal Data Group finalizer locks rows before serialization';
  END IF;
  IF has_function_privilege(
      'anon',
      'public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v219_smoke: internal Data Group finalizer is callable as an RPC';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_finalize_data_group_campaign(bigint,bigint,bigint,text)'
  )) INTO v_function_definition;
  IF position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
    OR position('FOR UPDATE OF campaign, account' IN v_function_definition) = 0
    OR position('account.is_zalo_server' IN v_function_definition) = 0
    OR position('runtime_not_owner' IN v_function_definition) = 0
    OR position('aka_agent_internal_finalize_data_group_campaign_v219' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      > position('FOR UPDATE OF campaign, account' IN v_function_definition)
    OR position('aka_agent_internal_finalize_data_group_campaign_v219' IN v_function_definition)
      < position('FOR UPDATE OF campaign, account' IN v_function_definition)
  THEN
    RAISE EXCEPTION 'v219_smoke: legacy public Data Group finalizer is not Desktop-exact';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_finalize_expired_data_group_campaigns(bigint,bigint,integer)'
  )) INTO v_function_definition;
  IF position('COALESCE(account.is_zalo_server, false) = true' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
    OR position('FOR UPDATE OF campaign, account' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      > position('FOR UPDATE OF campaign, account' IN v_function_definition)
    OR position('FOR UPDATE OF campaign SKIP LOCKED' IN v_function_definition) > 0
  THEN
    RAISE EXCEPTION 'v219_smoke: desktop expired Data Group sweep ownership/serialization is incomplete';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_advance_zalo_server_multi_daily_slot(bigint,bigint,bigint,timestamptz)',
    'public.aka_agent_claim_zalo_server_run_unit(bigint,bigint,bigint,bigint[])',
    'public.aka_agent_finalize_zalo_server_campaign(bigint,bigint,text,boolean)',
    'public.aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)',
    'public.aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_function_definition;
    IF position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
      OR position('FOR UPDATE OF input_data' IN v_function_definition) = 0
      OR position('FOR UPDATE OF campaign, account' IN v_function_definition) = 0
      OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
        > position('FOR UPDATE OF input_data' IN v_function_definition)
      OR position('FOR UPDATE OF input_data' IN v_function_definition)
        > position('FOR UPDATE OF campaign, account' IN v_function_definition)
    THEN
      RAISE EXCEPTION 'v219_smoke: Server input lock order is not input/campaign/account in %', v_signature;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_internal_finalize_zalo_server_maintenance_guard(bigint,bigint,bigint,text,boolean,text)'
  )) INTO v_function_definition;
  IF position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
    OR position('FOR UPDATE OF input_data' IN v_function_definition) = 0
    OR position('FOR UPDATE OF campaign' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      > position('FOR UPDATE OF input_data' IN v_function_definition)
    OR position('FOR UPDATE OF input_data' IN v_function_definition)
      > position('FOR UPDATE OF campaign' IN v_function_definition)
  THEN
    RAISE EXCEPTION 'v219_smoke: maintenance guard does not lock input before campaign';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_finalize_expired_zalo_server_data_group_campaigns(bigint,bigint,text,integer)'
  )) INTO v_function_definition;
  IF position('aka_agent_finalize_zalo_server_data_group_campaign' IN v_function_definition) = 0
    OR position('FOR UPDATE OF campaign' IN v_function_definition) > 0
  THEN
    RAISE EXCEPTION 'v219_smoke: expired Data Group sweep bypasses input-first Server wrapper';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.claim_campaign_runtime(bigint,bigint,bigint,text)'
  )) INTO v_function_definition;
  IF position('aka_agent_finalize_zalo_server_data_group_campaign' IN v_function_definition) = 0
    OR position('aka_agent_finalize_data_group_campaign' IN v_function_definition) = 0
    OR position('aka_agent_finalize_zalo_server_data_group_campaign' IN v_function_definition)
      > position('FOR UPDATE OF campaign' IN v_function_definition)
    OR position('aka_agent_finalize_data_group_campaign' IN v_function_definition)
      > position('FOR UPDATE OF campaign' IN v_function_definition)
    OR position(
      'IF v_runtime_target = ''server'' THEN'
      IN substring(
        v_function_definition
        FROM position('IF v_campaign.data_target_source_mode' IN v_function_definition)
      )
    ) = 0
  THEN
    RAISE EXCEPTION 'v219_smoke: campaign claim can finalize Server Data Group after campaign lock';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)'
  )) INTO v_function_definition;
  IF position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
    OR position('FOR UPDATE OF input_data' IN v_function_definition) = 0
    OR position('FOR UPDATE OF campaign, account' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      > position('FOR UPDATE OF input_data' IN v_function_definition)
    OR position('FOR UPDATE OF input_data' IN v_function_definition)
      > position('FOR UPDATE OF campaign, account' IN v_function_definition)
    OR position('campaign_completed' IN v_function_definition) = 0
  THEN
    RAISE EXCEPTION 'v219_smoke: input-status RPC lock/final-state guard is incomplete';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.append_control_campaign_inputs(bigint,bigint,bigint,text,integer,jsonb)',
    'public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)',
    'public.delete_control_campaign_atomic(bigint,bigint,bigint)',
    'public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_function_definition;
    IF position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
      OR position('FOR UPDATE OF input_data' IN v_function_definition) = 0
      OR position('FOR UPDATE OF campaign, account' IN v_function_definition) = 0
      OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
        > position('FOR UPDATE OF input_data' IN v_function_definition)
      OR position('FOR UPDATE OF input_data' IN v_function_definition)
        > position('FOR UPDATE OF campaign, account' IN v_function_definition)
    THEN
      RAISE EXCEPTION 'v219_smoke: Control campaign/input serialization order is incomplete in %', v_signature;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)'
  )) INTO v_function_definition;
  IF (
      length(v_function_definition)
      - length(replace(
          v_function_definition,
          'aka_agent_lock_campaign_input_serialization',
          ''
        ))
    ) / length('aka_agent_lock_campaign_input_serialization') < 2
    OR position('FOR UPDATE OF campaign' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      > position('FOR UPDATE OF campaign' IN v_function_definition)
  THEN
    RAISE EXCEPTION 'v219_smoke: Data Group bind does not serialize bundle/direct campaigns before row locks';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)'
  )) INTO v_function_definition;
  IF position('aka_agent_lock_campaign_input_serialization' IN v_function_definition) = 0
    OR position('FOR UPDATE OF campaign, account' IN v_function_definition) = 0
    OR position('aka_agent_lock_campaign_input_serialization' IN v_function_definition)
      > position('FOR UPDATE OF campaign, account' IN v_function_definition)
  THEN
    RAISE EXCEPTION 'v219_smoke: Data Group reactivation locks campaign before serialization';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint,text,text)',
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint,text,text)',
    'public.aka_agent_get_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)',
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)',
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text,text)'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_function_definition;
    IF position('aka_agent.zalo_runtime_target' IN v_function_definition) = 0
      OR position('desktop' IN v_function_definition) = 0
    THEN
      RAISE EXCEPTION 'v219_smoke: desktop Data Group context missing from %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_finalize_zalo_server_campaign(bigint,bigint,text,boolean)',
    'public.aka_agent_advance_zalo_server_multi_daily_slot(bigint,bigint,bigint,timestamptz)',
    'public.aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)',
    'public.aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_function_definition;
    IF position('resolve_organization_zalo_account_capabilities' IN v_function_definition) > 0 THEN
      RAISE EXCEPTION 'v219_smoke: drain path still requires live capability in %', v_signature;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(to_regprocedure(
    'public.aka_agent_claim_zalo_server_run_unit(bigint,bigint,bigint,bigint[])'
  )) INTO v_function_definition;
  IF position('resolve_organization_zalo_account_capabilities' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'v219_smoke: new run-unit claims are not capability-gated';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.update_control_zalo_account_group_atomic(bigint,bigint,bigint,timestamptz,jsonb)',
    'public.delete_control_zalo_account_group_atomic(bigint,bigint,bigint)',
    'public.update_control_zalo_proxy_atomic(bigint,bigint,bigint,timestamptz,jsonb)',
    'public.delete_control_zalo_proxy_atomic(bigint,bigint,bigint)'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_signature))
    INTO v_function_definition;
    IF position('pg_advisory_xact_lock' IN v_function_definition) = 0
      OR position('FOR UPDATE OF' IN v_function_definition) = 0
    THEN
      RAISE EXCEPTION 'v219_smoke: atomic resource lock missing from %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)',
    'public.release_zalo_account_runtime_operation(bigint,bigint,text,text)',
    'public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)',
    'public.release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)',
    'public.materialize_auto_automation_detail(bigint,bigint,bigint,text,jsonb,text,text)',
    'public.aka_agent_finalize_data_group_campaign(bigint,bigint,bigint,text,text,text)'
  ] LOOP
    IF NOT has_function_privilege('anon', v_signature, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'v219_smoke: runtime-operation grant missing from %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)',
    'public.update_control_zalo_account_group_atomic(bigint,bigint,bigint,timestamptz,jsonb)',
    'public.delete_control_zalo_account_group_atomic(bigint,bigint,bigint)',
    'public.update_control_zalo_proxy_atomic(bigint,bigint,bigint,timestamptz,jsonb)',
    'public.delete_control_zalo_proxy_atomic(bigint,bigint,bigint)',
    'public.aka_agent_finalize_data_group_campaign(bigint,bigint,bigint,text)',
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)',
    'public.aka_agent_get_campaign_data_group_source(bigint,bigint,bigint)',
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer)'
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
      OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'v219_smoke: service-only RPC grants are wrong for %', v_signature;
    END IF;
  END LOOP;
END;
$preflight$;

-- A fresh migration.sql dump may still carry this abandoned global unique
-- index. Dropping it inside the rollback-only test allows an isolated Zalo row.
DROP INDEX IF EXISTS public.uq_active_subscription_per_org;

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_package_id bigint;
  v_action_id text;
  v_alternate_action_id text;
  v_sms_action_id text;
  v_entitlement_id bigint;
  v_local_account_id constant bigint := 8800219000000001;
  v_web_account_id constant bigint := 8800219000000002;
  v_server_account_id constant bigint := 8800219000000003;
  v_legacy_web_owner_id constant bigint := 8800219000000004;
  v_legacy_server_owner_id constant bigint := 8800219000000005;
  v_explicit_local_id constant bigint := 8800219000000006;
  v_inactive_account_id constant bigint := 8800219000000007;
  v_local_campaign_id constant bigint := 8800219000000010;
  v_server_campaign_id constant bigint := 8800219000000011;
  v_guard_campaign_id constant bigint := 8800219000000012;
  v_guard_input_data_id constant bigint := 8800219000000013;
  v_local_input_data_id constant bigint := 8800219000000014;
  v_server_input_data_id constant bigint := 8800219000000015;
  v_local_data_group_campaign_id constant bigint := 8800219000000016;
  v_server_data_group_campaign_id constant bigint := 8800219000000017;
  v_non_server_proxy_account_id constant bigint := 8800219000000018;
  v_sms_account_id constant bigint := 8800219000000019;
  v_sms_campaign_id constant bigint := 8800219000000020;
  v_sms_input_data_id constant bigint := 8800219000000021;
  v_created_account_id bigint;
  v_created_campaign_id bigint;
  v_data_group_id bigint;
  v_account_group_id bigint;
  v_proxy_id bigint;
  v_resource_updated_at timestamptz;
  v_expected_updated_at timestamptz;
  v_row_count bigint;
  v_claim_token constant uuid := '00000000-0000-4000-8000-000000000219'::uuid;
  v_wrong_claim_token constant uuid := '00000000-0000-4000-8000-000000000220'::uuid;
  v_capabilities record;
  v_legacy_mode record;
  v_staff_capabilities jsonb;
  v_old_discovery jsonb;
  v_new_discovery jsonb;
  v_result jsonb;
  v_previous_status text;
  v_control record;
  v_run_unit record;
  v_data_group_preflight record;
  v_rejected boolean;
  v_swept_local boolean;
  v_swept_server boolean;
  v_revision text;
BEGIN
  SELECT staff.id, staff.organization_id
  INTO v_staff_id, v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
  ORDER BY staff.id
  LIMIT 1
  FOR UPDATE OF staff;

  SELECT package.id INTO v_package_id
  FROM public.org_product_package AS package
  ORDER BY package.id
  LIMIT 1;

  SELECT action.id INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.id = 'zalo_message_friend'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  LIMIT 1;

  SELECT action.id INTO v_alternate_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.flatform_type = 'zalo'
    AND action.id <> v_action_id
    AND action.id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  ORDER BY action.id
  LIMIT 1;

  SELECT action.id INTO v_sms_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.id = 'sms_send'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  LIMIT 1;

  IF v_staff_id IS NULL OR v_package_id IS NULL
    OR v_action_id IS NULL OR v_alternate_action_id IS NULL
    OR v_sms_action_id IS NULL
  THEN
    RAISE NOTICE 'v219_smoke: active staff, package, two Zalo or SMS action missing; behavioral fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('aka-agent-v219-smoke-fixture', 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.auto_accounts
    WHERE id IN (
      v_local_account_id, v_web_account_id, v_server_account_id,
      v_legacy_web_owner_id, v_legacy_server_owner_id,
      v_explicit_local_id, v_inactive_account_id,
      v_non_server_proxy_account_id, v_sms_account_id
    )
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaigns
    WHERE id IN (
      v_local_campaign_id, v_server_campaign_id, v_guard_campaign_id,
      v_local_data_group_campaign_id, v_server_data_group_campaign_id,
      v_sms_campaign_id
    )
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data
    WHERE id IN (
      v_guard_input_data_id, v_local_input_data_id,
      v_server_input_data_id, v_sms_input_data_id
    )
  ) THEN
    RAISE EXCEPTION 'v219_smoke: reserved fixture ID collision';
  END IF;

  UPDATE public.org_organization_product
  SET is_deleted = true
  WHERE organization_id = v_organization_id
    AND product_id IN (16, 18);
  UPDATE public.auto_accounts
  SET is_delete = true
  WHERE staff_id = v_staff_id
    AND lower(btrim(COALESCE(flatform_type, ''))) = 'zalo';

  INSERT INTO public.org_organization_product (
    organization_id, product_package_id, product_id, product_name,
    package_name, package_type, max_accounts, max_sends_per_day,
    expiration_date, created_at, is_deleted, is_zalo_show_web, is_zalo_server
  ) VALUES (
    v_organization_id, v_package_id, 18, '__v219_zalo__',
    '__v219__', 'month', 3, 321,
    now() + interval '10 years', now() + interval '219 years',
    false, true, true
  ) RETURNING id INTO v_entitlement_id;

  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  SELECT * INTO v_legacy_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF v_capabilities.entitlement_id IS DISTINCT FROM v_entitlement_id
    OR v_capabilities.qr_enabled IS DISTINCT FROM true
    OR v_capabilities.web_enabled IS DISTINCT FROM true
    OR v_capabilities.server_enabled IS DISTINCT FROM true
    OR v_capabilities.max_accounts IS DISTINCT FROM 3
    OR v_capabilities.max_sends_per_day IS DISTINCT FROM 321
  THEN
    RAISE EXCEPTION 'v219_smoke: additive capability resolution mismatch: %', row_to_json(v_capabilities);
  END IF;
  IF v_legacy_mode.web_enabled IS DISTINCT FROM true
    OR v_legacy_mode.is_zalo_server IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'v219_smoke: legacy Web-over-Server mode changed: %', row_to_json(v_legacy_mode);
  END IF;
  v_revision := v_capabilities.capability_revision;

  v_staff_capabilities := public.get_staff_zalo_account_capabilities(v_staff_id);
  IF COALESCE((v_staff_capabilities->>'zalo_qr_enabled')::boolean, false) IS DISTINCT FROM true
    OR COALESCE((v_staff_capabilities->>'zalo_web_enabled')::boolean, false) IS DISTINCT FROM true
    OR COALESCE((v_staff_capabilities->>'zalo_server_enabled')::boolean, false) IS DISTINCT FROM true
    OR v_staff_capabilities->>'revision' IS DISTINCT FROM v_revision
  THEN
    RAISE EXCEPTION 'v219_smoke: staff additive payload mismatch: %', v_staff_capabilities;
  END IF;

  v_old_discovery := public.discover_zalo_server_runtime_users(0, 1000);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_old_discovery->'items') AS item
    WHERE (item->>'staff_id')::bigint = v_staff_id
  ) THEN
    RAISE EXCEPTION 'v219_smoke: legacy discovery stopped honoring Web precedence';
  END IF;
  v_new_discovery := public.discover_zalo_server_account_runtime_users(0, 1000);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_new_discovery->'items') AS item
    WHERE (item->>'staff_id')::bigint = v_staff_id
      AND (item->>'zalo_web_enabled')::boolean = true
      AND (item->>'zalo_server_enabled')::boolean = true
      AND item->>'mode_revision' = v_revision
  ) THEN
    RAISE EXCEPTION 'v219_smoke: additive Server discovery missed Web+Server staff: %', v_new_discovery;
  END IF;

  -- The same additive Server flag is accepted on both Product 16 and 18.
  UPDATE public.org_organization_product
  SET product_id = 16
  WHERE id = v_entitlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'v219_smoke: Product 16 Server capability update failed';
  END IF;
  UPDATE public.org_organization_product
  SET product_id = 18
  WHERE id = v_entitlement_id;

  -- Product flags are rejected outside Product 16/18.
  v_rejected := false;
  BEGIN
    INSERT INTO public.org_organization_product (
      organization_id, product_package_id, product_id, product_name,
      package_name, package_type, expiration_date, is_deleted, is_zalo_server
    ) VALUES (
      v_organization_id, v_package_id, 17, '__v219_invalid_product__',
      '__v219__', 'month', now() + interval '1 year', true, true
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: non-Zalo product accepted is_zalo_server=true';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_local_account_id, '__v219_local__', 'zalo', false, false,
      'đã đăng nhập', 'chờ xử lý', true, v_staff_id, v_organization_id, false),
    (v_web_account_id, '__v219_web__', 'zalo', true, false,
      'đã đăng nhập', 'chờ xử lý', true, v_staff_id, v_organization_id, false),
    (v_server_account_id, '__v219_server__', 'zalo', false, true,
      'đã đăng nhập', 'chờ xử lý', true, v_staff_id, v_organization_id, false);

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_sms_account_id, '__v219_sms__', 'sms', false, false,
    'chưa đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  -- Staff/organization reassignment is itself a capability/quota transition;
  -- it must not take the trigger's no-op early return.
  v_rejected := false;
  BEGIN
    UPDATE public.auto_accounts
    SET organization_id = v_organization_id + 8800219
    WHERE id = v_local_account_id;
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'zalo_account_organization_mismatch';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: organization reassignment bypassed account capability trigger';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE public.auto_accounts
    SET staff_id = 8800219000000999
    WHERE id = v_local_account_id;
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'zalo_account_staff_not_active';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: staff reassignment bypassed account capability trigger';
  END IF;

  -- Both product flags true means the legacy owner is Desktop/Web; an omitted
  -- account field must inherit false, while explicit false remains false.
  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web,
    login_status, status, is_active, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_legacy_web_owner_id, '__v219_legacy_web_owner__', 'zalo', false,
    'chưa đăng nhập', 'chờ xử lý', true, v_staff_id, v_organization_id, true
  );
  IF (SELECT is_zalo_server FROM public.auto_accounts WHERE id = v_legacy_web_owner_id) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v219_smoke: omitted insert did not inherit legacy Web/Desktop owner';
  END IF;

  UPDATE public.org_organization_product
  SET is_zalo_show_web = false
  WHERE id = v_entitlement_id;
  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web,
    login_status, status, is_active, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_legacy_server_owner_id, '__v219_legacy_server_owner__', 'zalo', false,
    'chưa đăng nhập', 'chờ xử lý', true, v_staff_id, v_organization_id, true
  );
  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_explicit_local_id, '__v219_explicit_local__', 'zalo', false, false,
    'chưa đăng nhập', 'chờ xử lý', true, v_staff_id, v_organization_id, true
  );
  IF (SELECT is_zalo_server FROM public.auto_accounts WHERE id = v_legacy_server_owner_id) IS DISTINCT FROM true
    OR (SELECT is_zalo_server FROM public.auto_accounts WHERE id = v_explicit_local_id) IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'v219_smoke: omitted and explicit-false inserts were not distinguished';
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO public.auto_accounts (
      name, flatform_type, is_zalo_show_web, is_zalo_server,
      login_status, status, is_active, staff_id, organization_id, is_delete
    ) VALUES (
      '__v219_invalid_both__', 'zalo', true, true,
      'chưa đăng nhập', 'chờ xử lý', true, v_staff_id, v_organization_id, true
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'v219_smoke: Web+Server account was accepted'; END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO public.auto_accounts (
      name, flatform_type, is_zalo_show_web, is_zalo_server,
      login_status, status, is_active, staff_id, organization_id, is_delete
    ) VALUES (
      '__v219_invalid_platform__', 'facebook', false, true,
      'chưa đăng nhập', 'chờ xử lý', true, v_staff_id, v_organization_id, true
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'v219_smoke: non-Zalo Server account was accepted'; END IF;

  -- Web is now hidden, but all three non-deleted subtype rows still consume
  -- the shared quota and must block Server-control creation.
  v_result := public.create_control_zalo_account_atomic(
    v_staff_id, v_organization_id, 999,
    jsonb_build_object('name', '__v219_quota_blocked__', 'isActive', true)
  );
  IF COALESCE((v_result->>'created')::boolean, false)
    OR v_result->>'reason' IS DISTINCT FROM 'account_limit_reached'
  THEN
    RAISE EXCEPTION 'v219_smoke: hidden subtype did not consume shared quota: %', v_result;
  END IF;

  -- Desktop/direct inserts share the same live, advisory-locked quota guard as
  -- the control RPC; cached client-side counts cannot bypass it.
  v_rejected := false;
  BEGIN
    INSERT INTO public.auto_accounts (
      name, flatform_type, is_zalo_show_web, is_zalo_server,
      login_status, status, is_active, staff_id, organization_id, is_delete
    ) VALUES (
      '__v219_direct_quota_blocked__', 'zalo', false, false,
      'chưa đăng nhập', 'chờ xử lý', true, v_staff_id, v_organization_id, false
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'zalo_account_limit_reached';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: direct Zalo insert bypassed shared quota';
  END IF;

  UPDATE public.auto_accounts SET is_delete = true WHERE id = v_local_account_id;
  v_result := public.create_control_zalo_account_atomic(
    v_staff_id, v_organization_id, 999,
    jsonb_build_object(
      'name', '__v219_control_server__',
      'isActive', true,
      'isZaloShowWeb', true,
      'isZaloServer', false
    )
  );
  IF NOT COALESCE((v_result->>'created')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: control create failed below shared quota: %', v_result;
  END IF;
  v_created_account_id := (v_result->>'account_id')::bigint;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_accounts
    WHERE id = v_created_account_id
      AND is_zalo_show_web = false
      AND is_zalo_server = true
  ) THEN
    RAISE EXCEPTION 'v219_smoke: control payload overrode authoritative Server subtype';
  END IF;
  UPDATE public.auto_accounts SET is_delete = true WHERE id = v_created_account_id;
  UPDATE public.auto_accounts SET is_delete = false WHERE id = v_local_account_id;
  UPDATE public.org_organization_product
  SET is_zalo_show_web = true, max_accounts = 10
  WHERE id = v_entitlement_id;

  -- Raw/legacy subtype writes fail closed before taking a staff lock. The
  -- tokenized CAS still revalidates its destination from the live entitlement,
  -- not a cached desktop payload.
  v_result := public.claim_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', false
  );
  IF NOT COALESCE((v_result->>'claimed')::boolean, false)
    OR v_result->>'previous_status' IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v219_smoke: legacy subtype claim setup failed: %', v_result;
  END IF;
  v_rejected := false;
  BEGIN
    -- v218 restored the previous status in the same non-token subtype UPDATE.
    UPDATE public.auto_accounts
    SET is_zalo_server = true, status = 'chờ xử lý'
    WHERE id = v_local_account_id
      AND status = 'đang chạy';
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'zalo_account_subtype_change_claim_required';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: legacy claimed subtype conversion did not fail closed';
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', 'chờ xử lý'
  ) THEN
    RAISE EXCEPTION 'v219_smoke: legacy release did not restore rejected subtype claim';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE public.auto_accounts
    SET is_zalo_server = true
    WHERE id = v_local_account_id;
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'zalo_account_subtype_change_claim_required';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: unclaimed Server conversion did not fail closed';
  END IF;

  UPDATE public.org_organization_product
  SET is_zalo_server = false
  WHERE id = v_entitlement_id;
  v_result := public.claim_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', 'chờ xử lý',
    v_claim_token, false
  );
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Server capability CAS claim failed: %', v_result;
  END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.auto_accounts
    SET is_zalo_server = true
    WHERE id = v_local_account_id
      AND status = 'đang chạy'
      AND runtime_operation_claim_token = v_claim_token;
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'zalo_account_capability_unavailable';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: claimed Server conversion ignored live capability';
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', 'chờ xử lý', v_claim_token
  ) THEN
    RAISE EXCEPTION 'v219_smoke: failed to release rejected Server conversion';
  END IF;
  UPDATE public.org_organization_product
  SET is_zalo_server = true
  WHERE id = v_entitlement_id;

  UPDATE public.org_organization_product
  SET is_zalo_show_web = false
  WHERE id = v_entitlement_id;
  v_result := public.claim_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', 'chờ xử lý',
    v_claim_token, false
  );
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Web capability CAS claim failed: %', v_result;
  END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.auto_accounts
    SET is_zalo_show_web = true
    WHERE id = v_local_account_id
      AND status = 'đang chạy'
      AND runtime_operation_claim_token = v_claim_token;
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'zalo_account_capability_unavailable';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: claimed Web conversion ignored live capability';
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', 'chờ xử lý', v_claim_token
  ) THEN
    RAISE EXCEPTION 'v219_smoke: failed to release rejected Web conversion';
  END IF;
  UPDATE public.org_organization_product
  SET is_zalo_show_web = true
  WHERE id = v_entitlement_id;

  SELECT capabilities.capability_revision INTO v_revision
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id) AS capabilities;

  -- Resource assignment and Web mutation share one advisory-lock namespace.
  -- A local-only group/proxy cannot be guessed into a Server account, while a
  -- Server-only resource remains editable with optimistic CAS.
  INSERT INTO public.auto_account_groups (
    name, flatform_type, settings, is_active, is_delete,
    staff_id, organization_id
  ) VALUES (
    '__v219_account_group__', 'zalo', '{}'::jsonb, true, false,
    v_staff_id, v_organization_id
  ) RETURNING id, updated_at INTO v_account_group_id, v_resource_updated_at;
  INSERT INTO public.auto_proxies (
    name, protocol, host, port, is_active, is_delete,
    staff_id, organization_id
  ) VALUES (
    '__v219_proxy__', 'http', '127.0.0.1', 8219, true, false,
    v_staff_id, v_organization_id
  ) RETURNING id INTO v_proxy_id;

  UPDATE public.auto_accounts
  SET account_group_id = v_account_group_id,
      proxy_id = v_proxy_id
  WHERE id = v_local_account_id;

  v_result := public.create_control_zalo_account_atomic(
    v_staff_id, v_organization_id, 999,
    jsonb_build_object(
      'name', '__v219_group_local_only__',
      'accountGroupId', v_account_group_id
    )
  );
  IF v_result->>'reason' IS DISTINCT FROM 'account_group_local_only' THEN
    RAISE EXCEPTION 'v219_smoke: Server create accepted local-only group: %', v_result;
  END IF;
  v_result := public.create_control_zalo_account_atomic(
    v_staff_id, v_organization_id, 999,
    jsonb_build_object(
      'name', '__v219_proxy_local_only__',
      'proxyId', v_proxy_id
    )
  );
  IF v_result->>'reason' IS DISTINCT FROM 'proxy_local_only' THEN
    RAISE EXCEPTION 'v219_smoke: Server create accepted local-only proxy: %', v_result;
  END IF;

  SELECT updated_at INTO v_resource_updated_at
  FROM public.auto_account_groups
  WHERE id = v_account_group_id;
  v_result := public.update_control_zalo_account_group_atomic(
    v_staff_id, v_organization_id, v_account_group_id,
    v_resource_updated_at, jsonb_build_object('name', '__v219_rejected_group__')
  );
  IF v_result->>'reason' IS DISTINCT FROM 'account_group_used_by_local_zalo' THEN
    RAISE EXCEPTION 'v219_smoke: atomic group update accepted local Zalo usage: %', v_result;
  END IF;
  SELECT updated_at INTO v_resource_updated_at
  FROM public.auto_proxies
  WHERE id = v_proxy_id;
  v_result := public.update_control_zalo_proxy_atomic(
    v_staff_id, v_organization_id, v_proxy_id,
    v_resource_updated_at, jsonb_build_object('name', '__v219_rejected_proxy__')
  );
  IF v_result->>'reason' IS DISTINCT FROM 'proxy_used_by_non_server_account' THEN
    RAISE EXCEPTION 'v219_smoke: atomic proxy update accepted local Zalo usage: %', v_result;
  END IF;

  UPDATE public.auto_accounts
  SET account_group_id = v_account_group_id,
      proxy_id = v_proxy_id
  WHERE id = v_server_account_id;

  -- Legacy account groups shared by Server+Local can still be assigned to a
  -- new Server account, but Web mutation remains blocked while Local uses it.
  v_result := public.create_control_zalo_account_atomic(
    v_staff_id, v_organization_id, 999,
    jsonb_build_object(
      'name', '__v219_shared_group_server__',
      'accountGroupId', v_account_group_id
    )
  );
  IF NOT COALESCE((v_result->>'created')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: shared legacy group was not assignable to Server: %', v_result;
  END IF;
  v_created_account_id := (v_result->>'account_id')::bigint;
  UPDATE public.auto_accounts SET is_delete = true WHERE id = v_created_account_id;

  v_result := public.create_control_zalo_account_atomic(
    v_staff_id, v_organization_id, 999,
    jsonb_build_object(
      'name', '__v219_shared_proxy_server__',
      'proxyId', v_proxy_id
    )
  );
  IF NOT COALESCE((v_result->>'created')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: shared legacy proxy was not assignable to Server: %', v_result;
  END IF;
  v_created_account_id := (v_result->>'account_id')::bigint;
  UPDATE public.auto_accounts SET is_delete = true WHERE id = v_created_account_id;

  UPDATE public.auto_accounts
  SET account_group_id = NULL, proxy_id = NULL
  WHERE id = v_local_account_id;

  SELECT updated_at INTO v_resource_updated_at
  FROM public.auto_account_groups
  WHERE id = v_account_group_id;
  v_result := public.update_control_zalo_account_group_atomic(
    v_staff_id, v_organization_id, v_account_group_id,
    v_resource_updated_at,
    jsonb_build_object('name', '__v219_account_group_edited__', 'isActive', false)
  );
  IF NOT COALESCE((v_result->>'updated')::boolean, false)
    OR v_result->'row'->>'name' IS DISTINCT FROM '__v219_account_group_edited__'
  THEN
    RAISE EXCEPTION 'v219_smoke: atomic group update rejected Server-only usage: %', v_result;
  END IF;
  v_result := public.update_control_zalo_account_group_atomic(
    v_staff_id, v_organization_id, v_account_group_id,
    v_resource_updated_at - interval '1 second',
    jsonb_build_object('name', '__v219_stale_group__')
  );
  IF v_result->>'reason' IS DISTINCT FROM 'version_conflict' THEN
    RAISE EXCEPTION 'v219_smoke: group update CAS accepted stale version: %', v_result;
  END IF;

  SELECT updated_at INTO v_resource_updated_at
  FROM public.auto_proxies
  WHERE id = v_proxy_id;
  v_result := public.update_control_zalo_proxy_atomic(
    v_staff_id, v_organization_id, v_proxy_id,
    v_resource_updated_at,
    jsonb_build_object('name', '__v219_proxy_edited__', 'isActive', false)
  );
  IF NOT COALESCE((v_result->>'updated')::boolean, false)
    OR v_result->'row'->>'name' IS DISTINCT FROM '__v219_proxy_edited__'
  THEN
    RAISE EXCEPTION 'v219_smoke: atomic proxy update rejected Server-only usage: %', v_result;
  END IF;
  v_result := public.update_control_zalo_proxy_atomic(
    v_staff_id, v_organization_id, v_proxy_id,
    v_resource_updated_at - interval '1 second',
    jsonb_build_object('name', '__v219_stale_proxy__')
  );
  IF v_result->>'reason' IS DISTINCT FROM 'version_conflict' THEN
    RAISE EXCEPTION 'v219_smoke: proxy update CAS accepted stale version: %', v_result;
  END IF;

  v_result := public.delete_control_zalo_account_group_atomic(
    v_staff_id, v_organization_id, v_account_group_id
  );
  IF v_result->>'reason' IS DISTINCT FROM 'account_group_in_use' THEN
    RAISE EXCEPTION 'v219_smoke: group delete ignored Server usage: %', v_result;
  END IF;
  v_result := public.delete_control_zalo_proxy_atomic(
    v_staff_id, v_organization_id, v_proxy_id
  );
  IF v_result->>'reason' IS DISTINCT FROM 'proxy_in_use' THEN
    RAISE EXCEPTION 'v219_smoke: proxy delete ignored Server usage: %', v_result;
  END IF;

  UPDATE public.auto_accounts
  SET account_group_id = NULL, proxy_id = NULL
  WHERE id = v_server_account_id;
  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active, proxy_id,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_non_server_proxy_account_id, '__v219_facebook_proxy__', 'facebook', false, false,
    'chưa đăng nhập', 'chờ xử lý', true, v_proxy_id,
    v_staff_id, v_organization_id, false
  );
  SELECT updated_at INTO v_resource_updated_at
  FROM public.auto_proxies
  WHERE id = v_proxy_id;
  v_result := public.update_control_zalo_proxy_atomic(
    v_staff_id, v_organization_id, v_proxy_id,
    v_resource_updated_at, jsonb_build_object('name', '__v219_facebook_proxy_rejected__')
  );
  IF v_result->>'reason' IS DISTINCT FROM 'proxy_used_by_non_server_account' THEN
    RAISE EXCEPTION 'v219_smoke: proxy update ignored Facebook usage: %', v_result;
  END IF;
  UPDATE public.auto_accounts
  SET is_delete = true
  WHERE id = v_non_server_proxy_account_id;

  v_result := public.delete_control_zalo_account_group_atomic(
    v_staff_id, v_organization_id, v_account_group_id
  );
  IF NOT COALESCE((v_result->>'deleted')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: empty group delete failed: %', v_result;
  END IF;
  v_result := public.delete_control_zalo_proxy_atomic(
    v_staff_id, v_organization_id, v_proxy_id
  );
  IF NOT COALESCE((v_result->>'deleted')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: empty proxy delete failed: %', v_result;
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE public.auto_accounts
    SET account_group_id = v_account_group_id
    WHERE id = v_local_account_id;
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'account_group_not_found';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: account attached a soft-deleted group after lock';
  END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.auto_accounts
    SET proxy_id = v_proxy_id
    WHERE id = v_local_account_id;
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'proxy_not_found';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: account attached a soft-deleted proxy after lock';
  END IF;

  -- Additive Server ownership remains live even though the legacy resolver is
  -- Web/Desktop. Account subtype, not organization mode, decides each claim.
  v_result := public.claim_zalo_account_runtime_operation(
    v_server_account_id, v_staff_id, 'server', true
  );
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Server failed to claim Server subtype beside Web: %', v_result;
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(
    v_server_account_id, v_staff_id, 'server', 'chờ xử lý'
  ) THEN RAISE EXCEPTION 'v219_smoke: Server failed to release Server subtype'; END IF;

  v_result := public.claim_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'server', true
  );
  IF COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Server claimed QR-local subtype';
  END IF;
  v_result := public.claim_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', true
  );
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Desktop failed to claim QR-local subtype: %', v_result;
  END IF;
  PERFORM public.release_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', 'chờ xử lý'
  );
  v_result := public.claim_zalo_account_runtime_operation(
    v_web_account_id, v_staff_id, 'desktop', true
  );
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Desktop failed to claim Web-local subtype: %', v_result;
  END IF;
  PERFORM public.release_zalo_account_runtime_operation(
    v_web_account_id, v_staff_id, 'desktop', 'chờ xử lý'
  );
  v_result := public.claim_zalo_account_runtime_operation(
    v_server_account_id, v_staff_id, 'desktop', true
  );
  IF COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Desktop claimed Server subtype';
  END IF;

  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_account_status(
    v_server_account_id, v_staff_id, 'tạm dừng'
  );
  IF NOT COALESCE(v_control.ok, false) THEN
    RAISE EXCEPTION 'v219_smoke: Server run-control rejected Server subtype beside Web';
  END IF;
  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_account_status(
    v_local_account_id, v_staff_id, 'tạm dừng'
  );
  IF COALESCE(v_control.ok, false) THEN
    RAISE EXCEPTION 'v219_smoke: Server run-control changed local subtype';
  END IF;
  UPDATE public.auto_accounts SET status = 'chờ xử lý' WHERE id = v_server_account_id;

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_local_campaign_id, '__v219_local_campaign__', v_action_id,
      v_local_account_id, 'chờ xử lý', '', now() - interval '1 minute',
      now() - interval '1 minute', 'direct', v_staff_id, v_organization_id, false),
    (v_server_campaign_id, '__v219_server_campaign__', v_action_id,
      v_server_account_id, 'chờ xử lý', '', now() - interval '1 minute',
      now() - interval '1 minute', 'direct', v_staff_id, v_organization_id, false),
    (v_local_data_group_campaign_id, '__v219_local_data_group__', v_action_id,
      v_local_account_id, 'chờ xử lý', '', now() - interval '1 minute',
      now() - interval '1 minute', 'direct', v_staff_id, v_organization_id, false),
    (v_server_data_group_campaign_id, '__v219_server_data_group__', v_action_id,
      v_server_account_id, 'chờ xử lý', '', now() - interval '1 minute',
      now() - interval '1 minute', 'direct', v_staff_id, v_organization_id, false),
    (v_sms_campaign_id, '__v219_sms_campaign__', v_sms_action_id,
      v_sms_account_id, 'chờ xử lý', '', now() - interval '1 minute',
      now() - interval '1 minute', 'direct', v_staff_id, v_organization_id, false);

  INSERT INTO public.auto_campaign_input_data (
    id, campaign_id, uid, status, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_local_input_data_id, v_local_campaign_id, '__v219_local_input__', 'chờ xử lý', false),
    (v_server_input_data_id, v_server_campaign_id, '__v219_server_input__', 'chờ xử lý', false),
    (v_sms_input_data_id, v_sms_campaign_id, '__v219_sms_input__', 'chờ xử lý', false);

  -- Authoritative Control Web functions reject local Zalo even if the caller
  -- passed every earlier API preflight, while the exact Server subtype remains
  -- editable. Zalo metadata edits preserve lifecycle status.
  v_rejected := false;
  BEGIN
    PERFORM public.create_control_campaign(
      v_staff_id,
      v_organization_id,
      '__v219_create_local__' || v_staff_id::text,
      jsonb_build_object(
        'name', '__v219_control_local__',
        'accountId', v_local_account_id,
        'actionId', v_action_id
      ),
      '[]'::jsonb
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'control_account_not_found';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: Control create accepted local Zalo';
  END IF;

  v_result := public.create_control_campaign(
    v_staff_id,
    v_organization_id,
    '__v219_create_server__' || v_staff_id::text,
    jsonb_build_object(
      'name', '__v219_control_server_campaign__',
      'accountId', v_server_account_id,
      'actionId', v_action_id
    ),
    '[]'::jsonb
  );
  IF NOT COALESCE((v_result->>'created')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Control create rejected Server Zalo: %', v_result;
  END IF;
  v_created_campaign_id := (v_result->>'campaign_id')::bigint;
  v_result := public.delete_control_campaign_atomic(
    v_staff_id, v_organization_id, v_created_campaign_id
  );
  IF NOT COALESCE((v_result->>'deleted')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Control delete rejected Server Zalo: %', v_result;
  END IF;
  v_result := public.delete_control_campaign_atomic(
    v_staff_id, v_organization_id, v_local_campaign_id
  );
  IF v_result->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'v219_smoke: Control delete exposed local Zalo: %', v_result;
  END IF;

  SELECT updated_at INTO v_expected_updated_at
  FROM public.auto_campaigns
  WHERE id = v_server_campaign_id;
  v_result := public.update_control_campaign_atomic(
    v_staff_id,
    v_organization_id,
    v_server_campaign_id,
    v_expected_updated_at,
    jsonb_build_object(
      'name', '__v219_server_campaign_edited__',
      'action_id', v_alternate_action_id,
      'status', 'hoàn thành'
    )
  );
  IF NOT COALESCE((v_result->>'updated')::boolean, false)
    OR (SELECT name FROM public.auto_campaigns WHERE id = v_server_campaign_id)
      IS DISTINCT FROM '__v219_server_campaign_edited__'
    OR (SELECT action_id FROM public.auto_campaigns WHERE id = v_server_campaign_id)
      IS DISTINCT FROM v_alternate_action_id
    OR (SELECT status FROM public.auto_campaigns WHERE id = v_server_campaign_id)
      IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v219_smoke: Server metadata edit/action/status contract mismatch: %', v_result;
  END IF;

  SELECT updated_at INTO v_expected_updated_at
  FROM public.auto_campaigns
  WHERE id = v_server_campaign_id;
  v_rejected := false;
  BEGIN
    PERFORM public.update_control_campaign_atomic(
      v_staff_id,
      v_organization_id,
      v_server_campaign_id,
      v_expected_updated_at,
      jsonb_build_object('account_id', v_local_account_id)
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'control_account_not_found';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: atomic update accepted local target account';
  END IF;

  SELECT updated_at INTO v_expected_updated_at
  FROM public.auto_campaigns
  WHERE id = v_local_campaign_id;
  v_result := public.update_control_campaign_atomic(
    v_staff_id,
    v_organization_id,
    v_local_campaign_id,
    v_expected_updated_at,
    jsonb_build_object('name', '__v219_local_campaign_bypass__')
  );
  IF v_result->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'v219_smoke: atomic update exposed local Zalo: %', v_result;
  END IF;

  v_result := public.update_control_campaign_input_statuses_atomic(
    v_staff_id, v_organization_id, v_local_campaign_id,
    ARRAY[v_local_input_data_id], 'tạm dừng', NULL
  );
  IF v_result->>'reason' IS DISTINCT FROM 'account_not_server' THEN
    RAISE EXCEPTION 'v219_smoke: input-status RPC accepted local Zalo: %', v_result;
  END IF;
  v_result := public.update_control_campaign_input_statuses_atomic(
    v_staff_id, v_organization_id, v_server_campaign_id,
    ARRAY[v_server_input_data_id], 'tạm dừng', NULL
  );
  IF NOT COALESCE((v_result->>'updated')::boolean, false)
    OR COALESCE((v_result->>'updated_count')::integer, 0) <> 1
    OR (SELECT status FROM public.auto_campaign_input_data WHERE id = v_server_input_data_id)
      IS DISTINCT FROM 'tạm dừng'
  THEN
    RAISE EXCEPTION 'v219_smoke: input-status RPC rejected Server Zalo: %', v_result;
  END IF;
  PERFORM public.update_control_campaign_input_statuses_atomic(
    v_staff_id, v_organization_id, v_server_campaign_id,
    ARRAY[v_server_input_data_id], 'chờ xử lý', NULL
  );

  -- A finalizer that wins the same input-first lock chain leaves a completed
  -- campaign terminal; a delayed/manual resume cannot recreate pending work.
  UPDATE public.auto_campaign_input_data
  SET status = 'tạm dừng'
  WHERE id = v_server_input_data_id;
  UPDATE public.auto_campaigns
  SET status = 'hoàn thành'
  WHERE id = v_server_campaign_id;
  v_result := public.update_control_campaign_input_statuses_atomic(
    v_staff_id, v_organization_id, v_server_campaign_id,
    ARRAY[v_server_input_data_id], 'chờ xử lý', NULL
  );
  IF v_result->>'reason' IS DISTINCT FROM 'campaign_completed'
    OR (SELECT status FROM public.auto_campaign_input_data WHERE id = v_server_input_data_id)
      IS DISTINCT FROM 'tạm dừng'
  THEN
    RAISE EXCEPTION 'v219_smoke: completed Server campaign was reopened by input resume: %', v_result;
  END IF;
  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý'
  WHERE id = v_server_campaign_id;
  UPDATE public.auto_campaign_input_data
  SET status = 'chờ xử lý'
  WHERE id = v_server_input_data_id;

  v_result := public.append_control_campaign_inputs(
    v_staff_id, v_organization_id, v_local_campaign_id,
    '__v219_append_local__' || v_staff_id::text, 1,
    jsonb_build_array(jsonb_build_object('uid', '__v219_rejected__'))
  );
  IF v_result->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'v219_smoke: append exposed local Zalo: %', v_result;
  END IF;
  v_result := public.append_control_campaign_inputs(
    v_staff_id, v_organization_id, v_server_campaign_id,
    '__v219_append_server__' || v_staff_id::text, 1,
    jsonb_build_array(jsonb_build_object('uid', '__v219_appended__'))
  );
  IF NOT COALESCE((v_result->>'created')::boolean, false)
    OR COALESCE((v_result->>'inserted')::integer, 0) <> 1
  THEN
    RAISE EXCEPTION 'v219_smoke: append rejected Server Zalo: %', v_result;
  END IF;
  v_result := public.add_control_campaign_input_rows(
    v_staff_id, v_organization_id, v_local_campaign_id,
    '__v219_add_local__' || v_staff_id::text, 1,
    jsonb_build_array(jsonb_build_object('uid', '__v219_rejected__')),
    now(), 'chờ xử lý'
  );
  IF v_result->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'v219_smoke: add-input exposed local Zalo: %', v_result;
  END IF;

  -- Recheck every mutation after the same account changes QR -> Web; the
  -- guard is the exact Server tuple, not merely `flatform_type = zalo`.
  SELECT status INTO v_previous_status
  FROM public.auto_accounts
  WHERE id = v_local_account_id;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'v219_smoke: local account is not idle before Web conversion';
  END IF;
  v_result := public.claim_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', v_previous_status,
    v_claim_token, false
  );
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: QR-to-Web claim failed: %', v_result;
  END IF;
  UPDATE public.auto_accounts
  SET is_zalo_show_web = true
  WHERE id = v_local_account_id
    AND status = 'đang chạy'
    AND runtime_operation_claim_token = v_claim_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'v219_smoke: QR-to-Web subtype CAS failed';
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', v_previous_status, v_claim_token
  ) THEN
    RAISE EXCEPTION 'v219_smoke: QR-to-Web release failed';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.create_control_campaign(
      v_staff_id,
      v_organization_id,
      '__v219_create_web_local__' || v_staff_id::text,
      jsonb_build_object(
        'name', '__v219_control_web_local__',
        'accountId', v_local_account_id,
        'actionId', v_action_id
      ),
      '[]'::jsonb
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'control_account_not_found';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: Control create accepted Web-local Zalo';
  END IF;
  SELECT updated_at INTO v_expected_updated_at
  FROM public.auto_campaigns
  WHERE id = v_local_campaign_id;
  v_result := public.update_control_campaign_atomic(
    v_staff_id, v_organization_id, v_local_campaign_id,
    v_expected_updated_at, jsonb_build_object('name', '__v219_web_bypass__')
  );
  IF v_result->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'v219_smoke: atomic update accepted Web-local Zalo: %', v_result;
  END IF;
  v_result := public.append_control_campaign_inputs(
    v_staff_id, v_organization_id, v_local_campaign_id,
    '__v219_append_web_local__' || v_staff_id::text, 1,
    jsonb_build_array(jsonb_build_object('uid', '__v219_rejected__'))
  );
  IF v_result->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'v219_smoke: append accepted Web-local Zalo: %', v_result;
  END IF;
  v_result := public.add_control_campaign_input_rows(
    v_staff_id, v_organization_id, v_local_campaign_id,
    '__v219_add_web_local__' || v_staff_id::text, 1,
    jsonb_build_array(jsonb_build_object('uid', '__v219_rejected__')),
    now(), 'chờ xử lý'
  );
  IF v_result->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'v219_smoke: add-input accepted Web-local Zalo: %', v_result;
  END IF;
  v_result := public.delete_control_campaign_atomic(
    v_staff_id, v_organization_id, v_local_campaign_id
  );
  IF v_result->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'v219_smoke: delete accepted Web-local Zalo: %', v_result;
  END IF;
  v_result := public.claim_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', v_previous_status,
    v_claim_token, false
  );
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Web-to-QR claim failed: %', v_result;
  END IF;
  UPDATE public.auto_accounts
  SET is_zalo_show_web = false
  WHERE id = v_local_account_id
    AND status = 'đang chạy'
    AND runtime_operation_claim_token = v_claim_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'v219_smoke: Web-to-QR subtype CAS failed';
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(
    v_local_account_id, v_staff_id, 'desktop', v_previous_status, v_claim_token
  ) THEN
    RAISE EXCEPTION 'v219_smoke: Web-to-QR release failed';
  END IF;

  -- SMS keeps the v165/v166 contract: metadata status is editable and the
  -- same atomic input/create/delete surfaces remain available.
  SELECT updated_at INTO v_expected_updated_at
  FROM public.auto_campaigns
  WHERE id = v_sms_campaign_id;
  v_result := public.update_control_campaign_atomic(
    v_staff_id,
    v_organization_id,
    v_sms_campaign_id,
    v_expected_updated_at,
    jsonb_build_object('name', '__v219_sms_edited__', 'status', 'tạm dừng')
  );
  IF NOT COALESCE((v_result->>'updated')::boolean, false)
    OR (SELECT status FROM public.auto_campaigns WHERE id = v_sms_campaign_id)
      IS DISTINCT FROM 'tạm dừng'
  THEN
    RAISE EXCEPTION 'v219_smoke: SMS metadata/status contract regressed: %', v_result;
  END IF;
  v_result := public.update_control_campaign_input_statuses_atomic(
    v_staff_id, v_organization_id, v_sms_campaign_id,
    ARRAY[v_sms_input_data_id], 'tạm dừng', NULL
  );
  IF NOT COALESCE((v_result->>'updated')::boolean, false)
    OR COALESCE((v_result->>'updated_count')::integer, 0) <> 1
  THEN
    RAISE EXCEPTION 'v219_smoke: SMS input-status contract regressed: %', v_result;
  END IF;
  PERFORM public.update_control_campaign_input_statuses_atomic(
    v_staff_id, v_organization_id, v_sms_campaign_id,
    ARRAY[v_sms_input_data_id], 'chờ xử lý', NULL
  );
  v_result := public.append_control_campaign_inputs(
    v_staff_id, v_organization_id, v_sms_campaign_id,
    '__v219_append_sms__' || v_staff_id::text, 1,
    jsonb_build_array(jsonb_build_object('phone', '0900000219'))
  );
  IF NOT COALESCE((v_result->>'created')::boolean, false)
    OR COALESCE((v_result->>'inserted')::integer, 0) <> 1
  THEN
    RAISE EXCEPTION 'v219_smoke: SMS append contract regressed: %', v_result;
  END IF;
  v_result := public.add_control_campaign_input_rows(
    v_staff_id, v_organization_id, v_sms_campaign_id,
    '__v219_add_sms__' || v_staff_id::text, 2,
    jsonb_build_array(jsonb_build_object('phone', '0900000220')),
    now(), 'chờ xử lý'
  );
  IF NOT COALESCE((v_result->>'created')::boolean, false)
    OR COALESCE((v_result->>'inserted')::integer, 0) <> 1
  THEN
    RAISE EXCEPTION 'v219_smoke: SMS add-input contract regressed: %', v_result;
  END IF;
  v_result := public.create_control_campaign(
    v_staff_id,
    v_organization_id,
    '__v219_create_sms__' || v_staff_id::text,
    jsonb_build_object(
      'name', '__v219_control_sms__',
      'accountId', v_sms_account_id,
      'actionId', v_sms_action_id
    ),
    '[]'::jsonb
  );
  IF NOT COALESCE((v_result->>'created')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Control create rejected SMS: %', v_result;
  END IF;
  v_created_campaign_id := (v_result->>'campaign_id')::bigint;
  v_result := public.delete_control_campaign_atomic(
    v_staff_id, v_organization_id, v_created_campaign_id
  );
  IF NOT COALESCE((v_result->>'deleted')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: Control delete rejected SMS: %', v_result;
  END IF;

  -- Service-role Data Group implementations own exact Server Zalo. The v224
  -- tenant wrappers route UI provisioning by account subtype while these
  -- service-only core ownership checks remain unchanged.
  INSERT INTO public.auto_account_contact_groups (
    account_id, contact_type, name, purpose,
    staff_id, organization_id, is_delete
  ) VALUES (
    NULL, NULL, '__v219_data_group__', 'data_group',
    v_staff_id, v_organization_id, false
  ) RETURNING id INTO v_data_group_id;

  -- The credentialed legacy snapshot is a Desktop-only mutation surface. Its
  -- core locks the group before joining the campaign barrier, then rejects the
  -- exact Server owner without creating a batch or input.
  SELECT count(*) INTO v_row_count
  FROM public.auto_campaign_input_data
  WHERE campaign_id = v_server_data_group_campaign_id
    AND COALESCE(is_delete, false) = false;
  v_rejected := false;
  BEGIN
    PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign(
      v_staff_id,
      v_organization_id,
      '__v219_snapshot_server_rejected__' || v_staff_id::text,
      v_server_data_group_campaign_id,
      v_data_group_id,
      now(),
      'chờ xử lý',
      NULL::text,
      NULL::text
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'direct_campaign_runtime_not_owner';
  END;
  IF NOT v_rejected
    OR (SELECT count(*)
        FROM public.auto_campaign_input_data
        WHERE campaign_id = v_server_data_group_campaign_id
          AND COALESCE(is_delete, false) = false) <> v_row_count
    OR EXISTS (
      SELECT 1
      FROM public.auto_data_ingest_batches AS batch
      WHERE batch.staff_id = v_staff_id
        AND batch.organization_id = v_organization_id
        AND batch.request_id = '__v219_snapshot_server_rejected__' || v_staff_id::text
    )
  THEN
    RAISE EXCEPTION 'v219_smoke: legacy direct snapshot mutated a Server campaign';
  END IF;

  SELECT * INTO v_data_group_preflight
  FROM public.aka_agent_preflight_campaign_data_group_change(
    v_staff_id, v_organization_id,
    v_local_data_group_campaign_id, v_data_group_id
  );
  IF COALESCE(v_data_group_preflight.allowed, true)
    OR v_data_group_preflight.reason IS DISTINCT FROM 'data_group_campaign_account_not_found'
  THEN
    RAISE EXCEPTION 'v219_smoke: service Data Group preflight accepted local Zalo';
  END IF;
  SELECT * INTO v_data_group_preflight
  FROM public.aka_agent_preflight_campaign_data_group_change(
    v_staff_id, v_organization_id,
    v_local_data_group_campaign_id, v_data_group_id,
    NULL::text, NULL::text
  );
  IF NOT COALESCE(v_data_group_preflight.allowed, false) THEN
    RAISE EXCEPTION 'v219_smoke: desktop Data Group preflight rejected local Zalo: %', row_to_json(v_data_group_preflight);
  END IF;
  SELECT * INTO v_data_group_preflight
  FROM public.aka_agent_preflight_campaign_data_group_change(
    v_staff_id, v_organization_id,
    v_server_data_group_campaign_id, v_data_group_id
  );
  IF NOT COALESCE(v_data_group_preflight.allowed, false) THEN
    RAISE EXCEPTION 'v219_smoke: service Data Group preflight rejected Server Zalo: %', row_to_json(v_data_group_preflight);
  END IF;
  SELECT * INTO v_data_group_preflight
  FROM public.aka_agent_preflight_campaign_data_group_change(
    v_staff_id, v_organization_id,
    v_server_data_group_campaign_id, v_data_group_id,
    NULL::text, NULL::text
  );
  IF NOT COALESCE(v_data_group_preflight.allowed, false) THEN
    RAISE EXCEPTION 'v219_smoke: tenant Data Group preflight rejected Server Zalo: %',
      row_to_json(v_data_group_preflight);
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.aka_agent_bind_campaign_data_group_source(
      v_staff_id, v_organization_id,
      '__v219_bind_local_service__' || v_staff_id::text,
      v_local_data_group_campaign_id, v_data_group_id, NULL::bigint
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'data_group_campaign_account_not_found';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: service Data Group bind accepted local Zalo';
  END IF;

  v_result := public.aka_agent_bind_campaign_data_group_source(
    v_staff_id, v_organization_id,
    '__v219_bind_local_desktop__' || v_staff_id::text,
    v_local_data_group_campaign_id, v_data_group_id, NULL::bigint,
    NULL::text, NULL::text
  );
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'v219_smoke: desktop Data Group bind rejected local Zalo';
  END IF;
  IF public.aka_agent_get_campaign_data_group_source(
    v_staff_id, v_organization_id, v_local_data_group_campaign_id
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v219_smoke: service Data Group get exposed local Zalo';
  END IF;
  IF public.aka_agent_get_campaign_data_group_source(
    v_staff_id, v_organization_id, v_local_data_group_campaign_id,
    NULL::text, NULL::text
  ) IS NULL THEN
    RAISE EXCEPTION 'v219_smoke: desktop Data Group get hid local Zalo';
  END IF;
  PERFORM public.aka_agent_stop_campaign_data_group_source(
    v_staff_id, v_organization_id, v_local_data_group_campaign_id,
    '__v219_stop_local_desktop__' || v_staff_id::text, NULL,
    NULL::text, NULL::text
  );
  PERFORM public.aka_agent_reactivate_campaign_data_group_source(
    v_staff_id, v_organization_id, v_local_data_group_campaign_id,
    '__v219_reactivate_local_desktop__' || v_staff_id::text, NULL,
    NULL::text, NULL::text
  );

  v_result := public.aka_agent_bind_campaign_data_group_source(
    v_staff_id, v_organization_id,
    '__v219_bind_server_service__' || v_staff_id::text,
    v_server_data_group_campaign_id, v_data_group_id, NULL::bigint
  );
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'v219_smoke: service Data Group bind rejected Server Zalo';
  END IF;
  IF public.aka_agent_get_campaign_data_group_source(
    v_staff_id, v_organization_id, v_server_data_group_campaign_id
  ) IS NULL THEN
    RAISE EXCEPTION 'v219_smoke: service Data Group get hid Server Zalo';
  END IF;
  IF public.aka_agent_get_campaign_data_group_source(
    v_staff_id, v_organization_id, v_server_data_group_campaign_id,
    NULL::text, NULL::text
  ) IS NULL THEN
    RAISE EXCEPTION 'v219_smoke: tenant Data Group get hid Server Zalo';
  END IF;
  PERFORM public.aka_agent_stop_campaign_data_group_source(
    v_staff_id, v_organization_id, v_server_data_group_campaign_id,
    '__v219_stop_server_service__' || v_staff_id::text, NULL
  );
  PERFORM public.aka_agent_reactivate_campaign_data_group_source(
    v_staff_id, v_organization_id, v_server_data_group_campaign_id,
    '__v219_reactivate_server_service__' || v_staff_id::text, NULL
  );

  -- A desktop hard-end sweep in a mixed tenant owns the local QR campaign but
  -- must leave the per-account Server campaign untouched for the Server sweep.
  UPDATE public.auto_campaigns
  SET schedule_end_date = '-infinity'::timestamptz,
      schedule = now() - interval '2 minutes',
      status = 'chờ xử lý'
  WHERE id IN (
    v_local_data_group_campaign_id,
    v_server_data_group_campaign_id
  );

  -- The legacy Desktop-authenticated finalizer must fail closed after the
  -- account becomes Server-owned, without aborting the caller transaction.
  v_result := public.aka_agent_finalize_data_group_campaign(
    v_staff_id,
    v_organization_id,
    v_server_data_group_campaign_id,
    'desktop must not finalize server',
    NULL::text,
    NULL::text
  );
  IF v_result->>'reason' IS DISTINCT FROM 'runtime_not_owner'
    OR v_result->>'runtime_owner' IS DISTINCT FROM 'server'
    OR (SELECT status FROM public.auto_campaigns
        WHERE id = v_server_data_group_campaign_id) IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v219_smoke: legacy Desktop finalizer did not fail closed for Server owner: %', v_result;
  END IF;

  SELECT
    COALESCE(bool_or(sweep.campaign_id = v_local_data_group_campaign_id), false),
    COALESCE(bool_or(sweep.campaign_id = v_server_data_group_campaign_id), false)
  INTO v_swept_local, v_swept_server
  FROM public.aka_agent_finalize_expired_data_group_campaigns(
    v_staff_id, v_organization_id, 1000
  ) AS sweep;
  IF NOT v_swept_local
    OR (SELECT status FROM public.auto_campaigns
        WHERE id = v_local_data_group_campaign_id) IS DISTINCT FROM 'hoàn thành'
  THEN
    RAISE EXCEPTION 'v219_smoke: desktop expired sweep did not finalize local Data Group';
  END IF;
  IF v_swept_server
    OR (SELECT status FROM public.auto_campaigns
        WHERE id = v_server_data_group_campaign_id) IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v219_smoke: desktop expired sweep finalized Server Data Group';
  END IF;

  -- Expired Server Data Group claim enters the input-first wrapper before the
  -- ordinary campaign/account claim locks and completes the hard-end cleanup.
  UPDATE public.auto_campaigns
  SET schedule_end_date = now() - interval '1 minute',
      schedule = now() - interval '2 minutes',
      status = 'chờ xử lý'
  WHERE id = v_server_data_group_campaign_id;
  IF public.claim_campaign_runtime(
    v_server_data_group_campaign_id,
    v_server_account_id,
    v_staff_id,
    'server'
  ) THEN
    RAISE EXCEPTION 'v219_smoke: expired Server Data Group campaign was claimed';
  END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id = v_server_data_group_campaign_id)
    IS DISTINCT FROM 'hoàn thành'
  THEN
    RAISE EXCEPTION 'v219_smoke: expired Server Data Group claim bypassed safe finalization';
  END IF;

  v_rejected := false;
  BEGIN
    SELECT count(*) INTO v_row_count
    FROM public.aka_agent_list_campaign_input_data_page(
      v_staff_id, v_organization_id, v_local_campaign_id,
      NULL, NULL, NULL, NULL, 'all', 0, 100
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'campaign_not_found';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v219_smoke: service input page exposed local Zalo';
  END IF;
  SELECT count(*) INTO v_row_count
  FROM public.aka_agent_list_campaign_input_data_page(
    v_staff_id, v_organization_id, v_local_campaign_id,
    NULL, NULL, NULL, NULL, 'all', 0, 100,
    NULL::text, NULL::text
  );
  IF v_row_count < 1 THEN
    RAISE EXCEPTION 'v219_smoke: desktop input page hid local Zalo';
  END IF;
  SELECT count(*) INTO v_row_count
  FROM public.aka_agent_list_campaign_input_data_page(
    v_staff_id, v_organization_id, v_server_campaign_id,
    NULL, NULL, NULL, NULL, 'all', 0, 100
  );
  IF v_row_count < 1 THEN
    RAISE EXCEPTION 'v219_smoke: service input page hid Server Zalo';
  END IF;

  IF NOT public.claim_campaign_runtime(
    v_server_campaign_id, v_server_account_id, v_staff_id, 'server'
  ) THEN
    RAISE EXCEPTION 'v219_smoke: Server campaign claim failed beside Web capability';
  END IF;
  SELECT * INTO v_run_unit
  FROM public.aka_agent_claim_zalo_server_run_unit(
    v_server_campaign_id, v_server_account_id, v_staff_id, ARRAY[]::bigint[]
  );
  IF NOT COALESCE(v_run_unit.ok, false) THEN
    RAISE EXCEPTION 'v219_smoke: Server run-unit rejected Server subtype';
  END IF;
  UPDATE public.auto_campaigns SET status = 'chờ xử lý' WHERE id = v_server_campaign_id;
  UPDATE public.auto_accounts SET status = 'chờ xử lý' WHERE id = v_server_account_id;

  IF public.claim_campaign_runtime(
    v_local_campaign_id, v_local_account_id, v_staff_id, 'server'
  ) THEN RAISE EXCEPTION 'v219_smoke: Server claimed local campaign'; END IF;
  IF NOT public.claim_campaign_runtime(
    v_local_campaign_id, v_local_account_id, v_staff_id, 'desktop'
  ) THEN RAISE EXCEPTION 'v219_smoke: Desktop failed to claim local campaign'; END IF;
  UPDATE public.auto_campaigns SET status = 'chờ xử lý' WHERE id = v_local_campaign_id;
  UPDATE public.auto_accounts SET status = 'chờ xử lý' WHERE id = v_local_account_id;
  IF public.claim_campaign_runtime(
    v_server_campaign_id, v_server_account_id, v_staff_id, 'desktop'
  ) THEN RAISE EXCEPTION 'v219_smoke: Desktop claimed Server campaign'; END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_inactive_account_id, '__v219_inactive_local__', 'zalo', false, false,
    'chưa đăng nhập', 'chờ xử lý', false, v_staff_id, v_organization_id, false
  );
  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_guard_campaign_id, '__v219_running_child_guard__', v_action_id,
    v_inactive_account_id, 'chờ xử lý', '', v_staff_id, v_organization_id, false
  );
  INSERT INTO public.auto_campaign_input_data (
    id, campaign_id, status, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_guard_input_data_id, v_guard_campaign_id, 'đang chạy', false
  );

  v_result := public.claim_zalo_account_runtime_operation(
    v_inactive_account_id, v_staff_id, 'desktop', 'chờ xử lý',
    v_claim_token, false
  );
  IF v_result->>'reason' IS DISTINCT FROM 'work_running' THEN
    RAISE EXCEPTION 'v219_smoke: tokenized conversion ignored running input-data: %', v_result;
  END IF;
  UPDATE public.auto_campaign_input_data
  SET status = 'hoàn thành'
  WHERE id = v_guard_input_data_id;

  v_result := public.claim_zalo_account_runtime_operation(
    v_inactive_account_id, v_staff_id, 'desktop', 'chờ xử lý',
    v_claim_token, false
  );
  IF NOT COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: inactive conversion claim failed: %', v_result;
  END IF;
  UPDATE public.auto_accounts
  SET is_zalo_server = true
  WHERE id = v_inactive_account_id
    AND status = 'đang chạy'
    AND runtime_operation_claim_token = v_wrong_claim_token
    AND is_zalo_server = false;
  IF FOUND THEN
    RAISE EXCEPTION 'v219_smoke: subtype CAS accepted the wrong ownership token';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.auto_accounts
    WHERE id = v_inactive_account_id
      AND is_zalo_server = true
  ) THEN
    RAISE EXCEPTION 'v219_smoke: subtype CAS accepted the wrong ownership token';
  END IF;
  UPDATE public.auto_accounts
  SET is_zalo_server = true
  WHERE id = v_inactive_account_id
    AND status = 'đang chạy'
    AND runtime_operation_claim_token = v_claim_token
    AND is_zalo_server = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'v219_smoke: subtype CAS update failed'; END IF;
  IF NOT public.release_zalo_account_runtime_operation(
    v_inactive_account_id, v_staff_id, 'desktop', 'chờ xử lý', v_claim_token
  ) THEN
    RAISE EXCEPTION 'v219_smoke: token release failed after subtype changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_accounts
    WHERE id = v_inactive_account_id
      AND is_zalo_server = true
      AND status = 'chờ xử lý'
      AND runtime_operation_claim_token IS NULL
  ) THEN
    RAISE EXCEPTION 'v219_smoke: tokenized conversion did not release cleanly';
  END IF;

  -- Desktop recovery ignores the legacy exclude flag and touches every local
  -- subtype, while inspection/recovery see only Server-subtype rows.
  UPDATE public.auto_campaigns SET status = 'đang chạy'
  WHERE id IN (v_local_campaign_id, v_server_campaign_id);
  UPDATE public.auto_campaign_input_data SET status = 'đang chạy'
  WHERE id IN (v_local_input_data_id, v_server_input_data_id);
  UPDATE public.auto_accounts SET status = 'đang chạy'
  WHERE id IN (v_local_account_id, v_web_account_id, v_server_account_id);
  v_result := public.inspect_staff_zalo_running_state(v_staff_id);
  IF (v_result->>'accounts_running')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v219_smoke: running-state inspection crossed account owners: %', v_result;
  END IF;

  -- The v184 no-retry wrapper first takes the same deterministic superset as
  -- its delegated Desktop reset. It may reset local Zalo but not Server rows.
  v_result := public.reset_desktop_running_statuses_no_retry(
    v_staff_id, true, false
  );
  IF (SELECT status FROM public.auto_campaign_input_data WHERE id = v_local_input_data_id)
      IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_campaigns WHERE id = v_local_campaign_id)
      IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_campaign_input_data WHERE id = v_server_input_data_id)
      IS DISTINCT FROM 'đang chạy'
    OR (SELECT status FROM public.auto_campaigns WHERE id = v_server_campaign_id)
      IS DISTINCT FROM 'đang chạy'
    OR (SELECT status FROM public.auto_accounts WHERE id = v_server_account_id)
      IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION 'v219_smoke: no-retry recovery crossed per-account ownership: %', v_result;
  END IF;

  UPDATE public.auto_campaigns SET status = 'đang chạy'
  WHERE id = v_local_campaign_id;
  UPDATE public.auto_campaign_input_data SET status = 'đang chạy'
  WHERE id = v_local_input_data_id;
  UPDATE public.auto_accounts SET status = 'đang chạy'
  WHERE id IN (v_local_account_id, v_web_account_id);
  v_result := public.reset_desktop_running_statuses(v_staff_id, true, false);
  IF COALESCE((v_result->>'exclude_zalo')::boolean, false) IS DISTINCT FROM true
    OR (SELECT status FROM public.auto_accounts WHERE id = v_local_account_id) IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_accounts WHERE id = v_web_account_id) IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_accounts WHERE id = v_server_account_id) IS DISTINCT FROM 'đang chạy'
    OR (SELECT status FROM public.auto_campaign_input_data WHERE id = v_local_input_data_id)
      IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_campaign_input_data WHERE id = v_server_input_data_id)
      IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION 'v219_smoke: desktop recovery crossed per-account ownership: %', v_result;
  END IF;
  PERFORM public.recover_server_zalo_running_state(v_staff_id, v_revision, true);
  IF (SELECT status FROM public.auto_accounts WHERE id = v_server_account_id) IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_campaigns WHERE id = v_server_campaign_id)
      IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_campaign_input_data WHERE id = v_server_input_data_id)
      IS DISTINCT FROM 'hoàn thành'
  THEN
    RAISE EXCEPTION 'v219_smoke: Server recovery did not reset Server subtype';
  END IF;

  -- Capability loss blocks new work but lets the already claimed unit pass its
  -- run-control/finalizer/release path before the runtime disappears.
  UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = v_server_campaign_id;
  UPDATE public.auto_accounts SET status = 'đang chạy' WHERE id = v_server_account_id;
  UPDATE public.org_organization_product
  SET expiration_date = now() - interval '1 day'
  WHERE id = v_entitlement_id;
  SELECT * INTO v_run_unit
  FROM public.aka_agent_claim_zalo_server_run_unit(
    v_server_campaign_id, v_server_account_id, v_staff_id, ARRAY[]::bigint[]
  );
  IF COALESCE(v_run_unit.ok, false) THEN
    RAISE EXCEPTION 'v219_smoke: capability loss allowed a new run-unit claim';
  END IF;
  SELECT * INTO v_control
  FROM public.aka_agent_get_zalo_server_run_control_state(
    v_server_campaign_id, v_server_account_id, v_staff_id
  );
  IF COALESCE(v_control.should_stop, true)
    OR v_control.hard_stop_reason IS NOT NULL
  THEN
    RAISE EXCEPTION 'v219_smoke: capability loss aborted an already claimed unit: %', row_to_json(v_control);
  END IF;
  SELECT * INTO v_control
  FROM public.aka_agent_finalize_zalo_server_campaign(
    v_server_campaign_id, v_staff_id, NULL, false
  );
  IF NOT COALESCE(v_control.ok, false) THEN
    RAISE EXCEPTION 'v219_smoke: capability loss blocked finalization: %', row_to_json(v_control);
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(
    v_server_account_id, v_staff_id, 'server', 'chờ xử lý'
  ) THEN
    RAISE EXCEPTION 'v219_smoke: capability loss blocked account release';
  END IF;
  v_result := public.claim_zalo_account_runtime_operation(
    v_server_account_id, v_staff_id, 'server', false
  );
  IF COALESCE((v_result->>'claimed')::boolean, false) THEN
    RAISE EXCEPTION 'v219_smoke: capability loss allowed a new Server claim';
  END IF;

  -- Crash cleanup also remains possible after the entitlement is no longer live.
  UPDATE public.auto_accounts SET status = 'đang chạy' WHERE id = v_server_account_id;
  PERFORM public.recover_server_zalo_running_state(v_staff_id, NULL, false);
  IF (SELECT status FROM public.auto_accounts WHERE id = v_server_account_id) IS DISTINCT FROM 'chờ xử lý' THEN
    RAISE EXCEPTION 'v219_smoke: cleanup recovery required a live entitlement';
  END IF;
END;
$behavior$;

ROLLBACK;

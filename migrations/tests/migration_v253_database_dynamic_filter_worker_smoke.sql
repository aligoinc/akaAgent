-- Rollback smoke test for migration_v253_database_dynamic_filter_worker.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $contract$
DECLARE
  v_process oid := pg_catalog.to_regprocedure(
    'public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)'
  );
  v_core oid := pg_catalog.to_regprocedure(
    'public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)'
  );
  v_worker oid := pg_catalog.to_regprocedure(
    'public.aka_agent_run_data_group_dynamic_filter_worker(integer,integer)'
  );
  v_private oid;
BEGIN
  IF v_process IS NULL OR v_core IS NULL OR v_worker IS NULL THEN
    RAISE EXCEPTION 'v253_smoke:signature_missing';
  END IF;

  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_process))
      IS DISTINCT FROM '4e855f4769b4f5537bdf351d9f20c6b6'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_core))
      IS DISTINCT FROM 'e384f8113c0166531de3eacd724d7241'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_worker))
      IS DISTINCT FROM '56510e2f6e8450b684486336e773746d'
  THEN
    RAISE EXCEPTION 'v253_smoke:checksum_mismatch';
  END IF;

  IF pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_process),
      'auto_assert_automation_identity'
    ) = 0
    OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_process),
      'aka_agent_process_data_group_dynamic_filters_core'
    ) = 0
    OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_core),
      'dynamic_filter.effective_from_at <= v_queue.last_event_at'
    ) = 0
    OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_worker),
      'v_deadline'
    ) = 0
  THEN
    RAISE EXCEPTION 'v253_smoke:behavior_marker_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'aka-agent-data-group-dynamic-filter-worker'
      AND schedule = '30 seconds'
      AND command = 'SELECT public.aka_agent_run_data_group_dynamic_filter_worker(5, 100);'
      AND active = true
      AND username = 'postgres'
      AND database = current_database()
  ) THEN
    RAISE EXCEPTION 'v253_smoke:cron_contract_mismatch';
  END IF;

  IF pg_catalog.pg_get_indexdef(pg_catalog.to_regclass(
      'public.idx_data_group_dynamic_filter_queue_global_due'
    )) IS DISTINCT FROM
    'CREATE INDEX idx_data_group_dynamic_filter_queue_global_due ON public.auto_account_contact_dynamic_filter_queue USING btree (queued_at, contact_id, staff_id, organization_id)'
  THEN
    RAISE EXCEPTION 'v253_smoke:index_contract_mismatch';
  END IF;

  IF NOT pg_catalog.has_function_privilege('anon', v_process, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', v_process, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_process, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v253_smoke:legacy_rpc_acl_missing';
  END IF;

  FOREACH v_private IN ARRAY ARRAY[v_core, v_worker] LOOP
    IF pg_catalog.has_function_privilege('anon', v_private, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', v_private, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', v_private, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'v253_smoke:private_rpc_exposed';
    END IF;
  END LOOP;
END;
$contract$;

DO $behavior$
DECLARE
  v_account record;
  v_group_id bigint := 925300000000000 + pg_catalog.txid_current();
  v_filter_id bigint;
  v_contact_one bigint;
  v_contact_two bigint;
  v_data_type_id bigint := public.aka_agent_data_type_category_item_id('zalo_person');
  v_scope_id bigint;
  v_join_id bigint;
  v_field_id bigint;
  v_operator_id bigint;
  v_result jsonb;
  v_uid_prefix text := 'v253-smoke-' || pg_catalog.txid_current()::text || '-';
BEGIN
  SELECT account.id, account.staff_id, account.organization_id
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.flatform_type = 'zalo'
    AND account.staff_id IS NOT NULL
    AND account.organization_id IS NOT NULL
    AND account.is_delete = false
  ORDER BY account.id
  LIMIT 1;

  IF v_account.id IS NULL THEN
    RAISE NOTICE 'v253_smoke:no_zalo_account_fixture; behavior skipped';
    RETURN;
  END IF;
  IF v_data_type_id IS NULL THEN
    RAISE EXCEPTION 'v253_smoke:zalo_person_category_missing';
  END IF;

  SELECT item.id INTO v_scope_id
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common' AND type.code = 'data_filter_scope'
    AND item.code = 'enter' AND item.is_active = true;
  SELECT item.id INTO v_join_id
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common' AND type.code = 'data_filter_join'
    AND item.code = 'and' AND item.is_active = true;
  SELECT item.id INTO v_field_id
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common' AND type.code = 'data_filter_field'
    AND item.code = 'zalo_friend_status' AND item.is_active = true;
  SELECT item.id INTO v_operator_id
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common' AND type.code = 'data_filter_operator'
    AND item.code = 'equals' AND item.is_active = true;

  IF v_scope_id IS NULL OR v_join_id IS NULL
    OR v_field_id IS NULL OR v_operator_id IS NULL
  THEN
    RAISE EXCEPTION 'v253_smoke:rule_category_missing';
  END IF;

  INSERT INTO public.auto_account_contact_groups (
    id, account_id, contact_type, name, purpose,
    staff_id, organization_id, data_type_category_item_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_group_id, NULL, NULL, '__v253_database_worker__', 'data_group',
    v_account.staff_id, v_account.organization_id, v_data_type_id, false
  );

  INSERT INTO public.auto_account_contact_group_dynamic_filters (
    group_id, staff_id, organization_id, is_enabled, revision,
    effective_from_at, next_evaluation_at
  ) VALUES (
    v_group_id, v_account.staff_id, v_account.organization_id, true, 1,
    clock_timestamp() - interval '1 second', NULL
  ) RETURNING id INTO v_filter_id;

  INSERT INTO public.auto_account_contact_group_dynamic_filter_rules (
    dynamic_filter_id, scope_category_item_id, join_category_item_id,
    field_category_item_id, operator_category_item_id, account_id,
    sort_order, value_keys, value_labels
  ) VALUES (
    v_filter_id, v_scope_id, v_join_id, v_field_id, v_operator_id,
    v_account.id, 1, '["unknown"]'::jsonb, '["Chưa xác định"]'::jsonb
  );

  INSERT INTO public.auto_account_contacts (
    account_id, contact_type, name, uid, extra_data,
    flatform_type, staff_id, organization_id, is_delete, is_friend
  ) VALUES (
    v_account.id, 'person', '__v253_database_worker_one__',
    v_uid_prefix || 'one', '{}'::jsonb,
    'zalo', v_account.staff_id, v_account.organization_id, false, NULL
  ) RETURNING id INTO v_contact_one;

  INSERT INTO public.auto_account_contacts (
    account_id, contact_type, name, uid, extra_data,
    flatform_type, staff_id, organization_id, is_delete, is_friend
  ) VALUES (
    v_account.id, 'person', '__v253_database_worker_two__',
    v_uid_prefix || 'two', '{}'::jsonb,
    'zalo', v_account.staff_id, v_account.organization_id, false, NULL
  ) RETURNING id INTO v_contact_two;

  UPDATE public.auto_account_contact_dynamic_filter_queue
  SET queued_at = '-infinity'::timestamptz
  WHERE contact_id IN (v_contact_one, v_contact_two);

  IF (
    SELECT count(*)
    FROM public.auto_account_contact_dynamic_filter_queue
    WHERE contact_id IN (v_contact_one, v_contact_two)
  ) <> 2 THEN
    RAISE EXCEPTION 'v253_smoke:fixture_not_queued';
  END IF;

  v_result := public.aka_agent_run_data_group_dynamic_filter_worker(1, 1);
  IF COALESCE((v_result->>'busy')::boolean, false)
    OR COALESCE((v_result->>'processed_contact_count')::integer, 0) <> 1
    OR COALESCE((v_result->>'has_more')::boolean, false) IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v253_smoke:first_bounded_batch_failed: %', v_result;
  END IF;

  IF (
    SELECT count(*)
    FROM public.auto_account_contact_dynamic_filter_queue
    WHERE contact_id IN (v_contact_one, v_contact_two)
  ) <> 1 OR (
    SELECT count(*)
    FROM public.auto_account_contact_group_members AS member
    JOIN public.auto_account_contact_group_member_origins AS origin
      ON origin.membership_id = member.id
     AND origin.dynamic_filter_id = v_filter_id
     AND origin.is_current = true
    WHERE member.group_id = v_group_id
      AND member.contact_id IN (v_contact_one, v_contact_two)
      AND member.is_delete = false
  ) <> 1 THEN
    RAISE EXCEPTION 'v253_smoke:first_batch_membership_contract_failed';
  END IF;

  v_result := public.aka_agent_run_data_group_dynamic_filter_worker(1, 1);
  IF COALESCE((v_result->>'busy')::boolean, false)
    OR COALESCE((v_result->>'processed_contact_count')::integer, 0) <> 1
  THEN
    RAISE EXCEPTION 'v253_smoke:second_bounded_batch_failed: %', v_result;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.auto_account_contact_dynamic_filter_queue
    WHERE contact_id IN (v_contact_one, v_contact_two)
  ) OR (
    SELECT count(*)
    FROM public.auto_account_contact_group_members AS member
    JOIN public.auto_account_contact_group_member_origins AS origin
      ON origin.membership_id = member.id
     AND origin.dynamic_filter_id = v_filter_id
     AND origin.is_current = true
    WHERE member.group_id = v_group_id
      AND member.contact_id IN (v_contact_one, v_contact_two)
      AND member.is_delete = false
  ) <> 2 THEN
    RAISE EXCEPTION 'v253_smoke:second_batch_membership_contract_failed';
  END IF;

  RAISE NOTICE 'v253 database-native bounded worker smoke passed';
END;
$behavior$;

ROLLBACK;

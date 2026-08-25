-- Rollback smoke test for migration_v252_forward_only_dynamic_filters.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $contract$
DECLARE
  v_save oid := pg_catalog.to_regprocedure(
    'public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)'
  );
  v_process oid := pg_catalog.to_regprocedure(
    'public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)'
  );
  v_stamp oid := pg_catalog.to_regprocedure(
    'public.aka_agent_dynamic_filter_stamp_queue_event()'
  );
BEGIN
  IF v_save IS NULL OR v_process IS NULL OR v_stamp IS NULL THEN
    RAISE EXCEPTION 'v252_smoke:signature_missing';
  END IF;

  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_save))
      IS DISTINCT FROM '5c8507459cb2dc0e39b2b8906f6047ee'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_process))
      IS DISTINCT FROM '0b7d7dcf67514fa7a959f5a56fd72e7b'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_stamp))
      IS DISTINCT FROM '82ca61f3031b277dbeceb8d3bfd14a14'
  THEN
    RAISE EXCEPTION 'v252_smoke:checksum_mismatch';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'auto_account_contact_group_dynamic_filters'
        AND column_name = 'effective_from_at'
        AND is_nullable = 'NO'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'auto_account_contact_dynamic_filter_queue'
        AND column_name = 'last_event_at'
        AND is_nullable = 'NO'
    )
  THEN
    RAISE EXCEPTION 'v252_smoke:column_contract';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.auto_account_contact_group_dynamic_filters
    WHERE next_evaluation_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'v252_smoke:periodic_timestamp_not_cleared';
  END IF;

  IF pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_save),
      'INSERT INTO public.auto_account_contact_dynamic_filter_queue'
    ) <> 0
    OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_save),
      'pg_advisory_xact_lock'
    ) = 0
    OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(v_process),
      'dynamic_filter.effective_from_at <= v_queue.last_event_at'
    ) = 0
  THEN
    RAISE EXCEPTION 'v252_smoke:forward_only_marker';
  END IF;
END;
$contract$;

DO $behavior$
DECLARE
  v_account record;
  v_group_id bigint := 925200000000000 + pg_catalog.txid_current();
  v_filter_id bigint;
  v_contact_id bigint;
  v_data_type_id bigint := public.aka_agent_data_type_category_item_id('zalo_person');
  v_cutoff timestamptz;
  v_first_event timestamptz;
  v_latest_event timestamptz;
  v_uid text := 'v252-smoke-' || pg_catalog.txid_current()::text;
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
    RAISE NOTICE 'v252_smoke:no_zalo_account_fixture; behavior skipped';
    RETURN;
  END IF;
  IF v_data_type_id IS NULL THEN
    RAISE EXCEPTION 'v252_smoke:zalo_person_category_missing';
  END IF;

  INSERT INTO public.auto_account_contact_groups (
    id, account_id, contact_type, name, purpose,
    staff_id, organization_id, data_type_category_item_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_group_id, NULL, NULL, '__v252_forward_only__', 'data_group',
    v_account.staff_id, v_account.organization_id, v_data_type_id, false
  );

  INSERT INTO public.auto_account_contact_group_dynamic_filters (
    group_id, staff_id, organization_id, is_enabled, revision,
    effective_from_at, next_evaluation_at
  ) VALUES (
    v_group_id, v_account.staff_id, v_account.organization_id, true, 1,
    clock_timestamp() + interval '1 hour', NULL
  ) RETURNING id, effective_from_at INTO v_filter_id, v_cutoff;

  INSERT INTO public.auto_account_contacts (
    account_id, contact_type, name, uid, extra_data,
    flatform_type, staff_id, organization_id, is_delete
  ) VALUES (
    v_account.id, 'person', '__v252_forward_only__', v_uid, '{}'::jsonb,
    'zalo', v_account.staff_id, v_account.organization_id, false
  ) RETURNING id INTO v_contact_id;

  SELECT queue.last_event_at INTO v_first_event
  FROM public.auto_account_contact_dynamic_filter_queue AS queue
  WHERE queue.contact_id = v_contact_id;

  IF v_first_event IS NULL OR v_first_event >= v_cutoff THEN
    RAISE EXCEPTION 'v252_smoke:historical_event_not_before_cutoff';
  END IF;

  UPDATE public.auto_account_contact_group_dynamic_filters
  SET effective_from_at = clock_timestamp()
  WHERE id = v_filter_id
  RETURNING effective_from_at INTO v_cutoff;

  UPDATE public.auto_account_contacts
  SET extra_data = extra_data || '{"v252Changed":true}'::jsonb
  WHERE id = v_contact_id;

  SELECT queue.last_event_at INTO v_latest_event
  FROM public.auto_account_contact_dynamic_filter_queue AS queue
  WHERE queue.contact_id = v_contact_id;

  IF v_latest_event IS NULL
    OR v_latest_event < v_cutoff
    OR v_latest_event < v_first_event
  THEN
    RAISE EXCEPTION 'v252_smoke:latest_event_not_advanced';
  END IF;

  RAISE NOTICE 'v252 forward-only dynamic-filter smoke passed';
END;
$behavior$;

ROLLBACK;

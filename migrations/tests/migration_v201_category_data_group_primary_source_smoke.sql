-- Catalog and transactional behavior smoke checks for
-- migration_v201_category_data_group_primary_source.sql.
-- Run after v201 is applied. Any fixture mutation is rolled back.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';

DO $v201_catalog_schema$
DECLARE
  v_type_id bigint;
  v_codes text[];
  v_names text[];
  v_managed_by text[];
  v_colors text[];
  v_mapping_ids bigint[];
  v_expected_ids bigint[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'category_type'
      AND column_name = 'id'
      AND data_type = 'bigint'
      AND is_identity = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'category_item'
      AND column_name = 'id'
      AND data_type = 'bigint'
      AND is_identity = 'YES'
  ) THEN
    RAISE EXCEPTION 'v201_smoke: category ids are not bigint identities';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'category_type'
      AND column_name = 'namespace'
      AND column_default = '''common''::text'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.category_item'::regclass
      AND conname = 'category_item_sort_order_check'
      AND position(
        'sort_order >= 0' IN pg_catalog.pg_get_constraintdef(oid)
      ) > 0
  ) THEN
    RAISE EXCEPTION 'v201_smoke: shared namespace/sort defaults are invalid';
  END IF;

  SELECT category_type.id
  INTO v_type_id
  FROM public.category_type AS category_type
  WHERE category_type.namespace = 'common'
    AND category_type.code = 'data_source'
    AND category_type.name = 'Nguồn data'
    AND category_type.managed_by = 'system'
    AND category_type.is_active = true;

  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'v201_smoke: common/data_source system type is missing';
  END IF;

  SELECT
    array_agg(category_item.code ORDER BY category_item.sort_order, category_item.id),
    array_agg(category_item.name ORDER BY category_item.sort_order, category_item.id),
    array_agg(category_item.managed_by ORDER BY category_item.sort_order, category_item.id),
    array_agg(category_item.color ORDER BY category_item.sort_order, category_item.id),
    array_agg(category_item.id ORDER BY category_item.code)
  INTO v_codes, v_names, v_managed_by, v_colors, v_expected_ids
  FROM public.category_item AS category_item
  WHERE category_item.category_type_id = v_type_id
    AND category_item.managed_by = 'system'
    AND category_item.is_active = true;

  IF v_codes IS DISTINCT FROM ARRAY['upload', 'scan', 'automation']::text[]
    OR v_names IS DISTINCT FROM
      ARRAY['Upload data', 'Quét data', 'Tự động hóa']::text[]
    OR v_managed_by IS DISTINCT FROM ARRAY['system', 'system', 'system']::text[]
    OR v_colors IS DISTINCT FROM ARRAY[NULL, NULL, NULL]::text[]
  THEN
    RAISE EXCEPTION
      'v201_smoke: active data-source item catalog is not the exact seeded set';
  END IF;

  SELECT array_agg(mapped.id ORDER BY mapped.code)
  INTO v_mapping_ids
  FROM (VALUES
    ('automation', public.aka_agent_data_group_source_category_item_id('automation')),
    ('scan', public.aka_agent_data_group_source_category_item_id('scan')),
    ('upload', public.aka_agent_data_group_source_category_item_id('manual'))
  ) AS mapped(code, id);

  IF v_mapping_ids IS DISTINCT FROM v_expected_ids
    OR public.aka_agent_data_group_source_category_item_id('upload')
      IS DISTINCT FROM public.aka_agent_data_group_source_category_item_id('manual')
    OR public.aka_agent_data_group_source_category_item_id('api') IS NOT NULL
    OR public.aka_agent_data_group_source_category_item_id('legacy') IS NOT NULL
    OR public.aka_agent_data_group_source_category_item_id('legacy_unknown') IS NOT NULL
  THEN
    RAISE EXCEPTION 'v201_smoke: precise origin-kind mapping is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.category_item'::regclass
      AND conname = 'category_item_category_type_id_fkey'
      AND contype = 'f'
      AND confdeltype = 'r'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid =
      'public.auto_account_contact_group_member_origins'::regclass
      AND conname =
        'auto_account_contact_group_member_origins_source_category_item_fkey'
      AND contype = 'f'
      AND confdeltype = 'r'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_account_contact_group_members'::regclass
      AND conname = 'auto_account_contact_group_members_primary_origin_fkey'
      AND contype = 'f'
      AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'v201_smoke: catalog/origin/member FK delete contracts are invalid';
  END IF;

  IF NOT has_table_privilege('anon', 'public.category_type', 'SELECT')
    OR has_table_privilege('anon', 'public.category_type', 'INSERT')
    OR NOT has_table_privilege('authenticated', 'public.category_item', 'SELECT')
    OR has_table_privilege('authenticated', 'public.category_item', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.category_type', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.category_type', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.category_type', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.category_type', 'DELETE')
    OR NOT has_table_privilege('service_role', 'public.category_item', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.category_item', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.category_item', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.category_item', 'DELETE')
    OR NOT has_sequence_privilege(
      'service_role', 'public.category_type_id_seq', 'USAGE'
    )
    OR NOT has_sequence_privilege(
      'service_role', 'public.category_item_id_seq', 'USAGE'
    )
  THEN
    RAISE EXCEPTION 'v201_smoke: shared catalog ACL contract is invalid';
  END IF;

  IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class
      WHERE oid = 'public.category_type'::regclass
        AND relrowsecurity = true
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class
      WHERE oid = 'public.category_item'::regclass
        AND relrowsecurity = true
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'category_type'
        AND policyname = 'category_type_read_catalog'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'category_item'
        AND policyname = 'category_item_read_catalog'
    )
  THEN
    RAISE EXCEPTION 'v201_smoke: shared catalog RLS contract is invalid';
  END IF;
END;
$v201_catalog_schema$;

DO $v201_rpc_contract$
DECLARE
  v_signature text;
  v_oid oid;
  v_output_names text[];
  v_expected_names constant text[] := ARRAY[
    'id', 'group_id', 'contact_id', 'name', 'uid', 'url', 'phone', 'email',
    'info1', 'info2', 'info3', 'info4', 'info5', 'contact_type',
    'flatform_type', 'source_account_id', 'source_account_name',
    'source_account_deleted', 'dataset_ids', 'dataset_names', 'is_friend',
    'is_joined', 'is_delete', 'change_revision', 'provenance', 'created_at',
    'updated_at', 'primary_origin_id', 'source_category_item_id', 'source_code',
    'source_name', 'source_automation_id', 'source_automation_name', 'total_count'
  ]::text[];
  v_definition text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)',
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer,text,text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'v201_smoke: list-members overload % is missing', v_signature;
    END IF;

    SELECT array_agg(routine.proargnames[arg_position] ORDER BY arg_position)
    INTO v_output_names
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL generate_subscripts(routine.proallargtypes, 1)
      AS positions(arg_position)
    WHERE routine.oid = v_oid
      AND routine.proargmodes[arg_position] IN ('o', 't');

    IF v_output_names IS DISTINCT FROM v_expected_names THEN
      RAISE EXCEPTION 'v201_smoke: overload % OUT contract drifted: %',
        v_signature, v_output_names;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc
      WHERE oid = v_oid AND prosecdef AND provolatile = 's'
    ) THEN
      RAISE EXCEPTION 'v201_smoke: overload % lost stable/security-definer contract',
        v_signature;
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)'::regprocedure
  ) INTO v_definition;
  IF position('primary_origin.source_category_item_id' IN v_definition) = 0
    OR position('automation_detail.staff_id = p_staff_id' IN v_definition) = 0
    OR position('automation.organization_id = p_organization_id' IN v_definition) = 0
    OR position('filtered.account_id::bigint' IN v_definition) = 0
    OR position('''relationship_kind'', origin.relationship_kind' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'v201_smoke: base list-members projection/security regressed';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer,text,text)'::regprocedure
  ) INTO v_definition;
  IF position('auto_assert_automation_identity' IN v_definition) = 0
    OR position('FROM public.aka_agent_list_data_group_members' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'v201_smoke: authenticated list-members wrapper drifted';
  END IF;

  IF has_function_privilege(
      'anon',
      'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'anon',
      'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer,text,text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'authenticated',
      'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer,text,text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v201_smoke: list-members overload ACL strategy regressed';
  END IF;
END;
$v201_rpc_contract$;

DO $v201_writers_and_triggers$
DECLARE
  v_trigger text;
  v_helper text;
  v_definition text;
BEGIN
  FOREACH v_trigger IN ARRAY ARRAY[
    'trg_aka_agent_stamp_data_group_source_category',
    'trg_aka_agent_refresh_data_group_primary_from_origin',
    'trg_aka_agent_deferred_repair_data_group_primary_from_origin',
    'trg_aka_agent_guard_data_group_member_primary_origin',
    'trg_aka_agent_refresh_data_group_primary_from_member',
    'trg_aka_agent_refresh_data_group_primary_from_category_item',
    'trg_aka_agent_refresh_data_group_primary_from_category_type'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger
      WHERE tgname = v_trigger
        AND NOT tgisinternal
        AND tgenabled <> 'D'
    ) THEN
      RAISE EXCEPTION 'v201_smoke: trigger % is missing or disabled', v_trigger;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'trg_aka_agent_deferred_repair_data_group_primary_from_origin'
      AND tgdeferrable = true
      AND tginitdeferred = true
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'v201_smoke: primary-source repair trigger is not initially deferred';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_repair_data_group_primary_from_origin()'::regprocedure
  ) INTO v_definition;
  IF position('v_replacement_origin_id' IN v_definition) = 0
    OR position('origin.dataset_id = OLD.dataset_id' IN v_definition) = 0
    OR position('v_replacement_origin_id IS NOT NULL' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'v201_smoke: dataset-origin replacement transfer is missing';
  END IF;

  FOREACH v_helper IN ARRAY ARRAY[
    'public.touch_category_catalog_updated_at()',
    'public.aka_agent_data_group_source_category_item_id(text)',
    'public.aka_agent_sync_data_group_member_primary_origin(bigint,bigint,boolean)',
    'public.aka_agent_refresh_data_group_primary_from_origin()',
    'public.aka_agent_repair_data_group_primary_from_origin()',
    'public.aka_agent_sync_copied_data_group_origins(bigint,bigint,boolean)'
  ] LOOP
    IF has_function_privilege('anon', v_helper, 'EXECUTE')
      OR has_function_privilege('authenticated', v_helper, 'EXECUTE')
      OR has_function_privilege('service_role', v_helper, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'v201_smoke: internal helper % is externally executable', v_helper;
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text)'::regprocedure
  ) INTO v_definition;
  IF position('aka_agent_sync_copied_data_group_origins' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'v201_smoke: duplicate writer does not preserve source primary';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)'::regprocedure
  ) INTO v_definition;
  IF position('aka_agent_sync_copied_data_group_origins' IN v_definition) = 0
    OR position('v_target_primary_before' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'v201_smoke: move writer does not preserve/reactivate source primary';
  END IF;
END;
$v201_writers_and_triggers$;

-- Exercise stickiness, deterministic fallback, unmapped legacy/API behavior,
-- retirement, and reactivation against one existing row when available. This
-- avoids fabricating the large tenant/account FK graph and is always rolled back.
DO $v201_behavior$
DECLARE
  v_member record;
  v_marker text := 'v201-smoke:' || txid_current()::text;
  v_manual_origin_id bigint;
  v_scan_origin_id bigint;
  v_api_origin_id bigint;
  v_automation_origin_id bigint;
  v_reactivation_origin_id bigint;
  v_automation_detail_id bigint;
  v_expected_automation_id bigint;
  v_expected_automation_name text;
  v_primary_origin_id bigint;
  v_source_category_item_id bigint;
  v_listed record;
BEGIN
  SELECT
    member.id,
    member.group_id,
    contact_group.staff_id,
    contact_group.organization_id
  INTO v_member
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contact_groups AS contact_group
    ON contact_group.id = member.group_id
   AND contact_group.purpose = 'data_group'
   AND contact_group.is_delete = false
  JOIN public.auto_account_contacts AS contact
    ON contact.id = member.contact_id
   AND contact.staff_id = contact_group.staff_id
   AND contact.organization_id = contact_group.organization_id
   AND COALESCE(contact.is_delete, false) = false
  WHERE member.is_delete = false
  ORDER BY member.id
  LIMIT 1
  FOR UPDATE OF member SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE NOTICE 'v201_smoke: no active Data Group member; row behavior skipped';
    RETURN;
  END IF;

  SELECT
    detail.id,
    automation.id,
    automation.name
  INTO
    v_automation_detail_id,
    v_expected_automation_id,
    v_expected_automation_name
  FROM public.auto_automation_detail AS detail
  JOIN public.auto_automation AS automation
    ON automation.id = detail.automation_id
   AND automation.staff_id = v_member.staff_id
   AND automation.organization_id = v_member.organization_id
  WHERE detail.staff_id = v_member.staff_id
    AND detail.organization_id = v_member.organization_id
  ORDER BY detail.id
  LIMIT 1;

  UPDATE public.auto_account_contact_group_member_origins
  SET is_current = false
  WHERE membership_id = v_member.id
    AND is_current = true;
  SET CONSTRAINTS public.trg_aka_agent_deferred_repair_data_group_primary_from_origin IMMEDIATE;
  SET CONSTRAINTS public.trg_aka_agent_deferred_repair_data_group_primary_from_origin DEFERRED;

  SELECT member.primary_origin_id
  INTO v_primary_origin_id
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = v_member.id;
  IF v_primary_origin_id IS NOT NULL THEN
    RAISE EXCEPTION 'v201_smoke: retiring all origins did not clear primary';
  END IF;

  INSERT INTO public.auto_account_contact_group_member_origins (
    membership_id, kind, source_name_snapshot, is_current, created_at, updated_at
  ) VALUES (
    v_member.id, 'manual', v_marker || ':manual', true,
    clock_timestamp() - interval '5 minutes', clock_timestamp()
  ) RETURNING id, source_category_item_id
    INTO v_manual_origin_id, v_source_category_item_id;

  IF v_source_category_item_id IS DISTINCT FROM
    public.aka_agent_data_group_source_category_item_id('upload') THEN
    RAISE EXCEPTION 'v201_smoke: manual origin was not stamped as upload';
  END IF;

  INSERT INTO public.auto_account_contact_group_member_origins (
    membership_id, kind, source_name_snapshot, is_current, created_at, updated_at
  ) VALUES (
    v_member.id, 'scan', v_marker || ':scan', true,
    clock_timestamp() - interval '10 minutes', clock_timestamp()
  ) RETURNING id INTO v_scan_origin_id;

  SELECT member.primary_origin_id
  INTO v_primary_origin_id
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = v_member.id;
  IF v_primary_origin_id IS DISTINCT FROM v_manual_origin_id THEN
    RAISE EXCEPTION 'v201_smoke: a later duplicate source replaced valid primary';
  END IF;

  UPDATE public.auto_account_contact_group_member_origins
  SET is_current = false
  WHERE id = v_manual_origin_id;
  SET CONSTRAINTS public.trg_aka_agent_deferred_repair_data_group_primary_from_origin IMMEDIATE;
  SET CONSTRAINTS public.trg_aka_agent_deferred_repair_data_group_primary_from_origin DEFERRED;
  SELECT member.primary_origin_id
  INTO v_primary_origin_id
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = v_member.id;
  IF v_primary_origin_id IS DISTINCT FROM v_scan_origin_id THEN
    RAISE EXCEPTION 'v201_smoke: source retirement did not select oldest fallback';
  END IF;

  UPDATE public.auto_account_contact_group_member_origins
  SET is_current = true
  WHERE id = v_manual_origin_id;
  SELECT member.primary_origin_id
  INTO v_primary_origin_id
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = v_member.id;
  IF v_primary_origin_id IS DISTINCT FROM v_scan_origin_id THEN
    RAISE EXCEPTION 'v201_smoke: reactivation stole a valid fallback primary';
  END IF;

  -- Dataset snapshot writers may temporarily retire and reactivate the exact
  -- same origin in one transaction. The final current source must stay sticky.
  UPDATE public.auto_account_contact_group_member_origins
  SET is_current = false
  WHERE id = v_scan_origin_id;
  UPDATE public.auto_account_contact_group_member_origins
  SET is_current = true
  WHERE id = v_scan_origin_id;
  SET CONSTRAINTS public.trg_aka_agent_deferred_repair_data_group_primary_from_origin IMMEDIATE;
  SET CONSTRAINTS public.trg_aka_agent_deferred_repair_data_group_primary_from_origin DEFERRED;
  SELECT member.primary_origin_id
  INTO v_primary_origin_id
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = v_member.id;
  IF v_primary_origin_id IS DISTINCT FROM v_scan_origin_id THEN
    RAISE EXCEPTION 'v201_smoke: no-op snapshot refresh changed primary source';
  END IF;

  INSERT INTO public.auto_account_contact_group_member_origins (
    membership_id, kind, source_name_snapshot, is_current
  ) VALUES (
    v_member.id, 'api', v_marker || ':api', true
  ) RETURNING id, source_category_item_id
    INTO v_api_origin_id, v_source_category_item_id;
  IF v_source_category_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'v201_smoke: API origin was guessed into a category';
  END IF;

  INSERT INTO public.auto_account_contact_group_member_origins (
    membership_id, kind, automation_detail_id, source_name_snapshot, is_current
  ) VALUES (
    v_member.id, 'automation', v_automation_detail_id,
    v_marker || ':automation', true
  ) RETURNING id INTO v_automation_origin_id;

  UPDATE public.auto_account_contact_group_member_origins
  SET is_current = false
  WHERE id IN (v_scan_origin_id, v_manual_origin_id);
  SET CONSTRAINTS public.trg_aka_agent_deferred_repair_data_group_primary_from_origin IMMEDIATE;
  SET CONSTRAINTS public.trg_aka_agent_deferred_repair_data_group_primary_from_origin DEFERRED;

  SELECT member.primary_origin_id
  INTO v_primary_origin_id
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = v_member.id;
  IF v_primary_origin_id IS DISTINCT FROM v_automation_origin_id THEN
    RAISE EXCEPTION 'v201_smoke: automation fallback was not selected';
  END IF;

  SELECT listed.*
  INTO v_listed
  FROM public.aka_agent_list_data_group_members(
    p_staff_id => v_member.staff_id,
    p_organization_id => v_member.organization_id,
    p_group_id => v_member.group_id,
    p_ids => ARRAY[v_member.id]
  ) AS listed;

  IF v_listed.primary_origin_id IS DISTINCT FROM v_automation_origin_id
    OR v_listed.source_code IS DISTINCT FROM 'automation'
    OR v_listed.source_name IS DISTINCT FROM 'Tự động hóa'
    OR v_listed.source_category_item_id IS DISTINCT FROM
      public.aka_agent_data_group_source_category_item_id('automation')
    OR v_listed.source_automation_id IS DISTINCT FROM v_expected_automation_id
    OR v_listed.source_automation_name IS DISTINCT FROM COALESCE(
      NULLIF(btrim(v_expected_automation_name), ''),
      v_marker || ':automation'
    )
  THEN
    RAISE EXCEPTION 'v201_smoke: list-members top-level source projection is invalid';
  END IF;

  UPDATE public.auto_account_contact_group_members
  SET is_delete = true
  WHERE id = v_member.id;
  SELECT member.primary_origin_id
  INTO v_primary_origin_id
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = v_member.id;
  IF v_primary_origin_id IS NOT NULL THEN
    RAISE EXCEPTION 'v201_smoke: deleted membership retained a primary';
  END IF;

  UPDATE public.auto_account_contact_group_members
  SET is_delete = false
  WHERE id = v_member.id;
  SELECT member.primary_origin_id
  INTO v_primary_origin_id
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = v_member.id;
  IF v_primary_origin_id IS NOT NULL THEN
    RAISE EXCEPTION 'v201_smoke: membership reactivation reused a historical source too early';
  END IF;

  UPDATE public.auto_account_contact_group_member_origins
  SET is_current = false
  WHERE id = v_automation_origin_id;
  SET CONSTRAINTS public.trg_aka_agent_deferred_repair_data_group_primary_from_origin IMMEDIATE;
  SET CONSTRAINTS public.trg_aka_agent_deferred_repair_data_group_primary_from_origin DEFERRED;
  SELECT member.primary_origin_id
  INTO v_primary_origin_id
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = v_member.id;
  IF v_primary_origin_id IS NOT NULL THEN
    RAISE EXCEPTION 'v201_smoke: retiring an old source preempted reactivation';
  END IF;

  INSERT INTO public.auto_account_contact_group_member_origins (
    membership_id, kind, source_name_snapshot, is_current
  ) VALUES (
    v_member.id, 'upload', v_marker || ':reactivation', true
  ) RETURNING id INTO v_reactivation_origin_id;

  SELECT member.primary_origin_id
  INTO v_primary_origin_id
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = v_member.id;
  IF v_primary_origin_id IS DISTINCT FROM v_reactivation_origin_id THEN
    RAISE EXCEPTION 'v201_smoke: reactivating origin did not become primary';
  END IF;
END;
$v201_behavior$;

ROLLBACK;

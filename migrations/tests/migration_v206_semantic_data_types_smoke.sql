-- Catalog and transactional smoke checks for
-- migration_v206_semantic_data_types.sql.
-- Run after v206 is applied. All fixture mutations are rolled back.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';

DO $v206_catalog$
DECLARE
  v_type_id bigint;
  v_codes text[];
  v_names text[];
  v_sorts integer[];
  v_table text;
BEGIN
  SELECT category_type.id
  INTO v_type_id
  FROM public.category_type AS category_type
  WHERE category_type.namespace = 'common'
    AND category_type.code = 'data_type'
    AND category_type.name = 'Loại dữ liệu'
    AND category_type.managed_by = 'system'
    AND category_type.is_active = true;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'v206_smoke: common/data_type is missing';
  END IF;

  SELECT
    array_agg(item.code ORDER BY item.sort_order, item.id),
    array_agg(item.name ORDER BY item.sort_order, item.id),
    array_agg(item.sort_order ORDER BY item.sort_order, item.id)
  INTO v_codes, v_names, v_sorts
  FROM public.category_item AS item
  WHERE item.category_type_id = v_type_id
    AND item.managed_by = 'system'
    AND item.is_active = true;

  IF v_codes IS DISTINCT FROM ARRAY[
      'phone', 'email', 'facebook_search_keyword', 'facebook_post_url',
      'facebook_person', 'facebook_group', 'facebook_page',
      'facebook_page_inbox_customer', 'zalo_person', 'zalo_group'
    ]::text[]
    OR v_names IS DISTINCT FROM ARRAY[
      'Số điện thoại', 'Email', 'Facebook · Từ khóa tìm kiếm',
      'Facebook · Link bài viết', 'Facebook · User', 'Facebook · Group',
      'Facebook · Page', 'Facebook · Khách inbox Page',
      'Zalo · User theo UID', 'Zalo · Group/link'
    ]::text[]
    OR v_sorts IS DISTINCT FROM
      ARRAY[10, 20, 30, 40, 50, 60, 70, 80, 90, 100]::integer[]
  THEN
    RAISE EXCEPTION 'v206_smoke: semantic catalog is not the exact seed';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'auto_account_contact_groups',
    'auto_account_contacts_dataset',
    'auto_account_contact_group_member_origins',
    'auto_campaign_input_data',
    'auto_campaign_action_data_types',
    'auto_automation',
    'auto_automation_detail'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = 'data_type_category_item_id'
        AND data_type = 'bigint'
        AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'v206_smoke: %.data_type_category_item_id is missing',
        v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = ANY(constraint_row.conkey)
      WHERE constraint_row.conrelid =
          pg_catalog.to_regclass('public.' || v_table)
        AND constraint_row.contype = 'f'
        AND constraint_row.confrelid = 'public.category_item'::regclass
        AND constraint_row.confdeltype = 'r'
        AND attribute.attname = 'data_type_category_item_id'
    ) THEN
      RAISE EXCEPTION 'v206_smoke: % semantic FK is invalid', v_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'auto_account_contacts',
        'auto_account_contact_group_members'
      )
      AND column_name = 'data_type_category_item_id'
  ) THEN
    RAISE EXCEPTION 'v206_smoke: semantic type leaked onto contact/membership';
  END IF;
END;
$v206_catalog$;

DO $v206_action_mappings$
DECLARE
  v_phone_id bigint :=
    public.aka_agent_data_type_category_item_id('phone');
  v_zalo_person_id bigint :=
    public.aka_agent_data_type_category_item_id('zalo_person');
  v_mapping_codes text[];
  v_bad_item_id bigint;
BEGIN
  SELECT array_agg(item.code ORDER BY item.sort_order)
  INTO v_mapping_codes
  FROM public.auto_campaign_action_data_types AS mapping
  JOIN public.category_item AS item
    ON item.id = mapping.data_type_category_item_id
  WHERE mapping.campaign_action_id = 'facebook_comment_seeding'
    AND mapping.is_active = true
    AND mapping.is_delete = false
    AND mapping.can_target = true;
  IF v_mapping_codes IS DISTINCT FROM
    ARRAY['facebook_person', 'facebook_group', 'facebook_page']::text[]
  THEN
    RAISE EXCEPTION 'v206_smoke: comment-seeding semantic mapping drifted';
  END IF;

  SELECT array_agg(item.code ORDER BY item.sort_order)
  INTO v_mapping_codes
  FROM public.auto_campaign_action_data_types AS mapping
  JOIN public.category_item AS item
    ON item.id = mapping.data_type_category_item_id
  WHERE mapping.campaign_action_id = 'zalo_add_group_member'
    AND mapping.is_active = true
    AND mapping.is_delete = false;
  IF v_mapping_codes IS DISTINCT FROM ARRAY['phone', 'zalo_person']::text[]
  THEN
    RAISE EXCEPTION 'v206_smoke: add-group-member mapping drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_index AS index_row
      ON index_row.indexrelid = constraint_row.conindid
    WHERE constraint_row.conrelid =
        'public.auto_campaign_action_data_types'::regclass
      AND constraint_row.conname =
        'uq_auto_campaign_action_semantic_data_type'
      AND constraint_row.contype = 'u'
      AND index_row.indnullsnotdistinct = true
  ) THEN
    RAISE EXCEPTION 'v206_smoke: semantic action identity is invalid';
  END IF;

  SELECT item.id
  INTO v_bad_item_id
  FROM public.category_item AS item
  JOIN public.category_type AS category_type
    ON category_type.id = item.category_type_id
  WHERE category_type.namespace = 'common'
    AND category_type.code = 'data_source'
    AND item.code = 'upload';
  IF v_bad_item_id IS NULL THEN
    RAISE EXCEPTION 'v206_smoke: data_source fixture is missing';
  END IF;

  BEGIN
    UPDATE public.auto_campaign_action_data_types
    SET data_type_category_item_id = v_bad_item_id
    WHERE campaign_action_id = 'zalo_message_phone'
      AND data_type_category_item_id = v_phone_id;
    RAISE EXCEPTION 'v206_smoke: wrong category type was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%invalid_data_type_category_item%' THEN
      RAISE;
    END IF;
  END;

  IF v_phone_id IS NULL OR v_zalo_person_id IS NULL THEN
    RAISE EXCEPTION 'v206_smoke: lookup helpers failed';
  END IF;
END;
$v206_action_mappings$;

DO $v206_rpc_contracts$
DECLARE
  v_signature text;
  v_oid oid;
  v_names text[];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)',
    'public.aka_agent_create_data_group(bigint,bigint,text,text,text,bigint,text,text)',
    'public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer,bigint,boolean,text,text)',
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)',
    'public.aka_agent_list_data_group_datasets(bigint,bigint,bigint,text,text)',
    'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)',
    'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint)',
    'public.aka_agent_save_upload_contact_datasets(bigint,bigint,bigint[],text,text,text,text,text,text,text,text,jsonb,jsonb,bigint)',
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)',
    'public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamptz,text,boolean,jsonb,bigint,text,text,integer,text,time without time zone,time without time zone,boolean)',
    'public.claim_auto_automation_details(bigint,bigint,text,integer,text,text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'v206_smoke: RPC % is missing', v_signature;
    END IF;
  END LOOP;

  SELECT routine.proargnames
  INTO v_names
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = pg_catalog.to_regprocedure(
    'public.claim_auto_automation_details(bigint,bigint,text,integer,text,text)'
  );
  IF NOT v_names @> ARRAY[
    'data_type_category_item_id',
    'data_type_category_code',
    'data_type_category_name'
  ]::text[] THEN
    RAISE EXCEPTION 'v206_smoke: automation claim semantic outputs missing';
  END IF;

  SELECT routine.proargnames
  INTO v_names
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = pg_catalog.to_regprocedure(
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer)'
  );
  IF NOT v_names @> ARRAY[
    'data_type_category_item_id', 'data_type_code', 'data_type_name',
    'group_data_type_category_item_id', 'group_data_type_code',
    'group_data_type_name'
  ]::text[] THEN
    RAISE EXCEPTION 'v206_smoke: member semantic outputs missing';
  END IF;

  IF has_function_privilege(
      'anon',
      'public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,boolean)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,boolean)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'anon',
      'public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'authenticated',
      'public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamptz,text,boolean,jsonb,bigint,text,text,integer,text,time without time zone,time without time zone,boolean)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.aka_agent_data_group_membership_semantic_compatible(bigint,text,bigint)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.aka_agent_internal_route_data_group_member_v205_internal(bigint,bigint,bigint,bigint)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v206_smoke: RPC ACL contract regressed';
  END IF;
END;
$v206_rpc_contracts$;

DO $v206_invariants$
DECLARE
  v_definition text;
  v_phone_id bigint :=
    public.aka_agent_data_type_category_item_id('phone');
  v_email_id bigint :=
    public.aka_agent_data_type_category_item_id('email');
  v_phone_key text;
  v_email_key text;
BEGIN
  v_phone_key := public.aka_agent_internal_dataset_auto_group_key(
    'upload', 42, 'facebook', 'campaign_input', 'upload_data',
    'same-name:42', v_phone_id
  );
  v_email_key := public.aka_agent_internal_dataset_auto_group_key(
    'upload', 42, 'facebook', 'campaign_input', 'upload_data',
    'same-name:42', v_email_id
  );
  IF v_phone_key IS NOT DISTINCT FROM v_email_key THEN
    RAISE EXCEPTION 'v206_smoke: dataset/group identity ignores semantic type';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.source = 'upload'
      AND dataset.account_id IS NOT NULL
      AND dataset.group_id IS NULL
      AND dataset.is_delete = false
      AND right(
        dataset.source_key,
        length(':' || dataset.account_id::text)
      ) = ':' || dataset.account_id::text
      AND dataset.source_key !~ (
        ':data-type:[^:]+:' || dataset.account_id::text || '$'
      )
  ) THEN
    RAISE EXCEPTION
      'v206_smoke: legacy upload dataset identity was not backfilled';
  END IF;

  IF EXISTS (
    WITH owned_keys AS (
      SELECT
        contact_group.id,
        contact_group.dataset_sync_key,
        public.aka_agent_internal_dataset_auto_group_key(
          dataset.source,
          dataset.account_id,
          dataset.flatform_type,
          dataset.contact_type,
          dataset.scan_type,
          dataset.source_key,
          dataset.data_type_category_item_id
        ) AS semantic_key
      FROM public.auto_account_contact_groups AS contact_group
      JOIN public.auto_account_contacts_dataset AS dataset
        ON dataset.auto_data_group_id = contact_group.id
       AND dataset.group_id IS NULL
       AND dataset.is_delete = false
      WHERE contact_group.purpose = 'data_group'
        AND contact_group.dataset_sync_mode = 'dataset_auto'
        AND contact_group.is_delete = false
    ),
    uniform_groups AS (
      SELECT
        id,
        min(dataset_sync_key) AS dataset_sync_key,
        min(semantic_key) AS semantic_key
      FROM owned_keys
      GROUP BY id
      HAVING count(DISTINCT semantic_key) = 1
    )
    SELECT 1
    FROM uniform_groups
    WHERE dataset_sync_key IS DISTINCT FROM semantic_key
  ) THEN
    RAISE EXCEPTION
      'v206_smoke: uniform dataset-owned group kept a legacy sync key';
  END IF;

  PERFORM set_config(
    'aka_agent.data_type_category_item_id', 'null', true
  );
  IF NOT public.aka_agent_data_type_context_present()
    OR public.aka_agent_current_data_type_category_item_id() IS NOT NULL
  THEN
    RAISE EXCEPTION 'v206_smoke: explicit NULL semantic context is invalid';
  END IF;
  PERFORM set_config(
    'aka_agent.data_type_category_item_id', '', true
  );

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_guard_data_group_semantic_type()'::regprocedure
  ) INTO v_definition;
  IF position(
      'data_group_active_campaign_semantic_type_mismatch' IN v_definition
    ) = 0
    OR position(
      'data_group_active_automation_semantic_type_mismatch' IN v_definition
    ) = 0
    OR position('mapping.can_target = true' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'v206_smoke: group retype guards are incomplete';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_guard_automation_semantic_type()'::regprocedure
  ) INTO v_definition;
  IF position(
      'legacy_automation_requires_unrestricted_data_group' IN v_definition
    ) = 0
    OR position('v_context_present' IN v_definition) = 0
    OR position('v_effective_type' IN v_definition) = 0
    OR position(
      'NEW.data_type_category_item_id IS NULL' IN v_definition
    ) = 0
  THEN
    RAISE EXCEPTION
      'v206_smoke: automation semantic transition guard is incomplete';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamptz,text,boolean,jsonb,bigint,text,text,integer,text,time without time zone,time without time zone,boolean)'::regprocedure
  ) INTO v_definition;
  IF position(
      'automation.data_type_category_item_id IS DISTINCT FROM' IN
        v_definition
    ) = 0
    OR position(
      'automation.data_type_category_item_id IS NOT DISTINCT FROM' IN
        v_definition
    ) = 0
  THEN
    RAISE EXCEPTION
      'v206_smoke: automation save semantic transition is not selective';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_stamp_dataset_semantic_type()'::regprocedure
  ) INTO v_definition;
  IF position('v_context_present' IN v_definition) = 0
    OR position(
      'NEW.data_type_category_item_id := v_context_type' IN v_definition
    ) = 0
  THEN
    RAISE EXCEPTION
      'v206_smoke: explicit dataset semantic context is not authoritative';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'::regprocedure
  ) INTO v_definition;
  IF position('aka_agent_data_group_type_compatible' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'v206_smoke: direct snapshot semantic guard missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'::regprocedure
  ) INTO v_definition;
  IF position(
    'aka_agent_data_group_membership_semantic_compatible' IN v_definition
  ) = 0
    OR position(
      'data_group_member_semantic_type_mismatch' IN v_definition
    ) = 0
  THEN
    RAISE EXCEPTION
      'v206_smoke: live Data Group member semantic filter missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'::regprocedure
  ) INTO v_definition;
  IF position(
    'aka_agent_data_group_membership_semantic_compatible' IN v_definition
  ) = 0
  THEN
    RAISE EXCEPTION
      'v206_smoke: direct snapshot member semantic filter missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_ensure_dataset_auto_data_group()'::regprocedure
  ) INTO v_definition;
  IF position('v_preserve_legacy_group' IN v_definition) = 0
    OR position('v_owned_semantic_key_count' IN v_definition) = 0
  THEN
    RAISE EXCEPTION
      'v206_smoke: legacy dataset-owned group reuse is missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_enqueue_campaign_detail_automations()'::regprocedure
  ) INTO v_definition;
  IF position('source_mapping.data_type_category_item_id' IN v_definition) = 0
    OR position('target_mapping.data_type_category_item_id' IN v_definition) = 0
    OR position('source_input.data_type_category_item_id' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'v206_smoke: typed automation enqueue filter missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)'::regprocedure
  ) INTO v_definition;
  IF position('data_group_move_semantic_type_mismatch' IN v_definition) = 0
    OR position('origin.data_type_category_item_id' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'v206_smoke: move does not preserve/validate semantic type';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_save_upload_contact_datasets(bigint,bigint,bigint[],text,text,text,text,text,text,text,text,jsonb,jsonb,bigint)'::regprocedure
  ) INTO v_definition;
  IF position(''':data-type:''' IN v_definition) = 0
    OR position('v_effective_type' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'v206_smoke: upload dataset identity ignores semantic type';
  END IF;
END;
$v206_invariants$;

ROLLBACK;

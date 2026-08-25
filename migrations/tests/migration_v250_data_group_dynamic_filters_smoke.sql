-- Rollback smoke test for migration_v250_data_group_dynamic_filters.sql.
-- Run only after v250 is applied. All fixture mutations are rolled back.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $contract$
DECLARE
  v_code text;
BEGIN
  FOREACH v_code IN ARRAY ARRAY[
    'data_filter_scope',
    'data_filter_join',
    'data_filter_operator',
    'data_filter_field',
    'zalo_friend_status',
    'data_filter_queue_reason'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.category_type
      WHERE namespace = 'common' AND code = v_code AND is_active = true
    ) THEN
      RAISE EXCEPTION 'v250_smoke:missing_category_type:%', v_code;
    END IF;
  END LOOP;

  IF public.aka_agent_data_group_source_code('dynamic_filter')
      IS DISTINCT FROM 'dynamic_filter'
    OR pg_catalog.to_regclass(
      'public.auto_account_contact_group_dynamic_filters'
    ) IS NULL
    OR pg_catalog.to_regclass(
      'public.auto_account_contact_group_dynamic_filter_rules'
    ) IS NULL
    OR pg_catalog.to_regclass(
      'public.auto_account_contact_dynamic_filter_queue'
    ) IS NULL
  THEN
    RAISE EXCEPTION 'v250_smoke:schema_contract';
  END IF;

  IF pg_catalog.has_function_privilege(
      'anon',
      'public.aka_agent_data_group_dynamic_values_match(bigint,text,text[])',
      'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v250_smoke:function_acl_contract';
  END IF;
END;
$contract$;

DO $behavior$
DECLARE
  v_account record;
  v_group_id bigint := 925000000000000 + pg_catalog.txid_current();
  v_filter_id bigint;
  v_contact_a bigint;
  v_contact_c bigint;
  v_contact_fail bigint;
  v_data_type_id bigint := public.aka_agent_data_type_category_item_id('zalo_person');
  v_uid_prefix text := 'v250-smoke-' || pg_catalog.txid_current()::text || '-';
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
    RAISE NOTICE 'v250_smoke:no_zalo_account_fixture; behavior skipped';
    RETURN;
  END IF;
  IF v_data_type_id IS NULL THEN
    RAISE EXCEPTION 'v250_smoke:zalo_person_category_missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups WHERE id = v_group_id
  ) THEN
    RAISE EXCEPTION 'v250_smoke:reserved_group_id_collision';
  END IF;

  INSERT INTO public.auto_account_contact_groups (
    id, account_id, contact_type, name, purpose,
    staff_id, organization_id, data_type_category_item_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_group_id, NULL, NULL, '__v250_dynamic_filter__', 'data_group',
    v_account.staff_id, v_account.organization_id, v_data_type_id, false
  );

  INSERT INTO public.auto_account_contacts (
    account_id, contact_type, name, uid, extra_data,
    flatform_type, is_friend, is_joined,
    staff_id, organization_id, is_delete
  ) VALUES (
    v_account.id, 'person', '__v250_and_branch__', v_uid_prefix || 'and',
    '{"zaloTagIds":["A"]}'::jsonb,
    'zalo', true, false,
    v_account.staff_id, v_account.organization_id, false
  ) RETURNING id INTO v_contact_a;

  INSERT INTO public.auto_account_contacts (
    account_id, contact_type, name, uid, extra_data,
    flatform_type, is_friend, is_joined,
    staff_id, organization_id, is_delete
  ) VALUES (
    v_account.id, 'person', '__v250_or_branch__', v_uid_prefix || 'or',
    '{"zaloTagIds":["C"]}'::jsonb,
    'zalo', false, false,
    v_account.staff_id, v_account.organization_id, false
  ) RETURNING id INTO v_contact_c;

  INSERT INTO public.auto_account_contacts (
    account_id, contact_type, name, uid, extra_data,
    flatform_type, is_friend, is_joined,
    staff_id, organization_id, is_delete
  ) VALUES (
    v_account.id, 'person', '__v250_fail_branch__', v_uid_prefix || 'fail',
    '{"zaloTagIds":["A"]}'::jsonb,
    'zalo', false, false,
    v_account.staff_id, v_account.organization_id, false
  ) RETURNING id INTO v_contact_fail;

  INSERT INTO public.auto_account_contact_group_dynamic_filters (
    group_id, staff_id, organization_id, is_enabled, revision
  ) VALUES (
    v_group_id, v_account.staff_id, v_account.organization_id, true, 1
  ) RETURNING id INTO v_filter_id;

  WITH rule_seed(sort_order, join_code, field_code, operator_code, value_keys, value_labels) AS (
    VALUES
      (0, 'and', 'zalo_tag', 'contains', '["A"]'::jsonb, '["Tag A"]'::jsonb),
      (1, 'and', 'zalo_friend_status', 'equals', '["friend"]'::jsonb, '["Đã là bạn"]'::jsonb),
      (2, 'or', 'zalo_tag', 'contains', '["C"]'::jsonb, '["Tag C"]'::jsonb)
  )
  INSERT INTO public.auto_account_contact_group_dynamic_filter_rules (
    dynamic_filter_id, scope_category_item_id, join_category_item_id,
    field_category_item_id, operator_category_item_id,
    account_id, sort_order, value_keys, value_labels
  )
  SELECT
    v_filter_id, scope_item.id, join_item.id, field_item.id, operator_item.id,
    v_account.id, rule_seed.sort_order, rule_seed.value_keys, rule_seed.value_labels
  FROM rule_seed
  JOIN public.category_type AS scope_type
    ON scope_type.namespace = 'common' AND scope_type.code = 'data_filter_scope'
  JOIN public.category_item AS scope_item
    ON scope_item.category_type_id = scope_type.id AND scope_item.code = 'enter'
  JOIN public.category_type AS join_type
    ON join_type.namespace = 'common' AND join_type.code = 'data_filter_join'
  JOIN public.category_item AS join_item
    ON join_item.category_type_id = join_type.id AND join_item.code = rule_seed.join_code
  JOIN public.category_type AS field_type
    ON field_type.namespace = 'common' AND field_type.code = 'data_filter_field'
  JOIN public.category_item AS field_item
    ON field_item.category_type_id = field_type.id AND field_item.code = rule_seed.field_code
  JOIN public.category_type AS operator_type
    ON operator_type.namespace = 'common' AND operator_type.code = 'data_filter_operator'
  JOIN public.category_item AS operator_item
    ON operator_item.category_type_id = operator_type.id AND operator_item.code = rule_seed.operator_code;

  -- Required behavior: (A AND B) OR C.
  IF public.aka_agent_data_group_dynamic_scope_matches(
      v_filter_id, v_contact_a, 'enter'
    ) IS DISTINCT FROM true
    OR public.aka_agent_data_group_dynamic_scope_matches(
      v_filter_id, v_contact_c, 'enter'
    ) IS DISTINCT FROM true
    OR public.aka_agent_data_group_dynamic_scope_matches(
      v_filter_id, v_contact_fail, 'enter'
    ) IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'v250_smoke:and_or_semantics';
  END IF;

  UPDATE public.auto_account_contacts
  SET extra_data = extra_data || '{"smokeChanged":true}'::jsonb
  WHERE id = v_contact_a;

  IF (SELECT count(*) FROM public.auto_account_contact_dynamic_filter_queue
      WHERE contact_id = v_contact_a) <> 1
  THEN
    RAISE EXCEPTION 'v250_smoke:contact_queue_not_deduplicated';
  END IF;

  RAISE NOTICE 'v250 dynamic-filter smoke passed';
END;
$behavior$;

ROLLBACK;

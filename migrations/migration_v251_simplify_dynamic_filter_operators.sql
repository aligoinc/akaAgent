-- Give each dynamic-filter field one unambiguous pair of operators.
--
-- This migration intentionally leaves the evaluator RPCs unchanged. Their
-- synonym support remains backward-compatible, while stored rules and the
-- category-backed UI catalog are normalized to the canonical operators.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $preflight$
DECLARE
  v_field_count integer;
  v_operator_count integer;
  v_invalid_count integer;
BEGIN
  IF pg_catalog.to_regclass('public.auto_account_contact_group_dynamic_filter_rules') IS NULL THEN
    RAISE EXCEPTION 'v251_dynamic_filter_rules_table_missing';
  END IF;

  SELECT count(*) INTO v_field_count
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common'
    AND type.code = 'data_filter_field'
    AND item.code IN (
      'zalo_tag', 'akabiz_tag', 'zalo_group_membership', 'zalo_friend_status'
    );

  IF v_field_count <> 4 THEN
    RAISE EXCEPTION 'v251_dynamic_filter_field_catalog_incomplete:%', v_field_count;
  END IF;

  SELECT count(*) INTO v_operator_count
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common'
    AND type.code = 'data_filter_operator'
    AND item.code IN (
      'contains', 'not_contains', 'equals', 'not_equals', 'in', 'out'
    );

  IF v_operator_count <> 6 THEN
    RAISE EXCEPTION 'v251_dynamic_filter_operator_catalog_incomplete:%', v_operator_count;
  END IF;

  SELECT count(*) INTO v_invalid_count
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common'
    AND type.code = 'data_filter_field'
    AND item.code IN (
      'zalo_tag', 'akabiz_tag', 'zalo_group_membership', 'zalo_friend_status'
    )
    AND (
      (item.code IN ('zalo_tag', 'akabiz_tag') AND item.metadata->'operators' IN (
        '["contains", "not_contains", "equals", "not_equals"]'::jsonb,
        '["contains", "not_contains"]'::jsonb
      ))
      OR (item.code = 'zalo_group_membership' AND item.metadata->'operators' IN (
        '["in", "out", "equals", "not_equals"]'::jsonb,
        '["in", "out"]'::jsonb
      ))
      OR (item.code = 'zalo_friend_status' AND item.metadata->'operators' IN (
        '["equals", "not_equals", "in", "out"]'::jsonb,
        '["equals", "not_equals"]'::jsonb
      ))
    ) IS NOT TRUE;

  IF v_invalid_count <> 0 THEN
    RAISE EXCEPTION 'v251_dynamic_filter_field_catalog_changed:%', v_invalid_count;
  END IF;
END;
$preflight$;

WITH operator_mapping(field_code, source_operator_code, target_operator_code) AS (
  VALUES
    ('zalo_tag', 'equals', 'contains'),
    ('zalo_tag', 'not_equals', 'not_contains'),
    ('akabiz_tag', 'equals', 'contains'),
    ('akabiz_tag', 'not_equals', 'not_contains'),
    ('zalo_group_membership', 'equals', 'in'),
    ('zalo_group_membership', 'not_equals', 'out'),
    ('zalo_friend_status', 'in', 'equals'),
    ('zalo_friend_status', 'out', 'not_equals')
), resolved_mapping AS (
  SELECT
    field_item.id AS field_id,
    source_operator.id AS source_operator_id,
    target_operator.id AS target_operator_id
  FROM operator_mapping AS mapping
  JOIN public.category_type AS field_type
    ON field_type.namespace = 'common'
   AND field_type.code = 'data_filter_field'
  JOIN public.category_item AS field_item
    ON field_item.category_type_id = field_type.id
   AND field_item.code = mapping.field_code
  JOIN public.category_type AS operator_type
    ON operator_type.namespace = 'common'
   AND operator_type.code = 'data_filter_operator'
  JOIN public.category_item AS source_operator
    ON source_operator.category_type_id = operator_type.id
   AND source_operator.code = mapping.source_operator_code
  JOIN public.category_item AS target_operator
    ON target_operator.category_type_id = operator_type.id
   AND target_operator.code = mapping.target_operator_code
)
UPDATE public.auto_account_contact_group_dynamic_filter_rules AS rule
SET
  operator_category_item_id = mapping.target_operator_id,
  updated_at = clock_timestamp()
FROM resolved_mapping AS mapping
WHERE rule.field_category_item_id = mapping.field_id
  AND rule.operator_category_item_id = mapping.source_operator_id;

UPDATE public.category_item AS item
SET
  metadata = jsonb_set(
    COALESCE(item.metadata, '{}'::jsonb),
    '{operators}',
    CASE
      WHEN item.code IN ('zalo_tag', 'akabiz_tag')
        THEN '["contains", "not_contains"]'::jsonb
      WHEN item.code = 'zalo_group_membership'
        THEN '["in", "out"]'::jsonb
      WHEN item.code = 'zalo_friend_status'
        THEN '["equals", "not_equals"]'::jsonb
    END,
    true
  ),
  updated_at = clock_timestamp()
FROM public.category_type AS type
WHERE item.category_type_id = type.id
  AND type.namespace = 'common'
  AND type.code = 'data_filter_field'
  AND item.code IN (
    'zalo_tag', 'akabiz_tag', 'zalo_group_membership', 'zalo_friend_status'
  );

COMMIT;

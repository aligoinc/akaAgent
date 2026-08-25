BEGIN;

DO $smoke$
DECLARE
  v_field_count integer;
  v_invalid_metadata_count integer;
  v_noncanonical_rule_count integer;
BEGIN
  SELECT count(*) INTO v_field_count
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common'
    AND type.code = 'data_filter_field'
    AND item.code IN (
      'zalo_tag', 'akabiz_tag', 'zalo_group_membership', 'zalo_friend_status'
    );

  IF v_field_count <> 4 THEN
    RAISE EXCEPTION 'v251_smoke_field_catalog_incomplete:%', v_field_count;
  END IF;

  SELECT count(*) INTO v_invalid_metadata_count
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common'
    AND type.code = 'data_filter_field'
    AND (
      (item.code IN ('zalo_tag', 'akabiz_tag')
        AND item.metadata->'operators' IS DISTINCT FROM '["contains", "not_contains"]'::jsonb)
      OR (item.code = 'zalo_group_membership'
        AND item.metadata->'operators' IS DISTINCT FROM '["in", "out"]'::jsonb)
      OR (item.code = 'zalo_friend_status'
        AND item.metadata->'operators' IS DISTINCT FROM '["equals", "not_equals"]'::jsonb)
    );

  IF v_invalid_metadata_count <> 0 THEN
    RAISE EXCEPTION 'v251_smoke_invalid_operator_metadata:%', v_invalid_metadata_count;
  END IF;

  SELECT count(*) INTO v_noncanonical_rule_count
  FROM public.auto_account_contact_group_dynamic_filter_rules AS rule
  JOIN public.category_item AS field_item ON field_item.id = rule.field_category_item_id
  JOIN public.category_item AS operator_item ON operator_item.id = rule.operator_category_item_id
  WHERE (field_item.code IN ('zalo_tag', 'akabiz_tag')
      AND operator_item.code NOT IN ('contains', 'not_contains'))
    OR (field_item.code = 'zalo_group_membership'
      AND operator_item.code NOT IN ('in', 'out'))
    OR (field_item.code = 'zalo_friend_status'
      AND operator_item.code NOT IN ('equals', 'not_equals'));

  IF v_noncanonical_rule_count <> 0 THEN
    RAISE EXCEPTION 'v251_smoke_noncanonical_rules:%', v_noncanonical_rule_count;
  END IF;
END;
$smoke$;

ROLLBACK;

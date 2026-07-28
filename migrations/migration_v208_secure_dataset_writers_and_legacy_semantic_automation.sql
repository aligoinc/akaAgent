-- v208
-- 1. Keep semantic dataset writers behind the same process-only identity
--    contract as the other desktop RPCs.
-- 2. Preserve transport-only automation rules when an action has more than
--    one semantic category (notably mixed Facebook comment-seeding input).

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_contact_dataset(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_id bigint,
  p_scan_type text,
  p_contact_type text,
  p_source_key text,
  p_name text,
  p_link text,
  p_description text,
  p_status text,
  p_contact_uids text[],
  p_extra_data jsonb,
  p_data_type_category_item_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS SETOF public.auto_account_contacts_dataset
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT *
  FROM public.aka_agent_finalize_contact_dataset(
    p_staff_id,
    p_organization_id,
    p_account_id,
    p_scan_type,
    p_contact_type,
    p_source_key,
    p_name,
    p_link,
    p_description,
    p_status,
    p_contact_uids,
    p_extra_data,
    p_data_type_category_item_id
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_save_upload_contact_datasets(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_ids bigint[],
  p_name text,
  p_flatform_type text,
  p_contact_type text,
  p_action_id text,
  p_import_source text,
  p_source_link text,
  p_description text,
  p_source_key_prefix text,
  p_contacts jsonb,
  p_extra_data jsonb,
  p_data_type_category_item_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS SETOF public.auto_account_contacts_dataset
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT *
  FROM public.aka_agent_save_upload_contact_datasets(
    p_staff_id,
    p_organization_id,
    p_account_ids,
    p_name,
    p_flatform_type,
    p_contact_type,
    p_action_id,
    p_import_source,
    p_source_link,
    p_description,
    p_source_key_prefix,
    p_contacts,
    p_extra_data,
    p_data_type_category_item_id
  );
$$;

ALTER FUNCTION public.aka_agent_save_upload_contact_datasets(
  bigint, bigint, bigint[], text, text, text, text, text, text, text,
  text, jsonb, jsonb, bigint, text, text
)
SET statement_timeout TO '120s';

REVOKE ALL ON FUNCTION public.aka_agent_finalize_contact_dataset(
  bigint, bigint, bigint, text, text, text, text, text, text, text,
  text[], jsonb, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_finalize_contact_dataset(
  bigint, bigint, bigint, text, text, text, text, text, text, text,
  text[], jsonb, bigint
) TO service_role;

REVOKE ALL ON FUNCTION public.aka_agent_save_upload_contact_datasets(
  bigint, bigint, bigint[], text, text, text, text, text, text, text,
  text, jsonb, jsonb, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_save_upload_contact_datasets(
  bigint, bigint, bigint[], text, text, text, text, text, text, text,
  text, jsonb, jsonb, bigint
) TO service_role;

REVOKE ALL ON FUNCTION public.aka_agent_finalize_contact_dataset(
  bigint, bigint, bigint, text, text, text, text, text, text, text,
  text[], jsonb, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_finalize_contact_dataset(
  bigint, bigint, bigint, text, text, text, text, text, text, text,
  text[], jsonb, bigint, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_save_upload_contact_datasets(
  bigint, bigint, bigint[], text, text, text, text, text, text, text,
  text, jsonb, jsonb, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_save_upload_contact_datasets(
  bigint, bigint, bigint[], text, text, text, text, text, text, text,
  text, jsonb, jsonb, bigint, text, text
) TO anon, authenticated, service_role;

DO $v208_patch_automation_validator$
DECLARE
  v_signature regprocedure := COALESCE(
    pg_catalog.to_regprocedure(
      'public.auto_validate_automation_rule_v176_internal(bigint,bigint,bigint,bigint,bigint,text,bigint,text,integer,integer,timestamptz,boolean,boolean,integer,text,time without time zone)'
    ),
    pg_catalog.to_regprocedure(
      'public.auto_validate_automation_rule_v173_internal(bigint,bigint,bigint,bigint,bigint,text,bigint,text,integer,integer,timestamptz,boolean,boolean,integer,text,time without time zone)'
    )
  );
  v_definition text;
  v_source_current text :=
    'AND mapping.data_type_code = p_data_type_code
      AND mapping.data_type_category_item_id IS NOT DISTINCT FROM
        COALESCE(
          public.aka_agent_current_data_type_category_item_id(),
          public.aka_agent_legacy_action_semantic_type(
            v_source.action_id, p_data_type_code
          )
        )
      AND mapping.can_source = true';
  v_source_fixed text :=
    'AND mapping.data_type_code = p_data_type_code
      AND (
        public.aka_agent_current_data_type_category_item_id() IS NULL
        OR mapping.data_type_category_item_id =
          public.aka_agent_current_data_type_category_item_id()
      )
      AND mapping.can_source = true';
  v_target_current text :=
    'AND mapping.data_type_code = p_data_type_code
    AND mapping.data_type_category_item_id IS NOT DISTINCT FROM
      COALESCE(
        public.aka_agent_current_data_type_category_item_id(),
        public.aka_agent_legacy_action_semantic_type(
          v_target.action_id, p_data_type_code
        )
      )
    AND mapping.can_target = true';
  v_target_fixed text :=
    'AND mapping.data_type_code = p_data_type_code
    AND (
      public.aka_agent_current_data_type_category_item_id() IS NULL
      OR mapping.data_type_category_item_id =
        public.aka_agent_current_data_type_category_item_id()
    )
    AND mapping.can_target = true';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_automation_rule_validator';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, v_source_fixed) = 0 THEN
    IF pg_catalog.strpos(v_definition, v_source_current) = 0
      OR pg_catalog.strpos(v_definition, v_target_current) = 0
    THEN
      RAISE EXCEPTION 'unexpected_v206_automation_rule_validator_shape';
    END IF;
    v_definition := pg_catalog.replace(
      v_definition, v_source_current, v_source_fixed
    );
    v_definition := pg_catalog.replace(
      v_definition, v_target_current, v_target_fixed
    );
    EXECUTE v_definition;
  END IF;
END;
$v208_patch_automation_validator$;

DO $v208_patch_automation_enqueue$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_source_current text :=
    'AND source_mapping.is_delete = false
   AND source_mapping.data_type_category_item_id IS NOT DISTINCT FROM
     COALESCE(
       automation.data_type_category_item_id,
       public.aka_agent_legacy_action_semantic_type(
         source_campaign.action_id, automation.data_type_code
       )
     )
   AND (
     automation.data_type_category_item_id IS NULL
     OR source_input.data_type_category_item_id =
       automation.data_type_category_item_id
   )';
  v_source_fixed text :=
    'AND source_mapping.is_delete = false
   AND (
     automation.data_type_category_item_id IS NULL
     OR (
       source_mapping.data_type_category_item_id =
         automation.data_type_category_item_id
       AND source_input.data_type_category_item_id =
         automation.data_type_category_item_id
     )
   )';
  v_target_current text :=
    'AND target_mapping.is_delete = false
   AND target_mapping.data_type_category_item_id IS NOT DISTINCT FROM
     COALESCE(
       automation.data_type_category_item_id,
       public.aka_agent_legacy_action_semantic_type(
         target_campaign.action_id, automation.data_type_code
       )
     )';
  v_target_fixed text :=
    'AND target_mapping.is_delete = false
   AND (
     automation.data_type_category_item_id IS NULL
     OR target_mapping.data_type_category_item_id =
       automation.data_type_category_item_id
   )';
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    pg_catalog.to_regprocedure(
      'public.aka_agent_enqueue_campaign_detail_automations()'
    ),
    pg_catalog.to_regprocedure(
      'public.aka_agent_enqueue_group_only_automations()'
    )
  ] LOOP
    IF v_signature IS NULL THEN
      RAISE EXCEPTION 'missing_automation_enqueue_trigger';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_signature)
    INTO v_definition;

    IF pg_catalog.strpos(v_definition, v_source_fixed) = 0 THEN
      IF pg_catalog.strpos(v_definition, v_source_current) = 0 THEN
        RAISE EXCEPTION
          'unexpected_v206_automation_enqueue_shape:%', v_signature;
      END IF;
      v_definition := pg_catalog.replace(
        v_definition, v_source_current, v_source_fixed
      );
    END IF;

    IF pg_catalog.strpos(v_definition, 'target_mapping') > 0
      AND pg_catalog.strpos(v_definition, v_target_fixed) = 0
    THEN
      IF pg_catalog.strpos(v_definition, v_target_current) = 0 THEN
        RAISE EXCEPTION
          'unexpected_v206_automation_target_shape:%', v_signature;
      END IF;
      v_definition := pg_catalog.replace(
        v_definition, v_target_current, v_target_fixed
      );
    END IF;

    EXECUTE v_definition;
  END LOOP;
END;
$v208_patch_automation_enqueue$;

COMMENT ON FUNCTION public.aka_agent_finalize_contact_dataset(
  bigint, bigint, bigint, text, text, text, text, text, text, text,
  text[], jsonb, bigint, text, text
) IS 'Tenant-authenticated desktop wrapper for semantic dataset finalization.';

COMMENT ON FUNCTION public.aka_agent_save_upload_contact_datasets(
  bigint, bigint, bigint[], text, text, text, text, text, text, text,
  text, jsonb, jsonb, bigint, text, text
) IS 'Tenant-authenticated desktop wrapper for semantic upload dataset writes.';

NOTIFY pgrst, 'reload schema';

COMMIT;

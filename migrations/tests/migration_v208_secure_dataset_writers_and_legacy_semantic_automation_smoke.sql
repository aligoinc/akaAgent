BEGIN;

DO $v208_writer_contracts$
DECLARE
  v_finalize_service regprocedure :=
    pg_catalog.to_regprocedure(
      'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint)'
    );
  v_finalize_client regprocedure :=
    pg_catalog.to_regprocedure(
      'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,text,text)'
    );
  v_upload_service regprocedure :=
    pg_catalog.to_regprocedure(
      'public.aka_agent_save_upload_contact_datasets(bigint,bigint,bigint[],text,text,text,text,text,text,text,text,jsonb,jsonb,bigint)'
    );
  v_upload_client regprocedure :=
    pg_catalog.to_regprocedure(
      'public.aka_agent_save_upload_contact_datasets(bigint,bigint,bigint[],text,text,text,text,text,text,text,text,jsonb,jsonb,bigint,text,text)'
    );
  v_definition text;
BEGIN
  IF v_finalize_service IS NULL
    OR v_finalize_client IS NULL
    OR v_upload_service IS NULL
    OR v_upload_client IS NULL
  THEN
    RAISE EXCEPTION 'v208_smoke: semantic dataset RPC overload missing';
  END IF;

  IF has_function_privilege('anon', v_finalize_service, 'EXECUTE')
    OR has_function_privilege('authenticated', v_finalize_service, 'EXECUTE')
    OR has_function_privilege('anon', v_upload_service, 'EXECUTE')
    OR has_function_privilege('authenticated', v_upload_service, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_finalize_service, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_upload_service, 'EXECUTE')
    OR NOT has_function_privilege('anon', v_finalize_client, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', v_upload_client, 'EXECUTE')
    OR NOT has_function_privilege('anon', v_upload_client, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', v_upload_client, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v208_smoke: semantic dataset writer ACL regressed';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_finalize_client)
  INTO v_definition;
  IF pg_catalog.strpos(
    v_definition, 'auto_assert_automation_identity'
  ) = 0 THEN
    RAISE EXCEPTION 'v208_smoke: finalize wrapper does not authenticate';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_upload_client)
  INTO v_definition;
  IF pg_catalog.strpos(
    v_definition, 'auto_assert_automation_identity'
  ) = 0 THEN
    RAISE EXCEPTION 'v208_smoke: upload wrapper does not authenticate';
  END IF;
END;
$v208_writer_contracts$;

DO $v208_legacy_semantic_automation$
DECLARE
  v_validator regprocedure := COALESCE(
    pg_catalog.to_regprocedure(
      'public.auto_validate_automation_rule_v176_internal(bigint,bigint,bigint,bigint,bigint,text,bigint,text,integer,integer,timestamptz,boolean,boolean,integer,text,time without time zone)'
    ),
    pg_catalog.to_regprocedure(
      'public.auto_validate_automation_rule_v173_internal(bigint,bigint,bigint,bigint,bigint,text,bigint,text,integer,integer,timestamptz,boolean,boolean,integer,text,time without time zone)'
    )
  );
  v_signature regprocedure;
  v_definition text;
BEGIN
  IF v_validator IS NULL THEN
    RAISE EXCEPTION 'v208_smoke: automation validator missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_validator)
  INTO v_definition;
  IF pg_catalog.strpos(
    v_definition,
    'aka_agent_current_data_type_category_item_id() IS NULL'
  ) = 0 THEN
    RAISE EXCEPTION
      'v208_smoke: transport-only automation validator is still ambiguous';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    pg_catalog.to_regprocedure(
      'public.aka_agent_enqueue_campaign_detail_automations()'
    ),
    pg_catalog.to_regprocedure(
      'public.aka_agent_enqueue_group_only_automations()'
    )
  ] LOOP
    IF v_signature IS NULL THEN
      RAISE EXCEPTION 'v208_smoke: automation enqueue trigger missing';
    END IF;
    SELECT pg_catalog.pg_get_functiondef(v_signature)
    INTO v_definition;
    IF pg_catalog.strpos(
      v_definition,
      'automation.data_type_category_item_id IS NULL'
    ) = 0
      OR pg_catalog.strpos(
        v_definition,
        'source_input.data_type_category_item_id'
      ) = 0
    THEN
      RAISE EXCEPTION
        'v208_smoke: legacy/typed automation enqueue split missing';
    END IF;
  END LOOP;
END;
$v208_legacy_semantic_automation$;

ROLLBACK;

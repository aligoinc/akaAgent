BEGIN;

DO $v209_campaign_data_group_source_summaries$
DECLARE
  v_function regprocedure :=
    pg_catalog.to_regprocedure(
      'public.aka_agent_list_campaign_data_group_source_summaries(bigint,bigint,bigint[],text,text)'
    );
  v_definition text;
  v_result text;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'v209_smoke: campaign Data Group summary RPC missing';
  END IF;

  IF NOT has_function_privilege('anon', v_function, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_function, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v209_smoke: campaign Data Group summary RPC ACL regressed';
  END IF;

  SELECT
    pg_catalog.pg_get_functiondef(v_function),
    pg_catalog.pg_get_function_result(v_function)
  INTO v_definition, v_result;

  IF pg_catalog.strpos(v_definition, 'auto_assert_automation_identity') = 0
    OR pg_catalog.strpos(v_definition, 'campaign.staff_id = p_staff_id') = 0
    OR pg_catalog.strpos(v_definition, 'source.organization_id = p_organization_id') = 0
  THEN
    RAISE EXCEPTION 'v209_smoke: campaign Data Group summary RPC is not tenant-authenticated';
  END IF;

  IF pg_catalog.strpos(v_result, 'campaign_id bigint') = 0
    OR pg_catalog.strpos(v_result, 'group_name text') = 0
    OR pg_catalog.strpos(v_result, 'group_is_delete boolean') = 0
    OR pg_catalog.strpos(v_result, 'source_status text') = 0
  THEN
    RAISE EXCEPTION 'v209_smoke: campaign Data Group summary result contract regressed';
  END IF;
END;
$v209_campaign_data_group_source_summaries$;

ROLLBACK;

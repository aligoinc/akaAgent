-- Allow the authenticated Desktop tenant UI to inspect campaign input data
-- for both Desktop-owned and Server-owned Zalo accounts.
--
-- v219 correctly target-guards the service-only core reader, but both
-- credentialed UI wrappers always forced the Desktop target. A Server campaign
-- therefore failed with campaign_not_found even though its input ledger still
-- existed. Resolve the read target from the campaign account after tenant
-- authentication; runtime claim/mutation ownership guards are unchanged.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_input_data_page_core';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_input_data_page_origin_core';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_input_data_page_authenticated_wrapper';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_input_data_page_origin_authenticated_wrapper';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_search text,
  p_status text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_offset integer,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (input_data jsonb, origins jsonb, total_count bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    RETURN QUERY
    SELECT *
    FROM public.aka_agent_list_campaign_input_data_page(
      p_staff_id, p_organization_id, p_campaign_id, p_search, p_status,
      p_date_from, p_date_to, p_offset, p_limit
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_search text,
  p_status text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_origin_filter text,
  p_offset integer,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (input_data jsonb, origins jsonb, total_count bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_runtime_target text := 'desktop';
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT CASE
    WHEN lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
    THEN 'server'
    ELSE 'desktop'
  END
  INTO v_runtime_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL
      OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false;

  v_runtime_target := COALESCE(v_runtime_target, 'desktop');
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', v_runtime_target, true
  );
  BEGIN
    RETURN QUERY
    SELECT *
    FROM public.aka_agent_list_campaign_input_data_page(
      p_staff_id, p_organization_id, p_campaign_id, p_search, p_status,
      p_date_from, p_date_to, p_origin_filter, p_offset, p_limit
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  integer, integer, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  integer, integer, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  text, integer, integer, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  text, integer, integer, text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

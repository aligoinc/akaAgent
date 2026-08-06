-- Route authenticated tenant Data Group campaign operations by the campaign
-- account subtype. The service-only cores remain target-guarded; this only
-- fixes the UI wrappers that v219 left permanently pinned to Desktop.

BEGIN;

DO $preflight$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint,text,text)',
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint,text,text)',
    'public.aka_agent_get_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)',
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'v224 preflight: missing authenticated wrapper: %', v_signature;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_preflight_campaign_data_group_change(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_group_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (allowed boolean, reason text, canonical_count bigint)
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
    FROM public.aka_agent_preflight_campaign_data_group_change(
      p_staff_id, p_organization_id, p_campaign_id, p_group_id
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

CREATE OR REPLACE FUNCTION public.aka_agent_bind_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_campaign_id bigint,
  p_group_id bigint,
  p_bundle_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
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
  v_result jsonb;
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
    v_result := public.aka_agent_bind_campaign_data_group_source(
      p_staff_id, p_organization_id, p_request_id, p_campaign_id,
      p_group_id, p_bundle_id
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
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
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
  v_result jsonb;
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
    v_result := public.aka_agent_get_campaign_data_group_source(
      p_staff_id, p_organization_id, p_campaign_id
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
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_stop_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_request_id text,
  p_reason text,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
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
  v_result jsonb;
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
    v_result := public.aka_agent_stop_campaign_data_group_source(
      p_staff_id, p_organization_id, p_campaign_id, p_request_id, p_reason
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
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_reactivate_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_request_id text,
  p_reason text,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
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
  v_result jsonb;
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
    v_result := public.aka_agent_reactivate_campaign_data_group_source(
      p_staff_id, p_organization_id, p_campaign_id, p_request_id, p_reason
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
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_preflight_campaign_data_group_change(
  bigint, bigint, bigint, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_preflight_campaign_data_group_change(
  bigint, bigint, bigint, bigint, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_bind_campaign_data_group_source(
  bigint, bigint, text, bigint, bigint, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_bind_campaign_data_group_source(
  bigint, bigint, text, bigint, bigint, bigint, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_get_campaign_data_group_source(
  bigint, bigint, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_get_campaign_data_group_source(
  bigint, bigint, bigint, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_stop_campaign_data_group_source(
  bigint, bigint, bigint, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_stop_campaign_data_group_source(
  bigint, bigint, bigint, text, text, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_reactivate_campaign_data_group_source(
  bigint, bigint, bigint, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_reactivate_campaign_data_group_source(
  bigint, bigint, bigint, text, text, text, text
) TO anon, authenticated, service_role;

DO $postflight$
DECLARE
  v_signature text;
  v_definition text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint,text,text)',
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint,text,text)',
    'public.aka_agent_get_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)',
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)'
  ] LOOP
    SELECT pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature))
    INTO v_definition;

    IF position('auto_assert_automation_identity' IN v_definition) = 0
      OR position('account.is_zalo_server' IN v_definition) = 0
      OR position('account.is_zalo_show_web' IN v_definition) = 0
      OR position(
        'aka_agent.zalo_runtime_target'', v_runtime_target'
        IN v_definition
      ) = 0
    THEN
      RAISE EXCEPTION 'v224 postflight: subtype-aware routing missing from %', v_signature;
    END IF;

    IF NOT pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
      OR NOT pg_catalog.has_function_privilege(
        'authenticated', v_signature, 'EXECUTE'
      )
      OR NOT pg_catalog.has_function_privilege(
        'service_role', v_signature, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'v224 postflight: wrapper grants are wrong for %', v_signature;
    END IF;
  END LOOP;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;

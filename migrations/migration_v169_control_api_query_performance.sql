-- Reduce control API round-trips without changing its public contract.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_authenticate_control_session(
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_session public.auto_control_sessions%ROWTYPE;
  v_staff public.org_staff%ROWTYPE;
  v_organization public.org_organization%ROWTYPE;
  v_zalo_package public.org_organization_product%ROWTYPE;
  v_sms_package public.org_organization_product%ROWTYPE;
  v_zalo_enabled boolean := false;
  v_sms_enabled boolean := false;
  v_now timestamptz := now();
  v_vietnam_day_start timestamptz := (
    date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  SELECT session.*
  INTO v_session
  FROM public.auto_control_sessions AS session
  WHERE session.token_hash = p_token_hash
    AND session.revoked_at IS NULL
    AND session.expires_at > v_now
  LIMIT 1;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_session');
  END IF;

  SELECT staff.*
  INTO v_staff
  FROM public.org_staff AS staff
  WHERE staff.id = v_session.staff_id
  LIMIT 1;

  IF v_staff.id IS NULL
    OR v_staff.is_active IS DISTINCT FROM true
    OR v_staff.organization_id IS DISTINCT FROM v_session.organization_id THEN
    UPDATE public.auto_control_sessions
    SET revoked_at = v_now
    WHERE id = v_session.id
      AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_staff');
  END IF;

  SELECT organization.*
  INTO v_organization
  FROM public.org_organization AS organization
  WHERE organization.id = v_staff.organization_id
  LIMIT 1;

  IF v_organization.id IS NULL THEN
    UPDATE public.auto_control_sessions
    SET revoked_at = v_now
    WHERE id = v_session.id
      AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_organization');
  END IF;

  SELECT entitlement.*
  INTO v_zalo_package
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_staff.organization_id
    AND entitlement.is_deleted = false
    AND entitlement.product_id IN (16, 18)
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  SELECT entitlement.*
  INTO v_sms_package
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_staff.organization_id
    AND entitlement.is_deleted = false
    AND entitlement.product_id = 17
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_zalo_enabled := COALESCE(v_staff.is_zalo_server, false) AND v_zalo_package.id IS NOT NULL;
  v_sms_enabled := v_sms_package.id IS NOT NULL;

  IF NOT v_zalo_enabled AND NOT v_sms_enabled THEN
    UPDATE public.auto_control_sessions
    SET revoked_at = v_now
    WHERE id = v_session.id
      AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'capability_unavailable');
  END IF;

  IF v_session.last_seen_at <= v_now - interval '5 minutes' THEN
    UPDATE public.auto_control_sessions
    SET last_seen_at = v_now
    WHERE id = v_session.id
      AND revoked_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'status', 'authenticated',
    'session', jsonb_build_object(
      'id', v_session.id,
      'staff_id', v_session.staff_id,
      'organization_id', v_session.organization_id,
      'client_type', v_session.client_type,
      'user_agent', v_session.user_agent,
      'created_at', v_session.created_at,
      'last_seen_at', v_session.last_seen_at,
      'expires_at', v_session.expires_at,
      'revoked_at', v_session.revoked_at
    ),
    'staff', jsonb_build_object(
      'id', v_staff.id,
      'organization_id', v_staff.organization_id,
      'name', v_staff.name,
      'username', v_staff.username,
      'phone', v_staff.phone,
      'email', v_staff.email,
      'is_active', v_staff.is_active,
      'is_zalo_server', v_staff.is_zalo_server
    ),
    'organization', jsonb_build_object(
      'id', v_organization.id,
      'name', v_organization.name
    ),
    'capabilities', jsonb_build_object(
      'zalo_server', v_zalo_enabled,
      'sms', v_sms_enabled
    ),
    'zalo_package', CASE
      WHEN v_zalo_package.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_zalo_package.id,
        'product_id', v_zalo_package.product_id,
        'product_package_id', v_zalo_package.product_package_id,
        'product_name', v_zalo_package.product_name,
        'package_name', v_zalo_package.package_name,
        'max_accounts', v_zalo_package.max_accounts,
        'max_staff', v_zalo_package.max_staff,
        'max_sends_per_day', v_zalo_package.max_sends_per_day,
        'expiration_date', v_zalo_package.expiration_date,
        'created_at', v_zalo_package.created_at
      )
    END,
    'sms_package', CASE
      WHEN v_sms_package.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_sms_package.id,
        'product_id', v_sms_package.product_id,
        'product_package_id', v_sms_package.product_package_id,
        'product_name', v_sms_package.product_name,
        'package_name', v_sms_package.package_name,
        'max_accounts', v_sms_package.max_accounts,
        'max_staff', v_sms_package.max_staff,
        'max_sends_per_day', v_sms_package.max_sends_per_day,
        'expiration_date', v_sms_package.expiration_date,
        'created_at', v_sms_package.created_at
      )
    END
  );
END;
$$;

COMMENT ON FUNCTION public.aka_agent_authenticate_control_session(text) IS
  'Resolves a live control session, staff, organization and current Zalo/SMS entitlements in one API-to-database round-trip.';

REVOKE ALL ON FUNCTION public.aka_agent_authenticate_control_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_authenticate_control_session(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_authenticate_control_session(text) TO service_role;

CREATE OR REPLACE FUNCTION public.aka_agent_control_campaign_progress(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_ids bigint[]
)
RETURNS TABLE (
  campaign_id bigint,
  input_total bigint,
  input_completed bigint,
  input_failed bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    input_data.campaign_id,
    count(*) AS input_total,
    count(*) FILTER (WHERE input_data.status = 'hoàn thành') AS input_completed,
    count(*) FILTER (WHERE input_data.status = 'lỗi') AS input_failed
  FROM public.auto_campaign_input_data AS input_data
  INNER JOIN public.auto_campaigns AS campaign
    ON campaign.id = input_data.campaign_id
  WHERE input_data.campaign_id = ANY(COALESCE(p_campaign_ids, ARRAY[]::bigint[]))
    AND input_data.is_delete = false
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.is_delete = false
  GROUP BY input_data.campaign_id;
$$;

COMMENT ON FUNCTION public.aka_agent_control_campaign_progress(bigint, bigint, bigint[]) IS
  'Aggregates control campaign input progress inside PostgreSQL without returning every input row to the API.';

REVOKE ALL ON FUNCTION public.aka_agent_control_campaign_progress(bigint, bigint, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_control_campaign_progress(bigint, bigint, bigint[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_campaign_progress(bigint, bigint, bigint[]) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

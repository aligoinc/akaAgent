-- V490: iOS sessions of staff who may use only Chat (akaChat) are accepted with a "chat" scope.
--
-- Adds public.aka_agent_authenticate_control_session_chat_v2(text). The existing
-- public.aka_agent_authenticate_control_session(text) is NOT changed: Web/PWA, older iOS builds and the
-- currently deployed WebApp API keep calling it with identical results (it still revokes sessions of staff
-- without akaAgent and of organizations without a campaign package).
--
-- The new function is the same body with one difference. Where the old one revokes the session because
--   (a) the staff may not use akaAgent (aka_agent_app_access_staff_allowed(staff,'akaAgent') is false), or
--   (b) the organization has no usable campaign package (no Zalo Server/SMS and no desktopOnlyLogin /
--       facebookOnlyLogin exception),
-- it keeps the session and returns status 'authenticated' with app_scope = 'chat' when ALL of:
--   * the session is a native (iOS) session;
--   * the staff may use akaChat: aka_agent_app_access_staff_allowed(staff,'akaChat') (separate access:
--     product 5 still valid + staff flag; legacy: true);
--   * the organization has the Chat runtime: aka_agent_app_access_chat_runtime(org,false) (legacy:
--     product 16/18 with is_chat_sync; separate: product 5, Zalo QR or a held Zalo runtime).
-- Otherwise it revokes exactly like the old function. Every authenticated result also carries
-- app_scope ('full' | 'chat'). The Chat check runs only on those two revoke paths, so a full session
-- costs the same as with the old function (the new iOS build calls this function on every request).
-- Any later change to the old function must be made here too (both bodies are kept identical apart
-- from the chat-scope branches).
--
-- The WebApp API calls the new function only for native requests that send x-aka-chat-only: 1 and then
-- denies every route except /me, logout and the Chat inbox proxy for chat-scope sessions (default deny).
-- If this migration is not applied, the API falls back to the old function (no behaviour change).
-- Chat data itself is still authorized by Chat API (akaChat staff ACL); this only lets the session exist.
--
-- No table, index, policy, role, timeout, pool or connection change. EXECUTE only for service_role
-- (same ACL as the old function). Rollback: migrations/rollback_v490_control_session_chat_scope.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_authenticate_control_session(text)') IS NULL THEN
    RAISE EXCEPTION 'v490_session_auth_missing';
  END IF;
  -- The new body is a copy of this exact live body (10/11/2026) plus the chat-scope branches; stop if
  -- the old function changed meanwhile so the two never silently diverge.
  IF current_setting('aka_agent.v490_skip_body_check', true) IS DISTINCT FROM 'on'
    AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_authenticate_control_session(text)'))
      IS DISTINCT FROM '0ed750b83cb1188f8fd4ae2fd0898870' THEN
    RAISE EXCEPTION 'v490_session_auth_body_unexpected';
  END IF;
  IF to_regprocedure('public.aka_agent_authenticate_control_session_chat_v2(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'v490_already_applied';
  END IF;
  IF to_regprocedure('public.aka_agent_app_access_staff_allowed(bigint,text)') IS NULL
    OR to_regprocedure('public.aka_agent_app_access_chat_runtime(bigint,boolean)') IS NULL
    OR to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') IS NULL
    OR to_regprocedure('public.resolve_organization_zalo_account_capabilities(bigint)') IS NULL
    OR to_regprocedure('private.aka_agent_web_desktop_accounts_policy(bigint)') IS NULL
    OR to_regprocedure('private.aka_agent_web_facebook_campaigns_policy(bigint)') IS NULL THEN
    RAISE EXCEPTION 'v490_dependency_missing';
  END IF;
END
$preflight$;

CREATE FUNCTION public.aka_agent_authenticate_control_session_chat_v2(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.auto_control_sessions%ROWTYPE;
  v_staff public.org_staff%ROWTYPE;
  v_organization public.org_organization%ROWTYPE;
  v_zalo_package public.org_organization_product%ROWTYPE;
  v_sms_package public.org_organization_product%ROWTYPE;
  v_zalo_capabilities record;
  v_zalo_qr_enabled boolean := false;
  v_zalo_web_enabled boolean := false;
  v_zalo_server_enabled boolean := false;
  v_sms_enabled boolean := false;
  v_web_desktop_policy jsonb := '{}'::jsonb;
  v_facebook_enabled boolean := false;
  v_web_facebook_policy jsonb := '{}'::jsonb;
  v_agent_allowed boolean := false;
  v_chat_allowed boolean := false;
  v_chat_scope boolean := false;
  v_now timestamptz := now();
  v_vietnam_day_start timestamptz := (
    date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  SELECT session.* INTO v_session
  FROM public.auto_control_sessions AS session
  WHERE session.token_hash = p_token_hash
    AND session.revoked_at IS NULL
    AND session.expires_at > v_now
  LIMIT 1;
  IF v_session.id IS NULL THEN RETURN jsonb_build_object('status', 'invalid_session'); END IF;

  SELECT staff.* INTO v_staff
  FROM public.org_staff AS staff
  WHERE staff.id = v_session.staff_id
  LIMIT 1;
  IF v_staff.id IS NULL
    OR v_staff.is_active IS DISTINCT FROM true
    OR v_staff.organization_id IS DISTINCT FROM v_session.organization_id
  THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_staff');
  END IF;

  SELECT organization.* INTO v_organization
  FROM public.org_organization AS organization
  WHERE organization.id = v_staff.organization_id
  LIMIT 1;
  IF v_organization.id IS NULL THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_organization');
  END IF;

  -- Live staff/org expiry applies to both scopes, exactly as before.
  IF NOT public.aka_agent_staff_time_allowed(v_staff.id) THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_staff');
  END IF;

  v_agent_allowed := public.aka_agent_app_access_staff_allowed(v_staff.id, 'akaAgent');

  IF NOT v_agent_allowed THEN
    -- Chat permission is evaluated only where the old function would revoke, so full sessions (every
    -- request of the new iOS build) cost exactly what the old function costs. Native (iOS) only;
    -- Web/PWA keep the old rules.
    IF v_session.client_type = 'native' THEN
      v_chat_allowed := public.aka_agent_app_access_staff_allowed(v_staff.id, 'akaChat')
        AND public.aka_agent_app_access_chat_runtime(v_staff.organization_id, false);
    END IF;
    IF NOT v_chat_allowed THEN
      UPDATE public.auto_control_sessions SET revoked_at = v_now
      WHERE id = v_session.id AND revoked_at IS NULL;
      RETURN jsonb_build_object('status', 'invalid_staff');
    END IF;
    v_chat_scope := true;
  END IF;

  SELECT * INTO v_zalo_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_staff.organization_id);
  IF v_zalo_capabilities.entitlement_id IS NOT NULL THEN
    SELECT entitlement.* INTO v_zalo_package
    FROM public.org_organization_product AS entitlement
    WHERE entitlement.id = v_zalo_capabilities.entitlement_id;
  END IF;

  SELECT entitlement.* INTO v_sms_package
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_staff.organization_id
    AND entitlement.is_deleted = false
    AND entitlement.product_id = 17
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_zalo_qr_enabled := COALESCE(v_zalo_capabilities.qr_enabled, false);
  v_zalo_web_enabled := COALESCE(v_zalo_capabilities.web_enabled, false);
  v_zalo_server_enabled := v_zalo_qr_enabled
    AND COALESCE(v_zalo_capabilities.server_enabled, false);
  v_sms_enabled := v_sms_package.id IS NOT NULL;
  v_facebook_enabled := EXISTS (
    SELECT 1 FROM public.org_organization_product AS entitlement
    WHERE entitlement.organization_id = v_staff.organization_id
      AND entitlement.is_deleted = false
      AND entitlement.product_id IN (3, 10)
      AND entitlement.expiration_date >= v_vietnam_day_start
  );

  v_web_desktop_policy := private.aka_agent_web_desktop_accounts_policy(v_staff.organization_id);
  v_web_facebook_policy := private.aka_agent_web_facebook_campaigns_policy(v_staff.organization_id);
  -- Same campaign-package gate as aka_agent_authenticate_control_session; only a Chat-capable
  -- native session survives it, with the chat scope. A session already in chat scope skips it.
  IF NOT v_chat_scope AND NOT v_zalo_server_enabled AND NOT v_sms_enabled AND NOT (
    v_zalo_qr_enabled
    AND v_session.client_type IN ('web', 'pwa', 'native')
    AND COALESCE((v_web_desktop_policy->>'desktopOnlyLogin')::boolean, false)
  ) AND NOT (
    -- Tổ chức chỉ có gói Facebook (chạy trên app Desktop) vào Web/PWA/iOS khi chính sách bật rõ facebookOnlyLogin.
    v_facebook_enabled
    AND v_session.client_type IN ('web', 'pwa', 'native')
    AND COALESCE((v_web_facebook_policy->>'facebookOnlyLogin')::boolean, false)
  ) THEN
    IF v_session.client_type = 'native' THEN
      v_chat_allowed := public.aka_agent_app_access_staff_allowed(v_staff.id, 'akaChat')
        AND public.aka_agent_app_access_chat_runtime(v_staff.organization_id, false);
    END IF;
    IF NOT v_chat_allowed THEN
      UPDATE public.auto_control_sessions SET revoked_at = v_now
      WHERE id = v_session.id AND revoked_at IS NULL;
      RETURN jsonb_build_object('status', 'capability_unavailable');
    END IF;
    v_chat_scope := true;
  END IF;
  IF v_session.last_seen_at <= v_now - interval '5 minutes' THEN
    UPDATE public.auto_control_sessions SET last_seen_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'status', 'authenticated',
    'app_scope', CASE WHEN v_chat_scope THEN 'chat' ELSE 'full' END,
    'session', jsonb_build_object(
      'id', v_session.id, 'staff_id', v_session.staff_id,
      'organization_id', v_session.organization_id,
      'client_type', v_session.client_type, 'user_agent', v_session.user_agent,
      'created_at', v_session.created_at, 'last_seen_at', v_session.last_seen_at,
      'expires_at', v_session.expires_at, 'revoked_at', v_session.revoked_at
    ),
    'staff', jsonb_build_object(
      'id', v_staff.id, 'organization_id', v_staff.organization_id,
      'name', v_staff.name, 'username', v_staff.username,
      'phone', v_staff.phone, 'email', v_staff.email,
      'is_active', v_staff.is_active, 'is_zalo_server', v_zalo_server_enabled
    ),
    'organization', jsonb_build_object('id', v_organization.id, 'name', v_organization.name),
    'capabilities', jsonb_build_object(
      'zalo_qr', v_zalo_qr_enabled,
      'zalo_web', v_zalo_web_enabled,
      'zalo_server', v_zalo_server_enabled,
      'sms', v_sms_enabled,
      'facebook', v_facebook_enabled
    ),
    'zalo_account_capabilities', jsonb_build_object(
      'qr', v_zalo_qr_enabled,
      'web', v_zalo_web_enabled,
      'server', v_zalo_server_enabled,
      'revision', v_zalo_capabilities.capability_revision
    ),
    'zalo_package', CASE WHEN v_zalo_package.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_zalo_package.id,
      'product_id', v_zalo_package.product_id,
      'product_package_id', v_zalo_package.product_package_id,
      'product_name', v_zalo_package.product_name,
      'package_name', v_zalo_package.package_name,
      'max_accounts', v_zalo_capabilities.max_accounts,
      'max_staff', v_zalo_package.max_staff,
      'max_sends_per_day', v_zalo_capabilities.max_sends_per_day,
      'expiration_date', v_zalo_package.expiration_date,
      'created_at', v_zalo_package.created_at,
      'capability_revision', v_zalo_capabilities.capability_revision
    ) END,
    'web_desktop_accounts', v_web_desktop_policy,
    'web_facebook_campaigns', v_web_facebook_policy,
    'sms_package', CASE WHEN v_sms_package.id IS NULL THEN NULL ELSE jsonb_build_object(
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
    ) END
  );
END;
$function$;

ALTER FUNCTION public.aka_agent_authenticate_control_session_chat_v2(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_authenticate_control_session_chat_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_authenticate_control_session_chat_v2(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_authenticate_control_session_chat_v2(text) TO service_role;

DO $postflight$
DECLARE
  v_fn regprocedure := to_regprocedure('public.aka_agent_authenticate_control_session_chat_v2(text)');
BEGIN
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v490_function_missing'; END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
    OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v490_function_exposed';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v490_service_role_missing';
  END IF;
  -- Exact body written above, and the same attributes as the old function (owner postgres, SECURITY
  -- DEFINER, VOLATILE, search_path=public); a later edit of the body must update this checksum.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM '5f88c1bf6cf4aac84bffc67ccd58c13c' THEN
    RAISE EXCEPTION 'v490_body_mismatch';
  END IF;
  IF NOT (SELECT pg_get_userbyid(proowner) = 'postgres' AND prosecdef AND provolatile = 'v'
      AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'v490_attributes_mismatch';
  END IF;
END
$postflight$;
COMMIT;

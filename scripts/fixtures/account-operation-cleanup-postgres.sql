-- ISOLATED LOCAL TEST DATABASE ONLY. Not a production migration.
-- Exact claim/release definitions captured from production on 2026-09-15.
-- Minimal tables and a deterministic capability resolver model the dependencies.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_chat_api;
CREATE TABLE public.org_staff(id bigint PRIMARY KEY, organization_id bigint, is_active boolean);
CREATE TABLE public.auto_accounts(id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, flatform_type text,
 status text, login_status text, is_active boolean, is_delete boolean, is_zalo_server boolean, is_zalo_show_web boolean,
 runtime_operation_claim_token uuid, updated_at timestamptz);
CREATE TABLE public.auto_campaigns(id bigint PRIMARY KEY,account_id bigint,staff_id bigint,status text,runtime_unit_token uuid);
CREATE TABLE public.auto_campaign_inputs(id bigint PRIMARY KEY,campaign_id bigint,status text);
CREATE TABLE public.auto_campaign_input_data(id bigint PRIMARY KEY,campaign_id bigint,status text);
CREATE TABLE public.test_capabilities(organization_id bigint PRIMARY KEY,qr_enabled boolean,web_enabled boolean,server_enabled boolean);
CREATE FUNCTION public.resolve_organization_zalo_account_capabilities(bigint)
RETURNS TABLE(qr_enabled boolean,web_enabled boolean,server_enabled boolean)
LANGUAGE sql AS $$SELECT qr_enabled,web_enabled,server_enabled FROM public.test_capabilities WHERE organization_id=$1$$;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_requires_login boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_capabilities record;
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'staff_not_active'
    );
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT *
  INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(
    v_organization_id
  );

  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'account_not_found'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_inputs AS campaign_input
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = campaign_input.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign_input.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS input_data
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = input_data.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND input_data.status = 'đang chạy'
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'work_running'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
    OR (
      COALESCE(p_requires_login, true)
      AND v_account.login_status <> 'đã đăng nhập'
    )
    OR v_account.status NOT IN ('chờ xử lý', 'tạm dừng')
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'account_not_available'
    );
  END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);
  IF (
    v_runtime_target = 'server'
    AND (
      v_is_web
      OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    )
  ) OR (
    v_runtime_target = 'desktop'
    AND (
      v_is_server
      OR (
        v_is_web
        AND NOT COALESCE(v_capabilities.web_enabled, false)
      )
      OR (
        NOT v_is_web
        AND NOT v_is_server
        AND NOT COALESCE(v_capabilities.qr_enabled, false)
      )
    )
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'runtime_not_owner'
    );
  END IF;

  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_account.status,
    'runtime_target', v_runtime_target
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.claim_zalo_account_runtime_operation(bigint,bigint,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_zalo_account_runtime_operation(bigint,bigint,text,boolean) TO postgres,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_previous_status text, p_claim_token uuid, p_requires_login boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
  v_capabilities record;
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'staff_not_active'
    );
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT *
  INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(
    v_organization_id
  );

  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    )
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_found'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);
  IF (
    v_runtime_target = 'server'
    AND (
      v_is_web
      OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    )
  ) OR (
    v_runtime_target = 'desktop'
    AND (
      v_is_server
      OR (
        v_is_web
        AND NOT COALESCE(v_capabilities.web_enabled, false)
      )
      OR (
        NOT v_is_web
        AND NOT v_is_server
        AND NOT COALESCE(v_capabilities.qr_enabled, false)
      )
    )
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'runtime_not_owner'
    );
  END IF;

  -- Retry of the same account-operation token remains idempotent after an
  -- ambiguous response. A campaign cannot form a unit while this account row
  -- is already owned/running by that token.
  IF v_account.status = 'đang chạy'
    AND v_account.runtime_operation_claim_token = p_claim_token
  THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'account_id', p_account_id,
      'previous_status', v_previous_status,
      'claim_token', p_claim_token,
      'runtime_target', v_runtime_target
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_inputs AS campaign_input
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = campaign_input.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign_input.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS input_data
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = input_data.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND input_data.status = 'đang chạy'
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'work_running'
    );
  END IF;

  IF v_account.status IS DISTINCT FROM v_previous_status
    OR (
      COALESCE(p_requires_login, true)
      AND (
        v_account.is_active IS NOT TRUE
        OR v_account.login_status IS DISTINCT FROM 'đã đăng nhập'
      )
    )
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  UPDATE public.auto_accounts AS account
  SET status = 'đang chạy',
    runtime_operation_claim_token = p_claim_token,
    updated_at = now()
  WHERE account.id = p_account_id
    AND account.status = v_previous_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_previous_status,
    'claim_token', p_claim_token,
    'runtime_target', v_runtime_target
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean) TO postgres,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.release_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_previous_status text, p_claim_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = v_previous_status,
    runtime_operation_claim_token = NULL,
    updated_at = now()
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND account.status = 'đang chạy'
    AND account.runtime_operation_claim_token = p_claim_token;
  RETURN FOUND;
END;
$function$
;
REVOKE ALL ON FUNCTION public.release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid) TO postgres,anon,authenticated,service_role,aka_agent_chat_api;
CREATE OR REPLACE FUNCTION public.claim_non_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_previous_status text, p_claim_token uuid, p_requires_login boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_platform NOT IN ('facebook', 'email') THEN
    RAISE EXCEPTION 'Non-Zalo runtime platform must be Facebook or Email';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  -- reset_desktop_running_statuses takes FOR UPDATE on this same row. The
  -- shared lock prevents a new account operation from entering recovery.
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'staff_not_active'
    );
  END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_found'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> v_platform
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  -- Retrying the same client-generated token is idempotent after an ambiguous
  -- network response: the caller still owns this exact account-only claim.
  IF v_account.status = 'đang chạy'
    AND v_account.runtime_operation_claim_token = p_claim_token
  THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'account_id', p_account_id,
      'previous_status', v_previous_status,
      'claim_token', p_claim_token,
      'platform', v_platform
    );
  END IF;

  IF (COALESCE(p_requires_login, true) AND v_account.login_status IS DISTINCT FROM 'đã đăng nhập')
    OR v_account.status IS DISTINCT FROM v_previous_status
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = 'đang chạy',
    runtime_operation_claim_token = p_claim_token,
    updated_at = now()
  WHERE account.id = p_account_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_previous_status,
    'claim_token', p_claim_token,
    'platform', v_platform
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean) TO postgres,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.release_non_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_previous_status text, p_claim_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_platform NOT IN ('facebook', 'email') THEN
    RAISE EXCEPTION 'Non-Zalo runtime platform must be Facebook or Email';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = v_platform
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = v_previous_status,
    runtime_operation_claim_token = NULL,
    updated_at = now()
  WHERE account.id = p_account_id
    AND account.status = 'đang chạy'
    AND account.runtime_operation_claim_token = p_claim_token;
  RETURN FOUND;
END;
$function$
;
REVOKE ALL ON FUNCTION public.release_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid) TO postgres,anon,authenticated,service_role;

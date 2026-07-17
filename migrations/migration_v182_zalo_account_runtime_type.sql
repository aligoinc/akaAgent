-- Split Zalo QR/zca-js and Zalo Web at the account level.
-- Product 16 grants QR. Product 18 grants Web only while is_zalo_show_web is
-- enabled; otherwise it grants QR. The newest active row is resolved per
-- product so Product 16 and Product 18 can be effective at the same time.

BEGIN;

DO $schema$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_accounts'
      AND column_name = 'is_zalo_show_web'
  ) THEN
    ALTER TABLE public.auto_accounts
      ADD COLUMN is_zalo_show_web boolean NOT NULL DEFAULT false;
  END IF;
END;
$schema$;

UPDATE public.auto_accounts
SET is_zalo_show_web = false
WHERE is_zalo_show_web IS NULL
  OR (
    is_zalo_show_web = true
    AND lower(btrim(COALESCE(flatform_type, ''))) <> 'zalo'
  );

ALTER TABLE public.auto_accounts
  ALTER COLUMN is_zalo_show_web SET DEFAULT false,
  ALTER COLUMN is_zalo_show_web SET NOT NULL;

COMMENT ON COLUMN public.auto_accounts.is_zalo_show_web IS
  'False: Zalo QR/zca-js account. True: Zalo Web account using the persistent Chromium partition.';

COMMENT ON COLUMN public.org_organization_product.is_zalo_show_web IS
  'Product 18 only. Grants Zalo Web accounts and takes runtime precedence over Server without clearing is_zalo_server.';

-- v179 allowed both product IDs to select Web. From v182 only Product 18 may
-- grant that capability. Normalize legacy Product 16 flags before validating.
UPDATE public.org_organization_product
SET is_zalo_show_web = false
WHERE product_id IS DISTINCT FROM 18
  AND COALESCE(is_zalo_show_web, false) = true;

DROP TRIGGER IF EXISTS trg_normalize_zalo_runtime_mode_flags
  ON public.org_organization_product;
DROP FUNCTION IF EXISTS public.normalize_zalo_runtime_mode_flags();

ALTER TABLE public.auto_accounts
  DROP CONSTRAINT IF EXISTS chk_auto_accounts_zalo_show_web_platform;
ALTER TABLE public.auto_accounts
  ADD CONSTRAINT chk_auto_accounts_zalo_show_web_platform
  CHECK (
    NOT is_zalo_show_web
    OR lower(btrim(COALESCE(flatform_type, ''))) = 'zalo'
  ) NOT VALID;
ALTER TABLE public.auto_accounts
  VALIDATE CONSTRAINT chk_auto_accounts_zalo_show_web_platform;

ALTER TABLE public.org_organization_product
  DROP CONSTRAINT IF EXISTS chk_org_product_zalo_show_web_product18;
ALTER TABLE public.org_organization_product
  ADD CONSTRAINT chk_org_product_zalo_show_web_product18
  CHECK (
    NOT COALESCE(is_zalo_show_web, false)
    OR product_id = 18
  ) NOT VALID;
ALTER TABLE public.org_organization_product
  VALIDATE CONSTRAINT chk_org_product_zalo_show_web_product18;

CREATE INDEX IF NOT EXISTS idx_auto_accounts_zalo_runtime_type
  ON public.auto_accounts (staff_id, is_zalo_show_web, id)
  WHERE lower(btrim(COALESCE(flatform_type, ''))) = 'zalo'
    AND COALESCE(is_delete, false) = false;

-- One shared resolver is used by desktop/server ownership RPCs. The revision
-- remains opaque to clients, but starts with the representative entitlement's
-- id:xmin for compatibility with existing Zalo Server validation.
CREATE OR REPLACE FUNCTION public.resolve_organization_zalo_runtime_mode(
  p_organization_id bigint
)
RETURNS TABLE(
  entitlement_id bigint,
  product_id bigint,
  product_name text,
  package_name text,
  package_type text,
  expiration_date timestamptz,
  max_sends_per_day integer,
  max_accounts integer,
  created_at timestamptz,
  qr_enabled boolean,
  web_enabled boolean,
  is_zalo_server boolean,
  mode_revision text
)
LANGUAGE sql
STABLE
SET search_path TO public
AS $function$
  WITH latest AS (
    SELECT DISTINCT ON (entitlement.product_id)
      entitlement.id,
      entitlement.product_id,
      entitlement.product_name,
      entitlement.package_name,
      entitlement.package_type,
      entitlement.expiration_date,
      entitlement.max_sends_per_day,
      entitlement.max_accounts,
      entitlement.created_at,
      entitlement.xmin::text AS entitlement_xmin,
      COALESCE(entitlement.is_zalo_server, false) AS requests_server,
      entitlement.product_id = 18
        AND COALESCE(entitlement.is_zalo_show_web, false) AS grants_web
    FROM public.org_organization_product AS entitlement
    WHERE entitlement.organization_id = p_organization_id
      AND entitlement.product_id IN (16, 18)
      AND entitlement.is_deleted = false
      AND entitlement.expiration_date IS NOT NULL
      AND entitlement.expiration_date >= (
        date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
          AT TIME ZONE 'Asia/Ho_Chi_Minh'
      )
    ORDER BY
      entitlement.product_id,
      entitlement.created_at DESC NULLS LAST,
      entitlement.id DESC
  ),
  capabilities AS (
    SELECT
      COALESCE(bool_or(product_id = 16 OR (product_id = 18 AND NOT grants_web)), false) AS qr_enabled,
      COALESCE(bool_or(product_id = 18 AND grants_web), false) AS web_enabled,
      COALESCE(bool_or(requests_server), false) AS requests_server,
      CASE
        WHEN count(*) = 0 THEN NULL
        WHEN max(max_sends_per_day) FILTER (WHERE max_sends_per_day > 0) IS NOT NULL
          THEN max(max_sends_per_day) FILTER (WHERE max_sends_per_day > 0)
        WHEN bool_and(lower(btrim(COALESCE(package_type, ''))) = 'demo') THEN 30
        ELSE NULL
      END AS max_sends_per_day,
      max(max_accounts) AS max_accounts,
      string_agg(
        product_id::text || '=' || id::text || ':' || entitlement_xmin,
        '|' ORDER BY product_id
      ) AS component_revision
    FROM latest
  ),
  representative AS (
    SELECT latest.*
    FROM latest
    ORDER BY
      -- Server discovery still exposes one package_type. Prefer any paid row
      -- so a demo row that happens to request Server cannot reintroduce the
      -- demo fallback when another effective paid Zalo package is unlimited.
      (lower(btrim(COALESCE(latest.package_type, ''))) <> 'demo') DESC,
      latest.requests_server DESC,
      latest.created_at DESC NULLS LAST,
      latest.id DESC
    LIMIT 1
  )
  SELECT
    representative.id,
    representative.product_id,
    representative.product_name,
    representative.package_name,
    representative.package_type,
    representative.expiration_date,
    capabilities.max_sends_per_day,
    capabilities.max_accounts,
    representative.created_at,
    capabilities.qr_enabled,
    capabilities.web_enabled,
    capabilities.qr_enabled
      AND NOT capabilities.web_enabled
      AND capabilities.requests_server AS is_zalo_server,
    CASE
      WHEN representative.id IS NULL THEN 'none:' || p_organization_id::text
      ELSE representative.id::text || ':' || representative.entitlement_xmin
        || '|' || capabilities.component_revision
    END AS mode_revision
  FROM capabilities
  LEFT JOIN representative ON true;
$function$;

CREATE OR REPLACE FUNCTION public.inspect_staff_zalo_running_state(
  p_staff_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_mode record;
  v_accounts_running integer := 0;
  v_campaigns_running integer := 0;
  v_campaign_inputs_running integer := 0;
  v_campaign_input_data_running integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);

  -- This state is the ownership barrier for local <-> Server handoff. Web is
  -- always desktop-only, and hidden QR accounts have no current runtime owner;
  -- neither may keep Zalo Server waiting.
  IF COALESCE(v_mode.qr_enabled, false) THEN
    SELECT count(*)::integer INTO v_accounts_running
    FROM public.auto_accounts AS account
    WHERE account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_delete, false) = false
      AND account.status = 'đang chạy';

    SELECT count(*)::integer INTO v_campaigns_running
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(campaign.is_delete, false) = false
      AND COALESCE(account.is_delete, false) = false
      AND campaign.status = 'đang chạy';

    SELECT count(*)::integer INTO v_campaign_inputs_running
    FROM public.auto_campaign_inputs AS campaign_input
    JOIN public.auto_campaigns AS campaign ON campaign.id = campaign_input.campaign_id
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(campaign_input.is_delete, false) = false
      AND COALESCE(campaign.is_delete, false) = false
      AND COALESCE(account.is_delete, false) = false
      AND campaign_input.status = 'đang chạy';

    SELECT count(*)::integer INTO v_campaign_input_data_running
    FROM public.auto_campaign_input_data AS input_data
    JOIN public.auto_campaigns AS campaign ON campaign.id = input_data.campaign_id
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(input_data.is_delete, false) = false
      AND COALESCE(campaign.is_delete, false) = false
      AND COALESCE(account.is_delete, false) = false
      AND input_data.status = 'đang chạy';
  END IF;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'has_running_state',
      v_accounts_running > 0 OR v_campaigns_running > 0
      OR v_campaign_inputs_running > 0 OR v_campaign_input_data_running > 0,
    'accounts_running', v_accounts_running,
    'campaigns_running', v_campaigns_running,
    'campaign_inputs_running', v_campaign_inputs_running,
    'campaign_input_data_running', v_campaign_input_data_running
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.recover_server_zalo_running_state(
  p_staff_id bigint,
  p_expected_mode_revision text DEFAULT NULL,
  p_require_server_mode boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_accounts_reset integer := 0;
  v_campaigns_reset integer := 0;
  v_campaign_inputs_completed integer := 0;
  v_campaign_input_data_completed integer := 0;
  v_recovery_note constant text := 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_mode record;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR UPDATE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);

  IF NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NOT NULL
    AND v_mode.mode_revision IS DISTINCT FROM btrim(p_expected_mode_revision)
  THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  IF COALESCE(p_require_server_mode, false) AND (
    NOT COALESCE(v_mode.is_zalo_server, false)
    OR v_mode.entitlement_id IS NULL
    OR NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  -- A Web account is never server-owned. A QR account that is no longer
  -- granted is hidden and is not touched by Server recovery either.
  IF COALESCE(v_mode.qr_enabled, false) THEN
    UPDATE public.auto_campaign_input_data AS input_data
    SET status = 'hoàn thành', note = v_recovery_note
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE input_data.campaign_id = campaign.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_delete, false) = false
      AND input_data.status = 'đang chạy'
      AND COALESCE(input_data.is_delete, false) = false;
    GET DIAGNOSTICS v_campaign_input_data_completed = ROW_COUNT;

    UPDATE public.auto_campaign_inputs AS campaign_input
    SET status = 'hoàn thành', note = v_recovery_note
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign_input.campaign_id = campaign.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_delete, false) = false
      AND campaign_input.status = 'đang chạy'
      AND COALESCE(campaign_input.is_delete, false) = false;
    GET DIAGNOSTICS v_campaign_inputs_completed = ROW_COUNT;

    UPDATE public.auto_campaigns AS campaign
    SET status = 'chờ xử lý', updated_at = now()
    FROM public.auto_accounts AS account
    WHERE campaign.account_id = account.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND campaign.status = 'đang chạy'
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_delete, false) = false;
    GET DIAGNOSTICS v_campaigns_reset = ROW_COUNT;

    UPDATE public.auto_accounts AS account
    SET status = 'chờ xử lý', updated_at = now()
    WHERE account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_delete, false) = false
      AND account.status = 'đang chạy';
    GET DIAGNOSTICS v_accounts_reset = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'accounts_reset', v_accounts_reset,
    'campaigns_reset', v_campaigns_reset,
    'campaign_inputs_completed', v_campaign_inputs_completed,
    'campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_authenticate_control_session(
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_session public.auto_control_sessions%ROWTYPE;
  v_staff public.org_staff%ROWTYPE;
  v_organization public.org_organization%ROWTYPE;
  v_zalo_package public.org_organization_product%ROWTYPE;
  v_sms_package public.org_organization_product%ROWTYPE;
  v_zalo_mode record;
  v_zalo_enabled boolean := false;
  v_sms_enabled boolean := false;
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

  SELECT * INTO v_zalo_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_staff.organization_id);
  IF v_zalo_mode.entitlement_id IS NOT NULL THEN
    SELECT entitlement.* INTO v_zalo_package
    FROM public.org_organization_product AS entitlement
    WHERE entitlement.id = v_zalo_mode.entitlement_id;
  END IF;

  SELECT entitlement.* INTO v_sms_package
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_staff.organization_id
    AND entitlement.is_deleted = false
    AND entitlement.product_id = 17
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_zalo_enabled := COALESCE(v_zalo_mode.is_zalo_server, false)
    AND COALESCE(v_zalo_mode.qr_enabled, false)
    AND NOT COALESCE(v_zalo_mode.web_enabled, false);
  v_sms_enabled := v_sms_package.id IS NOT NULL;

  IF NOT v_zalo_enabled AND NOT v_sms_enabled THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'capability_unavailable');
  END IF;
  IF v_session.last_seen_at <= v_now - interval '5 minutes' THEN
    UPDATE public.auto_control_sessions SET last_seen_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'status', 'authenticated',
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
      'is_active', v_staff.is_active, 'is_zalo_server', v_zalo_enabled
    ),
    'organization', jsonb_build_object('id', v_organization.id, 'name', v_organization.name),
    'capabilities', jsonb_build_object('zalo_server', v_zalo_enabled, 'sms', v_sms_enabled),
    'zalo_package', CASE WHEN v_zalo_package.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_zalo_package.id,
      'product_id', v_zalo_package.product_id,
      'product_package_id', v_zalo_package.product_package_id,
      'product_name', v_zalo_package.product_name,
      'package_name', v_zalo_package.package_name,
      'max_accounts', v_zalo_mode.max_accounts,
      'max_staff', v_zalo_package.max_staff,
      'max_sends_per_day', v_zalo_mode.max_sends_per_day,
      'expiration_date', v_zalo_package.expiration_date,
      'created_at', v_zalo_package.created_at
    ) END,
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

CREATE OR REPLACE FUNCTION public.reset_desktop_running_statuses(
  p_staff_id bigint,
  p_exclude_zalo boolean DEFAULT false,
  p_zalo_uncertain_no_retry boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_accounts_reset integer := 0;
  v_campaigns_reset integer := 0;
  v_campaign_notes_reset integer := 0;
  v_campaign_inputs_reset integer := 0;
  v_campaign_input_data_reset integer := 0;
  v_exclude_zalo boolean := COALESCE(p_exclude_zalo, false);
  v_zalo_uncertain_no_retry boolean := COALESCE(p_zalo_uncertain_no_retry, false);
  v_handoff_note constant text := 'Dừng do thay đổi chế độ runtime, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_mode record;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR UPDATE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  v_exclude_zalo := v_exclude_zalo OR COALESCE(v_mode.is_zalo_server, false);

  -- Exclusion protects only QR accounts owned by VPS. Web accounts are never
  -- server-owned and must remain eligible for ordinary desktop cleanup.
  UPDATE public.auto_campaign_input_data AS input_data
  SET
    status = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN 'hoàn thành' ELSE 'chờ xử lý' END,
    note = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN v_handoff_note ELSE input_data.note END
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      NOT v_exclude_zalo
      OR lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_show_web, false)
    )
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_reset = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET
    status = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN 'hoàn thành' ELSE 'chờ xử lý' END,
    note = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN v_handoff_note ELSE campaign_input.note END
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      NOT v_exclude_zalo
      OR lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_show_web, false)
    )
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_reset = ROW_COUNT;

  SELECT count(*)::integer INTO v_campaign_notes_reset
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON campaign.account_id = account.id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND campaign.note IS NOT NULL
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      NOT v_exclude_zalo
      OR lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_show_web, false)
    );

  UPDATE public.auto_campaigns AS campaign
  SET status = 'chờ xử lý', note = NULL, updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      NOT v_exclude_zalo
      OR lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_show_web, false)
    );
  GET DIAGNOSTICS v_campaigns_reset = ROW_COUNT;

  UPDATE public.auto_accounts AS account
  SET status = 'chờ xử lý', updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      NOT v_exclude_zalo
      OR lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_show_web, false)
    )
    AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_accounts_reset = ROW_COUNT;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'exclude_zalo', v_exclude_zalo,
    'zalo_uncertain_no_retry', v_zalo_uncertain_no_retry,
    'accounts_reset', v_accounts_reset,
    'campaigns_reset', v_campaigns_reset,
    'campaign_notes_reset', v_campaign_notes_reset,
    'campaign_inputs_reset', v_campaign_inputs_reset,
    'campaign_input_data_reset', v_campaign_input_data_reset
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_control_zalo_account_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_max_accounts integer,
  p_account jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_account_id bigint;
  v_account_count integer := 0;
  v_account_group_id bigint := NULLIF(p_account->>'accountGroupId', '')::bigint;
  v_proxy_id bigint := NULLIF(p_account->>'proxyId', '')::bigint;
  v_mode record;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR jsonb_typeof(COALESCE(p_account, '{}'::jsonb)) <> 'object'
    OR NULLIF(btrim(COALESCE(p_account->>'name', '')), '') IS NULL
  THEN RAISE EXCEPTION 'invalid_control_zalo_account_payload'; END IF;

  PERFORM 1 FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND THEN RAISE EXCEPTION 'inactive_control_staff'; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(p_organization_id);
  IF NOT COALESCE(v_mode.is_zalo_server, false)
    OR NOT COALESCE(v_mode.qr_enabled, false)
    OR COALESCE(v_mode.web_enabled, false)
  THEN
    RETURN jsonb_build_object('created', false, 'reason', 'capability_unavailable');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('control-zalo-account:' || p_staff_id::text, 0)
  );
  SELECT count(*)::integer INTO v_account_count
  FROM public.auto_accounts
  WHERE staff_id = p_staff_id
    AND (organization_id IS NULL OR organization_id = p_organization_id)
    AND lower(btrim(COALESCE(flatform_type, ''))) = 'zalo'
    AND COALESCE(is_zalo_show_web, false) = false
    AND COALESCE(is_delete, false) = false;

  -- p_max_accounts remains for wire compatibility. The maximum across the
  -- two effective Zalo product rows is authoritative.
  IF v_mode.max_accounts IS NOT NULL
    AND v_mode.max_accounts > 0
    AND v_account_count >= v_mode.max_accounts
  THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'account_limit_reached',
      'max_accounts', v_mode.max_accounts
    );
  END IF;

  IF v_account_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auto_account_groups
    WHERE id = v_account_group_id
      AND staff_id = p_staff_id
      AND organization_id = p_organization_id
      AND flatform_type = 'zalo'
      AND COALESCE(is_delete, false) = false
  ) THEN RETURN jsonb_build_object('created', false, 'reason', 'account_group_not_found'); END IF;
  IF v_proxy_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auto_proxies
    WHERE id = v_proxy_id
      AND staff_id = p_staff_id
      AND organization_id = p_organization_id
      AND COALESCE(is_delete, false) = false
  ) THEN RETURN jsonb_build_object('created', false, 'reason', 'proxy_not_found'); END IF;

  INSERT INTO public.auto_accounts (
    name, flatform_type, is_zalo_show_web, login_status, status, is_active,
    account_group_id, proxy_id, staff_id, organization_id, is_delete
  ) VALUES (
    btrim(p_account->>'name'), 'zalo', false, 'chưa đăng nhập', 'chờ xử lý',
    COALESCE((p_account->>'isActive')::boolean, true), v_account_group_id,
    v_proxy_id, p_staff_id, p_organization_id, false
  ) RETURNING id INTO v_account_id;

  RETURN jsonb_build_object('created', true, 'account_id', v_account_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_advance_zalo_server_multi_daily_slot(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_next_schedule timestamptz
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_status text,
  account_status text,
  reset_count integer
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_mode record;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_reset_count integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF p_next_schedule IS NULL THEN RAISE EXCEPTION 'Next schedule is required'; END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT COALESCE(v_mode.is_zalo_server, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  SELECT campaign.status, account.status, account.login_status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO v_campaign_status, v_account_status, v_account_login_status,
    v_account_is_active, v_account_is_delete, v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id IN ('zalo_message_friend', 'zalo_message_group')
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_found', NULL::text, NULL::text, 0; RETURN; END IF;
  IF v_campaign_is_delete THEN RETURN QUERY SELECT false, 'campaign_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_is_delete THEN RETURN QUERY SELECT false, 'account_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF NOT v_account_is_active THEN RETURN QUERY SELECT false, 'account_inactive', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN RETURN QUERY SELECT false, 'account_logged_out', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_campaign_status IS DISTINCT FROM 'đang chạy' OR v_account_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT false, 'runtime_control_paused', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'chờ xử lý', note = '', date_action = NULL
  WHERE campaign_id = p_campaign_id
    AND COALESCE(is_delete, false) = false
    AND status <> 'tạm dừng';
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý', schedule = p_next_schedule, note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  RETURN QUERY SELECT true, 'advanced', 'chờ xử lý', v_account_status, v_reset_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_campaign_zalo_realtime_group_event(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_group_id text,
  p_group_name text,
  p_trigger_type text,
  p_target_uid text,
  p_target_name text,
  p_event_time timestamptz,
  p_schedule_at timestamptz,
  p_raw_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(inserted boolean, event_id bigint, input_data_id bigint)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_event_id bigint;
  v_input_data_id bigint;
  v_organization_id bigint;
  v_mode record;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_target_uid text := btrim(COALESCE(p_target_uid, ''));
  v_target_name text := NULLIF(btrim(COALESCE(p_target_name, '')), '');
  v_group_id text := btrim(COALESCE(p_group_id, ''));
  v_group_name text := NULLIF(btrim(COALESCE(p_group_name, '')), '');
  v_schedule_at timestamptz := COALESCE(p_schedule_at, now());
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN RAISE EXCEPTION 'campaign_id is required'; END IF;
  IF p_account_id IS NULL OR p_account_id <= 0 THEN RAISE EXCEPTION 'account_id is required'; END IF;
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN RAISE EXCEPTION 'staff_id is required'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN RAISE EXCEPTION 'runtime target must be desktop or server'; END IF;
  IF v_group_id = '' THEN RAISE EXCEPTION 'group_id is required'; END IF;
  IF v_target_uid = '' OR v_target_uid = '0' THEN RAISE EXCEPTION 'target_uid is required'; END IF;
  IF p_trigger_type NOT IN ('join', 'leave', 'interact') THEN RAISE EXCEPTION 'invalid trigger_type: %', p_trigger_type; END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RAISE EXCEPTION 'active staff % was not found', p_staff_id; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  -- Realtime is a QR-only capability. A Web account is rejected below even
  -- when Product 16 keeps QR available beside Product 18 Web.
  IF NOT COALESCE(v_mode.qr_enabled, false)
    OR (v_runtime_target = 'server' AND NOT COALESCE(v_mode.is_zalo_server, false))
    OR (v_runtime_target = 'desktop' AND COALESCE(v_mode.is_zalo_server, false))
  THEN RAISE EXCEPTION 'runtime_not_owner'; END IF;

  PERFORM 1
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id = 'zalo_message_group_realtime'
    AND campaign.status IN ('chờ xử lý', 'đang chạy')
    AND COALESCE(campaign.is_delete, false) = false
  FOR SHARE OF campaign;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime_control_paused'; END IF;

  PERFORM 1
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND account.is_active = true
    AND account.status IN ('chờ xử lý', 'đang chạy')
    AND COALESCE(account.is_delete, false) = false
  FOR SHARE OF account;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime_control_paused'; END IF;

  INSERT INTO public.auto_campaign_zalo_realtime_group_events (
    campaign_id, account_id, group_id, group_name, trigger_type,
    target_uid, target_name, event_time, raw_payload
  ) VALUES (
    p_campaign_id, p_account_id, v_group_id, v_group_name, p_trigger_type,
    v_target_uid, v_target_name, COALESCE(p_event_time, now()), COALESCE(p_raw_payload, '{}'::jsonb)
  ) ON CONFLICT (campaign_id, target_uid) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT event.id, event.input_data_id INTO v_event_id, v_input_data_id
    FROM public.auto_campaign_zalo_realtime_group_events AS event
    WHERE event.campaign_id = p_campaign_id AND event.target_uid = v_target_uid;
    RETURN QUERY SELECT false, v_event_id, v_input_data_id;
    RETURN;
  END IF;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, input_id, name, uid, status, note, schedule
  ) VALUES (
    p_campaign_id, NULL, v_target_name, v_target_uid, 'chờ xử lý', '', v_schedule_at
  ) RETURNING id INTO v_input_data_id;

  UPDATE public.auto_campaign_zalo_realtime_group_events
  SET input_data_id = v_input_data_id, updated_at = now()
  WHERE id = v_event_id;
  UPDATE public.auto_campaigns
  SET schedule = v_schedule_at, updated_at = now()
  WHERE id = p_campaign_id AND account_id = p_account_id
    AND status IN ('chờ xử lý', 'đang chạy')
    AND (schedule IS NULL OR schedule < now() OR schedule > v_schedule_at);

  RETURN QUERY SELECT true, v_event_id, v_input_data_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_zalo_server_run_unit(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_input_data_ids bigint[] DEFAULT ARRAY[]::bigint[]
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_status text,
  account_status text,
  claimed_count integer
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_mode record;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_input_data_ids bigint[] := ARRAY(
    SELECT DISTINCT ids.input_id
    FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    ORDER BY ids.input_id
  );
  v_input_data_id bigint;
  v_claimed_count integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    WHERE ids.input_id IS NULL OR ids.input_id <= 0
  ) THEN RAISE EXCEPTION 'Input data IDs must be positive integers'; END IF;
  IF cardinality(v_input_data_ids) > 50 THEN
    RAISE EXCEPTION 'A Zalo Server run unit cannot contain more than 50 input rows';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT COALESCE(v_mode.is_zalo_server, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  SELECT campaign.status, account.status, account.login_status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO v_campaign_status, v_account_status, v_account_login_status,
    v_account_is_active, v_account_is_delete, v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_found', NULL::text, NULL::text, 0; RETURN; END IF;
  IF v_campaign_is_delete THEN RETURN QUERY SELECT false, 'campaign_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_is_delete THEN RETURN QUERY SELECT false, 'account_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF NOT v_account_is_active THEN RETURN QUERY SELECT false, 'account_inactive', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN RETURN QUERY SELECT false, 'account_logged_out', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_campaign_status IS DISTINCT FROM 'đang chạy' OR v_account_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT false, 'runtime_control_paused', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;

  IF cardinality(v_input_data_ids) > 0 THEN
    FOR v_input_data_id IN
      SELECT input_data.id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = ANY(v_input_data_ids)
        AND input_data.campaign_id = p_campaign_id
        AND COALESCE(input_data.is_delete, false) = false
        AND input_data.status = 'chờ xử lý'
      ORDER BY input_data.id
      FOR UPDATE OF input_data
    LOOP
      v_claimed_count := v_claimed_count + 1;
    END LOOP;
    IF v_claimed_count <> cardinality(v_input_data_ids) THEN
      RETURN QUERY SELECT false, 'input_not_pending', v_campaign_status, v_account_status, 0;
      RETURN;
    END IF;
    UPDATE public.auto_campaign_input_data
    SET status = 'đang chạy', date_action = now()
    WHERE id = ANY(v_input_data_ids) AND campaign_id = p_campaign_id;
  END IF;

  RETURN QUERY SELECT true, 'claimed', v_campaign_status, v_account_status, v_claimed_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_campaign(
  p_campaign_id bigint,
  p_staff_id bigint,
  p_note text,
  p_update_note boolean
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_id bigint,
  account_id bigint,
  campaign_status text,
  account_status text
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_mode record;
  v_account_id bigint;
  v_campaign_status text;
  v_account_status text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Campaign and staff IDs must be positive integers';
  END IF;
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::bigint, NULL::text, NULL::text;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT COALESCE(v_mode.is_zalo_server, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::bigint, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.account_id, campaign.status, account.status
  INTO v_account_id, v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_campaign_id, NULL::bigint, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_campaign_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT true, 'campaign_control_won', p_campaign_id, v_account_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;
  IF v_account_status IS DISTINCT FROM 'đang chạy' THEN
    UPDATE public.auto_campaigns
    SET status = 'chờ xử lý', note = NULL, updated_at = now()
    WHERE id = p_campaign_id AND status = 'đang chạy';
    RETURN QUERY SELECT true, 'account_control_won', p_campaign_id, v_account_id, 'chờ xử lý', v_account_status;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'chờ xử lý'
  ) THEN
    UPDATE public.auto_campaigns
    SET status = 'chờ xử lý', note = NULL, updated_at = now()
    WHERE id = p_campaign_id AND status = 'đang chạy';
    RETURN QUERY SELECT true, 'pending_input_remaining', p_campaign_id, v_account_id, 'chờ xử lý', v_account_status;
    RETURN;
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET status = 'hoàn thành',
    note = CASE WHEN COALESCE(p_update_note, false) THEN p_note ELSE campaign.note END,
    updated_at = now()
  WHERE campaign.id = p_campaign_id AND campaign.status = 'đang chạy';
  RETURN QUERY SELECT true, 'completed', p_campaign_id, v_account_id, 'hoàn thành', v_account_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_zalo_server_campaign_status(
  p_campaign_id bigint,
  p_staff_id bigint,
  p_status text
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_id bigint,
  campaign_status text,
  account_status text
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_target_status text := lower(btrim(COALESCE(p_status, '')));
  v_organization_id bigint;
  v_mode record;
  v_campaign_status text;
  v_account_status text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Campaign and staff IDs must be positive integers';
  END IF;
  IF v_target_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT COALESCE(v_mode.is_zalo_server, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.status, account.status
  INTO v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_campaign_status = v_target_status THEN
    RETURN QUERY SELECT true, 'already_target', p_campaign_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;
  IF (v_target_status = 'tạm dừng' AND v_campaign_status IN ('chờ xử lý', 'đang chạy'))
    OR (v_target_status = 'chờ xử lý' AND v_campaign_status = 'tạm dừng')
  THEN
    UPDATE public.auto_campaigns
    SET status = v_target_status, note = NULL, updated_at = now()
    WHERE id = p_campaign_id;
    RETURN QUERY SELECT true, 'updated', p_campaign_id, v_target_status, v_account_status;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_campaign_status, v_account_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_zalo_server_account_status(
  p_account_id bigint,
  p_staff_id bigint,
  p_status text
)
RETURNS TABLE(
  ok boolean,
  reason text,
  account_id bigint,
  account_status text,
  campaign_status text
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_target_status text := lower(btrim(COALESCE(p_status, '')));
  v_organization_id bigint;
  v_mode record;
  v_account_status text;
  v_campaign_status text;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_target_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RETURN QUERY SELECT false, 'invalid_transition', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
  IF NOT COALESCE(v_mode.is_zalo_server, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT account.status INTO v_account_status
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.status INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  WHERE campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = v_organization_id
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status IN ('đang chạy', 'tạm dừng', 'chờ xử lý')
  ORDER BY CASE campaign.status WHEN 'đang chạy' THEN 0 WHEN 'tạm dừng' THEN 1 ELSE 2 END,
    campaign.updated_at DESC NULLS LAST, campaign.id DESC
  LIMIT 1;

  IF v_account_status = v_target_status THEN
    RETURN QUERY SELECT true, 'already_target', p_account_id, v_account_status, v_campaign_status;
    RETURN;
  END IF;
  IF (v_target_status = 'tạm dừng' AND v_account_status IN ('chờ xử lý', 'đang chạy'))
    OR (v_target_status = 'chờ xử lý' AND v_account_status = 'tạm dừng')
  THEN
    UPDATE public.auto_accounts SET status = v_target_status, updated_at = now()
    WHERE id = p_account_id;
    RETURN QUERY SELECT true, 'updated', p_account_id, v_target_status, v_campaign_status;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, 'invalid_transition', p_account_id, v_account_status, v_campaign_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_zalo_server_run_control_state(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint
)
RETURNS TABLE(
  campaign_id bigint,
  account_id bigint,
  campaign_status text,
  account_status text,
  account_login_status text,
  account_is_active boolean,
  account_is_delete boolean,
  campaign_is_delete boolean,
  pause_requested boolean,
  should_stop boolean,
  hard_stop_reason text
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_mode record;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_pause_requested boolean := false;
  v_hard_stop_reason text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    v_hard_stop_reason := 'runtime_not_owner';
  ELSE
    SELECT * INTO v_mode FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);
    IF NOT COALESCE(v_mode.is_zalo_server, false) THEN
      v_hard_stop_reason := 'runtime_not_owner';
    END IF;
  END IF;

  SELECT campaign.status, account.status, account.login_status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO v_campaign_status, v_account_status, v_account_login_status,
    v_account_is_active, v_account_is_delete, v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false;

  IF NOT FOUND THEN
    v_hard_stop_reason := COALESCE(v_hard_stop_reason, 'not_found');
  ELSE
    v_pause_requested := v_campaign_status IS DISTINCT FROM 'đang chạy'
      OR v_account_status IS DISTINCT FROM 'đang chạy';
    IF v_hard_stop_reason IS NULL AND v_campaign_is_delete THEN
      v_hard_stop_reason := 'campaign_deleted';
    ELSIF v_hard_stop_reason IS NULL AND v_account_is_delete THEN
      v_hard_stop_reason := 'account_deleted';
    ELSIF v_hard_stop_reason IS NULL AND NOT v_account_is_active THEN
      v_hard_stop_reason := 'account_inactive';
    ELSIF v_hard_stop_reason IS NULL AND v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
      v_hard_stop_reason := 'account_logged_out';
    END IF;
  END IF;

  RETURN QUERY SELECT p_campaign_id, p_account_id, v_campaign_status,
    v_account_status, v_account_login_status, v_account_is_active,
    v_account_is_delete, v_campaign_is_delete, v_pause_requested,
    v_pause_requested OR v_hard_stop_reason IS NOT NULL, v_hard_stop_reason;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_campaign_runtime(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_mode record;
  v_is_zalo boolean;
  v_is_web boolean;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.account_id = p_account_id
  FOR UPDATE OF campaign;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN false; END IF;

  IF COALESCE(v_campaign.is_delete, false)
    OR v_campaign.status <> 'chờ xử lý'
    OR v_campaign.schedule IS NULL
    OR v_campaign.schedule > now()
    OR (v_campaign.daily_stop_time IS NOT NULL
      AND v_campaign.daily_stop_time < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time)
    OR COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR v_account.status <> 'chờ xử lý'
    OR v_account.login_status <> 'đã đăng nhập'
  THEN
    RETURN false;
  END IF;

  v_is_zalo := lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'zalo';
  v_is_web := COALESCE(v_account.is_zalo_show_web, false);

  IF v_runtime_target = 'server' THEN
    IF NOT v_is_zalo OR v_is_web
      OR NOT COALESCE(v_mode.qr_enabled, false)
      OR NOT COALESCE(v_mode.is_zalo_server, false)
    THEN RETURN false; END IF;
  ELSIF v_is_zalo AND (
    (v_is_web AND NOT COALESCE(v_mode.web_enabled, false))
    OR (NOT v_is_web AND (
      NOT COALESCE(v_mode.qr_enabled, false)
      OR COALESCE(v_mode.is_zalo_server, false)
    ))
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy', note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_requires_login boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_mode record;
  v_is_web boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'staff_not_active');
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'account_not_found');
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
    OR (COALESCE(p_requires_login, true) AND v_account.login_status <> 'đã đăng nhập')
    OR v_account.status NOT IN ('chờ xử lý', 'tạm dừng')
  THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'account_not_available');
  END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  IF (v_runtime_target = 'server' AND (
      v_is_web
      OR NOT COALESCE(v_mode.qr_enabled, false)
      OR NOT COALESCE(v_mode.is_zalo_server, false)
    ))
    OR (v_runtime_target = 'desktop' AND (
      (v_is_web AND NOT COALESCE(v_mode.web_enabled, false))
      OR (NOT v_is_web AND (
        NOT COALESCE(v_mode.qr_enabled, false)
        OR COALESCE(v_mode.is_zalo_server, false)
      ))
    ))
  THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'runtime_not_owner');
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
$function$;

CREATE OR REPLACE FUNCTION public.release_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_previous_status text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
  v_mode record;
  v_is_web boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN false; END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  IF (v_runtime_target = 'server' AND (
      v_is_web
      OR NOT COALESCE(v_mode.qr_enabled, false)
      OR NOT COALESCE(v_mode.is_zalo_server, false)
    ))
    -- Release is cleanup, not a new operation. Desktop may release a subtype
    -- that became hidden while it was in flight. Web can never be VPS-owned;
    -- QR is protected only when the live effective owner is actually Server.
    OR (v_runtime_target = 'desktop'
      AND NOT v_is_web
      AND COALESCE(v_mode.is_zalo_server, false))
  THEN RETURN false; END IF;

  UPDATE public.auto_accounts
  SET status = v_previous_status, updated_at = now()
  WHERE id = p_account_id AND status = 'đang chạy';
  RETURN FOUND;
END;
$function$;

COMMENT ON FUNCTION public.resolve_organization_zalo_runtime_mode(bigint) IS
  'Resolve newest active Product 16 and Product 18 rows independently, returning QR/Web capabilities, Web-over-Server ownership, shared limits and an opaque revision.';

CREATE OR REPLACE FUNCTION public.get_staff_zalo_runtime_mode(
  p_staff_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_mode record;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'is_zalo_server', COALESCE(v_mode.is_zalo_server, false),
    'is_zalo_show_web', COALESCE(v_mode.web_enabled, false),
    'zalo_qr_enabled', COALESCE(v_mode.qr_enabled, false),
    'zalo_web_enabled', COALESCE(v_mode.web_enabled, false),
    'revision', COALESCE(v_mode.mode_revision, 'none:' || v_organization_id::text)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.discover_zalo_server_runtime_users(
  p_after_staff_id bigint DEFAULT 0,
  p_limit integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $function$
DECLARE
  v_page_size integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
  v_result jsonb;
BEGIN
  IF p_after_staff_id IS NULL OR p_after_staff_id < 0 THEN
    RAISE EXCEPTION 'After staff ID must be zero or greater';
  END IF;

  WITH organization_modes AS (
    SELECT mode.*,
      organization_id.organization_id
    FROM (
      SELECT DISTINCT entitlement.organization_id
      FROM public.org_organization_product AS entitlement
      WHERE entitlement.product_id IN (16, 18)
        AND entitlement.is_deleted = false
        AND entitlement.expiration_date IS NOT NULL
        AND entitlement.expiration_date >= (
          date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
            AT TIME ZONE 'Asia/Ho_Chi_Minh'
        )
    ) AS organization_id
    CROSS JOIN LATERAL public.resolve_organization_zalo_runtime_mode(
      organization_id.organization_id
    ) AS mode
    WHERE mode.is_zalo_server = true
      AND mode.qr_enabled = true
      AND mode.web_enabled = false
  ),
  page_candidates AS (
    SELECT
      staff.id AS staff_id,
      staff.organization_id,
      staff.name AS staff_name,
      staff.phone AS staff_phone,
      staff.username,
      COALESCE(staff.is_admin_akabiz, false) AS is_admin_akabiz,
      COALESCE(staff.use_test_workflow, false) AS use_test_workflow,
      organization.name AS organization_name,
      mode.entitlement_id,
      mode.mode_revision,
      mode.product_id,
      mode.product_name,
      mode.package_name,
      mode.package_type,
      mode.expiration_date,
      mode.max_sends_per_day,
      mode.max_accounts,
      mode.created_at
    FROM organization_modes AS mode
    JOIN public.org_staff AS staff
      ON staff.organization_id = mode.organization_id
    JOIN public.org_organization AS organization
      ON organization.id = staff.organization_id
    WHERE staff.is_active = true
      AND staff.id > p_after_staff_id
    ORDER BY staff.id ASC
    LIMIT v_page_size + 1
  ),
  page_items AS (
    SELECT candidate.*
    FROM page_candidates AS candidate
    ORDER BY candidate.staff_id ASC
    LIMIT v_page_size
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'staff_id', item.staff_id,
          'organization_id', item.organization_id,
          'staff_name', item.staff_name,
          'staff_phone', item.staff_phone,
          'username', item.username,
          'is_admin_akabiz', item.is_admin_akabiz,
          'use_test_workflow', item.use_test_workflow,
          'organization_name', item.organization_name,
          'entitlement_id', item.entitlement_id,
          'mode_revision', item.mode_revision,
          'product_id', item.product_id,
          'product_name', item.product_name,
          'package_name', item.package_name,
          'package_type', item.package_type,
          'expiration_date', item.expiration_date,
          'max_sends_per_day', item.max_sends_per_day,
          'max_accounts', item.max_accounts,
          'created_at', item.created_at
        ) ORDER BY item.staff_id ASC
      ) FROM page_items AS item
    ), '[]'::jsonb),
    'next_after_staff_id', CASE
      WHEN (SELECT count(*) FROM page_candidates) > v_page_size
        THEN (SELECT max(item.staff_id) FROM page_items AS item)
      ELSE NULL
    END
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_staff_zalo_runtime_mode(bigint) IS
  'Return simultaneous QR/Web capabilities plus the effective Web-over-Server runtime snapshot for one active staff.';
COMMENT ON FUNCTION public.discover_zalo_server_runtime_users(bigint, integer) IS
  'Discover active staff only when QR is granted, Web is not granted and an effective Zalo product requests Server.';
COMMENT ON FUNCTION public.recover_server_zalo_running_state(bigint, text, boolean) IS
  'Recover QR-only Zalo Server state; Web and currently incompatible QR accounts are never mutated.';
COMMENT ON FUNCTION public.claim_campaign_runtime(bigint, bigint, bigint, text) IS
  'Claim a campaign using its Zalo account subtype and the effective per-product QR/Web/Server capabilities.';
COMMENT ON FUNCTION public.claim_zalo_account_runtime_operation(bigint, bigint, text, boolean) IS
  'Reserve a Zalo account only for the runtime that owns its QR/Web subtype.';
COMMENT ON FUNCTION public.release_zalo_account_runtime_operation(bigint, bigint, text, text) IS
  'Release a Zalo account only while the caller still owns its QR/Web subtype.';
COMMENT ON FUNCTION public.create_control_zalo_account_atomic(bigint, bigint, integer, jsonb) IS
  'Create QR-only Zalo accounts from Server control when effective Server capability is available.';
COMMENT ON FUNCTION public.enqueue_campaign_zalo_realtime_group_event(
  bigint, bigint, bigint, text, text, text, text, text, text,
  timestamptz, timestamptz, jsonb
) IS
  'Enqueue Zalo realtime events for QR accounts only; Web accounts never run realtime.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Move the Zalo runtime mode source from individual staff rows to the newest
-- active Zalo entitlement of the organization.

BEGIN;

ALTER TABLE public.org_organization_product
  ADD COLUMN IF NOT EXISTS is_zalo_server boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.org_organization_product.is_zalo_server IS
  'True: every staff in the organization runs Zalo on akaAgent Zalo Server. False: they run Zalo in the desktop app.';

CREATE INDEX IF NOT EXISTS idx_org_product_zalo_runtime_mode_lookup
  ON public.org_organization_product (
    organization_id,
    created_at DESC,
    id DESC
  )
  WHERE is_deleted = false AND product_id IN (16, 18);

-- This statement-level trigger never rejects a product/mode change. It takes
-- the exclusive side of a transaction advisory lock before PostgreSQL locks
-- any affected product row. Runtime claims/recoveries take the shared side, so
-- inserting, activating, expiring, moving or updating an entitlement cannot
-- create a new effective winner in the middle of an atomic ownership check.
CREATE OR REPLACE FUNCTION public.serialize_zalo_runtime_entitlement_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_serialize_zalo_runtime_entitlement_change
  ON public.org_organization_product;

CREATE TRIGGER trg_serialize_zalo_runtime_entitlement_change
BEFORE INSERT OR UPDATE OR DELETE ON public.org_organization_product
FOR EACH STATEMENT
EXECUTE FUNCTION public.serialize_zalo_runtime_entitlement_change();

CREATE OR REPLACE FUNCTION public.get_staff_zalo_runtime_mode(
  p_staff_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
DECLARE
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_entitlement_xmin text;
  v_mode boolean := false;
  v_revision text;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
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

  SELECT
    entitlement.id,
    COALESCE(entitlement.is_zalo_server, false),
    entitlement.xmin::text
  INTO v_entitlement_id, v_mode, v_entitlement_xmin
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_mode := COALESCE(v_mode, false);
  v_revision := CASE
    WHEN v_entitlement_id IS NULL THEN 'none:' || v_organization_id::text
    ELSE v_entitlement_id::text || ':' || v_entitlement_xmin
  END;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'is_zalo_server', v_mode,
    'revision', v_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.discover_zalo_server_runtime_users(
  p_after_staff_id bigint DEFAULT 0,
  p_limit integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
DECLARE
  v_page_size integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
  v_result jsonb;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_after_staff_id IS NULL OR p_after_staff_id < 0 THEN
    RAISE EXCEPTION 'After staff ID must be zero or greater';
  END IF;

  WITH effective_zalo_entitlement AS (
    SELECT DISTINCT ON (entitlement.organization_id)
      entitlement.organization_id,
      entitlement.id AS entitlement_id,
      entitlement.xmin::text AS entitlement_xmin,
      COALESCE(entitlement.is_zalo_server, false) AS is_zalo_server,
      entitlement.product_id,
      entitlement.product_name,
      entitlement.package_name,
      entitlement.package_type,
      entitlement.expiration_date,
      entitlement.max_sends_per_day,
      entitlement.max_accounts,
      entitlement.created_at
    FROM public.org_organization_product AS entitlement
    WHERE entitlement.product_id IN (16, 18)
      AND entitlement.is_deleted = false
      AND entitlement.expiration_date IS NOT NULL
      AND entitlement.expiration_date >= v_vietnam_day_start
    ORDER BY
      entitlement.organization_id,
      entitlement.created_at DESC NULLS LAST,
      entitlement.id DESC
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
      entitlement.entitlement_id,
      entitlement.entitlement_id::text || ':' || entitlement.entitlement_xmin AS mode_revision,
      entitlement.product_id,
      entitlement.product_name,
      entitlement.package_name,
      entitlement.package_type,
      entitlement.expiration_date,
      entitlement.max_sends_per_day,
      entitlement.max_accounts,
      entitlement.created_at
    FROM effective_zalo_entitlement AS entitlement
    JOIN public.org_staff AS staff
      ON staff.organization_id = entitlement.organization_id
    JOIN public.org_organization AS organization
      ON organization.id = staff.organization_id
    WHERE entitlement.is_zalo_server = true
      AND staff.is_active = true
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
    'items', COALESCE(
      (
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
          )
          ORDER BY item.staff_id ASC
        )
        FROM page_items AS item
      ),
      '[]'::jsonb
    ),
    'next_after_staff_id', CASE
      WHEN (SELECT count(*) FROM page_candidates) > v_page_size
        THEN (SELECT max(item.staff_id) FROM page_items AS item)
      ELSE NULL
    END
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

-- A stale desktop binary may still pass p_exclude_zalo=false after the
-- organization has switched to server mode. Resolve the effective product
-- mode inside the same transaction and force Zalo exclusion so a late
-- quit/logout cannot reset work already claimed by the server.
CREATE OR REPLACE FUNCTION public.reset_desktop_running_statuses(
  p_staff_id bigint,
  p_exclude_zalo boolean DEFAULT false,
  p_zalo_uncertain_no_retry boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $$
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
  v_live_is_zalo_server boolean := false;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
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

  SELECT COALESCE(entitlement.is_zalo_server, false)
  INTO v_live_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_live_is_zalo_server := COALESCE(v_live_is_zalo_server, false);
  v_exclude_zalo := v_exclude_zalo OR v_live_is_zalo_server;

  UPDATE public.auto_campaign_input_data AS input_data
  SET
    status = CASE
      WHEN v_zalo_uncertain_no_retry AND account.flatform_type = 'zalo' THEN 'hoàn thành'
      ELSE 'chờ xử lý'
    END,
    note = CASE
      WHEN v_zalo_uncertain_no_retry AND account.flatform_type = 'zalo' THEN v_handoff_note
      ELSE input_data.note
    END
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.flatform_type <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (NOT v_exclude_zalo OR account.flatform_type <> 'zalo')
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_reset = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET
    status = CASE
      WHEN v_zalo_uncertain_no_retry AND account.flatform_type = 'zalo' THEN 'hoàn thành'
      ELSE 'chờ xử lý'
    END,
    note = CASE
      WHEN v_zalo_uncertain_no_retry AND account.flatform_type = 'zalo' THEN v_handoff_note
      ELSE campaign_input.note
    END
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.flatform_type <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (NOT v_exclude_zalo OR account.flatform_type <> 'zalo')
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_reset = ROW_COUNT;

  SELECT count(*)::integer
  INTO v_campaign_notes_reset
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON campaign.account_id = account.id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND campaign.note IS NOT NULL
    AND account.staff_id = p_staff_id
    AND account.flatform_type <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (NOT v_exclude_zalo OR account.flatform_type <> 'zalo');

  UPDATE public.auto_campaigns AS campaign
  SET
    status = 'chờ xử lý',
    note = NULL,
    updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND account.flatform_type <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (NOT v_exclude_zalo OR account.flatform_type <> 'zalo');
  GET DIAGNOSTICS v_campaigns_reset = ROW_COUNT;

  UPDATE public.auto_accounts AS account
  SET
    status = 'chờ xử lý',
    updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND account.flatform_type <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (NOT v_exclude_zalo OR account.flatform_type <> 'zalo')
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
$$;

CREATE OR REPLACE FUNCTION public.recover_server_zalo_running_state(
  p_staff_id bigint,
  p_expected_mode_revision text DEFAULT NULL,
  p_require_server_mode boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $$
DECLARE
  v_accounts_reset integer := 0;
  v_campaigns_reset integer := 0;
  v_campaign_inputs_completed integer := 0;
  v_campaign_input_data_completed integer := 0;
  v_recovery_note constant text := 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_entitlement_xmin text;
  v_live_is_zalo_server boolean := false;
  v_live_mode_revision text;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  -- Lock the stable staff row first, then take the shared entitlement mutation
  -- barrier before reading the effective entitlement. Do not use FOR SHARE on
  -- org_organization_product here: the desktop/server anon role has read-only
  -- RLS access, and PostgreSQL hides rows from locking SELECTs without an UPDATE
  -- policy. The advisory barrier already serializes every entitlement mutation.
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

  SELECT
    entitlement.id,
    COALESCE(entitlement.is_zalo_server, false),
    entitlement.xmin::text
  INTO v_entitlement_id, v_live_is_zalo_server, v_entitlement_xmin
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_live_is_zalo_server := COALESCE(v_live_is_zalo_server, false);
  v_live_mode_revision := CASE
    WHEN v_entitlement_id IS NULL THEN 'none:' || v_organization_id::text
    ELSE v_entitlement_id::text || ':' || v_entitlement_xmin
  END;

  -- A supplied revision is always a transaction barrier, including desktop
  -- crash recovery while the effective product mode is local.
  IF NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NOT NULL
    AND v_live_mode_revision IS DISTINCT FROM btrim(p_expected_mode_revision)
  THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  IF COALESCE(p_require_server_mode, false) AND (
    NOT v_live_is_zalo_server
    OR v_entitlement_id IS NULL
    OR NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  -- Recovery deliberately does not require the live flag to remain true. When
  -- server -> local handoff begins, the server that already owned the work must
  -- still settle its own rows using the current revision barrier.
  UPDATE public.auto_campaign_input_data AS input_data
  SET
    status = 'hoàn thành',
    note = v_recovery_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.flatform_type = 'zalo'
    AND COALESCE(account.is_delete, false) = false
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_completed = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET
    status = 'hoàn thành',
    note = v_recovery_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.flatform_type = 'zalo'
    AND COALESCE(account.is_delete, false) = false
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_completed = ROW_COUNT;

  UPDATE public.auto_campaigns AS campaign
  SET
    status = 'chờ xử lý',
    updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND account.flatform_type = 'zalo'
    AND COALESCE(account.is_delete, false) = false;
  GET DIAGNOSTICS v_campaigns_reset = ROW_COUNT;

  UPDATE public.auto_accounts AS account
  SET
    status = 'chờ xử lý',
    updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND account.flatform_type = 'zalo'
    AND COALESCE(account.is_delete, false) = false
    AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_accounts_reset = ROW_COUNT;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'accounts_reset', v_accounts_reset,
    'campaigns_reset', v_campaigns_reset,
    'campaign_inputs_completed', v_campaign_inputs_completed,
    'campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_campaign_runtime(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO public
AS $$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_is_zalo_server boolean := false;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'Campaign ID must be a positive integer';
  END IF;
  IF p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'Account ID must be a positive integer';
  END IF;
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  -- Claims consistently lock staff -> shared entitlement mutation barrier ->
  -- campaign -> account so mode updates cannot race the selected entitlement.
  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT
    entitlement.id,
    COALESCE(entitlement.is_zalo_server, false)
  INTO v_entitlement_id, v_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_is_zalo_server := COALESCE(v_is_zalo_server, false);

  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.account_id = p_account_id
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
  FOR UPDATE OF account;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_campaign.staff_id IS DISTINCT FROM p_staff_id
    OR v_campaign.account_id IS DISTINCT FROM p_account_id
    OR COALESCE(v_campaign.is_delete, false)
    OR v_campaign.status <> 'chờ xử lý'
    OR v_campaign.schedule IS NULL
    OR v_campaign.schedule > now()
    OR (
      v_campaign.daily_stop_time IS NOT NULL
      AND v_campaign.daily_stop_time < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    )
  THEN
    RETURN false;
  END IF;

  IF v_account.staff_id IS DISTINCT FROM p_staff_id
    OR COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR v_account.status <> 'chờ xử lý'
    OR v_account.login_status <> 'đã đăng nhập'
  THEN
    RETURN false;
  END IF;

  IF v_runtime_target = 'server' THEN
    IF lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
      OR v_entitlement_id IS NULL
      OR NOT v_is_zalo_server
    THEN
      RETURN false;
    END IF;
  ELSIF lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'zalo'
    AND (v_entitlement_id IS NULL OR v_is_zalo_server)
  THEN
    RETURN false;
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET
    status = 'đang chạy',
    note = NULL,
    updated_at = now()
  WHERE campaign.id = p_campaign_id;

  UPDATE public.auto_accounts AS account
  SET
    status = 'đang chạy',
    updated_at = now()
  WHERE account.id = p_account_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_requires_login boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_is_zalo_server boolean := false;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'Account ID must be a positive integer';
  END IF;
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
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
    RETURN jsonb_build_object('claimed', false, 'reason', 'staff_not_active');
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT
    entitlement.id,
    COALESCE(entitlement.is_zalo_server, false)
  INTO v_entitlement_id, v_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_is_zalo_server := COALESCE(v_is_zalo_server, false);

  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
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

  IF v_entitlement_id IS NULL
    OR (v_runtime_target = 'server' AND NOT v_is_zalo_server)
    OR (v_runtime_target = 'desktop' AND v_is_zalo_server)
  THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'runtime_not_owner');
  END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = 'đang chạy',
    updated_at = now()
  WHERE account.id = p_account_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_account.status,
    'runtime_target', v_runtime_target
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_previous_status text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO public
AS $$
DECLARE
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
  v_is_zalo_server boolean := false;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'Account ID must be a positive integer';
  END IF;
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT
    entitlement.id,
    COALESCE(entitlement.is_zalo_server, false)
  INTO v_entitlement_id, v_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_is_zalo_server := COALESCE(v_is_zalo_server, false);

  -- A late release from the old side of a mode handoff must not reset an
  -- account that the newly selected runtime has already claimed. With no live
  -- entitlement, only desktop cleanup is allowed; new claims remain blocked.
  IF (v_runtime_target = 'server' AND NOT v_is_zalo_server)
    OR (v_runtime_target = 'desktop' AND v_is_zalo_server)
  THEN
    RETURN false;
  END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = v_previous_status,
    updated_at = now()
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_delete, false) = false
    AND account.status = 'đang chạy';

  RETURN FOUND;
END;
$$;

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
AS $$
DECLARE
  v_event_id bigint;
  v_input_data_id bigint;
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_is_zalo_server boolean := false;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_target_uid text := btrim(COALESCE(p_target_uid, ''));
  v_target_name text := NULLIF(btrim(COALESCE(p_target_name, '')), '');
  v_group_id text := btrim(COALESCE(p_group_id, ''));
  v_group_name text := NULLIF(btrim(COALESCE(p_group_name, '')), '');
  v_schedule_at timestamptz := COALESCE(p_schedule_at, now());
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'campaign_id is required';
  END IF;
  IF p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'account_id is required';
  END IF;
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'staff_id is required';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF v_group_id = '' THEN
    RAISE EXCEPTION 'group_id is required';
  END IF;
  IF v_target_uid = '' OR v_target_uid = '0' THEN
    RAISE EXCEPTION 'target_uid is required';
  END IF;
  IF p_trigger_type NOT IN ('join', 'leave', 'interact') THEN
    RAISE EXCEPTION 'invalid trigger_type: %', p_trigger_type;
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'active staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT
    entitlement.id,
    COALESCE(entitlement.is_zalo_server, false)
  INTO v_entitlement_id, v_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_is_zalo_server := COALESCE(v_is_zalo_server, false);

  IF v_entitlement_id IS NULL
    OR (v_runtime_target = 'server' AND NOT v_is_zalo_server)
    OR (v_runtime_target = 'desktop' AND v_is_zalo_server)
  THEN
    RAISE EXCEPTION 'runtime_not_owner';
  END IF;

  PERFORM 1
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id = 'zalo_message_group_realtime'
    AND campaign.status IN ('chờ xử lý', 'đang chạy')
    AND COALESCE(campaign.is_delete, false) = false
  FOR SHARE OF campaign;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active realtime Zalo campaign % was not found', p_campaign_id;
  END IF;

  -- Keep the same staff -> shared entitlement mutation barrier -> campaign ->
  -- account lock order as campaign claims.
  PERFORM 1
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND account.is_active = true
    AND COALESCE(account.is_delete, false) = false
  FOR SHARE OF account;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active Zalo account % was not found', p_account_id;
  END IF;

  INSERT INTO public.auto_campaign_zalo_realtime_group_events (
    campaign_id,
    account_id,
    group_id,
    group_name,
    trigger_type,
    target_uid,
    target_name,
    event_time,
    raw_payload
  )
  VALUES (
    p_campaign_id,
    p_account_id,
    v_group_id,
    v_group_name,
    p_trigger_type,
    v_target_uid,
    v_target_name,
    COALESCE(p_event_time, now()),
    COALESCE(p_raw_payload, '{}'::jsonb)
  )
  ON CONFLICT (campaign_id, target_uid) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT event.id, event.input_data_id
    INTO v_event_id, v_input_data_id
    FROM public.auto_campaign_zalo_realtime_group_events AS event
    WHERE event.campaign_id = p_campaign_id
      AND event.target_uid = v_target_uid;

    RETURN QUERY SELECT false, v_event_id, v_input_data_id;
    RETURN;
  END IF;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id,
    input_id,
    name,
    uid,
    status,
    note,
    schedule
  )
  VALUES (
    p_campaign_id,
    NULL,
    v_target_name,
    v_target_uid,
    'chờ xử lý',
    '',
    v_schedule_at
  )
  RETURNING id INTO v_input_data_id;

  UPDATE public.auto_campaign_zalo_realtime_group_events AS event
  SET
    input_data_id = v_input_data_id,
    updated_at = now()
  WHERE event.id = v_event_id;

  UPDATE public.auto_campaigns AS campaign
  SET
    schedule = v_schedule_at,
    updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND (
      campaign.schedule IS NULL
      OR campaign.schedule < now()
      OR campaign.schedule > v_schedule_at
    );

  RETURN QUERY SELECT true, v_event_id, v_input_data_id;
END;
$$;

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
AS $$
DECLARE
  v_account_id bigint;
  v_account_count integer := 0;
  v_account_group_id bigint := NULLIF(p_account->>'accountGroupId', '')::bigint;
  v_proxy_id bigint := NULLIF(p_account->>'proxyId', '')::bigint;
  v_entitlement_id bigint;
  v_is_zalo_server boolean := false;
  v_effective_max_accounts integer;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR jsonb_typeof(COALESCE(p_account, '{}'::jsonb)) <> 'object'
    OR NULLIF(btrim(COALESCE(p_account->>'name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_control_zalo_account_payload';
  END IF;

  PERFORM 1
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT
    entitlement.id,
    COALESCE(entitlement.is_zalo_server, false),
    entitlement.max_accounts
  INTO v_entitlement_id, v_is_zalo_server, v_effective_max_accounts
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = p_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  IF v_entitlement_id IS NULL OR COALESCE(v_is_zalo_server, false) = false THEN
    RETURN jsonb_build_object('created', false, 'reason', 'capability_unavailable');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account:' || p_staff_id::text, 0));

  SELECT count(*)::integer INTO v_account_count
  FROM public.auto_accounts
  WHERE staff_id = p_staff_id
    AND organization_id = p_organization_id
    AND flatform_type = 'zalo'
    AND COALESCE(is_delete, false) = false;
  -- p_max_accounts remains in the public signature for compatibility, but the
  -- serialized effective entitlement is the only authoritative limit.
  IF v_effective_max_accounts IS NOT NULL
    AND v_effective_max_accounts > 0
    AND v_account_count >= v_effective_max_accounts
  THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'account_limit_reached',
      'max_accounts', v_effective_max_accounts
    );
  END IF;

  IF v_account_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auto_account_groups
    WHERE id = v_account_group_id
      AND staff_id = p_staff_id
      AND organization_id = p_organization_id
      AND flatform_type = 'zalo'
      AND COALESCE(is_delete, false) = false
  ) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'account_group_not_found');
  END IF;
  IF v_proxy_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auto_proxies
    WHERE id = v_proxy_id
      AND staff_id = p_staff_id
      AND organization_id = p_organization_id
      AND COALESCE(is_delete, false) = false
  ) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'proxy_not_found');
  END IF;

  INSERT INTO public.auto_accounts (
    name, flatform_type, login_status, status, is_active,
    account_group_id, proxy_id, staff_id, organization_id, is_delete
  ) VALUES (
    btrim(p_account->>'name'),
    'zalo',
    'chưa đăng nhập',
    'chờ xử lý',
    COALESCE((p_account->>'isActive')::boolean, true),
    v_account_group_id,
    v_proxy_id,
    p_staff_id,
    p_organization_id,
    false
  ) RETURNING id INTO v_account_id;

  RETURN jsonb_build_object('created', true, 'account_id', v_account_id);
END;
$$;

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

  v_zalo_enabled := v_zalo_package.id IS NOT NULL
    AND COALESCE(v_zalo_package.is_zalo_server, false);
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
      'is_zalo_server', v_zalo_enabled
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

COMMENT ON FUNCTION public.get_staff_zalo_runtime_mode(bigint) IS
  'Read the organization effective Zalo entitlement runtime flag and entitlement-id/xmin revision used to reject stale ownership markers.';

COMMENT ON FUNCTION public.discover_zalo_server_runtime_users(bigint, integer) IS
  'Keyset-paginated discovery of active staff whose organization newest active Zalo entitlement selects server runtime.';

COMMENT ON FUNCTION public.reset_desktop_running_statuses(bigint, boolean, boolean) IS
  'Reset desktop-owned non-SMS state while always excluding Zalo when the live organization entitlement selects server runtime.';

COMMENT ON FUNCTION public.recover_server_zalo_running_state(bigint, text, boolean) IS
  'Recover interrupted running state for one staff Zalo runtime using the organization effective entitlement revision barrier.';

COMMENT ON FUNCTION public.claim_campaign_runtime(bigint, bigint, bigint, text) IS
  'Atomically claim one due campaign/account pair for the runtime selected by the organization effective Zalo entitlement.';

COMMENT ON FUNCTION public.claim_zalo_account_runtime_operation(bigint, bigint, text, boolean) IS
  'Atomically reserve one Zalo account for the runtime selected by the organization effective Zalo entitlement.';

COMMENT ON FUNCTION public.release_zalo_account_runtime_operation(bigint, bigint, text, text) IS
  'Conditionally release a Zalo account claim only when its runtime still owns the organization effective Zalo mode.';

COMMENT ON FUNCTION public.enqueue_campaign_zalo_realtime_group_event(
  bigint,
  bigint,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  jsonb
) IS
  'Atomically enqueue a realtime Zalo event only for the runtime selected by the organization effective Zalo entitlement.';

COMMENT ON FUNCTION public.create_control_zalo_account_atomic(bigint, bigint, integer, jsonb) IS
  'Atomically create a Zalo account only for a staff whose organization effective Zalo entitlement selects server runtime.';

COMMENT ON FUNCTION public.aka_agent_authenticate_control_session(text) IS
  'Resolves a live control session and capabilities using the organization newest active Zalo/SMS entitlements.';

NOTIFY pgrst, 'reload schema';

COMMIT;

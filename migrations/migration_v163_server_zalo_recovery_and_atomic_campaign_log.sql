-- Staff-scoped Zalo runtime mode plus durable primitives shared by desktop and server.

BEGIN;

ALTER TABLE public.org_staff
  ADD COLUMN IF NOT EXISTS is_zalo_server boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.org_staff.is_zalo_server IS
  'True: Zalo campaigns, scans and sessions run on akaAgent Zalo Server. False: they run in the staff desktop app.';

CREATE INDEX IF NOT EXISTS idx_org_staff_zalo_server_active
  ON public.org_staff (id)
  WHERE is_active = true AND is_zalo_server = true;

DROP TRIGGER IF EXISTS trg_guard_org_staff_zalo_runtime_mode_change ON public.org_staff;
DROP FUNCTION IF EXISTS public.guard_org_staff_zalo_runtime_mode_change();

CREATE OR REPLACE FUNCTION public.get_staff_zalo_runtime_mode(
  p_staff_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
DECLARE
  v_mode boolean;
  v_revision text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.is_zalo_server, staff.xmin::text
  INTO v_mode, v_revision
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'is_zalo_server', COALESCE(v_mode, false),
    'revision', v_revision
  );
END;
$$;

DROP FUNCTION IF EXISTS public.append_auto_campaign_log(bigint, text);

CREATE OR REPLACE FUNCTION public.append_auto_campaign_log(
  p_campaign_id bigint,
  p_staff_id bigint,
  p_log_line text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'Campaign ID must be a positive integer';
  END IF;

  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  IF NULLIF(btrim(COALESCE(p_log_line, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Campaign log line must not be empty';
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET
    log = CASE
      WHEN NULLIF(campaign.log, '') IS NULL THEN p_log_line
      ELSE campaign.log || E'\n' || p_log_line
    END,
    updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND COALESCE(campaign.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active campaign % was not found', p_campaign_id;
  END IF;

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.recover_server_zalo_running_state(bigint);

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
  v_live_is_zalo_server boolean := false;
  v_live_mode_revision text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.is_zalo_server, staff.xmin::text
  INTO v_live_is_zalo_server, v_live_mode_revision
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR UPDATE OF staff;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  -- A supplied revision is always a transaction barrier, including desktop
  -- crash recovery while is_zalo_server=false. This prevents stale desktop
  -- cleanup from touching work after an admin switches the staff back to VPS.
  IF NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NOT NULL
    AND v_live_mode_revision IS DISTINCT FROM btrim(p_expected_mode_revision)
  THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  IF COALESCE(p_require_server_mode, false) AND (
    NOT v_live_is_zalo_server
    OR NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  -- Recovery deliberately does not require the live flag to remain true. When
  -- server -> local handoff begins, the server that already owned the work must
  -- still settle its own rows after is_zalo_server has changed to false.
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

CREATE OR REPLACE FUNCTION public.inspect_staff_zalo_running_state(
  p_staff_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $$
DECLARE
  v_accounts_running integer := 0;
  v_campaigns_running integer := 0;
  v_campaign_inputs_running integer := 0;
  v_campaign_input_data_running integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.is_active = true
  ) THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  SELECT count(*)::integer
  INTO v_accounts_running
  FROM public.auto_accounts AS account
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_delete, false) = false
    AND account.status = 'đang chạy';

  SELECT count(*)::integer
  INTO v_campaigns_running
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(account.is_delete, false) = false
    AND campaign.status = 'đang chạy';

  SELECT count(*)::integer
  INTO v_campaign_inputs_running
  FROM public.auto_campaign_inputs AS campaign_input
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = campaign_input.campaign_id
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(campaign_input.is_delete, false) = false
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(account.is_delete, false) = false
    AND campaign_input.status = 'đang chạy';

  SELECT count(*)::integer
  INTO v_campaign_input_data_running
  FROM public.auto_campaign_input_data AS input_data
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = input_data.campaign_id
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(input_data.is_delete, false) = false
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(account.is_delete, false) = false
    AND input_data.status = 'đang chạy';

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'has_running_state',
      v_accounts_running > 0
      OR v_campaigns_running > 0
      OR v_campaign_inputs_running > 0
      OR v_campaign_input_data_running > 0,
    'accounts_running', v_accounts_running,
    'campaigns_running', v_campaigns_running,
    'campaign_inputs_running', v_campaign_inputs_running,
    'campaign_input_data_running', v_campaign_input_data_running
  );
END;
$$;

DROP FUNCTION IF EXISTS public.reset_desktop_running_statuses(bigint, boolean);

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
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  PERFORM 1
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR UPDATE OF staff;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  -- The caller passes the mode captured for its own desktop session. Do not
  -- replace it with the live flag: after local -> server, the old desktop must
  -- still clean up the Zalo work it owned before the server can start.

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
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_staff_is_zalo_server boolean := false;
  v_has_active_zalo_product boolean := false;
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

  -- Staff is always locked before campaign/account rows. Claims share this
  -- lock; recovery, reset and mode changes take the conflicting update lock.
  SELECT staff.organization_id, COALESCE(staff.is_zalo_server, false)
  INTO v_organization_id, v_staff_is_zalo_server
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN false;
  END IF;

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

  SELECT EXISTS (
    SELECT 1
    FROM public.org_organization_product AS organization_product
    WHERE organization_product.organization_id = v_organization_id
      AND organization_product.product_id IN (16, 18)
      AND COALESCE(organization_product.is_deleted, false) = false
      AND organization_product.expiration_date IS NOT NULL
      AND organization_product.expiration_date >= v_vietnam_day_start
  )
  INTO v_has_active_zalo_product;

  IF v_runtime_target = 'server' THEN
    IF lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
      OR NOT v_staff_is_zalo_server
      OR NOT v_has_active_zalo_product
    THEN
      RETURN false;
    END IF;
  ELSIF lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'zalo'
    AND (v_staff_is_zalo_server OR NOT v_has_active_zalo_product)
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

DROP FUNCTION IF EXISTS public.claim_zalo_account_runtime_operation(bigint, bigint, text);

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
  v_staff_is_zalo_server boolean := false;
  v_has_active_zalo_product boolean := false;
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

  SELECT staff.organization_id, COALESCE(staff.is_zalo_server, false)
  INTO v_organization_id, v_staff_is_zalo_server
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'staff_not_active');
  END IF;

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

  SELECT EXISTS (
    SELECT 1
    FROM public.org_organization_product AS organization_product
    WHERE organization_product.organization_id = v_organization_id
      AND organization_product.product_id IN (16, 18)
      AND COALESCE(organization_product.is_deleted, false) = false
      AND organization_product.expiration_date IS NOT NULL
      AND organization_product.expiration_date >= v_vietnam_day_start
  )
  INTO v_has_active_zalo_product;

  IF NOT v_has_active_zalo_product
    OR (v_runtime_target = 'server' AND NOT v_staff_is_zalo_server)
    OR (v_runtime_target = 'desktop' AND v_staff_is_zalo_server)
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
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
  v_staff_is_zalo_server boolean := false;
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

  SELECT COALESCE(staff.is_zalo_server, false)
  INTO v_staff_is_zalo_server
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- A late release from the old side of a mode handoff must not reset an
  -- account that the newly selected runtime has already claimed. The old
  -- runtime's final atomic recovery barrier settles any claim left behind.
  IF (v_runtime_target = 'server' AND NOT v_staff_is_zalo_server)
    OR (v_runtime_target = 'desktop' AND v_staff_is_zalo_server)
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

DROP FUNCTION IF EXISTS public.enqueue_campaign_zalo_realtime_group_event(
  bigint,
  bigint,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  jsonb
);

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
  v_staff_is_zalo_server boolean := false;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_target_uid text := btrim(COALESCE(p_target_uid, ''));
  v_target_name text := NULLIF(btrim(COALESCE(p_target_name, '')), '');
  v_group_id text := btrim(COALESCE(p_group_id, ''));
  v_group_name text := NULLIF(btrim(COALESCE(p_group_name, '')), '');
  v_schedule_at timestamptz := COALESCE(p_schedule_at, now());
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

  SELECT COALESCE(staff.is_zalo_server, false)
  INTO v_staff_is_zalo_server
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active staff % was not found', p_staff_id;
  END IF;
  IF (v_runtime_target = 'server' AND NOT v_staff_is_zalo_server)
    OR (v_runtime_target = 'desktop' AND v_staff_is_zalo_server)
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

  -- Keep the same staff -> campaign -> account lock order as campaign claims.
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

COMMENT ON FUNCTION public.append_auto_campaign_log(bigint, bigint, text) IS
  'Atomically append one already-formatted line to an active campaign log.';

COMMENT ON FUNCTION public.get_staff_zalo_runtime_mode(bigint) IS
  'Read the live Zalo runtime flag with the PostgreSQL row revision used to reject stale VPS ownership markers.';

COMMENT ON FUNCTION public.recover_server_zalo_running_state(bigint, text, boolean) IS
  'Recover interrupted running state for one staff Zalo runtime without retrying uncertain targets.';

COMMENT ON FUNCTION public.inspect_staff_zalo_running_state(bigint) IS
  'Inspect active non-deleted Zalo running rows so a newly enabled server runtime can wait for desktop cleanup.';

COMMENT ON FUNCTION public.reset_desktop_running_statuses(bigint, boolean, boolean) IS
  'Reset interrupted desktop state; a runtime handoff completes uncertain Zalo input rows instead of retrying them.';

COMMENT ON FUNCTION public.claim_campaign_runtime(bigint, bigint, bigint, text) IS
  'Atomically claim one due campaign/account pair for the runtime selected by org_staff.is_zalo_server.';

COMMENT ON FUNCTION public.claim_zalo_account_runtime_operation(bigint, bigint, text, boolean) IS
  'Atomically reserve one Zalo account for a non-campaign operation; QR login may opt out of the logged-in requirement.';

COMMENT ON FUNCTION public.release_zalo_account_runtime_operation(bigint, bigint, text, text) IS
  'Conditionally release a non-campaign Zalo account claim after the old runtime finishes during a handoff.';

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
  'Atomically enqueue a realtime Zalo event only for the runtime selected by org_staff.is_zalo_server.';

NOTIFY pgrst, 'reload schema';

COMMIT;

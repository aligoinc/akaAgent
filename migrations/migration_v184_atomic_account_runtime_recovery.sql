-- Atomic account-only runtime ownership for Facebook/Email and no-retry
-- desktop recovery. This migration changes schema objects only; it does not
-- mutate existing account, campaign, input or input-data rows when applied.

BEGIN;

-- Avoid waiting behind a long-lived production transaction while taking the
-- brief metadata lock required by ADD COLUMN / CREATE TRIGGER.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.auto_accounts
  ADD COLUMN IF NOT EXISTS runtime_operation_claim_token uuid;

COMMENT ON COLUMN public.auto_accounts.runtime_operation_claim_token IS
  'Opaque ownership token for short account-only runtime operations such as contact scans.';

CREATE OR REPLACE FUNCTION public.guard_auto_account_runtime_operation_claim_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM 'đang chạy' THEN
    NEW.runtime_operation_claim_token := NULL;
  ELSIF OLD.status IS DISTINCT FROM 'đang chạy'
    AND NEW.runtime_operation_claim_token IS NOT DISTINCT FROM OLD.runtime_operation_claim_token
  THEN
    -- A different runtime (for example claim_campaign_runtime or an older app)
    -- entered running state without supplying an account-operation token.
    NEW.runtime_operation_claim_token := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_auto_accounts_runtime_operation_claim_token
  ON public.auto_accounts;
CREATE TRIGGER trg_auto_accounts_runtime_operation_claim_token
BEFORE UPDATE OF status, runtime_operation_claim_token ON public.auto_accounts
FOR EACH ROW
EXECUTE FUNCTION public.guard_auto_account_runtime_operation_claim_token();

REVOKE ALL ON FUNCTION public.guard_auto_account_runtime_operation_claim_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_auto_account_runtime_operation_claim_token()
  TO anon, authenticated, service_role;

-- Remove the abandoned server-generated-token draft if it was ever installed manually.
DROP FUNCTION IF EXISTS public.claim_non_zalo_account_runtime_operation(
  bigint,
  bigint,
  text,
  text,
  boolean
);

CREATE OR REPLACE FUNCTION public.claim_non_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_platform text,
  p_previous_status text,
  p_claim_token uuid,
  p_requires_login boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
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
$function$;

-- Remove the abandoned pre-release draft if it was ever installed manually.
DROP FUNCTION IF EXISTS public.release_non_zalo_account_runtime_operation(
  bigint,
  bigint,
  text,
  text
);
DROP FUNCTION IF EXISTS public.release_non_zalo_account_runtime_operation(
  bigint,
  bigint,
  text,
  text,
  text
);

CREATE OR REPLACE FUNCTION public.release_non_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_platform text,
  p_previous_status text,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
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
$function$;

CREATE OR REPLACE FUNCTION public.reset_desktop_running_statuses_no_retry(
  p_staff_id bigint,
  p_exclude_zalo boolean DEFAULT false,
  p_zalo_uncertain_no_retry boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
DECLARE
  v_result jsonb;
  v_campaign_inputs_completed integer := 0;
  v_campaign_input_data_completed integer := 0;
  v_non_zalo_accounts_reset integer := 0;
  v_non_zalo_campaigns_reset integer := 0;
  v_non_zalo_campaign_notes_reset integer := 0;
  v_interrupted_note constant text := 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  -- Hold the same staff-row barrier as campaign/account claims for the entire
  -- no-retry completion + existing recovery sequence.
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR UPDATE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  UPDATE public.auto_campaign_input_data AS input_data
  SET status = 'hoàn thành', note = v_interrupted_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_completed = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET status = 'hoàn thành', note = v_interrupted_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_completed = ROW_COUNT;

  SELECT count(*)::integer INTO v_non_zalo_campaign_notes_reset
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND campaign.note IS NOT NULL
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false;

  UPDATE public.auto_campaigns AS campaign
  SET status = 'chờ xử lý', note = NULL, updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false;
  GET DIAGNOSTICS v_non_zalo_campaigns_reset = ROW_COUNT;

  UPDATE public.auto_accounts AS account
  SET status = 'chờ xử lý', updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_non_zalo_accounts_reset = ROW_COUNT;

  -- The deployed recovery function executes inside this same transaction. It
  -- now sees non-Zalo children as completed, while preserving all QR/Web/Server
  -- ownership rules and resetting only the remaining eligible parent rows.
  v_result := public.reset_desktop_running_statuses(
    p_staff_id,
    COALESCE(p_exclude_zalo, false),
    COALESCE(p_zalo_uncertain_no_retry, false)
  );

  RETURN v_result || jsonb_build_object(
    'accounts_reset', COALESCE((v_result ->> 'accounts_reset')::integer, 0) + v_non_zalo_accounts_reset,
    'campaigns_reset', COALESCE((v_result ->> 'campaigns_reset')::integer, 0) + v_non_zalo_campaigns_reset,
    'campaign_notes_reset', COALESCE((v_result ->> 'campaign_notes_reset')::integer, 0) + v_non_zalo_campaign_notes_reset,
    'non_zalo_uncertain_no_retry', true,
    'non_zalo_campaign_inputs_completed', v_campaign_inputs_completed,
    'non_zalo_campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$function$;

COMMENT ON FUNCTION public.claim_non_zalo_account_runtime_operation(bigint, bigint, text, text, uuid, boolean) IS
  'Atomically claims an available Facebook/Email account-only runtime operation under the staff recovery lock.';
COMMENT ON FUNCTION public.release_non_zalo_account_runtime_operation(bigint, bigint, text, text, uuid) IS
  'Atomically releases only the matching Facebook/Email account claim token without overwriting newer ownership or pause state.';
COMMENT ON FUNCTION public.reset_desktop_running_statuses_no_retry(bigint, boolean, boolean) IS
  'Completes uncertain non-Zalo inputs without retry, then runs desktop account/campaign recovery in the same transaction.';

REVOKE ALL ON FUNCTION public.claim_non_zalo_account_runtime_operation(bigint, bigint, text, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_non_zalo_account_runtime_operation(bigint, bigint, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_desktop_running_statuses_no_retry(bigint, boolean, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_non_zalo_account_runtime_operation(bigint, bigint, text, text, uuid, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_non_zalo_account_runtime_operation(bigint, bigint, text, text, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_desktop_running_statuses_no_retry(bigint, boolean, boolean)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

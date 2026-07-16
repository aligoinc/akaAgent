-- Make the database the source of truth for Zalo Server pause/resume control.
-- Ordinary pause is graceful: the server observes it and stops at the next
-- target/batch boundary instead of cancelling an in-flight Zalo request.

BEGIN;

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
AS $$
DECLARE
  v_target_status text := lower(btrim(COALESCE(p_status, '')));
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_is_zalo_server boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'Campaign ID must be a positive integer';
  END IF;
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;
  IF v_target_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT entitlement.id, COALESCE(entitlement.is_zalo_server, false)
  INTO v_entitlement_id, v_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  IF v_entitlement_id IS NULL OR NOT COALESCE(v_is_zalo_server, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.status, account.status
  INTO v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
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
    UPDATE public.auto_campaigns AS campaign
    SET
      status = v_target_status,
      note = NULL,
      updated_at = now()
    WHERE campaign.id = p_campaign_id;
    v_campaign_status := v_target_status;
    RETURN QUERY SELECT true, 'updated', p_campaign_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_campaign_status, v_account_status;
END;
$$;

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
AS $$
DECLARE
  v_target_status text := lower(btrim(COALESCE(p_status, '')));
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_is_zalo_server boolean := false;
  v_account_status text;
  v_campaign_status text;
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
  IF v_target_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RETURN QUERY SELECT false, 'invalid_transition', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT entitlement.id, COALESCE(entitlement.is_zalo_server, false)
  INTO v_entitlement_id, v_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  IF v_entitlement_id IS NULL OR NOT COALESCE(v_is_zalo_server, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT account.status
  INTO v_account_status
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  WHERE campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = v_organization_id
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status IN ('đang chạy', 'tạm dừng', 'chờ xử lý')
  ORDER BY
    CASE campaign.status WHEN 'đang chạy' THEN 0 WHEN 'tạm dừng' THEN 1 ELSE 2 END,
    campaign.updated_at DESC NULLS LAST,
    campaign.id DESC
  LIMIT 1;

  IF v_account_status = v_target_status THEN
    RETURN QUERY SELECT true, 'already_target', p_account_id, v_account_status, v_campaign_status;
    RETURN;
  END IF;

  IF (v_target_status = 'tạm dừng' AND v_account_status IN ('chờ xử lý', 'đang chạy'))
    OR (v_target_status = 'chờ xử lý' AND v_account_status = 'tạm dừng')
  THEN
    UPDATE public.auto_accounts AS account
    SET
      status = v_target_status,
      updated_at = now()
    WHERE account.id = p_account_id;
    v_account_status := v_target_status;
    RETURN QUERY SELECT true, 'updated', p_account_id, v_account_status, v_campaign_status;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'invalid_transition', p_account_id, v_account_status, v_campaign_status;
END;
$$;

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
AS $$
DECLARE
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_is_zalo_server boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_pause_requested boolean := false;
  v_hard_stop_reason text;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    v_hard_stop_reason := 'runtime_not_owner';
  ELSE
    SELECT entitlement.id, COALESCE(entitlement.is_zalo_server, false)
    INTO v_entitlement_id, v_is_zalo_server
    FROM public.org_organization_product AS entitlement
    WHERE entitlement.organization_id = v_organization_id
      AND entitlement.product_id IN (16, 18)
      AND entitlement.is_deleted = false
      AND entitlement.expiration_date IS NOT NULL
      AND entitlement.expiration_date >= v_vietnam_day_start
    ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
    LIMIT 1;

    IF v_entitlement_id IS NULL OR NOT COALESCE(v_is_zalo_server, false) THEN
      v_hard_stop_reason := 'runtime_not_owner';
    END IF;
  END IF;

  SELECT
    campaign.status,
    account.status,
    account.login_status,
    COALESCE(account.is_active, false),
    COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO
    v_campaign_status,
    v_account_status,
    v_account_login_status,
    v_account_is_active,
    v_account_is_delete,
    v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo';

  IF NOT FOUND THEN
    v_hard_stop_reason := COALESCE(v_hard_stop_reason, 'not_found');
  ELSE
    -- After a claim both rows are "đang chạy". A client may pause and resume
    -- before the next poll, leaving "chờ xử lý"; that is still a graceful
    -- boundary request for the old run, which must release before re-claim.
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

  RETURN QUERY SELECT
    p_campaign_id,
    p_account_id,
    v_campaign_status,
    v_account_status,
    v_account_login_status,
    v_account_is_active,
    v_account_is_delete,
    v_campaign_is_delete,
    v_pause_requested,
    v_pause_requested OR v_hard_stop_reason IS NOT NULL,
    v_hard_stop_reason;
END;
$$;

-- Linearization point between graceful DB pause/resume and a new runtime
-- unit. The campaign/account rows are locked in the same order as the
-- control RPCs. Therefore either a pause commits first and this claim fails,
-- or this claim commits first and the selected target/batch is the in-flight
-- unit that is allowed to finish.
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
AS $$
DECLARE
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_is_zalo_server boolean := false;
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
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    WHERE ids.input_id IS NULL OR ids.input_id <= 0
  ) THEN
    RAISE EXCEPTION 'Input data IDs must be positive integers';
  END IF;
  IF cardinality(v_input_data_ids) > 50 THEN
    RAISE EXCEPTION 'A Zalo Server run unit cannot contain more than 50 input rows';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT entitlement.id, COALESCE(entitlement.is_zalo_server, false)
  INTO v_entitlement_id, v_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  IF v_entitlement_id IS NULL OR NOT COALESCE(v_is_zalo_server, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  SELECT
    campaign.status,
    account.status,
    account.login_status,
    COALESCE(account.is_active, false),
    COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO
    v_campaign_status,
    v_account_status,
    v_account_login_status,
    v_account_is_active,
    v_account_is_delete,
    v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  IF v_campaign_is_delete THEN
    RETURN QUERY SELECT false, 'campaign_deleted', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;
  IF v_account_is_delete THEN
    RETURN QUERY SELECT false, 'account_deleted', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;
  IF NOT v_account_is_active THEN
    RETURN QUERY SELECT false, 'account_inactive', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;
  IF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    RETURN QUERY SELECT false, 'account_logged_out', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;
  IF v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
  THEN
    RETURN QUERY SELECT false, 'runtime_control_paused', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;

  -- Lock every requested row before changing any of them. A missing, paused
  -- or already-processed row rejects the whole unit, so a batch is never
  -- partially claimed.
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

    UPDATE public.auto_campaign_input_data AS input_data
    SET
      status = 'đang chạy',
      date_action = now()
    WHERE input_data.id = ANY(v_input_data_ids)
      AND input_data.campaign_id = p_campaign_id;
  END IF;

  RETURN QUERY SELECT true, 'claimed', v_campaign_status, v_account_status, v_claimed_count;
END;
$$;

-- Finalize a claimed Zalo Server campaign at the same serialization boundary
-- used by pause/resume. A pause that commits first must win over completion:
-- campaign pause/resume is preserved, while account pause/resume releases the
-- old run by returning its still-running campaign to pending.
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
AS $$
DECLARE
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_is_zalo_server boolean := false;
  v_account_id bigint;
  v_campaign_status text;
  v_account_status text;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'Campaign and staff IDs must be positive integers';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::bigint, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT entitlement.id, COALESCE(entitlement.is_zalo_server, false)
  INTO v_entitlement_id, v_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  IF v_entitlement_id IS NULL OR NOT COALESCE(v_is_zalo_server, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::bigint, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.account_id, campaign.status, account.status
  INTO v_account_id, v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_campaign_id, NULL::bigint, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- A newer campaign pause/resume already changed the row away from the
  -- claimed running state. Never overwrite that client decision.
  IF v_campaign_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT true, 'campaign_control_won', p_campaign_id, v_account_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;

  -- A newer account pause/resume must release this old run. Keep the account
  -- exactly as the client wrote it and make the campaign claimable again only
  -- when the account is also pending.
  IF v_account_status IS DISTINCT FROM 'đang chạy' THEN
    UPDATE public.auto_campaigns AS campaign
    SET
      status = 'chờ xử lý',
      note = NULL,
      updated_at = now()
    WHERE campaign.id = p_campaign_id
      AND campaign.status = 'đang chạy';
    v_campaign_status := 'chờ xử lý';

    RETURN QUERY SELECT true, 'account_control_won', p_campaign_id, v_account_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;

  -- The scheduler runs a snapshot of input rows. A find-data producer or the
  -- realtime listener may append another pending row while that snapshot is
  -- being processed. Do not strand that row under a completed campaign.
  IF EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'chờ xử lý'
  ) THEN
    UPDATE public.auto_campaigns AS campaign
    SET
      status = 'chờ xử lý',
      note = NULL,
      updated_at = now()
    WHERE campaign.id = p_campaign_id
      AND campaign.status = 'đang chạy';
    v_campaign_status := 'chờ xử lý';

    RETURN QUERY SELECT true, 'pending_input_remaining', p_campaign_id, v_account_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET
    status = 'hoàn thành',
    note = CASE WHEN COALESCE(p_update_note, false) THEN p_note ELSE campaign.note END,
    updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.status = 'đang chạy';
  v_campaign_status := 'hoàn thành';

  RETURN QUERY SELECT true, 'completed', p_campaign_id, v_account_id, v_campaign_status, v_account_status;
END;
$$;

-- Complete one Zalo Server multi-daily slot in one transaction. The input
-- reset and the campaign transition must not be observable separately: a
-- concurrent pause either wins before this function (nothing is reset) or
-- applies to the new pending slot after this function commits.
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
AS $$
DECLARE
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_is_zalo_server boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_reset_count integer := 0;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers';
  END IF;
  IF p_next_schedule IS NULL THEN
    RAISE EXCEPTION 'Next schedule is required';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT entitlement.id, COALESCE(entitlement.is_zalo_server, false)
  INTO v_entitlement_id, v_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  IF v_entitlement_id IS NULL OR NOT COALESCE(v_is_zalo_server, false) THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  SELECT
    campaign.status,
    account.status,
    account.login_status,
    COALESCE(account.is_active, false),
    COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO
    v_campaign_status,
    v_account_status,
    v_account_login_status,
    v_account_is_active,
    v_account_is_delete,
    v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id IN ('zalo_message_friend', 'zalo_message_group')
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  IF v_campaign_is_delete THEN
    RETURN QUERY SELECT false, 'campaign_deleted', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;
  IF v_account_is_delete THEN
    RETURN QUERY SELECT false, 'account_deleted', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;
  IF NOT v_account_is_active THEN
    RETURN QUERY SELECT false, 'account_inactive', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;
  IF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    RETURN QUERY SELECT false, 'account_logged_out', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;
  IF v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
  THEN
    RETURN QUERY SELECT false, 'runtime_control_paused', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;

  UPDATE public.auto_campaign_input_data AS input_data
  SET
    status = 'chờ xử lý',
    note = '',
    date_action = NULL
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status <> 'tạm dừng';
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  UPDATE public.auto_campaigns AS campaign
  SET
    status = 'chờ xử lý',
    schedule = p_next_schedule,
    note = NULL,
    updated_at = now()
  WHERE campaign.id = p_campaign_id;
  v_campaign_status := 'chờ xử lý';

  RETURN QUERY SELECT true, 'advanced', v_campaign_status, v_account_status, v_reset_count;
END;
$$;

-- Recreate the realtime enqueue function so a listener that already received
-- an event cannot append new work after the campaign/account was paused.
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

  PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0));
  SELECT entitlement.id, COALESCE(entitlement.is_zalo_server, false)
  INTO v_entitlement_id, v_is_zalo_server
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  IF v_entitlement_id IS NULL
    OR (v_runtime_target = 'server' AND NOT COALESCE(v_is_zalo_server, false))
    OR (v_runtime_target = 'desktop' AND COALESCE(v_is_zalo_server, false))
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
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime_control_paused'; END IF;

  PERFORM 1
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
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
  )
  ON CONFLICT (campaign_id, target_uid) DO NOTHING
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

  UPDATE public.auto_campaign_zalo_realtime_group_events AS event
  SET input_data_id = v_input_data_id, updated_at = now()
  WHERE event.id = v_event_id;

  UPDATE public.auto_campaigns AS campaign
  SET schedule = v_schedule_at, updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.status IN ('chờ xử lý', 'đang chạy')
    AND (campaign.schedule IS NULL OR campaign.schedule < now() OR campaign.schedule > v_schedule_at);

  RETURN QUERY SELECT true, v_event_id, v_input_data_id;
END;
$$;

COMMENT ON FUNCTION public.aka_agent_set_zalo_server_campaign_status(bigint, bigint, text) IS
  'Tenant-scoped idempotent pause/resume for a Zalo Server campaign. Pause may transition a running campaign without cancelling its in-flight unit.';
COMMENT ON FUNCTION public.aka_agent_set_zalo_server_account_status(bigint, bigint, text) IS
  'Tenant-scoped idempotent pause/resume for a Zalo Server account.';
COMMENT ON FUNCTION public.aka_agent_get_zalo_server_run_control_state(bigint, bigint, bigint) IS
  'Reads campaign/account pause and hard-stop state used by the Zalo Server five-second run guard.';
COMMENT ON FUNCTION public.aka_agent_claim_zalo_server_run_unit(bigint, bigint, bigint, bigint[]) IS
  'Atomically verifies Zalo Server run control and marks one target/batch running at its graceful-pause boundary.';
COMMENT ON FUNCTION public.aka_agent_finalize_zalo_server_campaign(bigint, bigint, text, boolean) IS
  'Atomically completes a claimed Zalo Server campaign, preserves newer control, or returns it to pending when new input arrived after the runtime snapshot.';
COMMENT ON FUNCTION public.aka_agent_advance_zalo_server_multi_daily_slot(bigint, bigint, bigint, timestamptz) IS
  'Atomically resets input rows and advances a claimed Zalo Server campaign to its next daily time slot.';

NOTIFY pgrst, 'reload schema';

COMMIT;

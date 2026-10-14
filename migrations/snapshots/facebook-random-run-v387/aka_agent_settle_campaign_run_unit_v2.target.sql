CREATE OR REPLACE FUNCTION public.aka_agent_settle_campaign_run_unit_v2(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_unit_token uuid, p_requeue_unstarted boolean)
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, db_now timestamp with time zone, vietnam_date_key date, requeued_count integer)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_organization_id bigint;
  v_campaign_found boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_account_platform text;
  v_account_is_zalo_web boolean;
  v_account_is_zalo_server boolean;
  v_runtime_owner_matches boolean;
  v_stored_unit_token uuid;
  v_stored_unit_vietnam_date date;
  v_stored_unit_claimed_at timestamptz;
  v_stored_unit_input_data_ids bigint[];
  v_optimistic_input_data_ids bigint[];
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_requeued_count integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'campaign, account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF p_runtime_unit_token IS NULL THEN
    RAISE EXCEPTION 'runtime unit token is required';
  END IF;
  IF p_requeue_unstarted IS NULL THEN
    RAISE EXCEPTION 'requeue-unstarted decision is required';
  END IF;

  -- Settlement is cleanup: an inactive staff/capability must not strand an
  -- exact token, but the staff/organization/account scope remains mandatory.
  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text,
      v_now, v_vietnam_date, 0;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Read the immutable payload after the advisory lock, lock only those rows,
  -- then lock/recheck the campaign. This preserves the canonical input-first
  -- order used by control and run-unit claims.
  SELECT campaign.runtime_unit_input_data_ids
  INTO v_optimistic_input_data_ids
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = v_organization_id
    )
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    );

  IF cardinality(COALESCE(v_optimistic_input_data_ids, ARRAY[]::bigint[])) > 0 THEN
    PERFORM input_data.id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id = ANY(v_optimistic_input_data_ids)
      AND input_data.campaign_id = p_campaign_id
    ORDER BY input_data.id
    FOR UPDATE OF input_data;
  END IF;

  SELECT
    campaign.status,
    account.status,
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false),
    campaign.runtime_unit_token,
    campaign.runtime_unit_vietnam_date,
    campaign.runtime_unit_claimed_at,
    campaign.runtime_unit_input_data_ids
  INTO
    v_campaign_status,
    v_account_status,
    v_account_platform,
    v_account_is_zalo_web,
    v_account_is_zalo_server,
    v_stored_unit_token,
    v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at,
    v_stored_unit_input_data_ids
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = v_organization_id
    )
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    )
  FOR UPDATE OF campaign, account;
  v_campaign_found := FOUND;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  IF NOT v_campaign_found THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      v_now, v_vietnam_date, 0;
    RETURN;
  END IF;

  v_runtime_owner_matches := NOT (
    (v_runtime_target = 'server' AND (
      v_account_platform <> 'zalo'
      OR v_account_is_zalo_web
      OR NOT v_account_is_zalo_server
    ))
    OR (v_runtime_target = 'desktop' AND (
      v_account_platform = 'zalo' AND v_account_is_zalo_server
    ))
  );

  IF v_stored_unit_token IS NULL THEN
    IF NOT v_runtime_owner_matches THEN
      RETURN QUERY SELECT
        false, 'runtime_not_owner', v_campaign_status, v_account_status,
        v_now, v_vietnam_date, 0;
    ELSIF v_stored_unit_vietnam_date IS NOT NULL
      OR v_stored_unit_claimed_at IS NOT NULL
      OR v_stored_unit_input_data_ids IS NOT NULL
    THEN
      RETURN QUERY SELECT
        false, 'unit_lease_corrupt', v_campaign_status, v_account_status,
        v_now, v_vietnam_date, 0;
    ELSE
      -- Idempotent terminal result for a settlement response lost after the
      -- lease was cleared. There is no active token this caller can mutate.
      RETURN QUERY SELECT
        true, 'already_settled', v_campaign_status, v_account_status,
        v_now, v_vietnam_date, 0;
    END IF;
    RETURN;
  END IF;

  IF v_stored_unit_token IS DISTINCT FROM p_runtime_unit_token THEN
    RETURN QUERY SELECT
      false, 'unit_lease_mismatch', v_campaign_status, v_account_status,
      v_now, v_vietnam_date, 0;
    RETURN;
  END IF;
  -- The exact opaque token remains authorized to clean up after mutable
  -- account subtype/capability/control changes; no other token can cross it.
  IF v_stored_unit_vietnam_date IS NULL
    OR v_stored_unit_claimed_at IS NULL
    OR v_stored_unit_input_data_ids IS NULL
  THEN
    RETURN QUERY SELECT
      false, 'unit_lease_corrupt', v_campaign_status, v_account_status,
      v_now, v_vietnam_date, 0;
    RETURN;
  END IF;

  IF v_account_platform='facebook' THEN PERFORM private.facebook_random_unit_settled(p_campaign_id,p_account_id,p_runtime_unit_token,p_requeue_unstarted); END IF;

  -- Win the token CAS before mutating even the stored input set. Both changes
  -- remain one transaction, so callers can never observe a cleared lease with
  -- only a partial requeue.
  UPDATE public.auto_campaigns AS campaign
  SET runtime_unit_token = NULL,
    runtime_unit_vietnam_date = NULL,
    runtime_unit_claimed_at = NULL,
    runtime_unit_input_data_ids = NULL,
    updated_at = v_now
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.runtime_unit_token = p_runtime_unit_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, 'unit_lease_mismatch', v_campaign_status, v_account_status,
      v_now, v_vietnam_date, 0;
    RETURN;
  END IF;

  IF p_requeue_unstarted
    AND cardinality(v_stored_unit_input_data_ids) > 0
  THEN
    UPDATE public.auto_campaign_input_data AS input_data
    SET status = 'chờ xử lý', date_action = NULL
    WHERE input_data.id = ANY(v_stored_unit_input_data_ids)
      AND input_data.campaign_id = p_campaign_id
      AND input_data.status = 'đang chạy';
    GET DIAGNOSTICS v_requeued_count = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT
    true,
    CASE WHEN p_requeue_unstarted
      THEN 'requeued_unstarted'
      ELSE 'settled'
    END,
    v_campaign_status,
    v_account_status,
    v_now,
    v_vietnam_date,
    v_requeued_count;
END;
$function$

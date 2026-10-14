CREATE OR REPLACE FUNCTION public.aka_agent_claim_campaign_run_unit_v2(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_claim_token uuid, p_runtime_claim_vietnam_date date, p_runtime_unit_token uuid, p_input_data_ids bigint[] DEFAULT ARRAY[]::bigint[])
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, claimed_count integer, runtime_claim_token uuid, runtime_claim_vietnam_date date, runtime_unit_token uuid, runtime_unit_vietnam_date date, runtime_unit_claimed_at timestamp with time zone, runtime_unit_input_data_ids bigint[], db_now timestamp with time zone, vietnam_date_key date, effective_stop_time time without time zone, boundary_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_input_data_ids bigint[] := ARRAY(
    SELECT DISTINCT ids.input_id
    FROM unnest(
      COALESCE(p_input_data_ids, ARRAY[]::bigint[])
    ) AS ids(input_id)
    ORDER BY ids.input_id
  );
  v_organization_id bigint;
  v_staff_is_active boolean := false;
  v_capabilities record;
  v_campaign_found boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_account_platform text;
  v_account_is_zalo_web boolean;
  v_account_is_zalo_server boolean;
  v_stored_claim_token uuid;
  v_stored_claim_target text;
  v_stored_claim_vietnam_date date;
  v_stored_unit_token uuid;
  v_stored_unit_vietnam_date date;
  v_stored_unit_claimed_at timestamptz;
  v_stored_unit_input_data_ids bigint[];
  v_daily_stop_time time without time zone;
  v_effective_stop_time time without time zone;
  v_boundary_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_requested_found_count integer := 0;
  v_requested_pending_count integer := 0;
  v_total_running_count integer := 0;
  v_claimed_count integer := 0;
  v_reason text;
  v_legacy_unit record;
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
  IF p_runtime_claim_token IS NULL
    OR p_runtime_claim_vietnam_date IS NULL
    OR p_runtime_unit_token IS NULL
  THEN
    RAISE EXCEPTION 'parent claim token/date and runtime unit token are required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    WHERE ids.input_id IS NULL OR ids.input_id <= 0
  ) THEN
    RAISE EXCEPTION 'input data IDs must be positive integers';
  END IF;
  IF cardinality(v_input_data_ids) > 50 THEN
    RAISE EXCEPTION 'a campaign run unit cannot contain more than 50 input rows';
  END IF;

  SELECT staff.organization_id, COALESCE(staff.is_active, false)
  INTO v_organization_id, v_staff_is_active
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text, 0,
      NULL::uuid, NULL::date,
      NULL::uuid, NULL::date, NULL::timestamptz, NULL::bigint[],
      v_now, v_vietnam_date, NULL::time, NULL::timestamptz;
    RETURN;
  END IF;

  -- Keep the established entitlement -> campaign barrier lock order for both
  -- fresh claims and response recovery. Exact committed-unit recovery does not
  -- consult mutable entitlement/staff-active values after taking these locks.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  IF cardinality(v_input_data_ids) > 0 THEN
    PERFORM input_data.id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id = ANY(v_input_data_ids)
      AND input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
    ORDER BY input_data.id
    FOR UPDATE OF input_data;

    SELECT
      count(*)::integer,
      count(*) FILTER (WHERE input_data.status = 'chờ xử lý')::integer
    INTO v_requested_found_count, v_requested_pending_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id = ANY(v_input_data_ids)
      AND input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false;
  END IF;

  -- Reject a fresh v2 unit while legacy/unrecovered input rows are running.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'đang chạy'
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT count(*)::integer
  INTO v_total_running_count
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'đang chạy';

  SELECT
    campaign.status,
    account.status,
    account.login_status,
    COALESCE(account.is_active, false),
    COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false),
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false),
    campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_claim_vietnam_date,
    campaign.runtime_unit_token,
    campaign.runtime_unit_vietnam_date,
    campaign.runtime_unit_claimed_at,
    campaign.runtime_unit_input_data_ids,
    campaign.daily_stop_time
  INTO
    v_campaign_status,
    v_account_status,
    v_account_login_status,
    v_account_is_active,
    v_account_is_delete,
    v_campaign_is_delete,
    v_account_platform,
    v_account_is_zalo_web,
    v_account_is_zalo_server,
    v_stored_claim_token,
    v_stored_claim_target,
    v_stored_claim_vietnam_date,
    v_stored_unit_token,
    v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at,
    v_stored_unit_input_data_ids,
    v_daily_stop_time
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
  v_effective_stop_time := LEAST(
    COALESCE(v_daily_stop_time, time '23:59:00'),
    time '23:59:00'
  );
  v_boundary_at := (
    p_runtime_claim_vietnam_date + v_effective_stop_time
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

  IF NOT v_campaign_found THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text, 0,
      NULL::uuid, NULL::date,
      NULL::uuid, NULL::date, NULL::timestamptz, NULL::bigint[],
      v_now, v_vietnam_date, NULL::time, NULL::timestamptz;
    RETURN;
  END IF;

  -- The exact committed unit token/date/target/canonical payload is the
  -- linearization point for a lost response. Resolve it only after the same
  -- campaign/input/account locks as a fresh claim, but before mutable
  -- staff-active, entitlement, control, login, or subtype checks. This lets the
  -- caller recover the response and settle instead of stranding maintenance.
  -- Parent fields are NULL-or-match because Desktop soft-pause deliberately
  -- clears that weaker tuple while the opaque unit token/date/exact payload
  -- remains durable; a still-present Server/newer parent must match exactly.
  IF v_stored_unit_token = p_runtime_unit_token
    AND v_stored_unit_vietnam_date = p_runtime_claim_vietnam_date
    AND v_stored_unit_claimed_at IS NOT NULL
    AND v_stored_unit_input_data_ids = v_input_data_ids
    AND (
      v_stored_claim_token IS NULL
      OR v_stored_claim_token = p_runtime_claim_token
    )
    AND (
      v_stored_claim_target IS NULL
      OR v_stored_claim_target = v_runtime_target
    )
    AND (
      v_stored_claim_vietnam_date IS NULL
      OR v_stored_claim_vietnam_date = p_runtime_claim_vietnam_date
    )
  THEN
    RETURN QUERY SELECT
      true, 'already_claimed', v_campaign_status, v_account_status,
      cardinality(v_stored_unit_input_data_ids),
      v_stored_claim_token, v_stored_claim_vietnam_date,
      v_stored_unit_token, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  -- A different/new unit still passes the complete mutable runtime guard.
  IF NOT v_staff_is_active OR NOT public.aka_agent_staff_time_allowed(p_staff_id) THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      v_stored_unit_token, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  -- Durable token identity remains authoritative ahead of mutable campaign,
  -- account, login, and subtype checks after the active/entitlement guard.
  IF v_stored_unit_token IS NOT NULL THEN
    IF v_stored_unit_vietnam_date IS NULL
      OR v_stored_unit_claimed_at IS NULL
      OR v_stored_unit_input_data_ids IS NULL
    THEN
      v_reason := 'unit_lease_corrupt';
    ELSIF v_stored_unit_token IS DISTINCT FROM p_runtime_unit_token THEN
      v_reason := 'unit_lease_busy';
    ELSIF (
        v_stored_claim_token IS NOT NULL
        AND v_stored_claim_token IS DISTINCT FROM p_runtime_claim_token
      ) OR (
        v_stored_claim_target IS NOT NULL
        AND v_stored_claim_target IS DISTINCT FROM v_runtime_target
      ) OR (
        v_stored_claim_vietnam_date IS NOT NULL
        AND v_stored_claim_vietnam_date
          IS DISTINCT FROM p_runtime_claim_vietnam_date
      )
    THEN
      v_reason := 'runtime_claim_mismatch';
    ELSIF v_stored_unit_vietnam_date IS DISTINCT FROM p_runtime_claim_vietnam_date
      OR v_stored_unit_input_data_ids IS DISTINCT FROM v_input_data_ids
    THEN
      v_reason := 'unit_lease_payload_mismatch';
    ELSE
      RETURN QUERY SELECT
        true, 'already_claimed', v_campaign_status, v_account_status,
        cardinality(v_stored_unit_input_data_ids),
        v_stored_claim_token, v_stored_claim_vietnam_date,
        v_stored_unit_token, v_stored_unit_vietnam_date,
        v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
        v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      false, v_reason, v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      v_stored_unit_token, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  ELSIF v_stored_unit_vietnam_date IS NOT NULL
    OR v_stored_unit_claimed_at IS NOT NULL
    OR v_stored_unit_input_data_ids IS NOT NULL
  THEN
    RETURN QUERY SELECT
      false, 'unit_lease_corrupt', v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      NULL::uuid, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  IF v_runtime_target = 'server' AND (
      v_account_platform <> 'zalo'
      OR v_account_is_zalo_web
      OR NOT v_account_is_zalo_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    )
  THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_runtime_target = 'desktop'
    AND v_account_platform = 'zalo'
    AND (
      v_account_is_zalo_server
      OR (
        v_account_is_zalo_web
        AND NOT COALESCE(v_capabilities.web_enabled, false)
      )
      OR (
        NOT v_account_is_zalo_web
        AND NOT v_account_is_zalo_server
        AND NOT COALESCE(v_capabilities.qr_enabled, false)
      )
    )
  THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_campaign_is_delete THEN
    v_reason := 'campaign_deleted';
  ELSIF v_account_is_delete THEN
    v_reason := 'account_deleted';
  ELSIF NOT v_account_is_active THEN
    v_reason := 'account_inactive';
  ELSIF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    v_reason := 'account_logged_out';
  ELSIF v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
  THEN
    v_reason := 'runtime_control_paused';
  ELSIF v_stored_claim_token IS DISTINCT FROM p_runtime_claim_token
    OR v_stored_claim_target IS DISTINCT FROM v_runtime_target
    OR v_stored_claim_vietnam_date IS DISTINCT FROM p_runtime_claim_vietnam_date
  THEN
    v_reason := 'runtime_claim_mismatch';
  ELSIF p_runtime_claim_vietnam_date > v_vietnam_date THEN
    v_reason := 'invalid_claimed_vietnam_date';
  ELSIF v_vietnam_date > p_runtime_claim_vietnam_date THEN
    v_reason := 'vietnam_day_changed';
  ELSIF v_now >= v_boundary_at THEN
    v_reason := CASE
      WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
      ELSE 'daily_stop_due'
    END;
  ELSIF v_total_running_count > 0
    OR v_requested_found_count <> cardinality(v_input_data_ids)
    OR v_requested_pending_count <> cardinality(v_input_data_ids)
  THEN
    v_reason := 'input_not_pending';
  ELSE
    v_reason := 'allowed';
  END IF;

  IF v_reason='allowed' AND v_account_platform='facebook' THEN
    v_reason:=coalesce(private.facebook_random_unit_gate(p_campaign_id,p_account_id,p_runtime_claim_token,cardinality(v_input_data_ids)),'allowed');
  END IF;

  IF v_reason <> 'allowed' THEN
    RETURN QUERY SELECT
      false, v_reason, v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      NULL::uuid, NULL::date, NULL::timestamptz, NULL::bigint[],
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  BEGIN
    IF v_runtime_target = 'server' THEN
      SELECT * INTO v_legacy_unit
      FROM public.aka_agent_claim_zalo_server_run_unit(
        p_campaign_id,
        p_account_id,
        p_staff_id,
        v_input_data_ids
      );
      IF v_legacy_unit.ok IS DISTINCT FROM true THEN
        v_reason := COALESCE(v_legacy_unit.reason, 'unit_claim_rejected');
        RAISE EXCEPTION USING
          ERRCODE = 'P0232',
          MESSAGE = 'legacy Server unit claim rejected';
      END IF;
      v_claimed_count := COALESCE(v_legacy_unit.claimed_count, 0)::integer;
      IF v_claimed_count IS DISTINCT FROM cardinality(v_input_data_ids) THEN
        v_reason := 'unit_claim_count_mismatch';
        RAISE EXCEPTION USING
          ERRCODE = 'P0232',
          MESSAGE = 'legacy Server unit claim count mismatch';
      END IF;
    ELSE
      IF cardinality(v_input_data_ids) > 0 THEN
        UPDATE public.auto_campaign_input_data AS input_data
        SET status = 'đang chạy', date_action = v_now
        WHERE input_data.id = ANY(v_input_data_ids)
          AND input_data.campaign_id = p_campaign_id
          AND COALESCE(input_data.is_delete, false) = false
          AND input_data.status = 'chờ xử lý';
        GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
      END IF;
      IF v_claimed_count IS DISTINCT FROM cardinality(v_input_data_ids) THEN
        v_reason := 'unit_claim_count_mismatch';
        RAISE EXCEPTION USING
          ERRCODE = 'P0232',
          MESSAGE = 'Desktop unit claim count mismatch';
      END IF;
    END IF;

    -- The lease is written only after the exact reservation succeeds and a
    -- final DB-clock sample confirms the inclusive boundary is still open.
    v_now := clock_timestamp();
    v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
    IF v_vietnam_date > p_runtime_claim_vietnam_date THEN
      v_reason := 'vietnam_day_changed';
      RAISE EXCEPTION USING
        ERRCODE = 'P0232',
        MESSAGE = 'run unit crossed Vietnam midnight';
    ELSIF v_now >= v_boundary_at THEN
      v_reason := CASE
        WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
        ELSE 'daily_stop_due'
      END;
      RAISE EXCEPTION USING
        ERRCODE = 'P0232',
        MESSAGE = 'run unit crossed its daily boundary';
    END IF;

    UPDATE public.auto_campaigns AS campaign
    SET runtime_unit_token = p_runtime_unit_token,
      runtime_unit_vietnam_date = p_runtime_claim_vietnam_date,
      runtime_unit_claimed_at = v_now,
      runtime_unit_input_data_ids = v_input_data_ids,
      updated_at = v_now
    WHERE campaign.id = p_campaign_id
      AND campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy'
      AND campaign.runtime_claim_token = p_runtime_claim_token
      AND campaign.runtime_claim_target = v_runtime_target
      AND campaign.runtime_claim_vietnam_date = p_runtime_claim_vietnam_date
      AND campaign.runtime_unit_token IS NULL;

    IF NOT FOUND THEN
      v_reason := 'unit_lease_lost';
      RAISE EXCEPTION USING
        ERRCODE = 'P0232',
        MESSAGE = 'run-unit lease lost parent ownership';
    END IF;

    IF v_account_platform='facebook' THEN PERFORM private.facebook_random_unit_started(p_campaign_id,p_account_id,p_runtime_unit_token); END IF;

    RETURN QUERY SELECT
      true, 'claimed', v_campaign_status, v_account_status, v_claimed_count,
      p_runtime_claim_token, p_runtime_claim_vietnam_date,
      p_runtime_unit_token, p_runtime_claim_vietnam_date,
      v_now, v_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  EXCEPTION
    WHEN SQLSTATE 'P0232' THEN
      -- Reservation and lease writes in this subtransaction are rolled back
      -- together; no compensating UPDATE can clobber a concurrent control row.
      NULL;
  END;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  SELECT campaign.status, account.status,
    campaign.runtime_claim_token, campaign.runtime_claim_vietnam_date,
    campaign.runtime_unit_token, campaign.runtime_unit_vietnam_date,
    campaign.runtime_unit_claimed_at, campaign.runtime_unit_input_data_ids
  INTO v_campaign_status, v_account_status,
    v_stored_claim_token, v_stored_claim_vietnam_date,
    v_stored_unit_token, v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at, v_stored_unit_input_data_ids
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id;

  RETURN QUERY SELECT
    false, COALESCE(v_reason, 'unit_claim_lost'),
    v_campaign_status, v_account_status, 0,
    v_stored_claim_token, v_stored_claim_vietnam_date,
    v_stored_unit_token, v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
    v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
END;
$function$

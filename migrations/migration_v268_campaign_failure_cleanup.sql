-- Live source: cgjbsmqtfhqvttudyjzq, captured 2026-09-09. No historical function bodies.
DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])') IS NULL OR
    md5(pg_get_functiondef(to_regprocedure('public.aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])'))) IS DISTINCT FROM '698334ac50dcc485fbe4a825411df582' THEN
    RAISE EXCEPTION 'v268 live definition drift: aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])';
  END IF;
  IF to_regprocedure('public.aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)') IS NULL OR
    md5(pg_get_functiondef(to_regprocedure('public.aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)'))) IS DISTINCT FROM '782a8b7adf396f21f7d69bc4a613bce1' THEN
    RAISE EXCEPTION 'v268 live definition drift: aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)';
  END IF;
  IF to_regprocedure('public.aka_agent_clear_campaign_runtime_claim_metadata()') IS NULL OR
    md5(pg_get_functiondef(to_regprocedure('public.aka_agent_clear_campaign_runtime_claim_metadata()'))) IS DISTINCT FROM 'dacc6362ba94f2f62c9e4cb43f965510' THEN
    RAISE EXCEPTION 'v268 live definition drift: aka_agent_clear_campaign_runtime_claim_metadata()';
  END IF;
  IF to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)') IS NULL OR
    md5(pg_get_functiondef(to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)'))) IS DISTINCT FROM '74c082aacb1de27a8cedff2e824f219f' THEN
    RAISE EXCEPTION 'v268 live definition drift: aka_agent_lock_campaign_input_serialization(bigint)';
  END IF;
  IF to_regprocedure('public.aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)') IS NULL OR
    md5(pg_get_functiondef(to_regprocedure('public.aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)'))) IS DISTINCT FROM '1c3e5d27fa9d99b6bc6e7fb3ede55115' THEN
    RAISE EXCEPTION 'v268 live definition drift: aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)';
  END IF;
  IF to_regprocedure('public.claim_campaign_runtime(bigint,bigint,bigint,text)') IS NULL OR
    md5(pg_get_functiondef(to_regprocedure('public.claim_campaign_runtime(bigint,bigint,bigint,text)'))) IS DISTINCT FROM 'e6b1889cda717cb0bea6f7d801633c75' THEN
    RAISE EXCEPTION 'v268 live definition drift: claim_campaign_runtime(bigint,bigint,bigint,text)';
  END IF;
  IF to_regprocedure('public.guard_auto_account_runtime_operation_claim_token()') IS NULL OR
    md5(pg_get_functiondef(to_regprocedure('public.guard_auto_account_runtime_operation_claim_token()'))) IS DISTINCT FROM 'aa29df91b50cd6bc11e24bd912545c40' THEN
    RAISE EXCEPTION 'v268 live definition drift: guard_auto_account_runtime_operation_claim_token()';
  END IF;
  IF to_regprocedure('public.aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'v268 cleanup RPC already exists; inspect live definition before replacing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_campaign_runtime_v2(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_claim_token uuid)
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, runtime_claim_token uuid, runtime_claim_vietnam_date date, runtime_claimed_at timestamp with time zone, db_now timestamp with time zone, vietnam_date_key date, effective_stop_time time without time zone, boundary_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_claimed_vietnam_date date;
  v_schedule timestamptz;
  v_schedule_type text;
  v_continue_next_day boolean;
  v_vietnam_day_start timestamptz;
  v_daily_stop_time time without time zone;
  v_effective_stop_time time without time zone;
  v_boundary_at timestamptz;
  v_campaign_status text;
  v_account_status text;
  v_stored_claim_token uuid;
  v_stored_claim_target text;
  v_stored_claim_vietnam_date date;
  v_stored_claimed_at timestamptz;
  v_stored_unit_token uuid;
  v_claimed_at timestamptz;
  v_legacy_claimed boolean := false;
  v_post_claim_rejection text;
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
  IF p_runtime_claim_token IS NULL THEN
    RAISE EXCEPTION 'runtime claim token is required';
  END IF;

  -- Fast DB-clock rejection avoids invoking the comparatively expensive
  -- legacy entitlement/claim path once the inclusive cutoff is already due.
  -- The same predicate is rechecked under the locks retained by that claim.
  SELECT
    campaign.daily_stop_time,
    campaign.status,
    account.status,
    campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_claim_vietnam_date,
    campaign.runtime_claimed_at,
    campaign.runtime_unit_token,
    campaign.schedule,
    lower(btrim(COALESCE(NULLIF(campaign.schedule_type, ''), 'daily'))),
    COALESCE(campaign.continue_next_day, false)
  INTO
    v_daily_stop_time,
    v_campaign_status,
    v_account_status,
    v_stored_claim_token,
    v_stored_claim_target,
    v_stored_claim_vietnam_date,
    v_stored_claimed_at,
    v_stored_unit_token,
    v_schedule,
    v_schedule_type,
    v_continue_next_day
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      NULL::uuid, NULL::date, NULL::timestamptz,
      v_now, v_vietnam_date, NULL::time, NULL::timestamptz;
    RETURN;
  END IF;

  v_effective_stop_time := LEAST(
    COALESCE(v_daily_stop_time, time '23:59:00'),
    time '23:59:00'
  );
  v_vietnam_day_start := (
    v_vietnam_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );

  -- The caller creates the UUID before the request. If the first transaction
  -- committed but its response was lost, the exact immutable tuple recovers
  -- ownership before any mutable campaign/account status is considered. A
  -- concurrent DB-first pause therefore remains visible in the result without
  -- letting another executor claim or release the shared account too early.
  -- This does not create a second claim; the unit RPC still decides whether
  -- new work may start.
  IF v_stored_claim_token = p_runtime_claim_token
    AND v_stored_claim_target = v_runtime_target
    AND v_stored_claim_vietnam_date IS NOT NULL
    AND v_stored_claim_vietnam_date <= v_vietnam_date
    AND v_stored_claimed_at IS NOT NULL
  THEN
    v_boundary_at := (
      v_stored_claim_vietnam_date + v_effective_stop_time
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    RETURN QUERY SELECT
      true,
      'already_claimed',
      v_campaign_status,
      v_account_status,
      p_runtime_claim_token,
      v_stored_claim_vietnam_date,
      v_stored_claimed_at,
      v_now,
      v_vietnam_date,
      v_effective_stop_time,
      v_boundary_at;
    RETURN;
  END IF;

  -- A durable unit lease remains authoritative independently of mutable status
  -- and parent metadata. Never let a different parent claim overlap it.
  IF v_stored_unit_token IS NOT NULL THEN
    RETURN QUERY SELECT
      false, 'unit_lease_busy', v_campaign_status, v_account_status,
      NULL::uuid, NULL::date, NULL::timestamptz,
      v_now, v_vietnam_date, v_effective_stop_time,
      (
        v_vietnam_date + v_effective_stop_time
      ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    RETURN;
  END IF;

  -- A stale daily schedule is intentional only when the user chose not to
  -- wait for the next day's configured time. Every recurring schedule that
  -- must advance still fails closed until maintenance writes its next due time.
  IF v_campaign_status = 'chờ xử lý'
    AND v_schedule IS NOT NULL
    AND v_schedule < v_vietnam_day_start
    AND NOT (
      v_schedule_type = 'daily'
      AND v_continue_next_day IS NOT TRUE
    )
  THEN
    RETURN QUERY SELECT
      false, 'daily_maintenance_required',
      v_campaign_status, v_account_status,
      NULL::uuid, NULL::date, NULL::timestamptz,
      v_now, v_vietnam_date, v_effective_stop_time,
      (
        v_vietnam_date + v_effective_stop_time
      ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    RETURN;
  END IF;

  v_boundary_at := (
    v_vietnam_date + v_effective_stop_time
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

  IF v_now >= v_boundary_at THEN
    RETURN QUERY SELECT
      false,
      CASE
        WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
        ELSE 'daily_stop_due'
      END,
      v_campaign_status,
      v_account_status,
      NULL::uuid,
      NULL::date,
      NULL::timestamptz,
      v_now,
      v_vietnam_date,
      v_effective_stop_time,
      v_boundary_at;
    RETURN;
  END IF;

  v_claimed_vietnam_date := v_vietnam_date;

  -- An exception block is deliberately used as a subtransaction. If the DB
  -- clock crosses the boundary while the legacy function is acquiring locks,
  -- raising P0231 rolls its campaign/account writes back before this function
  -- returns a normal rejection result.
  BEGIN
    v_legacy_claimed := public.claim_campaign_runtime(
      p_campaign_id,
      p_account_id,
      p_staff_id,
      v_runtime_target
    );

    IF NOT v_legacy_claimed THEN
      -- A retry can overlap the first request: the optimistic read above may
      -- have seen pending while this legacy call later waited for the first
      -- transaction. Re-read under the locks retained by the legacy call and
      -- recover only the exact caller-supplied token.
      SELECT
        campaign.status,
        account.status,
        campaign.runtime_claim_token,
        campaign.runtime_claim_target,
        campaign.runtime_claim_vietnam_date,
        campaign.runtime_claimed_at,
        campaign.daily_stop_time,
        campaign.runtime_unit_token,
        campaign.schedule,
        lower(btrim(COALESCE(NULLIF(campaign.schedule_type, ''), 'daily'))),
        COALESCE(campaign.continue_next_day, false)
      INTO
        v_campaign_status,
        v_account_status,
        v_stored_claim_token,
        v_stored_claim_target,
        v_stored_claim_vietnam_date,
        v_stored_claimed_at,
        v_daily_stop_time,
        v_stored_unit_token,
        v_schedule,
        v_schedule_type,
        v_continue_next_day
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
       AND account.staff_id = campaign.staff_id
      WHERE campaign.id = p_campaign_id
        AND campaign.account_id = p_account_id
        AND campaign.staff_id = p_staff_id
      FOR UPDATE OF campaign, account;

      v_now := clock_timestamp();
      v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
      v_effective_stop_time := LEAST(
        COALESCE(v_daily_stop_time, time '23:59:00'),
        time '23:59:00'
      );
      v_vietnam_day_start := (
        v_vietnam_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
      );

      IF FOUND
        AND v_stored_claim_token = p_runtime_claim_token
        AND v_stored_claim_target = v_runtime_target
        AND v_stored_claim_vietnam_date IS NOT NULL
        AND v_stored_claim_vietnam_date <= v_vietnam_date
        AND v_stored_claimed_at IS NOT NULL
      THEN
        v_boundary_at := (
          v_stored_claim_vietnam_date + v_effective_stop_time
        ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
        RETURN QUERY SELECT
          true,
          'already_claimed',
          v_campaign_status,
          v_account_status,
          p_runtime_claim_token,
          v_stored_claim_vietnam_date,
          v_stored_claimed_at,
          v_now,
          v_vietnam_date,
          v_effective_stop_time,
          v_boundary_at;
        RETURN;
      END IF;

      IF FOUND AND v_stored_unit_token IS NOT NULL THEN
        RETURN QUERY SELECT
          false, 'unit_lease_busy', v_campaign_status, v_account_status,
          NULL::uuid, NULL::date, NULL::timestamptz,
          v_now, v_vietnam_date, v_effective_stop_time,
          (
            v_vietnam_date + v_effective_stop_time
          ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
        RETURN;
      END IF;

      IF FOUND
        AND v_campaign_status = 'chờ xử lý'
        AND v_schedule IS NOT NULL
        AND v_schedule < v_vietnam_day_start
        AND NOT (
          v_schedule_type = 'daily'
          AND v_continue_next_day IS NOT TRUE
        )
      THEN
        RETURN QUERY SELECT
          false, 'daily_maintenance_required',
          v_campaign_status, v_account_status,
          NULL::uuid, NULL::date, NULL::timestamptz,
          v_now, v_vietnam_date, v_effective_stop_time,
          (
            v_vietnam_date + v_effective_stop_time
          ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
        RETURN;
      END IF;

      RETURN QUERY SELECT
        false, 'claim_rejected', v_campaign_status, v_account_status,
        NULL::uuid, NULL::date, NULL::timestamptz,
        v_now,
        v_vietnam_date,
        v_effective_stop_time,
        v_boundary_at;
      RETURN;
    END IF;

    -- claim_campaign_runtime retains both row locks until this outer RPC
    -- finishes, so this is the authoritative post-lock boundary check.
    SELECT
      campaign.daily_stop_time,
      campaign.status,
      account.status,
      campaign.runtime_unit_token,
      campaign.schedule,
      lower(btrim(COALESCE(NULLIF(campaign.schedule_type, ''), 'daily'))),
      COALESCE(campaign.continue_next_day, false)
    INTO
      v_daily_stop_time,
      v_campaign_status,
      v_account_status,
      v_stored_unit_token,
      v_schedule,
      v_schedule_type,
      v_continue_next_day
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    WHERE campaign.id = p_campaign_id
      AND campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
    FOR UPDATE OF campaign, account;

    v_now := clock_timestamp();
    v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
    v_effective_stop_time := LEAST(
      COALESCE(v_daily_stop_time, time '23:59:00'),
      time '23:59:00'
    );
    v_vietnam_day_start := (
      v_vietnam_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
    );
    v_boundary_at := (
      v_claimed_vietnam_date + v_effective_stop_time
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

    IF v_stored_unit_token IS NOT NULL THEN
      v_post_claim_rejection := 'unit_lease_busy';
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign runtime claim overlapped an active unit lease';
    ELSIF v_schedule IS NOT NULL
      AND v_schedule < v_vietnam_day_start
      AND NOT (
        v_schedule_type = 'daily'
        AND v_continue_next_day IS NOT TRUE
      )
    THEN
      v_post_claim_rejection := 'daily_maintenance_required';
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign runtime claim used a stale Vietnam-day schedule';
    ELSIF v_vietnam_date > v_claimed_vietnam_date THEN
      v_post_claim_rejection := 'vietnam_day_changed';
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign runtime claim crossed Vietnam midnight';
    ELSIF v_now >= v_boundary_at THEN
      v_post_claim_rejection := CASE
        WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
        ELSE 'daily_stop_due'
      END;
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign runtime claim crossed its daily boundary';
    END IF;

    v_claimed_at := v_now;

    UPDATE public.auto_campaigns AS campaign
    SET
      runtime_claim_token = p_runtime_claim_token,
      runtime_claim_target = v_runtime_target,
      runtime_claim_vietnam_date = v_claimed_vietnam_date,
      runtime_claimed_at = v_claimed_at,
      updated_at = v_claimed_at
    WHERE campaign.id = p_campaign_id
      AND campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy';

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign runtime claim lost ownership before token assignment';
    END IF;

    -- Bind the existing account operation token in the same fresh-claim
    -- transaction. Exact-token retries and every eligibility guard stay intact.
    UPDATE public.auto_accounts AS account
    SET runtime_operation_claim_token = p_runtime_claim_token
    WHERE account.id = p_account_id
      AND account.staff_id = p_staff_id
      AND account.status = 'đang chạy';

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign account lost ownership before token assignment';
    END IF;

    RETURN QUERY SELECT
      true,
      'claimed',
      'đang chạy'::text,
      'đang chạy'::text,
      p_runtime_claim_token,
      v_claimed_vietnam_date,
      v_claimed_at,
      v_now,
      v_vietnam_date,
      v_effective_stop_time,
      v_boundary_at;
    RETURN;
  EXCEPTION
    WHEN SQLSTATE 'P0231' THEN
      -- All writes made by claim_campaign_runtime and token assignment inside
      -- the block have been rolled back. Local variables intentionally retain
      -- the rejection metadata for the structured result below.
      NULL;
  END;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  SELECT campaign.status, account.status
  INTO v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id;

  RETURN QUERY SELECT
    false,
    COALESCE(v_post_claim_rejection, 'claim_lost'),
    v_campaign_status,
    v_account_status,
    NULL::uuid,
    NULL::date,
    NULL::timestamptz,
    v_now,
    v_vietnam_date,
    v_effective_stop_time,
    v_boundary_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_cleanup_failed_campaign_runtime(
  p_campaign_id bigint, p_account_id bigint, p_staff_id bigint,
  p_runtime_target text, p_runtime_claim_token uuid, p_runtime_unit_token uuid,
  p_unstarted_input_data_ids bigint[], p_note text, p_pause_unknown_outcome boolean,
  p_campaign_status text DEFAULT NULL, p_account_status text DEFAULT NULL
)
RETURNS TABLE(ok boolean, reason text)
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint;
  v_optimistic_ids bigint[];
  v_ids bigint[];
  v_parent uuid;
  v_unit uuid;
  v_account_token uuid;
  v_target text;
  v_claim_date date;
  v_claim_at timestamptz;
  v_unit_date date;
  v_unit_at timestamptz;
  v_campaign_status text;
  v_account_status text;
  v_now timestamptz := clock_timestamp();
  v_unstarted bigint[] := COALESCE(p_unstarted_input_data_ids, ARRAY[]::bigint[]);
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop', 'server')
    OR p_runtime_claim_token IS NULL OR p_pause_unknown_outcome IS NULL
    OR cardinality(v_unstarted) > 50 OR array_position(v_unstarted, NULL) IS NOT NULL
    OR (p_campaign_status IS NOT NULL AND p_campaign_status NOT IN ('chờ xử lý', 'tạm dừng'))
    OR (p_account_status IS NOT NULL AND p_account_status NOT IN ('chờ xử lý', 'tạm dừng'))
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid failure cleanup payload';
  END IF;

  -- Like v2 settlement, cleanup survives entitlement/subtype changes, but
  -- requires the original opaque token and tenant scope under invoker RLS.
  SELECT staff.organization_id INTO v_org
  FROM public.org_staff staff WHERE staff.id = p_staff_id FOR SHARE OF staff;
  IF NOT FOUND OR v_org IS NULL THEN
    RETURN QUERY SELECT false, 'not_owner'; RETURN;
  END IF;
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
  SELECT c.runtime_unit_input_data_ids INTO v_optimistic_ids
  FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id = c.account_id AND a.staff_id = c.staff_id
  WHERE c.id = p_campaign_id AND c.account_id = p_account_id AND c.staff_id = p_staff_id
    AND (c.organization_id IS NULL OR c.organization_id = v_org)
    AND (a.organization_id IS NULL OR a.organization_id = v_org);
  PERFORM d.id FROM public.auto_campaign_input_data d
  WHERE d.campaign_id = p_campaign_id AND d.id = ANY(v_optimistic_ids)
  ORDER BY d.id FOR UPDATE OF d;

  SELECT c.runtime_claim_token, c.runtime_claim_target, c.runtime_claim_vietnam_date, c.runtime_claimed_at,
    c.runtime_unit_token, c.runtime_unit_vietnam_date, c.runtime_unit_claimed_at, c.runtime_unit_input_data_ids,
    c.status, a.status, a.runtime_operation_claim_token
  INTO v_parent, v_target, v_claim_date, v_claim_at, v_unit, v_unit_date, v_unit_at, v_ids,
    v_campaign_status, v_account_status, v_account_token
  FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id = c.account_id AND a.staff_id = c.staff_id
  WHERE c.id = p_campaign_id AND c.account_id = p_account_id AND c.staff_id = p_staff_id
    AND (c.organization_id IS NULL OR c.organization_id = v_org)
    AND (a.organization_id IS NULL OR a.organization_id = v_org)
  FOR UPDATE OF c, a;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'; RETURN;
  END IF;

  IF (v_parent IS NOT NULL AND v_parent <> p_runtime_claim_token)
    OR (v_account_token IS NOT NULL AND v_account_token <> p_runtime_claim_token)
    OR (v_unit IS NOT NULL AND v_unit IS DISTINCT FROM p_runtime_unit_token)
    OR (v_parent IS NOT NULL AND v_target IS DISTINCT FROM p_runtime_target)
  THEN
    RETURN QUERY SELECT false, 'not_owner'; RETURN;
  END IF;
  IF v_ids IS DISTINCT FROM v_optimistic_ids
    OR (v_parent IS NOT NULL AND (v_claim_date IS NULL OR v_claim_at IS NULL))
    OR (v_parent IS NULL AND (v_target IS NOT NULL OR v_claim_date IS NOT NULL OR v_claim_at IS NOT NULL))
    OR (v_unit IS NOT NULL AND (v_unit_date IS NULL OR v_unit_at IS NULL OR v_ids IS NULL OR cardinality(v_ids) > 50))
    OR (v_unit IS NULL AND (v_unit_date IS NOT NULL OR v_unit_at IS NOT NULL OR v_ids IS NOT NULL))
    OR (v_campaign_status = 'đang chạy' AND v_parent IS DISTINCT FROM p_runtime_claim_token)
    OR (v_account_status = 'đang chạy' AND v_account_token IS DISTINCT FROM p_runtime_claim_token)
  THEN
    RETURN QUERY SELECT false, 'insufficient_ownership'; RETURN;
  END IF;
  IF v_parent IS NULL AND v_unit IS NULL AND v_account_token IS NULL THEN
    -- A committed response can be lost. This branch performs no writes and
    -- cannot release a new owner, including a tokenless legacy running row.
    RETURN QUERY SELECT true, 'already_cleaned'; RETURN;
  END IF;
  IF v_unit IS NOT NULL AND NOT (v_unstarted <@ v_ids) THEN
    RETURN QUERY SELECT false, 'invalid_unstarted_ids'; RETURN;
  END IF;
  IF v_unit IS NULL AND cardinality(v_unstarted) > 0 THEN
    RETURN QUERY SELECT false, 'insufficient_ownership'; RETURN;
  END IF;

  IF v_unit IS NOT NULL THEN
    UPDATE public.auto_campaign_input_data d
    SET status = CASE WHEN d.id = ANY(v_unstarted) THEN 'chờ xử lý' ELSE 'hoàn thành' END,
      date_action = CASE WHEN d.id = ANY(v_unstarted) THEN NULL ELSE d.date_action END,
      note = CASE WHEN d.id = ANY(v_unstarted) THEN d.note
        ELSE left(COALESCE(p_note, 'Lượt chạy bị gián đoạn'), 2000) || ' — Kết quả chưa xác nhận; không tự gửi lại.' END
    WHERE d.campaign_id = p_campaign_id AND d.id = ANY(v_ids)
      AND (d.status = 'đang chạy' OR (d.status = 'chờ xử lý' AND NOT (d.id = ANY(v_unstarted))));
    -- An inner error/pause handler may have requeued a started input before its
    -- next write failed. Its still-owned lease proves it cannot be sent again.
    -- Already paused/completed inputs are deliberately untouched.
    UPDATE public.auto_campaigns c
    SET runtime_unit_token = NULL, runtime_unit_vietnam_date = NULL,
      runtime_unit_claimed_at = NULL, runtime_unit_input_data_ids = NULL, updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_unit_token = p_runtime_unit_token;
  END IF;

  IF v_parent = p_runtime_claim_token THEN
    UPDATE public.auto_campaigns c
    SET status = CASE WHEN p_pause_unknown_outcome THEN 'tạm dừng' ELSE COALESCE(p_campaign_status, 'chờ xử lý') END,
      note = left(COALESCE(p_note, 'Lượt chạy bị gián đoạn'), 2000)
        || CASE WHEN p_pause_unknown_outcome THEN ' — Chưa xác định phần đã thực hiện; tạm dừng để kiểm tra.' ELSE '' END,
      updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_claim_token = p_runtime_claim_token AND c.status = 'đang chạy';
    -- The existing server pause trigger preserves the parent tuple on a status
    -- transition. Clear it separately, under the same row lock/transaction.
    UPDATE public.auto_campaigns c
    SET runtime_claim_token = NULL, runtime_claim_target = NULL,
      runtime_claim_vietnam_date = NULL, runtime_claimed_at = NULL, updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_claim_token = p_runtime_claim_token;
  END IF;
  IF v_account_token = p_runtime_claim_token THEN
    UPDATE public.auto_accounts a
    SET status = CASE WHEN a.status = 'đang chạy' THEN COALESCE(p_account_status, 'chờ xử lý') ELSE a.status END,
      runtime_operation_claim_token = NULL, updated_at = v_now
    WHERE a.id = p_account_id AND a.staff_id = p_staff_id
      AND a.runtime_operation_claim_token = p_runtime_claim_token;
  END IF;
  RETURN QUERY SELECT true, 'cleaned';
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text) TO anon, authenticated, service_role, aka_agent_chat_api;

-- New RPC signature must become visible to PostgREST; no data-only reload.
NOTIFY pgrst, 'reload schema';

-- Preserve the user's schedule timestamp for daily campaigns that do not wait
-- for the next day's configured time. Their old timestamp intentionally stays
-- due across midnight, so the v2 claim must not mistake it for an unmaintained
-- recurring schedule. Daily campaigns that do wait, plus weekly and monthly
-- campaigns, still fail closed until maintenance advances their recurrence.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)'
  );
  v_checksum text;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'aka_agent_claim_campaign_runtime_v2_signature_missing';
  END IF;

  SELECT
    pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)),
    owner_role.rolname,
    proc.prosecdef,
    proc.provolatile,
    proc.proconfig
  INTO
    v_checksum,
    v_owner,
    v_security_definer,
    v_volatility,
    v_config
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = proc.proowner
  WHERE proc.oid = v_function_oid;

  IF v_checksum NOT IN (
    '5597e09b5b80435e27b7d4a1e134321e',
    '782a8b7adf396f21f7d69bc4a613bce1'
  ) THEN
    RAISE EXCEPTION
      'aka_agent_claim_campaign_runtime_v2_checksum_mismatch: %',
      v_checksum;
  END IF;
  IF v_owner <> 'postgres'
    OR v_security_definer IS DISTINCT FROM false
    OR v_volatility <> 'v'
    OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  THEN
    RAISE EXCEPTION
      'aka_agent_claim_campaign_runtime_v2_attributes_mismatch';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
      'postgres', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'anon', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'authenticated', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'aka_agent_chat_api', v_function_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'public', v_function_oid, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'aka_agent_claim_campaign_runtime_v2_acl_mismatch';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_campaign_runtime_v2(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_runtime_claim_token uuid
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_status text,
  account_status text,
  runtime_claim_token uuid,
  runtime_claim_vietnam_date date,
  runtime_claimed_at timestamptz,
  db_now timestamptz,
  vietnam_date_key date,
  effective_stop_time time without time zone,
  boundary_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
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

COMMENT ON FUNCTION public.aka_agent_claim_campaign_runtime_v2(
  bigint, bigint, bigint, text, uuid
) IS
  'Backward-compatible, retry-idempotent top-level claim wrapper. Daily campaigns with continue_next_day=false intentionally keep an already-due old timestamp and may claim normally; daily campaigns that wait for the next configured time plus weekly/monthly recurrences still reject stale pre-maintenance schedules. All unit-lease, cutoff, retry-token, ownership, and Vietnam-day race guards remain enforced before and after locking.';

DO $grant_chat_daily_maintenance_barrier$
DECLARE
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_check_daily_maintenance_barrier(bigint,text,date)'
  );
  v_checksum text;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'aka_agent_check_daily_maintenance_barrier_signature_missing';
  END IF;

  SELECT
    pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)),
    owner_role.rolname,
    proc.prosecdef,
    proc.provolatile,
    proc.proconfig
  INTO
    v_checksum,
    v_owner,
    v_security_definer,
    v_volatility,
    v_config
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = proc.proowner
  WHERE proc.oid = v_function_oid;

  IF v_checksum <> '087a04ad6f98cc2cff5267dabcead7cd' THEN
    RAISE EXCEPTION
      'aka_agent_check_daily_maintenance_barrier_checksum_mismatch: %',
      v_checksum;
  END IF;
  IF v_owner <> 'postgres'
    OR v_security_definer IS DISTINCT FROM false
    OR v_volatility <> 'v'
    OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  THEN
    RAISE EXCEPTION
      'aka_agent_check_daily_maintenance_barrier_attributes_mismatch';
  END IF;
  IF pg_catalog.to_regrole('aka_agent_chat_api') IS NULL THEN
    RAISE EXCEPTION 'aka_agent_chat_api_role_missing';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
      'postgres', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'anon', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'authenticated', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role', v_function_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'public', v_function_oid, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'aka_agent_check_daily_maintenance_barrier_acl_mismatch';
  END IF;

  GRANT EXECUTE ON FUNCTION public.aka_agent_check_daily_maintenance_barrier(
    bigint, text, date
  ) TO aka_agent_chat_api;

  IF NOT pg_catalog.has_function_privilege(
    'aka_agent_chat_api', v_function_oid, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'aka_agent_check_daily_maintenance_barrier_grant_failed';
  END IF;
END;
$grant_chat_daily_maintenance_barrier$;

DO $postflight$
DECLARE
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)'
  );
  v_checksum text;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
BEGIN
  SELECT
    pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)),
    owner_role.rolname,
    proc.prosecdef,
    proc.provolatile,
    proc.proconfig
  INTO
    v_checksum,
    v_owner,
    v_security_definer,
    v_volatility,
    v_config
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = proc.proowner
  WHERE proc.oid = v_function_oid;

  IF v_checksum <> '782a8b7adf396f21f7d69bc4a613bce1' THEN
    RAISE EXCEPTION
      'aka_agent_claim_campaign_runtime_v2_postflight_checksum_mismatch: %',
      v_checksum;
  END IF;

  IF v_owner <> 'postgres'
    OR v_security_definer IS DISTINCT FROM false
    OR v_volatility <> 'v'
    OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  THEN
    RAISE EXCEPTION
      'aka_agent_claim_campaign_runtime_v2_postflight_attributes_mismatch';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
      'postgres', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'anon', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'authenticated', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role', v_function_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'aka_agent_chat_api', v_function_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'public', v_function_oid, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'aka_agent_claim_campaign_runtime_v2_postflight_acl_mismatch';
  END IF;
END;
$postflight$;

COMMIT;

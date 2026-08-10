-- Add a DB-clock-authoritative boundary for campaign run units.
--
-- New runtimes use a tokenized v2 wrapper around the existing top-level claim
-- and a token-bound atomic claim before every target or batch. A configured
-- daily_stop_time is an inclusive cutoff. Campaigns without one start draining
-- at 23:59 Asia/Ho_Chi_Minh so schedule maintenance can run after the old-day
-- unit settles.
--
-- This migration is additive: legacy claim/release RPC signatures and their
-- ordinary idle behavior remain unchanged, so an already-running older binary
-- is not forced to stop or lose its current campaign. Existing Zalo account
-- operation claims additionally treat a durable v2 unit as running work.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.auto_campaigns') IS NULL
    OR pg_catalog.to_regclass('public.auto_accounts') IS NULL
    OR pg_catalog.to_regclass('public.auto_campaign_inputs') IS NULL
    OR pg_catalog.to_regclass('public.auto_campaign_input_data') IS NULL
    OR pg_catalog.to_regclass('public.org_staff') IS NULL
  THEN
    RAISE EXCEPTION 'campaign_daily_boundary_tables_missing';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_lock_campaign_input_serialization(bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'campaign_input_serialization_barrier_missing';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.claim_campaign_runtime(bigint,bigint,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'campaign_runtime_claim_missing';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_claim_zalo_server_run_unit(bigint,bigint,bigint,bigint[])'
  ) IS NULL THEN
    RAISE EXCEPTION 'zalo_server_run_unit_claim_missing';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.resolve_organization_zalo_account_capabilities(bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'zalo_account_capability_resolver_missing';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)'
  ) IS NULL THEN
    RAISE EXCEPTION 'zalo_account_runtime_operation_claim_missing';
  END IF;
END;
$preflight$;

-- Nullable, no-default metadata keeps this ALTER metadata-only and lets an old
-- binary continue to use claim_campaign_runtime unchanged. A NULL token/date
-- unambiguously identifies a legacy claim.
ALTER TABLE public.auto_campaigns
  ADD COLUMN IF NOT EXISTS runtime_claim_token uuid,
  ADD COLUMN IF NOT EXISTS runtime_claim_target text,
  ADD COLUMN IF NOT EXISTS runtime_claim_vietnam_date date,
  ADD COLUMN IF NOT EXISTS runtime_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS runtime_unit_token uuid,
  ADD COLUMN IF NOT EXISTS runtime_unit_vietnam_date date,
  ADD COLUMN IF NOT EXISTS runtime_unit_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS runtime_unit_input_data_ids bigint[];

ALTER TABLE public.auto_campaigns
  ALTER COLUMN runtime_claim_token DROP DEFAULT,
  ALTER COLUMN runtime_claim_token DROP NOT NULL,
  ALTER COLUMN runtime_claim_target DROP DEFAULT,
  ALTER COLUMN runtime_claim_target DROP NOT NULL,
  ALTER COLUMN runtime_claim_vietnam_date DROP DEFAULT,
  ALTER COLUMN runtime_claim_vietnam_date DROP NOT NULL,
  ALTER COLUMN runtime_claimed_at DROP DEFAULT,
  ALTER COLUMN runtime_claimed_at DROP NOT NULL,
  ALTER COLUMN runtime_unit_token DROP DEFAULT,
  ALTER COLUMN runtime_unit_token DROP NOT NULL,
  ALTER COLUMN runtime_unit_vietnam_date DROP DEFAULT,
  ALTER COLUMN runtime_unit_vietnam_date DROP NOT NULL,
  ALTER COLUMN runtime_unit_claimed_at DROP DEFAULT,
  ALTER COLUMN runtime_unit_claimed_at DROP NOT NULL,
  ALTER COLUMN runtime_unit_input_data_ids DROP DEFAULT,
  ALTER COLUMN runtime_unit_input_data_ids DROP NOT NULL;

COMMENT ON COLUMN public.auto_campaigns.runtime_claim_token IS
  'Opaque ownership token set only by aka_agent_claim_campaign_runtime_v2. NULL denotes no v2 ownership (including legacy runtimes).';
COMMENT ON COLUMN public.auto_campaigns.runtime_claim_target IS
  'Normalized desktop/server owner captured atomically with the v2 parent claim. It limits running -> paused lost-response preservation to Server claims.';
COMMENT ON COLUMN public.auto_campaigns.runtime_claim_vietnam_date IS
  'Asia/Ho_Chi_Minh date captured atomically by the v2 top-level claim. Daily maintenance uses this immutable run date instead of mutable schedule.';
COMMENT ON COLUMN public.auto_campaigns.runtime_claimed_at IS
  'PostgreSQL clock timestamp at which the current v2 runtime claim was committed.';
COMMENT ON COLUMN public.auto_campaigns.runtime_unit_token IS
  'Durable client UUID for the one active v2 run unit. It survives campaign/account control changes until token-CAS settlement or startup recovery.';
COMMENT ON COLUMN public.auto_campaigns.runtime_unit_vietnam_date IS
  'Immutable Asia/Ho_Chi_Minh date on which the active run unit was reserved. Daily maintenance waits for every old-day unit lease regardless of campaign status.';
COMMENT ON COLUMN public.auto_campaigns.runtime_unit_claimed_at IS
  'PostgreSQL clock timestamp at which the active v2 run-unit lease and its input reservation were committed.';
COMMENT ON COLUMN public.auto_campaigns.runtime_unit_input_data_ids IS
  'Canonical de-duplicated ascending input-data IDs reserved by the active v2 unit; an empty array is a valid leased aggregate unit.';

CREATE OR REPLACE FUNCTION public.aka_agent_clear_campaign_runtime_claim_metadata()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'đang chạy'
      AND NEW.status = 'tạm dừng'
      AND OLD.runtime_claim_target = 'server'
    THEN
      -- Server run control is DB-first. A pause can commit after the executor's
      -- top-level claim committed but before that response reached the caller.
      -- Preserve the exact ownership tuple so the caller can recover the lost
      -- response, observe the paused status, and release the account only from
      -- its normal safe cleanup boundary.
      NEW.runtime_claim_token := OLD.runtime_claim_token;
      NEW.runtime_claim_target := OLD.runtime_claim_target;
      NEW.runtime_claim_vietnam_date := OLD.runtime_claim_vietnam_date;
      NEW.runtime_claimed_at := OLD.runtime_claimed_at;
    ELSE
      NEW.runtime_claim_token := NULL;
      NEW.runtime_claim_target := NULL;
      NEW.runtime_claim_vietnam_date := NULL;
      NEW.runtime_claimed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.aka_agent_clear_campaign_runtime_claim_metadata() IS
  'Clears top-level v2 ownership on campaign status changes except a Server-owned đang chạy -> tạm dừng transition, which preserves the immutable tuple for lost-claim-response recovery and safe executor cleanup. Desktop pause clears the tuple so ordinary resume remains compatible. Active durable runtime_unit_* leases always survive control changes until explicit settlement or startup recovery.';

DROP TRIGGER IF EXISTS aka_agent_clear_campaign_runtime_claim_metadata
  ON public.auto_campaigns;
CREATE TRIGGER aka_agent_clear_campaign_runtime_claim_metadata
BEFORE UPDATE OF status ON public.auto_campaigns
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_clear_campaign_runtime_claim_metadata();

-- Account-only Zalo operations and subtype conversion predate durable campaign
-- units. DB-first pause can make every mutable status non-running while the
-- last unit is still performing its external effect. Keep the established
-- account-row lock/order and add the immutable lease to both work guards so an
-- old operation client or the tokenized subtype client cannot overlap it.
CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_requires_login boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
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
$function$;

COMMENT ON FUNCTION public.claim_zalo_account_runtime_operation(
  bigint, bigint, text, boolean
) IS
  'Claims a Zalo account-only operation for the current subtype owner. Durable campaign runtime_unit_token ownership is work_running even after DB-first pause changed all mutable statuses.';

CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_previous_status text,
  p_claim_token uuid,
  p_requires_login boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
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
$function$;

COMMENT ON FUNCTION public.claim_zalo_account_runtime_operation(
  bigint, bigint, text, text, uuid, boolean
) IS
  'Tokenized Zalo account/subtype-operation claim. Durable campaign runtime_unit_token ownership is work_running even after DB-first pause changed all mutable statuses; exact account-operation token retries remain idempotent.';

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
    campaign.schedule
  INTO
    v_daily_stop_time,
    v_campaign_status,
    v_account_status,
    v_stored_claim_token,
    v_stored_claim_target,
    v_stored_claim_vietnam_date,
    v_stored_claimed_at,
    v_stored_unit_token,
    v_schedule
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

  -- A resumed daily row can race maintenance while its schedule still points
  -- into the previous Vietnam day. Fail closed without changing either status;
  -- maintenance advances it to today's due time before a new claim may form.
  IF v_campaign_status = 'chờ xử lý'
    AND v_schedule IS NOT NULL
    AND v_schedule < v_vietnam_day_start
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
        campaign.schedule
      INTO
        v_campaign_status,
        v_account_status,
        v_stored_claim_token,
        v_stored_claim_target,
        v_stored_claim_vietnam_date,
        v_stored_claimed_at,
        v_daily_stop_time,
        v_stored_unit_token,
        v_schedule
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
      campaign.schedule
    INTO
      v_daily_stop_time,
      v_campaign_status,
      v_account_status,
      v_stored_unit_token,
      v_schedule
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
  'Backward-compatible, retry-idempotent top-level claim wrapper. The client-supplied UUID and stored immutable target/date/timestamp recover a committed claim after a lost response before mutable campaign/account statuses are considered, including a concurrent DB-first Server pause. A first claim invokes claim_campaign_runtime in the same transaction, rejects stale pre-maintenance schedules and the inclusive min(daily_stop_time, 23:59) boundary before and after locking, then atomically assigns the token, normalized runtime target, and immutable Vietnam run date.';

CREATE OR REPLACE FUNCTION public.aka_agent_check_campaign_daily_boundary(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_claimed_vietnam_date date
)
RETURNS TABLE(
  allow_new_unit boolean,
  reason text,
  campaign_status text,
  account_status text,
  db_now timestamptz,
  vietnam_date_key date,
  claimed_vietnam_date_key date,
  effective_stop_time time without time zone,
  boundary_at timestamptz,
  day_changed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_organization_id bigint;
  v_campaign_status text;
  v_account_status text;
  v_daily_stop_time time without time zone;
  v_campaign_is_delete boolean;
  v_account_is_delete boolean;
  v_account_is_active boolean;
  v_account_login_status text;
  v_account_platform text;
  v_account_is_zalo_web boolean;
  v_account_is_zalo_server boolean;
  v_effective_stop_time time without time zone;
  v_boundary_at timestamptz;
  v_day_changed boolean;
  v_reason text;
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
  IF p_claimed_vietnam_date IS NULL THEN
    RAISE EXCEPTION 'claimed Vietnam date is required';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text,
      v_now, v_vietnam_date, p_claimed_vietnam_date,
      NULL::time, NULL::timestamptz,
      v_vietnam_date > p_claimed_vietnam_date;
    RETURN;
  END IF;

  SELECT
    campaign.status,
    account.status,
    campaign.daily_stop_time,
    COALESCE(campaign.is_delete, false),
    COALESCE(account.is_delete, false),
    COALESCE(account.is_active, false),
    account.login_status,
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false)
  INTO
    v_campaign_status,
    v_account_status,
    v_daily_stop_time,
    v_campaign_is_delete,
    v_account_is_delete,
    v_account_is_active,
    v_account_login_status,
    v_account_platform,
    v_account_is_zalo_web,
    v_account_is_zalo_server
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

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      v_now, v_vietnam_date, p_claimed_vietnam_date,
      NULL::time, NULL::timestamptz,
      v_vietnam_date > p_claimed_vietnam_date;
    RETURN;
  END IF;

  v_effective_stop_time := LEAST(
    COALESCE(v_daily_stop_time, time '23:59:00'),
    time '23:59:00'
  );
  v_boundary_at := (
    p_claimed_vietnam_date + v_effective_stop_time
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_day_changed := v_vietnam_date > p_claimed_vietnam_date;

  IF (v_runtime_target = 'server' AND (
      v_account_platform <> 'zalo'
      OR v_account_is_zalo_web
      OR NOT v_account_is_zalo_server
    ))
    OR (v_runtime_target = 'desktop' AND (
      v_account_platform = 'zalo' AND v_account_is_zalo_server
    ))
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
    -- A concurrent manual campaign/account pause always wins.
    v_reason := 'runtime_control_paused';
  ELSIF p_claimed_vietnam_date > v_vietnam_date THEN
    v_reason := 'invalid_claimed_vietnam_date';
  ELSIF v_day_changed THEN
    v_reason := 'vietnam_day_changed';
  ELSIF v_now >= v_boundary_at THEN
    -- Inclusive comparison: no unit may start exactly at the cutoff.
    v_reason := CASE
      WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
      ELSE 'daily_stop_due'
    END;
  ELSE
    v_reason := 'allowed';
  END IF;

  RETURN QUERY SELECT
    v_reason = 'allowed',
    v_reason,
    v_campaign_status,
    v_account_status,
    v_now,
    v_vietnam_date,
    p_claimed_vietnam_date,
    v_effective_stop_time,
    v_boundary_at,
    v_day_changed;
END;
$function$;

COMMENT ON FUNCTION public.aka_agent_check_campaign_daily_boundary(
  bigint, bigint, bigint, text, date
) IS
  'Read-only pre-unit guard using the PostgreSQL clock. The effective inclusive cutoff is min(daily_stop_time, 23:59 Asia/Ho_Chi_Minh), with 23:59 used when daily_stop_time is NULL.';

CREATE OR REPLACE FUNCTION public.aka_agent_claim_campaign_run_unit_v2(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_runtime_claim_token uuid,
  p_runtime_claim_vietnam_date date,
  p_runtime_unit_token uuid,
  p_input_data_ids bigint[] DEFAULT ARRAY[]::bigint[]
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_status text,
  account_status text,
  claimed_count integer,
  runtime_claim_token uuid,
  runtime_claim_vietnam_date date,
  runtime_unit_token uuid,
  runtime_unit_vietnam_date date,
  runtime_unit_claimed_at timestamptz,
  runtime_unit_input_data_ids bigint[],
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
  IF NOT v_staff_is_active THEN
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
$function$;

COMMENT ON FUNCTION public.aka_agent_claim_campaign_run_unit_v2(
  bigint, bigint, bigint, text, uuid, date, uuid, bigint[]
) IS
  'Atomically reserves at most 50 canonical de-duplicated ascending input-data IDs and writes one durable client-token unit lease. The exact token/date/payload retry returns already_claimed before mutable control or parent-token checks, including after pause or midnight. A different token cannot pass an active lease; empty-ID aggregate units are leased and retry-idempotent.';

CREATE OR REPLACE FUNCTION public.aka_agent_settle_campaign_run_unit_v2(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_runtime_unit_token uuid,
  p_requeue_unstarted boolean
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_status text,
  account_status text,
  db_now timestamptz,
  vietnam_date_key date,
  requeued_count integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
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
$function$;

COMMENT ON FUNCTION public.aka_agent_settle_campaign_run_unit_v2(
  bigint, bigint, bigint, text, uuid, boolean
) IS
  'Token-CAS settlement for a durable run-unit lease. Normal settlement clears only the lease after caller side effects and DB writes settle; requeue_unstarted additionally resets only exact stored input IDs still running to pending/date_action NULL. Exact opaque-token cleanup survives mutable campaign/account status and account-subtype changes.';

CREATE OR REPLACE FUNCTION public.aka_agent_recover_campaign_runtime_unit_leases(
  p_staff_id bigint,
  p_runtime_target text,
  p_platform_scope text DEFAULT 'all'
)
RETURNS TABLE(
  ok boolean,
  reason text,
  recovered_lease_count bigint,
  requeued_input_count bigint,
  db_now timestamptz,
  vietnam_date_key date
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_platform_scope text := lower(btrim(COALESCE(p_platform_scope, '')));
  v_organization_id bigint;
  v_candidate record;
  v_locked_token uuid;
  v_locked_input_data_ids bigint[];
  v_recovered_lease_count bigint := 0;
  v_requeued_input_count bigint := 0;
  v_row_count bigint := 0;
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'staff ID must be a positive integer';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF v_platform_scope NOT IN ('all', 'zalo') THEN
    RAISE EXCEPTION 'platform scope must be all or zalo';
  END IF;

  -- Startup recovery is cleanup and therefore remains available for an
  -- inactive staff row. The caller must invoke it only after its existing
  -- runtime-specific recovery has proved the scheduler process idle.
  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', 0::bigint, 0::bigint,
      v_now, v_vietnam_date;
    RETURN;
  END IF;

  FOR v_candidate IN
    SELECT campaign.id AS campaign_id,
      campaign.account_id,
      campaign.runtime_unit_token,
      campaign.runtime_unit_input_data_ids
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token IS NOT NULL
      AND (
        v_platform_scope = 'all'
        OR lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      )
      AND (
        campaign.organization_id IS NULL
        OR campaign.organization_id = v_organization_id
      )
      AND (
        account.organization_id IS NULL
        OR account.organization_id = v_organization_id
      )
      AND (
        (
          v_runtime_target = 'server'
          AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
        OR (
          v_runtime_target = 'desktop'
          AND NOT (
            lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
            AND COALESCE(account.is_zalo_server, false) = true
          )
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(
      v_candidate.campaign_id
    );

    IF cardinality(COALESCE(
      v_candidate.runtime_unit_input_data_ids,
      ARRAY[]::bigint[]
    )) > 0 THEN
      PERFORM input_data.id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = ANY(v_candidate.runtime_unit_input_data_ids)
        AND input_data.campaign_id = v_candidate.campaign_id
      ORDER BY input_data.id
      FOR UPDATE OF input_data;
    END IF;

    SELECT campaign.runtime_unit_token,
      campaign.runtime_unit_input_data_ids
    INTO v_locked_token, v_locked_input_data_ids
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    WHERE campaign.id = v_candidate.campaign_id
      AND campaign.account_id = v_candidate.account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token = v_candidate.runtime_unit_token
      AND (
        v_platform_scope = 'all'
        OR lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      )
      AND (
        campaign.organization_id IS NULL
        OR campaign.organization_id = v_organization_id
      )
      AND (
        account.organization_id IS NULL
        OR account.organization_id = v_organization_id
      )
      AND (
        (
          v_runtime_target = 'server'
          AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
        OR (
          v_runtime_target = 'desktop'
          AND NOT (
            lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
            AND COALESCE(account.is_zalo_server, false) = true
          )
        )
      )
    FOR UPDATE OF campaign, account;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF cardinality(COALESCE(v_locked_input_data_ids, ARRAY[]::bigint[])) > 0 THEN
      UPDATE public.auto_campaign_input_data AS input_data
      SET status = 'chờ xử lý', date_action = NULL
      WHERE input_data.id = ANY(v_locked_input_data_ids)
        AND input_data.campaign_id = v_candidate.campaign_id
        AND input_data.status = 'đang chạy';
      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_requeued_input_count := v_requeued_input_count + v_row_count;
    END IF;

    v_now := clock_timestamp();
    UPDATE public.auto_campaigns AS campaign
    SET runtime_unit_token = NULL,
      runtime_unit_vietnam_date = NULL,
      runtime_unit_claimed_at = NULL,
      runtime_unit_input_data_ids = NULL,
      updated_at = v_now
    WHERE campaign.id = v_candidate.campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token = v_locked_token;

    IF FOUND THEN
      v_recovered_lease_count := v_recovered_lease_count + 1;
    END IF;
  END LOOP;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  RETURN QUERY SELECT
    true, 'recovered', v_recovered_lease_count, v_requeued_input_count,
    v_now, v_vietnam_date;
END;
$function$;

COMMENT ON FUNCTION public.aka_agent_recover_campaign_runtime_unit_leases(
  bigint, text, text
) IS
  'Startup/handoff cleanup after the caller runtime has completed existing running-state recovery and proved the scoped scheduler idle. platform_scope=all preserves broad startup/quit behavior; platform_scope=zalo limits Desktop handoff recovery to Zalo accounts so live Facebook/email leases remain untouched. For matching staff/runtime ownership, requeues only each durable lease stored running input IDs and clears that lease; campaign status is never changed.';

CREATE OR REPLACE FUNCTION public.aka_agent_set_desktop_campaign_status_v2(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_target_status text
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_status text,
  account_status text,
  db_now timestamptz,
  vietnam_date_key date
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_target_status text := btrim(COALESCE(p_target_status, ''));
  v_organization_id bigint;
  v_campaign_found boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_campaign_is_delete boolean;
  v_account_is_delete boolean;
  v_account_is_active boolean;
  v_account_platform text;
  v_account_is_zalo_server boolean;
  v_runtime_claim_token uuid;
  v_runtime_claim_target text;
  v_runtime_unit_token uuid;
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_reason text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'campaign, account and staff IDs must be positive integers';
  END IF;
  IF v_target_status NOT IN ('tạm dừng', 'chờ xử lý') THEN
    RAISE EXCEPTION 'target status must be paused or pending';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text,
      v_now, v_vietnam_date;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.status, account.status, account.login_status,
    COALESCE(campaign.is_delete, false),
    COALESCE(account.is_delete, false),
    COALESCE(account.is_active, false),
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_server, false),
    campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_unit_token
  INTO v_campaign_status, v_account_status, v_account_login_status,
    v_campaign_is_delete, v_account_is_delete, v_account_is_active,
    v_account_platform, v_account_is_zalo_server,
    v_runtime_claim_token, v_runtime_claim_target, v_runtime_unit_token
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
      v_now, v_vietnam_date;
    RETURN;
  END IF;

  IF v_account_platform = 'zalo' AND v_account_is_zalo_server THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_campaign_is_delete THEN
    v_reason := 'campaign_deleted';
  ELSIF v_account_is_delete THEN
    v_reason := 'account_deleted';
  ELSIF NOT v_account_is_active THEN
    v_reason := 'account_inactive';
  ELSIF v_target_status = 'tạm dừng' THEN
    IF v_campaign_status = 'tạm dừng' THEN
      v_reason := 'already_target';
    ELSIF v_campaign_status = 'đang chạy'
      OR v_runtime_claim_token IS NOT NULL
    THEN
      v_reason := 'runtime_busy';
    ELSIF v_runtime_unit_token IS NOT NULL THEN
      v_reason := 'unit_lease_busy';
    ELSIF v_campaign_status IS DISTINCT FROM 'chờ xử lý' THEN
      v_reason := 'invalid_transition';
    ELSE
      UPDATE public.auto_campaigns AS campaign
      SET status = 'tạm dừng',
        note = CASE
          WHEN campaign.data_target_source_mode = 'data_group'
            AND campaign.note IN ('Chờ data phù hợp', 'Chờ data mới')
          THEN campaign.note
          ELSE NULL
        END,
        updated_at = v_now
      WHERE campaign.id = p_campaign_id
        AND campaign.account_id = p_account_id
        AND campaign.staff_id = p_staff_id
        AND campaign.status = 'chờ xử lý'
        AND campaign.runtime_claim_token IS NULL
        AND campaign.runtime_unit_token IS NULL;
      IF FOUND THEN
        v_campaign_status := 'tạm dừng';
        v_reason := 'updated';
      ELSE
        v_reason := 'runtime_busy';
      END IF;
    END IF;
  ELSE
    IF v_campaign_status = 'đang chạy' THEN
      v_reason := 'runtime_busy';
    ELSIF v_runtime_unit_token IS NOT NULL THEN
      v_reason := 'unit_lease_busy';
    ELSIF v_runtime_claim_token IS NOT NULL
      AND v_runtime_claim_target IS DISTINCT FROM 'server'
    THEN
      v_reason := 'runtime_busy';
    ELSIF v_account_status = 'đang chạy' THEN
      v_reason := 'account_running';
    ELSIF NOT v_account_is_active THEN
      v_reason := 'account_inactive';
    ELSIF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
      v_reason := 'account_logged_out';
    ELSIF v_campaign_status IS DISTINCT FROM 'tạm dừng' THEN
      v_reason := 'invalid_transition';
    ELSE
      UPDATE public.auto_campaigns AS campaign
      SET status = 'chờ xử lý', note = NULL, updated_at = v_now
      WHERE campaign.id = p_campaign_id
        AND campaign.account_id = p_account_id
        AND campaign.staff_id = p_staff_id
        AND campaign.status = 'tạm dừng'
        AND (
          campaign.runtime_claim_token IS NULL
          OR campaign.runtime_claim_target = 'server'
        )
        AND campaign.runtime_unit_token IS NULL;
      IF FOUND THEN
        v_campaign_status := 'chờ xử lý';
        v_reason := 'updated';
      ELSE
        v_reason := 'runtime_busy';
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_reason IN ('updated', 'already_target'),
    v_reason,
    v_campaign_status,
    v_account_status,
    v_now,
    v_vietnam_date;
END;
$function$;

COMMENT ON FUNCTION public.aka_agent_set_desktop_campaign_status_v2(
  bigint, bigint, bigint, text
) IS
  'Desktop control CAS. Pause changes only pending to paused; a running/claimed row returns runtime_busy so the local scheduler can latch a soft pause. Resume changes only paused to pending when campaign/account are not running and no unit lease exists; it may consume a dormant Server parent tuple after the account subtype has moved to Desktop, and the status trigger clears that tuple atomically. Other parent claims, stale updates, and duplicate resume never overwrite newer ownership.';

CREATE OR REPLACE FUNCTION public.aka_agent_yield_campaign_daily_boundary(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_runtime_claim_token uuid,
  p_claimed_vietnam_date date
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_status text,
  account_status text,
  db_now timestamptz,
  vietnam_date_key date,
  claimed_vietnam_date_key date,
  effective_stop_time time without time zone,
  boundary_at timestamptz,
  day_changed boolean,
  running_input_count bigint
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz;
  v_vietnam_date date;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_organization_id bigint;
  v_campaign_status text;
  v_account_status text;
  v_daily_stop_time time without time zone;
  v_campaign_is_delete boolean;
  v_account_is_delete boolean;
  v_account_platform text;
  v_account_is_zalo_web boolean;
  v_account_is_zalo_server boolean;
  v_stored_claim_token uuid;
  v_stored_claim_target text;
  v_stored_claim_vietnam_date date;
  v_stored_unit_token uuid;
  v_effective_stop_time time without time zone;
  v_boundary_at timestamptz;
  v_day_changed boolean;
  v_running_input_count bigint := 0;
  v_reason text;
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
  IF p_runtime_claim_token IS NULL OR p_claimed_vietnam_date IS NULL THEN
    RAISE EXCEPTION 'runtime claim token and Vietnam date are required';
  END IF;

  -- Yield is cleanup. Do not require staff.is_active or a live entitlement:
  -- capability loss must not strand a campaign/account in running state.
  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    v_now := clock_timestamp();
    v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text,
      v_now, v_vietnam_date, p_claimed_vietnam_date,
      NULL::time, NULL::timestamptz,
      v_vietnam_date > p_claimed_vietnam_date,
      0::bigint;
    RETURN;
  END IF;

  -- Use the same campaign-scoped serialization barrier as Server run-unit
  -- claims and Control pause/resume before touching input/campaign rows.
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Wait for any in-flight unit row to become stable, but never mutate it.
  -- The runtime calls this RPC only after its current target/batch has settled.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'đang chạy'
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  PERFORM campaign_input.id
  FROM public.auto_campaign_inputs AS campaign_input
  WHERE campaign_input.campaign_id = p_campaign_id
    AND COALESCE(campaign_input.is_delete, false) = false
    AND campaign_input.status = 'đang chạy'
  ORDER BY campaign_input.id
  FOR UPDATE OF campaign_input;

  SELECT
    campaign.status,
    account.status,
    campaign.daily_stop_time,
    COALESCE(campaign.is_delete, false),
    COALESCE(account.is_delete, false),
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false),
    campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_claim_vietnam_date,
    campaign.runtime_unit_token
  INTO
    v_campaign_status,
    v_account_status,
    v_daily_stop_time,
    v_campaign_is_delete,
    v_account_is_delete,
    v_account_platform,
    v_account_is_zalo_web,
    v_account_is_zalo_server,
    v_stored_claim_token,
    v_stored_claim_target,
    v_stored_claim_vietnam_date,
    v_stored_unit_token
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

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      v_now, v_vietnam_date, p_claimed_vietnam_date,
      NULL::time, NULL::timestamptz,
      v_vietnam_date > p_claimed_vietnam_date,
      0::bigint;
    RETURN;
  END IF;

  v_effective_stop_time := LEAST(
    COALESCE(v_daily_stop_time, time '23:59:00'),
    time '23:59:00'
  );
  v_boundary_at := (
    p_claimed_vietnam_date + v_effective_stop_time
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_day_changed := v_vietnam_date > p_claimed_vietnam_date;

  SELECT
    (
      SELECT count(*)
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = p_campaign_id
        AND COALESCE(input_data.is_delete, false) = false
        AND input_data.status = 'đang chạy'
    ) + (
      SELECT count(*)
      FROM public.auto_campaign_inputs AS campaign_input
      WHERE campaign_input.campaign_id = p_campaign_id
        AND COALESCE(campaign_input.is_delete, false) = false
        AND campaign_input.status = 'đang chạy'
    )
  INTO v_running_input_count;

  IF v_stored_unit_token IS NOT NULL THEN
    -- A durable lease is the authoritative in-flight marker, including for an
    -- empty-ID aggregate unit and after DB-first control changed visible state.
    v_reason := 'unit_still_running';
  ELSIF (v_runtime_target = 'server' AND (
      v_account_platform <> 'zalo'
      OR v_account_is_zalo_web
      OR NOT v_account_is_zalo_server
    ))
    OR (v_runtime_target = 'desktop' AND (
      v_account_platform = 'zalo' AND v_account_is_zalo_server
    ))
  THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_campaign_is_delete THEN
    v_reason := 'campaign_deleted';
  ELSIF v_account_is_delete THEN
    v_reason := 'account_deleted';
  ELSIF v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
  THEN
    -- A DB-first running -> paused transition preserves the parent tuple, but
    -- visible control still wins so the owning executor performs its normal
    -- account-release cleanup instead of yielding or starting new work.
    v_reason := 'runtime_control_paused';
  ELSIF v_stored_claim_token IS DISTINCT FROM p_runtime_claim_token
    OR v_stored_claim_target IS DISTINCT FROM v_runtime_target
    OR v_stored_claim_vietnam_date IS DISTINCT FROM p_claimed_vietnam_date
  THEN
    -- While control remains running, mismatch wins over a newer run's input
    -- count so the stale executor cannot loop on unit_still_running.
    v_reason := 'runtime_claim_mismatch';
  ELSIF v_running_input_count > 0 THEN
    v_reason := 'unit_still_running';
  ELSIF p_claimed_vietnam_date > v_vietnam_date THEN
    v_reason := 'invalid_claimed_vietnam_date';
  ELSIF v_day_changed THEN
    v_reason := 'vietnam_day_changed';
  ELSIF v_now >= v_boundary_at THEN
    v_reason := CASE
      WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
      ELSE 'daily_stop_due'
    END;
  ELSE
    v_reason := 'boundary_not_due';
  END IF;

  IF v_reason IN (
    'vietnam_day_changed',
    'daily_drain_due',
    'daily_stop_due'
  ) THEN
    UPDATE public.auto_campaigns AS campaign
    SET
      status = 'chờ xử lý',
      runtime_claim_token = NULL,
      runtime_claim_target = NULL,
      runtime_claim_vietnam_date = NULL,
      runtime_claimed_at = NULL,
      updated_at = v_now
    WHERE campaign.id = p_campaign_id
      AND campaign.status = 'đang chạy'
      AND campaign.runtime_claim_token = p_runtime_claim_token
      AND campaign.runtime_claim_target = v_runtime_target
      AND campaign.runtime_claim_vietnam_date = p_claimed_vietnam_date
      AND campaign.runtime_unit_token IS NULL;

    IF FOUND THEN
      UPDATE public.auto_accounts AS account
      SET
        status = 'chờ xử lý',
        updated_at = v_now
      WHERE account.id = p_account_id
        AND account.staff_id = p_staff_id
        AND account.status = 'đang chạy';

      v_campaign_status := 'chờ xử lý';
      IF FOUND THEN
        v_account_status := 'chờ xử lý';
      END IF;
      v_reason := 'yielded_' || v_reason;
    ELSE
      -- Defensive CAS result; row locks make this unlikely, but never report a
      -- successful yield when a newer status won.
      v_reason := 'runtime_control_paused';
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_reason IN (
      'yielded_vietnam_day_changed',
      'yielded_daily_drain_due',
      'yielded_daily_stop_due'
    ),
    v_reason,
    v_campaign_status,
    v_account_status,
    v_now,
    v_vietnam_date,
    p_claimed_vietnam_date,
    v_effective_stop_time,
    v_boundary_at,
    v_day_changed,
    v_running_input_count;
END;
$function$;

COMMENT ON FUNCTION public.aka_agent_yield_campaign_daily_boundary(
  bigint, bigint, bigint, text, uuid, date
) IS
  'After explicit unit settlement, token-CAS a running campaign/account back to pending only when the DB clock has reached its inclusive daily boundary. Any durable active unit lease returns unit_still_running even for empty-ID work or after control changes; yield never changes schedule or input rows.';

CREATE OR REPLACE FUNCTION public.aka_agent_check_daily_maintenance_barrier(
  p_staff_id bigint,
  p_runtime_target text,
  p_vietnam_date_key date
)
RETURNS TABLE(
  ready boolean,
  running_campaign_count bigint,
  db_now timestamptz,
  vietnam_date_key date
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_vietnam_day_start timestamptz := (
    timezone('Asia/Ho_Chi_Minh', v_now)::date::timestamp
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_organization_id bigint;
  v_running_campaign_count bigint := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'staff ID must be a positive integer';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF p_vietnam_date_key IS NULL THEN
    RAISE EXCEPTION 'Vietnam date key is required';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 0::bigint, v_now, v_vietnam_date;
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_running_campaign_count
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = v_organization_id
    )
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    )
    AND (
      -- A durable unit lease blocks maintenance by its immutable date even if
      -- DB-first pause/delete/control has changed campaign status or cleared
      -- the parent claim fields.
      (
        campaign.runtime_unit_token IS NOT NULL
        AND campaign.runtime_unit_vietnam_date IS NOT NULL
        AND campaign.runtime_unit_vietnam_date < v_vietnam_date
      )
      OR (
        COALESCE(campaign.is_delete, false) = false
        AND COALESCE(account.is_delete, false) = false
        -- SMS/voice legacy/parent claims remain outside CampaignScheduler
        -- maintenance ownership. A durable unit lease above is never skipped,
        -- even if campaign metadata was edited while that lease drains.
        AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
        AND campaign.action_id IS DISTINCT FROM 'sms_send'
        AND campaign.action_id IS DISTINCT FROM 'voice_call'
        AND campaign.status = 'đang chạy'
        AND (
          -- A parent v2 claim without an active unit still uses its immutable
          -- run date; schedule may be rewritten only after the gate opens.
          (
            campaign.runtime_claim_vietnam_date IS NOT NULL
            AND campaign.runtime_claim_vietnam_date < v_vietnam_date
          )
          OR (
            -- Old binaries never set claim metadata, so retain the legacy
            -- stale-schedule heuristic only for NULL-date running rows.
            campaign.runtime_claim_vietnam_date IS NULL
            AND campaign.schedule IS NOT NULL
            AND campaign.schedule < v_vietnam_day_start
          )
        )
      )
    )
    AND (
      (
        v_runtime_target = 'server'
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
      )
      OR (
        v_runtime_target = 'desktop'
        AND NOT (
          lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_server, false) = true
        )
      )
    );

  -- A stale caller date never opens the maintenance gate. The coordinator
  -- must refresh its DB clock and retry for the actual Vietnam date.
  RETURN QUERY SELECT
    p_vietnam_date_key = v_vietnam_date
      AND v_running_campaign_count = 0,
    v_running_campaign_count,
    v_now,
    v_vietnam_date;
END;
$function$;

COMMENT ON FUNCTION public.aka_agent_check_daily_maintenance_barrier(
  bigint, text, date
) IS
  'Reports whether daily maintenance may run for this staff/runtime/date. Every old-day durable runtime_unit_vietnam_date lease blocks regardless of campaign status; parent v2 running claims use runtime_claim_vietnam_date and only legacy NULL-date running rows fall back to stale schedule.';

COMMENT ON COLUMN public.auto_campaigns.daily_stop_time IS
  'Inclusive daily cutoff in Asia/Ho_Chi_Minh. New runtimes stop before starting another unit; NULL uses the mandatory 23:59 daily drain boundary.';

REVOKE ALL ON FUNCTION public.aka_agent_check_campaign_daily_boundary(
  bigint, bigint, bigint, text, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_claim_campaign_runtime_v2(
  bigint, bigint, bigint, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_claim_campaign_run_unit_v2(
  bigint, bigint, bigint, text, uuid, date, uuid, bigint[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_settle_campaign_run_unit_v2(
  bigint, bigint, bigint, text, uuid, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_recover_campaign_runtime_unit_leases(
  bigint, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_set_desktop_campaign_status_v2(
  bigint, bigint, bigint, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_yield_campaign_daily_boundary(
  bigint, bigint, bigint, text, uuid, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_check_daily_maintenance_barrier(
  bigint, text, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_clear_campaign_runtime_claim_metadata()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_zalo_account_runtime_operation(
  bigint, bigint, text, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_zalo_account_runtime_operation(
  bigint, bigint, text, text, uuid, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.aka_agent_check_campaign_daily_boundary(
  bigint, bigint, bigint, text, date
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_claim_campaign_runtime_v2(
  bigint, bigint, bigint, text, uuid
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_claim_campaign_run_unit_v2(
  bigint, bigint, bigint, text, uuid, date, uuid, bigint[]
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_settle_campaign_run_unit_v2(
  bigint, bigint, bigint, text, uuid, boolean
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_recover_campaign_runtime_unit_leases(
  bigint, text, text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_set_desktop_campaign_status_v2(
  bigint, bigint, bigint, text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_yield_campaign_daily_boundary(
  bigint, bigint, bigint, text, uuid, date
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_check_daily_maintenance_barrier(
  bigint, text, date
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_zalo_account_runtime_operation(
  bigint, bigint, text, boolean
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_zalo_account_runtime_operation(
  bigint, bigint, text, text, uuid, boolean
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- v340: per-staff browser account admission limits; live source captured 2026-10-02.
-- Source/attributes: scripts/fixtures/browser-run-limits/live-source.json.
-- Apply once to linked akachat only, after rollback and isolated concurrency smoke.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
DECLARE r jsonb; p record;
BEGIN
  FOR r IN SELECT value FROM jsonb_array_elements($sources$[{"signature":"claim_campaign_runtime(bigint,bigint,bigint,text)","checksum":"02038a74bbd1238f276dee3109ae21cf","owner":"postgres","prosecdef":false,"provolatile":"v","proconfig":["search_path=public"],"proacl":"{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"signature":"auto_assert_automation_identity(bigint,bigint,text,text)","checksum":"5a9a503db72b965eb644739f5f60905d","owner":"postgres","prosecdef":true,"provolatile":"s","proconfig":["search_path=pg_catalog, public"],"proacl":"{postgres=X/postgres,service_role=X/postgres}"},{"signature":"guard_auto_account_runtime_operation_claim_token()","checksum":"aa29df91b50cd6bc11e24bd912545c40","owner":"postgres","prosecdef":false,"provolatile":"v","proconfig":["search_path=public"],"proacl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"signature":"aka_agent_clear_campaign_runtime_claim_metadata()","checksum":"dacc6362ba94f2f62c9e4cb43f965510","owner":"postgres","prosecdef":false,"provolatile":"v","proconfig":["search_path=pg_catalog, public"],"proacl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"signature":"aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)","checksum":"c822891785abb3fadf2576ec02b6b6f8","owner":"postgres","prosecdef":false,"provolatile":"v","proconfig":["search_path=pg_catalog, public"],"proacl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}"}]$sources$::jsonb) LOOP
    SELECT md5(pg_get_functiondef(oid)) AS checksum, pg_get_userbyid(proowner) AS owner,
      prosecdef, provolatile::text, to_jsonb(proconfig) AS proconfig, proacl::text
    INTO p FROM pg_proc WHERE oid=to_regprocedure('public.' || (r->>'signature'));
    IF NOT FOUND OR p.checksum IS DISTINCT FROM r->>'checksum'
      OR p.owner IS DISTINCT FROM r->>'owner' OR p.prosecdef IS DISTINCT FROM (r->>'prosecdef')::boolean
      OR p.provolatile IS DISTINCT FROM r->>'provolatile' OR COALESCE(p.proconfig,'null'::jsonb) IS DISTINCT FROM r->'proconfig'
      OR p.proacl IS DISTINCT FROM r->>'proacl' THEN
      RAISE EXCEPTION 'v340_source_drift:%', r->>'signature';
    END IF;
  END LOOP;
  IF to_regprocedure('public.aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text)') IS NOT NULL
    OR to_regprocedure('public.aka_agent_browser_run_limits(bigint,bigint,text,text,text,jsonb)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.org_staff'::regclass AND NOT attisdropped
      AND attname IN ('max_running_zalo_web_accounts','max_running_facebook_accounts','browser_run_limits_revision')) THEN
    RAISE EXCEPTION 'v340_target_already_exists';
  END IF;
END;
$preflight$;
ALTER TABLE public.org_staff
  ADD COLUMN max_running_zalo_web_accounts integer CHECK (max_running_zalo_web_accounts > 0),
  ADD COLUMN max_running_facebook_accounts integer CHECK (max_running_facebook_accounts > 0),
  ADD COLUMN browser_run_limits_revision bigint NOT NULL DEFAULT 0
    CHECK (browser_run_limits_revision BETWEEN 0 AND 9007199254740991);
COMMENT ON COLUMN public.org_staff.max_running_zalo_web_accounts IS 'Concurrent Zalo browser campaign accounts across this staff devices; NULL means unlimited.';
COMMENT ON COLUMN public.org_staff.max_running_facebook_accounts IS 'Concurrent Facebook campaign accounts across this staff devices; NULL means unlimited.';

CREATE OR REPLACE FUNCTION public.aka_agent_claim_campaign_runtime_checked(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text)
 RETURNS TABLE(ok boolean, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_capabilities record;
  v_is_zalo boolean;
  v_is_web boolean;
  v_is_server boolean;
  v_zalo_web_max integer;
  v_facebook_max integer;
  v_max integer;
  v_running bigint;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id, staff.max_running_zalo_web_accounts, staff.max_running_facebook_accounts
  INTO v_organization_id, v_zalo_web_max, v_facebook_max
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  -- Serialize only admission, never the duration of a campaign. Staff SHARE
  -- above also fences settings SAVE's staff UPDATE lock. Keep this before
  -- campaign/account row locks and after the existing entitlement barrier.
  IF v_runtime_target = 'desktop' AND (v_zalo_web_max IS NOT NULL OR v_facebook_max IS NOT NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || p_staff_id::text, 0));
  END IF;

  -- Server hard-end cleanup must start before the ordinary campaign/account
  -- claim locks. Candidate discovery uses only caller-readable campaign and
  -- account rows; the SECURITY DEFINER wrapper authoritatively revalidates the
  -- RPC-only Data Group source after joining the common input-first barrier.
  IF v_runtime_target = 'server'
    AND COALESCE(v_capabilities.qr_enabled, false)
    AND COALESCE(v_capabilities.server_enabled, false)
    AND EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
       AND account.staff_id = campaign.staff_id
      WHERE campaign.id = p_campaign_id
        AND campaign.staff_id = p_staff_id
        AND campaign.account_id = p_account_id
        AND campaign.organization_id = v_organization_id
        AND campaign.data_target_source_mode = 'data_group'
        AND campaign.action_id IN (
          'zalo_message_phone',
          'zalo_join_group_link',
          'zalo_message_friend',
          'zalo_message_group_member',
          'zalo_message_remarketing_customer',
          'zalo_message_group',
          'zalo_add_group_member'
        )
        AND campaign.schedule_end_date IS NOT NULL
        AND campaign.schedule_end_date <= now()
        AND (
          account.organization_id IS NULL
          OR account.organization_id = v_organization_id
        )
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
    )
  THEN
    BEGIN
      PERFORM public.aka_agent_finalize_zalo_server_data_group_campaign(
        p_staff_id,
        v_organization_id,
        v_capabilities.capability_revision,
        p_campaign_id,
        'Chiến dịch đã hết hạn'
      );
    EXCEPTION
      -- The source, campaign or account subtype can change after optimistic
      -- candidate discovery. Those expected races are a rejected
      -- claim, not a scheduler error; the authoritative sweep handles any
      -- remaining hard-end cleanup on its next pass.
      WHEN raise_exception THEN
        IF SQLERRM NOT IN (
          'data_group_server_campaign_not_found',
          'data_group_server_runtime_not_owner'
        ) THEN
          RAISE;
        END IF;
    END;
    RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN;
  END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.account_id = p_account_id
  FOR UPDATE OF campaign;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  v_is_zalo := lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'zalo';
  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);

  IF v_runtime_target = 'server' THEN
    IF NOT v_is_zalo OR v_is_web OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;
  ELSIF v_is_zalo AND (
    v_is_server
    OR (v_is_web AND NOT COALESCE(v_capabilities.web_enabled, false))
    OR (NOT v_is_web AND NOT v_is_server
      AND NOT COALESCE(v_capabilities.qr_enabled, false))
  ) THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  IF v_campaign.data_target_source_mode = 'data_group'
    AND v_campaign.schedule_end_date IS NOT NULL
    AND v_campaign.schedule_end_date <= now()
  THEN
    -- Expiry can race the pre-claim sweep. Do not call a privileged finalizer
    -- while executing as anon/authenticated and do not change either row. The
    -- next tenant sweep completes the hard-end cleanup under its narrow RPC.
    RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN;
  END IF;

  IF COALESCE(v_campaign.is_delete, false)
    OR v_campaign.status <> 'chờ xử lý'
    OR v_campaign.schedule IS NULL
    OR v_campaign.schedule > now()
    OR COALESCE(v_campaign.provisioning_state, 'ready') <> 'ready'
    OR (
      v_campaign.data_target_source_mode = 'data_group'
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND COALESCE(input_data.is_delete, false) = false
          AND input_data.status = 'chờ xử lý'
          AND (input_data.schedule IS NULL OR input_data.schedule <= now())
      )
    )
    OR (v_campaign.daily_stop_time IS NOT NULL
      AND v_campaign.daily_stop_time < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time)
    OR COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR v_account.status <> 'chờ xử lý'
    OR v_account.login_status <> 'đã đăng nhập'
  THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  v_max := CASE
    WHEN lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'facebook' THEN v_facebook_max
    WHEN v_is_zalo AND v_is_web AND NOT v_is_server THEN v_zalo_web_max
    ELSE NULL END;
  IF v_runtime_target = 'desktop' AND v_max IS NOT NULL THEN
    -- Status is enough for legacy clients; immutable claim/unit metadata also
    -- keeps a paused or draining run counted until its existing cleanup wins.
    -- Never filter live ownership by login/active/deleted flags. Account-only
    -- operations (login, scans) do not create a campaign and consume no slot.
    SELECT count(DISTINCT campaign.account_id) INTO v_running
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
      AND account.staff_id = campaign.staff_id
    WHERE campaign.staff_id = p_staff_id
      AND account.id <> p_account_id
      AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
      AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
      AND (campaign.status = 'đang chạy' OR campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)
      AND CASE WHEN v_is_zalo THEN
        lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND account.is_zalo_show_web = true AND account.is_zalo_server = false
        ELSE lower(btrim(COALESCE(account.flatform_type, ''))) = 'facebook' END;
    IF v_running >= v_max THEN
      RETURN QUERY SELECT false, 'concurrency_limit_reached'::text; RETURN;
    END IF;
  END IF;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy', note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;
  RETURN QUERY SELECT true, 'claimed'::text; RETURN;
END;
$function$
;
REVOKE ALL ON FUNCTION public.aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text) TO postgres,anon,authenticated,service_role,aka_agent_chat_api;

CREATE OR REPLACE FUNCTION public.claim_campaign_runtime(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT claim.ok FROM public.aka_agent_claim_campaign_runtime_checked(
    p_campaign_id, p_account_id, p_staff_id, p_runtime_target
  ) AS claim);
END;
$function$
;
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
  v_claim_reason text;
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
    SELECT claim.ok, claim.reason INTO v_legacy_claimed, v_claim_reason
    FROM public.aka_agent_claim_campaign_runtime_checked(
      p_campaign_id,
      p_account_id,
      p_staff_id,
      v_runtime_target
    ) AS claim;

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
        false, COALESCE(v_claim_reason, 'claim_rejected'), v_campaign_status, v_account_status,
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
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_browser_run_limits(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text,
  p_action text, p_data jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '10s'
SET lock_timeout TO '5s'
AS $function$
DECLARE
  v_staff public.org_staff%ROWTYPE;
  v_key text;
  v_zalo integer;
  v_facebook integer;
  v_revision bigint;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('get','save') THEN RAISE EXCEPTION 'browser_run_limits_invalid_action'; END IF;
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF p_action = 'save' THEN
    SELECT * INTO v_staff FROM public.org_staff WHERE id=p_staff_id FOR UPDATE;
  ELSE
    SELECT * INTO v_staff FROM public.org_staff WHERE id=p_staff_id;
  END IF;
  -- Revalidate the exact identity after locking, including service_role calls.
  IF NOT FOUND OR v_staff.organization_id IS DISTINCT FROM p_organization_id
    OR v_staff.is_active IS NOT TRUE OR v_staff.deleted_at IS NOT NULL
    OR p_auth_username IS NULL OR p_auth_password IS NULL
    OR v_staff.username IS DISTINCT FROM p_auth_username OR v_staff.password IS DISTINCT FROM p_auth_password
    OR NOT public.aka_agent_staff_time_allowed(p_staff_id) THEN
    RAISE EXCEPTION 'browser_run_limits_access_denied';
  END IF;
  IF p_action='save' THEN
    IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'browser_run_limits_invalid_input'; END IF;
    FOREACH v_key IN ARRAY ARRAY['zaloWebMax','facebookMax'] LOOP
      IF NOT (p_data ? v_key) THEN RAISE EXCEPTION 'browser_run_limits_invalid_input'; END IF;
      IF p_data->v_key <> 'null'::jsonb AND (
        jsonb_typeof(p_data->v_key) <> 'number'
        OR (p_data->>v_key) !~ '^[0-9]+$'
        OR (p_data->>v_key)::numeric < 1 OR (p_data->>v_key)::numeric > 2147483647
      ) THEN RAISE EXCEPTION 'browser_run_limits_invalid_input'; END IF;
    END LOOP;
    IF jsonb_typeof(p_data->'revision') IS DISTINCT FROM 'number'
      OR (p_data->>'revision') !~ '^[0-9]+$'
      OR (p_data->>'revision')::numeric > 9007199254740991 THEN
      RAISE EXCEPTION 'browser_run_limits_invalid_input';
    END IF;
    v_revision := (p_data->>'revision')::bigint;
    IF v_revision IS DISTINCT FROM v_staff.browser_run_limits_revision THEN
      RETURN jsonb_build_object('ok',false,'reason','conflict');
    END IF;
    v_zalo := (p_data->>'zaloWebMax')::integer;
    v_facebook := (p_data->>'facebookMax')::integer;
    UPDATE public.org_staff SET max_running_zalo_web_accounts=v_zalo,
      max_running_facebook_accounts=v_facebook, browser_run_limits_revision=browser_run_limits_revision+1
    WHERE id=p_staff_id RETURNING * INTO v_staff;
  END IF;
  RETURN jsonb_build_object('ok',true,'settings',jsonb_build_object(
    'zaloWebMax',v_staff.max_running_zalo_web_accounts,'facebookMax',v_staff.max_running_facebook_accounts,
    'revision',v_staff.browser_run_limits_revision));
END;
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_browser_run_limits(bigint,bigint,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_browser_run_limits(bigint,bigint,text,text,text,jsonb) TO postgres,anon,authenticated,service_role;
DO $postflight$
DECLARE r jsonb; p record;
BEGIN
  FOR r IN SELECT value FROM jsonb_array_elements($targets$[{"owner":"postgres","proacl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}","checksum":"79f9f689e1e87631ca8a704a7ffff9b4","proconfig":["search_path=pg_catalog, public","statement_timeout=10s","lock_timeout=5s"],"prosecdef":true,"signature":"aka_agent_browser_run_limits(bigint,bigint,text,text,text,jsonb)","provolatile":"v"},{"owner":"postgres","proacl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}","checksum":"3e7288046c6d08a25fef71468c8e03c9","proconfig":["search_path=public"],"prosecdef":false,"signature":"aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text)","provolatile":"v"},{"owner":"postgres","proacl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}","checksum":"0fdbb44da58b3ef82bdd85224922c428","proconfig":["search_path=pg_catalog, public"],"prosecdef":false,"signature":"aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)","provolatile":"v"},{"owner":"postgres","proacl":"{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}","checksum":"d629c23b56764f78d0e754bd524727d6","proconfig":["search_path=public"],"prosecdef":false,"signature":"claim_campaign_runtime(bigint,bigint,bigint,text)","provolatile":"v"}]$targets$::jsonb) LOOP
    SELECT md5(pg_get_functiondef(oid)) AS checksum,pg_get_userbyid(proowner) AS owner,
      prosecdef,provolatile::text,to_jsonb(proconfig) AS proconfig,proacl::text
    INTO p FROM pg_proc WHERE oid=to_regprocedure('public.' || (r->>'signature'));
    IF NOT FOUND OR p.checksum IS DISTINCT FROM r->>'checksum'
      OR p.owner IS DISTINCT FROM r->>'owner' OR p.prosecdef IS DISTINCT FROM (r->>'prosecdef')::boolean
      OR p.provolatile IS DISTINCT FROM r->>'provolatile' OR COALESCE(p.proconfig,'null'::jsonb) IS DISTINCT FROM r->'proconfig'
      OR p.proacl IS DISTINCT FROM r->>'proacl' THEN RAISE EXCEPTION 'v340_target_mismatch:%',r->>'signature'; END IF;
  END LOOP;
END;
$postflight$;

-- New columns and RPC signatures are API metadata changes.
NOTIFY pgrst, 'reload schema';
COMMIT;

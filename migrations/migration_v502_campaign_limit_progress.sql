-- V502: read-only facts for the campaign list column "Giới hạn lượt" and the detail tab "Hành động"
-- (WebApp and Desktop).
--
-- Adds TWO new functions only. No table, column, index, policy, existing-function, role/global timeout,
-- pool or connection change.
--   public.aka_agent_control_campaign_limit_progress  (service_role) the reader. The WebApp API (service_role
--     singleton) calls it once per campaign-list refresh for the campaigns on the visible page (<= 101 ids),
--     and once when the "Hành động" tab opens (p_detail = true, exactly one id).
--   public.aka_agent_read_campaign_limit_progress     (aka_agent_desktop) the same reader for the Desktop app
--     with its own token: auto_assert_automation_identity binds the token to p_staff_id
--     (private.aka_agent_assert_request_ownership) and checks that staff's automation username/password, the
--     same identity as the report readers Desktop already calls (V487/V489, V491/V493). No akaChat product ids:
--     Desktop already knows from its login whether the organization is chat-synced (chatSync is false).
--
-- The function returns FACTS, not decisions: campaign limit settings, account/group, daily counters,
-- locks and the timestamps of the counted results inside the rate window. Effective limits
-- (group -> campaign -> default -> package cap) and the per-runtime counting rule stay in the WebApp API
-- (campaignPendingLimits.ts), the same code that feeds "Tại sao CD không chạy?" and the diagnostics.
--
-- Reads, all by existing indexes:
--   auto_campaigns            by primary key (ids of one staff/organization), siblings by (staff_id, last_run_at)
--   auto_account_action_status by (account_id, action_code) / (account_id)
--   auto_campaign_details      by idx_auto_campaign_details_action_rate (account_id, action_code, created_at)
--                              WHERE is_delete = false AND action_code IS NOT NULL
-- Window rows: newest 500 per (account, action) inside the largest configured window (65..1440 minutes).
-- Rows with counts_toward_limit = false are never counted by any runtime and are skipped; the remaining
-- rows are tagged e (explicit true), l (legacy NULL with status thành công/thất bại) or o (legacy NULL,
-- other status: only the SMS/call runtime counts those).
-- p_extra_keys names the extra_settings flags the API needs to decide which actions a campaign runs.
-- Detail mode adds today's results (Vietnam day) per action, status, counted flag and campaign.
-- Never writes; never resets a counter; never enables an action.
-- Rollback: migrations/rollback_v502_campaign_limit_progress.sql
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_control_campaign_limit_progress(bigint,bigint,bigint[],bigint[],text[],boolean)') IS NOT NULL
    OR to_regprocedure('public.aka_agent_read_campaign_limit_progress(bigint,bigint,text,text,bigint[],text[],boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'v502_target_already_exists_do_not_overwrite';
  END IF;
  IF to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL
    OR to_regrole('aka_agent_desktop') IS NULL THEN
    RAISE EXCEPTION 'v502_desktop_identity_missing';
  END IF;
  IF to_regclass('public.auto_campaigns') IS NULL
    OR to_regclass('public.auto_accounts') IS NULL
    OR to_regclass('public.auto_account_groups') IS NULL
    OR to_regclass('public.auto_campaign_actions') IS NULL
    OR to_regclass('public.auto_account_actions') IS NULL
    OR to_regclass('public.auto_account_action_status') IS NULL
    OR to_regclass('public.auto_campaign_details') IS NULL
    OR to_regclass('public.org_organization_product') IS NULL THEN
    RAISE EXCEPTION 'v502_dependency_missing';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaign_details'
      AND column_name IN ('account_id', 'campaign_id', 'action_code', 'status', 'counts_toward_limit', 'created_at', 'is_delete')) <> 7
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_account_action_status'
      AND column_name IN ('account_id', 'action_code', 'count_action_in_day', 'count_date', 'is_disable', 'date_enable',
        'disabled_reason', 'disabled_error_code', 'disabled_at', 'updated_at')) <> 10
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaign_actions'
      AND column_name = 'limit_check_action_codes' AND udt_name = '_text') <> 1 THEN
    RAISE EXCEPTION 'v502_expected_columns_missing';
  END IF;
  -- The rate-window read depends on this partial index; stop instead of planning account-wide scans.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'auto_campaign_details'
      AND indexname = 'idx_auto_campaign_details_action_rate'
  ) THEN
    RAISE EXCEPTION 'v502_action_rate_index_missing';
  END IF;
END
$preflight$;

CREATE FUNCTION public.aka_agent_control_campaign_limit_progress(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_ids bigint[],
  p_chat_product_ids bigint[] DEFAULT '{}'::bigint[],
  p_extra_keys text[] DEFAULT '{}'::text[],
  p_detail boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '8s'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_day date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_day_start timestamptz := ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_result jsonb;
BEGIN
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_campaign_ids IS NULL THEN
    RAISE EXCEPTION 'Missing campaign scope';
  END IF;
  IF cardinality(p_campaign_ids) < 1 OR cardinality(p_campaign_ids) > 101
    OR (coalesce(p_detail, false) AND cardinality(p_campaign_ids) <> 1) THEN
    RAISE EXCEPTION 'Invalid campaign ids';
  END IF;

  WITH camp AS MATERIALIZED (
    SELECT c.id, c.name, c.account_id, c.action_id, c.status, c.schedule, c.original_schedule, c.schedule_type,
      c.schedule_days, c.schedule_week_days, c.schedule_end_date, c.daily_stop_time, c.continue_next_day,
      c.time_sleep_between_2, c.last_run_at,
      CASE WHEN jsonb_typeof(c.extra_settings) = 'object' THEN c.extra_settings ELSE '{}'::jsonb END AS extra,
      coalesce(act.limit_check_action_codes, '{}'::text[]) AS codes,
      a.name AS account_name, a.flatform_type, a.is_zalo_server, a.is_zalo_show_web, a.is_delete AS account_deleted,
      g.id AS group_id, g.name AS group_name, g.organization_id AS group_organization_id,
      g.is_active AS group_active, g.is_delete AS group_deleted,
      CASE WHEN jsonb_typeof(g.settings) = 'object' THEN g.settings ELSE '{}'::jsonb END AS group_settings
    FROM public.auto_campaigns c
    JOIN public.auto_accounts a ON a.id = c.account_id
      AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    LEFT JOIN public.auto_account_groups g ON g.id = a.account_group_id
    LEFT JOIN public.auto_campaign_actions act ON act.id = c.action_id
    WHERE c.id = ANY(p_campaign_ids)
      AND c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
  ), camp_window AS MATERIALIZED (
    -- Largest rate window any setting of this campaign/account group can ask for (default 65, cap 24h).
    SELECT c.id, c.account_id, c.codes,
      least(1440, greatest(65, coalesce((
        SELECT max(CASE WHEN x.t ~ '^[0-9]{1,6}(\.[0-9]+)?$' THEN floor(x.t::numeric)::integer END)
        FROM (
          SELECT c.extra #>> '{actionLimits,rateLimitMinutes}' AS t
          UNION ALL
          SELECT e.value ->> 'rateLimitMinutes'
          FROM jsonb_each(CASE WHEN jsonb_typeof(c.extra #> '{actionLimits,byActionCode}') = 'object'
            THEN c.extra #> '{actionLimits,byActionCode}' ELSE '{}'::jsonb END) e
          WHERE jsonb_typeof(e.value) = 'object'
          UNION ALL
          SELECT e.value ->> 'rateLimitMinutes'
          FROM jsonb_each(CASE WHEN jsonb_typeof(c.group_settings -> 'byActionCode') = 'object'
            THEN c.group_settings -> 'byActionCode' ELSE '{}'::jsonb END) e
          WHERE jsonb_typeof(e.value) = 'object'
        ) x
      ), 65))) AS lookback
    FROM camp c
  ), accounts AS MATERIALIZED (
    SELECT DISTINCT account_id FROM camp
  ), pairs AS MATERIALIZED (
    SELECT w.account_id, btrim(code.code) AS action_code, max(w.lookback) AS lookback
    FROM camp_window w
    CROSS JOIN LATERAL unnest(w.codes) AS code(code)
    WHERE btrim(coalesce(code.code, '')) <> ''
    GROUP BY 1, 2
  ), statuses AS MATERIALIZED (
    SELECT s.account_id, s.action_code, s.count_action_in_day, s.count_date, s.is_disable, s.date_enable,
      s.disabled_reason, s.disabled_error_code, s.disabled_at, s.updated_at
    FROM public.auto_account_action_status s
    WHERE s.account_id IN (SELECT account_id FROM accounts)
      -- List mode: only the actions whose limits are checked; the detail tab also shows tag/alias locks.
      AND (coalesce(p_detail, false) OR EXISTS (
        SELECT 1 FROM pairs p WHERE p.account_id = s.account_id AND p.action_code = s.action_code))
  ), windows AS MATERIALIZED (
    SELECT p.account_id, p.action_code, p.lookback, r.e, r.l, r.o, r.n
    FROM pairs p
    CROSS JOIN LATERAL (
      SELECT
        coalesce(jsonb_agg(t.created_at ORDER BY t.created_at) FILTER (WHERE t.kind = 'e'), '[]'::jsonb) AS e,
        coalesce(jsonb_agg(t.created_at ORDER BY t.created_at) FILTER (WHERE t.kind = 'l'), '[]'::jsonb) AS l,
        coalesce(jsonb_agg(t.created_at ORDER BY t.created_at) FILTER (WHERE t.kind = 'o'), '[]'::jsonb) AS o,
        count(*) AS n
      FROM (
        SELECT d.created_at,
          CASE WHEN d.counts_toward_limit THEN 'e'
            WHEN d.status IN ('thành công', 'thất bại') THEN 'l' ELSE 'o' END AS kind
        FROM public.auto_campaign_details d
        WHERE d.account_id = p.account_id AND d.action_code = p.action_code AND d.is_delete = false
          AND d.created_at >= v_now - make_interval(mins => p.lookback)
          AND d.counts_toward_limit IS NOT FALSE
        ORDER BY d.created_at DESC
        LIMIT 500
      ) t
    ) r
  ), siblings AS MATERIALIZED (
    -- Other campaigns of the same staff that ran today on the same accounts (shared daily counters).
    SELECT o.account_id, o.id, o.name, o.action_id, coalesce(oact.limit_check_action_codes, '{}'::text[]) AS codes
    FROM public.auto_campaigns o
    LEFT JOIN public.auto_campaign_actions oact ON oact.id = o.action_id
    WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.is_delete = false
      AND o.last_run_at >= v_day_start
      AND o.account_id IN (SELECT account_id FROM accounts)
  ), detail_codes AS MATERIALIZED (
    SELECT account_id, action_code FROM pairs WHERE coalesce(p_detail, false)
    UNION
    SELECT s.account_id, s.action_code FROM statuses s
    WHERE coalesce(p_detail, false) AND s.action_code IS NOT NULL
      AND (s.count_date = v_day OR s.updated_at >= v_day_start)
  ), today AS MATERIALIZED (
    SELECT d.account_id, d.action_code, d.campaign_id, d.status, d.counts_toward_limit,
      count(*) AS n, max(d.created_at) AS last_at
    FROM detail_codes p
    JOIN public.auto_campaign_details d ON d.account_id = p.account_id AND d.action_code = p.action_code
      AND d.is_delete = false AND d.created_at >= v_day_start
    GROUP BY 1, 2, 3, 4, 5
  )
  SELECT jsonb_build_object(
    'now', v_now,
    'vietnamDate', v_day,
    'dayStartsAt', v_day_start,
    'nextDayStartsAt', v_day_start + interval '1 day',
    'chatSync', EXISTS (
      SELECT 1 FROM public.org_organization_product p
      WHERE p.organization_id = p_organization_id AND p.product_id = ANY(coalesce(p_chat_product_ids, '{}'::bigint[]))
        AND p.is_chat_sync = true AND coalesce(p.is_deleted, false) = false
        AND p.expiration_date >= v_day_start
    ),
    'campaigns', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'accountId', c.account_id, 'actionId', c.action_id, 'status', c.status,
        'schedule', c.schedule, 'originalSchedule', c.original_schedule, 'scheduleType', c.schedule_type,
        'scheduleDays', c.schedule_days, 'scheduleWeekDays', c.schedule_week_days,
        'scheduleEndDate', c.schedule_end_date, 'dailyStopTime', c.daily_stop_time,
        'continueNextDay', c.continue_next_day, 'timeSleepBetween2', c.time_sleep_between_2,
        'lastRunAt', c.last_run_at,
        -- Only the limit block and the setting keys the API asks for (flags that decide which actions run):
        -- content, media and the other ~170 settings stay in the DB.
        'extra', (
          SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) FROM jsonb_each(c.extra) e
          WHERE e.key = 'actionLimits' OR (e.key = ANY(coalesce(p_extra_keys, '{}'::text[]))
            AND (jsonb_typeof(e.value) IN ('boolean', 'number', 'null')
              OR (jsonb_typeof(e.value) = 'string' AND length(e.value #>> '{}') <= 120)))
        ),
        'limitCheckActionCodes', to_jsonb(c.codes),
        'account', jsonb_build_object(
          'id', c.account_id, 'name', c.account_name, 'flatform_type', c.flatform_type,
          'is_zalo_server', c.is_zalo_server, 'is_zalo_show_web', c.is_zalo_show_web, 'is_delete', c.account_deleted
        ),
        'group', CASE WHEN c.group_id IS NULL THEN NULL ELSE jsonb_build_object(
          'name', c.group_name, 'organization_id', c.group_organization_id, 'is_active', c.group_active,
          'is_delete', c.group_deleted, 'settings', jsonb_build_object('byActionCode',
            CASE WHEN jsonb_typeof(c.group_settings -> 'byActionCode') = 'object'
              THEN c.group_settings -> 'byActionCode' ELSE '{}'::jsonb END)
        ) END
      ) ORDER BY c.id) FROM camp c
    ), '[]'::jsonb),
    'statuses', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'accountId', s.account_id, 'actionCode', s.action_code, 'countActionInDay', s.count_action_in_day,
        'countDate', s.count_date, 'isDisable', s.is_disable, 'dateEnable', s.date_enable,
        'disabledReason', s.disabled_reason, 'disabledErrorCode', s.disabled_error_code,
        'disabledAt', s.disabled_at, 'updatedAt', s.updated_at
      )) FROM statuses s
    ), '[]'::jsonb),
    'windows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'accountId', w.account_id, 'actionCode', w.action_code, 'lookbackMinutes', w.lookback,
        'e', w.e, 'l', w.l, 'o', w.o, 'truncated', w.n >= 500
      )) FROM windows w
    ), '[]'::jsonb),
    'siblings', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'accountId', s.account_id, 'campaignId', s.id, 'name', s.name, 'actionId', s.action_id,
        'limitCheckActionCodes', to_jsonb(s.codes)
      ) ORDER BY s.account_id, s.id) FROM siblings s
    ), '[]'::jsonb),
    'actionNames', coalesce((
      SELECT jsonb_agg(jsonb_build_object('platform', n.flatform_type, 'code', n.code, 'name', n.name))
      FROM public.auto_account_actions n
      WHERE n.is_active = true AND n.is_delete = false
        AND n.flatform_type IN (SELECT DISTINCT flatform_type FROM camp)
    ), '[]'::jsonb),
    'today', CASE WHEN coalesce(p_detail, false) THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'accountId', t.account_id, 'actionCode', t.action_code, 'campaignId', t.campaign_id,
        -- Names of other campaigns are returned only inside the caller's own staff/organization.
        'campaignName', (SELECT oc.name FROM public.auto_campaigns oc
          WHERE oc.id = t.campaign_id AND oc.staff_id = p_staff_id AND oc.organization_id = p_organization_id),
        'status', t.status, 'countsTowardLimit', t.counts_toward_limit, 'count', t.n, 'lastAt', t.last_at
      )) FROM today t
    ), '[]'::jsonb) ELSE NULL END
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.aka_agent_control_campaign_limit_progress(bigint,bigint,bigint[],bigint[],text[],boolean) OWNER TO postgres;
-- Default ACL in public grants EXECUTE to anon/authenticated: revoke them directly.
REVOKE ALL ON FUNCTION public.aka_agent_control_campaign_limit_progress(bigint,bigint,bigint[],bigint[],text[],boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_campaign_limit_progress(bigint,bigint,bigint[],bigint[],text[],boolean) TO service_role;
COMMENT ON FUNCTION public.aka_agent_control_campaign_limit_progress(bigint,bigint,bigint[],bigint[],text[],boolean) IS
  'V502 read-only facts for the WebApp campaign list "Giới hạn lượt" column and the "Hành động" tab: limit settings, account group, daily counters, locks, counted result timestamps inside the rate window and (detail) today''s results. service_role only; 8s per call; never writes.';

-- Desktop entry point. SECURITY DEFINER so the reader runs as its owner; the token check happens first.
CREATE FUNCTION public.aka_agent_read_campaign_limit_progress(
  p_staff_id bigint,
  p_organization_id bigint,
  p_auth_username text,
  p_auth_password text,
  p_campaign_ids bigint[],
  p_extra_keys text[] DEFAULT '{}'::text[],
  p_detail boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '8s'
AS $function$
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  RETURN public.aka_agent_control_campaign_limit_progress(
    p_staff_id, p_organization_id, p_campaign_ids, '{}'::bigint[], p_extra_keys, p_detail);
END;
$function$;
ALTER FUNCTION public.aka_agent_read_campaign_limit_progress(bigint,bigint,text,text,bigint[],text[],boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_read_campaign_limit_progress(bigint,bigint,text,text,bigint[],text[],boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_campaign_limit_progress(bigint,bigint,text,text,bigint[],text[],boolean) TO aka_agent_desktop;
COMMENT ON FUNCTION public.aka_agent_read_campaign_limit_progress(bigint,bigint,text,text,bigint[],text[],boolean) IS
  'V502 Desktop entry to aka_agent_control_campaign_limit_progress: Desktop token bound to p_staff_id plus automation credentials (auto_assert_automation_identity). aka_agent_desktop only; 8s per call; never writes.';

DO $postflight$
DECLARE v_acl text;
BEGIN
  SELECT proacl::text INTO v_acl FROM pg_proc
    WHERE oid = to_regprocedure('public.aka_agent_control_campaign_limit_progress(bigint,bigint,bigint[],bigint[],text[],boolean)');
  IF (SELECT array_agg(g ORDER BY g) FROM (
        SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
        FROM pg_proc pr, aclexplode(pr.proacl) a
        WHERE pr.oid = to_regprocedure('public.aka_agent_control_campaign_limit_progress(bigint,bigint,bigint[],bigint[],text[],boolean)')) x)
     IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v502_reader_acl_unexpected: %', v_acl;
  END IF;
  SELECT proacl::text INTO v_acl FROM pg_proc
    WHERE oid = to_regprocedure('public.aka_agent_read_campaign_limit_progress(bigint,bigint,text,text,bigint[],text[],boolean)');
  IF (SELECT array_agg(g ORDER BY g) FROM (
        SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
        FROM pg_proc pr, aclexplode(pr.proacl) a
        WHERE pr.oid = to_regprocedure('public.aka_agent_read_campaign_limit_progress(bigint,bigint,text,text,bigint[],text[],boolean)')) x)
     IS DISTINCT FROM ARRAY['aka_agent_desktop', 'postgres'] THEN
    RAISE EXCEPTION 'v502_desktop_acl_unexpected: %', v_acl;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure('public.aka_agent_read_campaign_limit_progress(bigint,bigint,text,text,bigint[],text[],boolean)')
      AND prosecdef AND provolatile = 's' AND pg_get_userbyid(proowner) = 'postgres'
      AND proconfig = ARRAY['search_path=pg_catalog, public', 'statement_timeout=8s']
  ) THEN
    RAISE EXCEPTION 'v502_desktop_attributes_unexpected';
  END IF;
END
$postflight$;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- V487: read-only aggregate for the WebApp campaign detail "Báo cáo" tab (one campaign).
--
-- Adds ONE new function only. No table, column, index, policy, existing-function, role/global
-- timeout, pool or connection change. Every read is scoped by campaign_id and uses existing
-- indexes: idx_campaign_input_data_progress_live (campaign_id, status) WHERE is_delete = false and
-- idx_campaign_details_page (campaign_id, created_at, id) WHERE is_delete = false.
-- Same identity chain as V462: service_role (WebApp backend singleton, credentials NULL) passes
-- public.auto_assert_automation_identity; no other role is granted EXECUTE.
-- Counts use exactly the filters of the existing readers so the tab matches them:
--   inputs  = aka_agent_control_campaign_progress / Data ban đầu (campaign_id, is_delete = false)
--   results = aka_agent_list_campaign_details_page_v2 / Kết quả chạy (campaign_id, is_delete = false)
-- Engagement marks are read, never written; execution status is never changed.
-- Rollback: migrations/rollback_v487_campaign_run_report.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'v487_target_already_exists_do_not_overwrite';
  END IF;
  IF to_regclass('public.auto_campaigns') IS NULL
    OR to_regclass('public.auto_campaign_details') IS NULL
    OR to_regclass('public.auto_campaign_input_data') IS NULL
    OR to_regclass('public.auto_campaign_detail_zalo_engagement') IS NULL
    OR to_regclass('public.auto_status') IS NULL
    OR to_regclass('public.org_staff') IS NULL
    OR to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL THEN
    RAISE EXCEPTION 'v487_dependency_missing';
  END IF;
  -- V361 result columns read by this report.
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaign_details'
      AND column_name IN ('report_group', 'status_id', 'sub_status_id', 'action_code', 'action_name', 'input_data_id')) <> 6
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_status'
      AND column_name IN ('code', 'name', 'status_value')) <> 3 THEN
    RAISE EXCEPTION 'v487_expected_columns_missing';
  END IF;
  -- The campaign-scoped indexes drive every read; stop instead of planning full scans.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_campaign_details_page')
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_campaign_input_data_progress_live') THEN
    RAISE EXCEPTION 'v487_expected_index_missing';
  END IF;
END
$preflight$;

CREATE FUNCTION public.aka_agent_read_campaign_run_report(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text,
  p_campaign_id bigint, p_query jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_tz constant text := 'Asia/Ho_Chi_Minh';
  -- Same engagement actions as V462 (exclusive message stages; friend acceptance).
  v_message constant text[] := ARRAY['zalo_message_friend', 'zalo_message_stranger'];
  v_friend constant text := 'zalo_add_friend';
  v_campaign record;
  v_success text[];
  v_skipped text[];
  v_failure text[];
  v_aux text[];
  v_not_found text[];
  v_not_found_codes text[];
  v_total bigint;
  v_first timestamptz;
  v_last timestamptz;
  v_unit text;
  v_inputs jsonb;
  v_main jsonb;
BEGIN
  -- Desktop token must belong to p_staff_id and carry the automation credentials; service_role passes.
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_staff WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN RAISE EXCEPTION 'report_access_denied' USING ERRCODE = '42501'; END IF;

  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_query IS NULL OR jsonb_typeof(p_query) IS DISTINCT FROM 'object'
    OR (p_query ? 'legacy' AND jsonb_typeof(p_query->'legacy') IS DISTINCT FROM 'object')
    OR (p_query ? 'auxiliaryActionCodes' AND (jsonb_typeof(p_query->'auxiliaryActionCodes') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_query->'auxiliaryActionCodes') > 50))
    OR (p_query ? 'notFoundStatuses' AND (jsonb_typeof(p_query->'notFoundStatuses') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_query->'notFoundStatuses') > 20))
    OR (p_query ? 'notFoundStatusCodes' AND (jsonb_typeof(p_query->'notFoundStatusCodes') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_query->'notFoundStatusCodes') > 20)) THEN
    RAISE EXCEPTION 'invalid_report_query' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT coalesce(array_agg(value), '{}') INTO v_success FROM jsonb_array_elements_text(coalesce(p_query#>'{legacy,success}', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_skipped FROM jsonb_array_elements_text(coalesce(p_query#>'{legacy,skipped}', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_failure FROM jsonb_array_elements_text(coalesce(p_query#>'{legacy,failure}', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_aux FROM jsonb_array_elements_text(coalesce(p_query->'auxiliaryActionCodes', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_not_found FROM jsonb_array_elements_text(coalesce(p_query->'notFoundStatuses', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_not_found_codes FROM jsonb_array_elements_text(coalesce(p_query->'notFoundStatusCodes', '[]'));
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invalid_report_query' USING ERRCODE = '22023';
  END;

  SELECT c.id, c.status, c.created_at INTO v_campaign
  FROM public.auto_campaigns c
  WHERE c.id = p_campaign_id AND c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_report_not_found' USING ERRCODE = 'P0002'; END IF;

  -- Data ban đầu by status (index-only on idx_campaign_input_data_progress_live).
  SELECT coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n) ORDER BY s.status), '[]'::jsonb)
    INTO v_inputs
  FROM (
    SELECT coalesce(i.status, '') AS status, count(*) AS n
    FROM public.auto_campaign_input_data i
    WHERE i.campaign_id = p_campaign_id AND i.is_delete = false
    GROUP BY 1
  ) s;

  -- Span of the results (idx_campaign_details_page) picks the timeline unit: hour ≤ 48 h, day ≤ 180 days, else week.
  SELECT count(*), min(d.created_at), max(d.created_at) INTO v_total, v_first, v_last
  FROM public.auto_campaign_details d
  WHERE d.campaign_id = p_campaign_id AND d.is_delete = false;
  v_unit := CASE
    WHEN v_first IS NULL OR v_last - v_first > interval '180 days' THEN CASE WHEN v_first IS NULL THEN 'day' ELSE 'week' END
    WHEN v_last - v_first <= interval '48 hours' THEN 'hour'
    ELSE 'day' END;

  -- One statement: the campaign's results are read once (materialized) and aggregated four ways.
  WITH d AS MATERIALIZED (
    SELECT d.id, d.input_data_id, d.action_code, d.action_name, d.status, d.status_id, d.sub_status_id, d.created_at,
      -- Stored report_group wins; legacy NULL rows keep the existing text mapping; anything else is "other".
      CASE
        WHEN d.report_group IN ('success', 'failure', 'skipped', 'pending') THEN d.report_group
        WHEN d.report_group IS NULL AND d.status = ANY(v_success) THEN 'success'
        WHEN d.report_group IS NULL AND d.status = ANY(v_skipped) THEN 'skipped'
        WHEN d.report_group IS NULL AND d.status = ANY(v_failure) THEN 'failure'
        ELSE 'other'
      END AS grp,
      coalesce(d.action_code = ANY(v_aux), false) AS aux,
      (d.status = ANY(v_not_found) OR coalesce(st.code = ANY(v_not_found_codes), false)) AS not_found
    FROM public.auto_campaign_details d
    LEFT JOIN public.auto_status st ON st.id = d.status_id
    WHERE d.campaign_id = p_campaign_id AND d.is_delete = false
  ),
  per_input AS (
    SELECT i.id, coalesce(i.status, '') AS status, count(d.id) AS n,
      bool_or(NOT d.aux) AS has_main,
      bool_or(d.grp = 'success' AND NOT d.aux) AS main_success, bool_or(d.grp = 'success' AND d.aux) AS aux_success,
      bool_or(d.grp = 'failure' AND NOT d.aux) AS main_failure, bool_or(d.grp = 'failure' AND d.aux) AS aux_failure,
      bool_or(d.grp = 'skipped' AND NOT d.aux) AS main_skipped, bool_or(d.grp = 'skipped' AND d.aux) AS aux_skipped,
      bool_or(d.grp = 'pending' AND NOT d.aux) AS main_pending, bool_or(d.grp = 'pending' AND d.aux) AS aux_pending,
      bool_or(d.grp = 'failure' AND d.not_found AND NOT d.aux) AS main_not_found,
      bool_or(d.grp = 'failure' AND d.not_found AND d.aux) AS aux_not_found
    FROM public.auto_campaign_input_data i
    LEFT JOIN d ON d.input_data_id = i.id
    WHERE i.campaign_id = p_campaign_id AND i.is_delete = false
    GROUP BY i.id, coalesce(i.status, '')
  ),
  outcome AS (
    -- Main actions decide; auxiliary ones (phone lookup, tag, alias) only when no main action ran.
    -- Order: success → failure → skipped → pending → none → other.
    SELECT p.status,
      CASE
        WHEN p.n = 0 THEN 'none'
        WHEN CASE WHEN p.has_main THEN p.main_success ELSE p.aux_success END THEN 'success'
        WHEN CASE WHEN p.has_main THEN p.main_failure ELSE p.aux_failure END THEN 'failure'
        WHEN CASE WHEN p.has_main THEN p.main_skipped ELSE p.aux_skipped END THEN 'skipped'
        WHEN CASE WHEN p.has_main THEN p.main_pending ELSE p.aux_pending END THEN 'pending'
        ELSE 'other'
      END AS outcome,
      coalesce(CASE WHEN p.has_main THEN p.main_not_found ELSE p.aux_not_found END, false) AS not_found
    FROM per_input p
  )
  SELECT jsonb_build_object(
    'results', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
          'actionCode', g.action_code, 'actionName', g.action_name, 'statusId', g.status_id, 'legacyStatus', g.legacy_status,
          'subStatusId', g.sub_status_id, 'group', g.grp, 'count', g.n, 'sampleStatus', g.sample_status)
          ORDER BY g.action_code NULLS LAST, g.grp, g.status_id NULLS LAST, g.legacy_status NULLS LAST, g.sub_status_id NULLS FIRST), '[]'::jsonb)
      FROM (
        SELECT d.action_code, max(d.action_name) AS action_name, d.status_id,
          CASE WHEN d.status_id IS NULL THEN d.status END AS legacy_status, d.sub_status_id, d.grp,
          count(*) AS n, min(d.status) AS sample_status
        FROM d
        GROUP BY d.action_code, d.status_id, CASE WHEN d.status_id IS NULL THEN d.status END, d.sub_status_id, d.grp
      ) g),
    'timeline', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
          'at', to_char(t.bucket, CASE WHEN v_unit = 'hour' THEN 'YYYY-MM-DD"T"HH24:00' ELSE 'YYYY-MM-DD' END),
          'group', t.grp, 'count', t.n) ORDER BY t.bucket, t.grp), '[]'::jsonb)
      FROM (SELECT date_trunc(v_unit, d.created_at AT TIME ZONE v_tz) AS bucket, d.grp, count(*) AS n FROM d GROUP BY 1, 2) t),
    'inputOutcomes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('status', o.status, 'outcome', o.outcome, 'notFound', o.not_found, 'count', o.n)
          ORDER BY o.status, o.outcome, o.not_found), '[]'::jsonb)
      FROM (SELECT status, outcome, not_found, count(*) AS n FROM outcome GROUP BY 1, 2, 3) o),
    'engagement', (
      SELECT jsonb_build_object(
        'messageSent', count(*) FILTER (WHERE d.action_code = ANY(v_message)),
        'messageTracked', count(e.campaign_detail_id) FILTER (WHERE d.action_code = ANY(v_message)),
        'responded', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND e.responded_at IS NOT NULL),
        'reacted', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND e.responded_at IS NULL AND e.reacted_at IS NOT NULL),
        'seen', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND e.responded_at IS NULL AND e.reacted_at IS NULL
          AND e.seen_at IS NOT NULL),
        'friendRequested', count(*) FILTER (WHERE d.action_code = v_friend),
        'friendTracked', count(e.campaign_detail_id) FILTER (WHERE d.action_code = v_friend),
        'friended', count(*) FILTER (WHERE d.action_code = v_friend AND e.friended_at IS NOT NULL))
      FROM d
      LEFT JOIN public.auto_campaign_detail_zalo_engagement e ON e.campaign_detail_id = d.id
      WHERE d.grp = 'success' AND (d.action_code = ANY(v_message) OR d.action_code = v_friend)),
    'statuses', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'statusValue', s.status_value)
          ORDER BY s.id), '[]'::jsonb)
      FROM public.auto_status s
      WHERE s.id IN (SELECT d.status_id FROM d WHERE d.status_id IS NOT NULL
        UNION SELECT d.sub_status_id FROM d WHERE d.sub_status_id IS NOT NULL))
  ) INTO v_main;

  RETURN jsonb_build_object(
    'dbNow', now(),
    'campaign', jsonb_build_object('id', v_campaign.id, 'status', v_campaign.status, 'createdAt', v_campaign.created_at),
    'inputs', v_inputs,
    'results', jsonb_build_object('total', v_total, 'firstAt', v_first, 'lastAt', v_last, 'groups', v_main->'results'),
    'timeline', jsonb_build_object('unit', v_unit, 'points', v_main->'timeline'),
    'inputOutcomes', v_main->'inputOutcomes',
    'engagement', v_main->'engagement',
    'statuses', v_main->'statuses'
  );
END;
$function$;
ALTER FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) OWNER TO postgres;
-- Default ACL in public grants EXECUTE to anon/authenticated: revoke them directly.
REVOKE ALL ON FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) TO service_role;
COMMENT ON FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) IS
  'V487 read-only aggregate of one campaign for the WebApp "Báo cáo" tab: inputs by status, per-input outcome, results by action/status/sub-status/group, timeline (hour/day/week, Vietnam time) and Zalo engagement. service_role only; 20s per call; never writes.';

DO $postflight$
DECLARE v_acl text;
BEGIN
  SELECT proacl::text INTO v_acl FROM pg_proc
    WHERE oid = to_regprocedure('public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb)');
  IF (SELECT array_agg(g ORDER BY g) FROM (
        SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
        FROM pg_proc pr, aclexplode(pr.proacl) a
        WHERE pr.oid = to_regprocedure('public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb)')) x)
     IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v487_reader_acl_unexpected: %', v_acl;
  END IF;
END
$postflight$;
NOTIFY pgrst, 'reload schema';
COMMIT;

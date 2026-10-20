-- V415: retain Web campaign list and history after account soft-delete.
-- Captured live 2026-10-20; only the account deletion predicate changes.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $preflight$
DECLARE f oid:=to_regprocedure('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])');
BEGIN
 IF f IS NULL OR md5(pg_get_functiondef(f)) NOT IN ('bd7caeef73e9675f36dd9851498c11e6','e081e2adaa53652506e9628e851aa604') THEN RAISE EXCEPTION 'V415: RPC drift for aka_agent_control_campaign_page'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=f AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=public, pg_temp','statement_timeout=20s'] AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'V415: RPC attributes/ACL drift'; END IF;
END;
$preflight$;
DO $preflight$
DECLARE f oid:=to_regprocedure('public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)');
BEGIN
 IF f IS NULL OR md5(pg_get_functiondef(f)) NOT IN ('3bafa54ccba53cb9788a32ab754ab7da','1275ad05d4dd184f5f6d9cd937caa21c') THEN RAISE EXCEPTION 'V415: RPC drift for aka_agent_control_campaign_logs'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=f AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=pg_catalog, public','statement_timeout=15s'] AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'V415: RPC attributes/ACL drift'; END IF;
END;
$preflight$;
CREATE OR REPLACE FUNCTION public.aka_agent_control_campaign_page(p_staff_id bigint, p_organization_id bigint, p_platforms text[], p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_drafts jsonb DEFAULT '[]'::jsonb, p_selected_id bigint DEFAULT NULL::bigint, p_selection boolean DEFAULT false, p_after_id bigint DEFAULT 0, p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_result jsonb;
  v_search text := lower(translate(regexp_replace(normalize(coalesce(p_filters->>'search', ''), NFD), U&'[\0300-\036f]', '', 'g'), 'Đđ', 'Dd'));
BEGIN
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_platforms IS NULL THEN
    RAISE EXCEPTION 'Missing campaign scope';
  END IF;
  IF p_page < 1 OR p_page > 100000 OR jsonb_array_length(p_drafts) > 10000 THEN
    RAISE EXCEPTION 'Invalid campaign page';
  END IF;

  -- Materialize only narrow sort/filter keys. Content, log, images and settings
  -- are never read. Null filters and explicit empty arrays remain distinct.
  WITH scoped AS NOT MATERIALIZED (
    SELECT c.id, c.status, c.name, c.account_id, c.action_id, a.flatform_type,
      coalesce(c.schedule, c.original_schedule, '1970-01-01Z'::timestamptz) AS send_time,
      CASE WHEN c.status IN ('tạm dừng', 'hoàn thành') THEN coalesce(c.last_run_at, c.schedule, c.original_schedule, '1970-01-01Z'::timestamptz)
        ELSE coalesce(c.schedule, c.original_schedule, '1970-01-01Z'::timestamptz) END AS sort_time,
      CASE c.status WHEN 'đang chạy' THEN 0 WHEN 'chờ xử lý' THEN 1 WHEN 'tạm dừng' THEN 2 WHEN 'hoàn thành' THEN 3 ELSE 99 END AS rank
    FROM public.auto_campaigns c
    JOIN public.auto_accounts a ON a.id = c.account_id
      AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
      AND a.flatform_type = ANY(p_platforms)
      AND (a.flatform_type = 'sms' OR (a.flatform_type = 'zalo' AND a.is_zalo_show_web = false AND a.is_zalo_server = true))
  ), filtered AS NOT MATERIALIZED (
    SELECT id, status, rank, sort_time FROM scoped s
    WHERE (NOT p_filters ? 'platforms' OR p_filters->'platforms' ? s.flatform_type)
      AND (NOT p_filters ? 'statuses' OR p_filters->'statuses' ? s.status)
      AND (NOT p_filters ? 'actionIds' OR p_filters->'actionIds' ? s.action_id)
      AND (NOT p_filters ? 'accountIds' OR p_filters->'accountIds' @> to_jsonb(s.account_id))
      AND (p_filters->>'dateFrom' IS NULL OR s.send_time >= ((p_filters->>'dateFrom')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
      AND (p_filters->>'dateTo' IS NULL OR s.send_time < (((p_filters->>'dateTo')::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
      AND (btrim(v_search) = '' OR strpos(lower(translate(regexp_replace(normalize(coalesce(s.name, ''), NFD), U&'[\0300-\036f]', '', 'g'), 'Đđ', 'Dd')), btrim(v_search)) > 0)
      AND (p_ids IS NULL OR s.id = ANY(p_ids))
  ), selections AS (
    SELECT id, status FROM filtered WHERE p_selection AND id > p_after_id ORDER BY id LIMIT 500
  ), combined AS MATERIALIZED (
    SELECT 'campaign'::text AS kind, id::text AS key, id, rank, sort_time FROM filtered WHERE NOT p_selection
    UNION ALL
    -- Draft anchors are untrusted layout hints only. They never read or grant
    -- access to a draft; actual drafts remain under their authenticated API.
    SELECT 'draft', value->>'id', NULL::bigint, 1, (value->>'schedule')::timestamptz
    FROM jsonb_array_elements(p_drafts) WHERE NOT p_selection
  ), totals AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE kind = 'campaign') AS campaign_total FROM combined
  ), bounds AS (
    SELECT *, least(p_page, greatest(1, ceil(total / 100.0)::integer)) AS page FROM totals
  ), page_keys AS MATERIALIZED (
    SELECT * FROM combined
    ORDER BY rank, sort_time DESC, kind, id DESC, key DESC
    LIMIT 100 OFFSET (SELECT (page - 1) * 100 FROM bounds)
  ), summaries AS MATERIALIZED (
    SELECT c.id, c.name, c.action_id AS "actionId", act.name AS "actionName",
      a.flatform_type AS platform, (a.flatform_type = 'zalo' AND a.is_zalo_show_web = false AND a.is_zalo_server = true) AS "isZaloServer",
      c.account_id AS "accountId", a.name AS "accountName", c.status,
      CASE WHEN c.data_target_source_mode = 'data_group' THEN 'data_group' ELSE 'direct' END AS "dataTargetSourceMode",
      c.schedule, c.original_schedule AS "originalSchedule", c.schedule_type AS "scheduleType",
      c.note, c.last_run_at AS "lastRunAt", c.created_at AS "createdAt", c.updated_at AS "updatedAt",
      0 AS "inputTotal", 0 AS "inputCompleted", 0 AS "inputFailed"
    FROM public.auto_campaigns c
    JOIN public.auto_accounts a ON a.id = c.account_id
    LEFT JOIN public.auto_campaign_actions act ON act.id = c.action_id
    WHERE NOT p_selection AND c.id IN (
      SELECT id FROM page_keys WHERE kind = 'campaign'
      UNION SELECT id FROM scoped WHERE id = p_selected_id
    )
  )
  SELECT CASE WHEN p_selection THEN jsonb_build_object('items', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM selections s), '[]'))
    ELSE jsonb_build_object(
      'items', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM summaries s JOIN page_keys k ON k.id = s.id), '[]'),
      'selected', (SELECT to_jsonb(s) FROM summaries s WHERE s.id = p_selected_id),
      'order', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'id', key) ORDER BY rank, sort_time DESC, kind, id DESC, key DESC) FROM page_keys), '[]'),
      'total', b.total, 'campaignTotal', b.campaign_total, 'page', b.page, 'pageSize', 100
    ) END INTO v_result FROM bounds b;
  RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.aka_agent_control_campaign_logs(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_platforms text[], p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id=c.account_id
  WHERE c.id=p_campaign_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.is_delete=false
   AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id
   AND a.flatform_type=ANY(p_platforms)
   AND (a.flatform_type<>'zalo' OR (a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))
 ) THEN RETURN NULL; END IF;
 RETURN private.campaign_log_page(p_campaign_id,p_options);
END $function$;
DO $postflight$
BEGIN
 IF md5(pg_get_functiondef('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'::regprocedure))<>'e081e2adaa53652506e9628e851aa604' THEN RAISE EXCEPTION 'V415: RPC checksum mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'::regprocedure AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=public, pg_temp','statement_timeout=20s'] AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'V415: RPC attributes/ACL changed'; END IF;
END;
$postflight$;
DO $postflight$
BEGIN
 IF md5(pg_get_functiondef('public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)'::regprocedure))<>'1275ad05d4dd184f5f6d9cd937caa21c' THEN RAISE EXCEPTION 'V415: RPC checksum mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)'::regprocedure AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=pg_catalog, public','statement_timeout=15s'] AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'V415: RPC attributes/ACL changed'; END IF;
END;
$postflight$;
COMMIT;

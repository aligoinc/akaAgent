-- Guarded rollback. Export the organization preferences before intentionally discarding them.
BEGIN;
DO $rollback_guard$
BEGIN
  IF to_regprocedure('aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])') IS NULL OR md5(pg_get_functiondef(to_regprocedure('aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'))) <> '3a16a880e5906c7d4a55b19f8b4c13c7' THEN RAISE EXCEPTION 'V423 rollback refused: function drift: aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'; END IF;
  IF to_regprocedure('private.aka_agent_campaign_visibility_snapshot(bigint,bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.aka_agent_campaign_visibility_snapshot(bigint,bigint)'))) <> 'fd44617ea1d6c9fd9186e6090d796bb7' THEN RAISE EXCEPTION 'V423 rollback refused: function drift: private.aka_agent_campaign_visibility_snapshot(bigint,bigint)'; END IF;
  IF to_regprocedure('private.aka_agent_campaign_visibility_actions(jsonb,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.aka_agent_campaign_visibility_actions(jsonb,text)'))) <> '6960198a9816d8e3cce62dae28568b5a' THEN RAISE EXCEPTION 'V423 rollback refused: function drift: private.aka_agent_campaign_visibility_actions(jsonb,text)'; END IF;
  IF to_regprocedure('private.aka_agent_campaign_type_visibility(bigint,bigint,jsonb,text,text,jsonb,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.aka_agent_campaign_type_visibility(bigint,bigint,jsonb,text,text,jsonb,boolean)'))) <> '9d00adbc6d496c67155cf4f92aaca063' THEN RAISE EXCEPTION 'V423 rollback refused: function drift: private.aka_agent_campaign_type_visibility(bigint,bigint,jsonb,text,text,jsonb,boolean)'; END IF;
  IF to_regprocedure('aka_agent_campaign_type_visibility(bigint,bigint,text,text,jsonb,text,jsonb,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('aka_agent_campaign_type_visibility(bigint,bigint,text,text,jsonb,text,jsonb,boolean)'))) <> 'a00e37f313f156db71971e29aaf25e3e' THEN RAISE EXCEPTION 'V423 rollback refused: function drift: aka_agent_campaign_type_visibility(bigint,bigint,text,text,jsonb,text,jsonb,boolean)'; END IF;
  IF to_regprocedure('aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean)'))) <> '38cef8f7febb9b4e2147a0b9b99c2898' THEN RAISE EXCEPTION 'V423 rollback refused: function drift: aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean)'; END IF;
  IF to_regprocedure('aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])') IS NULL OR md5(pg_get_functiondef(to_regprocedure('aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'))) <> '12d454fbc38217dea3497addd39ed832' THEN RAISE EXCEPTION 'V423 rollback refused: function drift: aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'; END IF;
END;
$rollback_guard$;
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
CREATE OR REPLACE FUNCTION public.aka_agent_desktop_campaign_page(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_access jsonb, p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_drafts jsonb DEFAULT '[]'::jsonb, p_selected_id bigint DEFAULT NULL::bigint, p_selection boolean DEFAULT false, p_after_id bigint DEFAULT 0, p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_result jsonb;
  v_search text := lower(translate(regexp_replace(normalize(coalesce(p_filters->>'search', ''), NFD), U&'[\0300-\036f]', '', 'g'), 'Đđ', 'Dd'));
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_access IS NULL THEN
    RAISE EXCEPTION 'Missing campaign scope';
  END IF;
  IF p_page < 1 OR p_page > 100000 OR jsonb_array_length(p_drafts) > 10000 OR coalesce(cardinality(p_ids),0) > 500 THEN
    RAISE EXCEPTION 'Invalid campaign page';
  END IF;

  -- Materialize only narrow sort/filter keys. Content, log, images and settings
  -- are never read. Null filters and explicit empty arrays remain distinct.
  WITH scoped AS NOT MATERIALIZED (
    SELECT c.id, c.status, c.name, c.account_id, c.secondary_account_id, c.action_id, a.flatform_type, ca.name AS action_name, coalesce(CASE WHEN ca.is_active=true AND ca.is_delete=false THEN nullif(lower(btrim(ca.flatform_type)),'') END,lower(btrim(a.flatform_type))) AS filter_platform, c.schedule AS filter_time,
      c.schedule AS send_time,
      CASE WHEN c.status IN ('tạm dừng', 'hoàn thành') THEN coalesce(c.last_run_at, c.schedule)
        ELSE c.schedule END AS sort_time,
      CASE c.status WHEN 'đang chạy' THEN 0 WHEN 'chờ xử lý' THEN 1 WHEN 'tạm dừng' THEN 2 WHEN 'hoàn thành' THEN 3 ELSE 99 END AS rank
    FROM public.auto_campaigns c
    LEFT JOIN public.auto_campaign_actions ca ON ca.id=c.action_id
    JOIN public.auto_accounts a ON a.id = c.account_id
      AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
      AND coalesce((p_access->>CASE
        WHEN c.action_id IN ('sms_send','voice_call') THEN 'sms'
        WHEN c.action_id='email_send' THEN 'email'
        WHEN c.action_id = ANY(ARRAY['zalo_message_phone','zalo_message_friend','zalo_message_birthday','zalo_message_group_member','zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation','zalo_message_group','zalo_add_group_member','zalo_join_group_link','zalo_cancel_sent_friend_request']) THEN 'zalo'
        WHEN c.action_id IN ('facebook_page_post','facebook_page_to_message') THEN 'facebookFanpage'
        ELSE 'facebookCore' END)::boolean,false)
      AND (a.flatform_type<>'zalo' OR coalesce((p_access->>CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'qr' END)::boolean,false))
  ), filtered AS NOT MATERIALIZED (
    SELECT id, status, rank, sort_time FROM scoped s
    WHERE (NOT p_filters ? 'platforms' OR p_filters->'platforms' ? CASE WHEN s.filter_platform LIKE '%facebook%' OR s.filter_platform='fb' THEN 'facebook' WHEN s.filter_platform LIKE '%zalo%' THEN 'zalo' WHEN s.filter_platform LIKE '%sms%' THEN 'sms' ELSE s.filter_platform END)
      AND (NOT p_filters ? 'statuses' OR p_filters->'statuses' ? s.status)
      AND (NOT p_filters ? 'actionIds' OR p_filters->'actionIds' ? s.action_id)
      AND (NOT p_filters ? 'accountIds' OR p_filters->'accountIds' @> to_jsonb(s.account_id) OR p_filters->'accountIds' @> to_jsonb(s.secondary_account_id))
      AND (NOT p_filters ? 'filterAccountId' OR (p_filters->>'filterAccountId')::bigint IN (s.account_id,s.secondary_account_id))
      AND (p_filters->>'dateFrom' IS NULL OR s.filter_time >= ((p_filters->>'dateFrom')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
      -- Desktop's legacy dateTo includes the following calendar day (drafts use the same rule).
      AND (p_filters->>'dateTo' IS NULL OR s.filter_time < (((p_filters->>'dateTo')::date + 2)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
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
    ORDER BY rank, sort_time DESC NULLS LAST, kind, id DESC, key ASC
    LIMIT 100 OFFSET (SELECT (page - 1) * 100 FROM bounds)
  )
  SELECT CASE WHEN p_selection THEN jsonb_build_object('items', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM selections s), '[]'))
    ELSE jsonb_build_object(
      'ids', coalesce((SELECT jsonb_agg(id) FROM page_keys WHERE kind='campaign'), '[]'),
      'selectedId', (SELECT id FROM scoped WHERE id=p_selected_id),
      'configVersion', (SELECT jsonb_build_object('id',c.id,'version',public.aka_agent_desktop_campaign_config_version(c))
        FROM public.auto_campaigns c WHERE c.id=p_selected_id AND c.id IN (SELECT id FROM scoped)),
      'order', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'id', key) ORDER BY rank, sort_time DESC NULLS LAST, kind, id DESC, key ASC) FROM page_keys), '[]'),
      'runningCampaigns', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'name',name) ORDER BY id DESC) FROM scoped WHERE status='đang chạy'),'[]'),
      'extraAccounts', coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) ORDER BY a.id) FROM public.auto_accounts a WHERE (a.id IN (SELECT secondary_account_id FROM scoped) OR (a.is_delete=true AND a.id IN (SELECT account_id FROM scoped))) AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id),'[]'),
      'actionOptions', coalesce((SELECT jsonb_agg(o ORDER BY o.id) FROM (SELECT DISTINCT action_id AS id,coalesce(action_name,action_id) AS name,flatform_type AS platform FROM scoped) o),'[]'),
      'total', b.total, 'campaignTotal', b.campaign_total, 'page', b.page, 'pageSize', 100
    ) END INTO v_result FROM bounds b;
  RETURN v_result;
END;
$function$;
DROP FUNCTION public.aka_agent_campaign_type_visibility(bigint,bigint,text,text,jsonb,text,jsonb,boolean);
DROP FUNCTION public.aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean);
DROP FUNCTION private.aka_agent_campaign_type_visibility(bigint,bigint,jsonb,text,text,jsonb,boolean);
DROP FUNCTION private.aka_agent_campaign_visibility_actions(jsonb,text);
DROP FUNCTION private.aka_agent_campaign_visibility_snapshot(bigint,bigint);
DROP TABLE public.auto_campaign_type_visibility;
COMMIT;

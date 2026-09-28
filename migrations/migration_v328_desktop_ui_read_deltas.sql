-- UI read-only changes; no runtime/log writers, triggers, indexes or settings changed.
-- Live source captured 2026-09-28 from cgjbsmqtfhqvttudyjzq. See docs/DESKTOP_UI_READ_DELTAS.md.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $preflight$ BEGIN
  IF to_regprocedure('public.aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])') IS NULL
    OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'))) NOT IN ('d3255c296a0db4e144b078ae64c3831d','0a57f824f6be155b8dafd2c636f36823') THEN
    RAISE EXCEPTION 'Desktop page live definition differs; audit before applying v328';
  END IF;
  IF to_regprocedure('public.aka_agent_desktop_campaign_config_version(public.auto_campaigns)') IS NOT NULL
    AND md5(pg_get_functiondef(to_regprocedure('public.aka_agent_desktop_campaign_config_version(public.auto_campaigns)'))) <> 'cd15cf96e7848c42071ed22b415fe246' THEN
    RAISE EXCEPTION 'Desktop config version definition differs';
  END IF;
  IF to_regprocedure('public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)') IS NOT NULL
    AND md5(pg_get_functiondef(to_regprocedure('public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)'))) <> '496c1f46adc7e4edfefbeeb0babd123e' THEN
    RAISE EXCEPTION 'Desktop detail definition differs';
  END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.aka_agent_desktop_campaign_config_version(c public.auto_campaigns)
RETURNS text LANGUAGE sql STABLE SET search_path='pg_catalog','public' SET timezone='UTC'
AS $function$
  SELECT md5(jsonb_build_array(c.name,c.action_id,c.account_id,c.secondary_account_id,c.original_schedule,c.schedule_type,c.schedule_end_date,c.daily_stop_time,c.schedule_days,c.schedule_week_days,c.continue_next_day,c.refresh_data,c.content,c.extra_settings,c.images,c.data_target_source_mode,c.data_group_id,c.provisioning_state,c.creation_bundle_id,c.creation_bundle_child_index)::text);
$function$;
ALTER FUNCTION public.aka_agent_desktop_campaign_config_version(public.auto_campaigns) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_desktop_campaign_config_version(public.auto_campaigns) FROM PUBLIC,anon,authenticated,service_role;
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
$function$
;
CREATE OR REPLACE FUNCTION public.aka_agent_desktop_campaign_detail(
  p_staff_id bigint,p_organization_id bigint,p_auth_username text,p_auth_password text,
  p_access jsonb,p_campaign_id bigint,p_part text,p_cursor jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path='pg_catalog','public' SET statement_timeout='60s'
AS $function$
DECLARE
  v_row jsonb; v_version text; v_log text; v_updated_at timestamptz;
  v_tail text; v_length integer; v_end integer; v_prefix text; v_keep integer;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_access IS NULL OR p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_part NOT IN ('config','log') OR p_part IS NULL THEN
    RAISE EXCEPTION 'Invalid campaign detail scope';
  END IF;
  IF p_part='config' THEN
    SELECT jsonb_build_object('id',c.id,'name',c.name,'action_id',c.action_id,'account_id',c.account_id,'secondary_account_id',c.secondary_account_id,'status',c.status,'schedule',c.schedule,'original_schedule',c.original_schedule,'schedule_type',c.schedule_type,'schedule_end_date',c.schedule_end_date,'daily_stop_time',c.daily_stop_time,'schedule_days',c.schedule_days,'schedule_week_days',c.schedule_week_days,'continue_next_day',c.continue_next_day,'refresh_data',c.refresh_data,'content',c.content,'extra_settings',c.extra_settings,'images',c.images,'note',c.note,'is_delete',c.is_delete,'staff_id',c.staff_id,'organization_id',c.organization_id,'created_at',c.created_at,'updated_at',c.updated_at,'completed_at',c.completed_at,'last_run_at',c.last_run_at,'data_target_source_mode',c.data_target_source_mode,'data_group_id',c.data_group_id,'provisioning_state',c.provisioning_state,'creation_bundle_id',c.creation_bundle_id,'creation_bundle_child_index',c.creation_bundle_child_index,'primary_account',jsonb_build_object('name',a.name,'flatform_type',a.flatform_type,'is_zalo_show_web',a.is_zalo_show_web,'is_zalo_server',a.is_zalo_server),'auto_campaign_actions',jsonb_build_object('name',ca.name)),public.aka_agent_desktop_campaign_config_version(c) INTO v_row,v_version
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
      AND c.id=p_campaign_id;
    RETURN CASE WHEN v_row IS NULL THEN NULL ELSE jsonb_build_object('row',v_row,'version',v_version) END;
  END IF;
  IF p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor)<>'object'
    OR coalesce(p_cursor->>'version','') !~ '^[a-f0-9]{32}$'
    OR coalesce(p_cursor->>'length','') !~ '^[0-9]{1,7}$'
    OR jsonb_typeof(p_cursor->'tail') IS DISTINCT FROM 'string'
    OR char_length(p_cursor->>'tail')>1024) THEN
    RAISE EXCEPTION 'Invalid campaign log cursor';
  END IF;
  SELECT coalesce(c.log,''),c.updated_at INTO v_log,v_updated_at FROM public.auto_campaigns c
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
      AND c.id=p_campaign_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_version:=md5(v_log);
  IF v_version=p_cursor->>'version' THEN
    RETURN jsonb_build_object('mode','unchanged','version',v_version,'updatedAt',v_updated_at);
  END IF;
  -- A rolling log can drop its oldest entries. Locate the old suffix, retain
  -- the overlap and send only a small new prefix plus the appended text. The
  -- caller MUST verify the reconstructed MD5 and refetch without a cursor if
  -- an anchor is ambiguous, the log was replaced or a concurrent edit occurred.
  v_tail:=p_cursor->>'tail';
  v_length:=(p_cursor->>'length')::integer;
  IF char_length(v_tail)>0 AND char_length(v_tail)<=v_length THEN
    v_end:=strpos(v_log,v_tail);
    IF v_end>0 THEN
      v_end:=v_end+char_length(v_tail)-1;
      v_prefix:=left(v_log,least(256,v_end));
      v_keep:=v_end-char_length(v_prefix);
      IF v_keep>=0 AND v_keep<=v_length THEN
        RETURN jsonb_build_object('mode','delta','version',v_version,'updatedAt',v_updated_at,
          'prefix',v_prefix,'keepChars',v_keep,'append',substr(v_log,v_end+1));
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('mode','replace','version',v_version,'updatedAt',v_updated_at,'log',v_log);
END;
$function$;
ALTER FUNCTION public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb) TO anon,authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

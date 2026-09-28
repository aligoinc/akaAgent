-- UI-only Desktop reads. Existing runtime and Web RPCs are unchanged.
-- Audit 2026-09-28, project cgjbsmqtfhqvttudyjzq: both new signatures absent.
-- Based on live Web page bd7caeef73e9675f36dd9851498c11e6, retaining its
-- tenant/empty-filter/ID-selection rules; Desktop keeps all entitled platforms,
-- secondary-account filters and schedule-only date filtering.
-- Identity guard 5a9a503db72b965eb644739f5f60905d and progress RPCs untouched.
-- Preflight permits first creation or identical target only. Apply before Desktop release.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $preflight$ BEGIN
  IF to_regprocedure('public.aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])') IS NOT NULL
    AND md5(pg_get_functiondef(to_regprocedure('public.aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'))) <> 'd3255c296a0db4e144b078ae64c3831d' THEN
    RAISE EXCEPTION 'Desktop campaign page definition differs; capture live definition before replacing';
  END IF;
END $preflight$;
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
      'order', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'id', key) ORDER BY rank, sort_time DESC NULLS LAST, kind, id DESC, key ASC) FROM page_keys), '[]'),
      'runningCampaigns', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'name',name) ORDER BY id DESC) FROM scoped WHERE status='đang chạy'),'[]'),
      'extraAccounts', coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) ORDER BY a.id) FROM public.auto_accounts a WHERE (a.id IN (SELECT secondary_account_id FROM scoped) OR (a.is_delete=true AND a.id IN (SELECT account_id FROM scoped))) AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id),'[]'),
      'actionOptions', coalesce((SELECT jsonb_agg(o ORDER BY o.id) FROM (SELECT DISTINCT action_id AS id,coalesce(action_name,action_id) AS name,flatform_type AS platform FROM scoped) o),'[]'),
      'total', b.total, 'campaignTotal', b.campaign_total, 'page', b.page, 'pageSize', 100
    ) END INTO v_result FROM bounds b;
  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[]) TO anon, authenticated, service_role;

DO $preflight$ BEGIN
  IF to_regprocedure('public.aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)') IS NOT NULL
    AND md5(pg_get_functiondef(to_regprocedure('public.aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)'))) <> '4cefacf78def24a3b0fc4d8164ddf7a8' THEN
    RAISE EXCEPTION 'Desktop account snapshot definition differs; capture live definition before replacing';
  END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.aka_agent_desktop_account_snapshot(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text,
  p_access jsonb, p_catalog_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path='pg_catalog','public' SET statement_timeout='60s'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  WITH scoped AS MATERIALIZED (
    SELECT a.id, a.status, a.login_status, a.updated_at, a.mobile_device_last_seen_at, a.mobile_device_info,
      a.zalo_session_updated_at, a.zalo_session_last_verified_at, a.zalo_session_last_error,
      a.email_session_updated_at, a.email_session_last_verified_at, a.email_session_last_error,
      a.facebook_login_claim_generation,
      jsonb_build_object(
        'id',a.id,'name',a.name,'flatform_type',a.flatform_type,'facebook_uid',a.facebook_uid,
        'facebook_login_managed',a.facebook_login_managed,
        'is_zalo_show_web',a.is_zalo_show_web,'is_zalo_server',a.is_zalo_server,
        'username',CASE WHEN a.flatform_type='sms' THEN a.username END,
        'password',CASE WHEN a.flatform_type='sms' THEN a.password END,
        'mobile_device_id',a.mobile_device_id,'mobile_device_registered_at',a.mobile_device_registered_at,
        'is_active',a.is_active,'rate_limit_minutes',a.rate_limit_minutes,
        'account_group_id',a.account_group_id,'proxy_id',a.proxy_id,'zalo_account_id',a.zalo_account_id,
        'is_delete',a.is_delete,'staff_id',a.staff_id,'organization_id',a.organization_id,'created_at',a.created_at,
        'auto_account_groups',CASE WHEN g.id IS NOT NULL THEN jsonb_build_object('name',g.name,'settings',g.settings) END,
        'auto_proxies',CASE WHEN pr.id IS NOT NULL THEN jsonb_build_object('name',pr.name,'protocol',pr.protocol,'host',pr.host,'port',pr.port) END,
        'zalo_accounts',CASE WHEN z.id IS NOT NULL THEN jsonb_build_object('id',z.id,'zalo_uid',z.zalo_uid,'display_name',z.display_name,'phone',z.phone,'avatar_url',z.avatar_url) END
      ) AS metadata
    FROM public.auto_accounts a
    LEFT JOIN public.auto_account_groups g ON g.id=a.account_group_id
    LEFT JOIN public.auto_proxies pr ON pr.id=a.proxy_id
    LEFT JOIN public.zalo_accounts z ON z.id=a.zalo_account_id
    WHERE a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete=false
      AND coalesce((p_access->>CASE WHEN a.flatform_type='facebook' THEN 'facebookCore' ELSE a.flatform_type END)::boolean,false)
      AND (a.flatform_type<>'zalo' OR coalesce((p_access->>CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'qr' END)::boolean,false))
  ), restricted AS MATERIALIZED (
    SELECT DISTINCT x.account_id FROM public.auto_account_action_status x
    JOIN scoped a ON a.id=x.account_id
    WHERE x.is_disable=true AND (x.date_enable IS NULL OR x.date_enable>now())
  ), catalog AS (
    SELECT md5(coalesce(string_agg(metadata::text,',' ORDER BY id),'')) AS version FROM scoped
  )
  SELECT jsonb_build_object('version',c.version,
    'catalog',CASE WHEN c.version IS DISTINCT FROM p_catalog_version THEN
      coalesce((SELECT jsonb_agg(metadata ORDER BY (metadata->>'created_at')::timestamptz DESC,id DESC) FROM scoped),'[]') END,
    'states',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',s.id,'status',s.status,'loginStatus',s.login_status,'updatedAt',s.updated_at,
      'mobileDeviceLastSeenAt',s.mobile_device_last_seen_at,'mobileDeviceInfo',s.mobile_device_info,
      'facebookLoginClaimGeneration',s.facebook_login_claim_generation,
      'zaloSessionUpdatedAt',s.zalo_session_updated_at,'zaloSessionLastVerifiedAt',s.zalo_session_last_verified_at,'zaloSessionLastError',s.zalo_session_last_error,
      'emailSessionUpdatedAt',s.email_session_updated_at,'emailSessionLastVerifiedAt',s.email_session_last_verified_at,'emailSessionLastError',s.email_session_last_error,
      'hasEmailSession',s.email_session_updated_at IS NOT NULL,
      'hasZaloSession',CASE WHEN (p_access->>'chatSync')::boolean IS TRUE AND s.metadata->>'flatform_type'='zalo' AND (s.metadata->>'is_zalo_server')::boolean IS TRUE AND (s.metadata->>'is_zalo_show_web')::boolean IS NOT TRUE THEN s.login_status='đã đăng nhập' ELSE s.zalo_session_updated_at IS NOT NULL END,
      'hasDisabledActions',r.account_id IS NOT NULL
    ) ORDER BY s.id) FROM scoped s LEFT JOIN restricted r ON r.account_id=s.id),'[]'))
  INTO v_result FROM catalog c;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text) TO anon, authenticated, service_role;

INSERT INTO public.auto_system_settings(key,value,description,is_secret,is_active) VALUES
('desktop.campaigns.poll_interval_seconds','30','Chu kỳ tải lại danh sách chiến dịch akaAgent Desktop, tính bằng giây (5–3600). Đọc một lần khi vào phiên đăng nhập; mở lại ứng dụng để nhận giá trị mới. Mặc định 30 giây.',false,true),
('desktop.accounts.poll_interval_seconds','30','Chu kỳ tải lại tài khoản trên màn Chiến dịch akaAgent Desktop, tính bằng giây (5–3600). Đọc một lần khi vào phiên đăng nhập; mở lại ứng dụng để nhận giá trị mới. Mặc định 30 giây.',false,true)
ON CONFLICT(key) DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;

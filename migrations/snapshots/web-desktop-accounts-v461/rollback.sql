-- Rollback v461: khôi phục 10 định nghĩa live trước v461, bỏ hàm mới, cột runtime và khóa cấu hình.
-- Chỉ chạy khi các hàm đang ở đúng bản v461 (hoặc đã về baseline); lệch thì dừng.
-- Trước khi chạy: tắt 'web.desktop_accounts' hoặc deploy lại Control API cũ để Web không gọi hàm mới.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE r record; checksum text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_authenticate_control_session(text)', 'c748df75349ebeef58c3c8f120439b0b', 'de8f93ee545bca94a199b2dffb9fe324'),
    ('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)', '761108afe53ff4046efe0cd247846d10', '6b148777006903e4830925c55616820b'),
    ('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])', '12d454fbc38217dea3497addd39ed832', 'a2bc3f7cae264e647ac576c9895e840f'),
    ('public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)', '1275ad05d4dd184f5f6d9cd937caa21c', '26875e2b1652ca56cc8e59460df8cae1'),
    ('public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)', 'c1673974d0982ce6a731741072ca5338', '61a6b5c855fbcf86cafaf3c3c7ce6f0a'),
    ('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', 'f285e48f4deaf2e1bf7896d7aeddbcf8', 'a86278195e18d1ef8d0091b41d1d0c5b'),
    ('public.delete_control_campaign_atomic(bigint,bigint,bigint)', '1955af1c590ec870cb098cde9dd0714b', '4cfcad941c3acf22e674a77b203d086d'),
    ('public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)', '0f22d3c6fe532176af0e3f38fd485f88', 'd283261c5e77558d10f5df86cd4d1127'),
    ('public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)', 'a98a23f8e7f2e1e6582449f7ed45fb45', 'd61093635f226751c4a311840c6b3e29'),
    ('public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)', 'b504f4928a9dd271dec783796a7a0374', '478aa4281c683686437f31947bb760b1')
  ) AS x(signature, source_md5, target_md5) LOOP
    checksum := md5(pg_get_functiondef(r.signature::regprocedure));
    IF checksum NOT IN (r.source_md5, r.target_md5) THEN
      RAISE EXCEPTION 'v461_rollback_unexpected_definition:%:%', r.signature, checksum;
    END IF;
  END LOOP;
END
$guard$;

CREATE OR REPLACE FUNCTION public.aka_agent_authenticate_control_session(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.auto_control_sessions%ROWTYPE;
  v_staff public.org_staff%ROWTYPE;
  v_organization public.org_organization%ROWTYPE;
  v_zalo_package public.org_organization_product%ROWTYPE;
  v_sms_package public.org_organization_product%ROWTYPE;
  v_zalo_capabilities record;
  v_zalo_qr_enabled boolean := false;
  v_zalo_web_enabled boolean := false;
  v_zalo_server_enabled boolean := false;
  v_sms_enabled boolean := false;
  v_now timestamptz := now();
  v_vietnam_day_start timestamptz := (
    date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  SELECT session.* INTO v_session
  FROM public.auto_control_sessions AS session
  WHERE session.token_hash = p_token_hash
    AND session.revoked_at IS NULL
    AND session.expires_at > v_now
  LIMIT 1;
  IF v_session.id IS NULL THEN RETURN jsonb_build_object('status', 'invalid_session'); END IF;

  SELECT staff.* INTO v_staff
  FROM public.org_staff AS staff
  WHERE staff.id = v_session.staff_id
  LIMIT 1;
  IF v_staff.id IS NULL
    OR v_staff.is_active IS DISTINCT FROM true
    OR v_staff.organization_id IS DISTINCT FROM v_session.organization_id
  THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_staff');
  END IF;

  SELECT organization.* INTO v_organization
  FROM public.org_organization AS organization
  WHERE organization.id = v_staff.organization_id
  LIMIT 1;
  IF v_organization.id IS NULL THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_organization');
  END IF;

  -- Reuse Desktop's live staff/org expiry rule, before product entitlement checks.
  -- Keep the existing failure status so older Control API clients still revoke safely.
  IF NOT public.aka_agent_staff_time_allowed(v_staff.id) OR NOT public.aka_agent_app_access_staff_allowed(v_staff.id,'akaAgent') THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_staff');
  END IF;

  SELECT * INTO v_zalo_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_staff.organization_id);
  IF v_zalo_capabilities.entitlement_id IS NOT NULL THEN
    SELECT entitlement.* INTO v_zalo_package
    FROM public.org_organization_product AS entitlement
    WHERE entitlement.id = v_zalo_capabilities.entitlement_id;
  END IF;

  SELECT entitlement.* INTO v_sms_package
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_staff.organization_id
    AND entitlement.is_deleted = false
    AND entitlement.product_id = 17
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_zalo_qr_enabled := COALESCE(v_zalo_capabilities.qr_enabled, false);
  v_zalo_web_enabled := COALESCE(v_zalo_capabilities.web_enabled, false);
  v_zalo_server_enabled := v_zalo_qr_enabled
    AND COALESCE(v_zalo_capabilities.server_enabled, false);
  v_sms_enabled := v_sms_package.id IS NOT NULL;

  IF NOT v_zalo_server_enabled AND NOT v_sms_enabled THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'capability_unavailable');
  END IF;
  IF v_session.last_seen_at <= v_now - interval '5 minutes' THEN
    UPDATE public.auto_control_sessions SET last_seen_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'status', 'authenticated',
    'session', jsonb_build_object(
      'id', v_session.id, 'staff_id', v_session.staff_id,
      'organization_id', v_session.organization_id,
      'client_type', v_session.client_type, 'user_agent', v_session.user_agent,
      'created_at', v_session.created_at, 'last_seen_at', v_session.last_seen_at,
      'expires_at', v_session.expires_at, 'revoked_at', v_session.revoked_at
    ),
    'staff', jsonb_build_object(
      'id', v_staff.id, 'organization_id', v_staff.organization_id,
      'name', v_staff.name, 'username', v_staff.username,
      'phone', v_staff.phone, 'email', v_staff.email,
      'is_active', v_staff.is_active, 'is_zalo_server', v_zalo_server_enabled
    ),
    'organization', jsonb_build_object('id', v_organization.id, 'name', v_organization.name),
    'capabilities', jsonb_build_object(
      'zalo_qr', v_zalo_qr_enabled,
      'zalo_web', v_zalo_web_enabled,
      'zalo_server', v_zalo_server_enabled,
      'sms', v_sms_enabled
    ),
    'zalo_account_capabilities', jsonb_build_object(
      'qr', v_zalo_qr_enabled,
      'web', v_zalo_web_enabled,
      'server', v_zalo_server_enabled,
      'revision', v_zalo_capabilities.capability_revision
    ),
    'zalo_package', CASE WHEN v_zalo_package.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_zalo_package.id,
      'product_id', v_zalo_package.product_id,
      'product_package_id', v_zalo_package.product_package_id,
      'product_name', v_zalo_package.product_name,
      'package_name', v_zalo_package.package_name,
      'max_accounts', v_zalo_capabilities.max_accounts,
      'max_staff', v_zalo_package.max_staff,
      'max_sends_per_day', v_zalo_capabilities.max_sends_per_day,
      'expiration_date', v_zalo_package.expiration_date,
      'created_at', v_zalo_package.created_at,
      'capability_revision', v_zalo_capabilities.capability_revision
    ) END,
    'sms_package', CASE WHEN v_sms_package.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_sms_package.id,
      'product_id', v_sms_package.product_id,
      'product_package_id', v_sms_package.product_package_id,
      'product_name', v_sms_package.product_name,
      'package_name', v_sms_package.package_name,
      'max_accounts', v_sms_package.max_accounts,
      'max_staff', v_sms_package.max_staff,
      'max_sends_per_day', v_sms_package.max_sends_per_day,
      'expiration_date', v_sms_package.expiration_date,
      'created_at', v_sms_package.created_at
    ) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_control_account_snapshot(p_staff_id bigint, p_organization_id bigint, p_platforms text[], p_view text DEFAULT 'accounts'::text, p_account_ids bigint[] DEFAULT NULL::bigint[], p_versions jsonb DEFAULT '{}'::jsonb, p_catalog_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_catalog jsonb;
  v_catalog_version text;
  v_items jsonb;
  v_running jsonb := '[]'::jsonb;
  v_chat boolean;
BEGIN
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_view IS NULL OR p_view NOT IN ('accounts','campaigns','details')
     OR jsonb_typeof(p_versions) IS DISTINCT FROM 'object'
     OR (p_view = 'campaigns' AND (p_account_ids IS NULL OR cardinality(p_account_ids) > 101)) THEN
    RAISE EXCEPTION 'Invalid account snapshot scope';
  END IF;

  IF p_view = 'campaigns' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'name',coalesce(nullif(a.name,''),nullif(z.display_name,''),'Tài khoản #'||a.id),
      'platform',a.flatform_type,'isZaloServer',a.flatform_type='zalo' AND a.is_zalo_server IS TRUE,
      'isZaloShowWeb',a.flatform_type='zalo' AND a.is_zalo_show_web IS TRUE
    ) ORDER BY a.created_at DESC,a.id DESC),'[]'::jsonb)
    INTO v_catalog
    FROM auto_accounts a LEFT JOIN zalo_accounts z ON z.id=a.zalo_account_id
    WHERE a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete IS FALSE
      AND a.flatform_type=ANY(p_platforms)
      AND public.aka_agent_app_access_account_allowed(a.id,'akaAgent')
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE));
    v_catalog_version := md5(v_catalog::text);
  END IF;

  IF p_view='accounts' THEN
  SELECT public.aka_agent_app_access_chat_runtime(p_organization_id) INTO v_chat;
  END IF;

  WITH account_rows AS MATERIALIZED (
    SELECT a.id,a.created_at,
      jsonb_build_object('id',a.id,'name',a.name,'flatform_type',a.flatform_type,
        'is_aka_agent_enabled',a.is_aka_agent_enabled,'is_akachat_enabled',a.is_akachat_enabled,
        'is_active',a.is_active,'is_zalo_show_web',a.is_zalo_show_web,'is_zalo_server',a.is_zalo_server,
        'account_group_id',a.account_group_id,'rate_limit_minutes',a.rate_limit_minutes,'proxy_id',a.proxy_id,
        'username',CASE WHEN a.flatform_type='sms' THEN a.username END,
        'mobile_device_id',CASE WHEN a.flatform_type='sms' THEN a.mobile_device_id END,
        'mobile_device_info',CASE WHEN a.flatform_type='sms' THEN coalesce(a.mobile_device_info,'{}'::jsonb) ELSE '{}'::jsonb END,
        'mobile_device_registered_at',CASE WHEN a.flatform_type='sms' THEN a.mobile_device_registered_at END,
        'created_at',a.created_at,
        'auto_account_groups',jsonb_build_object('name',g.name),
        'auto_proxies',jsonb_build_object('name',p.name),
        'zalo_accounts',jsonb_build_object('zalo_uid',z.zalo_uid,'display_name',z.display_name,'phone',z.phone,'avatar_url',z.avatar_url)
      ) AS metadata,
      (jsonb_build_object('id',a.id,'status',a.status,'login_status',a.login_status,'is_active',a.is_active,
        'mobile_device_last_seen_at',CASE WHEN a.flatform_type='sms' THEN a.mobile_device_last_seen_at END,
        'updated_at',a.updated_at)
      || CASE WHEN p_view<>'campaigns' THEN jsonb_build_object(
        'has_zalo_session',CASE WHEN a.flatform_type='zalo' AND v_chat THEN a.login_status IS NOT DISTINCT FROM 'đã đăng nhập'
          ELSE a.zalo_session IS NOT NULL AND a.zalo_session <> 'null'::jsonb END,
        'has_disabled_actions',CASE WHEN p_account_ids IS NULL THEN EXISTS (
          SELECT 1 FROM auto_account_action_status s WHERE s.account_id=a.id AND s.is_disable IS TRUE
            AND (s.date_enable IS NULL OR s.date_enable > now())
        ) ELSE NULL END
      ) ELSE '{}'::jsonb END
      || CASE WHEN p_view='details' THEN jsonb_build_object(
        'zalo_session_updated_at',a.zalo_session_updated_at,'zalo_session_last_verified_at',a.zalo_session_last_verified_at,
        'zalo_session_last_error',a.zalo_session_last_error
      ) ELSE '{}'::jsonb END) AS state
    FROM auto_accounts a
    LEFT JOIN auto_account_groups g ON g.id=a.account_group_id
    LEFT JOIN auto_proxies p ON p.id=a.proxy_id
    LEFT JOIN zalo_accounts z ON z.id=a.zalo_account_id
    WHERE a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete IS FALSE
      AND a.flatform_type=ANY(p_platforms)
      AND public.aka_agent_app_access_account_allowed(a.id,'akaAgent')
      AND (p_account_ids IS NULL OR a.id=ANY(p_account_ids))
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'version',md5(metadata::text),'state',state,
    'metadata',CASE WHEN p_view<>'campaigns' AND (p_versions->>id::text) IS DISTINCT FROM md5(metadata::text) THEN metadata ELSE NULL END
  ) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO v_items FROM account_rows;

  IF p_view='accounts' AND p_account_ids IS NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'accountId',c.account_id,'status',c.status)
      ORDER BY c.created_at DESC,c.id DESC),'[]'::jsonb) INTO v_running
    FROM auto_campaigns c JOIN auto_accounts a ON a.id=c.account_id
    WHERE c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.is_delete IS FALSE AND c.status='đang chạy'
      AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete IS FALSE
      AND a.flatform_type=ANY(p_platforms)
      AND public.aka_agent_app_access_account_allowed(a.id,'akaAgent')
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE));
  END IF;
  RETURN jsonb_build_object('items',v_items,'runningCampaigns',v_running,'catalogVersion',v_catalog_version,
    'catalog',CASE WHEN v_catalog_version IS DISTINCT FROM p_catalog_version THEN v_catalog ELSE NULL END);
END
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_control_campaign_page(p_staff_id bigint, p_organization_id bigint, p_platforms text[], p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_drafts jsonb DEFAULT '[]'::jsonb, p_selected_id bigint DEFAULT NULL::bigint, p_selection boolean DEFAULT false, p_after_id bigint DEFAULT 0, p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_result jsonb;
  v_visibility jsonb;
  v_apply_visibility boolean := coalesce((p_filters->>'applyDisplaySettings')::boolean,false);
  v_search text := lower(translate(regexp_replace(normalize(coalesce(p_filters->>'search', ''), NFD), U&'[\0300-\036f]', '', 'g'), 'Đđ', 'Dd'));
BEGIN
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_platforms IS NULL THEN
    RAISE EXCEPTION 'Missing campaign scope';
  END IF;
  IF p_page < 1 OR p_page > 100000 OR jsonb_array_length(p_drafts) > 10000 THEN
    RAISE EXCEPTION 'Invalid campaign page';
  END IF;

  IF v_apply_visibility THEN
    v_visibility:=private.aka_agent_campaign_visibility_snapshot(p_staff_id,p_organization_id);
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
    WHERE (NOT v_apply_visibility OR NOT (coalesce(v_visibility->'hiddenActionIds','[]'::jsonb) ? s.action_id))
      AND (NOT p_filters ? 'platforms' OR p_filters->'platforms' ? s.flatform_type)
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
      AND (NOT v_apply_visibility OR NOT (coalesce(v_visibility->'hiddenActionIds','[]'::jsonb) ? coalesce(value->>'actionId','')))
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
  IF v_apply_visibility THEN v_result:=v_result||jsonb_build_object('displaySettings',v_visibility); END IF;
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

CREATE OR REPLACE FUNCTION public.create_control_campaign(p_staff_id bigint, p_organization_id bigint, p_idempotency_key text, p_campaign jsonb, p_inputs jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_campaign_id bigint;
  v_account_id bigint;
  v_action_id text;
  v_action_platform text;
  v_account_platform text;
  v_input_count integer := 0;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_key IS NULL OR length(v_key) > 200 THEN
    RAISE EXCEPTION 'invalid_idempotency_key';
  END IF;
  IF jsonb_typeof(COALESCE(p_campaign, '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(COALESCE(p_inputs, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'invalid_control_campaign_payload';
  END IF;
  IF jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) > 5000 THEN
    RAISE EXCEPTION 'too_many_campaign_inputs';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_staff_id::text || ':' || v_key, 0));

  SELECT campaign.id INTO v_campaign_id
  FROM public.auto_campaigns AS campaign
  WHERE campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.control_idempotency_key = v_key
  LIMIT 1;

  IF FOUND THEN
    PERFORM account.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.id = v_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND (
        account.flatform_type = 'sms'
        OR (
          account.flatform_type = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
      )
      AND COALESCE(account.is_delete, false) = false
    FOR UPDATE OF account;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'control_account_not_found';
    END IF;

    SELECT count(*)::integer INTO v_input_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = v_campaign_id AND COALESCE(is_delete, false) = false;
    RETURN jsonb_build_object(
      'campaign_id', v_campaign_id,
      'input_count', v_input_count,
      'created', false
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.org_staff
    WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  v_account_id := NULLIF(p_campaign->>'accountId', '')::bigint;
  v_action_id := NULLIF(btrim(COALESCE(p_campaign->>'actionId', '')), '');
  IF v_account_id IS NULL OR v_action_id IS NULL THEN
    RAISE EXCEPTION 'campaign_account_and_action_required';
  END IF;

  SELECT account.flatform_type INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
      )
    )
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'control_account_not_found';
  END IF;

  SELECT action.flatform_type INTO v_action_platform
  FROM public.auto_campaign_actions AS action
  WHERE action.id = v_action_id
    AND action.flatform_type IN ('zalo', 'sms')
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false;
  IF NOT FOUND OR v_action_platform IS DISTINCT FROM v_account_platform THEN
    RAISE EXCEPTION 'control_action_not_allowed';
  END IF;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, schedule, original_schedule,
    content, schedule_type, schedule_end_date,
    daily_stop_time, schedule_days, schedule_week_days, continue_next_day,
    refresh_data, extra_settings, images, is_delete, staff_id, organization_id,
    control_idempotency_key, created_at, updated_at
  ) VALUES (
    btrim(p_campaign->>'name'),
    v_action_id,
    v_account_id,
    'chờ xử lý',
    NULLIF(p_campaign->>'schedule', '')::timestamptz,
    NULLIF(p_campaign->>'schedule', '')::timestamptz,
    COALESCE(p_campaign->>'content', ''),
    COALESCE(NULLIF(p_campaign->>'scheduleType', ''), 'daily'),
    NULLIF(p_campaign->>'scheduleEndDate', '')::timestamptz,
    NULLIF(p_campaign->>'dailyStopTime', '')::time,
    NULLIF(p_campaign->>'scheduleDays', ''),
    NULLIF(p_campaign->>'scheduleWeekDays', ''),
    COALESCE((p_campaign->>'continueNextDay')::boolean, false),
    COALESCE((p_campaign->>'refreshData')::boolean, false),
    CASE WHEN jsonb_typeof(p_campaign->'extraSettings') = 'object'
      THEN p_campaign->'extraSettings' ELSE '{}'::jsonb END,
    CASE WHEN jsonb_typeof(p_campaign->'images') = 'array'
      THEN p_campaign->'images' ELSE '[]'::jsonb END,
    false,
    p_staff_id,
    p_organization_id,
    v_key,
    now(),
    now()
  ) RETURNING id INTO v_campaign_id;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, input_id, name, phone, phone_carrier, uid, email,
    info1, info2, info3, info4, info5, content,
    status, note, schedule, is_delete, created_at
  )
  SELECT
    v_campaign_id,
    NULL,
    NULLIF(item->>'name', ''),
    NULLIF(item->>'phone', ''),
    NULLIF(item->>'phoneCarrier', ''),
    NULLIF(item->>'uid', ''),
    NULLIF(item->>'email', ''),
    NULLIF(item->>'info1', ''),
    NULLIF(item->>'info2', ''),
    NULLIF(item->>'info3', ''),
    NULLIF(item->>'info4', ''),
    NULLIF(item->>'info5', ''),
    NULLIF(item->>'content', ''),
    'chờ xử lý',
    NULLIF(item->>'note', ''),
    NULLIF(item->>'schedule', '')::timestamptz,
    false,
    now()
  FROM jsonb_array_elements(COALESCE(p_inputs, '[]'::jsonb)) AS item;
  GET DIAGNOSTICS v_input_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'campaign_id', v_campaign_id,
    'input_count', v_input_count,
    'created', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_control_campaign_atomic(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_expected_updated_at timestamp with time zone, p_campaign_patch jsonb, p_sms_inputs jsonb DEFAULT NULL::jsonb, p_update_sms_schedule boolean DEFAULT false, p_append_idempotency_key text DEFAULT NULL::text, p_expected_input_count integer DEFAULT NULL::integer, p_append_inputs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account_platform text;
  v_target_action_id text;
  v_payload_input_count integer := 0;
  v_payload_unique_input_count integer := 0;
  v_eligible_input_count integer := 0;
  v_current_eligible_input_count integer := 0;
  v_updated_inputs integer := 0;
  v_append_key text := NULLIF(btrim(COALESCE(p_append_idempotency_key, '')), '');
  v_append_input_count integer := 0;
  v_existing_append_count integer := 0;
  v_current_input_count integer := 0;
  v_appended_inputs integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_campaign_patch, '{}'::jsonb)) <> 'object'
    OR (p_sms_inputs IS NOT NULL AND jsonb_typeof(p_sms_inputs) <> 'array')
    OR (p_append_inputs IS NOT NULL AND jsonb_typeof(p_append_inputs) <> 'array') THEN
    RAISE EXCEPTION 'invalid_control_campaign_update_payload';
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    v_append_input_count := jsonb_array_length(p_append_inputs);
    IF v_append_input_count < 1 OR v_append_input_count > 5000
      OR v_append_key IS NULL OR length(v_append_key) > 200
      OR p_expected_input_count IS NULL OR p_expected_input_count < 0 THEN
      RAISE EXCEPTION 'invalid_control_campaign_append_payload';
    END IF;
  ELSIF v_append_key IS NOT NULL OR p_expected_input_count IS NOT NULL THEN
    RAISE EXCEPTION 'orphan_control_campaign_append_metadata';
  END IF;

  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      (
        COALESCE(account.is_delete, false) = false
        AND (
          account.flatform_type = 'sms'
          OR (
            account.flatform_type = 'zalo'
            AND COALESCE(account.is_zalo_show_web, false) = false
            AND COALESCE(account.is_zalo_server, false) = true
            AND COALESCE(account.is_active, true) = true
          )
        )
      )
      OR (
        COALESCE(account.is_delete, false) = true
        AND p_campaign_patch ? 'account_id'
        AND EXISTS (
          SELECT 1
          FROM public.auto_accounts AS target_account
          WHERE target_account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
            AND target_account.staff_id = p_staff_id
            AND target_account.organization_id = p_organization_id
            AND target_account.flatform_type = account.flatform_type
            AND (
              target_account.flatform_type = 'sms'
              OR (
                target_account.flatform_type = 'zalo'
                AND COALESCE(target_account.is_zalo_show_web, false) = false
                AND COALESCE(target_account.is_zalo_server, false) = true
                AND COALESCE(target_account.is_active, true) = true
              )
            )
            AND COALESCE(target_account.is_delete, false) = false
        )
      )
    );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  SELECT account.flatform_type
  INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id;

  -- A network retry after the transaction committed still carries the stale
  -- version. The durable append key proves that this exact edit already won.
  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_existing_append_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = p_campaign_id
      AND control_append_idempotency_key = v_append_key;
    IF v_existing_append_count > 0 THEN
      IF v_existing_append_count <> v_append_input_count THEN
        RETURN jsonb_build_object('updated', false, 'reason', 'append_idempotency_conflict');
      END IF;
      RETURN jsonb_build_object(
        'updated', true,
        'campaign_id', p_campaign_id,
        'updated_input_count', 0,
        'appended_input_count', v_existing_append_count,
        'updated_at', v_campaign.updated_at,
        'idempotent', true
      );
    END IF;
  END IF;

  IF v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;
  IF v_campaign.status = 'đang chạy' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_running');
  END IF;
  IF p_append_inputs IS NOT NULL AND v_campaign.status = 'hoàn thành' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_completed');
  END IF;
  IF p_sms_inputs IS NOT NULL AND v_account_platform <> 'sms' THEN
    RAISE EXCEPTION 'control_sms_materialization_platform_mismatch';
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  IF p_sms_inputs IS NOT NULL OR p_append_inputs IS NOT NULL THEN
    -- SMS status recording locks an input row before it may complete the
    -- campaign. Lock every current row before taking the campaign lock so an
    -- update+append cannot commit below a concurrently completed campaign.
    PERFORM input_data.id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
    ORDER BY input_data.id
    FOR UPDATE OF input_data;
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_eligible_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');

    SELECT
      count(*)::integer,
      count(DISTINCT NULLIF(item->>'id', '')::bigint)::integer
    INTO v_payload_input_count, v_payload_unique_input_count
    FROM jsonb_array_elements(p_sms_inputs) AS item;

    IF v_payload_input_count <> v_payload_unique_input_count
      OR v_payload_unique_input_count <> v_eligible_input_count
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_sms_inputs) AS item
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.id = NULLIF(item->>'id', '')::bigint
            AND input_data.campaign_id = p_campaign_id
            AND COALESCE(input_data.is_delete, false) = false
            AND input_data.status IN ('chờ xử lý', 'tạm dừng')
        )
      ) THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'sms_inputs_changed');
    END IF;
  END IF;

  -- Mobile status recording locks input rows before it may complete the campaign;
  -- take the campaign lock only after the SMS input locks to keep that order.
  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      (
        COALESCE(account.is_delete, false) = false
        AND (
          account.flatform_type = 'sms'
          OR (
            account.flatform_type = 'zalo'
            AND COALESCE(account.is_zalo_show_web, false) = false
            AND COALESCE(account.is_zalo_server, false) = true
            AND COALESCE(account.is_active, true) = true
          )
        )
      )
      OR (
        COALESCE(account.is_delete, false) = true
        AND p_campaign_patch ? 'account_id'
        AND EXISTS (
          SELECT 1
          FROM public.auto_accounts AS target_account
          WHERE target_account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
            AND target_account.staff_id = p_staff_id
            AND target_account.organization_id = p_organization_id
            AND target_account.flatform_type = account.flatform_type
            AND (
              target_account.flatform_type = 'sms'
              OR (
                target_account.flatform_type = 'zalo'
                AND COALESCE(target_account.is_zalo_show_web, false) = false
                AND COALESCE(target_account.is_zalo_server, false) = true
                AND COALESCE(target_account.is_active, true) = true
              )
            )
            AND COALESCE(target_account.is_delete, false) = false
        )
      )
    )
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  SELECT account.flatform_type
  INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id;

  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_existing_append_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = p_campaign_id
      AND control_append_idempotency_key = v_append_key;
    IF v_existing_append_count > 0 THEN
      IF v_existing_append_count <> v_append_input_count THEN
        RETURN jsonb_build_object('updated', false, 'reason', 'append_idempotency_conflict');
      END IF;
      RETURN jsonb_build_object(
        'updated', true,
        'campaign_id', p_campaign_id,
        'updated_input_count', 0,
        'appended_input_count', v_existing_append_count,
        'updated_at', v_campaign.updated_at,
        'idempotent', true
      );
    END IF;
  END IF;

  IF v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;
  IF v_campaign.status = 'đang chạy' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_running');
  END IF;
  IF p_append_inputs IS NOT NULL AND v_campaign.status = 'hoàn thành' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_completed');
  END IF;
  IF p_sms_inputs IS NOT NULL AND v_account_platform <> 'sms' THEN
    RAISE EXCEPTION 'control_sms_materialization_platform_mismatch';
  END IF;

  IF p_campaign_patch ? 'account_id' THEN
    PERFORM account.id
    FROM public.auto_accounts AS account
    WHERE account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
      AND account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND account.flatform_type = v_account_platform
      AND (
        account.flatform_type = 'sms'
        OR (
          account.flatform_type = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
          AND COALESCE(account.is_active, true) = true
        )
      )
      AND COALESCE(account.is_delete, false) = false
    FOR UPDATE OF account;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'control_account_not_found';
    END IF;
  END IF;

  v_target_action_id := v_campaign.action_id;
  IF p_campaign_patch ? 'action_id' THEN
    v_target_action_id := NULLIF(btrim(COALESCE(p_campaign_patch->>'action_id', '')), '');
    IF v_target_action_id IS NULL THEN
      RAISE EXCEPTION 'control_action_not_allowed';
    END IF;

    PERFORM action.id
    FROM public.auto_campaign_actions AS action
    WHERE action.id = v_target_action_id
      AND action.flatform_type = v_account_platform
      AND COALESCE(action.is_active, true) = true
      AND COALESCE(action.is_delete, false) = false
    FOR SHARE OF action;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'control_action_not_allowed';
    END IF;
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_current_eligible_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');
    IF v_current_eligible_input_count <> v_payload_unique_input_count THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'sms_inputs_changed');
    END IF;
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_current_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false;
    IF v_current_input_count <> p_expected_input_count THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'input_count_conflict');
    END IF;
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET
    name = CASE WHEN p_campaign_patch ? 'name' THEN p_campaign_patch->>'name' ELSE campaign.name END,
    action_id = v_target_action_id,
    account_id = CASE WHEN p_campaign_patch ? 'account_id' THEN NULLIF(p_campaign_patch->>'account_id', '')::bigint ELSE campaign.account_id END,
    schedule = CASE WHEN p_campaign_patch ? 'schedule' THEN NULLIF(p_campaign_patch->>'schedule', '')::timestamptz ELSE campaign.schedule END,
    original_schedule = CASE WHEN p_campaign_patch ? 'original_schedule' THEN NULLIF(p_campaign_patch->>'original_schedule', '')::timestamptz ELSE campaign.original_schedule END,
    content = CASE WHEN p_campaign_patch ? 'content' THEN COALESCE(p_campaign_patch->>'content', '') ELSE campaign.content END,
    schedule_type = CASE WHEN p_campaign_patch ? 'schedule_type' THEN p_campaign_patch->>'schedule_type' ELSE campaign.schedule_type END,
    schedule_end_date = CASE WHEN p_campaign_patch ? 'schedule_end_date' THEN NULLIF(p_campaign_patch->>'schedule_end_date', '')::timestamptz ELSE campaign.schedule_end_date END,
    daily_stop_time = CASE WHEN p_campaign_patch ? 'daily_stop_time' THEN NULLIF(p_campaign_patch->>'daily_stop_time', '')::time ELSE campaign.daily_stop_time END,
    schedule_days = CASE WHEN p_campaign_patch ? 'schedule_days' THEN NULLIF(p_campaign_patch->>'schedule_days', '') ELSE campaign.schedule_days END,
    schedule_week_days = CASE WHEN p_campaign_patch ? 'schedule_week_days' THEN NULLIF(p_campaign_patch->>'schedule_week_days', '') ELSE campaign.schedule_week_days END,
    continue_next_day = CASE WHEN p_campaign_patch ? 'continue_next_day' THEN (p_campaign_patch->>'continue_next_day')::boolean ELSE campaign.continue_next_day END,
    refresh_data = CASE WHEN p_campaign_patch ? 'refresh_data' THEN (p_campaign_patch->>'refresh_data')::boolean ELSE campaign.refresh_data END,
    extra_settings = CASE WHEN p_campaign_patch ? 'extra_settings' THEN p_campaign_patch->'extra_settings' ELSE campaign.extra_settings END,
    images = CASE WHEN p_campaign_patch ? 'images' THEN p_campaign_patch->'images' ELSE campaign.images END,
    status = CASE
      WHEN v_account_platform = 'zalo' THEN campaign.status
      WHEN p_campaign_patch ? 'status' THEN p_campaign_patch->>'status'
      ELSE campaign.status
    END,
    updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.updated_at IS NOT DISTINCT FROM p_expected_updated_at
  RETURNING * INTO v_campaign;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    WITH materialized AS (
      SELECT
        NULLIF(item->>'id', '')::bigint AS id,
        NULLIF(item->>'phone', '') AS phone,
        NULLIF(item->>'phoneCarrier', '') AS phone_carrier,
        NULLIF(item->>'content', '') AS content,
        NULLIF(item->>'schedule', '')::timestamptz AS schedule
      FROM jsonb_array_elements(p_sms_inputs) AS item
    )
    UPDATE public.auto_campaign_input_data AS input_data
    SET
      phone = materialized.phone,
      phone_carrier = materialized.phone_carrier,
      content = materialized.content,
      schedule = CASE WHEN p_update_sms_schedule THEN materialized.schedule ELSE input_data.schedule END
    FROM materialized
    WHERE input_data.id = materialized.id
      AND input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');
    GET DIAGNOSTICS v_updated_inputs = ROW_COUNT;
    IF v_updated_inputs <> v_eligible_input_count THEN
      RAISE EXCEPTION 'control_sms_inputs_changed';
    END IF;
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    INSERT INTO public.auto_campaign_input_data (
      campaign_id, input_id, name, phone, phone_carrier, uid, email,
      info1, info2, info3, info4, info5, content,
      status, note, schedule, is_delete, created_at,
      control_append_idempotency_key, control_append_row_index
    )
    SELECT
      p_campaign_id,
      NULL,
      NULLIF(item.value->>'name', ''),
      NULLIF(item.value->>'phone', ''),
      NULLIF(item.value->>'phoneCarrier', ''),
      NULLIF(item.value->>'uid', ''),
      NULLIF(item.value->>'email', ''),
      NULLIF(item.value->>'info1', ''),
      NULLIF(item.value->>'info2', ''),
      NULLIF(item.value->>'info3', ''),
      NULLIF(item.value->>'info4', ''),
      NULLIF(item.value->>'info5', ''),
      NULLIF(item.value->>'content', ''),
      'chờ xử lý',
      NULLIF(item.value->>'note', ''),
      NULLIF(item.value->>'schedule', '')::timestamptz,
      false,
      now(),
      v_append_key,
      (item.ordinality - 1)::integer
    FROM jsonb_array_elements(p_append_inputs) WITH ORDINALITY AS item(value, ordinality);
    GET DIAGNOSTICS v_appended_inputs = ROW_COUNT;
    IF v_appended_inputs <> v_append_input_count THEN
      RAISE EXCEPTION 'control_campaign_append_incomplete';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated', true,
    'campaign_id', p_campaign_id,
    'updated_input_count', v_updated_inputs,
    'appended_input_count', v_appended_inputs,
    'updated_at', v_campaign.updated_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_control_campaign_atomic(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_status text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;

  -- This is an optimistic platform read only; it deliberately takes no campaign
  -- row lock. The mutation locks input rows before taking the campaign row lock.
  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
      )
    );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
      )
    )
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;
  IF v_campaign_status = 'đang chạy' THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'campaign_running');
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET is_delete = true, updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status <> 'đang chạy';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'campaign_running');
  END IF;

  RETURN jsonb_build_object('deleted', true, 'campaign_id', p_campaign_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_control_campaign_input_rows(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_idempotency_key text, p_expected_input_count integer, p_inputs jsonb, p_campaign_schedule timestamp with time zone, p_campaign_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_campaign_status text;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_input_count integer := 0;
  v_existing_count integer := 0;
  v_inserted integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_key IS NULL OR length(v_key) > 200 THEN
    RAISE EXCEPTION 'invalid_idempotency_key';
  END IF;
  IF p_campaign_schedule IS NULL THEN
    RAISE EXCEPTION 'invalid_campaign_schedule';
  END IF;
  IF p_campaign_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_campaign_status';
  END IF;
  IF jsonb_typeof(COALESCE(p_inputs, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) < 1
    OR jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) > 5000 THEN
    RAISE EXCEPTION 'invalid_control_campaign_inputs';
  END IF;

  -- Validate tenant ownership before taking locks.
  PERFORM campaign.id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
      )
    )
    AND COALESCE(account.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'not_found');
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Keep the same input -> campaign lock order as SMS completion recording.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
      )
    )
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'not_found');
  END IF;

  SELECT count(*)::integer INTO v_existing_count
  FROM public.auto_campaign_input_data
  WHERE campaign_id = p_campaign_id
    AND control_append_idempotency_key = v_key;
  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('inserted', v_existing_count, 'created', false);
  END IF;

  IF v_campaign_status = 'đang chạy' THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'campaign_running');
  END IF;

  SELECT count(*)::integer INTO v_input_count
  FROM public.auto_campaign_input_data
  WHERE campaign_id = p_campaign_id
    AND COALESCE(is_delete, false) = false;
  IF p_expected_input_count IS NULL OR p_expected_input_count <> v_input_count THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'input_count_conflict');
  END IF;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, input_id, name, phone, phone_carrier, uid, email,
    info1, info2, info3, info4, info5, content,
    status, note, schedule, is_delete, created_at,
    control_append_idempotency_key, control_append_row_index
  )
  SELECT
    p_campaign_id,
    NULL,
    NULLIF(item.value->>'name', ''),
    NULLIF(item.value->>'phone', ''),
    NULLIF(item.value->>'phoneCarrier', ''),
    NULLIF(item.value->>'uid', ''),
    NULLIF(item.value->>'email', ''),
    NULLIF(item.value->>'info1', ''),
    NULLIF(item.value->>'info2', ''),
    NULLIF(item.value->>'info3', ''),
    NULLIF(item.value->>'info4', ''),
    NULLIF(item.value->>'info5', ''),
    NULLIF(item.value->>'content', ''),
    'chờ xử lý',
    NULLIF(item.value->>'note', ''),
    NULLIF(item.value->>'schedule', '')::timestamptz,
    false,
    now(),
    v_key,
    (item.ordinality - 1)::integer
  FROM jsonb_array_elements(p_inputs) WITH ORDINALITY AS item(value, ordinality);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.auto_campaigns
  SET schedule = p_campaign_schedule,
      original_schedule = p_campaign_schedule,
      status = p_campaign_status,
      updated_at = now()
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object('inserted', v_inserted, 'created', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_control_campaign_input_statuses_atomic(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_input_ids bigint[], p_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_input_ids bigint[];
  v_from_statuses text[];
  v_campaign_status text;
  v_account_platform text;
  v_is_zalo_show_web boolean;
  v_is_zalo_server boolean;
  v_updated_count integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0
  THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF p_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_control_input_status';
  END IF;
  IF p_input_ids IS NULL
    OR cardinality(p_input_ids) < 1
    OR cardinality(p_input_ids) > 5000
    OR EXISTS (
      SELECT 1
      FROM unnest(p_input_ids) AS requested(input_id)
      WHERE requested.input_id IS NULL OR requested.input_id <= 0
    )
  THEN
    RAISE EXCEPTION 'invalid_control_input_ids';
  END IF;

  SELECT array_agg(DISTINCT requested.input_id ORDER BY requested.input_id)
  INTO v_input_ids
  FROM unnest(p_input_ids) AS requested(input_id);
  v_from_statuses := CASE p_status
    WHEN 'tạm dừng' THEN ARRAY['chờ xử lý']
    ELSE ARRAY['tạm dừng', 'hoàn thành']
  END;

  -- Optimistic tenant/owner read. The authoritative check is repeated while
  -- holding both the campaign and account rows below.
  SELECT
    campaign.status,
    account.flatform_type,
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false)
  INTO
    v_campaign_status,
    v_account_platform,
    v_is_zalo_show_web,
    v_is_zalo_server
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'campaign_not_found'
    );
  END IF;
  IF v_account_platform = 'zalo'
    AND (v_is_zalo_show_web OR NOT v_is_zalo_server)
  THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'account_not_server'
    );
  ELSIF v_account_platform NOT IN ('zalo', 'sms') THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'invalid_owner'
    );
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Keep the established input -> campaign -> account lock order shared with
  -- SMS completion recording and the other control-web mutations.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND input_data.id = ANY(v_input_ids)
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT
    campaign.status,
    account.flatform_type,
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false)
  INTO
    v_campaign_status,
    v_account_platform,
    v_is_zalo_show_web,
    v_is_zalo_server
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'campaign_not_found'
    );
  END IF;
  IF v_account_platform = 'zalo'
    AND (v_is_zalo_show_web OR NOT v_is_zalo_server)
  THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'account_not_server'
    );
  ELSIF v_account_platform NOT IN ('zalo', 'sms') THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'invalid_owner'
    );
  END IF;
  -- An explicit selected-input rerun matches desktop. This changes input rows
  -- only: it never resumes the campaign or account, including completed campaigns.

  UPDATE public.auto_campaign_input_data AS input_data
  SET
    status = p_status,
    note = CASE WHEN p_note IS NULL THEN input_data.note ELSE p_note END
  WHERE input_data.campaign_id = p_campaign_id
    AND input_data.id = ANY(v_input_ids)
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = ANY(v_from_statuses);
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'updated', true,
    'updated_count', v_updated_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_device_presence(p_username text, p_password text, p_instance_id uuid, p_device jsonb, p_ended boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
AS $function$
DECLARE s public.org_staff%ROWTYPE; stamp timestamptz;
BEGIN
  IF p_instance_id IS NULL OR p_ended IS NULL OR jsonb_typeof(p_device) IS DISTINCT FROM 'object'
     OR coalesce(p_device->>'fingerprintHash','') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid presence request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.org_staff WHERE username = btrim(p_username) FOR UPDATE;
  IF NOT FOUND OR NOT s.is_active OR s.password IS DISTINCT FROM p_password THEN RETURN false; END IF;
  stamp := clock_timestamp();
  -- An end arriving before the first heartbeat inserts a tombstone. A late
  -- heartbeat cannot resurrect it; a new login always uses another instance_id.
  INSERT INTO public.auto_staff_device_presence AS presence
    (instance_id,staff_id,organization_id,device_fingerprint_hash,device_label,device_platform,app_version,started_at,last_seen_at,ended_at)
  VALUES (p_instance_id,s.id,s.organization_id,p_device->>'fingerprintHash',left(p_device->>'label',255),
    left(p_device->>'platform',20),left(p_device->>'appVersion',50),stamp,stamp,CASE WHEN p_ended THEN stamp END)
  ON CONFLICT (instance_id) DO UPDATE SET
    last_seen_at = CASE WHEN p_ended THEN presence.last_seen_at ELSE stamp END,
    ended_at = CASE WHEN p_ended THEN stamp ELSE NULL END
  WHERE presence.staff_id = s.id AND presence.organization_id = s.organization_id
    AND presence.device_fingerprint_hash = p_device->>'fingerprintHash' AND presence.ended_at IS NULL;
  RETURN FOUND;
END;
$function$;

DROP FUNCTION IF EXISTS public.aka_agent_control_set_desktop_campaign_status(bigint, bigint, bigint, text);
DROP FUNCTION IF EXISTS public.aka_agent_control_desktop_activity(bigint, bigint, text[], bigint, integer);
DROP FUNCTION IF EXISTS public.aka_agent_control_web_desktop_accounts_policy(bigint);
DROP FUNCTION IF EXISTS private.aka_agent_web_desktop_accounts_policy(bigint);
ALTER TABLE public.auto_staff_device_presence DROP CONSTRAINT IF EXISTS auto_staff_device_presence_runtime_state_check;
ALTER TABLE public.auto_staff_device_presence DROP COLUMN IF EXISTS runtime_state, DROP COLUMN IF EXISTS runtime_state_at;
DELETE FROM public.auto_system_settings WHERE key = 'web.desktop_accounts';

DO $postflight$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_authenticate_control_session(text)', 'c748df75349ebeef58c3c8f120439b0b', 'de8f93ee545bca94a199b2dffb9fe324'),
    ('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)', '761108afe53ff4046efe0cd247846d10', '6b148777006903e4830925c55616820b'),
    ('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])', '12d454fbc38217dea3497addd39ed832', 'a2bc3f7cae264e647ac576c9895e840f'),
    ('public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)', '1275ad05d4dd184f5f6d9cd937caa21c', '26875e2b1652ca56cc8e59460df8cae1'),
    ('public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)', 'c1673974d0982ce6a731741072ca5338', '61a6b5c855fbcf86cafaf3c3c7ce6f0a'),
    ('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', 'f285e48f4deaf2e1bf7896d7aeddbcf8', 'a86278195e18d1ef8d0091b41d1d0c5b'),
    ('public.delete_control_campaign_atomic(bigint,bigint,bigint)', '1955af1c590ec870cb098cde9dd0714b', '4cfcad941c3acf22e674a77b203d086d'),
    ('public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)', '0f22d3c6fe532176af0e3f38fd485f88', 'd283261c5e77558d10f5df86cd4d1127'),
    ('public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)', 'a98a23f8e7f2e1e6582449f7ed45fb45', 'd61093635f226751c4a311840c6b3e29'),
    ('public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)', 'b504f4928a9dd271dec783796a7a0374', '478aa4281c683686437f31947bb760b1')
  ) AS x(signature, source_md5, target_md5) LOOP
    IF md5(pg_get_functiondef(r.signature::regprocedure)) IS DISTINCT FROM r.source_md5 THEN
      RAISE EXCEPTION 'v461_rollback_postflight:%', r.signature;
    END IF;
  END LOOP;
END
$postflight$;
COMMIT;

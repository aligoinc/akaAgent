-- Rollback v476: khôi phục 6 định nghĩa live trước v476, bỏ 2 hàm chính sách mới và khoá cấu hình.
-- File sinh tự động bởi scripts/build-v476-sql.py từ baseline.sql; đừng sửa tay.
-- Chỉ chạy khi 6 hàm đang ở đúng bản v476 (hoặc đã về baseline); lệch thì dừng, không đổi gì.
-- Trước khi chạy: đặt 'web.facebook_campaigns' enabled=false (Web/iOS mới ngừng nhận dòng Facebook)
-- và deploy lại Control API không gọi aka_agent_control_web_facebook_campaigns_policy.
-- CREATE OR REPLACE nên PostgREST nạp lại schema: chỉ chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE v476_rollback_attrs ON COMMIT DROP AS
SELECT p.oid::regprocedure::text AS signature, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text AS acl,
  pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p
WHERE p.oid IN (
    'public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])'::regprocedure,
    'public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)'::regprocedure,
    'public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)'::regprocedure,
    'public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)'::regprocedure,
    'public.delete_control_campaign_atomic(bigint,bigint,bigint)'::regprocedure,
    'public.aka_agent_authenticate_control_session(text)'::regprocedure
);

DO $guard$
DECLARE r record; checksum text; at_baseline integer := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])', 'a2bc3f7cae264e647ac576c9895e840f', '367cf7ba9d72aff72c4907586cf1c3ba'),
    ('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)', '6b148777006903e4830925c55616820b', 'db8942b09904e535987b94745b159ca3'),
    ('public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)', '214999ca7a2830b2a0b85389a0325fbf', '6030f0d9c8429e36955a405920f751f9'),
    ('public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'ea05f7ca98ceb9c8794c447abe79dc7c', '87f7002ac924f647896a7635663562b5'),
    ('public.delete_control_campaign_atomic(bigint,bigint,bigint)', '4cfcad941c3acf22e674a77b203d086d', '2af929cc5e02683e5e9dc16a48cc9bac'),
    ('public.aka_agent_authenticate_control_session(text)', '2c10aa78ac5e4ab8069c741b356e88c8', '692e2a068ce51377f6bd71fec20a8b0c')
  ) AS x(signature, source_md5, target_md5) LOOP
    checksum := md5(pg_get_functiondef(r.signature::regprocedure));
    IF checksum NOT IN (r.source_md5, r.target_md5) THEN
      RAISE EXCEPTION 'v476_rollback_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF checksum = r.source_md5 THEN at_baseline := at_baseline + 1; END IF;
  END LOOP;
  IF at_baseline = 6 AND to_regprocedure('public.aka_agent_control_web_facebook_campaigns_policy(bigint)') IS NULL THEN
    RAISE NOTICE 'v476 đã ở baseline; rollback không đổi định nghĩa nào.';
  END IF;
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
  v_web_desktop_policy jsonb := '{}'::jsonb;
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

  v_web_desktop_policy := private.aka_agent_web_desktop_accounts_policy(v_staff.organization_id);
  -- Tổ chức chỉ có gói Zalo Desktop vào Web/PWA/iOS khi chính sách bật rõ desktopOnlyLogin (iOS: API chỉ nhận bản gửi header Desktop).
  IF NOT v_zalo_server_enabled AND NOT v_sms_enabled AND NOT (
    v_zalo_qr_enabled
    AND v_session.client_type IN ('web', 'pwa', 'native')
    AND COALESCE((v_web_desktop_policy->>'desktopOnlyLogin')::boolean, false)
  ) THEN
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
    'web_desktop_accounts', v_web_desktop_policy,
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
$function$
;

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
      CASE WHEN a.flatform_type = 'zalo' AND a.is_zalo_server IS NOT TRUE THEN 'desktop' ELSE 'web' END AS runtime_target,
      coalesce(c.schedule, c.original_schedule, '1970-01-01Z'::timestamptz) AS send_time,
      CASE WHEN c.status IN ('tạm dừng', 'hoàn thành') THEN coalesce(c.last_run_at, c.schedule, c.original_schedule, '1970-01-01Z'::timestamptz)
        ELSE coalesce(c.schedule, c.original_schedule, '1970-01-01Z'::timestamptz) END AS sort_time,
      CASE c.status WHEN 'đang chạy' THEN 0 WHEN 'chờ xử lý' THEN 1 WHEN 'tạm dừng' THEN 2 WHEN 'hoàn thành' THEN 3 ELSE 99 END AS rank
    FROM public.auto_campaigns c
    JOIN public.auto_accounts a ON a.id = c.account_id
      AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
      AND (a.flatform_type = ANY(p_platforms) OR (a.flatform_type = 'zalo' AND p_platforms && ARRAY['zalo_qr','zalo_web']::text[]))
      AND (a.flatform_type = 'sms' OR (a.flatform_type = 'zalo' AND (('zalo' = ANY(p_platforms) AND a.is_zalo_show_web = false AND a.is_zalo_server = true) OR ('zalo_qr' = ANY(p_platforms) AND a.is_zalo_show_web IS NOT TRUE AND a.is_zalo_server IS NOT TRUE) OR ('zalo_web' = ANY(p_platforms) AND a.is_zalo_show_web IS TRUE AND a.is_zalo_server IS NOT TRUE))))
  ), filtered AS NOT MATERIALIZED (
    SELECT id, status, rank, sort_time FROM scoped s
    WHERE (NOT v_apply_visibility OR NOT (coalesce(v_visibility->'hiddenActionIds','[]'::jsonb) ? s.action_id))
      AND (NOT p_filters ? 'platforms' OR p_filters->'platforms' ? s.flatform_type)
      AND (NOT p_filters ? 'runtimeTargets' OR p_filters->'runtimeTargets' ? s.runtime_target)
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
      a.flatform_type AS platform, (a.flatform_type = 'zalo' AND a.is_zalo_show_web = false AND a.is_zalo_server = true) AS "isZaloServer", (a.flatform_type = 'zalo' AND a.is_zalo_show_web IS TRUE) AS "isZaloShowWeb", (c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL) AS "runtimeBusy",
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
$function$
;

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
  v_presence jsonb;
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
      AND (a.flatform_type=ANY(p_platforms) OR (a.flatform_type='zalo' AND p_platforms && ARRAY['zalo_qr','zalo_web']::text[]))
      AND public.aka_agent_app_access_account_allowed(a.id,'akaAgent')
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND (('zalo'=ANY(p_platforms) AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE) OR ('zalo_qr'=ANY(p_platforms) AND a.is_zalo_server IS NOT TRUE AND a.is_zalo_show_web IS NOT TRUE) OR ('zalo_web'=ANY(p_platforms) AND a.is_zalo_server IS NOT TRUE AND a.is_zalo_show_web IS TRUE))));
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
        'has_zalo_session',CASE WHEN a.flatform_type='zalo' AND (v_chat OR a.is_zalo_server IS NOT TRUE) THEN a.login_status IS NOT DISTINCT FROM 'đã đăng nhập'
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
      AND (a.flatform_type=ANY(p_platforms) OR (a.flatform_type='zalo' AND p_platforms && ARRAY['zalo_qr','zalo_web']::text[]))
      AND public.aka_agent_app_access_account_allowed(a.id,'akaAgent')
      AND (p_account_ids IS NULL OR a.id=ANY(p_account_ids))
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND (('zalo'=ANY(p_platforms) AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE) OR ('zalo_qr'=ANY(p_platforms) AND a.is_zalo_server IS NOT TRUE AND a.is_zalo_show_web IS NOT TRUE) OR ('zalo_web'=ANY(p_platforms) AND a.is_zalo_server IS NOT TRUE AND a.is_zalo_show_web IS TRUE))))
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
      AND (a.flatform_type=ANY(p_platforms) OR (a.flatform_type='zalo' AND p_platforms && ARRAY['zalo_qr','zalo_web']::text[]))
      AND public.aka_agent_app_access_account_allowed(a.id,'akaAgent')
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND (('zalo'=ANY(p_platforms) AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE) OR ('zalo_qr'=ANY(p_platforms) AND a.is_zalo_server IS NOT TRUE AND a.is_zalo_show_web IS NOT TRUE) OR ('zalo_web'=ANY(p_platforms) AND a.is_zalo_server IS NOT TRUE AND a.is_zalo_show_web IS TRUE))));
  END IF;
  IF p_view IN ('accounts','campaigns') AND p_platforms && ARRAY['zalo_qr','zalo_web']::text[] THEN
    SELECT jsonb_build_object(
      'online', presence.ended_at IS NULL AND presence.last_seen_at > now() - interval '120 seconds',
      'startedAt', presence.started_at, 'lastSeenAt', presence.last_seen_at, 'endedAt', presence.ended_at,
      'appVersion', presence.app_version, 'deviceLabel', presence.device_label,
      'devicePlatform', presence.device_platform, 'runtime', presence.runtime_state,
      'runtimeAt', presence.runtime_state_at, 'checkedAt', now())
    INTO v_presence
    FROM auto_staff_device_presence presence
    WHERE presence.staff_id=p_staff_id AND presence.organization_id=p_organization_id
    ORDER BY presence.last_seen_at DESC NULLS LAST, presence.started_at DESC
    LIMIT 1;
    v_presence := coalesce(v_presence, jsonb_build_object('online', false, 'checkedAt', now()));
  END IF;
  RETURN jsonb_build_object('items',v_items,'runningCampaigns',v_running,'desktopPresence',v_presence,'catalogVersion',v_catalog_version,
    'catalog',CASE WHEN v_catalog_version IS DISTINCT FROM p_catalog_version THEN v_catalog ELSE NULL END);
END
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_control_desktop_activity(p_staff_id bigint, p_organization_id bigint, p_platforms text[], p_after_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_limit integer := least(greatest(COALESCE(p_limit, 100), 1), 200);
  v_items jsonb;
  v_cursor bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_platforms IS NULL OR (p_after_id IS NOT NULL AND p_after_id < 0) THEN
    RAISE EXCEPTION 'Invalid desktop activity scope';
  END IF;
  IF NOT (p_platforms && ARRAY['zalo_qr', 'zalo_web']::text[]) THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'cursor', p_after_id);
  END IF;

  WITH scoped AS MATERIALIZED (
    SELECT c.id, c.name, c.account_id, a.name AS account_name, a.is_zalo_show_web IS TRUE AS is_browser
    FROM public.auto_campaigns AS c
    JOIN public.auto_accounts AS a ON a.id = c.account_id AND a.staff_id = c.staff_id
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
      AND a.organization_id = p_organization_id
      AND a.flatform_type = 'zalo' AND a.is_zalo_server IS NOT TRUE
      AND (('zalo_qr' = ANY(p_platforms) AND a.is_zalo_show_web IS NOT TRUE)
        OR ('zalo_web' = ANY(p_platforms) AND a.is_zalo_show_web IS TRUE))
      AND (c.status = 'đang chạy' OR c.last_run_at > now() - interval '30 minutes'
        OR c.updated_at > now() - interval '30 minutes')
    ORDER BY (c.status = 'đang chạy') DESC, c.last_run_at DESC NULLS LAST, c.id DESC
    LIMIT 50
  ), picked AS MATERIALIZED (
    SELECT row.id, row.campaign_id, row.log, row.created_at
    FROM scoped AS s
    CROSS JOIN LATERAL (
      SELECT l.id, l.campaign_id, l.log, l.created_at
      FROM public.auto_campaign_logs AS l
      WHERE l.campaign_id = s.id
        AND (p_after_id IS NULL OR l.id > p_after_id OR l.created_at >= now() - interval '10 seconds')
      ORDER BY l.id DESC
      LIMIT v_limit
    ) AS row
    ORDER BY row.id DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id::text, 'campaignId', p.campaign_id, 'campaignName', s.name,
      'accountId', s.account_id, 'accountName', s.account_name,
      'accountType', CASE WHEN s.is_browser THEN 'zalo_browser' ELSE 'zalo_qr' END,
      'log', p.log, 'createdAt', p.created_at
    ) ORDER BY p.id), '[]'::jsonb),
    max(p.id)
  INTO v_items, v_cursor
  FROM picked AS p JOIN scoped AS s ON s.id = p.campaign_id;

  RETURN jsonb_build_object('items', v_items, 'cursor', COALESCE(greatest(v_cursor, p_after_id), p_after_id));
END
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_control_set_desktop_campaign_status(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_target_status text)
 RETURNS TABLE(ok boolean, reason text, campaign_id bigint, campaign_status text, account_status text, pause_pending boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s'
AS $function$
#variable_conflict use_column
DECLARE
  v_target text := btrim(COALESCE(p_target_status, ''));
  v_status text;
  v_account_status text;
  v_account_active boolean;
  v_account_deleted boolean;
  v_claim uuid;
  v_unit uuid;
  v_campaign_name text;
  v_account_name text;
  v_busy boolean;
  v_message text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_target NOT IN ('tạm dừng', 'chờ xử lý') THEN
    RAISE EXCEPTION 'invalid_desktop_campaign_status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id AND staff.organization_id = p_organization_id AND staff.is_active IS TRUE
  ) THEN
    RETURN QUERY SELECT false, 'inactive_control_staff', p_campaign_id, NULL::text, NULL::text, false;
    RETURN;
  END IF;

  -- Cùng thứ tự khóa với aka_agent_set_desktop_campaign_status_v2 và các RPC Control.
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.status, account.status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    campaign.runtime_claim_token, campaign.runtime_unit_token,
    nullif(btrim(COALESCE(campaign.name, '')), ''), nullif(btrim(COALESCE(account.name, '')), '')
  INTO v_status, v_account_status, v_account_active, v_account_deleted,
    v_claim, v_unit, v_campaign_name, v_account_name
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND account.flatform_type = 'zalo'
    AND COALESCE(account.is_zalo_server, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_campaign_id, NULL::text, NULL::text, false;
    RETURN;
  END IF;
  v_busy := v_claim IS NOT NULL OR v_unit IS NOT NULL;

  IF v_target = 'tạm dừng' THEN
    IF v_status = 'tạm dừng' THEN
      RETURN QUERY SELECT true, 'already_target', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    IF v_status NOT IN ('chờ xử lý', 'đang chạy') THEN
      RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    -- Giống Zalo Server: ghi trạng thái bền vững; scheduler Desktop đọc lại trước mỗi
    -- mục tiêu và dừng ở ranh giới, mục tiêu đang gửi được hoàn tất. Không chạm lease.
    UPDATE public.auto_campaigns AS campaign
    SET status = 'tạm dừng',
      note = CASE
        WHEN campaign.data_target_source_mode = 'data_group'
          AND btrim(COALESCE(campaign.note, '')) IN ('Chờ data phù hợp', 'Chờ data mới')
        THEN campaign.note
        ELSE NULL
      END,
      updated_at = v_now
    WHERE campaign.id = p_campaign_id
      AND campaign.status IN ('chờ xử lý', 'đang chạy');
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    v_busy := v_busy OR v_status = 'đang chạy';
    v_message := CASE WHEN v_busy
      THEN '⏸ Đã yêu cầu tạm dừng từ Web. App Desktop sẽ dừng sau mục tiêu đang xử lý.'
      ELSE '⏸ Đã tạm dừng chiến dịch từ Web.' END;
    v_status := 'tạm dừng';
  ELSE
    IF v_status = 'chờ xử lý' THEN
      RETURN QUERY SELECT true, 'already_target', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    IF v_status = 'đang chạy' OR v_busy THEN
      RETURN QUERY SELECT false, 'runtime_busy', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    IF v_status IS DISTINCT FROM 'tạm dừng' THEN
      RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    IF v_account_deleted THEN
      RETURN QUERY SELECT false, 'account_deleted', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    IF NOT v_account_active THEN
      RETURN QUERY SELECT false, 'account_inactive', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    UPDATE public.auto_campaigns AS campaign
    SET status = 'chờ xử lý', note = NULL, updated_at = v_now
    WHERE campaign.id = p_campaign_id
      AND campaign.status = 'tạm dừng'
      AND campaign.runtime_claim_token IS NULL
      AND campaign.runtime_unit_token IS NULL;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'runtime_busy', p_campaign_id, v_status, v_account_status, v_busy;
      RETURN;
    END IF;
    v_message := '▶️ Đã tiếp tục chiến dịch từ Web. App Desktop sẽ chạy khi đến lịch.';
    v_status := 'chờ xử lý';
  END IF;

  -- Cùng khóa với append_auto_campaign_log để con trỏ lịch sử không nhảy cóc.
  PERFORM pg_advisory_xact_lock(hashtextextended('auto_campaign_logs:' || p_campaign_id::text, 0));
  INSERT INTO public.auto_campaign_logs (campaign_id, log)
  VALUES (
    p_campaign_id,
    to_char(v_now AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS DD/MM/YYYY') || ' - '
      || concat_ws(' - ', v_account_name, v_campaign_name, v_message)
  );

  RETURN QUERY SELECT true, 'updated', p_campaign_id, v_status, v_account_status, v_busy;
END
$function$
;

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
        AND NOT (COALESCE(account.is_zalo_show_web, false)
        AND COALESCE(account.is_zalo_server, false))
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
        AND NOT (COALESCE(account.is_zalo_show_web, false)
        AND COALESCE(account.is_zalo_server, false))
      )
    )
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;
  IF v_campaign_status = 'đang chạy' THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'campaign_running');
  END IF;
  -- Desktop còn giữ claim/unit lease: xóa sẽ để lại lease mồ côi khóa cổng bảo trì.
  IF EXISTS (
    SELECT 1 FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.id = p_campaign_id
      AND account.flatform_type = 'zalo'
      AND COALESCE(account.is_zalo_server, false) = false
      AND (campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)
  ) THEN
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
$function$
;

DROP FUNCTION IF EXISTS public.aka_agent_control_web_facebook_campaigns_policy(bigint);
DROP FUNCTION IF EXISTS private.aka_agent_web_facebook_campaigns_policy(bigint);
DELETE FROM public.auto_system_settings WHERE key = 'web.facebook_campaigns';

DO $postflight$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])', 'a2bc3f7cae264e647ac576c9895e840f', '367cf7ba9d72aff72c4907586cf1c3ba'),
    ('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)', '6b148777006903e4830925c55616820b', 'db8942b09904e535987b94745b159ca3'),
    ('public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)', '214999ca7a2830b2a0b85389a0325fbf', '6030f0d9c8429e36955a405920f751f9'),
    ('public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', 'ea05f7ca98ceb9c8794c447abe79dc7c', '87f7002ac924f647896a7635663562b5'),
    ('public.delete_control_campaign_atomic(bigint,bigint,bigint)', '4cfcad941c3acf22e674a77b203d086d', '2af929cc5e02683e5e9dc16a48cc9bac'),
    ('public.aka_agent_authenticate_control_session(text)', '2c10aa78ac5e4ab8069c741b356e88c8', '692e2a068ce51377f6bd71fec20a8b0c')
  ) AS x(signature, source_md5, target_md5) LOOP
    IF md5(pg_get_functiondef(r.signature::regprocedure)) IS DISTINCT FROM r.source_md5 THEN
      RAISE EXCEPTION 'v476_rollback_postflight:%', r.signature;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM v476_rollback_attrs a JOIN pg_proc p ON p.oid = a.signature::regprocedure
    WHERE (p.prosecdef, p.provolatile, p.proconfig, p.proacl::text, pg_get_userbyid(p.proowner))
      IS DISTINCT FROM (a.prosecdef, a.provolatile, a.proconfig, a.acl, a.owner)
  ) THEN
    RAISE EXCEPTION 'v476_rollback_attributes_changed';
  END IF;
END
$postflight$;
COMMIT;

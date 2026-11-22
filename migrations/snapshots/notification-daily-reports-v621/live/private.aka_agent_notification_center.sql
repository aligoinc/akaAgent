CREATE OR REPLACE FUNCTION private.aka_agent_notification_center(p_staff_id bigint, p_organization_id bigint, p_client text, p_action text, p_payload jsonb, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
  s public.auto_email_notification_settings%ROWTYPE;
  v_found boolean; v_current_rev bigint; v_rev bigint;
  v_email_enabled boolean; v_push_enabled boolean; v_recipients text[]; v_old_recipients text[]; v_verified text[]; v_email text;
  v_c jsonb; v_a jsonb; v_r jsonb; v_g jsonb;
  v_c_enabled boolean; v_c_email boolean; v_c_push boolean; v_c_statuses jsonb; v_c_ids jsonb; v_c_cool integer;
  v_a_enabled boolean; v_a_email boolean; v_a_push boolean; v_a_login jsonb; v_a_run jsonb; v_a_ids jsonb; v_a_cool integer;
  v_r_enabled boolean; v_r_email boolean; v_r_push boolean; v_r_days smallint[]; v_r_times time without time zone[]; v_r_idle boolean;
  v_g_enabled boolean; v_g_email boolean; v_g_push boolean; v_g_ids jsonb; v_g_actions jsonb; v_g_bucket integer; v_g_shared boolean;
  v_limit integer; v_cursor_at timestamptz; v_cursor_id bigint; v_type text; v_unread boolean; v_items jsonb; v_count integer;
  v_id bigint; v_installation uuid; v_token text; v_bundle text; v_env text; v_rows integer; v_session record; v_ids bigint[];
  v_n public.auto_notifications%ROWTYPE; v_tz text; v_explicit boolean; v_active boolean;
BEGIN
  IF p_client NOT IN ('web', 'ios', 'desktop') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_client'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_staff st WHERE st.id = p_staff_id AND st.organization_id = p_organization_id
                  AND st.is_active IS TRUE AND st.deleted_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_access_denied';
  END IF;

  IF p_action = 'get_settings' THEN
    RETURN private.aka_agent_notification_settings_json(p_staff_id, p_session_id);

  ELSIF p_action = 'save_settings' THEN
    IF jsonb_typeof(v_p -> 'revision') <> 'number' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_revision_required'; END IF;
    v_rev := (v_p ->> 'revision')::bigint;
    SELECT * INTO s FROM public.auto_email_notification_settings WHERE staff_id = p_staff_id FOR UPDATE;
    v_found := FOUND;
    v_current_rev := CASE WHEN v_found AND s.is_delete IS NOT TRUE THEN s.revision ELSE 0 END;
    IF v_rev IS DISTINCT FROM v_current_rev THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'notification_settings_conflict';
    END IF;
    v_tz := CASE WHEN v_found THEN s.timezone ELSE 'Asia/Ho_Chi_Minh' END;
    v_old_recipients := CASE WHEN v_found AND s.is_delete IS NOT TRUE THEN s.recipient_emails ELSE '{}'::text[] END;
    -- Kênh
    v_email_enabled := private.aka_agent_notification_flag(v_p #> '{channels,email,enabled}', CASE WHEN v_found THEN s.is_enabled ELSE false END);
    v_push_enabled := private.aka_agent_notification_flag(v_p #> '{channels,push,enabled}', CASE WHEN v_found THEN s.push_enabled ELSE false END);
    IF v_p #> '{channels,email,recipients}' IS NULL THEN
      v_recipients := v_old_recipients;
    ELSE
      IF jsonb_typeof(v_p #> '{channels,email,recipients}') <> 'array' OR jsonb_array_length(v_p #> '{channels,email,recipients}') > 5
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_p #> '{channels,email,recipients}') e
                     WHERE jsonb_typeof(e) <> 'string' OR char_length(btrim(e #>> '{}')) > 254
                        OR lower(btrim(e #>> '{}')) !~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_email';
      END IF;
      SELECT coalesce(array_agg(e ORDER BY o), '{}'::text[]) INTO v_recipients
        FROM (SELECT lower(btrim(x #>> '{}')) AS e, min(o) AS o
                FROM jsonb_array_elements(v_p #> '{channels,email,recipients}') WITH ORDINALITY AS t(x, o) GROUP BY 1) y;
    END IF;
    IF v_email_enabled AND cardinality(v_recipients) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_email_required';
    END IF;
    v_verified := ARRAY(SELECT e FROM unnest(CASE WHEN v_found THEN s.verified_emails ELSE '{}'::text[] END) AS e WHERE e = ANY (v_recipients));
    -- Chiến dịch
    v_c := coalesce(v_p #> '{subscriptions,campaignStatus}', private.aka_agent_notification_subscription_json(p_staff_id, 'campaign.status_changed'));
    v_c_enabled := private.aka_agent_notification_flag(v_c -> 'enabled', false);
    v_c_email := private.aka_agent_notification_flag(v_c -> 'email', false);
    v_c_push := private.aka_agent_notification_flag(v_c -> 'push', false);
    v_c_statuses := private.aka_agent_notification_string_set(v_c -> 'toStatuses', ARRAY['hoàn thành','tạm dừng','đang chạy','chờ xử lý'],
                                                             private.aka_agent_notification_default_filters('campaign.status_changed') -> 'toStatuses');
    IF v_c_enabled AND jsonb_array_length(v_c_statuses) = 0 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter'; END IF;
    v_c_ids := private.aka_agent_notification_valid_ids(p_staff_id, 'campaign', v_c -> 'campaignIds');
    v_c_cool := private.aka_agent_notification_cooldown(v_c -> 'cooldownMinutes');
    -- Tài khoản
    v_a := coalesce(v_p #> '{subscriptions,accountStatus}', private.aka_agent_notification_subscription_json(p_staff_id, 'account.status_changed'));
    v_a_enabled := private.aka_agent_notification_flag(v_a -> 'enabled', false);
    v_a_email := private.aka_agent_notification_flag(v_a -> 'email', false);
    v_a_push := private.aka_agent_notification_flag(v_a -> 'push', false);
    v_a_login := private.aka_agent_notification_string_set(v_a -> 'loginEvents', ARRAY['logout','checkpoint','login'],
                                                          private.aka_agent_notification_default_filters('account.status_changed') -> 'loginEvents');
    v_a_run := private.aka_agent_notification_string_set(v_a -> 'runStatuses', ARRAY['chờ xử lý','đang chạy','tạm dừng'], '[]'::jsonb);
    IF v_a_enabled AND jsonb_array_length(v_a_login) + jsonb_array_length(v_a_run) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter';
    END IF;
    v_a_ids := private.aka_agent_notification_valid_ids(p_staff_id, 'account', v_a -> 'accountIds');
    v_a_cool := private.aka_agent_notification_cooldown(v_a -> 'cooldownMinutes');
    -- Báo cáo
    v_r := coalesce(v_p #> '{subscriptions,scheduledReport}', private.aka_agent_notification_subscription_json(p_staff_id, 'report.scheduled'));
    v_r_enabled := private.aka_agent_notification_flag(v_r -> 'enabled', false);
    v_r_email := private.aka_agent_notification_flag(v_r -> 'email', false);
    v_r_push := private.aka_agent_notification_flag(v_r -> 'push', false);
    v_r_idle := private.aka_agent_notification_flag(v_r -> 'skipWhenIdle', false);
    IF jsonb_typeof(v_r -> 'weekDays') IS DISTINCT FROM 'array' OR jsonb_array_length(v_r -> 'weekDays') NOT BETWEEN 1 AND 7
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_r -> 'weekDays') e WHERE jsonb_typeof(e) <> 'number' OR (e #>> '{}') !~ '^[1-7]$')
       OR jsonb_typeof(v_r -> 'times') IS DISTINCT FROM 'array' OR jsonb_array_length(v_r -> 'times') NOT BETWEEN 1 AND 6
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_r -> 'times') e WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_schedule';
    END IF;
    SELECT array_agg(DISTINCT (e #>> '{}')::smallint ORDER BY (e #>> '{}')::smallint) INTO v_r_days FROM jsonb_array_elements(v_r -> 'weekDays') e;
    SELECT array_agg(DISTINCT (e #>> '{}')::time ORDER BY (e #>> '{}')::time) INTO v_r_times FROM jsonb_array_elements(v_r -> 'times') e;
    IF cardinality(v_r_times) <> jsonb_array_length(v_r -> 'times') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_schedule'; END IF;
    -- Nhóm data
    v_g := coalesce(v_p #> '{subscriptions,dataGroupMembership}', private.aka_agent_notification_subscription_json(p_staff_id, 'data_group.membership_changed'));
    v_g_enabled := private.aka_agent_notification_flag(v_g -> 'enabled', false);
    v_g_email := private.aka_agent_notification_flag(v_g -> 'email', false);
    v_g_push := private.aka_agent_notification_flag(v_g -> 'push', false);
    v_g_shared := private.aka_agent_notification_flag(v_g -> 'includeSharedGroups', false);
    v_g_actions := private.aka_agent_notification_string_set(v_g -> 'actions', ARRAY['added','removed'], '["added","removed"]'::jsonb);
    IF v_g_enabled AND jsonb_array_length(v_g_actions) = 0 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter'; END IF;
    IF v_g -> 'bucketMinutes' IS NULL THEN v_g_bucket := 5;
    ELSIF (v_g ->> 'bucketMinutes') IN ('5', '15', '30', '60') AND jsonb_typeof(v_g -> 'bucketMinutes') = 'number' THEN v_g_bucket := (v_g ->> 'bucketMinutes')::integer;
    ELSE RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter'; END IF;
    v_g_ids := private.aka_agent_notification_valid_ids(p_staff_id, 'group', v_g -> 'groupIds');

    PERFORM set_config('aka.notification_center_write', 'on', true);
    INSERT INTO public.auto_email_notification_settings AS es (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed,
           daily_report_enabled, daily_report_time, is_delete, push_enabled, revision, settings_version, timezone, verified_emails, updated_by_client, updated_at)
    VALUES (p_staff_id, p_organization_id, v_email_enabled, v_recipients,
            v_c_enabled AND v_c_email AND v_c_statuses ? 'hoàn thành', v_r_enabled AND v_r_email, v_r_times[1], false,
            v_push_enabled, 1, 2, v_tz, v_verified, p_client, v_now)
    ON CONFLICT (staff_id) DO UPDATE
       SET organization_id = EXCLUDED.organization_id, is_enabled = EXCLUDED.is_enabled, recipient_emails = EXCLUDED.recipient_emails,
           notify_campaign_completed = EXCLUDED.notify_campaign_completed, daily_report_enabled = EXCLUDED.daily_report_enabled,
           daily_report_time = EXCLUDED.daily_report_time, is_delete = false, push_enabled = EXCLUDED.push_enabled,
           revision = es.revision + 1, settings_version = 2, verified_emails = EXCLUDED.verified_emails,
           updated_by_client = EXCLUDED.updated_by_client, updated_at = EXCLUDED.updated_at;
    PERFORM private.aka_agent_notification_save_subscription(p_staff_id, p_organization_id, 'campaign.status_changed', v_c_enabled, v_c_email, v_c_push,
      jsonb_build_object('toStatuses', v_c_statuses, 'campaignIds', v_c_ids), v_c_cool, NULL, NULL, v_tz);
    PERFORM private.aka_agent_notification_save_subscription(p_staff_id, p_organization_id, 'account.status_changed', v_a_enabled, v_a_email, v_a_push,
      jsonb_build_object('loginEvents', v_a_login, 'runStatuses', v_a_run, 'accountIds', v_a_ids), v_a_cool, NULL, NULL, v_tz);
    PERFORM private.aka_agent_notification_save_subscription(p_staff_id, p_organization_id, 'report.scheduled', v_r_enabled, v_r_email, v_r_push,
      jsonb_build_object('skipWhenIdle', v_r_idle, 'maxCampaigns', 50), NULL, v_r_days, v_r_times, v_tz);
    PERFORM private.aka_agent_notification_save_subscription(p_staff_id, p_organization_id, 'data_group.membership_changed', v_g_enabled, v_g_email, v_g_push,
      jsonb_build_object('groupIds', v_g_ids, 'actions', v_g_actions, 'bucketMinutes', v_g_bucket, 'includeSharedGroups', v_g_shared), NULL, NULL, NULL, v_tz);
    PERFORM set_config('aka.notification_center_write', '', true);
    IF v_email_enabled THEN
      FOREACH v_email IN ARRAY v_recipients LOOP
        IF NOT (v_email = ANY (v_verified)) AND NOT (v_email = ANY (v_old_recipients)) THEN
          PERFORM private.aka_agent_notification_request_verification(p_staff_id, p_organization_id, v_email);
        END IF;
      END LOOP;
    END IF;
    RETURN private.aka_agent_notification_settings_json(p_staff_id, p_session_id);

  ELSIF p_action = 'list' THEN
    v_limit := least(greatest(coalesce((v_p ->> 'limit')::integer, 20), 1), 50);
    v_cursor_at := (v_p #>> '{cursor,createdAt}')::timestamptz;
    v_cursor_id := (v_p #>> '{cursor,id}')::bigint;
    v_type := nullif(v_p ->> 'type', '');
    IF v_type IS NOT NULL AND v_type NOT IN ('campaign.status_changed','account.status_changed','report.scheduled','data_group.membership_changed','system.test') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter';
    END IF;
    v_unread := coalesce((v_p ->> 'unreadOnly')::boolean, false);
    SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC, id DESC), '[]'::jsonb), count(*) INTO v_items, v_count
      FROM (SELECT n.id, n.created_at,
                   jsonb_build_object('id', n.id, 'eventType', n.event_type, 'severity', n.severity, 'title', n.app_title, 'body', n.app_body,
                     'occurredAt', n.occurred_at, 'createdAt', n.created_at, 'readAt', n.read_at, 'emailState', n.email_state, 'pushState', n.push_state,
                     'campaignId', n.campaign_id, 'accountId', n.account_id, 'dataGroupId', n.data_group_id, 'entityKey', n.entity_key) AS item
              FROM public.auto_notifications n
             WHERE n.staff_id = p_staff_id AND n.content_status = 'ready' AND n.event_type <> 'system.verify_email'
               AND (v_type IS NULL OR n.event_type = v_type)
               AND (NOT v_unread OR n.read_at IS NULL)
               AND (v_cursor_at IS NULL OR (n.created_at, n.id) < (v_cursor_at, coalesce(v_cursor_id, 9223372036854775807)))
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT v_limit + 1) x;
    IF v_count > v_limit THEN
      v_items := (SELECT jsonb_agg(e ORDER BY o) FROM jsonb_array_elements(v_items) WITH ORDINALITY t(e, o) WHERE o <= v_limit);
    END IF;
    RETURN jsonb_build_object('items', v_items,
      'nextCursor', CASE WHEN v_count > v_limit THEN jsonb_build_object('createdAt', v_items -> (v_limit - 1) ->> 'createdAt', 'id', (v_items -> (v_limit - 1) ->> 'id')::bigint) END,
      'unreadCount', private.aka_agent_notification_unread_count(p_staff_id));

  ELSIF p_action = 'detail' THEN
    v_id := (v_p ->> 'id')::bigint;
    SELECT * INTO v_n FROM public.auto_notifications WHERE id = v_id AND staff_id = p_staff_id AND content_status = 'ready' AND event_type <> 'system.verify_email';
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'notification_not_found'; END IF;
    RETURN jsonb_build_object('id', v_n.id, 'eventType', v_n.event_type, 'severity', v_n.severity, 'title', v_n.app_title, 'body', v_n.app_body,
      'emailSubject', v_n.email_subject, 'occurredAt', v_n.occurred_at, 'createdAt', v_n.created_at, 'readAt', v_n.read_at,
      'campaignId', v_n.campaign_id, 'accountId', v_n.account_id, 'dataGroupId', v_n.data_group_id, 'entityKey', v_n.entity_key,
      'content', v_n.content_snapshot, 'templateVersion', v_n.template_version, 'emailState', v_n.email_state, 'pushState', v_n.push_state,
      'suppressedCount', coalesce((v_n.payload ->> 'suppressedCount')::integer, 0), 'mergedCount', coalesce((v_n.payload ->> 'mergedCount')::integer, 0),
      'deliveries', (SELECT coalesce(jsonb_agg(jsonb_build_object('channel', d.channel, 'status', d.status, 'sentAt', d.sent_at, 'attempts', d.attempt_count,
                       'errorCode', d.last_error_code,
                       'destination', CASE WHEN d.channel = 'email' THEN private.aka_agent_notification_mask_email(d.destination)
                                           ELSE coalesce(dv.device_name, dv.device_model, 'iPhone') END) ORDER BY d.channel, d.id), '[]'::jsonb)
                       FROM public.auto_notification_deliveries d LEFT JOIN public.auto_notification_devices dv ON dv.id = d.device_id
                      WHERE d.notification_id = v_n.id));

  ELSIF p_action = 'mark_read' THEN
    IF v_p ? 'ids' THEN
      IF jsonb_typeof(v_p -> 'ids') <> 'array' OR jsonb_array_length(v_p -> 'ids') NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_ids';
      END IF;
      SELECT array_agg((e #>> '{}')::bigint) INTO v_ids FROM jsonb_array_elements(v_p -> 'ids') e;
      UPDATE public.auto_notifications SET read_at = v_now, updated_at = v_now
       WHERE staff_id = p_staff_id AND id = ANY (v_ids) AND read_at IS NULL;
    ELSIF v_p ? 'upToId' THEN
      -- "Đánh dấu đã đọc tất cả" theo đúng thứ tự hộp thư (created_at, id) tới mục mới nhất đã thấy; tùy chọn chỉ một loại.
      v_type := nullif(v_p ->> 'type', '');
      IF v_type IS NOT NULL AND v_type NOT IN ('campaign.status_changed','account.status_changed','report.scheduled','data_group.membership_changed','system.test') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter';
      END IF;
      SELECT n.created_at, n.id INTO v_cursor_at, v_cursor_id FROM public.auto_notifications n
       WHERE n.id = (v_p ->> 'upToId')::bigint AND n.staff_id = p_staff_id AND n.content_status = 'ready';
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'notification_not_found'; END IF;
      UPDATE public.auto_notifications SET read_at = v_now, updated_at = v_now
       WHERE staff_id = p_staff_id AND read_at IS NULL AND content_status = 'ready'
         AND (v_type IS NULL OR event_type = v_type) AND (created_at, id) <= (v_cursor_at, v_cursor_id);
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_ids';
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'updated', v_rows, 'unreadCount', private.aka_agent_notification_unread_count(p_staff_id));

  ELSIF p_action = 'unread_count' THEN
    RETURN jsonb_build_object('unreadCount', private.aka_agent_notification_unread_count(p_staff_id));

  ELSIF p_action = 'register_device' THEN
    IF p_client <> 'ios' OR p_session_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_action_not_allowed'; END IF;
    SELECT * INTO v_session FROM public.auto_control_sessions
     WHERE id = p_session_id AND staff_id = p_staff_id AND client_type = 'native' AND revoked_at IS NULL AND expires_at > v_now;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_session_invalid'; END IF;
    BEGIN v_installation := (v_p ->> 'installationId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_device'; END;
    v_token := lower(nullif(btrim(v_p ->> 'pushToken'), ''));
    v_explicit := private.aka_agent_notification_flag(v_p -> 'explicit', false);
    v_bundle := v_p ->> 'bundleId';
    v_env := coalesce(v_p ->> 'apnsEnvironment', 'production');
    IF v_installation IS NULL OR v_bundle IS NULL OR v_bundle NOT IN ('net.akabiz.agent', 'net.akabiz.agent.dev')
       OR v_env NOT IN ('sandbox', 'production') OR (v_token IS NOT NULL AND v_token !~ '^[0-9a-f]{32,200}$')
       OR coalesce(v_p ->> 'permissionStatus', 'granted') NOT IN ('granted', 'denied', 'undetermined', 'provisional') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_device';
    END IF;
    IF v_token IS NOT NULL THEN
      UPDATE public.auto_notification_devices SET is_active = false, deactivated_reason = 'staff_changed', updated_at = v_now
       WHERE push_token = v_token AND is_active AND installation_id <> v_installation;
    END IF;
    INSERT INTO public.auto_notification_devices AS dv (staff_id, organization_id, control_session_id, installation_id, platform, device_name,
           device_model, os_version, app_version, bundle_id, push_token, apns_environment, permission_status, is_enabled, is_active,
           last_registered_at, updated_at)
    VALUES (p_staff_id, p_organization_id, p_session_id, v_installation, 'ios', left(v_p ->> 'deviceName', 120), left(v_p ->> 'deviceModel', 120),
            left(v_p ->> 'osVersion', 40), left(v_p ->> 'appVersion', 40), v_bundle, v_token, v_env, v_p ->> 'permissionStatus',
            true, true, v_now, v_now)
    ON CONFLICT (installation_id) DO UPDATE
       SET staff_id = EXCLUDED.staff_id, organization_id = EXCLUDED.organization_id, control_session_id = EXCLUDED.control_session_id,
           device_name = EXCLUDED.device_name, device_model = EXCLUDED.device_model, os_version = EXCLUDED.os_version,
           app_version = EXCLUDED.app_version, bundle_id = EXCLUDED.bundle_id, push_token = EXCLUDED.push_token,
           apns_environment = EXCLUDED.apns_environment, permission_status = EXCLUDED.permission_status,
           is_enabled = CASE WHEN dv.staff_id = EXCLUDED.staff_id THEN dv.is_enabled ELSE true END,
           -- Máy bị gỡ từ nơi khác chỉ bật lại khi người dùng tự bật trên chính máy đó (explicit); lần làm mới tự động thì giữ nguyên.
           is_active = NOT (dv.deactivated_reason = 'user_removed' AND dv.staff_id = EXCLUDED.staff_id AND NOT v_explicit),
           deactivated_reason = CASE WHEN dv.deactivated_reason = 'user_removed' AND dv.staff_id = EXCLUDED.staff_id AND NOT v_explicit
                                     THEN 'user_removed' END,
           failure_count = 0, last_registered_at = EXCLUDED.last_registered_at,
           updated_at = EXCLUDED.updated_at
    RETURNING dv.id, dv.is_active INTO v_id, v_active;
    RETURN jsonb_build_object('ok', true, 'deviceId', v_id, 'active', v_active);

  ELSIF p_action = 'unregister_device' THEN
    IF coalesce((v_p ->> 'current')::boolean, false) THEN
      IF p_client = 'desktop' OR p_session_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_action_not_allowed'; END IF;
      UPDATE public.auto_notification_devices SET is_active = false, deactivated_reason = 'logout', updated_at = v_now
       WHERE staff_id = p_staff_id AND control_session_id = p_session_id AND is_active;
    ELSE
      UPDATE public.auto_notification_devices SET is_active = false, deactivated_reason = 'user_removed', updated_at = v_now
       WHERE staff_id = p_staff_id AND id = (v_p ->> 'deviceId')::bigint AND is_active;
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'updated', v_rows);

  ELSIF p_action = 'set_device_enabled' THEN
    UPDATE public.auto_notification_devices SET is_enabled = private.aka_agent_notification_flag(v_p -> 'enabled', true), updated_at = v_now
     WHERE staff_id = p_staff_id AND id = (v_p ->> 'deviceId')::bigint AND is_active;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'notification_device_not_found'; END IF;
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'test' THEN
    IF NOT private.aka_agent_notification_enabled() THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'notification_center_disabled'; END IF;
    IF coalesce(v_p ->> 'channel', '') NOT IN ('email', 'push') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_channel'; END IF;
    IF (SELECT count(*) FROM public.auto_notifications WHERE staff_id = p_staff_id AND event_type = 'system.test' AND created_at > v_now - interval '10 minutes') >= 3 THEN
      RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'notification_test_rate_limited';
    END IF;
    INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, entity_key, occurred_at, deliver_after, dedupe_key, payload)
    VALUES (p_organization_id, p_staff_id, 'system.test', 'info', 'test:' || (v_p ->> 'channel'), v_now, v_now,
            format('ts:%s:%s', p_staff_id, gen_random_uuid()), jsonb_build_object('channel', v_p ->> 'channel', 'client', p_client))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'deliveryMode', private.aka_agent_notification_setting('notifications.delivery_mode', 'dry_run'));

  ELSIF p_action = 'resend_verification' THEN
    SELECT * INTO s FROM public.auto_email_notification_settings WHERE staff_id = p_staff_id AND is_delete IS NOT TRUE;
    v_email := lower(btrim(v_p ->> 'email'));
    IF NOT FOUND OR v_email IS NULL OR NOT (v_email = ANY (s.recipient_emails)) OR v_email = ANY (s.verified_emails) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_email';
    END IF;
    RETURN jsonb_build_object('ok', true, 'requested', private.aka_agent_notification_request_verification(p_staff_id, p_organization_id, v_email));

  ELSIF p_action = 'verify_email' THEN
    IF p_client = 'desktop' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_action_not_allowed'; END IF;
    v_email := lower(btrim(v_p ->> 'email'));
    PERFORM set_config('aka.notification_center_write', 'on', true);
    UPDATE public.auto_email_notification_settings
       SET verified_emails = verified_emails || v_email, updated_at = v_now
     WHERE staff_id = p_staff_id AND is_delete IS NOT TRUE AND v_email = ANY (recipient_emails) AND NOT (v_email = ANY (verified_emails));
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM set_config('aka.notification_center_write', '', true);
    RETURN jsonb_build_object('ok', true, 'verified', v_rows > 0 OR EXISTS (
      SELECT 1 FROM public.auto_email_notification_settings WHERE staff_id = p_staff_id AND v_email = ANY (verified_emails)));

  ELSIF p_action = 'unsubscribe' THEN
    IF p_client = 'desktop' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_action_not_allowed'; END IF;
    v_type := v_p ->> 'eventType';
    IF v_type NOT IN ('campaign.status_changed','account.status_changed','report.scheduled','data_group.membership_changed') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter';
    END IF;
    UPDATE public.auto_notification_subscriptions SET email_enabled = false, is_enabled = is_enabled AND push_enabled, updated_at = v_now
     WHERE staff_id = p_staff_id AND event_type = v_type AND scope = 'own';
    PERFORM set_config('aka.notification_center_write', 'on', true);
    UPDATE public.auto_email_notification_settings
       SET notify_campaign_completed = CASE WHEN v_type = 'campaign.status_changed' THEN false ELSE notify_campaign_completed END,
           daily_report_enabled = CASE WHEN v_type = 'report.scheduled' THEN false ELSE daily_report_enabled END,
           revision = revision + 1, updated_by_client = 'system', updated_at = v_now
     WHERE staff_id = p_staff_id;
    PERFORM set_config('aka.notification_center_write', '', true);
    RETURN jsonb_build_object('ok', true);
  END IF;
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_action';
END
$function$

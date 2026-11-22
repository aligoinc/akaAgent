CREATE OR REPLACE FUNCTION public.aka_agent_notification_worker(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_limit integer; v_lease integer; v_result jsonb; v_id bigint; v_token uuid; v_status text; g record;
  v_n public.auto_notifications%ROWTYPE;
  v_d public.auto_notification_deliveries%ROWTYPE;
  v_outcome text; v_delay integer;
BEGIN
  IF p_action = 'claim_render' THEN
    v_limit := least(greatest(coalesce((v_payload ->> 'limit')::integer, 20), 1), 50);
    v_lease := least(greatest(coalesce((v_payload ->> 'leaseSeconds')::integer, 120), 30), 600);
    -- Gộp các thông báo chiến dịch cùng trạng thái của một nhân viên đến hạn cùng lượt (capture đã dồn về cùng mốc) thành 1.
    FOR g IN
      WITH due AS (
        SELECT n.id, n.staff_id, n.payload ->> 'toStatus' AS to_status, n.occurred_at
          FROM public.auto_notifications n
         WHERE n.content_status = 'pending' AND n.deliver_after <= v_now AND n.event_type = 'campaign.status_changed'
         ORDER BY n.deliver_after, n.id LIMIT 2000
           FOR UPDATE SKIP LOCKED)
      SELECT staff_id, to_status, min(id) AS keep_id, array_agg(id ORDER BY id) AS ids, count(*) AS total
        FROM due GROUP BY staff_id, to_status
      HAVING count(*) >= 2
    LOOP
      UPDATE public.auto_notifications
         SET payload = payload || jsonb_build_object(
               'mergedCount', g.total - 1,
               'merged', (SELECT jsonb_agg(jsonb_build_object('campaignId', x.campaign_id, 'campaignName', x.payload ->> 'campaignName',
                                                              'note', x.payload ->> 'note') ORDER BY x.id)
                            FROM (SELECT * FROM public.auto_notifications WHERE id = ANY (g.ids) ORDER BY id LIMIT 50) x)),
             updated_at = v_now
       WHERE id = g.keep_id;
      UPDATE public.auto_notifications SET content_status = 'merged', merged_into_id = g.keep_id, updated_at = v_now
       WHERE id = ANY (g.ids) AND id <> g.keep_id;
    END LOOP;
    WITH picked AS (
      SELECT n.id FROM public.auto_notifications n
       WHERE (n.content_status = 'pending' AND n.deliver_after <= v_now) OR (n.content_status = 'rendering' AND n.leased_until < v_now)
       ORDER BY n.deliver_after, n.id LIMIT v_limit
         FOR UPDATE SKIP LOCKED
    ), upd AS (
      UPDATE public.auto_notifications n
         SET content_status = CASE WHEN n.attempt_count >= 5 THEN 'failed' ELSE 'rendering' END,
             lease_token = CASE WHEN n.attempt_count >= 5 THEN NULL ELSE gen_random_uuid() END,
             leased_until = CASE WHEN n.attempt_count >= 5 THEN NULL ELSE v_now + make_interval(secs => v_lease) END,
             last_error = CASE WHEN n.attempt_count >= 5 THEN 'render_attempts_exhausted' ELSE n.last_error END,
             attempt_count = n.attempt_count + 1,
             updated_at = v_now
        FROM picked WHERE n.id = picked.id
      RETURNING n.*
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', u.id, 'leaseToken', u.lease_token, 'eventType', u.event_type, 'severity', u.severity,
             'staffId', u.staff_id, 'organizationId', u.organization_id, 'staffName', st.name,
             'timezone', coalesce(es.timezone, 'Asia/Ho_Chi_Minh'),
             'campaignId', u.campaign_id, 'accountId', u.account_id, 'dataGroupId', u.data_group_id,
             'entityKey', u.entity_key, 'occurredAt', u.occurred_at, 'payload', u.payload, 'attempt', u.attempt_count) ORDER BY u.id), '[]'::jsonb)
      INTO v_result
      FROM upd u
      LEFT JOIN public.org_staff st ON st.id = u.staff_id
      LEFT JOIN public.auto_email_notification_settings es ON es.staff_id = u.staff_id
     WHERE u.content_status = 'rendering';
    RETURN jsonb_build_object('items', v_result);

  ELSIF p_action = 'complete_render' THEN
    v_id := (v_payload ->> 'id')::bigint;
    v_token := (v_payload ->> 'leaseToken')::uuid;
    v_status := v_payload ->> 'status';
    SELECT * INTO v_n FROM public.auto_notifications WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR v_n.content_status <> 'rendering' OR v_n.lease_token IS DISTINCT FROM v_token THEN
      RETURN jsonb_build_object('ok', false, 'error', 'lease_lost');
    END IF;
    IF v_status = 'ready' THEN
      IF coalesce(char_length(v_payload ->> 'appTitle'), 0) NOT BETWEEN 1 AND 200
         OR coalesce(char_length(v_payload ->> 'appBody'), 0) > 1000
         OR coalesce(char_length(v_payload ->> 'emailSubject'), 0) NOT BETWEEN 1 AND 300
         OR (v_payload -> 'contentSnapshot' IS NOT NULL AND jsonb_typeof(v_payload -> 'contentSnapshot') <> 'object')
         OR pg_column_size(v_payload -> 'contentSnapshot') > 524288 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_content');
      END IF;
      UPDATE public.auto_notifications
         SET content_status = 'ready', app_title = v_payload ->> 'appTitle', app_body = v_payload ->> 'appBody',
             email_subject = v_payload ->> 'emailSubject', content_snapshot = v_payload -> 'contentSnapshot',
             template_version = coalesce((v_payload ->> 'templateVersion')::smallint, 1),
             lease_token = NULL, leased_until = NULL, last_error = NULL, updated_at = v_now,
             -- created_at = lúc vào hộp thư: thông báo gộp theo khung (tạo từ đầu khung) vẫn lên đầu danh sách.
             created_at = v_now
       WHERE id = v_id;
      RETURN jsonb_build_object('ok', true, 'fanout', private.aka_agent_notification_fanout(v_id));
    ELSIF v_status IN ('suppressed', 'failed') THEN
      UPDATE public.auto_notifications
         SET content_status = v_status, lease_token = NULL, leased_until = NULL, last_error = left(v_payload ->> 'error', 500), updated_at = v_now
       WHERE id = v_id;
      RETURN jsonb_build_object('ok', true);
    ELSIF v_status = 'retry' THEN
      UPDATE public.auto_notifications
         SET content_status = 'pending', deliver_after = v_now + interval '1 minute', lease_token = NULL, leased_until = NULL,
             last_error = left(v_payload ->> 'error', 500), updated_at = v_now
       WHERE id = v_id;
      RETURN jsonb_build_object('ok', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');

  ELSIF p_action = 'claim_deliveries' THEN
    v_limit := least(greatest(coalesce((v_payload ->> 'limit')::integer, 50), 1), 100);
    v_lease := least(greatest(coalesce((v_payload ->> 'leaseSeconds')::integer, 120), 30), 600);
    WITH picked AS (
      SELECT d.id FROM public.auto_notification_deliveries d
       WHERE (d.status IN ('pending', 'retrying') AND d.next_attempt_at <= v_now) OR (d.status = 'sending' AND d.leased_until < v_now)
       ORDER BY d.next_attempt_at, d.id LIMIT v_limit
         FOR UPDATE SKIP LOCKED
    ), upd AS (
      UPDATE public.auto_notification_deliveries d
         SET status = 'sending', lease_token = gen_random_uuid(), leased_until = v_now + make_interval(secs => v_lease),
             attempt_count = d.attempt_count + 1, updated_at = v_now
        FROM picked WHERE d.id = picked.id
      RETURNING d.*
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', u.id, 'leaseToken', u.lease_token, 'channel', u.channel, 'provider', u.provider,
             'destination', CASE WHEN u.channel = 'email' THEN u.destination END,
             'attempt', u.attempt_count, 'maxAttempts', u.max_attempts,
             'notification', jsonb_build_object('id', n.id, 'eventType', n.event_type, 'severity', n.severity, 'staffId', n.staff_id,
               'organizationId', n.organization_id,
               'entityKey', n.entity_key, 'occurredAt', n.occurred_at, 'appTitle', n.app_title, 'appBody', n.app_body,
               'emailSubject', n.email_subject, 'templateVersion', n.template_version,
               'contentSnapshot', CASE WHEN u.channel = 'email' THEN n.content_snapshot END,
               'payload', CASE WHEN n.event_type = 'system.verify_email' THEN n.payload END),
             'device', CASE WHEN u.channel = 'push' THEN jsonb_build_object('id', dv.id, 'pushToken', dv.push_token,
               'apnsEnvironment', dv.apns_environment, 'bundleId', dv.bundle_id,
               'active', coalesce(dv.is_active AND dv.is_enabled AND cs.revoked_at IS NULL AND cs.expires_at > v_now AND cs.staff_id = u.staff_id, false)) END,
             'badge', CASE WHEN u.channel = 'push' THEN (SELECT least(count(*), 100) FROM public.auto_notifications x
                                                          WHERE x.staff_id = u.staff_id AND x.read_at IS NULL AND x.content_status = 'ready') END
           ) ORDER BY u.id), '[]'::jsonb)
      INTO v_result
      FROM upd u
      JOIN public.auto_notifications n ON n.id = u.notification_id
      LEFT JOIN public.auto_notification_devices dv ON dv.id = u.device_id
      LEFT JOIN public.auto_control_sessions cs ON cs.id = dv.control_session_id;
    RETURN jsonb_build_object('items', v_result);

  ELSIF p_action = 'complete_delivery' THEN
    v_id := (v_payload ->> 'id')::bigint;
    v_token := (v_payload ->> 'leaseToken')::uuid;
    v_outcome := v_payload ->> 'outcome';
    SELECT * INTO v_d FROM public.auto_notification_deliveries WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR v_d.status <> 'sending' OR v_d.lease_token IS DISTINCT FROM v_token THEN
      RETURN jsonb_build_object('ok', false, 'error', 'lease_lost');
    END IF;
    IF v_outcome = 'sent' THEN
      UPDATE public.auto_notification_deliveries
         SET status = 'sent', sent_at = v_now, provider_message_id = left(v_payload ->> 'providerMessageId', 300),
             last_error_code = NULL, last_error = NULL, lease_token = NULL, leased_until = NULL, updated_at = v_now
       WHERE id = v_id;
      IF v_d.device_id IS NOT NULL THEN
        UPDATE public.auto_notification_devices SET last_success_at = v_now, failure_count = 0, updated_at = v_now WHERE id = v_d.device_id;
      END IF;
    ELSIF v_outcome = 'retry' THEN
      v_delay := CASE v_d.attempt_count WHEN 1 THEN 1 WHEN 2 THEN 5 WHEN 3 THEN 15 ELSE 60 END;
      UPDATE public.auto_notification_deliveries
         SET status = CASE WHEN v_d.attempt_count >= v_d.max_attempts THEN 'failed' ELSE 'retrying' END,
             next_attempt_at = v_now + make_interval(mins => v_delay),
             last_error_code = left(v_payload ->> 'errorCode', 100), last_error = left(v_payload ->> 'error', 500),
             lease_token = NULL, leased_until = NULL, updated_at = v_now
       WHERE id = v_id;
      IF v_d.device_id IS NOT NULL THEN
        UPDATE public.auto_notification_devices SET last_failure_at = v_now, failure_count = failure_count + 1, updated_at = v_now WHERE id = v_d.device_id;
      END IF;
    ELSIF v_outcome IN ('failed', 'invalid_token', 'cancelled') THEN
      UPDATE public.auto_notification_deliveries
         SET status = CASE WHEN v_outcome = 'cancelled' THEN 'cancelled' ELSE 'failed' END,
             last_error_code = left(coalesce(v_payload ->> 'errorCode', v_outcome), 100), last_error = left(v_payload ->> 'error', 500),
             lease_token = NULL, leased_until = NULL, updated_at = v_now
       WHERE id = v_id;
      IF v_outcome = 'invalid_token' AND v_d.device_id IS NOT NULL THEN
        UPDATE public.auto_notification_devices
           SET is_active = false, deactivated_reason = 'token_invalid', last_failure_at = v_now, updated_at = v_now
         WHERE id = v_d.device_id;
      END IF;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_outcome');
    END IF;
    PERFORM private.aka_agent_notification_refresh_channel_state(v_d.notification_id, v_d.channel);
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'release' THEN
    UPDATE private.aka_agent_notification_dispatch_state SET leased_until = NULL, updated_at = v_now WHERE id = 1;
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'sender' THEN
    -- Cấu hình SMTP của tài khoản email gửi thông báo (auto_accounts.email_session). Chỉ service_role gọi được hàm này;
    -- mật khẩu chỉ đi tới worker trên server, không bao giờ trả cho client.
    SELECT jsonb_build_object('configured', true, 'accountId', a.id,
             'host', btrim(a.email_session ->> 'host'),
             'port', CASE WHEN (a.email_session ->> 'port') ~ '^[0-9]{1,5}$' THEN (a.email_session ->> 'port')::integer ELSE 587 END,
             'secure', lower(coalesce(a.email_session ->> 'secure', 'false')) = 'true',
             'user', btrim(coalesce(a.email_session ->> 'user', '')), 'pass', a.email_session ->> 'pass',
             'fromEmail', lower(btrim(a.email_session ->> 'fromEmail')),
             'brandName', nullif(btrim(coalesce(a.email_session ->> 'brandName', '')), ''),
             'replyTo', nullif(btrim(coalesce(a.email_session ->> 'replyTo', '')), ''))
      INTO v_result
      FROM public.auto_accounts a
     WHERE a.id = (SELECT CASE WHEN v ~ '^[0-9]{1,18}$' THEN v::bigint END
                     FROM (SELECT btrim(private.aka_agent_notification_setting('notifications.email.sender_account_id', '')) AS v) x)
       AND a.flatform_type = 'email' AND a.is_delete IS NOT TRUE AND a.is_active IS NOT FALSE
       AND jsonb_typeof(a.email_session) = 'object'
       AND nullif(btrim(coalesce(a.email_session ->> 'host', '')), '') IS NOT NULL
       AND nullif(btrim(coalesce(a.email_session ->> 'fromEmail', '')), '') IS NOT NULL
       AND nullif(a.email_session ->> 'pass', '') IS NOT NULL;
    RETURN coalesce(v_result, jsonb_build_object('configured', false));

  ELSIF p_action = 'stats' THEN
    RETURN jsonb_build_object(
      'enabled', private.aka_agent_notification_enabled(),
      'deliveryMode', private.aka_agent_notification_setting('notifications.delivery_mode', 'dry_run'),
      'pendingRender', (SELECT count(*) FROM public.auto_notifications WHERE content_status IN ('pending', 'rendering')),
      'pendingDeliveries', (SELECT count(*) FROM public.auto_notification_deliveries WHERE status IN ('pending', 'retrying', 'sending')),
      'dueNow', (SELECT count(*) FROM public.auto_notifications WHERE content_status = 'pending' AND deliver_after <= v_now));
  END IF;
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_worker_invalid_action';
END
$function$

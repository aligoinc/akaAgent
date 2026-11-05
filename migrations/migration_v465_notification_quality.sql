-- V465: Trung tâm thông báo — sửa lỗi tìm được khi phát lại lịch sử thật 02–05/11/2026 (docs/NOTIFICATION_REPLAY_20261105.md).
-- CANDIDATE, CHƯA APPLY. Số V464 đã dùng trên production (migration_v464_native_desktop_only_login): kiểm lại số trước khi apply.
-- Chỉ thay 5 hàm của V457 (md5 trước/sau khóa cứng), thêm 2 index nhỏ trên bảng thông báo và 2 cấu hình:
--  1) snapshot('campaign') đếm kết quả bằng index-only (chiến dịch ~60 nghìn dòng: 36,8s → <1s, trước đây quá 8s timeout → không bao giờ gửi);
--  2) snapshot('account') trả lý do gắn đúng sự kiện (details.reason của dòng log đăng nhập/đăng xuất) + cảnh báo gần nhất + mốc cập nhật phiên chat;
--  3) snapshot('report') tính tài khoản SMS theo máy đã gắn, bỏ tài khoản SMS mặc định chưa dùng (trước đây mọi báo cáo báo sai "đăng xuất"),
--     ưu tiên chiến dịch có hoạt động hôm nay trong danh sách;
--  4) capture chiến dịch dồn thay đổi cùng trạng thái của một nhân viên về mốc gửi kế tiếp (notifications.digest_minutes.campaign, mặc định 10)
--     và worker gộp từ 2 thông báo đến hạn cùng lượt (trước đây cần ≥5 trong 2 phút): người dùng nặng 156 → ~? email/ngày;
--  5) fanout thêm trần email/giờ cho thông báo sự kiện (notifications.email.hourly_cap, mặc định 20; báo cáo/thư thử không tính);
--  6) không tạo báo cáo theo lịch cho nhân viên đã ngừng/không còn quyền (vẫn dời lịch).
-- Không đổi bảng, trigger, quyền, cron, pool/kết nối. Rollback: migrations/rollback_v465_notification_quality.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $v465_preflight$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_notification_capture_campaign()'))) IS DISTINCT FROM '690159475b3b866cf409d37a1cb5f1d0' THEN RAISE EXCEPTION 'v465: unexpected definition private.aka_agent_notification_capture_campaign()'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_notification_schedule_reports(timestamp with time zone)'))) IS DISTINCT FROM 'bce0405ad0fed1c0f96c5276ee294308' THEN RAISE EXCEPTION 'v465: unexpected definition private.aka_agent_notification_schedule_reports(timestamp with time zone)'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_notification_fanout(bigint)'))) IS DISTINCT FROM '74b1a6296f18c67674f64d6948b2163f' THEN RAISE EXCEPTION 'v465: unexpected definition private.aka_agent_notification_fanout(bigint)'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_notification_worker(text,jsonb)'))) IS DISTINCT FROM 'f598494e22bf8d1f9ae8879a72a95840' THEN RAISE EXCEPTION 'v465: unexpected definition public.aka_agent_notification_worker(text,jsonb)'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_notification_snapshot(text,jsonb)'))) IS DISTINCT FROM '8c311a4c00fef984f746f2d8fb66c023' THEN RAISE EXCEPTION 'v465: unexpected definition public.aka_agent_notification_snapshot(text,jsonb)'; END IF;
  IF to_regclass('public.idx_auto_notifications_digest') IS NOT NULL OR to_regclass('public.idx_auto_notification_deliveries_email_cap') IS NOT NULL THEN
    RAISE EXCEPTION 'v465: indexes already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key IN ('notifications.digest_minutes.campaign', 'notifications.email.hourly_cap')) THEN
    RAISE EXCEPTION 'v465: settings already exist';
  END IF;
  IF to_regclass('public.idx_auto_campaign_details_automation_status') IS NULL THEN
    RAISE EXCEPTION 'v465: idx_auto_campaign_details_automation_status missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_account_logs'::regclass AND attname = 'details' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_account_logs'::regclass AND attname = 'login_status' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'v465: auto_account_logs.details/login_status missing';
  END IF;
END
$v465_preflight$;

-- Bảng thông báo nhỏ (vài nghìn dòng/ngày): tạo index thường trong giao dịch, không khóa bảng nghiệp vụ.
CREATE INDEX idx_auto_notifications_digest ON public.auto_notifications (staff_id, event_type, deliver_after DESC);
CREATE INDEX idx_auto_notification_deliveries_email_cap ON public.auto_notification_deliveries (staff_id, created_at) WHERE channel = 'email';

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('notifications.digest_minutes.campaign', '10', 'Phút tối thiểu giữa hai thông báo chiến dịch cùng trạng thái của một nhân viên; thay đổi trong khoảng này được gộp. 0 = tắt gộp theo mốc.', false, true),
  ('notifications.email.hourly_cap', '20', 'Trần email thông báo sự kiện (chiến dịch/tài khoản/nhóm) mỗi giờ cho một nhân viên; vượt thì chỉ hiện trong hộp thư. 0 = tắt email sự kiện. Báo cáo không tính.', false, true);

CREATE OR REPLACE FUNCTION private.aka_agent_notification_capture_campaign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_sub public.auto_notification_subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_to text := NEW.status;
  v_cooldown integer;
  v_last bigint;
  v_org bigint;
  v_digest integer; v_deliver timestamptz; v_prev_deliver timestamptz; v_prev_status text;
BEGIN
  IF NOT private.aka_agent_notification_enabled() THEN RETURN NULL; END IF;
  SELECT * INTO v_sub FROM public.auto_notification_subscriptions
   WHERE staff_id = NEW.staff_id AND event_type = 'campaign.status_changed' AND scope = 'own' AND is_enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (coalesce(v_sub.filters -> 'toStatuses', private.aka_agent_notification_default_filters('campaign.status_changed') -> 'toStatuses') ? v_to) THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v_sub.filters -> 'campaignIds') = 'array' AND NOT ((v_sub.filters -> 'campaignIds') @> to_jsonb(NEW.id)) THEN
    RETURN NULL;
  END IF;
  v_cooldown := CASE WHEN v_to IN ('đang chạy', 'chờ xử lý') THEN coalesce(v_sub.cooldown_minutes, 15)
    ELSE coalesce(v_sub.cooldown_minutes, private.aka_agent_notification_int_setting('notifications.cooldown_minutes.campaign', 10)) END;
  IF v_cooldown > 0 THEN
    SELECT n.id INTO v_last FROM public.auto_notifications n
     WHERE n.staff_id = NEW.staff_id AND n.event_type = 'campaign.status_changed' AND n.entity_key = 'campaign:' || NEW.id
       AND n.occurred_at > v_now - make_interval(mins => v_cooldown) AND n.payload ->> 'toStatus' = v_to
       AND n.content_status <> 'failed'
     ORDER BY n.occurred_at DESC LIMIT 1;
    IF FOUND THEN
      UPDATE public.auto_notifications
         SET payload = payload || jsonb_build_object('suppressedCount', coalesce((payload ->> 'suppressedCount')::integer, 0) + 1,
                                                    'lastOccurredAt', v_now),
             updated_at = v_now
       WHERE id = v_last;
      RETURN NULL;
    END IF;
  END IF;
  -- Gom: thông báo đầu tiên trong lúc yên gửi sau 30 giây; các thay đổi cùng trạng thái tiếp theo của nhân viên
  -- dồn vào mốc kế tiếp (cách lần gửi trước ≥ digest phút) để worker gộp thành 1 thông báo.
  v_deliver := v_now + interval '30 seconds';
  v_digest := private.aka_agent_notification_int_setting('notifications.digest_minutes.campaign', 10);
  IF v_digest > 0 THEN
    SELECT n.deliver_after, n.content_status INTO v_prev_deliver, v_prev_status FROM public.auto_notifications n
     WHERE n.staff_id = NEW.staff_id AND n.event_type = 'campaign.status_changed'
       AND n.deliver_after > v_now - make_interval(mins => v_digest)
       AND n.content_status IN ('pending', 'rendering', 'ready') AND n.payload ->> 'toStatus' = v_to
     ORDER BY n.deliver_after DESC LIMIT 1;
    IF FOUND THEN
      v_deliver := CASE WHEN v_prev_status = 'pending' THEN v_prev_deliver
                        ELSE greatest(v_deliver, v_prev_deliver + make_interval(mins => v_digest)) END;
    END IF;
  END IF;
  v_org := private.aka_agent_notification_staff_org(NEW.staff_id, NEW.organization_id);
  INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, campaign_id, account_id, entity_key,
                                         occurred_at, deliver_after, dedupe_key, payload)
  VALUES (v_org, NEW.staff_id, 'campaign.status_changed', CASE WHEN v_to = 'tạm dừng' THEN 'warning' ELSE 'info' END,
          NEW.id, NEW.account_id, 'campaign:' || NEW.id, v_now, v_deliver,
          format('cs:%s:%s:%s', NEW.id, v_to, txid_current()),
          jsonb_build_object('campaignId', NEW.id, 'campaignName', NEW.name, 'actionId', NEW.action_id, 'accountId', NEW.account_id,
                             'fromStatus', OLD.status, 'toStatus', v_to, 'note', NEW.note, 'changedAt', v_now,
                             'source', private.aka_agent_notification_change_source()))
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_schedule_reports(p_now timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record; v_count integer := 0; v_tz text; v_slot_local text; v_allowed boolean;
BEGIN
  FOR r IN
    SELECT s.* FROM public.auto_notification_subscriptions s
     WHERE s.event_type = 'report.scheduled' AND s.is_enabled AND s.next_run_at IS NOT NULL AND s.next_run_at <= p_now
     ORDER BY s.next_run_at LIMIT 200 FOR UPDATE SKIP LOCKED
  LOOP
    SELECT coalesce(min(e.timezone), 'Asia/Ho_Chi_Minh') INTO v_tz FROM public.auto_email_notification_settings e WHERE e.staff_id = r.staff_id;
    v_slot_local := to_char(r.next_run_at AT TIME ZONE v_tz, 'YYYY-MM-DD"T"HH24:MI');
    SELECT st.is_active IS TRUE AND st.deleted_at IS NULL AND public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
      INTO v_allowed FROM public.org_staff st WHERE st.id = r.staff_id;
    -- Lỡ nhiều mốc (sự cố) chỉ tạo một báo cáo cho mốc đến hạn sớm nhất rồi nhảy tới mốc tương lai.
    IF coalesce(v_allowed, false) THEN
    INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, entity_key, occurred_at, deliver_after, dedupe_key, payload)
    VALUES (r.organization_id, r.staff_id, 'report.scheduled', 'info', 'report:' || v_slot_local, p_now, p_now,
            format('rp:%s:%s', r.staff_id, v_slot_local),
            jsonb_build_object('slotAt', r.next_run_at, 'slotLocal', v_slot_local, 'timezone', v_tz,
                               'skipWhenIdle', coalesce((r.filters ->> 'skipWhenIdle')::boolean, false),
                               'maxCampaigns', least(greatest(coalesce((r.filters ->> 'maxCampaigns')::integer, 50), 1), 100)))
    ON CONFLICT (dedupe_key) DO NOTHING;
    v_count := v_count + 1;
    END IF;
    UPDATE public.auto_notification_subscriptions
       SET last_run_at = r.next_run_at,
           next_run_at = private.aka_agent_notification_next_run(r.schedule_week_days, r.schedule_times, v_tz, p_now),
           updated_at = p_now
     WHERE id = r.id;
  END LOOP;
  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_fanout(p_notification_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  n public.auto_notifications%ROWTYPE;
  s public.auto_email_notification_settings%ROWTYPE;
  sub public.auto_notification_subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_live boolean := private.aka_agent_notification_setting('notifications.delivery_mode', 'dry_run') = 'live';
  v_allowed boolean; v_email_on boolean := false; v_push_on boolean := false; v_emails text[] := '{}'; v_cap integer; v_recent integer;
  v_email_rows integer := 0; v_push_rows integer := 0; v_has_settings boolean;
  v_email_cap integer; v_email_recent integer := 0; v_email_capped boolean := false;
BEGIN
  SELECT * INTO n FROM public.auto_notifications WHERE id = p_notification_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT st.is_active IS TRUE AND st.deleted_at IS NULL AND public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
    INTO v_allowed FROM public.org_staff st WHERE st.id = n.staff_id;
  IF NOT coalesce(v_allowed, false) THEN
    UPDATE public.auto_notifications SET email_state = 'skipped', push_state = 'skipped', last_error = 'staff_not_allowed', updated_at = v_now
     WHERE id = n.id;
    RETURN jsonb_build_object('ok', true, 'email', 0, 'push', 0, 'skipped', 'staff_not_allowed');
  END IF;
  SELECT * INTO s FROM public.auto_email_notification_settings WHERE staff_id = n.staff_id AND is_delete IS NOT TRUE;
  v_has_settings := FOUND;
  IF n.event_type = 'system.verify_email' THEN
    v_email_on := true;
    v_emails := ARRAY[lower(n.payload ->> 'email')];
  ELSIF NOT v_has_settings THEN
    v_email_on := false; v_push_on := false;
  ELSIF n.event_type = 'system.test' THEN
    v_email_on := n.payload ->> 'channel' = 'email';
    v_push_on := n.payload ->> 'channel' = 'push';
  ELSE
    SELECT * INTO sub FROM public.auto_notification_subscriptions WHERE staff_id = n.staff_id AND event_type = n.event_type AND scope = 'own';
    IF FOUND THEN
      v_email_on := s.is_enabled AND sub.email_enabled;
      v_push_on := s.push_enabled AND sub.push_enabled;
    END IF;
  END IF;
  IF v_email_on AND n.event_type <> 'system.verify_email' THEN
    v_emails := ARRAY(SELECT e FROM unnest(coalesce(s.recipient_emails, '{}'::text[])) WITH ORDINALITY AS r(e, o)
                       WHERE e = ANY (coalesce(s.verified_emails, '{}'::text[])) ORDER BY o LIMIT 5);
  END IF;
  IF v_email_on AND cardinality(v_emails) > 0 THEN
    IF n.event_type IN ('campaign.status_changed', 'account.status_changed', 'data_group.membership_changed') THEN
      v_email_cap := private.aka_agent_notification_int_setting('notifications.email.hourly_cap', 20);
      SELECT count(DISTINCT d.notification_id) INTO v_email_recent FROM public.auto_notification_deliveries d
       WHERE d.staff_id = n.staff_id AND d.channel = 'email' AND d.created_at > v_now - interval '1 hour'
         AND d.status IN ('pending', 'sending', 'retrying', 'sent') AND d.notification_id <> n.id;
      v_email_capped := v_email_recent >= v_email_cap;
    END IF;
    INSERT INTO public.auto_notification_deliveries (notification_id, staff_id, channel, provider, destination, status, last_error_code)
    SELECT n.id, n.staff_id, 'email', 'smtp', e, CASE WHEN v_live AND NOT v_email_capped THEN 'pending' ELSE 'skipped' END,
           CASE WHEN NOT v_live THEN 'dry_run' WHEN v_email_capped THEN 'hourly_cap' END
      FROM unnest(v_emails) AS e
    ON CONFLICT (notification_id, channel, destination) DO NOTHING;
    GET DIAGNOSTICS v_email_rows = ROW_COUNT;
  END IF;
  IF v_push_on THEN
    v_cap := coalesce(s.hourly_push_cap, private.aka_agent_notification_int_setting('notifications.push.hourly_cap', 60));
    SELECT count(*) INTO v_recent FROM public.auto_notification_deliveries d
     WHERE d.staff_id = n.staff_id AND d.channel = 'push' AND d.created_at > v_now - interval '1 hour'
       AND d.status IN ('pending', 'sending', 'retrying', 'sent');
    INSERT INTO public.auto_notification_deliveries (notification_id, staff_id, channel, provider, destination, device_id, status, last_error_code)
    SELECT n.id, n.staff_id, 'push', 'apns', 'device:' || dv.id, dv.id,
           CASE WHEN NOT v_live OR v_recent >= v_cap THEN 'skipped' ELSE 'pending' END,
           CASE WHEN NOT v_live THEN 'dry_run' WHEN v_recent >= v_cap THEN 'hourly_cap' END
      FROM public.auto_notification_devices dv
      JOIN public.auto_control_sessions cs ON cs.id = dv.control_session_id
     WHERE dv.staff_id = n.staff_id AND dv.is_active AND dv.is_enabled AND dv.push_token IS NOT NULL
       AND cs.staff_id = n.staff_id AND cs.revoked_at IS NULL AND cs.expires_at > v_now
     ORDER BY dv.id LIMIT 10
    ON CONFLICT (notification_id, channel, destination) DO NOTHING;
    GET DIAGNOSTICS v_push_rows = ROW_COUNT;
  END IF;
  PERFORM private.aka_agent_notification_refresh_channel_state(n.id, 'email');
  PERFORM private.aka_agent_notification_refresh_channel_state(n.id, 'push');
  RETURN jsonb_build_object('ok', true, 'email', v_email_rows, 'push', v_push_rows, 'live', v_live);
END
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_notification_worker(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_notification_snapshot(p_kind text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_staff bigint := (v_payload ->> 'staffId')::bigint;
  v_tz text := coalesce(nullif(v_payload ->> 'timezone', ''), 'Asia/Ho_Chi_Minh');
  v_now timestamptz := clock_timestamp();
  v_day_start timestamptz;
  v_id bigint; v_main jsonb; v_inputs jsonb; v_results jsonb; v_first timestamptz; v_at timestamptz;
  v_accounts jsonb; v_logged_out jsonb; v_campaign_counts jsonb; v_campaigns jsonb; v_issues jsonb; v_limit integer;
  v_from timestamptz; v_to timestamptz;
BEGIN
  IF v_staff IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_snapshot_staff_required'; END IF;
  v_day_start := date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  IF p_kind = 'campaign' THEN
    v_id := (v_payload ->> 'campaignId')::bigint;
    SELECT jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'note', c.note, 'actionId', c.action_id, 'actionName', a.name,
             'accountId', c.account_id, 'accountName', acc.name, 'platform', acc.flatform_type, 'completedAt', c.completed_at,
             'createdAt', c.created_at, 'lastRunAt', c.last_run_at, 'scheduleEndDate', c.schedule_end_date, 'isDeleted', coalesce(c.is_delete, false))
      INTO v_main
      FROM public.auto_campaigns c
      LEFT JOIN public.auto_campaign_actions a ON a.id = c.action_id
      LEFT JOIN public.auto_accounts acc ON acc.id = c.account_id
     WHERE c.id = v_id AND c.staff_id = v_staff;
    IF v_main IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
    SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_inputs
      FROM (SELECT status, count(*) AS n FROM public.auto_campaign_input_data WHERE campaign_id = v_id AND is_delete = false GROUP BY status) x;
    -- Đếm theo (action_code, status) chỉ đọc index idx_auto_campaign_details_automation_status (không đọc heap: chiến dịch
    -- 60 nghìn dòng 36,8s → <1s); tên hành động và nhóm kết quả lấy từ 1 dòng gần nhất của mỗi nhóm.
    WITH g AS (
      SELECT d.action_code, d.status, count(*) AS total, count(*) FILTER (WHERE d.created_at >= v_day_start) AS today
        FROM public.auto_campaign_details d
       WHERE d.campaign_id = v_id AND d.is_delete = false
       GROUP BY d.action_code, d.status
    ), labeled AS (
      SELECT coalesce(nullif(coalesce(rc.action_name, rn.action_name), ''), g.action_code, 'Hành động') AS action,
             private.aka_agent_notification_result_group(coalesce(rc.report_group, rn.report_group), g.status) AS grp, g.total, g.today
        FROM g
        LEFT JOIN LATERAL (SELECT d.action_name, d.report_group FROM public.auto_campaign_details d
                            WHERE d.campaign_id = v_id AND d.is_delete = false AND d.status = g.status AND d.action_code = g.action_code
                            ORDER BY d.created_at DESC LIMIT 1) rc ON g.action_code IS NOT NULL
        LEFT JOIN LATERAL (SELECT d.action_name, d.report_group FROM public.auto_campaign_details d
                            WHERE d.campaign_id = v_id AND d.is_delete = false AND d.status = g.status AND d.action_code IS NULL
                            ORDER BY d.created_at DESC LIMIT 1) rn ON g.action_code IS NULL
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('action', action, 'group', grp, 'total', total, 'today', today) ORDER BY action, grp), '[]'::jsonb)
      INTO v_results
      FROM (SELECT action, grp, sum(total)::bigint AS total, sum(today)::bigint AS today FROM labeled GROUP BY 1, 2) r;
    SELECT min(d.created_at) INTO v_first FROM public.auto_campaign_details d WHERE d.campaign_id = v_id AND d.is_delete = false;
    RETURN jsonb_build_object('found', true, 'campaign', v_main, 'inputs', v_inputs, 'results', v_results,
                              'startedAt', coalesce(v_first, (v_main ->> 'createdAt')::timestamptz), 'countedAt', v_now, 'dayStart', v_day_start);

  ELSIF p_kind = 'account' THEN
    v_id := (v_payload ->> 'accountId')::bigint;
    v_at := coalesce((v_payload ->> 'occurredAt')::timestamptz, v_now);
    SELECT jsonb_build_object('id', a.id, 'name', a.name, 'platform', a.flatform_type, 'loginStatus', a.login_status, 'status', a.status,
             'isZaloServer', coalesce(a.is_zalo_server, false), 'isZaloWeb', coalesce(a.is_zalo_show_web, false), 'proxyName', p.name,
             'device', CASE WHEN a.flatform_type = 'sms' AND a.mobile_device_info IS NOT NULL THEN jsonb_build_object(
                         'app', a.mobile_device_info -> 'app', 'osVersion', a.mobile_device_info -> 'osVersion',
                         'platform', a.mobile_device_info -> 'platform', 'lastSeenAt', a.mobile_device_last_seen_at) END,
             'chatSession', (SELECT jsonb_build_object('lastError', left(o.session_last_error, 300), 'closeReason', left(o.socket_last_close_reason, 300),
                               'closeCode', o.socket_last_close_code, 'lastDisconnectedAt', o.last_socket_disconnected_at, 'updatedAt', o.updated_at)
                               FROM public.chat_zalo_account_organization o WHERE o.auto_account_id = a.id ORDER BY o.updated_at DESC LIMIT 1),
             'lastLog', (SELECT jsonb_build_object('at', l.created_at, 'event', l.event_type, 'message', left(l.message, 300), 'source', l.source)
                           FROM public.auto_account_logs l
                          WHERE l.account_id = a.id AND l.created_at BETWEEN v_at - interval '2 minutes' AND v_at + interval '2 minutes'
                          ORDER BY l.created_at DESC LIMIT 1),
             'loginLog', (SELECT jsonb_build_object('at', l.created_at, 'event', l.event_type, 'loginStatus', l.login_status,
                                   'reason', left(l.details ->> 'reason', 300), 'source', l.source)
                            FROM public.auto_account_logs l
                           WHERE l.account_id = a.id AND l.event_type IN ('logout', 'login', 'login_status_changed')
                             AND l.created_at BETWEEN v_at - interval '2 minutes' AND v_at + interval '2 minutes'
                           ORDER BY abs(extract(epoch FROM l.created_at - v_at)), l.created_at DESC LIMIT 1),
             'warnLog', (SELECT jsonb_build_object('at', l.created_at, 'event', l.event_type, 'message', left(l.message, 300), 'source', l.source)
                           FROM public.auto_account_logs l
                          WHERE l.account_id = a.id AND l.event_type IN ('zalo_warning', 'runtime_error')
                            AND l.created_at BETWEEN v_at - interval '2 minutes' AND v_at + interval '1 minute'
                          ORDER BY l.created_at DESC LIMIT 1),
             'desktopDevice', CASE WHEN a.flatform_type = 'zalo' AND NOT coalesce(a.is_zalo_server, false) THEN (
                         SELECT CASE WHEN count(*) = 1 THEN min(dp.device_label || coalesce(' · v' || dp.app_version, '')) END
                           FROM public.auto_staff_device_presence dp
                          WHERE dp.staff_id = a.staff_id AND dp.ended_at IS NULL AND dp.last_seen_at > v_now - interval '5 minutes') END,
             'activeCampaigns', (SELECT count(*) FROM public.auto_campaigns c
                                  WHERE c.account_id = a.id AND c.is_delete IS NOT TRUE AND c.status IN ('đang chạy', 'chờ xử lý')))
      INTO v_main
      FROM public.auto_accounts a LEFT JOIN public.auto_proxies p ON p.id = a.proxy_id
     WHERE a.id = v_id AND a.staff_id = v_staff;
    IF v_main IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
    RETURN jsonb_build_object('found', true, 'account', v_main, 'countedAt', v_now);

  ELSIF p_kind = 'report' THEN
    v_limit := least(greatest(coalesce((v_payload ->> 'maxCampaigns')::integer, 50), 1), 100);
    -- SMS: login_status luôn 'chưa đăng nhập'; kết nối thật là máy đã gắn (mobile_device_id). Tài khoản SMS chưa gắn máy
    -- và không có chiến dịch đang chạy/chờ là chưa dùng (mỗi nhân viên có 1 tài khoản SMS mặc định): không tính.
    SELECT jsonb_build_object('total', count(*),
             'loggedIn', count(*) FILTER (WHERE x.eff = 'đã đăng nhập'),
             'loggedOut', count(*) FILTER (WHERE x.eff = 'chưa đăng nhập'),
             'checkpoint', count(*) FILTER (WHERE x.eff = 'checkpoint'),
             'running', count(*) FILTER (WHERE x.status = 'đang chạy'),
             'pending', count(*) FILTER (WHERE x.status = 'chờ xử lý'),
             'paused', count(*) FILTER (WHERE x.status = 'tạm dừng'))
      INTO v_accounts
      FROM (SELECT a.status, CASE WHEN a.flatform_type = 'sms'
                                  THEN CASE WHEN a.mobile_device_id IS NOT NULL THEN 'đã đăng nhập' ELSE 'chưa đăng nhập' END
                                  ELSE a.login_status END AS eff
              FROM public.auto_accounts a
             WHERE a.staff_id = v_staff AND a.is_delete IS NOT TRUE
               AND (a.flatform_type IS DISTINCT FROM 'sms' OR a.mobile_device_id IS NOT NULL
                    OR EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.account_id = a.id AND c.is_delete IS NOT TRUE
                                 AND c.status IN ('đang chạy', 'chờ xử lý')))) x;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'platform', flatform_type, 'loginStatus', eff, 'since', updated_at)
                              ORDER BY updated_at DESC), '[]'::jsonb)
      INTO v_logged_out
      FROM (SELECT a.id, a.name, a.flatform_type, a.updated_at,
                   CASE WHEN a.flatform_type = 'sms' THEN 'chưa đăng nhập' ELSE a.login_status END AS eff
              FROM public.auto_accounts a
             WHERE a.staff_id = v_staff AND a.is_delete IS NOT TRUE
               AND CASE WHEN a.flatform_type = 'sms'
                        THEN a.mobile_device_id IS NULL
                             AND EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.account_id = a.id AND c.is_delete IS NOT TRUE
                                           AND c.status IN ('đang chạy', 'chờ xử lý'))
                        ELSE a.login_status IN ('chưa đăng nhập', 'checkpoint') END
             ORDER BY a.updated_at DESC LIMIT 20) x;
    SELECT jsonb_build_object('byStatus', coalesce(jsonb_object_agg(status, n), '{}'::jsonb),
             'completedToday', (SELECT count(*) FROM public.auto_campaigns
                                 WHERE staff_id = v_staff AND is_delete IS NOT TRUE AND status = 'hoàn thành' AND completed_at >= v_day_start))
      INTO v_campaign_counts
      FROM (SELECT status, count(*) AS n FROM public.auto_campaigns WHERE staff_id = v_staff AND is_delete IS NOT TRUE GROUP BY status) x;
    WITH picked AS (
      SELECT c.id, c.name, c.status, c.note, c.action_id, c.account_id, c.completed_at, c.last_run_at,
             row_number() OVER (ORDER BY (c.last_run_at >= v_day_start) DESC NULLS LAST,
                                (c.status IN ('tạm dừng', 'chờ xử lý') AND coalesce(c.note, '') <> '') DESC,
                                CASE c.status WHEN 'đang chạy' THEN 1 WHEN 'chờ xử lý' THEN 2 WHEN 'tạm dừng' THEN 3 ELSE 4 END,
                                c.last_run_at DESC NULLS LAST, c.id DESC) AS rn
        FROM public.auto_campaigns c
       WHERE c.staff_id = v_staff AND c.is_delete IS NOT TRUE
         AND (c.status <> 'hoàn thành' OR c.completed_at >= v_day_start)
       ORDER BY (c.last_run_at >= v_day_start) DESC NULLS LAST,
                (c.status IN ('tạm dừng', 'chờ xử lý') AND coalesce(c.note, '') <> '') DESC,
                CASE c.status WHEN 'đang chạy' THEN 1 WHEN 'chờ xử lý' THEN 2 WHEN 'tạm dừng' THEN 3 ELSE 4 END,
                c.last_run_at DESC NULLS LAST, c.id DESC
       LIMIT v_limit
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'note', p.note, 'actionName', a.name,
             'accountName', acc.name, 'completedAt', p.completed_at, 'lastRunAt', p.last_run_at,
             'pendingInputs', (SELECT count(*) FROM public.auto_campaign_input_data i WHERE i.campaign_id = p.id AND i.is_delete = false AND i.status = 'chờ xử lý'),
             'today', (SELECT coalesce(jsonb_object_agg(grp, n), '{}'::jsonb) FROM (
                         SELECT private.aka_agent_notification_result_group(d.report_group, d.status) AS grp, count(*) AS n
                           FROM public.auto_campaign_details d
                          WHERE d.campaign_id = p.id AND d.is_delete = false AND d.created_at >= v_day_start
                          GROUP BY 1) t)
           ) ORDER BY p.rn), '[]'::jsonb)
      INTO v_campaigns
      FROM picked p
      LEFT JOIN public.auto_campaign_actions a ON a.id = p.action_id
      LEFT JOIN public.auto_accounts acc ON acc.id = p.account_id;
    WITH issues AS (
      SELECT 'critical' AS severity, 'account_logged_out_with_campaigns' AS code, a.name AS subject,
             CASE WHEN a.flatform_type = 'sms' THEN 'Chưa gắn máy SMS'
                  ELSE 'Tài khoản ' || CASE a.login_status WHEN 'checkpoint' THEN 'bị checkpoint' ELSE 'đã đăng xuất' END END
               || ' trong khi còn ' || count(c.id) || ' chiến dịch đang chạy hoặc chờ xử lý' AS message, 1 AS rank
        FROM public.auto_accounts a JOIN public.auto_campaigns c ON c.account_id = a.id
       WHERE a.staff_id = v_staff AND a.is_delete IS NOT TRUE
         AND CASE WHEN a.flatform_type = 'sms' THEN a.mobile_device_id IS NULL ELSE a.login_status IN ('chưa đăng nhập', 'checkpoint') END
         AND c.is_delete IS NOT TRUE AND c.status IN ('đang chạy', 'chờ xử lý')
       GROUP BY a.id, a.name, a.login_status, a.flatform_type
      UNION ALL
      SELECT CASE WHEN c.note ILIKE '%đăng xuất%' OR c.note ILIKE '%checkpoint%' THEN 'critical' ELSE 'warning' END,
             'campaign_stopped_with_reason', c.name, left(c.note, 300), 2
        FROM public.auto_campaigns c
       WHERE c.staff_id = v_staff AND c.is_delete IS NOT TRUE AND c.status IN ('tạm dừng', 'chờ xử lý') AND coalesce(c.note, '') <> ''
      UNION ALL
      SELECT 'warning', 'high_failure_rate_today', p ->> 'name',
             'Tỷ lệ thất bại hôm nay ' || round(100.0 * (p -> 'today' ->> 'failure')::numeric
               / nullif(coalesce((p -> 'today' ->> 'failure')::numeric, 0) + coalesce((p -> 'today' ->> 'success')::numeric, 0)
                        + coalesce((p -> 'today' ->> 'skipped')::numeric, 0), 0)) || '%', 3
        FROM jsonb_array_elements(v_campaigns) p
       WHERE coalesce((p -> 'today' ->> 'failure')::numeric, 0) + coalesce((p -> 'today' ->> 'success')::numeric, 0)
             + coalesce((p -> 'today' ->> 'skipped')::numeric, 0) >= 20
         AND coalesce((p -> 'today' ->> 'failure')::numeric, 0) * 100 >= 30 * (coalesce((p -> 'today' ->> 'failure')::numeric, 0)
             + coalesce((p -> 'today' ->> 'success')::numeric, 0) + coalesce((p -> 'today' ->> 'skipped')::numeric, 0))
      UNION ALL
      SELECT 'info', 'staff_expiring', st.name, 'Tài khoản nhân viên hết hạn ngày ' || to_char(st.expiration_date AT TIME ZONE v_tz, 'DD/MM/YYYY'), 4
        FROM public.org_staff st
       WHERE st.id = v_staff AND st.expiration_date IS NOT NULL AND st.expiration_date BETWEEN v_now AND v_now + interval '7 days'
      UNION ALL
      SELECT 'info', 'package_expiring', op.product_name, 'Gói ' || coalesce(op.product_name, '') || ' hết hạn ngày '
               || to_char(op.expiration_date AT TIME ZONE v_tz, 'DD/MM/YYYY'), 4
        FROM public.org_staff st JOIN public.org_organization_product op ON op.organization_id = st.organization_id
       WHERE st.id = v_staff AND op.is_deleted IS NOT TRUE AND op.expiration_date BETWEEN v_now AND v_now + interval '7 days'
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('severity', severity, 'code', code, 'subject', subject, 'message', message)
                              ORDER BY rank, severity), '[]'::jsonb)
      INTO v_issues
      FROM (SELECT * FROM issues ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, rank LIMIT 20) i;
    RETURN jsonb_build_object('found', true, 'accounts', v_accounts, 'loggedOutAccounts', v_logged_out, 'campaignCounts', v_campaign_counts,
                              'campaigns', v_campaigns, 'issues', v_issues, 'countedAt', v_now, 'dayStart', v_day_start, 'timezone', v_tz);

  ELSIF p_kind = 'data_group' THEN
    v_id := (v_payload ->> 'groupId')::bigint;
    v_from := coalesce((v_payload ->> 'from')::timestamptz, v_now - interval '5 minutes');
    v_to := coalesce((v_payload ->> 'to')::timestamptz, v_now);
    SELECT jsonb_build_object('id', g.id, 'name', g.name, 'ownerStaffId', g.staff_id) INTO v_main
      FROM public.auto_account_contact_groups g
     WHERE g.id = v_id AND g.is_delete IS NOT TRUE
       AND (g.staff_id = v_staff OR EXISTS (SELECT 1 FROM public.auto_data_group_recipients r WHERE r.group_id = g.id AND r.staff_id = v_staff));
    IF v_main IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
    SELECT jsonb_build_object('added', count(*) FILTER (WHERE action = 'added'), 'removed', count(*) FILTER (WHERE action = 'removed'),
             'totalAfter', (array_agg(group_total_after ORDER BY occurred_at DESC, id DESC))[1],
             'samples', (SELECT coalesce(jsonb_agg(jsonb_build_object('action', s.action, 'label', s.contact_label, 'at', s.occurred_at) ORDER BY s.occurred_at DESC), '[]'::jsonb)
                           FROM (SELECT action, contact_label, occurred_at FROM public.auto_data_group_member_events
                                  WHERE group_id = v_id AND occurred_at >= v_from AND occurred_at < v_to ORDER BY occurred_at DESC LIMIT 20) s),
             'filterSummary', (array_agg(filter_summary ORDER BY occurred_at DESC, id DESC))[1])
      INTO v_results
      FROM public.auto_data_group_member_events WHERE group_id = v_id AND occurred_at >= v_from AND occurred_at < v_to;
    RETURN jsonb_build_object('found', true, 'group', v_main, 'changes', v_results, 'from', v_from, 'to', v_to, 'countedAt', v_now);
  END IF;
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_snapshot_invalid_kind';
END
$$;

DO $v465_postcheck$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_notification_capture_campaign()'))) IS DISTINCT FROM '4a5e881eb85efc1cc2280e8cf0c10721' THEN RAISE EXCEPTION 'v465: checksum mismatch private.aka_agent_notification_capture_campaign()'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_notification_schedule_reports(timestamp with time zone)'))) IS DISTINCT FROM '801b8ea24fea1dc96e11eb63758a675b' THEN RAISE EXCEPTION 'v465: checksum mismatch private.aka_agent_notification_schedule_reports(timestamp with time zone)'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_notification_fanout(bigint)'))) IS DISTINCT FROM '461b803b4ce316a214e4615679f40668' THEN RAISE EXCEPTION 'v465: checksum mismatch private.aka_agent_notification_fanout(bigint)'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_notification_worker(text,jsonb)'))) IS DISTINCT FROM '60eb06ec7d4f83d086b4aebb91e48b35' THEN RAISE EXCEPTION 'v465: checksum mismatch public.aka_agent_notification_worker(text,jsonb)'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_notification_snapshot(text,jsonb)'))) IS DISTINCT FROM 'c67d59fad197519aeb90e43c6e146e16' THEN RAISE EXCEPTION 'v465: checksum mismatch public.aka_agent_notification_snapshot(text,jsonb)'; END IF;
  IF NOT has_function_privilege('service_role', 'public.aka_agent_notification_worker(text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aka_agent_notification_snapshot(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.aka_agent_notification_worker(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aka_agent_notification_snapshot(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_notification_worker(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'private.aka_agent_notification_fanout(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'v465: privilege check failed';
  END IF;
  IF (SELECT count(*) FROM public.auto_system_settings WHERE key IN ('notifications.digest_minutes.campaign', 'notifications.email.hourly_cap')) <> 2 THEN
    RAISE EXCEPTION 'v465: settings missing';
  END IF;
END
$v465_postcheck$;

COMMIT;

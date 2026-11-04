-- V457: Trung tâm thông báo akaBiz — nền tảng giai đoạn 1. CANDIDATE, CHƯA APPLY.
-- Hợp đồng: docs/NOTIFICATION_CENTER.md. Phương án đã chốt 04/11/2026.
-- Thêm: cột quản trị cho auto_email_notification_settings (+ trigger cầu nối cho Desktop/API cũ),
-- 5 bảng mới (subscriptions, notifications, deliveries, devices, data group member events),
-- trigger bắt sự kiện trên auto_campaigns(status), auto_accounts(status, login_status,
-- mobile_device_id) và auto_control_sessions(revoked_at), bước điều phối gắn vào tick 30 giây
-- sẵn có (gọi worker trên Fly qua pg_net khi có việc), RPC cho worker/số liệu/cài đặt.
-- Không thêm job cron, pool hay kết nối. Công tắc khẩn notifications.enabled mặc định 'false' và
-- notifications.delivery_mode mặc định 'dry_run': apply xong chưa tạo/gửi gì cho tới khi bật.
-- Ghi sự kiện vào/rời nhóm của bộ lọc động để ở V458 (sửa hàm core riêng).
-- Rollback thủ công: migrations/rollback_v457_notification_center.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v457_preflight$
DECLARE sig text;
BEGIN
  IF to_regclass('public.auto_notifications') IS NOT NULL OR to_regclass('public.auto_notification_subscriptions') IS NOT NULL
     OR to_regclass('public.auto_notification_deliveries') IS NOT NULL OR to_regclass('public.auto_notification_devices') IS NOT NULL
     OR to_regclass('public.auto_data_group_member_events') IS NOT NULL
     OR to_regclass('private.aka_agent_notification_dispatch_state') IS NOT NULL THEN
    RAISE EXCEPTION 'v457: notification tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_email_notification_settings'::regclass AND NOT attisdropped
             AND attname IN ('push_enabled','revision','settings_version','timezone','verified_emails','hourly_push_cap','quiet_hours','updated_by_client')) THEN
    RAISE EXCEPTION 'v457: settings columns already exist';
  END IF;
  -- Hàm duy nhất bị thay: định nghĩa live chụp ngày 04/11/2026.
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_data_group_background_tick()'))) IS DISTINCT FROM '873b2939cc09a51e0e9d71f685dfd0e0' THEN
    RAISE EXCEPTION 'v457: aka_agent_data_group_background_tick drift';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polname = 'v456_desktop_owner'
        AND polrelid IN ('public.auto_email_notification_settings'::regclass, 'public.auto_email_notification_deliveries'::regclass)) <> 2 THEN
    RAISE EXCEPTION 'v457: V456 policies missing';
  END IF;
  FOREACH sig IN ARRAY ARRAY['private.aka_agent_staff_scope_for_request()','private.aka_agent_assert_request_ownership(bigint,bigint,bigint)',
    'public.auto_assert_automation_identity(bigint,bigint,text,text)','public.aka_agent_app_access_staff_allowed(bigint,text)',
    'public.aka_agent_get_vault_secret(text)','net.http_post(text,jsonb,jsonb,jsonb,integer)'] LOOP
    IF to_regprocedure(sig) IS NULL THEN RAISE EXCEPTION 'v457: missing dependency %', sig; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE (n.nspname, p.proname) IN (('public','aka_agent_notification_dispatch'),('public','aka_agent_notification_worker'),
               ('public','aka_agent_notification_snapshot'),('public','aka_agent_control_notification_center'),('public','aka_agent_notification_center'))
                OR (n.nspname = 'private' AND p.proname LIKE 'aka_agent_notification%')) THEN
    RAISE EXCEPTION 'v457: notification functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_aka_agent_notify_campaign_status','trg_aka_agent_notify_account_status',
             'trg_aka_agent_notify_session_revoked','trg_aka_agent_notification_settings_before','trg_aka_agent_notification_settings_after')) THEN
    RAISE EXCEPTION 'v457: notification triggers already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key LIKE 'notifications.%') THEN
    RAISE EXCEPTION 'v457: notifications.* system settings already exist';
  END IF;
END
$v457_preflight$;

-- 1. Cột quản trị cho bảng cài đặt cũ (Desktop cũ upsert 9 cột vẫn chạy; cột mới có mặc định).
ALTER TABLE public.auto_email_notification_settings
  ADD COLUMN push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN settings_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  ADD COLUMN verified_emails text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN hourly_push_cap integer,
  ADD COLUMN quiet_hours jsonb,
  ADD COLUMN updated_by_client text,
  ADD CONSTRAINT auto_email_notification_settings_version_check CHECK (settings_version IN (1, 2)),
  ADD CONSTRAINT auto_email_notification_settings_push_cap_check CHECK (hourly_push_cap IS NULL OR hourly_push_cap BETWEEN 1 AND 1000),
  ADD CONSTRAINT auto_email_notification_settings_client_check CHECK (updated_by_client IS NULL OR updated_by_client IN ('web','ios','desktop','legacy','system'));

-- 2. Bảng mới. Không đặt FK tới org_staff/org_organization trên bảng ghi từ trigger nóng
-- (tránh khóa KEY SHARE trên dòng cha trong giao dịch đổi trạng thái chiến dịch/tài khoản).
CREATE TABLE public.auto_notification_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('campaign.status_changed','account.status_changed','report.scheduled','data_group.membership_changed')),
  scope text NOT NULL DEFAULT 'own' CHECK (scope IN ('own','organization')),
  is_enabled boolean NOT NULL DEFAULT false,
  email_enabled boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT false,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
  cooldown_minutes integer CHECK (cooldown_minutes IS NULL OR cooldown_minutes BETWEEN 0 AND 1440),
  schedule_week_days smallint[],
  schedule_times time without time zone[],
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_notification_subscriptions_unique UNIQUE (staff_id, event_type, scope)
);
CREATE INDEX idx_auto_notification_subscriptions_report_due ON public.auto_notification_subscriptions (next_run_at)
  WHERE event_type = 'report.scheduled' AND is_enabled;

CREATE TABLE public.auto_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('campaign.status_changed','account.status_changed','report.scheduled',
    'data_group.membership_changed','system.test','system.verify_email')),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  account_id bigint,
  campaign_id bigint,
  data_group_id bigint,
  dynamic_filter_id bigint,
  entity_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deliver_after timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  content_status text NOT NULL DEFAULT 'pending' CHECK (content_status IN ('pending','rendering','ready','merged','suppressed','failed')),
  merged_into_id bigint REFERENCES public.auto_notifications(id) ON DELETE SET NULL,
  app_title text,
  app_body text,
  email_subject text,
  content_snapshot jsonb,
  template_version smallint,
  email_state text NOT NULL DEFAULT 'none' CHECK (email_state IN ('none','pending','sent','partial','failed','skipped')),
  push_state text NOT NULL DEFAULT 'none' CHECK (push_state IN ('none','pending','sent','partial','failed','skipped')),
  email_sent_at timestamptz,
  push_sent_at timestamptz,
  read_at timestamptz,
  lease_token uuid,
  leased_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_notifications_dedupe_unique UNIQUE (dedupe_key)
);
CREATE INDEX idx_auto_notifications_inbox ON public.auto_notifications (staff_id, created_at DESC, id DESC) WHERE content_status = 'ready';
CREATE INDEX idx_auto_notifications_unread ON public.auto_notifications (staff_id) WHERE read_at IS NULL AND content_status = 'ready';
CREATE INDEX idx_auto_notifications_due ON public.auto_notifications (deliver_after, id) WHERE content_status IN ('pending','rendering');
CREATE INDEX idx_auto_notifications_cooldown ON public.auto_notifications (staff_id, event_type, entity_key, occurred_at DESC);
CREATE INDEX idx_auto_notifications_created ON public.auto_notifications (created_at);
CREATE INDEX idx_auto_notifications_merged ON public.auto_notifications (merged_into_id) WHERE merged_into_id IS NOT NULL;

CREATE TABLE public.auto_notification_devices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  control_session_id uuid REFERENCES public.auto_control_sessions(id) ON DELETE SET NULL,
  installation_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios')),
  device_name text CHECK (device_name IS NULL OR char_length(device_name) <= 120),
  device_model text CHECK (device_model IS NULL OR char_length(device_model) <= 120),
  os_version text CHECK (os_version IS NULL OR char_length(os_version) <= 40),
  app_version text CHECK (app_version IS NULL OR char_length(app_version) <= 40),
  bundle_id text NOT NULL CHECK (bundle_id IN ('net.akabiz.agent','net.akabiz.agent.dev')),
  provider text NOT NULL DEFAULT 'apns' CHECK (provider IN ('apns')),
  push_token text CHECK (push_token IS NULL OR push_token ~ '^[0-9a-f]{32,200}$'),
  apns_environment text NOT NULL DEFAULT 'production' CHECK (apns_environment IN ('sandbox','production')),
  permission_status text CHECK (permission_status IS NULL OR permission_status IN ('granted','denied','undetermined','provisional')),
  is_enabled boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  deactivated_reason text CHECK (deactivated_reason IS NULL OR deactivated_reason IN ('logout','session_revoked','token_invalid','staff_changed','user_removed')),
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_notification_devices_installation_unique UNIQUE (installation_id)
);
CREATE UNIQUE INDEX uq_auto_notification_devices_active_token ON public.auto_notification_devices (push_token) WHERE is_active AND push_token IS NOT NULL;
CREATE INDEX idx_auto_notification_devices_staff ON public.auto_notification_devices (staff_id) WHERE is_active;
CREATE INDEX idx_auto_notification_devices_session ON public.auto_notification_devices (control_session_id) WHERE control_session_id IS NOT NULL;

CREATE TABLE public.auto_notification_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id bigint NOT NULL REFERENCES public.auto_notifications(id) ON DELETE CASCADE,
  staff_id bigint NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','push')),
  provider text NOT NULL CHECK (provider IN ('smtp','apns')),
  destination text NOT NULL,
  device_id bigint REFERENCES public.auto_notification_devices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','retrying','sent','failed','skipped','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 4 CHECK (max_attempts BETWEEN 1 AND 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  leased_until timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_notification_deliveries_unique UNIQUE (notification_id, channel, destination)
);
CREATE INDEX idx_auto_notification_deliveries_due ON public.auto_notification_deliveries (next_attempt_at, id) WHERE status IN ('pending','retrying','sending');
CREATE INDEX idx_auto_notification_deliveries_push_cap ON public.auto_notification_deliveries (staff_id, created_at) WHERE channel = 'push';
CREATE INDEX idx_auto_notification_deliveries_device ON public.auto_notification_deliveries (device_id) WHERE device_id IS NOT NULL;

CREATE TABLE public.auto_data_group_member_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint,
  staff_id bigint NOT NULL,
  group_id bigint NOT NULL,
  dynamic_filter_id bigint,
  filter_revision bigint,
  filter_summary text,
  membership_id bigint,
  contact_id bigint,
  contact_label text,
  action text NOT NULL CHECK (action IN ('added','removed')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  group_total_after integer,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auto_data_group_member_events_group ON public.auto_data_group_member_events (group_id, occurred_at DESC, id DESC);
CREATE INDEX idx_auto_data_group_member_events_run ON public.auto_data_group_member_events (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX idx_auto_data_group_member_events_created ON public.auto_data_group_member_events (created_at);

CREATE TABLE private.aka_agent_notification_dispatch_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  leased_until timestamptz,
  last_called_at timestamptz,
  last_request_id bigint,
  last_cleanup_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.aka_agent_notification_dispatch_state (id) VALUES (1);

-- Chỉ truy cập qua hàm SECURITY DEFINER; không mở bảng cho role nào (kể cả service_role).
DO $v457_table_acl$
DECLARE t text; seq text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.auto_notification_subscriptions','public.auto_notifications','public.auto_notification_devices',
                           'public.auto_notification_deliveries','public.auto_data_group_member_events'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api', t);
    seq := pg_get_serial_sequence(t, 'id');
    IF seq IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api', seq);
    END IF;
  END LOOP;
  REVOKE ALL ON TABLE private.aka_agent_notification_dispatch_state FROM PUBLIC;
END
$v457_table_acl$;

-- 3. Cấu hình hệ thống (không bí mật). Mặc định tắt và chạy thử.
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('notifications.enabled', 'false', 'Công tắc khẩn trung tâm thông báo: false = không tạo và không gửi thông báo mới.', false, true),
  ('notifications.delivery_mode', 'dry_run', 'dry_run: dựng nội dung, ghi lượt gửi là skipped; live: gửi email/push thật.', false, true),
  ('notifications.cooldown_minutes.campaign', '10', 'Phút chờ giữa hai thông báo cùng chiến dịch cùng trạng thái (Hoàn thành/Tạm dừng).', false, true),
  ('notifications.cooldown_minutes.account', '15', 'Phút chờ mặc định giữa hai thông báo cùng tài khoản cùng sự kiện.', false, true),
  ('notifications.push.hourly_cap', '60', 'Trần số push mỗi giờ cho một nhân viên.', false, true),
  ('notifications.retention_days', '90', 'Số ngày giữ thông báo.', false, true),
  ('notifications.report_retention_days', '30', 'Số ngày giữ nội dung báo cáo (content_snapshot).', false, true),
  ('notifications.member_event_retention_days', '90', 'Số ngày giữ nhật ký vào/rời nhóm.', false, true);

-- 4. Hàm phụ (private, chỉ owner gọi trực tiếp).
CREATE FUNCTION private.aka_agent_notification_setting(p_key text, p_default text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT s.value FROM public.auto_system_settings s WHERE s.key = p_key AND s.is_active IS TRUE LIMIT 1), p_default)
$$;

CREATE FUNCTION private.aka_agent_notification_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT lower(btrim(private.aka_agent_notification_setting('notifications.enabled', 'false'))) IN ('true', '1', 'on', 'yes')
$$;

CREATE FUNCTION private.aka_agent_notification_int_setting(p_key text, p_default integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN v ~ '^[0-9]{1,6}$' THEN v::integer ELSE p_default END
  FROM (SELECT btrim(private.aka_agent_notification_setting(p_key, p_default::text)) AS v) x
$$;

CREATE FUNCTION private.aka_agent_notification_default_filters(p_event_type text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE p_event_type
    WHEN 'campaign.status_changed' THEN '{"toStatuses":["hoàn thành","tạm dừng"],"campaignIds":null}'::jsonb
    WHEN 'account.status_changed' THEN '{"loginEvents":["logout","checkpoint","login"],"runStatuses":[],"accountIds":null}'::jsonb
    WHEN 'report.scheduled' THEN '{"skipWhenIdle":false,"maxCampaigns":50}'::jsonb
    WHEN 'data_group.membership_changed' THEN '{"groupIds":null,"actions":["added","removed"],"bucketMinutes":5,"includeSharedGroups":false}'::jsonb
    ELSE '{}'::jsonb END
$$;

-- Mốc kế tiếp > p_after theo thứ (1 = Thứ Hai … 7 = Chủ nhật) và giờ địa phương p_tz.
CREATE FUNCTION private.aka_agent_notification_next_run(p_week_days smallint[], p_times time without time zone[], p_tz text, p_after timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $$
DECLARE v_local timestamp := p_after AT TIME ZONE p_tz; v_day date; v_t time; v_candidate timestamptz; i integer;
BEGIN
  IF p_times IS NULL OR cardinality(p_times) = 0 THEN RETURN NULL; END IF;
  FOR i IN 0..7 LOOP
    v_day := v_local::date + i;
    IF p_week_days IS NOT NULL AND cardinality(p_week_days) > 0
       AND NOT (extract(isodow FROM v_day)::smallint = ANY (p_week_days)) THEN
      CONTINUE;
    END IF;
    FOR v_t IN SELECT t FROM unnest(p_times) AS t ORDER BY t LOOP
      v_candidate := (v_day + v_t) AT TIME ZONE p_tz;
      IF v_candidate > p_after THEN RETURN v_candidate; END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END
$$;

-- Nguồn ghi suy từ role của phiên (SET ROLE còn giữ trong SECURITY DEFINER).
CREATE FUNCTION private.aka_agent_notification_change_source()
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT CASE coalesce(nullif(current_setting('role', true), 'none'), session_user::text)
    WHEN 'aka_agent_desktop' THEN 'desktop'
    WHEN 'aka_agent_chat_api' THEN 'chat_api'
    WHEN 'service_role' THEN 'server'
    WHEN 'authenticator' THEN 'server'
    ELSE 'system' END
$$;

CREATE FUNCTION private.aka_agent_notification_staff_org(p_staff_id bigint, p_fallback bigint)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(p_fallback, (SELECT s.organization_id FROM public.org_staff s WHERE s.id = p_staff_id))
$$;

CREATE FUNCTION private.aka_agent_notification_mask_email(p_email text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p_email IS NULL OR position('@' IN p_email) < 2 THEN p_email
    ELSE left(split_part(p_email, '@', 1), 2) || '***@' || split_part(p_email, '@', 2) END
$$;

-- Thư xác minh địa chỉ email mới: tối đa 1 thư/địa chỉ/ngày, chỉ khi trung tâm đang bật.
CREATE FUNCTION private.aka_agent_notification_request_verification(p_staff_id bigint, p_organization_id bigint, p_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_now timestamptz := clock_timestamp(); v_email text := lower(btrim(p_email)); v_rows integer;
BEGIN
  IF NOT private.aka_agent_notification_enabled() OR v_email IS NULL OR v_email = '' THEN RETURN false; END IF;
  INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, entity_key, occurred_at, deliver_after, dedupe_key, payload)
  VALUES (p_organization_id, p_staff_id, 'system.verify_email', 'info', 'email:' || v_email, v_now, v_now,
    format('ve:%s:%s:%s', p_staff_id, v_email, to_char(v_now AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')),
    jsonb_build_object('email', v_email, 'requestedAt', v_now))
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END
$$;

-- 5. Bắt sự kiện. Chỉ đọc theo khóa rồi chèn 1 dòng; không đếm số liệu ở đây.
CREATE FUNCTION private.aka_agent_notification_capture_campaign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_sub public.auto_notification_subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_to text := NEW.status;
  v_cooldown integer;
  v_last bigint;
  v_org bigint;
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
  v_org := private.aka_agent_notification_staff_org(NEW.staff_id, NEW.organization_id);
  INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, campaign_id, account_id, entity_key,
                                         occurred_at, deliver_after, dedupe_key, payload)
  VALUES (v_org, NEW.staff_id, 'campaign.status_changed', CASE WHEN v_to = 'tạm dừng' THEN 'warning' ELSE 'info' END,
          NEW.id, NEW.account_id, 'campaign:' || NEW.id, v_now, v_now + interval '30 seconds',
          format('cs:%s:%s:%s', NEW.id, v_to, txid_current()),
          jsonb_build_object('campaignId', NEW.id, 'campaignName', NEW.name, 'actionId', NEW.action_id, 'accountId', NEW.account_id,
                             'fromStatus', OLD.status, 'toStatus', v_to, 'note', NEW.note, 'changedAt', v_now,
                             'source', private.aka_agent_notification_change_source()))
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
END
$$;

CREATE FUNCTION private.aka_agent_notification_capture_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_sub public.auto_notification_subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_kind text; v_event text; v_cooldown integer; v_last bigint; v_org bigint; v_filter_key text;
BEGIN
  IF NEW.is_delete IS TRUE THEN RETURN NULL; END IF;
  IF OLD.login_status IS DISTINCT FROM NEW.login_status THEN
    v_kind := 'login';
    v_event := CASE NEW.login_status WHEN 'đã đăng nhập' THEN 'login' WHEN 'chưa đăng nhập' THEN 'logout' WHEN 'checkpoint' THEN 'checkpoint' END;
  ELSIF OLD.mobile_device_id IS DISTINCT FROM NEW.mobile_device_id AND NEW.flatform_type = 'sms' THEN
    v_kind := 'device';
    v_event := CASE WHEN NEW.mobile_device_id IS NULL THEN 'logout' ELSE 'login' END;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    v_kind := 'run';
    v_event := NEW.status;
  END IF;
  IF v_event IS NULL THEN RETURN NULL; END IF;
  IF NOT private.aka_agent_notification_enabled() THEN RETURN NULL; END IF;
  SELECT * INTO v_sub FROM public.auto_notification_subscriptions
   WHERE staff_id = NEW.staff_id AND event_type = 'account.status_changed' AND scope = 'own' AND is_enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_filter_key := CASE WHEN v_kind = 'run' THEN 'runStatuses' ELSE 'loginEvents' END;
  IF NOT (coalesce(v_sub.filters -> v_filter_key, private.aka_agent_notification_default_filters('account.status_changed') -> v_filter_key) ? v_event) THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v_sub.filters -> 'accountIds') = 'array' AND NOT ((v_sub.filters -> 'accountIds') @> to_jsonb(NEW.id)) THEN
    RETURN NULL;
  END IF;
  v_cooldown := coalesce(v_sub.cooldown_minutes, private.aka_agent_notification_int_setting('notifications.cooldown_minutes.account', 15));
  IF v_cooldown > 0 THEN
    SELECT n.id INTO v_last FROM public.auto_notifications n
     WHERE n.staff_id = NEW.staff_id AND n.event_type = 'account.status_changed' AND n.entity_key = 'account:' || NEW.id
       AND n.occurred_at > v_now - make_interval(mins => v_cooldown) AND n.payload ->> 'event' = v_event
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
  v_org := private.aka_agent_notification_staff_org(NEW.staff_id, NEW.organization_id);
  INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, account_id, entity_key,
                                         occurred_at, deliver_after, dedupe_key, payload)
  VALUES (v_org, NEW.staff_id, 'account.status_changed',
          CASE WHEN v_event IN ('logout', 'checkpoint') THEN 'critical' ELSE 'info' END,
          NEW.id, 'account:' || NEW.id, v_now, v_now + interval '30 seconds',
          format('as:%s:%s:%s', NEW.id, v_event, txid_current()),
          jsonb_build_object('accountId', NEW.id, 'accountName', NEW.name, 'platform', NEW.flatform_type, 'kind', v_kind, 'event', v_event,
                             'fromLoginStatus', OLD.login_status, 'toLoginStatus', NEW.login_status,
                             'fromStatus', OLD.status, 'toStatus', NEW.status,
                             'deviceAttached', NEW.mobile_device_id IS NOT NULL, 'changedAt', v_now,
                             'source', private.aka_agent_notification_change_source()))
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
END
$$;

CREATE FUNCTION private.aka_agent_notification_session_revoked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.auto_notification_devices
     SET is_active = false, deactivated_reason = 'session_revoked', updated_at = clock_timestamp()
   WHERE control_session_id = NEW.id AND is_active;
  RETURN NULL;
END
$$;

CREATE TRIGGER trg_aka_agent_notify_campaign_status
  AFTER UPDATE OF status ON public.auto_campaigns
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.is_delete IS NOT TRUE AND NEW.staff_id IS NOT NULL)
  EXECUTE FUNCTION private.aka_agent_notification_capture_campaign();

CREATE TRIGGER trg_aka_agent_notify_account_status
  AFTER UPDATE OF status, login_status, mobile_device_id ON public.auto_accounts
  FOR EACH ROW
  WHEN ((OLD.status IS DISTINCT FROM NEW.status OR OLD.login_status IS DISTINCT FROM NEW.login_status
         OR OLD.mobile_device_id IS DISTINCT FROM NEW.mobile_device_id) AND NEW.staff_id IS NOT NULL)
  EXECUTE FUNCTION private.aka_agent_notification_capture_account();

CREATE TRIGGER trg_aka_agent_notify_session_revoked
  AFTER UPDATE OF revoked_at ON public.auto_control_sessions
  FOR EACH ROW
  WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION private.aka_agent_notification_session_revoked();

-- 6. Cầu nối cho client cũ (Desktop upsert 9 cột, API email 5 trường). RPC mới đặt
-- aka.notification_center_write = 'on' trong giao dịch nên hai trigger này bỏ qua.
CREATE FUNCTION private.aka_agent_notification_apply_legacy_campaign(p_staff_id bigint, p_organization_id bigint, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.auto_notification_subscriptions AS s (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled, filters)
  VALUES (p_staff_id, p_organization_id, 'campaign.status_changed', p_enabled, p_enabled, false,
          jsonb_build_object('toStatuses', jsonb_build_array('hoàn thành'), 'campaignIds', NULL))
  ON CONFLICT (staff_id, event_type, scope) DO UPDATE
     SET email_enabled = p_enabled,
         is_enabled = p_enabled OR s.push_enabled,
         filters = CASE WHEN p_enabled AND NOT (coalesce(s.filters -> 'toStatuses', '[]'::jsonb) ? 'hoàn thành')
                        THEN jsonb_set(s.filters, '{toStatuses}', coalesce(s.filters -> 'toStatuses', '[]'::jsonb) || '["hoàn thành"]'::jsonb, true)
                        ELSE s.filters END,
         updated_at = now();
END
$$;

CREATE FUNCTION private.aka_agent_notification_apply_legacy_report(p_staff_id bigint, p_organization_id bigint, p_enabled boolean,
  p_time time without time zone, p_timezone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_time time without time zone := coalesce(p_time, '18:00'::time);
BEGIN
  INSERT INTO public.auto_notification_subscriptions AS s (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled,
                                                          filters, schedule_week_days, schedule_times)
  VALUES (p_staff_id, p_organization_id, 'report.scheduled', p_enabled, p_enabled, false,
          private.aka_agent_notification_default_filters('report.scheduled'), ARRAY[1,2,3,4,5,6,7]::smallint[], ARRAY[v_time])
  ON CONFLICT (staff_id, event_type, scope) DO UPDATE
     SET email_enabled = p_enabled,
         is_enabled = p_enabled OR s.push_enabled,
         schedule_week_days = coalesce(s.schedule_week_days, ARRAY[1,2,3,4,5,6,7]::smallint[]),
         schedule_times = (SELECT array_agg(DISTINCT t ORDER BY t)
                             FROM unnest(ARRAY[v_time] || coalesce((SELECT array_agg(x ORDER BY x) FROM unnest(s.schedule_times) x)[2:], '{}'::time[])) AS t),
         updated_at = now();
  UPDATE public.auto_notification_subscriptions
     SET next_run_at = CASE WHEN is_enabled
                            THEN private.aka_agent_notification_next_run(schedule_week_days, schedule_times, coalesce(p_timezone, 'Asia/Ho_Chi_Minh'), clock_timestamp())
                       END
   WHERE staff_id = p_staff_id AND event_type = 'report.scheduled' AND scope = 'own';
END
$$;

CREATE FUNCTION private.aka_agent_notification_settings_before()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF coalesce(current_setting('aka.notification_center_write', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.updated_by_client := coalesce(NEW.updated_by_client, 'legacy');
  ELSIF (NEW.is_enabled, NEW.recipient_emails, NEW.notify_campaign_completed, NEW.daily_report_enabled, NEW.daily_report_time, NEW.is_delete)
        IS DISTINCT FROM (OLD.is_enabled, OLD.recipient_emails, OLD.notify_campaign_completed, OLD.daily_report_enabled, OLD.daily_report_time, OLD.is_delete) THEN
    NEW.revision := OLD.revision + 1;
    NEW.updated_by_client := 'legacy';
  END IF;
  -- Danh sách đã xác minh luôn là tập con của danh sách nhận.
  NEW.verified_emails := ARRAY(SELECT e FROM unnest(coalesce(NEW.verified_emails, '{}'::text[])) AS e
                                WHERE e = ANY (coalesce(NEW.recipient_emails, '{}'::text[])));
  RETURN NEW;
END
$$;

CREATE FUNCTION private.aka_agent_notification_settings_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_org bigint; v_email text; v_old_recipients text[];
BEGIN
  IF coalesce(current_setting('aka.notification_center_write', true), '') = 'on' THEN RETURN NULL; END IF;
  v_org := private.aka_agent_notification_staff_org(NEW.staff_id, NEW.organization_id);
  IF TG_OP = 'INSERT' OR NEW.notify_campaign_completed IS DISTINCT FROM OLD.notify_campaign_completed
     OR NEW.is_enabled IS DISTINCT FROM OLD.is_enabled OR NEW.is_delete IS DISTINCT FROM OLD.is_delete THEN
    PERFORM private.aka_agent_notification_apply_legacy_campaign(NEW.staff_id, v_org,
      NEW.notify_campaign_completed AND NEW.is_enabled AND NOT NEW.is_delete);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.daily_report_enabled IS DISTINCT FROM OLD.daily_report_enabled
     OR NEW.daily_report_time IS DISTINCT FROM OLD.daily_report_time
     OR NEW.is_enabled IS DISTINCT FROM OLD.is_enabled OR NEW.is_delete IS DISTINCT FROM OLD.is_delete THEN
    PERFORM private.aka_agent_notification_apply_legacy_report(NEW.staff_id, v_org,
      NEW.daily_report_enabled AND NEW.is_enabled AND NOT NEW.is_delete, NEW.daily_report_time, NEW.timezone);
  END IF;
  v_old_recipients := CASE WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.recipient_emails, '{}'::text[]) ELSE '{}'::text[] END;
  IF NEW.is_enabled AND NOT NEW.is_delete THEN
    FOREACH v_email IN ARRAY coalesce(NEW.recipient_emails, '{}'::text[]) LOOP
      IF NOT (v_email = ANY (NEW.verified_emails)) AND NOT (v_email = ANY (v_old_recipients)) THEN
        PERFORM private.aka_agent_notification_request_verification(NEW.staff_id, v_org, v_email);
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER trg_aka_agent_notification_settings_before
  BEFORE INSERT OR UPDATE ON public.auto_email_notification_settings
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_notification_settings_before();

CREATE TRIGGER trg_aka_agent_notification_settings_after
  AFTER INSERT OR UPDATE OF is_enabled, recipient_emails, notify_campaign_completed, daily_report_enabled, daily_report_time, is_delete
  ON public.auto_email_notification_settings
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_notification_settings_after();

-- 7. Báo cáo theo lịch, dọn dữ liệu, điều phối (chạy trong tick 30 giây sẵn có).
CREATE FUNCTION private.aka_agent_notification_schedule_reports(p_now timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record; v_count integer := 0; v_tz text; v_slot_local text;
BEGIN
  FOR r IN
    SELECT s.* FROM public.auto_notification_subscriptions s
     WHERE s.event_type = 'report.scheduled' AND s.is_enabled AND s.next_run_at IS NOT NULL AND s.next_run_at <= p_now
     ORDER BY s.next_run_at LIMIT 200 FOR UPDATE SKIP LOCKED
  LOOP
    SELECT coalesce(min(e.timezone), 'Asia/Ho_Chi_Minh') INTO v_tz FROM public.auto_email_notification_settings e WHERE e.staff_id = r.staff_id;
    v_slot_local := to_char(r.next_run_at AT TIME ZONE v_tz, 'YYYY-MM-DD"T"HH24:MI');
    -- Lỡ nhiều mốc (sự cố) chỉ tạo một báo cáo cho mốc đến hạn sớm nhất rồi nhảy tới mốc tương lai.
    INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, entity_key, occurred_at, deliver_after, dedupe_key, payload)
    VALUES (r.organization_id, r.staff_id, 'report.scheduled', 'info', 'report:' || v_slot_local, p_now, p_now,
            format('rp:%s:%s', r.staff_id, v_slot_local),
            jsonb_build_object('slotAt', r.next_run_at, 'slotLocal', v_slot_local, 'timezone', v_tz,
                               'skipWhenIdle', coalesce((r.filters ->> 'skipWhenIdle')::boolean, false),
                               'maxCampaigns', least(greatest(coalesce((r.filters ->> 'maxCampaigns')::integer, 50), 1), 100)))
    ON CONFLICT (dedupe_key) DO NOTHING;
    UPDATE public.auto_notification_subscriptions
       SET last_run_at = r.next_run_at,
           next_run_at = private.aka_agent_notification_next_run(r.schedule_week_days, r.schedule_times, v_tz, p_now),
           updated_at = p_now
     WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$$;

-- Dọn theo lô nhỏ, tối đa 1 lần/giờ; báo cáo giữ nội dung 30 ngày rồi xóa snapshot.
CREATE FUNCTION private.aka_agent_notification_cleanup(p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_notifications integer; v_snapshots integer; v_events integer;
BEGIN
  DELETE FROM public.auto_notifications WHERE id IN (
    SELECT id FROM public.auto_notifications
     WHERE created_at < p_now - make_interval(days => private.aka_agent_notification_int_setting('notifications.retention_days', 90))
     ORDER BY created_at LIMIT 1000);
  GET DIAGNOSTICS v_notifications = ROW_COUNT;
  UPDATE public.auto_notifications SET content_snapshot = NULL, updated_at = p_now WHERE id IN (
    SELECT id FROM public.auto_notifications
     WHERE event_type = 'report.scheduled' AND content_snapshot IS NOT NULL
       AND created_at < p_now - make_interval(days => private.aka_agent_notification_int_setting('notifications.report_retention_days', 30))
     ORDER BY created_at LIMIT 1000);
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;
  DELETE FROM public.auto_data_group_member_events WHERE id IN (
    SELECT id FROM public.auto_data_group_member_events
     WHERE created_at < p_now - make_interval(days => private.aka_agent_notification_int_setting('notifications.member_event_retention_days', 90))
     ORDER BY created_at LIMIT 5000);
  GET DIAGNOSTICS v_events = ROW_COUNT;
  RETURN jsonb_build_object('notifications', v_notifications, 'reportSnapshots', v_snapshots, 'memberEvents', v_events);
END
$$;

-- Gọi worker trên Fly đúng 1 lần khi có việc; khóa thuê 60 giây tránh chạy chồng.
-- URL và token đọc từ Vault: AKA_AGENT_NOTIFICATION_DISPATCH_URL, AKA_AGENT_NOTIFICATION_DISPATCH_TOKEN.
CREATE FUNCTION public.aka_agent_notification_dispatch()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_state private.aka_agent_notification_dispatch_state%ROWTYPE;
  v_reports integer := 0; v_cleanup jsonb; v_has_work boolean; v_url text; v_token text; v_request bigint;
BEGIN
  IF NOT private.aka_agent_notification_enabled() THEN RETURN jsonb_build_object('enabled', false); END IF;
  v_reports := private.aka_agent_notification_schedule_reports(v_now);
  SELECT * INTO v_state FROM private.aka_agent_notification_dispatch_state WHERE id = 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('enabled', true, 'reports', v_reports, 'skipped', 'state_locked'); END IF;
  IF v_state.last_cleanup_at IS NULL OR v_state.last_cleanup_at < v_now - interval '1 hour' THEN
    v_cleanup := private.aka_agent_notification_cleanup(v_now);
    UPDATE private.aka_agent_notification_dispatch_state SET last_cleanup_at = v_now, updated_at = v_now WHERE id = 1;
  END IF;
  v_has_work := EXISTS (SELECT 1 FROM public.auto_notifications n
                         WHERE (n.content_status = 'pending' AND n.deliver_after <= v_now)
                            OR (n.content_status = 'rendering' AND n.leased_until < v_now))
             OR EXISTS (SELECT 1 FROM public.auto_notification_deliveries d
                         WHERE (d.status IN ('pending', 'retrying') AND d.next_attempt_at <= v_now)
                            OR (d.status = 'sending' AND d.leased_until < v_now));
  IF NOT v_has_work THEN
    RETURN jsonb_build_object('enabled', true, 'reports', v_reports, 'work', false, 'cleanup', v_cleanup);
  END IF;
  IF v_state.leased_until IS NOT NULL AND v_state.leased_until > v_now THEN
    RETURN jsonb_build_object('enabled', true, 'reports', v_reports, 'work', true, 'busy', true);
  END IF;
  v_url := public.aka_agent_get_vault_secret('AKA_AGENT_NOTIFICATION_DISPATCH_URL');
  v_token := public.aka_agent_get_vault_secret('AKA_AGENT_NOTIFICATION_DISPATCH_TOKEN');
  IF v_url IS NULL OR btrim(v_url) = '' OR v_token IS NULL OR btrim(v_token) = '' THEN
    RETURN jsonb_build_object('enabled', true, 'reports', v_reports, 'work', true, 'configured', false);
  END IF;
  -- Máy Fly có thể đang dừng (auto stop): chờ tối đa 30 giây để proxy bật lại.
  SELECT net.http_post(url := v_url,
                       body := jsonb_build_object('reason', 'tick', 'at', v_now),
                       params := '{}'::jsonb,
                       headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-token', v_token),
                       timeout_milliseconds := 30000)
    INTO v_request;
  UPDATE private.aka_agent_notification_dispatch_state
     SET leased_until = v_now + interval '60 seconds', last_called_at = v_now, last_request_id = v_request, updated_at = v_now
   WHERE id = 1;
  RETURN jsonb_build_object('enabled', true, 'reports', v_reports, 'work', true, 'requestId', v_request, 'cleanup', v_cleanup);
END
$$;

-- 8. RPC cho worker (chỉ service_role). Mọi lần nhận việc dùng FOR UPDATE SKIP LOCKED + lease_token.
CREATE FUNCTION private.aka_agent_notification_refresh_channel_state(p_notification_id bigint, p_channel text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c record; v_state text; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT count(*) AS total,
         count(*) FILTER (WHERE status IN ('pending', 'sending', 'retrying')) AS open,
         count(*) FILTER (WHERE status = 'sent') AS sent,
         count(*) FILTER (WHERE status = 'skipped') AS skipped
    INTO c FROM public.auto_notification_deliveries WHERE notification_id = p_notification_id AND channel = p_channel;
  v_state := CASE WHEN c.total = 0 THEN 'none'
                  WHEN c.open > 0 THEN 'pending'
                  WHEN c.skipped = c.total THEN 'skipped'
                  WHEN c.sent > 0 AND c.sent = c.total - c.skipped THEN 'sent'
                  WHEN c.sent > 0 THEN 'partial'
                  ELSE 'failed' END;
  IF p_channel = 'email' THEN
    UPDATE public.auto_notifications SET email_state = v_state,
           email_sent_at = CASE WHEN c.sent > 0 THEN coalesce(email_sent_at, v_now) ELSE email_sent_at END, updated_at = v_now
     WHERE id = p_notification_id;
  ELSE
    UPDATE public.auto_notifications SET push_state = v_state,
           push_sent_at = CASE WHEN c.sent > 0 THEN coalesce(push_sent_at, v_now) ELSE push_sent_at END, updated_at = v_now
     WHERE id = p_notification_id;
  END IF;
END
$$;

-- Chia lượt gửi theo cài đặt tại thời điểm gửi. dry_run: ghi lượt gửi 'skipped' để đối chiếu.
CREATE FUNCTION private.aka_agent_notification_fanout(p_notification_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  n public.auto_notifications%ROWTYPE;
  s public.auto_email_notification_settings%ROWTYPE;
  sub public.auto_notification_subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_live boolean := private.aka_agent_notification_setting('notifications.delivery_mode', 'dry_run') = 'live';
  v_allowed boolean; v_email_on boolean := false; v_push_on boolean := false; v_emails text[] := '{}'; v_cap integer; v_recent integer;
  v_email_rows integer := 0; v_push_rows integer := 0; v_has_settings boolean;
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
    INSERT INTO public.auto_notification_deliveries (notification_id, staff_id, channel, provider, destination, status, last_error_code)
    SELECT n.id, n.staff_id, 'email', 'smtp', e, CASE WHEN v_live THEN 'pending' ELSE 'skipped' END, CASE WHEN v_live THEN NULL ELSE 'dry_run' END
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

CREATE FUNCTION public.aka_agent_notification_worker(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
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
    -- Gộp loạt thay đổi cùng trạng thái của một nhân viên (từ 5 chiến dịch, trong 2 phút) thành 1 thông báo.
    FOR g IN
      WITH due AS (
        SELECT n.id, n.staff_id, n.payload ->> 'toStatus' AS to_status, n.occurred_at
          FROM public.auto_notifications n
         WHERE n.content_status = 'pending' AND n.deliver_after <= v_now AND n.event_type = 'campaign.status_changed'
         ORDER BY n.deliver_after, n.id LIMIT 2000
           FOR UPDATE SKIP LOCKED)
      SELECT staff_id, to_status, min(id) AS keep_id, array_agg(id ORDER BY id) AS ids, count(*) AS total
        FROM due GROUP BY staff_id, to_status
      HAVING count(*) >= 5 AND max(occurred_at) - min(occurred_at) <= interval '2 minutes'
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
             lease_token = NULL, leased_until = NULL, last_error = NULL, updated_at = v_now
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

-- 9. Số liệu cho nội dung thông báo (chỉ đọc, service_role). Worker gọi sau sự kiện vài giây.
CREATE FUNCTION private.aka_agent_notification_result_group(p_report_group text, p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(p_report_group, CASE
    WHEN p_status IN ('thất bại', 'lỗi', 'không tồn tại', 'tag không tồn tại', 'tham số không hợp lệ') THEN 'failure'
    WHEN p_status IN ('bỏ qua', 'đã là bạn bè', 'đã gửi lời mời', 'đã là thành viên', 'đã tham gia') THEN 'skipped'
    ELSE 'success' END)
$$;

CREATE FUNCTION public.aka_agent_notification_snapshot(p_kind text, p_payload jsonb DEFAULT '{}'::jsonb)
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
    SELECT coalesce(jsonb_agg(jsonb_build_object('action', action, 'group', grp, 'total', total, 'today', today) ORDER BY action, grp), '[]'::jsonb)
      INTO v_results
      FROM (SELECT coalesce(nullif(d.action_name, ''), d.action_code, 'Hành động') AS action,
                   private.aka_agent_notification_result_group(d.report_group, d.status) AS grp,
                   count(*) AS total, count(*) FILTER (WHERE d.created_at >= v_day_start) AS today
              FROM public.auto_campaign_details d
             WHERE d.campaign_id = v_id AND d.is_delete = false
             GROUP BY 1, 2) r;
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
                               'closeCode', o.socket_last_close_code, 'lastDisconnectedAt', o.last_socket_disconnected_at)
                               FROM public.chat_zalo_account_organization o WHERE o.auto_account_id = a.id ORDER BY o.updated_at DESC LIMIT 1),
             'lastLog', (SELECT jsonb_build_object('at', l.created_at, 'event', l.event_type, 'message', left(l.message, 300), 'source', l.source)
                           FROM public.auto_account_logs l
                          WHERE l.account_id = a.id AND l.created_at BETWEEN v_at - interval '2 minutes' AND v_at + interval '2 minutes'
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
    SELECT jsonb_build_object('total', count(*),
             'loggedIn', count(*) FILTER (WHERE login_status = 'đã đăng nhập'),
             'loggedOut', count(*) FILTER (WHERE login_status = 'chưa đăng nhập'),
             'checkpoint', count(*) FILTER (WHERE login_status = 'checkpoint'),
             'running', count(*) FILTER (WHERE status = 'đang chạy'),
             'pending', count(*) FILTER (WHERE status = 'chờ xử lý'),
             'paused', count(*) FILTER (WHERE status = 'tạm dừng'))
      INTO v_accounts
      FROM public.auto_accounts WHERE staff_id = v_staff AND is_delete IS NOT TRUE;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'platform', flatform_type, 'loginStatus', login_status, 'since', updated_at)
                              ORDER BY updated_at DESC), '[]'::jsonb)
      INTO v_logged_out
      FROM (SELECT id, name, flatform_type, login_status, updated_at FROM public.auto_accounts
             WHERE staff_id = v_staff AND is_delete IS NOT TRUE AND login_status IN ('chưa đăng nhập', 'checkpoint')
             ORDER BY updated_at DESC LIMIT 20) x;
    SELECT jsonb_build_object('byStatus', coalesce(jsonb_object_agg(status, n), '{}'::jsonb),
             'completedToday', (SELECT count(*) FROM public.auto_campaigns
                                 WHERE staff_id = v_staff AND is_delete IS NOT TRUE AND status = 'hoàn thành' AND completed_at >= v_day_start))
      INTO v_campaign_counts
      FROM (SELECT status, count(*) AS n FROM public.auto_campaigns WHERE staff_id = v_staff AND is_delete IS NOT TRUE GROUP BY status) x;
    WITH picked AS (
      SELECT c.id, c.name, c.status, c.note, c.action_id, c.account_id, c.completed_at, c.last_run_at,
             row_number() OVER (ORDER BY (c.status IN ('tạm dừng', 'chờ xử lý') AND coalesce(c.note, '') <> '') DESC,
                                CASE c.status WHEN 'đang chạy' THEN 1 WHEN 'chờ xử lý' THEN 2 WHEN 'tạm dừng' THEN 3 ELSE 4 END,
                                c.last_run_at DESC NULLS LAST, c.id DESC) AS rn
        FROM public.auto_campaigns c
       WHERE c.staff_id = v_staff AND c.is_delete IS NOT TRUE
         AND (c.status <> 'hoàn thành' OR c.completed_at >= v_day_start)
       ORDER BY (c.status IN ('tạm dừng', 'chờ xử lý') AND coalesce(c.note, '') <> '') DESC,
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
             'Tài khoản ' || CASE a.login_status WHEN 'checkpoint' THEN 'bị checkpoint' ELSE 'đã đăng xuất' END
               || ' trong khi còn ' || count(c.id) || ' chiến dịch đang chạy hoặc chờ xử lý' AS message, 1 AS rank
        FROM public.auto_accounts a JOIN public.auto_campaigns c ON c.account_id = a.id
       WHERE a.staff_id = v_staff AND a.is_delete IS NOT TRUE AND a.login_status IN ('chưa đăng nhập', 'checkpoint')
         AND c.is_delete IS NOT TRUE AND c.status IN ('đang chạy', 'chờ xử lý')
       GROUP BY a.id, a.name, a.login_status
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

-- 10. Cài đặt, hộp thư, thiết bị. Web/iOS gọi qua API (service_role), Desktop qua wrapper có xác thực.
CREATE FUNCTION private.aka_agent_notification_subscription_json(p_staff_id bigint, p_event_type text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH sub AS (SELECT * FROM public.auto_notification_subscriptions WHERE staff_id = p_staff_id AND event_type = p_event_type AND scope = 'own'),
       d AS (SELECT private.aka_agent_notification_default_filters(p_event_type) AS f),
       m AS (SELECT coalesce((SELECT filters FROM sub), '{}'::jsonb) AS f)
  SELECT jsonb_build_object('enabled', coalesce((SELECT is_enabled FROM sub), false),
                            'email', coalesce((SELECT email_enabled FROM sub), false),
                            'push', coalesce((SELECT push_enabled FROM sub), false),
                            'cooldownMinutes', (SELECT cooldown_minutes FROM sub))
         || CASE p_event_type
              WHEN 'campaign.status_changed' THEN jsonb_build_object(
                'toStatuses', coalesce(m.f -> 'toStatuses', d.f -> 'toStatuses'), 'campaignIds', coalesce(m.f -> 'campaignIds', 'null'::jsonb))
              WHEN 'account.status_changed' THEN jsonb_build_object(
                'loginEvents', coalesce(m.f -> 'loginEvents', d.f -> 'loginEvents'), 'runStatuses', coalesce(m.f -> 'runStatuses', d.f -> 'runStatuses'),
                'accountIds', coalesce(m.f -> 'accountIds', 'null'::jsonb))
              WHEN 'report.scheduled' THEN jsonb_build_object(
                'weekDays', coalesce(to_jsonb((SELECT schedule_week_days FROM sub)), '[1,2,3,4,5,6,7]'::jsonb),
                'times', coalesce((SELECT jsonb_agg(to_char(t, 'HH24:MI') ORDER BY t) FROM unnest((SELECT schedule_times FROM sub)) AS t), '["18:00"]'::jsonb),
                'skipWhenIdle', coalesce(m.f -> 'skipWhenIdle', d.f -> 'skipWhenIdle'), 'nextRunAt', (SELECT next_run_at FROM sub))
              WHEN 'data_group.membership_changed' THEN jsonb_build_object(
                'groupIds', coalesce(m.f -> 'groupIds', 'null'::jsonb), 'actions', coalesce(m.f -> 'actions', d.f -> 'actions'),
                'bucketMinutes', coalesce(m.f -> 'bucketMinutes', d.f -> 'bucketMinutes'),
                'includeSharedGroups', coalesce(m.f -> 'includeSharedGroups', d.f -> 'includeSharedGroups'))
              ELSE '{}'::jsonb END
    FROM d, m
$$;

CREATE FUNCTION private.aka_agent_notification_settings_json(p_staff_id bigint, p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s public.auto_email_notification_settings%ROWTYPE; v_found boolean; v_devices jsonb;
BEGIN
  SELECT * INTO s FROM public.auto_email_notification_settings WHERE staff_id = p_staff_id AND is_delete IS NOT TRUE;
  v_found := FOUND;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', dv.id, 'name', dv.device_name, 'model', dv.device_model, 'osVersion', dv.os_version,
           'appVersion', dv.app_version, 'enabled', dv.is_enabled, 'hasToken', dv.push_token IS NOT NULL, 'permissionStatus', dv.permission_status,
           'lastRegisteredAt', dv.last_registered_at, 'lastSuccessAt', dv.last_success_at,
           'isCurrentDevice', p_session_id IS NOT NULL AND dv.control_session_id = p_session_id) ORDER BY dv.last_registered_at DESC), '[]'::jsonb)
    INTO v_devices
    FROM public.auto_notification_devices dv
    LEFT JOIN public.auto_control_sessions cs ON cs.id = dv.control_session_id
   WHERE dv.staff_id = p_staff_id AND dv.is_active AND (cs.id IS NULL OR (cs.revoked_at IS NULL AND cs.expires_at > now()));
  RETURN jsonb_build_object(
    'revision', CASE WHEN v_found THEN s.revision ELSE 0 END,
    'timezone', CASE WHEN v_found THEN s.timezone ELSE 'Asia/Ho_Chi_Minh' END,
    'updatedAt', CASE WHEN v_found THEN s.updated_at END,
    'updatedByClient', CASE WHEN v_found THEN s.updated_by_client END,
    'centerEnabled', private.aka_agent_notification_enabled(),
    'deliveryMode', private.aka_agent_notification_setting('notifications.delivery_mode', 'dry_run'),
    'channels', jsonb_build_object(
      'email', jsonb_build_object('enabled', CASE WHEN v_found THEN s.is_enabled ELSE false END,
                                  'recipients', to_jsonb(CASE WHEN v_found THEN s.recipient_emails ELSE '{}'::text[] END),
                                  'unverified', to_jsonb(CASE WHEN v_found THEN ARRAY(SELECT e FROM unnest(s.recipient_emails) AS e
                                                                                       WHERE NOT (e = ANY (s.verified_emails))) ELSE '{}'::text[] END)),
      'push', jsonb_build_object('enabled', CASE WHEN v_found THEN s.push_enabled ELSE false END, 'devices', v_devices)),
    'subscriptions', jsonb_build_object(
      'campaignStatus', private.aka_agent_notification_subscription_json(p_staff_id, 'campaign.status_changed'),
      'accountStatus', private.aka_agent_notification_subscription_json(p_staff_id, 'account.status_changed'),
      'scheduledReport', private.aka_agent_notification_subscription_json(p_staff_id, 'report.scheduled'),
      'dataGroupMembership', private.aka_agent_notification_subscription_json(p_staff_id, 'data_group.membership_changed')));
END
$$;

CREATE FUNCTION private.aka_agent_notification_unread_count(p_staff_id bigint)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT count(*)::integer FROM (SELECT 1 FROM public.auto_notifications
                                  WHERE staff_id = p_staff_id AND read_at IS NULL AND content_status = 'ready'
                                    AND event_type <> 'system.verify_email' LIMIT 100) x
$$;

-- Kiểm tra mảng id thuộc phạm vi nhân viên; null = mọi đối tượng.
CREATE FUNCTION private.aka_agent_notification_valid_ids(p_staff_id bigint, p_kind text, p_ids jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_ids bigint[]; v_owned integer;
BEGIN
  IF p_ids IS NULL OR jsonb_typeof(p_ids) = 'null' THEN RETURN 'null'::jsonb; END IF;
  IF jsonb_typeof(p_ids) <> 'array' OR jsonb_array_length(p_ids) > 200
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_ids) e WHERE jsonb_typeof(e) <> 'number' OR (e #>> '{}') !~ '^[1-9][0-9]{0,17}$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_ids';
  END IF;
  SELECT array_agg(DISTINCT (e #>> '{}')::bigint) INTO v_ids FROM jsonb_array_elements(p_ids) e;
  IF v_ids IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_ids'; END IF;
  v_owned := CASE p_kind
    WHEN 'campaign' THEN (SELECT count(*) FROM public.auto_campaigns WHERE id = ANY (v_ids) AND staff_id = p_staff_id AND is_delete IS NOT TRUE)
    WHEN 'account' THEN (SELECT count(*) FROM public.auto_accounts WHERE id = ANY (v_ids) AND staff_id = p_staff_id AND is_delete IS NOT TRUE)
    WHEN 'group' THEN (SELECT count(*) FROM public.auto_account_contact_groups g WHERE g.id = ANY (v_ids) AND g.is_delete IS NOT TRUE
                         AND (g.staff_id = p_staff_id OR EXISTS (SELECT 1 FROM public.auto_data_group_recipients r WHERE r.group_id = g.id AND r.staff_id = p_staff_id)))
    END;
  IF v_owned IS DISTINCT FROM cardinality(v_ids) THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_ids_not_owned'; END IF;
  RETURN (SELECT jsonb_agg(x ORDER BY x) FROM unnest(v_ids) x);
END
$$;

CREATE FUNCTION private.aka_agent_notification_string_set(p_value jsonb, p_allowed text[], p_default jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF p_value IS NULL THEN RETURN p_default; END IF;
  IF jsonb_typeof(p_value) <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_value) e
                                                  WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') = ANY (p_allowed))) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(v ORDER BY array_position(p_allowed, v)) FROM (SELECT DISTINCT e #>> '{}' AS v FROM jsonb_array_elements(p_value) e) x), '[]'::jsonb);
END
$$;

CREATE FUNCTION private.aka_agent_notification_flag(p_value jsonb, p_default boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF p_value IS NULL THEN RETURN p_default; END IF;
  IF jsonb_typeof(p_value) <> 'boolean' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_flag'; END IF;
  RETURN (p_value #>> '{}')::boolean;
END
$$;

CREATE FUNCTION private.aka_agent_notification_cooldown(p_value jsonb)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}') !~ '^[0-9]{1,4}$' OR (p_value #>> '{}')::integer > 1440 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_cooldown';
  END IF;
  RETURN (p_value #>> '{}')::integer;
END
$$;

CREATE FUNCTION private.aka_agent_notification_save_subscription(p_staff_id bigint, p_organization_id bigint, p_event_type text,
  p_enabled boolean, p_email boolean, p_push boolean, p_filters jsonb, p_cooldown integer, p_week_days smallint[], p_times time without time zone[],
  p_timezone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.auto_notification_subscriptions AS s (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled,
                                                          filters, cooldown_minutes, schedule_week_days, schedule_times, next_run_at)
  VALUES (p_staff_id, p_organization_id, p_event_type, p_enabled, p_email, p_push, p_filters, p_cooldown, p_week_days, p_times,
          CASE WHEN p_event_type = 'report.scheduled' AND p_enabled
               THEN private.aka_agent_notification_next_run(p_week_days, p_times, p_timezone, clock_timestamp()) END)
  ON CONFLICT (staff_id, event_type, scope) DO UPDATE
     SET organization_id = EXCLUDED.organization_id, is_enabled = EXCLUDED.is_enabled, email_enabled = EXCLUDED.email_enabled,
         push_enabled = EXCLUDED.push_enabled, filters = EXCLUDED.filters, cooldown_minutes = EXCLUDED.cooldown_minutes,
         schedule_week_days = EXCLUDED.schedule_week_days, schedule_times = EXCLUDED.schedule_times,
         next_run_at = CASE WHEN EXCLUDED.schedule_week_days IS NOT DISTINCT FROM s.schedule_week_days
                              AND EXCLUDED.schedule_times IS NOT DISTINCT FROM s.schedule_times AND s.is_enabled AND s.next_run_at IS NOT NULL
                            THEN CASE WHEN EXCLUDED.is_enabled THEN s.next_run_at END
                            ELSE EXCLUDED.next_run_at END,
         updated_at = now();
END
$$;

CREATE FUNCTION private.aka_agent_notification_center(p_staff_id bigint, p_organization_id bigint, p_client text, p_action text,
  p_payload jsonb, p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
  v_n public.auto_notifications%ROWTYPE; v_tz text;
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
      UPDATE public.auto_notifications SET read_at = v_now, updated_at = v_now
       WHERE staff_id = p_staff_id AND read_at IS NULL AND content_status = 'ready' AND id <= (v_p ->> 'upToId')::bigint;
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
           is_active = true, deactivated_reason = NULL, failure_count = 0, last_registered_at = EXCLUDED.last_registered_at,
           updated_at = EXCLUDED.updated_at
    RETURNING dv.id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'deviceId', v_id);

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
$$;

CREATE FUNCTION public.aka_agent_control_notification_center(p_staff_id bigint, p_organization_id bigint, p_client text, p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_session_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_client NOT IN ('web', 'ios') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_client'; END IF;
  RETURN private.aka_agent_notification_center(p_staff_id, p_organization_id, p_client, p_action, coalesce(p_payload, '{}'::jsonb), p_session_id);
END
$$;

CREATE FUNCTION public.aka_agent_notification_center(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text,
  p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, NULL); -- Bind Desktop token before privileged work.
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF p_action IN ('register_device', 'verify_email', 'unsubscribe') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_action_not_allowed';
  END IF;
  RETURN private.aka_agent_notification_center(p_staff_id, p_organization_id, 'desktop', p_action, coalesce(p_payload, '{}'::jsonb), NULL);
END
$$;

-- 11. Gắn bước điều phối vào tick 30 giây sẵn có (giữ nguyên hai khối cũ, thêm khối thứ ba).
CREATE OR REPLACE FUNCTION public.aka_agent_data_group_background_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  BEGIN PERFORM public.aka_agent_run_data_group_dynamic_filter_worker(5,100);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Data Group dynamic filter worker failed (%)',SQLSTATE; END;
  BEGIN PERFORM public.aka_agent_sheet_dispatch();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Data Group Sheet dispatch failed (%)',SQLSTATE; END;
  BEGIN PERFORM public.aka_agent_notification_dispatch();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Notification dispatch failed (%)',SQLSTATE; END;
END;
$function$;

-- 12. Chuyển cài đặt hiện có: giữ đúng hành vi email cũ (chỉ báo Hoàn thành, báo cáo 1 mốc/ngày);
-- email đang nhận được coi là đã xác minh. Đặt cờ để hai trigger cầu nối bỏ qua lượt này.
SELECT set_config('aka.notification_center_write', 'on', true);
UPDATE public.auto_email_notification_settings SET verified_emails = recipient_emails WHERE is_delete IS NOT TRUE;
INSERT INTO public.auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled, filters)
SELECT s.staff_id, coalesce(s.organization_id, st.organization_id), 'campaign.status_changed',
       s.is_enabled AND s.notify_campaign_completed, s.is_enabled AND s.notify_campaign_completed, false,
       jsonb_build_object('toStatuses', jsonb_build_array('hoàn thành'), 'campaignIds', NULL)
  FROM public.auto_email_notification_settings s JOIN public.org_staff st ON st.id = s.staff_id
 WHERE s.is_delete IS NOT TRUE AND coalesce(s.organization_id, st.organization_id) IS NOT NULL;
INSERT INTO public.auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled, filters,
                                                   schedule_week_days, schedule_times, next_run_at)
SELECT s.staff_id, coalesce(s.organization_id, st.organization_id), 'report.scheduled',
       s.is_enabled AND s.daily_report_enabled, s.is_enabled AND s.daily_report_enabled, false,
       private.aka_agent_notification_default_filters('report.scheduled'), ARRAY[1,2,3,4,5,6,7]::smallint[], ARRAY[coalesce(s.daily_report_time, '18:00'::time)],
       CASE WHEN s.is_enabled AND s.daily_report_enabled
            THEN private.aka_agent_notification_next_run(ARRAY[1,2,3,4,5,6,7]::smallint[], ARRAY[coalesce(s.daily_report_time, '18:00'::time)], s.timezone, clock_timestamp()) END
  FROM public.auto_email_notification_settings s JOIN public.org_staff st ON st.id = s.staff_id
 WHERE s.is_delete IS NOT TRUE AND coalesce(s.organization_id, st.organization_id) IS NOT NULL;
SELECT set_config('aka.notification_center_write', '', true);

-- 13. Quyền: thu hồi mặc định rồi cấp đúng chỗ. Hàm trigger và hàm phụ chỉ owner gọi.
DO $v457_function_acl$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'aka_agent_notification%')
               OR (n.nspname = 'public' AND p.proname IN ('aka_agent_notification_dispatch', 'aka_agent_notification_worker',
                     'aka_agent_notification_snapshot', 'aka_agent_control_notification_center', 'aka_agent_notification_center'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api', f);
  END LOOP;
END
$v457_function_acl$;
GRANT EXECUTE ON FUNCTION public.aka_agent_notification_worker(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_notification_snapshot(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_notification_center(bigint, bigint, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_notification_center(bigint, bigint, text, text, text, jsonb) TO aka_agent_desktop;

-- 14. Hậu kiểm.
DO $v457_postcheck$
DECLARE v_settings integer; v_subs integer;
BEGIN
  IF md5(pg_get_functiondef('public.aka_agent_data_group_background_tick()'::regprocedure)) IS DISTINCT FROM '10a2465bf8273b269ed5123344cff4db' THEN
    RAISE EXCEPTION 'v457: tick target checksum mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_aka_agent_notify_campaign_status','trg_aka_agent_notify_account_status',
        'trg_aka_agent_notify_session_revoked','trg_aka_agent_notification_settings_before','trg_aka_agent_notification_settings_after')) <> 5 THEN
    RAISE EXCEPTION 'v457: triggers missing';
  END IF;
  IF (SELECT count(*) FROM public.auto_system_settings WHERE key LIKE 'notifications.%') <> 8
     OR private.aka_agent_notification_enabled() THEN
    RAISE EXCEPTION 'v457: system settings mismatch';
  END IF;
  SELECT count(*) INTO v_settings FROM public.auto_email_notification_settings s JOIN public.org_staff st ON st.id = s.staff_id
   WHERE s.is_delete IS NOT TRUE AND coalesce(s.organization_id, st.organization_id) IS NOT NULL;
  SELECT count(*) INTO v_subs FROM public.auto_notification_subscriptions;
  IF v_subs <> 2 * v_settings THEN RAISE EXCEPTION 'v457: backfill mismatch % vs %', v_subs, v_settings; END IF;
  IF has_function_privilege('anon', 'public.aka_agent_notification_worker(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_control_notification_center(bigint,bigint,text,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.aka_agent_notification_dispatch()', 'EXECUTE')
     OR has_table_privilege('service_role', 'public.auto_notifications', 'SELECT')
     OR has_table_privilege('aka_agent_desktop', 'public.auto_notification_devices', 'SELECT')
     OR NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_notification_center(bigint,bigint,text,text,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aka_agent_notification_worker(text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'v457: privilege postcheck failed';
  END IF;
END
$v457_postcheck$;

COMMIT;

-- Metadata-only reconstruction of the live objects V457 depends on (read on akachat 04/11/2026).
-- Disposable cluster only: no production credentials, customer rows, cron or pg_net.
\set ON_ERROR_STOP 1
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE authenticator NOINHERIT;
CREATE ROLE service_role BYPASSRLS; CREATE ROLE aka_agent_desktop NOINHERIT; CREATE ROLE aka_agent_chat_api BYPASSRLS;
CREATE SCHEMA private; CREATE SCHEMA auth; CREATE SCHEMA net;
GRANT USAGE ON SCHEMA public, private TO service_role, aka_agent_desktop, aka_agent_chat_api, anon, authenticated;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC; GRANT EXECUTE ON FUNCTION auth.jwt() TO PUBLIC;

CREATE TABLE public.org_organization (id bigint PRIMARY KEY, name text);
CREATE TABLE public.org_staff (
  id bigint PRIMARY KEY, organization_id bigint REFERENCES public.org_organization(id), name text, username text, password text,
  is_active boolean DEFAULT true, deleted_at timestamptz, expiration_date timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.org_organization_product (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id bigint, product_name text,
  expiration_date timestamptz, is_deleted boolean DEFAULT false);
CREATE TABLE private.aka_agent_desktop_users (auth_user_id uuid PRIMARY KEY, staff_id bigint NOT NULL);
CREATE TABLE public.auto_system_settings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key text NOT NULL, value text, description text, is_secret boolean DEFAULT false,
  is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  CONSTRAINT auto_system_settings_key_unique UNIQUE (key));
CREATE TABLE public.auto_proxies (id bigint PRIMARY KEY, name text);
CREATE TABLE public.auto_campaign_actions (id text PRIMARY KEY, name text);
CREATE TABLE public.auto_accounts (
  id bigint PRIMARY KEY, name text, flatform_type text, login_status text, status text DEFAULT 'chờ xử lý', is_active boolean DEFAULT true,
  is_delete boolean DEFAULT false, staff_id bigint, organization_id bigint, proxy_id bigint, mobile_device_id text, mobile_device_info jsonb,
  mobile_device_last_seen_at timestamptz, is_zalo_server boolean DEFAULT false, is_zalo_show_web boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.auto_campaigns (
  id bigint PRIMARY KEY, name text NOT NULL, action_id text, account_id bigint, status text NOT NULL DEFAULT 'chờ xử lý', is_delete boolean DEFAULT false,
  staff_id bigint, organization_id bigint, note text, completed_at timestamptz, last_run_at timestamptz, schedule_end_date timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.auto_campaign_input_data (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, campaign_id bigint, status text, is_delete boolean DEFAULT false);
CREATE INDEX idx_campaign_input_data_progress_live ON public.auto_campaign_input_data (campaign_id, status) WHERE is_delete = false;
CREATE TABLE public.auto_campaign_details (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, campaign_id bigint, action_name text, action_code text, status text, report_group text,
  is_delete boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE INDEX idx_campaign_details_page ON public.auto_campaign_details (campaign_id, created_at, id) WHERE is_delete = false;
CREATE TABLE public.auto_control_sessions (
  id uuid PRIMARY KEY, staff_id bigint, organization_id bigint, client_type text, created_at timestamptz DEFAULT now(),
  expires_at timestamptz, revoked_at timestamptz);
CREATE TABLE public.chat_zalo_account_organization (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, auto_account_id bigint, session_last_error text,
  socket_last_close_reason text, socket_last_close_code integer, last_socket_disconnected_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.auto_account_logs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at timestamptz DEFAULT now(), account_id bigint,
  source text, event_type text, message text);
CREATE TABLE public.auto_staff_device_presence (instance_id uuid PRIMARY KEY, staff_id bigint, device_label text, app_version text,
  last_seen_at timestamptz, ended_at timestamptz);
CREATE TABLE public.auto_account_contact_groups (id bigint PRIMARY KEY, name text, staff_id bigint, is_delete boolean DEFAULT false);
CREATE TABLE public.auto_data_group_recipients (group_id bigint, staff_id bigint);

-- Bảng email từ v69 + quyền và policy V435/V456 như live.
CREATE TABLE public.auto_email_notification_settings (
  id bigint GENERATED ALWAYS AS IDENTITY, staff_id bigint NOT NULL REFERENCES public.org_staff(id), organization_id bigint REFERENCES public.org_organization(id),
  is_enabled boolean NOT NULL DEFAULT false, recipient_emails text[] NOT NULL DEFAULT '{}', notify_campaign_completed boolean NOT NULL DEFAULT true,
  daily_report_enabled boolean NOT NULL DEFAULT false, daily_report_time time without time zone NOT NULL DEFAULT '18:00', is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_email_notification_settings_pkey PRIMARY KEY (id), CONSTRAINT auto_email_notification_settings_staff_unique UNIQUE (staff_id));
CREATE TABLE public.auto_email_notification_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id bigint NOT NULL, type text NOT NULL, dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending', payload jsonb NOT NULL DEFAULT '{}');
GRANT SELECT ON public.auto_email_notification_settings TO aka_agent_desktop, aka_agent_chat_api;
GRANT ALL ON public.auto_email_notification_settings, public.auto_email_notification_deliveries TO service_role;
GRANT INSERT (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed, daily_report_enabled, daily_report_time, is_delete, updated_at),
      UPDATE (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed, daily_report_enabled, daily_report_time, is_delete, updated_at)
  ON public.auto_email_notification_settings TO aka_agent_desktop;
ALTER TABLE public.auto_email_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_email_notification_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY v435_existing_role_access ON public.auto_email_notification_settings FOR ALL TO aka_agent_desktop USING (true) WITH CHECK (true);
CREATE POLICY v435_existing_role_access ON public.auto_email_notification_deliveries FOR ALL TO aka_agent_desktop USING (true) WITH CHECK (true);

-- Desktop dùng được bảng nghiệp vụ của chính mình (rút gọn từ V435/V436).
GRANT SELECT, UPDATE ON public.auto_campaigns, public.auto_accounts TO aka_agent_desktop, aka_agent_chat_api, service_role;
GRANT SELECT, UPDATE ON public.auto_control_sessions TO service_role;
GRANT SELECT ON public.auto_system_settings TO aka_agent_desktop, service_role;

-- Hàm live (định nghĩa chính xác) và stub phụ thuộc.
CREATE FUNCTION private.aka_agent_staff_scope_for_request()
 RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_claims jsonb; v_user uuid; v_staff bigint;
BEGIN
 -- SET ROLE is retained across SECURITY DEFINER calls; current_user is not.
 IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN NULL; END IF;
 BEGIN
  v_claims := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  IF v_claims->>'role' IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN 0; END IF;
  v_user := NULLIF(v_claims->>'sub','')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN 0;
 END;
 SELECT staff_id INTO v_staff FROM private.aka_agent_desktop_users WHERE auth_user_id=v_user;
 RETURN COALESCE(v_staff,0);
END;
$function$;
CREATE FUNCTION private.aka_agent_assert_request_ownership(p_staff_id bigint DEFAULT NULL::bigint, p_account_id bigint DEFAULT NULL::bigint, p_campaign_id bigint DEFAULT NULL::bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request();
BEGIN
 IF v_staff IS NULL THEN RETURN true; END IF;
 IF v_staff <= 0 OR (p_staff_id IS NOT NULL AND p_staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_staff_scope_denied';
 END IF;
 -- Preserve each caller's existing not-found/cleanup semantics.
 IF p_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=p_account_id AND staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_account_scope_denied'; END IF;
 IF p_campaign_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=p_campaign_id AND staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_campaign_scope_denied'; END IF;
 RETURN true;
END;
$function$;
CREATE FUNCTION public.auto_assert_automation_identity(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_claim_role text;
  v_claims jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, NULL); -- Bind Desktop token before privileged work.

  v_claim_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_claim_role IS NULL THEN
    BEGIN
      v_claims := NULLIF(
        current_setting('request.jwt.claims', true),
        ''
      )::jsonb;
      v_claim_role := NULLIF(v_claims ->> 'role', '');
    EXCEPTION
      WHEN OTHERS THEN
        v_claim_role := NULL;
    END;
  END IF;

  IF v_claim_role IS NULL THEN
    v_claim_role := NULLIF(auth.jwt() ->> 'role', '');
  END IF;

  IF v_claim_role = 'service_role' THEN
    RETURN;
  END IF;

  IF p_auth_username IS NULL OR p_auth_password IS NULL THEN
    RAISE EXCEPTION 'automation_auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
      AND staff.username = p_auth_username
      AND staff.password = p_auth_password
  ) THEN
    RAISE EXCEPTION 'automation_auth_invalid';
  END IF;
END;
$function$;
CREATE FUNCTION public.aka_agent_app_access_staff_allowed(p_staff bigint, p_app text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$ SELECT coalesce((SELECT is_active FROM public.org_staff WHERE id = p_staff), false) $$;
CREATE TABLE private.fixture_vault (name text PRIMARY KEY, secret text);
CREATE FUNCTION public.aka_agent_get_vault_secret(p_name text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, private
  AS $$ SELECT secret FROM private.fixture_vault WHERE name = p_name LIMIT 1 $$;
CREATE TABLE private.fixture_http_calls (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_ms integer);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO private.fixture_http_calls (url, body, headers, timeout_ms) VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;
CREATE TABLE private.fixture_tick_calls (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, what text);
CREATE FUNCTION public.aka_agent_run_data_group_dynamic_filter_worker(integer, integer) RETURNS void LANGUAGE sql
  AS $$ INSERT INTO private.fixture_tick_calls (what) VALUES ('filters') $$;
CREATE FUNCTION public.aka_agent_sheet_dispatch() RETURNS void LANGUAGE sql AS $$ INSERT INTO private.fixture_tick_calls (what) VALUES ('sheet') $$;
-- Exact live body; checksum 873b2939cc09a51e0e9d71f685dfd0e0.
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
END;
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_data_group_background_tick() FROM PUBLIC;

-- V456 policies (đã live).
CREATE POLICY v456_desktop_owner ON public.auto_email_notification_settings AS RESTRICTIVE FOR ALL TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request())) WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));
CREATE POLICY v456_desktop_owner ON public.auto_email_notification_deliveries AS RESTRICTIVE FOR ALL TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request())) WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));
CREATE POLICY desktop_owned_resource ON public.auto_campaigns AS RESTRICTIVE FOR ALL TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));
CREATE POLICY v435_existing_role_access ON public.auto_campaigns FOR ALL TO aka_agent_desktop USING (true) WITH CHECK (true);
ALTER TABLE public.auto_campaigns ENABLE ROW LEVEL SECURITY;
GRANT EXECUTE ON FUNCTION private.aka_agent_staff_scope_for_request() TO aka_agent_desktop, service_role, aka_agent_chat_api;

-- Dữ liệu mẫu: tổ chức 1, staff 1 (email bật, đã xác minh), staff 2 (chưa có cài đặt), staff 3 (đã nghỉ).
INSERT INTO public.org_organization VALUES (1, 'Org 1'), (2, 'Org 2');
INSERT INTO public.org_staff (id, organization_id, name, username, password, is_active, expiration_date) VALUES
  (1, 1, 'Hà', 'ha', 'pw1', true, now() + interval '3 days'), (2, 1, 'Nam', 'nam', 'pw2', true, NULL), (3, 2, 'Cũ', 'cu', 'pw3', false, NULL);
INSERT INTO public.org_organization_product (organization_id, product_name, expiration_date) VALUES (1, 'akaAgent Zalo', now() + interval '5 days');
INSERT INTO private.aka_agent_desktop_users VALUES ('11111111-1111-4111-8111-111111111111', 1), ('22222222-2222-4222-8222-222222222222', 2);
INSERT INTO public.auto_campaign_actions VALUES ('zalo_message_phone', 'Zalo - Nhắn tin theo SĐT');
INSERT INTO public.auto_proxies VALUES (7, 'Proxy HN');
INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, staff_id, organization_id, proxy_id) VALUES
  (100, 'Zalo Shop Hà', 'zalo', 'đã đăng nhập', 'chờ xử lý', 1, 1, 7), (101, 'SMS Hà', 'sms', 'đã đăng nhập', 'chờ xử lý', 1, 1, NULL),
  (200, 'Zalo Nam', 'zalo', 'đã đăng nhập', 'chờ xử lý', 2, 1, NULL);
INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, staff_id, organization_id) VALUES
  (10, 'Chăm sóc khách tháng 11', 'zalo_message_phone', 100, 'chờ xử lý', 1, 1), (11, 'Nhắc lịch hẹn', 'zalo_message_phone', 100, 'chờ xử lý', 1, 1),
  (20, 'Chiến dịch Nam', 'zalo_message_phone', 200, 'chờ xử lý', 2, 1);
INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, staff_id, organization_id)
SELECT 30 + g, 'Loạt ' || g, 'zalo_message_phone', 100, 'đang chạy', 1, 1 FROM generate_series(1, 6) g;
INSERT INTO public.auto_campaign_input_data (campaign_id, status) SELECT 10, s FROM unnest(ARRAY['hoàn thành','hoàn thành','chờ xử lý']) s;
INSERT INTO public.auto_campaign_details (campaign_id, action_name, status, report_group, created_at) VALUES
  (10, 'Nhắn tin', 'thành công', 'success', now()), (10, 'Nhắn tin', 'thất bại', 'failure', now()), (10, 'Nhắn tin', 'đã là bạn bè', NULL, now() - interval '3 days');
INSERT INTO public.auto_email_notification_settings (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed, daily_report_enabled, daily_report_time)
VALUES (1, 1, true, '{ha@example.test}', true, true, '08:00');
INSERT INTO public.auto_control_sessions (id, staff_id, organization_id, client_type, expires_at) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 1, 1, 'native', now() + interval '30 days'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 1, 1, 'web', now() + interval '30 days'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 2, 1, 'native', now() + interval '30 days');
INSERT INTO public.auto_account_contact_groups VALUES (500, 'Khách VIP', 1, false), (501, 'Nhóm Nam', 2, false);
INSERT INTO public.auto_data_group_recipients VALUES (501, 1);

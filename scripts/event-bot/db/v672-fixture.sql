-- Lược đồ tối thiểu để chạy V660 trên Postgres cục bộ (không phải bản chụp production).
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api LOGIN;
CREATE SCHEMA private; CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
CREATE TABLE public.auto_system_settings (id bigserial PRIMARY KEY, key text UNIQUE, value text, description text,
  is_secret boolean DEFAULT false, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint, name text, is_active boolean DEFAULT true,
  is_admin_akabiz boolean NOT NULL DEFAULT false, deleted_at timestamptz);
CREATE TABLE public.auto_accounts (id bigint PRIMARY KEY, name text NOT NULL DEFAULT '', staff_id bigint, organization_id bigint,
  flatform_type text NOT NULL DEFAULT 'zalo', login_status text NOT NULL DEFAULT 'đã đăng nhập', status text NOT NULL DEFAULT 'chờ xử lý',
  is_zalo_server boolean NOT NULL DEFAULT false, is_zalo_show_web boolean NOT NULL DEFAULT false, is_delete boolean DEFAULT false,
  zalo_account_id bigint);
CREATE TABLE public.auto_campaigns (id bigint PRIMARY KEY, name text, action_id text, account_id bigint, staff_id bigint,
  organization_id bigint, status text, note text, completed_at timestamptz, schedule_end_date timestamptz,
  extra_settings jsonb DEFAULT '{}'::jsonb, is_delete boolean DEFAULT false, updated_at timestamptz DEFAULT now());
CREATE TABLE public.auto_campaign_input_data (id bigserial PRIMARY KEY, campaign_id bigint, input_id bigint, name text, uid text,
  status text, note text, is_delete boolean DEFAULT false, control_append_idempotency_key text, control_append_row_index integer);
CREATE UNIQUE INDEX uq_ctl ON public.auto_campaign_input_data (campaign_id, control_append_idempotency_key, control_append_row_index)
  WHERE control_append_idempotency_key IS NOT NULL;
CREATE TABLE public.auto_campaign_logs (id bigserial PRIMARY KEY, campaign_id bigint, log text, created_at timestamptz DEFAULT now());
CREATE TABLE public.zalo_users (account_id bigint, zalo_uid text, display_name text, zalo_name text, PRIMARY KEY (account_id, zalo_uid));
-- Giả lập phiên Desktop: nhân viên lấy từ GUC test.staff khi role là aka_agent_desktop.
CREATE FUNCTION private.aka_agent_desktop_data_context() RETURNS TABLE(staff_id bigint, organization_id bigint, system_admin boolean)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.organization_id, false FROM public.org_staff s
  WHERE s.id = NULLIF(current_setting('test.staff', true), '')::bigint $$;
-- Bảng danh mục kết quả (chỉ các cột V660 ghi).
CREATE TABLE public.auto_status (id bigint PRIMARY KEY, code text, name text);
INSERT INTO public.auto_status VALUES (51, 'campaign_detail_skipped', 'Bỏ qua');
CREATE TABLE public.auto_error (id bigserial PRIMARY KEY, error_type text, error_code text UNIQUE, error_name text, error_desc text,
  noti_running_process text, noti_campaign text, disable_action_codes text[], counts_toward_limit boolean, counts_toward_bad_target boolean,
  disable_action_mode text, zalo_error_codes text[], zalo_action_codes text[], is_active boolean, is_delete boolean, public_code text,
  error_class text, customer_title text, customer_help text, detail_status text);
CREATE TABLE public.auto_outcome_policies (id bigserial PRIMARY KEY, error_code text, error_class text, status_id bigint, action_code text,
  campaign_action_id text, runtime_target text, detail_mode text, detail_status_id bigint, sub_status_id bigint, log_template text,
  campaign_note_template text, quota_effect text, target_streak_effect text, streak_threshold integer, target_effect text,
  requeue_after_minutes integer, remaining_steps text, lock_action_codes text[], lock_mode text, lock_minutes integer, lock_days integer,
  lock_time text, run_effect text, pace_mode text, pace_seconds integer, campaign_effect text, campaign_hold_minutes integer,
  account_effect text, login_effect text, description text, source text, is_active boolean DEFAULT true, is_delete boolean DEFAULT false);
CREATE TABLE public.auto_outcome_signal_rules (id bigserial PRIMARY KEY, platform text, action_code text, phase text, signal_kind text,
  pattern text, priority integer, error_code text, source text, note text, is_active boolean DEFAULT true);

-- ===== Thêm cho V672 (cột như production đọc chỉ đọc 26/11/2026) =====
CREATE TABLE public.zalo_accounts (id bigint PRIMARY KEY, zalo_uid text NOT NULL, display_name text, avatar_url text);
CREATE TABLE public.category_item (id bigint PRIMARY KEY, code text);
INSERT INTO public.category_item VALUES (34, 'phone'), (40, 'zalo_person');
CREATE TABLE public.auto_account_contacts (id bigserial PRIMARY KEY, account_id integer, contact_type text NOT NULL, name text NOT NULL DEFAULT '',
  uid text, phone text, is_delete boolean DEFAULT false, staff_id bigint, organization_id bigint, flatform_type text DEFAULT 'zalo',
  extra_data jsonb, updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX uq_auto_account_contacts_account_type_uid ON public.auto_account_contacts (account_id, contact_type, uid);
CREATE TABLE public.auto_account_contact_groups (id bigserial PRIMARY KEY, account_id bigint, contact_type text, name text NOT NULL,
  is_delete boolean NOT NULL DEFAULT false, staff_id bigint, organization_id bigint, purpose text NOT NULL DEFAULT 'data_group',
  data_type_category_item_id bigint, bound_zalo_account_id bigint, revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.auto_account_contact_group_members (id bigserial PRIMARY KEY, group_id bigint NOT NULL, contact_id bigint NOT NULL,
  is_delete boolean NOT NULL DEFAULT false, change_revision bigint NOT NULL DEFAULT 0, primary_origin_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (group_id, contact_id));
CREATE TABLE public.auto_account_contact_group_member_origins (id bigserial PRIMARY KEY, membership_id bigint NOT NULL, kind text NOT NULL,
  dataset_id bigint, source_account_id bigint, source_name_snapshot text, is_current boolean NOT NULL, dynamic_filter_id bigint,
  data_type_category_item_id bigint, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX uq_data_group_member_origin_dynamic_filter ON public.auto_account_contact_group_member_origins (membership_id, dynamic_filter_id)
  WHERE dynamic_filter_id IS NOT NULL;
CREATE TABLE public.auto_account_contact_group_dynamic_filters (id bigserial PRIMARY KEY, group_id bigint NOT NULL, staff_id bigint NOT NULL,
  organization_id bigint NOT NULL, is_enabled boolean NOT NULL DEFAULT true, revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.chat_zalo_account_organization (id bigserial PRIMARY KEY, chat_zalo_account_id bigint NOT NULL DEFAULT 1,
  organization_id bigint NOT NULL, auto_account_id bigint NOT NULL, is_active boolean NOT NULL DEFAULT true);
-- Bảng của bộ chạy chiến dịch: bot không được đụng (bài kiểm độc lập).
CREATE TABLE public.auto_account_action_status (id bigserial PRIMARY KEY, account_id bigint, action_code text, count_action_in_day integer DEFAULT 0);
CREATE TABLE public.auto_campaign_details (id bigserial PRIMARY KEY, account_id bigint, campaign_id bigint, status text);
CREATE TABLE public.auto_staff_device_presence (instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id bigint, organization_id bigint,
  app_version text, started_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now(), ended_at timestamptz, runtime_state jsonb);
CREATE TABLE public.auto_engine_leases (account_id bigint, lane text DEFAULT 'main', PRIMARY KEY (account_id, lane));
-- Hàm production thay bằng bản giả đọc bảng test.
CREATE TABLE public.test_org_flags (organization_id bigint PRIMARY KEY, chat_runtime boolean NOT NULL DEFAULT false, fly_route boolean NOT NULL DEFAULT false);
CREATE FUNCTION public.aka_agent_app_access_chat_runtime(p_org bigint, p_server boolean) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT chat_runtime FROM public.test_org_flags WHERE organization_id = p_org), false) $$;
CREATE FUNCTION public.aka_agent_zalo_server_flag_route(p_org bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT fly_route FROM public.test_org_flags WHERE organization_id = p_org), false) $$;
-- pg_cron giả: chỉ để migration đăng ký job.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$
  WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT EXISTS (SELECT 1 FROM d) $$;
-- USAGE schema private như production (anon / authenticated có USAGE).
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

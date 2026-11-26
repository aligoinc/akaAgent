-- Lược đồ tối thiểu để chạy V660 trên Postgres cục bộ (không phải bản chụp production).
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api LOGIN;
CREATE SCHEMA private; CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
CREATE TABLE public.auto_system_settings (id bigserial PRIMARY KEY, key text UNIQUE, value text, description text,
  is_secret boolean DEFAULT false, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint);
CREATE TABLE public.auto_accounts (id bigint PRIMARY KEY, name text, staff_id bigint, organization_id bigint, flatform_type text,
  is_zalo_server boolean DEFAULT false, is_zalo_show_web boolean DEFAULT false, is_delete boolean DEFAULT false);
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

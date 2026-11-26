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

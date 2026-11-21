-- Bổ sung nền kiểm thử V621 (chỉ cụm Postgres tạm): cột / bảng / hàm production mà setup.sql của notification-center không dựng.
-- Kiểu cột theo production đọc 21/11/2026.
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);

ALTER TABLE public.auto_campaigns ADD COLUMN IF NOT EXISTS schedule timestamptz, ADD COLUMN IF NOT EXISTS schedule_type text,
  ADD COLUMN IF NOT EXISTS schedule_week_days text, ADD COLUMN IF NOT EXISTS schedule_days text;
ALTER TABLE public.org_staff ADD COLUMN IF NOT EXISTS email text, ADD COLUMN IF NOT EXISTS is_admin_akabiz boolean DEFAULT false;
ALTER TABLE public.org_organization ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.auto_campaign_details ADD COLUMN IF NOT EXISTS error_code text, ADD COLUMN IF NOT EXISTS account_id bigint;
ALTER TABLE public.auto_campaign_actions ADD COLUMN IF NOT EXISTS limit_check_action_codes text[];
CREATE TABLE IF NOT EXISTS public.auto_error (id bigserial PRIMARY KEY, error_code text, public_code text, customer_title text);

CREATE TABLE IF NOT EXISTS public.auto_account_actions (id bigint PRIMARY KEY, code text NOT NULL, name text, is_delete boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS public.auto_account_action_status (
  id bigserial PRIMARY KEY, account_id bigint, action_code text, count_action_in_day integer DEFAULT 0, count_date date);

-- Bản giả của hàm hạn mức engine (production: công thức bộ chạy). Đọc daily từ bảng thử để kiểm phần "dự kiến hôm nay".
CREATE TABLE IF NOT EXISTS public.v621_test_limits (campaign_id bigint, action_code text, daily integer);
CREATE OR REPLACE FUNCTION public.aka_agent_engine_action_limit(p_campaign_id bigint, p_account_id bigint, p_action_code text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('daily', coalesce((SELECT daily FROM public.v621_test_limits WHERE campaign_id = p_campaign_id AND action_code = p_action_code), 30))
$$;

CREATE INDEX IF NOT EXISTS v621_details_rate ON public.auto_campaign_details (account_id, action_code, created_at);

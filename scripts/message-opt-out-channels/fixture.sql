-- Nền tối thiểu để chạy V649 trên Postgres cục bộ. Bảng chỉ có các cột hàm cần; hàm phụ thuộc chép theo
-- production 24/11/2026 (normalize_phone làm gọn: bỏ ký tự lạ, +84/84 → 0).
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN CREATE ROLE aka_agent_desktop; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN CREATE ROLE aka_agent_chat_api; END IF;
END
$roles$;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO service_role, aka_agent_desktop, aka_agent_chat_api;
GRANT USAGE ON SCHEMA public TO service_role, aka_agent_desktop;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);

CREATE FUNCTION public.normalize_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') ~ '^84[0-9]{9}$' THEN '0' || substr(regexp_replace(p, '[^0-9]', '', 'g'), 3)
    ELSE regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') END
$$;
CREATE FUNCTION public.aka_agent_internal_normalize_phone(p_value text)
 RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT SET search_path TO 'pg_catalog'
AS $function$
  select case
    when public.normalize_phone(p_value) ~ '^0[35789][0-9]{8}$' then public.normalize_phone(p_value)
    else ''
  end;
$function$;

CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint, is_active boolean DEFAULT true, deleted_at timestamptz);
CREATE TABLE public.auto_accounts (id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, flatform_type text, is_delete boolean DEFAULT false);
CREATE TABLE public.auto_campaigns (
  id bigint PRIMARY KEY, name text, staff_id bigint, organization_id bigint, account_id bigint, action_id text,
  status text DEFAULT 'chờ xử lý', schedule timestamptz, extra_settings jsonb DEFAULT '{}', is_delete boolean DEFAULT false,
  note text, updated_at timestamptz DEFAULT now());
CREATE TABLE public.auto_campaign_input_data (
  id bigint PRIMARY KEY, campaign_id bigint, status text DEFAULT 'chờ xử lý', is_delete boolean DEFAULT false,
  phone text, phone_carrier text, content text, name text, info1 text, info2 text, info3 text, info4 text, info5 text,
  schedule timestamptz, created_at timestamptz DEFAULT now(), note text, date_action timestamptz);
CREATE TABLE public.auto_system_settings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key text NOT NULL, value text, description text,
  is_secret boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.auto_error (
  id bigserial PRIMARY KEY, error_code text, public_code text, error_name text, error_desc text, error_type text,
  error_class text, customer_title text, customer_help text, counts_toward_limit boolean, counts_toward_bad_target boolean,
  is_active boolean DEFAULT true, is_delete boolean DEFAULT false, zalo_error_codes text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX auto_error_public_code_uidx ON public.auto_error (public_code) WHERE public_code IS NOT NULL;
CREATE TABLE public.auto_outcome_policies (
  id bigserial PRIMARY KEY, error_code text, action_code text, error_class text, source text, description text,
  revision integer NOT NULL DEFAULT 1, updated_by text NOT NULL DEFAULT current_user, is_active boolean DEFAULT true,
  is_delete boolean DEFAULT false, detail_mode text, detail_status_id bigint, target_effect text, quota_effect text,
  run_effect text, target_streak_effect text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
INSERT INTO public.auto_error (error_code, public_code, error_name, error_desc, error_type, error_class, customer_title, customer_help,
  counts_toward_limit, counts_toward_bad_target)
VALUES ('err_engine_recipient_opted_out', 'OPT01', 'Người nhận từ chối nhận tin', 'Engine v2: ... Zalo', 'engine v2', 'target_permanent',
  'Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo', 'Người nhận tự bấm từ chối; không gửi lại cho người này.', false, false);
INSERT INTO public.auto_outcome_policies (error_code, source, description, revision, updated_by, detail_mode, detail_status_id,
  target_effect, quota_effect, run_effect, target_streak_effect)
VALUES ('err_engine_recipient_opted_out', 'seed_v495_engine', 'Từ chối nhận tin', 1, 'postgres', 'suppress', 51, 'hold', 'no_count', 'continue', 'ignore');

CREATE TABLE public.auto_zalo_message_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text, email text, zalo_global_id text NOT NULL,
  staff_id bigint NOT NULL, organization_id bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz, source_campaign_id bigint, source_campaign_name text, source_detail_id bigint,
  source_sent_at timestamptz, source_action_name text, source_status text, zalo_name text, zalo_avatar text);
CREATE UNIQUE INDEX auto_zalo_message_opt_outs_scope_global_id_uidx ON public.auto_zalo_message_opt_outs (staff_id, organization_id, zalo_global_id);
CREATE INDEX auto_zalo_message_opt_outs_scope_phone_idx ON public.auto_zalo_message_opt_outs (staff_id, organization_id, phone);
CREATE INDEX auto_zalo_message_opt_outs_confirmed_page_idx ON public.auto_zalo_message_opt_outs (staff_id, organization_id, confirmed_at DESC, id DESC) WHERE confirmed_at IS NOT NULL;

-- Phiên Desktop giả: test.staff = nhân viên của phiên; trống = gọi từ máy chủ.
CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.staff', true), '')::bigint
$$;
CREATE FUNCTION private.aka_agent_assert_request_ownership(p_staff_id bigint, p_account_id bigint, p_campaign_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public AS $$
DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request();
BEGIN
  IF v_staff IS NULL THEN RETURN true; END IF;
  IF v_staff <= 0 OR (p_staff_id IS NOT NULL AND p_staff_id IS DISTINCT FROM v_staff) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_staff_scope_denied'; END IF;
  IF p_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=p_account_id AND staff_id IS DISTINCT FROM v_staff) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_account_scope_denied'; END IF;
  IF p_campaign_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=p_campaign_id AND staff_id IS DISTINCT FROM v_staff) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_campaign_scope_denied'; END IF;
  RETURN true;
END $$;
CREATE FUNCTION public.aka_agent_app_access_account_allowed(bigint, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.auto_assert_automation_identity(bigint, bigint, text, text) RETURNS void LANGUAGE sql AS $$ SELECT $$;

-- Hàm Zalo cũ (thân production, đọc 24/11/2026) để kiểm bảng mới không làm hỏng đường Zalo.
CREATE FUNCTION public.aka_agent_prepare_zalo_message_opt_out(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_phone text, p_zalo_global_id text)
RETURNS TABLE(id uuid, is_opted_out boolean) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog, public AS $function$
DECLARE v_organization_id bigint; v_phone text := NULLIF(public.aka_agent_internal_normalize_phone(p_phone), '');
  v_zalo_global_id text := NULLIF(pg_catalog.btrim(p_zalo_global_id), '');
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id);
  IF v_zalo_global_id IS NULL THEN RAISE EXCEPTION 'zalo_global_id_required'; END IF;
  SELECT campaign.organization_id INTO v_organization_id FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id AND campaign.staff_id = p_staff_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'zalo_message_opt_out_scope_not_found'; END IF;
  RETURN QUERY INSERT INTO public.auto_zalo_message_opt_outs AS opt_out (phone, zalo_global_id, staff_id, organization_id)
  VALUES (v_phone, v_zalo_global_id, p_staff_id, v_organization_id)
  ON CONFLICT (staff_id, organization_id, zalo_global_id) DO UPDATE SET phone = COALESCE(EXCLUDED.phone, opt_out.phone)
  RETURNING opt_out.id, opt_out.confirmed_at IS NOT NULL;
END $function$;
CREATE FUNCTION public.aka_agent_confirm_zalo_message_opt_out(p_id uuid) RETURNS TABLE(state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog, public AS $function$
BEGIN
  UPDATE public.auto_zalo_message_opt_outs AS opt_out SET confirmed_at = COALESCE(opt_out.confirmed_at, pg_catalog.clock_timestamp()) WHERE opt_out.id = p_id;
  IF FOUND THEN RETURN QUERY SELECT 'confirmed'::text; ELSE RETURN QUERY SELECT 'invalid'::text; END IF;
END $function$;

-- Như production: service_role đọc / ghi mọi bảng public.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

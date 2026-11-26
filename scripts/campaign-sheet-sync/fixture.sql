-- Nền tối thiểu cho bài kiểm V662 trên Postgres cục bộ. Cột / thân hàm phụ thuộc chép từ production (đọc chỉ đọc 26/11/2026).
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN BYPASSRLS;
CREATE SCHEMA private; CREATE SCHEMA supabase_migrations; CREATE SCHEMA net;
GRANT USAGE ON SCHEMA private TO anon, authenticated, aka_agent_desktop, aka_agent_chat_api, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);

CREATE TABLE public.auto_system_settings (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key text UNIQUE NOT NULL,
  value text, description text, is_secret boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint NOT NULL, is_active boolean NOT NULL DEFAULT true,
  is_admin_akabiz boolean NOT NULL DEFAULT false, deleted_at timestamptz);
CREATE TABLE public.auto_campaigns (id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, action_id text, name text,
  status text DEFAULT 'chờ xử lý', note text, is_delete boolean DEFAULT false, data_group_id bigint,
  schedule_end_date timestamptz, completed_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.auto_campaign_input_data (id bigserial PRIMARY KEY, campaign_id bigint, input_id bigint, name text, phone text,
  uid text, email text, status text DEFAULT 'chờ xử lý', note text, schedule timestamptz, date_action timestamptz,
  is_delete boolean DEFAULT false, created_at timestamptz DEFAULT now(), info1 text, info2 text, info3 text, info4 text, info5 text,
  content text, phone_carrier text, canonical_target_key text, data_type_category_item_id bigint,
  content_rotation_indexes jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX ON public.auto_campaign_input_data (campaign_id);
CREATE TABLE public.auto_campaign_logs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES public.auto_campaigns(id), log text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.auto_campaign_data_group_sources (id bigserial PRIMARY KEY, campaign_id bigint, group_id bigint, status text);
CREATE TABLE public.auto_journey_step_campaigns (id bigserial PRIMARY KEY, campaign_id bigint);

CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO net.calls (url, headers, body) VALUES (url, headers, body) RETURNING id $$;
CREATE FUNCTION public.aka_agent_get_vault_secret(p_name text) RETURNS text LANGUAGE sql AS $$ SELECT 'test-secret' $$;

CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.staff', true), '')::bigint $$;
CREATE OR REPLACE FUNCTION private.aka_agent_desktop_data_context()
 RETURNS TABLE(staff_id bigint, organization_id bigint, system_admin boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT s.id, s.organization_id,
   COALESCE(s.is_admin_akabiz AND s.is_active AND s.deleted_at IS NULL,false)
 FROM public.org_staff s
 WHERE current_setting('role',true)='aka_agent_desktop'
   AND s.id=(SELECT private.aka_agent_staff_scope_for_request());
$function$;

CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  d text;
begin
  if p is null then
    return null;
  end if;
  d := regexp_replace(p, '[^0-9]', '', 'g');
  if d = '' then
    return '';
  end if;
  if d like '0084%' and length(d) >= 13 then
    d := '0' || substr(d, 5);
  elsif d like '84%' and length(d) >= 11 then
    d := '0' || substr(d, 3);
  end if;
  if length(d) = 9 and left(d, 1) in ('3','5','7','8','9') then
    d := '0' || d;
  end if;
  if length(d) = 11 and left(d, 1) = '0' then
    d := case left(d, 4)
      when '0162' then '032' when '0163' then '033' when '0164' then '034' when '0165' then '035'
      when '0166' then '036' when '0167' then '037' when '0168' then '038' when '0169' then '039'
      when '0120' then '070' when '0121' then '079' when '0122' then '077' when '0126' then '076'
      when '0128' then '078' when '0123' then '083' when '0124' then '084' when '0125' then '085'
      when '0127' then '081' when '0129' then '082' when '0186' then '056' when '0188' then '058'
      when '0199' then '059'
      else left(d, 4)
    end || substr(d, 5);
  end if;
  return d;
end;
$function$;
CREATE OR REPLACE FUNCTION public.aka_agent_internal_normalize_phone(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when public.normalize_phone(p_value) ~ '^0[35789][0-9]{8}$' then public.normalize_phone(p_value)
    else ''
  end;
$function$;

CREATE FUNCTION public.aka_agent_run_data_group_dynamic_filter_worker(integer, integer) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.aka_agent_sheet_dispatch() RETURNS bigint LANGUAGE sql AS $$ SELECT NULL::bigint $$;
CREATE FUNCTION public.aka_agent_notification_dispatch() RETURNS void LANGUAGE sql AS $$ SELECT $$;
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

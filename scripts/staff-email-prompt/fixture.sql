-- Bảng tối thiểu giống production (chỉ các cột V652 dùng) để kiểm V652 trên PostgreSQL cục bộ.
\set ON_ERROR_STOP 1
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','aka_agent_desktop','aka_agent_chat_api'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP; END $$;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO anon, authenticated, aka_agent_desktop, aka_agent_chat_api, service_role;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[]);
CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('test.staff', true), '')::bigint, 0) $$;
GRANT EXECUTE ON FUNCTION private.aka_agent_staff_scope_for_request() TO PUBLIC;
CREATE TABLE public.aka_customer(id bigint PRIMARY KEY, email text, updated_at timestamptz DEFAULT now(),
  merged_into_customer_id bigint, pipeline_stage text);
CREATE FUNCTION public.update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER trigger_customer_updated_at BEFORE UPDATE ON public.aka_customer FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TABLE public.org_organization(id bigint PRIMARY KEY, customer_id bigint NOT NULL, name text NOT NULL, phone text NOT NULL DEFAULT '', email text, staff_admin_id bigint);
CREATE TABLE public.org_staff(id bigint PRIMARY KEY, organization_id bigint NOT NULL, name text NOT NULL, phone text NOT NULL DEFAULT '',
  email text, username text NOT NULL, is_active boolean NOT NULL DEFAULT true, is_admin boolean, is_admin_akabiz boolean, deleted_at timestamptz);
CREATE TABLE public.org_organization_product(id bigserial PRIMARY KEY, organization_id bigint, product_name text, package_name text,
  expiration_date timestamptz, is_deleted boolean, is_paid boolean);
CREATE TABLE public.auto_system_settings(id bigserial PRIMARY KEY, key text UNIQUE, value text, description text, is_secret boolean, is_active boolean);
-- Dữ liệu có sẵn trước V652 để kiểm p3 điền danh sách.
INSERT INTO public.aka_customer(id, email) VALUES (199, 'Old.Crm@x.vn'), (198, 'lead@x.vn');
INSERT INTO public.org_organization(id, customer_id, name, email) VALUES (99, 199, 'Org cũ', 'Old.Org@x.vn');
INSERT INTO public.org_staff(id, organization_id, name, username, email, is_admin) VALUES (99, 99, 'Cũ', 'old', ' Old.Staff@x.vn', true);

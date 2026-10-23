CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
-- Match the linked production public-schema defaults, including direct role grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
CREATE SCHEMA private;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
CREATE TABLE org_organization(id bigint PRIMARY KEY,use_staff_expiration boolean NOT NULL DEFAULT false);
CREATE TABLE org_staff(id bigint PRIMARY KEY,organization_id bigint,name text,username text,password text,
  is_active boolean DEFAULT true,is_admin boolean DEFAULT false,deleted_at timestamptz,expiration_date timestamptz);
CREATE TABLE auto_campaign_actions(id text PRIMARY KEY,name text,flatform_type text,is_active boolean DEFAULT true,is_delete boolean DEFAULT false);
CREATE TABLE auto_accounts(id bigint PRIMARY KEY,staff_id bigint,organization_id bigint,name text,flatform_type text,
  is_zalo_show_web boolean DEFAULT false,is_zalo_server boolean DEFAULT false,is_delete boolean DEFAULT false);
CREATE TABLE auto_campaigns(id bigint PRIMARY KEY,staff_id bigint,organization_id bigint,account_id bigint,secondary_account_id bigint,
  action_id text,name text,status text DEFAULT 'chờ xử lý',is_delete boolean DEFAULT false,schedule timestamptz,
  original_schedule timestamptz,last_run_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
  data_target_source_mode text DEFAULT 'direct',schedule_type text DEFAULT 'daily',note text);
CREATE INDEX campaigns_scope ON auto_campaigns(staff_id,organization_id,action_id) WHERE is_delete=false;
CREATE FUNCTION public.aka_agent_desktop_campaign_config_version(c public.auto_campaigns) RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT md5(c.id::text) $$;
GRANT USAGE ON SCHEMA public,private,auth TO anon,authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;

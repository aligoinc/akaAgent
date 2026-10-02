-- Isolated PostgreSQL fixture only. No production data or connections.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_chat_api;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE TABLE org_staff(id bigint PRIMARY KEY, organization_id bigint, is_active boolean DEFAULT true,
 deleted_at timestamptz, username text, password text);
CREATE TABLE auto_accounts(id bigint PRIMARY KEY,staff_id bigint,organization_id bigint,flatform_type text DEFAULT 'facebook',
 status text DEFAULT 'chờ xử lý',login_status text DEFAULT 'đã đăng nhập',is_active boolean DEFAULT true,is_delete boolean DEFAULT false,
 is_zalo_server boolean DEFAULT false,is_zalo_show_web boolean DEFAULT false,runtime_operation_claim_token uuid,updated_at timestamptz);
CREATE TABLE auto_campaigns(id bigint PRIMARY KEY,account_id bigint,staff_id bigint,organization_id bigint,
 status text DEFAULT 'chờ xử lý',schedule timestamptz DEFAULT now(),schedule_type text DEFAULT 'daily',continue_next_day boolean DEFAULT false,
 daily_stop_time time,schedule_end_date timestamptz,data_target_source_mode text,action_id text,is_delete boolean DEFAULT false,
 provisioning_state text DEFAULT 'ready',note text,updated_at timestamptz,
 runtime_claim_token uuid,runtime_claim_target text,runtime_claim_vietnam_date date,runtime_claimed_at timestamptz,
 runtime_unit_token uuid,runtime_unit_vietnam_date date,runtime_unit_claimed_at timestamptz,runtime_unit_input_data_ids bigint[]);
CREATE TABLE auto_campaign_input_data(id bigint PRIMARY KEY,campaign_id bigint,is_delete boolean DEFAULT false,status text,schedule timestamptz);
CREATE INDEX auto_accounts_staff_id_idx ON auto_accounts(staff_id);
CREATE INDEX auto_campaigns_staff_id_idx ON auto_campaigns(staff_id);
CREATE FUNCTION public.aka_agent_staff_time_allowed(bigint) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.resolve_organization_zalo_account_capabilities(bigint)
RETURNS TABLE(qr_enabled boolean,web_enabled boolean,server_enabled boolean,capability_revision text)
LANGUAGE sql AS $$SELECT true,true,true,'fixture'::text$$;
CREATE FUNCTION public.aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)
RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role,aka_agent_chat_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role,aka_agent_chat_api;

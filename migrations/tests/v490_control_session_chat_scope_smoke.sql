-- Local smoke for V490 on an empty Postgres (stubs only; never run against production).
--   createdb v490 && psql -v ON_ERROR_STOP=1 -d v490 -f migrations/tests/v490_control_session_chat_scope_smoke.sql
-- Stubs the tables/helpers the function reads, applies migration_v490 + rollback, and checks each
-- scope decision, revocation and the ACL.
\set ON_ERROR_STOP on
DO $roles$ BEGIN
  IF to_regrole('anon') IS NULL THEN CREATE ROLE anon; END IF;
  IF to_regrole('authenticated') IS NULL THEN CREATE ROLE authenticated; END IF;
  IF to_regrole('service_role') IS NULL THEN CREATE ROLE service_role; END IF;
END $roles$;
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE public.org_organization (id bigint PRIMARY KEY, name text);
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint, name text, username text,
  phone text, email text, is_active boolean DEFAULT true);
CREATE TABLE public.auto_control_sessions (id uuid PRIMARY KEY DEFAULT md5(random()::text)::uuid,
  staff_id bigint, organization_id bigint, token_hash text, client_type text, user_agent text,
  created_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '1 day', revoked_at timestamptz);
CREATE TABLE public.org_organization_product (id bigint PRIMARY KEY, organization_id bigint, product_id bigint,
  product_package_id bigint, product_name text, package_name text, max_accounts int, max_staff int,
  max_sends_per_day int, expiration_date timestamptz, created_at timestamptz DEFAULT now(), is_deleted boolean DEFAULT false);
-- Controls for stubbed helpers.
CREATE TABLE public.t_access (staff_id bigint PRIMARY KEY, agent boolean, chat boolean);
CREATE TABLE public.t_org (organization_id bigint PRIMARY KEY, chat_runtime boolean, qr boolean, server boolean,
  desktop_only boolean DEFAULT false);

CREATE FUNCTION public.aka_agent_staff_time_allowed(p bigint) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
-- Chat helpers count their calls: full sessions must never evaluate Chat permission.
CREATE TABLE public.t_calls (name text PRIMARY KEY, n int NOT NULL DEFAULT 0);
INSERT INTO public.t_calls VALUES ('chat_allowed', 0), ('chat_runtime', 0);
CREATE FUNCTION public.aka_agent_app_access_staff_allowed(p bigint, app text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF app = 'akaChat' THEN UPDATE public.t_calls SET n = n + 1 WHERE name = 'chat_allowed'; END IF;
  RETURN COALESCE((SELECT CASE app WHEN 'akaAgent' THEN agent ELSE chat END FROM public.t_access WHERE staff_id = p), false);
END $$;
CREATE FUNCTION public.aka_agent_app_access_chat_runtime(p bigint, s boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.t_calls SET n = n + 1 WHERE name = 'chat_runtime';
  RETURN COALESCE((SELECT chat_runtime FROM public.t_org WHERE organization_id = p), false);
END $$;
CREATE FUNCTION public.resolve_organization_zalo_account_capabilities(p bigint)
  RETURNS TABLE(entitlement_id bigint, qr_enabled boolean, web_enabled boolean, server_enabled boolean,
    max_accounts int, max_sends_per_day int, capability_revision text) LANGUAGE sql AS
  $$ SELECT NULL::bigint, COALESCE(qr,false), false, COALESCE(server,false), NULL::int, NULL::int, 'r1'
     FROM public.t_org WHERE organization_id = p $$;
CREATE FUNCTION private.aka_agent_web_desktop_accounts_policy(p bigint) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT jsonb_build_object('desktopOnlyLogin', COALESCE((SELECT desktop_only FROM public.t_org WHERE organization_id = p), false)) $$;
CREATE FUNCTION private.aka_agent_web_facebook_campaigns_policy(p bigint) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT '{}'::jsonb $$;
-- The real V490 preflight requires the old function to exist.
CREATE FUNCTION public.aka_agent_authenticate_control_session(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;

-- The stub old function has another body; skip only the production body md5 guard.
SET aka_agent.v490_skip_body_check = 'on';
\ir ../migration_v490_control_session_chat_scope.sql

-- org 1: Zalo Server + Chat; org 2: Chat only (no campaign package); org 3: Server, no Chat runtime.
INSERT INTO public.org_organization VALUES (1,'A'),(2,'B'),(3,'C');
INSERT INTO public.t_org VALUES (1,true,true,true),(2,true,false,false),(3,false,true,true);
INSERT INTO public.org_staff(id, organization_id, name, username) VALUES
  (11,1,'full','full'),(12,1,'chat-only staff','c1'),(13,1,'nothing','n1'),
  (21,2,'chat org','c2'),(22,2,'no chat flag','n2'),(23,2,'chat org, agent off','c3'),
  (31,3,'agent off, no runtime','n3');
INSERT INTO public.t_access VALUES (11,true,true),(12,false,true),(13,false,false),
  (21,true,true),(22,true,false),(23,false,true),(31,false,true);

CREATE FUNCTION pg_temp.session(p_staff bigint, p_client text) RETURNS text LANGUAGE sql AS $$
  INSERT INTO public.auto_control_sessions(staff_id, organization_id, token_hash, client_type)
  SELECT p_staff, organization_id, p_staff || ':' || p_client || ':' || md5(random()::text), p_client
  FROM public.org_staff WHERE id = p_staff
  RETURNING token_hash $$;
CREATE FUNCTION pg_temp.check(p_staff bigint, p_client text, p_status text, p_scope text, p_revoked boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_token text := pg_temp.session(p_staff, p_client); v_result jsonb; v_revoked boolean;
BEGIN
  v_result := public.aka_agent_authenticate_control_session_chat_v2(v_token);
  SELECT revoked_at IS NOT NULL INTO v_revoked FROM public.auto_control_sessions WHERE token_hash = v_token;
  IF v_result->>'status' IS DISTINCT FROM p_status OR (v_result->>'app_scope') IS DISTINCT FROM p_scope
    OR v_revoked IS DISTINCT FROM p_revoked THEN
    RAISE EXCEPTION 'staff % % expected %/%/revoked=% got %/%/revoked=%', p_staff, p_client,
      p_status, p_scope, p_revoked, v_result->>'status', v_result->>'app_scope', v_revoked;
  END IF;
  RAISE NOTICE 'ok staff % % -> % %', p_staff, p_client, p_status, COALESCE(p_scope, '-');
END $$;

SELECT pg_temp.check(11,'native','authenticated','full',false);
SELECT pg_temp.check(11,'web','authenticated','full',false);
-- Staff without akaAgent but with akaChat: chat scope on iOS only, revoked on Web as before.
SELECT pg_temp.check(12,'native','authenticated','chat',false);
SELECT pg_temp.check(12,'web','invalid_staff',NULL,true);
SELECT pg_temp.check(12,'pwa','invalid_staff',NULL,true);
SELECT pg_temp.check(13,'native','invalid_staff',NULL,true);
-- Organization with only Chat: chat scope on iOS; no Chat flag keeps capability_unavailable.
SELECT pg_temp.check(21,'native','authenticated','chat',false);
SELECT pg_temp.check(21,'web','capability_unavailable',NULL,true);
SELECT pg_temp.check(22,'native','capability_unavailable',NULL,true);
-- Neither akaAgent nor a campaign package, but Chat: chat scope.
SELECT pg_temp.check(23,'native','authenticated','chat',false);
-- No Chat runtime in the organization: no chat scope.
SELECT pg_temp.check(31,'native','invalid_staff',NULL,true);

DO $lazy$ DECLARE v_calls int; BEGIN
  UPDATE public.t_calls SET n = 0;
  -- Full sessions (every request of the new iOS build) never evaluate Chat permission.
  PERFORM public.aka_agent_authenticate_control_session_chat_v2(pg_temp.session(11,'native'));
  PERFORM public.aka_agent_authenticate_control_session_chat_v2(pg_temp.session(11,'web'));
  SELECT sum(n) INTO v_calls FROM public.t_calls;
  IF v_calls <> 0 THEN RAISE EXCEPTION 'full session evaluated chat (% calls)', v_calls; END IF;
  -- Web/PWA never evaluate it either, even on the revoke paths.
  PERFORM public.aka_agent_authenticate_control_session_chat_v2(pg_temp.session(12,'web'));
  PERFORM public.aka_agent_authenticate_control_session_chat_v2(pg_temp.session(21,'pwa'));
  SELECT sum(n) INTO v_calls FROM public.t_calls;
  IF v_calls <> 0 THEN RAISE EXCEPTION 'web session evaluated chat (% calls)', v_calls; END IF;
  -- Already in chat scope (no akaAgent): the package gate is skipped, Chat evaluated once.
  PERFORM public.aka_agent_authenticate_control_session_chat_v2(pg_temp.session(23,'native'));
  IF (SELECT n FROM public.t_calls WHERE name = 'chat_runtime') <> 1 THEN RAISE EXCEPTION 'chat evaluated twice'; END IF;
  RAISE NOTICE 'ok lazy chat check';
END $lazy$;
-- Desktop-only exception still yields the full scope.
UPDATE public.t_org SET qr = true, desktop_only = true WHERE organization_id = 2;
SELECT pg_temp.check(21,'native','authenticated','full',false);
SELECT pg_temp.check(22,'native','authenticated','full',false);

DO $acl$ BEGIN
  IF has_function_privilege('anon','public.aka_agent_authenticate_control_session_chat_v2(text)','EXECUTE')
    OR has_function_privilege('authenticated','public.aka_agent_authenticate_control_session_chat_v2(text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.aka_agent_authenticate_control_session_chat_v2(text)','EXECUTE') THEN
    RAISE EXCEPTION 'acl';
  END IF;
  RAISE NOTICE 'ok acl';
END $acl$;

\ir ../rollback_v490_control_session_chat_scope.sql
DO $rb$ BEGIN
  IF to_regprocedure('public.aka_agent_authenticate_control_session_chat_v2(text)') IS NOT NULL THEN RAISE EXCEPTION 'rollback'; END IF;
  RAISE NOTICE 'ok rollback';
END $rb$;

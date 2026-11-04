-- Metadata-only reconstruction of the live state V456 expects (read on akachat 04/11/2026).
-- Disposable cluster only: no production credentials, customer rows, cron or pg_net.
\set ON_ERROR_STOP 1
CREATE ROLE aka_agent_desktop NOINHERIT;
CREATE ROLE service_role BYPASSRLS;
CREATE ROLE aka_agent_chat_api BYPASSRLS;
CREATE ROLE aka_message_ingest_owner; CREATE ROLE authenticator NOINHERIT; CREATE ROLE cli_login_postgres;
CREATE ROLE dashboard_user; CREATE ROLE pgbouncer; CREATE ROLE supabase_auth_admin;
CREATE ROLE supabase_functions_admin; CREATE ROLE supabase_privileged_role; CREATE ROLE supabase_realtime_admin;
CREATE ROLE supabase_replication_admin; CREATE ROLE supabase_storage_admin;

CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, private TO aka_agent_desktop, service_role, aka_agent_chat_api;

CREATE TABLE private.aka_agent_desktop_users (auth_user_id uuid PRIMARY KEY, staff_id bigint NOT NULL);
CREATE TABLE public.org_organization (id bigint PRIMARY KEY);
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint REFERENCES public.org_organization(id));

-- Exact live body; checksum d417807fa9dc08cfecbd6cd0aab7df3e.
CREATE FUNCTION private.aka_agent_staff_scope_for_request()
 RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_claims jsonb; v_user uuid; v_staff bigint;
BEGIN
 -- SET ROLE is retained across SECURITY DEFINER calls; current_user is not.
 IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN NULL; END IF;
 BEGIN
  v_claims := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  IF v_claims->>'role' IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN 0; END IF;
  v_user := NULLIF(v_claims->>'sub','')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN 0;
 END;
 SELECT staff_id INTO v_staff FROM private.aka_agent_desktop_users WHERE auth_user_id=v_user;
 RETURN COALESCE(v_staff,0);
END;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_staff_scope_for_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.aka_agent_staff_scope_for_request() TO aka_agent_desktop, service_role, aka_agent_chat_api;

CREATE TABLE public.auto_campaigns (
  id bigint PRIMARY KEY, staff_id bigint REFERENCES public.org_staff(id),
  status text NOT NULL DEFAULT 'chờ xử lý', completed_at timestamptz
);
GRANT SELECT, UPDATE ON public.auto_campaigns TO aka_agent_desktop;
ALTER TABLE public.auto_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY v435_existing_role_access ON public.auto_campaigns FOR ALL TO aka_agent_desktop USING (true) WITH CHECK (true);
CREATE POLICY desktop_owned_resource ON public.auto_campaigns AS RESTRICTIVE FOR ALL TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));

CREATE TABLE public.auto_email_notification_settings (
  id bigint GENERATED ALWAYS AS IDENTITY,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id),
  organization_id bigint REFERENCES public.org_organization(id),
  is_enabled boolean NOT NULL DEFAULT false,
  recipient_emails text[] NOT NULL DEFAULT '{}',
  notify_campaign_completed boolean NOT NULL DEFAULT true,
  daily_report_enabled boolean NOT NULL DEFAULT false,
  daily_report_time time without time zone NOT NULL DEFAULT '18:00',
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_email_notification_settings_pkey PRIMARY KEY (id),
  CONSTRAINT auto_email_notification_settings_staff_unique UNIQUE (staff_id)
);
CREATE TABLE public.auto_email_notification_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id),
  type text NOT NULL,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  retry_count integer NOT NULL DEFAULT 0,
  max_retry_count integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_email_notification_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT auto_email_notification_deliveries_type_check CHECK (type IN ('campaign_completed', 'daily_report')),
  CONSTRAINT auto_email_notification_deliveries_dedupe_unique UNIQUE (dedupe_key)
);

-- Live ACL (V435 cutover).
GRANT ALL ON public.auto_email_notification_settings TO service_role;
GRANT SELECT ON public.auto_email_notification_settings TO aka_agent_chat_api;
GRANT SELECT ON public.auto_email_notification_settings TO aka_agent_desktop;
GRANT INSERT (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed,
  daily_report_enabled, daily_report_time, is_delete, updated_at),
  UPDATE (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed,
  daily_report_enabled, daily_report_time, is_delete, updated_at)
  ON public.auto_email_notification_settings TO aka_agent_desktop;
GRANT ALL ON public.auto_email_notification_deliveries TO service_role;
GRANT SELECT, INSERT ON public.auto_email_notification_deliveries TO aka_agent_chat_api;
GRANT INSERT (staff_id, type, dedupe_key, payload) ON public.auto_email_notification_deliveries TO aka_agent_desktop;

ALTER TABLE public.auto_email_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_email_notification_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY v435_existing_role_access ON public.auto_email_notification_settings FOR ALL TO "aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin" USING (true) WITH CHECK (true);
CREATE POLICY v435_existing_role_access ON public.auto_email_notification_deliveries FOR ALL TO "aka_agent_desktop","aka_message_ingest_owner","authenticator","cli_login_postgres","dashboard_user","pg_checkpoint","pg_create_subscription","pg_database_owner","pg_execute_server_program","pg_maintain","pg_monitor","pg_read_all_data","pg_read_all_settings","pg_read_all_stats","pg_read_server_files","pg_signal_backend","pg_stat_scan_tables","pg_use_reserved_connections","pg_write_all_data","pg_write_server_files","pgbouncer","supabase_auth_admin","supabase_functions_admin","supabase_privileged_role","supabase_realtime_admin","supabase_replication_admin","supabase_storage_admin" USING (true) WITH CHECK (true);

-- Worker call is a stub (no pg_net/HTTP in the fixture).
CREATE FUNCTION public.aka_agent_call_email_notification_worker(p_mode text DEFAULT 'process', p_reason text DEFAULT 'manual')
RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::bigint $$;
GRANT EXECUTE ON FUNCTION public.aka_agent_call_email_notification_worker(text, text) TO aka_agent_desktop;

-- Exact live body; checksum 0523c07b0878e3aaa53efb0bc97a74b8.
CREATE OR REPLACE FUNCTION public.aka_agent_enqueue_campaign_completed_email()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF NEW.status = 'hoàn thành'
    AND OLD.status IS DISTINCT FROM NEW.status
    AND NEW.staff_id IS NOT NULL
  THEN
    INSERT INTO public.auto_email_notification_deliveries (
      staff_id,
      type,
      dedupe_key,
      payload
    )
    SELECT
      NEW.staff_id,
      'campaign_completed',
      'completion:' || NEW.id::text || ':' || COALESCE(NEW.completed_at, now())::text,
      jsonb_build_object(
        'campaignId', NEW.id,
        'completedAt', COALESCE(NEW.completed_at, now()),
        'staffId', NEW.staff_id
      )
    FROM public.auto_email_notification_settings s
    WHERE s.staff_id = NEW.staff_id
      AND s.is_delete = false
      AND s.is_enabled = true
      AND s.notify_campaign_completed = true
      AND array_length(s.recipient_emails, 1) > 0
    ON CONFLICT (dedupe_key) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted > 0 THEN
      PERFORM public.aka_agent_call_email_notification_worker('process', 'campaign-completed');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_aka_agent_enqueue_campaign_completed_email AFTER UPDATE OF status ON public.auto_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.aka_agent_enqueue_campaign_completed_email();

-- Fixture rows: staff 1 (token A), staff 2 (token B), org 1.
INSERT INTO public.org_organization VALUES (1);
INSERT INTO public.org_staff VALUES (1, 1), (2, 1);
INSERT INTO private.aka_agent_desktop_users VALUES
  ('11111111-1111-4111-8111-111111111111', 1), ('22222222-2222-4222-8222-222222222222', 2);
INSERT INTO public.auto_campaigns (id, staff_id) VALUES (10, 1), (20, 2);
INSERT INTO public.auto_email_notification_settings (staff_id, organization_id, is_enabled, recipient_emails)
VALUES (2, 1, true, '{b@example.test}');

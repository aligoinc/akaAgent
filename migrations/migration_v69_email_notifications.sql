BEGIN;

DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
EXCEPTION
  WHEN undefined_file THEN
    RAISE NOTICE 'pg_net extension is not available in this database.';
END $$;

ALTER TABLE public.auto_campaigns
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.auto_email_notification_settings (
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

CREATE INDEX IF NOT EXISTS idx_auto_email_notification_settings_enabled
  ON public.auto_email_notification_settings (is_enabled, daily_report_enabled, daily_report_time)
  WHERE is_delete = false;

CREATE TABLE IF NOT EXISTS public.auto_email_notification_deliveries (
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
  CONSTRAINT auto_email_notification_deliveries_status_check CHECK (status IN ('pending', 'sending', 'retrying', 'sent', 'failed')),
  CONSTRAINT auto_email_notification_deliveries_dedupe_unique UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_auto_email_notification_deliveries_due
  ON public.auto_email_notification_deliveries (status, next_attempt_at, id)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_auto_email_notification_deliveries_staff
  ON public.auto_email_notification_deliveries (staff_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.aka_agent_get_vault_secret(p_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = p_name
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_call_email_notification_worker(
  p_mode text DEFAULT 'process',
  p_reason text DEFAULT 'manual'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  v_url text := public.aka_agent_get_vault_secret('AKA_AGENT_EMAIL_NOTIFICATION_WORKER_URL');
  v_token text := public.aka_agent_get_vault_secret('INTERNAL_EDGE_FUNCTION_TOKEN');
  v_request_id bigint;
BEGIN
  IF v_url IS NULL OR btrim(v_url) = '' OR v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE NOTICE 'Email notification worker URL/token is not configured in Supabase Vault.';
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net extension is not installed; email notification worker was not invoked.';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-token', v_token
    ),
    body := jsonb_build_object(
      'mode', COALESCE(NULLIF(p_mode, ''), 'process'),
      'reason', COALESCE(NULLIF(p_reason, ''), 'manual')
    )
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_email_notification_deliveries(p_limit integer DEFAULT 10)
RETURNS SETOF public.auto_email_notification_deliveries
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH next_rows AS (
    SELECT id
    FROM public.auto_email_notification_deliveries
    WHERE status IN ('pending', 'retrying')
      AND next_attempt_at <= now()
      AND retry_count <= max_retry_count
    ORDER BY next_attempt_at ASC, id ASC
    LIMIT GREATEST(COALESCE(p_limit, 10), 1)
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.auto_email_notification_deliveries d
    SET status = 'sending',
        attempt_count = d.attempt_count + 1,
        locked_at = now(),
        updated_at = now()
    FROM next_rows
    WHERE d.id = next_rows.id
    RETURNING d.*
  )
  SELECT * FROM updated;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_campaign_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'hoàn thành' AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.completed_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_enqueue_campaign_completed_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_set_campaign_completed_at ON public.auto_campaigns;
CREATE TRIGGER trg_aka_agent_set_campaign_completed_at
  BEFORE UPDATE OF status ON public.auto_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.aka_agent_set_campaign_completed_at();

DROP TRIGGER IF EXISTS trg_aka_agent_enqueue_campaign_completed_email ON public.auto_campaigns;
CREATE TRIGGER trg_aka_agent_enqueue_campaign_completed_email
  AFTER UPDATE OF status ON public.auto_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.aka_agent_enqueue_campaign_completed_email();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN (
      'aka_agent_email_notification_worker_retry',
      'aka_agent_email_notification_daily_report'
    );

    PERFORM cron.schedule(
      'aka_agent_email_notification_worker_retry',
      '*/5 * * * *',
      $cmd$select public.aka_agent_call_email_notification_worker('process', 'cron-retry');$cmd$
    );

    PERFORM cron.schedule(
      'aka_agent_email_notification_daily_report',
      '*/5 * * * *',
      $cmd$select public.aka_agent_call_email_notification_worker('daily', 'cron-daily-report');$cmd$
    );
  END IF;
END $$;

COMMENT ON TABLE public.auto_email_notification_settings IS
  'Staff-scoped akaAgent email notification preferences. SMTP config lives in Edge Function secrets.';
COMMENT ON TABLE public.auto_email_notification_deliveries IS
  'akaAgent email notification outbox processed by the aka-agent-email-notification-worker Edge Function.';
COMMENT ON COLUMN public.auto_campaigns.completed_at IS
  'Timestamp set when a campaign transitions into trạng thái hoàn thành.';
COMMENT ON FUNCTION public.aka_agent_call_email_notification_worker(text, text) IS
  'Calls aka-agent-email-notification-worker via pg_net. Requires AKA_AGENT_EMAIL_NOTIFICATION_WORKER_URL and INTERNAL_EDGE_FUNCTION_TOKEN in Supabase Vault.';

NOTIFY pgrst, 'reload schema';

COMMIT;

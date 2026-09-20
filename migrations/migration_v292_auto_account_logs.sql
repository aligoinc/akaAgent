-- Observational telemetry only: no triggers, business FKs or state enums.
BEGIN;

CREATE TABLE public.auto_account_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    account_id bigint NOT NULL,
    campaign_id bigint,
    login_status text,
    account_status text,
    source text NOT NULL,
    event_type text NOT NULL,
    message text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_auto_account_logs_account_time
    ON public.auto_account_logs (account_id, created_at DESC);

ALTER TABLE public.auto_account_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_account_logs FROM PUBLIC, anon, authenticated, aka_agent_chat_api;
REVOKE ALL ON SEQUENCE public.auto_account_logs_id_seq FROM PUBLIC, anon, authenticated, aka_agent_chat_api;
GRANT INSERT (created_at, account_id, campaign_id, login_status, account_status,
              source, event_type, message, details)
    ON public.auto_account_logs TO anon, authenticated, aka_agent_chat_api, service_role;
GRANT USAGE ON SEQUENCE public.auto_account_logs_id_seq
    TO anon, authenticated, aka_agent_chat_api, service_role;

-- Existing desktop/App Server use the anon Data API (custom staff auth, not
-- Supabase Auth JWTs). Accept append-only diagnostics for existing accounts;
-- these reports are untrusted telemetry, NEVER authorization/audit evidence.
-- No SELECT/UPDATE/DELETE policy or grant is exposed to application clients.
CREATE POLICY auto_account_logs_insert ON public.auto_account_logs
FOR INSERT TO anon, authenticated, aka_agent_chat_api
WITH CHECK (
    EXISTS (SELECT 1 FROM public.auto_accounts a WHERE a.id = auto_account_logs.account_id)
    AND (
        campaign_id IS NULL OR EXISTS (
            SELECT 1 FROM public.auto_campaigns c
            WHERE c.id = auto_account_logs.campaign_id
              AND (c.account_id = auto_account_logs.account_id
                   OR c.secondary_account_id = auto_account_logs.account_id)
        )
    )
);

COMMENT ON TABLE public.auto_account_logs IS
    'Best-effort runtime diagnostics. Append only from clients; admin-only read. Never used by business logic. No automatic retention.';

-- New API table/permissions require a schema cache refresh.
NOTIFY pgrst, 'reload schema';
COMMIT;

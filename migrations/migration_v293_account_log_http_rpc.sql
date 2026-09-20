-- Source audit on akachat / cgjbsmqtfhqvttudyjzq, 2026-09-20:
-- to_regprocedure('public.aka_agent_record_account_log(jsonb,jsonb)') = NULL;
-- no overload exists. New additive RPC; no existing function body is replaced.
BEGIN;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'aka_agent_record_account_log'
  ) THEN
    RAISE EXCEPTION 'account-log RPC appeared after source audit; inspect live definition before applying';
  END IF;
  IF to_regclass('public.auto_account_logs') IS NULL THEN
    RAISE EXCEPTION 'migration v292 must be applied first';
  END IF;
END
$preflight$;

-- Narrow append-only endpoint. A definer is needed only for the internal
-- runtime-binding lookup; callers receive no rows/IDs or privileged table access.
-- Account/campaign validation preserves the existing v292 INSERT policy.
CREATE FUNCTION public.aka_agent_record_account_log(p_event jsonb, p_context jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '4s'
SET lock_timeout = '1s'
AS $function$
DECLARE
  v_account_id bigint := (p_event ->> 'account_id')::bigint;
  v_campaign_id bigint := (p_event ->> 'campaign_id')::bigint;
  v_created_at timestamptz := (p_event ->> 'created_at')::timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_accounts WHERE id = v_account_id) THEN
    RETURN;
  END IF;

  IF v_campaign_id IS NULL AND p_context IS NOT NULL THEN
    SELECT campaign.id INTO v_campaign_id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
      AND account.organization_id = campaign.organization_id AND account.staff_id = campaign.staff_id
    JOIN public.chat_zalo_account_organization AS binding ON binding.auto_account_id = account.id
      AND binding.organization_id = account.organization_id
    WHERE account.id = v_account_id
      AND account.organization_id = (p_context ->> 'organizationId')::bigint
      AND account.staff_id = (p_context ->> 'staffId')::bigint
      AND p_context ->> 'runtimeTarget' IN ('server', 'desktop')
      AND account.is_zalo_server = (p_context ->> 'runtimeTarget' = 'server')
      AND binding.runtime_generation = (p_context ->> 'runtimeGeneration')::bigint
      AND binding.is_active = true
      AND campaign.runtime_claim_token IS NOT NULL
      AND campaign.runtime_claim_target = p_context ->> 'runtimeTarget'
      AND campaign.runtime_claimed_at <= v_created_at
      AND COALESCE(campaign.is_delete, false) = false
    ORDER BY campaign.runtime_claimed_at DESC, campaign.id DESC
    LIMIT 1;
  END IF;

  IF v_campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auto_campaigns
    WHERE id = v_campaign_id AND (account_id = v_account_id OR secondary_account_id = v_account_id)
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.auto_account_logs
    (created_at, account_id, campaign_id, login_status, account_status, source, event_type, message, details)
  VALUES (v_created_at, v_account_id, v_campaign_id, p_event ->> 'login_status',
    p_event ->> 'account_status', p_event ->> 'source', p_event ->> 'event_type', p_event ->> 'message',
    COALESCE(p_event -> 'details', '{}'::jsonb));
END
$function$;

ALTER FUNCTION public.aka_agent_record_account_log(jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_record_account_log(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_record_account_log(jsonb,jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_record_account_log(jsonb,jsonb) IS
  'Best-effort append-only diagnostics via HTTP; optional fenced runtime context. Returns no business data; never used by business logic.';

-- A new Data API RPC changes metadata and requires a cache refresh.
NOTIFY pgrst, 'reload schema';
COMMIT;

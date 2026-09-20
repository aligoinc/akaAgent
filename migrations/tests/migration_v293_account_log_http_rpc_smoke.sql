BEGIN;
DO $smoke$
DECLARE
  v_account_id bigint;
  v_campaign_id bigint;
  v_before bigint;
  v_message text := 'v293-rollback-smoke-' || txid_current()::text;
  v_time timestamptz := clock_timestamp();
  v_payload jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = 'public.aka_agent_record_account_log(jsonb,jsonb)'::regprocedure
      AND p.prosecdef AND p.prorettype = 'void'::regtype AND p.provolatile = 'v'
      AND pg_get_userbyid(p.proowner) = 'postgres'
  ) THEN RAISE EXCEPTION 'RPC attributes mismatch'; END IF;
  IF NOT has_function_privilege('anon', 'public.aka_agent_record_account_log(jsonb,jsonb)', 'EXECUTE')
    OR has_table_privilege('anon', 'public.auto_account_logs', 'SELECT')
    OR has_table_privilege('anon', 'public.auto_account_logs', 'UPDATE')
    OR has_table_privilege('anon', 'public.auto_account_logs', 'DELETE')
  THEN RAISE EXCEPTION 'append-only permission mismatch'; END IF;

  SELECT id INTO STRICT v_account_id FROM public.auto_accounts ORDER BY id LIMIT 1;
  SELECT id INTO v_campaign_id FROM public.auto_campaigns
    WHERE account_id = v_account_id OR secondary_account_id = v_account_id ORDER BY id LIMIT 1;
  v_payload := jsonb_build_object('account_id', v_account_id, 'campaign_id', v_campaign_id,
    'created_at', v_time, 'login_status', 'future-login-status', 'account_status', 'future-account-status',
    'source', 'future-source', 'event_type', 'future-event', 'message', v_message, 'details', '{}'::jsonb);

  SET LOCAL ROLE anon;
  PERFORM public.aka_agent_record_account_log(v_payload, NULL);
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.auto_account_logs
    WHERE message = v_message AND account_id = v_account_id
      AND campaign_id IS NOT DISTINCT FROM v_campaign_id AND created_at = v_time
      AND login_status = 'future-login-status' AND account_status = 'future-account-status'
      AND source = 'future-source' AND event_type = 'future-event')
  THEN RAISE EXCEPTION 'RPC snapshot/free-text smoke failed'; END IF;

  SELECT count(*) INTO v_before FROM public.auto_account_logs WHERE message = v_message;
  SET LOCAL ROLE anon;
  PERFORM public.aka_agent_record_account_log(v_payload || '{"account_id":-1}'::jsonb, NULL);
  PERFORM public.aka_agent_record_account_log(v_payload || '{"campaign_id":-1}'::jsonb, NULL);
  RESET ROLE;
  IF (SELECT count(*) FROM public.auto_account_logs WHERE message = v_message) <> v_before
  THEN RAISE EXCEPTION 'invalid account/campaign was accepted'; END IF;
END
$smoke$;
SELECT 'PASS: RPC permissions, free states, snapshot and invalid context; writes rolled back' AS result;
ROLLBACK;

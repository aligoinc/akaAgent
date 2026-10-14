-- Stop the two V383 registrations; keep the log table, sequence, function and
-- all collected history. Run only on verified linked akachat. No CASCADE.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
-- DROP TRIGGER requires ACCESS EXCLUSIVE. Acquire it up front, avoiding a
-- SHARE ROW EXCLUSIVE -> ACCESS EXCLUSIVE upgrade against concurrent writers.
LOCK TABLE public.auto_campaigns,public.auto_error IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF to_regprocedure('private.aka_agent_capture_table_change()') IS NULL
     OR md5(pg_get_functiondef('private.aka_agent_capture_table_change()'::regprocedure))
        IS DISTINCT FROM '1cd8e9bc61b39e7ac7f8e6020ba3e953'
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('public.auto_campaigns'::regclass,'public.auto_error'::regclass)
       AND tgname='trg_auto_table_log' AND tgtype=21 AND tgenabled='O' AND tgqual IS NULL
       AND tgfoid='private.aka_agent_capture_table_change()'::regprocedure
       AND ((tgrelid='public.auto_campaigns'::regclass AND encode(tgargs,'escape')=E'campaign_config_v1\\000id\\000')
         OR (tgrelid='public.auto_error'::regclass AND encode(tgargs,'escape')=E'error_config_v1\\000id\\000')))<>2 THEN
    RAISE EXCEPTION 'v383 rollback drift: inspect function/trigger state before detaching';
  END IF;
END;
$guard$;
DROP TRIGGER trg_auto_table_log ON public.auto_campaigns;
DROP TRIGGER trg_auto_table_log ON public.auto_error;
COMMIT;

-- Rollback V489: Desktop no longer executes the V487 reader; service_role (WebApp API) keeps it.
-- Only the grant is revoked (no reload of the PostgREST schema cache). Desktop then shows the
-- "Báo cáo đang được cập nhật" notice in the tab (permission denied is mapped to it) and every other tab keeps working.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE EXECUTE ON FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) FROM aka_agent_desktop;
DO $postflight$
BEGIN
  IF has_function_privilege('aka_agent_desktop',
      'public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'v489_rollback_desktop_still_executes';
  END IF;
END
$postflight$;
COMMIT;

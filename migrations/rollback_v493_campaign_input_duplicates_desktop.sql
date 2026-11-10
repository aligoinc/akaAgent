-- Rollback V493: Desktop no longer executes the V491 reader; service_role (WebApp API) keeps it.
-- Only the grant is revoked (no reload of the PostgREST schema cache). Desktop then reports the cross-campaign check
-- as "đang được cập nhật" (permission denied is mapped to it) and the customer can still insert with "Chỉ lọc trong file".
-- Faster, no-DDL alternative that also hides the options on Web and Desktop: set the web.campaign_input_duplicates
-- switch to {"audience":"off",...}.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE EXECUTE ON FUNCTION public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb) FROM aka_agent_desktop;
DO $postflight$
BEGIN
  IF has_function_privilege('aka_agent_desktop',
      'public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'v493_rollback_desktop_still_executes';
  END IF;
END
$postflight$;
COMMIT;

-- Rollback V522: Desktop no longer executes the V519 reader; service_role (WebApp API) keeps it.
-- Only the grant is revoked (no reload of the PostgREST schema cache). Desktop then treats the lookup as not ready
-- (permission denied is mapped to it): the two "Bỏ data đã có…" options disappear and the import window adds rows as
-- it did before V522.
-- Faster, no-DDL alternative that also turns the lookup off on Web: add "groupMatches": false to the value of the
-- web.campaign_input_duplicates switch.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE EXECUTE ON FUNCTION public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb) FROM aka_agent_desktop;
DO $postflight$
BEGIN
  IF has_function_privilege('aka_agent_desktop',
      'public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'v522_rollback_desktop_still_executes';
  END IF;
END
$postflight$;
COMMIT;

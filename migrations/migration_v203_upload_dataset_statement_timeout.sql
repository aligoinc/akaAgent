-- Large upload Data Sets may contain up to 10,000 normalized contacts and
-- materialize the same snapshot for multiple accounts. The desktop calls this
-- RPC through PostgREST's anon role, whose default statement timeout is only
-- three seconds. Grant this one bounded operation a longer execution window
-- without changing the timeout for any other query.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_save_upload_contact_datasets(bigint,bigint,bigint[],text,text,text,text,text,text,text,text,jsonb,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_save_upload_contact_datasets_rpc';
  END IF;
END;
$preflight$;

ALTER FUNCTION public.aka_agent_save_upload_contact_datasets(
  bigint,
  bigint,
  bigint[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb
)
SET statement_timeout TO '120s';

COMMENT ON FUNCTION public.aka_agent_save_upload_contact_datasets(
  bigint,
  bigint,
  bigint[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb
) IS
  'Save uploaded contact Data Sets with a function-local 120-second statement timeout.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Additive hotfix for Desktop token requests. Stage A is already applied.
-- The live PostgREST pre-request hook runs under the JWT role before every query.
-- Preserve the current IP deny rule, legacy grants, timeouts and business RLS.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  p record;
BEGIN
  SELECT * INTO p FROM pg_proc
  WHERE oid = to_regprocedure('public.aka_agent_block_denied_ip_request()');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Desktop pre-request hook is missing';
  END IF;
  IF md5(pg_get_functiondef(p.oid)) <> 'ff086d95d4ba66cad668bfe48a705e11'
     OR pg_get_userbyid(p.proowner) <> 'postgres'
     OR p.prosecdef
     OR p.provolatile <> 's'
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR p.proacl::text NOT IN (
       '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
       '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
     )
     OR p.proacl IS NULL THEN
    RAISE EXCEPTION 'Desktop pre-request hook definition or ACL drift';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'aka_agent_desktop'
      AND NOT rolsuper AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Desktop token role is missing or changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'authenticator'
      AND 'pgrst.db_pre_request=public.aka_agent_block_denied_ip_request' = ANY(rolconfig)
  ) THEN
    RAISE EXCEPTION 'PostgREST pre-request configuration drift';
  END IF;
END $preflight$;

GRANT EXECUTE ON FUNCTION public.aka_agent_block_denied_ip_request() TO aka_agent_desktop;

COMMIT;

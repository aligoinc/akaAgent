-- Correct the phase B runtime helper only. Does not enable RLS or change grants.
-- Retain the caller's lock_timeout, matching the original inline row locks.
-- No changes to login/recovery deadlines, role defaults, function body or ACL.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $guard$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_proc
  WHERE oid=to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)')
    AND md5(pg_get_functiondef(oid))='092a2f9248212405948944410f40172c'
    AND pg_get_userbyid(proowner)='postgres'
    AND prosecdef=true AND provolatile='v'
    AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','lock_timeout=3s']::text[]
    AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
 ) THEN
  RAISE EXCEPTION 'staff runtime lock timeout source drift; capture live definition again';
 END IF;
END;
$guard$;

ALTER FUNCTION public.aka_agent_staff_runtime_scope(bigint,text) RESET lock_timeout;

DO $guard$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_proc
  WHERE oid=to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)')
    AND md5(pg_get_functiondef(oid))='41d7a8af8bb781e59157a5b919621492'
    AND pg_get_userbyid(proowner)='postgres'
    AND prosecdef=true AND provolatile='v'
    AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
 ) THEN
  RAISE EXCEPTION 'staff runtime lock timeout target drift; capture live definition again';
 END IF;
END;
$guard$;
NOTIFY pgrst, 'reload schema';
COMMIT;

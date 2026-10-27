-- Restore only the existing Chat SQL backend's access to the new staff runtime boundary.
-- Source/target definitions are identical; no RLS activation or function replacement.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $preflight$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)')
  AND md5(pg_get_functiondef(oid))='41d7a8af8bb781e59157a5b919621492'
  AND proowner='postgres'::regrole AND prosecdef AND provolatile='v'
  AND proconfig=ARRAY['search_path=pg_catalog, public']::text[]
  AND proacl::text='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff runtime scope drift; re-audit'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.aka_agent_staff_runtime_profile')
  AND relkind='v' AND md5(pg_get_viewdef(oid,true))='ede238aba1a0de0cebd9fa33ff183f4a'
  AND relowner='postgres'::regrole AND reloptions=ARRAY['security_barrier=true']::text[]
  AND relacl::text='{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=r/postgres}') THEN
  RAISE EXCEPTION 'staff runtime view drift; re-audit'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aka_agent_chat_api' AND rolbypassrls)
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid='public.org_staff'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'backend role/staff RLS drift; re-audit'; END IF;
END;
$preflight$;
GRANT SELECT ON public.aka_agent_staff_runtime_profile TO aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_staff_runtime_scope(bigint,text) TO aka_agent_chat_api;
DO $verify$
BEGIN
 IF NOT has_table_privilege('aka_agent_chat_api','public.aka_agent_staff_runtime_profile','SELECT')
 OR NOT has_function_privilege('aka_agent_chat_api','public.aka_agent_staff_runtime_scope(bigint,text)','EXECUTE')
 OR has_table_privilege('aka_agent_chat_api','public.aka_agent_staff_runtime_profile','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
 OR (SELECT md5(pg_get_functiondef(to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)')))) <> '41d7a8af8bb781e59157a5b919621492'
 OR (SELECT md5(pg_get_viewdef('public.aka_agent_staff_runtime_profile'::regclass,true))) <> 'ede238aba1a0de0cebd9fa33ff183f4a' THEN
  RAISE EXCEPTION 'staff runtime backend permission verification failed'; END IF;
END;
$verify$;

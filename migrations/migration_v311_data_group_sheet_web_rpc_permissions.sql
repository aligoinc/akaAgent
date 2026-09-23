-- v311: Allow the Web backend to call the existing tenant-checked Sheet RPCs.
-- Live definitions captured on cgjbsmqtfhqvttudyjzq, 2026-09-23.
-- ACL-only: preserve function bodies, existing Desktop grants, tables and workers.
-- No PostgREST schema reload: signatures/return types are unchanged. Verify HTTP.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
DECLARE
  r record;
  p record;
  base_acl aclitem[] := '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}';
  target_acl aclitem[] := '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_data_group_external_sync(bigint,bigint,text,text,text,jsonb)','b85a58727a68514b9a5837861adfe35b','v'),
    ('public.aka_agent_list_data_group_members_v3(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text,text[])','e6fb975f8bfa32ebf342c8f4bc7cd0e5','s')
  ) AS expected(signature,checksum,volatility) LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
    IF NOT FOUND THEN RAISE EXCEPTION 'v311: missing RPC %',r.signature; END IF;
    IF md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM r.checksum
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR NOT p.prosecdef OR p.provolatile::text IS DISTINCT FROM r.volatility
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=60s']::text[]
      OR p.proacl IS NULL OR NOT (p.proacl @> base_acl AND p.proacl <@ target_acl)
    THEN RAISE EXCEPTION 'v311: live definition/attributes/ACL drift for %',r.signature; END IF;
  END LOOP;
END;
$preflight$;

GRANT EXECUTE ON FUNCTION public.aka_agent_data_group_external_sync(bigint,bigint,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_data_group_members_v3(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text,text[]) TO service_role;

DO $postflight$
BEGIN
  IF NOT has_function_privilege('service_role','public.aka_agent_data_group_external_sync(bigint,bigint,text,text,text,jsonb)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.aka_agent_list_data_group_members_v3(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text,text[])','EXECUTE') THEN
    RAISE EXCEPTION 'v311: service_role EXECUTE grant missing';
  END IF;
END;
$postflight$;
COMMIT;

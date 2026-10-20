-- V371: temporary organization flag for the future shared Zalo runtime.
-- Source: linked akachat cgjbsmqtfhqvttudyjzq, captured 2026-10-10.
-- New private function: absence is required; never replace existing functions.
-- Existing orgs stay false; INSERT always starts true; UPDATE remains editable.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- ALTER TABLE already requires this lock. Bound the wait and keep the transaction short.
LOCK TABLE public.org_organization IN ACCESS EXCLUSIVE MODE;
DO $preflight$
DECLARE
  v_schema_md5 text;
  v_triggers_md5 text;
  v_ddl_md5 text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'v371 requires the captured postgres owner';
  END IF;
  IF to_regprocedure('private.aka_agent_org_default_new_zalo_runtime()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='private' AND p.proname='aka_agent_org_default_new_zalo_runtime'
     ) THEN
    RAISE EXCEPTION 'v371 target function already exists; inspect, do not replace';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v371_%') THEN
    RAISE EXCEPTION 'v371 version is already in use';
  END IF;
  WITH snapshot AS (
SELECT current_setting('server_version') AS server_version, current_user AS executing_role,
  (SELECT jsonb_build_object(
    'name', c.oid::regclass::text, 'kind', c.relkind, 'owner', pg_get_userbyid(c.relowner),
    'acl', c.relacl, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'estimated_rows', c.reltuples, 'bytes', pg_total_relation_size(c.oid),
    'columns', (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod), 'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid,true)) ORDER BY x.conname),'[]'::jsonb) FROM pg_constraint x WHERE x.conrelid=c.oid)
  ) FROM pg_class c WHERE c.oid='public.org_organization'::regclass) AS table_schema,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),
    'function',jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl)) ORDER BY t.tgname),'[]'::jsonb)
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.org_organization'::regclass AND NOT t.tgisinternal) AS triggers,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,'signature',e.evtfoid::regprocedure::text,'definition',pg_get_functiondef(e.evtfoid),'md5',md5(pg_get_functiondef(e.evtfoid))) ORDER BY e.evtname),'[]'::jsonb) FROM pg_event_trigger e) AS ddl_triggers,
  to_regprocedure('private.aka_agent_org_default_new_zalo_runtime()')::text AS target_signature,
  (SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='aka_agent_org_default_new_zalo_runtime') AS target_overloads,
  (SELECT jsonb_agg(x ORDER BY x.version DESC) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 10)x) AS recent_migrations
  ) SELECT md5((table_schema - 'bytes' - 'estimated_rows')::text),
           md5(triggers::text), md5(ddl_triggers::text)
    INTO v_schema_md5, v_triggers_md5, v_ddl_md5 FROM snapshot;
  IF v_schema_md5 IS DISTINCT FROM '59f762689c91ca2f893646d25d62bc56'
     OR v_triggers_md5 IS DISTINCT FROM '6ed2df73f4b468104468192c372a7370'
     OR v_ddl_md5 IS DISTINCT FROM '2ca46b2b562944de645a2b544a4eec25' THEN
    RAISE EXCEPTION 'v371 source schema/trigger/function drift: %, %, %', v_schema_md5, v_triggers_md5, v_ddl_md5;
  END IF;
END;
$preflight$;

-- Constant false is PostgreSQL's fast missing value for old rows: no UPDATE,
-- no customer lifecycle/order UPDATE triggers. Both defaults change atomically.
ALTER TABLE public.org_organization
  ADD COLUMN use_new_zalo_runtime boolean NOT NULL DEFAULT false;
ALTER TABLE public.org_organization
  ALTER COLUMN use_new_zalo_runtime SET DEFAULT true;

CREATE FUNCTION private.aka_agent_org_default_new_zalo_runtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.use_new_zalo_runtime := true;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_org_default_new_zalo_runtime()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_use_new_zalo_runtime_on_insert
  BEFORE INSERT ON public.org_organization
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_org_default_new_zalo_runtime();

COMMENT ON COLUMN public.org_organization.use_new_zalo_runtime IS
  'Temporary Zalo runtime rollout flag. Existing organizations start false; new INSERTs are forced true even for explicit false/null. UPDATE may change it. Metadata only until runtime routing consumes it; remove after full migration.';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.org_organization WHERE use_new_zalo_runtime IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'v371 must preserve all pre-existing organizations as false';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid='private.aka_agent_org_default_new_zalo_runtime()'::regprocedure
      AND a.grantee <> p.proowner
  ) THEN
    RAISE EXCEPTION 'v371 trigger function must remain owner-only';
  END IF;
END;
$verify$;
-- Existing pgrst_ddl_watch automatically queues the required schema reload for
-- the new API column. No extra NOTIFY, setup DDL, pool, cron or runtime switch.
COMMIT;

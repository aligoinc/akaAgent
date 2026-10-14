-- V382: opt-in INSERT/UPDATE snapshots, best effort, owner-only read.
-- Source: linked akachat cgjbsmqtfhqvttudyjzq, captured 2026-10-14.
-- New objects only. Existing functions/triggers/ACLs are never replaced.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- CREATE TRIGGER needs this lock; acquire both in a fixed order and fail quickly.
LOCK TABLE public.auto_campaigns, public.auto_error IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
DECLARE
  v_sources_md5 text;
  v_ddl_md5 text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'v382 requires the captured postgres owner';
  END IF;
  IF to_regnamespace('private') IS NULL
     OR to_regclass('private.auto_table_logs') IS NOT NULL
     OR to_regclass('private.auto_table_logs_id_seq') IS NOT NULL
     OR to_regclass('private.idx_auto_table_logs_record_time') IS NOT NULL
     OR to_regprocedure('private.aka_agent_capture_table_change()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='private' AND p.proname='aka_agent_capture_table_change') THEN
    RAISE EXCEPTION 'v382 target objects already exist or private schema is missing; inspect, do not replace';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v382_%') THEN
    RAISE EXCEPTION 'v382 migration version already used';
  END IF;
  WITH snapshot AS (SELECT current_setting('server_version') AS server_version, current_user AS executing_role,
  (SELECT jsonb_agg(jsonb_build_object(
    'name',c.oid::regclass::text,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
    'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,
      'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
      'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl)
      ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid,true)) ORDER BY x.conname),'[]'::jsonb)
      FROM pg_constraint x WHERE x.conrelid=c.oid),
    'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),
      'function',jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
      'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
      'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl)) ORDER BY t.tgname),'[]'::jsonb)
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)
  ) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('auto_campaigns','auto_error')) AS sources,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,
    'signature',e.evtfoid::regprocedure::text,'definition',pg_get_functiondef(e.evtfoid),'md5',md5(pg_get_functiondef(e.evtfoid))) ORDER BY e.evtname),'[]'::jsonb)
    FROM pg_event_trigger e) AS ddl_triggers,
  to_regclass('private.auto_table_logs')::text AS target_table,
  to_regclass('private.auto_table_logs_id_seq')::text AS target_sequence,
  to_regprocedure('private.aka_agent_capture_table_change()')::text AS target_signature,
  (SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text),'[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='aka_agent_capture_table_change') AS target_overloads,
  (SELECT jsonb_agg(x ORDER BY x.version DESC) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8)x) AS recent_migrations) SELECT md5(sources::text), md5(ddl_triggers::text) INTO v_sources_md5, v_ddl_md5 FROM snapshot;
  IF v_sources_md5 IS DISTINCT FROM '8d92e4751c1a5f52529ce1a467fadbd8' OR v_ddl_md5 IS DISTINCT FROM '2ca46b2b562944de645a2b544a4eec25' THEN
    RAISE EXCEPTION 'v382 source schema/trigger/function drift: %, %', v_sources_md5, v_ddl_md5;
  END IF;
END;
$preflight$;

CREATE TABLE private.auto_table_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  table_name text NOT NULL,
  record_pk jsonb NOT NULL,
  operation text NOT NULL,
  old_data jsonb,
  new_data jsonb NOT NULL,
  CONSTRAINT auto_table_logs_operation_check CHECK (operation IN ('INSERT','UPDATE')),
  CONSTRAINT auto_table_logs_record_pk_check CHECK (jsonb_typeof(record_pk)='object' AND record_pk<>'{}'::jsonb),
  CONSTRAINT auto_table_logs_new_data_check CHECK (jsonb_typeof(new_data)='object'),
  CONSTRAINT auto_table_logs_old_data_check CHECK (
    (operation='INSERT' AND old_data IS NULL)
    OR (operation='UPDATE' AND old_data IS NOT NULL AND jsonb_typeof(old_data)='object')
  )
);
CREATE INDEX idx_auto_table_logs_record_time
  ON private.auto_table_logs(table_name, record_pk, created_at DESC, id DESC);
ALTER TABLE private.auto_table_logs ENABLE ROW LEVEL SECURITY;

-- BEGIN CAPTURE FUNCTION
CREATE FUNCTION private.aka_agent_capture_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_new jsonb;
  v_old jsonb;
  v_pk jsonb := '{}'::jsonb;
  v_column text;
BEGIN
  -- No schema is stored. Restrict registration to public tables; in particular,
  -- the private log cannot log itself. No catalog query is needed per row.
  IF TG_TABLE_SCHEMA <> 'public' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW'
     OR TG_OP NOT IN ('INSERT','UPDATE') OR TG_NARGS=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid table log trigger configuration';
  END IF;
  v_new := to_jsonb(NEW);
  IF TG_OP='UPDATE' THEN
    v_old := to_jsonb(OLD);
  END IF;
  FOREACH v_column IN ARRAY TG_ARGV LOOP
    IF v_column IS NULL OR NOT (v_new ? v_column) OR v_new->v_column='null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid table log primary key column';
    END IF;
    v_pk := v_pk || jsonb_build_object(v_column,v_new->v_column);
  END LOOP;
  INSERT INTO private.auto_table_logs(table_name,record_pk,operation,old_data,new_data)
    VALUES (TG_TABLE_NAME,v_pk,TG_OP,v_old,v_new);
  RETURN NULL; -- ignored for AFTER ROW triggers
EXCEPTION WHEN OTHERS THEN
  -- Do not include SQLERRM/DETAIL/row values (they can contain credentials).
  -- Cancellation/assertion failures remain PostgreSQL errors; no retry/queue.
  RAISE WARNING 'auto_table_logs: capture skipped (SQLSTATE %)', SQLSTATE;
  RETURN NULL;
END;
$function$;
-- END CAPTURE FUNCTION

-- Remove every default grant, including project-specific roles. This changes
-- only the three new objects; private schema privileges remain untouched.
DO $permissions$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT c.oid::regclass::text AS object_name,
      CASE WHEN c.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END AS object_type,
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee
    FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE c.oid IN ('private.auto_table_logs'::regclass,'private.auto_table_logs_id_seq'::regclass)
      AND a.grantee<>c.relowner
  LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM %s',r.object_type,r.object_name,r.grantee);
  END LOOP;
  FOR r IN
    SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='private.aka_agent_capture_table_change()'::regprocedure AND a.grantee<>p.proowner
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_capture_table_change() FROM %s',r.grantee);
  END LOOP;
END;
$permissions$;

CREATE TRIGGER trg_auto_table_log
  AFTER INSERT OR UPDATE ON public.auto_campaigns
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('id');
CREATE TRIGGER trg_auto_table_log
  AFTER INSERT OR UPDATE ON public.auto_error
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change('id');

COMMENT ON TABLE private.auto_table_logs IS
  'Best-effort full INSERT/UPDATE snapshots for explicitly registered public tables. table_name has no schema prefix. Admin-only read; no automatic retention, source FKs, DELETE logging or historical backfill. Rolled-back writes leave no log.';
COMMENT ON FUNCTION private.aka_agent_capture_table_change() IS
  'AFTER INSERT OR UPDATE ROW trigger. TG_ARGV lists primary-key columns. Owner-only internal definer; handles ordinary logging errors without retry. Does not identify the human actor.';

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE c.oid IN ('private.auto_table_logs'::regclass,'private.auto_table_logs_id_seq'::regclass)
      AND a.grantee<>c.relowner
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='private.aka_agent_capture_table_change()'::regprocedure AND a.grantee<>p.proowner
  ) THEN
    RAISE EXCEPTION 'v382 new objects must be owner-only';
  END IF;
END;
$verify$;
-- Existing pgrst_ddl_watch observes this DDL. Do not add another NOTIFY,
-- disable global event triggers, or create migration-history setup objects.
COMMIT;

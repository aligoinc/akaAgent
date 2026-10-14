-- Reverse V385 comments only; preserve logging and migration history.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $guard$
DECLARE v_snapshot record;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'v385 requires postgres'; END IF;
  SELECT * INTO v_snapshot FROM (SELECT jsonb_build_object(
  'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
  'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),
  'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl
) AS capture_function,
obj_description(p.oid,'pg_proc') AS function_comment,
obj_description(c.oid,'pg_class') AS table_comment,
jsonb_build_object(
  'oid',c.oid,'schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),
  'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
  'relfilenode',c.relfilenode,'toast_oid',c.reltoastrelid,
  'sequence',pg_get_serial_sequence('public.auto_table_logs','id'),
  'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'identity',a.attidentity,'acl',a.attacl,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid,true)) ORDER BY conname)
    FROM pg_constraint WHERE conrelid=c.oid),
  'indexes',(SELECT jsonb_agg(jsonb_build_object('oid',i.indexrelid,'file',ic.relfilenode,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname)
    FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),
  'policies',(SELECT coalesce(jsonb_agg(to_jsonb(pol)),'[]') FROM pg_policy pol WHERE polrelid=c.oid)
) AS table_catalog,
(SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,
  'definition',pg_get_triggerdef(t.oid,true)) ORDER BY t.tgrelid::regclass::text,t.tgname)
 FROM pg_trigger t WHERE t.tgfoid=p.oid) AS registrations,
(SELECT jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,
  'signature',e.evtfoid::regprocedure::text,'md5',md5(pg_get_functiondef(e.evtfoid))) ORDER BY e.evtname)
 FROM pg_event_trigger e) AS ddl_triggers
FROM pg_proc p CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE p.oid=to_regprocedure('private.aka_agent_capture_table_change()')
  AND c.oid=to_regclass('public.auto_table_logs')) captured;
  IF NOT FOUND THEN RAISE EXCEPTION 'v385 required objects are missing'; END IF;
  IF v_snapshot.capture_function - 'definition' IS DISTINCT FROM '{"acl":["postgres=X/postgres"],"config":["search_path=pg_catalog"],"md5":"96858661d7d592a9cdc22c67fd853c62","owner":"postgres","security_definer":true,"signature":"private.aka_agent_capture_table_change()","volatility":"v"}'::jsonb
    OR v_snapshot.table_catalog IS DISTINCT FROM '{"acl":null,"columns":[{"acl":null,"default":null,"identity":"a","name":"id","not_null":true,"type":"bigint"},{"acl":null,"default":"clock_timestamp()","identity":"","name":"created_at","not_null":true,"type":"timestamp with time zone"},{"acl":null,"default":null,"identity":"","name":"table_name","not_null":true,"type":"text"},{"acl":null,"default":null,"identity":"","name":"record_pk","not_null":true,"type":"jsonb"},{"acl":null,"default":null,"identity":"","name":"operation","not_null":true,"type":"text"},{"acl":null,"default":null,"identity":"","name":"old_data","not_null":false,"type":"jsonb"},{"acl":null,"default":null,"identity":"","name":"new_data","not_null":true,"type":"jsonb"}],"constraints":[{"def":"CHECK (jsonb_typeof(new_data) = ''object''::text)","name":"auto_table_logs_new_data_check"},{"def":"CHECK (operation = ''INSERT''::text AND old_data IS NULL OR operation = ''UPDATE''::text AND old_data IS NOT NULL AND jsonb_typeof(old_data) = ''object''::text)","name":"auto_table_logs_old_data_check"},{"def":"CHECK (operation = ANY (ARRAY[''INSERT''::text, ''UPDATE''::text]))","name":"auto_table_logs_operation_check"},{"def":"PRIMARY KEY (id)","name":"auto_table_logs_pkey"},{"def":"CHECK (jsonb_typeof(record_pk) = ''object''::text AND record_pk <> ''{}''::jsonb)","name":"auto_table_logs_record_pk_check"}],"force_rls":false,"indexes":[{"definition":"CREATE UNIQUE INDEX auto_table_logs_pkey ON public.auto_table_logs USING btree (id)","file":"39736847","oid":"39736847"},{"definition":"CREATE INDEX idx_auto_table_logs_record_time ON public.auto_table_logs USING btree (table_name, record_pk, created_at DESC, id DESC)","file":"39736849","oid":"39736849"}],"name":"auto_table_logs","oid":"39736837","owner":"postgres","policies":[],"relfilenode":"39736837","rls":true,"schema":"public","sequence":"public.auto_table_logs_id_seq","toast_oid":"39736845"}'::jsonb
    OR v_snapshot.registrations IS DISTINCT FROM '[{"definition":"CREATE TRIGGER trg_auto_table_log AFTER INSERT OR UPDATE ON auto_campaigns FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change(''campaign_config_v1'', ''id'')","enabled":"O","name":"trg_auto_table_log","table":"auto_campaigns"},{"definition":"CREATE TRIGGER trg_auto_table_log AFTER INSERT OR UPDATE ON auto_error FOR EACH ROW EXECUTE FUNCTION private.aka_agent_capture_table_change(''error_config_v1'', ''id'')","enabled":"O","name":"trg_auto_table_log","table":"auto_error"}]'::jsonb
    OR v_snapshot.ddl_triggers IS DISTINCT FROM '[{"enabled":"O","event":"sql_drop","md5":"8da9dff6b2ae47498209d341acaeb60b","name":"issue_graphql_placeholder","signature":"set_graphql_placeholder()","tags":["DROP EXTENSION"]},{"enabled":"O","event":"ddl_command_end","md5":"53a44336da0ac1dd62d89dbd988e6d1d","name":"issue_pg_cron_access","signature":"grant_pg_cron_access()","tags":["CREATE EXTENSION"]},{"enabled":"O","event":"ddl_command_end","md5":"4e6d7efe4aed1b3b92063b648aa7a0cf","name":"issue_pg_graphql_access","signature":"grant_pg_graphql_access()","tags":["CREATE FUNCTION"]},{"enabled":"O","event":"ddl_command_end","md5":"1d06ef4fb47bb0ab6e6f8818a62013bb","name":"issue_pg_net_access","signature":"grant_pg_net_access()","tags":["CREATE EXTENSION"]},{"enabled":"O","event":"ddl_command_end","md5":"afaad7193dcf8f81e728d2bedb85e43e","name":"pgrst_ddl_watch","signature":"pgrst_ddl_watch()","tags":null},{"enabled":"O","event":"sql_drop","md5":"4357772baf5cfcd5c6d7049585b3a537","name":"pgrst_drop_watch","signature":"pgrst_drop_watch()","tags":null}]'::jsonb
    OR v_snapshot.function_comment IS DISTINCT FROM 'AFTER INSERT OR UPDATE FOR EACH ROW trigger for supported public source tables, excluding auto_table_logs. TG_ARGV[0] is the configuration profile (campaign_config_v1 or error_config_v1); TG_ARGV[1..] are primary-key column names included in the profile snapshot. Registrations: auto_campaigns -> (''campaign_config_v1'',''id''); auto_error -> (''error_config_v1'',''id''). INSERT captures configuration; UPDATE skips unchanged normalized configuration. Owner-only SECURITY DEFINER with fixed search_path; ordinary capture errors are skipped with a sanitized warning, without retry. No human-actor attribution.'
    OR v_snapshot.table_comment IS DISTINCT FROM 'Best-effort configuration history for explicitly registered public tables. INSERT records the configuration baseline; UPDATE records only normalized configuration differences. Campaign snapshots exclude log, timestamps, status, claims and known runtime progress; auto_error excludes created_at/updated_at. Historical V382 rows may contain full source snapshots and are retained. table_name has no schema prefix. Admin-only read; no automatic retention, source FKs, DELETE logging or backfill. Rolled-back writes leave no log.' THEN
    RAISE EXCEPTION 'v385 catalog/function/comment drift; inspect live state';
  END IF;
END;
$guard$;
COMMENT ON TABLE public.auto_table_logs IS 'Best-effort full INSERT/UPDATE snapshots for explicitly registered public tables. table_name has no schema prefix. Admin-only read; no automatic retention, source FKs, DELETE logging or historical backfill. Rolled-back writes leave no log.';
COMMENT ON FUNCTION private.aka_agent_capture_table_change() IS 'AFTER INSERT OR UPDATE ROW trigger. TG_ARGV lists primary-key columns. Owner-only internal definer; handles ordinary logging errors without retry. Does not identify the human actor.';
COMMIT;

-- V384: move the existing log table to public; preserve V383 config filtering.
-- Captured live on linked akachat cgjbsmqtfhqvttudyjzq. No row copy/prune.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
-- Stop source writers first, so moving the log cannot deadlock with their triggers.
LOCK TABLE public.auto_campaigns,public.auto_error IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE private.auto_table_logs IN ACCESS EXCLUSIVE MODE;
DO $preflight$
DECLARE v_snapshot record;
BEGIN
  IF current_user<>'postgres' OR to_regprocedure('private.aka_agent_capture_table_change()') IS NULL
    OR md5(pg_get_functiondef('private.aka_agent_capture_table_change()'::regprocedure)) IS DISTINCT FROM '1cd8e9bc61b39e7ac7f8e6020ba3e953' THEN
    RAISE EXCEPTION 'v384 source function/owner drift';
  END IF;
  IF to_regclass('public.auto_table_logs') IS NOT NULL OR to_regtype('public.auto_table_logs') IS NOT NULL
    OR to_regclass('public.auto_table_logs_id_seq') IS NOT NULL
    OR to_regclass('public.auto_table_logs_pkey') IS NOT NULL
    OR to_regclass('public.idx_auto_table_logs_record_time') IS NOT NULL
    OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v384_%') THEN
    RAISE EXCEPTION 'v384 target name/version already exists';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgfoid='private.aka_agent_capture_table_change()'::regprocedure)<>2 THEN
    RAISE EXCEPTION 'v384 unexpected capture registration';
  END IF;
  SELECT * INTO v_snapshot FROM (WITH base AS (SELECT current_setting('server_version') AS server_version, current_user AS executing_role,
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
  (SELECT jsonb_agg(x ORDER BY x.version DESC) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8)x) AS recent_migrations), catalog AS (SELECT jsonb_build_object('oid',c.oid,'name',c.relname,'schema',n.nspname,'owner',pg_get_userbyid(c.relowner),
'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'relfilenode',c.relfilenode,'toast_oid',c.reltoastrelid,
'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'acl',a.attacl,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid,true)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid),
'indexes',(SELECT jsonb_agg(jsonb_build_object('oid',i.indexrelid,'name',ic.relname,'schema',ins.nspname,'relfilenode',ic.relfilenode,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace ins ON ins.oid=ic.relnamespace WHERE i.indrelid=c.oid),
'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM pg_policy p WHERE polrelid=c.oid),
'sequence',(SELECT jsonb_build_object('oid',s.oid,'name',s.relname,'schema',sn.nspname,'owner',pg_get_userbyid(s.relowner),'acl',s.relacl) FROM pg_class s JOIN pg_namespace sn ON sn.oid=s.relnamespace WHERE s.oid=pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),'id')::regclass)) AS log_catalog
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=coalesce(to_regclass('private.auto_table_logs'),to_regclass('public.auto_table_logs'))) SELECT to_jsonb(base) base,log_catalog,md5(base.sources::text) sources_md5,md5(base.ddl_triggers::text) ddl_md5,md5(log_catalog::text) catalog_md5,clock_timestamp() captured_at FROM base,catalog) snapshot;
  IF v_snapshot.sources_md5 IS DISTINCT FROM '272f28d368cdc0133afca583fdbf1447'
     OR v_snapshot.ddl_md5 IS DISTINCT FROM '2ca46b2b562944de645a2b544a4eec25'
     OR v_snapshot.catalog_md5 IS DISTINCT FROM '06376d38d9dfea8bfe4430987a00c9ca' THEN
    RAISE EXCEPTION 'v384 schema/function/trigger/ACL drift; inspect live state';
  END IF;
END;
$preflight$;
ALTER TABLE private.auto_table_logs SET SCHEMA public;
CREATE OR REPLACE FUNCTION private.aka_agent_capture_table_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_new jsonb;
  v_old jsonb;
  v_pk jsonb := '{}'::jsonb;
  v_column text;
BEGIN
  -- No schema is stored. Restrict registration to public source tables,
  -- excluding the audit table itself. No catalog query is needed per row.
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME='auto_table_logs' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW'
     OR TG_OP NOT IN ('INSERT','UPDATE') OR TG_NARGS<2
     OR TG_ARGV[0] NOT IN ('campaign_config_v1','error_config_v1') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid table log trigger configuration';
  END IF;
  -- Explicit campaign projection never reads/serializes the large log column.
  -- original_schedule is configured time; schedule is the next runtime slot.
  -- Empty/NULL settings and runtime-only settings have the same config value.
  IF TG_ARGV[0]='campaign_config_v1' THEN
    v_new := jsonb_build_object(
      'id',NEW.id,
      'name',NEW.name,
      'action_id',NEW.action_id,
      'account_id',NEW.account_id,
      'secondary_account_id',NEW.secondary_account_id,
      'is_delete',NEW.is_delete,
      'content',NEW.content,
      'original_schedule',NEW.original_schedule,
      'schedule_type',NEW.schedule_type,
      'schedule_end_date',NEW.schedule_end_date,
      'schedule_days',NEW.schedule_days,
      'schedule_week_days',NEW.schedule_week_days,
      'continue_next_day',NEW.continue_next_day,
      'refresh_data',NEW.refresh_data,
      'extra_settings',CASE WHEN jsonb_typeof(NEW.extra_settings)='object' THEN nullif(NEW.extra_settings - ARRAY['sourceLinkIndex','contentRotationIndex','postBumpRotationIndex','internalSmsCreatedCampaignIdsByAccount','postBumpCreatedCampaignIdsByAccount','zaloFriendDataMaterializedAt','zaloFriendMaterializedCount','zaloBirthdayDataMaterializedDate','zaloBirthdayMaterializedCount','zaloFriendRecommendationDataMaterializedAt','zaloFriendRecommendationMaterializedCount','zaloCancelFriendRequestDataMaterializedAt','zaloCancelFriendRequestMaterializedCount'], '{}'::jsonb) ELSE NEW.extra_settings END,
      'images',NEW.images,
      'staff_id',NEW.staff_id,
      'organization_id',NEW.organization_id,
      'daily_stop_time',NEW.daily_stop_time,
      'time_sleep_between_2',NEW.time_sleep_between_2,
      'data_target_source_mode',NEW.data_target_source_mode,
      'data_group_id',NEW.data_group_id
    );
    IF TG_OP='UPDATE' THEN
      v_old := jsonb_build_object(
      'id',OLD.id,
      'name',OLD.name,
      'action_id',OLD.action_id,
      'account_id',OLD.account_id,
      'secondary_account_id',OLD.secondary_account_id,
      'is_delete',OLD.is_delete,
      'content',OLD.content,
      'original_schedule',OLD.original_schedule,
      'schedule_type',OLD.schedule_type,
      'schedule_end_date',OLD.schedule_end_date,
      'schedule_days',OLD.schedule_days,
      'schedule_week_days',OLD.schedule_week_days,
      'continue_next_day',OLD.continue_next_day,
      'refresh_data',OLD.refresh_data,
      'extra_settings',CASE WHEN jsonb_typeof(OLD.extra_settings)='object' THEN nullif(OLD.extra_settings - ARRAY['sourceLinkIndex','contentRotationIndex','postBumpRotationIndex','internalSmsCreatedCampaignIdsByAccount','postBumpCreatedCampaignIdsByAccount','zaloFriendDataMaterializedAt','zaloFriendMaterializedCount','zaloBirthdayDataMaterializedDate','zaloBirthdayMaterializedCount','zaloFriendRecommendationDataMaterializedAt','zaloFriendRecommendationMaterializedCount','zaloCancelFriendRequestDataMaterializedAt','zaloCancelFriendRequestMaterializedCount'], '{}'::jsonb) ELSE OLD.extra_settings END,
      'images',OLD.images,
      'staff_id',OLD.staff_id,
      'organization_id',OLD.organization_id,
      'daily_stop_time',OLD.daily_stop_time,
      'time_sleep_between_2',OLD.time_sleep_between_2,
      'data_target_source_mode',OLD.data_target_source_mode,
      'data_group_id',OLD.data_group_id
    );
    END IF;
  ELSE
    -- auto_error is a policy catalog, not an error-event stream.
    v_new := to_jsonb(NEW) - ARRAY['created_at','updated_at'];
    IF TG_OP='UPDATE' THEN
      v_old := to_jsonb(OLD) - ARRAY['created_at','updated_at'];
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND v_old IS NOT DISTINCT FROM v_new THEN
    RETURN NULL;
  END IF;
  -- Profile first, then the primary-key column names (including composite keys).
  FOREACH v_column IN ARRAY TG_ARGV[1:TG_NARGS-1] LOOP
    IF v_column IS NULL OR NOT (v_new ? v_column) OR v_new->v_column='null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid table log primary key column';
    END IF;
    v_pk := v_pk || jsonb_build_object(v_column,v_new->v_column);
  END LOOP;
  INSERT INTO public.auto_table_logs(table_name,record_pk,operation,old_data,new_data)
    VALUES (TG_TABLE_NAME,v_pk,TG_OP,v_old,v_new);
  RETURN NULL; -- ignored for AFTER ROW triggers
EXCEPTION WHEN OTHERS THEN
  -- Do not include SQLERRM/DETAIL/row values (they can contain credentials).
  -- Cancellation/assertion failures remain PostgreSQL errors; no retry/queue.
  RAISE WARNING 'auto_table_logs: capture skipped (SQLSTATE %)', SQLSTATE;
  RETURN NULL;
END;
$function$
;

-- SET SCHEMA also moves the owned identity sequence and indexes. Preserve ACLs;
-- public schema visibility does not grant application access to the table.
DO $verify$
BEGIN
  IF to_regclass('private.auto_table_logs') IS NOT NULL
    OR pg_get_serial_sequence('public.auto_table_logs','id')<>'public.auto_table_logs_id_seq'
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.auto_table_logs'::regclass
      AND relrowsecurity AND pg_get_userbyid(relowner)='postgres')
    OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.auto_table_logs'::regclass)
    OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
      WHERE c.oid IN ('public.auto_table_logs'::regclass,'public.auto_table_logs_id_seq'::regclass) AND a.grantee<>c.relowner)
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='private.aka_agent_capture_table_change()'::regprocedure
      AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='v'
      AND proconfig=ARRAY['search_path=pg_catalog'] AND proacl::text='{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'v384 log ownership/RLS/ACL/sequence contract failed';
  END IF;
END;
$verify$;
-- Existing pgrst_ddl_watch handles schema reload. No duplicate NOTIFY/setup DDL.
COMMIT;

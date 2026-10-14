-- V384 reverse move only: retain all data and V383 config-only logging.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.auto_campaigns,public.auto_error IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.auto_table_logs IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF current_user<>'postgres' OR md5(pg_get_functiondef('private.aka_agent_capture_table_change()'::regprocedure)) IS DISTINCT FROM '96858661d7d592a9cdc22c67fd853c62'
    OR to_regclass('private.auto_table_logs') IS NOT NULL OR to_regtype('private.auto_table_logs') IS NOT NULL
    OR to_regclass('private.auto_table_logs_id_seq') IS NOT NULL
    OR to_regclass('private.auto_table_logs_pkey') IS NOT NULL
    OR to_regclass('private.idx_auto_table_logs_record_time') IS NOT NULL THEN
    RAISE EXCEPTION 'v384 rollback drift; inspect current state';
  END IF;
END $guard$;
ALTER TABLE public.auto_table_logs SET SCHEMA private;
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
  -- No schema is stored. Restrict registration to public tables; in particular,
  -- the private log cannot log itself. No catalog query is needed per row.
  IF TG_TABLE_SCHEMA <> 'public' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW'
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
  INSERT INTO private.auto_table_logs(table_name,record_pk,operation,old_data,new_data)
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

DO $verify$ BEGIN
  IF md5(pg_get_functiondef('private.aka_agent_capture_table_change()'::regprocedure))<>'1cd8e9bc61b39e7ac7f8e6020ba3e953'
    OR pg_get_serial_sequence('private.auto_table_logs','id')<>'private.auto_table_logs_id_seq' THEN
    RAISE EXCEPTION 'v384 rollback contract failed';
  END IF;
END $verify$;
-- Existing DDL watcher reloads schema. Do not delete migration history.
COMMIT;

-- Rollback V465: removes the nightly job, the data report functions and the private data report tables.
-- No existing table, index, function or permission was changed by V465, so nothing else is restored.
-- WebApp API and Desktop treat a missing reader as "đang được cập nhật" and hide the data report.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $unschedule$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-report-nightly') THEN
    PERFORM cron.unschedule('aka-agent-data-report-nightly');
  END IF;
END
$unschedule$;
DROP FUNCTION IF EXISTS public.aka_agent_read_data_report(bigint,bigint,text,text,jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_data_report_run(integer);
DROP FUNCTION IF EXISTS private.aka_agent_data_report_build(bigint,date);
DROP FUNCTION IF EXISTS private.aka_agent_data_report_sweep_engagement(timestamptz);
DROP FUNCTION IF EXISTS private.aka_agent_data_report_sweep_details(integer);
DROP FUNCTION IF EXISTS private.aka_agent_data_report_sweep_inputs(integer);
DROP FUNCTION IF EXISTS private.aka_agent_data_report_sweep_contacts(integer);
DROP FUNCTION IF EXISTS private.aka_agent_data_report_sweep_people(integer);
DROP FUNCTION IF EXISTS private.aka_agent_data_report_store_known();
DROP FUNCTION IF EXISTS private.aka_agent_data_report_merge_links();
DROP FUNCTION IF EXISTS private.aka_agent_data_report_phone_hash(text);
DROP FUNCTION IF EXISTS private.aka_agent_data_report_person_hash(text,bigint,text);
DROP TABLE IF EXISTS private.aka_agent_data_report_stage;
DROP TABLE IF EXISTS private.aka_agent_data_report_runs;
DROP TABLE IF EXISTS private.aka_agent_data_report_snapshots;
DROP TABLE IF EXISTS private.aka_agent_data_report_groups;
DROP TABLE IF EXISTS private.aka_agent_data_report_group_daily;
DROP TABLE IF EXISTS private.aka_agent_data_report_daily;
DROP TABLE IF EXISTS private.aka_agent_data_report_contact_keys;
DROP TABLE IF EXISTS private.aka_agent_data_report_phone_links;
DROP TABLE IF EXISTS private.aka_agent_data_report_customers;
DROP TABLE IF EXISTS private.aka_agent_data_report_staff;
DROP TABLE IF EXISTS private.aka_agent_data_report_state;
NOTIFY pgrst, 'reload schema';
COMMIT;

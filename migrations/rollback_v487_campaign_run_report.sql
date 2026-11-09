-- Rollback V487: drops only the function added by V487. No data is touched.
-- The WebApp API treats a missing function as "Báo cáo đang được cập nhật" (503) and keeps every other tab working.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb);
NOTIFY pgrst, 'reload schema';
COMMIT;

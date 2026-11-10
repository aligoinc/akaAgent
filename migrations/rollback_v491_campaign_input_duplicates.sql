-- Rollback V491: drops only the function and the switch row added by V491. No campaign data is touched.
-- The WebApp API treats a missing function/switch as "chưa sẵn sàng": the upload modal hides the
-- cross-campaign options and keeps "Chỉ trong file này" (the behaviour before V491).
-- Faster, no-DDL alternative: UPDATE auto_system_settings SET value = '{"audience":"off","defaultDays":30,"maxDays":365}'
--   WHERE key = 'web.campaign_input_duplicates';
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb);
DELETE FROM public.auto_system_settings WHERE key = 'web.campaign_input_duplicates';
NOTIFY pgrst, 'reload schema';
COMMIT;

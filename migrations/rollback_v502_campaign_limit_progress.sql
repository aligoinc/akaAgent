-- Rollback V502: drops only the function added by V502. No data is touched.
-- The WebApp API treats a missing function as "chưa sẵn sàng": the campaign list hides the "Giới hạn lượt"
-- numbers and the "Hành động" tab falls back to its previous reader.
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP FUNCTION IF EXISTS public.aka_agent_control_campaign_limit_progress(bigint,bigint,bigint[],bigint[],text[],boolean);
NOTIFY pgrst, 'reload schema';
COMMIT;

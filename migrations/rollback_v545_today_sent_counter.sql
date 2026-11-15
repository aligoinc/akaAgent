-- Rollback V545 (docs/TODAY_SENT_COUNTER_V545.md): gỡ hai trigger trước (một giao dịch riêng, lock_timeout ngắn, lệnh
-- DROP TRIGGER là lệnh cuối), rồi gỡ job, hàm, bảng và dòng công tắc. Không chạm hàm/trigger nào có từ trước V545.
-- Muốn ngừng nhanh mà không gỡ: đặt công tắc {"enabled":false} (trigger thoát ngay, Web ẩn ô).
BEGIN;
SET LOCAL lock_timeout = '2s';
DROP TRIGGER IF EXISTS trg_aka_agent_today_sent_update ON public.auto_campaign_details;
DROP TRIGGER IF EXISTS trg_aka_agent_today_sent_insert ON public.auto_campaign_details;
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'aka-agent-today-sent-cleanup';
DROP FUNCTION IF EXISTS public.aka_agent_control_today_sent(bigint, bigint, text[]);
DROP FUNCTION IF EXISTS private.auto_today_sent_capture();
DROP TABLE IF EXISTS private.auto_account_sent_events;
DELETE FROM public.auto_system_settings WHERE key = 'campaigns.today_sent';
COMMIT;

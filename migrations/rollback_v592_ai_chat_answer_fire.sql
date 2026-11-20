-- Gỡ V592: dừng job, xoá hàm, bảng trạng thái và thiết lập.
BEGIN;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'aka-agent-ai-chat-answer-fire';
DROP FUNCTION IF EXISTS public.aka_agent_ai_chat_answer_fire_tick_v1();
DROP TABLE IF EXISTS private.ai_chat_answer_fire_state;
DELETE FROM public.auto_system_settings WHERE key = 'ai_chat.answer_fire';
COMMIT;

-- Rollback V488 (Hỏi đáp AI). XÓA toàn bộ hội thoại/câu hỏi/câu trả lời đã lưu: chỉ chạy khi chấp nhận mất dữ liệu đó.
-- Tắt nhanh không mất dữ liệu: UPDATE public.auto_system_settings SET value = 'false' WHERE key = 'ai_chat.enabled';
-- DDL ⇒ PostgREST nạp lại schema: chạy ngoài giờ cao điểm, sau khi API/Web/Desktop đã ngừng gọi RPC ai_chat.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $v488_rollback_preflight$
BEGIN
  IF to_regclass('public.ai_message') IS NULL OR to_regprocedure('public.aka_agent_ai_chat_worker(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'v488 rollback: V488 objects not found';
  END IF;
END
$v488_rollback_preflight$;

DROP FUNCTION public.aka_agent_ai_chat_worker(text, jsonb);
DROP FUNCTION public.aka_agent_ai_chat(bigint, bigint, text, text, text, jsonb);
DROP FUNCTION public.aka_agent_control_ai_chat(bigint, bigint, text, text, jsonb, uuid);
DROP FUNCTION private.aka_agent_ai_chat(bigint, bigint, text, text, jsonb);
DROP FUNCTION private.aka_agent_ai_chat_expire(bigint, bigint);
DROP FUNCTION private.aka_agent_ai_chat_snapshot(bigint, bigint, integer);
DROP FUNCTION private.aka_agent_ai_chat_thread_json(public.ai_message_thread);
DROP FUNCTION private.aka_agent_ai_chat_message_json(public.ai_message);
DROP FUNCTION private.aka_agent_ai_chat_project_json(public.ai_project);
DROP FUNCTION private.aka_agent_ai_chat_int(jsonb, integer, integer, integer);
DROP FUNCTION private.aka_agent_ai_chat_id(jsonb);
DROP FUNCTION private.aka_agent_ai_chat_uuid(text);
DROP FUNCTION private.aka_agent_ai_chat_int_setting(text, integer, integer);
DROP FUNCTION private.aka_agent_ai_chat_setting(text, text);
DROP FUNCTION private.aka_agent_ai_chat_active();
DROP TABLE public.ai_message;
DROP TABLE public.ai_message_thread;
DROP TABLE public.ai_project;
DROP TABLE public.ai_project_group;
DELETE FROM public.auto_system_settings WHERE key IN ('ai_chat.enabled', 'ai_chat.max_pending_per_staff', 'ai_chat.max_questions_per_staff_per_day');

DO $v488_rollback_postcheck$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'private') AND p.proname LIKE 'aka_agent%ai_chat%')
     OR EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key LIKE 'ai_chat.%') THEN
    RAISE EXCEPTION 'v488 rollback: objects left behind';
  END IF;
END
$v488_rollback_postcheck$;

COMMIT;

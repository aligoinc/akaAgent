-- Rollback V492: gỡ hàm chèn câu hỏi nội bộ. Đường /ask của Edge Function ai-chat-agent trả 503 ai_chat_not_ready
-- ngay sau đó; /list, /start, /answer, /status và app Web/iOS/Desktop không dùng hàm này nên không đổi.
-- Hội thoại và câu hỏi đã chèn qua /ask được giữ nguyên (chúng là dòng bình thường của V488).
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP FUNCTION IF EXISTS public.aka_agent_ai_chat_insert(jsonb);
DO $v492_rollback_postcheck$
BEGIN
  IF to_regprocedure('public.aka_agent_ai_chat_insert(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'v492_rollback: function still present';
  END IF;
  IF to_regprocedure('private.aka_agent_ai_chat(bigint,bigint,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.aka_agent_ai_chat_worker(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'v492_rollback: V488 functions missing';
  END IF;
END
$v492_rollback_postcheck$;
COMMIT;

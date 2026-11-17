-- Gỡ V556 phần 1: xoá job dọn ảnh lỗi, 11 hàm, view, 5 bảng (kèm danh mục, yêu cầu và ảnh lỗi) và 4 dòng thiết lập.
-- Phải gỡ V558 / V559 (đọc các bảng và hàm này) và phần 2 trước. Bản Desktop đã phát hành có engine Facebook gọi các hàm này thì
-- nhận lỗi "hàm không tồn tại" và chạy bộ cũ (thiết lập tắt = bộ cũ).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('public.auto_engine_block_steps') IS NULL THEN RAISE EXCEPTION 'Gỡ V556 phần 1: chưa apply phần 1'; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
              AND attname = 'streak_after_delivery' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Gỡ V556 phần 1: gỡ phần 2 trước (rollback_v556_engine_facebook_p2.sql)';
  END IF;
END $pre$;

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-desktop-diagnostics-cleanup') THEN
      PERFORM cron.unschedule('aka-agent-desktop-diagnostics-cleanup');
    END IF;
  END IF;
END $cron$;

DROP FUNCTION public.aka_agent_desktop_diagnostic_cleanup_v1();
DROP FUNCTION public.aka_agent_desktop_diagnostic_files_v1(bigint);
DROP FUNCTION public.aka_agent_desktop_diagnostic_request_v1(bigint, jsonb, text);
DROP FUNCTION public.aka_agent_desktop_diagnostic_complete_v1(bigint, jsonb);
DROP FUNCTION public.aka_agent_desktop_diagnostic_upload_v1(bigint, uuid, jsonb, text);
DROP FUNCTION public.aka_agent_desktop_diagnostic_next_v1();
DROP FUNCTION public.aka_agent_device_presence_v2(text, text, uuid, jsonb, boolean);
DROP FUNCTION public.aka_agent_engine_health_v1(integer);
DROP FUNCTION public.aka_agent_engine_trace_v1(bigint, bigint, integer);
DROP FUNCTION public.aka_agent_engine_facebook_enabled_v1();
DROP FUNCTION public.aka_agent_engine_facebook_org_enabled(bigint);
DROP VIEW public.aka_agent_engine_block_copy_drift;
DROP TABLE public.auto_desktop_diagnostic_files;
DROP TABLE public.auto_desktop_diagnostic_requests;
DROP TABLE public.auto_engine_block_copies;
DROP TABLE public.auto_engine_workflows;
DROP TABLE public.auto_engine_block_steps;
DELETE FROM public.auto_system_settings
 WHERE key IN ('engine.facebook', 'facebook.max_comments', 'facebook.block_hang_minutes', 'campaign.wait_note_minutes');

COMMIT;

-- Gỡ V574 (bộ tạo việc kiểm lỗi chiến dịch Facebook cho Claude Code). SỐ TẠM, xem migration_v574_engine_error_watch.sql.
-- Xoá job, hàm, ba bảng sổ ca lỗi và thiết lập. Sổ ca lỗi mất hẳn (dựng lại được từ auto_engine_outcomes trong 30 ngày giữ dữ liệu).
-- Agent và nhóm agent: xoá nếu chưa có hội thoại nào; đã có hội thoại thì chỉ tắt (is_active = false) để giữ lịch sử báo cáo.
-- Yêu cầu ảnh đã tạo (auto_desktop_diagnostic_requests, requested_by = 'error-watch') để nguyên, job dọn của V556 tự xoá sau 7 ngày.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regprocedure('public.aka_agent_engine_error_watch_tick_v1()') IS NULL OR to_regclass('private.auto_engine_error_cases') IS NULL THEN
    RAISE EXCEPTION 'Gỡ V574: chưa thấy hàm tick hoặc bảng sổ ca lỗi, không có gì để gỡ';
  END IF;
END $pre$;

DO $cron$
BEGIN
  -- IF lồng: câu đọc cron.job chỉ được phân tích khi pg_cron có cài.
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'aka-agent-engine-error-watch') THEN
      PERFORM cron.unschedule('aka-agent-engine-error-watch');
    END IF;
  END IF;
END $cron$;

DROP FUNCTION public.aka_agent_engine_error_watch_tick_v1();
DROP FUNCTION private.aka_agent_engine_error_num(text, numeric);
DROP FUNCTION private.aka_agent_engine_error_pattern(text);
DROP TABLE private.auto_engine_error_cases;
DROP TABLE private.auto_engine_error_hourly;
DROP TABLE private.auto_engine_error_watch_state;
DELETE FROM public.auto_system_settings WHERE key = 'engine.error_watch';

DO $agent$
DECLARE v_project bigint; v_group bigint;
BEGIN
  SELECT p.id, p.group_id INTO v_project, v_group FROM public.ai_project p WHERE p.code = 'kiem-loi-chien-dich-facebook';
  IF v_project IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.ai_message_thread t WHERE t.project_id = v_project) THEN
      UPDATE public.ai_project SET is_active = false, audience = 'off', version = version + 1, updated_at = now() WHERE id = v_project;
      UPDATE public.ai_project_group SET is_active = false, updated_at = now() WHERE id = v_group AND code = 'van-hanh-noi-bo';
      RAISE NOTICE 'Gỡ V574: agent đã có hội thoại nên chỉ tắt, không xoá';
    ELSE
      DELETE FROM public.ai_project WHERE id = v_project;
      DELETE FROM public.ai_project_group g WHERE g.code = 'van-hanh-noi-bo' AND NOT EXISTS (SELECT 1 FROM public.ai_project p WHERE p.group_id = g.id);
    END IF;
  END IF;
END $agent$;

DO $post$
BEGIN
  IF to_regprocedure('public.aka_agent_engine_error_watch_tick_v1()') IS NOT NULL OR to_regclass('private.auto_engine_error_cases') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.auto_system_settings s WHERE s.key = 'engine.error_watch') THEN
    RAISE EXCEPTION 'Gỡ V574: còn sót đối tượng';
  END IF;
END $post$;

COMMIT;

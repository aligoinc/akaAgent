-- Rollback V473 (Quy trình tự động trên Web). Candidate, production cgjbsmqtfhqvttudyjzq only.
-- Gỡ hai RPC, mọi hàm phụ private.aka_agent_journey_*, 11 bảng auto_journey* (kèm toàn bộ dữ liệu quy trình,
-- khách trong quy trình, dòng thời gian, bộ đếm, việc cần làm) và hai dòng cài đặt journeys.engine_enabled / web.journeys.
-- V473 không đổi bảng, index, hàm hay quyền có sẵn nên không có gì khác cần khôi phục.
-- Không đụng chiến dịch "[Quy trình] …" do quy trình đã tạo (bảng auto_campaigns) và các dòng mục tiêu đã chèn:
-- chúng là chiến dịch thường; tạm dừng/xóa bằng lệnh chiến dịch hiện có nếu cần (danh sách campaign_id lấy từ
-- auto_journey_step_campaigns TRƯỚC khi chạy file này).
-- Trước khi rollback: tắt bộ máy bằng journeys.engine_enabled = {"enabled":false} hoặc dừng API, để nhịp đang
-- chạy không gọi RPC đã bị xóa.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $drop_functions$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'public' AND p.proname IN ('aka_agent_journey_control', 'aka_agent_journey_engine'))
       OR (n.nspname = 'private' AND p.proname LIKE 'aka\_agent\_journey\_%')
    ORDER BY CASE WHEN n.nspname = 'public' THEN 0 ELSE 1 END, p.proname
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', v_fn);
  END LOOP;
END
$drop_functions$;

ALTER TABLE IF EXISTS public.auto_journeys DROP CONSTRAINT IF EXISTS auto_journeys_active_version_fk;
DROP TABLE IF EXISTS public.auto_journey_tasks;
DROP TABLE IF EXISTS public.auto_journey_events;
DROP TABLE IF EXISTS public.auto_journey_step_runs;
DROP TABLE IF EXISTS public.auto_journey_step_stats;
DROP TABLE IF EXISTS public.auto_journey_enrollments;
DROP TABLE IF EXISTS public.auto_journey_step_campaigns;
DROP TABLE IF EXISTS public.auto_journey_marks;
DROP TABLE IF EXISTS public.auto_journey_sources;
DROP TABLE IF EXISTS public.auto_journey_versions;
DROP TABLE IF EXISTS public.auto_journey_engine_state;
DROP TABLE IF EXISTS public.auto_journeys;

DELETE FROM public.auto_system_settings WHERE key IN ('journeys.engine_enabled', 'web.journeys');

DO $postflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN ('public', 'private') AND p.proname LIKE 'aka\_agent\_journey\_%')
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname LIKE 'auto\_journey%') THEN
    RAISE EXCEPTION 'v473_rollback_incomplete';
  END IF;
END
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;

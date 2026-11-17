-- V556: "Lặp lại sau khi chạy xong" cho chiến dịch lịch Hàng ngày (17/11/2026).
-- SINH TỪ scripts/build-v556-sql.cjs, không sửa tay. Hợp đồng: docs/CAMPAIGN_REPEAT_V556.md; phương án: akaAgentWebApp
-- docs/CAMPAIGN_REPEAT_PLAN.md.
--
-- Chiến dịch chạy hết danh sách thì tự chạy lại sau x phút / giờ / ngày (tính từ lúc chạy xong), tới khi đủ số lượt tối đa hoặc tới
-- ngày kết thúc. Cài đặt nằm ở auto_campaigns.extra_settings: repeatAfterCompletionEnabled / Every / Unit / MaxRuns; ngày kết thúc
-- ở schedule_end_date. Chưa chiến dịch nào có các khoá này nên apply xong chưa đổi hành vi của chiến dịch nào.
-- Hai phần, apply đúng thứ tự p1 → p2, mỗi phần một giao dịch và một dòng trong sổ migration:
--   p1: thêm hai cột vào public.auto_campaigns (không tạo bảng mới):
--         repeat_runs_done integer NOT NULL DEFAULT 0   số lượt đã chạy xong, tính cả lượt đầu;
--         repeat_log jsonb                               nhật ký, mỗi lần đếm một dòng (NULL = chưa từng bật lặp).
--       Chỉ có hai lệnh ALTER nên khoá bảng trong chốc lát; lock_timeout 3 giây, không viết lại bảng.
--   p2: hàm private.aka_agent_campaign_repeat_* (luật lặp) và bốn RPC public: sync_v1, decide_v1, state_v1 (service_role +
--       aka_agent_desktop), tick_v1 (service_role);
--       aka_agent_engine_finish_campaign_v2 (thân V506, md5 khoá cứng): thêm nhánh 5b gọi luật lặp trước khi hoàn thành;
--       private.aka_agent_notification_capture_campaign (thân V475, md5 khoá cứng): lượt giữa không báo "hoàn thành";
--       auto_system_settings 'campaign.repeat_after_completion' = {"audience":"admin_akabiz","sweeper":true} (off | admin_akabiz | all;
--       "sweeper": false tắt khẩn bộ quét).
-- ALTER TABLE và CREATE FUNCTION làm PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm.
-- Gỡ: rollback_v556_campaign_repeat_after_completion.sql.
-- PHẦN 1/2: hai cột đếm lượt.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v556_%_p1') THEN
      RAISE EXCEPTION 'V556 p1 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass AND attname IN ('repeat_runs_done', 'repeat_log')
              AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V556 p1: cột đếm lượt đã có';
  END IF;
END $pre$;

ALTER TABLE public.auto_campaigns
  ADD COLUMN repeat_runs_done integer NOT NULL DEFAULT 0,
  ADD COLUMN repeat_log jsonb;
COMMENT ON COLUMN public.auto_campaigns.repeat_runs_done IS
  'V556 "Lặp lại sau khi chạy xong": số lượt đã chạy xong trong vòng lặp hiện tại, tính cả lượt đầu. Chỉ hàm private.aka_agent_campaign_repeat_* ghi.';
COMMENT ON COLUMN public.auto_campaigns.repeat_log IS
  'V556 "Lặp lại sau khi chạy xong": nhật ký đếm lượt, mảng JSON tối đa 120 dòng {type: arm|run|end|error|skip|off, at, ...}. NULL = chưa từng bật lặp. Chỉ hàm private.aka_agent_campaign_repeat_* ghi.';

DO $post$
DECLARE v_bad text;
BEGIN
  -- App Desktop không tự sửa được bộ đếm: role aka_agent_desktop chỉ có quyền UPDATE theo danh sách cột, hai cột mới không nằm trong
  -- đó (kiểm production 17/11/2026). Backend (service_role, aka_agent_chat_api) có quyền cả bảng như mọi cột khác.
  SELECT string_agg(r.rolname || '.' || a.col, ', ') INTO v_bad
    FROM pg_roles r CROSS JOIN unnest(ARRAY['repeat_runs_done', 'repeat_log']) AS a(col)
   WHERE r.rolname = 'aka_agent_desktop'
     AND has_column_privilege(r.rolname, 'public.auto_campaigns', a.col, 'UPDATE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V556 p1 postflight: app Desktop sửa được cột đếm lượt: %', v_bad; END IF;
END $post$;

COMMIT;

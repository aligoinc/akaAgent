-- V557 phần 1: lượt theo lịch của engine v2 (trang cá nhân, newsfeed Facebook: không có dòng data; anh chốt Q4, anh duyệt schema A1 /
-- S2 ngày 16/11/2026 tối, docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_SCHEMA.md).
--   auto_engine_target_runs: thêm slot_at (mốc lịch của chiến dịch lúc nhận lượt), input_data_id bỏ NOT NULL, ràng buộc mỗi lượt có đúng
--     một trong hai (thêm NOT VALID, phần 3 VALIDATE riêng để không quét bảng dưới khoá ACCESS EXCLUSIVE);
--   auto_engine_outcomes, auto_engine_target_events: input_data_id bỏ NOT NULL (lượt theo lịch không có data).
-- Chỉ đổi metadata, không viết lại bảng. Mọi dòng hiện có giữ input_data_id, slot_at NULL; chưa hàm nào ghi slot_at (V558 mới ghi), nên
-- engine Zalo không đổi hành vi. Ba bảng này engine Zalo đang ghi liên tục: một giao dịch ngắn, khoá theo đúng thứ tự report_v1 khoá
-- (lượt → kết quả → sự kiện) để không chéo khoá, lock_timeout 2 giây (bận thì dừng, chạy lại sau). Apply ngoài giờ cao điểm.
-- Sau phần này: phần 2 (hai chỉ mục CONCURRENTLY, mỗi lệnh chạy riêng, không trong giao dịch), rồi phần 3.
-- Gỡ: rollback_v557_engine_slot_runs.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v557_%') THEN
      RAISE EXCEPTION 'V557 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_engine_target_runs'::regclass AND attname = 'slot_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V557: cột slot_at đã có';
  END IF;
  IF NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.auto_engine_target_runs'::regclass AND attname = 'input_data_id')
     OR NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.auto_engine_outcomes'::regclass AND attname = 'input_data_id')
     OR NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.auto_engine_target_events'::regclass AND attname = 'input_data_id') THEN
    RAISE EXCEPTION 'V557: input_data_id của bảng engine khác bản V495 (đã bỏ NOT NULL?)';
  END IF;
END $pre$;

ALTER TABLE public.auto_engine_target_runs
  ADD COLUMN slot_at timestamptz,
  ALTER COLUMN input_data_id DROP NOT NULL,
  ADD CONSTRAINT auto_engine_target_runs_target_or_slot_v557 CHECK ((input_data_id IS NULL) <> (slot_at IS NULL)) NOT VALID;
ALTER TABLE public.auto_engine_outcomes ALTER COLUMN input_data_id DROP NOT NULL;
ALTER TABLE public.auto_engine_target_events ALTER COLUMN input_data_id DROP NOT NULL;

COMMENT ON COLUMN public.auto_engine_target_runs.slot_at IS
  'V557: lượt theo lịch (loại chiến dịch không có dòng data: trang cá nhân, newsfeed Facebook): lịch của chiến dịch lúc nhận lượt; mỗi mốc lịch chạy một lượt. Lượt theo data thì NULL. Mỗi lượt có đúng một trong input_data_id / slot_at.';

DO $post$
BEGIN
  IF (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.auto_engine_target_runs'::regclass AND attname = 'input_data_id')
     OR (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.auto_engine_outcomes'::regclass AND attname = 'input_data_id')
     OR (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.auto_engine_target_events'::regclass AND attname = 'input_data_id') THEN
    RAISE EXCEPTION 'V557 postflight: input_data_id vẫn NOT NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.auto_engine_target_runs'::regclass
                  AND conname = 'auto_engine_target_runs_target_or_slot_v557' AND NOT convalidated) THEN
    RAISE EXCEPTION 'V557 postflight: thiếu ràng buộc data / mốc lịch (NOT VALID)';
  END IF;
END $post$;

COMMIT;

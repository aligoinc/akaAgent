-- Gỡ V557 (lượt theo lịch). Phải gỡ V558 trước (claim / report / finish ghi slot_at) và không còn lượt theo lịch nào (lượt theo lịch là
-- dữ liệu của loại chiến dịch trang cá nhân / newsfeed chạy bằng engine: xoá thì mất dòng thời gian của các lượt đó; dừng nếu còn).
-- Trả NOT NULL mà không quét bảng dưới khoá ACCESS EXCLUSIVE: thêm CHECK (… IS NOT NULL) NOT VALID, VALIDATE (khoá nhẹ), rồi SET NOT NULL
-- (PostgreSQL dùng ràng buộc đã kiểm, không quét lại), xoá CHECK tạm. Chỉ mục CONCURRENTLY phải xoá bằng hai lệnh riêng TRƯỚC file này:
--   DROP INDEX CONCURRENTLY IF EXISTS public.auto_engine_target_runs_slot_open_v557;
--   DROP INDEX CONCURRENTLY IF EXISTS public.auto_engine_target_runs_slot_v557;
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '120s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_engine_target_runs'::regclass AND attname = 'slot_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Gỡ V557: chưa apply V557';
  END IF;
  IF to_regclass('public.auto_engine_target_runs_slot_open_v557') IS NOT NULL OR to_regclass('public.auto_engine_target_runs_slot_v557') IS NOT NULL THEN
    RAISE EXCEPTION 'Gỡ V557: xoá hai chỉ mục CONCURRENTLY trước (xem đầu file)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs WHERE slot_at IS NOT NULL OR input_data_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.auto_engine_outcomes WHERE input_data_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.auto_engine_target_events WHERE input_data_id IS NULL) THEN
    RAISE EXCEPTION 'Gỡ V557: còn lượt theo lịch / kết quả / sự kiện không có data';
  END IF;
END $pre$;

ALTER TABLE public.auto_engine_target_runs DROP CONSTRAINT auto_engine_target_runs_target_or_slot_v557;
ALTER TABLE public.auto_engine_target_runs ADD CONSTRAINT auto_engine_target_runs_input_nn_tmp CHECK (input_data_id IS NOT NULL) NOT VALID;
ALTER TABLE public.auto_engine_outcomes ADD CONSTRAINT auto_engine_outcomes_input_nn_tmp CHECK (input_data_id IS NOT NULL) NOT VALID;
ALTER TABLE public.auto_engine_target_events ADD CONSTRAINT auto_engine_target_events_input_nn_tmp CHECK (input_data_id IS NOT NULL) NOT VALID;
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '300s';
ALTER TABLE public.auto_engine_target_runs VALIDATE CONSTRAINT auto_engine_target_runs_input_nn_tmp;
ALTER TABLE public.auto_engine_outcomes VALIDATE CONSTRAINT auto_engine_outcomes_input_nn_tmp;
ALTER TABLE public.auto_engine_target_events VALIDATE CONSTRAINT auto_engine_target_events_input_nn_tmp;
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE public.auto_engine_target_runs ALTER COLUMN input_data_id SET NOT NULL, DROP CONSTRAINT auto_engine_target_runs_input_nn_tmp, DROP COLUMN slot_at;
ALTER TABLE public.auto_engine_outcomes ALTER COLUMN input_data_id SET NOT NULL, DROP CONSTRAINT auto_engine_outcomes_input_nn_tmp;
ALTER TABLE public.auto_engine_target_events ALTER COLUMN input_data_id SET NOT NULL, DROP CONSTRAINT auto_engine_target_events_input_nn_tmp;
COMMIT;

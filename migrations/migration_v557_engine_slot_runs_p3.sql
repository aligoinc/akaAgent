-- V557 phần 3: kiểm ràng buộc data / mốc lịch trên các dòng cũ (VALIDATE chỉ giữ khoá SHARE UPDATE EXCLUSIVE: không chặn đọc / ghi)
-- và hậu kiểm hai chỉ mục của phần 2. Chạy sau phần 1, 2a, 2b.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '120s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.auto_engine_target_runs'::regclass
                  AND conname = 'auto_engine_target_runs_target_or_slot_v557') THEN
    RAISE EXCEPTION 'V557 phần 3: chưa chạy phần 1';
  END IF;
  IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname IN ('auto_engine_target_runs_slot_open_v557', 'auto_engine_target_runs_slot_v557') AND i.indisvalid AND i.indisready) <> 2 THEN
    RAISE EXCEPTION 'V557 phần 3: chưa có đủ hai chỉ mục hợp lệ của phần 2 (chỉ mục INVALID thì DROP INDEX CONCURRENTLY rồi dựng lại)';
  END IF;
END $pre$;

ALTER TABLE public.auto_engine_target_runs VALIDATE CONSTRAINT auto_engine_target_runs_target_or_slot_v557;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.auto_engine_target_runs'::regclass
                  AND conname = 'auto_engine_target_runs_target_or_slot_v557' AND convalidated) THEN
    RAISE EXCEPTION 'V557 phần 3 postflight: ràng buộc chưa được kiểm';
  END IF;
END $post$;

COMMIT;

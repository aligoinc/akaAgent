-- Gỡ V556 phần 2: trả ràng buộc detail_mode về bản V495, xoá cột streak_after_delivery. Phải gỡ V558 / V559 (đọc / ghi hai thứ này)
-- trước; còn dòng chính sách dùng chúng thì dừng.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
                  AND attname = 'streak_after_delivery' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Gỡ V556 phần 2: chưa apply phần 2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE detail_mode = 'inherit' OR streak_after_delivery IS NOT NULL) THEN
    RAISE EXCEPTION 'Gỡ V556 phần 2: còn chính sách dùng detail_mode = inherit / streak_after_delivery (gỡ V559 trước)';
  END IF;
END $pre$;

ALTER TABLE public.auto_outcome_policies
  DROP CONSTRAINT auto_outcome_policies_detail_mode_check,
  ADD CONSTRAINT auto_outcome_policies_detail_mode_check CHECK (detail_mode IN ('write', 'suppress')),
  DROP COLUMN streak_after_delivery;
COMMENT ON COLUMN public.auto_outcome_policies.detail_mode IS NULL;

COMMIT;

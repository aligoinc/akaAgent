-- V556 phần 2: auto_outcome_policies cho chính sách Facebook giữ đúng cách tính của bộ cũ (anh duyệt 16/11/2026 tối, mục A2 của
-- docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_SCHEMA.md):
--   - detail_mode thêm giá trị 'inherit': trạng thái dòng lịch sử lấy theo kết quả gửi lên (statusCode block trả, như bộ cũ ghi theo
--     actionResult.statusCode), rồi các trường đếm còn NULL lấy theo chính sách của chính trạng thái đó;
--   - cột streak_after_delivery ('count' / 'ignore', NULL = kế thừa, mặc định count): bộ cũ không cộng chuỗi data lỗi cho comment lỗi khi
--     data đã có kết quả gửi thành công (actionResultRuntime.ts:160-161, targetOnlyFailure).
-- Chưa hàm nào đọc hai thứ này (V558 mới đọc); mọi dòng hiện có giữ nguyên (cột mới NULL), nên không đổi hành vi.
--
-- Giao dịch riêng, chỉ vài mili giây: ALTER giữ khoá ACCESS EXCLUSIVE của bảng mà report_v1 đọc mỗi lần báo kết quả (bài học V495:
-- ALTER chung giao dịch dài làm app quá giờ). lock_timeout 2 giây: bận thì dừng, chạy lại sau. Phải chạy SAU phần 1.
-- Gỡ: rollback_v556_engine_facebook_p2.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v556_engine_facebook_p2') THEN
      RAISE EXCEPTION 'V556 phần 2 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_steps') IS NULL THEN
    RAISE EXCEPTION 'V556 phần 2: chưa chạy phần 1';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.auto_outcome_policies'::regclass AND conname = 'auto_outcome_policies_detail_mode_check')
     IS DISTINCT FROM 'CHECK ((detail_mode = ANY (ARRAY[''write''::text, ''suppress''::text])))' THEN
    RAISE EXCEPTION 'V556 phần 2: ràng buộc detail_mode khác bản V495';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
              AND attname = 'streak_after_delivery' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V556 phần 2: cột streak_after_delivery đã có';
  END IF;
END $pre$;

ALTER TABLE public.auto_outcome_policies
  DROP CONSTRAINT auto_outcome_policies_detail_mode_check,
  ADD CONSTRAINT auto_outcome_policies_detail_mode_check CHECK (detail_mode IN ('write', 'suppress', 'inherit')),
  ADD COLUMN streak_after_delivery text
    CONSTRAINT auto_outcome_policies_streak_after_delivery_v556_check CHECK (streak_after_delivery IS NULL OR streak_after_delivery IN ('count', 'ignore'));

COMMENT ON COLUMN public.auto_outcome_policies.detail_mode IS
  'write = ghi dòng lịch sử theo detail_status_id; suppress = không ghi; inherit (V556) = ghi theo trạng thái của kết quả gửi lên (block trả), các trường đếm NULL lấy theo chính sách của trạng thái đó. NULL = kế thừa.';
COMMENT ON COLUMN public.auto_outcome_policies.streak_after_delivery IS
  'V556: kết quả lỗi khi data đã có kết quả gửi thành công: count = cộng chuỗi data lỗi như thường, ignore = không cộng (bộ cũ: comment Facebook). NULL = kế thừa, mặc định count.';

DO $post$
BEGIN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.auto_outcome_policies'::regclass AND conname = 'auto_outcome_policies_detail_mode_check')
     IS DISTINCT FROM 'CHECK ((detail_mode = ANY (ARRAY[''write''::text, ''suppress''::text, ''inherit''::text])))' THEN
    RAISE EXCEPTION 'V556 phần 2 postflight: ràng buộc detail_mode sai';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE streak_after_delivery IS NOT NULL OR detail_mode = 'inherit') THEN
    RAISE EXCEPTION 'V556 phần 2 postflight: dòng cũ không được đổi';
  END IF;
END $post$;

COMMIT;

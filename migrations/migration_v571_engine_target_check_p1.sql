-- V571 phần 1: cột kiểm người nhận trên toàn hệ thống ở auto_outcome_policies. SINH TỪ scripts/build-v571-sql.cjs, không sửa tay.
-- Thêm target_check_enabled (NULL = không kiểm; false = chỉ theo dõi, xem số đo; true = engine bỏ qua bước khi người nhận đã biết hỏng) và
-- target_check_days (số ngày xét, 1–3650), rồi bật 3 dòng anh duyệt 18/11/2026 (365 ngày):
--   zalo_find_phone_user × err_zalo_user_not_found
--   zalo_find_phone_user × err_zalo_219_find_phone_invalid
--   zalo_message_stranger × err_zalo_receiver_blocks_stranger_message
-- Chưa có tác dụng tới khi apply phần 2 và bật engine.target_check. Bảng danh mục engine đọc mỗi lần báo kết quả: giao dịch riêng, vài
-- mili giây; DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v571_engine_target_check_p1.sql (sau khi gỡ phần 2).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v571_%') THEN
      RAISE EXCEPTION 'V571 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
              AND attname IN ('target_check_enabled', 'target_check_days') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V571 p1: cột target_check đã có';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies p
   WHERE p.is_active AND NOT p.is_delete AND p.status_id IS NULL AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL
     AND (p.error_code, p.action_code) IN (('err_zalo_user_not_found', 'zalo_find_phone_user'), ('err_zalo_219_find_phone_invalid', 'zalo_find_phone_user'), ('err_zalo_receiver_blocks_stranger_message', 'zalo_message_stranger'));
  IF v_n <> 3 THEN RAISE EXCEPTION 'V571 p1: cần đúng 3 dòng chính sách (mã × thao tác), thấy %', v_n; END IF;
END $pre$;

ALTER TABLE public.auto_outcome_policies
  ADD COLUMN target_check_enabled boolean,
  ADD COLUMN target_check_days integer,
  ADD CONSTRAINT auto_outcome_policies_target_check_v571 CHECK (
    (target_check_enabled IS NULL AND target_check_days IS NULL)
    OR (target_check_enabled IS NOT NULL AND target_check_days IS NOT NULL AND target_check_days BETWEEN 1 AND 3650
        AND error_code IS NOT NULL AND action_code IS NOT NULL AND status_id IS NULL AND campaign_action_id IS NULL AND runtime_target IS NULL));
COMMENT ON COLUMN public.auto_outcome_policies.target_check_enabled IS
  'V571: kiểm người nhận trên toàn hệ thống cho (error_code × action_code) của dòng này. NULL = không kiểm; false = chỉ theo dõi (xem số đo); true = engine v2 bỏ qua bước khi người nhận (SĐT / global id) đã hỏng với mã này trong target_check_days ngày và chưa thành công lại. Mã Zalo "thuộc về người nhận" của Tìm SĐT / Nhắn tin người lạ / Kết bạn đã được theo dõi sẵn nên bật có hiệu lực ngay. Bật cả hệ thống: auto_system_settings engine.target_check.';
COMMENT ON COLUMN public.auto_outcome_policies.target_check_days IS
  'V571: số ngày xét lần hỏng của người nhận (1–3650); bắt buộc khi target_check_enabled khác NULL.';

DO $set$
DECLARE v_n integer;
BEGIN
  UPDATE public.auto_outcome_policies p SET target_check_enabled = true, target_check_days = 365
   WHERE p.is_active AND NOT p.is_delete AND p.status_id IS NULL AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL
     AND (p.error_code, p.action_code) IN (('err_zalo_user_not_found', 'zalo_find_phone_user'), ('err_zalo_219_find_phone_invalid', 'zalo_find_phone_user'), ('err_zalo_receiver_blocks_stranger_message', 'zalo_message_stranger'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 3 THEN RAISE EXCEPTION 'V571 p1: bật được % dòng, cần 3', v_n; END IF;
END $set$;

COMMIT;

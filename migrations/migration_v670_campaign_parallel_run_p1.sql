-- V670 p1: "Chạy cùng lúc", cột akaBiz bật theo loại chiến dịch. SINH TỪ scripts/build-v670-sql.cjs, không sửa tay.
-- Thêm auto_campaign_actions.allow_parallel_run (mặc định false; khách không sửa), bật cho zalo_cancel_sent_friend_request, zalo_add_group_member, zalo_join_group_link.
-- Giao dịch riêng, ngắn: ALTER bảng danh mục giữ khoá tới hết giao dịch. Gỡ: rollback_v670_campaign_parallel_run.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v670_campaign_parallel_run_p1') THEN
      RAISE EXCEPTION 'migration_v670_campaign_parallel_run_p1 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_campaign_actions'::regclass AND attname = 'allow_parallel_run' AND NOT attisdropped) THEN RAISE EXCEPTION 'V670 p1 đã chạy (allow_parallel_run đã có)'; END IF;
  IF (SELECT count(*) FROM public.auto_campaign_actions WHERE id IN ('zalo_cancel_sent_friend_request', 'zalo_add_group_member', 'zalo_join_group_link')) <> 3 THEN
    RAISE EXCEPTION 'V670 p1: thiếu loại chiến dịch cần bật';
  END IF;
END $pre$;

ALTER TABLE public.auto_campaign_actions ADD COLUMN allow_parallel_run boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.auto_campaign_actions.allow_parallel_run IS
  'Chạy cùng lúc (V670): akaBiz bật thì khách tích được "Chạy cùng lúc" cho loại này; chiến dịch có tích chạy ở làn riêng của loại, mỗi tài khoản mỗi loại một chiến dịch. Khách không sửa.';
UPDATE public.auto_campaign_actions SET allow_parallel_run = true
 WHERE id IN ('zalo_cancel_sent_friend_request', 'zalo_add_group_member', 'zalo_join_group_link');

DO $post$
BEGIN
  IF (SELECT count(*) FROM public.auto_campaign_actions WHERE allow_parallel_run) <> 3 THEN
    RAISE EXCEPTION 'V670 p1 postflight: số loại bật khác 3';
  END IF;
END $post$;
COMMIT;

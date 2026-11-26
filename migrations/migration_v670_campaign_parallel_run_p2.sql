-- V670 p2: "Chạy cùng lúc", cột khách tích trên chiến dịch. SINH TỪ scripts/build-v670-sql.cjs, không sửa tay.
-- Thêm auto_campaigns.parallel_run_enabled (mặc định false: mọi chiến dịch đang có chạy như cũ) và quyền ghi theo cột cho Desktop (V435).
-- Cột riêng thay vì extra_settings: form Desktop đang phát hành dựng lại extra_settings mỗi lần lưu, khoá mới sẽ bị xoá mà không báo.
-- Giao dịch riêng, ngắn (bảng nóng). Cần p1. Gỡ: rollback_v670_campaign_parallel_run.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v670_campaign_parallel_run_p2') THEN
      RAISE EXCEPTION 'migration_v670_campaign_parallel_run_p2 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_campaign_actions'::regclass AND attname = 'allow_parallel_run' AND NOT attisdropped) THEN RAISE EXCEPTION 'V670 p2: chạy p1 trước'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass AND attname = 'parallel_run_enabled' AND NOT attisdropped) THEN RAISE EXCEPTION 'V670 p2 đã chạy (parallel_run_enabled đã có)'; END IF;
END $pre$;

ALTER TABLE public.auto_campaigns ADD COLUMN parallel_run_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.auto_campaigns.parallel_run_enabled IS
  'Chạy cùng lúc (V670): khách tích ở form; chỉ có hiệu lực khi loại có allow_parallel_run và chiến dịch chạy bằng engine v2 (tài khoản Zalo).';
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT INSERT (parallel_run_enabled), UPDATE (parallel_run_enabled) ON public.auto_campaigns TO aka_agent_desktop;
  END IF;
END $grant$;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass AND attname = 'parallel_run_enabled' AND NOT attisdropped) THEN RAISE EXCEPTION 'V670 p2 postflight: thiếu cột'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop')
     AND NOT (has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'parallel_run_enabled', 'UPDATE')
              AND has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'parallel_run_enabled', 'INSERT')) THEN
    RAISE EXCEPTION 'V670 p2 postflight: Desktop chưa có quyền ghi cột';
  END IF;
END $post$;
COMMIT;

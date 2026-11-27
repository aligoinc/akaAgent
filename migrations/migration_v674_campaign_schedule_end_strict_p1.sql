-- V674 p1: "Đặt ngày kết thúc" dừng chiến dịch đúng ngày, cột khách chọn. SINH TỪ scripts/build-v674-sql.cjs, không sửa tay.
-- Thêm auto_campaigns.schedule_end_strict (mặc định false: mọi chiến dịch đang có chạy như cũ) và quyền ghi theo cột cho Desktop (V435).
-- Giao dịch riêng, ngắn: ALTER giữ khoá bảng nóng tới hết giao dịch. Chưa có p2 thì cột chưa có tác dụng. Gỡ: rollback_v674_campaign_schedule_end_strict.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v674_campaign_schedule_end_strict_p1') THEN
      RAISE EXCEPTION 'migration_v674_campaign_schedule_end_strict_p1 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass AND attname = 'schedule_end_strict' AND NOT attisdropped) THEN RAISE EXCEPTION 'V674 p1 đã chạy (schedule_end_strict đã có)'; END IF;
END $pre$;

ALTER TABLE public.auto_campaigns ADD COLUMN schedule_end_strict boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.auto_campaigns.schedule_end_strict IS
  'Đặt ngày kết thúc (V674): true = khách chủ động đặt ngày kết thúc trên form mới, hết schedule_end_date chiến dịch hoàn thành kể cả còn data chờ. false = chiến dịch cũ, ngày kết thúc chỉ ngừng làm mới data.';
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT INSERT (schedule_end_strict), UPDATE (schedule_end_strict) ON public.auto_campaigns TO aka_agent_desktop;
  END IF;
END $grant$;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass AND attname = 'schedule_end_strict' AND NOT attisdropped) THEN RAISE EXCEPTION 'V674 p1 postflight: thiếu cột'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop')
     AND NOT (has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'schedule_end_strict', 'UPDATE')
              AND has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'schedule_end_strict', 'INSERT')) THEN
    RAISE EXCEPTION 'V674 p1 postflight: Desktop chưa có quyền ghi cột';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaigns WHERE schedule_end_strict) THEN RAISE EXCEPTION 'V674 p1 postflight: đã có chiến dịch bật cột'; END IF;
END $post$;
COMMIT;

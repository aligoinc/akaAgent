-- Gỡ V513: xoá hàm public.aka_agent_engine_desktop_enabled_v1(). Không có dữ liệu nào. Desktop bản mới gặp lỗi hàm không có
-- (PGRST202) thì coi như cờ tắt và chạy bộ cũ cho mọi chiến dịch (sau khi đăng nhập lại).
-- Lệnh sửa schema: apply ngoài giờ cao điểm. Không xoá dòng trong sổ migration.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.aka_agent_engine_desktop_enabled_v1();
DO $post$
BEGIN
  IF to_regprocedure('public.aka_agent_engine_desktop_enabled_v1()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback V513 postflight: hàm vẫn còn';
  END IF;
END $post$;
COMMIT;

-- Gỡ V546: xoá ba hàm đọc mã giới thiệu cho phần mềm akaAgent. Không có dữ liệu nào (mã và hoa hồng nằm ở các bảng aff_*
-- của CRM, không đụng tới). Web/iOS/Desktop bản mới gặp lỗi hàm không có (PGRST202) thì ẩn mục "Giới thiệu nhận hoa hồng".
-- Chạy file này TRƯỚC khi gỡ migration CRM 20261115100000_aff_partner_program.sql.
-- Lệnh sửa schema: apply ngoài giờ cao điểm. Không xoá dòng trong sổ migration.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.aka_agent_aff_partner(boolean);
DROP FUNCTION IF EXISTS public.aka_agent_control_aff_partner(bigint, bigint, boolean);
DROP FUNCTION IF EXISTS private.aka_agent_aff_partner_view(bigint, boolean);
DO $post$
BEGIN
  IF to_regprocedure('public.aka_agent_aff_partner(boolean)') IS NOT NULL
     OR to_regprocedure('public.aka_agent_control_aff_partner(bigint, bigint, boolean)') IS NOT NULL
     OR to_regprocedure('private.aka_agent_aff_partner_view(bigint, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback V546 postflight: hàm vẫn còn';
  END IF;
END $post$;
COMMIT;

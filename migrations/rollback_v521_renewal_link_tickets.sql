-- Gỡ V521: xoá bốn hàm vé gia hạn và bảng private.aka_renewal_link_tickets (vé chỉ sống 10 phút nên không mất gì đáng giữ).
-- Sau khi gỡ: Desktop/API Web gặp lỗi thiếu hàm (PGRST202) thì tự dùng link thường, khách đăng nhập cổng bằng mật khẩu;
-- cổng CRM coi mã vé là không hợp lệ và hiện form đăng nhập. Không xoá dòng trong sổ migration.
-- Lệnh sửa schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.aka_agent_renewal_link_ticket(bigint);
DROP FUNCTION IF EXISTS public.aka_agent_control_renewal_link_ticket(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.aka_renewal_link_ticket_redeem(text);
DROP FUNCTION IF EXISTS private.aka_renewal_link_ticket_issue(bigint, bigint, bigint, text);
DROP TABLE IF EXISTS private.aka_renewal_link_tickets;
DO $post$
BEGIN
  IF to_regclass('private.aka_renewal_link_tickets') IS NOT NULL
     OR to_regprocedure('public.aka_agent_renewal_link_ticket(bigint)') IS NOT NULL
     OR to_regprocedure('public.aka_agent_control_renewal_link_ticket(bigint,bigint,bigint)') IS NOT NULL
     OR to_regprocedure('public.aka_renewal_link_ticket_redeem(text)') IS NOT NULL
     OR to_regprocedure('private.aka_renewal_link_ticket_issue(bigint,bigint,bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback V521 postflight: còn sót đối tượng';
  END IF;
END $post$;
COMMIT;

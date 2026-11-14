-- Gỡ V529: trả public.aka_agent_zalo_server_on_fly_v1() về đúng thân V498 (chỉ có Chat hoặc dòng to_fly).
-- Desktop đọc hàm lúc đăng nhập nên gỡ có hiệu lực khi nhân viên đăng nhập lại. Không xoá dòng trong sổ migration.
-- Lệnh sửa schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.aka_agent_zalo_server_on_fly_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  SELECT COALESCE((
    SELECT public.aka_agent_app_access_chat_runtime(ctx.organization_id, true)
        OR EXISTS (
          SELECT 1 FROM private.auto_zalo_server_session_handoff AS handoff
           WHERE handoff.organization_id = ctx.organization_id AND handoff.direction = 'to_fly'
        )
      FROM private.aka_agent_desktop_data_context() AS ctx
     LIMIT 1
  ), false)
$function$;

COMMENT ON FUNCTION public.aka_agent_zalo_server_on_fly_v1() IS
  'V498: tài khoản Zalo Server của tổ chức trong phiên Desktop đang chạy trên Fly (có Chat, hoặc ChatApi đã nhận theo cờ V497). Desktop dùng để nghe tiến trình chiến dịch từ ChatApi.';

DO $post$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef('public.aka_agent_zalo_server_on_fly_v1()'::regprocedure));
  IF v_md5 <> '0e8f19b1cabf61598a08a818dfe20171' THEN
    RAISE EXCEPTION 'Rollback V529 postflight: md5 thân hàm % khác bản V498', v_md5;
  END IF;
  IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_zalo_server_on_fly_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback V529 postflight: aka_agent_desktop chưa gọi được hàm';
  END IF;
END $post$;

COMMIT;

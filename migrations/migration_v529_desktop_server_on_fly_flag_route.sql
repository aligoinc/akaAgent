-- V529: Desktop chọn nơi chạy tài khoản Zalo Server giống Web và ChatApi (14/11/2026).
--
-- V498 public.aka_agent_zalo_server_on_fly_v1() chỉ đúng khi tổ chức có Chat hoặc đã có dòng to_fly trong
-- private.auto_zalo_server_session_handoff. Web, ChatApi và runtime Fly thì dùng public.aka_agent_zalo_server_flag_route(org)
-- (cờ engine v2 + gói 16/18 còn hạn + quyền QR và Server). Tổ chức bật cờ có gói Server nhưng chưa có tài khoản Server nào
-- (tổ chức mới tạo qua V528) chưa có dòng to_fly, nên Desktop ≥ 9.6.0 tạo và quét QR tài khoản Server đầu tiên trên App Server.
-- Ngay sau đó ChatApi tạo dòng to_fly và App Server thả tổ chức trong ≤ 60 giây: lượt quét đang dở bị cắt; quét xong thì phiên
-- bị chép sang Fly, đúng loại phiên bị Zalo đá sáng 14/11. Tạo bằng Web thì đi Fly ngay.
--
-- V529 thêm OR public.aka_agent_zalo_server_flag_route(org) vào hàm, giữ điều kiện cũ (có Chat; còn dòng to_fly, tức App Server
-- đang hoặc đã thả tổ chức). Giữ nguyên tên, tham số, quyền (chỉ aka_agent_desktop gọi), SECURITY DEFINER, STABLE, search_path.
-- Kết quả chỉ đổi với tổ chức bật cờ đủ điều kiện Fly mà chưa có Chat và chưa có dòng to_fly (08:42 VN 14/11: 12 tổ chức, đều chưa
-- có tài khoản Server). Desktop đọc hàm lúc đăng nhập nên thay đổi có hiệu lực khi nhân viên đăng nhập lại; Desktop < 9.6.0 không
-- gọi hàm này nên không đổi.
--
-- CREATE OR REPLACE FUNCTION và COMMENT làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
-- Gỡ: rollback_v529_desktop_server_on_fly_flag_route.sql (trả đúng thân V498).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v529_%') THEN
      RAISE EXCEPTION 'V529 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_zalo_server_on_fly_v1()') IS NULL THEN
    RAISE EXCEPTION 'V529 cần V498 (public.aka_agent_zalo_server_on_fly_v1())';
  END IF;
  v_md5 := md5(pg_get_functiondef('public.aka_agent_zalo_server_on_fly_v1()'::regprocedure));
  IF v_md5 <> '0e8f19b1cabf61598a08a818dfe20171' THEN
    RAISE EXCEPTION 'V529: thân public.aka_agent_zalo_server_on_fly_v1() khác bản V498 (md5 %); đọc lại bản live trước khi sửa', v_md5;
  END IF;
  IF to_regprocedure('public.aka_agent_zalo_server_flag_route(bigint)') IS NULL THEN
    RAISE EXCEPTION 'V529 cần V497 (public.aka_agent_zalo_server_flag_route(bigint))';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.aka_agent_zalo_server_on_fly_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  SELECT COALESCE((
    SELECT public.aka_agent_app_access_chat_runtime(ctx.organization_id, true)
        OR public.aka_agent_zalo_server_flag_route(ctx.organization_id)
        OR EXISTS (
          SELECT 1 FROM private.auto_zalo_server_session_handoff AS handoff
           WHERE handoff.organization_id = ctx.organization_id AND handoff.direction = 'to_fly'
        )
      FROM private.aka_agent_desktop_data_context() AS ctx
     LIMIT 1
  ), false)
$function$;

COMMENT ON FUNCTION public.aka_agent_zalo_server_on_fly_v1() IS
  'V498/V529: tài khoản Zalo Server của tổ chức trong phiên Desktop chạy trên Fly: có Chat, bật cờ engine v2 đủ điều kiện Fly (aka_agent_zalo_server_flag_route, như Web và ChatApi), hoặc còn dòng to_fly. Desktop đọc lúc đăng nhập để chọn ChatApi hay App Server cho tài khoản Server.';

DO $post$
DECLARE v_md5 text; v_bad text;
BEGIN
  v_md5 := md5(pg_get_functiondef('public.aka_agent_zalo_server_on_fly_v1()'::regprocedure));
  IF v_md5 <> '2bdb82692298981a410803ef8ef47266' THEN
    RAISE EXCEPTION 'V529 postflight: md5 thân hàm % khác bản đã kiểm', v_md5;
  END IF;
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, 'public.aka_agent_zalo_server_on_fly_v1()', 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V529 postflight: role không được gọi hàm: %', v_bad; END IF;
  IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_zalo_server_on_fly_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'V529 postflight: aka_agent_desktop chưa gọi được hàm';
  END IF;
  IF (SELECT NOT prosecdef OR provolatile <> 's' FROM pg_proc WHERE oid = 'public.aka_agent_zalo_server_on_fly_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'V529 postflight: hàm phải SECURITY DEFINER, STABLE';
  END IF;
END $post$;

COMMIT;

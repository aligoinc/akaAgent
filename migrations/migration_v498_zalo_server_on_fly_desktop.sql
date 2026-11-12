-- V498: cho Desktop biết tài khoản Zalo Server của tổ chức mình đang chạy trên Fly (11/11/2026, kế hoạch mục 16.9).
-- Desktop chỉ nghe tiến trình chiến dịch (kênh realtime của ChatApi) khi tổ chức có Chat. Tổ chức không Chat chạy trên Fly
-- theo cờ (V497) thì VPS đã thả tổ chức nên tab "Tiến trình" trống. Desktop không đọc được cờ use_new_zalo_runtime
-- (không có quyền cột) và bảng chép phiên của V497, nên cần một hàm đọc theo phiên Desktop.
--
-- public.aka_agent_zalo_server_on_fly_v1(): không nhận tham số tổ chức; lấy nhân viên/tổ chức từ phiên Desktop
-- (private.aka_agent_desktop_data_context). Đúng khi:
--   * tổ chức có Chat chạy Server trên Fly: public.aka_agent_app_access_chat_runtime(org, true); hoặc
--   * ChatApi đã nhận tổ chức theo cờ: có dòng to_fly trong private.auto_zalo_server_session_handoff (V497; App Server chỉ
--     thả tổ chức khi đã có dòng này, tắt cờ thì ChatApi trả phiên và đổi dòng sang to_vps).
-- Gọi bằng role khác aka_agent_desktop (không có phiên Desktop) thì trả false.
--
-- Chỉ thêm một hàm mới; không sửa hàm, bảng hay dữ liệu cũ. Desktop bản cũ không gọi hàm này.
-- CREATE FUNCTION làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v498_zalo_server_on_fly_desktop.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v498_%') THEN
      RAISE EXCEPTION 'V498 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_zalo_server_on_fly_v1()') IS NOT NULL THEN
    RAISE EXCEPTION 'V498: public.aka_agent_zalo_server_on_fly_v1() đã có';
  END IF;
  IF to_regclass('private.auto_zalo_server_session_handoff') IS NULL THEN
    RAISE EXCEPTION 'V498 cần V497 (private.auto_zalo_server_session_handoff)';
  END IF;
  IF to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN
    RAISE EXCEPTION 'V498: thiếu private.aka_agent_desktop_data_context()';
  END IF;
  IF to_regprocedure('public.aka_agent_app_access_chat_runtime(bigint,boolean)') IS NULL THEN
    RAISE EXCEPTION 'V498: thiếu public.aka_agent_app_access_chat_runtime(bigint, boolean)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    RAISE EXCEPTION 'V498: thiếu role aka_agent_desktop';
  END IF;
END $pre$;

CREATE FUNCTION public.aka_agent_zalo_server_on_fly_v1()
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

REVOKE ALL ON FUNCTION public.aka_agent_zalo_server_on_fly_v1() FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_zalo_server_on_fly_v1() FROM %I', r);
    END IF;
  END LOOP;
END $grants$;
GRANT EXECUTE ON FUNCTION public.aka_agent_zalo_server_on_fly_v1() TO aka_agent_desktop;

DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, 'public.aka_agent_zalo_server_on_fly_v1()', 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V498 postflight: role không được gọi hàm: %', v_bad; END IF;
  IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_zalo_server_on_fly_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'V498 postflight: aka_agent_desktop chưa gọi được hàm';
  END IF;
  IF (SELECT NOT prosecdef OR provolatile <> 's' FROM pg_proc WHERE oid = 'public.aka_agent_zalo_server_on_fly_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'V498 postflight: hàm phải SECURITY DEFINER, STABLE';
  END IF;
END $post$;

COMMIT;

-- V513: cho Desktop đọc cờ engine v2 của tổ chức mình (12/11/2026, anh chốt "dùng chung cờ tổ chức").
-- Desktop bản có engine v2 chỉ chạy bộ mới cho tài khoản Zalo QR/Web khi tổ chức của nhân viên đăng nhập bật cờ
-- org_organization.use_new_zalo_runtime (cùng cờ chọn bộ mới cho tài khoản Server trên Fly). Desktop không đọc được cột này
-- (không có quyền cột, V435), nên cần một hàm đọc theo phiên Desktop, như V498.
--
-- public.aka_agent_engine_desktop_enabled_v1(): không nhận tham số tổ chức; lấy tổ chức từ phiên Desktop
-- (private.aka_agent_desktop_data_context()) và trả use_new_zalo_runtime của tổ chức đó. Không có phiên Desktop (role khác),
-- JWT không ánh xạ nhân viên, hay cờ NULL thì trả false. Desktop đọc một lần lúc đăng nhập; lỗi hoặc DB chưa có hàm (PGRST202)
-- thì chạy bộ cũ.
--
-- Chỉ thêm một hàm mới; không sửa hàm, bảng hay dữ liệu cũ. Desktop bản cũ không gọi hàm này.
-- CREATE FUNCTION làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v513_engine_desktop_flag.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v513_%') THEN
      RAISE EXCEPTION 'V513 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_engine_desktop_enabled_v1()') IS NOT NULL THEN
    RAISE EXCEPTION 'V513: public.aka_agent_engine_desktop_enabled_v1() đã có';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.org_organization'::regclass AND attname = 'use_new_zalo_runtime'
       AND atttypid = 'boolean'::regtype AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'V513: thiếu cột boolean public.org_organization.use_new_zalo_runtime (V371)';
  END IF;
  IF to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN
    RAISE EXCEPTION 'V513: thiếu private.aka_agent_desktop_data_context()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    RAISE EXCEPTION 'V513: thiếu role aka_agent_desktop';
  END IF;
END $pre$;

CREATE FUNCTION public.aka_agent_engine_desktop_enabled_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  SELECT COALESCE((
    SELECT org.use_new_zalo_runtime
      FROM private.aka_agent_desktop_data_context() AS ctx
      JOIN public.org_organization AS org ON org.id = ctx.organization_id
     LIMIT 1
  ), false)
$function$;

COMMENT ON FUNCTION public.aka_agent_engine_desktop_enabled_v1() IS
  'V513: cờ engine v2 (org_organization.use_new_zalo_runtime) của tổ chức trong phiên Desktop. Desktop đọc lúc đăng nhập để chọn bộ chạy chiến dịch Zalo QR/Web; false thì chạy bộ cũ.';

REVOKE ALL ON FUNCTION public.aka_agent_engine_desktop_enabled_v1() FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_engine_desktop_enabled_v1() FROM %I', r);
    END IF;
  END LOOP;
END $grants$;
GRANT EXECUTE ON FUNCTION public.aka_agent_engine_desktop_enabled_v1() TO aka_agent_desktop;

DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, 'public.aka_agent_engine_desktop_enabled_v1()', 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V513 postflight: role không được gọi hàm: %', v_bad; END IF;
  IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_desktop_enabled_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'V513 postflight: aka_agent_desktop chưa gọi được hàm';
  END IF;
  IF (SELECT NOT prosecdef OR provolatile <> 's' FROM pg_proc WHERE oid = 'public.aka_agent_engine_desktop_enabled_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'V513 postflight: hàm phải SECURITY DEFINER, STABLE';
  END IF;
  -- Gọi ngoài phiên Desktop (role chạy migration) thì false.
  IF public.aka_agent_engine_desktop_enabled_v1() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'V513 postflight: ngoài phiên Desktop phải trả false';
  END IF;
END $post$;

COMMIT;

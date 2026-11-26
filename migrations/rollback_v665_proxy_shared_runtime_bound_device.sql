-- Gỡ V665: trả private.aka_agent_proxy_shared_runtime_ready về đúng thân V511 đang chạy production 26/11/2026 (kiểm md5 trước và sau).
-- Sau khi gỡ: nhân viên vừa cập nhật Desktop lại không gắn được proxy do đồng nghiệp thêm cho tài khoản Desktop tới 30 ngày.
-- Tài khoản đã gắn proxy đồng nghiệp trong lúc V665 chạy vẫn giữ (trigger chỉ xét khi đổi proxy / nhân viên / loại tài khoản).
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
DECLARE v_md5 text; v_acl text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v665_proxy_shared_runtime_bound_device') THEN
    RAISE EXCEPTION 'Gỡ V665: V665 chưa có trong sổ';
  END IF;
  -- Thân hàm phải đúng bản V665 (migration sau có vá hàm này thì gỡ migration đó trước).
  SELECT md5(pg_get_functiondef(oid)), COALESCE(proacl::text, '') INTO v_md5, v_acl FROM pg_proc WHERE oid = to_regprocedure('private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)');
  IF v_md5 IS DISTINCT FROM 'ee76fb5dae789f510cb90425f24e0f03' THEN
    RAISE EXCEPTION 'Gỡ V665: hàm không phải bản V665 (md5 %)', v_md5;
  END IF;
  PERFORM set_config('aka_agent.v665_acl', v_acl, true);
END $pre$;

CREATE OR REPLACE FUNCTION private.aka_agent_proxy_shared_runtime_ready(p_staff_id bigint, p_server boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_raw text;
  v_config jsonb;
  v_min text;
  v_min_parts integer[];
BEGIN
  SELECT setting.value INTO v_raw FROM public.auto_system_settings AS setting
  WHERE setting.key = 'proxies.shared_runtime' AND setting.is_active
  LIMIT 1;
  BEGIN
    v_config := NULLIF(btrim(COALESCE(v_raw, '')), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF v_config IS NULL OR jsonb_typeof(v_config) <> 'object' THEN
    RETURN false;
  END IF;
  IF p_server THEN
    RETURN jsonb_typeof(v_config -> 'server') = 'boolean' AND (v_config ->> 'server')::boolean;
  END IF;
  v_min := v_config ->> 'desktopMinVersion';
  IF jsonb_typeof(v_config -> 'desktopMinVersion') IS DISTINCT FROM 'string'
     OR v_min !~ '^\d{1,6}(\.\d{1,6}){0,3}$' THEN
    RETURN false;
  END IF;
  v_min_parts := string_to_array(v_min, '.')::integer[];
  RETURN EXISTS (
      SELECT 1 FROM public.auto_staff_device_presence AS device
      WHERE device.staff_id = p_staff_id AND device.last_seen_at > now() - interval '30 days')
    AND NOT EXISTS (
      SELECT 1 FROM public.auto_staff_device_presence AS device
      WHERE device.staff_id = p_staff_id AND device.last_seen_at > now() - interval '30 days'
        AND (device.app_version IS NULL OR device.app_version !~ '^\d{1,6}(\.\d{1,6}){0,3}$'
             OR string_to_array(device.app_version, '.')::integer[] < v_min_parts));
END;
$function$;

DO $post$
DECLARE v_md5 text; v_acl text; v_role text; v_label text := 'Gỡ V665';
BEGIN
  SELECT md5(pg_get_functiondef(oid)), COALESCE(proacl::text, '') INTO v_md5, v_acl FROM pg_proc WHERE oid = to_regprocedure('private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)');
  IF v_md5 IS DISTINCT FROM '5c25d073f3a9ee1859dccf6cc4f45fff' THEN
    RAISE EXCEPTION 'Gỡ V665: hàm không về bản production (md5 %)', v_md5;
  END IF;
  IF v_acl IS DISTINCT FROM current_setting('aka_agent.v665_acl', true) THEN
    RAISE EXCEPTION 'Gỡ V665: quyền hàm đổi (% → %)', current_setting('aka_agent.v665_acl', true), v_acl;
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role)
       AND has_function_privilege(v_role, 'private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)', 'EXECUTE') THEN
      RAISE EXCEPTION '%: % chạy được hàm private', v_label, v_role;
    END IF;
  END LOOP;
END $post$;
DELETE FROM supabase_migrations.schema_migrations WHERE name = 'migration_v665_proxy_shared_runtime_bound_device';
COMMIT;

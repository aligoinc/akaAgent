-- V665: cổng gắn proxy do nhân viên khác thêm cho tài khoản Desktop (V511 private.aka_agent_proxy_shared_runtime_ready) xét máy đang
-- gắn với tài khoản thay cho mọi phiên presence trong 30 ngày.
-- SINH TỪ scripts/build-v665-sql.cjs, không sửa tay. Kiểm: bash scripts/test-v665-proxy-shared-runtime.sh. Gỡ: rollback_v665_proxy_shared_runtime_bound_device.sql.
-- Vì sao: auto_staff_device_presence ghi một dòng cho MỖI lần mở app (khoá instance_id), nên nhân viên vừa cập nhật vẫn còn dòng bản cũ
-- và bị chặn tới 30 ngày. Đo 26/11/2026 (desktopMinVersion 9.6.0, chỉ đọc): 610 nhân viên có phiên trong 30 ngày, hàm trả false cho
-- 509; 287 trong số đó máy gắn đã chạy ≥ 9.6.0 ở phiên mới nhất và không máy nào khác đang mở bản cũ (108 chỉ vì dòng cũ của chính máy
-- gắn, 179 vì dòng cũ của một mã máy khác không còn mở: 154 / 179 cùng tên máy với máy gắn, đều thấy lần cuối trước phiên bản mới đầu
-- tiên của máy gắn, nhiều khả năng cùng máy trước khi đổi cách tính mã máy). Sau V665: 388 true; 0 nhân viên đang true chuyển false;
-- 222 vẫn false (219 máy gắn còn bản cũ ở phiên mới nhất, 3 chưa gắn máy).
-- Bản mới: máy gắn (org_staff.aka_agent_device_fingerprint_hash) xét ở phiên mới nhất theo last_seen_at, cộng mọi máy khác đang mở app
-- (ended_at IS NULL, last_seen_at trong 1 ngày), cộng máy khác có lần mở gần nhất trong 7 ngày là bản cũ (anh chốt 26/11: nhân viên có
-- thể "Đổi máy tính" sang máy đó, bản < 9.6.0 không đọc được proxy đồng nghiệp và chạy bằng mạng thật; 22 / 287 người được mở đã đổi
-- sang máy bản cũ trong 30 ngày); chưa gắn máy thì false. Nhánh Zalo Server giữ nguyên.
-- Phát lại đúng file này trên bản sao production 26/11 16:38 VN (19.158 phiên, PostgreSQL 17 cục bộ): hàm V511 khớp production 610 / 610;
-- 102 → 389 nhân viên qua cổng, 287 được mở, 0 bị chặn thêm, 221 vẫn chặn; điều kiện 7 ngày lúc đó không chặn thêm ai.
-- Chỉ thay thân một hàm (cùng chữ ký, chủ, quyền); trigger trg_account_proxy_scope_guard và RPC aka_agent_control_proxies (can_assign) gọi
-- hàm này nên đổi theo. Không DDL bảng. CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema một lần: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
DECLARE v_md5 text; v_acl text;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v665_proxy_shared_runtime_bound_device') THEN
    RAISE EXCEPTION 'V665 đã có trong sổ migration, không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v665_%') THEN
    RAISE EXCEPTION 'V665: số đã dùng cho migration khác';
  END IF;
  IF to_regprocedure('private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)') IS NULL THEN
    RAISE EXCEPTION 'V665: thiếu hàm V511';
  END IF;
  SELECT md5(pg_get_functiondef(oid)), COALESCE(proacl::text, '')
    INTO v_md5, v_acl FROM pg_proc WHERE oid = to_regprocedure('private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)');
  IF v_md5 IS DISTINCT FROM '5c25d073f3a9ee1859dccf6cc4f45fff' THEN
    RAISE EXCEPTION 'V665: hàm khác bản production 26/11 (md5 %)', v_md5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_staff'
                 AND column_name = 'aka_agent_device_fingerprint_hash')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_staff_device_presence'
         AND column_name IN ('staff_id', 'device_fingerprint_hash', 'app_version', 'last_seen_at', 'ended_at')) <> 5 THEN
    RAISE EXCEPTION 'V665: thiếu cột máy gắn / presence';
  END IF;
  PERFORM set_config('aka_agent.v665_acl', v_acl, true);
END $pre$;

CREATE OR REPLACE FUNCTION private.aka_agent_proxy_shared_runtime_ready(p_staff_id bigint, p_server boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V665: phần mềm chạy tài khoản đã đọc proxy theo tổ chức chưa (để gắn proxy do nhân viên khác thêm). Thiết lập proxies.shared_runtime:
--  - Zalo Server: server = true sau khi cài App Server mới (như V511);
--  - Desktop: máy đang gắn với tài khoản (org_staff.aka_agent_device_fingerprint_hash) chạy bản ≥ desktopMinVersion ở phiên mới nhất,
--    mọi máy khác đang mở app (phiên chưa kết thúc, thấy trong 1 ngày) cũng vậy, và không máy khác nào có lần mở gần nhất trong 7 ngày
--    là bản cũ; chưa gắn máy thì không gắn được.
--    V511 xét mọi phiên presence trong 30 ngày, mà mỗi lần mở app là một dòng: đo 26/11, 287 / 509 nhân viên bị chặn chỉ vì dòng bản cũ
--    của máy đã cập nhật. Cùng cách với private.aka_agent_send_exclusion_runtime_ready.
DECLARE
  v_raw text;
  v_config jsonb;
  v_min text;
  v_min_parts integer[];
  v_hash text;
  v_version text;
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
  SELECT NULLIF(btrim(staff.aka_agent_device_fingerprint_hash), '') INTO v_hash
  FROM public.org_staff AS staff WHERE staff.id = p_staff_id;
  IF v_hash IS NULL THEN
    RETURN false;
  END IF;
  SELECT device.app_version INTO v_version FROM public.auto_staff_device_presence AS device
  WHERE device.staff_id = p_staff_id AND device.device_fingerprint_hash = v_hash
  ORDER BY device.last_seen_at DESC
  LIMIT 1;
  IF v_version IS NULL OR v_version !~ '^\d{1,6}(\.\d{1,6}){0,3}$'
     OR string_to_array(v_version, '.')::integer[] < v_min_parts THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
      SELECT 1 FROM public.auto_staff_device_presence AS device
      WHERE device.staff_id = p_staff_id AND device.ended_at IS NULL
        AND device.last_seen_at > now() - interval '1 day'
        AND device.device_fingerprint_hash IS DISTINCT FROM v_hash
        AND (device.app_version IS NULL OR device.app_version !~ '^\d{1,6}(\.\d{1,6}){0,3}$'
             OR string_to_array(device.app_version, '.')::integer[] < v_min_parts))
    -- Máy khác có lần mở gần nhất là bản cũ, trong 7 ngày: nhân viên có thể "Đổi máy tính" sang máy đó, mà bản cũ không đọc được
    -- proxy của đồng nghiệp và chạy bằng mạng thật. Chỉ xét lần mở gần nhất của từng máy: máy đó cập nhật là hết chặn.
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT DISTINCT ON (device.device_fingerprint_hash) device.app_version
        FROM public.auto_staff_device_presence AS device
        WHERE device.staff_id = p_staff_id AND device.device_fingerprint_hash IS DISTINCT FROM v_hash
          AND device.last_seen_at > now() - interval '7 days'
        ORDER BY device.device_fingerprint_hash, device.last_seen_at DESC) AS latest
      WHERE latest.app_version IS NULL OR latest.app_version !~ '^\d{1,6}(\.\d{1,6}){0,3}$'
         OR string_to_array(latest.app_version, '.')::integer[] < v_min_parts);
END;
$function$;

DO $post$
DECLARE v_md5 text; v_acl text; v_role text; v_label text := 'V665 postflight';
BEGIN
  SELECT md5(pg_get_functiondef(oid)), COALESCE(proacl::text, '') INTO v_md5, v_acl FROM pg_proc WHERE oid = to_regprocedure('private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)');
  IF v_md5 IS DISTINCT FROM 'ee76fb5dae789f510cb90425f24e0f03' THEN
    RAISE EXCEPTION 'V665 postflight: thân hàm khác bản sinh (md5 %)', v_md5;
  END IF;
  IF v_acl IS DISTINCT FROM current_setting('aka_agent.v665_acl', true) THEN
    RAISE EXCEPTION 'V665 postflight: quyền hàm đổi (% → %)', current_setting('aka_agent.v665_acl', true), v_acl;
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role)
       AND has_function_privilege(v_role, 'private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)', 'EXECUTE') THEN
      RAISE EXCEPTION '%: % chạy được hàm private', v_label, v_role;
    END IF;
  END LOOP;
  IF private.aka_agent_proxy_shared_runtime_ready(0, false) THEN
    RAISE EXCEPTION 'V665 postflight: nhân viên không có máy gắn vẫn được gắn';
  END IF;
END $post$;
COMMIT;

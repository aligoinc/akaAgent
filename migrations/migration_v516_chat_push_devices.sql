-- V516: Chat đọc danh bạ iPhone của Trung tâm thông báo để đẩy tin nhắn của khách ra điện thoại. CANDIDATE, CHƯA APPLY.
-- Hợp đồng phía Chat: akaAgentChatApi docs/CHAT_ALERT_DELIVERY_20261113.md (mục iPhone). Chủ sản phẩm yêu cầu 13/11/2026:
-- nhân viên phải được báo khi có tin của khách, kể cả khi đã đóng akaChat và đang dùng điện thoại.
--
-- Thiết bị iPhone đăng ký ở public.auto_notification_devices (V457) qua API WebApp. Bộ phát thông báo của Chat chạy trong
-- Chat API bằng role SQL aka_agent_chat_api; role này không có quyền nào trên bảng thiết bị và bảng phiên (đo 13/11/2026:
-- ACL bảng chỉ có postgres), và không nên có: bảng chứa token đẩy của mọi nhân viên. Hai hàm mới là cửa hẹp duy nhất:
--
--   public.aka_agent_chat_push_devices(p_staff_ids bigint[])
--     Trả (device_id, staff_id, push_token, apns_environment, bundle_id) của các iPhone ĐANG NHẬN của những nhân viên
--     được hỏi, theo đúng luật Trung tâm thông báo dùng khi tự đẩy (V465): thiết bị is_active và is_enabled, có token, và
--     phiên đăng nhập của thiết bị (auto_control_sessions) thuộc đúng nhân viên, chưa bị thu hồi, chưa hết hạn. Tối đa 10
--     máy mỗi nhân viên (máy đăng ký gần nhất trước), tối đa 500 nhân viên mỗi lượt gọi. Chỉ đọc.
--   public.aka_agent_chat_push_device_result(p_device_id bigint, p_outcome text)
--     Ghi kết quả một lần đẩy của Chat lên thiết bị, giống worker thông báo: 'sent' → last_success_at, failure_count = 0;
--     'failed' → last_failure_at, failure_count + 1; 'invalid_token' (Apple báo token không còn dùng được) → is_active =
--     false, deactivated_reason = 'token_invalid'. Chỉ đụng thiết bị đang is_active; giá trị khác bị từ chối.
--
-- Cả hai SECURITY DEFINER (chủ postgres), search_path cố định, EXECUTE chỉ cho aka_agent_chat_api: thu hồi rõ khỏi PUBLIC,
-- anon, authenticated, service_role và aka_agent_desktop (default ACL của schema public cấp EXECUTE cho anon/authenticated/
-- service_role, REVOKE PUBLIC không đủ). Chat API gọi bằng kết nối SQL sẵn có của nó, không qua PostgREST; thời hạn câu
-- lệnh là của phiên Chat API.
--
-- Không đổi bảng, index, hàm, trigger hay dữ liệu cũ; không thêm job, pool hay kết nối. Trung tâm thông báo chạy như trước.
-- Chat API tự dò hai hàm (tối đa một phút một lần): chưa có thì không đẩy ra iPhone, mọi thứ khác của Chat không đổi.
-- CREATE FUNCTION làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v516_chat_push_devices.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v516_%') THEN
      RAISE EXCEPTION 'V516 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_chat_push_devices(bigint[])') IS NOT NULL
     OR to_regprocedure('public.aka_agent_chat_push_device_result(bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'V516: hàm aka_agent_chat_push_* đã có';
  END IF;
  IF to_regclass('public.auto_notification_devices') IS NULL OR to_regclass('public.auto_control_sessions') IS NULL THEN
    RAISE EXCEPTION 'V516: thiếu public.auto_notification_devices hoặc public.auto_control_sessions (V457)';
  END IF;
  -- Đúng các cột hai hàm dùng, đúng kiểu: bảng lệch thì dừng, không dựng hàm trên cấu trúc khác.
  SELECT string_agg(want.col, ', ' ORDER BY want.col) INTO v_missing
    FROM (VALUES
      ('auto_notification_devices', 'id', 'bigint'), ('auto_notification_devices', 'staff_id', 'bigint'),
      ('auto_notification_devices', 'control_session_id', 'uuid'), ('auto_notification_devices', 'bundle_id', 'text'),
      ('auto_notification_devices', 'push_token', 'text'), ('auto_notification_devices', 'apns_environment', 'text'),
      ('auto_notification_devices', 'is_enabled', 'boolean'), ('auto_notification_devices', 'is_active', 'boolean'),
      ('auto_notification_devices', 'deactivated_reason', 'text'),
      ('auto_notification_devices', 'last_registered_at', 'timestamp with time zone'),
      ('auto_notification_devices', 'last_success_at', 'timestamp with time zone'),
      ('auto_notification_devices', 'last_failure_at', 'timestamp with time zone'),
      ('auto_notification_devices', 'failure_count', 'integer'),
      ('auto_notification_devices', 'updated_at', 'timestamp with time zone'),
      ('auto_control_sessions', 'id', 'uuid'), ('auto_control_sessions', 'staff_id', 'bigint'),
      ('auto_control_sessions', 'revoked_at', 'timestamp with time zone'),
      ('auto_control_sessions', 'expires_at', 'timestamp with time zone')
    ) AS want(tbl, col, typ)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = ('public.' || want.tbl)::regclass AND a.attname = want.col AND NOT a.attisdropped
        AND format_type(a.atttypid, a.atttypmod) = want.typ);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'V516: bảng thiết bị/phiên thiếu hoặc khác kiểu cột: %', v_missing;
  END IF;
  -- 'token_invalid' phải còn là lý do ngừng hợp lệ của bảng thiết bị.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.auto_notification_devices'::regclass AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%token_invalid%') THEN
    RAISE EXCEPTION 'V516: bảng thiết bị không còn nhận deactivated_reason = token_invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN
    RAISE EXCEPTION 'V516: thiếu role aka_agent_chat_api';
  END IF;
END $pre$;

CREATE FUNCTION public.aka_agent_chat_push_devices(p_staff_ids bigint[])
RETURNS TABLE (device_id bigint, staff_id bigint, push_token text, apns_environment text, bundle_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT ranked.id, ranked.staff_id, ranked.push_token, ranked.apns_environment, ranked.bundle_id
    FROM (
      SELECT dv.id, dv.staff_id, dv.push_token, dv.apns_environment, dv.bundle_id,
             row_number() OVER (PARTITION BY dv.staff_id ORDER BY dv.last_registered_at DESC, dv.id DESC) AS position
        FROM public.auto_notification_devices AS dv
        JOIN public.auto_control_sessions AS cs ON cs.id = dv.control_session_id
       WHERE dv.staff_id = ANY (p_staff_ids[1:500])
         AND dv.is_active AND dv.is_enabled AND dv.push_token IS NOT NULL
         AND cs.staff_id = dv.staff_id AND cs.revoked_at IS NULL AND cs.expires_at > now()
    ) AS ranked
   WHERE ranked.position <= 10
   ORDER BY ranked.staff_id, ranked.id
$$;

COMMENT ON FUNCTION public.aka_agent_chat_push_devices(bigint[]) IS
  'V516: iPhone đang nhận thông báo đẩy của các nhân viên được hỏi (thiết bị bật, có token, phiên đăng nhập còn hạn). Chỉ aka_agent_chat_api gọi, để đẩy tin nhắn của khách.';

CREATE FUNCTION public.aka_agent_chat_push_device_result(p_device_id bigint, p_outcome text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_device_id IS NULL OR p_outcome IS NULL OR p_outcome NOT IN ('sent', 'failed', 'invalid_token') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_push_invalid_outcome';
  END IF;
  IF p_outcome = 'sent' THEN
    UPDATE public.auto_notification_devices
       SET last_success_at = v_now, failure_count = 0, updated_at = v_now
     WHERE id = p_device_id AND is_active;
  ELSIF p_outcome = 'failed' THEN
    UPDATE public.auto_notification_devices
       SET last_failure_at = v_now, failure_count = failure_count + 1, updated_at = v_now
     WHERE id = p_device_id AND is_active;
  ELSE
    UPDATE public.auto_notification_devices
       SET is_active = false, deactivated_reason = 'token_invalid', last_failure_at = v_now, updated_at = v_now
     WHERE id = p_device_id AND is_active;
  END IF;
END
$$;

COMMENT ON FUNCTION public.aka_agent_chat_push_device_result(bigint, text) IS
  'V516: Chat ghi kết quả một lần đẩy lên thiết bị (sent | failed | invalid_token), như worker thông báo. Chỉ aka_agent_chat_api gọi.';

REVOKE ALL ON FUNCTION public.aka_agent_chat_push_devices(bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_chat_push_device_result(bigint, text) FROM PUBLIC;
DO $acl$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_chat_push_devices(bigint[]) FROM %I', v_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_chat_push_device_result(bigint, text) FROM %I', v_role);
    END IF;
  END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public.aka_agent_chat_push_devices(bigint[]) TO aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_chat_push_device_result(bigint, text) TO aka_agent_chat_api;

DO $post$
DECLARE
  v_sig text;
  v_role text;
  v_proc pg_proc%ROWTYPE;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY['public.aka_agent_chat_push_devices(bigint[])', 'public.aka_agent_chat_push_device_result(bigint,text)'] LOOP
    SELECT * INTO v_proc FROM pg_proc WHERE oid = to_regprocedure(v_sig);
    IF NOT FOUND THEN RAISE EXCEPTION 'V516 postflight: thiếu %', v_sig; END IF;
    IF NOT v_proc.prosecdef OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
      RAISE EXCEPTION 'V516 postflight: % sai chế độ bảo mật hoặc search_path', v_sig;
    END IF;
    IF NOT has_function_privilege('aka_agent_chat_api', v_proc.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'V516 postflight: aka_agent_chat_api chưa gọi được %', v_sig;
    END IF;
    -- Ngoài chủ hàm và aka_agent_chat_api, không role nào (kể cả PUBLIC) được có EXECUTE.
    IF EXISTS (
      SELECT 1 FROM aclexplode(v_proc.proacl) AS acl
       WHERE acl.privilege_type = 'EXECUTE'
         AND acl.grantee NOT IN (v_proc.proowner, (SELECT oid FROM pg_roles WHERE rolname = 'aka_agent_chat_api'))) THEN
      RAISE EXCEPTION 'V516 postflight: % còn cấp EXECUTE cho role khác', v_sig;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) AND has_function_privilege(v_role, v_proc.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'V516 postflight: % vẫn gọi được %', v_role, v_sig;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT provolatile FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_chat_push_devices(bigint[])')) <> 's' THEN
    RAISE EXCEPTION 'V516 postflight: hàm đọc thiết bị phải là STABLE';
  END IF;
  -- Quyền bảng không đổi: Chat vẫn không đọc thẳng được bảng thiết bị và bảng phiên.
  IF has_table_privilege('aka_agent_chat_api', 'public.auto_notification_devices', 'SELECT')
     OR has_table_privilege('aka_agent_chat_api', 'public.auto_control_sessions', 'SELECT') THEN
    RAISE EXCEPTION 'V516 postflight: aka_agent_chat_api đang có quyền đọc thẳng bảng thiết bị hoặc bảng phiên';
  END IF;
END $post$;

COMMIT;

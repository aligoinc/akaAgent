-- V675: trả lại quyền dùng sequence public.auto_zalo_api_error_logs_id_seq mà V525 thu nhầm.
--
-- Nguyên nhân: khối $grants$ của V525 (apply 25/11/2026 18:42:12 VN, sổ 20261125114212, md5 sổ = tệp 1250bb56…) thu
-- REVOKE ALL trên MỌI sequence tên 'auto\_zalo\_%' ở cả private lẫn public, từ anon, authenticated, service_role,
-- aka_agent_desktop, aka_agent_chat_api. Ngoài hai sequence của chính V525 (private.auto_zalo_status_events_id_seq,
-- private.auto_zalo_status_runs_id_seq), mẫu đó trúng public.auto_zalo_api_error_logs_id_seq. Từ 18:42:15 VN 25/11 mọi
-- INSERT vào public.auto_zalo_api_error_logs đều báo "permission denied for sequence auto_zalo_api_error_logs_id_seq"
-- (Desktop / App Server qua PostgREST và ChatApi); dòng cuối ghi được có created_at 18:42:10 VN 25/11.
--
-- Bản sửa chỉ cấp lại đúng quyền sequence đã có trước V525, cho đúng ba vai trò đang được INSERT vào bảng:
--   service_role       SELECT, UPDATE, USAGE   (như 82 sequence khác ở public)
--   aka_agent_desktop  USAGE                   (như 19 sequence cùng họ: bảng cho Desktop INSERT theo cột)
--   aka_agent_chat_api SELECT, USAGE           (đúng ChatApi migration 10013, như 7 sequence khác)
-- Nguồn: migrations/snapshots/desktop-session-rls/least-privilege-after.json (trước V435), V435 dòng 726 thu anon /
-- authenticated, và mẫu quyền của các sequence cùng họ trên production đọc 27/11/2026.
-- Không đổi: bảng, quyền bảng / cột, RLS / policy, hai sequence private của V525, sequence khác, hàm, role, timeout, pool,
-- connection. Không COMMENT: GRANT không nằm trong danh sách lệnh của pgrst_ddl_watch nên PostgREST không nạp lại schema.
-- Có hiệu lực ngay với lệnh INSERT tiếp theo, không cần deploy ChatApi / Desktop.
-- Không lấy lại được các dòng nhật ký đã mất từ 18:42 VN 25/11 tới lúc apply.
-- Rollback: migrations/rollback_v675_zalo_api_error_logs_sequence_grants.sql (trả về trạng thái hỏng sau V525).
-- Kiểm cục bộ: scripts/test-v675-zalo-api-error-logs-sequence-grants.sh. Hậu kiểm production (chỉ đọc):
-- migrations/tests/migration_v675_zalo_api_error_logs_sequence_grants_smoke.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $pre$
DECLARE
  v_seq regclass := to_regclass('public.auto_zalo_api_error_logs_id_seq');
  v_acl text[];
  v_role text;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration\_v675\_%') THEN
    RAISE EXCEPTION 'V675: số 675 đã có trong sổ migration';
  END IF;
  IF v_seq IS NULL OR (SELECT relkind FROM pg_class WHERE oid = v_seq) IS DISTINCT FROM 'S' THEN
    RAISE EXCEPTION 'V675: không thấy sequence public.auto_zalo_api_error_logs_id_seq';
  END IF;
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = v_seq) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'V675: chủ sequence không phải postgres';
  END IF;
  IF pg_get_serial_sequence('public.auto_zalo_api_error_logs', 'id') IS DISTINCT FROM 'public.auto_zalo_api_error_logs_id_seq' THEN
    RAISE EXCEPTION 'V675: cột id của auto_zalo_api_error_logs không còn dùng sequence này';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF to_regrole(v_role) IS NULL THEN
      RAISE EXCEPTION 'V675: thiếu vai trò %', v_role;
    END IF;
  END LOOP;
  -- Chỉ trả quyền sequence cho vai trò đang được ghi bảng (quyền bảng / cột giữ nguyên như trước V525).
  IF NOT has_table_privilege('service_role', 'public.auto_zalo_api_error_logs', 'INSERT')
     OR NOT has_table_privilege('aka_agent_chat_api', 'public.auto_zalo_api_error_logs', 'INSERT')
     OR NOT has_any_column_privilege('aka_agent_desktop', 'public.auto_zalo_api_error_logs', 'INSERT') THEN
    RAISE EXCEPTION 'V675: quyền INSERT trên bảng đã khác lúc viết, dừng để đối chiếu';
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_acl FROM (
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type
           || CASE WHEN a.is_grantable THEN ':grant' ELSE '' END AS x
    FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = v_seq
  ) s;
  IF v_acl = ARRAY['aka_agent_chat_api:SELECT', 'aka_agent_chat_api:USAGE', 'aka_agent_desktop:USAGE',
                   'postgres:SELECT', 'postgres:UPDATE', 'postgres:USAGE',
                   'service_role:SELECT', 'service_role:UPDATE', 'service_role:USAGE'] THEN
    RAISE EXCEPTION 'V675: quyền sequence đã đúng bản sửa, không apply lại';
  END IF;
  -- Đúng thứ V525 để lại (đọc production 27/11/2026: {postgres=rwU/postgres}).
  IF v_acl IS DISTINCT FROM ARRAY['postgres:SELECT', 'postgres:UPDATE', 'postgres:USAGE'] THEN
    RAISE EXCEPTION 'V675: quyền sequence đã khác lúc viết (%), dừng để đối chiếu', v_acl;
  END IF;
END
$pre$;

GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq TO aka_agent_desktop;
GRANT SELECT, USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq TO aka_agent_chat_api;

DO $post$
DECLARE
  v_acl text[];
  v_role text;
BEGIN
  SELECT array_agg(x ORDER BY x) INTO v_acl FROM (
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type
           || CASE WHEN a.is_grantable THEN ':grant' ELSE '' END AS x
    FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.auto_zalo_api_error_logs_id_seq'::regclass
  ) s;
  IF v_acl IS DISTINCT FROM ARRAY['aka_agent_chat_api:SELECT', 'aka_agent_chat_api:USAGE', 'aka_agent_desktop:USAGE',
                                  'postgres:SELECT', 'postgres:UPDATE', 'postgres:USAGE',
                                  'service_role:SELECT', 'service_role:UPDATE', 'service_role:USAGE'] THEN
    RAISE EXCEPTION 'V675: quyền sequence sau khi cấp lệch (%)', v_acl;
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF to_regrole(v_role) IS NOT NULL
       AND has_sequence_privilege(v_role, 'public.auto_zalo_api_error_logs_id_seq', 'USAGE,UPDATE,SELECT') THEN
      RAISE EXCEPTION 'V675: % không được dùng sequence này', v_role;
    END IF;
  END LOOP;
  -- Hai sequence của chính V525 vẫn chỉ của postgres.
  IF EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid IN (to_regclass('private.auto_zalo_status_events_id_seq'), to_regclass('private.auto_zalo_status_runs_id_seq'))
      AND a.grantee <> 'postgres'::regrole
  ) THEN
    RAISE EXCEPTION 'V675: sequence private của V525 có quyền lạ';
  END IF;
END
$post$;
COMMIT;

-- Hậu kiểm V675: chỉ đọc catalog (has_*_privilege), không đọc / ghi dòng nào, không tiêu số sequence, kết thúc ROLLBACK.
-- Đạt: in NOTICE "V675 smoke: đạt". Trước V675 (trạng thái sau V525) bài này báo lỗi ở service_role USAGE.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $smoke$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('service_role', 'USAGE', true), ('service_role', 'SELECT', true), ('service_role', 'UPDATE', true),
      ('aka_agent_desktop', 'USAGE', true), ('aka_agent_desktop', 'SELECT', false), ('aka_agent_desktop', 'UPDATE', false),
      ('aka_agent_chat_api', 'USAGE', true), ('aka_agent_chat_api', 'SELECT', true), ('aka_agent_chat_api', 'UPDATE', false),
      ('anon', 'USAGE', false), ('anon', 'SELECT', false), ('anon', 'UPDATE', false),
      ('authenticated', 'USAGE', false), ('authenticated', 'SELECT', false), ('authenticated', 'UPDATE', false)
    ) AS v(role_name, privilege, expected)
  LOOP
    IF has_sequence_privilege(r.role_name, 'public.auto_zalo_api_error_logs_id_seq', r.privilege) IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'V675 smoke: % % trên auto_zalo_api_error_logs_id_seq = % (cần %)',
        r.role_name, r.privilege, NOT r.expected, r.expected;
    END IF;
  END LOOP;
  -- Quyền ghi bảng không đổi: ba đường ghi vẫn được INSERT, anon / authenticated vẫn không.
  IF NOT has_table_privilege('service_role', 'public.auto_zalo_api_error_logs', 'INSERT')
     OR NOT has_table_privilege('aka_agent_chat_api', 'public.auto_zalo_api_error_logs', 'INSERT')
     OR NOT has_any_column_privilege('aka_agent_desktop', 'public.auto_zalo_api_error_logs', 'INSERT')
     OR has_any_column_privilege('anon', 'public.auto_zalo_api_error_logs', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.auto_zalo_api_error_logs', 'INSERT') THEN
    RAISE EXCEPTION 'V675 smoke: quyền INSERT trên bảng auto_zalo_api_error_logs đã khác';
  END IF;
  -- Hai sequence của V525 vẫn chỉ của postgres.
  IF EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid IN (to_regclass('private.auto_zalo_status_events_id_seq'), to_regclass('private.auto_zalo_status_runs_id_seq'))
      AND a.grantee <> 'postgres'::regrole
  ) THEN
    RAISE EXCEPTION 'V675 smoke: sequence private của V525 có quyền lạ';
  END IF;
  RAISE NOTICE 'V675 smoke: đạt';
END
$smoke$;
ROLLBACK;

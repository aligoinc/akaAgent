-- Gỡ V675: thu lại đúng các quyền sequence mà V675 cấp, về trạng thái sau V525 ({postgres=rwU/postgres}).
-- Gỡ xong thì mọi INSERT vào public.auto_zalo_api_error_logs lại báo "permission denied for sequence" như từ
-- 18:42 VN 25/11/2026 (Desktop / App Server và ChatApi đều bắt lỗi này, chiến dịch không dừng, chỉ mất dòng nhật ký).
-- Chỉ dùng khi chính V675 gây vấn đề. Không đổi gì khác; không COMMENT nên PostgREST không nạp lại schema.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $pre$
DECLARE
  v_acl text[];
BEGIN
  IF to_regclass('public.auto_zalo_api_error_logs_id_seq') IS NULL THEN
    RAISE EXCEPTION 'Gỡ V675: không thấy sequence public.auto_zalo_api_error_logs_id_seq';
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_acl FROM (
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type
           || CASE WHEN a.is_grantable THEN ':grant' ELSE '' END AS x
    FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.auto_zalo_api_error_logs_id_seq'::regclass
  ) s;
  IF v_acl = ARRAY['postgres:SELECT', 'postgres:UPDATE', 'postgres:USAGE'] THEN
    RAISE EXCEPTION 'Gỡ V675: quyền sequence đã ở trạng thái sau V525, không có gì để gỡ';
  END IF;
  IF v_acl IS DISTINCT FROM ARRAY['aka_agent_chat_api:SELECT', 'aka_agent_chat_api:USAGE', 'aka_agent_desktop:USAGE',
                                  'postgres:SELECT', 'postgres:UPDATE', 'postgres:USAGE',
                                  'service_role:SELECT', 'service_role:UPDATE', 'service_role:USAGE'] THEN
    RAISE EXCEPTION 'Gỡ V675: quyền sequence không khớp bản V675 (%), dừng để đối chiếu', v_acl;
  END IF;
END
$pre$;

REVOKE SELECT, UPDATE, USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq FROM service_role;
REVOKE USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq FROM aka_agent_desktop;
REVOKE SELECT, USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq FROM aka_agent_chat_api;

DO $post$
DECLARE
  v_acl text[];
BEGIN
  SELECT array_agg(x ORDER BY x) INTO v_acl FROM (
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type
           || CASE WHEN a.is_grantable THEN ':grant' ELSE '' END AS x
    FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.auto_zalo_api_error_logs_id_seq'::regclass
  ) s;
  IF v_acl IS DISTINCT FROM ARRAY['postgres:SELECT', 'postgres:UPDATE', 'postgres:USAGE'] THEN
    RAISE EXCEPTION 'Gỡ V675: quyền sequence sau khi gỡ lệch (%)', v_acl;
  END IF;
END
$post$;
COMMIT;

-- Dữ liệu và hàm đối chứng cho bài kiểm khoá chéo của update_control_email_account_atomic (test-v530-*.sh mục 9).
SET client_min_messages = warning;
CREATE SCHEMA IF NOT EXISTS v530_test;
INSERT INTO auto_accounts(id, name, flatform_type, staff_id, organization_id, is_delete, is_active, login_status, status, email_session, account_group_id) VALUES
  (3013, 'Email khoá chéo A', 'email', 301, 30, false, true, 'đã đăng nhập', 'chờ xử lý',
    '{"brandName":"","host":"h","port":587,"secure":false,"user":"u","pass":"p","fromEmail":"x@example.test","replyTo":"","cc":""}', 3901),
  (3014, 'Email khoá chéo B', 'email', 301, 30, false, true, 'đã đăng nhập', 'chờ xử lý',
    '{"brandName":"","host":"h","port":587,"secure":false,"user":"u","pass":"p","fromEmail":"y@example.test","replyTo":"","cc":""}', 3905);
-- Đối chứng: thứ tự khoá của bản v530 đầu tiên (khoá nhóm ĐỘC QUYỀN trước, rồi mới khoá dòng tài khoản). Với trigger
-- production lock_auto_account_control_resources (khoá dòng trước, khoá nhóm dùng chung sau) thứ tự này khoá chéo.
CREATE OR REPLACE FUNCTION v530_test.old_lock_order_update(p_account_id bigint, p_group_id bigint, p_name text)
RETURNS text LANGUAGE plpgsql SET lock_timeout TO '8s' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account-group:' || p_group_id::text, 0));
  PERFORM 1 FROM public.auto_accounts WHERE id = p_account_id FOR UPDATE;
  UPDATE public.auto_accounts SET name = COALESCE(p_name, name), account_group_id = p_group_id, updated_at = now() WHERE id = p_account_id;
  RETURN 'updated';
END
$$;

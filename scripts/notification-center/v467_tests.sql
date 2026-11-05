-- V467 behaviour checks. Run after setup.sql + V457 + live-like Desktop grants + V467 (see smoke_v467.sh).
\set ON_ERROR_STOP 1
\set QUIET 1
CREATE FUNCTION public.fixture_assert(p_ok boolean, p_message text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_message; END IF;
  RETURN 'ok  - ' || p_message;
END $$;
CREATE FUNCTION public.fixture_error(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.fixture_assert(boolean, text), public.fixture_error(text) TO PUBLIC;
CREATE FUNCTION public.fixture_sender() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.aka_agent_notification_sender() $$;
CREATE FUNCTION public.fixture_flagged() RETURNS bigint[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM public.auto_accounts WHERE is_send_noti_akabiz $$;
\set QUIET 0
\pset tuples_only on
\pset format unaligned

\echo '== apply keeps the current sender'
SELECT fixture_assert(public.fixture_flagged() = '{9742}', 'only the account in the old setting is flagged after apply');
SELECT fixture_assert((SELECT count(*) FROM auto_accounts WHERE NOT is_send_noti_akabiz) = (SELECT count(*) FROM auto_accounts) - 1, 'other accounts default to false');
SET ROLE service_role;
SELECT fixture_assert(r ->> 'configured' = 'true' AND r ->> 'source' = 'flag' AND (r ->> 'accountId')::bigint = 9742 AND r ->> 'host' = 'smtp.example.test'
         AND (r ->> 'port')::int = 587 AND r ->> 'user' = 'sender@example.test' AND r ->> 'pass' = 'fixture-pass'
         AND r ->> 'fromEmail' = 'sender@example.test' AND r ->> 'brandName' = 'akaBiz' AND r ->> 'replyTo' = 'support@example.test',
       'sender RPC returns the flagged account with its SMTP settings')
  FROM (SELECT public.aka_agent_notification_sender() AS r) x;
SELECT fixture_assert((public.aka_agent_notification_worker('sender') ->> 'accountId')::bigint = 9742, 'V457 sender action unchanged');
RESET ROLE;

\echo '== flag another account'
INSERT INTO auto_accounts (id, name, flatform_type, staff_id, organization_id, email_session) VALUES
  (9800, 'Thông báo mới', 'email', 3, 2, '{"host":"smtp.mail.example","port":465,"secure":true,"user":"noti@example.test","pass":"p2","fromEmail":"Noti@Example.test","brandName":"akaBiz Noti"}'),
  (9802, 'Thiếu mật khẩu', 'email', 3, 2, '{"host":"smtp.mail.example","port":"587","user":"x@example.test","fromEmail":"x@example.test"}'),
  (9803, 'Zalo có SMTP', 'zalo', 3, 2, '{"host":"smtp.mail.example","pass":"p","fromEmail":"z@example.test"}');
UPDATE auto_accounts SET is_send_noti_akabiz = true WHERE id = 9800;
SELECT fixture_assert(public.fixture_flagged() = '{9800}', 'flagging 9800 turns the old flag off');
SELECT fixture_assert((SELECT r ->> 'source' = 'flag' AND (r ->> 'accountId')::bigint = 9800 AND (r ->> 'port')::int = 465 AND r ->> 'secure' = 'true'
                         AND r ->> 'fromEmail' = 'noti@example.test' AND r ->> 'replyTo' IS NULL FROM (SELECT public.fixture_sender() r) x),
                      'sender switches to the newly flagged account');
INSERT INTO auto_accounts (id, name, flatform_type, staff_id, organization_id, email_session, is_send_noti_akabiz) VALUES
  (9801, 'Tạo mới đã bật', 'email', 3, 2, '{"host":"smtp.other.example","pass":"p3","fromEmail":"other@example.test"}', true);
SELECT fixture_assert(public.fixture_flagged() = '{9801}', 'inserting a flagged account turns the old flag off');
SELECT fixture_assert((public.fixture_sender() ->> 'accountId')::bigint = 9801 AND public.fixture_sender() ->> 'user' = '', 'new flagged account is used');

\echo '== fallback to the old setting'
UPDATE auto_accounts SET is_send_noti_akabiz = true WHERE id = 9802;
SELECT fixture_assert(public.fixture_flagged() = '{9802}', 'only one account stays flagged');
SELECT fixture_assert((SELECT r ->> 'source' = 'setting' AND (r ->> 'accountId')::bigint = 9742 FROM (SELECT public.fixture_sender() r) x),
                      'flagged account without password falls back to the old setting');
UPDATE auto_accounts SET is_send_noti_akabiz = true WHERE id = 9803;
SELECT fixture_assert((public.fixture_sender() ->> 'source') = 'setting', 'non-email flagged account is ignored');
UPDATE auto_accounts SET is_send_noti_akabiz = true WHERE id = 9800;
UPDATE auto_accounts SET is_delete = true WHERE id = 9800;
SELECT fixture_assert((public.fixture_sender() ->> 'accountId')::bigint = 9742, 'deleted flagged account falls back to the old setting');
UPDATE auto_accounts SET is_delete = false, is_active = false WHERE id = 9800;
SELECT fixture_assert((public.fixture_sender() ->> 'accountId')::bigint = 9742, 'inactive flagged account falls back to the old setting');
UPDATE auto_accounts SET is_active = true, is_send_noti_akabiz = false WHERE id = 9800;
SELECT fixture_assert(public.fixture_flagged() = '{}' AND (public.fixture_sender() ->> 'source') = 'setting', 'no flag uses the old setting');
UPDATE auto_system_settings SET value = 'abc' WHERE key = 'notifications.email.sender_account_id';
SELECT fixture_assert(public.fixture_sender() = '{"configured": false}'::jsonb, 'no flag and invalid setting means not configured');
UPDATE auto_system_settings SET value = '9742' WHERE key = 'notifications.email.sender_account_id';
UPDATE auto_accounts SET is_send_noti_akabiz = true WHERE id = 9742;
SELECT fixture_assert(public.fixture_flagged() = '{9742}' AND (public.fixture_sender() ->> 'source') = 'flag', 'flag 9742 again');

\echo '== privileges'
SET ROLE aka_agent_desktop;
SELECT fixture_assert(fixture_error($$SELECT * FROM public.auto_accounts LIMIT 1$$) = 'no error', 'desktop select * still works');
SELECT fixture_assert(fixture_error($$SELECT is_send_noti_akabiz FROM public.auto_accounts LIMIT 1$$) = 'no error', 'desktop can read the flag');
SELECT fixture_assert(fixture_error($$UPDATE public.auto_accounts SET is_send_noti_akabiz = true WHERE id = 100$$) LIKE '42501:%', 'desktop cannot set the flag');
SELECT fixture_assert(fixture_error($$UPDATE public.auto_accounts SET login_status = 'đã đăng nhập' WHERE id = 100$$) = 'no error', 'desktop column updates still work');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_sender()$$) LIKE '42501:%', 'desktop cannot read the sender');
RESET ROLE;
SET ROLE anon;
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_sender()$$) LIKE '42501:%', 'anon cannot read the sender');
RESET ROLE;
SET ROLE authenticated;
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_sender()$$) LIKE '42501:%', 'authenticated cannot read the sender');
RESET ROLE;
SET ROLE aka_agent_chat_api;
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_sender()$$) LIKE '42501:%', 'chat api cannot read the sender');
RESET ROLE;
DROP FUNCTION public.fixture_sender();
DROP FUNCTION public.fixture_flagged();
DROP FUNCTION public.fixture_assert(boolean, text);
DROP FUNCTION public.fixture_error(text);
SELECT 'PASS';

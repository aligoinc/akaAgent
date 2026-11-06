-- V467 (05/11/2026): chọn tài khoản gửi email thông báo bằng cờ auto_accounts.is_send_noti_akabiz.
-- Bật cờ ở tài khoản email nào (đủ SMTP) thì worker gửi bằng tài khoản đó; bật ở tài khoản khác thì cờ cũ tự tắt (trigger),
-- nên luôn chỉ một tài khoản gửi. Không tài khoản nào bật cờ hợp lệ thì dùng khóa cũ notifications.email.sender_account_id.
-- RPC mới public.aka_agent_notification_sender() (chỉ service_role) cho API WebApp; action 'sender' của V457 giữ nguyên.
-- Apply đánh cờ cho đúng tài khoản đang gửi (theo khóa cài đặt) nên không đổi hành vi.
-- auto_accounts là bảng nóng (Desktop/App Server đọc liên tục): ADD COLUMN có DEFAULT hằng nên không viết lại bảng; lock_timeout
-- 3 giây để không xếp hàng chặn người đọc; DDL làm PostgREST nạp lại schema → apply ngoài giờ cao điểm.
-- Desktop có SELECT cấp bảng (select=* vẫn chạy) và chỉ INSERT/UPDATE theo cột nên không bật được cờ.
-- Không đổi worker/snapshot/capture/dispatch (độc lập V465, V466). Kiểm lại số migration trước khi apply.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $v467_preflight$
BEGIN
  IF to_regclass('public.auto_accounts') IS NULL
     OR to_regprocedure('private.aka_agent_notification_setting(text,text)') IS NULL THEN
    RAISE EXCEPTION 'v467: auto_accounts or V457 notification settings missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_accounts'::regclass AND attname = 'is_send_noti_akabiz' AND NOT attisdropped)
     OR to_regprocedure('public.aka_agent_notification_sender()') IS NOT NULL
     OR to_regprocedure('private.aka_agent_notification_sender_exclusive()') IS NOT NULL THEN
    RAISE EXCEPTION 'v467: already applied';
  END IF;
  IF has_table_privilege('aka_agent_desktop', 'public.auto_accounts', 'UPDATE')
     OR has_table_privilege('aka_agent_desktop', 'public.auto_accounts', 'INSERT') THEN
    RAISE EXCEPTION 'v467: aka_agent_desktop has table-level write on auto_accounts; the new flag would be writable from Desktop';
  END IF;
END
$v467_preflight$;

ALTER TABLE public.auto_accounts ADD COLUMN is_send_noti_akabiz boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.auto_accounts.is_send_noti_akabiz IS
  'true = tài khoản email dùng để gửi email thông báo akaBiz. Chỉ một tài khoản: bật ở tài khoản khác thì cờ này tự tắt.';

CREATE FUNCTION private.aka_agent_notification_sender_exclusive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- Chỉ một tài khoản gửi thông báo: bật cờ ở tài khoản này thì tắt ở các tài khoản khác.
  UPDATE public.auto_accounts SET is_send_noti_akabiz = false WHERE is_send_noti_akabiz AND id <> NEW.id;
  RETURN NULL;
END
$$;

CREATE FUNCTION public.aka_agent_notification_sender()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_result jsonb;
BEGIN
  -- Tài khoản email bật cờ is_send_noti_akabiz (đủ SMTP) trước; không có thì tài khoản theo khóa cũ
  -- notifications.email.sender_account_id. Mật khẩu chỉ trả cho worker trên server (chỉ service_role gọi được).
  WITH candidates AS (
    SELECT a.id, a.flatform_type, a.is_delete, a.is_active, a.email_session, 1 AS priority
      FROM public.auto_accounts a WHERE a.is_send_noti_akabiz
    UNION ALL
    SELECT a.id, a.flatform_type, a.is_delete, a.is_active, a.email_session, 2
      FROM public.auto_accounts a
     WHERE a.id = (SELECT CASE WHEN v ~ '^[0-9]{1,18}$' THEN v::bigint END
                     FROM (SELECT btrim(private.aka_agent_notification_setting('notifications.email.sender_account_id', '')) AS v) x)
  )
  SELECT jsonb_build_object('configured', true, 'source', CASE c.priority WHEN 1 THEN 'flag' ELSE 'setting' END, 'accountId', c.id,
           'host', btrim(c.email_session ->> 'host'),
           'port', CASE WHEN (c.email_session ->> 'port') ~ '^[0-9]{1,5}$' THEN (c.email_session ->> 'port')::integer ELSE 587 END,
           'secure', lower(coalesce(c.email_session ->> 'secure', 'false')) = 'true',
           'user', btrim(coalesce(c.email_session ->> 'user', '')), 'pass', c.email_session ->> 'pass',
           'fromEmail', lower(btrim(c.email_session ->> 'fromEmail')),
           'brandName', nullif(btrim(coalesce(c.email_session ->> 'brandName', '')), ''),
           'replyTo', nullif(btrim(coalesce(c.email_session ->> 'replyTo', '')), ''))
    INTO v_result
    FROM candidates c
   WHERE c.flatform_type = 'email' AND c.is_delete IS NOT TRUE AND c.is_active IS NOT FALSE
     AND jsonb_typeof(c.email_session) = 'object'
     AND nullif(btrim(coalesce(c.email_session ->> 'host', '')), '') IS NOT NULL
     AND nullif(btrim(coalesce(c.email_session ->> 'fromEmail', '')), '') IS NOT NULL
     AND nullif(c.email_session ->> 'pass', '') IS NOT NULL
   ORDER BY c.priority, c.id DESC
   LIMIT 1;
  RETURN coalesce(v_result, jsonb_build_object('configured', false));
END
$$;

CREATE TRIGGER trg_aka_agent_notification_sender_exclusive
  AFTER INSERT OR UPDATE OF is_send_noti_akabiz ON public.auto_accounts
  FOR EACH ROW WHEN (NEW.is_send_noti_akabiz) EXECUTE FUNCTION private.aka_agent_notification_sender_exclusive();

REVOKE ALL ON FUNCTION private.aka_agent_notification_sender_exclusive() FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION public.aka_agent_notification_sender() FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_notification_sender() TO service_role;

-- Tài khoản đang gửi (theo khóa cài đặt) được bật cờ để không đổi hành vi.
UPDATE public.auto_accounts a SET is_send_noti_akabiz = true
 WHERE a.id = (SELECT CASE WHEN v ~ '^[0-9]{1,18}$' THEN v::bigint END
                 FROM (SELECT btrim(private.aka_agent_notification_setting('notifications.email.sender_account_id', '')) AS v) x)
   AND a.flatform_type = 'email' AND a.is_delete IS NOT TRUE;

DO $v467_postcheck$
BEGIN
  IF (SELECT format_type(atttypid, atttypmod) || ':' || attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = 'public.auto_accounts'::regclass AND a.attname = 'is_send_noti_akabiz' AND NOT a.attisdropped)
     IS DISTINCT FROM 'boolean:true:false' THEN
    RAISE EXCEPTION 'v467: column shape mismatch';
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_notification_sender()'::regprocedure)) IS DISTINCT FROM '757b286e28d52497aabc81d45fe9fef8'
     OR md5(pg_get_functiondef('private.aka_agent_notification_sender_exclusive()'::regprocedure)) IS DISTINCT FROM '9937edb0d6b26dca7d2407365c60b8d9'
     OR (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.auto_accounts'::regclass
           AND tgname = 'trg_aka_agent_notification_sender_exclusive' AND NOT tgisinternal)
        IS DISTINCT FROM 'CREATE TRIGGER trg_aka_agent_notification_sender_exclusive AFTER INSERT OR UPDATE OF is_send_noti_akabiz ON public.auto_accounts FOR EACH ROW WHEN (new.is_send_noti_akabiz) EXECUTE FUNCTION private.aka_agent_notification_sender_exclusive()' THEN
    RAISE EXCEPTION 'v467: function or trigger mismatch';
  END IF;
  IF (SELECT count(*) FROM public.auto_accounts WHERE is_send_noti_akabiz) > 1 THEN
    RAISE EXCEPTION 'v467: more than one sender flagged';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.aka_agent_notification_sender()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.aka_agent_notification_sender()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aka_agent_notification_sender()', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_notification_sender()', 'EXECUTE')
     OR has_function_privilege('aka_agent_chat_api', 'public.aka_agent_notification_sender()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.aka_agent_notification_sender()'::regprocedure AND a.grantee = 0)
     OR has_column_privilege('aka_agent_desktop', 'public.auto_accounts', 'is_send_noti_akabiz', 'UPDATE')
     OR has_column_privilege('aka_agent_desktop', 'public.auto_accounts', 'is_send_noti_akabiz', 'INSERT')
     OR has_table_privilege('aka_agent_desktop', 'public.auto_accounts', 'SELECT')
        AND NOT has_column_privilege('aka_agent_desktop', 'public.auto_accounts', 'is_send_noti_akabiz', 'SELECT') THEN
    RAISE EXCEPTION 'v467: privilege postcheck failed';
  END IF;
END
$v467_postcheck$;

COMMIT;

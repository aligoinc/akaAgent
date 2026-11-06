-- Rollback V467: bỏ cờ auto_accounts.is_send_noti_akabiz, trigger và RPC aka_agent_notification_sender().
-- Trước khi chạy: đặt notifications.email.sender_account_id đúng tài khoản muốn gửi (sau rollback chỉ còn khóa này).
-- API WebApp mới tự quay về action 'sender' của V457 khi RPC không còn (PGRST202). Apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $v467_rollback_preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_accounts'::regclass AND attname = 'is_send_noti_akabiz' AND NOT attisdropped)
     OR to_regprocedure('public.aka_agent_notification_sender()') IS NULL THEN
    RAISE EXCEPTION 'v467 rollback: V467 not applied';
  END IF;
END
$v467_rollback_preflight$;

DROP TRIGGER trg_aka_agent_notification_sender_exclusive ON public.auto_accounts;
DROP FUNCTION private.aka_agent_notification_sender_exclusive();
DROP FUNCTION public.aka_agent_notification_sender();
ALTER TABLE public.auto_accounts DROP COLUMN is_send_noti_akabiz;

DO $v467_rollback_postcheck$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_accounts'::regclass AND attname = 'is_send_noti_akabiz' AND NOT attisdropped)
     OR to_regprocedure('public.aka_agent_notification_sender()') IS NOT NULL
     OR to_regprocedure('private.aka_agent_notification_sender_exclusive()') IS NOT NULL THEN
    RAISE EXCEPTION 'v467 rollback: postcheck failed';
  END IF;
END
$v467_rollback_postcheck$;

COMMIT;

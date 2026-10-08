-- Linked production: akachat / cgjbsmqtfhqvttudyjzq.
-- Clarify the two notices without changing detection or the 24-hour cooldown.
-- Data only: no schema reload or existing campaign/account state changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $waiting_message_notices$
DECLARE
  before_row jsonb;
  after_row jsonb;
BEGIN
  IF (SELECT count(*) FROM public.auto_error
      WHERE error_code = 'err_limit_waiting_message') <> 1 THEN
    RAISE EXCEPTION 'v357 preflight: expected exactly one waiting-message policy';
  END IF;

  SELECT to_jsonb(p) INTO before_row
  FROM public.auto_error p
  WHERE id = 5 AND error_code = 'err_limit_waiting_message'
  FOR UPDATE;

  IF md5(before_row::text) IS DISTINCT FROM '1d7a519002b4180aa14158db7e80d61e' THEN
    RAISE EXCEPTION 'v357 preflight: live waiting-message policy changed';
  END IF;

  UPDATE public.auto_error
  SET noti_running_process = 'Facebook đang hạn chế nhắn tin cho người lạ.',
      noti_campaign = 'Facebook đang hạn chế nhắn tin cho người lạ. Tạm nghỉ 24 giờ.',
      updated_at = now()
  WHERE id = 5 AND error_code = 'err_limit_waiting_message';

  SELECT to_jsonb(p) INTO after_row
  FROM public.auto_error p WHERE id = 5;

  IF (after_row->>'noti_running_process') IS DISTINCT FROM 'Facebook đang hạn chế nhắn tin cho người lạ.'
     OR (after_row->>'noti_campaign') IS DISTINCT FROM 'Facebook đang hạn chế nhắn tin cho người lạ. Tạm nghỉ 24 giờ.'
     OR (after_row - 'noti_running_process' - 'noti_campaign' - 'updated_at')
        IS DISTINCT FROM (before_row - 'noti_running_process' - 'noti_campaign' - 'updated_at') THEN
    RAISE EXCEPTION 'v357 verification: unexpected policy change';
  END IF;
END;
$waiting_message_notices$;

COMMIT;

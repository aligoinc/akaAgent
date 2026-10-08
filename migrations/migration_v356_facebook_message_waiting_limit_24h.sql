-- Linked production: akachat / cgjbsmqtfhqvttudyjzq.
-- Change the existing waiting-message policy from 60 minutes to 24 hours.
-- Data only: no schema reload, block changes or existing account-state changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $waiting_limit_24h$
DECLARE
  before_row jsonb;
  after_row jsonb;
BEGIN
  IF (SELECT count(*) FROM public.auto_error
      WHERE error_code = 'err_limit_waiting_message') <> 1 THEN
    RAISE EXCEPTION 'v356 preflight: expected exactly one waiting-message policy';
  END IF;

  SELECT to_jsonb(p) INTO before_row
  FROM public.auto_error p
  WHERE id = 5 AND error_code = 'err_limit_waiting_message'
  FOR UPDATE;

  IF md5(before_row::text) IS DISTINCT FROM '6962d5198d9884f148a8affa8f168dfa' THEN
    RAISE EXCEPTION 'v356 preflight: live waiting-message policy changed';
  END IF;

  UPDATE public.auto_error
  SET time_disable_actions = 1440, updated_at = now()
  WHERE id = 5 AND error_code = 'err_limit_waiting_message';

  SELECT to_jsonb(p) INTO after_row
  FROM public.auto_error p WHERE id = 5;

  IF (after_row->>'time_disable_actions')::integer IS DISTINCT FROM 1440
     OR (after_row - 'time_disable_actions' - 'updated_at')
        IS DISTINCT FROM (before_row - 'time_disable_actions' - 'updated_at') THEN
    RAISE EXCEPTION 'v356 verification: unexpected policy change';
  END IF;
END;
$waiting_limit_24h$;

COMMIT;

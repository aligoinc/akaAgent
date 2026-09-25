-- Linked production: cgjbsmqtfhqvttudyjzq. Schema only; no policy/action/campaign writes.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.auto_error IN ACCESS EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid='public.auto_error'::regclass AND conname='auto_error_disable_action_mode_check')
     IS DISTINCT FROM 'CHECK ((disable_action_mode = ANY (ARRAY[''fixed_minutes''::text, ''end_of_day''::text, ''indefinite''::text])))'
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='auto_error' AND column_name IN ('disable_action_days','disable_action_time')) THEN
    RAISE EXCEPTION 'v322 preflight: auto_error schema changed; inspect live before proceeding';
  END IF;
END $preflight$;

ALTER TABLE public.auto_error
  ADD COLUMN disable_action_days integer,
  ADD COLUMN disable_action_time time without time zone,
  DROP CONSTRAINT auto_error_disable_action_mode_check,
  ADD CONSTRAINT auto_error_disable_action_mode_check CHECK (
    disable_action_mode IN ('fixed_minutes','end_of_day','indefinite','days_at_time')
  ),
  ADD CONSTRAINT auto_error_disable_action_days_check CHECK (
    disable_action_days IS NULL OR disable_action_days >= 0
  ),
  ADD CONSTRAINT auto_error_disable_action_time_check CHECK (
    disable_action_time IS NULL OR disable_action_time < time '24:00'
  ),
  ADD CONSTRAINT auto_error_days_at_time_config_check CHECK (
    disable_action_mode <> 'days_at_time' OR (
      disable_action_days IS NOT NULL
      AND time_disable_actions IS NOT NULL AND time_disable_actions > 0
      AND (disable_action_days > 0 OR disable_action_time IS NOT NULL)
    )
  );

COMMENT ON COLUMN public.auto_error.disable_action_days IS
  'days_at_time: nonnegative integer; calendar days in Asia/Ho_Chi_Minh when time is set, otherwise elapsed 24h days.';
COMMENT ON COLUMN public.auto_error.disable_action_time IS
  'days_at_time: local Vietnam unlock time. NULL means elapsed duration; 00:00 is midnight, not NULL. Runtime rejects unlock <= disabled_at.';
-- API metadata changed. Unlike the data-only migration, this requires cache refresh.
NOTIFY pgrst, 'reload schema';
COMMIT;

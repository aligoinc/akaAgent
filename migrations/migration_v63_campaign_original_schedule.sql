-- Add a user-defined schedule anchor for long-running campaigns.
-- Runtime schedule may move forward automatically, while original_schedule keeps
-- the last schedule value explicitly chosen by the user.

BEGIN;

ALTER TABLE public.auto_campaigns
  ADD COLUMN IF NOT EXISTS original_schedule timestamptz;

UPDATE public.auto_campaigns
SET original_schedule = schedule
WHERE original_schedule IS NULL;

UPDATE public.auto_campaigns
SET extra_settings = COALESCE(extra_settings, '{}'::jsonb) - 'findDataRerunOriginalSchedule'
WHERE COALESCE(extra_settings, '{}'::jsonb) ? 'findDataRerunOriginalSchedule';

COMMENT ON COLUMN public.auto_campaigns.original_schedule IS
  'Original schedule chosen by the user; automation may update schedule without changing this value.';

COMMIT;

-- Store why an account action was temporarily disabled so later preflight checks
-- can render the original auto_error campaign notification instead of a generic
-- disabled-action note.

BEGIN;

ALTER TABLE public.auto_account_action_status
  ADD COLUMN IF NOT EXISTS disabled_error_code text,
  ADD COLUMN IF NOT EXISTS disabled_reason text,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auto_account_action_status_disabled_error_code_fkey'
  ) THEN
    ALTER TABLE public.auto_account_action_status
      ADD CONSTRAINT auto_account_action_status_disabled_error_code_fkey
      FOREIGN KEY (disabled_error_code) REFERENCES public.auto_error(error_code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auto_account_action_status_disabled_error
  ON public.auto_account_action_status(disabled_error_code)
  WHERE disabled_error_code IS NOT NULL;

WITH latest_disabled_error AS (
  SELECT DISTINCT ON (aas.id)
    aas.id AS status_id,
    err.error_code,
    detail.log,
    detail.created_at
  FROM public.auto_account_action_status AS aas
  JOIN public.auto_campaign_details AS detail
    ON detail.account_id = aas.account_id
  JOIN public.auto_error AS err
    ON err.error_code = detail.error_code
   AND aas.action_code = ANY(err.disable_action_codes)
  WHERE aas.is_disable = true
    AND aas.disabled_error_code IS NULL
    AND detail.is_delete = false
    AND detail.error_code IS NOT NULL
  ORDER BY aas.id, detail.created_at DESC
)
UPDATE public.auto_account_action_status AS status
SET
  disabled_error_code = latest.error_code,
  disabled_reason = latest.log,
  disabled_at = COALESCE(status.disabled_at, latest.created_at),
  updated_at = now()
FROM latest_disabled_error AS latest
WHERE status.id = latest.status_id;

CREATE OR REPLACE FUNCTION public.enable_due_auto_account_actions()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.auto_account_action_status
  SET is_disable = false,
      date_enable = NULL,
      disabled_error_code = NULL,
      disabled_reason = NULL,
      disabled_at = NULL,
      updated_at = now()
  WHERE is_disable = true
    AND date_enable IS NOT NULL
    AND date_enable <= now();
$$;

COMMENT ON COLUMN public.auto_account_action_status.disabled_error_code IS
  'auto_error.error_code that caused this action to be temporarily disabled.';
COMMENT ON COLUMN public.auto_account_action_status.disabled_reason IS
  'Rendered policy reason at the moment this action was disabled.';
COMMENT ON COLUMN public.auto_account_action_status.disabled_at IS
  'Time when this action was disabled by runtime policy.';

COMMIT;

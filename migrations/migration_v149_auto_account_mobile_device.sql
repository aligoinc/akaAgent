-- Store the mobile device currently bound to an SMS account.
-- Mobile API will use these columns to enforce one mobile device per SMS account.

ALTER TABLE public.auto_accounts
  ADD COLUMN IF NOT EXISTS mobile_device_id text,
  ADD COLUMN IF NOT EXISTS mobile_device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mobile_device_registered_at timestamptz,
  ADD COLUMN IF NOT EXISTS mobile_device_last_seen_at timestamptz;

COMMENT ON COLUMN public.auto_accounts.mobile_device_id IS
  'Device identifier currently bound to this account for mobile app login, mainly SMS accounts.';
COMMENT ON COLUMN public.auto_accounts.mobile_device_info IS
  'Non-secret mobile device metadata, such as platform, model, app version, and OS version.';
COMMENT ON COLUMN public.auto_accounts.mobile_device_registered_at IS
  'Time when the current mobile device was first bound to this account.';
COMMENT ON COLUMN public.auto_accounts.mobile_device_last_seen_at IS
  'Last time the bound mobile device used this account.';

NOTIFY pgrst, 'reload schema';

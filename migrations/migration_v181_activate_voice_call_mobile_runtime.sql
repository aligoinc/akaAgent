-- Run this activation migration only after:
--   1. migration_v180 is deployed,
--   2. akaBizApi voice endpoints are live,
--   3. akaBizSms capability v1 APK is deployed, and
--   4. the compatible akaAgent desktop is deployed.

BEGIN;

UPDATE public.auto_account_actions
SET is_active = true, is_delete = false, updated_at = now()
WHERE code = 'voice_call'
  AND flatform_type = 'sms';

UPDATE public.auto_campaign_actions
SET is_active = true, is_delete = false
WHERE id = 'voice_call'
  AND flatform_type = 'sms';

COMMIT;

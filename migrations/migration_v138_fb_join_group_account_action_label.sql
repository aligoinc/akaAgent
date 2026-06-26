-- Remove platform prefix from the Facebook join group account action label.
-- Keep the campaign action label as "Facebook - Tham gia vào group".

BEGIN;

UPDATE public.auto_account_actions
SET
  name = 'Tham gia group',
  updated_at = now()
WHERE code = 'fb_join_group';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_account_actions
    WHERE code = 'fb_join_group'
      AND name = 'Tham gia group'
  ) THEN
    RAISE EXCEPTION 'fb_join_group account action label was not updated to Tham gia group';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaign_actions
    WHERE id = 'facebook_join_group'
      AND name = 'Facebook - Tham gia vào group'
  ) THEN
    RAISE EXCEPTION 'facebook_join_group campaign action label must remain Facebook - Tham gia vào group';
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

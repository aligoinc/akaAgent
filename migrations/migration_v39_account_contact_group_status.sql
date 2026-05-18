-- Store group join state and post-approval state on account contacts.
-- Existing group contacts are from account scans, so backfill them as joined once.

BEGIN;

ALTER TABLE public.auto_account_contacts
  ADD COLUMN IF NOT EXISTS requires_post_approval boolean;

DO $$
DECLARE
  had_is_joined boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_account_contacts'
      AND column_name = 'is_joined'
  ) INTO had_is_joined;

  ALTER TABLE public.auto_account_contacts
    ADD COLUMN IF NOT EXISTS is_joined boolean NOT NULL DEFAULT false;

  IF NOT had_is_joined THEN
    UPDATE public.auto_account_contacts
    SET is_joined = true
    WHERE contact_type = 'group';
  END IF;
END $$;

COMMENT ON COLUMN public.auto_account_contacts.requires_post_approval IS
  'Group post approval state: true=pending approval, false=no approval needed, null=unknown.';

COMMENT ON COLUMN public.auto_account_contacts.is_joined IS
  'Whether the account is currently confirmed joined to this group by group scan.';

COMMIT;

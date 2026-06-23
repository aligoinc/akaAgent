-- Add purpose to account contact groups so data groups and Zalo friend blocklists
-- can share the same membership table without appearing in each other's UI.

BEGIN;

ALTER TABLE public.auto_account_contact_groups
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'data_group';

UPDATE public.auto_account_contact_groups
SET purpose = 'data_group'
WHERE purpose IS NULL OR purpose = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auto_account_contact_groups_purpose_check'
      AND conrelid = 'public.auto_account_contact_groups'::regclass
  ) THEN
    ALTER TABLE public.auto_account_contact_groups
      ADD CONSTRAINT auto_account_contact_groups_purpose_check
      CHECK (purpose IN ('data_group', 'zalo_friend_blocklist'));
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_auto_account_contact_groups_active_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_account_contact_groups_active_name
  ON public.auto_account_contact_groups (staff_id, account_id, contact_type, purpose, lower(name))
  WHERE is_delete = false;

DROP INDEX IF EXISTS public.idx_auto_account_contact_groups_account_type;

CREATE INDEX IF NOT EXISTS idx_auto_account_contact_groups_account_type
  ON public.auto_account_contact_groups (account_id, contact_type, purpose)
  WHERE is_delete = false;

COMMENT ON COLUMN public.auto_account_contact_groups.purpose IS
  'Group purpose: data_group for normal contact groups, zalo_friend_blocklist for Zalo friend exclusion lists.';

COMMIT;

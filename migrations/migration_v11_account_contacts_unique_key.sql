-- ============================================================
-- Migration v11: Restore contact upsert conflict key
-- - accountContactRepository upserts with ON CONFLICT (account_id, contact_type, uid)
-- - Some migrated databases lost the matching unique constraint during table renames
-- ============================================================

BEGIN;

-- Keep one row per contact key so the unique constraint can be added safely.
WITH ranked_contacts AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY account_id, contact_type, uid
      ORDER BY is_delete ASC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.auto_account_contacts
  WHERE uid IS NOT NULL
)
DELETE FROM public.auto_account_contacts c
USING ranked_contacts r
WHERE c.id = r.id
  AND r.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.auto_account_contacts'::regclass
      AND conname = 'uq_auto_account_contacts_account_type_uid'
  ) THEN
    ALTER TABLE public.auto_account_contacts
      ADD CONSTRAINT uq_auto_account_contacts_account_type_uid
      UNIQUE (account_id, contact_type, uid);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

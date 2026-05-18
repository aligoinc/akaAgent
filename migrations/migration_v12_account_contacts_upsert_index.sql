-- ============================================================
-- Migration v12: Add explicit unique index for Supabase REST upsert
-- - v11 restores the UNIQUE constraint.
-- - This explicit index is harmless if the constraint already exists and can
--   help PostgREST/Supabase REST infer ON CONFLICT columns in migrated schemas.
-- ============================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_account_contacts_upsert_key
  ON public.auto_account_contacts (account_id, contact_type, uid);

NOTIFY pgrst, 'reload schema';

COMMIT;

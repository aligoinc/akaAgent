-- Store raw Zalo phone on shared identity rows.
-- phone_masked was lossy, so existing masked values are intentionally not backfilled.

ALTER TABLE public.zalo_accounts
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.zalo_accounts
  DROP COLUMN IF EXISTS phone_masked;

COMMENT ON COLUMN public.zalo_accounts.phone IS
  'Raw phone number returned by zca-js for the shared Zalo identity when available.';

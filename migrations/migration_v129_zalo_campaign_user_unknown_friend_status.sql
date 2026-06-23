-- Allow Zalo campaign upserts to preserve unknown friend status.
-- Campaign targets may be real Zalo users without an API-confirmed isFr field.

ALTER TABLE public.auto_account_contacts
  ALTER COLUMN is_friend DROP DEFAULT,
  ALTER COLUMN is_friend DROP NOT NULL;

COMMENT ON COLUMN public.auto_account_contacts.is_friend IS
  'Friend status for person contacts. NULL means the current workflow has not received an API-confirmed friend status.';

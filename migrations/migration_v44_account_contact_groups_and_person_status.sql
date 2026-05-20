-- Add contact friend-status support and contact groups.
-- This migration is backward-compatible with old app versions:
-- it does not rewrite existing contact_type='friend' rows.

BEGIN;

ALTER TABLE public.auto_account_contacts
  ADD COLUMN IF NOT EXISTS is_friend boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.auto_account_contacts.is_friend IS
  'Whether this Facebook person is currently confirmed as a friend by the latest friend-list scan.';

CREATE TABLE IF NOT EXISTS public.auto_account_contact_groups (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES public.auto_accounts(id) ON DELETE CASCADE,
  contact_type text NOT NULL,
  name text NOT NULL,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  staff_id bigint,
  organization_id bigint
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_account_contact_groups_active_name
  ON public.auto_account_contact_groups (staff_id, account_id, contact_type, lower(name))
  WHERE is_delete = false;

CREATE INDEX IF NOT EXISTS idx_auto_account_contact_groups_account_type
  ON public.auto_account_contact_groups (account_id, contact_type)
  WHERE is_delete = false;

CREATE TABLE IF NOT EXISTS public.auto_account_contact_group_members (
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES public.auto_account_contact_groups(id) ON DELETE CASCADE,
  contact_id bigint NOT NULL REFERENCES public.auto_account_contacts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_account_contact_group_members_unique
  ON public.auto_account_contact_group_members (group_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_auto_account_contact_group_members_contact
  ON public.auto_account_contact_group_members (contact_id);

COMMENT ON TABLE public.auto_account_contact_groups IS
  'User-created contact groups scoped by account and contact type.';

COMMENT ON TABLE public.auto_account_contact_group_members IS
  'Many-to-many membership between account contact groups and account contacts.';

COMMIT;

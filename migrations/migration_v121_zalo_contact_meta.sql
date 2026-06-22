-- Zalo contact metadata scoped by auto account.
-- Zalo user/group ids returned by zca-js are account-scoped for contact scans,
-- so uniqueness is always (account_id, zalo_uid/group_id), never global.

BEGIN;

CREATE TABLE IF NOT EXISTS public.zalo_users (
  id bigint GENERATED ALWAYS AS IDENTITY,
  account_id bigint NOT NULL REFERENCES public.auto_accounts(id) ON DELETE CASCADE,
  zalo_uid text NOT NULL,
  user_id text,
  username text,
  display_name text,
  zalo_name text,
  avatar text,
  bgavatar text,
  cover text,
  gender integer,
  dob bigint,
  sdob text,
  status text,
  phone_number text,
  is_fr integer,
  is_blocked integer,
  last_action_time bigint,
  last_update_time bigint,
  is_active integer,
  key integer,
  type integer,
  is_active_pc integer,
  is_active_web integer,
  is_valid integer,
  user_key text,
  account_status integer,
  oa_info jsonb,
  user_mode integer,
  global_id text,
  biz_pkg jsonb,
  created_ts bigint,
  oa_status jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  staff_id bigint,
  organization_id bigint,
  CONSTRAINT zalo_users_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zalo_users_account_uid
  ON public.zalo_users(account_id, zalo_uid);

CREATE INDEX IF NOT EXISTS idx_zalo_users_account_updated_at
  ON public.zalo_users(account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_zalo_users_staff_account
  ON public.zalo_users(staff_id, account_id);

CREATE TABLE IF NOT EXISTS public.zalo_groups (
  id bigint GENERATED ALWAYS AS IDENTITY,
  account_id bigint NOT NULL REFERENCES public.auto_accounts(id) ON DELETE CASCADE,
  zalo_group_id text NOT NULL,
  name text,
  description text,
  group_type integer,
  creator_uid text,
  version text,
  avatar text,
  full_avatar text,
  member_ids text[] NOT NULL DEFAULT '{}'::text[],
  admin_ids text[] NOT NULL DEFAULT '{}'::text[],
  current_mems jsonb,
  update_mems jsonb,
  admins jsonb,
  has_more_member integer,
  sub_type integer,
  total_member integer,
  max_member integer,
  setting jsonb,
  created_time bigint,
  visibility integer,
  global_id text,
  e2ee integer,
  extra_info jsonb,
  mem_ver_list text[] NOT NULL DEFAULT '{}'::text[],
  pending_approve jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  staff_id bigint,
  organization_id bigint,
  CONSTRAINT zalo_groups_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zalo_groups_account_group_id
  ON public.zalo_groups(account_id, zalo_group_id);

CREATE INDEX IF NOT EXISTS idx_zalo_groups_account_updated_at
  ON public.zalo_groups(account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_zalo_groups_staff_account
  ON public.zalo_groups(staff_id, account_id);

CREATE INDEX IF NOT EXISTS idx_zalo_groups_member_ids
  ON public.zalo_groups USING gin(member_ids);

ALTER TABLE public.auto_account_contacts
  ADD COLUMN IF NOT EXISTS zalo_user_id bigint,
  ADD COLUMN IF NOT EXISTS zalo_group_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auto_account_contacts_zalo_user_id_fkey'
  ) THEN
    ALTER TABLE public.auto_account_contacts
      ADD CONSTRAINT auto_account_contacts_zalo_user_id_fkey
      FOREIGN KEY (zalo_user_id)
      REFERENCES public.zalo_users(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auto_account_contacts_zalo_group_id_fkey'
  ) THEN
    ALTER TABLE public.auto_account_contacts
      ADD CONSTRAINT auto_account_contacts_zalo_group_id_fkey
      FOREIGN KEY (zalo_group_id)
      REFERENCES public.zalo_groups(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auto_account_contacts_zalo_user_id
  ON public.auto_account_contacts(zalo_user_id);

CREATE INDEX IF NOT EXISTS idx_auto_account_contacts_zalo_group_id
  ON public.auto_account_contacts(zalo_group_id);

COMMENT ON TABLE public.zalo_users IS
  'Account-scoped Zalo friend/user metadata collected through zca-js contact scans.';
COMMENT ON TABLE public.zalo_groups IS
  'Account-scoped Zalo group metadata collected through zca-js contact scans.';
COMMENT ON COLUMN public.zalo_users.zalo_uid IS
  'Zalo user id as observed by this auto account. It is not a global identity key.';
COMMENT ON COLUMN public.zalo_groups.zalo_group_id IS
  'Zalo group id as observed by this auto account. It is not a global identity key.';
COMMENT ON COLUMN public.zalo_users.raw_payload IS
  'Audit copy of the raw zca-js user payload; app queries should use named columns.';
COMMENT ON COLUMN public.zalo_groups.raw_payload IS
  'Audit copy of the raw zca-js group payload; app queries should use named columns.';

NOTIFY pgrst, 'reload schema';

COMMIT;

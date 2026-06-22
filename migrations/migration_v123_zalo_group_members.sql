BEGIN;

ALTER TABLE public.zalo_groups
  ADD COLUMN IF NOT EXISTS status integer;

COMMENT ON COLUMN public.zalo_groups.status IS
  'Raw Zalo group status returned by the legacy getmg endpoint.';

CREATE TABLE IF NOT EXISTS public.zalo_group_members (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES public.auto_accounts(id) ON DELETE CASCADE,
  user_id bigint REFERENCES public.zalo_users(id) ON DELETE SET NULL,
  group_id bigint REFERENCES public.zalo_groups(id) ON DELETE SET NULL,
  zalo_uid text NOT NULL,
  zalo_group_id text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  role_rank integer NOT NULL DEFAULT 3,
  is_creator boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false,
  is_current boolean NOT NULL DEFAULT true,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  staff_id bigint,
  organization_id bigint,
  CONSTRAINT zalo_group_members_role_check CHECK (role IN ('owner', 'admin', 'member')),
  CONSTRAINT zalo_group_members_role_rank_check CHECK (role_rank IN (1, 2, 3))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zalo_group_members_account_group_user
  ON public.zalo_group_members(account_id, zalo_group_id, zalo_uid);

CREATE INDEX IF NOT EXISTS idx_zalo_group_members_group
  ON public.zalo_group_members(account_id, zalo_group_id)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_zalo_group_members_user
  ON public.zalo_group_members(account_id, zalo_uid);

CREATE INDEX IF NOT EXISTS idx_zalo_group_members_group_id
  ON public.zalo_group_members(group_id)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_zalo_group_members_user_id
  ON public.zalo_group_members(user_id);

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES (
  'zalo.group_link.ginfo_proxy_url',
  '',
  'Optional proxy URL used only for direct Zalo group link ginfo requests when Zalo returns an empty member page without proxy.',
  true,
  true
)
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  is_secret = EXCLUDED.is_secret,
  is_active = EXCLUDED.is_active,
  updated_at = now();

COMMENT ON TABLE public.zalo_group_members IS
  'Account-scoped membership metadata for Zalo users in Zalo groups.';

COMMENT ON COLUMN public.zalo_group_members.user_id IS
  'Internal FK to zalo_users.id. The external Zalo UID remains in zalo_uid for direct queries.';

COMMENT ON COLUMN public.zalo_group_members.group_id IS
  'Internal FK to zalo_groups.id. The external Zalo group id remains in zalo_group_id for direct queries.';

NOTIFY pgrst, 'reload schema';

COMMIT;

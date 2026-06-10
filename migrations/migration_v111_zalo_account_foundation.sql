-- Zalo account foundation:
-- - zalo_accounts stores shared Zalo identity only (deduped globally by zalo_uid).
-- - auto_accounts keeps per-staff/per-auto-account session credentials.
-- - Campaign execution is intentionally not enabled in this migration.

CREATE TABLE IF NOT EXISTS public.zalo_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY,
  zalo_uid text NOT NULL,
  display_name text,
  phone text,
  avatar_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zalo_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT zalo_accounts_zalo_uid_key UNIQUE (zalo_uid)
);

CREATE INDEX IF NOT EXISTS idx_zalo_accounts_updated_at
  ON public.zalo_accounts(updated_at DESC);

COMMENT ON TABLE public.zalo_accounts IS
  'Shared global Zalo identity catalog. Runtime credentials are intentionally stored on auto_accounts.';
COMMENT ON COLUMN public.zalo_accounts.zalo_uid IS
  'Stable Zalo user id used to dedupe identity globally across staff/organizations.';
COMMENT ON COLUMN public.zalo_accounts.phone IS
  'Raw phone number returned by zca-js for the shared Zalo identity when available.';
COMMENT ON COLUMN public.zalo_accounts.metadata IS
  'Non-secret profile metadata returned by zca-js. Do not store session/cookie credentials here.';

ALTER TABLE public.auto_accounts
  ADD COLUMN IF NOT EXISTS zalo_account_id bigint,
  ADD COLUMN IF NOT EXISTS zalo_session jsonb,
  ADD COLUMN IF NOT EXISTS zalo_session_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS zalo_session_last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS zalo_session_last_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auto_accounts_zalo_account_id_fkey'
  ) THEN
    ALTER TABLE public.auto_accounts
      ADD CONSTRAINT auto_accounts_zalo_account_id_fkey
      FOREIGN KEY (zalo_account_id)
      REFERENCES public.zalo_accounts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auto_accounts_zalo_account_id
  ON public.auto_accounts(zalo_account_id);

COMMENT ON COLUMN public.auto_accounts.zalo_account_id IS
  'FK to shared Zalo identity. Multiple auto_accounts may point to the same Zalo identity.';
COMMENT ON COLUMN public.auto_accounts.zalo_session IS
  'Per-auto-account zca-js credentials/session. Secret data; never expose to renderer account lists.';
COMMENT ON COLUMN public.auto_accounts.zalo_session_updated_at IS
  'Last time zca-js credentials were stored for this auto account.';
COMMENT ON COLUMN public.auto_accounts.zalo_session_last_verified_at IS
  'Last successful zca-js session verification time.';
COMMENT ON COLUMN public.auto_accounts.zalo_session_last_error IS
  'Last zca-js login/check error for this auto account.';

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES
  ('zalo', 'Zalo - Kết bạn', 'zalo_add_friend'),
  ('zalo', 'Zalo - Thêm thành viên vào group', 'zalo_add_group_member'),
  ('zalo', 'Zalo - Tìm SĐT', 'zalo_find_phone_user'),
  ('zalo', 'Zalo - Gửi tin nhắn đến bạn bè', 'zalo_message_friend'),
  ('zalo', 'Zalo - Gửi tin nhắn đến group', 'zalo_message_group'),
  ('zalo', 'Zalo - Gửi tin nhắn đến người lạ', 'zalo_message_stranger'),
  ('zalo', 'Zalo - Tham gia vào group', 'zalo_join_group'),
  ('zalo', 'Zalo - Gắn tag', 'zalo_tag_contact'),
  ('zalo', 'Zalo - Đổi tên', 'zalo_change_alias')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

-- ============================================================
-- Migration v78: Account groups and group-level action limits
-- - Adds account groups with shared sleep/limit settings.
-- - Accounts can belong to at most one group.
-- - Backfills campaign sleep into extra_settings.actionLimits.sleepBetweenActions
--   and removes the legacy time_sleep_between_2 column.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.auto_account_groups (
  id BIGSERIAL PRIMARY KEY,
  name text NOT NULL,
  flatform_type text NOT NULL DEFAULT 'facebook',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS auto_account_groups_staff_platform_name_unique
  ON public.auto_account_groups(staff_id, flatform_type, lower(name))
  WHERE is_delete = false;

CREATE INDEX IF NOT EXISTS idx_auto_account_groups_staff_platform
  ON public.auto_account_groups(staff_id, flatform_type)
  WHERE is_delete = false;

ALTER TABLE public.auto_accounts
  ADD COLUMN IF NOT EXISTS account_group_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auto_accounts_account_group_id_fkey'
  ) THEN
    ALTER TABLE public.auto_accounts
      ADD CONSTRAINT auto_accounts_account_group_id_fkey
      FOREIGN KEY (account_group_id)
      REFERENCES public.auto_account_groups(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auto_accounts_account_group_id
  ON public.auto_accounts(account_group_id)
  WHERE is_delete = false;

CREATE OR REPLACE FUNCTION public.prevent_delete_account_group_with_accounts()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.is_delete = false AND NEW.is_delete = true) THEN
    IF EXISTS (
      SELECT 1
      FROM public.auto_accounts a
      WHERE a.account_group_id = OLD.id
        AND a.is_delete = false
    ) THEN
      RAISE EXCEPTION 'Không thể xoá nhóm account khi còn tài khoản đang dùng nhóm này';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_delete_account_group_with_accounts ON public.auto_account_groups;
CREATE TRIGGER trg_prevent_delete_account_group_with_accounts
  BEFORE DELETE OR UPDATE OF is_delete ON public.auto_account_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delete_account_group_with_accounts();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_campaigns'
      AND column_name = 'time_sleep_between_2'
  ) THEN
    UPDATE public.auto_campaigns
    SET extra_settings = jsonb_set(
      jsonb_set(
        COALESCE(extra_settings, '{}'::jsonb),
        '{actionLimits}',
        COALESCE(extra_settings->'actionLimits', '{}'::jsonb),
        true
      ),
      '{actionLimits,sleepBetweenActions}',
      to_jsonb(COALESCE(time_sleep_between_2, 0)),
      true
    )
    WHERE NOT (
      COALESCE(extra_settings, '{}'::jsonb) ? 'actionLimits'
      AND COALESCE(extra_settings->'actionLimits', '{}'::jsonb) ? 'sleepBetweenActions'
    );

    ALTER TABLE public.auto_campaigns
      DROP COLUMN IF EXISTS time_sleep_between_2;
  END IF;
END $$;

COMMIT;

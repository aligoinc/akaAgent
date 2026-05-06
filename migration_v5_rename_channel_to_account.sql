-- ============================================================
-- Migration v5: Rename channel schema to account schema
-- - org_channels / org_accounts -> auto_accounts
-- - org_channel_contacts / org_account_contacts -> auto_account_contacts
-- - channel_id columns -> account_id columns
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.auto_accounts') IS NULL THEN
    IF to_regclass('public.org_accounts') IS NOT NULL THEN
      ALTER TABLE public.org_accounts RENAME TO auto_accounts;
    ELSIF to_regclass('public.org_channels') IS NOT NULL THEN
      ALTER TABLE public.org_channels RENAME TO auto_accounts;
    END IF;
  END IF;

  IF to_regclass('public.auto_account_contacts') IS NULL THEN
    IF to_regclass('public.org_account_contacts') IS NOT NULL THEN
      ALTER TABLE public.org_account_contacts RENAME TO auto_account_contacts;
    ELSIF to_regclass('public.org_channel_contacts') IS NOT NULL THEN
      ALTER TABLE public.org_channel_contacts RENAME TO auto_account_contacts;
    END IF;
  END IF;

  IF to_regclass('public.auto_accounts_id_seq') IS NULL THEN
    IF to_regclass('public.org_accounts_id_seq') IS NOT NULL THEN
      ALTER SEQUENCE public.org_accounts_id_seq RENAME TO auto_accounts_id_seq;
    ELSIF to_regclass('public.org_channels_id_seq') IS NOT NULL THEN
      ALTER SEQUENCE public.org_channels_id_seq RENAME TO auto_accounts_id_seq;
    END IF;
  END IF;

  IF to_regclass('public.auto_account_contacts_id_seq') IS NULL THEN
    IF to_regclass('public.org_account_contacts_id_seq') IS NOT NULL THEN
      ALTER SEQUENCE public.org_account_contacts_id_seq RENAME TO auto_account_contacts_id_seq;
    ELSIF to_regclass('public.org_channel_contacts_id_seq') IS NOT NULL THEN
      ALTER SEQUENCE public.org_channel_contacts_id_seq RENAME TO auto_account_contacts_id_seq;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaigns' AND column_name = 'channel_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaigns' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.auto_campaigns RENAME COLUMN channel_id TO account_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_detail_actions' AND column_name = 'channel_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_detail_actions' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.auto_campaign_detail_actions RENAME COLUMN channel_id TO account_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_account_contacts' AND column_name = 'channel_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_account_contacts' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.auto_account_contacts RENAME COLUMN channel_id TO account_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_v2_runs' AND column_name = 'channel_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_v2_runs' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.auto_v2_runs RENAME COLUMN channel_id TO account_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_result_actions' AND column_name = 'channel_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_campaign_result_actions' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE public.auto_campaign_result_actions RENAME COLUMN channel_id TO account_id;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.auto_accounts') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_channels_pkey') THEN
      ALTER TABLE public.auto_accounts RENAME CONSTRAINT org_channels_pkey TO auto_accounts_pkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_accounts_pkey') THEN
      ALTER TABLE public.auto_accounts RENAME CONSTRAINT org_accounts_pkey TO auto_accounts_pkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_channels_staff_id_fkey') THEN
      ALTER TABLE public.auto_accounts RENAME CONSTRAINT org_channels_staff_id_fkey TO auto_accounts_staff_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_accounts_staff_id_fkey') THEN
      ALTER TABLE public.auto_accounts RENAME CONSTRAINT org_accounts_staff_id_fkey TO auto_accounts_staff_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_channels_organization_id_fkey') THEN
      ALTER TABLE public.auto_accounts RENAME CONSTRAINT org_channels_organization_id_fkey TO auto_accounts_organization_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_accounts_organization_id_fkey') THEN
      ALTER TABLE public.auto_accounts RENAME CONSTRAINT org_accounts_organization_id_fkey TO auto_accounts_organization_id_fkey;
    END IF;
  END IF;

  IF to_regclass('public.auto_account_contacts') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_channel_contacts_pkey') THEN
      ALTER TABLE public.auto_account_contacts RENAME CONSTRAINT org_channel_contacts_pkey TO auto_account_contacts_pkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_account_contacts_pkey') THEN
      ALTER TABLE public.auto_account_contacts RENAME CONSTRAINT org_account_contacts_pkey TO auto_account_contacts_pkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_org_channel_contacts_channel_type_uid') THEN
      ALTER TABLE public.auto_account_contacts RENAME CONSTRAINT uq_org_channel_contacts_channel_type_uid TO uq_auto_account_contacts_account_type_uid;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_org_account_contacts_account_type_uid') THEN
      ALTER TABLE public.auto_account_contacts RENAME CONSTRAINT uq_org_account_contacts_account_type_uid TO uq_auto_account_contacts_account_type_uid;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_channel_contacts_staff_id_fkey') THEN
      ALTER TABLE public.auto_account_contacts RENAME CONSTRAINT org_channel_contacts_staff_id_fkey TO auto_account_contacts_staff_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_account_contacts_staff_id_fkey') THEN
      ALTER TABLE public.auto_account_contacts RENAME CONSTRAINT org_account_contacts_staff_id_fkey TO auto_account_contacts_staff_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_channel_contacts_organization_id_fkey') THEN
      ALTER TABLE public.auto_account_contacts RENAME CONSTRAINT org_channel_contacts_organization_id_fkey TO auto_account_contacts_organization_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_account_contacts_organization_id_fkey') THEN
      ALTER TABLE public.auto_account_contacts RENAME CONSTRAINT org_account_contacts_organization_id_fkey TO auto_account_contacts_organization_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_channel_contacts_channel_id_fkey') THEN
      ALTER TABLE public.auto_account_contacts RENAME CONSTRAINT org_channel_contacts_channel_id_fkey TO auto_account_contacts_account_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_account_contacts_account_id_fkey') THEN
      ALTER TABLE public.auto_account_contacts RENAME CONSTRAINT org_account_contacts_account_id_fkey TO auto_account_contacts_account_id_fkey;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaigns_channel_id_fkey') THEN
    ALTER TABLE public.auto_campaigns RENAME CONSTRAINT auto_campaigns_channel_id_fkey TO auto_campaigns_account_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_detail_actions_channel_id_fkey') THEN
    ALTER TABLE public.auto_campaign_detail_actions RENAME CONSTRAINT auto_campaign_detail_actions_channel_id_fkey TO auto_campaign_detail_actions_account_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_result_actions_channel_id_fkey') THEN
    ALTER TABLE public.auto_campaign_result_actions RENAME CONSTRAINT auto_campaign_result_actions_channel_id_fkey TO auto_campaign_result_actions_account_id_fkey;
  END IF;
END $$;

ALTER INDEX IF EXISTS public.org_channels_staff_id_idx RENAME TO auto_accounts_staff_id_idx;
ALTER INDEX IF EXISTS public.org_accounts_staff_id_idx RENAME TO auto_accounts_staff_id_idx;
ALTER INDEX IF EXISTS public.org_channel_contacts_staff_id_idx RENAME TO auto_account_contacts_staff_id_idx;
ALTER INDEX IF EXISTS public.org_account_contacts_staff_id_idx RENAME TO auto_account_contacts_staff_id_idx;
ALTER INDEX IF EXISTS public.idx_org_channel_contacts_channel_type RENAME TO idx_auto_account_contacts_account_type;
ALTER INDEX IF EXISTS public.idx_org_account_contacts_account_type RENAME TO idx_auto_account_contacts_account_type;
ALTER INDEX IF EXISTS public.idx_result_actions_channel_id RENAME TO idx_result_actions_account_id;
ALTER INDEX IF EXISTS public.idx_result_actions_rate_limit RENAME TO idx_result_actions_rate_limit_account;

COMMENT ON COLUMN public.auto_accounts.staff_id IS 'Staff owner for this account (main filter)';
COMMENT ON COLUMN public.auto_accounts.organization_id IS 'Owning organization (audit / future cross-staff sharing)';

NOTIFY pgrst, 'reload schema';

COMMIT;

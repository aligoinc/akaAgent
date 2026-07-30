-- Add the configuration-only secondary account contract for supported campaigns.
-- Runtime fallback/claim behavior is intentionally introduced by a later migration.

BEGIN;

ALTER TABLE public.auto_campaign_actions
  ADD COLUMN IF NOT EXISTS allow_secondary_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.auto_campaign_actions.allow_secondary_account IS
  'Whether campaigns of this action may configure one fallback account.';

UPDATE public.auto_campaign_actions
SET allow_secondary_account = true
WHERE id IN (
  'facebook_group_post',
  'facebook_message_uid',
  'zalo_message_phone'
);

ALTER TABLE public.auto_campaigns
  ADD COLUMN IF NOT EXISTS secondary_account_id bigint;

COMMENT ON COLUMN public.auto_campaigns.secondary_account_id IS
  'Optional configured fallback account id; intentionally not a foreign key while legacy clients still embed auto_accounts without a relationship hint.';

-- Do not add a second auto_campaigns -> auto_accounts foreign key. Legacy app
-- versions embed auto_accounts without a relationship hint, so a second FK
-- makes every such PostgREST query ambiguous.
ALTER TABLE public.auto_campaigns
  DROP CONSTRAINT IF EXISTS auto_campaigns_secondary_account_id_fkey;

ALTER TABLE public.auto_campaigns
  DROP CONSTRAINT IF EXISTS auto_campaigns_secondary_account_diff_check;

ALTER TABLE public.auto_campaigns
  ADD CONSTRAINT auto_campaigns_secondary_account_diff_check
  CHECK (
    secondary_account_id IS NULL
    OR secondary_account_id IS DISTINCT FROM account_id
  );

CREATE INDEX IF NOT EXISTS idx_auto_campaigns_secondary_account_id
  ON public.auto_campaigns (secondary_account_id)
  WHERE secondary_account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;

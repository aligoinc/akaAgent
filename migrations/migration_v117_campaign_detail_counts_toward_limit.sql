-- Add nullable per-detail limit counting override.
-- NULL keeps the legacy rule: count statuses "thành công" and "thất bại".
-- TRUE/FALSE is an explicit runtime decision.

BEGIN;

ALTER TABLE public.auto_campaign_details
  ADD COLUMN IF NOT EXISTS counts_toward_limit boolean;

COMMENT ON COLUMN public.auto_campaign_details.counts_toward_limit IS
  'Nullable per-detail action limit override. NULL uses legacy status rule; TRUE/FALSE is explicit runtime decision.';

COMMIT;

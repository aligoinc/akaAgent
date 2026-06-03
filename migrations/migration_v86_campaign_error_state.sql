-- Campaign-scoped consecutive bad target tracking.
-- Counts bad targets per campaign, independent from account/action error state.

BEGIN;

CREATE TABLE IF NOT EXISTS public.auto_campaign_error_state (
  id BIGSERIAL PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES public.auto_campaigns(id) ON DELETE CASCADE,
  count_consecutive_bad_targets integer NOT NULL DEFAULT 0,
  last_input_data_id bigint REFERENCES public.auto_campaign_input_data(id) ON DELETE SET NULL,
  last_reason text,
  last_bad_target_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_campaign_error_state_campaign_unique UNIQUE (campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_auto_campaign_error_state_campaign
  ON public.auto_campaign_error_state(campaign_id);

COMMENT ON TABLE public.auto_campaign_error_state IS
  'Campaign-scoped consecutive bad target counter for stopping after repeated failures/errors.';

COMMENT ON COLUMN public.auto_campaign_error_state.count_consecutive_bad_targets IS
  'Consecutive target/input runs that had at least one campaign_detail thất bại/lỗi or runtime error.';

COMMIT;

BEGIN;

ALTER TABLE public.auto_campaigns
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_auto_campaigns_last_run_at
  ON public.auto_campaigns (staff_id, last_run_at)
  WHERE is_delete = false;

CREATE OR REPLACE FUNCTION public.aka_agent_touch_campaign_last_run_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_detail_at timestamptz := COALESCE(NEW.created_at, now());
BEGIN
  IF NEW.campaign_id IS NULL OR COALESCE(NEW.is_delete, false) THEN
    RETURN NEW;
  END IF;

  UPDATE public.auto_campaigns
  SET last_run_at = v_detail_at,
      updated_at = now()
  WHERE id = NEW.campaign_id
    AND is_delete = false
    AND (last_run_at IS NULL OR last_run_at < v_detail_at);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_touch_campaign_last_run_at ON public.auto_campaign_details;
CREATE TRIGGER trg_aka_agent_touch_campaign_last_run_at
  AFTER INSERT OR UPDATE ON public.auto_campaign_details
  FOR EACH ROW
  EXECUTE FUNCTION public.aka_agent_touch_campaign_last_run_at();

COMMENT ON COLUMN public.auto_campaigns.last_run_at IS
  'Latest non-deleted auto_campaign_details.created_at recorded for this campaign.';

NOTIFY pgrst, 'reload schema';

COMMIT;

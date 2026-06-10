-- Raw Zalo API error logs for campaign debugging.
-- This table is intentionally internal/debug-only and does not replace
-- auto_campaign_details, which remains the user-facing action history.

BEGIN;

CREATE TABLE IF NOT EXISTS public.auto_zalo_api_error_logs (
  id bigserial PRIMARY KEY,
  staff_id bigint,
  organization_id bigint,
  account_id bigint,
  campaign_id bigint,
  campaign_input_data_id bigint,
  campaign_detail_id bigint,
  action_code text,
  action_name text,
  api_name text,
  zalo_error_code text,
  zalo_error_message text,
  normalized_error_code text,
  detail_status text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_error jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.auto_zalo_api_error_logs IS
  'Internal raw Zalo API error logs captured while running Zalo campaigns.';
COMMENT ON COLUMN public.auto_zalo_api_error_logs.request_payload IS
  'Best-effort request/context payload for the failed Zalo API call. Secrets are redacted by application code.';
COMMENT ON COLUMN public.auto_zalo_api_error_logs.target_payload IS
  'Best-effort target payload such as found Zalo user, phone, label, or alias context.';
COMMENT ON COLUMN public.auto_zalo_api_error_logs.raw_error IS
  'Best-effort raw error object from zca-js/Zalo API. Secrets are redacted by application code.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_zalo_api_error_logs_staff_id_fkey') THEN
    ALTER TABLE public.auto_zalo_api_error_logs
      ADD CONSTRAINT auto_zalo_api_error_logs_staff_id_fkey
      FOREIGN KEY (staff_id) REFERENCES public.org_staff(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_zalo_api_error_logs_organization_id_fkey') THEN
    ALTER TABLE public.auto_zalo_api_error_logs
      ADD CONSTRAINT auto_zalo_api_error_logs_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.org_organization(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_zalo_api_error_logs_account_id_fkey') THEN
    ALTER TABLE public.auto_zalo_api_error_logs
      ADD CONSTRAINT auto_zalo_api_error_logs_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.auto_accounts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_zalo_api_error_logs_campaign_id_fkey') THEN
    ALTER TABLE public.auto_zalo_api_error_logs
      ADD CONSTRAINT auto_zalo_api_error_logs_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.auto_campaigns(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_zalo_api_error_logs_campaign_input_data_id_fkey') THEN
    ALTER TABLE public.auto_zalo_api_error_logs
      ADD CONSTRAINT auto_zalo_api_error_logs_campaign_input_data_id_fkey
      FOREIGN KEY (campaign_input_data_id) REFERENCES public.auto_campaign_input_data(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_zalo_api_error_logs_campaign_detail_id_fkey') THEN
    ALTER TABLE public.auto_zalo_api_error_logs
      ADD CONSTRAINT auto_zalo_api_error_logs_campaign_detail_id_fkey
      FOREIGN KEY (campaign_detail_id) REFERENCES public.auto_campaign_details(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_zalo_api_error_logs_campaign_created
  ON public.auto_zalo_api_error_logs(campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_zalo_api_error_logs_account_created
  ON public.auto_zalo_api_error_logs(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_zalo_api_error_logs_zalo_code
  ON public.auto_zalo_api_error_logs(zalo_error_code);

CREATE INDEX IF NOT EXISTS idx_zalo_api_error_logs_normalized_code
  ON public.auto_zalo_api_error_logs(normalized_error_code);

UPDATE public.auto_error
SET
  noti_running_process = '[a] thất bại: [x]',
  noti_campaign = '[a] thất bại: [x]',
  updated_at = now()
WHERE error_code = 'err_zalo_api_business_failed'
  AND is_delete = false;

COMMIT;

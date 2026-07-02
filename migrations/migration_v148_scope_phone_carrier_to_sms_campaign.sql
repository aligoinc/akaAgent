COMMENT ON COLUMN public.auto_campaign_input_data.phone_carrier IS
  'Vietnam mobile carrier code inferred from phone prefix for sms_send campaign input data only.';

UPDATE public.auto_campaign_input_data data
SET phone_carrier = NULL
FROM public.auto_campaigns campaign
WHERE data.campaign_id = campaign.id
  AND campaign.action_id <> 'sms_send'
  AND data.phone_carrier IS NOT NULL;

BEGIN;

DELETE FROM public.ai_personalization;
ALTER TABLE public.ai_personalization ALTER COLUMN id RESTART WITH 1;

INSERT INTO public.ai_personalization (
  source_table,
  source_column,
  text_symbol,
  description,
  is_system,
  is_active
)
VALUES
  ('auto_campaign_input_data', 'name', '{{name}}', 'Input data name.', true, true),
  ('auto_campaign_input_data', 'uid', '{{uid}}', 'Input data UID or target URL.', true, true),
  ('auto_campaign_input_data', 'email', '{{email}}', 'Input data email.', true, true),
  ('auto_campaign_input_data', 'phone', '{{phone}}', 'Input data phone.', true, true),
  ('auto_accounts', 'name', '{{account_name}}', 'Running account name.', true, true);

COMMIT;

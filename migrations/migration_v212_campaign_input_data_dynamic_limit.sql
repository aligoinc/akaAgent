BEGIN;

INSERT INTO public.auto_system_settings (
  key,
  value,
  description,
  is_secret,
  is_active
)
VALUES (
  'campaign.input_data.max_rows',
  '10000',
  'So luong data toi da khi nguoi dung tao mot chien dich.',
  false,
  true
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

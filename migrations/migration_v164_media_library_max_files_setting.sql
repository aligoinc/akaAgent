BEGIN;

INSERT INTO public.auto_system_settings (
  key,
  value,
  description,
  is_secret,
  is_active
)
VALUES (
  'media.so_luong_file_toi_da',
  '10000',
  'So luong file toi da trong thu vien media cua moi nhan vien.',
  false,
  true
)
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  is_secret = EXCLUDED.is_secret,
  is_active = EXCLUDED.is_active,
  updated_at = now();

COMMIT;

-- Standardize the Media Library quota at 1,000 active files per staff.
-- Existing media is preserved; users already over quota cannot upload more files.

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
  '1000',
  'So luong file toi da trong thu vien media cua moi nhan vien.',
  false,
  true
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  is_secret = EXCLUDED.is_secret,
  is_active = EXCLUDED.is_active,
  updated_at = now();

COMMIT;

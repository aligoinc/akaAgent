-- Store login preferences per staff account and desktop device.
CREATE TABLE IF NOT EXISTS public.auto_staff_device_login_settings (
  id bigint GENERATED ALWAYS AS IDENTITY,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint REFERENCES public.org_organization(id),
  device_fingerprint_hash text NOT NULL,
  device_label text,
  device_platform text,
  remember_login boolean NOT NULL DEFAULT true,
  auto_login boolean NOT NULL DEFAULT false,
  startup_enabled boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  last_used_at timestamptz,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_staff_device_login_settings_pkey PRIMARY KEY (id),
  CONSTRAINT auto_staff_device_login_settings_staff_device_unique UNIQUE (staff_id, device_fingerprint_hash),
  CONSTRAINT auto_staff_device_login_settings_auto_requires_remember CHECK (auto_login = false OR remember_login = true)
);

CREATE INDEX IF NOT EXISTS idx_auto_staff_device_login_settings_device
  ON public.auto_staff_device_login_settings (device_fingerprint_hash, updated_at DESC)
  WHERE is_delete = false;

CREATE INDEX IF NOT EXISTS idx_auto_staff_device_login_settings_staff
  ON public.auto_staff_device_login_settings (staff_id, updated_at DESC)
  WHERE is_delete = false;

COMMENT ON TABLE public.auto_staff_device_login_settings IS
  'Per-staff, per-device desktop login preferences for remember login, auto login, and OS startup.';

COMMENT ON COLUMN public.auto_staff_device_login_settings.device_fingerprint_hash IS
  'SHA-256 hash from the desktop device identity service. Matches org_staff.device_fingerprint_hash.';

COMMENT ON COLUMN public.auto_staff_device_login_settings.remember_login IS
  'If true, the login screen can prefill credentials for this staff on this device.';

COMMENT ON COLUMN public.auto_staff_device_login_settings.auto_login IS
  'If true, the desktop app can login automatically for this staff on this device.';

COMMENT ON COLUMN public.auto_staff_device_login_settings.startup_enabled IS
  'DB source of truth for Electron open-at-login on this desktop device.';

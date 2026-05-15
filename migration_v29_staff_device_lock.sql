-- Lock each org_staff login to a single desktop device.
ALTER TABLE public.org_staff
  ADD COLUMN IF NOT EXISTS device_fingerprint_hash text,
  ADD COLUMN IF NOT EXISTS device_label text,
  ADD COLUMN IF NOT EXISTS device_platform text,
  ADD COLUMN IF NOT EXISTS device_bound_at timestamptz,
  ADD COLUMN IF NOT EXISTS device_last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS org_staff_device_fingerprint_hash_idx
  ON public.org_staff (device_fingerprint_hash)
  WHERE device_fingerprint_hash IS NOT NULL;

COMMENT ON COLUMN public.org_staff.device_fingerprint_hash IS
  'SHA-256 hash of platform + OS machine ID. Limits one staff login to one computer.';
COMMENT ON COLUMN public.org_staff.device_label IS
  'Friendly local device label such as platform + hostname.';
COMMENT ON COLUMN public.org_staff.device_platform IS
  'Desktop platform that bound the login, e.g. mac or win.';
COMMENT ON COLUMN public.org_staff.device_bound_at IS
  'When this staff account was first bound to the current device.';
COMMENT ON COLUMN public.org_staff.device_last_seen_at IS
  'Last successful login/check-in from the bound device.';

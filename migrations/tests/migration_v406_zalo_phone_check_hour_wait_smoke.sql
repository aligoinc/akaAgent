-- Run after the seed, inside a rollback transaction for pre-apply verification.
DO $smoke$
BEGIN
  IF (SELECT count(*) FROM public.auto_system_settings
      WHERE key = 'zalo.phone_check.hour_limit_wait_minutes'
        AND value = '60' AND is_active AND NOT is_secret) <> 1 THEN
    RAISE EXCEPTION 'V406 default setting/flags do not match';
  END IF;
END;
$smoke$;
SET LOCAL ROLE anon;
SELECT 1 / count(*)::int AS anon_can_read FROM public.auto_system_settings
WHERE key = 'zalo.phone_check.hour_limit_wait_minutes' AND value = '60';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT 1 / count(*)::int AS authenticated_can_read FROM public.auto_system_settings
WHERE key = 'zalo.phone_check.hour_limit_wait_minutes' AND value = '60';
RESET ROLE;

-- v430: Use the exact user-provided Vietnamese/English profile menu XPath.
-- Source: akachat auto_elements id 1536, captured 2026-10-25.
-- Already applied to akachat: 20261025153625 / migration_v430_facebook_identity_menu_xpath.
-- Do not reapply on merge or release; this file records the deployed change.
-- Data-only: no schema/RPC/block/workflow changes or PostgREST reload.
-- Restart the desktop app after apply to clear the element cache.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $identity_menu_xpath$
DECLARE
  v_row jsonb;
  v_xpath constant text := $xpath$//*[@role='button' and (@aria-label='Trang cá nhân của bạn' or @aria-label='Account, your profile')]$xpath$;
BEGIN
  SELECT to_jsonb(e) INTO v_row
  FROM public.auto_elements e
  WHERE id = 1536 AND name = 'FbIdentityMenuButton'
  FOR UPDATE;

  IF v_row IS NULL OR md5(v_row::text) IS DISTINCT FROM '80b9dcb41eb4ffc1d22384a6cb742db5' THEN
    RAISE EXCEPTION 'v430 live FbIdentityMenuButton changed; recapture before applying';
  END IF;

  UPDATE public.auto_elements
  SET xpath = v_xpath, updated_at = now()
  WHERE id = 1536 AND name = 'FbIdentityMenuButton';

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements e
    WHERE id = 1536 AND xpath = v_xpath
      AND (to_jsonb(e) - 'xpath' - 'updated_at') = (v_row - 'xpath' - 'updated_at')
  ) THEN
    RAISE EXCEPTION 'v430 FbIdentityMenuButton postflight failed';
  END IF;
END;
$identity_menu_xpath$;
COMMIT;

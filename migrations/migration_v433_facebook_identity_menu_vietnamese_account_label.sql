-- v433: Add the exact Vietnamese account/profile label supplied by the user.
-- Source: akachat auto_elements id 1536, captured 2026-10-27.
-- Already applied to akachat: 20261027092222 / migration_v433_facebook_identity_menu_vietnamese_account_label.
-- Do not reapply on merge or release; this file records the deployed change.
-- Data-only: no schema/RPC/block/workflow changes or PostgREST reload.
-- Restart the desktop app after apply to clear the element cache.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $identity_menu_xpath$
DECLARE
  v_row jsonb;
  v_xpath constant text := $xpath$//*[@role='button' and (@aria-label='Trang cá nhân của bạn' or @aria-label='Tài khoản, trang cá nhân của bạn' or @aria-label='Account, your profile')]$xpath$;
BEGIN
  SELECT to_jsonb(e) INTO v_row
  FROM public.auto_elements e
  WHERE id = 1536 AND name = 'FbIdentityMenuButton'
  FOR UPDATE;

  IF v_row IS NULL OR md5(v_row::text) IS DISTINCT FROM '3ebd648adf7a77977d285c1a262a565f' THEN
    RAISE EXCEPTION 'v433 live FbIdentityMenuButton changed; recapture before applying';
  END IF;

  UPDATE public.auto_elements
  SET xpath = v_xpath, updated_at = now()
  WHERE id = 1536 AND name = 'FbIdentityMenuButton';

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements e
    WHERE id = 1536 AND xpath = v_xpath
      AND (to_jsonb(e) - 'xpath' - 'updated_at') = (v_row - 'xpath' - 'updated_at')
  ) THEN
    RAISE EXCEPTION 'v433 FbIdentityMenuButton postflight failed';
  END IF;
END;
$identity_menu_xpath$;
COMMIT;

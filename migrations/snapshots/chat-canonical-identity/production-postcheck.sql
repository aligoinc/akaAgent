BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
DO $positive$
DECLARE n public.auto_accounts; o public.auto_accounts; alternate bigint; caller_name text; sig text;
BEGIN
  SELECT * INTO o FROM public.auto_accounts WHERE id=192;
  n:=o; n.is_akachat_enabled:=true;
  PERFORM private.app_access_validate_account(n,o);
  -- A live unbound duplicate remains rejected; only copies of rows are passed.
  n.login_status:='đã đăng nhập';
  BEGIN
    PERFORM private.app_access_validate_account(n,o);
    RAISE EXCEPTION 'identity_trial_expected_live_duplicate_rejection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zalo_already_linked' THEN RAISE; END IF;
  END;
  SELECT * INTO o FROM public.auto_accounts WHERE id=1159;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.chat_zalo_account_organization WHERE auto_account_id=o.id)
    THEN RAISE EXCEPTION 'identity_trial_bound_fixture_changed'; END IF;
  SELECT z.id INTO alternate FROM public.zalo_accounts z WHERE z.id<>o.zalo_account_id ORDER BY z.id LIMIT 1;
  IF alternate IS NULL THEN RAISE EXCEPTION 'identity_trial_alternate_missing'; END IF;
  o.is_akachat_enabled:=false; n:=o; n.is_akachat_enabled:=true; n.zalo_account_id:=alternate;
  PERFORM private.app_access_validate_account(n,o);
  n.login_status:='đã đăng nhập';
  PERFORM private.app_access_validate_account(n,o);
  FOREACH caller_name IN ARRAY ARRAY['anon','authenticated','aka_agent_desktop','aka_agent_chat_api','service_role'] LOOP
    FOREACH sig IN ARRAY ARRAY['private.app_access_validate_account(auto_accounts,auto_accounts)','private.app_access_reserve_enabled_identity()'] LOOP
      IF has_function_privilege(caller_name,sig,'EXECUTE') THEN RAISE EXCEPTION 'identity_trial_private_acl_changed'; END IF;
    END LOOP;
  END LOOP;
END $positive$;
SELECT jsonb_build_object('validatorAndPreservedGuardsPassed',true,'rowCopiesOnly',true) postcheck;
ROLLBACK;

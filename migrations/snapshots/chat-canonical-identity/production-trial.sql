-- Diagnostic transaction only; no business row DML. Always ends ROLLBACK.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
CREATE TEMP TABLE identity_trial_before ON COMMIT DROP AS SELECT jsonb_build_object(
  'flags',(SELECT md5(string_agg(concat_ws(':',id,is_aka_agent_enabled,is_akachat_enabled),',' ORDER BY id)) FROM public.auto_accounts),
  'staffFlags',(SELECT md5(string_agg(concat_ws(':',id,is_aka_agent_enabled,is_akachat_enabled),',' ORDER BY id)) FROM public.org_staff),
  'bindings',(SELECT md5(string_agg(concat_ws(':',id,organization_id,auto_account_id,chat_zalo_account_id,is_active,runtime_generation),',' ORDER BY id)) FROM public.chat_zalo_account_organization),
  'otherFunctions',(SELECT md5(string_agg(concat_ws(':',p.oid,md5(pg_get_functiondef(p.oid)),p.proowner,p.proacl,p.proconfig,p.prosecdef,p.provolatile,p.procost),',' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname IN ('public','private') AND p.prokind='f' AND p.oid NOT IN ('private.app_access_validate_account(auto_accounts,auto_accounts)'::regprocedure,'private.app_access_reserve_enabled_identity()'::regprocedure))
) x;
DO $negative$
DECLARE n public.auto_accounts; o public.auto_accounts;
BEGIN
  SELECT * INTO o FROM public.auto_accounts WHERE id=192;
  IF o.id IS NULL OR o.is_akachat_enabled OR o.login_status IS DISTINCT FROM 'chưa đăng nhập'
    OR EXISTS(SELECT 1 FROM public.chat_zalo_account_organization WHERE auto_account_id=o.id)
    THEN RAISE EXCEPTION 'identity_trial_fixture_changed'; END IF;
  n:=o; n.is_akachat_enabled:=true;
  BEGIN
    PERFORM private.app_access_validate_account(n,o);
    RAISE EXCEPTION 'identity_trial_expected_old_rejection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zalo_already_linked' THEN RAISE; END IF;
  END;
END $negative$;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_chat_identity(bigint,bigint,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'e1b81ef404854cd4290496a9dfc0ff46'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_preflight_drift: private.app_access_reserve_chat_identity(bigint,bigint,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_enabled_identity()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'ddc0b1c0b4e11534cc5e8a403ec07158'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_preflight_drift: private.app_access_reserve_enabled_identity()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(auto_accounts,auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'bb948da088b5a8be76f9516e08255a14'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_preflight_drift: private.app_access_validate_account(auto_accounts,auto_accounts)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_flags()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'aacbeba11f54e46705182d61915ff928'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_preflight_drift: private.app_access_guard_flags()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '8366eb0aafe73f700214ff9c80542876'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_preflight_drift: aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION private.app_access_validate_account(n auto_accounts, o auto_accounts DEFAULT NULL::auto_accounts)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE owner_row public.org_staff%ROWTYPE; q jsonb; used integer; app_name text; assigned boolean; previous boolean; uid text; binding_org bigint;
BEGIN
  SELECT * INTO owner_row FROM public.org_staff WHERE id=n.staff_id;
  IF NOT public.aka_agent_app_access_separate(owner_row.organization_id) OR COALESCE(n.is_delete,false) THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account:'||n.staff_id::text,0));
  FOREACH app_name IN ARRAY ARRAY['akaAgent','akaChat'] LOOP
    assigned:=CASE app_name WHEN 'akaAgent' THEN n.is_aka_agent_enabled ELSE n.is_akachat_enabled END;
    previous:=CASE app_name WHEN 'akaAgent' THEN o.is_aka_agent_enabled ELSE o.is_akachat_enabled END;
    IF NOT assigned OR (previous AND NOT COALESCE(o.is_delete,false)
      AND o.staff_id=n.staff_id AND o.organization_id IS NOT DISTINCT FROM n.organization_id
      AND o.flatform_type IS NOT DISTINCT FROM n.flatform_type
      AND o.is_zalo_show_web IS NOT DISTINCT FROM n.is_zalo_show_web
      AND o.is_zalo_server IS NOT DISTINCT FROM n.is_zalo_server) THEN CONTINUE; END IF;
    -- Server Chat can be granted by an authorized actor while its owner is locked/expired.
    -- Agent and local QR still require an active, unexpired owner; keep tenant/deletion guards.
    IF owner_row.id IS NULL OR owner_row.deleted_at IS NOT NULL
      OR (n.organization_id IS NOT NULL AND n.organization_id IS DISTINCT FROM owner_row.organization_id)
      OR ((app_name='akaAgent' OR NOT COALESCE(n.is_zalo_server,false))
        AND NOT private.app_access_staff_time_allowed(owner_row.id))
      THEN RAISE EXCEPTION 'app_access_denied'; END IF;
    q:=private.app_access_quota(owner_row.organization_id,n.staff_id,app_name,'account',lower(n.flatform_type));
    IF NOT (q->>'hasPackage')::boolean THEN RAISE EXCEPTION 'app_access_package_required'; END IF;
    SELECT count(*) INTO used FROM public.auto_accounts a WHERE a.staff_id=n.staff_id AND a.id IS DISTINCT FROM n.id
      AND NOT COALESCE(a.is_delete,false) AND (a.organization_id IS NULL OR a.organization_id=owner_row.organization_id)
      AND CASE app_name WHEN 'akaAgent' THEN a.is_aka_agent_enabled AND lower(a.flatform_type)=lower(n.flatform_type) ELSE a.is_akachat_enabled END;
    IF q->>'limit' IS NOT NULL AND used >= (q->>'limit')::integer THEN RAISE EXCEPTION 'app_access_account_limit'; END IF;
    IF app_name='akaAgent' THEN
      IF NOT public.aka_agent_app_access_staff_allowed(n.staff_id,'akaAgent') THEN RAISE EXCEPTION 'app_access_owner_agent_required'; END IF;
      IF lower(n.flatform_type)='zalo' AND NOT EXISTS(SELECT 1 FROM private.resolve_organization_zalo_entitlement_pools(owner_row.organization_id) p
        WHERE p.entitlement_id IS NOT NULL AND p.account_subtype=CASE WHEN n.is_zalo_show_web THEN 'web' WHEN n.is_zalo_server THEN 'server' ELSE 'qr' END)
        THEN RAISE EXCEPTION 'zalo_account_capability_unavailable'; END IF;
    ELSE
      IF lower(n.flatform_type)<>'zalo' OR COALESCE(n.is_zalo_show_web,false) THEN RAISE EXCEPTION 'app_access_zalo_only'; END IF;
      IF NOT COALESCE(n.is_zalo_server,false) AND NOT public.aka_agent_app_access_staff_allowed(n.staff_id,'akaAgent')
        THEN RAISE EXCEPTION 'app_access_local_reader_required'; END IF;
      -- Match the Chat account list: a retained Chat binding is the canonical identity.
      SELECT z.zalo_id,b.organization_id INTO uid,binding_org
        FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
        WHERE b.auto_account_id=n.id;
      IF FOUND THEN
        IF binding_org IS DISTINCT FROM owner_row.organization_id THEN RAISE EXCEPTION 'app_access_denied'; END IF;
      ELSIF n.login_status='đã đăng nhập' THEN
        -- Unbound, live sessions still reserve their identity atomically on enable.
        -- Logged-out legacy IDs are stale metadata, not a completed Chat link.
        SELECT z.zalo_uid INTO uid FROM public.zalo_accounts z WHERE z.id=n.zalo_account_id;
      END IF;
      IF uid IS NOT NULL THEN
        -- Same identity lock as Chat API QR completion, never another UNIQUE or identity record.
        PERFORM pg_advisory_xact_lock(hashtextextended(owner_row.organization_id::text||':'||uid,0));
        IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
          JOIN public.auto_accounts bound ON bound.id=b.auto_account_id
          WHERE b.organization_id=owner_row.organization_id AND z.zalo_id=uid AND b.auto_account_id<>n.id AND NOT COALESCE(bound.is_delete,false))
          THEN RAISE EXCEPTION 'zalo_already_linked'; END IF;
        IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
          WHERE b.auto_account_id=n.id AND z.zalo_id<>uid) THEN RAISE EXCEPTION 'account_already_has_another_zalo'; END IF;
      END IF;
    END IF;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION private.app_access_reserve_enabled_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE org bigint;
BEGIN
  SELECT organization_id INTO org FROM public.org_staff WHERE id=NEW.staff_id;
  IF EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.organization_id=org AND r.target_type='initialize'
    AND r.status='processing' AND r.result->>'transactionId'=pg_current_xact_id()::text) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.is_akachat_enabled IS NOT DISTINCT FROM OLD.is_akachat_enabled
    AND NEW.zalo_account_id IS NOT DISTINCT FROM OLD.zalo_account_id
    AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
    AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id AND NEW.login_status IS NOT DISTINCT FROM OLD.login_status
    THEN RETURN NEW; END IF;
  IF public.aka_agent_app_access_separate(org) AND NEW.is_akachat_enabled AND NOT COALESCE(NEW.is_delete,false)
    AND NEW.zalo_account_id IS NOT NULL AND NEW.login_status='đã đăng nhập' THEN
    -- A flag-only toggle must not reinterpret a retained binding from legacy metadata.
    -- Real login/identity/owner/tenant changes and undelete keep the reservation guard.
    IF TG_OP='UPDATE' AND NEW.is_akachat_enabled IS DISTINCT FROM OLD.is_akachat_enabled
      AND NEW.zalo_account_id IS NOT DISTINCT FROM OLD.zalo_account_id
      AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
      AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id AND NEW.login_status IS NOT DISTINCT FROM OLD.login_status
      AND NEW.zalo_session IS NOT DISTINCT FROM OLD.zalo_session
      AND EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b WHERE b.auto_account_id=NEW.id AND b.organization_id=org)
      THEN RETURN NEW; END IF;
    PERFORM private.app_access_reserve_chat_identity(NEW.id,org,NEW.zalo_account_id);
  END IF;
  RETURN NEW;
END $function$;

DO $postflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_chat_identity(bigint,bigint,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'e1b81ef404854cd4290496a9dfc0ff46'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_postflight_drift: private.app_access_reserve_chat_identity(bigint,bigint,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_enabled_identity()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '66a710beb5d36f03d16d4684fd1a5385'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_postflight_drift: private.app_access_reserve_enabled_identity()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(auto_accounts,auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'f9f8f66c263a45c7196808f1781a64cf'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_postflight_drift: private.app_access_validate_account(auto_accounts,auto_accounts)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_flags()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'aacbeba11f54e46705182d61915ff928'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_postflight_drift: private.app_access_guard_flags()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '8366eb0aafe73f700214ff9c80542876'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_postflight_drift: aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)';
  END IF;
END $postflight$;


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
CREATE TEMP TABLE identity_trial_after ON COMMIT DROP AS SELECT jsonb_build_object(
  'flags',(SELECT md5(string_agg(concat_ws(':',id,is_aka_agent_enabled,is_akachat_enabled),',' ORDER BY id)) FROM public.auto_accounts),
  'staffFlags',(SELECT md5(string_agg(concat_ws(':',id,is_aka_agent_enabled,is_akachat_enabled),',' ORDER BY id)) FROM public.org_staff),
  'bindings',(SELECT md5(string_agg(concat_ws(':',id,organization_id,auto_account_id,chat_zalo_account_id,is_active,runtime_generation),',' ORDER BY id)) FROM public.chat_zalo_account_organization),
  'otherFunctions',(SELECT md5(string_agg(concat_ws(':',p.oid,md5(pg_get_functiondef(p.oid)),p.proowner,p.proacl,p.proconfig,p.prosecdef,p.provolatile,p.procost),',' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname IN ('public','private') AND p.prokind='f' AND p.oid NOT IN ('private.app_access_validate_account(auto_accounts,auto_accounts)'::regprocedure,'private.app_access_reserve_enabled_identity()'::regprocedure))
) x;
DO $unchanged$ BEGIN
  IF (SELECT x FROM identity_trial_before) IS DISTINCT FROM (SELECT x FROM identity_trial_after)
    THEN RAISE EXCEPTION 'identity_trial_data_or_dependency_changed'; END IF;
END $unchanged$;
SELECT jsonb_build_object('candidateValidated',true,'rowCopiesOnly',true,
  'businessDataAndOtherFunctionsUnchanged',true,'candidateChecksums',(SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) FROM pg_proc p WHERE p.oid=ANY(ARRAY['private.app_access_reserve_chat_identity(bigint,bigint,bigint)'::regprocedure,'private.app_access_reserve_enabled_identity()'::regprocedure,'private.app_access_validate_account(auto_accounts,auto_accounts)'::regprocedure,'private.app_access_guard_flags()'::regprocedure,'aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)'::regprocedure]))) rehearsal;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $rollback_preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_chat_identity(bigint,bigint,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'e1b81ef404854cd4290496a9dfc0ff46'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_rollback_preflight_drift: private.app_access_reserve_chat_identity(bigint,bigint,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_enabled_identity()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '66a710beb5d36f03d16d4684fd1a5385'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_rollback_preflight_drift: private.app_access_reserve_enabled_identity()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(auto_accounts,auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'f9f8f66c263a45c7196808f1781a64cf'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_rollback_preflight_drift: private.app_access_validate_account(auto_accounts,auto_accounts)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_flags()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'aacbeba11f54e46705182d61915ff928'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_rollback_preflight_drift: private.app_access_guard_flags()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '8366eb0aafe73f700214ff9c80542876'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_rollback_preflight_drift: aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)';
  END IF;
END $rollback_preflight$;

CREATE OR REPLACE FUNCTION private.app_access_reserve_enabled_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE org bigint;
BEGIN
  SELECT organization_id INTO org FROM public.org_staff WHERE id=NEW.staff_id;
  IF EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.organization_id=org AND r.target_type='initialize'
    AND r.status='processing' AND r.result->>'transactionId'=pg_current_xact_id()::text) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.is_akachat_enabled IS NOT DISTINCT FROM OLD.is_akachat_enabled
    AND NEW.zalo_account_id IS NOT DISTINCT FROM OLD.zalo_account_id
    AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
    AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id AND NEW.login_status IS NOT DISTINCT FROM OLD.login_status
    THEN RETURN NEW; END IF;
  IF public.aka_agent_app_access_separate(org) AND NEW.is_akachat_enabled AND NOT COALESCE(NEW.is_delete,false)
    AND NEW.zalo_account_id IS NOT NULL AND NEW.login_status='đã đăng nhập' THEN
    PERFORM private.app_access_reserve_chat_identity(NEW.id,org,NEW.zalo_account_id);
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private.app_access_validate_account(n auto_accounts, o auto_accounts DEFAULT NULL::auto_accounts)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE owner_row public.org_staff%ROWTYPE; q jsonb; used integer; app_name text; assigned boolean; previous boolean; uid text;
BEGIN
  SELECT * INTO owner_row FROM public.org_staff WHERE id=n.staff_id;
  IF NOT public.aka_agent_app_access_separate(owner_row.organization_id) OR COALESCE(n.is_delete,false) THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account:'||n.staff_id::text,0));
  FOREACH app_name IN ARRAY ARRAY['akaAgent','akaChat'] LOOP
    assigned:=CASE app_name WHEN 'akaAgent' THEN n.is_aka_agent_enabled ELSE n.is_akachat_enabled END;
    previous:=CASE app_name WHEN 'akaAgent' THEN o.is_aka_agent_enabled ELSE o.is_akachat_enabled END;
    IF NOT assigned OR (previous AND NOT COALESCE(o.is_delete,false)
      AND o.staff_id=n.staff_id AND o.organization_id IS NOT DISTINCT FROM n.organization_id
      AND o.flatform_type IS NOT DISTINCT FROM n.flatform_type
      AND o.is_zalo_show_web IS NOT DISTINCT FROM n.is_zalo_show_web
      AND o.is_zalo_server IS NOT DISTINCT FROM n.is_zalo_server) THEN CONTINUE; END IF;
    -- Server Chat can be granted by an authorized actor while its owner is locked/expired.
    -- Agent and local QR still require an active, unexpired owner; keep tenant/deletion guards.
    IF owner_row.id IS NULL OR owner_row.deleted_at IS NOT NULL
      OR (n.organization_id IS NOT NULL AND n.organization_id IS DISTINCT FROM owner_row.organization_id)
      OR ((app_name='akaAgent' OR NOT COALESCE(n.is_zalo_server,false))
        AND NOT private.app_access_staff_time_allowed(owner_row.id))
      THEN RAISE EXCEPTION 'app_access_denied'; END IF;
    q:=private.app_access_quota(owner_row.organization_id,n.staff_id,app_name,'account',lower(n.flatform_type));
    IF NOT (q->>'hasPackage')::boolean THEN RAISE EXCEPTION 'app_access_package_required'; END IF;
    SELECT count(*) INTO used FROM public.auto_accounts a WHERE a.staff_id=n.staff_id AND a.id IS DISTINCT FROM n.id
      AND NOT COALESCE(a.is_delete,false) AND (a.organization_id IS NULL OR a.organization_id=owner_row.organization_id)
      AND CASE app_name WHEN 'akaAgent' THEN a.is_aka_agent_enabled AND lower(a.flatform_type)=lower(n.flatform_type) ELSE a.is_akachat_enabled END;
    IF q->>'limit' IS NOT NULL AND used >= (q->>'limit')::integer THEN RAISE EXCEPTION 'app_access_account_limit'; END IF;
    IF app_name='akaAgent' THEN
      IF NOT public.aka_agent_app_access_staff_allowed(n.staff_id,'akaAgent') THEN RAISE EXCEPTION 'app_access_owner_agent_required'; END IF;
      IF lower(n.flatform_type)='zalo' AND NOT EXISTS(SELECT 1 FROM private.resolve_organization_zalo_entitlement_pools(owner_row.organization_id) p
        WHERE p.entitlement_id IS NOT NULL AND p.account_subtype=CASE WHEN n.is_zalo_show_web THEN 'web' WHEN n.is_zalo_server THEN 'server' ELSE 'qr' END)
        THEN RAISE EXCEPTION 'zalo_account_capability_unavailable'; END IF;
    ELSE
      IF lower(n.flatform_type)<>'zalo' OR COALESCE(n.is_zalo_show_web,false) THEN RAISE EXCEPTION 'app_access_zalo_only'; END IF;
      IF NOT COALESCE(n.is_zalo_server,false) AND NOT public.aka_agent_app_access_staff_allowed(n.staff_id,'akaAgent')
        THEN RAISE EXCEPTION 'app_access_local_reader_required'; END IF;
      SELECT z.zalo_uid INTO uid FROM public.zalo_accounts z WHERE z.id=n.zalo_account_id;
      IF uid IS NOT NULL THEN
        -- Same identity lock as Chat API QR completion, never another UNIQUE or identity record.
        PERFORM pg_advisory_xact_lock(hashtextextended(owner_row.organization_id::text||':'||uid,0));
        IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
          JOIN public.auto_accounts bound ON bound.id=b.auto_account_id
          WHERE b.organization_id=owner_row.organization_id AND z.zalo_id=uid AND b.auto_account_id<>n.id AND NOT COALESCE(bound.is_delete,false))
          THEN RAISE EXCEPTION 'zalo_already_linked'; END IF;
        IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
          WHERE b.auto_account_id=n.id AND z.zalo_id<>uid) THEN RAISE EXCEPTION 'account_already_has_another_zalo'; END IF;
      END IF;
    END IF;
  END LOOP;
END $function$;

DO $rollback_postflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_chat_identity(bigint,bigint,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'e1b81ef404854cd4290496a9dfc0ff46'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_rollback_postflight_drift: private.app_access_reserve_chat_identity(bigint,bigint,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_enabled_identity()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'ddc0b1c0b4e11534cc5e8a403ec07158'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_rollback_postflight_drift: private.app_access_reserve_enabled_identity()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(auto_accounts,auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'bb948da088b5a8be76f9516e08255a14'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_rollback_postflight_drift: private.app_access_validate_account(auto_accounts,auto_accounts)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_flags()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'aacbeba11f54e46705182d61915ff928'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_rollback_postflight_drift: private.app_access_guard_flags()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '8366eb0aafe73f700214ff9c80542876'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_canonical_identity_rollback_postflight_drift: aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)';
  END IF;
END $rollback_postflight$;


DO $negative$
DECLARE n public.auto_accounts; o public.auto_accounts;
BEGIN
  SELECT * INTO o FROM public.auto_accounts WHERE id=192;
  IF o.id IS NULL OR o.is_akachat_enabled OR o.login_status IS DISTINCT FROM 'chưa đăng nhập'
    OR EXISTS(SELECT 1 FROM public.chat_zalo_account_organization WHERE auto_account_id=o.id)
    THEN RAISE EXCEPTION 'identity_trial_fixture_changed'; END IF;
  n:=o; n.is_akachat_enabled:=true;
  BEGIN
    PERFORM private.app_access_validate_account(n,o);
    RAISE EXCEPTION 'identity_trial_expected_old_rejection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zalo_already_linked' THEN RAISE; END IF;
  END;
END $negative$;
ROLLBACK;

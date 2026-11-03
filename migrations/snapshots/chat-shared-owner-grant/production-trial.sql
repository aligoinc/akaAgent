BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE v450_routines_before ON COMMIT DROP AS
 SELECT p.oid,md5(pg_get_functiondef(p.oid)) checksum,p.proowner,p.proacl::text,p.prosecdef,p.provolatile,p.proconfig
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p');
CREATE TEMP TABLE v450_flags_before ON COMMIT DROP AS
 SELECT id,is_aka_agent_enabled,is_akachat_enabled,
   public.aka_agent_app_access_account_allowed(id,'akaAgent') agent_allowed,
   public.aka_agent_app_access_account_allowed(id,'akaChat') chat_allowed
 FROM auto_accounts WHERE organization_id=1;
CREATE TEMP TABLE v450_cases(id bigint PRIMARY KEY,server boolean,baseline_denied boolean,target_allowed boolean) ON COMMIT DROP;
DO $before$
DECLARE n public.auto_accounts%ROWTYPE; o public.auto_accounts%ROWTYPE; denied boolean;
BEGIN
 FOR n IN SELECT * FROM auto_accounts WHERE id IN (2666,3359,4949,4992,4993,4994,7025) ORDER BY id LOOP
  o:=n; o.is_akachat_enabled:=false; denied:=false;
  BEGIN
   PERFORM private.app_access_validate_account(n,o);
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'app_access_denied' THEN RAISE; END IF;
   denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Baseline did not reproduce denial for %',n.id; END IF;
  INSERT INTO v450_cases VALUES(n.id,n.is_zalo_server,denied,NULL);
 END LOOP;
 IF (SELECT count(*) FROM v450_cases)<>7 THEN RAISE EXCEPTION 'Probe data drift'; END IF;
END $before$;

-- V450: allow Chat Server grants for locked/expired owners; preserve Agent/local QR guards.
-- Exact live source: ff633bcc1b189376d584685f1b6decf7; target: bb948da088b5a8be76f9516e08255a14.
-- No data writes, grants, schema reload or changes to V449/activation/auth.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(public.auto_accounts,public.auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'ff633bcc1b189376d584685f1b6decf7'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_shared_owner_grant_preflight_drift: inspect live body/owner/ACL/config';
  END IF;
END $preflight$;

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

DO $postflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(public.auto_accounts,public.auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'bb948da088b5a8be76f9516e08255a14'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_shared_owner_grant_postflight_drift: inspect live body/owner/ACL/config';
  END IF;
END $postflight$;


DO $after$
DECLARE n public.auto_accounts%ROWTYPE; o public.auto_accounts%ROWTYPE; allowed boolean; caller_name text;
BEGIN
 FOR n IN SELECT a.* FROM auto_accounts a JOIN v450_cases c ON c.id=a.id ORDER BY a.id LOOP
  o:=n; o.is_akachat_enabled:=false; allowed:=true;
  BEGIN
   PERFORM private.app_access_validate_account(n,o);
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'app_access_denied' THEN RAISE; END IF;
   allowed:=false;
  END;
  IF allowed IS DISTINCT FROM n.is_zalo_server THEN RAISE EXCEPTION 'Unexpected grant result for %',n.id; END IF;
  UPDATE v450_cases SET target_allowed=allowed WHERE id=n.id;
 END LOOP;
 IF EXISTS(SELECT 1 FROM v450_flags_before b JOIN auto_accounts a USING(id)
   WHERE b.is_aka_agent_enabled IS DISTINCT FROM a.is_aka_agent_enabled OR b.is_akachat_enabled IS DISTINCT FROM a.is_akachat_enabled
     OR b.agent_allowed IS DISTINCT FROM public.aka_agent_app_access_account_allowed(a.id,'akaAgent')
     OR b.chat_allowed IS DISTINCT FROM public.aka_agent_app_access_account_allowed(a.id,'akaChat')) THEN
  RAISE EXCEPTION 'Account flags or effective permissions changed'; END IF;
 IF EXISTS(SELECT 1 FROM v450_routines_before b JOIN pg_proc p ON p.oid=b.oid
   WHERE p.oid<>'private.app_access_validate_account(auto_accounts,auto_accounts)'::regprocedure
     AND (b.checksum IS DISTINCT FROM md5(pg_get_functiondef(p.oid)) OR b.proowner IS DISTINCT FROM p.proowner
       OR b.proacl IS DISTINCT FROM p.proacl::text OR b.prosecdef IS DISTINCT FROM p.prosecdef
       OR b.provolatile IS DISTINCT FROM p.provolatile OR b.proconfig IS DISTINCT FROM p.proconfig)) THEN
  RAISE EXCEPTION 'Unrelated function changed'; END IF;
 FOREACH caller_name IN ARRAY ARRAY['service_role','aka_agent_chat_api','aka_agent_desktop','anon','authenticated'] LOOP
  IF has_function_privilege(caller_name,'private.app_access_validate_account(auto_accounts,auto_accounts)','EXECUTE') THEN
   RAISE EXCEPTION 'Private helper exposed to %',caller_name; END IF;
 END LOOP;
 FOREACH caller_name IN ARRAY ARRAY['service_role','aka_agent_chat_api','aka_agent_desktop'] LOOP
  IF NOT has_function_privilege(caller_name,'public.aka_agent_app_access(bigint,text,text,text,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'Public entrypoint denied to %',caller_name; END IF;
 END LOOP;
END $after$;
SELECT jsonb_build_object('trial_only',true,'routines_checked',(SELECT count(*) FROM v450_routines_before),
 'accounts_checked',(SELECT count(*) FROM v450_flags_before),'cases',(SELECT jsonb_agg(c ORDER BY id) FROM v450_cases c),
 'target_checksum',md5(pg_get_functiondef('private.app_access_validate_account(auto_accounts,auto_accounts)'::regprocedure))) rehearsal;

-- Narrow V450 rollback only. Requires explicit authorization; V449 remains applied.
-- Exact live source: bb948da088b5a8be76f9516e08255a14; target: ff633bcc1b189376d584685f1b6decf7.
-- No data writes, grants, schema reload or changes to V449/activation/auth.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(public.auto_accounts,public.auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'bb948da088b5a8be76f9516e08255a14'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_shared_owner_grant_preflight_drift: inspect live body/owner/ACL/config';
  END IF;
END $preflight$;

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
    IF NOT private.app_access_staff_time_allowed(owner_row.id) OR (n.organization_id IS NOT NULL AND n.organization_id IS DISTINCT FROM owner_row.organization_id)
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

DO $postflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(public.auto_accounts,public.auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'ff633bcc1b189376d584685f1b6decf7'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_shared_owner_grant_postflight_drift: inspect live body/owner/ACL/config';
  END IF;
END $postflight$;


DO $restored$
DECLARE n public.auto_accounts%ROWTYPE; o public.auto_accounts%ROWTYPE; denied boolean;
BEGIN
 FOR n IN SELECT a.* FROM auto_accounts a JOIN v450_cases c ON c.id=a.id ORDER BY a.id LOOP
  o:=n; o.is_akachat_enabled:=false; denied:=false;
  BEGIN PERFORM private.app_access_validate_account(n,o);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'app_access_denied' THEN RAISE; END IF; denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Rollback failed for %',n.id; END IF;
 END LOOP;
END $restored$;
ROLLBACK;

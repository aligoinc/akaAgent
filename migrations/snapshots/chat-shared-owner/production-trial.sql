BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='5s';

CREATE TEMP TABLE shared_owner_before ON COMMIT DROP AS
 SELECT a.id,a.staff_id,s.organization_id,
   public.aka_agent_app_access_account_allowed(a.id,'akaAgent') agent_allowed,
   public.aka_agent_app_access_account_allowed(a.id,'akaChat') chat_allowed
 FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
 WHERE public.aka_agent_app_access_separate(s.organization_id) OR s.organization_id=990;
CREATE TEMP TABLE shared_owner_staff_before ON COMMIT DROP AS
 SELECT s.id,public.aka_agent_app_access_staff_allowed(s.id,'akaAgent') agent_allowed,
   public.aka_agent_app_access_staff_allowed(s.id,'akaChat') chat_allowed
 FROM public.org_staff s WHERE public.aka_agent_app_access_separate(s.organization_id) OR s.organization_id=990;
CREATE TEMP TABLE shared_owner_routines_before ON COMMIT DROP AS
 SELECT p.oid,md5(pg_get_functiondef(p.oid)) checksum,
   p.proowner,p.proacl::text,p.prosecdef,p.provolatile,p.proparallel,p.proconfig
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p');

-- V449: Chat sharing survives an inactive/expired account owner.
-- Keep recipient authorization, owner deletion/tenant checks and Agent eligibility.
-- Captured live source: 694f41f6896f5c031f76a181ee0d9286; target: daf197a1cc419fd29030338e2ef2c936.
-- No grants, auth/session changes, data backfill, schema reload or activation rollback.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_app_access_account_allowed(bigint,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '694f41f6896f5c031f76a181ee0d9286'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_shared_owner_preflight_drift: inspect live body/owner/ACL/config before continuing';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_app_access_account_allowed(p_account bigint, p_app text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  SELECT COALESCE((SELECT CASE WHEN NOT public.aka_agent_app_access_separate(s.organization_id) THEN true ELSE
    NOT COALESCE(a.is_delete,false) AND s.deleted_at IS NULL
    AND (a.organization_id IS NULL OR a.organization_id=s.organization_id)
    AND CASE p_app WHEN 'akaAgent' THEN a.is_aka_agent_enabled
        AND s.is_active=true AND private.app_access_staff_time_allowed(s.id)
        AND public.aka_agent_app_access_staff_allowed(s.id,'akaAgent')
        AND EXISTS(SELECT 1 FROM private.app_access_packages(s.organization_id,'akaAgent',lower(a.flatform_type)))
        AND (lower(a.flatform_type)<>'zalo' OR EXISTS(SELECT 1 FROM private.resolve_organization_zalo_entitlement_pools(s.organization_id) p
          WHERE p.entitlement_id IS NOT NULL AND p.account_subtype=CASE WHEN a.is_zalo_show_web THEN 'web' WHEN a.is_zalo_server THEN 'server' ELSE 'qr' END))
      WHEN 'akaChat' THEN a.is_akachat_enabled AND lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)
        AND EXISTS(SELECT 1 FROM private.app_access_packages(s.organization_id,'akaChat'))
      ELSE false END END FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE a.id=p_account),false)
$function$;

DO $postflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_app_access_account_allowed(bigint,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'daf197a1cc419fd29030338e2ef2c936'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_shared_owner_postflight_drift: inspect live body/owner/ACL/config before continuing';
  END IF;
END $postflight$;



DO $verify_access$
BEGIN
 IF EXISTS(SELECT 1 FROM shared_owner_before b WHERE b.agent_allowed IS DISTINCT FROM public.aka_agent_app_access_account_allowed(b.id,'akaAgent')) THEN
   RAISE EXCEPTION 'Unexpected Agent permission change'; END IF;
 IF EXISTS(SELECT 1 FROM shared_owner_staff_before b WHERE b.agent_allowed IS DISTINCT FROM public.aka_agent_app_access_staff_allowed(b.id,'akaAgent')
   OR b.chat_allowed IS DISTINCT FROM public.aka_agent_app_access_staff_allowed(b.id,'akaChat')) THEN
   RAISE EXCEPTION 'Unexpected staff permission change'; END IF;
 IF EXISTS(SELECT 1 FROM shared_owner_before b WHERE b.chat_allowed AND NOT public.aka_agent_app_access_account_allowed(b.id,'akaChat')) THEN
   RAISE EXCEPTION 'Existing Chat access was revoked'; END IF;
 IF EXISTS(SELECT 1 FROM shared_owner_before b WHERE b.organization_id=990 AND b.chat_allowed IS DISTINCT FROM public.aka_agent_app_access_account_allowed(b.id,'akaChat')) THEN
   RAISE EXCEPTION 'Legacy access changed'; END IF;
 IF EXISTS(SELECT 1 FROM shared_owner_routines_before b JOIN pg_proc p ON p.oid=b.oid
   WHERE b.oid<>'public.aka_agent_app_access_account_allowed(bigint,text)'::regprocedure
   AND (b.checksum IS DISTINCT FROM md5(pg_get_functiondef(p.oid)) OR b.proowner IS DISTINCT FROM p.proowner
     OR b.proacl IS DISTINCT FROM p.proacl::text OR b.prosecdef IS DISTINCT FROM p.prosecdef
     OR b.provolatile IS DISTINCT FROM p.provolatile OR b.proparallel IS DISTINCT FROM p.proparallel OR b.proconfig IS DISTINCT FROM p.proconfig)) THEN
   RAISE EXCEPTION 'Unexpected unrelated function or ACL change'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
   WHERE a.id IN (2666,3359,4949,4992,4993,4994,7025) AND
     (s.organization_id<>1 OR s.is_active OR NOT public.aka_agent_app_access_account_allowed(a.id,'akaChat')
       OR public.aka_agent_app_access_account_allowed(a.id,'akaAgent'))) THEN
   RAISE EXCEPTION 'Locked owner Chat/Agent expectations failed'; END IF;
END $verify_access$;


DO $caller_acl$
DECLARE caller_name text;
BEGIN
 FOREACH caller_name IN ARRAY ARRAY['service_role','aka_agent_desktop','aka_agent_chat_api'] LOOP
  IF NOT has_schema_privilege(caller_name,'public','USAGE')
    OR NOT has_function_privilege(caller_name,'public.aka_agent_app_access_account_allowed(bigint,text)','EXECUTE') THEN
   RAISE EXCEPTION 'Missing caller privilege: %',caller_name; END IF;
 END LOOP;
 FOREACH caller_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_function_privilege(caller_name,'public.aka_agent_app_access_account_allowed(bigint,text)','EXECUTE') THEN
   RAISE EXCEPTION 'Unexpected caller privilege: %',caller_name; END IF;
 END LOOP;
END $caller_acl$;


SELECT jsonb_build_object(
 'accounts_checked',(SELECT count(*) FROM shared_owner_before),
 'staff_checked',(SELECT count(*) FROM shared_owner_staff_before),
 'routines_checked',(SELECT count(*) FROM shared_owner_routines_before),
 'new_chat_accounts',(SELECT jsonb_agg(b.id ORDER BY b.id) FROM shared_owner_before b WHERE NOT b.chat_allowed AND public.aka_agent_app_access_account_allowed(b.id,'akaChat')),
 'target_checksum',(SELECT md5(pg_get_functiondef('public.aka_agent_app_access_account_allowed(bigint,text)'::regprocedure))),
 'trial_only',true) AS rehearsal;

-- Narrow rollback for V449 only; requires explicit authorization before production use.
-- Restores the previous stricter Chat owner guard; never disables V447 or resets flags.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $rollback_preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_app_access_account_allowed(bigint,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'daf197a1cc419fd29030338e2ef2c936'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_shared_owner_rollback_preflight_drift: inspect live body/owner/ACL/config before continuing';
  END IF;
END $rollback_preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_app_access_account_allowed(p_account bigint, p_app text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  SELECT COALESCE((SELECT CASE WHEN NOT public.aka_agent_app_access_separate(s.organization_id) THEN true ELSE
    NOT COALESCE(a.is_delete,false) AND s.deleted_at IS NULL AND s.is_active=true
    AND private.app_access_staff_time_allowed(s.id)
    AND (a.organization_id IS NULL OR a.organization_id=s.organization_id)
    AND CASE p_app WHEN 'akaAgent' THEN a.is_aka_agent_enabled
        AND public.aka_agent_app_access_staff_allowed(s.id,'akaAgent')
        AND EXISTS(SELECT 1 FROM private.app_access_packages(s.organization_id,'akaAgent',lower(a.flatform_type)))
        AND (lower(a.flatform_type)<>'zalo' OR EXISTS(SELECT 1 FROM private.resolve_organization_zalo_entitlement_pools(s.organization_id) p
          WHERE p.entitlement_id IS NOT NULL AND p.account_subtype=CASE WHEN a.is_zalo_show_web THEN 'web' WHEN a.is_zalo_server THEN 'server' ELSE 'qr' END))
      WHEN 'akaChat' THEN a.is_akachat_enabled AND lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)
        AND EXISTS(SELECT 1 FROM private.app_access_packages(s.organization_id,'akaChat'))
      ELSE false END END FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE a.id=p_account),false)
$function$;

DO $rollback_postflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_app_access_account_allowed(bigint,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '694f41f6896f5c031f76a181ee0d9286'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u' OR f.proleakproof OR f.proisstrict
    OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_shared_owner_rollback_postflight_drift: inspect live body/owner/ACL/config before continuing';
  END IF;
END $rollback_postflight$;



DO $restored$
BEGIN
 IF EXISTS(SELECT 1 FROM shared_owner_before b WHERE b.chat_allowed IS DISTINCT FROM public.aka_agent_app_access_account_allowed(b.id,'akaChat')
   OR b.agent_allowed IS DISTINCT FROM public.aka_agent_app_access_account_allowed(b.id,'akaAgent')) THEN
  RAISE EXCEPTION 'Narrow rollback did not restore previous account results'; END IF;
END $restored$;

ROLLBACK;

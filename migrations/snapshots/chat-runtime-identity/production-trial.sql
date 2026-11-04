-- V452: canonical identity for status confirmation, local runtime and duplicate reservations.
-- Captured live V451; preserve QR receipts, ACL, quota, tenant and lock budgets.
-- No business-row updates, schema/index additions or explicit PostgREST reload.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_local_session(bigint,bigint,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'a136235e01eb1651b0ad3cc5a6d44b5d'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM false
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_preflight_drift: %','aka_agent_app_access_local_session(bigint,bigint,text,jsonb)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '8366eb0aafe73f700214ff9c80542876'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_preflight_drift: %','aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_account_runtime()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'c4357bf7f7dc2d756d10db76037e3906'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_preflight_drift: %','private.app_access_guard_account_runtime()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_flags()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'aacbeba11f54e46705182d61915ff928'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_preflight_drift: %','private.app_access_guard_flags()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_chat_identity(bigint,bigint,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'e1b81ef404854cd4290496a9dfc0ff46'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_preflight_drift: %','private.app_access_reserve_chat_identity(bigint,bigint,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_enabled_identity()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '66a710beb5d36f03d16d4684fd1a5385'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_preflight_drift: %','private.app_access_reserve_enabled_identity()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(auto_accounts,auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'f9f8f66c263a45c7196808f1781a64cf'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_preflight_drift: %','private.app_access_validate_account(auto_accounts,auto_accounts)';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION private.app_access_reserve_chat_identity(p_account bigint, p_org bigint, p_zalo bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE uid text; chat_id bigint; bound_id bigint; login_id bigint; socket_id bigint;
BEGIN
  SELECT zalo_uid INTO uid FROM public.zalo_accounts WHERE id=p_zalo;
  IF uid IS NULL THEN RAISE EXCEPTION 'app_access_invalid_identity'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||':'||uid,0));
  IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
    WHERE b.auto_account_id=p_account AND (b.organization_id<>p_org OR z.zalo_id<>uid)) THEN
    RAISE EXCEPTION 'account_already_has_another_zalo';
  END IF;
  SELECT b.auto_account_id INTO bound_id FROM public.chat_zalo_account_organization b
    JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
    WHERE b.organization_id=p_org AND z.zalo_id=uid FOR UPDATE OF b;
  -- An existing binding owns this identity even if legacy duplicate flags remain.
  IF bound_id=p_account THEN RETURN; END IF;
  IF bound_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=bound_id AND NOT COALESCE(is_delete,false))
    THEN RAISE EXCEPTION 'zalo_already_linked'; END IF;
  -- Only unbound logged-in rows reserve a future enrollment, including reuse of
  -- a deleted binding. A row bound to another Zalo cannot reserve its stale ID.
  IF EXISTS(SELECT 1 FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE s.organization_id=p_org AND a.id<>p_account AND NOT COALESCE(a.is_delete,false)
      AND a.is_akachat_enabled AND a.zalo_account_id=p_zalo AND a.login_status='đã đăng nhập'
      AND NOT EXISTS(SELECT 1 FROM public.chat_zalo_account_organization own_binding WHERE own_binding.auto_account_id=a.id)) THEN
    RAISE EXCEPTION 'zalo_already_linked';
  END IF;
  IF bound_id IS NOT NULL THEN RETURN; END IF;
  INSERT INTO public.chat_zalo_account(zalo_id) VALUES(uid)
    ON CONFLICT(zalo_id) DO NOTHING;
  SELECT id INTO chat_id FROM public.chat_zalo_account WHERE zalo_id=uid;
  SELECT i.id INTO login_id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
    WHERE t.namespace='zalo' AND t.code='zalo_login_status' AND i.code='logged_out' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  SELECT i.id INTO socket_id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
    WHERE t.namespace='zalo' AND t.code='zalo_socket_status' AND i.code='disconnected' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  IF login_id IS NULL OR socket_id IS NULL THEN RAISE EXCEPTION 'app_access_category_missing'; END IF;
  INSERT INTO public.chat_zalo_account_organization(chat_zalo_account_id,organization_id,auto_account_id,
    login_status_category_item_id,socket_status_category_item_id,is_active,runtime_generation)
    VALUES(chat_id,p_org,p_account,login_id,socket_id,false,0);
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
    -- Flags/status confirm the retained binding, not stale legacy metadata.
    -- New session/identity/owner/tenant changes and undelete still reserve the
    -- actual candidate; QR commit independently checks its sealed receipt.
    IF TG_OP='UPDATE'
      AND (NEW.is_akachat_enabled IS DISTINCT FROM OLD.is_akachat_enabled
        OR NEW.login_status IS DISTINCT FROM OLD.login_status)
      AND NEW.zalo_account_id IS NOT DISTINCT FROM OLD.zalo_account_id
      AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
      AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
      AND NEW.flatform_type IS NOT DISTINCT FROM OLD.flatform_type
      AND NEW.is_zalo_server IS NOT DISTINCT FROM OLD.is_zalo_server
      AND NEW.is_zalo_show_web IS NOT DISTINCT FROM OLD.is_zalo_show_web
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
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_local_session(bigint,bigint,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'a136235e01eb1651b0ad3cc5a6d44b5d'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM false
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_postflight_drift: %','aka_agent_app_access_local_session(bigint,bigint,text,jsonb)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '8366eb0aafe73f700214ff9c80542876'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_postflight_drift: %','aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_account_runtime()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'c4357bf7f7dc2d756d10db76037e3906'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_postflight_drift: %','private.app_access_guard_account_runtime()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_flags()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'aacbeba11f54e46705182d61915ff928'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_postflight_drift: %','private.app_access_guard_flags()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_chat_identity(bigint,bigint,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '151cabcf20c6a5d2f76ff158ad1b72ea'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_postflight_drift: %','private.app_access_reserve_chat_identity(bigint,bigint,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_enabled_identity()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'c7a04ca3aad62ebcf30794cd440402a5'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_postflight_drift: %','private.app_access_reserve_enabled_identity()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(auto_accounts,auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'f9f8f66c263a45c7196808f1781a64cf'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_postflight_drift: %','private.app_access_validate_account(auto_accounts,auto_accounts)';
  END IF;
END $postflight$;



-- Isolated mirror tables: production customer rows, sessions and sequences are never written.
CREATE TEMP TABLE v452_org_staff(id bigint PRIMARY KEY,organization_id bigint);
CREATE TEMP TABLE v452_app_access_requests(organization_id bigint,target_type text,status text,result jsonb);
CREATE TEMP TABLE v452_auto_accounts(id bigint PRIMARY KEY,staff_id bigint,organization_id bigint,zalo_account_id bigint,
  is_akachat_enabled boolean,is_delete boolean,login_status text,zalo_session jsonb,flatform_type text,is_zalo_server boolean,is_zalo_show_web boolean);
CREATE TEMP TABLE v452_zalo_accounts(id bigint PRIMARY KEY,zalo_uid text UNIQUE);
CREATE TEMP TABLE v452_chat_zalo_account(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,zalo_id text UNIQUE);
CREATE TEMP TABLE v452_chat_zalo_account_organization(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organization_id bigint,auto_account_id bigint UNIQUE,chat_zalo_account_id bigint,login_status_category_item_id bigint,
  socket_status_category_item_id bigint,is_active boolean,runtime_generation bigint,UNIQUE(organization_id,chat_zalo_account_id));
CREATE TEMP TABLE v452_category_type(id bigint,namespace text,code text,is_active boolean);
CREATE TEMP TABLE v452_category_item(id bigint,category_type_id bigint,code text,is_active boolean);
CREATE FUNCTION pg_temp.aka_agent_app_access_separate(bigint) RETURNS boolean LANGUAGE sql AS 'SELECT true';
INSERT INTO v452_org_staff VALUES(1,1);
INSERT INTO v452_zalo_accounts VALUES(1,'v452-test-bound'),(2,'v452-test-old'),(3,'v452-test-deleted');
INSERT INTO v452_chat_zalo_account(id,zalo_id) OVERRIDING SYSTEM VALUE VALUES(10,'v452-test-bound'),(11,'v452-test-server'),(12,'v452-test-deleted');
INSERT INTO v452_auto_accounts VALUES
 (1,1,1,2,true,false,'chưa đăng nhập','{}','zalo',false,false),
 (2,1,1,2,true,false,'chưa đăng nhập',NULL,'zalo',true,false),
 (3,1,1,1,true,false,'đã đăng nhập','{}','zalo',false,false),
 (4,1,1,3,false,true,'chưa đăng nhập',NULL,'zalo',true,false),
 (5,1,1,3,true,false,'đã đăng nhập',NULL,'zalo',true,false),
 (6,1,1,3,true,false,'chưa đăng nhập',NULL,'zalo',true,false);
INSERT INTO v452_chat_zalo_account_organization(organization_id,auto_account_id,chat_zalo_account_id,is_active,runtime_generation)
 VALUES(1,1,10,true,7),(1,2,11,true,1),(1,4,12,false,9);

CREATE OR REPLACE FUNCTION pg_temp.app_access_reserve_chat_identity(p_account bigint, p_org bigint, p_zalo bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE uid text; chat_id bigint; bound_id bigint; login_id bigint; socket_id bigint;
BEGIN
  SELECT zalo_uid INTO uid FROM pg_temp.v452_zalo_accounts WHERE id=p_zalo;
  IF uid IS NULL THEN RAISE EXCEPTION 'app_access_invalid_identity'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||':'||uid,0));
  IF EXISTS(SELECT 1 FROM pg_temp.v452_chat_zalo_account_organization b JOIN pg_temp.v452_chat_zalo_account z ON z.id=b.chat_zalo_account_id
    WHERE b.auto_account_id=p_account AND (b.organization_id<>p_org OR z.zalo_id<>uid)) THEN
    RAISE EXCEPTION 'account_already_has_another_zalo';
  END IF;
  SELECT b.auto_account_id INTO bound_id FROM pg_temp.v452_chat_zalo_account_organization b
    JOIN pg_temp.v452_chat_zalo_account z ON z.id=b.chat_zalo_account_id
    WHERE b.organization_id=p_org AND z.zalo_id=uid FOR UPDATE OF b;
  -- An existing binding owns this identity even if legacy duplicate flags remain.
  IF bound_id=p_account THEN RETURN; END IF;
  IF bound_id IS NOT NULL AND EXISTS(SELECT 1 FROM pg_temp.v452_auto_accounts WHERE id=bound_id AND NOT COALESCE(is_delete,false))
    THEN RAISE EXCEPTION 'zalo_already_linked'; END IF;
  -- Only unbound logged-in rows reserve a future enrollment, including reuse of
  -- a deleted binding. A row bound to another Zalo cannot reserve its stale ID.
  IF EXISTS(SELECT 1 FROM pg_temp.v452_auto_accounts a JOIN pg_temp.v452_org_staff s ON s.id=a.staff_id
    WHERE s.organization_id=p_org AND a.id<>p_account AND NOT COALESCE(a.is_delete,false)
      AND a.is_akachat_enabled AND a.zalo_account_id=p_zalo AND a.login_status='đã đăng nhập'
      AND NOT EXISTS(SELECT 1 FROM pg_temp.v452_chat_zalo_account_organization own_binding WHERE own_binding.auto_account_id=a.id)) THEN
    RAISE EXCEPTION 'zalo_already_linked';
  END IF;
  IF bound_id IS NOT NULL THEN RETURN; END IF;
  INSERT INTO pg_temp.v452_chat_zalo_account(zalo_id) VALUES(uid)
    ON CONFLICT(zalo_id) DO NOTHING;
  SELECT id INTO chat_id FROM pg_temp.v452_chat_zalo_account WHERE zalo_id=uid;
  SELECT i.id INTO login_id FROM pg_temp.v452_category_item i JOIN pg_temp.v452_category_type t ON t.id=i.category_type_id
    WHERE t.namespace='zalo' AND t.code='zalo_login_status' AND i.code='logged_out' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  SELECT i.id INTO socket_id FROM pg_temp.v452_category_item i JOIN pg_temp.v452_category_type t ON t.id=i.category_type_id
    WHERE t.namespace='zalo' AND t.code='zalo_socket_status' AND i.code='disconnected' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  IF login_id IS NULL OR socket_id IS NULL THEN RAISE EXCEPTION 'app_access_category_missing'; END IF;
  INSERT INTO pg_temp.v452_chat_zalo_account_organization(chat_zalo_account_id,organization_id,auto_account_id,
    login_status_category_item_id,socket_status_category_item_id,is_active,runtime_generation)
    VALUES(chat_id,p_org,p_account,login_id,socket_id,false,0);
END $function$;

CREATE OR REPLACE FUNCTION pg_temp.app_access_reserve_enabled_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE org bigint;
BEGIN
  SELECT organization_id INTO org FROM pg_temp.v452_org_staff WHERE id=NEW.staff_id;
  IF EXISTS(SELECT 1 FROM pg_temp.v452_app_access_requests r WHERE r.organization_id=org AND r.target_type='initialize'
    AND r.status='processing' AND r.result->>'transactionId'=pg_current_xact_id()::text) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.is_akachat_enabled IS NOT DISTINCT FROM OLD.is_akachat_enabled
    AND NEW.zalo_account_id IS NOT DISTINCT FROM OLD.zalo_account_id
    AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
    AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id AND NEW.login_status IS NOT DISTINCT FROM OLD.login_status
    THEN RETURN NEW; END IF;
  IF pg_temp.aka_agent_app_access_separate(org) AND NEW.is_akachat_enabled AND NOT COALESCE(NEW.is_delete,false)
    AND NEW.zalo_account_id IS NOT NULL AND NEW.login_status='đã đăng nhập' THEN
    -- Flags/status confirm the retained binding, not stale legacy metadata.
    -- New session/identity/owner/tenant changes and undelete still reserve the
    -- actual candidate; QR commit independently checks its sealed receipt.
    IF TG_OP='UPDATE'
      AND (NEW.is_akachat_enabled IS DISTINCT FROM OLD.is_akachat_enabled
        OR NEW.login_status IS DISTINCT FROM OLD.login_status)
      AND NEW.zalo_account_id IS NOT DISTINCT FROM OLD.zalo_account_id
      AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
      AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
      AND NEW.flatform_type IS NOT DISTINCT FROM OLD.flatform_type
      AND NEW.is_zalo_server IS NOT DISTINCT FROM OLD.is_zalo_server
      AND NEW.is_zalo_show_web IS NOT DISTINCT FROM OLD.is_zalo_show_web
      AND NEW.zalo_session IS NOT DISTINCT FROM OLD.zalo_session
      AND EXISTS(SELECT 1 FROM pg_temp.v452_chat_zalo_account_organization b WHERE b.auto_account_id=NEW.id AND b.organization_id=org)
      THEN RETURN NEW; END IF;
    PERFORM pg_temp.app_access_reserve_chat_identity(NEW.id,org,NEW.zalo_account_id);
  END IF;
  RETURN NEW;
END $function$;


CREATE TRIGGER app_access_reserve_enabled_identity AFTER INSERT OR UPDATE OF is_akachat_enabled,zalo_account_id,is_delete,staff_id,organization_id,login_status
 ON pg_temp.v452_auto_accounts FOR EACH ROW EXECUTE FUNCTION pg_temp.app_access_reserve_enabled_identity();
DO $behavior$
BEGIN
 UPDATE pg_temp.v452_auto_accounts SET login_status='đã đăng nhập' WHERE id IN(1,2);
 PERFORM pg_temp.app_access_reserve_chat_identity(1,1,1);
 BEGIN
  PERFORM pg_temp.app_access_reserve_chat_identity(3,1,1);
  RAISE EXCEPTION 'expected_duplicate_rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'zalo_already_linked' THEN RAISE; END IF; END;
 BEGIN
  PERFORM pg_temp.app_access_reserve_chat_identity(1,1,2);
  RAISE EXCEPTION 'expected_actual_identity_rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'account_already_has_another_zalo' THEN RAISE; END IF; END;
 PERFORM pg_temp.app_access_reserve_chat_identity(5,1,3);
 BEGIN
  PERFORM pg_temp.app_access_reserve_chat_identity(6,1,3);
  RAISE EXCEPTION 'expected_pending_reservation_rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'zalo_already_linked' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM pg_temp.v452_chat_zalo_account_organization)<>3
   OR (SELECT runtime_generation FROM pg_temp.v452_chat_zalo_account_organization WHERE auto_account_id=1)<>7
   THEN RAISE EXCEPTION 'binding_changed'; END IF;
END $behavior$;


SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $rollback_preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_local_session(bigint,bigint,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'a136235e01eb1651b0ad3cc5a6d44b5d'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM false
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_preflight_drift: %','aka_agent_app_access_local_session(bigint,bigint,text,jsonb)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '8366eb0aafe73f700214ff9c80542876'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_preflight_drift: %','aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_account_runtime()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'c4357bf7f7dc2d756d10db76037e3906'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_preflight_drift: %','private.app_access_guard_account_runtime()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_flags()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'aacbeba11f54e46705182d61915ff928'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_preflight_drift: %','private.app_access_guard_flags()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_chat_identity(bigint,bigint,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '151cabcf20c6a5d2f76ff158ad1b72ea'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_preflight_drift: %','private.app_access_reserve_chat_identity(bigint,bigint,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_enabled_identity()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'c7a04ca3aad62ebcf30794cd440402a5'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_preflight_drift: %','private.app_access_reserve_enabled_identity()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(auto_accounts,auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'f9f8f66c263a45c7196808f1781a64cf'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_preflight_drift: %','private.app_access_validate_account(auto_accounts,auto_accounts)';
  END IF;
END $rollback_preflight$;

CREATE OR REPLACE FUNCTION private.app_access_reserve_chat_identity(p_account bigint, p_org bigint, p_zalo bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE uid text; chat_id bigint; bound_id bigint; login_id bigint; socket_id bigint;
BEGIN
  SELECT zalo_uid INTO uid FROM public.zalo_accounts WHERE id=p_zalo;
  IF uid IS NULL THEN RAISE EXCEPTION 'app_access_invalid_identity'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||':'||uid,0));
  -- Flags protect an enrollment waiting to reuse a deleted binding too.
  IF EXISTS(SELECT 1 FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE s.organization_id=p_org AND a.id<>p_account AND NOT COALESCE(a.is_delete,false)
      AND a.is_akachat_enabled AND a.zalo_account_id=p_zalo AND a.login_status='đã đăng nhập') THEN
    RAISE EXCEPTION 'zalo_already_linked';
  END IF;
  IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
    WHERE b.auto_account_id=p_account AND (b.organization_id<>p_org OR z.zalo_id<>uid)) THEN
    RAISE EXCEPTION 'account_already_has_another_zalo';
  END IF;
  SELECT b.auto_account_id INTO bound_id FROM public.chat_zalo_account_organization b
    JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
    WHERE b.organization_id=p_org AND z.zalo_id=uid FOR UPDATE OF b;
  IF bound_id IS NOT NULL THEN
    IF bound_id<>p_account AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=bound_id AND NOT COALESCE(is_delete,false))
      THEN RAISE EXCEPTION 'zalo_already_linked'; END IF;
    RETURN;
  END IF;
  INSERT INTO public.chat_zalo_account(zalo_id) VALUES(uid)
    ON CONFLICT(zalo_id) DO NOTHING;
  SELECT id INTO chat_id FROM public.chat_zalo_account WHERE zalo_id=uid;
  SELECT i.id INTO login_id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
    WHERE t.namespace='zalo' AND t.code='zalo_login_status' AND i.code='logged_out' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  SELECT i.id INTO socket_id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
    WHERE t.namespace='zalo' AND t.code='zalo_socket_status' AND i.code='disconnected' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  IF login_id IS NULL OR socket_id IS NULL THEN RAISE EXCEPTION 'app_access_category_missing'; END IF;
  INSERT INTO public.chat_zalo_account_organization(chat_zalo_account_id,organization_id,auto_account_id,
    login_status_category_item_id,socket_status_category_item_id,is_active,runtime_generation)
    VALUES(chat_id,p_org,p_account,login_id,socket_id,false,0);
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

DO $rollback_postflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_local_session(bigint,bigint,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'a136235e01eb1651b0ad3cc5a6d44b5d'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM false
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_postflight_drift: %','aka_agent_app_access_local_session(bigint,bigint,text,jsonb)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '8366eb0aafe73f700214ff9c80542876'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private','lock_timeout=3s','statement_timeout=12s']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_postflight_drift: %','aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_account_runtime()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'c4357bf7f7dc2d756d10db76037e3906'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_postflight_drift: %','private.app_access_guard_account_runtime()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_guard_flags()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'aacbeba11f54e46705182d61915ff928'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_postflight_drift: %','private.app_access_guard_flags()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_chat_identity(bigint,bigint,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'e1b81ef404854cd4290496a9dfc0ff46'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_postflight_drift: %','private.app_access_reserve_chat_identity(bigint,bigint,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_reserve_enabled_identity()');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '66a710beb5d36f03d16d4684fd1a5385'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_postflight_drift: %','private.app_access_reserve_enabled_identity()';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_validate_account(auto_accounts,auto_accounts)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'f9f8f66c263a45c7196808f1781a64cf'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 'v'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100::real
    OR f.prorows IS DISTINCT FROM 0::real
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'chat_runtime_identity_rollback_postflight_drift: %','private.app_access_validate_account(auto_accounts,auto_accounts)';
  END IF;
END $rollback_postflight$;


ROLLBACK;

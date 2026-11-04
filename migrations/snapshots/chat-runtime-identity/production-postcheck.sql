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

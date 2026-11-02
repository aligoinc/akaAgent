-- Separate deployment step, AFTER backend/runtime/UI and private auth patches. Never bulk-push.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$ BEGIN
  IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM (SELECT policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='auto_accounts') p) IS DISTINCT FROM '[{"policyname": "app_access_desktop_accounts", "permissive": "RESTRICTIVE", "roles": "{aka_agent_desktop}", "cmd": "SELECT", "qual": "(is_aka_agent_enabled OR (NOT aka_agent_app_access_separate(COALESCE(organization_id, ( SELECT profile.organization_id\n   FROM aka_agent_staff_runtime_profile profile\n  WHERE (profile.id = auto_accounts.staff_id))))) OR ((current_setting(''request.method''::text, true) = ''POST''::text) AND (current_setting(''request.path''::text, true) = ANY (ARRAY[''/rpc/aka_agent_app_access_local_session''::text, ''/rpc/aka_agent_claim_account_operation''::text, ''/rpc/aka_agent_cleanup_account_operation''::text, ''/rpc/aka_agent_facebook_account_operation''::text, ''/rpc/release_zalo_account_runtime_operation''::text, ''/rpc/aka_agent_settle_campaign_run_unit_v2''::text, ''/rpc/aka_agent_cleanup_failed_campaign_runtime''::text, ''/rpc/aka_agent_recover_campaign_runtime_unit_leases''::text, ''/rpc/inspect_staff_zalo_running_state''::text, ''/rpc/recover_server_zalo_running_state''::text, ''/rpc/reset_desktop_running_statuses_no_retry''::text]))))", "with_check": null}, {"policyname": "desktop_owned_resource", "permissive": "RESTRICTIVE", "roles": "{aka_agent_desktop}", "cmd": "ALL", "qual": "(staff_id = ( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request))", "with_check": "((staff_id = ( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request)) AND ((account_group_id IS NULL) OR (EXISTS ( SELECT 1\n   FROM auto_account_groups owned\n  WHERE (owned.id = auto_accounts.account_group_id)))) AND ((proxy_id IS NULL) OR (EXISTS ( SELECT 1\n   FROM auto_proxies owned\n  WHERE (owned.id = auto_accounts.proxy_id)))))"}, {"policyname": "v435_existing_role_access", "permissive": "PERMISSIVE", "roles": "{aka_agent_desktop,aka_message_ingest_owner,authenticator,cli_login_postgres,dashboard_user,pg_checkpoint,pg_create_subscription,pg_database_owner,pg_execute_server_program,pg_maintain,pg_monitor,pg_read_all_data,pg_read_all_settings,pg_read_all_stats,pg_read_server_files,pg_signal_backend,pg_stat_scan_tables,pg_use_reserved_connections,pg_write_all_data,pg_write_server_files,pgbouncer,supabase_auth_admin,supabase_functions_admin,supabase_privileged_role,supabase_realtime_admin,supabase_replication_admin,supabase_storage_admin}", "cmd": "ALL", "qual": "true", "with_check": "true"}]'::jsonb OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.auto_accounts'::regclass) THEN RAISE EXCEPTION 'app_access_policy_drift'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.aka_agent_staff_runtime_profile')
      AND c.relkind='v' AND pg_get_userbyid(c.relowner)='postgres'
      AND md5(pg_get_viewdef(c.oid,true))='bb879c13f7469398e75650bf7403a7d7'
      AND c.relacl::text IS NOT DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=r/postgres,aka_agent_chat_api=r/postgres,aka_agent_desktop=r/postgres}'
      AND to_jsonb(c.reloptions) IS NOT DISTINCT FROM '["security_barrier=true"]'::jsonb
      AND has_table_privilege('aka_agent_desktop',c.oid,'SELECT')
  ) THEN RAISE EXCEPTION 'app_access_view_drift'; END IF;
  IF to_regprocedure('private.app_access_capture_rollout()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_capture_rollout()')
      AND md5(pg_get_functiondef(p.oid))='434a8e1f587410bbe414fc1b26ee48ef'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_capture_rollout()'; END IF;
  IF to_regprocedure('private.app_access_finish_stops()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_finish_stops()')
      AND md5(pg_get_functiondef(p.oid))='e42254a8932dab368e1234dbf2e29b06'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_finish_stops()'; END IF;
  IF to_regprocedure('private.app_access_flags(text,bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_flags(text,bigint)')
      AND md5(pg_get_functiondef(p.oid))='1d644c29faa018a63f6da93bd662d2e8'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_flags(text,bigint)'; END IF;
  IF to_regprocedure('private.app_access_guard_account_runtime()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_guard_account_runtime()')
      AND md5(pg_get_functiondef(p.oid))='c4357bf7f7dc2d756d10db76037e3906'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_guard_account_runtime()'; END IF;
  IF to_regprocedure('private.app_access_guard_campaign_claim()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_guard_campaign_claim()')
      AND md5(pg_get_functiondef(p.oid))='973c05e0b7762b836b6f214394d6c8c9'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_guard_campaign_claim()'; END IF;
  IF to_regprocedure('private.app_access_guard_flags()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_guard_flags()')
      AND md5(pg_get_functiondef(p.oid))='aacbeba11f54e46705182d61915ff928'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_guard_flags()'; END IF;
  IF to_regprocedure('private.app_access_held(text,bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_held(text,bigint)')
      AND md5(pg_get_functiondef(p.oid))='091b58186a65975e5faf5e620569feac'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_held(text,bigint)'; END IF;
  IF to_regprocedure('private.app_access_initialize(bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_initialize(bigint)')
      AND md5(pg_get_functiondef(p.oid))='269bd4f827904e096f9900ed689544a0'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_initialize(bigint)'; END IF;
  IF to_regprocedure('private.app_access_packages(bigint,text,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_packages(bigint,text,text)')
      AND md5(pg_get_functiondef(p.oid))='4f2251c2a5848ae174481a97fe02fe72'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_packages(bigint,text,text)'; END IF;
  IF to_regprocedure('private.app_access_policy_enabled()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_policy_enabled()')
      AND md5(pg_get_functiondef(p.oid))='c6fd7d3a914f343d1b1baacd135c5ddf'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_policy_enabled()'; END IF;
  IF to_regprocedure('private.app_access_product_added()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_product_added()')
      AND md5(pg_get_functiondef(p.oid))='05bf6647a5c9b6471cb1360329c94d82'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_product_added()'; END IF;
  IF to_regprocedure('private.app_access_quota(bigint,bigint,text,text,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_quota(bigint,bigint,text,text,text)')
      AND md5(pg_get_functiondef(p.oid))='0ac3b350f4c7871e4661b6a23a495e8a'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_quota(bigint,bigint,text,text,text)'; END IF;
  IF to_regprocedure('private.app_access_reserve_chat_identity(bigint,bigint,bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_reserve_chat_identity(bigint,bigint,bigint)')
      AND md5(pg_get_functiondef(p.oid))='e1b81ef404854cd4290496a9dfc0ff46'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_reserve_chat_identity(bigint,bigint,bigint)'; END IF;
  IF to_regprocedure('private.app_access_reserve_enabled_identity()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_reserve_enabled_identity()')
      AND md5(pg_get_functiondef(p.oid))='ddc0b1c0b4e11534cc5e8a403ec07158'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_reserve_enabled_identity()'; END IF;
  IF to_regprocedure('private.app_access_staff_time_allowed(bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_staff_time_allowed(bigint)')
      AND md5(pg_get_functiondef(p.oid))='4589a06b40ae8f5f309c1ba83da512c3'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_staff_time_allowed(bigint)'; END IF;
  IF to_regprocedure('private.app_access_validate_account(auto_accounts,auto_accounts)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('private.app_access_validate_account(auto_accounts,auto_accounts)')
      AND md5(pg_get_functiondef(p.oid))='ff633bcc1b189376d584685f1b6decf7'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','private.app_access_validate_account(auto_accounts,auto_accounts)'; END IF;
  IF to_regprocedure('aka_agent_app_access(bigint,text,text,text,jsonb)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access(bigint,text,text,text,jsonb)')
      AND md5(pg_get_functiondef(p.oid))='5810ada148d7dadcb6edb0710ce6fe2d'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private", "lock_timeout=3s", "statement_timeout=12s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access(bigint,text,text,text,jsonb)'; END IF;
  IF to_regprocedure('aka_agent_app_access_account_allowed(bigint,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_account_allowed(bigint,text)')
      AND md5(pg_get_functiondef(p.oid))='694f41f6896f5c031f76a181ee0d9286'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_account_allowed(bigint,text)'; END IF;
  IF to_regprocedure('aka_agent_app_access_chat_organizations(bigint[])') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_chat_organizations(bigint[])')
      AND md5(pg_get_functiondef(p.oid))='b48a2ab3d264c6a1c75345cd69a7582e'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_chat_organizations(bigint[])'; END IF;
  IF to_regprocedure('aka_agent_app_access_chat_runtime(bigint,boolean)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_chat_runtime(bigint,boolean)')
      AND md5(pg_get_functiondef(p.oid))='875dd3c7e002a614dca11d23a979ab58'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_chat_runtime(bigint,boolean)'; END IF;
  IF to_regprocedure('aka_agent_app_access_check_request()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_check_request()')
      AND md5(pg_get_functiondef(p.oid))='4d26d4af7f5be14564ff8e86be205f6d'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_check_request()'; END IF;
  IF to_regprocedure('aka_agent_app_access_local_session(bigint,bigint,text,jsonb)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_local_session(bigint,bigint,text,jsonb)')
      AND md5(pg_get_functiondef(p.oid))='a136235e01eb1651b0ad3cc5a6d44b5d'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public", "lock_timeout=3s", "statement_timeout=12s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_local_session(bigint,bigint,text,jsonb)'; END IF;
  IF to_regprocedure('aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)')
      AND md5(pg_get_functiondef(p.oid))='8366eb0aafe73f700214ff9c80542876'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private", "lock_timeout=3s", "statement_timeout=12s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)'; END IF;
  IF to_regprocedure('aka_agent_app_access_quota(bigint,bigint,text,text,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_quota(bigint,bigint,text,text,text)')
      AND md5(pg_get_functiondef(p.oid))='33fde08561110ec3ee6a15f48c4f9d32'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_quota(bigint,bigint,text,text,text)'; END IF;
  IF to_regprocedure('aka_agent_app_access_runtime_accounts(bigint,bigint[],boolean)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_runtime_accounts(bigint,bigint[],boolean)')
      AND md5(pg_get_functiondef(p.oid))='e126bc5e68dbbf9e33e2102514afa527'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private", "statement_timeout=60s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_runtime_accounts(bigint,bigint[],boolean)'; END IF;
  IF to_regprocedure('aka_agent_app_access_runtime_allowed(bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_runtime_allowed(bigint)')
      AND md5(pg_get_functiondef(p.oid))='2bf894e789327b77d46d7eea4ab027ae'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_runtime_allowed(bigint)'; END IF;
  IF to_regprocedure('aka_agent_app_access_separate(bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_separate(bigint)')
      AND md5(pg_get_functiondef(p.oid))='38a487450a871d167f9df67f9a9c393e'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_separate(bigint)'; END IF;
  IF to_regprocedure('aka_agent_app_access_staff_allowed(bigint,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_staff_allowed(bigint,text)')
      AND md5(pg_get_functiondef(p.oid))='1cfd48cf50e988665a42b1f80aa7b408'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_staff_allowed(bigint,text)'; END IF;
  IF to_regprocedure('aka_agent_app_access_state(text,bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_app_access_state(text,bigint)')
      AND md5(pg_get_functiondef(p.oid))='a886b8d4c26b18156ba7c1678caf0725'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_app_access_state(text,bigint)'; END IF;
  IF to_regprocedure('aka_agent_authenticate_control_session(text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_authenticate_control_session(text)')
      AND md5(pg_get_functiondef(p.oid))='c748df75349ebeef58c3c8f120439b0b'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_authenticate_control_session(text)'; END IF;
  IF to_regprocedure('aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)')
      AND md5(pg_get_functiondef(p.oid))='b6599acd23f714779aba5ac551d4c46f'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)'; END IF;
  IF to_regprocedure('aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)')
      AND md5(pg_get_functiondef(p.oid))='761108afe53ff4046efe0cd247846d10'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public, pg_temp", "statement_timeout=20s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)'; END IF;
  IF to_regprocedure('aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)')
      AND md5(pg_get_functiondef(p.oid))='e4dbe2f2dba71e96c0b669ef1a79179b'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public", "statement_timeout=60s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)'; END IF;
  IF to_regprocedure('aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)')
      AND md5(pg_get_functiondef(p.oid))='532019b253e648044dd46821a3c4cec6'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)'; END IF;
  IF to_regprocedure('aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)')
      AND md5(pg_get_functiondef(p.oid))='832d4d8f23cdf61b31f34802270d3679'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)'; END IF;
  IF to_regprocedure('aka_agent_staff_access(bigint,text,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_staff_access(bigint,text,text)')
      AND md5(pg_get_functiondef(p.oid))='10c2f7330813adcc91f5f12f36e80b82'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_staff_access(bigint,text,text)'; END IF;
  IF to_regprocedure('aka_agent_staff_client(text,text,text,jsonb)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_staff_client(text,text,text,jsonb)')
      AND md5(pg_get_functiondef(p.oid))='7d99fae02234962b74e26d24167a7414'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public", "lock_timeout=3s", "statement_timeout=12s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_staff_client(text,text,text,jsonb)'; END IF;
  IF to_regprocedure('aka_agent_staff_management(bigint,text,text,text,jsonb)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_staff_management(bigint,text,text,text,jsonb)')
      AND md5(pg_get_functiondef(p.oid))='912fe184892b574e5d64c4e1effe206d'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public", "lock_timeout=3s", "statement_timeout=12s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_staff_management(bigint,text,text,text,jsonb)'; END IF;
  IF to_regprocedure('aka_agent_staff_management_row(bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_staff_management_row(bigint)')
      AND md5(pg_get_functiondef(p.oid))='2e2ac358e055d452ab8ed0c3d33f5596'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_staff_management_row(bigint)'; END IF;
  IF to_regprocedure('claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)')
      AND md5(pg_get_functiondef(p.oid))='15e9617caaeace5966742b8707a9c2ad'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)'; END IF;
  IF to_regprocedure('create_control_zalo_account_atomic(bigint,bigint,integer,jsonb)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('create_control_zalo_account_atomic(bigint,bigint,integer,jsonb)')
      AND md5(pg_get_functiondef(p.oid))='6ae582eefa775bb2bac43ad123226128'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','create_control_zalo_account_atomic(bigint,bigint,integer,jsonb)'; END IF;
  IF to_regprocedure('enforce_zalo_account_capability_and_quota()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('enforce_zalo_account_capability_and_quota()')
      AND md5(pg_get_functiondef(p.oid))='7668b1e0957c6b389c435f0134c0eb94'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','enforce_zalo_account_capability_and_quota()'; END IF;
  IF to_regprocedure('aka_agent_block_denied_ip_request()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_block_denied_ip_request()')
      AND md5(pg_get_functiondef(p.oid))='3d14fd34e0b35dac896876b9e6ec1604'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_block_denied_ip_request()'; END IF;
  IF to_regprocedure('aka_agent_desktop_session_admin(text,jsonb)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_desktop_session_admin(text,jsonb)')
      AND md5(pg_get_functiondef(p.oid))='2540676100a33615df3b5be3b8104345'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog", "statement_timeout=12s", "lock_timeout=3s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_desktop_session_admin(text,jsonb)'; END IF;
  IF to_regprocedure('aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)')
      AND md5(pg_get_functiondef(p.oid))='3381b7f73df758e9a161cac5fbedc620'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)'; END IF;
  IF to_regprocedure('aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)')
      AND md5(pg_get_functiondef(p.oid))='97e7a22c22f8ea9ab28a7a8aabcc634c'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)'; END IF;
  IF to_regprocedure('aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)')
      AND md5(pg_get_functiondef(p.oid))='91b1ff4d36fc5c1ff2f9364bd7301fba'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)'; END IF;
  IF to_regprocedure('aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text)')
      AND md5(pg_get_functiondef(p.oid))='64f75be5b0f722dad02b765ff1ca220f'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text)'; END IF;
  IF to_regprocedure('aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)')
      AND md5(pg_get_functiondef(p.oid))='3dffabe31ade3469f72664d226acfc78'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)'; END IF;
  IF to_regprocedure('aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)')
      AND md5(pg_get_functiondef(p.oid))='2f7bd25ee7ba86653384737a63b73deb'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)'; END IF;
  IF to_regprocedure('inspect_staff_zalo_running_state(bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('inspect_staff_zalo_running_state(bigint)')
      AND md5(pg_get_functiondef(p.oid))='b84b44b4100ffc99a41d174cbd7f5ab7'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','inspect_staff_zalo_running_state(bigint)'; END IF;
  IF to_regprocedure('recover_server_zalo_running_state(bigint,text,boolean)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('recover_server_zalo_running_state(bigint,text,boolean)')
      AND md5(pg_get_functiondef(p.oid))='02c1541f6dbfcb1a352e94da888ac0bd'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','recover_server_zalo_running_state(bigint,text,boolean)'; END IF;
  IF to_regprocedure('release_zalo_account_runtime_operation(bigint,bigint,text,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('release_zalo_account_runtime_operation(bigint,bigint,text,text)')
      AND md5(pg_get_functiondef(p.oid))='3b9e3e76491a6e7a8ae91c9c3c714408'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','release_zalo_account_runtime_operation(bigint,bigint,text,text)'; END IF;
  IF to_regprocedure('release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)')
      AND md5(pg_get_functiondef(p.oid))='06f2a974302b96a5dcacbfec83fd8e87'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)'; END IF;
  IF to_regprocedure('reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)')
      AND md5(pg_get_functiondef(p.oid))='6803509057e6ec91b349c9543757f3d3'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)'; END IF;
END $preflight$;
-- Block product/staff/account writers only for the final capture and gate flip.
LOCK TABLE public.org_organization_product,public.org_staff,public.auto_accounts IN SHARE ROW EXCLUSIVE MODE;
SELECT private.app_access_capture_rollout();
CREATE OR REPLACE FUNCTION private.app_access_policy_enabled() RETURNS boolean LANGUAGE sql STABLE
SET search_path=pg_catalog AS $$ SELECT true $$;
DO $postflight$ BEGIN
  IF NOT private.app_access_policy_enabled() THEN RAISE EXCEPTION 'app_access_activation_failed'; END IF;
END $postflight$;
COMMIT;

-- V454: indexable held-work lookup and equivalent Agent permission checks.
-- Derived from the current live capture; retain V449 shared-owner Chat semantics.
-- No flags, packages, claims, receipts, policies, grants, indexes or pool changes.
-- The run-control RPC keeps its INVOKER mode and staff/account/tenant checks.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';

DO $preflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_account_allowed(bigint,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'daf197a1cc419fd29030338e2ef2c936'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_preflight_drift: %', 'aka_agent_app_access_account_allowed(bigint,text)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_separate(bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '38a487450a871d167f9df67f9a9c393e'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_preflight_drift: %', 'aka_agent_app_access_separate(bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_staff_allowed(bigint,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '1cfd48cf50e988665a42b1f80aa7b408'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_preflight_drift: %', 'aka_agent_app_access_staff_allowed(bigint,text)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '532019b253e648044dd46821a3c4cec6'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM false
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 1000
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_preflight_drift: %', 'aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_staff_access(bigint,text,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '10c2f7330813adcc91f5f12f36e80b82'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_preflight_drift: %', 'aka_agent_staff_access(bigint,text,text)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_staff_time_allowed(bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '7569f2b3816985cac48c114c891b5672'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_preflight_drift: %', 'aka_agent_staff_time_allowed(bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_held(text,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '091b58186a65975e5faf5e620569feac'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_preflight_drift: %', 'private.app_access_held(text,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_packages(bigint,text,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '4f2251c2a5848ae174481a97fe02fe72'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 1000
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_preflight_drift: %', 'private.app_access_packages(bigint,text,text)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_staff_time_allowed(bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '4589a06b40ae8f5f309c1ba83da512c3'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_preflight_drift: %', 'private.app_access_staff_time_allowed(bigint)';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION private.app_access_held(p_type text, p_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE p_type
    WHEN 'account' THEN EXISTS(SELECT 1 FROM public.auto_accounts a WHERE a.id=p_id
      AND (a.runtime_operation_claim_token IS NOT NULL OR a.status='đang chạy'
        OR EXISTS(SELECT 1 FROM public.auto_campaigns c WHERE (c.account_id=a.id OR c.secondary_account_id=a.id)
          AND (c.status='đang chạy' OR c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL))))
    WHEN 'staff' THEN EXISTS(SELECT 1 FROM public.auto_accounts a WHERE a.staff_id=p_id
      AND (a.runtime_operation_claim_token IS NOT NULL OR a.status='đang chạy'
        OR EXISTS(SELECT 1 FROM public.auto_campaigns c WHERE (c.account_id=a.id OR c.secondary_account_id=a.id)
          AND (c.status='đang chạy' OR c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL))))
    ELSE false END
$function$;

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
        AND s.is_active=true AND s.is_aka_agent_enabled
        AND private.app_access_staff_time_allowed(s.id)
        AND EXISTS(SELECT 1 FROM private.app_access_packages(s.organization_id,'akaAgent',lower(a.flatform_type)))
        AND (lower(a.flatform_type)<>'zalo' OR EXISTS(SELECT 1 FROM private.resolve_organization_zalo_entitlement_pools(s.organization_id) p
          WHERE p.entitlement_id IS NOT NULL AND p.account_subtype=CASE WHEN a.is_zalo_show_web THEN 'web' WHEN a.is_zalo_server THEN 'server' ELSE 'qr' END))
      WHEN 'akaChat' THEN a.is_akachat_enabled AND lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)
        AND EXISTS(SELECT 1 FROM private.app_access_packages(s.organization_id,'akaChat'))
      ELSE false END END FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE a.id=p_account),false)
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_zalo_server_run_control_state(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint)
 RETURNS TABLE(campaign_id bigint, account_id bigint, campaign_status text, account_status text, account_login_status text, account_is_active boolean, account_is_delete boolean, campaign_is_delete boolean, pause_requested boolean, should_stop boolean, hard_stop_reason text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_pause_requested boolean := false;
  v_hard_stop_reason text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_profile AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
    AND (public.aka_agent_staff_time_allowed(staff.id) OR EXISTS (
      SELECT 1 FROM public.auto_campaigns held WHERE held.id=p_campaign_id
        AND held.account_id=p_account_id AND held.staff_id=p_staff_id AND held.runtime_unit_token IS NOT NULL
    ));
  IF NOT FOUND OR v_organization_id IS NULL THEN
    v_hard_stop_reason := 'runtime_not_owner';
  END IF;

  SELECT campaign.status, account.status, account.login_status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO v_campaign_status, v_account_status, v_account_login_status,
    v_account_is_active, v_account_is_delete, v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true;

  IF NOT FOUND THEN
    v_hard_stop_reason := COALESCE(v_hard_stop_reason, 'not_found');
  ELSE
    v_pause_requested := v_campaign_status IS DISTINCT FROM 'đang chạy'
      OR v_account_status IS DISTINCT FROM 'đang chạy';
    IF v_hard_stop_reason IS NULL AND v_campaign_is_delete THEN
      v_hard_stop_reason := 'campaign_deleted';
    ELSIF v_hard_stop_reason IS NULL AND v_account_is_delete THEN
      v_hard_stop_reason := 'account_deleted';
    ELSIF v_hard_stop_reason IS NULL AND NOT v_account_is_active THEN
      v_hard_stop_reason := 'account_inactive';
    ELSIF v_hard_stop_reason IS NULL AND v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
      v_hard_stop_reason := 'account_logged_out';
    END IF;
  END IF;

  -- Skipping the helper must not bypass its EXECUTE boundary for other roles.
  IF NOT pg_catalog.has_function_privilege('public.aka_agent_app_access_account_allowed(bigint,text)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'permission denied for function aka_agent_app_access_account_allowed' USING ERRCODE='42501';
  END IF;
  -- Existing failures already stop the runtime. With no failure, the scoped
  -- joins above proved account/staff ownership; legacy account_allowed is true.
  -- Separate organizations still recheck the complete current Agent permission.
  IF v_hard_stop_reason IS NULL THEN
    IF public.aka_agent_app_access_separate(v_organization_id) THEN
      IF NOT public.aka_agent_app_access_account_allowed(p_account_id,'akaAgent') THEN
        v_hard_stop_reason := 'app_access_denied';
      END IF;
    END IF;
  END IF;
  RETURN QUERY SELECT p_campaign_id, p_account_id, v_campaign_status,
    v_account_status, v_account_login_status, v_account_is_active,
    v_account_is_delete, v_campaign_is_delete, v_pause_requested,
    v_pause_requested OR v_hard_stop_reason IS NOT NULL, v_hard_stop_reason;
END;
$function$;

DO $postflight$
DECLARE f pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_account_allowed(bigint,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '410005b7e2720a1db565acfcd8c7e197'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_postflight_drift: %', 'aka_agent_app_access_account_allowed(bigint,text)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_separate(bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '38a487450a871d167f9df67f9a9c393e'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_postflight_drift: %', 'aka_agent_app_access_separate(bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_app_access_staff_allowed(bigint,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '1cfd48cf50e988665a42b1f80aa7b408'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_postflight_drift: %', 'aka_agent_app_access_staff_allowed(bigint,text)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '16505c0962e7a9a9d304d280400bfda1'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM false
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 1000
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_postflight_drift: %', 'aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_staff_access(bigint,text,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '10c2f7330813adcc91f5f12f36e80b82'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_postflight_drift: %', 'aka_agent_staff_access(bigint,text,text)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('aka_agent_staff_time_allowed(bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '7569f2b3816985cac48c114c891b5672'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres,aka_agent_chat_api=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_postflight_drift: %', 'aka_agent_staff_time_allowed(bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_held(text,bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM 'b181b7ce926f8bf4b07cc6233ac4380a'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_postflight_drift: %', 'private.app_access_held(text,bigint)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_packages(bigint,text,text)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '4f2251c2a5848ae174481a97fe02fe72'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 1000
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_postflight_drift: %', 'private.app_access_packages(bigint,text,text)';
  END IF;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('private.app_access_staff_time_allowed(bigint)');
  IF NOT FOUND OR md5(pg_get_functiondef(f.oid)) IS DISTINCT FROM '4589a06b40ae8f5f309c1ba83da512c3'
    OR pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
    OR f.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR f.prosecdef IS DISTINCT FROM true
    OR f.provolatile IS DISTINCT FROM 's'
    OR f.proparallel IS DISTINCT FROM 'u'
    OR f.proleakproof IS DISTINCT FROM false
    OR f.proisstrict IS DISTINCT FROM false
    OR f.procost IS DISTINCT FROM 100
    OR f.prorows IS DISTINCT FROM 0
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN
    RAISE EXCEPTION 'app_access_perf_postflight_drift: %', 'private.app_access_staff_time_allowed(bigint)';
  END IF;
END $postflight$;

COMMIT;

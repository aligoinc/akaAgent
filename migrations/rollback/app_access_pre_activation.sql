-- Pre-activation rollback only. Retain columns/receipts and all user decisions.
-- After activation, roll forward: reverting entitlement guards would reopen revoked access.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$ BEGIN
  IF private.app_access_policy_enabled() THEN RAISE EXCEPTION 'app_access_active_requires_roll_forward'; END IF;
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
END $preflight$;
CREATE OR REPLACE FUNCTION public.aka_agent_authenticate_control_session(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.auto_control_sessions%ROWTYPE;
  v_staff public.org_staff%ROWTYPE;
  v_organization public.org_organization%ROWTYPE;
  v_zalo_package public.org_organization_product%ROWTYPE;
  v_sms_package public.org_organization_product%ROWTYPE;
  v_zalo_capabilities record;
  v_zalo_qr_enabled boolean := false;
  v_zalo_web_enabled boolean := false;
  v_zalo_server_enabled boolean := false;
  v_sms_enabled boolean := false;
  v_now timestamptz := now();
  v_vietnam_day_start timestamptz := (
    date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  SELECT session.* INTO v_session
  FROM public.auto_control_sessions AS session
  WHERE session.token_hash = p_token_hash
    AND session.revoked_at IS NULL
    AND session.expires_at > v_now
  LIMIT 1;
  IF v_session.id IS NULL THEN RETURN jsonb_build_object('status', 'invalid_session'); END IF;

  SELECT staff.* INTO v_staff
  FROM public.org_staff AS staff
  WHERE staff.id = v_session.staff_id
  LIMIT 1;
  IF v_staff.id IS NULL
    OR v_staff.is_active IS DISTINCT FROM true
    OR v_staff.organization_id IS DISTINCT FROM v_session.organization_id
  THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_staff');
  END IF;

  SELECT organization.* INTO v_organization
  FROM public.org_organization AS organization
  WHERE organization.id = v_staff.organization_id
  LIMIT 1;
  IF v_organization.id IS NULL THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_organization');
  END IF;

  -- Reuse Desktop's live staff/org expiry rule, before product entitlement checks.
  -- Keep the existing failure status so older Control API clients still revoke safely.
  IF NOT public.aka_agent_staff_time_allowed(v_staff.id) THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_staff');
  END IF;

  SELECT * INTO v_zalo_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_staff.organization_id);
  IF v_zalo_capabilities.entitlement_id IS NOT NULL THEN
    SELECT entitlement.* INTO v_zalo_package
    FROM public.org_organization_product AS entitlement
    WHERE entitlement.id = v_zalo_capabilities.entitlement_id;
  END IF;

  SELECT entitlement.* INTO v_sms_package
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_staff.organization_id
    AND entitlement.is_deleted = false
    AND entitlement.product_id = 17
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_zalo_qr_enabled := COALESCE(v_zalo_capabilities.qr_enabled, false);
  v_zalo_web_enabled := COALESCE(v_zalo_capabilities.web_enabled, false);
  v_zalo_server_enabled := v_zalo_qr_enabled
    AND COALESCE(v_zalo_capabilities.server_enabled, false);
  v_sms_enabled := v_sms_package.id IS NOT NULL;

  IF NOT v_zalo_server_enabled AND NOT v_sms_enabled THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'capability_unavailable');
  END IF;
  IF v_session.last_seen_at <= v_now - interval '5 minutes' THEN
    UPDATE public.auto_control_sessions SET last_seen_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'status', 'authenticated',
    'session', jsonb_build_object(
      'id', v_session.id, 'staff_id', v_session.staff_id,
      'organization_id', v_session.organization_id,
      'client_type', v_session.client_type, 'user_agent', v_session.user_agent,
      'created_at', v_session.created_at, 'last_seen_at', v_session.last_seen_at,
      'expires_at', v_session.expires_at, 'revoked_at', v_session.revoked_at
    ),
    'staff', jsonb_build_object(
      'id', v_staff.id, 'organization_id', v_staff.organization_id,
      'name', v_staff.name, 'username', v_staff.username,
      'phone', v_staff.phone, 'email', v_staff.email,
      'is_active', v_staff.is_active, 'is_zalo_server', v_zalo_server_enabled
    ),
    'organization', jsonb_build_object('id', v_organization.id, 'name', v_organization.name),
    'capabilities', jsonb_build_object(
      'zalo_qr', v_zalo_qr_enabled,
      'zalo_web', v_zalo_web_enabled,
      'zalo_server', v_zalo_server_enabled,
      'sms', v_sms_enabled
    ),
    'zalo_account_capabilities', jsonb_build_object(
      'qr', v_zalo_qr_enabled,
      'web', v_zalo_web_enabled,
      'server', v_zalo_server_enabled,
      'revision', v_zalo_capabilities.capability_revision
    ),
    'zalo_package', CASE WHEN v_zalo_package.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_zalo_package.id,
      'product_id', v_zalo_package.product_id,
      'product_package_id', v_zalo_package.product_package_id,
      'product_name', v_zalo_package.product_name,
      'package_name', v_zalo_package.package_name,
      'max_accounts', v_zalo_capabilities.max_accounts,
      'max_staff', v_zalo_package.max_staff,
      'max_sends_per_day', v_zalo_capabilities.max_sends_per_day,
      'expiration_date', v_zalo_package.expiration_date,
      'created_at', v_zalo_package.created_at,
      'capability_revision', v_zalo_capabilities.capability_revision
    ) END,
    'sms_package', CASE WHEN v_sms_package.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_sms_package.id,
      'product_id', v_sms_package.product_id,
      'product_package_id', v_sms_package.product_package_id,
      'product_name', v_sms_package.product_name,
      'package_name', v_sms_package.package_name,
      'max_accounts', v_sms_package.max_accounts,
      'max_staff', v_sms_package.max_staff,
      'max_sends_per_day', v_sms_package.max_sends_per_day,
      'expiration_date', v_sms_package.expiration_date,
      'created_at', v_sms_package.created_at
    ) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_control_account_snapshot(p_staff_id bigint, p_organization_id bigint, p_platforms text[], p_view text DEFAULT 'accounts'::text, p_account_ids bigint[] DEFAULT NULL::bigint[], p_versions jsonb DEFAULT '{}'::jsonb, p_catalog_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_catalog jsonb;
  v_catalog_version text;
  v_items jsonb;
  v_running jsonb := '[]'::jsonb;
  v_chat boolean;
BEGIN
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_view IS NULL OR p_view NOT IN ('accounts','campaigns','details')
     OR jsonb_typeof(p_versions) IS DISTINCT FROM 'object'
     OR (p_view = 'campaigns' AND (p_account_ids IS NULL OR cardinality(p_account_ids) > 101)) THEN
    RAISE EXCEPTION 'Invalid account snapshot scope';
  END IF;

  IF p_view = 'campaigns' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'name',coalesce(nullif(a.name,''),nullif(z.display_name,''),'Tài khoản #'||a.id),
      'platform',a.flatform_type,'isZaloServer',a.flatform_type='zalo' AND a.is_zalo_server IS TRUE,
      'isZaloShowWeb',a.flatform_type='zalo' AND a.is_zalo_show_web IS TRUE
    ) ORDER BY a.created_at DESC,a.id DESC),'[]'::jsonb)
    INTO v_catalog
    FROM auto_accounts a LEFT JOIN zalo_accounts z ON z.id=a.zalo_account_id
    WHERE a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete IS FALSE
      AND a.flatform_type=ANY(p_platforms)
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE));
    v_catalog_version := md5(v_catalog::text);
  END IF;

  IF p_view='accounts' THEN
  SELECT EXISTS(SELECT 1 FROM org_organization_product
    WHERE organization_id=p_organization_id AND product_id IN (16,18) AND is_deleted IS FALSE
      AND is_chat_sync IS TRUE
      AND expiration_date >= (date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')) INTO v_chat;
  END IF;

  WITH account_rows AS MATERIALIZED (
    SELECT a.id,a.created_at,
      jsonb_build_object('id',a.id,'name',a.name,'flatform_type',a.flatform_type,
        'is_active',a.is_active,'is_zalo_show_web',a.is_zalo_show_web,'is_zalo_server',a.is_zalo_server,
        'account_group_id',a.account_group_id,'rate_limit_minutes',a.rate_limit_minutes,'proxy_id',a.proxy_id,
        'username',CASE WHEN a.flatform_type='sms' THEN a.username END,
        'mobile_device_id',CASE WHEN a.flatform_type='sms' THEN a.mobile_device_id END,
        'mobile_device_info',CASE WHEN a.flatform_type='sms' THEN coalesce(a.mobile_device_info,'{}'::jsonb) ELSE '{}'::jsonb END,
        'mobile_device_registered_at',CASE WHEN a.flatform_type='sms' THEN a.mobile_device_registered_at END,
        'created_at',a.created_at,
        'auto_account_groups',jsonb_build_object('name',g.name),
        'auto_proxies',jsonb_build_object('name',p.name),
        'zalo_accounts',jsonb_build_object('zalo_uid',z.zalo_uid,'display_name',z.display_name,'phone',z.phone,'avatar_url',z.avatar_url)
      ) AS metadata,
      (jsonb_build_object('id',a.id,'status',a.status,'login_status',a.login_status,'is_active',a.is_active,
        'mobile_device_last_seen_at',CASE WHEN a.flatform_type='sms' THEN a.mobile_device_last_seen_at END,
        'updated_at',a.updated_at)
      || CASE WHEN p_view<>'campaigns' THEN jsonb_build_object(
        'has_zalo_session',CASE WHEN a.flatform_type='zalo' AND v_chat THEN a.login_status IS NOT DISTINCT FROM 'đã đăng nhập'
          ELSE a.zalo_session IS NOT NULL AND a.zalo_session <> 'null'::jsonb END,
        'has_disabled_actions',CASE WHEN p_account_ids IS NULL THEN EXISTS (
          SELECT 1 FROM auto_account_action_status s WHERE s.account_id=a.id AND s.is_disable IS TRUE
            AND (s.date_enable IS NULL OR s.date_enable > now())
        ) ELSE NULL END
      ) ELSE '{}'::jsonb END
      || CASE WHEN p_view='details' THEN jsonb_build_object(
        'zalo_session_updated_at',a.zalo_session_updated_at,'zalo_session_last_verified_at',a.zalo_session_last_verified_at,
        'zalo_session_last_error',a.zalo_session_last_error
      ) ELSE '{}'::jsonb END) AS state
    FROM auto_accounts a
    LEFT JOIN auto_account_groups g ON g.id=a.account_group_id
    LEFT JOIN auto_proxies p ON p.id=a.proxy_id
    LEFT JOIN zalo_accounts z ON z.id=a.zalo_account_id
    WHERE a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete IS FALSE
      AND a.flatform_type=ANY(p_platforms)
      AND (p_account_ids IS NULL OR a.id=ANY(p_account_ids))
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'version',md5(metadata::text),'state',state,
    'metadata',CASE WHEN p_view<>'campaigns' AND (p_versions->>id::text) IS DISTINCT FROM md5(metadata::text) THEN metadata ELSE NULL END
  ) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO v_items FROM account_rows;

  IF p_view='accounts' AND p_account_ids IS NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'accountId',c.account_id,'status',c.status)
      ORDER BY c.created_at DESC,c.id DESC),'[]'::jsonb) INTO v_running
    FROM auto_campaigns c JOIN auto_accounts a ON a.id=c.account_id
    WHERE c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.is_delete IS FALSE AND c.status='đang chạy'
      AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete IS FALSE
      AND a.flatform_type=ANY(p_platforms)
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE));
  END IF;
  RETURN jsonb_build_object('items',v_items,'runningCampaigns',v_running,'catalogVersion',v_catalog_version,
    'catalog',CASE WHEN v_catalog_version IS DISTINCT FROM p_catalog_version THEN v_catalog ELSE NULL END);
END
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_desktop_account_snapshot(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_access jsonb, p_catalog_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  WITH scoped AS MATERIALIZED (
    SELECT a.id, a.status, a.login_status, a.updated_at, a.mobile_device_last_seen_at, a.mobile_device_info,
      a.zalo_session_updated_at, a.zalo_session_last_verified_at, a.zalo_session_last_error,
      a.email_session_updated_at, a.email_session_last_verified_at, a.email_session_last_error,
      a.facebook_login_claim_generation, a.facebook_random_run_enabled,
      coalesce((a.facebook_random_run_config->>'revision')::int,0) AS facebook_random_run_revision,
      jsonb_build_object(
        'id',a.id,'name',a.name,'flatform_type',a.flatform_type,'facebook_uid',a.facebook_uid,
        'facebook_login_managed',a.facebook_login_managed,
        'is_zalo_show_web',a.is_zalo_show_web,'is_zalo_server',a.is_zalo_server,
        'username',CASE WHEN a.flatform_type='sms' THEN a.username END,
        'password',CASE WHEN a.flatform_type='sms' THEN a.password END,
        'mobile_device_id',a.mobile_device_id,'mobile_device_registered_at',a.mobile_device_registered_at,
        'is_active',a.is_active,'rate_limit_minutes',a.rate_limit_minutes,
        'account_group_id',a.account_group_id,'proxy_id',a.proxy_id,'zalo_account_id',a.zalo_account_id,
        'is_delete',a.is_delete,'staff_id',a.staff_id,'organization_id',a.organization_id,'created_at',a.created_at,
        'auto_account_groups',CASE WHEN g.id IS NOT NULL THEN jsonb_build_object('name',g.name,'settings',g.settings) END,
        'auto_proxies',CASE WHEN pr.id IS NOT NULL THEN jsonb_build_object('name',pr.name,'protocol',pr.protocol,'host',pr.host,'port',pr.port) END,
        'zalo_accounts',CASE WHEN z.id IS NOT NULL THEN jsonb_build_object('id',z.id,'zalo_uid',z.zalo_uid,'display_name',z.display_name,'phone',z.phone,'avatar_url',z.avatar_url) END
      ) AS metadata
    FROM public.auto_accounts a
    LEFT JOIN public.auto_account_groups g ON g.id=a.account_group_id
    LEFT JOIN public.auto_proxies pr ON pr.id=a.proxy_id
    LEFT JOIN public.zalo_accounts z ON z.id=a.zalo_account_id
    WHERE a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete=false
      AND coalesce((p_access->>CASE WHEN a.flatform_type='facebook' THEN 'facebookCore' ELSE a.flatform_type END)::boolean,false)
      AND (a.flatform_type<>'zalo' OR coalesce((p_access->>CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'qr' END)::boolean,false))
  ), restricted AS MATERIALIZED (
    SELECT DISTINCT x.account_id FROM public.auto_account_action_status x
    JOIN scoped a ON a.id=x.account_id
    WHERE x.is_disable=true AND (x.date_enable IS NULL OR x.date_enable>now())
  ), catalog AS (
    SELECT md5(coalesce(string_agg(metadata::text,',' ORDER BY id),'')) AS version FROM scoped
  )
  SELECT jsonb_build_object('version',c.version,
    'catalog',CASE WHEN c.version IS DISTINCT FROM p_catalog_version THEN
      coalesce((SELECT jsonb_agg(metadata ORDER BY (metadata->>'created_at')::timestamptz DESC,id DESC) FROM scoped),'[]') END,
    'states',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',s.id,'status',s.status,'loginStatus',s.login_status,'updatedAt',s.updated_at,
      'mobileDeviceLastSeenAt',s.mobile_device_last_seen_at,'mobileDeviceInfo',s.mobile_device_info,
      'facebookLoginClaimGeneration',s.facebook_login_claim_generation,
      'facebookRandomRunEnabled',s.facebook_random_run_enabled,'facebookRandomRunRevision',s.facebook_random_run_revision,
      'zaloSessionUpdatedAt',s.zalo_session_updated_at,'zaloSessionLastVerifiedAt',s.zalo_session_last_verified_at,'zaloSessionLastError',s.zalo_session_last_error,
      'emailSessionUpdatedAt',s.email_session_updated_at,'emailSessionLastVerifiedAt',s.email_session_last_verified_at,'emailSessionLastError',s.email_session_last_error,
      'hasEmailSession',s.email_session_updated_at IS NOT NULL,
      'hasZaloSession',CASE WHEN (p_access->>'chatSync')::boolean IS TRUE AND s.metadata->>'flatform_type'='zalo' AND (s.metadata->>'is_zalo_server')::boolean IS TRUE AND (s.metadata->>'is_zalo_show_web')::boolean IS NOT TRUE THEN s.login_status='đã đăng nhập' ELSE s.zalo_session_updated_at IS NOT NULL END,
      'hasDisabledActions',r.account_id IS NOT NULL
    ) ORDER BY s.id) FROM scoped s LEFT JOIN restricted r ON r.account_id=s.id),'[]'))
  INTO v_result FROM catalog c;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_staff_access(p_staff_id bigint, p_username text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE s public.org_staff%ROWTYPE; o public.org_organization%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.org_staff WHERE id=p_staff_id AND username=p_username AND password=p_password;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_auth_invalid'; END IF;
  SELECT * INTO STRICT o FROM public.org_organization WHERE id=s.organization_id;
  RETURN jsonb_build_object('isAdmin',s.is_admin IS TRUE AND s.is_active AND s.deleted_at IS NULL,
    'isActive',s.is_active AND s.deleted_at IS NULL,'timeAllowed',public.aka_agent_staff_time_allowed(s.id),
    'expirationDate',s.expiration_date,'useStaffExpiration',o.use_staff_expiration,'useOrganizationExpiration',NOT o.use_staff_expiration);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_staff_client(p_username text, p_password text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '12s'
AS $function$
DECLARE
  s public.org_staff%ROWTYPE;
  allowed text[];
  stamp timestamptz := clock_timestamp();
  integration jsonb;
  kind text;
  device_result jsonb;
  lock_key bigint;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('read','bind_device','accept_policy','change_password','set_test_workflow','save_integration','register_recovery','prepare_device_v3','bind_device_v3')
    OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
  allowed := CASE p_action
    WHEN 'prepare_device_v3' THEN ARRAY['staffId','fingerprintHash','legacyHash','source']
    WHEN 'bind_device_v3' THEN ARRAY['staffId','fingerprintHash','legacyHash','source','requestId','expected']
    WHEN 'bind_device' THEN ARRAY['staffId','fingerprintHash']
    WHEN 'change_password' THEN ARRAY['staffId','newPassword']
    WHEN 'set_test_workflow' THEN ARRAY['staffId','enabled']
    WHEN 'save_integration' THEN ARRAY['staffId','kind','integration']
    WHEN 'register_recovery' THEN ARRAY['staffId','fingerprintHash','secretHash']
    ELSE ARRAY['staffId'] END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT k=ANY(allowed))
    OR (p_data ? 'staffId' AND (jsonb_typeof(p_data->'staffId') IS DISTINCT FROM 'number' OR p_data->>'staffId' !~ '^[1-9][0-9]*$'))
    OR (p_action NOT IN ('read','prepare_device_v3') AND NOT p_data ? 'staffId') THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
  IF coalesce(btrim(p_username),'')='' OR coalesce(p_password,'')='' THEN RAISE EXCEPTION 'staff_client_auth_invalid'; END IF;

  -- Authenticate before taking a lock, then repeat under that lock. Neither an
  -- ID nor a fingerprint is a credential; no caller selects another staff.
  SELECT * INTO s FROM public.org_staff WHERE username=btrim(p_username) AND password=p_password;
  IF NOT FOUND OR (p_data ? 'staffId' AND s.id IS DISTINCT FROM (p_data->>'staffId')::bigint) THEN RAISE EXCEPTION 'staff_client_auth_invalid'; END IF;
  -- All fingerprint locks precede staff locks, including proof recovery and old API enrollment.
  IF p_action IN ('prepare_device_v3','bind_device_v3','bind_device','register_recovery') THEN
    IF jsonb_typeof(p_data->'fingerprintHash') IS DISTINCT FROM 'string'
      OR p_data->>'fingerprintHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    FOR lock_key IN SELECT DISTINCT hashtextextended(k,73103) FROM unnest(ARRAY[
      s.aka_agent_device_identity_version::text||':'||s.aka_agent_device_fingerprint_hash,
      (CASE WHEN p_action IN ('prepare_device_v3','bind_device_v3') THEN '3' ELSE s.aka_agent_device_identity_version::text END)||':'||(p_data->>'fingerprintHash')
    ]) k WHERE k IS NOT NULL ORDER BY 1 LOOP
      PERFORM pg_advisory_xact_lock(lock_key);
    END LOOP;
  END IF;
  IF p_action='read' THEN
    SELECT * INTO s FROM public.org_staff WHERE id=s.id AND username=btrim(p_username) AND password=p_password FOR SHARE;
  ELSE
    SELECT * INTO s FROM public.org_staff WHERE id=s.id AND username=btrim(p_username) AND password=p_password FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_client_auth_invalid'; END IF;
  IF NOT s.is_active OR s.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'staff_client_inactive'; END IF;

  IF p_action IN ('bind_device','accept_policy','register_recovery','prepare_device_v3','bind_device_v3') AND NOT public.aka_agent_staff_time_allowed(s.id) THEN
    RAISE EXCEPTION 'staff_client_expired';
  END IF;
  IF p_action IN ('prepare_device_v3','bind_device_v3') THEN
    device_result := private.aka_agent_device_v3(s.id,p_action,p_data);
    SELECT * INTO s FROM public.org_staff WHERE id=s.id;
  ELSIF p_action='register_recovery' THEN
    IF jsonb_typeof(p_data->'fingerprintHash') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_data->'secretHash') IS DISTINCT FROM 'string'
      OR p_data->>'fingerprintHash' !~ '^[a-f0-9]{64}$' OR p_data->>'secretHash' !~ '^[a-f0-9]{64}$'
      OR s.aka_agent_device_fingerprint_hash IS DISTINCT FROM p_data->>'fingerprintHash' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    IF private.aka_agent_device_ambiguous(s.aka_agent_device_identity_version,s.aka_agent_device_fingerprint_hash,s.id,false) THEN
      DELETE FROM private.aka_agent_staff_recovery WHERE staff_id=s.id;
    ELSE
    INSERT INTO private.aka_agent_staff_recovery AS r (staff_id,organization_id,fingerprint_hash,secret_hash,credential_hash)
      VALUES(s.id,s.organization_id,p_data->>'fingerprintHash',p_data->>'secretHash',encode(extensions.digest(s.password,'sha256'),'hex'))
      ON CONFLICT (staff_id) DO UPDATE SET organization_id=excluded.organization_id,fingerprint_hash=excluded.fingerprint_hash,
        secret_hash=excluded.secret_hash,credential_hash=excluded.credential_hash,created_at=clock_timestamp();
  END IF;
  ELSIF p_action='bind_device' THEN
    IF s.aka_agent_device_identity_version=3 THEN RAISE EXCEPTION 'staff_client_device_locked'; END IF;
    IF jsonb_typeof(p_data->'fingerprintHash') IS DISTINCT FROM 'string'
      OR p_data->>'fingerprintHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    IF s.aka_agent_device_fingerprint_hash IS NOT NULL
      AND s.aka_agent_device_fingerprint_hash IS DISTINCT FROM p_data->>'fingerprintHash' THEN
      RAISE EXCEPTION 'staff_client_device_locked';
    END IF;
    IF s.aka_agent_device_fingerprint_hash IS NULL THEN
      UPDATE public.org_staff SET aka_agent_device_fingerprint_hash=p_data->>'fingerprintHash' WHERE id=s.id RETURNING * INTO s;
    END IF;
    PERFORM private.aka_agent_device_ambiguous(2::smallint,s.aka_agent_device_fingerprint_hash,s.id,false);
  ELSIF p_action='accept_policy' THEN
    IF NOT s.is_policy_accepted THEN
      UPDATE public.org_staff SET is_policy_accepted=true,policy_accepted_at=stamp,updated_at=stamp WHERE id=s.id RETURNING * INTO s;
    END IF;
  ELSIF p_action='change_password' THEN
    IF jsonb_typeof(p_data->'newPassword') IS DISTINCT FROM 'string'
      OR length(p_data->>'newPassword') NOT BETWEEN 1 AND 1024 THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    UPDATE public.org_staff SET password=p_data->>'newPassword',updated_at=stamp WHERE id=s.id RETURNING * INTO s;
    DELETE FROM private.aka_agent_staff_recovery WHERE staff_id=s.id;
  ELSIF p_action='set_test_workflow' THEN
    IF NOT s.is_admin_akabiz THEN RAISE EXCEPTION 'staff_client_forbidden'; END IF;
    IF jsonb_typeof(p_data->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    UPDATE public.org_staff SET use_test_workflow=(p_data->>'enabled')::boolean,updated_at=stamp WHERE id=s.id RETURNING * INTO s;
  ELSIF p_action='save_integration' THEN
    kind:=p_data->>'kind'; integration:=p_data->'integration';
    IF kind IS NULL OR kind NOT IN ('sms','zaloWeb','akaBizDesktop') OR jsonb_typeof(integration) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'staff_client_invalid_input';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(integration) k WHERE NOT k=ANY(ARRAY['id','staffId','username','name','installPath','dbPath']))
      OR jsonb_typeof(integration->'staffId') IS DISTINCT FROM 'number' OR integration->>'staffId' !~ '^[1-9][0-9]*$'
      OR jsonb_typeof(integration->'username') IS DISTINCT FROM 'string' OR length(btrim(integration->>'username')) NOT BETWEEN 1 AND 255
      OR EXISTS (SELECT 1 FROM jsonb_each(integration) e WHERE e.key IN ('name','installPath','dbPath') AND
        (jsonb_typeof(e.value) NOT IN ('null','string') OR length(e.value#>>'{}')>4096)) THEN RAISE EXCEPTION 'staff_client_invalid_input'; END IF;
    integration:=jsonb_build_object('id',(integration->>'staffId')::bigint,'staffId',(integration->>'staffId')::bigint,
      'username',btrim(integration->>'username'),'name',integration->'name','installPath',integration->'installPath','dbPath',integration->'dbPath','integratedAt',stamp);
    UPDATE public.org_staff SET akabiz_integrations=jsonb_set(coalesce(akabiz_integrations,'{}'),ARRAY[kind],integration,true),updated_at=stamp
      WHERE id=s.id RETURNING * INTO s;
  END IF;

  -- Explicit projection: never return password, CRM permissions, tokens, or
  -- future columns added to org_staff. Mutations never accept tenant/admin data.
  RETURN jsonb_build_object('id',s.id,'organization_id',s.organization_id,'name',s.name,'phone',s.phone,'username',s.username,
    'is_active',s.is_active,'is_admin',s.is_admin,'is_admin_akabiz',s.is_admin_akabiz,'use_test_workflow',s.use_test_workflow,
    'is_policy_accepted',s.is_policy_accepted,'policy_accepted_at',s.policy_accepted_at,
    'aka_agent_device_fingerprint_hash',s.aka_agent_device_fingerprint_hash,
    'aka_agent_device_identity_version',s.aka_agent_device_identity_version,'deviceV3',device_result,
    'device_label',s.device_label,'device_platform',s.device_platform,'device_bound_at',s.device_bound_at,'device_last_seen_at',s.device_last_seen_at,
    'app_notification',s.app_notification,'akabiz_integrations',s.akabiz_integrations,'updated_at',s.updated_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_staff_management(p_actor_id bigint, p_username text, p_password text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '12s'
AS $function$
#variable_conflict use_variable
DECLARE
  actor public.org_staff%ROWTYPE; org public.org_organization%ROWTYPE;
  target public.org_staff%ROWTYPE; grp public.org_group%ROWTYPE;
  request public.auto_staff_management_requests%ROWTYPE;
  result jsonb; obj jsonb; ids bigint[]; id bigint; parent_id bigint; group_id bigint;
  request_id uuid; revision text; phone text; label text; allowed text[];
  root_id bigint; root_count integer;
  mutation boolean; total bigint; offset_rows integer; group_ids bigint[]; stamp timestamptz:=clock_timestamp();
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('list','saveGroup','saveStaff','setStatus','revealPassword','prepareDevices','resetDevices') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
  allowed:=CASE p_action
    WHEN 'list' THEN ARRAY['search','groupId','status','page']
    WHEN 'saveGroup' THEN ARRAY['id','name','parentId','expectedVersion','requestId']
    WHEN 'saveStaff' THEN ARRAY['id','name','phone','groupId','isDepartmentManager','expectedVersion','requestId']
    WHEN 'setStatus' THEN ARRAY['targets','isActive','requestId']
    WHEN 'revealPassword' THEN ARRAY['id']
    WHEN 'prepareDevices' THEN ARRAY['ids']
    ELSE ARRAY['targets','requestId'] END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT k=ANY(allowed)) THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
  SELECT s.* INTO actor FROM public.org_staff s WHERE s.id=p_actor_id AND s.username=p_username AND s.password=p_password;
  IF NOT FOUND OR actor.is_admin IS NOT TRUE OR NOT public.aka_agent_staff_time_allowed(actor.id) THEN RAISE EXCEPTION 'staff_access_denied'; END IF;
  mutation:=p_action IN ('saveGroup','saveStaff','setStatus','resetDevices');
  IF mutation THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-staff-management:'||actor.organization_id::text,0));
    IF p_action IN ('saveGroup','saveStaff') THEN
      -- Share Chat's organization lock before actor/group/staff rows, including manager replacement.
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-chat:workspace-staff:'||actor.organization_id::text,0));
    END IF;
  END IF;
  -- Revalidate after waiting. Keep the authorizing row locked through commit.
  SELECT s.* INTO actor FROM public.org_staff s WHERE s.id=p_actor_id AND s.username=p_username AND s.password=p_password FOR SHARE;
  IF NOT FOUND OR actor.is_admin IS NOT TRUE OR NOT public.aka_agent_staff_time_allowed(actor.id) THEN RAISE EXCEPTION 'staff_access_denied'; END IF;
  SELECT o.* INTO STRICT org FROM public.org_organization o WHERE o.id=actor.organization_id FOR SHARE;
  IF mutation THEN
    request_id:=(p_data->>'requestId')::uuid;
    IF request_id IS NULL THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    SELECT * INTO request FROM public.auto_staff_management_requests WHERE auto_staff_management_requests.request_id=request_id;
    IF FOUND THEN
      IF request.actor_id<>actor.id OR request.organization_id<>org.id OR request.action<>p_action OR request.payload IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'staff_conflict'; END IF;
      RETURN request.result;
    END IF;
  END IF;

  IF p_action='list' THEN
    IF length(coalesce(p_data->>'search',''))>200 OR coalesce(p_data->>'status','all') NOT IN ('all','active','locked','expired') THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    offset_rows:=greatest(0,coalesce((p_data->>'page')::integer,0))*100;
    group_id:=(p_data->>'groupId')::bigint;
    IF group_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.org_group WHERE org_group.id=group_id AND organization_id=org.id) THEN RAISE EXCEPTION 'staff_not_found'; END IF;
      WITH RECURSIVE tree AS (SELECT g.id FROM public.org_group g WHERE g.id=group_id AND g.organization_id=org.id
        UNION SELECT g.id FROM public.org_group g JOIN tree t ON g.parent_id=t.id WHERE g.organization_id=org.id)
      SELECT array_agg(t.id) INTO group_ids FROM tree t;
    END IF;
    WITH rows AS MATERIALIZED (SELECT public.aka_agent_staff_management_row(s.id) row FROM public.org_staff s
      WHERE s.organization_id=org.id AND s.deleted_at IS NULL
      AND (coalesce(p_data->>'search','')='' OR strpos(lower(s.name||' '||s.phone||' '||s.username),lower(p_data->>'search'))>0)
      AND (group_id IS NULL OR EXISTS (SELECT 1 FROM public.org_group_staff gs WHERE gs.staff_id=s.id AND gs.organization_id=org.id AND gs.group_id=ANY(group_ids)))),
    filtered AS (SELECT row FROM rows WHERE coalesce(p_data->>'status','all')='all' OR row->>'status'=p_data->>'status'),
    page AS (SELECT row FROM filtered ORDER BY (row->>'id')::bigint OFFSET offset_rows LIMIT 100)
    SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(row ORDER BY (row->>'id')::bigint) FROM page),'[]'::jsonb),
      'total',(SELECT count(*) FROM filtered),'page',offset_rows/100) INTO result;
    SELECT count(*) INTO total FROM public.org_staff s WHERE s.organization_id=org.id AND s.deleted_at IS NULL;
    result:=result||jsonb_build_object('organization',jsonb_build_object('id',org.id,'name',org.name,'maxStaff',org.max_staff,
      'staffCount',total,'staffDurationDays',coalesce(org.staff_duration_days,365),'useStaffExpiration',org.use_staff_expiration,'useOrganizationExpiration',NOT org.use_staff_expiration,
      'expirationDate',(SELECT max(p.expiration_date) FROM public.org_organization_product p WHERE p.organization_id=org.id AND NOT p.is_deleted AND p.product_id IN (3,10,13,16,17,18)),
      'today',timezone('Asia/Ho_Chi_Minh',stamp)::date),
      'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'parentId',g.parent_id,'version',g.xmin::text,
        'managers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) ORDER BY m.id)
          FROM public.org_staff m WHERE m.organization_id=org.id AND m.deleted_at IS NULL
          AND EXISTS(SELECT 1 FROM public.org_group_staff gm WHERE gm.group_id=g.id AND gm.organization_id=org.id AND gm.staff_id=m.id AND gm.is_admin IS TRUE)),'[]'::jsonb),
        'staffCount',(SELECT count(DISTINCT gs.staff_id) FROM public.org_group_staff gs JOIN public.org_staff s ON s.id=gs.staff_id
          WHERE gs.group_id=g.id AND gs.organization_id=org.id AND s.organization_id=org.id AND s.deleted_at IS NULL)) ORDER BY g.id)
        FROM public.org_group g WHERE g.organization_id=org.id),'[]'::jsonb));

  ELSIF p_action='saveGroup' THEN
    id:=(p_data->>'id')::bigint; parent_id:=(p_data->>'parentId')::bigint; label:=btrim(p_data->>'name');
    IF label IS NULL OR length(label) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    SELECT count(*),min(g.id) INTO root_count,root_id FROM public.org_group g WHERE g.organization_id=org.id AND g.parent_id IS NULL;
    IF root_count>1 THEN RAISE EXCEPTION 'staff_group_multiple_roots'; END IF;
    IF root_id IS NULL THEN
      INSERT INTO public.org_group(organization_id,name,parent_id) VALUES(org.id,org.name,NULL) RETURNING org_group.id INTO root_id;
    END IF;
    -- NULL is the legacy Desktop value for 'directly under the organization'.
    parent_id:=coalesce(parent_id,root_id);
    IF parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.org_group g WHERE g.id=parent_id AND g.organization_id=org.id) THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    IF id IS NOT NULL THEN
      SELECT * INTO grp FROM public.org_group g WHERE g.id=id AND g.organization_id=org.id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;
      IF grp.parent_id IS NULL THEN RAISE EXCEPTION 'staff_group_root_read_only'; END IF;
      SELECT g.xmin::text INTO revision FROM public.org_group g WHERE g.id=id;
      IF revision IS DISTINCT FROM p_data->>'expectedVersion' THEN RAISE EXCEPTION 'staff_conflict'; END IF;
      IF parent_id IS NOT NULL AND EXISTS (WITH RECURSIVE descendants AS (
        SELECT g.id FROM public.org_group g WHERE g.id=id AND g.organization_id=org.id
        UNION SELECT g.id FROM public.org_group g JOIN descendants d ON g.parent_id=d.id WHERE g.organization_id=org.id)
        SELECT 1 FROM descendants d WHERE d.id=parent_id) THEN RAISE EXCEPTION 'staff_group_cycle'; END IF;
      UPDATE public.org_group g SET name=label,parent_id=save_parent.parent_id,updated_at=stamp
        FROM (SELECT parent_id) save_parent WHERE g.id=id;
    ELSE
      INSERT INTO public.org_group(organization_id,name,parent_id) VALUES(org.id,label,parent_id) RETURNING org_group.id INTO id;
    END IF;
    result:=jsonb_build_object('id',id);

  ELSIF p_action='saveStaff' THEN
    id:=(p_data->>'id')::bigint;group_id:=(p_data->>'groupId')::bigint;label:=btrim(p_data->>'name');phone:=public.normalize_phone(p_data->>'phone');
    IF label IS NULL OR length(label) NOT BETWEEN 1 AND 200 OR phone IS NULL OR phone !~ '^0[0-9]{9,10}$' OR group_id IS NULL THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    IF p_data ? 'isDepartmentManager' AND jsonb_typeof(p_data->'isDepartmentManager') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.org_group g WHERE g.id=group_id AND g.organization_id=org.id) THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    IF EXISTS(SELECT 1 FROM public.org_staff s WHERE s.organization_id=org.id AND public.normalize_phone(s.phone)=phone AND (id IS NULL OR s.id<>id)) THEN RAISE EXCEPTION 'staff_phone_exists'; END IF;
    IF id IS NULL THEN
      SELECT count(*) INTO total FROM public.org_staff s WHERE s.organization_id=org.id AND s.deleted_at IS NULL;
      IF total>=org.max_staff THEN RAISE EXCEPTION 'staff_quota_full'; END IF;
      INSERT INTO public.org_staff(organization_id,name,phone,username,password,is_active,is_admin,created_at,updated_at,expiration_date)
      VALUES(org.id,label,phone,org.id::text||'.'||phone,'123456',true,false,stamp,stamp,
        (timezone('Asia/Ho_Chi_Minh',stamp)::date+coalesce(org.staff_duration_days,365)+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      RETURNING org_staff.id INTO id;
    ELSE
      SELECT * INTO target FROM public.org_staff s WHERE s.id=id AND s.organization_id=org.id AND s.deleted_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;
      IF public.aka_agent_staff_management_row(id)->>'version' IS DISTINCT FROM p_data->>'expectedVersion' THEN RAISE EXCEPTION 'staff_conflict'; END IF;
      UPDATE public.org_staff s SET name=label,phone=save_phone.phone,updated_at=stamp FROM (SELECT phone) save_phone WHERE s.id=id;
    END IF;
    DELETE FROM public.org_group_staff gs WHERE gs.staff_id=id AND gs.organization_id=org.id AND gs.group_id<>group_id;
    IF NOT EXISTS(SELECT 1 FROM public.org_group_staff gs WHERE gs.staff_id=id AND gs.organization_id=org.id AND gs.group_id=group_id) THEN
      INSERT INTO public.org_group_staff(organization_id,staff_id,group_id,is_admin) VALUES(org.id,id,group_id,false);
    END IF;
    -- Optional for legacy clients: omission keeps the previous membership behavior.
    -- Explicit true replaces every current manager of the chosen department, as Chat does.
    IF p_data ? 'isDepartmentManager' THEN
      IF (p_data->>'isDepartmentManager')::boolean THEN
        UPDATE public.org_group_staff gs SET is_admin=false
          WHERE gs.organization_id=org.id AND gs.group_id=group_id AND gs.staff_id<>id AND gs.is_admin IS TRUE;
      END IF;
      UPDATE public.org_group_staff gs SET is_admin=(p_data->>'isDepartmentManager')::boolean
        WHERE gs.organization_id=org.id AND gs.group_id=group_id AND gs.staff_id=id
          AND gs.is_admin IS DISTINCT FROM (p_data->>'isDepartmentManager')::boolean;
    END IF;
    result:=public.aka_agent_staff_management_row(id);

  ELSIF p_action='revealPassword' THEN
    SELECT s.password INTO revision FROM public.org_staff s WHERE s.id=(p_data->>'id')::bigint AND s.organization_id=org.id AND s.deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    result:=jsonb_build_object('password',revision);

  ELSE
    IF p_action='prepareDevices' THEN
      IF jsonb_typeof(p_data->'ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
      SELECT array_agg(DISTINCT value::bigint ORDER BY value::bigint) INTO ids FROM jsonb_array_elements_text(p_data->'ids');
    ELSE
      IF jsonb_typeof(p_data->'targets') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
      SELECT array_agg(DISTINCT (value->>'id')::bigint ORDER BY (value->>'id')::bigint) INTO ids FROM jsonb_array_elements(p_data->'targets');
    END IF;
    IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 100 OR array_position(ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
    IF p_action='prepareDevices' THEN
      PERFORM s.id FROM public.org_staff s WHERE s.id=ANY(ids) AND s.organization_id=org.id ORDER BY s.id FOR SHARE;
    ELSE
      PERFORM s.id FROM public.org_staff s WHERE s.id=ANY(ids) AND s.organization_id=org.id ORDER BY s.id FOR UPDATE;
    END IF;
    IF (SELECT count(*) FROM public.org_staff s WHERE s.id=ANY(ids) AND s.organization_id=org.id AND s.deleted_at IS NULL)<>cardinality(ids) THEN RAISE EXCEPTION 'staff_not_found'; END IF;
    IF p_action='prepareDevices' THEN
      SELECT jsonb_build_object('items',jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'username',s.username,
        'version',s.xmin::text,'isBound',s.aka_agent_device_fingerprint_hash IS NOT NULL,
        'label',presence.device_label,'platform',presence.device_platform,'lastSeenAt',presence.last_seen_at) ORDER BY s.id)) INTO result
      FROM public.org_staff s LEFT JOIN LATERAL (SELECT p.device_label,p.device_platform,p.last_seen_at FROM public.auto_staff_device_presence p
        WHERE p.staff_id=s.id AND p.organization_id=org.id ORDER BY p.last_seen_at DESC LIMIT 1) presence ON true WHERE s.id=ANY(ids);
    ELSE
      IF jsonb_array_length(p_data->'targets')<>cardinality(ids) THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
      FOR obj IN SELECT value FROM jsonb_array_elements(p_data->'targets') LOOP
        IF jsonb_typeof(obj) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(obj) k WHERE k NOT IN ('id','expectedVersion')) THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
        IF (obj->>'id')::bigint IS NULL OR obj->>'expectedVersion' IS NULL THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
        IF p_action='setStatus' THEN revision:=public.aka_agent_staff_management_row((obj->>'id')::bigint)->>'version';
        ELSE SELECT s.xmin::text INTO revision FROM public.org_staff s WHERE s.id=(obj->>'id')::bigint; END IF;
        IF revision IS DISTINCT FROM obj->>'expectedVersion' THEN RAISE EXCEPTION 'staff_conflict'; END IF;
      END LOOP;
      IF p_action='setStatus' THEN
        IF jsonb_typeof(p_data->'isActive') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'staff_invalid_input'; END IF;
        IF NOT (p_data->>'isActive')::boolean AND (actor.id=ANY(ids) OR NOT EXISTS(SELECT 1 FROM public.org_staff s
          WHERE s.organization_id=org.id AND s.is_admin IS TRUE AND s.is_active AND s.deleted_at IS NULL AND NOT s.id=ANY(ids))) THEN RAISE EXCEPTION 'staff_admin_required'; END IF;
        UPDATE public.org_staff s SET is_active=(p_data->>'isActive')::boolean,updated_at=stamp WHERE s.id=ANY(ids);
      ELSE
        UPDATE public.org_staff s SET aka_agent_device_fingerprint_hash=NULL,updated_at=stamp
          WHERE s.id=ANY(ids) AND s.aka_agent_device_fingerprint_hash IS NOT NULL;
      END IF;
      result:=jsonb_build_object('count',cardinality(ids));
    END IF;
  END IF;
  IF mutation THEN
    INSERT INTO public.auto_staff_management_requests(request_id,actor_id,organization_id,action,payload,result)
      VALUES(request_id,actor.id,org.id,p_action,p_data,result);
  END IF;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_staff_management_row(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object('id',s.id,'name',s.name,'phone',s.phone,'username',s.username,
    'isAdmin',s.is_admin IS TRUE,'isActive',s.is_active,'createdAt',s.created_at,
    'expirationDate',s.expiration_date,'effectiveExpirationDate',e.expires,
    'expirySource',CASE WHEN NOT o.use_staff_expiration OR s.expiration_date IS NULL THEN 'organization' ELSE 'staff' END,
    'status',CASE WHEN NOT s.is_active THEN 'locked' WHEN e.expires IS NULL OR timezone('Asia/Ho_Chi_Minh',e.expires)::date < timezone('Asia/Ho_Chi_Minh',now())::date THEN 'expired' ELSE 'active' END,
    'daysRemaining',greatest(0,timezone('Asia/Ho_Chi_Minh',e.expires)::date-timezone('Asia/Ho_Chi_Minh',now())::date),
    'groupIds',coalesce(g.ids,'[]'::jsonb),'groupNames',coalesce(g.names,'[]'::jsonb),
    'managerGroupIds',coalesce(g.manager_ids,'[]'::jsonb),
    'version',s.xmin::text||':'||md5(coalesce(g.revision,'')))
  FROM public.org_staff s JOIN public.org_organization o ON o.id=s.organization_id
  LEFT JOIN LATERAL (SELECT max(p.expiration_date) expires FROM public.org_organization_product p
    WHERE p.organization_id=s.organization_id AND NOT p.is_deleted AND p.product_id IN (3,10,13,16,17,18)) p ON true
  CROSS JOIN LATERAL (SELECT CASE WHEN NOT o.use_staff_expiration OR s.expiration_date IS NULL THEN p.expires
    WHEN p.expires IS NULL THEN NULL ELSE least(s.expiration_date,p.expires) END expires) e
  LEFT JOIN LATERAL (SELECT jsonb_agg(g.id ORDER BY g.id) ids,jsonb_agg(g.name ORDER BY g.id) names,
    jsonb_agg(g.id ORDER BY g.id) FILTER (WHERE gs.is_admin IS TRUE) manager_ids,
    string_agg(gs.id::text||':'||gs.group_id::text||':'||gs.is_admin::text,',' ORDER BY gs.id) revision
    FROM public.org_group_staff gs JOIN public.org_group g ON g.id=gs.group_id AND g.organization_id=s.organization_id
    WHERE gs.staff_id=s.id AND gs.organization_id=s.organization_id) g ON true
  WHERE s.id=p_id AND s.deleted_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_previous_status text, p_claim_token uuid, p_requires_login boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
  v_capabilities record;
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'staff_not_active'
    );
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT *
  INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(
    v_organization_id
  );

  SELECT account.*
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    )
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_found'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);
  IF (
    v_runtime_target = 'server'
    AND (
      v_is_web
      OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    )
  ) OR (
    v_runtime_target = 'desktop'
    AND (
      v_is_server
      OR (
        v_is_web
        AND NOT COALESCE(v_capabilities.web_enabled, false)
      )
      OR (
        NOT v_is_web
        AND NOT v_is_server
        AND NOT COALESCE(v_capabilities.qr_enabled, false)
      )
    )
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'runtime_not_owner'
    );
  END IF;

  -- Retry of the same account-operation token remains idempotent after an
  -- ambiguous response. A campaign cannot form a unit while this account row
  -- is already owned/running by that token.
  IF v_account.status = 'đang chạy'
    AND v_account.runtime_operation_claim_token = p_claim_token
  THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'account_id', p_account_id,
      'previous_status', v_previous_status,
      'claim_token', p_claim_token,
      'runtime_target', v_runtime_target
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_inputs AS campaign_input
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = campaign_input.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign_input.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS input_data
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = input_data.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND input_data.status = 'đang chạy'
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'work_running'
    );
  END IF;

  IF v_account.status IS DISTINCT FROM v_previous_status
    OR (
      COALESCE(p_requires_login, true)
      AND (
        v_account.is_active IS NOT TRUE
        OR v_account.login_status IS DISTINCT FROM 'đã đăng nhập'
      )
    )
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  UPDATE public.auto_accounts AS account
  SET status = 'đang chạy',
    runtime_operation_claim_token = p_claim_token,
    updated_at = now()
  WHERE account.id = p_account_id
    AND account.status = v_previous_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_previous_status,
    'claim_token', p_claim_token,
    'runtime_target', v_runtime_target
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_control_zalo_account_atomic(p_staff_id bigint, p_organization_id bigint, p_max_accounts integer, p_account jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_account_id bigint;
  v_account_count integer := 0;
  v_account_group_id bigint := NULLIF(p_account->>'accountGroupId', '')::bigint;
  v_proxy_id bigint := NULLIF(p_account->>'proxyId', '')::bigint;
  v_server_pool record;
  v_pool_subtypes text[] := ARRAY[]::text[];
  v_resource_local_count integer := 0;
  v_resource_server_count integer := 0;
  v_resource_lock_key bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR jsonb_typeof(COALESCE(p_account, '{}'::jsonb)) <> 'object'
    OR NULLIF(btrim(COALESCE(p_account->>'name', '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'invalid_control_zalo_account_payload';
  END IF;

  PERFORM 1
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  -- Match the existing resource-lock ordering so account creation cannot race
  -- group/proxy reassignment or deadlock another Control mutation.
  FOR v_resource_lock_key IN
    SELECT DISTINCT resource.lock_key
    FROM (
      VALUES
        (
          CASE
            WHEN v_account_group_id IS NULL THEN NULL
            ELSE hashtextextended(
              'control-zalo-account-group:' || v_account_group_id::text,
              0
            )
          END
        ),
        (
          CASE
            WHEN v_proxy_id IS NULL THEN NULL
            ELSE hashtextextended(
              'control-zalo-proxy:' || v_proxy_id::text,
              0
            )
          END
        )
    ) AS resource(lock_key)
    WHERE resource.lock_key IS NOT NULL
    ORDER BY resource.lock_key
  LOOP
    PERFORM pg_advisory_xact_lock(v_resource_lock_key);
  END LOOP;

  IF v_account_group_id IS NOT NULL THEN
    PERFORM account_group.id
    FROM public.auto_account_groups AS account_group
    WHERE account_group.id = v_account_group_id
      AND account_group.staff_id = p_staff_id
      AND account_group.organization_id = p_organization_id
      AND account_group.flatform_type = 'zalo'
      AND COALESCE(account_group.is_delete, false) = false
    FOR UPDATE OF account_group;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'created', false,
        'reason', 'account_group_not_found'
      );
    END IF;

    SELECT
      count(*) FILTER (
        WHERE lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND NOT (
            COALESCE(account.is_zalo_show_web, false) = false
            AND COALESCE(account.is_zalo_server, false) = true
          )
      )::integer,
      count(*) FILTER (
        WHERE lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
      )::integer
    INTO v_resource_local_count, v_resource_server_count
    FROM public.auto_accounts AS account
    WHERE account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND account.account_group_id = v_account_group_id
      AND COALESCE(account.is_delete, false) = false;

    IF v_resource_local_count > 0 AND v_resource_server_count = 0 THEN
      RETURN jsonb_build_object(
        'created', false,
        'reason', 'account_group_local_only'
      );
    END IF;
  END IF;

  IF v_proxy_id IS NOT NULL THEN
    PERFORM proxy.id
    FROM public.auto_proxies AS proxy
    WHERE proxy.id = v_proxy_id
      AND proxy.staff_id = p_staff_id
      AND proxy.organization_id = p_organization_id
      AND COALESCE(proxy.is_delete, false) = false
    FOR UPDATE OF proxy;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'created', false,
        'reason', 'proxy_not_found'
      );
    END IF;

    SELECT
      count(*) FILTER (
        WHERE NOT (
          lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
      )::integer,
      count(*) FILTER (
        WHERE lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
      )::integer
    INTO v_resource_local_count, v_resource_server_count
    FROM public.auto_accounts AS account
    WHERE account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND account.proxy_id = v_proxy_id
      AND COALESCE(account.is_delete, false) = false;

    IF v_resource_local_count > 0 AND v_resource_server_count = 0 THEN
      RETURN jsonb_build_object(
        'created', false,
        'reason', 'proxy_local_only'
      );
    END IF;
  END IF;

  -- Resource locks precede entitlement and staff-quota locks, matching the
  -- current trigger/RPC order.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT *
  INTO v_server_pool
  FROM private.resolve_organization_zalo_entitlement_pools(p_organization_id)
  WHERE account_subtype = 'server';

  IF v_server_pool.entitlement_id IS NULL THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'capability_unavailable'
    );
  END IF;

  SELECT COALESCE(
    array_agg(pool.account_subtype ORDER BY pool.account_subtype),
    ARRAY[]::text[]
  )
  INTO v_pool_subtypes
  FROM private.resolve_organization_zalo_entitlement_pools(
    p_organization_id
  ) AS pool
  WHERE pool.entitlement_id = v_server_pool.entitlement_id;

  -- p_max_accounts remains wire-compatible. The resolved Server entitlement
  -- is authoritative.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('control-zalo-account:' || p_staff_id::text, 0)
  );

  SELECT count(*)::integer
  INTO v_account_count
  FROM public.auto_accounts AS account
  WHERE account.staff_id = p_staff_id
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    )
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_delete, false) = false
    AND (
      CASE
        WHEN COALESCE(account.is_zalo_show_web, false) THEN 'web'
        WHEN COALESCE(account.is_zalo_server, false) THEN 'server'
        ELSE 'qr'
      END
    ) = ANY(v_pool_subtypes);

  IF v_server_pool.max_accounts IS NOT NULL
    AND v_server_pool.max_accounts > 0
    AND v_account_count >= v_server_pool.max_accounts
  THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'account_limit_reached',
      'max_accounts', v_server_pool.max_accounts
    );
  END IF;

  -- This Control surface always creates the Server subtype.
  INSERT INTO public.auto_accounts (
    name,
    flatform_type,
    is_zalo_show_web,
    is_zalo_server,
    login_status,
    status,
    is_active,
    account_group_id,
    proxy_id,
    staff_id,
    organization_id,
    is_delete
  )
  VALUES (
    btrim(p_account->>'name'),
    'zalo',
    false,
    true,
    'chưa đăng nhập',
    'chờ xử lý',
    COALESCE((p_account->>'isActive')::boolean, true),
    v_account_group_id,
    v_proxy_id,
    p_staff_id,
    p_organization_id,
    false
  )
  RETURNING id INTO v_account_id;

  RETURN jsonb_build_object(
    'created', true,
    'account_id', v_account_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_zalo_account_capability_and_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_new_platform text := lower(btrim(COALESCE(NEW.flatform_type, '')));
  v_old_platform text := CASE
    WHEN TG_OP = 'UPDATE' THEN lower(btrim(COALESCE(OLD.flatform_type, '')))
    ELSE ''
  END;
  v_staff_organization_id bigint;
  v_organization_id bigint;
  v_new_subtype text;
  v_pool record;
  v_pool_subtypes text[] := ARRAY[]::text[];
  v_account_count integer := 0;
  v_requires_capability_check boolean := false;
  v_requires_quota_check boolean := false;
  v_is_existing_subtype_change boolean := false;
  v_is_claimed_subtype_cas boolean := false;
BEGIN
  IF v_new_platform <> 'zalo' OR COALESCE(NEW.is_delete, false) THEN
    RETURN NEW;
  END IF;

  v_new_subtype := CASE
    WHEN COALESCE(NEW.is_zalo_show_web, false) THEN 'web'
    WHEN COALESCE(NEW.is_zalo_server, false) THEN 'server'
    ELSE 'qr'
  END;

  -- Backend-only SQL import: preserve expired entitlements, locked staff and existing
  -- legacy counts. This context is scoped/restored by akabiz_migrate_sql_account_v1.
  -- Tenant callers cannot opt in, even if they manage to set the custom GUC.
  IF TG_OP = 'INSERT'
    AND (current_setting('role', true) = 'service_role'
      OR (session_user = 'postgres' AND current_setting('role', true) IN ('none','postgres')))
    AND current_setting('aka_agent.sql_migration_org', true) = NEW.organization_id::text
    AND NEW.is_zalo_server = true AND NEW.is_zalo_show_web = false
    AND EXISTS (SELECT 1 FROM public.org_staff s WHERE s.id = NEW.staff_id
      AND s.organization_id = NEW.organization_id AND s.deleted_at IS NULL)
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_requires_capability_check := true;
    v_requires_quota_check := true;
  ELSE
    v_is_existing_subtype_change := v_old_platform = 'zalo'
      AND v_new_platform = 'zalo'
      AND OLD.id IS NOT DISTINCT FROM NEW.id
      AND OLD.flatform_type IS NOT DISTINCT FROM NEW.flatform_type
      AND COALESCE(OLD.is_delete, false) = false
      AND COALESCE(NEW.is_delete, false) = false
      AND OLD.staff_id IS NOT DISTINCT FROM NEW.staff_id
      AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
      AND (
        COALESCE(OLD.is_zalo_show_web, false)
          IS DISTINCT FROM COALESCE(NEW.is_zalo_show_web, false)
        OR COALESCE(OLD.is_zalo_server, false)
          IS DISTINCT FROM COALESCE(NEW.is_zalo_server, false)
      );
    v_is_claimed_subtype_cas := v_is_existing_subtype_change
      AND OLD.status = 'đang chạy'
      AND NEW.status = 'đang chạy'
      AND OLD.runtime_operation_claim_token IS NOT NULL
      AND OLD.runtime_operation_claim_token
        IS NOT DISTINCT FROM NEW.runtime_operation_claim_token;
    v_requires_capability_check := v_old_platform <> 'zalo'
      OR COALESCE(OLD.is_delete, false)
      OR OLD.staff_id IS DISTINCT FROM NEW.staff_id
      OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
      OR COALESCE(OLD.is_zalo_show_web, false)
        IS DISTINCT FROM COALESCE(NEW.is_zalo_show_web, false)
      OR COALESCE(OLD.is_zalo_server, false)
        IS DISTINCT FROM COALESCE(NEW.is_zalo_server, false);
    v_requires_quota_check := v_requires_capability_check;
  END IF;

  IF NOT v_requires_capability_check AND NOT v_requires_quota_check THEN
    RETURN NEW;
  END IF;

  -- Subtype ownership is changed only by the tokenized claim/CAS/release
  -- protocol. Preserve the existing fail-closed and lock-order behavior.
  IF v_is_existing_subtype_change AND NOT v_is_claimed_subtype_cas THEN
    RAISE EXCEPTION 'zalo_account_subtype_change_claim_required';
  END IF;

  IF v_is_claimed_subtype_cas THEN
    SELECT staff.organization_id
    INTO v_staff_organization_id
    FROM public.org_staff AS staff
    WHERE staff.id = NEW.staff_id
      AND staff.is_active = true;
  ELSE
    SELECT staff.organization_id
    INTO v_staff_organization_id
    FROM public.org_staff AS staff
    WHERE staff.id = NEW.staff_id
      AND staff.is_active = true
    FOR SHARE OF staff;
  END IF;

  IF NOT FOUND OR v_staff_organization_id IS NULL THEN
    RAISE EXCEPTION 'zalo_account_staff_not_active';
  END IF;

  v_organization_id := COALESCE(NEW.organization_id, v_staff_organization_id);
  IF v_organization_id IS DISTINCT FROM v_staff_organization_id THEN
    RAISE EXCEPTION 'zalo_account_organization_mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT *
  INTO v_pool
  FROM private.resolve_organization_zalo_entitlement_pools(v_organization_id)
  WHERE account_subtype = v_new_subtype;

  IF v_requires_capability_check AND v_pool.entitlement_id IS NULL THEN
    RAISE EXCEPTION 'zalo_account_capability_unavailable';
  END IF;

  IF v_requires_quota_check THEN
    SELECT COALESCE(
      array_agg(pool.account_subtype ORDER BY pool.account_subtype),
      ARRAY[]::text[]
    )
    INTO v_pool_subtypes
    FROM private.resolve_organization_zalo_entitlement_pools(
      v_organization_id
    ) AS pool
    WHERE pool.entitlement_id = v_pool.entitlement_id;

    -- This is the same transaction lock used by the atomic Control creator.
    -- Calls are re-entrant, so the RPC and trigger remain race-safe together.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('control-zalo-account:' || NEW.staff_id::text, 0)
    );

    SELECT count(*)::integer
    INTO v_account_count
    FROM public.auto_accounts AS account
    WHERE account.staff_id = NEW.staff_id
      AND (
        account.organization_id IS NULL
        OR account.organization_id = v_organization_id
      )
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_delete, false) = false
      AND (
        TG_OP <> 'UPDATE'
        OR account.id IS DISTINCT FROM NEW.id
      )
      AND (
        CASE
          WHEN COALESCE(account.is_zalo_show_web, false) THEN 'web'
          WHEN COALESCE(account.is_zalo_server, false) THEN 'server'
          ELSE 'qr'
        END
      ) = ANY(v_pool_subtypes);

    IF v_pool.max_accounts IS NOT NULL
      AND v_pool.max_accounts > 0
      AND v_account_count >= v_pool.max_accounts
    THEN
      RAISE EXCEPTION 'zalo_account_limit_reached';
    END IF;
  END IF;

  RETURN NEW;
END;
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

  RETURN QUERY SELECT p_campaign_id, p_account_id, v_campaign_status,
    v_account_status, v_account_login_status, v_account_is_active,
    v_account_is_delete, v_campaign_is_delete, v_pause_requested,
    v_pause_requested OR v_hard_stop_reason IS NOT NULL, v_hard_stop_reason;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_check_campaign_daily_boundary(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_claimed_vietnam_date date)
 RETURNS TABLE(allow_new_unit boolean, reason text, campaign_status text, account_status text, db_now timestamp with time zone, vietnam_date_key date, claimed_vietnam_date_key date, effective_stop_time time without time zone, boundary_at timestamp with time zone, day_changed boolean)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_organization_id bigint;
  v_campaign_status text;
  v_account_status text;
  v_daily_stop_time time without time zone;
  v_campaign_is_delete boolean;
  v_account_is_delete boolean;
  v_account_is_active boolean;
  v_account_login_status text;
  v_account_platform text;
  v_account_is_zalo_web boolean;
  v_account_is_zalo_server boolean;
  v_effective_stop_time time without time zone;
  v_boundary_at timestamptz;
  v_day_changed boolean;
  v_reason text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'campaign, account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF p_claimed_vietnam_date IS NULL THEN
    RAISE EXCEPTION 'claimed Vietnam date is required';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
    AND (public.aka_agent_staff_time_allowed(staff.id) OR EXISTS (
      SELECT 1 FROM public.auto_campaigns held WHERE held.id=p_campaign_id
        AND held.account_id=p_account_id AND held.staff_id=p_staff_id AND held.runtime_unit_token IS NOT NULL
    ))
  ;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text,
      v_now, v_vietnam_date, p_claimed_vietnam_date,
      NULL::time, NULL::timestamptz,
      v_vietnam_date > p_claimed_vietnam_date;
    RETURN;
  END IF;

  SELECT
    campaign.status,
    account.status,
    campaign.daily_stop_time,
    COALESCE(campaign.is_delete, false),
    COALESCE(account.is_delete, false),
    COALESCE(account.is_active, false),
    account.login_status,
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false)
  INTO
    v_campaign_status,
    v_account_status,
    v_daily_stop_time,
    v_campaign_is_delete,
    v_account_is_delete,
    v_account_is_active,
    v_account_login_status,
    v_account_platform,
    v_account_is_zalo_web,
    v_account_is_zalo_server
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = v_organization_id
    )
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    );

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      v_now, v_vietnam_date, p_claimed_vietnam_date,
      NULL::time, NULL::timestamptz,
      v_vietnam_date > p_claimed_vietnam_date;
    RETURN;
  END IF;

  v_effective_stop_time := LEAST(
    COALESCE(v_daily_stop_time, time '23:59:00'),
    time '23:59:00'
  );
  v_boundary_at := (
    p_claimed_vietnam_date + v_effective_stop_time
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_day_changed := v_vietnam_date > p_claimed_vietnam_date;

  IF (v_runtime_target = 'server' AND (
      v_account_platform <> 'zalo'
      OR v_account_is_zalo_web
      OR NOT v_account_is_zalo_server
    ))
    OR (v_runtime_target = 'desktop' AND (
      v_account_platform = 'zalo' AND v_account_is_zalo_server
    ))
  THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_campaign_is_delete THEN
    v_reason := 'campaign_deleted';
  ELSIF v_account_is_delete THEN
    v_reason := 'account_deleted';
  ELSIF NOT v_account_is_active THEN
    v_reason := 'account_inactive';
  ELSIF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    v_reason := 'account_logged_out';
  ELSIF v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
  THEN
    -- A concurrent manual campaign/account pause always wins.
    v_reason := 'runtime_control_paused';
  ELSIF p_claimed_vietnam_date > v_vietnam_date THEN
    v_reason := 'invalid_claimed_vietnam_date';
  ELSIF v_day_changed THEN
    v_reason := 'vietnam_day_changed';
  ELSIF v_now >= v_boundary_at THEN
    -- Inclusive comparison: no unit may start exactly at the cutoff.
    v_reason := CASE
      WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
      ELSE 'daily_stop_due'
    END;
  ELSE
    v_reason := 'allowed';
  END IF;

  RETURN QUERY SELECT
    v_reason = 'allowed',
    v_reason,
    v_campaign_status,
    v_account_status,
    v_now,
    v_vietnam_date,
    p_claimed_vietnam_date,
    v_effective_stop_time,
    v_boundary_at,
    v_day_changed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_sms_due_input_data(p_account_id bigint, p_campaign_ids bigint[] DEFAULT NULL::bigint[], p_carrier text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_per_campaign_limit integer DEFAULT 30)
 RETURNS TABLE(input_data_id bigint, campaign_id bigint, campaign_name text, campaign_schedule timestamp with time zone, campaign_extra_settings jsonb, input_schedule timestamp with time zone, effective_schedule timestamp with time zone, input_created_at timestamp with time zone, phone text, phone_carrier text, content text, name text, info1 text, info2 text, info3 text, info4 text, info5 text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH normalized AS (
    SELECT
      p_campaign_ids AS campaign_ids,
      NULLIF(btrim(lower(coalesce(p_carrier, ''))), '') AS carrier,
      LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) AS row_limit,
      LEAST(GREATEST(COALESCE(p_per_campaign_limit, 30), 1), 500) AS per_campaign_limit
  ),
  allowed_campaigns AS (
    SELECT
      campaign.id,
      campaign.name,
      campaign.schedule,
      COALESCE(campaign.extra_settings, '{}'::jsonb) AS extra_settings
    FROM public.auto_campaigns AS campaign
    CROSS JOIN normalized
    WHERE campaign.account_id = p_account_id
      AND campaign.action_id = 'sms_send'
      AND campaign.status = 'chờ xử lý'
      AND COALESCE(campaign.is_delete, false) = false
      AND (
        normalized.campaign_ids IS NULL
        OR campaign.id = ANY(normalized.campaign_ids)
      )
  )
  SELECT
    data.id AS input_data_id,
    campaign.id AS campaign_id,
    campaign.name AS campaign_name,
    campaign.schedule AS campaign_schedule,
    campaign.extra_settings AS campaign_extra_settings,
    data.schedule AS input_schedule,
    COALESCE(data.schedule, campaign.schedule) AS effective_schedule,
    data.created_at AS input_created_at,
    data.phone,
    data.phone_carrier,
    data.content,
    data.name,
    data.info1,
    data.info2,
    data.info3,
    data.info4,
    data.info5
  FROM allowed_campaigns AS campaign
  CROSS JOIN normalized
  CROSS JOIN LATERAL (
    SELECT input_data.*
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = campaign.id
      AND input_data.status = 'chờ xử lý'
      AND COALESCE(input_data.is_delete, false) = false
      AND NULLIF(btrim(coalesce(input_data.phone, '')), '') IS NOT NULL
      AND NULLIF(btrim(coalesce(input_data.content, '')), '') IS NOT NULL
      AND (
        normalized.carrier IS NULL
        OR normalized.carrier = 'all'
        OR lower(coalesce(input_data.phone_carrier, 'unknown')) = normalized.carrier
      )
      AND (
        COALESCE(input_data.schedule, campaign.schedule) IS NULL
        OR COALESCE(input_data.schedule, campaign.schedule) <= now()
      )
    ORDER BY
      COALESCE(input_data.schedule, campaign.schedule) ASC NULLS FIRST,
      input_data.created_at ASC NULLS FIRST,
      input_data.id ASC
    LIMIT (SELECT per_campaign_limit FROM normalized)
  ) AS data
  ORDER BY
    COALESCE(data.schedule, campaign.schedule) ASC NULLS FIRST,
    data.created_at ASC NULLS FIRST,
    data.id ASC
  LIMIT (SELECT row_limit FROM normalized);
$function$;
DO $postflight$ BEGIN
  IF to_regprocedure('aka_agent_authenticate_control_session(text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_authenticate_control_session(text)')
      AND md5(pg_get_functiondef(p.oid))='7995d6e92b16eb17b44995e14aae1b87'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_authenticate_control_session(text)'; END IF;
  IF to_regprocedure('aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)')
      AND md5(pg_get_functiondef(p.oid))='6ac923806e9e78cb4872e6909d487a6c'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public, pg_temp", "statement_timeout=20s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)'; END IF;
  IF to_regprocedure('aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)')
      AND md5(pg_get_functiondef(p.oid))='c2fcb127716bc511d36d8f0763fcc07b'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public", "statement_timeout=60s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)'; END IF;
  IF to_regprocedure('aka_agent_staff_access(bigint,text,text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_staff_access(bigint,text,text)')
      AND md5(pg_get_functiondef(p.oid))='ca59bfbfa79c7e40ec50788e77b9d022'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_staff_access(bigint,text,text)'; END IF;
  IF to_regprocedure('aka_agent_staff_client(text,text,text,jsonb)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_staff_client(text,text,text,jsonb)')
      AND md5(pg_get_functiondef(p.oid))='73830b14c79b98802050cc9419cfd6c1'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public", "lock_timeout=3s", "statement_timeout=12s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_staff_client(text,text,text,jsonb)'; END IF;
  IF to_regprocedure('aka_agent_staff_management(bigint,text,text,text,jsonb)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_staff_management(bigint,text,text,text,jsonb)')
      AND md5(pg_get_functiondef(p.oid))='689c389e3380c75497c720e7e6c5dafb'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public", "lock_timeout=3s", "statement_timeout=12s"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_staff_management(bigint,text,text,text,jsonb)'; END IF;
  IF to_regprocedure('aka_agent_staff_management_row(bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_staff_management_row(bigint)')
      AND md5(pg_get_functiondef(p.oid))='4964edb52ffc866f610036212d14fb08'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_staff_management_row(bigint)'; END IF;
  IF to_regprocedure('claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)')
      AND md5(pg_get_functiondef(p.oid))='6884cc5eb00e3076c491ac35f453babf'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)'; END IF;
  IF to_regprocedure('create_control_zalo_account_atomic(bigint,bigint,integer,jsonb)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('create_control_zalo_account_atomic(bigint,bigint,integer,jsonb)')
      AND md5(pg_get_functiondef(p.oid))='a42a8a093fd19dc094b002c45890e1bd'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','create_control_zalo_account_atomic(bigint,bigint,integer,jsonb)'; END IF;
  IF to_regprocedure('enforce_zalo_account_capability_and_quota()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('enforce_zalo_account_capability_and_quota()')
      AND md5(pg_get_functiondef(p.oid))='1edc48a7985f2268159ad0b605fb205b'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'
      AND p.prosecdef=true AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public, private"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','enforce_zalo_account_capability_and_quota()'; END IF;
  IF to_regprocedure('aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)')
      AND md5(pg_get_functiondef(p.oid))='e8fbdc5224846296f0c8816be82958d3'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)'; END IF;
  IF to_regprocedure('aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)')
      AND md5(pg_get_functiondef(p.oid))='272de6b1e353a955d6394b912578e024'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='v'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=pg_catalog, public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)'; END IF;
  IF to_regprocedure('aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)')
      AND md5(pg_get_functiondef(p.oid))='70ffadf2302e9601f68d1af0dab41469'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_message_ingest_owner=X/postgres,authenticator=X/postgres,cli_login_postgres=X/postgres,crm_interest_worker=X/postgres,dashboard_user=X/postgres,pg_checkpoint=X/postgres,pg_create_subscription=X/postgres,pg_database_owner=X/postgres,pg_execute_server_program=X/postgres,pg_maintain=X/postgres,pg_monitor=X/postgres,pg_read_all_data=X/postgres,pg_read_all_settings=X/postgres,pg_read_all_stats=X/postgres,pg_read_server_files=X/postgres,pg_signal_backend=X/postgres,pg_stat_scan_tables=X/postgres,pg_use_reserved_connections=X/postgres,pg_write_all_data=X/postgres,pg_write_server_files=X/postgres,pgbouncer=X/postgres,supabase_admin=X/postgres,supabase_auth_admin=X/postgres,supabase_etl_admin=X/postgres,supabase_functions_admin=X/postgres,supabase_privileged_role=X/postgres,supabase_read_only_user=X/postgres,supabase_realtime_admin=X/postgres,supabase_replication_admin=X/postgres,supabase_storage_admin=X/postgres}'
      AND p.prosecdef=false AND p.provolatile='s'
      AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM '["search_path=public"]'::jsonb
  ) THEN RAISE EXCEPTION 'app_access_live_drift: %','aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)'; END IF;
END $postflight$;
NOTIFY pgrst,'reload schema';
COMMIT;

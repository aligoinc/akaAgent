-- PHASE B: read-only runtime projection and existing invoker compatibility.
-- Candidate, NOT applied. No RLS/grant change on org_staff in this migration.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('public.aka_agent_staff_runtime_profile') IS NOT NULL
 OR to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'staff runtime compatibility objects already exist; re-audit';
 END IF;
END;
$preflight$;

-- Intentional definer view: only the metadata already returned by Server
-- discovery/capability RPCs. No passwords, device hashes, CRM fields or writes.
CREATE VIEW public.aka_agent_staff_runtime_profile WITH (security_barrier=true) AS
 SELECT id,organization_id,name,phone,username,is_active,is_admin,is_admin_akabiz,use_test_workflow,deleted_at,expiration_date,max_running_zalo_web_accounts,max_running_facebook_accounts FROM public.org_staff;
ALTER VIEW public.aka_agent_staff_runtime_profile OWNER TO postgres;
REVOKE ALL ON public.aka_agent_staff_runtime_profile FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.aka_agent_staff_runtime_profile TO anon,authenticated,service_role;

-- Locks the same staff row, in the same position in each original RPC's lock
-- order. Only this narrow helper runs as owner; campaign/account writes still
-- run as the caller and retain their original RLS, tokens and CAS guards.
CREATE FUNCTION public.aka_agent_staff_runtime_scope(p_staff_id bigint,p_lock text)
RETURNS SETOF public.aka_agent_staff_runtime_profile
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s'
AS $function$
BEGIN
 IF p_staff_id IS NULL OR p_staff_id<=0 OR p_lock IS NULL OR p_lock NOT IN ('share','update') THEN
  RAISE EXCEPTION 'staff_runtime_scope_invalid';
 END IF;
 IF p_lock='share' THEN
  RETURN QUERY SELECT s.id,s.organization_id,s.name,s.phone,s.username,s.is_active,s.is_admin,s.is_admin_akabiz,s.use_test_workflow,s.deleted_at,s.expiration_date,s.max_running_zalo_web_accounts,s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id=p_staff_id FOR SHARE OF s;
 ELSE
  RETURN QUERY SELECT s.id,s.organization_id,s.name,s.phone,s.username,s.is_active,s.is_admin,s.is_admin_akabiz,s.use_test_workflow,s.deleted_at,s.expiration_date,s.max_running_zalo_web_accounts,s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id=p_staff_id FOR UPDATE OF s;
 END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_staff_runtime_scope(bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_staff_runtime_scope(bigint,text) TO anon,authenticated,service_role;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_advance_zalo_server_multi_daily_slot(bigint,bigint,bigint,timestamp with time zone)')
  AND md5(pg_get_functiondef(oid))='74d42a41077050f99e82b33ae75d76f3' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_advance_zalo_server_multi_daily_slot(bigint,bigint,bigint,timestamp with time zone)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_advance_zalo_server_multi_daily_slot(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_next_schedule timestamp with time zone)
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, reset_count integer)
 LANGUAGE plpgsql
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
  v_reset_count integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF p_next_schedule IS NULL THEN RAISE EXCEPTION 'Next schedule is required'; END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Input status mutations use input -> campaign -> account. Lock every live
  -- row in the same deterministic order before advancing the whole slot so a
  -- concurrent pause/resume cannot invert the order or commit a stale state.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

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
    AND campaign.action_id IN ('zalo_message_friend', 'zalo_message_group')
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_found', NULL::text, NULL::text, 0; RETURN; END IF;
  IF v_campaign_is_delete THEN RETURN QUERY SELECT false, 'campaign_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_is_delete THEN RETURN QUERY SELECT false, 'account_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF NOT v_account_is_active THEN RETURN QUERY SELECT false, 'account_inactive', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN RETURN QUERY SELECT false, 'account_logged_out', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_campaign_status IS DISTINCT FROM 'đang chạy' OR v_account_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT false, 'runtime_control_paused', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'chờ xử lý', note = '', date_action = NULL
  WHERE campaign_id = p_campaign_id
    AND COALESCE(is_delete, false) = false
    AND status <> 'tạm dừng';
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý', schedule = p_next_schedule, note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  RETURN QUERY SELECT true, 'advanced', 'chờ xử lý', v_account_status, v_reset_count;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)')
  AND md5(pg_get_functiondef(oid))='8ea465944efda08fb2e89da9589e065a' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)';
 END IF;
END;
$preflight$;

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

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_check_daily_maintenance_barrier(bigint,text,date)')
  AND md5(pg_get_functiondef(oid))='087a04ad6f98cc2cff5267dabcead7cd' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_check_daily_maintenance_barrier(bigint,text,date)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_check_daily_maintenance_barrier(p_staff_id bigint, p_runtime_target text, p_vietnam_date_key date)
 RETURNS TABLE(ready boolean, running_campaign_count bigint, db_now timestamp with time zone, vietnam_date_key date)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_vietnam_day_start timestamptz := (
    timezone('Asia/Ho_Chi_Minh', v_now)::date::timestamp
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_organization_id bigint;
  v_running_campaign_count bigint := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'staff ID must be a positive integer';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF p_vietnam_date_key IS NULL THEN
    RAISE EXCEPTION 'Vietnam date key is required';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  ;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 0::bigint, v_now, v_vietnam_date;
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_running_campaign_count
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = v_organization_id
    )
    AND (
      account.organization_id IS NULL
      OR account.organization_id = v_organization_id
    )
    AND (
      -- A durable unit lease blocks maintenance by its immutable date even if
      -- DB-first pause/delete/control has changed campaign status or cleared
      -- the parent claim fields.
      (
        campaign.runtime_unit_token IS NOT NULL
        AND campaign.runtime_unit_vietnam_date IS NOT NULL
        AND campaign.runtime_unit_vietnam_date < v_vietnam_date
      )
      OR (
        COALESCE(campaign.is_delete, false) = false
        AND COALESCE(account.is_delete, false) = false
        -- SMS/voice legacy/parent claims remain outside CampaignScheduler
        -- maintenance ownership. A durable unit lease above is never skipped,
        -- even if campaign metadata was edited while that lease drains.
        AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
        AND campaign.action_id IS DISTINCT FROM 'sms_send'
        AND campaign.action_id IS DISTINCT FROM 'voice_call'
        AND campaign.status = 'đang chạy'
        AND (
          -- A parent v2 claim without an active unit still uses its immutable
          -- run date; schedule may be rewritten only after the gate opens.
          (
            campaign.runtime_claim_vietnam_date IS NOT NULL
            AND campaign.runtime_claim_vietnam_date < v_vietnam_date
          )
          OR (
            -- Old binaries never set claim metadata, so retain the legacy
            -- stale-schedule heuristic only for NULL-date running rows.
            campaign.runtime_claim_vietnam_date IS NULL
            AND campaign.schedule IS NOT NULL
            AND campaign.schedule < v_vietnam_day_start
          )
        )
      )
    )
    AND (
      (
        v_runtime_target = 'server'
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
      )
      OR (
        v_runtime_target = 'desktop'
        AND NOT (
          lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_server, false) = true
        )
      )
    );

  -- A stale caller date never opens the maintenance gate. The coordinator
  -- must refresh its DB clock and retry for the actual Vietnam date.
  RETURN QUERY SELECT
    p_vietnam_date_key = v_vietnam_date
      AND v_running_campaign_count = 0,
    v_running_campaign_count,
    v_now,
    v_vietnam_date;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)')
  AND md5(pg_get_functiondef(oid))='b721f2bf997eef62f72eaf5e2728fb8c' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_account_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_runtime_target text, p_previous_status text, p_claim_token uuid, p_requires_login boolean, p_operation_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_account public.auto_accounts%ROWTYPE; v_organization_id bigint;
BEGIN
  IF p_account_id IS NULL OR p_account_id<=0 OR p_staff_id IS NULL OR p_staff_id<=0
    OR p_claim_token IS NULL OR p_previous_status IS NULL
    OR p_previous_status NOT IN ('chờ xử lý','tạm dừng')
    OR p_platform IS NULL OR p_platform NOT IN ('zalo','facebook','email')
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop','server')
    OR (p_platform<>'zalo' AND p_runtime_target<>'desktop') THEN
    RAISE EXCEPTION 'invalid_account_operation_identity';
  END IF;
  IF p_operation_kind IS NULL OR p_operation_kind NOT IN ('operation','type_change')
    OR (p_operation_kind='type_change' AND p_platform<>'zalo') THEN
    RAISE EXCEPTION 'invalid_account_operation_kind';
  END IF;
  -- Keep the existing lock order: staff, entitlement advisory lock, account.
  SELECT organization_id INTO v_organization_id FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share')
    WHERE id=p_staff_id AND is_active=true AND public.aka_agent_staff_time_allowed(p_staff_id) ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object('claimed',false,'reason','staff_not_active');
  END IF;
  IF p_platform='zalo' THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  END IF;
  SELECT * INTO v_account FROM public.auto_accounts a
    WHERE a.id=p_account_id AND a.staff_id=p_staff_id
      AND (a.organization_id IS NULL OR a.organization_id=v_organization_id) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false,'reason','account_not_found'); END IF;
  IF COALESCE(v_account.is_delete,false) OR lower(btrim(COALESCE(v_account.flatform_type,'')))<>p_platform
    OR (p_operation_kind='operation' AND v_account.is_active IS NOT TRUE) THEN
    RETURN jsonb_build_object('claimed',false,'reason','account_not_available');
  END IF;
  -- A retry after a lost response must never undo a newer pause/resume write.
  IF v_account.runtime_operation_claim_token=p_claim_token AND v_account.status<>'đang chạy' THEN
    RETURN jsonb_build_object('claimed',false,'reason','control_changed');
  END IF;
  -- Zalo already checks all work below in its existing RPC. Extend the same
  -- producer barrier to non-Zalo scans before delegating their existing claim.
  IF p_platform<>'zalo' AND (EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id
      AND (c.status='đang chạy' OR c.runtime_unit_token IS NOT NULL))
    OR EXISTS (SELECT 1 FROM public.auto_campaign_inputs i JOIN public.auto_campaigns c ON c.id=i.campaign_id
      WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id AND i.status='đang chạy')
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d JOIN public.auto_campaigns c ON c.id=d.campaign_id
      WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id AND d.status='đang chạy')) THEN
    RETURN jsonb_build_object('claimed',false,'reason','work_running');
  END IF;
  -- A different token on an idle account can be a completed legacy campaign's
  -- token. Eligibility remains governed by the existing status/work guards.
  IF p_platform='zalo' THEN
    RETURN public.claim_zalo_account_runtime_operation(p_account_id,p_staff_id,p_runtime_target,
      p_previous_status,p_claim_token,CASE WHEN p_operation_kind='type_change' THEN false ELSE COALESCE(p_requires_login,true) END);
  END IF;
  RETURN public.claim_non_zalo_account_runtime_operation(p_account_id,p_staff_id,p_platform,
    p_previous_status,p_claim_token,COALESCE(p_requires_login,true));
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])')
  AND md5(pg_get_functiondef(oid))='bc35534b174333a0012c3bf84ca81ef2' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_campaign_run_unit_v2(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_claim_token uuid, p_runtime_claim_vietnam_date date, p_runtime_unit_token uuid, p_input_data_ids bigint[] DEFAULT ARRAY[]::bigint[])
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, claimed_count integer, runtime_claim_token uuid, runtime_claim_vietnam_date date, runtime_unit_token uuid, runtime_unit_vietnam_date date, runtime_unit_claimed_at timestamp with time zone, runtime_unit_input_data_ids bigint[], db_now timestamp with time zone, vietnam_date_key date, effective_stop_time time without time zone, boundary_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_input_data_ids bigint[] := ARRAY(
    SELECT DISTINCT ids.input_id
    FROM unnest(
      COALESCE(p_input_data_ids, ARRAY[]::bigint[])
    ) AS ids(input_id)
    ORDER BY ids.input_id
  );
  v_organization_id bigint;
  v_staff_is_active boolean := false;
  v_capabilities record;
  v_campaign_found boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_account_platform text;
  v_account_is_zalo_web boolean;
  v_account_is_zalo_server boolean;
  v_stored_claim_token uuid;
  v_stored_claim_target text;
  v_stored_claim_vietnam_date date;
  v_stored_unit_token uuid;
  v_stored_unit_vietnam_date date;
  v_stored_unit_claimed_at timestamptz;
  v_stored_unit_input_data_ids bigint[];
  v_daily_stop_time time without time zone;
  v_effective_stop_time time without time zone;
  v_boundary_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_requested_found_count integer := 0;
  v_requested_pending_count integer := 0;
  v_total_running_count integer := 0;
  v_claimed_count integer := 0;
  v_reason text;
  v_legacy_unit record;
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
  IF p_runtime_claim_token IS NULL
    OR p_runtime_claim_vietnam_date IS NULL
    OR p_runtime_unit_token IS NULL
  THEN
    RAISE EXCEPTION 'parent claim token/date and runtime unit token are required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    WHERE ids.input_id IS NULL OR ids.input_id <= 0
  ) THEN
    RAISE EXCEPTION 'input data IDs must be positive integers';
  END IF;
  IF cardinality(v_input_data_ids) > 50 THEN
    RAISE EXCEPTION 'a campaign run unit cannot contain more than 50 input rows';
  END IF;

  SELECT staff.organization_id, COALESCE(staff.is_active, false)
  INTO v_organization_id, v_staff_is_active
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
  ;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text, 0,
      NULL::uuid, NULL::date,
      NULL::uuid, NULL::date, NULL::timestamptz, NULL::bigint[],
      v_now, v_vietnam_date, NULL::time, NULL::timestamptz;
    RETURN;
  END IF;

  -- Keep the established entitlement -> campaign barrier lock order for both
  -- fresh claims and response recovery. Exact committed-unit recovery does not
  -- consult mutable entitlement/staff-active values after taking these locks.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  IF cardinality(v_input_data_ids) > 0 THEN
    PERFORM input_data.id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id = ANY(v_input_data_ids)
      AND input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
    ORDER BY input_data.id
    FOR UPDATE OF input_data;

    SELECT
      count(*)::integer,
      count(*) FILTER (WHERE input_data.status = 'chờ xử lý')::integer
    INTO v_requested_found_count, v_requested_pending_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id = ANY(v_input_data_ids)
      AND input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false;
  END IF;

  -- Reject a fresh v2 unit while legacy/unrecovered input rows are running.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'đang chạy'
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT count(*)::integer
  INTO v_total_running_count
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'đang chạy';

  SELECT
    campaign.status,
    account.status,
    account.login_status,
    COALESCE(account.is_active, false),
    COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false),
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false),
    campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_claim_vietnam_date,
    campaign.runtime_unit_token,
    campaign.runtime_unit_vietnam_date,
    campaign.runtime_unit_claimed_at,
    campaign.runtime_unit_input_data_ids,
    campaign.daily_stop_time
  INTO
    v_campaign_status,
    v_account_status,
    v_account_login_status,
    v_account_is_active,
    v_account_is_delete,
    v_campaign_is_delete,
    v_account_platform,
    v_account_is_zalo_web,
    v_account_is_zalo_server,
    v_stored_claim_token,
    v_stored_claim_target,
    v_stored_claim_vietnam_date,
    v_stored_unit_token,
    v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at,
    v_stored_unit_input_data_ids,
    v_daily_stop_time
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
    )
  FOR UPDATE OF campaign, account;
  v_campaign_found := FOUND;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_effective_stop_time := LEAST(
    COALESCE(v_daily_stop_time, time '23:59:00'),
    time '23:59:00'
  );
  v_boundary_at := (
    p_runtime_claim_vietnam_date + v_effective_stop_time
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

  IF NOT v_campaign_found THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text, 0,
      NULL::uuid, NULL::date,
      NULL::uuid, NULL::date, NULL::timestamptz, NULL::bigint[],
      v_now, v_vietnam_date, NULL::time, NULL::timestamptz;
    RETURN;
  END IF;

  -- The exact committed unit token/date/target/canonical payload is the
  -- linearization point for a lost response. Resolve it only after the same
  -- campaign/input/account locks as a fresh claim, but before mutable
  -- staff-active, entitlement, control, login, or subtype checks. This lets the
  -- caller recover the response and settle instead of stranding maintenance.
  -- Parent fields are NULL-or-match because Desktop soft-pause deliberately
  -- clears that weaker tuple while the opaque unit token/date/exact payload
  -- remains durable; a still-present Server/newer parent must match exactly.
  IF v_stored_unit_token = p_runtime_unit_token
    AND v_stored_unit_vietnam_date = p_runtime_claim_vietnam_date
    AND v_stored_unit_claimed_at IS NOT NULL
    AND v_stored_unit_input_data_ids = v_input_data_ids
    AND (
      v_stored_claim_token IS NULL
      OR v_stored_claim_token = p_runtime_claim_token
    )
    AND (
      v_stored_claim_target IS NULL
      OR v_stored_claim_target = v_runtime_target
    )
    AND (
      v_stored_claim_vietnam_date IS NULL
      OR v_stored_claim_vietnam_date = p_runtime_claim_vietnam_date
    )
  THEN
    RETURN QUERY SELECT
      true, 'already_claimed', v_campaign_status, v_account_status,
      cardinality(v_stored_unit_input_data_ids),
      v_stored_claim_token, v_stored_claim_vietnam_date,
      v_stored_unit_token, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  -- A different/new unit still passes the complete mutable runtime guard.
  IF NOT v_staff_is_active OR NOT public.aka_agent_staff_time_allowed(p_staff_id) THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      v_stored_unit_token, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  -- Durable token identity remains authoritative ahead of mutable campaign,
  -- account, login, and subtype checks after the active/entitlement guard.
  IF v_stored_unit_token IS NOT NULL THEN
    IF v_stored_unit_vietnam_date IS NULL
      OR v_stored_unit_claimed_at IS NULL
      OR v_stored_unit_input_data_ids IS NULL
    THEN
      v_reason := 'unit_lease_corrupt';
    ELSIF v_stored_unit_token IS DISTINCT FROM p_runtime_unit_token THEN
      v_reason := 'unit_lease_busy';
    ELSIF (
        v_stored_claim_token IS NOT NULL
        AND v_stored_claim_token IS DISTINCT FROM p_runtime_claim_token
      ) OR (
        v_stored_claim_target IS NOT NULL
        AND v_stored_claim_target IS DISTINCT FROM v_runtime_target
      ) OR (
        v_stored_claim_vietnam_date IS NOT NULL
        AND v_stored_claim_vietnam_date
          IS DISTINCT FROM p_runtime_claim_vietnam_date
      )
    THEN
      v_reason := 'runtime_claim_mismatch';
    ELSIF v_stored_unit_vietnam_date IS DISTINCT FROM p_runtime_claim_vietnam_date
      OR v_stored_unit_input_data_ids IS DISTINCT FROM v_input_data_ids
    THEN
      v_reason := 'unit_lease_payload_mismatch';
    ELSE
      RETURN QUERY SELECT
        true, 'already_claimed', v_campaign_status, v_account_status,
        cardinality(v_stored_unit_input_data_ids),
        v_stored_claim_token, v_stored_claim_vietnam_date,
        v_stored_unit_token, v_stored_unit_vietnam_date,
        v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
        v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      false, v_reason, v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      v_stored_unit_token, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  ELSIF v_stored_unit_vietnam_date IS NOT NULL
    OR v_stored_unit_claimed_at IS NOT NULL
    OR v_stored_unit_input_data_ids IS NOT NULL
  THEN
    RETURN QUERY SELECT
      false, 'unit_lease_corrupt', v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      NULL::uuid, v_stored_unit_vietnam_date,
      v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  IF v_runtime_target = 'server' AND (
      v_account_platform <> 'zalo'
      OR v_account_is_zalo_web
      OR NOT v_account_is_zalo_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    )
  THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_runtime_target = 'desktop'
    AND v_account_platform = 'zalo'
    AND (
      v_account_is_zalo_server
      OR (
        v_account_is_zalo_web
        AND NOT COALESCE(v_capabilities.web_enabled, false)
      )
      OR (
        NOT v_account_is_zalo_web
        AND NOT v_account_is_zalo_server
        AND NOT COALESCE(v_capabilities.qr_enabled, false)
      )
    )
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
    v_reason := 'runtime_control_paused';
  ELSIF v_stored_claim_token IS DISTINCT FROM p_runtime_claim_token
    OR v_stored_claim_target IS DISTINCT FROM v_runtime_target
    OR v_stored_claim_vietnam_date IS DISTINCT FROM p_runtime_claim_vietnam_date
  THEN
    v_reason := 'runtime_claim_mismatch';
  ELSIF p_runtime_claim_vietnam_date > v_vietnam_date THEN
    v_reason := 'invalid_claimed_vietnam_date';
  ELSIF v_vietnam_date > p_runtime_claim_vietnam_date THEN
    v_reason := 'vietnam_day_changed';
  ELSIF v_now >= v_boundary_at THEN
    v_reason := CASE
      WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
      ELSE 'daily_stop_due'
    END;
  ELSIF v_total_running_count > 0
    OR v_requested_found_count <> cardinality(v_input_data_ids)
    OR v_requested_pending_count <> cardinality(v_input_data_ids)
  THEN
    v_reason := 'input_not_pending';
  ELSE
    v_reason := 'allowed';
  END IF;

  IF v_reason='allowed' AND v_account_platform='facebook' THEN
    v_reason:=coalesce(private.facebook_random_unit_gate(p_campaign_id,p_account_id,p_runtime_claim_token,cardinality(v_input_data_ids)),'allowed');
  END IF;

  IF v_reason <> 'allowed' THEN
    RETURN QUERY SELECT
      false, v_reason, v_campaign_status, v_account_status, 0,
      v_stored_claim_token, v_stored_claim_vietnam_date,
      NULL::uuid, NULL::date, NULL::timestamptz, NULL::bigint[],
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  END IF;

  BEGIN
    IF v_runtime_target = 'server' THEN
      SELECT * INTO v_legacy_unit
      FROM public.aka_agent_claim_zalo_server_run_unit(
        p_campaign_id,
        p_account_id,
        p_staff_id,
        v_input_data_ids
      );
      IF v_legacy_unit.ok IS DISTINCT FROM true THEN
        v_reason := COALESCE(v_legacy_unit.reason, 'unit_claim_rejected');
        RAISE EXCEPTION USING
          ERRCODE = 'P0232',
          MESSAGE = 'legacy Server unit claim rejected';
      END IF;
      v_claimed_count := COALESCE(v_legacy_unit.claimed_count, 0)::integer;
      IF v_claimed_count IS DISTINCT FROM cardinality(v_input_data_ids) THEN
        v_reason := 'unit_claim_count_mismatch';
        RAISE EXCEPTION USING
          ERRCODE = 'P0232',
          MESSAGE = 'legacy Server unit claim count mismatch';
      END IF;
    ELSE
      IF cardinality(v_input_data_ids) > 0 THEN
        UPDATE public.auto_campaign_input_data AS input_data
        SET status = 'đang chạy', date_action = v_now
        WHERE input_data.id = ANY(v_input_data_ids)
          AND input_data.campaign_id = p_campaign_id
          AND COALESCE(input_data.is_delete, false) = false
          AND input_data.status = 'chờ xử lý';
        GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
      END IF;
      IF v_claimed_count IS DISTINCT FROM cardinality(v_input_data_ids) THEN
        v_reason := 'unit_claim_count_mismatch';
        RAISE EXCEPTION USING
          ERRCODE = 'P0232',
          MESSAGE = 'Desktop unit claim count mismatch';
      END IF;
    END IF;

    -- The lease is written only after the exact reservation succeeds and a
    -- final DB-clock sample confirms the inclusive boundary is still open.
    v_now := clock_timestamp();
    v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
    IF v_vietnam_date > p_runtime_claim_vietnam_date THEN
      v_reason := 'vietnam_day_changed';
      RAISE EXCEPTION USING
        ERRCODE = 'P0232',
        MESSAGE = 'run unit crossed Vietnam midnight';
    ELSIF v_now >= v_boundary_at THEN
      v_reason := CASE
        WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
        ELSE 'daily_stop_due'
      END;
      RAISE EXCEPTION USING
        ERRCODE = 'P0232',
        MESSAGE = 'run unit crossed its daily boundary';
    END IF;

    UPDATE public.auto_campaigns AS campaign
    SET runtime_unit_token = p_runtime_unit_token,
      runtime_unit_vietnam_date = p_runtime_claim_vietnam_date,
      runtime_unit_claimed_at = v_now,
      runtime_unit_input_data_ids = v_input_data_ids,
      updated_at = v_now
    WHERE campaign.id = p_campaign_id
      AND campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy'
      AND campaign.runtime_claim_token = p_runtime_claim_token
      AND campaign.runtime_claim_target = v_runtime_target
      AND campaign.runtime_claim_vietnam_date = p_runtime_claim_vietnam_date
      AND campaign.runtime_unit_token IS NULL;

    IF NOT FOUND THEN
      v_reason := 'unit_lease_lost';
      RAISE EXCEPTION USING
        ERRCODE = 'P0232',
        MESSAGE = 'run-unit lease lost parent ownership';
    END IF;

    IF v_account_platform='facebook' THEN PERFORM private.facebook_random_unit_started(p_campaign_id,p_account_id,p_runtime_unit_token); END IF;

    RETURN QUERY SELECT
      true, 'claimed', v_campaign_status, v_account_status, v_claimed_count,
      p_runtime_claim_token, p_runtime_claim_vietnam_date,
      p_runtime_unit_token, p_runtime_claim_vietnam_date,
      v_now, v_input_data_ids,
      v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
    RETURN;
  EXCEPTION
    WHEN SQLSTATE 'P0232' THEN
      -- Reservation and lease writes in this subtransaction are rolled back
      -- together; no compensating UPDATE can clobber a concurrent control row.
      NULL;
  END;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  SELECT campaign.status, account.status,
    campaign.runtime_claim_token, campaign.runtime_claim_vietnam_date,
    campaign.runtime_unit_token, campaign.runtime_unit_vietnam_date,
    campaign.runtime_unit_claimed_at, campaign.runtime_unit_input_data_ids
  INTO v_campaign_status, v_account_status,
    v_stored_claim_token, v_stored_claim_vietnam_date,
    v_stored_unit_token, v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at, v_stored_unit_input_data_ids
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id;

  RETURN QUERY SELECT
    false, COALESCE(v_reason, 'unit_claim_lost'),
    v_campaign_status, v_account_status, 0,
    v_stored_claim_token, v_stored_claim_vietnam_date,
    v_stored_unit_token, v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at, v_stored_unit_input_data_ids,
    v_now, v_vietnam_date, v_effective_stop_time, v_boundary_at;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text)')
  AND md5(pg_get_functiondef(oid))='dc5d650ca0f8e63c00ce97c4606ef245' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_campaign_runtime_checked(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text)
 RETURNS TABLE(ok boolean, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_capabilities record;
  v_is_zalo boolean;
  v_is_web boolean;
  v_is_server boolean;
  v_zalo_web_max integer;
  v_facebook_max integer;
  v_max integer;
  v_running bigint;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id, staff.max_running_zalo_web_accounts, staff.max_running_facebook_accounts
  INTO v_organization_id, v_zalo_web_max, v_facebook_max
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  -- Serialize only admission, never the duration of a campaign. Staff SHARE
  -- above also fences settings SAVE's staff UPDATE lock. Keep this before
  -- campaign/account row locks and after the existing entitlement barrier.
  IF v_runtime_target = 'desktop' AND (v_zalo_web_max IS NOT NULL OR v_facebook_max IS NOT NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || p_staff_id::text, 0));
  END IF;

  -- Server hard-end cleanup must start before the ordinary campaign/account
  -- claim locks. Candidate discovery uses only caller-readable campaign and
  -- account rows; the SECURITY DEFINER wrapper authoritatively revalidates the
  -- RPC-only Data Group source after joining the common input-first barrier.
  IF v_runtime_target = 'server'
    AND COALESCE(v_capabilities.qr_enabled, false)
    AND COALESCE(v_capabilities.server_enabled, false)
    AND EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
       AND account.staff_id = campaign.staff_id
      WHERE campaign.id = p_campaign_id
        AND campaign.staff_id = p_staff_id
        AND campaign.account_id = p_account_id
        AND campaign.organization_id = v_organization_id
        AND campaign.data_target_source_mode = 'data_group'
        AND campaign.action_id IN (
          'zalo_message_phone',
          'zalo_join_group_link',
          'zalo_message_friend',
          'zalo_message_group_member',
          'zalo_message_remarketing_customer',
          'zalo_message_group',
          'zalo_add_group_member'
        )
        AND campaign.schedule_end_date IS NOT NULL
        AND campaign.schedule_end_date <= now()
        AND (
          account.organization_id IS NULL
          OR account.organization_id = v_organization_id
        )
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
    )
  THEN
    BEGIN
      PERFORM public.aka_agent_finalize_zalo_server_data_group_campaign(
        p_staff_id,
        v_organization_id,
        v_capabilities.capability_revision,
        p_campaign_id,
        'Chiến dịch đã hết hạn'
      );
    EXCEPTION
      -- The source, campaign or account subtype can change after optimistic
      -- candidate discovery. Those expected races are a rejected
      -- claim, not a scheduler error; the authoritative sweep handles any
      -- remaining hard-end cleanup on its next pass.
      WHEN raise_exception THEN
        IF SQLERRM NOT IN (
          'data_group_server_campaign_not_found',
          'data_group_server_runtime_not_owner'
        ) THEN
          RAISE;
        END IF;
    END;
    RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN;
  END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.account_id = p_account_id
  FOR UPDATE OF campaign;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  -- V387: old/ordinary clients cannot claim a random account. The wrapper's
  -- transaction-local turn ID must name the first pending turn of this day.
  IF v_account.flatform_type='facebook' AND v_account.facebook_random_run_enabled THEN
    IF NOT private.facebook_random_claim_allowed(p_campaign_id,p_account_id,current_setting('aka.facebook_random_turn',true)) THEN RETURN QUERY SELECT false,'random_context_required'::text; RETURN; END IF;
  ELSIF nullif(current_setting('aka.facebook_random_turn',true),'') IS NOT NULL THEN
    RETURN QUERY SELECT false,'random_mode_changed'::text; RETURN;
  END IF;

  v_is_zalo := lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'zalo';
  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);

  IF v_runtime_target = 'server' THEN
    IF NOT v_is_zalo OR v_is_web OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;
  ELSIF v_is_zalo AND (
    v_is_server
    OR (v_is_web AND NOT COALESCE(v_capabilities.web_enabled, false))
    OR (NOT v_is_web AND NOT v_is_server
      AND NOT COALESCE(v_capabilities.qr_enabled, false))
  ) THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  IF NOT private.campaign_dispatch_schedule_allowed(
    v_campaign.schedule, v_campaign.data_target_source_mode,
    v_campaign.schedule_end_date, v_campaign.daily_stop_time, now(), true
  ) THEN
    -- Shared with random planning; retain the legacy cutoff contract and locks.
    -- The tenant sweep, not this eligibility check, finalizes hard-ended sources.
    RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN;
  END IF;

  IF COALESCE(v_campaign.is_delete, false)
    OR v_campaign.status <> 'chờ xử lý'
    OR COALESCE(v_campaign.provisioning_state, 'ready') <> 'ready'
    OR (
      v_campaign.data_target_source_mode = 'data_group'
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND COALESCE(input_data.is_delete, false) = false
          AND input_data.status = 'chờ xử lý'
          AND (input_data.schedule IS NULL OR input_data.schedule <= now())
      )
    )
    OR COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR v_account.status <> 'chờ xử lý'
    OR v_account.login_status <> 'đã đăng nhập'
  THEN RETURN QUERY SELECT false, 'claim_rejected'::text; RETURN; END IF;

  v_max := CASE
    WHEN lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'facebook' THEN v_facebook_max
    WHEN v_is_zalo AND v_is_web AND NOT v_is_server THEN v_zalo_web_max
    ELSE NULL END;
  IF v_runtime_target = 'desktop' AND v_max IS NOT NULL THEN
    -- Status is enough for legacy clients; immutable claim/unit metadata also
    -- keeps a paused or draining run counted until its existing cleanup wins.
    -- Never filter live ownership by login/active/deleted flags. Account-only
    -- operations (login, scans) do not create a campaign and consume no slot.
    SELECT count(DISTINCT campaign.account_id) INTO v_running
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
      AND account.staff_id = campaign.staff_id
    WHERE campaign.staff_id = p_staff_id
      AND account.id <> p_account_id
      AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
      AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
      AND (campaign.status = 'đang chạy' OR campaign.runtime_claim_token IS NOT NULL OR campaign.runtime_unit_token IS NOT NULL)
      AND CASE WHEN v_is_zalo THEN
        lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND account.is_zalo_show_web = true AND account.is_zalo_server = false
        ELSE lower(btrim(COALESCE(account.flatform_type, ''))) = 'facebook' END;
    IF v_running >= v_max THEN
      RETURN QUERY SELECT false, 'concurrency_limit_reached'::text; RETURN;
    END IF;
  END IF;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy', note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;
  RETURN QUERY SELECT true, 'claimed'::text; RETURN;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_claim_zalo_server_run_unit(bigint,bigint,bigint,bigint[])')
  AND md5(pg_get_functiondef(oid))='1d2e9fe42c493c523641741389496b5c' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_claim_zalo_server_run_unit(bigint,bigint,bigint,bigint[])';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_zalo_server_run_unit(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_input_data_ids bigint[] DEFAULT ARRAY[]::bigint[])
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, claimed_count integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_capabilities record;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_input_data_ids bigint[] := ARRAY(
    SELECT DISTINCT ids.input_id
    FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    ORDER BY ids.input_id
  );
  v_input_data_id bigint;
  v_claimed_count integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    WHERE ids.input_id IS NULL OR ids.input_id <= 0
  ) THEN RAISE EXCEPTION 'Input data IDs must be positive integers'; END IF;
  IF cardinality(v_input_data_ids) > 50 THEN
    RAISE EXCEPTION 'A Zalo Server run unit cannot contain more than 50 input rows';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Match Control input pause/resume: requested inputs are always the first
  -- mutable rows in the lock chain, followed by campaign and account below.
  -- The status predicate is rechecked by PostgreSQL after any blocked updater.
  IF cardinality(v_input_data_ids) > 0 THEN
    FOR v_input_data_id IN
      SELECT input_data.id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = ANY(v_input_data_ids)
        AND input_data.campaign_id = p_campaign_id
        AND COALESCE(input_data.is_delete, false) = false
        AND input_data.status = 'chờ xử lý'
      ORDER BY input_data.id
      FOR UPDATE OF input_data
    LOOP
      v_claimed_count := v_claimed_count + 1;
    END LOOP;
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
    AND COALESCE(account.is_zalo_server, false) = true
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_found', NULL::text, NULL::text, 0; RETURN; END IF;
  IF v_campaign_is_delete THEN RETURN QUERY SELECT false, 'campaign_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_is_delete THEN RETURN QUERY SELECT false, 'account_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF NOT v_account_is_active THEN RETURN QUERY SELECT false, 'account_inactive', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN RETURN QUERY SELECT false, 'account_logged_out', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_campaign_status IS DISTINCT FROM 'đang chạy' OR v_account_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT false, 'runtime_control_paused', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;

  IF cardinality(v_input_data_ids) > 0 THEN
    IF v_claimed_count <> cardinality(v_input_data_ids) THEN
      RETURN QUERY SELECT false, 'input_not_pending', v_campaign_status, v_account_status, 0;
      RETURN;
    END IF;
    UPDATE public.auto_campaign_input_data
    SET status = 'đang chạy', date_action = now()
    WHERE id = ANY(v_input_data_ids) AND campaign_id = p_campaign_id;
  END IF;

  RETURN QUERY SELECT true, 'claimed', v_campaign_status, v_account_status, v_claimed_count;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)')
  AND md5(pg_get_functiondef(oid))='f941b9177b447ca5da721d10dacf55e8' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_cleanup_account_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_runtime_target text, p_previous_status text, p_claim_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_account public.auto_accounts%ROWTYPE; v_organization_id bigint;
BEGIN
  IF p_account_id IS NULL OR p_account_id<=0 OR p_staff_id IS NULL OR p_staff_id<=0
    OR p_claim_token IS NULL OR p_previous_status IS NULL
    OR p_previous_status NOT IN ('chờ xử lý','tạm dừng')
    OR p_platform IS NULL OR p_platform NOT IN ('zalo','facebook','email')
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop','server')
    OR (p_platform<>'zalo' AND p_runtime_target<>'desktop') THEN
    RAISE EXCEPTION 'invalid_account_operation_identity';
  END IF;
  -- Cleanup is allowed after entitlement/subtype/active changes, but only for
  -- this staff, organization, platform and exact operation token.
  SELECT organization_id INTO v_organization_id FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share')
    WHERE id=p_staff_id ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','staff_not_found');
  END IF;
  IF p_platform='zalo' THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  END IF;
  SELECT * INTO v_account FROM public.auto_accounts a
    WHERE a.id=p_account_id AND a.staff_id=p_staff_id
      AND (a.organization_id IS NULL OR a.organization_id=v_organization_id)
      AND lower(btrim(COALESCE(a.flatform_type,'')))=p_platform FOR UPDATE;
  IF NOT FOUND OR v_account.runtime_operation_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('ok',true,'reason','not_owner');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id
      AND (c.status='đang chạy' OR c.runtime_unit_token IS NOT NULL))
    OR EXISTS (SELECT 1 FROM public.auto_campaign_inputs i JOIN public.auto_campaigns c ON c.id=i.campaign_id
      WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id AND i.status='đang chạy')
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d JOIN public.auto_campaigns c ON c.id=d.campaign_id
      WHERE c.account_id=p_account_id AND c.staff_id=p_staff_id AND d.status='đang chạy') THEN
    RETURN jsonb_build_object('ok',false,'reason','work_running');
  END IF;
  UPDATE public.auto_accounts a SET
    status=CASE WHEN a.status='đang chạy' THEN p_previous_status ELSE a.status END,
    runtime_operation_claim_token=NULL, updated_at=now()
    WHERE a.id=p_account_id AND a.staff_id=p_staff_id AND a.runtime_operation_claim_token=p_claim_token;
  RETURN jsonb_build_object('ok',true,'reason','cleaned');
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)')
  AND md5(pg_get_functiondef(oid))='f506f8695e3e874642e3c845e103e42d' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_cleanup_failed_campaign_runtime(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_claim_token uuid, p_runtime_unit_token uuid, p_unstarted_input_data_ids bigint[], p_note text, p_pause_unknown_outcome boolean, p_campaign_status text DEFAULT NULL::text, p_account_status text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint;
  v_optimistic_ids bigint[];
  v_ids bigint[];
  v_parent uuid;
  v_unit uuid;
  v_account_token uuid;
  v_target text;
  v_claim_date date;
  v_claim_at timestamptz;
  v_unit_date date;
  v_unit_at timestamptz;
  v_campaign_status text;
  v_account_status text;
  v_now timestamptz := clock_timestamp();
  v_unstarted bigint[] := COALESCE(p_unstarted_input_data_ids, ARRAY[]::bigint[]);
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
    OR p_runtime_target IS NULL OR p_runtime_target NOT IN ('desktop', 'server')
    OR p_runtime_claim_token IS NULL OR p_pause_unknown_outcome IS NULL
    OR cardinality(v_unstarted) > 50 OR array_position(v_unstarted, NULL) IS NOT NULL
    OR (p_campaign_status IS NOT NULL AND p_campaign_status NOT IN ('chờ xử lý', 'tạm dừng'))
    OR (p_account_status IS NOT NULL AND p_account_status NOT IN ('chờ xử lý', 'tạm dừng'))
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid failure cleanup payload';
  END IF;

  -- Like v2 settlement, cleanup survives entitlement/subtype changes, but
  -- requires the original opaque token and tenant scope under invoker RLS.
  SELECT staff.organization_id INTO v_org
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') staff WHERE staff.id = p_staff_id ;
  IF NOT FOUND OR v_org IS NULL THEN
    RETURN QUERY SELECT false, 'not_owner'; RETURN;
  END IF;
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
  SELECT c.runtime_unit_input_data_ids INTO v_optimistic_ids
  FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id = c.account_id AND a.staff_id = c.staff_id
  WHERE c.id = p_campaign_id AND c.account_id = p_account_id AND c.staff_id = p_staff_id
    AND (c.organization_id IS NULL OR c.organization_id = v_org)
    AND (a.organization_id IS NULL OR a.organization_id = v_org);
  PERFORM d.id FROM public.auto_campaign_input_data d
  WHERE d.campaign_id = p_campaign_id AND d.id = ANY(v_optimistic_ids)
  ORDER BY d.id FOR UPDATE OF d;

  SELECT c.runtime_claim_token, c.runtime_claim_target, c.runtime_claim_vietnam_date, c.runtime_claimed_at,
    c.runtime_unit_token, c.runtime_unit_vietnam_date, c.runtime_unit_claimed_at, c.runtime_unit_input_data_ids,
    c.status, a.status, a.runtime_operation_claim_token
  INTO v_parent, v_target, v_claim_date, v_claim_at, v_unit, v_unit_date, v_unit_at, v_ids,
    v_campaign_status, v_account_status, v_account_token
  FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id = c.account_id AND a.staff_id = c.staff_id
  WHERE c.id = p_campaign_id AND c.account_id = p_account_id AND c.staff_id = p_staff_id
    AND (c.organization_id IS NULL OR c.organization_id = v_org)
    AND (a.organization_id IS NULL OR a.organization_id = v_org)
  FOR UPDATE OF c, a;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'; RETURN;
  END IF;

  IF (v_parent IS NOT NULL AND v_parent <> p_runtime_claim_token)
    OR (v_account_token IS NOT NULL AND v_account_token <> p_runtime_claim_token)
    OR (v_unit IS NOT NULL AND v_unit IS DISTINCT FROM p_runtime_unit_token)
    OR (v_parent IS NOT NULL AND v_target IS DISTINCT FROM p_runtime_target)
  THEN
    RETURN QUERY SELECT false, 'not_owner'; RETURN;
  END IF;
  IF v_ids IS DISTINCT FROM v_optimistic_ids
    OR (v_parent IS NOT NULL AND (v_claim_date IS NULL OR v_claim_at IS NULL))
    OR (v_parent IS NULL AND (v_target IS NOT NULL OR v_claim_date IS NOT NULL OR v_claim_at IS NOT NULL))
    OR (v_unit IS NOT NULL AND (v_unit_date IS NULL OR v_unit_at IS NULL OR v_ids IS NULL OR cardinality(v_ids) > 50))
    OR (v_unit IS NULL AND (v_unit_date IS NOT NULL OR v_unit_at IS NOT NULL OR v_ids IS NOT NULL))
    OR (v_campaign_status = 'đang chạy' AND v_parent IS DISTINCT FROM p_runtime_claim_token)
    OR (v_account_status = 'đang chạy' AND v_account_token IS DISTINCT FROM p_runtime_claim_token)
  THEN
    RETURN QUERY SELECT false, 'insufficient_ownership'; RETURN;
  END IF;
  IF v_parent IS NULL AND v_unit IS NULL AND v_account_token IS NULL THEN
    -- A committed response can be lost. This branch performs no writes and
    -- cannot release a new owner, including a tokenless legacy running row.
    RETURN QUERY SELECT true, 'already_cleaned'; RETURN;
  END IF;
  IF v_unit IS NOT NULL AND NOT (v_unstarted <@ v_ids) THEN
    RETURN QUERY SELECT false, 'invalid_unstarted_ids'; RETURN;
  END IF;
  IF v_unit IS NULL AND cardinality(v_unstarted) > 0 THEN
    RETURN QUERY SELECT false, 'insufficient_ownership'; RETURN;
  END IF;

  -- A durable pause hint arriving while budget cleanup waits must win too.
  IF coalesce(p_campaign_status,'chờ xử lý')='chờ xử lý' AND private.facebook_random_pause_requested(p_campaign_id,p_account_id,p_runtime_claim_token) THEN
    p_campaign_status:='tạm dừng';
    IF coalesce(p_note,'')='' THEN p_note:='Đang chờ tạm dừng'; END IF;
  END IF;
  IF v_unit IS NOT NULL THEN
    UPDATE public.auto_campaign_input_data d
    SET status = CASE WHEN d.id = ANY(v_unstarted) THEN 'chờ xử lý' ELSE 'hoàn thành' END,
      date_action = CASE WHEN d.id = ANY(v_unstarted) THEN NULL ELSE d.date_action END,
      note = CASE WHEN d.id = ANY(v_unstarted) THEN d.note
        ELSE left(COALESCE(p_note, 'Lượt chạy bị gián đoạn'), 2000) || ' — Kết quả chưa xác nhận; không tự gửi lại.' END
    WHERE d.campaign_id = p_campaign_id AND d.id = ANY(v_ids)
      AND (d.status = 'đang chạy' OR (d.status = 'chờ xử lý' AND NOT (d.id = ANY(v_unstarted))));
    -- An inner error/pause handler may have requeued a started input before its
    -- next write failed. Its still-owned lease proves it cannot be sent again.
    -- Already paused/completed inputs are deliberately untouched.
    PERFORM private.facebook_random_unit_settled(p_campaign_id,p_account_id,p_runtime_unit_token,p_pause_unknown_outcome);
    UPDATE public.auto_campaigns c
    SET runtime_unit_token = NULL, runtime_unit_vietnam_date = NULL,
      runtime_unit_claimed_at = NULL, runtime_unit_input_data_ids = NULL, updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_unit_token = p_runtime_unit_token;
  END IF;

  IF v_parent = p_runtime_claim_token THEN
    UPDATE public.auto_campaigns c
    SET status = CASE WHEN p_pause_unknown_outcome THEN 'tạm dừng' ELSE COALESCE(p_campaign_status, 'chờ xử lý') END,
      note = left(COALESCE(p_note, 'Lượt chạy bị gián đoạn'), 2000)
        || CASE WHEN p_pause_unknown_outcome THEN ' — Chưa xác định phần đã thực hiện; tạm dừng để kiểm tra.' ELSE '' END,
      updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_claim_token = p_runtime_claim_token AND c.status = 'đang chạy';
    -- The existing server pause trigger preserves the parent tuple on a status
    -- transition. Clear it separately, under the same row lock/transaction.
    UPDATE public.auto_campaigns c
    SET runtime_claim_token = NULL, runtime_claim_target = NULL,
      runtime_claim_vietnam_date = NULL, runtime_claimed_at = NULL, updated_at = v_now
    WHERE c.id = p_campaign_id AND c.runtime_claim_token = p_runtime_claim_token;
  END IF;
  IF v_account_token = p_runtime_claim_token THEN
    UPDATE public.auto_accounts a
    SET status = CASE WHEN a.status = 'đang chạy' THEN COALESCE(p_account_status, 'chờ xử lý') ELSE a.status END,
      runtime_operation_claim_token = NULL, updated_at = v_now
    WHERE a.id = p_account_id AND a.staff_id = p_staff_id
      AND a.runtime_operation_claim_token = p_runtime_claim_token;
  END IF;
  RETURN QUERY SELECT true, 'cleaned';
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text)')
  AND md5(pg_get_functiondef(oid))='a5c7a6181fb3af9b1d47eeed8bc912cf' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_facebook_account_operation(p_account_id bigint, p_staff_id bigint, p_previous_status text, p_claim_token uuid, p_generation bigint, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE a public.auto_accounts%ROWTYPE; org_id bigint; result jsonb;
BEGIN
  IF p_account_id IS NULL OR p_account_id<=0 OR p_staff_id IS NULL OR p_staff_id<=0
    OR p_claim_token IS NULL OR p_generation IS NULL OR p_generation<0 OR p_generation>9007199254740991
    OR p_previous_status IS NULL OR p_previous_status NOT IN ('chờ xử lý','tạm dừng')
    OR p_action IS NULL OR p_action NOT IN ('claim','cleanup') THEN
    RAISE EXCEPTION 'invalid_facebook_operation_identity';
  END IF;
  -- Same staff -> account lock order as the existing claim, cleanup and recovery.
  -- Cleanup remains possible after staff deactivation/expiry or soft deletion.
  SELECT organization_id INTO org_id FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') WHERE id=p_staff_id ;
  IF NOT FOUND OR org_id IS NULL THEN
    RETURN CASE WHEN p_action='claim' THEN jsonb_build_object('claimed',false,'reason','staff_not_active')
      ELSE jsonb_build_object('ok',false,'reason','staff_not_found') END;
  END IF;
  SELECT * INTO a FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id
    AND (organization_id IS NULL OR organization_id=org_id) AND lower(btrim(coalesce(flatform_type,'')))='facebook'
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN CASE WHEN p_action='claim' THEN jsonb_build_object('claimed',false,'reason','account_not_found')
      ELSE jsonb_build_object('ok',true,'reason','not_owner') END;
  END IF;
  IF p_action='claim' THEN
    -- The trigger increments once on acquisition. A retry may still observe
    -- that same owned token, but a closed generation can never acquire it again.
    IF a.facebook_login_claim_generation<>p_generation AND NOT (
      a.runtime_operation_claim_token IS NOT DISTINCT FROM p_claim_token
      AND a.facebook_login_claim_generation=p_generation+1) THEN
      RETURN jsonb_build_object('claimed',false,'reason','claim_closed');
    END IF;
    RETURN public.aka_agent_claim_account_operation(p_account_id,p_staff_id,'facebook','desktop',
      p_previous_status,p_claim_token,false,'operation');
  END IF;

  result:=public.aka_agent_cleanup_account_operation(p_account_id,p_staff_id,'facebook','desktop',
    p_previous_status,p_claim_token);
  IF coalesce((result->>'ok')::boolean,false) AND result->>'reason' IN ('cleaned','not_owner','already_cleaned') THEN
    -- If cleanup wins the row lock BEFORE claim, close its generation even
    -- though no token is present yet. Do not alter status or another token.
    UPDATE public.auto_accounts SET facebook_login_claim_generation=facebook_login_claim_generation+1
      WHERE id=p_account_id AND facebook_login_claim_generation=p_generation;
  END IF;
  RETURN result;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_finalize_zalo_server_campaign(bigint,bigint,text,boolean)')
  AND md5(pg_get_functiondef(oid))='a56637c5ec588f1d6b20622e4096db38' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_finalize_zalo_server_campaign(bigint,bigint,text,boolean)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_campaign(p_campaign_id bigint, p_staff_id bigint, p_note text, p_update_note boolean)
 RETURNS TABLE(ok boolean, reason text, campaign_id bigint, account_id bigint, campaign_status text, account_status text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_account_id bigint;
  v_campaign_status text;
  v_account_status text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Campaign and staff IDs must be positive integers';
  END IF;
  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::bigint, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Serialize the final pending-input decision with Control pause/resume and
  -- run-unit claims. The campaign/account lock is deliberately taken only
  -- after every live input row is stable for the rest of this transaction.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT campaign.account_id, campaign.status, account.status
  INTO v_account_id, v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_campaign_id, NULL::bigint, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_campaign_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT true, 'campaign_control_won', p_campaign_id, v_account_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;
  IF v_account_status IS DISTINCT FROM 'đang chạy' THEN
    UPDATE public.auto_campaigns
    SET status = 'chờ xử lý', note = NULL, updated_at = now()
    WHERE id = p_campaign_id AND status = 'đang chạy';
    RETURN QUERY SELECT true, 'account_control_won', p_campaign_id, v_account_id, 'chờ xử lý', v_account_status;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'chờ xử lý'
  ) THEN
    UPDATE public.auto_campaigns
    SET status = 'chờ xử lý', note = NULL, updated_at = now()
    WHERE id = p_campaign_id AND status = 'đang chạy';
    RETURN QUERY SELECT true, 'pending_input_remaining', p_campaign_id, v_account_id, 'chờ xử lý', v_account_status;
    RETURN;
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET status = 'hoàn thành',
    note = CASE WHEN COALESCE(p_update_note, false) THEN p_note ELSE campaign.note END,
    updated_at = now()
  WHERE campaign.id = p_campaign_id AND campaign.status = 'đang chạy';
  RETURN QUERY SELECT true, 'completed', p_campaign_id, v_account_id, 'hoàn thành', v_account_status;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)')
  AND md5(pg_get_functiondef(oid))='5b849d4685b10d6446b4922ed70b0219' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='s'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)';
 END IF;
END;
$preflight$;

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

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)')
  AND md5(pg_get_functiondef(oid))='048ea7194cd77589ffeb1820353f500c' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_recover_campaign_runtime_unit_leases(p_staff_id bigint, p_runtime_target text, p_platform_scope text DEFAULT 'all'::text)
 RETURNS TABLE(ok boolean, reason text, recovered_lease_count bigint, requeued_input_count bigint, db_now timestamp with time zone, vietnam_date_key date)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_random record;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_platform_scope text := lower(btrim(COALESCE(p_platform_scope, '')));
  v_organization_id bigint;
  v_candidate record;
  v_locked_token uuid;
  v_locked_input_data_ids bigint[];
  v_recovered_lease_count bigint := 0;
  v_requeued_input_count bigint := 0;
  v_row_count bigint := 0;
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'staff ID must be a positive integer';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF v_platform_scope NOT IN ('all', 'zalo') THEN
    RAISE EXCEPTION 'platform scope must be all or zalo';
  END IF;

  -- Startup recovery is cleanup and therefore remains available for an
  -- inactive staff row. The caller must invoke it only after its existing
  -- runtime-specific recovery has proved the scheduler process idle.
  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
  ;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', 0::bigint, 0::bigint,
      v_now, v_vietnam_date;
    RETURN;
  END IF;

  FOR v_candidate IN
    SELECT campaign.id AS campaign_id,
      campaign.account_id,
      campaign.runtime_unit_token,
      campaign.runtime_unit_input_data_ids
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token IS NOT NULL
      AND (
        v_platform_scope = 'all'
        OR lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      )
      AND (
        campaign.organization_id IS NULL
        OR campaign.organization_id = v_organization_id
      )
      AND (
        account.organization_id IS NULL
        OR account.organization_id = v_organization_id
      )
      AND (
        (
          v_runtime_target = 'server'
          AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
        OR (
          v_runtime_target = 'desktop'
          AND NOT (
            lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
            AND COALESCE(account.is_zalo_server, false) = true
          )
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(
      v_candidate.campaign_id
    );

    IF cardinality(COALESCE(
      v_candidate.runtime_unit_input_data_ids,
      ARRAY[]::bigint[]
    )) > 0 THEN
      PERFORM input_data.id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = ANY(v_candidate.runtime_unit_input_data_ids)
        AND input_data.campaign_id = v_candidate.campaign_id
      ORDER BY input_data.id
      FOR UPDATE OF input_data;
    END IF;

    SELECT campaign.runtime_unit_token,
      campaign.runtime_unit_input_data_ids
    INTO v_locked_token, v_locked_input_data_ids
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    WHERE campaign.id = v_candidate.campaign_id
      AND campaign.account_id = v_candidate.account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token = v_candidate.runtime_unit_token
      AND (
        v_platform_scope = 'all'
        OR lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      )
      AND (
        campaign.organization_id IS NULL
        OR campaign.organization_id = v_organization_id
      )
      AND (
        account.organization_id IS NULL
        OR account.organization_id = v_organization_id
      )
      AND (
        (
          v_runtime_target = 'server'
          AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
        OR (
          v_runtime_target = 'desktop'
          AND NOT (
            lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
            AND COALESCE(account.is_zalo_server, false) = true
          )
        )
      )
    FOR UPDATE OF campaign, account;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    PERFORM private.facebook_random_unit_recover(v_candidate.campaign_id,v_candidate.account_id,v_locked_token);

    IF cardinality(COALESCE(v_locked_input_data_ids, ARRAY[]::bigint[])) > 0 THEN
      UPDATE public.auto_campaign_input_data AS input_data
      SET status = 'chờ xử lý', date_action = NULL
      WHERE input_data.id = ANY(v_locked_input_data_ids)
        AND input_data.campaign_id = v_candidate.campaign_id
        AND input_data.status = 'đang chạy';
      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_requeued_input_count := v_requeued_input_count + v_row_count;
    END IF;

    v_now := clock_timestamp();
    UPDATE public.auto_campaigns AS campaign
    SET runtime_unit_token = NULL,
      runtime_unit_vietnam_date = NULL,
      runtime_unit_claimed_at = NULL,
      runtime_unit_input_data_ids = NULL,
      updated_at = v_now
    WHERE campaign.id = v_candidate.campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.runtime_unit_token = v_locked_token;

    IF FOUND THEN
      v_recovered_lease_count := v_recovered_lease_count + 1;
    END IF;
  END LOOP;

  -- Same startup recovery proof/locks; includes orphan turns when mode is off.
  IF v_runtime_target='desktop' AND v_platform_scope='all' THEN
    FOR v_random IN SELECT * FROM private.facebook_random_orphan_turns(p_staff_id,v_organization_id) ORDER BY id
    LOOP
      PERFORM public.aka_agent_lock_campaign_input_serialization(v_random.id);
      PERFORM 1 FROM public.auto_campaigns cc JOIN public.auto_accounts aa ON aa.id=cc.account_id AND aa.staff_id=cc.staff_id
        WHERE cc.id=v_random.id AND cc.account_id=v_random.account_id AND cc.staff_id=p_staff_id AND aa.flatform_type='facebook'
          AND (cc.organization_id IS NULL OR cc.organization_id=v_organization_id)
          AND (aa.organization_id IS NULL OR aa.organization_id=v_organization_id)
          AND cc.runtime_claim_token IS NULL AND cc.runtime_unit_token IS NULL AND cc.status<>'đang chạy'
        FOR UPDATE OF cc,aa;
      IF FOUND THEN PERFORM private.facebook_random_finalize_turn(v_random.id,v_random.account_id,v_random.claim::uuid,v_random.unit::uuid,true); END IF;
    END LOOP;
  END IF;
  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  RETURN QUERY SELECT
    true, 'recovered', v_recovered_lease_count, v_requeued_input_count,
    v_now, v_vietnam_date;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_set_desktop_campaign_status_v2(bigint,bigint,bigint,text)')
  AND md5(pg_get_functiondef(oid))='f8b736faac1c365999f6741054f08680' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_set_desktop_campaign_status_v2(bigint,bigint,bigint,text)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_desktop_campaign_status_v2(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_target_status text)
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, db_now timestamp with time zone, vietnam_date_key date)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_target_status text := btrim(COALESCE(p_target_status, ''));
  v_organization_id bigint;
  v_campaign_found boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_campaign_is_delete boolean;
  v_account_is_delete boolean;
  v_account_is_active boolean;
  v_account_platform text;
  v_account_is_zalo_server boolean;
  v_runtime_claim_token uuid;
  v_runtime_claim_target text;
  v_runtime_unit_token uuid;
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_reason text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'campaign, account and staff IDs must be positive integers';
  END IF;
  IF v_target_status NOT IN ('tạm dừng', 'chờ xử lý') THEN
    RAISE EXCEPTION 'target status must be paused or pending';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true
  ;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text,
      v_now, v_vietnam_date;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.status, account.status,
    COALESCE(campaign.is_delete, false),
    COALESCE(account.is_delete, false),
    COALESCE(account.is_active, false),
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_server, false),
    campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_unit_token
  INTO v_campaign_status, v_account_status,
    v_campaign_is_delete, v_account_is_delete, v_account_is_active,
    v_account_platform, v_account_is_zalo_server,
    v_runtime_claim_token, v_runtime_claim_target, v_runtime_unit_token
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
    )
  FOR UPDATE OF campaign, account;
  v_campaign_found := FOUND;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  IF NOT v_campaign_found THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      v_now, v_vietnam_date;
    RETURN;
  END IF;

  IF v_account_platform = 'zalo' AND v_account_is_zalo_server THEN
    v_reason := 'runtime_not_owner';
  ELSIF v_campaign_is_delete THEN
    v_reason := 'campaign_deleted';
  ELSIF v_account_is_delete AND v_target_status <> 'tạm dừng' THEN
    v_reason := 'account_deleted';
  ELSIF NOT v_account_is_active AND v_target_status <> 'tạm dừng' THEN
    v_reason := 'account_inactive';
  ELSIF v_target_status = 'tạm dừng' THEN
    IF v_campaign_status = 'tạm dừng' THEN
      v_reason := 'already_target';
    ELSIF (v_campaign_status = 'đang chạy' AND NOT v_account_is_delete)
      OR v_runtime_claim_token IS NOT NULL
    THEN
      v_reason := 'runtime_busy';
    ELSIF v_runtime_unit_token IS NOT NULL THEN
      v_reason := 'unit_lease_busy';
    ELSIF v_campaign_status IS DISTINCT FROM 'chờ xử lý'
      AND NOT (v_account_is_delete AND v_campaign_status = 'đang chạy') THEN
      v_reason := 'invalid_transition';
    ELSE
      UPDATE public.auto_campaigns AS campaign
      SET status = 'tạm dừng',
        note = CASE
          WHEN campaign.data_target_source_mode = 'data_group'
            AND campaign.note IN ('Chờ data phù hợp', 'Chờ data mới')
          THEN campaign.note
          ELSE NULL
        END,
        updated_at = v_now
      WHERE campaign.id = p_campaign_id
        AND campaign.account_id = p_account_id
        AND campaign.staff_id = p_staff_id
        AND (campaign.status = 'chờ xử lý'
          OR (v_account_is_delete AND campaign.status = 'đang chạy'))
        AND campaign.runtime_claim_token IS NULL
        AND campaign.runtime_unit_token IS NULL;
      IF FOUND THEN
        v_campaign_status := 'tạm dừng';
        v_reason := 'updated';
      ELSE
        v_reason := 'runtime_busy';
      END IF;
    END IF;
  ELSE
    IF v_campaign_status = 'đang chạy' THEN
      v_reason := 'runtime_busy';
    ELSIF v_runtime_unit_token IS NOT NULL THEN
      v_reason := 'unit_lease_busy';
    ELSIF v_runtime_claim_token IS NOT NULL
      AND v_runtime_claim_target IS DISTINCT FROM 'server'
    THEN
      v_reason := 'runtime_busy';
    ELSIF NOT v_account_is_active THEN
      v_reason := 'account_inactive';
    ELSIF v_campaign_status IS DISTINCT FROM 'tạm dừng' THEN
      v_reason := 'invalid_transition';
    ELSE
      UPDATE public.auto_campaigns AS campaign
      SET status = 'chờ xử lý', note = NULL, updated_at = v_now
      WHERE campaign.id = p_campaign_id
        AND campaign.account_id = p_account_id
        AND campaign.staff_id = p_staff_id
        AND campaign.status = 'tạm dừng'
        AND (
          campaign.runtime_claim_token IS NULL
          OR campaign.runtime_claim_target = 'server'
        )
        AND campaign.runtime_unit_token IS NULL;
      IF FOUND THEN
        v_campaign_status := 'chờ xử lý';
        v_reason := 'updated';
      ELSE
        v_reason := 'runtime_busy';
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_reason IN ('updated', 'already_target'),
    v_reason,
    v_campaign_status,
    v_account_status,
    v_now,
    v_vietnam_date;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_set_zalo_server_account_status(bigint,bigint,text)')
  AND md5(pg_get_functiondef(oid))='81578dbe29f58ae5736948d34e77f36c' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_set_zalo_server_account_status(bigint,bigint,text)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_zalo_server_account_status(p_account_id bigint, p_staff_id bigint, p_status text)
 RETURNS TABLE(ok boolean, reason text, account_id bigint, account_status text, campaign_status text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_status text := lower(btrim(COALESCE(p_status, '')));
  v_organization_id bigint;
  v_capabilities record;
  v_account_status text;
  v_campaign_status text;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_target_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RETURN QUERY SELECT false, 'invalid_transition', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT account.status INTO v_account_status
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.status INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  WHERE campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = v_organization_id
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status IN ('đang chạy', 'tạm dừng', 'chờ xử lý')
  ORDER BY CASE campaign.status WHEN 'đang chạy' THEN 0 WHEN 'tạm dừng' THEN 1 ELSE 2 END,
    campaign.updated_at DESC NULLS LAST, campaign.id DESC
  LIMIT 1;

  IF v_account_status = v_target_status THEN
    RETURN QUERY SELECT true, 'already_target', p_account_id, v_account_status, v_campaign_status;
    RETURN;
  END IF;
  IF (v_target_status = 'tạm dừng' AND v_account_status IN ('chờ xử lý', 'đang chạy'))
    OR (v_target_status = 'chờ xử lý' AND v_account_status = 'tạm dừng')
  THEN
    UPDATE public.auto_accounts SET status = v_target_status, updated_at = now()
    WHERE id = p_account_id;
    RETURN QUERY SELECT true, 'updated', p_account_id, v_target_status, v_campaign_status;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, 'invalid_transition', p_account_id, v_account_status, v_campaign_status;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_set_zalo_server_campaign_status(bigint,bigint,text)')
  AND md5(pg_get_functiondef(oid))='8811f009a969f2ce8dda19df95a8c614' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_set_zalo_server_campaign_status(bigint,bigint,text)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_zalo_server_campaign_status(p_campaign_id bigint, p_staff_id bigint, p_status text)
 RETURNS TABLE(ok boolean, reason text, campaign_id bigint, campaign_status text, account_status text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_status text := lower(btrim(COALESCE(p_status, '')));
  v_organization_id bigint;
  v_capabilities record;
  v_campaign_status text;
  v_account_status text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Campaign and staff IDs must be positive integers';
  END IF;
  IF v_target_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.status, account.status
  INTO v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND (v_target_status = 'tạm dừng' OR COALESCE(account.is_delete, false) = false)
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_campaign_status = v_target_status THEN
    RETURN QUERY SELECT true, 'already_target', p_campaign_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;
  IF (v_target_status = 'tạm dừng' AND v_campaign_status IN ('chờ xử lý', 'đang chạy'))
    OR (v_target_status = 'chờ xử lý' AND v_campaign_status = 'tạm dừng')
  THEN
    UPDATE public.auto_campaigns AS campaign
    SET
      status = v_target_status,
      note = CASE
        WHEN campaign.data_target_source_mode = 'data_group'
          AND btrim(COALESCE(campaign.note, '')) IN ('Chờ data phù hợp', 'Chờ data mới')
        THEN campaign.note
        ELSE NULL
      END,
      updated_at = now()
    WHERE campaign.id = p_campaign_id;
    RETURN QUERY SELECT true, 'updated', p_campaign_id, v_target_status, v_account_status;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_campaign_status, v_account_status;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)')
  AND md5(pg_get_functiondef(oid))='5ebb1d085d5a70a1dde3ad85268349f4' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_settle_campaign_run_unit_v2(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_unit_token uuid, p_requeue_unstarted boolean)
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, db_now timestamp with time zone, vietnam_date_key date, requeued_count integer)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_organization_id bigint;
  v_campaign_found boolean := false;
  v_campaign_status text;
  v_account_status text;
  v_account_platform text;
  v_account_is_zalo_web boolean;
  v_account_is_zalo_server boolean;
  v_runtime_owner_matches boolean;
  v_stored_unit_token uuid;
  v_stored_unit_vietnam_date date;
  v_stored_unit_claimed_at timestamptz;
  v_stored_unit_input_data_ids bigint[];
  v_optimistic_input_data_ids bigint[];
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_requeued_count integer := 0;
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
  IF p_runtime_unit_token IS NULL THEN
    RAISE EXCEPTION 'runtime unit token is required';
  END IF;
  IF p_requeue_unstarted IS NULL THEN
    RAISE EXCEPTION 'requeue-unstarted decision is required';
  END IF;

  -- Settlement is cleanup: an inactive staff/capability must not strand an
  -- exact token, but the staff/organization/account scope remains mandatory.
  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
  ;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text,
      v_now, v_vietnam_date, 0;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Read the immutable payload after the advisory lock, lock only those rows,
  -- then lock/recheck the campaign. This preserves the canonical input-first
  -- order used by control and run-unit claims.
  SELECT campaign.runtime_unit_input_data_ids
  INTO v_optimistic_input_data_ids
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

  IF cardinality(COALESCE(v_optimistic_input_data_ids, ARRAY[]::bigint[])) > 0 THEN
    PERFORM input_data.id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id = ANY(v_optimistic_input_data_ids)
      AND input_data.campaign_id = p_campaign_id
    ORDER BY input_data.id
    FOR UPDATE OF input_data;
  END IF;

  SELECT
    campaign.status,
    account.status,
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false),
    campaign.runtime_unit_token,
    campaign.runtime_unit_vietnam_date,
    campaign.runtime_unit_claimed_at,
    campaign.runtime_unit_input_data_ids
  INTO
    v_campaign_status,
    v_account_status,
    v_account_platform,
    v_account_is_zalo_web,
    v_account_is_zalo_server,
    v_stored_unit_token,
    v_stored_unit_vietnam_date,
    v_stored_unit_claimed_at,
    v_stored_unit_input_data_ids
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
    )
  FOR UPDATE OF campaign, account;
  v_campaign_found := FOUND;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  IF NOT v_campaign_found THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      v_now, v_vietnam_date, 0;
    RETURN;
  END IF;

  v_runtime_owner_matches := NOT (
    (v_runtime_target = 'server' AND (
      v_account_platform <> 'zalo'
      OR v_account_is_zalo_web
      OR NOT v_account_is_zalo_server
    ))
    OR (v_runtime_target = 'desktop' AND (
      v_account_platform = 'zalo' AND v_account_is_zalo_server
    ))
  );

  IF v_stored_unit_token IS NULL THEN
    IF NOT v_runtime_owner_matches THEN
      RETURN QUERY SELECT
        false, 'runtime_not_owner', v_campaign_status, v_account_status,
        v_now, v_vietnam_date, 0;
    ELSIF v_stored_unit_vietnam_date IS NOT NULL
      OR v_stored_unit_claimed_at IS NOT NULL
      OR v_stored_unit_input_data_ids IS NOT NULL
    THEN
      RETURN QUERY SELECT
        false, 'unit_lease_corrupt', v_campaign_status, v_account_status,
        v_now, v_vietnam_date, 0;
    ELSE
      -- Idempotent terminal result for a settlement response lost after the
      -- lease was cleared. There is no active token this caller can mutate.
      RETURN QUERY SELECT
        true, 'already_settled', v_campaign_status, v_account_status,
        v_now, v_vietnam_date, 0;
    END IF;
    RETURN;
  END IF;

  IF v_stored_unit_token IS DISTINCT FROM p_runtime_unit_token THEN
    RETURN QUERY SELECT
      false, 'unit_lease_mismatch', v_campaign_status, v_account_status,
      v_now, v_vietnam_date, 0;
    RETURN;
  END IF;
  -- The exact opaque token remains authorized to clean up after mutable
  -- account subtype/capability/control changes; no other token can cross it.
  IF v_stored_unit_vietnam_date IS NULL
    OR v_stored_unit_claimed_at IS NULL
    OR v_stored_unit_input_data_ids IS NULL
  THEN
    RETURN QUERY SELECT
      false, 'unit_lease_corrupt', v_campaign_status, v_account_status,
      v_now, v_vietnam_date, 0;
    RETURN;
  END IF;

  IF v_account_platform='facebook' THEN PERFORM private.facebook_random_unit_settled(p_campaign_id,p_account_id,p_runtime_unit_token,p_requeue_unstarted); END IF;

  -- Win the token CAS before mutating even the stored input set. Both changes
  -- remain one transaction, so callers can never observe a cleared lease with
  -- only a partial requeue.
  UPDATE public.auto_campaigns AS campaign
  SET runtime_unit_token = NULL,
    runtime_unit_vietnam_date = NULL,
    runtime_unit_claimed_at = NULL,
    runtime_unit_input_data_ids = NULL,
    updated_at = v_now
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.runtime_unit_token = p_runtime_unit_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, 'unit_lease_mismatch', v_campaign_status, v_account_status,
      v_now, v_vietnam_date, 0;
    RETURN;
  END IF;

  IF p_requeue_unstarted
    AND cardinality(v_stored_unit_input_data_ids) > 0
  THEN
    UPDATE public.auto_campaign_input_data AS input_data
    SET status = 'chờ xử lý', date_action = NULL
    WHERE input_data.id = ANY(v_stored_unit_input_data_ids)
      AND input_data.campaign_id = p_campaign_id
      AND input_data.status = 'đang chạy';
    GET DIAGNOSTICS v_requeued_count = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT
    true,
    CASE WHEN p_requeue_unstarted
      THEN 'requeued_unstarted'
      ELSE 'settled'
    END,
    v_campaign_status,
    v_account_status,
    v_now,
    v_vietnam_date,
    v_requeued_count;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_yield_campaign_daily_boundary(bigint,bigint,bigint,text,uuid,date)')
  AND md5(pg_get_functiondef(oid))='e16a89cf47725bda16696ad5ff7272ea' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.aka_agent_yield_campaign_daily_boundary(bigint,bigint,bigint,text,uuid,date)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_yield_campaign_daily_boundary(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_claim_token uuid, p_claimed_vietnam_date date)
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, db_now timestamp with time zone, vietnam_date_key date, claimed_vietnam_date_key date, effective_stop_time time without time zone, boundary_at timestamp with time zone, day_changed boolean, running_input_count bigint)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz;
  v_vietnam_date date;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_organization_id bigint;
  v_campaign_status text;
  v_account_status text;
  v_daily_stop_time time without time zone;
  v_campaign_is_delete boolean;
  v_account_is_delete boolean;
  v_account_platform text;
  v_account_is_zalo_web boolean;
  v_account_is_zalo_server boolean;
  v_stored_claim_token uuid;
  v_stored_claim_target text;
  v_stored_claim_vietnam_date date;
  v_stored_unit_token uuid;
  v_effective_stop_time time without time zone;
  v_boundary_at timestamptz;
  v_day_changed boolean;
  v_running_input_count bigint := 0;
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
  IF p_runtime_claim_token IS NULL OR p_claimed_vietnam_date IS NULL THEN
    RAISE EXCEPTION 'runtime claim token and Vietnam date are required';
  END IF;

  -- Yield is cleanup. Do not require staff.is_active or a live entitlement:
  -- capability loss must not strand a campaign/account in running state.
  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
  ;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    v_now := clock_timestamp();
    v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
    RETURN QUERY SELECT
      false, 'runtime_not_owner', NULL::text, NULL::text,
      v_now, v_vietnam_date, p_claimed_vietnam_date,
      NULL::time, NULL::timestamptz,
      v_vietnam_date > p_claimed_vietnam_date,
      0::bigint;
    RETURN;
  END IF;

  -- Use the same campaign-scoped serialization barrier as Server run-unit
  -- claims and Control pause/resume before touching input/campaign rows.
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Wait for any in-flight unit row to become stable, but never mutate it.
  -- The runtime calls this RPC only after its current target/batch has settled.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'đang chạy'
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  PERFORM campaign_input.id
  FROM public.auto_campaign_inputs AS campaign_input
  WHERE campaign_input.campaign_id = p_campaign_id
    AND COALESCE(campaign_input.is_delete, false) = false
    AND campaign_input.status = 'đang chạy'
  ORDER BY campaign_input.id
  FOR UPDATE OF campaign_input;

  SELECT
    campaign.status,
    account.status,
    campaign.daily_stop_time,
    COALESCE(campaign.is_delete, false),
    COALESCE(account.is_delete, false),
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false),
    campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_claim_vietnam_date,
    campaign.runtime_unit_token
  INTO
    v_campaign_status,
    v_account_status,
    v_daily_stop_time,
    v_campaign_is_delete,
    v_account_is_delete,
    v_account_platform,
    v_account_is_zalo_web,
    v_account_is_zalo_server,
    v_stored_claim_token,
    v_stored_claim_target,
    v_stored_claim_vietnam_date,
    v_stored_unit_token
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
    )
  FOR UPDATE OF campaign, account;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      v_now, v_vietnam_date, p_claimed_vietnam_date,
      NULL::time, NULL::timestamptz,
      v_vietnam_date > p_claimed_vietnam_date,
      0::bigint;
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

  SELECT
    (
      SELECT count(*)
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = p_campaign_id
        AND COALESCE(input_data.is_delete, false) = false
        AND input_data.status = 'đang chạy'
    ) + (
      SELECT count(*)
      FROM public.auto_campaign_inputs AS campaign_input
      WHERE campaign_input.campaign_id = p_campaign_id
        AND COALESCE(campaign_input.is_delete, false) = false
        AND campaign_input.status = 'đang chạy'
    )
  INTO v_running_input_count;

  IF v_stored_unit_token IS NOT NULL THEN
    -- A durable lease is the authoritative in-flight marker, including for an
    -- empty-ID aggregate unit and after DB-first control changed visible state.
    v_reason := 'unit_still_running';
  ELSIF (v_runtime_target = 'server' AND (
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
  ELSIF v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
  THEN
    -- A DB-first running -> paused transition preserves the parent tuple, but
    -- visible control still wins so the owning executor performs its normal
    -- account-release cleanup instead of yielding or starting new work.
    v_reason := 'runtime_control_paused';
  ELSIF v_stored_claim_token IS DISTINCT FROM p_runtime_claim_token
    OR v_stored_claim_target IS DISTINCT FROM v_runtime_target
    OR v_stored_claim_vietnam_date IS DISTINCT FROM p_claimed_vietnam_date
  THEN
    -- While control remains running, mismatch wins over a newer run's input
    -- count so the stale executor cannot loop on unit_still_running.
    v_reason := 'runtime_claim_mismatch';
  ELSIF v_running_input_count > 0 THEN
    v_reason := 'unit_still_running';
  ELSIF p_claimed_vietnam_date > v_vietnam_date THEN
    v_reason := 'invalid_claimed_vietnam_date';
  ELSIF v_day_changed THEN
    v_reason := 'vietnam_day_changed';
  ELSIF v_now >= v_boundary_at THEN
    v_reason := CASE
      WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
      ELSE 'daily_stop_due'
    END;
  ELSE
    v_reason := 'boundary_not_due';
  END IF;

  IF v_reason IN (
    'vietnam_day_changed',
    'daily_drain_due',
    'daily_stop_due'
  ) THEN
    UPDATE public.auto_campaigns AS campaign
    SET
      status = 'chờ xử lý',
      runtime_claim_token = NULL,
      runtime_claim_target = NULL,
      runtime_claim_vietnam_date = NULL,
      runtime_claimed_at = NULL,
      updated_at = v_now
    WHERE campaign.id = p_campaign_id
      AND campaign.status = 'đang chạy'
      AND campaign.runtime_claim_token = p_runtime_claim_token
      AND campaign.runtime_claim_target = v_runtime_target
      AND campaign.runtime_claim_vietnam_date = p_claimed_vietnam_date
      AND campaign.runtime_unit_token IS NULL;

    IF FOUND THEN
      UPDATE public.auto_accounts AS account
      SET
        status = 'chờ xử lý',
        updated_at = v_now
      WHERE account.id = p_account_id
        AND account.staff_id = p_staff_id
        AND account.status = 'đang chạy';

      v_campaign_status := 'chờ xử lý';
      IF FOUND THEN
        v_account_status := 'chờ xử lý';
      END IF;
      v_reason := 'yielded_' || v_reason;
    ELSE
      -- Defensive CAS result; row locks make this unlikely, but never report a
      -- successful yield when a newer status won.
      v_reason := 'runtime_control_paused';
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_reason IN (
      'yielded_vietnam_day_changed',
      'yielded_daily_drain_due',
      'yielded_daily_stop_due'
    ),
    v_reason,
    v_campaign_status,
    v_account_status,
    v_now,
    v_vietnam_date,
    p_claimed_vietnam_date,
    v_effective_stop_time,
    v_boundary_at,
    v_day_changed,
    v_running_input_count;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)')
  AND md5(pg_get_functiondef(oid))='e590eca5b11f0b258309bcd13b01e6a6' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.claim_non_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_previous_status text, p_claim_token uuid, p_requires_login boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_platform NOT IN ('facebook', 'email') THEN
    RAISE EXCEPTION 'Non-Zalo runtime platform must be Facebook or Email';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  -- reset_desktop_running_statuses takes FOR UPDATE on this same row. The
  -- shared lock prevents a new account operation from entering recovery.
  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'staff_not_active'
    );
  END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_found'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> v_platform
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  -- Retrying the same client-generated token is idempotent after an ambiguous
  -- network response: the caller still owns this exact account-only claim.
  IF v_account.status = 'đang chạy'
    AND v_account.runtime_operation_claim_token = p_claim_token
  THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'account_id', p_account_id,
      'previous_status', v_previous_status,
      'claim_token', p_claim_token,
      'platform', v_platform
    );
  END IF;

  IF (COALESCE(p_requires_login, true) AND v_account.login_status IS DISTINCT FROM 'đã đăng nhập')
    OR v_account.status IS DISTINCT FROM v_previous_status
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = 'đang chạy',
    runtime_operation_claim_token = p_claim_token,
    updated_at = now()
  WHERE account.id = p_account_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_previous_status,
    'claim_token', p_claim_token,
    'platform', v_platform
  );
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)')
  AND md5(pg_get_functiondef(oid))='4d23cf3365d335072c4fcb01e7942dd1' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_requires_login boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
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

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
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
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'account_not_found'
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
      'reason', 'work_running'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
    OR (
      COALESCE(p_requires_login, true)
      AND v_account.login_status <> 'đã đăng nhập'
    )
    OR v_account.status NOT IN ('chờ xử lý', 'tạm dừng')
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
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
      'reason', 'runtime_not_owner'
    );
  END IF;

  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_account.status,
    'runtime_target', v_runtime_target
  );
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)')
  AND md5(pg_get_functiondef(oid))='2f925040dd0bdc49725e0cebbf07c407' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)';
 END IF;
END;
$preflight$;

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

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.discover_zalo_server_account_runtime_users(bigint,integer)')
  AND md5(pg_get_functiondef(oid))='e6c30bd94f312d1e181f936ac41bd026' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='s'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public','statement_timeout=60s']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.discover_zalo_server_account_runtime_users(bigint,integer)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.discover_zalo_server_account_runtime_users(p_after_staff_id bigint DEFAULT 0, p_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_page_size integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
  v_result jsonb;
BEGIN
  IF p_after_staff_id IS NULL OR p_after_staff_id < 0 THEN
    RAISE EXCEPTION 'After staff ID must be zero or greater';
  END IF;

  WITH organization_capabilities AS (
    SELECT capabilities.*, organizations.organization_id
    FROM (
      SELECT DISTINCT entitlement.organization_id
      FROM public.org_organization_product AS entitlement
      WHERE entitlement.product_id IN (16, 18)
        AND entitlement.is_deleted = false
        AND entitlement.expiration_date IS NOT NULL
        AND entitlement.expiration_date >= (
          date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
            AT TIME ZONE 'Asia/Ho_Chi_Minh'
        )
    ) AS organizations
    CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(
      organizations.organization_id
    ) AS capabilities
    WHERE capabilities.qr_enabled = true
      AND capabilities.server_enabled = true
  ),
  page_candidates AS (
    SELECT
      staff.id AS staff_id,
      staff.organization_id,
      staff.name AS staff_name,
      staff.phone AS staff_phone,
      staff.username,
      COALESCE(staff.is_admin_akabiz, false) AS is_admin_akabiz,
      COALESCE(staff.use_test_workflow, false) AS use_test_workflow,
      organization.name AS organization_name,
      capabilities.entitlement_id,
      capabilities.capability_revision AS mode_revision,
      capabilities.product_id,
      capabilities.product_name,
      capabilities.package_name,
      capabilities.package_type,
      capabilities.expiration_date,
      capabilities.max_sends_per_day,
      capabilities.max_accounts,
      capabilities.created_at,
      capabilities.qr_enabled,
      capabilities.web_enabled,
      capabilities.server_enabled
    FROM organization_capabilities AS capabilities
    JOIN public.aka_agent_staff_runtime_profile AS staff
      ON staff.organization_id = capabilities.organization_id
    JOIN public.org_organization AS organization
      ON organization.id = staff.organization_id
    WHERE staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id)
      AND staff.id > p_after_staff_id
    ORDER BY staff.id ASC
    LIMIT v_page_size + 1
  ),
  page_items AS (
    SELECT candidate.*
    FROM page_candidates AS candidate
    ORDER BY candidate.staff_id ASC
    LIMIT v_page_size
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'staff_id', item.staff_id,
          'organization_id', item.organization_id,
          'staff_name', item.staff_name,
          'staff_phone', item.staff_phone,
          'username', item.username,
          'is_admin_akabiz', item.is_admin_akabiz,
          'use_test_workflow', item.use_test_workflow,
          'organization_name', item.organization_name,
          'entitlement_id', item.entitlement_id,
          'mode_revision', item.mode_revision,
          'product_id', item.product_id,
          'product_name', item.product_name,
          'package_name', item.package_name,
          'package_type', item.package_type,
          'expiration_date', item.expiration_date,
          'max_sends_per_day', item.max_sends_per_day,
          'max_accounts', item.max_accounts,
          'created_at', item.created_at,
          'zalo_qr_enabled', item.qr_enabled,
          'zalo_web_enabled', item.web_enabled,
          'zalo_server_enabled', item.server_enabled
        ) ORDER BY item.staff_id ASC
      ) FROM page_items AS item
    ), '[]'::jsonb),
    'next_after_staff_id', CASE
      WHEN (SELECT count(*) FROM page_candidates) > v_page_size
        THEN (SELECT max(item.staff_id) FROM page_items AS item)
      ELSE NULL
    END
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.discover_zalo_server_runtime_users(bigint,integer)')
  AND md5(pg_get_functiondef(oid))='43b0f0efadb0fadcfbfdec7b16dcd083' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='s'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.discover_zalo_server_runtime_users(bigint,integer)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.discover_zalo_server_runtime_users(p_after_staff_id bigint DEFAULT 0, p_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_page_size integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
  v_result jsonb;
BEGIN
  IF p_after_staff_id IS NULL OR p_after_staff_id < 0 THEN
    RAISE EXCEPTION 'After staff ID must be zero or greater';
  END IF;

  WITH organization_modes AS (
    SELECT mode.*,
      organization_id.organization_id
    FROM (
      SELECT DISTINCT entitlement.organization_id
      FROM public.org_organization_product AS entitlement
      WHERE entitlement.product_id IN (16, 18)
        AND entitlement.is_deleted = false
        AND entitlement.expiration_date IS NOT NULL
        AND entitlement.expiration_date >= (
          date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
            AT TIME ZONE 'Asia/Ho_Chi_Minh'
        )
    ) AS organization_id
    CROSS JOIN LATERAL public.resolve_organization_zalo_runtime_mode(
      organization_id.organization_id
    ) AS mode
    WHERE mode.is_zalo_server = true
      AND mode.qr_enabled = true
      AND mode.web_enabled = false
  ),
  page_candidates AS (
    SELECT
      staff.id AS staff_id,
      staff.organization_id,
      staff.name AS staff_name,
      staff.phone AS staff_phone,
      staff.username,
      COALESCE(staff.is_admin_akabiz, false) AS is_admin_akabiz,
      COALESCE(staff.use_test_workflow, false) AS use_test_workflow,
      organization.name AS organization_name,
      mode.entitlement_id,
      mode.mode_revision,
      mode.product_id,
      mode.product_name,
      mode.package_name,
      mode.package_type,
      mode.expiration_date,
      mode.max_sends_per_day,
      mode.max_accounts,
      mode.created_at
    FROM organization_modes AS mode
    JOIN public.aka_agent_staff_runtime_profile AS staff
      ON staff.organization_id = mode.organization_id
    JOIN public.org_organization AS organization
      ON organization.id = staff.organization_id
    WHERE staff.is_active = true
      AND staff.id > p_after_staff_id
    ORDER BY staff.id ASC
    LIMIT v_page_size + 1
  ),
  page_items AS (
    SELECT candidate.*
    FROM page_candidates AS candidate
    ORDER BY candidate.staff_id ASC
    LIMIT v_page_size
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'staff_id', item.staff_id,
          'organization_id', item.organization_id,
          'staff_name', item.staff_name,
          'staff_phone', item.staff_phone,
          'username', item.username,
          'is_admin_akabiz', item.is_admin_akabiz,
          'use_test_workflow', item.use_test_workflow,
          'organization_name', item.organization_name,
          'entitlement_id', item.entitlement_id,
          'mode_revision', item.mode_revision,
          'product_id', item.product_id,
          'product_name', item.product_name,
          'package_name', item.package_name,
          'package_type', item.package_type,
          'expiration_date', item.expiration_date,
          'max_sends_per_day', item.max_sends_per_day,
          'max_accounts', item.max_accounts,
          'created_at', item.created_at
        ) ORDER BY item.staff_id ASC
      ) FROM page_items AS item
    ), '[]'::jsonb),
    'next_after_staff_id', CASE
      WHEN (SELECT count(*) FROM page_candidates) > v_page_size
        THEN (SELECT max(item.staff_id) FROM page_items AS item)
      ELSE NULL
    END
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.enqueue_campaign_zalo_realtime_group_event(bigint,bigint,bigint,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,jsonb)')
  AND md5(pg_get_functiondef(oid))='d41280de429610e294cee7a3fe425724' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.enqueue_campaign_zalo_realtime_group_event(bigint,bigint,bigint,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,jsonb)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enqueue_campaign_zalo_realtime_group_event(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_group_id text, p_group_name text, p_trigger_type text, p_target_uid text, p_target_name text, p_event_time timestamp with time zone, p_schedule_at timestamp with time zone, p_raw_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(inserted boolean, event_id bigint, input_data_id bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id bigint;
  v_input_data_id bigint;
  v_organization_id bigint;
  v_capabilities record;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_target_uid text := btrim(COALESCE(p_target_uid, ''));
  v_target_name text := NULLIF(btrim(COALESCE(p_target_name, '')), '');
  v_group_id text := btrim(COALESCE(p_group_id, ''));
  v_group_name text := NULLIF(btrim(COALESCE(p_group_name, '')), '');
  v_schedule_at timestamptz := COALESCE(p_schedule_at, now());
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN RAISE EXCEPTION 'campaign_id is required'; END IF;
  IF p_account_id IS NULL OR p_account_id <= 0 THEN RAISE EXCEPTION 'account_id is required'; END IF;
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN RAISE EXCEPTION 'staff_id is required'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN RAISE EXCEPTION 'runtime target must be desktop or server'; END IF;
  IF v_group_id = '' THEN RAISE EXCEPTION 'group_id is required'; END IF;
  IF v_target_uid = '' OR v_target_uid = '0' THEN RAISE EXCEPTION 'target_uid is required'; END IF;
  IF p_trigger_type NOT IN ('join', 'leave', 'interact') THEN RAISE EXCEPTION 'invalid trigger_type: %', p_trigger_type; END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN RAISE EXCEPTION 'active staff % was not found', p_staff_id; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR (v_runtime_target = 'server'
      AND NOT COALESCE(v_capabilities.server_enabled, false))
  THEN RAISE EXCEPTION 'runtime_not_owner'; END IF;

  PERFORM 1
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id = 'zalo_message_group_realtime'
    AND campaign.status IN ('chờ xử lý', 'đang chạy')
    AND COALESCE(campaign.is_delete, false) = false
  FOR SHARE OF campaign;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime_control_paused'; END IF;

  PERFORM 1
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND (
      (v_runtime_target = 'server' AND COALESCE(account.is_zalo_server, false) = true)
      OR (v_runtime_target = 'desktop' AND COALESCE(account.is_zalo_server, false) = false)
    )
    AND account.is_active = true
    AND account.status IN ('chờ xử lý', 'đang chạy')
    AND COALESCE(account.is_delete, false) = false
  FOR SHARE OF account;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime_control_paused'; END IF;

  INSERT INTO public.auto_campaign_zalo_realtime_group_events (
    campaign_id, account_id, group_id, group_name, trigger_type,
    target_uid, target_name, event_time, raw_payload
  ) VALUES (
    p_campaign_id, p_account_id, v_group_id, v_group_name, p_trigger_type,
    v_target_uid, v_target_name, COALESCE(p_event_time, now()), COALESCE(p_raw_payload, '{}'::jsonb)
  ) ON CONFLICT (campaign_id, target_uid) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT event.id, event.input_data_id INTO v_event_id, v_input_data_id
    FROM public.auto_campaign_zalo_realtime_group_events AS event
    WHERE event.campaign_id = p_campaign_id AND event.target_uid = v_target_uid;
    RETURN QUERY SELECT false, v_event_id, v_input_data_id;
    RETURN;
  END IF;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, input_id, name, uid, status, note, schedule
  ) VALUES (
    p_campaign_id, NULL, v_target_name, v_target_uid, 'chờ xử lý', '', v_schedule_at
  ) RETURNING id INTO v_input_data_id;

  UPDATE public.auto_campaign_zalo_realtime_group_events
  SET input_data_id = v_input_data_id, updated_at = now()
  WHERE id = v_event_id;
  UPDATE public.auto_campaigns
  SET schedule = v_schedule_at, updated_at = now()
  WHERE id = p_campaign_id AND account_id = p_account_id
    AND status IN ('chờ xử lý', 'đang chạy')
    AND (schedule IS NULL OR schedule < now() OR schedule > v_schedule_at);

  RETURN QUERY SELECT true, v_event_id, v_input_data_id;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_staff_zalo_account_capabilities(bigint)')
  AND md5(pg_get_functiondef(oid))='6354ae2e66d0d7624e090750ac820a2b' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='s'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public, private']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.get_staff_zalo_account_capabilities(bigint)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.get_staff_zalo_account_capabilities(p_staff_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_organization_id bigint;
  v_capabilities record;
  v_quota_pools jsonb;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_profile AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id);

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  SELECT *
  INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  SELECT jsonb_object_agg(
    pool.account_subtype,
    jsonb_build_object(
      'enabled', pool.entitlement_id IS NOT NULL,
      'entitlement_id', pool.entitlement_id,
      'product_id', pool.product_id,
      'product_name', pool.product_name,
      'package_name', pool.package_name,
      'package_type', pool.package_type,
      'expiration_date', pool.expiration_date,
      'max_sends_per_day', pool.max_sends_per_day,
      'max_accounts', pool.max_accounts,
      'created_at', pool.created_at,
      'revision', pool.pool_revision
    )
  )
  INTO v_quota_pools
  FROM private.resolve_organization_zalo_entitlement_pools(
    v_organization_id
  ) AS pool;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'organization_id', v_organization_id,
    'entitlement_id', v_capabilities.entitlement_id,
    'product_id', v_capabilities.product_id,
    'product_name', v_capabilities.product_name,
    'package_name', v_capabilities.package_name,
    'package_type', v_capabilities.package_type,
    'expiration_date', v_capabilities.expiration_date,
    'max_sends_per_day', v_capabilities.max_sends_per_day,
    'max_accounts', v_capabilities.max_accounts,
    'created_at', v_capabilities.created_at,
    'zalo_qr_enabled', COALESCE(v_capabilities.qr_enabled, false),
    'zalo_web_enabled', COALESCE(v_capabilities.web_enabled, false),
    'zalo_server_enabled', COALESCE(v_capabilities.server_enabled, false),
    'revision', COALESCE(
      v_capabilities.capability_revision,
      'none:' || v_organization_id::text
    ),
    'quota_pools', COALESCE(v_quota_pools, '{}'::jsonb)
  );
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_staff_zalo_runtime_mode(bigint)')
  AND md5(pg_get_functiondef(oid))='cf1fdfe5733240f9a52a0395e2cdefa1' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='s'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.get_staff_zalo_runtime_mode(bigint)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.get_staff_zalo_runtime_mode(p_staff_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_mode record;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_profile AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true AND public.aka_agent_staff_time_allowed(staff.id);

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'is_zalo_server', COALESCE(v_mode.is_zalo_server, false),
    'is_zalo_show_web', COALESCE(v_mode.web_enabled, false),
    'zalo_qr_enabled', COALESCE(v_mode.qr_enabled, false),
    'zalo_web_enabled', COALESCE(v_mode.web_enabled, false),
    'revision', COALESCE(v_mode.mode_revision, 'none:' || v_organization_id::text)
  );
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inspect_staff_zalo_running_state(bigint)')
  AND md5(pg_get_functiondef(oid))='a84efaee5acdf271c6b1a50c4fce1428' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.inspect_staff_zalo_running_state(bigint)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.inspect_staff_zalo_running_state(p_staff_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_accounts_running integer := 0;
  v_campaigns_running integer := 0;
  v_campaign_inputs_running integer := 0;
  v_campaign_input_data_running integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  -- This barrier follows durable account ownership and remains usable after
  -- entitlement loss. Concurrent QR/Web-local work must not block Server drain.
  SELECT count(*)::integer INTO v_accounts_running
  FROM public.auto_accounts AS account
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
    AND account.status = 'đang chạy';

  SELECT count(*)::integer INTO v_campaigns_running
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(account.is_delete, false) = false
    AND campaign.status = 'đang chạy';

  SELECT count(*)::integer INTO v_campaign_inputs_running
  FROM public.auto_campaign_inputs AS campaign_input
  JOIN public.auto_campaigns AS campaign ON campaign.id = campaign_input.campaign_id
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(campaign_input.is_delete, false) = false
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(account.is_delete, false) = false
    AND campaign_input.status = 'đang chạy';

  SELECT count(*)::integer INTO v_campaign_input_data_running
  FROM public.auto_campaign_input_data AS input_data
  JOIN public.auto_campaigns AS campaign ON campaign.id = input_data.campaign_id
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(input_data.is_delete, false) = false
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(account.is_delete, false) = false
    AND input_data.status = 'đang chạy';

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'has_running_state',
      v_accounts_running > 0 OR v_campaigns_running > 0
      OR v_campaign_inputs_running > 0 OR v_campaign_input_data_running > 0,
    'accounts_running', v_accounts_running,
    'campaigns_running', v_campaigns_running,
    'campaign_inputs_running', v_campaign_inputs_running,
    'campaign_input_data_running', v_campaign_input_data_running
  );
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.normalize_legacy_zalo_account_server_owner()')
  AND md5(pg_get_functiondef(oid))='331a13b1e8fcf0f1cc0eacb60afd756d' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.normalize_legacy_zalo_account_server_owner()';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.normalize_legacy_zalo_account_server_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_legacy_is_zalo_server boolean := false;
BEGIN
  -- Explicit true/false is a new-client subtype decision. Only omitted/NULL
  -- values use the legacy v218 organization-wide owner.
  IF NEW.is_zalo_server IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF lower(btrim(COALESCE(NEW.flatform_type, ''))) <> 'zalo'
    OR COALESCE(NEW.is_zalo_show_web, false)
  THEN
    NEW.is_zalo_server := false;
    RETURN NEW;
  END IF;

  v_organization_id := NEW.organization_id;
  IF v_organization_id IS NULL AND NEW.staff_id IS NOT NULL THEN
    SELECT staff.organization_id
    INTO v_organization_id
    FROM public.aka_agent_staff_runtime_profile AS staff
    WHERE staff.id = NEW.staff_id;
  END IF;

  IF v_organization_id IS NOT NULL THEN
    SELECT COALESCE(mode.is_zalo_server, false)
    INTO v_legacy_is_zalo_server
    FROM public.resolve_organization_zalo_runtime_mode(v_organization_id) AS mode;
  END IF;

  NEW.is_zalo_server := COALESCE(v_legacy_is_zalo_server, false);
  RETURN NEW;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.recover_server_zalo_running_state(bigint,text,boolean)')
  AND md5(pg_get_functiondef(oid))='d465015c7cd383fbe37f44b9aed404d9' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.recover_server_zalo_running_state(bigint,text,boolean)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.recover_server_zalo_running_state(p_staff_id bigint, p_expected_mode_revision text DEFAULT NULL::text, p_require_server_mode boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_accounts_reset integer := 0;
  v_campaigns_reset integer := 0;
  v_campaign_inputs_completed integer := 0;
  v_campaign_input_data_completed integer := 0;
  v_recovery_note constant text := 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_capabilities record;
  v_campaign_id bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'update') AS staff
  WHERE staff.id = p_staff_id
  ;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  IF NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NOT NULL
    AND v_capabilities.capability_revision IS DISTINCT FROM btrim(p_expected_mode_revision)
  THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  IF COALESCE(p_require_server_mode, false) AND (
    NOT COALESCE(v_capabilities.server_enabled, false)
    OR NOT COALESCE(v_capabilities.qr_enabled, false)
    OR v_capabilities.entitlement_id IS NULL
    OR NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  -- Claims/finalizers serialize campaign/input rows through this barrier.
  -- Recovery can touch more than one campaign, so acquire the complete set in
  -- ascending ID order before its first child/campaign row mutation. The staff
  -- row lock above prevents a new runtime claim from entering while this
  -- candidate set is established.
  FOR v_campaign_id IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND (
        campaign.status = 'đang chạy'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_inputs AS campaign_input
          WHERE campaign_input.campaign_id = campaign.id
            AND campaign_input.status = 'đang chạy'
            AND COALESCE(campaign_input.is_delete, false) = false
        )
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.campaign_id = campaign.id
            AND input_data.status = 'đang chạy'
            AND COALESCE(input_data.is_delete, false) = false
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  -- A recovery requested by Server may only mutate Server-subtype accounts.
  -- With p_require_server_mode=false this also cleans an interrupted Server
  -- account after its capability/entitlement expired, without touching local.
    UPDATE public.auto_campaign_input_data AS input_data
    SET status = 'hoàn thành', note = v_recovery_note
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE input_data.campaign_id = campaign.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND input_data.status = 'đang chạy'
      AND COALESCE(input_data.is_delete, false) = false;
    GET DIAGNOSTICS v_campaign_input_data_completed = ROW_COUNT;

    UPDATE public.auto_campaign_inputs AS campaign_input
    SET status = 'hoàn thành', note = v_recovery_note
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign_input.campaign_id = campaign.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND campaign_input.status = 'đang chạy'
      AND COALESCE(campaign_input.is_delete, false) = false;
    GET DIAGNOSTICS v_campaign_inputs_completed = ROW_COUNT;

    UPDATE public.auto_campaigns AS campaign
    SET status = 'chờ xử lý', updated_at = now()
    FROM public.auto_accounts AS account
    WHERE campaign.account_id = account.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND campaign.status = 'đang chạy'
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false;
    GET DIAGNOSTICS v_campaigns_reset = ROW_COUNT;

    UPDATE public.auto_accounts AS account
    SET status = 'chờ xử lý', updated_at = now()
    WHERE account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_accounts_reset = ROW_COUNT;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'accounts_reset', v_accounts_reset,
    'campaigns_reset', v_campaigns_reset,
    'campaign_inputs_completed', v_campaign_inputs_completed,
    'campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.release_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)')
  AND md5(pg_get_functiondef(oid))='8b5a01bc1606fca27eeff6fd5e27e08b' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.release_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.release_non_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_platform text, p_previous_status text, p_claim_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_platform NOT IN ('facebook', 'email') THEN
    RAISE EXCEPTION 'Non-Zalo runtime platform must be Facebook or Email';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = v_platform
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = v_previous_status,
    runtime_operation_claim_token = NULL,
    updated_at = now()
  WHERE account.id = p_account_id
    AND account.status = 'đang chạy'
    AND account.runtime_operation_claim_token = p_claim_token;
  RETURN FOUND;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.release_zalo_account_runtime_operation(bigint,bigint,text,text)')
  AND md5(pg_get_functiondef(oid))='c8962dc3218edc9c1a42567bd800ebaa' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.release_zalo_account_runtime_operation(bigint,bigint,text,text)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.release_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_previous_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN false; END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);
  -- Release is cleanup, not a new operation. Capability loss does not prevent
  -- either runtime from releasing its own subtype.
  IF (v_runtime_target = 'server' AND (v_is_web OR NOT v_is_server))
    OR (v_runtime_target = 'desktop' AND v_is_server)
  THEN RETURN false; END IF;

  UPDATE public.auto_accounts
  SET status = v_previous_status, updated_at = now()
  WHERE id = p_account_id AND status = 'đang chạy';
  RETURN FOUND;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)')
  AND md5(pg_get_functiondef(oid))='b32f324928cef0699697f259b3899c75' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.release_zalo_account_runtime_operation(p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_previous_status text, p_claim_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'share') AS staff
  WHERE staff.id = p_staff_id
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = v_previous_status,
    runtime_operation_claim_token = NULL,
    updated_at = now()
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND account.status = 'đang chạy'
    AND account.runtime_operation_claim_token = p_claim_token;
  RETURN FOUND;
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.reset_desktop_running_statuses(bigint,boolean,boolean)')
  AND md5(pg_get_functiondef(oid))='dc304ed20a0b6cab0824f9bbfbcb30c8' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.reset_desktop_running_statuses(bigint,boolean,boolean)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.reset_desktop_running_statuses(p_staff_id bigint, p_exclude_zalo boolean DEFAULT false, p_zalo_uncertain_no_retry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_accounts_reset integer := 0;
  v_campaigns_reset integer := 0;
  v_campaign_notes_reset integer := 0;
  v_campaign_inputs_reset integer := 0;
  v_campaign_input_data_reset integer := 0;
  v_exclude_zalo boolean := COALESCE(p_exclude_zalo, false);
  v_zalo_uncertain_no_retry boolean := COALESCE(p_zalo_uncertain_no_retry, false);
  v_handoff_note constant text := 'Dừng do thay đổi chế độ runtime, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_campaign_id bigint;
  v_previous_random_reset_staff text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;
  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'update') AS staff
  WHERE staff.id = p_staff_id
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  -- Acquire every campaign/input barrier in one deterministic pass before the
  -- bulk child updates below. This is the same superset used by the no-retry
  -- wrapper, so the wrapper can safely delegate back into this function.
  FOR v_campaign_id IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.action_id <> 'sms_send'
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
      AND COALESCE(account.is_delete, false) = false
      AND (
        lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
        OR COALESCE(account.is_zalo_server, false) = false
      )
      AND (
        campaign.status = 'đang chạy'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_inputs AS campaign_input
          WHERE campaign_input.campaign_id = campaign.id
            AND campaign_input.status = 'đang chạy'
            AND COALESCE(campaign_input.is_delete, false) = false
        )
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.campaign_id = campaign.id
            AND input_data.status = 'đang chạy'
            AND COALESCE(input_data.is_delete, false) = false
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  UPDATE public.auto_campaign_input_data AS input_data
  SET
    status = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN 'hoàn thành' ELSE 'chờ xử lý' END,
    note = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN v_handoff_note ELSE input_data.note END
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    )
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_reset = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET
    status = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN 'hoàn thành' ELSE 'chờ xử lý' END,
    note = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN v_handoff_note ELSE campaign_input.note END
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    )
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_reset = ROW_COUNT;

  SELECT count(*)::integer INTO v_campaign_notes_reset
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON campaign.account_id = account.id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND campaign.note IS NOT NULL
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    );

  -- Startup reset is not a successful random-turn release. Defer output to
  -- the existing lease/orphan recovery, including when random mode is off.
  v_previous_random_reset_staff := current_setting('aka_agent.facebook_random_reset_staff', true);
  PERFORM set_config('aka_agent.facebook_random_reset_staff', p_staff_id::text, true);
  UPDATE public.auto_campaigns AS campaign
  SET status = 'chờ xử lý', note = NULL, updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    );
  GET DIAGNOSTICS v_campaigns_reset = ROW_COUNT;
  PERFORM set_config('aka_agent.facebook_random_reset_staff', COALESCE(v_previous_random_reset_staff, ''), true);

  UPDATE public.auto_accounts AS account
  SET status = 'chờ xử lý', updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    )
    AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_accounts_reset = ROW_COUNT;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'exclude_zalo', v_exclude_zalo,
    'zalo_uncertain_no_retry', v_zalo_uncertain_no_retry,
    'accounts_reset', v_accounts_reset,
    'campaigns_reset', v_campaigns_reset,
    'campaign_notes_reset', v_campaign_notes_reset,
    'campaign_inputs_reset', v_campaign_inputs_reset,
    'campaign_input_data_reset', v_campaign_input_data_reset
  );
END;
$function$;

DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)')
  AND md5(pg_get_functiondef(oid))='bfda9371f3964c1e3a0d3bccb58167b9' AND prosecdef=false
  AND pg_get_userbyid(proowner)='postgres' AND provolatile='v'
  AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[] AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'staff RLS live definition/attributes drift: %','public.reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.reset_desktop_running_statuses_no_retry(p_staff_id bigint, p_exclude_zalo boolean DEFAULT false, p_zalo_uncertain_no_retry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_campaign_inputs_completed integer := 0;
  v_campaign_input_data_completed integer := 0;
  v_non_zalo_accounts_reset integer := 0;
  v_non_zalo_campaigns_reset integer := 0;
  v_non_zalo_campaign_notes_reset integer := 0;
  v_interrupted_note constant text := 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_campaign_id bigint;
  v_previous_random_reset_staff text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  -- Hold the same staff-row barrier as campaign/account claims for the entire
  -- no-retry completion + existing recovery sequence.
  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'update') AS staff
  WHERE staff.id = p_staff_id
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  -- Match the delegated recovery's global order exactly:
  -- staff -> entitlement (shared) -> campaign barriers -> rows.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  FOR v_campaign_id IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.action_id IS DISTINCT FROM 'sms_send'
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
      AND COALESCE(account.is_delete, false) = false
      AND (
        lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
        OR COALESCE(account.is_zalo_server, false) = false
      )
      AND (
        campaign.status = 'đang chạy'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_inputs AS campaign_input
          WHERE campaign_input.campaign_id = campaign.id
            AND campaign_input.status = 'đang chạy'
            AND COALESCE(campaign_input.is_delete, false) = false
        )
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.campaign_id = campaign.id
            AND input_data.status = 'đang chạy'
            AND COALESCE(input_data.is_delete, false) = false
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  UPDATE public.auto_campaign_input_data AS input_data
  SET status = 'hoàn thành', note = v_interrupted_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_completed = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET status = 'hoàn thành', note = v_interrupted_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_completed = ROW_COUNT;

  SELECT count(*)::integer INTO v_non_zalo_campaign_notes_reset
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND campaign.note IS NOT NULL
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false;

  -- Startup reset is not a successful random-turn release. Defer output to
  -- the existing lease/orphan recovery, including when random mode is off.
  v_previous_random_reset_staff := current_setting('aka_agent.facebook_random_reset_staff', true);
  PERFORM set_config('aka_agent.facebook_random_reset_staff', p_staff_id::text, true);
  UPDATE public.auto_campaigns AS campaign
  SET status = 'chờ xử lý', note = NULL, updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false;
  GET DIAGNOSTICS v_non_zalo_campaigns_reset = ROW_COUNT;
  PERFORM set_config('aka_agent.facebook_random_reset_staff', COALESCE(v_previous_random_reset_staff, ''), true);

  UPDATE public.auto_accounts AS account
  SET status = 'chờ xử lý', updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_non_zalo_accounts_reset = ROW_COUNT;

  v_result := public.reset_desktop_running_statuses(
    p_staff_id,
    COALESCE(p_exclude_zalo, false),
    COALESCE(p_zalo_uncertain_no_retry, false)
  );

  RETURN v_result || jsonb_build_object(
    'accounts_reset', COALESCE((v_result ->> 'accounts_reset')::integer, 0) + v_non_zalo_accounts_reset,
    'campaigns_reset', COALESCE((v_result ->> 'campaigns_reset')::integer, 0) + v_non_zalo_campaigns_reset,
    'campaign_notes_reset', COALESCE((v_result ->> 'campaign_notes_reset')::integer, 0) + v_non_zalo_campaign_notes_reset,
    'non_zalo_uncertain_no_retry', true,
    'non_zalo_campaign_inputs_completed', v_campaign_inputs_completed,
    'non_zalo_campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;

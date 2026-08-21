-- Rollback smoke test for
-- migration_v247_preserve_daily_schedule_without_next_day_delay.sql.

BEGIN;

SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '5s';
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $smoke$
DECLARE
  v_staff_id constant bigint := 8800247000000001;
  v_account_id constant bigint := 8800247000000002;
  v_campaign_id constant bigint := 8800247000000003;
  v_server_account_id constant bigint := 8800247000000004;
  v_server_campaign_id constant bigint := 8800247000000005;
  v_claim_token constant uuid :=
    '24700000-0000-4000-8000-000000000001';
  v_unit_token constant uuid :=
    '24700000-0000-4000-8000-000000000002';
  v_server_claim_token constant uuid :=
    '24700000-0000-4000-8000-000000000003';
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)'
  );
  v_barrier_function_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_check_daily_maintenance_barrier(bigint,text,date)'
  );
  v_organization_id bigint;
  v_action_id text;
  v_zalo_action_id text;
  v_today date := timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date;
  v_stale_schedule timestamptz;
  v_boundary_at timestamptz;
  v_result record;
BEGIN
  IF v_function_oid IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_function_oid))
      <> '782a8b7adf396f21f7d69bc4a613bce1'
  THEN
    RAISE EXCEPTION 'v247_smoke: target claim function is missing';
  END IF;
  IF v_barrier_function_oid IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_barrier_function_oid))
      <> '087a04ad6f98cc2cff5267dabcead7cd'
    OR NOT pg_catalog.has_function_privilege(
      'aka_agent_chat_api', v_barrier_function_oid, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v247_smoke: Chat daily maintenance barrier grant is missing';
  END IF;

  v_stale_schedule := (
    (v_today - 1) + time '12:34:00'
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_boundary_at := (
    v_today + time '23:59:00'
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

  IF clock_timestamp() + interval '30 seconds' >= v_boundary_at THEN
    RAISE NOTICE 'v247_smoke: behavior skipped near the daily drain boundary';
    RETURN;
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  JOIN public.org_organization AS organization
    ON organization.id = staff.organization_id
  CROSS JOIN LATERAL
    public.resolve_organization_zalo_account_capabilities(
      staff.organization_id
    ) AS capabilities
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
    AND COALESCE(capabilities.qr_enabled, false) = true
    AND COALESCE(capabilities.server_enabled, false) = true
  ORDER BY staff.id
  LIMIT 1;

  SELECT action.id
  INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE lower(btrim(COALESCE(action.flatform_type, ''))) = 'facebook'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  ORDER BY action.id
  LIMIT 1;

  SELECT action.id
  INTO v_zalo_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.id = 'zalo_message_phone'
    AND lower(btrim(COALESCE(action.flatform_type, ''))) = 'zalo'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  LIMIT 1;

  IF v_organization_id IS NULL
    OR v_action_id IS NULL
    OR v_zalo_action_id IS NULL
  THEN
    RAISE NOTICE
      'v247_smoke: Server-enabled organization or Facebook/Zalo action missing';
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('aka-agent-v247-daily-false-smoke', 0)
  );

  IF EXISTS (SELECT 1 FROM public.org_staff WHERE id = v_staff_id)
    OR EXISTS (
      SELECT 1
      FROM public.auto_accounts
      WHERE id IN (v_account_id, v_server_account_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.auto_campaigns
      WHERE id IN (v_campaign_id, v_server_campaign_id)
    )
  THEN
    RAISE EXCEPTION 'v247_smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.org_staff (
    id, organization_id, name, phone, username, password, is_active
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_staff_id,
    v_organization_id,
    '__v247_daily_false_staff__',
    '8800247000000001',
    '__v247_daily_false_staff__',
    '__v247_rollback_only__',
    true
  );

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_account_id, '__v247_daily_false_account__', 'facebook', false, false,
    'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  ), (
    v_server_account_id, '__v247_daily_false_server_account__',
    'zalo', false, true,
    'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, schedule_type, daily_stop_time,
    continue_next_day, data_target_source_mode,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_campaign_id, '__v247_daily_false_campaign__', v_action_id,
    v_account_id, 'chờ xử lý', '',
    v_stale_schedule, v_stale_schedule, 'daily', NULL,
    true, 'direct',
    v_staff_id, v_organization_id, false
  ), (
    v_server_campaign_id, '__v247_daily_false_server_campaign__',
    v_zalo_action_id, v_server_account_id, 'chờ xử lý', '',
    v_stale_schedule, v_stale_schedule, 'daily', NULL,
    false, 'direct',
    v_staff_id, v_organization_id, false
  );

  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_campaign_id, v_account_id, v_staff_id, 'desktop', v_claim_token
  );
  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'daily_maintenance_required'
  THEN
    RAISE EXCEPTION
      'v247_smoke: stale daily true schedule bypassed maintenance';
  END IF;

  UPDATE public.auto_campaigns
  SET schedule_type = 'weekly', continue_next_day = false
  WHERE id = v_campaign_id;
  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_campaign_id, v_account_id, v_staff_id, 'desktop', v_claim_token
  );
  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'daily_maintenance_required'
  THEN
    RAISE EXCEPTION
      'v247_smoke: stale weekly false schedule bypassed maintenance';
  END IF;

  UPDATE public.auto_campaigns
  SET schedule_type = 'monthly'
  WHERE id = v_campaign_id;
  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_campaign_id, v_account_id, v_staff_id, 'desktop', v_claim_token
  );
  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'daily_maintenance_required'
  THEN
    RAISE EXCEPTION
      'v247_smoke: stale monthly false schedule bypassed maintenance';
  END IF;

  UPDATE public.auto_campaigns
  SET schedule_type = 'daily', runtime_unit_token = v_unit_token
  WHERE id = v_campaign_id;
  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_campaign_id, v_account_id, v_staff_id, 'desktop', v_claim_token
  );
  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'unit_lease_busy'
  THEN
    RAISE EXCEPTION
      'v247_smoke: daily false bypassed the durable unit lease guard';
  END IF;

  UPDATE public.auto_campaigns
  SET runtime_unit_token = NULL
  WHERE id = v_campaign_id;
  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_campaign_id, v_account_id, v_staff_id, 'desktop', v_claim_token
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'claimed'
    OR NOT EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
        AND campaign.status = 'đang chạy'
        AND campaign.schedule = v_stale_schedule
        AND campaign.schedule_type = 'daily'
        AND campaign.continue_next_day = false
    )
  THEN
    RAISE EXCEPTION
      'v247_smoke: stale daily false was changed or could not claim';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_server_campaign_id,
    v_server_account_id,
    v_staff_id,
    'server',
    v_server_claim_token
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'claimed'
    OR NOT EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_server_campaign_id
        AND campaign.status = 'đang chạy'
        AND campaign.schedule = v_stale_schedule
        AND campaign.schedule_type = 'daily'
        AND campaign.continue_next_day = false
        AND campaign.action_id = 'zalo_message_phone'
    )
  THEN
    RAISE EXCEPTION
      'v247_smoke: stale Zalo Server daily false was changed or not claimable';
  END IF;
END;
$smoke$;

ROLLBACK;

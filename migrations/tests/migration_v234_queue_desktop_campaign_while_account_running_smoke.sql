-- Rollback smoke test for
-- migration_v234_queue_desktop_campaign_while_account_running.sql.

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $behavior$
DECLARE
  v_staff_id constant bigint := 8800234000000001;
  v_account_id constant bigint := 8800234000000002;
  v_campaign_id constant bigint := 8800234000000003;
  v_organization_id bigint;
  v_action_id text;
  v_result record;
  v_claim_result record;
  v_runtime_token constant uuid := '23400000-0000-4000-8000-000000000001';
  v_unit_token constant uuid := '23400000-0000-4000-8000-000000000002';
  v_scheduler_token constant uuid := '23400000-0000-4000-8000-000000000003';
  v_today date := timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date;
BEGIN
  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
  ORDER BY staff.id
  LIMIT 1;

  SELECT action.id
  INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE lower(btrim(COALESCE(action.flatform_type, ''))) <> 'zalo'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  ORDER BY action.id
  LIMIT 1;

  IF v_organization_id IS NULL OR v_action_id IS NULL THEN
    RAISE NOTICE 'v234_smoke: active organization or Desktop action missing; behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('aka-agent-v234-busy-account-queue-smoke', 0)
  );

  IF EXISTS (SELECT 1 FROM public.org_staff WHERE id = v_staff_id)
    OR EXISTS (SELECT 1 FROM public.auto_accounts WHERE id = v_account_id)
    OR EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id = v_campaign_id)
  THEN
    RAISE EXCEPTION 'v234_smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.org_staff (
    id, organization_id, name, phone, username, password, is_active
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_staff_id,
    v_organization_id,
    '__v234_busy_account_queue_staff__',
    '8800234000000001',
    '__v234_busy_account_queue_staff__',
    '__v234_rollback_only__',
    true
  );

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_account_id, '__v234_busy_account_queue_account__', 'facebook', false, false,
    'đã đăng nhập', 'đang chạy', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content, schedule,
    data_target_source_mode, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_campaign_id, '__v234_busy_account_queue_campaign__', v_action_id,
    v_account_id, 'tạm dừng', '', clock_timestamp(),
    'direct', v_staff_id, v_organization_id, false
  );

  -- Resume is a queue transition. It must succeed without changing or
  -- acquiring the already-running account.
  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_campaign_id, v_account_id, v_staff_id, 'chờ xử lý'
  );

  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR v_result.campaign_status IS DISTINCT FROM 'chờ xử lý'
    OR v_result.account_status IS DISTINCT FROM 'đang chạy'
    OR (
      SELECT account.status
      FROM public.auto_accounts AS account
      WHERE account.id = v_account_id
    ) IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION 'v234_smoke: paused campaign was not queued behind a busy account';
  END IF;

  -- Queueing must not weaken execution serialization. The scheduler claim
  -- still rejects while this account is running and must leave no parent token.
  SELECT * INTO v_claim_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_scheduler_token
  );
  IF v_claim_result.ok IS DISTINCT FROM false
    OR v_claim_result.reason IS DISTINCT FROM 'claim_rejected'
    OR v_claim_result.campaign_status IS DISTINCT FROM 'chờ xử lý'
    OR v_claim_result.account_status IS DISTINCT FROM 'đang chạy'
    OR EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
        AND campaign.runtime_claim_token IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'v234_smoke: scheduler claimed queued campaign while account was busy';
  END IF;

  -- The behavior change must not weaken ownership/concurrency guards on the
  -- campaign being resumed.
  UPDATE public.auto_campaigns
  SET status = 'tạm dừng'
  WHERE id = v_campaign_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_runtime_token,
    runtime_claim_target = 'desktop',
    runtime_claim_vietnam_date = v_today,
    runtime_claimed_at = clock_timestamp()
  WHERE id = v_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_campaign_id, v_account_id, v_staff_id, 'chờ xử lý'
  );
  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'runtime_busy'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
  THEN
    RAISE EXCEPTION 'v234_smoke: resume crossed an active runtime claim';
  END IF;

  UPDATE public.auto_campaigns
  SET runtime_claim_token = NULL,
    runtime_claim_target = NULL,
    runtime_claim_vietnam_date = NULL,
    runtime_claimed_at = NULL,
    runtime_unit_token = v_unit_token,
    runtime_unit_vietnam_date = v_today,
    runtime_unit_claimed_at = clock_timestamp(),
    runtime_unit_input_data_ids = ARRAY[]::bigint[]
  WHERE id = v_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_campaign_id, v_account_id, v_staff_id, 'chờ xử lý'
  );
  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'unit_lease_busy'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
  THEN
    RAISE EXCEPTION 'v234_smoke: resume crossed an active unit lease';
  END IF;

  UPDATE public.auto_campaigns
  SET runtime_unit_token = NULL,
    runtime_unit_vietnam_date = NULL,
    runtime_unit_claimed_at = NULL,
    runtime_unit_input_data_ids = NULL
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET is_active = false
  WHERE id = v_account_id;

  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_campaign_id, v_account_id, v_staff_id, 'chờ xử lý'
  );
  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'account_inactive'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
  THEN
    RAISE EXCEPTION 'v234_smoke: resume crossed the inactive-account guard';
  END IF;
END;
$behavior$;

ROLLBACK;

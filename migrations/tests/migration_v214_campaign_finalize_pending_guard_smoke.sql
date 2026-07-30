-- Rollback smoke test for migration_v214_campaign_finalize_pending_guard.sql.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $v214_campaign_finalize_pending_guard$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_account_id bigint;
  v_action_id text;
  v_campaign_id bigint;
  v_input_data_id bigint;
  v_second_input_data_id bigint;
  v_result record;
  v_status text;
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v214_smoke: campaign finalizer RPC is missing';
  END IF;

  SELECT staff.id, staff.organization_id, account.id
  INTO v_staff_id, v_organization_id, v_account_id
  FROM public.org_staff AS staff
  JOIN public.auto_accounts AS account
    ON account.staff_id = staff.id
    AND (
      account.organization_id IS NULL
      OR account.organization_id = staff.organization_id
    )
    AND COALESCE(account.is_delete, false) = false
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
  ORDER BY staff.id, account.id
  LIMIT 1;

  SELECT action.id
  INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE COALESCE(action.is_delete, false) = false
  ORDER BY action.id
  LIMIT 1;

  IF v_staff_id IS NULL OR v_account_id IS NULL OR v_action_id IS NULL THEN
    RAISE NOTICE 'v214_smoke: active staff, account or campaign action missing; behavioral fixture skipped';
    RETURN;
  END IF;

  UPDATE public.auto_email_notification_settings
  SET is_enabled = false
  WHERE staff_id = v_staff_id;

  INSERT INTO public.auto_campaigns (
    name,
    action_id,
    account_id,
    status,
    content,
    data_target_source_mode,
    staff_id,
    organization_id,
    is_delete
  ) VALUES (
    '__v214_pending_guard__',
    v_action_id,
    v_account_id,
    'đang chạy',
    '',
    'direct',
    v_staff_id,
    v_organization_id,
    false
  )
  RETURNING id INTO v_campaign_id;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id,
    status,
    is_delete
  ) VALUES (
    v_campaign_id,
    'chờ xử lý',
    false
  )
  RETURNING id INTO v_input_data_id;

  SELECT * INTO v_result
  FROM public.aka_agent_finalize_campaign(
    v_staff_id,
    v_organization_id,
    v_campaign_id,
    NULL,
    false,
    'đang chạy',
    NULL,
    NULL
  );

  SELECT status INTO v_status
  FROM public.auto_campaigns
  WHERE id = v_campaign_id;

  IF COALESCE(v_result.completed, false)
    OR v_result.reason IS DISTINCT FROM 'pending_input_remaining'
    OR v_result.pending_input_count IS DISTINCT FROM 1::bigint
    OR v_status IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v214_smoke: pending input did not prevent completion';
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'hoàn thành'
  WHERE id = v_input_data_id;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy'
  WHERE id = v_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_finalize_campaign(
    v_staff_id,
    v_organization_id,
    v_campaign_id,
    'done',
    true,
    'đang chạy',
    NULL,
    NULL
  );

  SELECT status INTO v_status
  FROM public.auto_campaigns
  WHERE id = v_campaign_id;

  IF NOT COALESCE(v_result.completed, false)
    OR v_result.reason IS DISTINCT FROM 'completed'
    OR v_result.pending_input_count IS DISTINCT FROM 0::bigint
    OR v_status IS DISTINCT FROM 'hoàn thành'
  THEN
    RAISE EXCEPTION 'v214_smoke: drained campaign did not complete';
  END IF;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id,
    status,
    is_delete
  ) VALUES (
    v_campaign_id,
    'chờ xử lý',
    false
  )
  RETURNING id INTO v_second_input_data_id;

  SELECT * INTO v_result
  FROM public.aka_agent_finalize_campaign(
    v_staff_id,
    v_organization_id,
    v_campaign_id,
    NULL,
    false,
    'chờ xử lý',
    NULL,
    NULL
  );

  SELECT status INTO v_status
  FROM public.auto_campaigns
  WHERE id = v_campaign_id;

  IF COALESCE(v_result.completed, false)
    OR v_result.reason IS DISTINCT FROM 'pending_input_remaining'
    OR v_result.pending_input_count IS DISTINCT FROM 1::bigint
    OR v_status IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v214_smoke: pending input did not reopen completed campaign';
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'hoàn thành'
  WHERE id = v_second_input_data_id;

  SELECT * INTO v_result
  FROM public.aka_agent_finalize_campaign(
    v_staff_id,
    v_organization_id,
    v_campaign_id,
    'done after reopen',
    true,
    'chờ xử lý',
    NULL,
    NULL
  );

  SELECT status INTO v_status
  FROM public.auto_campaigns
  WHERE id = v_campaign_id;

  IF NOT COALESCE(v_result.completed, false)
    OR v_result.reason IS DISTINCT FROM 'completed'
    OR v_result.pending_input_count IS DISTINCT FROM 0::bigint
    OR v_status IS DISTINCT FROM 'hoàn thành'
  THEN
    RAISE EXCEPTION 'v214_smoke: reopened campaign did not complete after draining';
  END IF;
END;
$v214_campaign_finalize_pending_guard$;

ROLLBACK;

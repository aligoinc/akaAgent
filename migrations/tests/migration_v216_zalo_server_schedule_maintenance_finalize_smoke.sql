-- Rollback smoke test for
-- migration_v216_zalo_server_schedule_maintenance_finalize.sql.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $v216_zalo_server_schedule_maintenance_finalize$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_account_id bigint;
  v_campaign_id bigint;
  v_input_data_id bigint;
  v_reopened_input_data_id bigint;
  v_action_id text;
  v_data_group_action_id text;
  v_group_id bigint;
  v_data_group_campaign_id bigint;
  v_data_group_input_id bigint;
  v_source_id bigint;
  v_data_group_result jsonb;
  v_source_status text;
  v_input_status text;
  v_mode_revision text;
  v_result record;
  v_status text;
  v_note text;
  v_wrong_revision_rejected boolean := false;
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v216_smoke: Zalo Server maintenance finalizer RPC is missing';
  END IF;

  SELECT staff.id, staff.organization_id, mode.mode_revision
  INTO v_staff_id, v_organization_id, v_mode_revision
  FROM public.org_staff AS staff
  CROSS JOIN LATERAL public.resolve_organization_zalo_runtime_mode(
    staff.organization_id
  ) AS mode
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
    AND COALESCE(mode.qr_enabled, false)
    AND NOT COALESCE(mode.web_enabled, false)
    AND COALESCE(mode.is_zalo_server, false)
    AND NULLIF(btrim(COALESCE(mode.mode_revision, '')), '') IS NOT NULL
  ORDER BY staff.id
  LIMIT 1;

  SELECT action.id
  INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.id = 'zalo_message_birthday'
    AND COALESCE(action.is_delete, false) = false
  LIMIT 1;

  SELECT action.id
  INTO v_data_group_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.id = 'zalo_message_phone'
    AND COALESCE(action.is_delete, false) = false
  LIMIT 1;

  IF v_staff_id IS NULL OR v_action_id IS NULL THEN
    RAISE NOTICE 'v216_smoke: active QR Server staff or birthday action missing; behavioral fixture skipped';
    RETURN;
  END IF;

  -- Serialize only concurrent smoke runs. Explicit high positive IDs keep every
  -- public sequence unchanged even though PostgreSQL sequences do not roll
  -- back with the surrounding transaction.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('aka-agent-v216-smoke-fixture', 0)
  );
  v_account_id := 8800216000000001;
  v_campaign_id := 8800216000000002;
  v_data_group_campaign_id := 8800216000000003;
  v_input_data_id := 8800216000000004;
  v_reopened_input_data_id := 8800216000000005;
  v_data_group_input_id := 8800216000000006;
  v_group_id := 8800216000000007;
  v_source_id := 8800216000000008;

  IF EXISTS (
    SELECT 1 FROM public.auto_accounts WHERE id = v_account_id
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaigns
    WHERE id IN (v_campaign_id, v_data_group_campaign_id)
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data
    WHERE id IN (v_input_data_id, v_reopened_input_data_id, v_data_group_input_id)
  ) OR EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups WHERE id = v_group_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaign_data_group_sources WHERE id = v_source_id
  ) THEN
    RAISE EXCEPTION 'v216_smoke: reserved fixture ID collision';
  END IF;

  UPDATE public.auto_email_notification_settings
  SET is_enabled = false
  WHERE staff_id = v_staff_id;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_account_id, '__v216_qr__', 'zalo', false, 'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, schedule_type,
    data_target_source_mode,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_campaign_id, '__v216_completed_stale_birthday__', v_action_id, v_account_id,
    'hoàn thành', '',
    now() - interval '10 days', now() - interval '10 days', 'daily',
    'direct',
    v_staff_id, v_organization_id, false
  );

  -- Exact #1816 regression: an already-completed stale birthday campaign is
  -- a Server-authorized no-op and must not need desktop credentials.
  SELECT * INTO v_result
  FROM public.aka_agent_finalize_zalo_server_maintenance_campaign(
    v_staff_id,
    v_organization_id,
    v_mode_revision,
    v_campaign_id,
    'must remain completed',
    true
  );

  SELECT status, note INTO v_status, v_note
  FROM public.auto_campaigns
  WHERE id = v_campaign_id;

  IF NOT COALESCE(v_result.completed, false)
    OR v_result.reason IS DISTINCT FROM 'campaign_control_won'
    OR v_result.pending_input_count IS DISTINCT FROM 0::bigint
    OR v_status IS DISTINCT FROM 'hoàn thành'
    OR v_note IS NOT NULL
  THEN
    RAISE EXCEPTION 'v216_smoke: completed stale birthday campaign was not a safe no-op';
  END IF;

  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý'
  WHERE id = v_campaign_id;

  INSERT INTO public.auto_campaign_input_data (
    id,
    campaign_id,
    status,
    is_delete
  ) VALUES (
    v_input_data_id,
    v_campaign_id,
    'chờ xử lý',
    false
  );

  SELECT * INTO v_result
  FROM public.aka_agent_finalize_zalo_server_maintenance_campaign(
    v_staff_id,
    v_organization_id,
    v_mode_revision,
    v_campaign_id,
    'must wait',
    true
  );

  SELECT status INTO v_status
  FROM public.auto_campaigns
  WHERE id = v_campaign_id;

  IF COALESCE(v_result.completed, false)
    OR v_result.reason IS DISTINCT FROM 'pending_input_remaining'
    OR v_result.pending_input_count IS DISTINCT FROM 1::bigint
    OR v_status IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v216_smoke: pending input did not prevent Server maintenance completion';
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'hoàn thành'
  WHERE id = v_input_data_id;

  SELECT * INTO v_result
  FROM public.aka_agent_finalize_zalo_server_maintenance_campaign(
    v_staff_id,
    v_organization_id,
    v_mode_revision,
    v_campaign_id,
    'completed by maintenance',
    true
  );

  SELECT status, note INTO v_status, v_note
  FROM public.auto_campaigns
  WHERE id = v_campaign_id;

  IF NOT COALESCE(v_result.completed, false)
    OR v_result.reason IS DISTINCT FROM 'completed'
    OR v_result.pending_input_count IS DISTINCT FROM 0::bigint
    OR v_status IS DISTINCT FROM 'hoàn thành'
    OR v_note IS DISTINCT FROM 'Chiến dịch chúc mừng sinh nhật không chạy bù qua ngày'
  THEN
    RAISE EXCEPTION 'v216_smoke: drained Server maintenance campaign did not complete';
  END IF;

  -- Preserve the v214 producer/finalizer race guard: newly-arrived input must
  -- reopen a completed snapshot.
  INSERT INTO public.auto_campaign_input_data (
    id,
    campaign_id,
    status,
    is_delete
  ) VALUES (
    v_reopened_input_data_id,
    v_campaign_id,
    'chờ xử lý',
    false
  );

  SELECT * INTO v_result
  FROM public.aka_agent_finalize_zalo_server_maintenance_campaign(
    v_staff_id,
    v_organization_id,
    v_mode_revision,
    v_campaign_id,
    'must reopen',
    true
  );

  SELECT status, note INTO v_status, v_note
  FROM public.auto_campaigns
  WHERE id = v_campaign_id;

  IF COALESCE(v_result.completed, false)
    OR v_result.reason IS DISTINCT FROM 'pending_input_remaining'
    OR v_result.pending_input_count IS DISTINCT FROM 1::bigint
    OR v_status IS DISTINCT FROM 'chờ xử lý'
    OR v_note IS NOT NULL
  THEN
    RAISE EXCEPTION 'v216_smoke: pending input did not reopen completed Server campaign';
  END IF;

  BEGIN
    PERFORM public.aka_agent_finalize_zalo_server_maintenance_campaign(
      v_staff_id,
      v_organization_id,
      v_mode_revision || ':stale',
      v_campaign_id,
      NULL,
      false
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%zalo_server_runtime_not_owner%' THEN
        v_wrong_revision_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;

  IF NOT v_wrong_revision_rejected THEN
    RAISE EXCEPTION 'v216_smoke: stale Server mode revision was accepted';
  END IF;

  -- The public revision is a CAS boundary, not a secret. Prove that the RPC
  -- rejects a stale campaign whose next valid occurrence is still inside its
  -- configured end date, then derives the hard-end note itself once eligible.
  IF v_data_group_action_id IS NOT NULL THEN
    UPDATE public.auto_campaign_input_data
    SET status = 'hoàn thành'
    WHERE id = v_reopened_input_data_id;

    UPDATE public.auto_campaigns
    SET action_id = v_data_group_action_id,
        status = 'chờ xử lý',
        note = NULL,
        schedule_end_date = now() + interval '10 days'
    WHERE id = v_campaign_id;

    SELECT * INTO v_result
    FROM public.aka_agent_finalize_zalo_server_maintenance_campaign(
      v_staff_id,
      v_organization_id,
      v_mode_revision,
      v_campaign_id,
      'caller-controlled note must be ignored',
      true
    );

    SELECT status, note INTO v_status, v_note
    FROM public.auto_campaigns
    WHERE id = v_campaign_id;

    IF COALESCE(v_result.completed, false)
      OR v_result.reason IS DISTINCT FROM 'not_found'
      OR v_status IS DISTINCT FROM 'chờ xử lý'
      OR v_note IS NOT NULL
    THEN
      RAISE EXCEPTION 'v216_smoke: non-maintenance campaign passed the narrow Server RPC';
    END IF;

    UPDATE public.auto_campaigns
    SET schedule_end_date = now() - interval '1 day'
    WHERE id = v_campaign_id;

    SELECT * INTO v_result
    FROM public.aka_agent_finalize_zalo_server_maintenance_campaign(
      v_staff_id,
      v_organization_id,
      v_mode_revision,
      v_campaign_id,
      'caller-controlled note must still be ignored',
      true
    );

    SELECT status, note INTO v_status, v_note
    FROM public.auto_campaigns
    WHERE id = v_campaign_id;

    IF NOT COALESCE(v_result.completed, false)
      OR v_result.reason IS DISTINCT FROM 'completed'
      OR v_status IS DISTINCT FROM 'hoàn thành'
      OR v_note IS DISTINCT FROM 'Chiến dịch đã hết ngày kết thúc'
    THEN
      RAISE EXCEPTION 'v216_smoke: exact schedule-end maintenance candidate was not finalized safely';
    END IF;
  END IF;

  -- The TypeScript maintenance route also forwards the Server context to the
  -- existing v196 Data Group wrapper. Exercise that wrapper with a hard-ended
  -- source so it cannot regress back to desktop identityParams().
  IF v_data_group_action_id IS NULL THEN
    RAISE NOTICE 'v216_smoke: Zalo phone-message action missing; Data Group fixture skipped';
  ELSE
    INSERT INTO public.auto_account_contact_groups (
      id, account_id, contact_type, name, purpose, is_delete,
      staff_id, organization_id
    ) VALUES (
      v_group_id, NULL, NULL, '__v216_data_group__', 'data_group', false,
      v_staff_id, v_organization_id
    );

    INSERT INTO public.auto_campaigns (
      id, name, action_id, account_id, status, content,
      schedule, original_schedule, schedule_type, schedule_end_date,
      data_target_source_mode, data_group_id,
      staff_id, organization_id, is_delete
    ) OVERRIDING SYSTEM VALUE VALUES (
      v_data_group_campaign_id,
      '__v216_server_data_group_hard_end__',
      v_data_group_action_id,
      v_account_id,
      'chờ xử lý',
      '',
      now() - interval '2 days',
      now() - interval '2 days',
      'daily',
      now() - interval '1 day',
      'data_group',
      v_group_id,
      v_staff_id,
      v_organization_id,
      false
    );

    INSERT INTO public.auto_campaign_data_group_sources (
      id, campaign_id, group_id, baseline_revision, status,
      staff_id, organization_id
    ) VALUES (
      v_source_id, v_data_group_campaign_id, v_group_id, 0, 'active',
      v_staff_id, v_organization_id
    );

    INSERT INTO public.auto_campaign_input_data (
      id,
      campaign_id,
      status,
      is_delete
    ) VALUES (
      v_data_group_input_id,
      v_data_group_campaign_id,
      'chờ xử lý',
      false
    );

    SELECT public.aka_agent_finalize_zalo_server_data_group_campaign(
      v_staff_id,
      v_organization_id,
      v_mode_revision,
      v_data_group_campaign_id,
      'Data Group đã hết ngày kết thúc'
    ) INTO v_data_group_result;

    SELECT status INTO v_status
    FROM public.auto_campaigns
    WHERE id = v_data_group_campaign_id;
    SELECT status INTO v_source_status
    FROM public.auto_campaign_data_group_sources
    WHERE campaign_id = v_data_group_campaign_id;
    SELECT status INTO v_input_status
    FROM public.auto_campaign_input_data
    WHERE id = v_data_group_input_id;

    IF COALESCE((v_data_group_result ->> 'completed')::boolean, false) IS NOT true
      OR v_status IS DISTINCT FROM 'hoàn thành'
      OR v_source_status IS DISTINCT FROM 'stopped'
      OR v_input_status IS DISTINCT FROM 'hoàn thành'
    THEN
      RAISE EXCEPTION 'v216_smoke: Server Data Group hard-end finalization did not settle atomically';
    END IF;
  END IF;
END;
$v216_zalo_server_schedule_maintenance_finalize$;

ROLLBACK;

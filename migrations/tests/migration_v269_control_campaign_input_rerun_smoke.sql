-- No campaign/account/input fixture is committed or visible to a worker.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $smoke$
DECLARE
  v_staff bigint; v_org bigint; v_account bigint; v_campaign bigint;
  v_pending bigint; v_paused bigint; v_completed bigint; v_running bigint; v_deleted bigint;
  v_result jsonb;
BEGIN
  IF md5(pg_get_functiondef('public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)'::regprocedure))
    <> 'a98a23f8e7f2e1e6582449f7ed45fb45' THEN RAISE EXCEPTION 'v269 smoke: target mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)'::regprocedure
    AND proowner::regrole::text = 'postgres' AND prosecdef AND provolatile = 'v'
    AND proconfig = ARRAY['search_path=pg_catalog, public']
    AND proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'v269 smoke: attributes changed'; END IF;

  SELECT id, organization_id INTO v_staff, v_org FROM public.org_staff WHERE is_active AND organization_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'v269 smoke: no fixture tenant'; END IF;
  INSERT INTO public.auto_accounts(name, flatform_type, is_zalo_show_web, is_zalo_server, status, is_active, staff_id, organization_id, is_delete)
    VALUES ('__v269_rollback_only__', 'zalo', false, true, 'tạm dừng', false, v_staff, v_org, false) RETURNING id INTO v_account;
  INSERT INTO public.auto_campaigns(name, action_id, account_id, status, content, schedule, original_schedule, data_target_source_mode, provisioning_state, staff_id, organization_id, is_delete)
    VALUES ('__v269_rollback_only__', 'zalo_message_phone', v_account, 'hoàn thành', '', now() + interval '100 years', now() + interval '100 years', 'direct', 'ready', v_staff, v_org, false) RETURNING id INTO v_campaign;
  INSERT INTO public.auto_campaign_input_data(campaign_id, name, status, note, is_delete) VALUES (v_campaign, 'pending', 'chờ xử lý', 'keep', false) RETURNING id INTO v_pending;
  INSERT INTO public.auto_campaign_input_data(campaign_id, name, status, note, is_delete) VALUES (v_campaign, 'paused', 'tạm dừng', 'keep', false) RETURNING id INTO v_paused;
  INSERT INTO public.auto_campaign_input_data(campaign_id, name, status, note, is_delete) VALUES (v_campaign, 'completed', 'hoàn thành', 'keep', false) RETURNING id INTO v_completed;
  INSERT INTO public.auto_campaign_input_data(campaign_id, name, status, note, is_delete) VALUES (v_campaign, 'running', 'đang chạy', 'keep', false) RETURNING id INTO v_running;
  INSERT INTO public.auto_campaign_input_data(campaign_id, name, status, note, is_delete) VALUES (v_campaign, 'deleted', 'hoàn thành', 'keep', true) RETURNING id INTO v_deleted;

  v_result := public.update_control_campaign_input_statuses_atomic(v_staff, v_org, v_campaign, ARRAY[v_pending,v_paused,v_completed,v_completed,v_running,v_deleted], 'chờ xử lý');
  IF v_result->>'updated_count' <> '2' THEN RAISE EXCEPTION 'v269 smoke: rerun count %', v_result; END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id=v_campaign) <> 'hoàn thành'
    OR (SELECT status FROM public.auto_accounts WHERE id=v_account) <> 'tạm dừng'
    OR (SELECT status FROM public.auto_campaign_input_data WHERE id=v_running) <> 'đang chạy'
    OR (SELECT status FROM public.auto_campaign_input_data WHERE id=v_deleted) <> 'hoàn thành'
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE campaign_id=v_campaign AND note <> 'keep')
    THEN RAISE EXCEPTION 'v269 smoke: unrelated runtime state changed'; END IF;
  v_result := public.update_control_campaign_input_statuses_atomic(v_staff, v_org, v_campaign, ARRAY[v_pending,v_paused,v_completed,v_running], 'tạm dừng');
  IF v_result->>'updated_count' <> '3' THEN RAISE EXCEPTION 'v269 smoke: pause count %', v_result; END IF;
  v_result := public.update_control_campaign_input_statuses_atomic(v_staff, v_org + 1, v_campaign, ARRAY[v_completed], 'chờ xử lý');
  IF v_result->>'reason' <> 'campaign_not_found' THEN RAISE EXCEPTION 'v269 smoke: tenant bypass %', v_result; END IF;
  INSERT INTO public.auto_accounts(name, flatform_type, is_zalo_show_web, is_zalo_server, status, is_active, staff_id, organization_id, is_delete)
    VALUES ('__v269_local_rollback_only__', 'zalo', false, false, 'tạm dừng', false, v_staff, v_org, false) RETURNING id INTO v_account;
  INSERT INTO public.auto_campaigns(name, action_id, account_id, status, content, schedule, original_schedule, data_target_source_mode, provisioning_state, staff_id, organization_id, is_delete)
    VALUES ('__v269_local_rollback_only__', 'zalo_message_phone', v_account, 'tạm dừng', '', now() + interval '100 years', now() + interval '100 years', 'direct', 'ready', v_staff, v_org, false) RETURNING id INTO v_campaign;
  v_result := public.update_control_campaign_input_statuses_atomic(v_staff, v_org, v_campaign, ARRAY[v_completed], 'chờ xử lý');
  IF v_result->>'reason' <> 'account_not_server' THEN RAISE EXCEPTION 'v269 smoke: desktop ownership bypass %', v_result; END IF;
  -- SMS uses the same input-status contract and does not depend on Zalo ownership.
  INSERT INTO public.auto_accounts(name, flatform_type, status, is_active, staff_id, organization_id, is_delete)
    VALUES ('__v269_sms_rollback_only__', 'sms', 'tạm dừng', false, v_staff, v_org, false) RETURNING id INTO v_account;
  INSERT INTO public.auto_campaigns(name, action_id, account_id, status, content, schedule, original_schedule, data_target_source_mode, provisioning_state, staff_id, organization_id, is_delete)
    VALUES ('__v269_sms_rollback_only__', 'sms_send', v_account, 'tạm dừng', '', now() + interval '100 years', now() + interval '100 years', 'direct', 'ready', v_staff, v_org, false) RETURNING id INTO v_campaign;
  INSERT INTO public.auto_campaign_input_data(campaign_id, name, status, note, is_delete) VALUES (v_campaign, 'completed', 'hoàn thành', 'keep', false) RETURNING id INTO v_completed;
  v_result := public.update_control_campaign_input_statuses_atomic(v_staff, v_org, v_campaign, ARRAY[v_completed], 'chờ xử lý');
  IF v_result->>'updated_count' <> '1' THEN RAISE EXCEPTION 'v269 smoke: SMS rerun failed %', v_result; END IF;
END;
$smoke$;
ROLLBACK;

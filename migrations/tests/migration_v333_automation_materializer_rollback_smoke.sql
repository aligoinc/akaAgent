-- Diagnostic fixture: akabiz001 / rule 83 / execution 777. Always ROLLBACK.
-- Before apply, concatenate the migration without its final COMMIT with this
-- file after removing this file's BEGIN. Never commit this diagnostic fixture.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
SET LOCAL plpgsql.check_asserts = on;
SET LOCAL request.jwt.claim.role = 'service_role';
SET LOCAL ROLE service_role;

DO $smoke$
DECLARE
  v_execution public.auto_automation_detail%ROWTYPE;
  v_result jsonb;
  v_input_id bigint;
  v_payload jsonb;
  v_original_schedule timestamptz;
  v_worker constant text := 'v333-rollback-smoke';
BEGIN
  ASSERT md5(pg_get_functiondef(to_regprocedure(
    'public.materialize_auto_automation_detail_v201_campaign_internal(bigint,bigint,bigint,text,jsonb,text,text)'
  ))) = '065b56a4fb9319f1d394a7c8b526ebc2', 'apply reviewed patch inside this transaction first';

  -- Lock in the same order as the public RPC; do not race a live worker.
  PERFORM 1 FROM public.auto_automation
  WHERE id = 83 AND staff_id = 2 AND organization_id = 1 FOR UPDATE;
  ASSERT FOUND, 'reported automation is missing';
  SELECT * INTO v_execution FROM public.auto_automation_detail
  WHERE id = 777 AND automation_id = 83 AND staff_id = 2 AND organization_id = 1 FOR UPDATE;
  ASSERT FOUND AND v_execution.status = 'lỗi' AND v_execution.attempt_count = 5
    AND v_execution.target_input_data_id IS NULL
    AND v_execution.target_campaign_id = 20120
    AND v_execution.last_error = 'function public.materialize_auto_automation_detail_v174_internal(bigint, bigint, bigint, text, jsonb, text, text) does not exist',
    'reported execution changed; inspect before testing';
  PERFORM public.aka_agent_lock_campaign_input_serialization(20120);
  SELECT original_schedule INTO v_original_schedule FROM public.auto_campaigns
  WHERE id = 20120 AND staff_id = 2 AND organization_id = 1
    AND status = 'chờ xử lý' AND NOT is_delete FOR UPDATE;
  ASSERT FOUND, 'target is no longer idle';
  ASSERT NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE auto_automation_detail_id = 777);

  v_payload := jsonb_build_object('phone', v_execution.data_value, 'contactUid', v_execution.data_value);

  -- A terminal row remains terminal; a cross-tenant lookup is not claimed.
  v_result := public.materialize_auto_automation_detail(2, 1, 777, v_worker, v_payload);
  ASSERT v_result ->> 'result' = 'failed', v_result::text;
  v_result := public.materialize_auto_automation_detail(2, 0, 777, v_worker, v_payload);
  ASSERT v_result ->> 'result' = 'not_claimed', v_result::text;

  UPDATE public.auto_automation_detail
  SET status = 'đang xử lý', locked_by = v_worker, locked_at = clock_timestamp()
  WHERE id = 777;
  v_result := public.materialize_auto_automation_detail(2, 1, 777, 'another-worker', v_payload);
  ASSERT v_result ->> 'result' = 'not_claimed', v_result::text;

  -- Running targets still defer before insertion.
  UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = 20120;
  v_result := public.materialize_auto_automation_detail(2, 1, 777, v_worker, v_payload);
  ASSERT v_result ->> 'result' = 'target_running', v_result::text;
  ASSERT NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE auto_automation_detail_id = 777);

  UPDATE public.auto_campaigns SET status = 'chờ xử lý' WHERE id = 20120;
  v_result := public.materialize_auto_automation_detail(2, 1, 777, v_worker, v_payload);
  ASSERT v_result ->> 'result' = 'materialized', v_result::text;
  v_input_id := (v_result ->> 'target_input_data_id')::bigint;
  ASSERT v_input_id IS NOT NULL;
  ASSERT EXISTS (SELECT 1 FROM public.auto_campaign_input_data
    WHERE id = v_input_id AND campaign_id = 20120 AND schedule = v_execution.scheduled_at);
  ASSERT EXISTS (SELECT 1 FROM public.auto_automation_detail
    WHERE id = 777 AND status = 'đã thêm' AND target_input_data_id = v_input_id
      AND locked_by IS NULL AND last_error IS NULL);
  ASSERT v_original_schedule IS NOT DISTINCT FROM (
    SELECT original_schedule FROM public.auto_campaigns WHERE id = 20120);

  v_result := public.materialize_auto_automation_detail(2, 1, 777, v_worker, v_payload);
  ASSERT v_result ->> 'result' = 'already_materialized'
    AND (v_result ->> 'target_input_data_id')::bigint = v_input_id, v_result::text;
  ASSERT (SELECT count(*) FROM public.auto_campaign_input_data WHERE auto_automation_detail_id = 777) <= 1;

  -- Public callers still need process credentials; internal functions stay private.
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  BEGIN
    PERFORM public.materialize_auto_automation_detail(2, 1, 777, v_worker, v_payload);
    RAISE EXCEPTION 'missing credentials were accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'automation_auth_required' THEN RAISE; END IF;
  END;
  ASSERT NOT has_function_privilege('anon',
    'public.materialize_auto_automation_detail_v201_campaign_internal(bigint,bigint,bigint,text,jsonb,text,text)', 'EXECUTE');
END;
$smoke$;
RESET ROLE;
SELECT 'v333 materialization/tenant/claim/running-target/schedule/idempotency/auth smoke passed; rollback follows' AS result;
ROLLBACK;

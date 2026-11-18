-- rollback_v576_engine_orphan_runs: gỡ V576, trả close_stale_v1 và reset_desktop_running_statuses_no_retry về bản đọc 18/11, xoá hai hàm mới.
-- Sinh bằng scripts/build-v576-sql.cjs, không sửa tay. Tạo / thay hàm nên PostgREST nạp lại schema: chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)')));
  IF v_md5 IS DISTINCT FROM '8ed4775297c061bc35cbc6f0944dc905' THEN RAISE EXCEPTION 'gỡ V576: close_stale_v1 không phải bản V576 (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)')));
  IF v_md5 IS DISTINCT FROM '24cb4850f4a91819ef8b37eeb3b7f8c5' THEN RAISE EXCEPTION 'gỡ V576: hàm reset Desktop không phải bản V576 (md5 %)', v_md5; END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_stale_v1(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_stale interval := make_interval(mins => greatest(1, public.aka_agent_engine_setting('engine.stale_target_minutes', '10')::integer));
  v_unsent text := public.aka_agent_engine_setting('engine.stale_unsent_target_action', 'complete');
  rr public.auto_engine_target_runs%ROWTYPE;
  v_marked boolean;
  v_code text;
  v_msg text;
  v_status text;
  v_closed integer := 0;
  v_released integer := 0;
  v_lease record;
BEGIN
  FOR rr IN
    SELECT tr.* FROM public.auto_engine_target_runs tr
     WHERE tr.completed_at IS NULL AND tr.started_at < v_now - v_stale
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases l
                        WHERE l.account_id = tr.account_id AND l.lease_token = tr.lease_token AND l.expires_at > v_now - v_stale)
     ORDER BY tr.id LIMIT greatest(1, p_limit)
     FOR UPDATE SKIP LOCKED
  LOOP
    v_marked := EXISTS (SELECT 1 FROM jsonb_array_elements(rr.marks) m WHERE m.value->>'state' IN ('pending', 'delivered', 'partial', 'unknown'))
             OR EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = rr.id AND eo.delivery_state IN ('delivered', 'partial', 'unknown'));
    IF v_marked THEN
      v_code := 'err_engine_interrupted_while_sending'; v_status := 'hoàn thành';
    -- V515 (C): 'requeue_unstarted' chỉ trả về hàng đợi lượt data chưa có kết quả nào, tức bộ chạy chưa làm gì với data (mất câu trả
    -- lời của claim, chết khi đang tra số). Lượt đã có kết quả (ví dụ nhắn bị từ chối rồi đã kiêm SMS) thì đóng như 'complete': chạy lại
    -- sẽ lặp các việc sau kết quả đó (kiêm SMS không lọc trùng). 'requeue' giữ nghĩa cũ: mọi lượt chưa có dấu "sắp gửi".
    ELSIF v_unsent = 'requeue'
       OR (v_unsent = 'requeue_unstarted' AND NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = rr.id)) THEN
      v_code := 'err_engine_interrupted_before_send'; v_status := 'chờ xử lý';
    ELSE
      v_code := 'err_engine_interrupted_before_send'; v_status := 'hoàn thành';
    END IF;
    SELECT coalesce(e.customer_title, e.error_name) || CASE WHEN e.public_code IS NOT NULL THEN ' (' || e.public_code || ')' ELSE '' END
      INTO v_msg FROM public.auto_error e WHERE e.error_code = v_code;
    -- Bộ cũ đã nhận lại chiến dịch (cập nhật app ngược, tắt cờ): không đụng data, chỉ đóng sổ lượt của bộ mới.
    UPDATE public.auto_campaign_input_data SET status = v_status, note = coalesce(v_msg, note), date_action = v_now
     WHERE id = rr.input_data_id AND status = 'đang chạy'
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.id = rr.campaign_id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL));
    INSERT INTO public.auto_engine_target_events (input_data_id, campaign_id, target_run_id, kind, error_code, message, data)
    VALUES (rr.input_data_id, rr.campaign_id, rr.id, 'interrupted', v_code, coalesce(v_msg, v_code),
            jsonb_build_object('marked', v_marked, 'runnerId', rr.runner_id, 'leaseToken', rr.lease_token));
    UPDATE public.auto_engine_target_runs SET completed_at = v_now, final_target_status = v_status, final_error_code = v_code, close_reason = 'stale'
     WHERE id = rr.id;
    v_closed := v_closed + 1;
  END LOOP;

  FOR v_lease IN
    SELECT l.account_id, l.campaign_id, l.lease_token FROM public.auto_engine_leases l
     WHERE l.expires_at < v_now - v_stale
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = l.account_id AND tr.lease_token = l.lease_token AND tr.completed_at IS NULL)
     ORDER BY l.expires_at LIMIT greatest(1, p_limit)
     FOR UPDATE SKIP LOCKED
  LOOP
    DELETE FROM public.auto_engine_leases WHERE account_id = v_lease.account_id AND lease_token = v_lease.lease_token;
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = v_lease.campaign_id AND status = 'đang chạy' AND runtime_claim_token IS NULL AND runtime_unit_token IS NULL;
    UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = v_lease.account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = auto_accounts.id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL));
    v_released := v_released + 1;
  END LOOP;
  RETURN jsonb_build_object('closedTargets', v_closed, 'releasedLeases', v_released);
END $function$;

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

DROP FUNCTION public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean);
DROP FUNCTION public.aka_agent_engine_close_run_v1(bigint,text);

DO $post$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)')));
  IF v_md5 IS DISTINCT FROM '1208cfa12d71eda90df525f1a8727bef' THEN RAISE EXCEPTION 'gỡ V576: close_stale_v1 khác bản cũ (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)')));
  IF v_md5 IS DISTINCT FROM '6803509057e6ec91b349c9543757f3d3' THEN RAISE EXCEPTION 'gỡ V576: hàm reset Desktop khác bản cũ (md5 %)', v_md5; END IF;
END $post$;

COMMIT;

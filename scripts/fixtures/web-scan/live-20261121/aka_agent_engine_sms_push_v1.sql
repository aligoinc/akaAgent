CREATE OR REPLACE FUNCTION public.aka_agent_engine_sms_push_v1(p_target_run_id bigint, p_lease_token uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
-- Kiêm gửi SMS nội bộ của engine v2, như pushZaloDetailToInternalSmsIfNeeded của Desktop: với từng tài khoản SMS đã chọn, lấy chiến dịch SMS
-- con theo bản đồ internalSmsCreatedCampaignIdsByAccount (mở lại nếu đã hoàn thành) hoặc tạo mới như createCampaign, thêm một data
-- (createSmsCampaignInputDataSnapshot) rồi mở lại nếu đã hoàn thành (reopenCompletedCampaignAfterInputInsert). Mỗi tài khoản một giao dịch
-- con: lỗi của tài khoản này không làm mất tài khoản khác. Lõi quyết định khi nào đẩy và dựng nội dung. Xác thực bằng lease của lượt data
-- (lượt có thể vừa đóng vì bước cuối của data vừa báo).
DECLARE
  v_now timestamptz := clock_timestamp();
  r public.auto_engine_target_runs%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  v_row jsonb := coalesce(p_payload->'row', '{}'::jsonb);
  v_phone text := nullif(btrim(coalesce(p_payload->'row'->>'phone', '')), '');
  v_allowed bigint[];
  v_account_id bigint;
  v_extra jsonb;
  v_mapping jsonb;
  v_child_id bigint;
  v_child_status text;
  v_sms_name text;
  v_err text;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF p_target_run_id IS NULL OR p_lease_token IS NULL OR jsonb_typeof(p_payload->'accountIds') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_row) IS DISTINCT FROM 'object' OR v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id;
  IF NOT FOUND OR r.lease_token IS DISTINCT FROM p_lease_token OR NOT EXISTS (
       SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost');
  END IF;
  -- Khoá chiến dịch nguồn: bản đồ chiến dịch SMS con đổi trong giao dịch này.
  SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id AND NOT coalesce(is_delete, false) FOR UPDATE;
  IF NOT FOUND OR NOT public.aka_agent_engine_scope_ok(c.staff_id) THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  IF c.action_id NOT IN ('zalo_message_phone', 'zalo_message_group_member') OR c.extra_settings->'internalSmsEnabled' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_enabled');
  END IF;
  -- Chỉ tài khoản SMS chiến dịch đã chọn (getInternalSmsAccountIds: số dương).
  SELECT coalesce(array_agg(DISTINCT floor(x::numeric)::bigint), '{}'::bigint[]) INTO v_allowed
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.extra_settings->'internalSmsAccountIds') = 'array'
                                        THEN c.extra_settings->'internalSmsAccountIds' ELSE '[]'::jsonb END) x
   WHERE x ~ '^[0-9]+(\.[0-9]+)?$' AND x::numeric > 0;

  FOR v_account_id IN SELECT DISTINCT x::bigint FROM jsonb_array_elements_text(p_payload->'accountIds') x WHERE x ~ '^[0-9]{1,18}$' LOOP
    BEGIN
      IF NOT (v_account_id = ANY (v_allowed)) THEN
        RAISE EXCEPTION 'Tài khoản Sms #% không có trong cấu hình kiêm SMS của chiến dịch.', v_account_id;
      END IF;
      SELECT coalesce(nullif(a.name, ''), nullif(a.username, ''), 'Sms #' || a.id) INTO v_sms_name FROM public.auto_accounts a
       WHERE a.id = v_account_id AND NOT coalesce(a.is_delete, false) AND a.flatform_type = 'sms'
         AND a.staff_id = c.staff_id AND a.organization_id IS NOT DISTINCT FROM c.organization_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Tài khoản Sms #% không tồn tại hoặc không hợp lệ.', v_account_id; END IF;
      -- Bản đồ đọc lại mỗi tài khoản (dòng đã khoá): lần trước có thể vừa thêm chiến dịch con.
      SELECT coalesce(x.extra_settings, '{}'::jsonb) INTO v_extra FROM public.auto_campaigns x WHERE x.id = c.id;
      v_mapping := CASE WHEN jsonb_typeof(v_extra->'internalSmsCreatedCampaignIdsByAccount') = 'object'
                        THEN v_extra->'internalSmsCreatedCampaignIdsByAccount' ELSE '{}'::jsonb END;
      v_child_id := NULL;
      -- isUsableInternalSmsChildCampaign: còn, là SMS, đúng tài khoản, nguồn trống hoặc là chiến dịch này.
      IF coalesce(v_mapping->>(v_account_id::text), '') ~ '^[0-9]{1,18}$' THEN
        SELECT x.id, x.status INTO v_child_id, v_child_status FROM public.auto_campaigns x
         WHERE x.id = (v_mapping->>(v_account_id::text))::bigint AND NOT coalesce(x.is_delete, false) AND x.action_id = 'sms_send'
           AND x.account_id = v_account_id
           AND (coalesce(x.extra_settings->>'internalSmsSourceCampaignId', '') !~ '^[0-9]+(\.[0-9]+)?$'
                OR (x.extra_settings->>'internalSmsSourceCampaignId')::numeric = c.id)
         FOR UPDATE;
        IF v_child_id IS NOT NULL AND v_child_status = 'hoàn thành' THEN
          UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, updated_at = v_now WHERE id = v_child_id;
        END IF;
      END IF;
      IF v_child_id IS NULL THEN
        -- Như createCampaign của Desktop cho chiến dịch SMS (lịch hằng ngày, chạy tiếp hôm sau, làm mới data).
        INSERT INTO public.auto_campaigns (name, action_id, account_id, secondary_account_id, status, schedule, original_schedule, schedule_type,
          schedule_end_date, daily_stop_time, schedule_days, schedule_week_days, continue_next_day, refresh_data, content, extra_settings, images,
          log, note, data_target_source_mode, data_group_id, provisioning_state, creation_bundle_id, creation_bundle_child_index, staff_id,
          organization_id)
        VALUES ('Kiêm SMS - ' || coalesce(c.name, '') || ' - ' || v_sms_name, 'sms_send', v_account_id, NULL, 'chờ xử lý', v_now, v_now, 'daily',
          NULL, NULL, NULL, NULL, true, true, coalesce(c.extra_settings->>'internalSmsContent', ''),
          jsonb_build_object('internalSmsSourceCampaignId', c.id, 'internalSmsSourceCampaignName', c.name, 'internalSmsSourceActionId', c.action_id),
          '[]'::jsonb, '', NULL, 'direct', NULL, 'ready', NULL, NULL, c.staff_id, c.organization_id)
        RETURNING id INTO v_child_id;
        UPDATE public.auto_campaigns
           SET extra_settings = v_extra || jsonb_build_object('internalSmsCreatedCampaignIdsByAccount',
                 v_mapping || jsonb_build_object(v_account_id::text, v_child_id)), updated_at = v_now
         WHERE id = c.id;
      END IF;
      INSERT INTO public.auto_campaign_input_data (campaign_id, name, phone, phone_carrier, uid, email, info1, info2, info3, info4, info5, content,
        status, note, schedule)
      VALUES (v_child_id, nullif(v_row->>'name', ''), v_phone, nullif(v_row->>'phoneCarrier', ''), nullif(v_row->>'uid', ''),
        nullif(v_row->>'email', ''), nullif(v_row->>'info1', ''), nullif(v_row->>'info2', ''), nullif(v_row->>'info3', ''),
        nullif(v_row->>'info4', ''), nullif(v_row->>'info5', ''), p_payload->>'content', 'chờ xử lý', NULL, v_now);
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, completed_at = NULL, updated_at = v_now
       WHERE id = v_child_id AND action_id = 'sms_send' AND NOT coalesce(is_delete, false) AND status = 'hoàn thành';
      v_results := v_results || jsonb_build_array(jsonb_build_object('accountId', v_account_id, 'ok', true, 'campaignId', v_child_id));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_results := v_results || jsonb_build_array(jsonb_build_object('accountId', v_account_id, 'ok', false, 'error', v_err));
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'results', v_results);
END $function$

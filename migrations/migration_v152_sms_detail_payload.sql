CREATE OR REPLACE FUNCTION public.aka_agent_record_sms_message_status(
  p_input_data_id bigint,
  p_account_id bigint,
  p_detail_status text,
  p_log text DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_note text DEFAULT NULL
)
RETURNS TABLE (
  input_data_id bigint,
  campaign_id bigint,
  detail_id bigint,
  detail_status text,
  counted boolean,
  input_updated boolean,
  accepted boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_input record;
  v_existing record;
  v_detail_id bigint := NULL;
  v_final_status text := p_detail_status;
  v_counted boolean := false;
  v_input_updated boolean := false;
  v_note text := p_note;
  v_existing_found boolean := false;
  v_detail_data jsonb := '{}'::jsonb;
BEGIN
  IF p_input_data_id IS NULL OR p_account_id IS NULL THEN
    RETURN QUERY SELECT
      p_input_data_id,
      NULL::bigint,
      NULL::bigint,
      NULL::text,
      false,
      false,
      false,
      'input_data_id/account_id không hợp lệ';
    RETURN;
  END IF;

  IF p_detail_status NOT IN ('đã gửi', 'đã nhận', 'thất bại') THEN
    RETURN QUERY SELECT
      p_input_data_id,
      NULL::bigint,
      NULL::bigint,
      NULL::text,
      false,
      false,
      false,
      'Trạng thái SMS không hợp lệ';
    RETURN;
  END IF;

  SELECT
    input_data.id,
    input_data.campaign_id,
    input_data.status,
    input_data.phone,
    input_data.phone_carrier,
    input_data.content,
    input_data.name,
    input_data.info1,
    input_data.info2,
    input_data.info3,
    input_data.info4,
    input_data.info5,
    input_data.schedule AS input_schedule,
    campaign.account_id,
    campaign.name AS campaign_name,
    campaign.schedule AS campaign_schedule
  INTO v_input
  FROM public.auto_campaign_input_data AS input_data
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = input_data.campaign_id
  WHERE input_data.id = p_input_data_id
    AND COALESCE(input_data.is_delete, false) = false
    AND campaign.account_id = p_account_id
    AND campaign.action_id = 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
  FOR UPDATE OF input_data;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      p_input_data_id,
      NULL::bigint,
      NULL::bigint,
      NULL::text,
      false,
      false,
      false,
      'Dữ liệu SMS không thuộc tài khoản đang đăng nhập';
    RETURN;
  END IF;

  v_detail_data := COALESCE(p_data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'phone', v_input.phone,
    'phoneCarrier', v_input.phone_carrier,
    'content', v_input.content,
    'name', v_input.name,
    'info1', v_input.info1,
    'info2', v_input.info2,
    'info3', v_input.info3,
    'info4', v_input.info4,
    'info5', v_input.info5,
    'inputSchedule', v_input.input_schedule,
    'campaignSchedule', v_input.campaign_schedule,
    'effectiveSchedule', COALESCE(v_input.input_schedule, v_input.campaign_schedule),
    'campaignName', v_input.campaign_name
  ));

  PERFORM pg_advisory_xact_lock(hashtextextended('aka_agent_sms_status:' || p_input_data_id::text, 0));

  SELECT
    detail.id,
    detail.status,
    detail.log,
    detail.data
  INTO v_existing
  FROM public.auto_campaign_details AS detail
  WHERE detail.input_data_id = p_input_data_id
    AND detail.action_code = 'sms_send'
    AND COALESCE(detail.is_delete, false) = false
  ORDER BY detail.created_at DESC NULLS LAST, detail.id DESC
  LIMIT 1
  FOR UPDATE;
  v_existing_found := FOUND;

  IF NOT v_existing_found THEN
    IF p_detail_status = 'đã nhận' THEN
      RETURN QUERY SELECT
        p_input_data_id,
        v_input.campaign_id,
        NULL::bigint,
        NULL::text,
        false,
        false,
        false,
        'Chưa có trạng thái đã gửi để cập nhật đã nhận';
      RETURN;
    END IF;

    INSERT INTO public.auto_campaign_details (
      input_data_id,
      campaign_id,
      account_id,
      action_code,
      action_name,
      status,
      log,
      data,
      counts_toward_limit
    )
    VALUES (
      p_input_data_id,
      v_input.campaign_id,
      p_account_id,
      'sms_send',
      'Gửi tin nhắn SMS',
      p_detail_status,
      p_log,
      v_detail_data,
      true
    )
    RETURNING id INTO v_detail_id;

    PERFORM public.increment_auto_account_action_count(p_account_id, 'sms_send', 1);
    v_counted := true;
    v_input_updated := true;
  ELSE
    v_detail_id := v_existing.id;
    v_final_status := v_existing.status;

    IF v_existing.status <> 'đã nhận'
      AND (
        p_detail_status = 'đã nhận'
        OR (p_detail_status = 'thất bại' AND v_existing.status <> 'thất bại')
      )
    THEN
      UPDATE public.auto_campaign_details
      SET
        status = p_detail_status,
        log = p_log,
        data = COALESCE(v_existing.data, '{}'::jsonb) || v_detail_data
      WHERE id = v_existing.id;

      v_final_status := p_detail_status;
      v_input_updated := true;
    END IF;

    IF NOT v_input_updated AND v_input.status <> 'hoàn thành' THEN
      v_input_updated := true;
      IF v_final_status = 'thất bại' THEN
        v_note := COALESCE(
          v_existing.log,
          v_existing.data ->> 'errorMessage',
          v_existing.data ->> 'errorCode',
          'Gửi SMS thất bại'
        );
      ELSE
        v_note := NULL;
      END IF;
    END IF;
  END IF;

  IF v_input_updated THEN
    IF v_final_status = 'thất bại' THEN
      v_note := COALESCE(v_note, p_log, 'Gửi SMS thất bại');
    ELSE
      v_note := NULL;
    END IF;

    UPDATE public.auto_campaign_input_data
    SET
      status = 'hoàn thành',
      note = v_note,
      date_action = now()
    WHERE id = p_input_data_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS remaining
    WHERE remaining.campaign_id = v_input.campaign_id
      AND COALESCE(remaining.is_delete, false) = false
      AND remaining.status IN ('chờ xử lý', 'tạm dừng', 'đang chạy')
  ) THEN
    UPDATE public.auto_campaigns
    SET
      status = 'hoàn thành',
      note = NULL,
      updated_at = now()
    WHERE id = v_input.campaign_id
      AND action_id = 'sms_send'
      AND COALESCE(is_delete, false) = false;
  END IF;

  RETURN QUERY SELECT
    p_input_data_id,
    v_input.campaign_id,
    v_detail_id,
    v_final_status,
    v_counted,
    v_input_updated,
    true,
    NULL::text;
END;
$$;

NOTIFY pgrst, 'reload schema';

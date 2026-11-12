-- Nguyên văn hàm kết thúc Nhóm data của production (akachat), đọc chỉ đọc bằng pg_get_functiondef ngày 12/11/2026.
-- md5(prosrc) production: 7786668cdaed19f1b42e1cd37044734a. Chỉ dùng cho kiểm thử V501 trên PostgreSQL cục bộ; không apply lên production.
CREATE OR REPLACE FUNCTION public.aka_agent_internal_finalize_data_group_campaign_v219(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_has_pending boolean;
  v_has_inflight boolean;
  v_before_hard_end boolean;
  v_hard_terminal boolean;
  v_status text;
  v_reason text;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT * INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.data_target_source_mode = 'data_group'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_campaign_not_found'; END IF;

  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'chờ xử lý'
  ), EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'đang chạy'
  ) INTO v_has_pending, v_has_inflight;

  v_before_hard_end := NOT COALESCE(v_campaign.is_delete, false)
    AND (v_campaign.schedule_end_date IS NULL OR v_campaign.schedule_end_date > now());
  v_hard_terminal := COALESCE(v_campaign.is_delete, false)
    OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now())
    OR v_campaign.status = 'hoàn thành';

  -- Hard terminal state wins over the ordinary pending-input race. No new
  -- target may start after delete/end/explicit completion; an already-running
  -- target is allowed to finish and the next finalize call completes cleanup.
  IF v_hard_terminal THEN
    IF v_source.id IS NOT NULL AND v_source.status <> 'stopped' THEN
      UPDATE public.auto_campaign_data_group_sources
      SET status = 'stopped',
          stopped_at = COALESCE(stopped_at, now()),
          stop_reason = COALESCE(stop_reason, CASE
            WHEN COALESCE(v_campaign.is_delete, false) THEN 'campaign_deleted'
            WHEN v_campaign.status = 'hoàn thành' THEN 'campaign_completed'
            ELSE 'hard_end_reached'
          END),
          updated_at = now()
      WHERE id = v_source.id;
    END IF;

    UPDATE public.auto_campaign_input_data
    SET status = 'hoàn thành',
        note = COALESCE(note, CASE
          WHEN COALESCE(v_campaign.is_delete, false) THEN 'Chiến dịch đã bị xoá'
          WHEN v_campaign.status = 'hoàn thành' THEN 'Chiến dịch đã hoàn thành'
          ELSE 'Chiến dịch đã hết hạn'
        END),
        date_action = COALESCE(date_action, now())
    WHERE campaign_id = v_campaign.id
      AND COALESCE(is_delete, false) = false
      AND status = 'chờ xử lý';
    v_has_pending := false;

    IF v_has_inflight THEN
      RETURN jsonb_build_object(
        'completed', false,
        'status', v_campaign.status,
        'reason', 'terminal_input_inflight'
      );
    END IF;

    UPDATE public.auto_campaigns
    SET status = 'hoàn thành',
        note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), note),
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE id = v_campaign.id;
    RETURN jsonb_build_object(
      'completed', true,
      'status', 'hoàn thành',
      'reason', CASE
        WHEN COALESCE(v_campaign.is_delete, false) THEN 'campaign_deleted'
        WHEN v_campaign.status = 'hoàn thành' THEN 'campaign_completed'
        ELSE 'hard_end_reached'
      END
    );
  END IF;

  -- Durable client pause wins every finalize race.
  IF v_campaign.status = 'tạm dừng' THEN
    RETURN jsonb_build_object(
      'completed', false, 'status', v_campaign.status, 'reason', 'paused'
    );
  END IF;
  IF v_has_inflight THEN
    RETURN jsonb_build_object(
      'completed', false, 'status', v_campaign.status, 'reason', 'input_inflight'
    );
  END IF;

  IF v_has_pending THEN
    v_status := 'chờ xử lý';
    v_reason := 'pending_input_raced';
    UPDATE public.auto_campaigns
    SET status = v_status,
        note = NULLIF(btrim(COALESCE(p_note, '')), ''),
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_campaign.id AND status <> 'tạm dừng';
  ELSIF v_source.id IS NOT NULL AND v_source.status IN ('baselining', 'active')
    AND v_before_hard_end THEN
    v_status := 'chờ xử lý';
    v_reason := 'active_source_waiting';
    UPDATE public.auto_campaigns
    SET status = v_status,
        note = 'Chờ data mới',
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_campaign.id AND status <> 'tạm dừng';
  ELSE
    v_status := 'hoàn thành';
    v_reason := CASE
      WHEN COALESCE(v_campaign.is_delete, false) THEN 'campaign_deleted'
      WHEN NOT v_before_hard_end THEN 'hard_end_reached'
      WHEN v_source.id IS NULL THEN 'source_missing'
      ELSE 'source_stopped_and_drained'
    END;
    UPDATE public.auto_campaigns
    SET status = v_status,
        note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), note),
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE id = v_campaign.id AND status <> 'tạm dừng';
  END IF;

  SELECT status INTO v_status
  FROM public.auto_campaigns
  WHERE id = v_campaign.id;
  RETURN jsonb_build_object(
    'completed', v_status = 'hoàn thành',
    'status', v_status,
    'reason', v_reason
  );
END;
$function$
;

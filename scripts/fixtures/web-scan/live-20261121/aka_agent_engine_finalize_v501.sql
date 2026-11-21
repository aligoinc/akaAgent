CREATE OR REPLACE FUNCTION public.aka_agent_engine_finalize_v501(p_campaign_id bigint, p_note text, p_reason text, p_extra jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Như aka_agent_finalize_campaign (v214): còn data "chờ xử lý" (kể cả chưa đến lịch) thì chưa hoàn thành, chiến dịch về
-- "chờ xử lý", xoá ghi chú; không còn thì "hoàn thành" (ghi chú giữ nguyên trừ khi truyền câu mới). Chỉ finish_campaign_v2 gọi.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_pending bigint;
BEGIN
  SELECT count(*) INTO v_pending FROM public.auto_campaign_input_data d
   WHERE d.campaign_id = p_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false;
  IF v_pending > 0 THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, completed_at = NULL, updated_at = v_now WHERE id = p_campaign_id;
    RETURN jsonb_build_object('ok', true, 'reason', 'pending_input_remaining', 'pendingCount', v_pending, 'campaignStatus', 'chờ xử lý');
  END IF;
  UPDATE public.auto_campaigns SET status = 'hoàn thành', note = coalesce(p_note, note), updated_at = v_now WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'reason', p_reason, 'campaignStatus', 'hoàn thành') || coalesce(p_extra, '{}'::jsonb);
END $function$

CREATE OR REPLACE FUNCTION public.aka_agent_engine_apply_status_event_v1(p_detail_id bigint, p_event_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  d record;
  v_rule record;
  v_new_rank integer;
  v_cur_rank integer;
BEGIN
  SELECT cd.id, cd.action_code, cd.status_id, cd.sub_status_id INTO d FROM public.auto_campaign_details cd WHERE cd.id = p_detail_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'detail_not_found'); END IF;
  SELECT er.status_id INTO v_rule FROM public.auto_status_event_rules er
   WHERE er.is_active AND er.event_kind = p_event_kind AND (er.action_code IS NULL OR er.action_code = d.action_code)
   ORDER BY (er.action_code IS NULL) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'applied', false, 'reason', 'no_rule'); END IF;
  SELECT s.progress_rank INTO v_new_rank FROM public.aka_agent_status_semantics(v_rule.status_id) s;
  SELECT s.progress_rank INTO v_cur_rank FROM public.aka_agent_status_semantics(coalesce(d.sub_status_id, d.status_id)) s;
  IF d.sub_status_id IS NOT NULL AND coalesce(v_new_rank, 0) <= coalesce(v_cur_rank, 0) THEN
    RETURN jsonb_build_object('ok', true, 'applied', false, 'reason', 'not_higher');
  END IF;
  UPDATE public.auto_campaign_details SET sub_status_id = v_rule.status_id WHERE id = d.id;
  RETURN jsonb_build_object('ok', true, 'applied', true, 'subStatusId', v_rule.status_id);
END $function$

CREATE OR REPLACE FUNCTION public.aka_agent_engine_simulate_v1(p_campaign_action_id text, p_runtime_target text, p_outcome jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_action text := p_outcome->>'actionCode';
  v_phase text := coalesce(nullif(p_outcome->>'phase', ''), 'after_send');
  v_platform text;
  v_rule_id bigint;
  v_matched_by text;
  v_catch_all boolean;
  v_status_id bigint;
  v_error_code text;
BEGIN
  SELECT aa.flatform_type INTO v_platform FROM public.auto_account_actions aa WHERE aa.code = v_action;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown'); END IF;
  IF coalesce((p_outcome->>'ok')::boolean, false) THEN
    SELECT s.id INTO v_status_id FROM public.auto_status s WHERE s.code = coalesce(nullif(p_outcome->>'statusCode', ''), 'campaign_detail_success');
  ELSE
    SELECT cs.error_code, cs.rule_id, cs.matched_by, cs.is_catch_all INTO v_error_code, v_rule_id, v_matched_by, v_catch_all
      FROM public.aka_agent_engine_classify_signal(v_platform, v_action, v_phase, coalesce(p_outcome->'signal', '{}'::jsonb)) cs;
    v_error_code := coalesce(v_error_code, 'err_undefined');
  END IF;
  RETURN jsonb_build_object('ok', true, 'errorCode', v_error_code, 'ruleId', v_rule_id, 'matchedBy', v_matched_by,
    'isCatchAll', v_catch_all,
    'publicCode', (SELECT e.public_code FROM public.auto_error e WHERE e.error_code = v_error_code),
    'policy', public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, p_campaign_action_id, p_runtime_target, v_phase));
END $function$

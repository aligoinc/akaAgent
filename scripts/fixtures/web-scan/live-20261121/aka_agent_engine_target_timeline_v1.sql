CREATE OR REPLACE FUNCTION public.aka_agent_engine_target_timeline_v1(p_input_data_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.at, x.ord), '[]'::jsonb) FROM (
    SELECT tr.started_at AS at, 1 AS ord, jsonb_build_object('at', tr.started_at, 'kind', 'started', 'targetRunId', tr.id, 'runnerId', tr.runner_id) AS item
      FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = p_input_data_id
    UNION ALL
    SELECT (m.value->>'markedAt')::timestamptz, 2, jsonb_build_object('at', m.value->>'markedAt', 'kind', 'mark_sending',
             'actionCode', m.value->>'actionCode', 'state', m.value->>'state')
      FROM public.auto_engine_target_runs tr, jsonb_array_elements(tr.marks) m WHERE tr.input_data_id = p_input_data_id
    UNION ALL
    SELECT cd.created_at, 3, jsonb_build_object('at', cd.created_at, 'kind', 'milestone', 'detailId', cd.id, 'actionCode', cd.action_code,
             'status', cd.status, 'errorCode', cd.error_code, 'publicCode', e.public_code, 'log', cd.log)
      FROM public.auto_campaign_details cd LEFT JOIN public.auto_error e ON e.error_code = cd.error_code
     WHERE cd.input_data_id = p_input_data_id AND cd.is_delete = false
    UNION ALL
    SELECT ev.created_at, 4, jsonb_build_object('at', ev.created_at, 'kind', ev.kind, 'errorCode', ev.error_code, 'message', ev.message)
      FROM public.auto_engine_target_events ev WHERE ev.input_data_id = p_input_data_id
    UNION ALL
    SELECT tr.completed_at, 5, jsonb_build_object('at', tr.completed_at, 'kind', 'completed', 'status', tr.final_target_status,
             'errorCode', tr.final_error_code, 'reason', tr.close_reason)
      FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = p_input_data_id AND tr.completed_at IS NOT NULL
  ) x
  WHERE public.aka_agent_engine_scope_ok((SELECT c.staff_id FROM public.auto_campaign_input_data d
                                           JOIN public.auto_campaigns c ON c.id = d.campaign_id WHERE d.id = p_input_data_id))
$function$

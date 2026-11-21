CREATE OR REPLACE FUNCTION public.aka_agent_engine_trace_v1(p_input_data_id bigint DEFAULT NULL::bigint, p_target_run_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_runs jsonb;
BEGIN
  IF p_input_data_id IS NULL AND p_target_run_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  WITH runs AS MATERIALIZED (
    SELECT r.* FROM public.auto_engine_target_runs r
     WHERE (p_target_run_id IS NOT NULL AND r.id = p_target_run_id)
        OR (p_target_run_id IS NULL AND r.input_data_id = p_input_data_id)
     ORDER BY r.id DESC LIMIT v_limit
  ), outs AS MATERIALIZED (
    SELECT o.* FROM public.auto_engine_outcomes o WHERE o.target_run_id IN (SELECT id FROM runs)
  ), wf AS MATERIALIZED (
    -- Lượt workflow: mã lượt auto_runs nằm trong tín hiệu (lỗi) hoặc data của dòng lịch sử (R1).
    SELECT DISTINCT x.target_run_id, x.run_id FROM (
      SELECT o.target_run_id, nullif(o.signal->>'runId', '') AS run_id FROM outs o
      UNION ALL
      SELECT o.target_run_id, nullif(d.data->>'runId', '') FROM outs o JOIN public.auto_campaign_details d ON d.id = o.detail_id
    ) x WHERE x.run_id ~ '^[0-9]{1,18}$'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'run', to_jsonb(r) - 'lease_token' - 'final_response',
      'finalResponse', r.final_response,
      'outcomes', (SELECT coalesce(jsonb_agg(jsonb_build_object('resultKey', o.result_key, 'actionCode', o.action_code, 'phase', o.phase, 'ok', o.ok,
                      'errorCode', o.error_code, 'statusId', o.status_id, 'deliveryState', o.delivery_state, 'detailId', o.detail_id,
                      'decision', o.decision, 'signal', o.signal, 'createdAt', o.created_at) ORDER BY o.created_at, o.result_key), '[]'::jsonb)
                     FROM outs o WHERE o.target_run_id = r.id),
      'events', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'errorCode', e.error_code, 'message', e.message, 'data', e.data,
                    'createdAt', e.created_at) ORDER BY e.id), '[]'::jsonb)
                   FROM public.auto_engine_target_events e
                  WHERE e.target_run_id = r.id AND (r.input_data_id IS NULL OR e.input_data_id = r.input_data_id)),
      'details', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'actionCode', d.action_code, 'status', d.status, 'log', d.log,
                     'data', d.data, 'createdAt', d.created_at) ORDER BY d.id), '[]'::jsonb)
                    FROM public.auto_campaign_details d WHERE d.id IN (SELECT o.detail_id FROM outs o WHERE o.target_run_id = r.id)),
      'workflowRuns', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', ar.id, 'workflowId', ar.workflow_id, 'status', ar.status, 'error', ar.error,
                          'startedAt', ar.started_at, 'completedAt', ar.completed_at,
                          'steps', (SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', s.node_id, 'blockName', s.block_name, 'status', s.status,
                                      'error', s.error, 'durationMs', s.duration_ms, 'output', left(s.output::text, 2000)) ORDER BY s.id), '[]'::jsonb)
                                     FROM (SELECT * FROM public.auto_run_steps s0 WHERE s0.run_id = ar.id ORDER BY s0.id LIMIT 300) s)
                        ) ORDER BY ar.id), '[]'::jsonb)
                         FROM public.auto_runs ar WHERE ar.id IN (SELECT w.run_id::bigint FROM wf w WHERE w.target_run_id = r.id))
    ) ORDER BY r.id DESC), '[]'::jsonb) INTO v_runs
  FROM runs r;
  RETURN jsonb_build_object('ok', true, 'inputDataId', p_input_data_id, 'targetRunId', p_target_run_id, 'runs', v_runs);
END $function$

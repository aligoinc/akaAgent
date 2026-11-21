CREATE OR REPLACE FUNCTION public.aka_agent_engine_record_wait_v1(p_target_run_id bigint, p_lease_token uuid, p_error_code text, p_until timestamp with time zone, p_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.auto_engine_target_runs%ROWTYPE;
BEGIN
  IF coalesce(p_seconds, 0) < public.aka_agent_engine_setting('engine.timeline_min_wait_seconds', '30')::integer THEN
    RETURN jsonb_build_object('ok', true, 'recorded', false);
  END IF;
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id;
  IF NOT FOUND OR r.lease_token IS DISTINCT FROM p_lease_token THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  INSERT INTO public.auto_engine_target_events (input_data_id, campaign_id, target_run_id, kind, error_code, message, data)
  VALUES (r.input_data_id, r.campaign_id, r.id, 'wait', p_error_code, public.aka_agent_engine_wait_note(p_error_code, p_until),
          jsonb_build_object('seconds', p_seconds, 'until', p_until));
  RETURN jsonb_build_object('ok', true, 'recorded', true);
END $function$

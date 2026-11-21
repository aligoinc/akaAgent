CREATE OR REPLACE FUNCTION private.aka_agent_engine_target_check_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_raw text;
  v jsonb;
BEGIN
  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = 'engine.target_check' AND s.is_active LIMIT 1;
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN RETURN '{}'::jsonb; END IF;
  v := v_raw::jsonb;
  RETURN CASE WHEN jsonb_typeof(v) = 'object' THEN v ELSE '{}'::jsonb END;
END $function$

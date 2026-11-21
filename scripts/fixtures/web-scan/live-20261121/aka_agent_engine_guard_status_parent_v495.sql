CREATE OR REPLACE FUNCTION public.aka_agent_engine_guard_status_parent_v495()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_cur bigint := NEW.parent_status_id; v_depth integer := 0; v_comp text;
BEGIN
  IF NEW.parent_status_id IS NULL THEN RETURN NEW; END IF;
  SELECT s.component_type INTO v_comp FROM public.auto_status s WHERE s.id = NEW.parent_status_id;
  IF v_comp IS DISTINCT FROM NEW.component_type THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'status_parent_component_mismatch';
  END IF;
  WHILE v_cur IS NOT NULL LOOP
    IF v_cur = NEW.id THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'status_parent_cycle'; END IF;
    v_depth := v_depth + 1;
    IF v_depth > 10 THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'status_parent_too_deep'; END IF;
    SELECT s.parent_status_id INTO v_cur FROM public.auto_status s WHERE s.id = v_cur;
  END LOOP;
  RETURN NEW;
END $function$

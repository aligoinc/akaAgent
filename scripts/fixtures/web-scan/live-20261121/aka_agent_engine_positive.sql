CREATE OR REPLACE FUNCTION public.aka_agent_engine_positive(p_value jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN floor(public.aka_agent_engine_number(p_value)) > 0 THEN floor(public.aka_agent_engine_number(p_value)) END
$function$

CREATE OR REPLACE FUNCTION public.aka_agent_engine_number(p_value jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'number' THEN (p_value #>> '{}')::numeric
              WHEN jsonb_typeof(p_value) = 'string' AND btrim(p_value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(p_value #>> '{}')::numeric
         END
$function$

CREATE OR REPLACE FUNCTION private.aka_agent_engine_error_num(p_value text, p_default numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_value ~ '^[0-9]{1,9}(\.[0-9]{1,4})?$' THEN p_value::numeric ELSE p_default END
$function$

CREATE OR REPLACE FUNCTION public.aka_agent_engine_scope_ok(p_staff bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN s.v IS NULL THEN true ELSE s.v = p_staff END
  FROM (SELECT public.aka_agent_engine_desktop_staff() AS v) s
$function$

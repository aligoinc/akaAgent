CREATE OR REPLACE FUNCTION public.aka_agent_engine_setting(p_key text, p_default text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT s.value FROM public.auto_system_settings s WHERE s.key = p_key AND s.is_active LIMIT 1), p_default)
$function$

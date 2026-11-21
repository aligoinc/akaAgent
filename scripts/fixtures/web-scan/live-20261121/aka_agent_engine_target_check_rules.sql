CREATE OR REPLACE FUNCTION private.aka_agent_engine_target_check_rules()
 RETURNS TABLE(action_code text, error_code text, enabled boolean, days integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT p.action_code, p.error_code, bool_or(p.target_check_enabled), max(p.target_check_days)
    FROM public.auto_outcome_policies p
   WHERE p.target_check_enabled IS NOT NULL AND p.is_active AND NOT p.is_delete
     AND p.action_code IS NOT NULL AND p.error_code IS NOT NULL
   GROUP BY p.action_code, p.error_code
$function$

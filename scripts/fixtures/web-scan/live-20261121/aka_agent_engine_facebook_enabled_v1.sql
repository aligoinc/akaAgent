CREATE OR REPLACE FUNCTION public.aka_agent_engine_facebook_enabled_v1()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT public.aka_agent_engine_facebook_org_enabled(ctx.organization_id)
                     FROM private.aka_agent_desktop_data_context() AS ctx LIMIT 1), false)
$function$

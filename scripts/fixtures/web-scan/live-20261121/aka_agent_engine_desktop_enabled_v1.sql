CREATE OR REPLACE FUNCTION public.aka_agent_engine_desktop_enabled_v1()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  SELECT COALESCE((
    SELECT org.use_new_zalo_runtime
      FROM private.aka_agent_desktop_data_context() AS ctx
      JOIN public.org_organization AS org ON org.id = ctx.organization_id
     LIMIT 1
  ), false)
$function$

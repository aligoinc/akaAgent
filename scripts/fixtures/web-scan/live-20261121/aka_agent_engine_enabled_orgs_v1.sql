CREATE OR REPLACE FUNCTION public.aka_agent_engine_enabled_orgs_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object('organizationIds',
    (SELECT coalesce(jsonb_agg(o.id::text ORDER BY o.id), '[]'::jsonb) FROM public.org_organization o WHERE o.use_new_zalo_runtime IS TRUE))
$function$

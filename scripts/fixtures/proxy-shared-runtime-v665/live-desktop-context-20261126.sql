CREATE OR REPLACE FUNCTION private.aka_agent_desktop_data_context()
 RETURNS TABLE(staff_id bigint, organization_id bigint, system_admin boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT s.id, s.organization_id,
   COALESCE(s.is_admin_akabiz AND s.is_active AND s.deleted_at IS NULL,false)
 FROM public.org_staff s
 WHERE current_setting('role',true)='aka_agent_desktop'
   AND s.id=(SELECT private.aka_agent_staff_scope_for_request());
$function$

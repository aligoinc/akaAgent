-- Additive, backend-only identity lookup for the Desktop AI proxy.
-- No existing function, key permission or RLS policy is changed.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $preflight$ BEGIN
 IF to_regprocedure('public.aka_agent_desktop_ai_identity(uuid,uuid)') IS NOT NULL THEN
   RAISE EXCEPTION 'Desktop AI identity already exists; capture live before editing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.aka_agent_staff_time_allowed(bigint)')
   AND md5(pg_get_functiondef(oid))='a294e60011edd8d42e90ac2f74ce744c' AND prosecdef AND pg_get_userbyid(proowner)='postgres') THEN
   RAISE EXCEPTION 'Staff time guard changed';
 END IF;
END $preflight$;
CREATE FUNCTION public.aka_agent_desktop_ai_identity(p_auth_user_id uuid,p_session_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET statement_timeout='10s' AS $function$
 SELECT jsonb_build_object('staffId',s.id,'organizationId',s.organization_id)
 FROM private.aka_agent_desktop_users m
 JOIN auth.users u ON u.id=m.auth_user_id AND u.role='aka_agent_desktop'
   AND u.raw_app_meta_data->>'aka_agent_desktop'='true'
 JOIN auth.sessions session ON session.user_id=u.id AND session.id=p_session_id
 JOIN public.org_staff s ON s.id=m.staff_id
 WHERE m.auth_user_id=p_auth_user_id AND public.aka_agent_staff_time_allowed(s.id);
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_desktop_ai_identity(uuid,uuid) FROM PUBLIC,anon,authenticated,aka_agent_desktop,service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_ai_identity(uuid,uuid) TO service_role;
COMMIT;

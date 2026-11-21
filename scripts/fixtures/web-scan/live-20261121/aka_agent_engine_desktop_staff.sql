CREATE OR REPLACE FUNCTION public.aka_agent_engine_desktop_staff()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_scope bigint;
BEGIN
  IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT private.aka_agent_staff_scope_for_request()' INTO v_scope;
  RETURN v_scope;
END $function$

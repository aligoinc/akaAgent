CREATE OR REPLACE FUNCTION private.aka_agent_staff_scope_for_request()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_claims jsonb; v_user uuid; v_staff bigint;
BEGIN
 -- SET ROLE is retained across SECURITY DEFINER calls; current_user is not.
 IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN NULL; END IF;
 BEGIN
  v_claims := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  IF v_claims->>'role' IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN 0; END IF;
  v_user := NULLIF(v_claims->>'sub','')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN 0;
 END;
 SELECT staff_id INTO v_staff FROM private.aka_agent_desktop_users WHERE auth_user_id=v_user;
 RETURN COALESCE(v_staff,0);
END;
$function$

CREATE OR REPLACE FUNCTION private.aka_agent_engine_target_check_on(p_organization_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF p_organization_id IS NULL THEN RETURN false; END IF;
  v := private.aka_agent_engine_target_check_config();
  IF v->>'mode' = 'all' THEN RETURN true; END IF;
  IF v->>'mode' = 'orgs' AND jsonb_typeof(v->'organizationIds') = 'array' THEN
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v->'organizationIds') e
                    WHERE jsonb_typeof(e.value) IN ('number', 'string') AND (e.value #>> '{}') = p_organization_id::text);
  END IF;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $function$

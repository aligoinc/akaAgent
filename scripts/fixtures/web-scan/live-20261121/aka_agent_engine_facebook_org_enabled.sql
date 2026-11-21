CREATE OR REPLACE FUNCTION public.aka_agent_engine_facebook_org_enabled(p_organization_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_raw text;
  v jsonb;
BEGIN
  IF p_organization_id IS NULL THEN RETURN false; END IF;
  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = 'engine.facebook' AND s.is_active LIMIT 1;
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN RETURN false; END IF;
  v := v_raw::jsonb;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF v->>'mode' = 'all' THEN RETURN true; END IF;
  IF v->>'mode' = 'orgs' AND jsonb_typeof(v->'organizationIds') = 'array' THEN
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v->'organizationIds') e
                    WHERE jsonb_typeof(e.value) IN ('number', 'string') AND (e.value #>> '{}') = p_organization_id::text);
  END IF;
  RETURN false;
END $function$

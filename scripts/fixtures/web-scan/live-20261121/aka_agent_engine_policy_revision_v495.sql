CREATE OR REPLACE FUNCTION public.aka_agent_engine_policy_revision_v495()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['revision','updated_at','updated_by']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['revision','updated_at','updated_by']) THEN
    RETURN NEW;
  END IF;
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  NEW.updated_by := current_user;
  RETURN NEW;
END $function$

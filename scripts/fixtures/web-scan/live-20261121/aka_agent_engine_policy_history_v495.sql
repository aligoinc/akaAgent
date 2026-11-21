CREATE OR REPLACE FUNCTION public.aka_agent_engine_policy_history_v495()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.auto_outcome_policy_history(policy_id, revision, op, before_row, after_row) VALUES (NEW.id, NEW.revision, 'insert', NULL, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.revision <> OLD.revision THEN
      INSERT INTO public.auto_outcome_policy_history(policy_id, revision, op, before_row, after_row) VALUES (NEW.id, NEW.revision, 'update', to_jsonb(OLD), to_jsonb(NEW));
    END IF;
  ELSE
    INSERT INTO public.auto_outcome_policy_history(policy_id, revision, op, before_row, after_row) VALUES (OLD.id, OLD.revision, 'delete', to_jsonb(OLD), NULL);
  END IF;
  RETURN NULL;
END $function$

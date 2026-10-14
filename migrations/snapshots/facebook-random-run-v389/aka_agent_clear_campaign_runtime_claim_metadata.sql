CREATE OR REPLACE FUNCTION public.aka_agent_clear_campaign_runtime_claim_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'đang chạy'
      AND NEW.status = 'tạm dừng'
      AND OLD.runtime_claim_target = 'server'
    THEN
      -- Server run control is DB-first. A pause can commit after the executor's
      -- top-level claim committed but before that response reached the caller.
      -- Preserve the exact ownership tuple so the caller can recover the lost
      -- response, observe the paused status, and release the account only from
      -- its normal safe cleanup boundary.
      NEW.runtime_claim_token := OLD.runtime_claim_token;
      NEW.runtime_claim_target := OLD.runtime_claim_target;
      NEW.runtime_claim_vietnam_date := OLD.runtime_claim_vietnam_date;
      NEW.runtime_claimed_at := OLD.runtime_claimed_at;
    ELSE
      NEW.runtime_claim_token := NULL;
      NEW.runtime_claim_target := NULL;
      NEW.runtime_claim_vietnam_date := NULL;
      NEW.runtime_claimed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

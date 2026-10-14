CREATE OR REPLACE FUNCTION private.facebook_random_unit_gate(p_campaign bigint, p_account bigint, p_claim uuid, p_count integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE t jsonb; enabled boolean;
BEGIN
 SELECT a.facebook_random_run_enabled INTO enabled FROM public.auto_accounts a WHERE a.id=p_account AND a.flatform_type='facebook';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT x INTO t FROM public.auto_account_random_run_days d, jsonb_array_elements(d.state->'turns') x
 WHERE d.account_id=p_account AND d.status='open' AND x->>'claimToken'=p_claim::text AND (x->>'campaignId')::bigint=p_campaign AND x->>'status'='running';
 IF enabled AND t IS NULL OR NOT enabled AND t IS NOT NULL THEN RETURN 'random_mode_changed'; END IF;
 IF t IS NULL THEN RETURN NULL; END IF;
 IF (t->>'unit'='data' AND (t->>'processed')::int+p_count>(t->>'quantity')::int)
   OR (t->>'unit'<>'data' AND (t->>'processed')::int>=1) THEN RETURN 'random_budget_exhausted'; END IF;
 RETURN NULL;
END $function$
;

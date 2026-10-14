CREATE OR REPLACE FUNCTION private.facebook_random_unit_started(p_campaign bigint, p_account bigint, p_unit uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c record;
BEGIN
 SELECT runtime_claim_token, runtime_unit_claimed_at, runtime_unit_vietnam_date INTO c
 FROM public.auto_campaigns WHERE id=p_campaign AND account_id=p_account AND runtime_unit_token=p_unit;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.auto_account_random_run_days d SET state=jsonb_set(d.state,'{turns}',(
   SELECT jsonb_agg(CASE WHEN x->>'claimToken'=c.runtime_claim_token::text AND x->>'status'='running'
     THEN x||jsonb_build_object('unitToken',p_unit,'unitStartedAt',c.runtime_unit_claimed_at) ELSE x END ORDER BY n)
   FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY AS a(x,n))), updated_at=clock_timestamp()
 WHERE d.account_id=p_account AND d.run_date=c.runtime_unit_vietnam_date
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.state->'turns') x WHERE x->>'claimToken'=c.runtime_claim_token::text AND x->>'status'='running');
END $function$
;

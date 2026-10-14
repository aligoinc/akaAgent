CREATE OR REPLACE FUNCTION private.facebook_random_claim_allowed(p_campaign bigint, p_account bigint, p_turn text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT EXISTS (
   SELECT 1 FROM public.auto_account_random_run_days d
   JOIN public.auto_accounts a ON a.id=d.account_id,
   LATERAL (SELECT x FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY q(x,n)
     WHERE x->>'status' IN ('planned','running') ORDER BY n LIMIT 1) next_turn
   WHERE d.account_id=p_account AND d.run_date=timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date
     AND d.status='open' AND next_turn.x->>'status'='planned'
     AND next_turn.x->>'id'=p_turn AND (next_turn.x->>'campaignId')::bigint=p_campaign
     AND (next_turn.x->>'revision')::int=(a.facebook_random_run_config->>'revision')::int
 );
$function$
;

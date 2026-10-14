CREATE OR REPLACE FUNCTION public.claim_campaign_runtime(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT claim.ok FROM public.aka_agent_claim_campaign_runtime_checked(
    p_campaign_id, p_account_id, p_staff_id, p_runtime_target
  ) AS claim);
END;
$function$

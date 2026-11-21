CREATE OR REPLACE FUNCTION private.app_access_packages(p_org bigint, p_app text, p_platform text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, product_id bigint, max_accounts integer, max_staff integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT p.id,p.product_id,p.max_accounts,p.max_staff FROM public.org_organization_product p
  WHERE p.organization_id=p_org AND p.is_deleted=false
    AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >=
        (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    AND CASE p_app WHEN 'akaChat' THEN p.product_id=5 WHEN 'akaAgent' THEN
      CASE p_platform WHEN 'zalo' THEN p.product_id IN (16,18)
        WHEN 'facebook' THEN p.product_id IN (3,10) WHEN 'email' THEN p.product_id=13
        WHEN 'sms' THEN p.product_id=17 WHEN NULL THEN false
        ELSE p_platform IS NULL AND p.product_id IN (3,10,13,16,17,18) END ELSE false END
$function$

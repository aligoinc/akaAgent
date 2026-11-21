CREATE OR REPLACE FUNCTION public.aka_agent_engine_target_key(p_phone text, p_uid text, p_email text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  WITH n AS (SELECT regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') AS digits)
  SELECT CASE
    WHEN (SELECT digits FROM n) <> '' THEN 'phone:' || md5(CASE
      WHEN (SELECT digits FROM n) LIKE '84%' AND length((SELECT digits FROM n)) >= 11 THEN '0' || substr((SELECT digits FROM n), 3)
      ELSE (SELECT digits FROM n) END)
    WHEN nullif(btrim(coalesce(p_uid, '')), '') IS NOT NULL THEN 'uid:' || btrim(p_uid)
    WHEN nullif(btrim(coalesce(p_email, '')), '') IS NOT NULL THEN 'email:' || md5(lower(btrim(p_email)))
  END
$function$

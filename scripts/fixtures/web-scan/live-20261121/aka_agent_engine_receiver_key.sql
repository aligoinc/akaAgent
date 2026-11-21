CREATE OR REPLACE FUNCTION private.aka_agent_engine_receiver_key(p_kind text, p_value text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_kind = 'phone' THEN (SELECT CASE WHEN n IS NULL OR n = '' THEN NULL ELSE md5('p:' || n)::uuid END FROM (SELECT public.normalize_phone(p_value) AS n) s)
    WHEN p_kind = 'global' THEN (SELECT CASE WHEN g IS NULL OR g = '' THEN NULL ELSE md5('g:' || g)::uuid END FROM (SELECT btrim(p_value) AS g) s)
  END
$function$

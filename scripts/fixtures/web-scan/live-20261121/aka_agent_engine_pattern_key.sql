CREATE OR REPLACE FUNCTION public.aka_agent_engine_pattern_key(p_signal jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT left(btrim(regexp_replace(regexp_replace(
    coalesce(nullif(p_signal->>'code', ''), '') || CASE WHEN coalesce(p_signal->>'code', '') <> '' AND coalesce(p_signal->>'message', '') <> '' THEN ' | ' ELSE '' END
      || coalesce(p_signal->>'message', ''),
    '[0-9]{4,}', '#', 'g'), '\s+', ' ', 'g')), 200)
$function$

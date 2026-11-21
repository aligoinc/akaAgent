CREATE OR REPLACE FUNCTION public.aka_agent_engine_format_vn(p_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_at IS NULL THEN NULL ELSE to_char(p_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') END
$function$

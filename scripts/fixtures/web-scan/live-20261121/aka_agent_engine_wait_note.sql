CREATE OR REPLACE FUNCTION public.aka_agent_engine_wait_note(p_error_code text, p_until timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT '⏳ ' || coalesce(e.customer_title, e.error_name, 'Tạm chờ') ||
    CASE WHEN p_until IS NULL THEN ''
         -- Chờ tới 00:00 (hạn mức ngày): chiến dịch chạy lại theo giờ đã cài, nên chỉ ghi ngày (anh chốt 18/11/2026).
         WHEN to_char(p_until AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI') = '00:00'
           THEN ', chạy tiếp vào ngày ' || to_char(p_until AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM')
         ELSE ', chạy tiếp lúc ' || public.aka_agent_engine_format_vn(p_until) END ||
    CASE WHEN e.public_code IS NOT NULL THEN ' (' || e.public_code || ')' ELSE '' END
  FROM (SELECT 1) one LEFT JOIN public.auto_error e ON e.error_code = p_error_code
$function$

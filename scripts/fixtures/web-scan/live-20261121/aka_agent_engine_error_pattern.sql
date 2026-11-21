CREATE OR REPLACE FUNCTION private.aka_agent_engine_error_pattern(p_message text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT left(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           coalesce(p_message, ''),
           '^((?:Đăng bài thất bại|Lỗi [^:]{1,60}?) (?:vào|đến)) [^:]{1,200}: ', '\1 *: '),
           'facebook\.com/(groups|profile\.php\?id=|permalink|posts)/?[^ ''"|)]*', 'facebook.com/\1/*', 'g'),
           '"[^"]{1,250}"', '"…"', 'g'),
           '[0-9a-f]{16,}', '#', 'g'),
           '[0-9]+', '#', 'g'),
           '\s+', ' ', 'g'), 160)
$function$

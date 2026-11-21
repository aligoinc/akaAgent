CREATE OR REPLACE FUNCTION private.aka_agent_engine_target_check_probe(p_phone text, p_global_id text)
 RETURNS TABLE(action_code text, error_code text, key_kind text, zalo_code text, bad_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH k AS (
    SELECT private.aka_agent_engine_receiver_key('phone', p_phone) AS pk, private.aka_agent_engine_receiver_key('global', p_global_id) AS gk
  ), rws AS (
    SELECT x.* FROM private.auto_engine_receiver_results x, k WHERE x.receiver_key = k.pk OR x.receiver_key = k.gk
  ), okmax AS (
    -- Thành công gần nhất của cùng thao tác qua mọi khoá của người nhận.
    SELECT w.action_code, max(w.ok_at) AS ok_at FROM rws w GROUP BY w.action_code
  )
  SELECT DISTINCT ON (w.action_code) w.action_code, w.error_code, w.key_kind, w.bad_zalo_code, w.bad_at
    FROM rws w
    JOIN okmax o ON o.action_code = w.action_code
    JOIN private.aka_agent_engine_target_check_rules() rl ON rl.action_code = w.action_code AND rl.error_code = w.error_code AND rl.enabled
   WHERE w.bad_at > clock_timestamp() - make_interval(days => rl.days)
     AND (o.ok_at IS NULL OR o.ok_at < w.bad_at)
   ORDER BY w.action_code, w.bad_at DESC
$function$

CREATE OR REPLACE FUNCTION private.aka_agent_engine_target_check_tracked()
 RETURNS TABLE(action_code text, error_code text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT a.code, e.error_code
    FROM unnest(ARRAY['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend']) a(code)
    CROSS JOIN public.auto_error e
   WHERE e.error_class = 'target_permanent' AND starts_with(e.error_code, 'err_zalo_') AND e.is_active AND NOT e.is_delete
     AND e.error_code <> ALL (ARRAY['err_zalo_api_business_failed', 'err_zalo_invalid_param', 'err_zalo_add_friend_failed'])
  UNION
  SELECT rl.action_code, rl.error_code FROM private.aka_agent_engine_target_check_rules() rl
$function$

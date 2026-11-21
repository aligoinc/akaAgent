CREATE OR REPLACE FUNCTION public.aka_agent_engine_lock_until(p_mode text, p_minutes integer, p_days integer, p_time time without time zone, p_now timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_day_start timestamptz := date_trunc('day', p_now AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
BEGIN
  -- Cùng ngữ nghĩa với code hiện tại (src/shared/actionDisableTime.ts, campaignScheduler resolvePolicyActionDisableContext).
  IF p_mode = 'indefinite' THEN RETURN NULL; END IF;
  IF p_mode = 'end_of_day' THEN RETURN v_day_start + interval '1 day'; END IF;
  IF p_mode = 'days_at_time' THEN
    IF p_time IS NULL THEN RETURN p_now + make_interval(days => coalesce(p_days, 0)); END IF;
    RETURN greatest(v_day_start + make_interval(days => coalesce(p_days, 0)) + p_time::interval, p_now + interval '1 second');
  END IF;
  IF coalesce(p_minutes, 0) > 0 THEN RETURN p_now + make_interval(mins => p_minutes); END IF;
  RETURN NULL;
END $function$

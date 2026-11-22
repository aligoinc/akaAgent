CREATE OR REPLACE FUNCTION private.aka_agent_notification_next_run(p_week_days smallint[], p_times time without time zone[], p_tz text, p_after timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_local timestamp := p_after AT TIME ZONE p_tz; v_day date; v_t time; v_candidate timestamptz; i integer;
BEGIN
  IF p_times IS NULL OR cardinality(p_times) = 0 THEN RETURN NULL; END IF;
  FOR i IN 0..7 LOOP
    v_day := v_local::date + i;
    IF p_week_days IS NOT NULL AND cardinality(p_week_days) > 0
       AND NOT (extract(isodow FROM v_day)::smallint = ANY (p_week_days)) THEN
      CONTINUE;
    END IF;
    FOR v_t IN SELECT t FROM unnest(p_times) AS t ORDER BY t LOOP
      v_candidate := (v_day + v_t) AT TIME ZONE p_tz;
      IF v_candidate > p_after THEN RETURN v_candidate; END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END
$function$

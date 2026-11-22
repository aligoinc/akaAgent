CREATE OR REPLACE FUNCTION private.aka_agent_notification_save_subscription(p_staff_id bigint, p_organization_id bigint, p_event_type text, p_enabled boolean, p_email boolean, p_push boolean, p_filters jsonb, p_cooldown integer, p_week_days smallint[], p_times time without time zone[], p_timezone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  INSERT INTO public.auto_notification_subscriptions AS s (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled,
                                                          filters, cooldown_minutes, schedule_week_days, schedule_times, next_run_at)
  VALUES (p_staff_id, p_organization_id, p_event_type, p_enabled, p_email, p_push, p_filters, p_cooldown, p_week_days, p_times,
          CASE WHEN p_event_type = 'report.scheduled' AND p_enabled
               THEN private.aka_agent_notification_next_run(p_week_days, p_times, p_timezone, clock_timestamp()) END)
  ON CONFLICT (staff_id, event_type, scope) DO UPDATE
     SET organization_id = EXCLUDED.organization_id, is_enabled = EXCLUDED.is_enabled, email_enabled = EXCLUDED.email_enabled,
         push_enabled = EXCLUDED.push_enabled, filters = EXCLUDED.filters, cooldown_minutes = EXCLUDED.cooldown_minutes,
         schedule_week_days = EXCLUDED.schedule_week_days, schedule_times = EXCLUDED.schedule_times,
         next_run_at = CASE WHEN EXCLUDED.schedule_week_days IS NOT DISTINCT FROM s.schedule_week_days
                              AND EXCLUDED.schedule_times IS NOT DISTINCT FROM s.schedule_times AND s.is_enabled AND s.next_run_at IS NOT NULL
                            THEN CASE WHEN EXCLUDED.is_enabled THEN s.next_run_at END
                            ELSE EXCLUDED.next_run_at END,
         updated_at = now();
END
$function$

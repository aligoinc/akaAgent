CREATE OR REPLACE FUNCTION private.aka_agent_notification_cleanup(p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_notifications integer; v_snapshots integer; v_events integer;
BEGIN
  DELETE FROM public.auto_notifications WHERE id IN (
    SELECT id FROM public.auto_notifications
     WHERE created_at < p_now - make_interval(days => private.aka_agent_notification_int_setting('notifications.retention_days', 90))
     ORDER BY created_at LIMIT 1000);
  GET DIAGNOSTICS v_notifications = ROW_COUNT;
  UPDATE public.auto_notifications SET content_snapshot = NULL, updated_at = p_now WHERE id IN (
    SELECT id FROM public.auto_notifications
     WHERE event_type = 'report.scheduled' AND content_snapshot IS NOT NULL
       AND created_at < p_now - make_interval(days => private.aka_agent_notification_int_setting('notifications.report_retention_days', 30))
     ORDER BY created_at LIMIT 1000);
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;
  DELETE FROM public.auto_data_group_member_events WHERE id IN (
    SELECT id FROM public.auto_data_group_member_events
     WHERE created_at < p_now - make_interval(days => private.aka_agent_notification_int_setting('notifications.member_event_retention_days', 90))
     ORDER BY created_at LIMIT 5000);
  GET DIAGNOSTICS v_events = ROW_COUNT;
  RETURN jsonb_build_object('notifications', v_notifications, 'reportSnapshots', v_snapshots, 'memberEvents', v_events);
END
$function$

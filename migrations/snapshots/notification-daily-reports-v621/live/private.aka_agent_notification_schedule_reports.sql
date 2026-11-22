CREATE OR REPLACE FUNCTION private.aka_agent_notification_schedule_reports(p_now timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r record; v_count integer := 0; v_tz text; v_slot_local text; v_allowed boolean;
BEGIN
  FOR r IN
    SELECT s.* FROM public.auto_notification_subscriptions s
     WHERE s.event_type = 'report.scheduled' AND s.is_enabled AND s.next_run_at IS NOT NULL AND s.next_run_at <= p_now
     ORDER BY s.next_run_at LIMIT 200 FOR UPDATE SKIP LOCKED
  LOOP
    SELECT coalesce(min(e.timezone), 'Asia/Ho_Chi_Minh') INTO v_tz FROM public.auto_email_notification_settings e WHERE e.staff_id = r.staff_id;
    v_slot_local := to_char(r.next_run_at AT TIME ZONE v_tz, 'YYYY-MM-DD"T"HH24:MI');
    SELECT st.is_active IS TRUE AND st.deleted_at IS NULL AND public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
      INTO v_allowed FROM public.org_staff st WHERE st.id = r.staff_id;
    -- Lỡ nhiều mốc (sự cố) chỉ tạo một báo cáo cho mốc đến hạn sớm nhất rồi nhảy tới mốc tương lai.
    IF coalesce(v_allowed, false) THEN
    INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, entity_key, occurred_at, deliver_after, dedupe_key, payload)
    VALUES (r.organization_id, r.staff_id, 'report.scheduled', 'info', 'report:' || v_slot_local, p_now, p_now,
            format('rp:%s:%s', r.staff_id, v_slot_local),
            jsonb_build_object('slotAt', r.next_run_at, 'slotLocal', v_slot_local, 'timezone', v_tz,
                               'skipWhenIdle', coalesce((r.filters ->> 'skipWhenIdle')::boolean, false),
                               'maxCampaigns', least(greatest(coalesce((r.filters ->> 'maxCampaigns')::integer, 50), 1), 100)))
    ON CONFLICT (dedupe_key) DO NOTHING;
    v_count := v_count + 1;
    END IF;
    UPDATE public.auto_notification_subscriptions
       SET last_run_at = r.next_run_at,
           next_run_at = private.aka_agent_notification_next_run(r.schedule_week_days, r.schedule_times, v_tz, p_now),
           updated_at = p_now
     WHERE id = r.id;
  END LOOP;
  RETURN v_count;
END
$function$

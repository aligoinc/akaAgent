CREATE OR REPLACE FUNCTION public.aka_agent_notification_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_state private.aka_agent_notification_dispatch_state%ROWTYPE;
  v_reports integer := 0; v_cleanup jsonb; v_has_work boolean;
BEGIN
  IF NOT private.aka_agent_notification_enabled() THEN RETURN jsonb_build_object('enabled', false, 'run', false); END IF;
  -- Chưa chuyển sang Fly: tick 30 giây trong DB vẫn lo lập lịch và gọi worker như cũ.
  IF lower(btrim(private.aka_agent_notification_setting('notifications.dispatch_mode', 'pg_net'))) <> 'fly' THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'pg_net', 'run', false);
  END IF;
  v_reports := private.aka_agent_notification_schedule_reports(v_now);
  SELECT * INTO v_state FROM private.aka_agent_notification_dispatch_state WHERE id = 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', false, 'skipped', 'state_locked');
  END IF;
  IF v_state.last_cleanup_at IS NULL OR v_state.last_cleanup_at < v_now - interval '1 hour' THEN
    v_cleanup := private.aka_agent_notification_cleanup(v_now);
    UPDATE private.aka_agent_notification_dispatch_state SET last_cleanup_at = v_now, updated_at = v_now WHERE id = 1;
  END IF;
  v_has_work := EXISTS (SELECT 1 FROM public.auto_notifications n
                         WHERE (n.content_status = 'pending' AND n.deliver_after <= v_now)
                            OR (n.content_status = 'rendering' AND n.leased_until < v_now))
             OR EXISTS (SELECT 1 FROM public.auto_notification_deliveries d
                         WHERE (d.status IN ('pending', 'retrying') AND d.next_attempt_at <= v_now)
                            OR (d.status = 'sending' AND d.leased_until < v_now));
  IF NOT v_has_work THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', false, 'work', false, 'cleanup', v_cleanup);
  END IF;
  -- Cùng khóa thuê với đường pg_net: một lượt worker tại một thời điểm, kể cả khi có nhiều máy Fly hoặc lúc đổi chế độ.
  -- Worker gọi action 'release' khi xong; máy chết giữa lượt thì khóa tự hết sau 60 giây.
  IF v_state.leased_until IS NOT NULL AND v_state.leased_until > v_now THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', false, 'work', true, 'busy', true);
  END IF;
  UPDATE private.aka_agent_notification_dispatch_state
     SET leased_until = v_now + interval '60 seconds', last_called_at = v_now, last_request_id = NULL, updated_at = v_now
   WHERE id = 1;
  RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', true, 'work', true, 'cleanup', v_cleanup);
END
$function$

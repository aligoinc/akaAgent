CREATE OR REPLACE FUNCTION private.aka_agent_notification_fanout(p_notification_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  n public.auto_notifications%ROWTYPE;
  s public.auto_email_notification_settings%ROWTYPE;
  sub public.auto_notification_subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_live boolean := private.aka_agent_notification_setting('notifications.delivery_mode', 'dry_run') = 'live';
  v_allowed boolean; v_email_on boolean := false; v_push_on boolean := false; v_emails text[] := '{}'; v_cap integer; v_recent integer;
  v_email_rows integer := 0; v_push_rows integer := 0; v_has_settings boolean;
  v_email_cap integer; v_email_recent integer := 0; v_email_capped boolean := false;
BEGIN
  SELECT * INTO n FROM public.auto_notifications WHERE id = p_notification_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT st.is_active IS TRUE AND st.deleted_at IS NULL AND public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
    INTO v_allowed FROM public.org_staff st WHERE st.id = n.staff_id;
  IF NOT coalesce(v_allowed, false) THEN
    UPDATE public.auto_notifications SET email_state = 'skipped', push_state = 'skipped', last_error = 'staff_not_allowed', updated_at = v_now
     WHERE id = n.id;
    RETURN jsonb_build_object('ok', true, 'email', 0, 'push', 0, 'skipped', 'staff_not_allowed');
  END IF;
  SELECT * INTO s FROM public.auto_email_notification_settings WHERE staff_id = n.staff_id AND is_delete IS NOT TRUE;
  v_has_settings := FOUND;
  IF n.event_type = 'system.verify_email' THEN
    v_email_on := true;
    v_emails := ARRAY[lower(n.payload ->> 'email')];
  ELSIF NOT v_has_settings THEN
    v_email_on := false; v_push_on := false;
  ELSIF n.event_type = 'system.test' THEN
    v_email_on := n.payload ->> 'channel' = 'email';
    v_push_on := n.payload ->> 'channel' = 'push';
  ELSE
    SELECT * INTO sub FROM public.auto_notification_subscriptions WHERE staff_id = n.staff_id AND event_type = n.event_type AND scope = 'own';
    IF FOUND THEN
      v_email_on := s.is_enabled AND sub.email_enabled;
      v_push_on := s.push_enabled AND sub.push_enabled;
    END IF;
  END IF;
  IF v_email_on AND n.event_type <> 'system.verify_email' THEN
    v_emails := ARRAY(SELECT e FROM unnest(coalesce(s.recipient_emails, '{}'::text[])) WITH ORDINALITY AS r(e, o)
                       WHERE e = ANY (coalesce(s.verified_emails, '{}'::text[])) ORDER BY o LIMIT 5);
  END IF;
  IF v_email_on AND cardinality(v_emails) > 0 THEN
    IF n.event_type IN ('campaign.status_changed', 'account.status_changed', 'data_group.membership_changed') THEN
      v_email_cap := private.aka_agent_notification_int_setting('notifications.email.hourly_cap', 20);
      SELECT count(DISTINCT d.notification_id) INTO v_email_recent FROM public.auto_notification_deliveries d
       WHERE d.staff_id = n.staff_id AND d.channel = 'email' AND d.created_at > v_now - interval '1 hour'
         AND d.status IN ('pending', 'sending', 'retrying', 'sent') AND d.notification_id <> n.id;
      v_email_capped := v_email_recent >= v_email_cap;
    END IF;
    INSERT INTO public.auto_notification_deliveries (notification_id, staff_id, channel, provider, destination, status, last_error_code)
    SELECT n.id, n.staff_id, 'email', 'smtp', e, CASE WHEN v_live AND NOT v_email_capped THEN 'pending' ELSE 'skipped' END,
           CASE WHEN NOT v_live THEN 'dry_run' WHEN v_email_capped THEN 'hourly_cap' END
      FROM unnest(v_emails) AS e
    ON CONFLICT (notification_id, channel, destination) DO NOTHING;
    GET DIAGNOSTICS v_email_rows = ROW_COUNT;
  END IF;
  IF v_push_on THEN
    v_cap := coalesce(s.hourly_push_cap, private.aka_agent_notification_int_setting('notifications.push.hourly_cap', 60));
    SELECT count(*) INTO v_recent FROM public.auto_notification_deliveries d
     WHERE d.staff_id = n.staff_id AND d.channel = 'push' AND d.created_at > v_now - interval '1 hour'
       AND d.status IN ('pending', 'sending', 'retrying', 'sent');
    INSERT INTO public.auto_notification_deliveries (notification_id, staff_id, channel, provider, destination, device_id, status, last_error_code)
    SELECT n.id, n.staff_id, 'push', 'apns', 'device:' || dv.id, dv.id,
           CASE WHEN NOT v_live OR v_recent >= v_cap THEN 'skipped' ELSE 'pending' END,
           CASE WHEN NOT v_live THEN 'dry_run' WHEN v_recent >= v_cap THEN 'hourly_cap' END
      FROM public.auto_notification_devices dv
      JOIN public.auto_control_sessions cs ON cs.id = dv.control_session_id
     WHERE dv.staff_id = n.staff_id AND dv.is_active AND dv.is_enabled AND dv.push_token IS NOT NULL
       AND cs.staff_id = n.staff_id AND cs.revoked_at IS NULL AND cs.expires_at > v_now
     ORDER BY dv.id LIMIT 10
    ON CONFLICT (notification_id, channel, destination) DO NOTHING;
    GET DIAGNOSTICS v_push_rows = ROW_COUNT;
  END IF;
  PERFORM private.aka_agent_notification_refresh_channel_state(n.id, 'email');
  PERFORM private.aka_agent_notification_refresh_channel_state(n.id, 'push');
  RETURN jsonb_build_object('ok', true, 'email', v_email_rows, 'push', v_push_rows, 'live', v_live);
END
$function$

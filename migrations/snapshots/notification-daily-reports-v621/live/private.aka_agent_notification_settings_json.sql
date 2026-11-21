CREATE OR REPLACE FUNCTION private.aka_agent_notification_settings_json(p_staff_id bigint, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE s public.auto_email_notification_settings%ROWTYPE; v_found boolean; v_devices jsonb;
BEGIN
  SELECT * INTO s FROM public.auto_email_notification_settings WHERE staff_id = p_staff_id AND is_delete IS NOT TRUE;
  v_found := FOUND;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', dv.id, 'name', dv.device_name, 'model', dv.device_model, 'osVersion', dv.os_version,
           'appVersion', dv.app_version, 'enabled', dv.is_enabled, 'hasToken', dv.push_token IS NOT NULL, 'permissionStatus', dv.permission_status,
           'lastRegisteredAt', dv.last_registered_at, 'lastSuccessAt', dv.last_success_at,
           'isCurrentDevice', p_session_id IS NOT NULL AND dv.control_session_id = p_session_id) ORDER BY dv.last_registered_at DESC), '[]'::jsonb)
    INTO v_devices
    FROM public.auto_notification_devices dv
    LEFT JOIN public.auto_control_sessions cs ON cs.id = dv.control_session_id
   WHERE dv.staff_id = p_staff_id AND dv.is_active AND (cs.id IS NULL OR (cs.revoked_at IS NULL AND cs.expires_at > now()));
  RETURN jsonb_build_object(
    'revision', CASE WHEN v_found THEN s.revision ELSE 0 END,
    'timezone', CASE WHEN v_found THEN s.timezone ELSE 'Asia/Ho_Chi_Minh' END,
    'updatedAt', CASE WHEN v_found THEN s.updated_at END,
    'updatedByClient', CASE WHEN v_found THEN s.updated_by_client END,
    'centerEnabled', private.aka_agent_notification_enabled(),
    'deliveryMode', private.aka_agent_notification_setting('notifications.delivery_mode', 'dry_run'),
    'channels', jsonb_build_object(
      'email', jsonb_build_object('enabled', CASE WHEN v_found THEN s.is_enabled ELSE false END,
                                  'recipients', to_jsonb(CASE WHEN v_found THEN s.recipient_emails ELSE '{}'::text[] END),
                                  'unverified', to_jsonb(CASE WHEN v_found THEN ARRAY(SELECT e FROM unnest(s.recipient_emails) AS e
                                                                                       WHERE NOT (e = ANY (s.verified_emails))) ELSE '{}'::text[] END)),
      'push', jsonb_build_object('enabled', CASE WHEN v_found THEN s.push_enabled ELSE false END, 'devices', v_devices)),
    'subscriptions', jsonb_build_object(
      'campaignStatus', private.aka_agent_notification_subscription_json(p_staff_id, 'campaign.status_changed'),
      'accountStatus', private.aka_agent_notification_subscription_json(p_staff_id, 'account.status_changed'),
      'scheduledReport', private.aka_agent_notification_subscription_json(p_staff_id, 'report.scheduled'),
      'dataGroupMembership', private.aka_agent_notification_subscription_json(p_staff_id, 'data_group.membership_changed')));
END
$function$

CREATE OR REPLACE FUNCTION private.aka_agent_notification_subscription_json(p_staff_id bigint, p_event_type text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH sub AS (SELECT * FROM public.auto_notification_subscriptions WHERE staff_id = p_staff_id AND event_type = p_event_type AND scope = 'own'),
       d AS (SELECT private.aka_agent_notification_default_filters(p_event_type) AS f),
       m AS (SELECT coalesce((SELECT filters FROM sub), '{}'::jsonb) AS f)
  SELECT jsonb_build_object('enabled', coalesce((SELECT is_enabled FROM sub), false),
                            'email', coalesce((SELECT email_enabled FROM sub), false),
                            'push', coalesce((SELECT push_enabled FROM sub), false),
                            'cooldownMinutes', (SELECT cooldown_minutes FROM sub))
         || CASE p_event_type
              WHEN 'campaign.status_changed' THEN jsonb_build_object(
                'toStatuses', coalesce(m.f -> 'toStatuses', d.f -> 'toStatuses'), 'campaignIds', coalesce(m.f -> 'campaignIds', 'null'::jsonb))
              WHEN 'account.status_changed' THEN jsonb_build_object(
                'loginEvents', coalesce(m.f -> 'loginEvents', d.f -> 'loginEvents'), 'runStatuses', coalesce(m.f -> 'runStatuses', d.f -> 'runStatuses'),
                'accountIds', coalesce(m.f -> 'accountIds', 'null'::jsonb))
              WHEN 'report.scheduled' THEN jsonb_build_object(
                'weekDays', coalesce(to_jsonb((SELECT schedule_week_days FROM sub)), '[1,2,3,4,5,6,7]'::jsonb),
                'times', coalesce((SELECT jsonb_agg(to_char(t, 'HH24:MI') ORDER BY t) FROM unnest((SELECT schedule_times FROM sub)) AS t), '["18:00"]'::jsonb),
                'skipWhenIdle', coalesce(m.f -> 'skipWhenIdle', d.f -> 'skipWhenIdle'), 'nextRunAt', (SELECT next_run_at FROM sub))
              WHEN 'data_group.membership_changed' THEN jsonb_build_object(
                'groupIds', coalesce(m.f -> 'groupIds', 'null'::jsonb), 'actions', coalesce(m.f -> 'actions', d.f -> 'actions'),
                'bucketMinutes', coalesce(m.f -> 'bucketMinutes', d.f -> 'bucketMinutes'),
                'includeSharedGroups', coalesce(m.f -> 'includeSharedGroups', d.f -> 'includeSharedGroups'))
              ELSE '{}'::jsonb END
    FROM d, m
$function$

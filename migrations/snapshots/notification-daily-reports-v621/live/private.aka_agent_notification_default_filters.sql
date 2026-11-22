CREATE OR REPLACE FUNCTION private.aka_agent_notification_default_filters(p_event_type text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE p_event_type
    WHEN 'campaign.status_changed' THEN '{"toStatuses":["hoàn thành","tạm dừng"],"campaignIds":null}'::jsonb
    WHEN 'account.status_changed' THEN '{"loginEvents":["logout","checkpoint","login"],"runStatuses":[],"accountIds":null}'::jsonb
    WHEN 'report.scheduled' THEN '{"skipWhenIdle":false,"maxCampaigns":50}'::jsonb
    WHEN 'data_group.membership_changed' THEN '{"groupIds":null,"actions":["added","removed"],"bucketMinutes":5,"includeSharedGroups":false}'::jsonb
    ELSE '{}'::jsonb END
$function$

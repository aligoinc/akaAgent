-- V457 behaviour checks. Run after setup.sql + migration on a disposable cluster.
\set ON_ERROR_STOP 1
\set QUIET 1
CREATE FUNCTION public.fixture_assert(p_ok boolean, p_message text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_message; END IF;
  RETURN 'ok  - ' || p_message;
END $$;
CREATE FUNCTION public.fixture_error(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public.fixture_assert(boolean, text), public.fixture_error(text) TO PUBLIC;
\set QUIET 0
\pset tuples_only on
\pset format unaligned

\echo '== backfill and defaults'
SELECT fixture_assert((SELECT count(*) FROM auto_notification_subscriptions WHERE staff_id = 1) = 2, 'existing settings backfilled to 2 subscriptions');
SELECT fixture_assert((SELECT is_enabled AND email_enabled AND filters -> 'toStatuses' = '["hoàn thành"]' FROM auto_notification_subscriptions
                       WHERE staff_id = 1 AND event_type = 'campaign.status_changed'), 'legacy campaign email kept as completion only');
SELECT fixture_assert((SELECT schedule_times = ARRAY['08:00'::time] AND next_run_at > now() FROM auto_notification_subscriptions
                       WHERE staff_id = 1 AND event_type = 'report.scheduled'), 'legacy daily report time and next run kept');
SELECT fixture_assert((SELECT verified_emails = recipient_emails FROM auto_email_notification_settings WHERE staff_id = 1), 'existing recipients treated as verified');
SELECT fixture_assert(NOT private.aka_agent_notification_enabled(), 'center disabled by default');
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 10;
SELECT fixture_assert((SELECT count(*) FROM auto_notifications) = 0, 'disabled center captures nothing');
UPDATE auto_campaigns SET status = 'chờ xử lý' WHERE id = 10;

\echo '== capture campaign events'
UPDATE auto_system_settings SET value = 'true' WHERE key = 'notifications.enabled';
SET ROLE aka_agent_desktop;
SELECT set_config('request.jwt.claims', '{"role":"aka_agent_desktop","sub":"11111111-1111-4111-8111-111111111111"}', false) \g /dev/null
UPDATE auto_campaigns SET status = 'hoàn thành', completed_at = now() WHERE id = 10;
RESET ROLE;
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE campaign_id = 10) = 1, 'desktop completion captured once');
SELECT fixture_assert((SELECT payload ->> 'source' = 'desktop' AND severity = 'info' AND deliver_after > occurred_at + interval '29 seconds'
                       FROM auto_notifications WHERE campaign_id = 10), 'source desktop, info, 30s batching window');
UPDATE auto_campaigns SET status = 'chờ xử lý' WHERE id = 10;
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 10;
SELECT fixture_assert((SELECT count(*) = 1 AND min((payload ->> 'suppressedCount')::int) = 1 FROM auto_notifications WHERE campaign_id = 10),
                      'second completion inside cooldown is suppressed and counted');
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id = 11;
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE campaign_id = 11) = 0, 'status outside toStatuses ignored');

\echo '== settings RPC (web/ios)'
SET ROLE service_role;
SELECT fixture_assert((public.aka_agent_control_notification_center(2, 1, 'web', 'get_settings') ->> 'revision')::int = 0, 'staff without settings has revision 0');
SELECT fixture_assert(public.aka_agent_control_notification_center(2, 1, 'web', 'get_settings') #> '{subscriptions,campaignStatus,toStatuses}'
                      = '["hoàn thành","tạm dừng"]', 'new users default to completed + paused');
SELECT fixture_assert((public.aka_agent_control_notification_center(2, 1, 'web', 'save_settings', '{
  "revision": 0,
  "channels": {"email": {"enabled": true, "recipients": ["Nam@Example.test", "nam@example.test"]}, "push": {"enabled": true}},
  "subscriptions": {
    "campaignStatus": {"enabled": true, "email": true, "push": true, "toStatuses": ["hoàn thành", "tạm dừng"], "campaignIds": null},
    "accountStatus": {"enabled": true, "email": false, "push": true, "loginEvents": ["logout", "checkpoint", "login"], "runStatuses": [], "accountIds": [200]},
    "scheduledReport": {"enabled": true, "email": true, "push": false, "weekDays": [1,2,3,4,5], "times": ["18:00", "07:30"], "skipWhenIdle": false},
    "dataGroupMembership": {"enabled": true, "email": true, "push": false, "groupIds": [501], "actions": ["added"], "bucketMinutes": 15, "includeSharedGroups": false}
  }}') ->> 'revision')::int = 1, 'first save creates revision 1');
RESET ROLE;
SELECT fixture_assert((SELECT recipient_emails = '{nam@example.test}' AND notify_campaign_completed AND daily_report_enabled
                         AND daily_report_time = '07:30' AND settings_version = 2 AND updated_by_client = 'web' AND push_enabled
                       FROM auto_email_notification_settings WHERE staff_id = 2), 'legacy columns mirrored from new settings, emails normalized');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE staff_id = 2 AND event_type = 'system.verify_email') = 1, 'new email gets one verification message');
SELECT fixture_assert((SELECT schedule_times = ARRAY['07:30'::time, '18:00'::time] AND schedule_week_days = ARRAY[1,2,3,4,5]::smallint[] AND next_run_at > now()
                       FROM auto_notification_subscriptions WHERE staff_id = 2 AND event_type = 'report.scheduled'), 'report schedule stored sorted with next run');
SET ROLE service_role;
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(2, 1, 'web', 'save_settings', '{"revision": 0}')$$)
                      LIKE '40001:notification_settings_conflict%', 'stale revision rejected with 40001');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(2, 1, 'web', 'save_settings',
  '{"revision": 1, "channels": {"email": {"enabled": true, "recipients": ["a@x.vn","b@x.vn","c@x.vn","d@x.vn","e@x.vn","f@x.vn"]}}}')$$)
                      LIKE '%notification_invalid_email%', 'more than 5 emails rejected');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(2, 1, 'web', 'save_settings',
  '{"revision": 1, "channels": {"email": {"enabled": true, "recipients": []}}}')$$) LIKE '%notification_email_required%', 'enabled email needs a recipient');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(2, 1, 'web', 'save_settings',
  '{"revision": 1, "subscriptions": {"campaignStatus": {"enabled": true, "email": true, "toStatuses": ["hoàn thành"], "campaignIds": [10]}}}')$$)
                      LIKE '%notification_ids_not_owned%', 'campaign of another staff rejected');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(2, 1, 'web', 'save_settings',
  '{"revision": 1, "subscriptions": {"scheduledReport": {"enabled": true, "weekDays": [1], "times": ["25:00"]}}}')$$)
                      LIKE '%notification_invalid_schedule%', 'invalid report time rejected');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(3, 2, 'web', 'get_settings')$$)
                      LIKE '42501:notification_access_denied%', 'inactive staff denied');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(2, 1, 'web', 'register_device', '{}', 'aaaaaaaa-0000-4000-8000-000000000003')$$)
                      LIKE '42501:notification_action_not_allowed%', 'web client cannot register a push device');
RESET ROLE;

\echo '== legacy Desktop bridge'
SET ROLE aka_agent_desktop;
SELECT set_config('request.jwt.claims', '{"role":"aka_agent_desktop","sub":"22222222-2222-4222-8222-222222222222"}', false) \g /dev/null
INSERT INTO auto_email_notification_settings (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed, daily_report_enabled, daily_report_time, is_delete, updated_at)
VALUES (2, 1, true, '{nam@example.test,nam2@example.test}', true, true, '09:15', false, now())
ON CONFLICT (staff_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, is_enabled = EXCLUDED.is_enabled, recipient_emails = EXCLUDED.recipient_emails,
  notify_campaign_completed = EXCLUDED.notify_campaign_completed, daily_report_enabled = EXCLUDED.daily_report_enabled,
  daily_report_time = EXCLUDED.daily_report_time, is_delete = EXCLUDED.is_delete, updated_at = EXCLUDED.updated_at RETURNING staff_id \g /dev/null
SELECT fixture_assert((SELECT count(*) FROM auto_email_notification_settings) = 1, 'desktop still sees only its own settings (V456)');
RESET ROLE;
SELECT fixture_assert((SELECT revision = 2 AND updated_by_client = 'legacy' FROM auto_email_notification_settings WHERE staff_id = 2), 'legacy write bumps revision');
SELECT fixture_assert((SELECT schedule_times = ARRAY['09:15'::time, '18:00'::time] FROM auto_notification_subscriptions
                       WHERE staff_id = 2 AND event_type = 'report.scheduled'), 'legacy report time replaces the earliest time');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE staff_id = 2 AND event_type = 'system.verify_email') = 2, 'email added by legacy client gets verification');
SELECT fixture_assert((SELECT push_enabled AND filters -> 'toStatuses' = '["hoàn thành","tạm dừng"]' FROM auto_notification_subscriptions
                       WHERE staff_id = 2 AND event_type = 'campaign.status_changed'), 'legacy write keeps new-only fields');

\echo '== account events'
SET ROLE aka_agent_chat_api;
UPDATE auto_accounts SET login_status = 'chưa đăng nhập' WHERE id = 200;
UPDATE auto_accounts SET status = 'đang chạy' WHERE id = 200;
RESET ROLE;
SELECT fixture_assert((SELECT count(*) = 1 AND bool_and(severity = 'critical' AND payload ->> 'event' = 'logout' AND payload ->> 'source' = 'chat_api')
                       FROM auto_notifications WHERE account_id = 200), 'logout captured critical, run status ignored');
UPDATE auto_accounts SET login_status = 'chưa đăng nhập' WHERE id = 100;
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE account_id = 100 AND event_type = 'account.status_changed') = 0,
                      'staff without account subscription gets nothing');

\echo '== worker render, dry run, live delivery'
UPDATE auto_notifications SET deliver_after = now() - interval '1 second';
SELECT fixture_assert((SELECT string_agg(event_type || '=' || n, ',' ORDER BY event_type) FROM (SELECT event_type, count(*) AS n FROM auto_notifications
                       WHERE content_status = 'pending' GROUP BY 1) x) = 'account.status_changed=1,campaign.status_changed=1,system.verify_email=2',
                      'due set: 1 account, 1 campaign, 2 verification emails');
SET ROLE service_role;
SELECT fixture_assert(jsonb_array_length(public.aka_agent_notification_worker('claim_render', '{"limit": 50}') -> 'items') = 4, 'claim_render returns all 4 due items');
RESET ROLE;
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE content_status = 'rendering' AND lease_token IS NOT NULL) = 4, 'claimed rows leased');
SET ROLE service_role;
SELECT fixture_assert((public.aka_agent_notification_worker('complete_render', jsonb_build_object('id', 1, 'leaseToken', gen_random_uuid(), 'status', 'ready',
                       'appTitle', 'x', 'emailSubject', 'x')) ->> 'error') = 'lease_lost', 'wrong lease token rejected');
RESET ROLE;
SELECT fixture_assert(public.aka_agent_notification_worker('complete_render', jsonb_build_object('id', n.id, 'leaseToken', n.lease_token, 'status', 'ready',
         'appTitle', 'Chiến dịch hoàn thành', 'appBody', 'Chăm sóc khách tháng 11 đã hoàn thành', 'emailSubject', '[akaBiz] Chiến dịch hoàn thành',
         'contentSnapshot', '{"k":1}'::jsonb, 'templateVersion', 1)) ->> 'ok' = 'true', 'complete_render ready')
  FROM auto_notifications n WHERE n.campaign_id = 10;
SELECT fixture_assert((SELECT count(*) = 1 AND bool_and(status = 'skipped' AND last_error_code = 'dry_run' AND destination = 'ha@example.test')
                       FROM auto_notification_deliveries d JOIN auto_notifications n ON n.id = d.notification_id WHERE n.campaign_id = 10),
                      'dry run writes skipped email delivery');
SELECT fixture_assert((SELECT email_state = 'skipped' AND push_state = 'none' FROM auto_notifications WHERE campaign_id = 10), 'channel states in dry run');
UPDATE auto_system_settings SET value = 'live' WHERE key = 'notifications.delivery_mode';
UPDATE auto_campaigns SET status = 'hoàn thành', completed_at = now() WHERE id = 20;
UPDATE auto_notifications SET deliver_after = now() - interval '1 second' WHERE campaign_id = 20;
INSERT INTO auto_notification_devices (staff_id, organization_id, control_session_id, installation_id, bundle_id, push_token, apns_environment)
VALUES (2, 1, 'aaaaaaaa-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'net.akabiz.agent', repeat('ab', 32), 'sandbox');
UPDATE auto_email_notification_settings SET verified_emails = '{nam@example.test}' WHERE staff_id = 2;
SET ROLE service_role;
SELECT fixture_assert(public.aka_agent_notification_worker('complete_render', jsonb_build_object('id', (x ->> 'id')::bigint, 'leaseToken', x ->> 'leaseToken',
         'status', 'ready', 'appTitle', 'Chiến dịch Nam hoàn thành', 'emailSubject', '[akaBiz] Chiến dịch hoàn thành', 'contentSnapshot', '{}'::jsonb)) #>> '{fanout,email}' = '1',
       'live fanout to verified email only')
  FROM jsonb_array_elements(public.aka_agent_notification_worker('claim_render', '{"limit": 50}') -> 'items') x WHERE x ->> 'eventType' = 'campaign.status_changed';
SELECT fixture_assert(jsonb_array_length(public.aka_agent_notification_worker('claim_deliveries', '{"limit": 10}') -> 'items') = 2, 'claim email + push deliveries');
RESET ROLE;
SELECT fixture_assert((SELECT bool_and(status = 'sending') FROM auto_notification_deliveries d JOIN auto_notifications n ON n.id = d.notification_id WHERE n.campaign_id = 20),
                      'claimed deliveries are sending');
SELECT fixture_assert(public.aka_agent_notification_worker('complete_delivery', jsonb_build_object('id', d.id, 'leaseToken', d.lease_token,
         CASE WHEN d.channel = 'email' THEN 'outcome' ELSE 'outcome' END, CASE WHEN d.channel = 'email' THEN 'sent' ELSE 'retry' END,
         'providerMessageId', 'mid-1', 'errorCode', 'apns_503')) ->> 'ok' = 'true', 'complete ' || d.channel)
  FROM auto_notification_deliveries d JOIN auto_notifications n ON n.id = d.notification_id WHERE n.campaign_id = 20;
SELECT fixture_assert((SELECT email_state = 'sent' AND email_sent_at IS NOT NULL AND push_state = 'pending' FROM auto_notifications WHERE campaign_id = 20),
                      'email sent, push waiting for retry');
SELECT fixture_assert((SELECT status = 'retrying' AND next_attempt_at > now() + interval '50 seconds' FROM auto_notification_deliveries
                       WHERE channel = 'push'), 'push retry after 1 minute');
UPDATE auto_notification_deliveries SET next_attempt_at = now() - interval '1 second' WHERE channel = 'push';
SELECT fixture_assert(public.aka_agent_notification_worker('complete_delivery', jsonb_build_object('id', (x ->> 'id')::bigint, 'leaseToken', x ->> 'leaseToken',
         'outcome', 'invalid_token', 'errorCode', 'BadDeviceToken')) ->> 'ok' = 'true', 'invalid token outcome')
  FROM jsonb_array_elements(public.aka_agent_notification_worker('claim_deliveries', '{}') -> 'items') x;
SELECT fixture_assert((SELECT NOT is_active AND deactivated_reason = 'token_invalid' FROM auto_notification_devices WHERE installation_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
                      'invalid token deactivates device');
SELECT fixture_assert((SELECT push_state = 'failed' FROM auto_notifications WHERE campaign_id = 20), 'push state failed');

\echo '== burst merge'
SET ROLE service_role;
SELECT public.aka_agent_control_notification_center(1, 1, 'web', 'save_settings', jsonb_build_object('revision',
  (public.aka_agent_control_notification_center(1, 1, 'web', 'get_settings') ->> 'revision')::int,
  'subscriptions', jsonb_build_object('campaignStatus', jsonb_build_object('enabled', true, 'email', true, 'push', false,
    'toStatuses', jsonb_build_array('hoàn thành', 'tạm dừng'), 'campaignIds', NULL)))) \g /dev/null
RESET ROLE;
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id BETWEEN 31 AND 36;
UPDATE auto_notifications SET deliver_after = now() - interval '1 second' WHERE campaign_id BETWEEN 31 AND 36;
SELECT public.aka_agent_notification_worker('claim_render', '{"limit": 50}') \g /dev/null
SELECT fixture_assert((SELECT count(*) FILTER (WHERE content_status = 'merged') = 5 AND count(*) FILTER (WHERE (payload ->> 'mergedCount')::int = 5) = 1
                       FROM auto_notifications WHERE campaign_id BETWEEN 31 AND 36), '6 pauses merged into 1');

\echo '== scheduled report and dispatch'
UPDATE auto_notification_subscriptions SET next_run_at = now() - interval '1 minute' WHERE staff_id = 1 AND event_type = 'report.scheduled';
SELECT fixture_assert((public.aka_agent_notification_dispatch() ->> 'reports')::int = 1, 'due report inserted');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE staff_id = 1 AND event_type = 'report.scheduled') = 1
                       AND (SELECT next_run_at > now() FROM auto_notification_subscriptions WHERE staff_id = 1 AND event_type = 'report.scheduled'),
                      'report inserted once and next run moved forward');
SELECT fixture_assert((public.aka_agent_notification_dispatch() ->> 'configured') = 'false', 'missing vault config does not call worker');
INSERT INTO private.fixture_vault VALUES ('AKA_AGENT_NOTIFICATION_DISPATCH_URL', 'https://agent.example/internal/notifications/dispatch'),
                                         ('AKA_AGENT_NOTIFICATION_DISPATCH_TOKEN', 'secret-token');
SELECT fixture_assert((public.aka_agent_notification_dispatch() ->> 'requestId') IS NOT NULL, 'dispatch calls worker when work exists');
SELECT fixture_assert((public.aka_agent_notification_dispatch() ->> 'busy') = 'true', 'lease prevents overlapping calls');
SELECT fixture_assert((SELECT count(*) = 1 AND bool_and(headers ->> 'x-internal-token' = 'secret-token' AND timeout_ms = 30000) FROM private.fixture_http_calls),
                      'one pg_net call with token and 30s timeout');
SET ROLE service_role;
SELECT public.aka_agent_notification_worker('release') \g /dev/null
RESET ROLE;
SELECT fixture_assert((public.aka_agent_notification_dispatch() ->> 'requestId') IS NOT NULL, 'release allows the next call');
SELECT public.aka_agent_data_group_background_tick();
SELECT fixture_assert((SELECT count(*) FROM private.fixture_tick_calls) = 2, 'tick still runs filter worker and sheet dispatch');

\echo '== devices'
SET ROLE service_role;
SELECT fixture_assert((public.aka_agent_control_notification_center(1, 1, 'ios', 'register_device', jsonb_build_object('installationId', 'cccccccc-0000-4000-8000-000000000001',
         'bundleId', 'net.akabiz.agent', 'pushToken', repeat('cd', 32), 'apnsEnvironment', 'production', 'deviceName', 'iPhone 15', 'permissionStatus', 'granted'),
         'aaaaaaaa-0000-4000-8000-000000000001') ->> 'deviceId') IS NOT NULL, 'ios session registers device');
SELECT fixture_assert((public.aka_agent_control_notification_center(1, 1, 'ios', 'get_settings', '{}', 'aaaaaaaa-0000-4000-8000-000000000001')
                       #> '{channels,push,devices,0,isCurrentDevice}') = 'true', 'settings mark current device');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(1, 1, 'ios', 'register_device',
  '{"installationId":"cccccccc-0000-4000-8000-000000000002","bundleId":"net.akabiz.agent"}', 'aaaaaaaa-0000-4000-8000-000000000002')$$)
                      LIKE '42501:notification_session_invalid%', 'web session cannot register device');
SELECT fixture_assert((public.aka_agent_control_notification_center(2, 1, 'ios', 'register_device', jsonb_build_object('installationId', 'cccccccc-0000-4000-8000-000000000003',
         'bundleId', 'net.akabiz.agent', 'pushToken', repeat('cd', 32)), 'aaaaaaaa-0000-4000-8000-000000000003') ->> 'ok') = 'true', 'same token on another install');
RESET ROLE;
SELECT fixture_assert((SELECT NOT is_active AND deactivated_reason = 'staff_changed' FROM auto_notification_devices WHERE installation_id = 'cccccccc-0000-4000-8000-000000000001'),
                      'token moved to new owner deactivates old binding');
UPDATE auto_control_sessions SET revoked_at = now() WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003';
SELECT fixture_assert((SELECT NOT is_active AND deactivated_reason = 'session_revoked' FROM auto_notification_devices WHERE installation_id = 'cccccccc-0000-4000-8000-000000000003'),
                      'session revoke deactivates device');

\echo '== inbox'
SET ROLE service_role;
SELECT fixture_assert((public.aka_agent_control_notification_center(2, 1, 'web', 'list') -> 'items' -> 0 ->> 'title') = 'Chiến dịch Nam hoàn thành', 'list shows ready items');
SELECT fixture_assert((public.aka_agent_control_notification_center(2, 1, 'web', 'list') ->> 'unreadCount')::int = 1, 'unread count');
SELECT fixture_assert((public.aka_agent_control_notification_center(2, 1, 'web', 'detail', jsonb_build_object('id',
         (public.aka_agent_control_notification_center(2, 1, 'web', 'list') -> 'items' -> 0 ->> 'id')::bigint)) -> 'deliveries' -> 0 ->> 'destination') = 'na***@example.test',
       'detail masks email destination');
SELECT fixture_assert((public.aka_agent_control_notification_center(2, 1, 'web', 'mark_read', jsonb_build_object('upToId', 9223372036854775807)) ->> 'unreadCount')::int = 0, 'mark all read');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(2, 1, 'web', 'detail', '{"id": 1}')$$) LIKE 'P0002:notification_not_found%',
                      'cannot open another staff notification');
SELECT fixture_assert((public.aka_agent_control_notification_center(1, 1, 'web', 'test', '{"channel": "email"}') ->> 'ok') = 'true', 'test 1');
SELECT public.aka_agent_control_notification_center(1, 1, 'web', 'test', '{"channel": "email"}') \g /dev/null
SELECT public.aka_agent_control_notification_center(1, 1, 'web', 'test', '{"channel": "push"}') \g /dev/null
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(1, 1, 'web', 'test', '{"channel": "email"}')$$)
                      LIKE '54000:notification_test_rate_limited%', 'fourth test in 10 minutes rate limited');
SELECT fixture_assert((public.aka_agent_control_notification_center(2, 1, 'web', 'verify_email', '{"email": "nam2@example.test"}') ->> 'verified') = 'true', 'verify email');
SELECT fixture_assert((public.aka_agent_control_notification_center(2, 1, 'web', 'unsubscribe', '{"eventType": "report.scheduled"}') ->> 'ok') = 'true', 'unsubscribe');
RESET ROLE;
SELECT fixture_assert((SELECT verified_emails @> '{nam2@example.test}' AND NOT daily_report_enabled FROM auto_email_notification_settings WHERE staff_id = 2),
                      'verified email stored, legacy report flag cleared on unsubscribe');

\echo '== desktop wrapper and privileges'
SET ROLE aka_agent_desktop;
SELECT set_config('request.jwt.claims', '{"role":"aka_agent_desktop","sub":"11111111-1111-4111-8111-111111111111"}', false) \g /dev/null
SELECT fixture_assert((public.aka_agent_notification_center(1, 1, 'ha', 'pw1', 'get_settings') ->> 'revision') IS NOT NULL, 'desktop reads own settings');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_center(2, 1, 'nam', 'pw2', 'get_settings')$$) LIKE '42501:desktop_staff_scope_denied%',
                      'desktop token cannot read another staff');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_center(1, 1, 'ha', 'wrong', 'get_settings')$$) LIKE '%automation_auth_invalid%',
                      'wrong desktop credentials rejected');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_center(1, 1, 'ha', 'pw1', 'register_device', '{}')$$) LIKE '42501:notification_action_not_allowed%',
                      'desktop cannot register push device');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_control_notification_center(1, 1, 'web', 'get_settings')$$) LIKE '42501:%', 'desktop cannot call control RPC');
SELECT fixture_assert(fixture_error($$SELECT count(*) FROM public.auto_notifications$$) LIKE '42501:%', 'desktop cannot read notifications table');
RESET ROLE;
SET ROLE anon;
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_worker('stats')$$) LIKE '42501:%', 'anon cannot call worker');
RESET ROLE;
SET ROLE service_role;
SELECT fixture_assert(fixture_error($$SELECT count(*) FROM public.auto_notification_devices$$) LIKE '42501:%', 'service_role uses RPC only, no table access');
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_dispatch()$$) LIKE '42501:%', 'only the tick may dispatch');

\echo '== snapshots'
SELECT fixture_assert((public.aka_agent_notification_snapshot('campaign', '{"staffId": 1, "campaignId": 10}') -> 'inputs') = '{"chờ xử lý": 1, "hoàn thành": 2}', 'campaign input counts');
SELECT fixture_assert((SELECT bool_or(r ->> 'group' = 'skipped' AND (r ->> 'total')::int = 1 AND (r ->> 'today')::int = 0)
                       FROM jsonb_array_elements(public.aka_agent_notification_snapshot('campaign', '{"staffId": 1, "campaignId": 10}') -> 'results') r),
                      'legacy NULL report_group mapped to skipped, not counted today');
SELECT fixture_assert((public.aka_agent_notification_snapshot('campaign', '{"staffId": 2, "campaignId": 10}') ->> 'found') = 'false', 'campaign snapshot scoped to staff');
SELECT fixture_assert((public.aka_agent_notification_snapshot('account', '{"staffId": 1, "accountId": 100}') #>> '{account,proxyName}') = 'Proxy HN', 'account snapshot');
SELECT fixture_assert((SELECT count(*) FILTER (WHERE i ->> 'code' IN ('staff_expiring', 'package_expiring')) = 2
                       FROM jsonb_array_elements(public.aka_agent_notification_snapshot('report', '{"staffId": 1}') -> 'issues') i), 'report lists expiring staff and package');
SELECT fixture_assert((public.aka_agent_notification_snapshot('data_group', '{"staffId": 1, "groupId": 501}') ->> 'found') = 'true', 'shared group visible to recipient');
SELECT fixture_assert((public.aka_agent_notification_snapshot('data_group', '{"staffId": 2, "groupId": 500}') ->> 'found') = 'false', 'foreign group hidden');
RESET ROLE;

\echo '== retention'
INSERT INTO auto_notifications (organization_id, staff_id, event_type, entity_key, dedupe_key, created_at, content_status)
VALUES (1, 1, 'system.test', 'old', 'old-1', now() - interval '100 days', 'ready');
SELECT fixture_assert((private.aka_agent_notification_cleanup(now()) ->> 'notifications')::int = 1, 'cleanup removes notifications older than 90 days');
\echo 'PASS'

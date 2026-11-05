-- V465 behaviour checks. Run after setup.sql + V457 + V465 on a disposable cluster (see smoke.sh).
\set ON_ERROR_STOP 1
\set QUIET 1
CREATE FUNCTION public.fixture_assert(p_ok boolean, p_message text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_message; END IF;
  RETURN 'ok  - ' || p_message;
END $$;
-- Render + fanout every due item through the worker RPC (same path as the WebApp worker).
CREATE FUNCTION public.fixture_render_due() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE i jsonb; n integer := 0;
BEGIN
  FOR i IN SELECT jsonb_array_elements(public.aka_agent_notification_worker('claim_render', '{"limit": 50}') -> 'items') LOOP
    PERFORM public.aka_agent_notification_worker('complete_render', jsonb_build_object('id', i ->> 'id', 'leaseToken', i ->> 'leaseToken',
      'status', 'ready', 'appTitle', 'Tiêu đề', 'appBody', 'Nội dung', 'emailSubject', 'Chủ đề'));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
\set QUIET 0
\pset tuples_only on
\pset format unaligned

UPDATE auto_system_settings SET value = 'true' WHERE key = 'notifications.enabled';
SET ROLE service_role;
SELECT public.aka_agent_control_notification_center(1, 1, 'web', 'save_settings', jsonb_build_object('revision',
  (public.aka_agent_control_notification_center(1, 1, 'web', 'get_settings') ->> 'revision')::int,
  'subscriptions', jsonb_build_object('campaignStatus', jsonb_build_object('enabled', true, 'email', true, 'push', false,
    'toStatuses', jsonb_build_array('hoàn thành', 'tạm dừng'), 'campaignIds', NULL)))) \g /dev/null
RESET ROLE;

\echo '== digest: changes of the same status are batched per staff'
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id = 31;
SELECT fixture_assert((SELECT deliver_after BETWEEN occurred_at + interval '29 seconds' AND occurred_at + interval '31 seconds'
                       FROM auto_notifications WHERE campaign_id = 31), 'first pause in a quiet period is sent after 30 seconds');
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id = 32;
SELECT fixture_assert((SELECT deliver_after FROM auto_notifications WHERE campaign_id = 32) = (SELECT deliver_after FROM auto_notifications WHERE campaign_id = 31),
                      'second pause joins the pending slot');
UPDATE auto_notifications SET deliver_after = now() - interval '1 second' WHERE campaign_id IN (31, 32);
SELECT fixture_assert(fixture_render_due() = 1, 'two pauses due together render once');
SELECT fixture_assert((SELECT count(*) FILTER (WHERE content_status = 'merged') = 1 AND count(*) FILTER (WHERE (payload ->> 'mergedCount')::int = 1) = 1
                       FROM auto_notifications WHERE campaign_id IN (31, 32)), 'two pauses merged into 1 (was: needed 5 within 2 minutes)');
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id = 33;
SELECT fixture_assert((SELECT n.deliver_after >= k.deliver_after + interval '10 minutes' - interval '1 second'
                         FROM auto_notifications n, auto_notifications k WHERE n.campaign_id = 33 AND k.campaign_id = 31),
                      'next pause waits for the following 10-minute slot');
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 34;
SELECT fixture_assert((SELECT deliver_after <= occurred_at + interval '31 seconds' FROM auto_notifications WHERE campaign_id = 34),
                      'other status keeps its own quiet slot');
UPDATE auto_system_settings SET value = '0' WHERE key = 'notifications.digest_minutes.campaign';
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id = 35;
SELECT fixture_assert((SELECT deliver_after <= occurred_at + interval '31 seconds' FROM auto_notifications WHERE campaign_id = 35),
                      'digest 0 restores the 30-second window');
UPDATE auto_system_settings SET value = '10' WHERE key = 'notifications.digest_minutes.campaign';

\echo '== email hourly cap (event notifications only)'
UPDATE auto_system_settings SET value = 'live' WHERE key = 'notifications.delivery_mode';
UPDATE auto_system_settings SET value = '2' WHERE key = 'notifications.email.hourly_cap';
DELETE FROM auto_notification_deliveries WHERE staff_id = 1;
INSERT INTO auto_notifications (organization_id, staff_id, event_type, entity_key, dedupe_key, content_status, app_title, app_body, email_subject)
SELECT 1, 1, 'campaign.status_changed', 'campaign:' || g, 'cap-test-' || g, 'ready', 't', 'b', 's' FROM generate_series(1, 3) g;
SELECT private.aka_agent_notification_fanout(id) FROM auto_notifications WHERE dedupe_key LIKE 'cap-test-%' ORDER BY id \g /dev/null
SELECT fixture_assert((SELECT array_agg(d.status || ':' || coalesce(d.last_error_code, '') ORDER BY n.id) FROM auto_notifications n
                         JOIN auto_notification_deliveries d ON d.notification_id = n.id AND d.channel = 'email'
                        WHERE n.dedupe_key LIKE 'cap-test-%') = ARRAY['pending:', 'pending:', 'skipped:hourly_cap'],
                      'third event email within the hour is skipped with hourly_cap');
INSERT INTO auto_notifications (organization_id, staff_id, event_type, entity_key, dedupe_key, content_status, app_title, app_body, email_subject)
VALUES (1, 1, 'report.scheduled', 'report:cap', 'cap-test-report', 'ready', 't', 'b', 's');
SELECT private.aka_agent_notification_fanout(id) FROM auto_notifications WHERE dedupe_key = 'cap-test-report' \g /dev/null
SELECT fixture_assert((SELECT d.status FROM auto_notification_deliveries d JOIN auto_notifications n ON n.id = d.notification_id
                        WHERE n.dedupe_key = 'cap-test-report' AND d.channel = 'email') = 'pending', 'scheduled report is not capped');
UPDATE auto_system_settings SET value = '20' WHERE key = 'notifications.email.hourly_cap';
UPDATE auto_system_settings SET value = 'dry_run' WHERE key = 'notifications.delivery_mode';

\echo '== report: SMS accounts by attached device'
UPDATE auto_accounts SET login_status = 'chưa đăng nhập', mobile_device_id = NULL WHERE id = 101;
SELECT fixture_assert((SELECT (r -> 'accounts' ->> 'total')::int = 1 AND NOT (r -> 'loggedOutAccounts') @> '[{"id": 101}]'
                         FROM (SELECT public.aka_agent_notification_snapshot('report', '{"staffId": 1}') r) x),
                      'unused default SMS account (no device, no campaign) is not counted');
UPDATE auto_accounts SET mobile_device_id = 'device-1' WHERE id = 101;
SELECT fixture_assert((SELECT (r -> 'accounts' ->> 'total')::int = 2 AND (r -> 'accounts' ->> 'loggedIn')::int = 2
                         FROM (SELECT public.aka_agent_notification_snapshot('report', '{"staffId": 1}') r) x),
                      'SMS account with attached device counts as connected');
UPDATE auto_accounts SET mobile_device_id = NULL WHERE id = 101;
INSERT INTO auto_campaigns (id, name, action_id, account_id, status, staff_id, organization_id) VALUES (40, 'SMS tri ân', 'zalo_message_phone', 101, 'chờ xử lý', 1, 1);
SELECT fixture_assert((SELECT (r -> 'loggedOutAccounts') @> '[{"id": 101}]'
                              AND (r -> 'issues') @> '[{"code": "account_logged_out_with_campaigns", "subject": "SMS Hà"}]'
                              AND EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'issues') i WHERE i ->> 'message' LIKE 'Chưa gắn máy SMS trong khi còn 1 chiến dịch%')
                         FROM (SELECT public.aka_agent_notification_snapshot('report', '{"staffId": 1}') r) x),
                      'SMS account in use without device is reported as such');
DELETE FROM auto_campaigns WHERE id = 40;

\echo '== report: campaigns with activity today come first'
UPDATE auto_campaigns SET last_run_at = now() - interval '3 days', note = 'Có lỗi xảy ra', status = 'tạm dừng' WHERE id = 11;
UPDATE auto_campaigns SET last_run_at = now() WHERE id = 10;
SELECT fixture_assert((SELECT (r -> 'campaigns' -> 0 ->> 'id')::bigint = 10 FROM (SELECT public.aka_agent_notification_snapshot('report', '{"staffId": 1}') r) x),
                      'campaign active today listed before a paused campaign with a note');

\echo '== scheduled reports skip staff who can no longer use the app'
INSERT INTO auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, email_enabled, filters, schedule_week_days, schedule_times, next_run_at)
VALUES (3, 2, 'report.scheduled', true, true, '{}', ARRAY[1,2,3,4,5,6,7]::smallint[], ARRAY['08:00'::time], now() - interval '1 minute');
SELECT fixture_assert(private.aka_agent_notification_schedule_reports(now()) = 0, 'no report created for inactive staff');
SELECT fixture_assert((SELECT next_run_at > now() FROM auto_notification_subscriptions WHERE staff_id = 3 AND event_type = 'report.scheduled')
                      AND NOT EXISTS (SELECT 1 FROM auto_notifications WHERE staff_id = 3), 'schedule still moves forward');

\echo '== snapshot: account reason tied to the event'
INSERT INTO auto_account_logs (created_at, account_id, source, event_type, message, login_status, details) VALUES
  (now() - interval '30 seconds', 100, 'desktop', 'zalo_warning', 'Zalo Web đã đăng xuất', NULL, NULL),
  (now(), 100, 'desktop', 'logout', 'Trạng thái đăng nhập: đã đăng nhập → chưa đăng nhập', 'chưa đăng nhập', '{"reason": "Đăng nhập thất bại"}'),
  (now() + interval '1 second', 100, 'zalo_server', 'status_changed', 'Đã giải phóng runtime; trạng thái tài khoản: chờ xử lý.', NULL, NULL);
SELECT fixture_assert((SELECT r -> 'account' -> 'loginLog' ->> 'reason' = 'Đăng nhập thất bại'
                              AND r -> 'account' -> 'loginLog' ->> 'event' = 'logout'
                              AND r -> 'account' -> 'warnLog' ->> 'message' = 'Zalo Web đã đăng xuất'
                              AND r -> 'account' -> 'lastLog' ->> 'event' = 'status_changed'
                         FROM (SELECT public.aka_agent_notification_snapshot('account', jsonb_build_object('staffId', 1, 'accountId', 100, 'occurredAt', now())) r) x),
                      'loginLog carries details.reason, warnLog the nearest warning, lastLog unchanged');
INSERT INTO chat_zalo_account_organization (auto_account_id, socket_last_close_reason, updated_at) VALUES (100, 'KICKOUT_BY_WORKER', '2026-10-10');
SELECT fixture_assert((SELECT (r -> 'account' -> 'chatSession' ->> 'updatedAt') IS NOT NULL
                         FROM (SELECT public.aka_agent_notification_snapshot('account', jsonb_build_object('staffId', 1, 'accountId', 100)) r) x),
                      'chat session exposes updatedAt so stale reasons can be ignored');

\echo '== snapshot: campaign results from the index match the old heap grouping'
CREATE FUNCTION pg_temp.v457_results(p_id bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('action', action, 'group', grp, 'total', total, 'today', today) ORDER BY action, grp), '[]'::jsonb)
    FROM (SELECT coalesce(nullif(d.action_name, ''), d.action_code, 'Hành động') AS action,
                 private.aka_agent_notification_result_group(d.report_group, d.status) AS grp,
                 count(*) AS total, count(*) FILTER (WHERE d.created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS today
            FROM public.auto_campaign_details d WHERE d.campaign_id = p_id AND d.is_delete = false GROUP BY 1, 2) r $$;
INSERT INTO auto_campaign_details (campaign_id, action_name, action_code, status, report_group, created_at)
SELECT 11, CASE WHEN g % 3 = 0 THEN 'Kết bạn' ELSE 'Nhắn tin' END, CASE WHEN g % 3 = 0 THEN 'zalo_add_friend' ELSE 'zalo_message_phone' END,
       CASE WHEN g % 5 = 0 THEN 'thất bại' WHEN g % 7 = 0 THEN 'đã là bạn bè' ELSE 'thành công' END,
       CASE WHEN g % 5 = 0 THEN 'failure' WHEN g % 7 = 0 THEN 'skipped' ELSE 'success' END,
       now() - (g || ' hours')::interval FROM generate_series(1, 400) g;
INSERT INTO auto_campaign_details (campaign_id, action_name, action_code, status, report_group) VALUES (11, 'Hành động cũ', NULL, 'thành công', NULL);
SELECT fixture_assert((SELECT public.aka_agent_notification_snapshot('campaign', '{"staffId": 1, "campaignId": 11}') -> 'results') = pg_temp.v457_results(11),
                      'results identical to V457 for coded, uncoded and legacy rows');
SELECT fixture_assert((SELECT public.aka_agent_notification_snapshot('campaign', '{"staffId": 1, "campaignId": 10}') -> 'results') = pg_temp.v457_results(10),
                      'results identical to V457 on the fixture campaign (NULL report_group)');
INSERT INTO auto_campaign_details (campaign_id, action_name, action_code, status, report_group, created_at) VALUES
  (11, 'Đăng bài', 'fb_post_group', 'thành công', 'success', now() - interval '2 days'),
  (11, 'Đăng bài group', 'fb_post_group', 'thành công', 'success', now());
SELECT fixture_assert((SELECT count(*) FROM jsonb_array_elements(public.aka_agent_notification_snapshot('campaign', '{"staffId": 1, "campaignId": 11}') -> 'results') r
                        WHERE r ->> 'action' IN ('Đăng bài', 'Đăng bài group')) = 1, 'one action code renamed over time is one row (latest name)');
DROP FUNCTION public.fixture_render_due();
DROP FUNCTION public.fixture_assert(boolean, text);
\echo 'PASS'

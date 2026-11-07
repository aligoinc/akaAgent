-- V475 behaviour checks. Run after setup.sql + V457 + V466 + V467 + V465 + v475_fixture.sql + V475 (see smoke_v475.sh).
\set ON_ERROR_STOP 1
\set QUIET 1
CREATE FUNCTION public.fixture_assert(p_ok boolean, p_message text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_message; END IF;
  RETURN 'ok  - ' || p_message;
END $$;
-- Campaign status notifications of one campaign, optionally for one target status.
CREATE FUNCTION public.fixture_n(p_campaign bigint, p_status text DEFAULT NULL) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.auto_notifications
   WHERE campaign_id = p_campaign AND event_type = 'campaign.status_changed' AND (p_status IS NULL OR payload ->> 'toStatus' = p_status)
$$;
\set QUIET 0
\pset tuples_only on
\pset format unaligned

UPDATE auto_system_settings SET value = 'true' WHERE key = 'notifications.enabled';
-- Staff 1 asks for every status the settings screen offers; cooldown 0 so each change is its own row.
SET ROLE service_role;
SELECT public.aka_agent_control_notification_center(1, 1, 'web', 'save_settings', jsonb_build_object('revision',
  (public.aka_agent_control_notification_center(1, 1, 'web', 'get_settings') ->> 'revision')::int,
  'subscriptions', jsonb_build_object('campaignStatus', jsonb_build_object('enabled', true, 'email', true, 'push', false,
    'toStatuses', jsonb_build_array('hoàn thành', 'tạm dừng', 'đang chạy', 'chờ xử lý'), 'campaignIds', NULL)))) \g /dev/null
RESET ROLE;
UPDATE auto_notification_subscriptions SET cooldown_minutes = 0 WHERE staff_id = 1 AND event_type = 'campaign.status_changed';
SELECT fixture_assert((SELECT is_enabled AND filters -> 'toStatuses' @> '["hoàn thành","tạm dừng","đang chạy","chờ xử lý"]'
                         FROM auto_notification_subscriptions WHERE staff_id = 1 AND event_type = 'campaign.status_changed'),
                      'staff 1 subscribed to the four campaign statuses');

-- Journeys of staff 1: running, paused, stopped, deleted, draft, and one for the role checks.
INSERT INTO auto_journeys (staff_id, organization_id, name, status, draft_graph, draft_settings, is_delete, stopped_at, deleted_at) VALUES
  (1, 1, 'QT đang chạy', 'active', '{}', '{}', false, NULL, NULL),
  (1, 1, 'QT tạm dừng', 'paused', '{}', '{}', false, NULL, NULL),
  (1, 1, 'QT đã dừng', 'stopped', '{}', '{}', false, now() - interval '1 day', NULL),
  (1, 1, 'QT đã xóa', 'paused', '{}', '{}', true, NULL, now() - interval '1 day'),
  (1, 1, 'QT nháp', 'draft', '{}', '{}', false, NULL, NULL),
  (1, 1, 'QT vai trò', 'active', '{}', '{}', false, NULL, NULL);
INSERT INTO auto_journey_step_campaigns (journey_id, step_id, account_id, action_code, campaign_id, is_active)
SELECT j.id, x.step, 100, 'zalo_message_phone', x.campaign, x.active
  FROM (VALUES ('QT đang chạy', 's1', 10, true), ('QT đang chạy', 's0', 31, false), ('QT tạm dừng', 's1', 11, true),
               ('QT đã dừng', 's1', 32, true), ('QT đã xóa', 's1', 33, true), ('QT nháp', 's1', 34, true),
               ('QT vai trò', 's1', 36, true)) x(journey, step, campaign, active)
  JOIN auto_journeys j ON j.name = x.journey;

\echo '== managed campaign of a running journey'
UPDATE auto_campaigns SET status = 'đang chạy' WHERE id = 10;
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 10;
UPDATE auto_campaigns SET status = 'chờ xử lý' WHERE id = 10;
SELECT fixture_assert(fixture_n(10) = 0, 'running, completed, queued again: nothing recorded');
UPDATE auto_campaigns SET status = 'đang chạy' WHERE id = 10;
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 10;
UPDATE auto_campaigns SET status = 'chờ xử lý' WHERE id = 10;
UPDATE auto_campaigns SET status = 'đang chạy' WHERE id = 10;
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 10;
SELECT fixture_assert(fixture_n(10) = 0, 'repeated reopen cycles by the engine stay silent');
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id = 10;
SELECT fixture_assert(fixture_n(10, 'tạm dừng') = 1 AND fixture_n(10) = 1
                      AND (SELECT severity FROM auto_notifications WHERE campaign_id = 10) = 'warning',
                      'pause is still notified, as a warning');
UPDATE auto_notification_subscriptions SET filters = jsonb_set(filters, '{toStatuses}', (filters -> 'toStatuses') || '["lỗi"]')
 WHERE staff_id = 1 AND event_type = 'campaign.status_changed';
UPDATE auto_campaigns SET status = 'lỗi' WHERE id = 10;
SELECT fixture_assert(fixture_n(10, 'lỗi') = 1, 'error status (if subscribed) is still notified');
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 31;
SELECT fixture_assert(fixture_n(31) = 0, 'campaign of an older version of a running journey (still draining) stays silent');

\echo '== managed campaign of a paused journey'
UPDATE auto_campaigns SET status = 'đang chạy' WHERE id = 11;
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 11;
SELECT fixture_assert(fixture_n(11) = 0, 'running and completed while the journey is paused: nothing recorded');
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id = 11;
SELECT fixture_assert(fixture_n(11, 'tạm dừng') = 1 AND fixture_n(11) = 1, 'pause is still notified');

\echo '== campaigns that behave as before'
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id IN (32, 33, 34, 35);
SELECT fixture_assert(fixture_n(32, 'hoàn thành') = 1, 'stopped journey: completion is notified');
SELECT fixture_assert(fixture_n(33, 'hoàn thành') = 1, 'deleted journey: completion is notified');
SELECT fixture_assert(fixture_n(34, 'hoàn thành') = 1, 'draft journey: completion is notified');
SELECT fixture_assert(fixture_n(35, 'hoàn thành') = 1, 'ordinary campaign: completion is notified');
SELECT fixture_assert((SELECT payload ->> 'source' FROM auto_notifications WHERE campaign_id = 35) = 'system'
                      AND (SELECT severity FROM auto_notifications WHERE campaign_id = 35) = 'info',
                      'ordinary completion keeps payload source and severity');

\echo '== journey status changes take effect at once'
UPDATE auto_journeys SET status = 'paused', paused_at = now() WHERE name = 'QT đang chạy';
UPDATE auto_campaigns SET status = 'chờ xử lý' WHERE id = 10;
SELECT fixture_assert(fixture_n(10, 'chờ xử lý') = 0, 'journey paused: queued again is not recorded');
UPDATE auto_journeys SET status = 'stopped', stopped_at = now() WHERE name = 'QT đang chạy';
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 10;
SELECT fixture_assert(fixture_n(10, 'hoàn thành') = 1, 'journey stopped: the campaign is an ordinary campaign again');

\echo '== callers: Desktop, Chat API, Server (journey tables stay closed to them)'
SET ROLE aka_agent_desktop;
SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"11111111-1111-4111-8111-111111111111"}';
UPDATE public.auto_campaigns SET status = 'hoàn thành' WHERE id = 36;
UPDATE public.auto_campaigns SET status = 'chờ xử lý' WHERE id = 35;
DO $$
BEGIN
  PERFORM 1 FROM public.auto_journey_step_campaigns LIMIT 1;
  RAISE EXCEPTION 'FAIL: desktop can read auto_journey_step_campaigns';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET request.jwt.claims;
RESET ROLE;
SELECT fixture_assert((SELECT status FROM auto_campaigns WHERE id = 36) = 'hoàn thành' AND fixture_n(36) = 0,
                      'desktop completes a managed campaign: update succeeds, nothing recorded');
SELECT fixture_assert((SELECT payload ->> 'source' FROM auto_notifications WHERE campaign_id = 35 AND payload ->> 'toStatus' = 'chờ xử lý') = 'desktop',
                      'desktop change of an ordinary campaign is recorded with source desktop');
SELECT fixture_assert(NOT has_table_privilege('aka_agent_desktop', 'public.auto_journey_step_campaigns', 'SELECT')
                      AND NOT has_table_privilege('aka_agent_chat_api', 'public.auto_journeys', 'SELECT'),
                      'Desktop and Chat API still have no access to the journey tables');
SET ROLE aka_agent_chat_api;
UPDATE public.auto_campaigns SET status = 'chờ xử lý' WHERE id = 36;
UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = 35;
RESET ROLE;
SELECT fixture_assert(fixture_n(36) = 0 AND (SELECT payload ->> 'source' FROM auto_notifications WHERE campaign_id = 35 AND payload ->> 'toStatus' = 'đang chạy') = 'chat_api',
                      'Chat API: managed stays silent, ordinary recorded with source chat_api');
SET ROLE service_role;
UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = 36;
UPDATE public.auto_campaigns SET status = 'tạm dừng' WHERE id = 35;
UPDATE public.auto_campaigns SET status = 'tạm dừng' WHERE id = 36;
RESET ROLE;
SELECT fixture_assert(fixture_n(36, 'đang chạy') = 0 AND fixture_n(36, 'tạm dừng') = 1
                      AND (SELECT payload ->> 'source' FROM auto_notifications WHERE campaign_id = 36) = 'server',
                      'Server (service_role): managed running stays silent, its pause is recorded with source server');

\echo '== journey tables missing (V473 rolled back): behaves as before, cached plan does not fail'
UPDATE auto_campaigns SET status = 'đang chạy' WHERE id = 36;
BEGIN;
DROP TABLE public.auto_journey_step_campaigns, public.auto_journeys;
UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 36;
SELECT fixture_assert(fixture_n(36, 'hoàn thành') = 1, 'completion of the former managed campaign is notified, no error');
ROLLBACK;
SELECT fixture_assert(to_regclass('public.auto_journeys') IS NOT NULL AND fixture_n(36, 'hoàn thành') = 0, 'rolled back the drop');

\echo '== nothing else changed'
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE campaign_id IN (10, 11, 31, 36)
                        AND payload ->> 'toStatus' NOT IN ('tạm dừng', 'lỗi', 'hoàn thành')) = 0,
                      'no running/queued notification for any managed campaign while its journey ran or was paused');
\echo 'PASS'

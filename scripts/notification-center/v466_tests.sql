-- V466 behaviour checks. Run after setup.sql + V457 + V466 on a disposable cluster (see smoke_v466.sh).
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
-- Empty the queue the way a finished worker run would (render/delivery details are covered by tests.sql).
CREATE FUNCTION public.fixture_drain() RETURNS void LANGUAGE sql AS $$
  UPDATE public.auto_notifications SET content_status = 'suppressed' WHERE content_status IN ('pending', 'rendering');
  UPDATE public.auto_notification_deliveries SET status = 'cancelled' WHERE status IN ('pending', 'retrying', 'sending');
  UPDATE private.aka_agent_notification_dispatch_state SET leased_until = NULL WHERE id = 1;
$$;
\set QUIET 0
\pset tuples_only on
\pset format unaligned

\echo '== defaults keep the pg_net path'
SELECT fixture_assert((SELECT value FROM auto_system_settings WHERE key = 'notifications.dispatch_mode') = 'pg_net', 'dispatch_mode starts as pg_net');
SET ROLE service_role;
SELECT fixture_assert(public.aka_agent_notification_tick() = '{"run": false, "enabled": false}'::jsonb, 'tick is idle while the center is disabled');
RESET ROLE;
UPDATE auto_system_settings SET value = 'true' WHERE key = 'notifications.enabled';
UPDATE auto_notification_subscriptions SET next_run_at = now() - interval '3 hours' WHERE staff_id = 1 AND event_type = 'report.scheduled';
SET ROLE service_role;
SELECT fixture_assert(public.aka_agent_notification_tick() = '{"run": false, "mode": "pg_net", "enabled": true}'::jsonb, 'tick is idle in pg_net mode');
RESET ROLE;
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE event_type = 'report.scheduled') = 0, 'tick does not schedule reports in pg_net mode');
INSERT INTO private.fixture_vault VALUES ('AKA_AGENT_NOTIFICATION_DISPATCH_URL', 'https://agent.example/internal/notifications/dispatch'),
                                         ('AKA_AGENT_NOTIFICATION_DISPATCH_TOKEN', 'secret-token');
SELECT fixture_assert((SELECT (r ->> 'reports')::int = 1 AND r ->> 'requestId' IS NOT NULL FROM (SELECT public.aka_agent_notification_dispatch() r) x),
                      'pg_net dispatch schedules and calls the worker as before');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE event_type = 'report.scheduled') = 1, 'pg_net path inserted the report');
SELECT public.fixture_drain();

\echo '== fly mode: DB stops scheduling and calling out'
UPDATE auto_system_settings SET value = 'fly' WHERE key = 'notifications.dispatch_mode';
UPDATE auto_notification_subscriptions SET next_run_at = now() - interval '2 hours' WHERE staff_id = 1 AND event_type = 'report.scheduled';
SELECT fixture_assert(public.aka_agent_notification_dispatch() = '{"mode": "fly", "enabled": true}'::jsonb, 'dispatch exits early in fly mode');
SELECT public.aka_agent_data_group_background_tick();
SELECT fixture_assert((SELECT count(*) FROM private.fixture_http_calls) = 1, 'no pg_net call in fly mode');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE event_type = 'report.scheduled') = 1
                      AND (SELECT next_run_at < now() FROM auto_notification_subscriptions WHERE staff_id = 1 AND event_type = 'report.scheduled'),
                      'background tick leaves the due report to Fly');
SELECT fixture_assert((SELECT count(*) FROM private.fixture_tick_calls) = 2, 'background tick still runs the data group workers');

\echo '== fly mode: tick schedules, leases and releases'
SET ROLE service_role;
SELECT fixture_assert((SELECT r ->> 'run' = 'true' AND (r ->> 'reports')::int = 1 AND r ->> 'mode' = 'fly' FROM (SELECT public.aka_agent_notification_tick() r) x),
                      'tick schedules the due report and grants one run');
RESET ROLE;
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE event_type = 'report.scheduled') = 2
                      AND (SELECT next_run_at > now() FROM auto_notification_subscriptions WHERE staff_id = 1 AND event_type = 'report.scheduled'),
                      'report inserted once and next run moved forward');
SELECT fixture_assert((SELECT leased_until > now() + interval '50 seconds' AND last_request_id IS NULL FROM private.aka_agent_notification_dispatch_state),
                      'run holds the shared 60 second lease');
SET ROLE service_role;
SELECT fixture_assert(public.aka_agent_notification_tick() ->> 'busy' = 'true', 'lease blocks an overlapping run');
SELECT public.aka_agent_notification_worker('release') \g /dev/null
SELECT fixture_assert(public.aka_agent_notification_tick() ->> 'run' = 'true', 'worker release allows the next run');
RESET ROLE;
SELECT public.fixture_drain();
SET ROLE service_role;
SELECT fixture_assert((SELECT r ->> 'run' = 'false' AND r ->> 'work' = 'false' FROM (SELECT public.aka_agent_notification_tick() r) x), 'no work, no run');
RESET ROLE;
UPDATE auto_system_settings SET value = ' Fly ' WHERE key = 'notifications.dispatch_mode';
SELECT fixture_assert(public.aka_agent_notification_dispatch() ->> 'mode' = 'fly', 'mode value is trimmed and case-insensitive');
UPDATE auto_system_settings SET value = 'fly' WHERE key = 'notifications.dispatch_mode';

\echo '== fly mode: hourly cleanup'
UPDATE private.aka_agent_notification_dispatch_state SET last_cleanup_at = now() - interval '2 hours';
INSERT INTO auto_notifications (organization_id, staff_id, event_type, entity_key, dedupe_key, content_status, created_at)
VALUES (1, 1, 'system.test', 'test:old', 'fixture-old-1', 'ready', now() - interval '200 days');
SET ROLE service_role;
SELECT fixture_assert((public.aka_agent_notification_tick() -> 'cleanup' ->> 'notifications')::int = 1, 'tick runs the hourly cleanup');
SELECT fixture_assert(public.aka_agent_notification_tick() ->> 'cleanup' IS NULL, 'cleanup runs at most once per hour');
RESET ROLE;

\echo '== privileges'
SET ROLE anon;
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_tick()$$) LIKE '42501:%', 'anon cannot tick');
RESET ROLE;
SET ROLE authenticated;
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_tick()$$) LIKE '42501:%', 'authenticated cannot tick');
RESET ROLE;
SET ROLE aka_agent_desktop;
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_tick()$$) LIKE '42501:%', 'desktop token cannot tick');
RESET ROLE;
SET ROLE aka_agent_chat_api;
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_tick()$$) LIKE '42501:%', 'chat api cannot tick');
RESET ROLE;
SET ROLE service_role;
SELECT fixture_assert(fixture_error($$SELECT public.aka_agent_notification_dispatch()$$) LIKE '42501:%', 'service_role still cannot call dispatch');
RESET ROLE;

\echo '== switch back to pg_net'
UPDATE auto_system_settings SET value = 'pg_net' WHERE key = 'notifications.dispatch_mode';
UPDATE auto_notification_subscriptions SET next_run_at = now() - interval '1 hour' WHERE staff_id = 1 AND event_type = 'report.scheduled';
SET ROLE service_role;
SELECT fixture_assert(public.aka_agent_notification_tick() ->> 'run' = 'false', 'tick goes idle again');
RESET ROLE;
SELECT fixture_assert((SELECT (r ->> 'reports')::int = 1 AND r ->> 'requestId' IS NOT NULL FROM (SELECT public.aka_agent_notification_dispatch() r) x),
                      'pg_net dispatch resumes immediately');
SELECT fixture_assert((SELECT count(*) FROM private.fixture_http_calls) = 2, 'second pg_net call recorded');
DROP FUNCTION public.fixture_drain();
DROP FUNCTION public.fixture_assert(boolean, text);
DROP FUNCTION public.fixture_error(text);
SELECT 'PASS';

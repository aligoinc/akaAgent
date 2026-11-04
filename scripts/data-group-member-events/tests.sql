-- V458 behaviour checks. Run by smoke.sh after setup.sql, the live core body and the migration.
\set ON_ERROR_STOP 1
\set QUIET 1
CREATE FUNCTION public.fixture_assert(p_ok boolean, p_message text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_message; END IF;
  RETURN 'ok  - ' || p_message;
END $$;
CREATE FUNCTION private.fixture_queue(VARIADIC p_ids bigint[]) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.auto_account_contact_dynamic_filter_queue (contact_id, staff_id, organization_id, queued_at, last_event_at)
  SELECT id, 1, 1, clock_timestamp() - interval '1 minute', clock_timestamp() FROM unnest(p_ids) AS id
  ON CONFLICT (contact_id) DO UPDATE SET queued_at = EXCLUDED.queued_at, last_event_at = EXCLUDED.last_event_at, attempt_count = 0
$$;
CREATE FUNCTION private.fixture_run() RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.aka_agent_process_data_group_dynamic_filters_core(1, 1, 50)
$$;
CREATE FUNCTION private.fixture_block_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'fixture blocks notifications'; END $$;
SET client_min_messages = error;
\set QUIET 0
\pset tuples_only on
\pset format unaligned

\echo '== switches off: membership only'
INSERT INTO private.fixture_scope_matches VALUES (800, 1001, 'enter', true), (800, 1002, 'enter', true), (800, 1003, 'enter', false);
SELECT private.fixture_queue(1001, 1002, 1003) \g /dev/null
SELECT fixture_assert((private.fixture_run() ->> 'entered_count')::int = 2, 'two contacts enter group 700');
SELECT fixture_assert((SELECT count(*) FROM auto_account_contact_group_members WHERE group_id = 700 AND NOT is_delete) = 2, 'members written');
SELECT fixture_assert((SELECT count(*) FROM auto_data_group_member_events) = 0, 'no events while both switches are off');

\echo '== member events only (notification center off)'
UPDATE auto_system_settings SET value = 'true' WHERE key = 'notifications.member_events.enabled';
UPDATE private.fixture_scope_matches SET matches = true WHERE filter_id = 800 AND contact_id = 1003;
SELECT private.fixture_queue(1003) \g /dev/null
SELECT fixture_assert((private.fixture_run() ->> 'entered_count')::int = 1, 'third contact enters');
SELECT fixture_assert(count(*) = 1 AND bool_and(action = 'added' AND staff_id = 1 AND organization_id = 1 AND group_id = 700
         AND dynamic_filter_id = 800 AND filter_revision = 3 AND contact_id = 1003 AND contact_label = 'Minh' AND run_id IS NOT NULL
         AND group_total_after = 3 AND membership_id = (SELECT id FROM auto_account_contact_group_members WHERE group_id = 700 AND contact_id = 1003)),
       'added event carries label, filter revision, membership and total after')
  FROM auto_data_group_member_events;
SELECT fixture_assert((SELECT filter_summary FROM auto_data_group_member_events LIMIT 1)
         = 'Vào: Tag Zalo chứa VIP, Quan tâm hoặc Trạng thái kết bạn Zalo bằng Bạn bè · Rời: Tag akaBiz chứa Đã mua', 'readable filter summary');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE event_type = 'data_group.membership_changed') = 0,
                      'no notification while the center is off');

\echo '== notifications: one per recipient, group and bucket'
UPDATE auto_system_settings SET value = 'true' WHERE key = 'notifications.enabled';
INSERT INTO auto_notification_subscriptions (staff_id, organization_id, event_type, scope, is_enabled, email_enabled, push_enabled, filters) VALUES
  (1, 1, 'data_group.membership_changed', 'own', true, true, false, '{"groupIds":null,"actions":["added","removed"],"bucketMinutes":5,"includeSharedGroups":false}'),
  (2, 1, 'data_group.membership_changed', 'own', true, true, false, '{"groupIds":null,"actions":["added","removed"],"bucketMinutes":15,"includeSharedGroups":false}');
INSERT INTO private.fixture_scope_matches VALUES (800, 1002, 'leave', true);
SELECT private.fixture_queue(1002) \g /dev/null
SELECT fixture_assert((private.fixture_run() ->> 'exited_count')::int = 1, 'contact matching the leave rule exits');
SELECT fixture_assert((SELECT contact_label FROM auto_data_group_member_events WHERE action = 'removed') = '091****678',
                      'unnamed contact shows a masked phone');
UPDATE private.fixture_scope_matches SET matches = false WHERE filter_id = 800 AND contact_id = 1002 AND scope = 'leave';
SELECT private.fixture_queue(1002) \g /dev/null
SELECT fixture_assert((private.fixture_run() ->> 'entered_count')::int = 1, 'contact re-enters');
SELECT fixture_assert(
  (SELECT count(*) FROM auto_notifications WHERE event_type = 'data_group.membership_changed' AND staff_id = 1 AND data_group_id = 700)
  = (SELECT count(DISTINCT date_bin(interval '5 minutes', occurred_at, timestamptz '2000-01-03 00:00:00+07'))
       FROM auto_data_group_member_events WHERE group_id = 700 AND contact_id = 1002), 'one notification per 5-minute bucket');
SELECT fixture_assert((SELECT sum((payload ->> 'added')::int) = 1 AND sum((payload ->> 'removed')::int) = 1
         AND bool_and(dedupe_key LIKE 'dg:1:700:5:%' AND entity_key = 'group:700' AND content_status = 'pending' AND severity = 'info'
                      AND organization_id = 1 AND dynamic_filter_id = 800 AND payload ->> 'groupName' = 'Khách VIP quan tâm'
                      AND deliver_after = (payload ->> 'to')::timestamptz + interval '30 seconds'
                      AND (payload ->> 'to')::timestamptz - (payload ->> 'from')::timestamptz = interval '5 minutes')
       FROM auto_notifications WHERE event_type = 'data_group.membership_changed' AND staff_id = 1 AND data_group_id = 700),
       'counts merge into the bucket notification, delivered 30 s after the bucket ends');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE staff_id = 2 AND event_type = 'data_group.membership_changed') = 0,
                      'staff without access to the group gets nothing');

\echo '== shared recipients and filters'
INSERT INTO auto_data_group_recipients VALUES (701, 2);
INSERT INTO private.fixture_scope_matches VALUES (801, 1001, 'enter', true);
SELECT private.fixture_queue(1001) \g /dev/null
SELECT fixture_assert((private.fixture_run() ->> 'entered_count')::int = 1, 'contact enters shared group 701');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE staff_id = 1 AND data_group_id = 701) >= 1, 'owner notified for the shared group');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE staff_id = 2) = 0, 'recipient not notified while includeSharedGroups is off');
UPDATE auto_notification_subscriptions SET filters = filters || '{"includeSharedGroups":true}'
 WHERE staff_id = 2 AND event_type = 'data_group.membership_changed';
INSERT INTO private.fixture_scope_matches VALUES (801, 1003, 'enter', true);
SELECT private.fixture_queue(1003) \g /dev/null
SELECT private.fixture_run() \g /dev/null
SELECT fixture_assert((SELECT count(*) = 1 AND bool_and((payload ->> 'shared')::boolean AND dedupe_key LIKE 'dg:2:701:15:%' AND organization_id = 1
                                 AND (payload ->> 'to')::timestamptz - (payload ->> 'from')::timestamptz = interval '15 minutes')
                         FROM auto_notifications WHERE staff_id = 2 AND data_group_id = 701),
                      'shared recipient notified in their own 15-minute bucket');
UPDATE auto_notification_subscriptions SET filters = filters || '{"groupIds":[700]}' WHERE staff_id = 1 AND event_type = 'data_group.membership_changed';
CREATE TEMP TABLE before_701 AS SELECT id, payload FROM auto_notifications WHERE staff_id = 1 AND data_group_id = 701;
UPDATE private.fixture_scope_matches SET matches = false WHERE filter_id = 801 AND contact_id = 1001;
SELECT private.fixture_queue(1001) \g /dev/null
SELECT fixture_assert((private.fixture_run() ->> 'exited_count')::int = 1, 'contact leaves group 701');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE staff_id = 1 AND data_group_id = 701) = (SELECT count(*) FROM before_701)
         AND NOT EXISTS (SELECT 1 FROM auto_notifications n JOIN before_701 b ON b.id = n.id WHERE n.payload IS DISTINCT FROM b.payload),
       'group outside groupIds is ignored');
UPDATE auto_notification_subscriptions SET filters = filters || '{"actions":["added"]}' WHERE staff_id = 1 AND event_type = 'data_group.membership_changed';
CREATE TEMP TABLE before_700 AS SELECT count(*) AS n, coalesce(sum((payload ->> 'removed')::int), 0) AS removed
  FROM auto_notifications WHERE staff_id = 1 AND data_group_id = 700;
INSERT INTO private.fixture_scope_matches VALUES (800, 1001, 'leave', true);
SELECT private.fixture_queue(1001) \g /dev/null
SELECT fixture_assert((private.fixture_run() ->> 'exited_count')::int = 1, 'removal is still applied to the group');
SELECT fixture_assert((SELECT count(*) FROM auto_notifications WHERE staff_id = 1 AND data_group_id = 700) = (SELECT n FROM before_700)
         AND (SELECT coalesce(sum((payload ->> 'removed')::int), 0) FROM auto_notifications WHERE staff_id = 1 AND data_group_id = 700)
             = (SELECT removed FROM before_700), 'removal not notified when only "added" is chosen');

\echo '== failures never break the filter run'
UPDATE auto_notification_subscriptions SET filters = '{"groupIds":null,"actions":["added","removed"],"bucketMinutes":5,"includeSharedGroups":false}'
 WHERE staff_id = 1 AND event_type = 'data_group.membership_changed';
ALTER TABLE auto_data_group_member_events ADD CONSTRAINT fixture_block CHECK (contact_id < 0) NOT VALID;
CREATE TEMP TABLE events_before AS SELECT count(*) AS n FROM auto_data_group_member_events;
UPDATE private.fixture_scope_matches SET matches = false WHERE filter_id = 800 AND contact_id = 1001 AND scope = 'leave';
SELECT private.fixture_queue(1001) \g /dev/null
SELECT fixture_assert((private.fixture_run() ->> 'entered_count')::int = 1, 'membership commits even when the event insert fails');
SELECT fixture_assert((SELECT count(*) FROM auto_data_group_member_events) = (SELECT n FROM events_before), 'failed event is skipped');
SELECT fixture_assert((SELECT NOT is_delete FROM auto_account_contact_group_members WHERE group_id = 700 AND contact_id = 1001), 'member is back in the group');
ALTER TABLE auto_data_group_member_events DROP CONSTRAINT fixture_block;
CREATE TRIGGER fixture_block BEFORE INSERT OR UPDATE ON auto_notifications FOR EACH ROW EXECUTE FUNCTION private.fixture_block_notification();
UPDATE private.fixture_scope_matches SET matches = true WHERE filter_id = 800 AND contact_id = 1001 AND scope = 'leave';
SELECT private.fixture_queue(1001) \g /dev/null
SELECT fixture_assert((private.fixture_run() ->> 'exited_count')::int = 1, 'run commits even when the notification capture fails');
SELECT fixture_assert((SELECT count(*) FROM auto_data_group_member_events) = (SELECT n FROM events_before) + 1, 'event kept when capture fails');
DROP TRIGGER fixture_block ON auto_notifications;
CREATE TEMP TABLE events_mid AS SELECT count(*) AS n FROM auto_data_group_member_events;
UPDATE private.fixture_scope_matches SET matches = false WHERE filter_id = 800 AND contact_id = 1001 AND scope = 'leave';
SELECT private.fixture_queue(999, 1001) \g /dev/null
SELECT fixture_assert((r ->> 'processed_contact_count')::int = 1 AND (r ->> 'entered_count')::int = 1, 'other contacts still processed')
  FROM (SELECT private.fixture_run() AS r) x;
SELECT fixture_assert((SELECT attempt_count = 1 AND last_error = 'fixture scope failure' FROM auto_account_contact_dynamic_filter_queue WHERE contact_id = 999)
         AND NOT EXISTS (SELECT 1 FROM auto_data_group_member_events WHERE contact_id = 999)
         AND (SELECT count(*) FROM auto_data_group_member_events) = (SELECT n FROM events_mid) + 1,
       'failing contact is retried later without events');

\echo '== snapshot and render'
SELECT fixture_assert((s ->> 'found')::boolean AND (s #>> '{changes,added}')::int + (s #>> '{changes,removed}')::int >= 1
         AND s #>> '{changes,filterSummary}' LIKE 'Vào: Tag Zalo chứa VIP%' AND jsonb_array_length(s #> '{changes,samples}') >= 1
         AND (s #>> '{group,name}') = 'Khách VIP quan tâm', 'snapshot reads events of the bucket window')
  FROM (SELECT public.aka_agent_notification_snapshot('data_group', jsonb_build_object('staffId', 1, 'groupId', 700,
                 'from', n.payload ->> 'from', 'to', n.payload ->> 'to')) AS s
          FROM auto_notifications n WHERE n.staff_id = 1 AND n.data_group_id = 700 ORDER BY n.id DESC LIMIT 1) x;
SET ROLE service_role;
SELECT fixture_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.aka_agent_notification_worker('claim_render', '{"limit": 50}') -> 'items') x
                                   WHERE x ->> 'eventType' = 'data_group.membership_changed'), 'bucket notification waits for its window to close');
RESET ROLE;
UPDATE auto_notifications SET deliver_after = now() - interval '1 second' WHERE event_type = 'data_group.membership_changed';
SET ROLE service_role;
SELECT fixture_assert(count(*) >= 2 AND bool_and((x ->> 'dataGroupId')::bigint = (x #>> '{payload,groupId}')::bigint
                                                 AND x #>> '{payload,from}' IS NOT NULL AND x #>> '{payload,to}' IS NOT NULL),
                      'due bucket notifications are claimed for rendering with their window')
  FROM jsonb_array_elements(public.aka_agent_notification_worker('claim_render', '{"limit": 50}') -> 'items') x
 WHERE x ->> 'eventType' = 'data_group.membership_changed';
RESET ROLE;
\echo 'PASS'

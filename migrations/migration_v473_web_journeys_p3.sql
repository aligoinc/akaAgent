-- V473 phần 3/4: Quy trình tự động trên Web (bộ máy: khóa thuê, nhận khách, thu kết quả, giao khách), production cgjbsmqtfhqvttudyjzq only.
-- Apply sau p2, trước p4; mỗi phần một giao dịch. Hợp đồng và lý do tách: đầu migration_v473_web_journeys_p1.sql.
-- Rollback (gỡ cả bốn phần): migrations/rollback_v473_web_journeys.sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Phần trước phải đã commit (hàm cuối của nó có mặt); phần này chưa chạy (hàm đầu của nó chưa có).
DO $guard_p3$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'private' AND p.proname = 'aka_agent_journey_ctl_catalog_campaigns') THEN
    RAISE EXCEPTION 'v473_p3_requires_p2';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'private' AND p.proname = 'aka_agent_journey_engine_lease') THEN
    RAISE EXCEPTION 'v473_p3_already_applied_do_not_overwrite';
  END IF;
END
$guard_p3$;

-- ---------------------------------------------------------------------------------------------------------
-- Engine
-- ---------------------------------------------------------------------------------------------------------
-- Every action after tick needs the unexpired lease token; it extends the lease by 60 seconds.
CREATE FUNCTION private.aka_agent_journey_engine_lease(p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_token uuid;
BEGIN
  IF jsonb_typeof(p_payload -> 'token') = 'string'
     AND (p_payload ->> 'token') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_token := (p_payload ->> 'token')::uuid;
  END IF;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'journey_lease_lost';
  END IF;
  UPDATE public.auto_journey_engine_state
  SET lease_until = now() + interval '60 seconds', updated_at = now()
  WHERE id = 1 AND lease_token = v_token AND lease_until > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_lease_lost';
  END IF;
  RETURN v_token;
END
$function$;

CREATE FUNCTION private.aka_agent_journey_engine_tick() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_flag jsonb := private.aka_agent_journey_setting('journeys.engine_enabled');
  v_enabled boolean;
  v_active integer;
  st public.auto_journey_engine_state%ROWTYPE;
  v_token uuid;
BEGIN
  -- Missing or unreadable switch = enabled; only an explicit {"enabled":false} stops the engine.
  v_enabled := NOT (jsonb_typeof(v_flag) = 'object' AND jsonb_typeof(v_flag -> 'enabled') = 'boolean'
    AND NOT (v_flag ->> 'enabled')::boolean);
  SELECT * INTO st FROM public.auto_journey_engine_state WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.auto_journey_engine_state (id) VALUES (1) RETURNING * INTO st;
  END IF;
  IF NOT v_enabled THEN
    UPDATE public.auto_journey_engine_state SET last_tick_at = now(), updated_at = now() WHERE id = 1;
    RETURN jsonb_build_object('run', false, 'enabled', false);
  END IF;
  SELECT count(*) INTO v_active FROM public.auto_journeys WHERE status = 'active' AND is_delete = false;
  IF v_active = 0 THEN
    UPDATE public.auto_journey_engine_state SET last_tick_at = now(), updated_at = now() WHERE id = 1;
    RETURN jsonb_build_object('run', false, 'enabled', true, 'active', 0);
  END IF;
  IF st.lease_token IS NOT NULL AND st.lease_until > now() THEN
    UPDATE public.auto_journey_engine_state SET last_tick_at = now(), updated_at = now() WHERE id = 1;
    RETURN jsonb_build_object('run', false, 'enabled', true, 'busy', true, 'active', v_active);
  END IF;
  v_token := gen_random_uuid();
  UPDATE public.auto_journey_engine_state
  SET lease_token = v_token, lease_until = now() + interval '60 seconds', last_tick_at = now(), updated_at = now()
  WHERE id = 1;
  RETURN jsonb_build_object('run', true, 'enabled', true, 'token', v_token, 'active', v_active,
    'cleanupDue', st.last_cleanup_at IS NULL OR st.last_cleanup_at < now() - interval '1 hour');
END
$function$;

CREATE FUNCTION private.aka_agent_journey_engine_release(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_token uuid := private.aka_agent_journey_engine_lease(p_payload);
  v_error text := CASE WHEN jsonb_typeof(p_payload -> 'error') = 'string' THEN left(p_payload ->> 'error', 1000) END;
BEGIN
  UPDATE public.auto_journey_engine_state
  SET lease_token = NULL, lease_until = NULL, last_run_at = now(),
      last_error = coalesce(v_error, last_error), last_error_at = CASE WHEN v_error IS NULL THEN last_error_at ELSE now() END,
      updated_at = now()
  WHERE id = 1 AND lease_token = v_token;
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- Retention in small batches, at most once an hour. Events/step runs walk the oldest ids only.
CREATE FUNCTION private.aka_agent_journey_engine_cleanup(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_last timestamptz;
  v_events integer := 0;
  v_runs integer := 0;
  v_enrollments integer := 0;
BEGIN
  PERFORM private.aka_agent_journey_engine_lease(p_payload);
  SELECT last_cleanup_at INTO v_last FROM public.auto_journey_engine_state WHERE id = 1;
  IF v_last IS NOT NULL AND v_last > now() - interval '1 hour' THEN
    RETURN jsonb_build_object('events', 0, 'runs', 0, 'enrollments', 0, 'skipped', true);
  END IF;
  WITH w AS (SELECT ev.id, ev.created_at FROM public.auto_journey_events ev ORDER BY ev.id LIMIT 5000),
  d AS (DELETE FROM public.auto_journey_events ev USING w WHERE ev.id = w.id AND w.created_at < now() - interval '90 days' RETURNING 1)
  SELECT count(*) INTO v_events FROM d;
  WITH w AS (SELECT r.id, r.status, r.settled_at FROM public.auto_journey_step_runs r ORDER BY r.id LIMIT 5000),
  d AS (DELETE FROM public.auto_journey_step_runs r USING w
        WHERE r.id = w.id AND w.status = 'settled' AND w.settled_at < now() - interval '90 days' RETURNING 1)
  SELECT count(*) INTO v_runs FROM d;
  WITH c AS (
    SELECT e.id FROM public.auto_journey_enrollments e
    WHERE e.status <> 'active' AND e.finished_at < now() - interval '180 days'
    ORDER BY e.finished_at LIMIT 500
  ), d AS (DELETE FROM public.auto_journey_enrollments e USING c WHERE e.id = c.id RETURNING 1)
  SELECT count(*) INTO v_enrollments FROM d;
  UPDATE public.auto_journey_engine_state SET last_cleanup_at = now(), updated_at = now() WHERE id = 1;
  RETURN jsonb_build_object('events', v_events, 'runs', v_runs, 'enrollments', v_enrollments);
END
$function$;

-- Next results of a campaign after the cursor, for the given statuses. The existing index is
-- (campaign_id, status, action_code, created_at DESC) WHERE is_delete = false, so each (status, action code)
-- pair is read as its own created_at range; distinct action codes come from a loose index scan.
CREATE FUNCTION private.aka_agent_journey_detail_page(p_campaign_id bigint, p_statuses text[], p_cursor_ts timestamptz,
  p_cursor_id bigint, p_limit integer, p_horizon timestamptz)
RETURNS TABLE(id bigint, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_status text;
  v_code text;
  v_ts timestamptz := coalesce(p_cursor_ts, '-infinity'::timestamptz);
  v_id bigint := coalesce(p_cursor_id, 0);
  v_probes integer := 0;
BEGIN
  FOREACH v_status IN ARRAY coalesce(p_statuses, '{}'::text[]) LOOP
    RETURN QUERY
      SELECT d.id, d.created_at FROM public.auto_campaign_details d
      WHERE d.campaign_id = p_campaign_id AND d.status = v_status AND d.is_delete = false AND d.action_code IS NULL
        AND d.created_at >= v_ts AND d.created_at < p_horizon AND (d.created_at, d.id) > (v_ts, v_id)
      ORDER BY d.created_at, d.id
      LIMIT p_limit;
    v_code := NULL;
    LOOP
      v_probes := v_probes + 1;
      EXIT WHEN v_probes > 200;
      IF v_code IS NULL THEN
        SELECT min(d.action_code) INTO v_code FROM public.auto_campaign_details d
        WHERE d.campaign_id = p_campaign_id AND d.status = v_status AND d.is_delete = false AND d.action_code IS NOT NULL;
      ELSE
        SELECT min(d.action_code) INTO v_code FROM public.auto_campaign_details d
        WHERE d.campaign_id = p_campaign_id AND d.status = v_status AND d.is_delete = false AND d.action_code > v_code;
      END IF;
      EXIT WHEN v_code IS NULL;
      RETURN QUERY
        SELECT d.id, d.created_at FROM public.auto_campaign_details d
        WHERE d.campaign_id = p_campaign_id AND d.status = v_status AND d.is_delete = false AND d.action_code = v_code
          AND d.created_at >= v_ts AND d.created_at < p_horizon AND (d.created_at, d.id) > (v_ts, v_id)
        ORDER BY d.created_at, d.id
        LIMIT p_limit;
    END LOOP;
  END LOOP;
END
$function$;

-- Ingest: new customers by cursor; stop/mark sources first; ≤ budget rows in total, ≤ 500 per source.
CREATE FUNCTION private.aka_agent_journey_engine_ingest(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_budget integer := least(greatest(coalesce(private.aka_agent_journey_bigint(p_payload -> 'budget'), 1000), 1), 5000)::integer;
  v_left integer;
  -- Rows younger than this may belong to transactions that have not committed yet; read them next time.
  v_horizon timestamptz := now() - interval '3 minutes';
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_source_ids bigint[];
  v_source_id bigint;
  src public.auto_journey_sources%ROWTYPE;
  j public.auto_journeys%ROWTYPE;
  v_settings jsonb;
  v_reentry text;
  v_reentry_days integer;
  v_max_new bigint;
  v_stop_groups bigint[];
  v_day_count integer;
  v_day_start integer;
  v_limit integer;
  v_batch jsonb;
  v_fetched integer;
  v_rows integer;
  v_capped boolean;
  v_last_ts timestamptz;
  v_last_id bigint;
  v_source_name text;
  v_source_group_target boolean;
  r record;
  v_key text;
  v_candidate boolean;
  v_skip boolean;
  v_new_id bigint;
  v_n integer;
  v_exit_step text;
  v_scanned integer := 0;
  v_enrolled integer := 0;
  v_stopped integer := 0;
  v_marked integer := 0;
  v_skipped integer := 0;
  v_stats jsonb := '{}'::jsonb;
BEGIN
  PERFORM private.aka_agent_journey_engine_lease(p_payload);
  v_left := v_budget;
  v_source_ids := ARRAY(
    SELECT s.id FROM public.auto_journey_sources s
    JOIN public.auto_journeys jj ON jj.id = s.journey_id
    WHERE s.is_active AND jj.status = 'active' AND jj.is_delete = false
    ORDER BY CASE WHEN s.is_stop OR s.is_mark THEN 0 ELSE 1 END, s.last_scanned_at NULLS FIRST, s.id
    LIMIT 500);
  FOREACH v_source_id IN ARRAY v_source_ids LOOP
    EXIT WHEN v_left <= 0;
    -- A control action holding the journey (publish, pause…) wins; this source waits for the next tick.
    SELECT jj.* INTO j FROM public.auto_journeys jj
    WHERE jj.id = (SELECT s.journey_id FROM public.auto_journey_sources s WHERE s.id = v_source_id)
      AND jj.status = 'active' AND jj.is_delete = false
    FOR NO KEY UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    SELECT * INTO src FROM public.auto_journey_sources WHERE id = v_source_id AND is_active FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    SELECT v.settings INTO v_settings FROM public.auto_journey_versions v WHERE v.id = j.active_version_id;
    CONTINUE WHEN v_settings IS NULL;
    v_reentry := coalesce(v_settings -> 'reentry' ->> 'mode', 'never');
    v_reentry_days := least(greatest(coalesce(private.aka_agent_journey_bigint(v_settings -> 'reentry' -> 'days'), 30), 1), 3650)::integer;
    v_max_new := private.aka_agent_journey_bigint(v_settings -> 'maxNewPerDay');
    v_stop_groups := private.aka_agent_journey_bigint_array(v_settings -> 'stopGroupIds');
    v_day_count := CASE WHEN j.entry_day = v_today THEN j.entry_day_count ELSE 0 END;
    v_day_start := v_day_count;
    -- Daily cap already reached: the entry source waits for tomorrow without reading.
    IF src.is_entry AND v_max_new IS NOT NULL AND v_day_count >= v_max_new THEN
      UPDATE public.auto_journey_sources SET last_scanned_at = now() WHERE id = src.id;
      CONTINUE;
    END IF;
    v_limit := least(500, v_left);
    v_capped := false;
    v_rows := 0;
    v_last_ts := src.cursor_ts;
    v_last_id := src.cursor_id;

    IF src.kind = 'data_group' THEN
      SELECT g.name INTO v_source_name FROM public.auto_account_contact_groups g WHERE g.id = src.group_id;
      v_source_group_target := false;
      SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.row_ts, x.row_id), '[]'::jsonb) INTO v_batch
      FROM (
        SELECT m.updated_at AS row_ts, m.id AS row_id, m.id AS ref,
          private.aka_agent_journey_phone(coalesce(nullif(c.phone, ''), nullif(c.extra_data ->> 'phone', ''),
            CASE WHEN c.contact_type = 'phone' THEN c.uid END)) AS phone,
          CASE WHEN c.contact_type IN ('phone', 'email') THEN NULL ELSE nullif(btrim(c.uid), '') END AS uid,
          private.aka_agent_journey_email(coalesce(nullif(c.email, ''), nullif(c.extra_data ->> 'email', ''),
            CASE WHEN c.contact_type = 'email' THEN c.uid END)) AS email,
          c.name, c.extra_data ->> 'info1' AS info1, c.extra_data ->> 'info2' AS info2, c.extra_data ->> 'info3' AS info3,
          c.extra_data ->> 'info4' AS info4, c.extra_data ->> 'info5' AS info5,
          coalesce(c.extra_data ->> 'phone_carrier', c.extra_data ->> 'carrier') AS carrier,
          c.account_id, 'contact:' || c.id::text AS fallback_key,
          (c.is_delete IS TRUE OR c.organization_id IS DISTINCT FROM j.organization_id) AS invalid,
          NULL::text AS detail_status,
          -- Nhóm data có thể chứa nhóm/trang Facebook hoặc tag Zalo: không phải một người.
          coalesce(c.contact_type IN ('group', 'page', 'zalo_tag'), false) AS group_target
        FROM public.auto_account_contact_group_members m
        JOIN public.auto_account_contacts c ON c.id = m.contact_id
        WHERE m.group_id = src.group_id AND m.is_delete = false
          AND (m.updated_at, m.id) > (coalesce(src.cursor_ts, '-infinity'::timestamptz), src.cursor_id)
          AND m.updated_at < v_horizon
        ORDER BY m.updated_at, m.id
        LIMIT v_limit
      ) x;
    ELSE
      SELECT c.name, private.aka_agent_journey_non_person_action(c.action_id) INTO v_source_name, v_source_group_target
      FROM public.auto_campaigns c WHERE c.id = src.campaign_id;
      SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.row_ts, x.row_id), '[]'::jsonb) INTO v_batch
      FROM (
        SELECT p.created_at AS row_ts, p.id AS row_id, d.id AS ref,
          private.aka_agent_journey_phone(i.phone) AS phone, nullif(btrim(i.uid), '') AS uid,
          private.aka_agent_journey_email(i.email) AS email,
          i.name, i.info1, i.info2, i.info3, i.info4, i.info5, i.phone_carrier AS carrier,
          d.account_id, 'detail:' || d.id::text AS fallback_key, false AS invalid, d.status AS detail_status
        FROM private.aka_agent_journey_detail_page(src.campaign_id, src.statuses, src.cursor_ts, src.cursor_id, v_limit, v_horizon) p
        JOIN public.auto_campaign_details d ON d.id = p.id
        LEFT JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id
        ORDER BY p.created_at, p.id
        LIMIT v_limit
      ) x;
    END IF;
    v_fetched := jsonb_array_length(v_batch);

    FOR r IN
      SELECT * FROM jsonb_to_recordset(v_batch) AS x(row_ts timestamptz, row_id bigint, ref bigint, phone text, uid text,
        email text, name text, info1 text, info2 text, info3 text, info4 text, info5 text, carrier text, account_id bigint,
        fallback_key text, invalid boolean, detail_status text, group_target boolean)
      ORDER BY x.row_ts, x.row_id
    LOOP
      v_key := private.aka_agent_journey_contact_key(r.phone, r.uid, r.account_id, r.email, r.fallback_key);
      v_candidate := NOT r.invalid AND src.is_entry AND NOT src.is_stop
        AND (src.entry_since IS NULL OR r.row_ts >= src.entry_since);
      v_skip := false;
      IF v_candidate THEN
        IF EXISTS (SELECT 1 FROM public.auto_journey_enrollments e
                   WHERE e.journey_id = j.id AND e.contact_key = v_key AND e.status = 'active') THEN
          v_skip := true;
        ELSIF v_reentry = 'never' AND EXISTS (SELECT 1 FROM public.auto_journey_enrollments e
                   WHERE e.journey_id = j.id AND e.contact_key = v_key AND NOT e.is_test) THEN
          v_skip := true;
        ELSIF v_reentry = 'after_days' AND EXISTS (SELECT 1 FROM public.auto_journey_enrollments e
                   WHERE e.journey_id = j.id AND e.contact_key = v_key AND NOT e.is_test
                     AND e.entered_at > now() - make_interval(days => v_reentry_days)) THEN
          v_skip := true;
        ELSIF r.phone IS NOT NULL AND EXISTS (SELECT 1 FROM public.auto_zalo_message_opt_outs o
                   WHERE o.staff_id = j.staff_id AND o.organization_id = j.organization_id AND o.phone = r.phone
                     AND o.confirmed_at IS NOT NULL) THEN
          v_skip := true;
        ELSIF cardinality(v_stop_groups) > 0 AND EXISTS (SELECT 1 FROM public.auto_journey_marks mk
                   WHERE mk.journey_id = j.id AND mk.group_id = ANY(v_stop_groups) AND mk.contact_key = v_key) THEN
          v_skip := true;
        END IF;
        -- Daily cap: stop this source before the row so the cursor does not pass it.
        IF NOT v_skip AND v_max_new IS NOT NULL AND v_day_count >= v_max_new THEN
          v_capped := true;
          EXIT;
        END IF;
      END IF;
      v_rows := v_rows + 1;

      IF NOT r.invalid AND (src.is_stop OR src.is_mark) THEN
        INSERT INTO public.auto_journey_marks (journey_id, group_id, contact_key)
        VALUES (j.id, src.group_id, v_key) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_marked := v_marked + v_n;
      END IF;
      IF NOT r.invalid AND src.is_stop THEN
        WITH o AS (
          UPDATE public.auto_journey_enrollments e
          SET status = 'exited', exit_code = 'stop_group', exit_reason = 'Khách đã vào nhóm dừng quy trình.', finished_at = now(),
              next_run_at = NULL, paused_next_run_at = NULL, phase = 'ready', pending_outcome = NULL, pending_reason = NULL,
              lease_token = NULL, lease_until = NULL, updated_at = now()
          WHERE e.journey_id = j.id AND e.contact_key = v_key AND e.status = 'active'
          RETURNING e.id, e.step_id
        ), ev AS (
          INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message, data)
          SELECT j.id, o.id, o.step_id, 'exit', 'Khách đã vào nhóm dừng quy trình.', jsonb_build_object('groupId', src.group_id) FROM o
        )
        SELECT count(*), max(o.step_id) INTO v_n, v_exit_step FROM o;
        IF v_n > 0 THEN
          v_stopped := v_stopped + v_n;
          v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, v_exit_step, 'exited', v_n);
          v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'exited', v_n);
        END IF;
      END IF;

      IF v_candidate THEN
        v_new_id := NULL;
        IF NOT v_skip THEN
          INSERT INTO public.auto_journey_enrollments (journey_id, version_id, staff_id, organization_id, contact_key, contact,
            source_kind, source_ref, source_group_id, source_campaign_id, status, phase, next_run_at)
          VALUES (j.id, j.active_version_id, j.staff_id, j.organization_id, v_key,
            private.aka_agent_journey_contact(r.name, r.phone, r.uid, r.email, r.info1, r.info2, r.info3, r.info4, r.info5,
              r.carrier, r.account_id)
              || CASE WHEN v_source_group_target IS TRUE OR r.group_target IS TRUE THEN '{"targetKind":"group"}'::jsonb ELSE '{}'::jsonb END,
            src.kind, r.ref, src.group_id, src.campaign_id, 'active', 'ready', now())
          ON CONFLICT (journey_id, contact_key) WHERE status = 'active' DO NOTHING
          RETURNING id INTO v_new_id;
        END IF;
        IF v_new_id IS NULL THEN
          v_skipped := v_skipped + 1;
        ELSE
          v_enrolled := v_enrolled + 1;
          v_day_count := v_day_count + 1;
          v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'enrolled', 1);
          INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message, data)
          VALUES (j.id, v_new_id, NULL, 'enter',
            CASE WHEN src.kind = 'data_group'
              THEN format('Khách vào quy trình từ nhóm data "%s".', coalesce(v_source_name, src.group_id::text))
              ELSE format('Khách vào quy trình từ kết quả "%s" của chiến dịch "%s".', r.detail_status,
                coalesce(v_source_name, src.campaign_id::text)) END,
            jsonb_strip_nulls(jsonb_build_object('sourceKind', src.kind, 'groupId', src.group_id, 'campaignId', src.campaign_id,
              'ref', r.ref)));
        END IF;
      END IF;
      v_last_ts := r.row_ts;
      v_last_id := r.row_id;
    END LOOP;

    UPDATE public.auto_journey_sources
    SET cursor_ts = v_last_ts, cursor_id = coalesce(v_last_id, 0), last_scanned_at = now(),
        seeded_at = CASE WHEN seeded_at IS NULL AND NOT v_capped AND v_fetched < v_limit THEN now() ELSE seeded_at END,
        updated_at = now()
    WHERE id = src.id;
    IF v_day_count <> v_day_start OR j.entry_day IS DISTINCT FROM v_today THEN
      UPDATE public.auto_journeys SET entry_day = v_today, entry_day_count = v_day_count WHERE id = j.id;
    END IF;
    v_scanned := v_scanned + v_rows;
    v_left := v_left - greatest(v_rows, CASE WHEN v_capped THEN 0 ELSE v_fetched END);
  END LOOP;
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  RETURN jsonb_build_object('scanned', v_scanned, 'enrolled', v_enrolled, 'stopped', v_stopped, 'marked', v_marked,
    'skipped', v_skipped);
END
$function$;

-- Collect: classify due step runs from the input row and its result rows (same lists as journey-core
-- RESULT_STATUS_GROUPS / AUXILIARY_ACTION_CODES), wake the customer, reopen finished campaigns that still hold
-- a queued row.
CREATE FUNCTION private.aka_agent_journey_engine_collect(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_limit integer := least(greatest(coalesce(private.aka_agent_journey_bigint(p_payload -> 'limit'), 500), 1), 1000)::integer;
  v_ok text[] := ARRAY['thành công', 'đã gửi', 'đã gửi lời mời', 'đã gửi lời mời kết bạn', 'đã gửi tin nhắn', 'đã là bạn bè',
    'đã là thành viên', 'đã nhận', 'đã tham gia', 'đã xem', 'đã click', 'đã duyệt bài', 'chờ duyệt bài'];
  v_no_zalo text[] := ARRAY['không tồn tại'];
  v_rejected text[] := ARRAY['thất bại'];
  v_aux text[] := ARRAY['zalo_find_phone_user', 'zalo_tag_contact', 'zalo_change_alias'];
  sr public.auto_journey_step_runs%ROWTYPE;
  v_in_id bigint;
  v_in_status text;
  v_in_note text;
  v_in_uid text;
  v_in_deleted boolean;
  v_n bigint;
  v_has_no_zalo boolean;
  v_has_ok boolean;
  v_ok_status text;
  v_has_rejected boolean;
  v_outcome text;
  v_reason text;
  v_uid text;
  v_delay interval;
  v_e_id bigint;
  v_e_status text;
  v_e_phase text;
  v_e_step text;
  v_e_lease timestamptz;
  v_journey_status text;
  v_campaign_status text;
  v_reopen bigint[] := '{}';
  v_campaign bigint;
  v_checked integer := 0;
  v_settled integer := 0;
  v_reopened integer := 0;
BEGIN
  PERFORM private.aka_agent_journey_engine_lease(p_payload);
  FOR sr IN
    SELECT r.* FROM public.auto_journey_step_runs r
    WHERE r.status = 'dispatched' AND r.next_check_at <= now()
    ORDER BY r.next_check_at, r.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_checked := v_checked + 1;
    v_outcome := NULL;
    v_reason := NULL;
    v_in_id := NULL; v_in_status := NULL; v_in_note := NULL; v_in_uid := NULL; v_in_deleted := NULL;
    SELECT i.id, i.status, i.note, i.uid, i.is_delete INTO v_in_id, v_in_status, v_in_note, v_in_uid, v_in_deleted
    FROM public.auto_campaign_input_data i WHERE i.id = sr.input_data_id;
    SELECT count(*),
      coalesce(bool_or(d.status = ANY(v_no_zalo)), false),
      coalesce(bool_or(d.status = ANY(v_ok) AND NOT (coalesce(d.action_code, '') = ANY(v_aux))), false),
      (array_agg(d.status ORDER BY d.created_at, d.id) FILTER (WHERE d.status = ANY(v_ok) AND NOT (coalesce(d.action_code, '') = ANY(v_aux))))[1],
      coalesce(bool_or(d.status = ANY(v_rejected) AND NOT (coalesce(d.action_code, '') = ANY(v_aux))), false)
    INTO v_n, v_has_no_zalo, v_has_ok, v_ok_status, v_has_rejected
    FROM public.auto_campaign_details d
    WHERE d.input_data_id = sr.input_data_id AND d.is_delete = false;

    IF v_has_no_zalo THEN
      v_outcome := 'no_zalo';
    ELSIF v_has_ok THEN
      v_outcome := 'ok';
      v_reason := CASE WHEN v_ok_status = 'thành công' THEN NULL ELSE v_ok_status END;
    ELSIF v_has_rejected THEN
      v_outcome := 'rejected';
    ELSIF v_in_id IS NULL OR v_in_deleted IS TRUE THEN
      v_outcome := 'failed';
      v_reason := 'Khách đã bị xóa khỏi chiến dịch';
    ELSIF v_in_status = 'hoàn thành' THEN
      v_outcome := 'failed';
      v_reason := coalesce(private.aka_agent_journey_short(v_in_note), 'Chiến dịch kết thúc mà không gửi được');
    ELSIF v_in_status = 'tạm dừng' AND v_n > 0 THEN
      v_outcome := 'failed';
      v_reason := coalesce(private.aka_agent_journey_short(v_in_note), 'Chiến dịch tạm dừng khách này sau lần chạy');
    ELSIF now() >= sr.deadline_at THEN
      v_outcome := 'failed';
      v_reason := 'Quá hạn chờ kết quả';
    END IF;

    IF v_outcome IS NULL THEN
      IF v_in_status = 'chờ xử lý' AND NOT (sr.campaign_id = ANY(v_reopen)) THEN
        SELECT c.status INTO v_campaign_status FROM public.auto_campaigns c WHERE c.id = sr.campaign_id AND c.is_delete IS NOT TRUE;
        IF v_campaign_status = 'hoàn thành' THEN
          v_reopen := v_reopen || sr.campaign_id;
        END IF;
      END IF;
      v_delay := CASE sr.check_count WHEN 0 THEN interval '2 minutes' WHEN 1 THEN interval '5 minutes' ELSE interval '10 minutes' END;
      UPDATE public.auto_journey_step_runs
      SET check_count = check_count + 1, next_check_at = least(now() + v_delay, deadline_at)
      WHERE id = sr.id;
      CONTINUE;
    END IF;

    -- A customer still leased by a claim keeps its run open until the lease ends (its result must not be overwritten).
    v_e_id := NULL;
    SELECT e.id, e.status, e.phase, e.step_id, e.lease_until, j.status
    INTO v_e_id, v_e_status, v_e_phase, v_e_step, v_e_lease, v_journey_status
    FROM public.auto_journey_enrollments e
    JOIN public.auto_journeys j ON j.id = e.journey_id
    WHERE e.id = sr.enrollment_id
    FOR UPDATE OF e SKIP LOCKED;
    IF v_e_id IS NULL THEN
      UPDATE public.auto_journey_step_runs SET next_check_at = now() + interval '15 seconds' WHERE id = sr.id;
      CONTINUE;
    END IF;
    IF v_e_status = 'active' AND v_e_lease IS NOT NULL AND v_e_lease > now() THEN
      UPDATE public.auto_journey_step_runs SET next_check_at = v_e_lease + interval '5 seconds' WHERE id = sr.id;
      CONTINUE;
    END IF;
    UPDATE public.auto_journey_step_runs
    SET status = 'settled', outcome = v_outcome, reason = v_reason, settled_at = now(), next_check_at = NULL,
        check_count = check_count + 1
    WHERE id = sr.id;
    v_settled := v_settled + 1;
    IF v_e_status = 'active' AND v_e_phase = 'awaiting' AND v_e_step = sr.step_id THEN
      v_uid := CASE WHEN sr.action_code LIKE 'zalo%' AND v_outcome <> 'no_zalo' THEN left(nullif(btrim(coalesce(v_in_uid, '')), ''), 500) END;
      UPDATE public.auto_journey_enrollments
      SET phase = 'result', pending_outcome = v_outcome, pending_reason = v_reason,
          next_run_at = CASE WHEN v_journey_status = 'active' THEN now() ELSE NULL END,
          paused_next_run_at = CASE WHEN v_journey_status = 'active' THEN NULL ELSE now() END,
          zalo_uids = CASE WHEN v_uid IS NULL THEN zalo_uids ELSE zalo_uids || jsonb_build_object(sr.account_id::text, v_uid) END,
          lease_token = NULL, lease_until = NULL, updated_at = now()
      WHERE id = v_e_id;
    END IF;
  END LOOP;

  FOR v_campaign IN SELECT DISTINCT x FROM unnest(v_reopen) x ORDER BY x LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign);
    SELECT c.status INTO v_campaign_status FROM public.auto_campaigns c
    WHERE c.id = v_campaign AND c.is_delete IS NOT TRUE FOR UPDATE;
    IF v_campaign_status = 'hoàn thành' THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now(), updated_at = now() WHERE id = v_campaign;
      v_reopened := v_reopened + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('checked', v_checked, 'settled', v_settled, 'reopened', v_reopened);
END
$function$;

-- Claim: due customers of running journeys, leased for 120 s, plus every fact the engine needs.
CREATE FUNCTION private.aka_agent_journey_engine_claim(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_token uuid := private.aka_agent_journey_engine_lease(p_payload);
  v_limit integer := least(greatest(coalesce(private.aka_agent_journey_bigint(p_payload -> 'limit'), 300), 1), 500)::integer;
  v_ids bigint[];
  v_day_start timestamptz := private.aka_agent_journey_vn_day_start();
  v_out jsonb;
BEGIN
  WITH c AS (
    SELECT e.id FROM public.auto_journey_enrollments e
    JOIN public.auto_journeys j ON j.id = e.journey_id
    WHERE e.status = 'active' AND e.next_run_at IS NOT NULL AND e.next_run_at <= now()
      AND (e.lease_until IS NULL OR e.lease_until <= now())
      AND j.status = 'active' AND j.is_delete = false
    ORDER BY e.next_run_at
    LIMIT v_limit
    FOR UPDATE OF e SKIP LOCKED
  ), u AS (
    UPDATE public.auto_journey_enrollments e
    SET lease_token = v_token, lease_until = now() + interval '120 seconds'
    FROM c WHERE e.id = c.id
    RETURNING e.id
  )
  SELECT coalesce(array_agg(u.id), '{}'::bigint[]) INTO v_ids FROM u;

  WITH e AS MATERIALIZED (
    SELECT * FROM public.auto_journey_enrollments WHERE id = ANY(v_ids)
  ), v AS MATERIALIZED (
    SELECT ver.* FROM public.auto_journey_versions ver WHERE ver.id IN (SELECT DISTINCT e.version_id FROM e)
  ), vr AS MATERIALIZED (
    SELECT v.id AS version_id, v.journey_id, rf.kind, rf.ref_id
    FROM v CROSS JOIN LATERAL private.aka_agent_journey_graph_refs(v.graph) rf
  ), vg AS MATERIALIZED (
    SELECT v.id AS version_id,
      private.aka_agent_journey_bigint_array(v.settings -> 'stopGroupIds') AS stop_groups,
      ARRAY(SELECT DISTINCT vr.ref_id FROM vr WHERE vr.version_id = v.id AND vr.kind = 'condition_group') AS cond_groups
    FROM v
  ), jr AS MATERIALIZED (
    SELECT DISTINCT e.journey_id, e.staff_id, e.organization_id FROM e
  ), sc AS MATERIALIZED (
    SELECT s.journey_id, s.step_id, s.account_id, s.action_code, s.campaign_id, s.config_hash,
      c.status AS campaign_status, (c.id IS NULL OR c.is_delete IS TRUE) AS campaign_deleted, c.action_id,
      c.content, c.schedule, c.original_schedule, c.extra_settings
    FROM public.auto_journey_step_campaigns s
    LEFT JOIN public.auto_campaigns c ON c.id = s.campaign_id
    WHERE s.journey_id IN (SELECT jr.journey_id FROM jr) AND s.is_active
  ), uc AS MATERIALIZED (
    SELECT DISTINCT ON (c.id) c.id, c.account_id, c.action_id, c.status, c.is_delete, c.content, c.schedule,
      c.original_schedule, c.extra_settings
    FROM vr
    JOIN jr ON jr.journey_id = vr.journey_id
    JOIN public.auto_campaigns c ON c.id = vr.ref_id AND c.staff_id = jr.staff_id AND c.organization_id = jr.organization_id
    WHERE vr.kind = 'campaign'
    ORDER BY c.id
  ), acc AS MATERIALIZED (
    SELECT DISTINCT x.id FROM (
      SELECT vr.ref_id AS id FROM vr WHERE vr.kind = 'account'
      UNION ALL SELECT e.sticky_account_id FROM e
      UNION ALL SELECT private.aka_agent_journey_bigint(e.contact -> 'accountId') FROM e
      UNION ALL SELECT uc.account_id FROM uc
      UNION ALL SELECT sc.account_id FROM sc
    ) x WHERE x.id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'enrollments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'journeyId', e.journey_id, 'versionId', e.version_id,
        'staffId', e.staff_id, 'organizationId', e.organization_id, 'contactKey', e.contact_key, 'contact', e.contact,
        'stepId', e.step_id, 'phase', e.phase, 'pendingOutcome', e.pending_outcome, 'pendingReason', e.pending_reason,
        'stickyAccountId', e.sticky_account_id, 'zaloUids', e.zalo_uids, 'zaloStatus', e.zalo_status, 'attempts', e.attempts,
        'deferCode', e.defer_code, 'stepEnteredAt', e.step_entered_at, 'isTest', e.is_test) ORDER BY e.next_run_at, e.id), '[]'::jsonb) FROM e),
    'versions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'journeyId', v.journey_id, 'graph', v.graph,
        'settings', v.settings) ORDER BY v.id), '[]'::jsonb) FROM v),
    'facts', (SELECT coalesce(jsonb_object_agg(e.id::text, jsonb_build_object(
        'optedOut', EXISTS (SELECT 1 FROM public.auto_zalo_message_opt_outs o
          WHERE o.staff_id = e.staff_id AND o.organization_id = e.organization_id
            AND o.phone = private.aka_agent_journey_phone(e.contact ->> 'phone') AND o.confirmed_at IS NOT NULL),
        'stopMarked', EXISTS (SELECT 1 FROM public.auto_journey_marks mk
          WHERE mk.journey_id = e.journey_id AND mk.group_id = ANY(vg.stop_groups)
            AND mk.contact_key = regexp_replace(e.contact_key, '^test:', '')),
        'groupMarks', coalesce((SELECT jsonb_agg(mk.group_id ORDER BY mk.group_id) FROM public.auto_journey_marks mk
          WHERE mk.journey_id = e.journey_id AND mk.group_id = ANY(vg.cond_groups)
            AND mk.contact_key = regexp_replace(e.contact_key, '^test:', '')), '[]'::jsonb),
        'recentSendTimes', coalesce((SELECT jsonb_agg(to_jsonb(r.dispatched_at) ORDER BY r.dispatched_at)
          FROM public.auto_journey_step_runs r
          WHERE r.staff_id = e.staff_id AND r.contact_key = e.contact_key AND r.dispatched_at > now() - interval '24 hours'
            -- Only sends that may have reached the customer count toward the daily cap (a "no Zalo" attempt must not
            -- block the SMS fallback for 24 hours).
            AND (r.status = 'dispatched' OR r.outcome = 'ok')),
          '[]'::jsonb))), '{}'::jsonb)
      FROM e JOIN vg ON vg.version_id = e.version_id),
    'accounts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'platform', a.flatform_type,
        'usable', private.aka_agent_journey_account_ready(a.flatform_type, a.login_status, a.mobile_device_id, a.is_delete, a.is_active, a.status),
        'isServer', coalesce(a.is_zalo_server, false),
        'dispatchedToday', (SELECT count(*) FROM public.auto_journey_step_runs r
          WHERE r.account_id = a.id AND r.dispatched_at >= v_day_start)) ORDER BY a.id), '[]'::jsonb)
      FROM public.auto_accounts a WHERE a.id IN (SELECT acc.id FROM acc)),
    'stepCampaigns', (SELECT coalesce(jsonb_agg(jsonb_build_object('journeyId', sc.journey_id, 'stepId', sc.step_id,
        'accountId', sc.account_id, 'actionCode', sc.action_code, 'campaignId', sc.campaign_id, 'configHash', sc.config_hash,
        'status', sc.campaign_status, 'deleted', sc.campaign_deleted)
      ORDER BY sc.journey_id, sc.step_id, sc.account_id, sc.campaign_id), '[]'::jsonb) FROM sc),
    'userCampaigns', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', uc.id, 'accountId', uc.account_id,
        'actionCode', uc.action_id, 'status', uc.status, 'deleted', uc.is_delete IS TRUE) ORDER BY uc.id), '[]'::jsonb) FROM uc),
    'smsCampaigns', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'content', x.content, 'schedule', x.schedule,
        'originalSchedule', x.original_schedule, 'extraSettings', coalesce(x.extra_settings, '{}'::jsonb)) ORDER BY x.id), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (y.id) y.* FROM (
          SELECT sc.campaign_id AS id, sc.content, sc.schedule, sc.original_schedule, sc.extra_settings
          FROM sc WHERE sc.action_id IN ('sms_send', 'voice_call') AND NOT sc.campaign_deleted
          UNION ALL
          SELECT uc.id, uc.content, uc.schedule, uc.original_schedule, uc.extra_settings
          FROM uc WHERE uc.action_id IN ('sms_send', 'voice_call') AND uc.is_delete IS NOT TRUE
        ) y ORDER BY y.id
      ) x)
  ) INTO v_out;
  RETURN v_out;
END
$function$;

-- Row for aka_agent_ingest_data_group: phone contact, else (account, UID) person, else email.
CREATE FUNCTION private.aka_agent_journey_group_row(p_contact jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $function$
  SELECT CASE
    WHEN nullif(p_contact ->> 'phone', '') IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
      'contact_type', 'phone', 'uid', p_contact ->> 'phone', 'phone', p_contact ->> 'phone', 'name', p_contact ->> 'name',
      'email', p_contact ->> 'email', 'info1', p_contact ->> 'info1', 'info2', p_contact ->> 'info2', 'info3', p_contact ->> 'info3',
      'info4', p_contact ->> 'info4', 'info5', p_contact ->> 'info5'))
    WHEN nullif(btrim(coalesce(p_contact ->> 'uid', '')), '') IS NOT NULL
      AND private.aka_agent_journey_bigint(p_contact -> 'accountId') IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
      'contact_type', 'person', 'uid', btrim(p_contact ->> 'uid'),
      'source_account_id', private.aka_agent_journey_bigint(p_contact -> 'accountId'), 'name', p_contact ->> 'name',
      'email', p_contact ->> 'email', 'info1', p_contact ->> 'info1', 'info2', p_contact ->> 'info2', 'info3', p_contact ->> 'info3',
      'info4', p_contact ->> 'info4', 'info5', p_contact ->> 'info5'))
    WHEN nullif(p_contact ->> 'email', '') IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
      'contact_type', 'email', 'uid', p_contact ->> 'email', 'email', p_contact ->> 'email', 'name', p_contact ->> 'name',
      'info1', p_contact ->> 'info1', 'info2', p_contact ->> 'info2', 'info3', p_contact ->> 'info3',
      'info4', p_contact ->> 'info4', 'info5', p_contact ->> 'info5'))
  END
$function$;

-- Active memberships of a group whose contact matches the customer key. Fast path: the member the customer
-- entered from; then indexed lookups by (account_id, contact_type, uid) or contact id; last, the 2.000 most
-- recently updated members of the group compared by computed key.
CREATE FUNCTION private.aka_agent_journey_group_members(p_staff_id bigint, p_organization_id bigint, p_group_id bigint,
  p_contact_key text, p_contact jsonb, p_source_group_id bigint, p_source_ref bigint)
RETURNS bigint[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_key text := regexp_replace(coalesce(p_contact_key, ''), '^test:', '');
  v_ids bigint[];
  v_value text;
  v_account bigint;
  v_uid text := btrim(coalesce(p_contact ->> 'uid', ''));
BEGIN
  IF p_source_group_id = p_group_id AND p_source_ref IS NOT NULL THEN
    SELECT array_agg(m.id) INTO v_ids FROM public.auto_account_contact_group_members m
    WHERE m.id = p_source_ref AND m.group_id = p_group_id AND m.is_delete = false;
    IF coalesce(cardinality(v_ids), 0) > 0 THEN
      RETURN v_ids;
    END IF;
  END IF;
  IF v_key LIKE 'phone:%' OR v_key LIKE 'email:%' THEN
    v_value := substr(v_key, 7);
    SELECT array_agg(DISTINCT m.id) INTO v_ids
    FROM public.auto_account_contacts c
    JOIN public.auto_account_contact_group_members m ON m.contact_id = c.id AND m.group_id = p_group_id AND m.is_delete = false
    WHERE c.account_id IS NULL AND c.contact_type = CASE WHEN v_key LIKE 'phone:%' THEN 'phone' ELSE 'email' END
      AND c.uid = v_value AND c.staff_id = p_staff_id AND c.organization_id = p_organization_id;
  ELSIF v_key LIKE 'zalo:%' AND split_part(v_key, ':', 2) ~ '^[0-9]{1,18}$' THEN
    v_account := split_part(v_key, ':', 2)::bigint;
    v_value := substr(v_key, length('zalo:' || split_part(v_key, ':', 2) || ':') + 1);
    SELECT array_agg(DISTINCT m.id) INTO v_ids
    FROM public.auto_account_contacts c
    JOIN public.auto_account_contact_group_members m ON m.contact_id = c.id AND m.group_id = p_group_id AND m.is_delete = false
    WHERE c.account_id = v_account AND c.contact_type IN ('person', 'group', 'page', 'page_inbox_customer', 'zalo_tag', 'campaign_input')
      AND c.uid IN (v_value, v_uid);
  ELSIF v_key ~ '^contact:[0-9]{1,18}$' THEN
    SELECT array_agg(m.id) INTO v_ids FROM public.auto_account_contact_group_members m
    WHERE m.group_id = p_group_id AND m.contact_id = substr(v_key, 9)::bigint AND m.is_delete = false;
  END IF;
  IF coalesce(cardinality(v_ids), 0) > 0 THEN
    RETURN v_ids;
  END IF;
  SELECT array_agg(x.id) INTO v_ids FROM (
    SELECT m.id, private.aka_agent_journey_contact_key(
      private.aka_agent_journey_phone(coalesce(nullif(c.phone, ''), nullif(c.extra_data ->> 'phone', ''),
        CASE WHEN c.contact_type = 'phone' THEN c.uid END)),
      CASE WHEN c.contact_type IN ('phone', 'email') THEN NULL ELSE nullif(btrim(c.uid), '') END,
      c.account_id,
      private.aka_agent_journey_email(coalesce(nullif(c.email, ''), nullif(c.extra_data ->> 'email', ''),
        CASE WHEN c.contact_type = 'email' THEN c.uid END)),
      'contact:' || c.id::text) AS k
    FROM public.auto_account_contact_group_members m
    JOIN public.auto_account_contacts c ON c.id = m.contact_id
    WHERE m.group_id = p_group_id AND m.is_delete = false
    ORDER BY m.updated_at DESC, m.id DESC
    LIMIT 2000
  ) x WHERE x.k = v_key;
  RETURN coalesce(v_ids, '{}'::bigint[]);
END
$function$;

-- Khóa quyền ngay trong phần này (schema private có USAGE cho các role API): mọi hàm private.aka_agent_journey_*
-- thuộc postgres, không ai khác EXECUTE. p4 chạy lại bước này cho mọi hàm rồi mới cấp hai RPC public cho service_role.
DO $lockdown_p3$
DECLARE
  v_fn regprocedure;
  v_role text;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname LIKE 'aka\_agent\_journey\_%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_role);
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'private' AND p.proname LIKE 'aka\_agent\_journey\_%'
      AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'))
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'aka\_agent\_journey\_%'
  ) THEN
    RAISE EXCEPTION 'v473_p3_function_acl_unexpected';
  END IF;
END
$lockdown_p3$;

COMMIT;

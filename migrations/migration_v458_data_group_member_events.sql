-- V458: nhật ký vào/rời nhóm data theo bộ lọc động + thông báo gộp theo khung (giai đoạn 1 trung tâm thông báo).
--
-- Phụ thuộc V457 (auto_data_group_member_events, auto_notifications, auto_notification_subscriptions, helper private).
-- Sửa public.aka_agent_process_data_group_dynamic_filters_core đúng 3 chỗ, lấy từ bản đang chạy trên akachat
-- (md5 d40d1a23943ae1a4a66339504382526f, 04/11/2026), không chép từ migration cũ:
--   1. Vòng bộ lọc đọc thêm dynamic_filter.revision.
--   2. Hai điểm đang tăng last_entered_count/last_exited_count gọi private.aka_agent_data_group_record_member_event
--      (trong cùng subtransaction của từng liên hệ: liên hệ lỗi thì nhật ký của nó cũng rollback).
--   3. Cuối lượt gọi private.aka_agent_data_group_finish_member_events: gắn tổng sau thay đổi cho sự kiện cuối của
--      mỗi nhóm (đếm 1 lần/nhóm/lượt bằng idx_auto_account_contact_group_members_active) và gộp thông báo
--      1 dòng cho mỗi (người nhận, nhóm, khung bucketMinutes) với dedupe_key dg:staff:group:minutes:bucket.
-- Hàm ghi nhật ký và hàm chốt tự bắt lỗi (RAISE WARNING), nên lỗi nhật ký/thông báo không làm hỏng lượt lọc.
-- Chỉ ghi khi notifications.enabled = true hoặc notifications.member_events.enabled = true (mặc định false):
-- apply xong không ghi gì cho tới khi bật. Không thêm job cron, pool, kết nối hay trigger.
-- Lưu ý: dọn nhật ký cũ (90 ngày) chạy trong bước điều phối, chỉ khi notifications.enabled = true.
-- Rollback: migrations/rollback_v458_data_group_member_events.sql (khôi phục đúng bản md5 d40d1a23943ae1a4a66339504382526f).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $v458_preflight$
DECLARE v_md5 text; v_fn regprocedure;
BEGIN
  IF to_regclass('public.auto_data_group_member_events') IS NULL OR to_regclass('public.auto_notifications') IS NULL
     OR to_regclass('public.auto_notification_subscriptions') IS NULL OR to_regclass('public.auto_data_group_recipients') IS NULL
     OR to_regprocedure('private.aka_agent_notification_enabled()') IS NULL
     OR to_regprocedure('private.aka_agent_notification_setting(text,text)') IS NULL
     OR to_regprocedure('private.aka_agent_notification_staff_org(bigint,bigint)') IS NULL THEN
    RAISE EXCEPTION 'v458: apply V457 first';
  END IF;
  v_fn := to_regprocedure('public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)');
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v458: dynamic filter core missing'; END IF;
  SELECT md5(pg_get_functiondef(v_fn)) INTO v_md5;
  IF v_md5 IS DISTINCT FROM 'd40d1a23943ae1a4a66339504382526f' THEN
    RAISE EXCEPTION 'v458: dynamic filter core checksum mismatch (%), re-capture the live body before applying', v_md5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND prosecdef AND pg_get_userbyid(proowner) = 'postgres'
                   AND proconfig = ARRAY['search_path=pg_catalog, public'] AND proacl::text = '{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'v458: dynamic filter core metadata changed';
  END IF;
  IF to_regprocedure('private.aka_agent_notification_member_events_enabled()') IS NOT NULL
     OR to_regprocedure('private.aka_agent_data_group_record_member_event(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text)') IS NOT NULL
     OR to_regprocedure('private.aka_agent_data_group_finish_member_events(uuid)') IS NOT NULL
     OR to_regprocedure('private.aka_agent_notification_capture_data_group(uuid)') IS NOT NULL
     OR to_regprocedure('private.aka_agent_data_group_filter_summary(bigint)') IS NOT NULL
     OR to_regprocedure('private.aka_agent_data_group_contact_label(bigint)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'notifications.member_events.enabled') THEN
    RAISE EXCEPTION 'v458: already applied';
  END IF;
  -- Cột hàm mới đọc/ghi.
  IF (SELECT count(*) FROM pg_attribute WHERE NOT attisdropped AND attnum > 0 AND (
        (attrelid = 'public.auto_account_contact_group_dynamic_filters'::regclass AND attname = 'revision')
     OR (attrelid = 'public.auto_account_contact_group_dynamic_filter_rules'::regclass AND attname IN ('dynamic_filter_id','scope_category_item_id',
           'join_category_item_id','field_category_item_id','operator_category_item_id','sort_order','value_labels'))
     OR (attrelid = 'public.auto_account_contacts'::regclass AND attname IN ('name','phone'))
     OR (attrelid = 'public.auto_account_contact_groups'::regclass AND attname IN ('name','staff_id','organization_id','is_delete'))
     OR (attrelid = 'public.category_item'::regclass AND attname IN ('code','name')))) <> 16 THEN
    RAISE EXCEPTION 'v458: expected columns missing';
  END IF;
  IF to_regclass('public.idx_auto_account_contact_group_members_active') IS NULL THEN
    RAISE EXCEPTION 'v458: active member index missing';
  END IF;
END
$v458_preflight$;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('notifications.member_events.enabled', 'false',
   'Ghi nhật ký vào/rời nhóm data kể cả khi trung tâm thông báo đang tắt (để quan sát lượng ghi trước khi bật).', false, true);

CREATE FUNCTION private.aka_agent_notification_member_events_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT private.aka_agent_notification_enabled()
      OR lower(btrim(private.aka_agent_notification_setting('notifications.member_events.enabled', 'false'))) IN ('true', '1', 'on', 'yes')
$$;

-- Mô tả luật dễ đọc lúc xảy ra (id luật đổi mỗi lần lưu bộ lọc), ví dụ "Vào: Tag Zalo chứa VIP và Trạng thái kết bạn Zalo bằng Bạn bè · Rời: Tag akaBiz chứa Đã mua".
CREATE FUNCTION private.aka_agent_data_group_filter_summary(p_filter_id bigint)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT left(string_agg(parts.part, ' · ' ORDER BY parts.scope_order), 300)
    FROM (
      SELECT CASE s.scope WHEN 'enter' THEN 1 ELSE 2 END AS scope_order,
             CASE s.scope WHEN 'enter' THEN 'Vào: ' ELSE 'Rời: ' END || string_agg(s.rule_text, '' ORDER BY s.sort_order, s.id) AS part
        FROM (
          SELECT sc.code AS scope, r.sort_order, r.id,
                 CASE WHEN row_number() OVER (PARTITION BY sc.code ORDER BY r.sort_order, r.id) = 1 THEN ''
                      WHEN jn.code = 'or' THEN ' hoặc ' ELSE ' và ' END
                 || coalesce(fd.name, fd.code, 'Điều kiện') || coalesce(' ' || coalesce(op.name, op.code), '')
                 || coalesce(' ' || (SELECT string_agg(CASE jsonb_typeof(v) WHEN 'object' THEN coalesce(v ->> 'label', v ->> 'name') ELSE v #>> '{}' END, ', ')
                                       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.value_labels) = 'array' THEN r.value_labels ELSE '[]'::jsonb END) AS v), '')
                   AS rule_text
            FROM public.auto_account_contact_group_dynamic_filter_rules r
            JOIN public.category_item sc ON sc.id = r.scope_category_item_id AND sc.code IN ('enter', 'leave')
            LEFT JOIN public.category_item jn ON jn.id = r.join_category_item_id
            LEFT JOIN public.category_item fd ON fd.id = r.field_category_item_id
            LEFT JOIN public.category_item op ON op.id = r.operator_category_item_id
           WHERE r.dynamic_filter_id = p_filter_id
        ) s
       GROUP BY s.scope
    ) parts
$$;

-- Tên liên hệ lúc xảy ra; không có tên thì số điện thoại đã che (3 số đầu, 3 số cuối).
CREATE FUNCTION private.aka_agent_data_group_contact_label(p_contact_id bigint)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT left(coalesce(nullif(btrim(c.name), ''),
                       CASE WHEN length(d.digits) >= 7 THEN left(d.digits, 3) || '****' || right(d.digits, 3) END,
                       'Liên hệ #' || c.id), 120)
    FROM public.auto_account_contacts c
    CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') AS digits) d
   WHERE c.id = p_contact_id
$$;

-- Ghi 1 sự kiện. Tự bắt lỗi: nhật ký hỏng không được làm rollback thay đổi thành viên của liên hệ.
CREATE FUNCTION private.aka_agent_data_group_record_member_event(p_run_id uuid, p_organization_id bigint, p_staff_id bigint,
  p_group_id bigint, p_filter_id bigint, p_filter_revision bigint, p_membership_id bigint, p_contact_id bigint, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_summary text;
BEGIN
  SELECT e.filter_summary INTO v_summary FROM public.auto_data_group_member_events e
   WHERE e.run_id = p_run_id AND e.dynamic_filter_id = p_filter_id LIMIT 1;
  IF NOT FOUND THEN v_summary := private.aka_agent_data_group_filter_summary(p_filter_id); END IF;
  INSERT INTO public.auto_data_group_member_events (organization_id, staff_id, group_id, dynamic_filter_id, filter_revision, filter_summary,
                                                    membership_id, contact_id, contact_label, action, run_id)
  VALUES (p_organization_id, p_staff_id, p_group_id, p_filter_id, p_filter_revision, v_summary,
          p_membership_id, p_contact_id, private.aka_agent_data_group_contact_label(p_contact_id), p_action, p_run_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Data group member event not recorded (%): %', SQLSTATE, left(SQLERRM, 200);
END
$$;

-- Gộp sự kiện của một lượt thành thông báo: 1 dòng cho mỗi (người nhận, nhóm, khung). Người nhận là chủ nhóm và,
-- nếu bật includeSharedGroups, người được chia sẻ nhóm. deliver_after = cuối khung + 30 giây.
CREATE FUNCTION private.aka_agent_notification_capture_data_group(p_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r record;
  v_now timestamptz := clock_timestamp();
  v_actions jsonb; v_added integer; v_removed integer; v_minutes integer;
  v_start timestamptz; v_end timestamptz; v_rows integer := 0; v_n integer;
BEGIN
  IF p_run_id IS NULL OR NOT private.aka_agent_notification_enabled() THEN RETURN 0; END IF;
  FOR r IN
    WITH changes AS (
      SELECT e.group_id, max(e.dynamic_filter_id) AS dynamic_filter_id,
             (count(*) FILTER (WHERE e.action = 'added'))::integer AS added,
             (count(*) FILTER (WHERE e.action = 'removed'))::integer AS removed,
             max(e.occurred_at) AS last_at
        FROM public.auto_data_group_member_events e
       WHERE e.run_id = p_run_id
       GROUP BY e.group_id
    ), candidates AS (
      SELECT c.*, g.name AS group_name, g.organization_id AS group_org, g.staff_id AS recipient_id, false AS shared
        FROM changes c JOIN public.auto_account_contact_groups g ON g.id = c.group_id AND g.is_delete IS NOT TRUE
      UNION ALL
      SELECT c.*, g.name, g.organization_id, rc.staff_id, true
        FROM changes c JOIN public.auto_account_contact_groups g ON g.id = c.group_id AND g.is_delete IS NOT TRUE
        JOIN public.auto_data_group_recipients rc ON rc.group_id = c.group_id AND rc.staff_id <> g.staff_id
    )
    SELECT cd.*, s.filters
      FROM candidates cd
      JOIN public.auto_notification_subscriptions s
        ON s.staff_id = cd.recipient_id AND s.event_type = 'data_group.membership_changed' AND s.scope = 'own' AND s.is_enabled
  LOOP
    IF r.shared AND lower(coalesce(r.filters ->> 'includeSharedGroups', 'false')) <> 'true' THEN CONTINUE; END IF;
    IF jsonb_typeof(r.filters -> 'groupIds') = 'array' AND NOT ((r.filters -> 'groupIds') @> to_jsonb(r.group_id)) THEN CONTINUE; END IF;
    v_actions := CASE WHEN jsonb_typeof(r.filters -> 'actions') = 'array' THEN r.filters -> 'actions' ELSE '["added","removed"]'::jsonb END;
    v_added := CASE WHEN v_actions ? 'added' THEN r.added ELSE 0 END;
    v_removed := CASE WHEN v_actions ? 'removed' THEN r.removed ELSE 0 END;
    IF v_added + v_removed = 0 THEN CONTINUE; END IF;
    v_minutes := CASE WHEN r.filters ->> 'bucketMinutes' IN ('5', '15', '30', '60') THEN (r.filters ->> 'bucketMinutes')::integer ELSE 5 END;
    v_start := date_bin(make_interval(mins => v_minutes), r.last_at, timestamptz '2000-01-03 00:00:00+07');
    v_end := v_start + make_interval(mins => v_minutes);
    INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, data_group_id, dynamic_filter_id, entity_key,
                                           occurred_at, deliver_after, dedupe_key, payload)
    VALUES (private.aka_agent_notification_staff_org(r.recipient_id, r.group_org), r.recipient_id, 'data_group.membership_changed', 'info',
            r.group_id, r.dynamic_filter_id, 'group:' || r.group_id, r.last_at, v_end + interval '30 seconds',
            format('dg:%s:%s:%s:%s', r.recipient_id, r.group_id, v_minutes, to_char(v_start AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI')),
            jsonb_build_object('groupId', r.group_id, 'groupName', r.group_name, 'from', v_start, 'to', v_end, 'added', v_added,
                               'removed', v_removed, 'actions', v_actions, 'shared', r.shared, 'bucketMinutes', v_minutes))
    ON CONFLICT (dedupe_key) DO UPDATE
       SET payload = auto_notifications.payload || jsonb_build_object(
             'added', coalesce((auto_notifications.payload ->> 'added')::integer, 0) + (EXCLUDED.payload ->> 'added')::integer,
             'removed', coalesce((auto_notifications.payload ->> 'removed')::integer, 0) + (EXCLUDED.payload ->> 'removed')::integer,
             'groupName', EXCLUDED.payload -> 'groupName'),
           occurred_at = greatest(auto_notifications.occurred_at, EXCLUDED.occurred_at),
           updated_at = v_now
     WHERE auto_notifications.content_status = 'pending';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rows := v_rows + v_n;
  END LOOP;
  RETURN v_rows;
END
$$;

-- Chốt một lượt: tổng thành viên đang hoạt động sau thay đổi gắn vào sự kiện cuối của mỗi nhóm, rồi gộp thông báo.
-- Tự bắt lỗi để lượt lọc vẫn commit kể cả khi phần nhật ký/thông báo hỏng.
CREATE FUNCTION private.aka_agent_data_group_finish_member_events(p_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.auto_data_group_member_events e
     SET group_total_after = t.total
    FROM (SELECT x.group_id, max(x.id) AS last_id,
                 (SELECT count(*)::integer FROM public.auto_account_contact_group_members m
                   WHERE m.group_id = x.group_id AND m.is_delete = false) AS total
            FROM public.auto_data_group_member_events x
           WHERE x.run_id = p_run_id
           GROUP BY x.group_id) t
   WHERE e.id = t.last_id;
  RETURN private.aka_agent_notification_capture_data_group(p_run_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Data group member events not finalized (%): %', SQLSTATE, left(SQLERRM, 200);
  RETURN 0;
END
$$;

REVOKE ALL ON FUNCTION private.aka_agent_notification_member_events_enabled(), private.aka_agent_data_group_filter_summary(bigint),
  private.aka_agent_data_group_contact_label(bigint),
  private.aka_agent_data_group_record_member_event(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text),
  private.aka_agent_notification_capture_data_group(uuid), private.aka_agent_data_group_finish_member_events(uuid) FROM PUBLIC;

-- Hàm lõi mới (đúng bản live + 3 chỗ nêu ở đầu file).
CREATE OR REPLACE FUNCTION public.aka_agent_process_data_group_dynamic_filters_core(p_staff_id bigint, p_organization_id bigint, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(500, GREATEST(1, COALESCE(p_limit, 200)));
  v_queue record;
  v_filter record;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_member_id bigint;
  v_origin_current boolean;
  v_was_member boolean;
  v_enter boolean;
  v_leave boolean;
  v_should_be_member boolean;
  v_processed integer := 0;
  v_pairs integer := 0;
  v_entered integer := 0;
  v_exited integer := 0;
  v_remaining bigint := 0;
  v_touched_filter_ids bigint[] := ARRAY[]::bigint[];
  v_changed_group_ids bigint[] := ARRAY[]::bigint[];
  -- V458: nhật ký vào/rời nhóm và thông báo gộp theo khung. Chỉ ghi khi bật trung tâm thông báo
  -- hoặc notifications.member_events.enabled; lỗi ghi nhật ký không bao giờ làm hỏng lượt lọc.
  v_events_enabled boolean := private.aka_agent_notification_member_events_enabled();
  v_run_id uuid := pg_catalog.gen_random_uuid();
  v_event_count integer := 0;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('data-group-dynamic-filter:' || p_staff_id::text, 0)
  ) THEN
    RETURN jsonb_build_object(
      'processed_contact_count', 0,
      'evaluated_pair_count', 0,
      'entered_count', 0,
      'exited_count', 0,
      'remaining_queue_count', (
        SELECT count(*) FROM public.auto_account_contact_dynamic_filter_queue AS queue
        WHERE queue.staff_id = p_staff_id AND queue.organization_id = p_organization_id
      ),
      'busy', true
    );
  END IF;

  FOR v_queue IN
    SELECT queue.contact_id, queue.last_event_at
    FROM public.auto_account_contact_dynamic_filter_queue AS queue
    WHERE queue.staff_id = p_staff_id
      AND queue.organization_id = p_organization_id
      AND queue.queued_at <= clock_timestamp()
    ORDER BY queue.queued_at, queue.contact_id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  LOOP
    BEGIN
      FOR v_filter IN
        SELECT dynamic_filter.id, dynamic_filter.group_id, dynamic_filter.revision
        FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
        JOIN public.auto_account_contact_groups AS contact_group
          ON contact_group.id = dynamic_filter.group_id
         AND contact_group.staff_id = p_staff_id
         AND contact_group.organization_id = p_organization_id
         AND contact_group.purpose = 'data_group'
         AND contact_group.is_delete = false
        JOIN public.category_item AS data_type
          ON data_type.id = contact_group.data_type_category_item_id
         AND data_type.code = 'zalo_person'
        WHERE dynamic_filter.staff_id = p_staff_id
          AND dynamic_filter.organization_id = p_organization_id
          AND dynamic_filter.is_enabled = true
          AND dynamic_filter.effective_from_at <= v_queue.last_event_at
          AND EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_dynamic_filter_rules AS rule
            JOIN public.category_item AS scope_item ON scope_item.id = rule.scope_category_item_id
            WHERE rule.dynamic_filter_id = dynamic_filter.id
              AND scope_item.code = 'enter'
          )
        ORDER BY dynamic_filter.id
      LOOP
        v_member_id := NULL;
        v_origin_current := false;
        v_was_member := false;
        v_pairs := v_pairs + 1;
        IF NOT v_filter.id = ANY (v_touched_filter_ids) THEN
          v_touched_filter_ids := pg_catalog.array_append(v_touched_filter_ids, v_filter.id);
          UPDATE public.auto_account_contact_group_dynamic_filters
          SET last_entered_count = 0, last_exited_count = 0
          WHERE id = v_filter.id;
        END IF;

        SELECT contact_group.* INTO v_group
        FROM public.auto_account_contact_groups AS contact_group
        WHERE contact_group.id = v_filter.group_id
        FOR UPDATE;

        IF v_group.bound_zalo_account_id IS NOT NULL AND (
          NOT public.aka_agent_data_group_account_available(v_group.bound_zalo_account_id,p_staff_id,p_organization_id)
          OR NOT EXISTS(SELECT 1 FROM public.auto_account_contacts WHERE id=v_queue.contact_id AND account_id=v_group.bound_zalo_account_id)
        ) THEN CONTINUE; END IF;
        IF EXISTS (
          SELECT 1 FROM public.auto_account_contacts AS contact
          WHERE contact.id = v_queue.contact_id
            AND contact.staff_id = p_staff_id
            AND contact.organization_id = p_organization_id
            AND contact.flatform_type = 'zalo'
            AND contact.contact_type = 'person'
            AND contact.is_delete = false
        ) THEN
          v_enter := public.aka_agent_data_group_dynamic_scope_matches(
            v_filter.id, v_queue.contact_id, 'enter'
          );
          v_leave := public.aka_agent_data_group_dynamic_scope_matches(
            v_filter.id, v_queue.contact_id, 'leave'
          );
          v_should_be_member := v_enter AND NOT v_leave;
        ELSE
          v_should_be_member := false;
        END IF;

        SELECT member.id, member.is_delete = false
        INTO v_member_id, v_was_member
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = v_filter.group_id
          AND member.contact_id = v_queue.contact_id
        FOR UPDATE;

        SELECT origin.is_current INTO v_origin_current
        FROM public.auto_account_contact_group_member_origins AS origin
        WHERE origin.membership_id = v_member_id
          AND origin.dynamic_filter_id = v_filter.id;

        IF v_should_be_member THEN
          INSERT INTO public.auto_account_contact_group_members (
            group_id, contact_id, is_delete, change_revision, updated_at
          ) VALUES (
            v_filter.group_id, v_queue.contact_id, false, v_group.revision + 1, clock_timestamp()
          )
          ON CONFLICT (group_id, contact_id) DO UPDATE SET
            is_delete = false,
            change_revision = v_group.revision + 1,
            updated_at = clock_timestamp()
          RETURNING id INTO v_member_id;

          INSERT INTO public.auto_account_contact_group_member_origins (
            membership_id, kind, dynamic_filter_id, source_account_id,
            source_name_snapshot, is_current, data_type_category_item_id, updated_at
          )
          SELECT
            v_member_id, 'dynamic_filter', v_filter.id, contact.account_id::bigint,
            'Bộ lọc động', true, v_group.data_type_category_item_id, clock_timestamp()
          FROM public.auto_account_contacts AS contact
          WHERE contact.id = v_queue.contact_id
          ON CONFLICT (membership_id, dynamic_filter_id)
            WHERE dynamic_filter_id IS NOT NULL
          DO UPDATE SET
            source_account_id = EXCLUDED.source_account_id,
            source_name_snapshot = EXCLUDED.source_name_snapshot,
            is_current = true,
            data_type_category_item_id = EXCLUDED.data_type_category_item_id,
            updated_at = clock_timestamp();

          IF NOT COALESCE(v_origin_current, false) THEN
            UPDATE public.auto_account_contact_group_dynamic_filters
            SET matched_count = matched_count + 1
            WHERE id = v_filter.id;
          END IF;

          IF NOT COALESCE(v_was_member, false) THEN
            v_entered := v_entered + 1;
            v_changed_group_ids := pg_catalog.array_append(v_changed_group_ids, v_filter.group_id);
            UPDATE public.auto_account_contact_group_dynamic_filters
            SET last_entered_count = last_entered_count + 1
            WHERE id = v_filter.id;
            IF v_events_enabled THEN
              PERFORM private.aka_agent_data_group_record_member_event(v_run_id, p_organization_id, p_staff_id,
                v_filter.group_id, v_filter.id, v_filter.revision, v_member_id, v_queue.contact_id, 'added');
              v_event_count := v_event_count + 1;
            END IF;
          END IF;
        ELSE
          IF COALESCE(v_origin_current, false) THEN
            UPDATE public.auto_account_contact_group_member_origins
            SET is_current = false, updated_at = clock_timestamp()
            WHERE membership_id = v_member_id
              AND dynamic_filter_id = v_filter.id
              AND is_current = true;

            UPDATE public.auto_account_contact_group_dynamic_filters
            SET matched_count = GREATEST(0, matched_count - 1)
            WHERE id = v_filter.id;

            IF COALESCE(v_was_member, false) AND NOT EXISTS (
              SELECT 1
              FROM public.auto_account_contact_group_member_origins AS origin
              WHERE origin.membership_id = v_member_id
                AND origin.is_current = true
            ) THEN
              UPDATE public.auto_account_contact_group_members
              SET is_delete = true,
                  primary_origin_id = NULL,
                  change_revision = v_group.revision + 1,
                  updated_at = clock_timestamp()
              WHERE id = v_member_id;
              v_exited := v_exited + 1;
              v_changed_group_ids := pg_catalog.array_append(v_changed_group_ids, v_filter.group_id);
              UPDATE public.auto_account_contact_group_dynamic_filters
              SET last_exited_count = last_exited_count + 1
              WHERE id = v_filter.id;
              IF v_events_enabled THEN
                PERFORM private.aka_agent_data_group_record_member_event(v_run_id, p_organization_id, p_staff_id,
                  v_filter.group_id, v_filter.id, v_filter.revision, v_member_id, v_queue.contact_id, 'removed');
                v_event_count := v_event_count + 1;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;

      DELETE FROM public.auto_account_contact_dynamic_filter_queue
      WHERE contact_id = v_queue.contact_id;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.auto_account_contact_dynamic_filter_queue
      SET attempt_count = attempt_count + 1,
          last_error = left(SQLERRM, 1000),
          queued_at = clock_timestamp() + make_interval(
            secs => CASE
              WHEN attempt_count >= 8 THEN 3600
              ELSE 5 * (attempt_count + 1) * (attempt_count + 1)
            END
          )
      WHERE contact_id = v_queue.contact_id;
    END;
  END LOOP;

  IF pg_catalog.array_length(v_changed_group_ids, 1) IS NOT NULL THEN
    UPDATE public.auto_account_contact_groups AS contact_group
    SET revision = contact_group.revision + 1,
        updated_at = clock_timestamp()
    WHERE contact_group.id = ANY (v_changed_group_ids);
  END IF;

  IF pg_catalog.array_length(v_touched_filter_ids, 1) IS NOT NULL THEN
    UPDATE public.auto_account_contact_group_dynamic_filters AS dynamic_filter
    SET last_evaluated_at = clock_timestamp(),
        next_evaluation_at = NULL,
        updated_at = clock_timestamp()
    WHERE dynamic_filter.id = ANY (v_touched_filter_ids);
  END IF;

  IF v_event_count > 0 THEN
    PERFORM private.aka_agent_data_group_finish_member_events(v_run_id);
  END IF;

  SELECT count(*)::bigint INTO v_remaining
  FROM public.auto_account_contact_dynamic_filter_queue AS queue
  WHERE queue.staff_id = p_staff_id
    AND queue.organization_id = p_organization_id
    AND queue.queued_at <= clock_timestamp();

  RETURN jsonb_build_object(
    'processed_contact_count', v_processed,
    'evaluated_pair_count', v_pairs,
    'entered_count', v_entered,
    'exited_count', v_exited,
    'remaining_queue_count', v_remaining,
    'busy', false
  );
END;
$function$;

DO $v458_postcheck$
DECLARE v_fn regprocedure := 'public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)'::regprocedure;
BEGIN
  IF md5(pg_get_functiondef(v_fn)) IS DISTINCT FROM '3b94712afe9d6aa725d8af55d825c5cb' THEN
    RAISE EXCEPTION 'v458: dynamic filter core target checksum mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND prosecdef AND pg_get_userbyid(proowner) = 'postgres'
                   AND proconfig = ARRAY['search_path=pg_catalog, public'] AND proacl::text = '{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'v458: dynamic filter core metadata changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'private' AND p.proname IN ('aka_agent_notification_member_events_enabled','aka_agent_data_group_filter_summary',
                    'aka_agent_data_group_contact_label','aka_agent_data_group_record_member_event','aka_agent_notification_capture_data_group',
                    'aka_agent_data_group_finish_member_events')
                AND (NOT p.prosecdef OR has_function_privilege('public', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'v458: helper functions must be SECURITY DEFINER and not executable by PUBLIC';
  END IF;
  IF (SELECT value FROM public.auto_system_settings WHERE key = 'notifications.member_events.enabled') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'v458: member events switch must start disabled';
  END IF;
END
$v458_postcheck$;

COMMIT;

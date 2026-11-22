-- V624 (thông báo vào Trợ lý aka) — dán nguyên khối này vào Supabase SQL Editor (project akachat) rồi bấm Run.
-- Thành công: bảng kết quả có status = applied. Lỗi bất kỳ: không đổi gì trong DB.
BEGIN;
DO $v624_run$
DECLARE
  v_src text := $v624_src$-- V624: mọi thông báo thành một mục "thông báo" trong hộp Trợ lý aka (docs/NOTIFICATION_ASSISTANT_INBOX_PLAN.md).
-- Thêm cột ai_message.notification_id (FK, xóa thông báo thì xóa mục), hội thoại thông báo mỗi nhân viên, trigger chép thông báo
-- vừa có nội dung, công tắc notifications.assistant_inbox = off; item / stream / sync / read / agent_context / worker claim
-- nhận mục thông báo. Khóa md5 trước / sau từng hàm thay. Sinh bằng: python3 scripts/build-v624-sql.py
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $v624_pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v621_notification_daily_reports') THEN
    RAISE EXCEPTION 'v624: cần V621 trước';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v624_%') THEN
    RAISE EXCEPTION 'v624: đã có trong sổ migration, không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_message' AND column_name = 'notification_id') THEN
    RAISE EXCEPTION 'v624: ai_message.notification_id đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'notifications.assistant_inbox') THEN
    RAISE EXCEPTION 'v624: đã có cài đặt notifications.assistant_inbox';
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_ai_assistant_item(ai_message)'::regprocedure)) IS DISTINCT FROM 'f7d421b8977fedf20e6471a9dfa4ada6' THEN
    RAISE EXCEPTION 'v624: private.aka_agent_ai_assistant_item(ai_message) khác bản đã đọc 22/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_ai_assistant_item(ai_message)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_ai_assistant_stream(bigint,bigint,jsonb)'::regprocedure)) IS DISTINCT FROM '965d14b00e959a935b13e9ba98b05a9d' THEN
    RAISE EXCEPTION 'v624: private.aka_agent_ai_assistant_stream(bigint,bigint,jsonb) khác bản đã đọc 22/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_ai_assistant_stream(bigint,bigint,jsonb)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_ai_assistant_sync(bigint,bigint,jsonb)'::regprocedure)) IS DISTINCT FROM '0ca5dccc4c29ecd06666a68c52ea5750' THEN
    RAISE EXCEPTION 'v624: private.aka_agent_ai_assistant_sync(bigint,bigint,jsonb) khác bản đã đọc 22/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_ai_assistant_sync(bigint,bigint,jsonb)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_control_ai_assistant(bigint,bigint,text,text,jsonb,uuid)'::regprocedure)) IS DISTINCT FROM '7239d660fba11a324acd342b59698247' THEN
    RAISE EXCEPTION 'v624: public.aka_agent_control_ai_assistant(bigint,bigint,text,text,jsonb,uuid) khác bản đã đọc 22/11/2026 (md5 %)', md5(pg_get_functiondef('public.aka_agent_control_ai_assistant(bigint,bigint,text,text,jsonb,uuid)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_ai_assistant_agent_context(bigint,bigint,jsonb)'::regprocedure)) IS DISTINCT FROM 'e2cbd418d0c87926f55479d2da6416fc' THEN
    RAISE EXCEPTION 'v624: private.aka_agent_ai_assistant_agent_context(bigint,bigint,jsonb) khác bản đã đọc 22/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_ai_assistant_agent_context(bigint,bigint,jsonb)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_notification_worker(text,jsonb)'::regprocedure)) IS DISTINCT FROM '60eb06ec7d4f83d086b4aebb91e48b35' THEN
    RAISE EXCEPTION 'v624: public.aka_agent_notification_worker(text,jsonb) khác bản đã đọc 22/11/2026 (md5 %)', md5(pg_get_functiondef('public.aka_agent_notification_worker(text,jsonb)'::regprocedure));
  END IF;
END
$v624_pre$;

ALTER TABLE public.ai_message ADD COLUMN notification_id bigint;
ALTER TABLE public.ai_message ADD CONSTRAINT ai_message_notification_id_fkey
  FOREIGN KEY (notification_id) REFERENCES public.auto_notifications(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX uq_ai_message_notification ON public.ai_message (notification_id) WHERE notification_id IS NOT NULL;
CREATE UNIQUE INDEX uq_ai_assistant_notice_thread ON public.ai_message_thread (org_staff_id)
  WHERE answer_mode = 'assistant' AND (intake_data ->> 'kind') = 'notices';

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('notifications.assistant_inbox', '{"audience":"off"}',
   'V624: chép mọi thông báo vừa có nội dung thành mục "thông báo" trong hộp Trợ lý aka (trừ assistant.result, system.*). audience: off | admin_akabiz | orgs (organizationIds) | all. off = không chép, tắt khẩn cấp không cần deploy.',
   false, true);

-- Công tắc: off | admin_akabiz | orgs (organizationIds) | all. Đọc lại mỗi lần (một dòng cài đặt, có chỉ mục theo key).
CREATE FUNCTION private.aka_agent_ai_assistant_notice_allowed(p_staff_id bigint, p_organization_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v_cfg jsonb; v_audience text;
BEGIN
  BEGIN
    v_cfg := private.aka_agent_notification_setting('notifications.assistant_inbox', '{"audience":"off"}')::jsonb;
  EXCEPTION WHEN others THEN RETURN false;
  END;
  v_audience := coalesce(v_cfg ->> 'audience', 'off');
  IF v_audience = 'all' THEN RETURN true; END IF;
  IF v_audience = 'admin_akabiz' THEN
    RETURN coalesce((SELECT s.is_admin_akabiz FROM public.org_staff s WHERE s.id = p_staff_id), false);
  END IF;
  IF v_audience = 'orgs' AND jsonb_typeof(v_cfg -> 'organizationIds') = 'array' THEN
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v_cfg -> 'organizationIds') x
                    WHERE (x #>> '{}') ~ '^[0-9]{1,18}$' AND (x #>> '{}')::bigint = p_organization_id);
  END IF;
  RETURN false;
END
$function$;

-- Chép một thông báo đã có nội dung thành mục "thông báo" của Trợ lý aka. Trả mã mục (đã có thì trả mục cũ), không chép thì NULL.
-- Thứ tự khóa: dòng thông báo (bên gọi đang giữ) → hội thoại thông báo của nhân viên. Không đường nào khóa hội thoại này rồi mới
-- khóa thông báo, nên không có vòng chờ. Mọi lỗi thành WARNING và trả NULL: không bao giờ làm hỏng thông báo.
CREATE FUNCTION private.aka_agent_ai_assistant_notice(p_notification_id bigint)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  n public.auto_notifications%ROWTYPE; t public.ai_message_thread%ROWTYPE; a record;
  v_now timestamptz := clock_timestamp(); v_id bigint; v_seq integer; v_rev bigint; v_title text; v_body text;
BEGIN
  SELECT * INTO n FROM public.auto_notifications WHERE id = p_notification_id;
  IF NOT FOUND OR n.content_status IS DISTINCT FROM 'ready' OR n.staff_id IS NULL OR n.organization_id IS NULL
     OR n.event_type IN ('assistant.result', 'system.test', 'system.verify_email') THEN
    RETURN NULL;
  END IF;
  SELECT m.id INTO v_id FROM public.ai_message m WHERE m.notification_id = n.id;
  IF FOUND THEN RETURN v_id; END IF;
  IF NOT private.aka_agent_ai_assistant_notice_allowed(n.staff_id, n.organization_id)
     OR NOT private.aka_agent_ai_assistant_enabled() THEN
    RETURN NULL;
  END IF;
  -- Nhân viên còn hoạt động và đúng tổ chức (ném lỗi nếu không), lấy agent điều phối làm chủ hội thoại thông báo.
  a := private.aka_agent_ai_assistant_access(n.staff_id, n.organization_id);

  SELECT * INTO t FROM public.ai_message_thread
   WHERE org_staff_id = n.staff_id AND answer_mode = 'assistant' AND (intake_data ->> 'kind') = 'notices'
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.ai_message_thread (project_id, project_version, name, first_question, organization_id, org_staff_id,
        intake_data, source, request_id, revision, message_count, last_message_seq, last_message_at, created_at, updated_at)
    VALUES (a.conversation_project_id, a.conversation_project_version, 'Thông báo', 'Thông báo', n.organization_id, n.staff_id,
        jsonb_build_object('kind', 'notices'), 'api', gen_random_uuid(), 1, 0, 0, v_now, v_now, v_now)
    ON CONFLICT (org_staff_id) WHERE answer_mode = 'assistant' AND (intake_data ->> 'kind') = 'notices' DO NOTHING;
    SELECT * INTO t FROM public.ai_message_thread
     WHERE org_staff_id = n.staff_id AND answer_mode = 'assistant' AND (intake_data ->> 'kind') = 'notices'
     FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  v_title := left(coalesce(nullif(btrim(n.app_title), ''), 'Thông báo'), 4000);
  v_body := left(coalesce(n.app_body, ''), 50000);
  v_seq := t.last_message_seq + 1; v_rev := t.revision + 1;
  INSERT INTO public.ai_message (thread_id, seq, request_id, question, answer, answer_json, status, thread_rev, asked_at, queued_at,
      answered_at, completed_at, deadline_at, created_at, updated_at, worker_id, assistant_staff_id, notification_id)
  VALUES (t.id, v_seq, gen_random_uuid(), v_title, v_body,
      jsonb_build_object('notice', jsonb_strip_nulls(jsonb_build_object(
        'notificationId', n.id, 'eventType', n.event_type, 'severity', n.severity, 'entityKey', n.entity_key,
        'campaignId', n.campaign_id, 'accountId', n.account_id, 'dataGroupId', n.data_group_id, 'occurredAt', n.occurred_at,
        'title', n.app_title, 'body', n.app_body, 'content', n.content_snapshot))),
      'hoàn thành', v_rev, v_now, v_now, v_now, v_now, v_now, v_now, v_now, 'notification-center', n.staff_id, n.id)
  ON CONFLICT (notification_id) WHERE notification_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT m.id INTO v_id FROM public.ai_message m WHERE m.notification_id = n.id;
    RETURN v_id;
  END IF;
  -- Hội thoại thông báo luôn "đã xem" ở mức hội thoại (last_read_seq = last_message_seq): chưa đọc tính theo thông báo
  -- (auto_notifications.read_at), không theo hội thoại, nên không lọt vào danh sách "cần chú ý" của Hỏi đáp AI.
  UPDATE public.ai_message_thread
     SET revision = v_rev, message_count = message_count + 1, last_message_seq = v_seq, last_message_status = 'hoàn thành',
         last_message_at = v_now, last_read_seq = v_seq, updated_at = v_now
   WHERE id = t.id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'aka_assistant_notice (thông báo %): % %', p_notification_id, SQLSTATE, SQLERRM;
  RETURN NULL;
END
$function$;

CREATE FUNCTION private.aka_agent_ai_assistant_notice_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.content_status IS NOT DISTINCT FROM 'ready' THEN RETURN NULL; END IF;
  PERFORM private.aka_agent_ai_assistant_notice(NEW.id);
  RETURN NULL;
END
$function$;

-- Khách đã thấy các mục thông báo tới `p_upto` trong hộp Trợ lý aka: đánh dấu đã đọc thông báo tương ứng, hủy lượt đẩy còn chờ.
-- Thứ tự khóa như notify_seen và worker gửi thông báo: lượt gửi trước, dòng thông báo sau.
CREATE FUNCTION private.aka_agent_ai_assistant_notice_seen(p_staff_id bigint, p_upto bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v_ids bigint[]; v_now timestamptz := clock_timestamp(); v_id bigint; v_cancelled integer;
BEGIN
  SELECT array_agg(n.id ORDER BY n.id) INTO v_ids
    FROM public.ai_message m JOIN public.auto_notifications n ON n.id = m.notification_id
   WHERE m.assistant_staff_id = p_staff_id AND m.notification_id IS NOT NULL AND m.id <= p_upto
     AND n.staff_id = p_staff_id AND n.read_at IS NULL AND n.content_status = 'ready';
  IF v_ids IS NULL THEN RETURN 0; END IF;
  UPDATE public.auto_notification_deliveries d
     SET status = 'cancelled', last_error_code = 'read_in_app', lease_token = NULL, leased_until = NULL, updated_at = v_now
   WHERE d.notification_id = ANY (v_ids) AND d.channel = 'push' AND d.status IN ('pending', 'retrying');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  IF v_cancelled > 0 THEN
    FOREACH v_id IN ARRAY v_ids LOOP PERFORM private.aka_agent_notification_refresh_channel_state(v_id, 'push'); END LOOP;
  END IF;
  UPDATE public.auto_notifications SET read_at = v_now, updated_at = v_now WHERE id = ANY (v_ids) AND read_at IS NULL;
  RETURN cardinality(v_ids);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'aka_assistant_notice_seen (nhân viên %): % %', p_staff_id, SQLSTATE, SQLERRM;
  RETURN 0;
END
$function$;

DO $v624_grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['private.aka_agent_ai_assistant_notice_allowed(bigint,bigint)', 'private.aka_agent_ai_assistant_notice(bigint)', 'private.aka_agent_ai_assistant_notice_capture()', 'private.aka_agent_ai_assistant_notice_seen(bigint,bigint)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api', f);
  END LOOP;
END
$v624_grants$;

CREATE TRIGGER trg_aka_agent_ai_assistant_notice
  AFTER INSERT OR UPDATE OF content_status ON public.auto_notifications
  FOR EACH ROW WHEN (NEW.content_status = 'ready')
  EXECUTE FUNCTION private.aka_agent_ai_assistant_notice_capture();

-- Hàm thay thế (CREATE OR REPLACE giữ chủ sở hữu và quyền)
CREATE OR REPLACE FUNCTION private.aka_agent_ai_assistant_item(m ai_message)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'id', m.id, 'kind', CASE WHEN m.brief IS NOT NULL THEN 'work' WHEN m.notification_id IS NOT NULL THEN 'notice' ELSE 'turn' END,
    'threadId', m.thread_id, 'requestId', m.request_id, 'notificationId', m.notification_id,
    'question', m.question,
    'answer', CASE WHEN m.status = 'hoàn thành' THEN m.answer END,
    'answerJson', CASE WHEN m.status = 'hoàn thành' THEN m.answer_json END,
    'status', m.status,
    'progressNote', CASE WHEN m.status IN ('đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời') THEN m.progress_note END,
    'askedAt', m.asked_at, 'startedAt', m.started_at, 'completedAt', m.completed_at, 'deadlineAt', m.deadline_at, 'updatedAt', m.updated_at,
    'errorCode', m.error_code, 'errorMessage', m.error_message, 'rating', m.rating,
    'sourceMessageId', m.source_message_id, 'scheduleId', m.schedule_id, 'brief', m.brief,
    'review', CASE WHEN m.status = 'hoàn thành' THEN m.review END, 'reviseCount', m.revise_count,
    'images', CASE WHEN m.brief ? 'image' THEN coalesce(private.aka_agent_ai_assistant_images(m.id), '[]'::jsonb) ELSE '[]'::jsonb END,
    'attachments', coalesce(m.attachments, '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION private.aka_agent_ai_assistant_stream(p_staff_id bigint, p_organization_id bigint, v_p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  st public.ai_assistant_state%ROWTYPE; v_before bigint := private.aka_agent_ai_assistant_id(v_p -> 'beforeId');
  v_limit integer := coalesce(private.aka_agent_ai_chat_int(v_p -> 'limit', 30, 1, 50), 30); v_items jsonb; v_count integer;
  -- V624: chỉ app vẽ được mục thông báo mới nhận mục thông báo (bản cũ đọc loại lạ thành tin khách gõ).
  v_notices boolean := coalesce(v_p ->> 'includeNotices', '') = 'true';
BEGIN
  PERFORM private.aka_agent_ai_assistant_access(p_staff_id, p_organization_id);
  IF v_before IS NULL THEN PERFORM private.aka_agent_ai_assistant_expire(p_staff_id); END IF;
  st := private.aka_agent_ai_assistant_state(p_staff_id, p_organization_id);
  SELECT coalesce(jsonb_agg(private.aka_agent_ai_assistant_item(x) ORDER BY x.id), '[]'::jsonb), count(*) INTO v_items, v_count
    FROM (SELECT * FROM public.ai_message m
           WHERE m.assistant_staff_id = p_staff_id AND (v_before IS NULL OR m.id < v_before)
             AND (v_notices OR m.notification_id IS NULL)
           ORDER BY m.id DESC LIMIT v_limit) x;
  RETURN jsonb_build_object('items', v_items, 'hasMore', v_count = v_limit, 'lastReadMessageId', st.last_read_message_id,
    'limits', private.aka_agent_ai_assistant_limits(p_staff_id, st), 'serverTime', clock_timestamp());
END
$function$;

CREATE OR REPLACE FUNCTION private.aka_agent_ai_assistant_sync(p_staff_id bigint, p_organization_id bigint, v_p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_after bigint := coalesce(private.aka_agent_ai_assistant_id(v_p -> 'afterId'), 0); v_new jsonb; v_watched jsonb; v_ids bigint[];
  v_notices boolean := coalesce(v_p ->> 'includeNotices', '') = 'true'; -- V624
BEGIN
  PERFORM private.aka_agent_ai_assistant_access(p_staff_id, p_organization_id);
  SELECT coalesce(array_agg(private.aka_agent_ai_assistant_id(x)), '{}'::bigint[]) INTO v_ids
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_p -> 'watchIds') = 'array' THEN v_p -> 'watchIds' ELSE '[]'::jsonb END) WITH ORDINALITY AS q(x, n)
   WHERE n <= 10;
  IF EXISTS (SELECT 1 FROM public.ai_message m WHERE m.id = ANY (v_ids) AND m.assistant_staff_id = p_staff_id
               AND m.status = ANY (private.aka_agent_ai_chat_active())
               AND (m.deadline_at <= clock_timestamp() OR (m.lease_until IS NOT NULL AND m.lease_until < clock_timestamp()))) THEN
    PERFORM private.aka_agent_ai_assistant_expire(p_staff_id);
  END IF;
  SELECT coalesce(jsonb_agg(private.aka_agent_ai_assistant_item(x) ORDER BY x.id), '[]'::jsonb) INTO v_new
    FROM (SELECT * FROM public.ai_message m WHERE m.assistant_staff_id = p_staff_id AND m.id > v_after
             AND (v_notices OR m.notification_id IS NULL) ORDER BY m.id LIMIT 50) x;
  SELECT coalesce(jsonb_agg(private.aka_agent_ai_assistant_item(m) ORDER BY m.id), '[]'::jsonb) INTO v_watched
    FROM public.ai_message m WHERE m.id = ANY (v_ids) AND m.assistant_staff_id = p_staff_id;
  RETURN jsonb_build_object('items', v_new, 'watched', v_watched, 'serverTime', clock_timestamp());
END
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_control_ai_assistant(p_staff_id bigint, p_organization_id bigint, p_client text, p_action text, p_payload jsonb, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_p jsonb := CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END;
  st public.ai_assistant_state%ROWTYPE; m public.ai_message%ROWTYPE; v_id bigint; v_ok boolean; v_request uuid; v_seen integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_organization_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ai_assistant_access_denied'; END IF;
  IF p_action = 'context' THEN
    -- Gửi lại một lượt đã ghi (mất mạng lúc chờ trả lời): trả đúng lượt cũ để API không gọi model lần nữa.
    BEGIN
      v_request := nullif(v_p ->> 'requestId', '')::uuid;
    EXCEPTION WHEN others THEN v_request := NULL; END;
    IF v_request IS NOT NULL AND EXISTS (SELECT 1 FROM public.ai_message x WHERE x.request_id = v_request AND x.assistant_staff_id = p_staff_id) THEN
      RETURN jsonb_build_object('duplicate', private.aka_agent_ai_assistant_commit(p_staff_id, p_organization_id, p_client,
        jsonb_build_object('requestId', v_request, 'text', '-', 'conversation', 'continue')));
    END IF;
    RETURN private.aka_agent_ai_assistant_context(p_staff_id, p_organization_id);
  ELSIF p_action = 'commit' THEN RETURN private.aka_agent_ai_assistant_commit(p_staff_id, p_organization_id, p_client, v_p);
  ELSIF p_action = 'stream' THEN RETURN private.aka_agent_ai_assistant_stream(p_staff_id, p_organization_id, v_p);
  ELSIF p_action = 'sync' THEN RETURN private.aka_agent_ai_assistant_sync(p_staff_id, p_organization_id, v_p);
  ELSIF p_action = 'read' THEN
    -- App báo khách đang nhìn hộp hội thoại và đã thấy tới tin `uptoId`. App gọi lại mỗi khi có thêm việc xong, kể cả khi
    -- `uptoId` không đổi (một việc cũ vừa xong nằm trước các lượt trò chuyện mới hơn).
    PERFORM private.aka_agent_ai_assistant_access(p_staff_id, p_organization_id);
    st := private.aka_agent_ai_assistant_state(p_staff_id, p_organization_id);
    v_id := private.aka_agent_ai_assistant_id(v_p -> 'uptoId');
    IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.ai_message x WHERE x.id = v_id AND x.assistant_staff_id = p_staff_id) THEN
      IF v_id > st.last_read_message_id THEN
        UPDATE public.ai_assistant_state SET last_read_message_id = v_id, updated_at = clock_timestamp() WHERE org_staff_id = p_staff_id;
        st.last_read_message_id := v_id;
      END IF;
      -- Chỉ hội thoại có tin cuối đã xong: việc còn đang làm thì kết quả của nó chưa ai thấy.
      -- Hội thoại đang bị đường khác khóa (bộ trả lời đang ghi, lượt dọn câu quá hạn) thì bỏ qua: lần xem sau đánh dấu tiếp.
      UPDATE public.ai_message_thread t SET last_read_seq = t.last_message_seq, updated_at = clock_timestamp()
       WHERE t.id IN (SELECT s.id FROM public.ai_message_thread s
                       WHERE s.org_staff_id = p_staff_id AND s.answer_mode = 'assistant' AND NOT s.is_delete AND s.last_read_seq < s.last_message_seq
                         AND (s.intake_data ->> 'kind') IN ('work', 'schedule')
                         AND NOT (s.last_message_status = ANY (private.aka_agent_ai_chat_active()))
                         AND NOT EXISTS (SELECT 1 FROM public.ai_message x WHERE x.thread_id = s.id AND x.id > v_id)
                       FOR UPDATE SKIP LOCKED);
      v_seen := private.aka_agent_ai_assistant_notify_seen(p_staff_id, v_id);
      -- V624: app vẽ được mục thông báo thì thông báo đã hiện trong hộp tới `uptoId` cũng là đã đọc.
      IF coalesce(v_p ->> 'includeNotices', '') = 'true' THEN
        v_seen := v_seen + private.aka_agent_ai_assistant_notice_seen(p_staff_id, v_id);
      END IF;
    END IF;
    RETURN jsonb_build_object('lastReadMessageId', st.last_read_message_id,
      'notificationUnreadCount', CASE WHEN v_seen > 0 THEN private.aka_agent_notification_unread_count(p_staff_id) END);
  ELSIF p_action = 'cancel_work' THEN
    PERFORM private.aka_agent_ai_assistant_access(p_staff_id, p_organization_id);
    PERFORM private.aka_agent_ai_assistant_lock(p_staff_id);
    v_id := private.aka_agent_ai_assistant_id(v_p -> 'messageId');
    v_ok := private.aka_agent_ai_assistant_cancel(p_staff_id, v_id);
    SELECT * INTO m FROM public.ai_message WHERE id = v_id AND assistant_staff_id = p_staff_id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_assistant_not_found'; END IF;
    RETURN jsonb_build_object('cancelled', v_ok, 'item', private.aka_agent_ai_assistant_item(m));
  ELSIF p_action = 'rate' THEN
    PERFORM private.aka_agent_ai_assistant_access(p_staff_id, p_organization_id);
    v_id := private.aka_agent_ai_assistant_id(v_p -> 'messageId');
    UPDATE public.ai_message SET rating = CASE WHEN v_p ->> 'rating' IN ('1', '-1') THEN (v_p ->> 'rating')::smallint END,
           rating_note = private.aka_agent_ai_assistant_text(v_p -> 'note', 1000), updated_at = clock_timestamp()
     WHERE id = v_id AND assistant_staff_id = p_staff_id AND brief IS NOT NULL AND status = 'hoàn thành' RETURNING * INTO m;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_assistant_not_found'; END IF;
    RETURN jsonb_build_object('item', private.aka_agent_ai_assistant_item(m));
  ELSIF p_action LIKE 'schedule_%' THEN
    PERFORM private.aka_agent_ai_assistant_access(p_staff_id, p_organization_id);
    RETURN private.aka_agent_ai_schedule_action(p_staff_id, p_organization_id, p_client, substr(p_action, 10), v_p);
  END IF;
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_assistant_invalid_request';
END
$function$;

CREATE OR REPLACE FUNCTION private.aka_agent_ai_assistant_agent_context(p_staff_id bigint, p_organization_id bigint, v_p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  a record; st public.ai_assistant_state%ROWTYPE; pr public.ai_project%ROWTYPE; g public.ai_project_group%ROWTYPE;
  t public.ai_message_thread%ROWTYPE; m public.ai_message%ROWTYPE;
  v_now timestamptz := clock_timestamp(); v_local timestamp := v_now AT TIME ZONE 'Asia/Ho_Chi_Minh'; v_request uuid;
  v_code text := private.aka_agent_ai_assistant_text(v_p -> 'agent', 64);
  v_thread bigint := private.aka_agent_ai_assistant_id(v_p -> 'threadId');
  v_resume boolean := coalesce(v_p ->> 'resume', '') = 'true';
  v_idle integer := private.aka_agent_ai_chat_int_setting('ai_assistant.agent_idle_minutes', 120, 1440);
  v_cap integer := private.aka_agent_ai_chat_int_setting('ai_assistant.agent_max_turns', 40, 200);
  v_expired boolean := false; v_session jsonb;
BEGIN
  IF NOT private.aka_agent_ai_assistant_agent_enabled() THEN
    IF v_resume THEN RETURN jsonb_build_object('agent', NULL); END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_assistant_agent_unavailable';
  END IF;
  a := private.aka_agent_ai_assistant_access(p_staff_id, p_organization_id);
  BEGIN
    v_request := nullif(v_p ->> 'requestId', '')::uuid;
  EXCEPTION WHEN others THEN v_request := NULL; END;
  PERFORM private.aka_agent_ai_assistant_lock(p_staff_id);
  st := private.aka_agent_ai_assistant_state(p_staff_id, p_organization_id);
  IF v_request IS NOT NULL THEN
    SELECT * INTO m FROM public.ai_message x WHERE x.request_id = v_request;
    IF FOUND THEN
      IF m.assistant_staff_id IS DISTINCT FROM p_staff_id THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_assistant_invalid_request'; END IF;
      RETURN jsonb_build_object('duplicate', jsonb_build_object('duplicate', true,
        'items', (SELECT coalesce(jsonb_agg(private.aka_agent_ai_assistant_item(x) ORDER BY x.id), '[]'::jsonb) FROM public.ai_message x
                   WHERE x.id = m.id OR (x.source_message_id = m.id AND x.assistant_staff_id = p_staff_id)),
        'schedules', '[]'::jsonb, 'blocked', m.answer_json #>> '{result,blocked}',
        'limits', private.aka_agent_ai_assistant_limits(p_staff_id, st)));
    END IF;
  END IF;

  IF v_resume THEN
    SELECT * INTO t FROM public.ai_message_thread x
     WHERE x.org_staff_id = p_staff_id AND x.answer_mode = 'assistant' AND x.status = 'đang mở' AND NOT x.is_delete
       AND (x.intake_data ->> 'kind') = 'agent'
     ORDER BY x.last_message_at DESC, x.id DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('agent', NULL); END IF;
    -- Sau lượt của agent khách đã trao đổi việc khác với Trợ lý aka: tin này không còn là lời đáp cho agent.
    IF EXISTS (SELECT 1 FROM public.ai_message x
                WHERE x.assistant_staff_id = p_staff_id AND x.brief IS NULL AND x.thread_id <> t.id
                  AND x.notification_id IS NULL -- V624: thông báo tới giữa chừng không làm đứt phiên agent
                  AND x.id > (SELECT max(y.id) FROM public.ai_message y WHERE y.thread_id = t.id)) THEN
      RETURN jsonb_build_object('agent', NULL);
    END IF;
    SELECT p.code INTO v_code FROM public.ai_project p WHERE p.id = t.project_id;
  END IF;
  IF v_code IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_assistant_invalid_request'; END IF;
  pr := private.aka_agent_ai_assistant_agent_row(p_staff_id, v_code);
  SELECT * INTO g FROM public.ai_project_group x WHERE x.id = pr.group_id;

  IF NOT v_resume AND v_thread IS NOT NULL THEN
    SELECT * INTO t FROM public.ai_message_thread x
     WHERE x.id = v_thread AND x.org_staff_id = p_staff_id AND x.project_id = pr.id AND x.answer_mode = 'assistant' AND NOT x.is_delete
       AND (x.intake_data ->> 'kind') = 'agent' AND x.status = 'đang mở'
     FOR UPDATE;
    IF NOT FOUND THEN v_expired := true; END IF;
  END IF;
  -- Phiên để quá lâu hoặc quá dài: đóng, lượt này mở phiên mới.
  IF t.id IS NOT NULL AND (t.last_message_at < v_now - make_interval(mins => v_idle) OR t.message_count >= v_cap) THEN
    PERFORM private.aka_agent_ai_assistant_agent_close(t.id, CASE WHEN t.message_count >= v_cap THEN 'cap' ELSE 'idle' END);
    t := NULL; v_expired := true;
  END IF;
  IF t.id IS NOT NULL THEN
    v_session := jsonb_build_object('threadId', t.id, 'turnCount', t.message_count, 'state', t.intake_data -> 'session',
      'turns', private.aka_agent_ai_assistant_agent_turns(t.id, 40));
  END IF;

  RETURN jsonb_build_object(
    'now', v_now, 'today', to_char(v_local, 'YYYY-MM-DD'), 'time', to_char(v_local, 'HH24:MI'),
    'staff', jsonb_build_object('id', p_staff_id, 'name', a.staff_name),
    'agent', jsonb_build_object('id', pr.id, 'code', pr.code, 'name', pr.name, 'description', pr.description, 'version', pr.version,
      'rules', pr.rules, 'groupCode', g.code, 'groupName', g.name, 'groupRules', g.rules,
      'modelId', pr.model_id, 'fallbackModelId', pr.fallback_model_id, 'formConfigId', pr.form_config_id,
      'campaignActionId', pr.campaign_action_id, 'command', pr.launcher ->> 'command'),
    'session', v_session, 'expired', v_expired,
    'limits', private.aka_agent_ai_assistant_limits(p_staff_id, st));
END
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_notification_worker(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_limit integer; v_lease integer; v_result jsonb; v_id bigint; v_token uuid; v_status text; g record;
  v_n public.auto_notifications%ROWTYPE;
  v_d public.auto_notification_deliveries%ROWTYPE;
  v_outcome text; v_delay integer;
BEGIN
  IF p_action = 'claim_render' THEN
    v_limit := least(greatest(coalesce((v_payload ->> 'limit')::integer, 20), 1), 50);
    v_lease := least(greatest(coalesce((v_payload ->> 'leaseSeconds')::integer, 120), 30), 600);
    -- Gộp các thông báo chiến dịch cùng trạng thái của một nhân viên đến hạn cùng lượt (capture đã dồn về cùng mốc) thành 1.
    FOR g IN
      WITH due AS (
        SELECT n.id, n.staff_id, n.payload ->> 'toStatus' AS to_status, n.occurred_at
          FROM public.auto_notifications n
         WHERE n.content_status = 'pending' AND n.deliver_after <= v_now AND n.event_type = 'campaign.status_changed'
         ORDER BY n.deliver_after, n.id LIMIT 2000
           FOR UPDATE SKIP LOCKED)
      SELECT staff_id, to_status, min(id) AS keep_id, array_agg(id ORDER BY id) AS ids, count(*) AS total
        FROM due GROUP BY staff_id, to_status
      HAVING count(*) >= 2
    LOOP
      UPDATE public.auto_notifications
         SET payload = payload || jsonb_build_object(
               'mergedCount', g.total - 1,
               'merged', (SELECT jsonb_agg(jsonb_build_object('campaignId', x.campaign_id, 'campaignName', x.payload ->> 'campaignName',
                                                              'note', x.payload ->> 'note') ORDER BY x.id)
                            FROM (SELECT * FROM public.auto_notifications WHERE id = ANY (g.ids) ORDER BY id LIMIT 50) x)),
             updated_at = v_now
       WHERE id = g.keep_id;
      UPDATE public.auto_notifications SET content_status = 'merged', merged_into_id = g.keep_id, updated_at = v_now
       WHERE id = ANY (g.ids) AND id <> g.keep_id;
    END LOOP;
    WITH picked AS (
      SELECT n.id FROM public.auto_notifications n
       WHERE (n.content_status = 'pending' AND n.deliver_after <= v_now) OR (n.content_status = 'rendering' AND n.leased_until < v_now)
       ORDER BY n.deliver_after, n.id LIMIT v_limit
         FOR UPDATE SKIP LOCKED
    ), upd AS (
      UPDATE public.auto_notifications n
         SET content_status = CASE WHEN n.attempt_count >= 5 THEN 'failed' ELSE 'rendering' END,
             lease_token = CASE WHEN n.attempt_count >= 5 THEN NULL ELSE gen_random_uuid() END,
             leased_until = CASE WHEN n.attempt_count >= 5 THEN NULL ELSE v_now + make_interval(secs => v_lease) END,
             last_error = CASE WHEN n.attempt_count >= 5 THEN 'render_attempts_exhausted' ELSE n.last_error END,
             attempt_count = n.attempt_count + 1,
             updated_at = v_now
        FROM picked WHERE n.id = picked.id
      RETURNING n.*
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', u.id, 'leaseToken', u.lease_token, 'eventType', u.event_type, 'severity', u.severity,
             'staffId', u.staff_id, 'organizationId', u.organization_id, 'staffName', st.name,
             'timezone', coalesce(es.timezone, 'Asia/Ho_Chi_Minh'),
             'campaignId', u.campaign_id, 'accountId', u.account_id, 'dataGroupId', u.data_group_id,
             'entityKey', u.entity_key, 'occurredAt', u.occurred_at, 'payload', u.payload, 'attempt', u.attempt_count) ORDER BY u.id), '[]'::jsonb)
      INTO v_result
      FROM upd u
      LEFT JOIN public.org_staff st ON st.id = u.staff_id
      LEFT JOIN public.auto_email_notification_settings es ON es.staff_id = u.staff_id
     WHERE u.content_status = 'rendering';
    RETURN jsonb_build_object('items', v_result);

  ELSIF p_action = 'complete_render' THEN
    v_id := (v_payload ->> 'id')::bigint;
    v_token := (v_payload ->> 'leaseToken')::uuid;
    v_status := v_payload ->> 'status';
    SELECT * INTO v_n FROM public.auto_notifications WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR v_n.content_status <> 'rendering' OR v_n.lease_token IS DISTINCT FROM v_token THEN
      RETURN jsonb_build_object('ok', false, 'error', 'lease_lost');
    END IF;
    IF v_status = 'ready' THEN
      IF coalesce(char_length(v_payload ->> 'appTitle'), 0) NOT BETWEEN 1 AND 200
         OR coalesce(char_length(v_payload ->> 'appBody'), 0) > 1000
         OR coalesce(char_length(v_payload ->> 'emailSubject'), 0) NOT BETWEEN 1 AND 300
         OR (v_payload -> 'contentSnapshot' IS NOT NULL AND jsonb_typeof(v_payload -> 'contentSnapshot') <> 'object')
         OR pg_column_size(v_payload -> 'contentSnapshot') > 524288 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_content');
      END IF;
      UPDATE public.auto_notifications
         SET content_status = 'ready', app_title = v_payload ->> 'appTitle', app_body = v_payload ->> 'appBody',
             email_subject = v_payload ->> 'emailSubject', content_snapshot = v_payload -> 'contentSnapshot',
             template_version = coalesce((v_payload ->> 'templateVersion')::smallint, 1),
             lease_token = NULL, leased_until = NULL, last_error = NULL, updated_at = v_now,
             -- created_at = lúc vào hộp thư: thông báo gộp theo khung (tạo từ đầu khung) vẫn lên đầu danh sách.
             created_at = v_now
       WHERE id = v_id;
      RETURN jsonb_build_object('ok', true, 'fanout', private.aka_agent_notification_fanout(v_id));
    ELSIF v_status IN ('suppressed', 'failed') THEN
      UPDATE public.auto_notifications
         SET content_status = v_status, lease_token = NULL, leased_until = NULL, last_error = left(v_payload ->> 'error', 500), updated_at = v_now
       WHERE id = v_id;
      RETURN jsonb_build_object('ok', true);
    ELSIF v_status = 'retry' THEN
      UPDATE public.auto_notifications
         SET content_status = 'pending', deliver_after = v_now + interval '1 minute', lease_token = NULL, leased_until = NULL,
             last_error = left(v_payload ->> 'error', 500), updated_at = v_now
       WHERE id = v_id;
      RETURN jsonb_build_object('ok', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');

  ELSIF p_action = 'claim_deliveries' THEN
    v_limit := least(greatest(coalesce((v_payload ->> 'limit')::integer, 50), 1), 100);
    v_lease := least(greatest(coalesce((v_payload ->> 'leaseSeconds')::integer, 120), 30), 600);
    WITH picked AS (
      SELECT d.id FROM public.auto_notification_deliveries d
       WHERE (d.status IN ('pending', 'retrying') AND d.next_attempt_at <= v_now) OR (d.status = 'sending' AND d.leased_until < v_now)
       ORDER BY d.next_attempt_at, d.id LIMIT v_limit
         FOR UPDATE SKIP LOCKED
    ), upd AS (
      UPDATE public.auto_notification_deliveries d
         SET status = 'sending', lease_token = gen_random_uuid(), leased_until = v_now + make_interval(secs => v_lease),
             attempt_count = d.attempt_count + 1, updated_at = v_now
        FROM picked WHERE d.id = picked.id
      RETURNING d.*
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', u.id, 'leaseToken', u.lease_token, 'channel', u.channel, 'provider', u.provider,
             'destination', CASE WHEN u.channel = 'email' THEN u.destination END,
             'attempt', u.attempt_count, 'maxAttempts', u.max_attempts,
             'notification', jsonb_build_object('id', n.id, 'eventType', n.event_type, 'severity', n.severity, 'staffId', n.staff_id,
               'organizationId', n.organization_id,
               'entityKey', n.entity_key, 'occurredAt', n.occurred_at, 'appTitle', n.app_title, 'appBody', n.app_body,
               'emailSubject', n.email_subject, 'templateVersion', n.template_version,
               'contentSnapshot', CASE WHEN u.channel = 'email' THEN n.content_snapshot END,
               'payload', CASE WHEN n.event_type = 'system.verify_email' THEN n.payload END,
               -- V624: mục của thông báo trong Trợ lý aka (lượt đẩy mở thẳng mục này với bản iOS vẽ được nó).
               'assistantItemId', CASE WHEN u.channel = 'push' THEN (SELECT m.id FROM public.ai_message m WHERE m.notification_id = n.id) END),
             'device', CASE WHEN u.channel = 'push' THEN jsonb_build_object('id', dv.id, 'pushToken', dv.push_token,
               'apnsEnvironment', dv.apns_environment, 'bundleId', dv.bundle_id, 'appVersion', dv.app_version,
               'active', coalesce(dv.is_active AND dv.is_enabled AND cs.revoked_at IS NULL AND cs.expires_at > v_now AND cs.staff_id = u.staff_id, false)) END,
             'badge', CASE WHEN u.channel = 'push' THEN (SELECT least(count(*), 100) FROM public.auto_notifications x
                                                          WHERE x.staff_id = u.staff_id AND x.read_at IS NULL AND x.content_status = 'ready') END
           ) ORDER BY u.id), '[]'::jsonb)
      INTO v_result
      FROM upd u
      JOIN public.auto_notifications n ON n.id = u.notification_id
      LEFT JOIN public.auto_notification_devices dv ON dv.id = u.device_id
      LEFT JOIN public.auto_control_sessions cs ON cs.id = dv.control_session_id;
    RETURN jsonb_build_object('items', v_result);

  ELSIF p_action = 'complete_delivery' THEN
    v_id := (v_payload ->> 'id')::bigint;
    v_token := (v_payload ->> 'leaseToken')::uuid;
    v_outcome := v_payload ->> 'outcome';
    SELECT * INTO v_d FROM public.auto_notification_deliveries WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR v_d.status <> 'sending' OR v_d.lease_token IS DISTINCT FROM v_token THEN
      RETURN jsonb_build_object('ok', false, 'error', 'lease_lost');
    END IF;
    IF v_outcome = 'sent' THEN
      UPDATE public.auto_notification_deliveries
         SET status = 'sent', sent_at = v_now, provider_message_id = left(v_payload ->> 'providerMessageId', 300),
             last_error_code = NULL, last_error = NULL, lease_token = NULL, leased_until = NULL, updated_at = v_now
       WHERE id = v_id;
      IF v_d.device_id IS NOT NULL THEN
        UPDATE public.auto_notification_devices SET last_success_at = v_now, failure_count = 0, updated_at = v_now WHERE id = v_d.device_id;
      END IF;
    ELSIF v_outcome = 'retry' THEN
      v_delay := CASE v_d.attempt_count WHEN 1 THEN 1 WHEN 2 THEN 5 WHEN 3 THEN 15 ELSE 60 END;
      UPDATE public.auto_notification_deliveries
         SET status = CASE WHEN v_d.attempt_count >= v_d.max_attempts THEN 'failed' ELSE 'retrying' END,
             next_attempt_at = v_now + make_interval(mins => v_delay),
             last_error_code = left(v_payload ->> 'errorCode', 100), last_error = left(v_payload ->> 'error', 500),
             lease_token = NULL, leased_until = NULL, updated_at = v_now
       WHERE id = v_id;
      IF v_d.device_id IS NOT NULL THEN
        UPDATE public.auto_notification_devices SET last_failure_at = v_now, failure_count = failure_count + 1, updated_at = v_now WHERE id = v_d.device_id;
      END IF;
    ELSIF v_outcome IN ('failed', 'invalid_token', 'cancelled') THEN
      UPDATE public.auto_notification_deliveries
         SET status = CASE WHEN v_outcome = 'cancelled' THEN 'cancelled' ELSE 'failed' END,
             last_error_code = left(coalesce(v_payload ->> 'errorCode', v_outcome), 100), last_error = left(v_payload ->> 'error', 500),
             lease_token = NULL, leased_until = NULL, updated_at = v_now
       WHERE id = v_id;
      IF v_outcome = 'invalid_token' AND v_d.device_id IS NOT NULL THEN
        UPDATE public.auto_notification_devices
           SET is_active = false, deactivated_reason = 'token_invalid', last_failure_at = v_now, updated_at = v_now
         WHERE id = v_d.device_id;
      END IF;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_outcome');
    END IF;
    PERFORM private.aka_agent_notification_refresh_channel_state(v_d.notification_id, v_d.channel);
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'release' THEN
    UPDATE private.aka_agent_notification_dispatch_state SET leased_until = NULL, updated_at = v_now WHERE id = 1;
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'sender' THEN
    -- Cấu hình SMTP của tài khoản email gửi thông báo (auto_accounts.email_session). Chỉ service_role gọi được hàm này;
    -- mật khẩu chỉ đi tới worker trên server, không bao giờ trả cho client.
    SELECT jsonb_build_object('configured', true, 'accountId', a.id,
             'host', btrim(a.email_session ->> 'host'),
             'port', CASE WHEN (a.email_session ->> 'port') ~ '^[0-9]{1,5}$' THEN (a.email_session ->> 'port')::integer ELSE 587 END,
             'secure', lower(coalesce(a.email_session ->> 'secure', 'false')) = 'true',
             'user', btrim(coalesce(a.email_session ->> 'user', '')), 'pass', a.email_session ->> 'pass',
             'fromEmail', lower(btrim(a.email_session ->> 'fromEmail')),
             'brandName', nullif(btrim(coalesce(a.email_session ->> 'brandName', '')), ''),
             'replyTo', nullif(btrim(coalesce(a.email_session ->> 'replyTo', '')), ''))
      INTO v_result
      FROM public.auto_accounts a
     WHERE a.id = (SELECT CASE WHEN v ~ '^[0-9]{1,18}$' THEN v::bigint END
                     FROM (SELECT btrim(private.aka_agent_notification_setting('notifications.email.sender_account_id', '')) AS v) x)
       AND a.flatform_type = 'email' AND a.is_delete IS NOT TRUE AND a.is_active IS NOT FALSE
       AND jsonb_typeof(a.email_session) = 'object'
       AND nullif(btrim(coalesce(a.email_session ->> 'host', '')), '') IS NOT NULL
       AND nullif(btrim(coalesce(a.email_session ->> 'fromEmail', '')), '') IS NOT NULL
       AND nullif(a.email_session ->> 'pass', '') IS NOT NULL;
    RETURN coalesce(v_result, jsonb_build_object('configured', false));

  ELSIF p_action = 'stats' THEN
    RETURN jsonb_build_object(
      'enabled', private.aka_agent_notification_enabled(),
      'deliveryMode', private.aka_agent_notification_setting('notifications.delivery_mode', 'dry_run'),
      'pendingRender', (SELECT count(*) FROM public.auto_notifications WHERE content_status IN ('pending', 'rendering')),
      'pendingDeliveries', (SELECT count(*) FROM public.auto_notification_deliveries WHERE status IN ('pending', 'retrying', 'sending')),
      'dueNow', (SELECT count(*) FROM public.auto_notifications WHERE content_status = 'pending' AND deliver_after <= v_now));
  END IF;
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_worker_invalid_action';
END
$function$;

DO $v624_post$
BEGIN
  IF md5(pg_get_functiondef('private.aka_agent_ai_assistant_item(ai_message)'::regprocedure)) IS DISTINCT FROM '1ceaa2192a8187af4f58759876973930' THEN
    RAISE EXCEPTION 'v624: private.aka_agent_ai_assistant_item(ai_message) sau khi thay không đúng bản V624 (md5 %)', md5(pg_get_functiondef('private.aka_agent_ai_assistant_item(ai_message)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_ai_assistant_stream(bigint,bigint,jsonb)'::regprocedure)) IS DISTINCT FROM '0afcb10adeaa818089ff4d947cd9ebc3' THEN
    RAISE EXCEPTION 'v624: private.aka_agent_ai_assistant_stream(bigint,bigint,jsonb) sau khi thay không đúng bản V624 (md5 %)', md5(pg_get_functiondef('private.aka_agent_ai_assistant_stream(bigint,bigint,jsonb)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_ai_assistant_sync(bigint,bigint,jsonb)'::regprocedure)) IS DISTINCT FROM 'fd0b2fa3011125a14073deccca15b76f' THEN
    RAISE EXCEPTION 'v624: private.aka_agent_ai_assistant_sync(bigint,bigint,jsonb) sau khi thay không đúng bản V624 (md5 %)', md5(pg_get_functiondef('private.aka_agent_ai_assistant_sync(bigint,bigint,jsonb)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_control_ai_assistant(bigint,bigint,text,text,jsonb,uuid)'::regprocedure)) IS DISTINCT FROM '68b766e23dcbd45705b4e76aa4a08311' THEN
    RAISE EXCEPTION 'v624: public.aka_agent_control_ai_assistant(bigint,bigint,text,text,jsonb,uuid) sau khi thay không đúng bản V624 (md5 %)', md5(pg_get_functiondef('public.aka_agent_control_ai_assistant(bigint,bigint,text,text,jsonb,uuid)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_ai_assistant_agent_context(bigint,bigint,jsonb)'::regprocedure)) IS DISTINCT FROM 'aeff942a414429b399419c0057c8a9cb' THEN
    RAISE EXCEPTION 'v624: private.aka_agent_ai_assistant_agent_context(bigint,bigint,jsonb) sau khi thay không đúng bản V624 (md5 %)', md5(pg_get_functiondef('private.aka_agent_ai_assistant_agent_context(bigint,bigint,jsonb)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_notification_worker(text,jsonb)'::regprocedure)) IS DISTINCT FROM '86a893ab6e9ff2cba0c13dbc4be00487' THEN
    RAISE EXCEPTION 'v624: public.aka_agent_notification_worker(text,jsonb) sau khi thay không đúng bản V624 (md5 %)', md5(pg_get_functiondef('public.aka_agent_notification_worker(text,jsonb)'::regprocedure));
  END IF;
END
$v624_post$;
COMMIT;
$v624_src$;
  v_body text;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v624_notification_assistant_inbox') THEN
    RAISE EXCEPTION 'V624 đã chạy rồi, không chạy lại';
  END IF;
  v_src := replace(v_src, E'\r\n', E'\n');
  IF md5(v_src) <> '7a47a5b8215103c95f174f11757f565c' THEN
    RAISE EXCEPTION 'Nội dung dán bị thiếu hoặc sai (md5 %), chưa chạy gì; chép lại nguyên khối', md5(v_src);
  END IF;
  v_body := substr(v_src, strpos(v_src, E'\nBEGIN;\n') + 8);
  v_body := left(v_body, length(v_body) - length(E'COMMIT;\n'));
  EXECUTE v_body;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  SELECT to_char(greatest(clock_timestamp() AT TIME ZONE 'UTC',
                          max(to_timestamp(version, 'YYYYMMDDHH24MISS')::timestamp) + interval '1 second'),
                 'YYYYMMDDHH24MISS'), 'migration_v624_notification_assistant_inbox', ARRAY[v_src]
  FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]{14}$';
END
$v624_run$;
COMMIT;
SELECT 'applied' AS status, version, name, md5(statements[1]) = '7a47a5b8215103c95f174f11757f565c' AS md5_khop_file
FROM supabase_migrations.schema_migrations WHERE name = 'migration_v624_notification_assistant_inbox';

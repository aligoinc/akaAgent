#!/usr/bin/env python3
"""Sinh V624: mọi thông báo của trung tâm thông báo thành một mục "thông báo" trong hộp Trợ lý aka.

Phương án và quyết định: docs/NOTIFICATION_ASSISTANT_INBOX_PLAN.md (anh chốt 22/11/2026: mọi loại, giữ chuông song song,
Desktop giữ chuông, iOS mời bật đẩy).

- Cột `ai_message.notification_id` (khóa ngoại tới `auto_notifications`, xóa thông báo thì xóa mục), mỗi nhân viên một hội thoại
  "thông báo" (`intake_data.kind = 'notices'`, làn `assistant`) dưới agent điều phối của Trợ lý aka.
- Trigger trên `auto_notifications`: thông báo vừa có nội dung (`content_status = 'ready'`) thì chép thành mục, trong cùng giao dịch,
  bọc khối bắt lỗi (ghi mục hỏng không bao giờ làm hỏng thông báo). Bỏ `assistant.result` (đã là mục việc), `system.test`,
  `system.verify_email`. Công tắc `notifications.assistant_inbox` (off | admin_akabiz | orgs | all), migration đặt off.
- `aka_agent_ai_assistant_item` trả `kind = 'notice'` + `notificationId`; `stream` / `sync` chỉ trả mục thông báo khi app gửi
  `includeNotices: true` (bản app cũ đọc loại lạ thành tin khách gõ); `read` của app đó đánh dấu đã đọc thông báo đã hiện và hủy
  lượt đẩy còn chờ.
- `agent_context`: mục thông báo không làm đứt phiên agent "/" đang dở.
- `aka_agent_notification_worker` `claim_deliveries`: lượt đẩy kèm `assistantItemId` (mục thông báo) và `device.appVersion`, để API
  mở thẳng mục trong Trợ lý aka với bản iOS vẽ được mục này.

Nguồn: migrations/snapshots/notification-assistant-inbox-v624/live/*.sql = pg_get_functiondef production đọc 22/11/2026.
Ra: migrations/migration_v624_notification_assistant_inbox.sql + rollback_v624_notification_assistant_inbox.sql.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIVE_DIR = ROOT / 'migrations' / 'snapshots' / 'notification-assistant-inbox-v624' / 'live'
NAME = 'migration_v624_notification_assistant_inbox'
ROLLBACK = 'rollback_v624_notification_assistant_inbox'


def md5(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


# (chữ ký, tên tệp, md5 production, các cặp thay [cũ, mới])
PATCHES: list[tuple[str, str, str, list[tuple[str, str]]]] = [
    ('private.aka_agent_ai_assistant_item(ai_message)', 'aka_agent_ai_assistant_item', 'f7d421b8977fedf20e6471a9dfa4ada6', [
        ("""'id', m.id, 'kind', CASE WHEN m.brief IS NOT NULL THEN 'work' ELSE 'turn' END, 'threadId', m.thread_id, 'requestId', m.request_id,""",
         """'id', m.id, 'kind', CASE WHEN m.brief IS NOT NULL THEN 'work' WHEN m.notification_id IS NOT NULL THEN 'notice' ELSE 'turn' END,
    'threadId', m.thread_id, 'requestId', m.request_id, 'notificationId', m.notification_id,"""),
    ]),
    ('private.aka_agent_ai_assistant_stream(bigint,bigint,jsonb)', 'aka_agent_ai_assistant_stream', '965d14b00e959a935b13e9ba98b05a9d', [
        ("""  v_limit integer := coalesce(private.aka_agent_ai_chat_int(v_p -> 'limit', 30, 1, 50), 30); v_items jsonb; v_count integer;
""",
         """  v_limit integer := coalesce(private.aka_agent_ai_chat_int(v_p -> 'limit', 30, 1, 50), 30); v_items jsonb; v_count integer;
  -- V624: chỉ app vẽ được mục thông báo mới nhận mục thông báo (bản cũ đọc loại lạ thành tin khách gõ).
  v_notices boolean := coalesce(v_p ->> 'includeNotices', '') = 'true';
"""),
        ("""           WHERE m.assistant_staff_id = p_staff_id AND (v_before IS NULL OR m.id < v_before)
""",
         """           WHERE m.assistant_staff_id = p_staff_id AND (v_before IS NULL OR m.id < v_before)
             AND (v_notices OR m.notification_id IS NULL)
"""),
    ]),
    ('private.aka_agent_ai_assistant_sync(bigint,bigint,jsonb)', 'aka_agent_ai_assistant_sync', '0ca5dccc4c29ecd06666a68c52ea5750', [
        ("""  v_after bigint := coalesce(private.aka_agent_ai_assistant_id(v_p -> 'afterId'), 0); v_new jsonb; v_watched jsonb; v_ids bigint[];
""",
         """  v_after bigint := coalesce(private.aka_agent_ai_assistant_id(v_p -> 'afterId'), 0); v_new jsonb; v_watched jsonb; v_ids bigint[];
  v_notices boolean := coalesce(v_p ->> 'includeNotices', '') = 'true'; -- V624
"""),
        ("""    FROM (SELECT * FROM public.ai_message m WHERE m.assistant_staff_id = p_staff_id AND m.id > v_after ORDER BY m.id LIMIT 50) x;
""",
         """    FROM (SELECT * FROM public.ai_message m WHERE m.assistant_staff_id = p_staff_id AND m.id > v_after
             AND (v_notices OR m.notification_id IS NULL) ORDER BY m.id LIMIT 50) x;
"""),
    ]),
    ('public.aka_agent_control_ai_assistant(bigint,bigint,text,text,jsonb,uuid)', 'aka_agent_control_ai_assistant', '7239d660fba11a324acd342b59698247', [
        ("""      v_seen := private.aka_agent_ai_assistant_notify_seen(p_staff_id, v_id);
""",
         """      v_seen := private.aka_agent_ai_assistant_notify_seen(p_staff_id, v_id);
      -- V624: app vẽ được mục thông báo thì thông báo đã hiện trong hộp tới `uptoId` cũng là đã đọc.
      IF coalesce(v_p ->> 'includeNotices', '') = 'true' THEN
        v_seen := v_seen + private.aka_agent_ai_assistant_notice_seen(p_staff_id, v_id);
      END IF;
"""),
    ]),
    ('private.aka_agent_ai_assistant_agent_context(bigint,bigint,jsonb)', 'aka_agent_ai_assistant_agent_context', 'e2cbd418d0c87926f55479d2da6416fc', [
        ("""                WHERE x.assistant_staff_id = p_staff_id AND x.brief IS NULL AND x.thread_id <> t.id
""",
         """                WHERE x.assistant_staff_id = p_staff_id AND x.brief IS NULL AND x.thread_id <> t.id
                  AND x.notification_id IS NULL -- V624: thông báo tới giữa chừng không làm đứt phiên agent
"""),
    ]),
    ('public.aka_agent_notification_worker(text,jsonb)', 'aka_agent_notification_worker', '60eb06ec7d4f83d086b4aebb91e48b35', [
        ("""               'payload', CASE WHEN n.event_type = 'system.verify_email' THEN n.payload END),
""",
         """               'payload', CASE WHEN n.event_type = 'system.verify_email' THEN n.payload END,
               -- V624: mục của thông báo trong Trợ lý aka (lượt đẩy mở thẳng mục này với bản iOS vẽ được nó).
               'assistantItemId', CASE WHEN u.channel = 'push' THEN (SELECT m.id FROM public.ai_message m WHERE m.notification_id = n.id) END),
"""),
        ("""               'apnsEnvironment', dv.apns_environment, 'bundleId', dv.bundle_id,
""",
         """               'apnsEnvironment', dv.apns_environment, 'bundleId', dv.bundle_id, 'appVersion', dv.app_version,
"""),
    ]),
]


def body(def_text: str) -> str:
    return def_text.rstrip('\n') + ';\n'


def guard(tag: str, sig: str, want: str, msg: str) -> str:
    return f"""  IF md5(pg_get_functiondef({q(sig)}::regprocedure)) IS DISTINCT FROM {q(want)} THEN
    RAISE EXCEPTION '{tag}: {sig} {msg} (md5 %)', md5(pg_get_functiondef({q(sig)}::regprocedure));
  END IF;"""


olds: dict[str, str] = {}
news: dict[str, str] = {}
for sig, name, live_md5, pairs in PATCHES:
    path = LIVE_DIR / f'{name}.{live_md5}.sql'
    text = path.read_text(encoding='utf-8')
    if md5(text) != live_md5:
        raise SystemExit(f'{path.name}: md5 {md5(text)} khác {live_md5}')
    new = text
    for old, rep in pairs:
        if new.count(old) != 1:
            raise SystemExit(f'{name}: không tìm thấy đúng một chỗ: {old[:80]!r}')
        new = new.replace(old, rep)
    olds[sig] = text
    news[sig] = new

NEW_FUNCTIONS = r"""
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
"""

NEW_SIGS = [
    'private.aka_agent_ai_assistant_notice_allowed(bigint,bigint)',
    'private.aka_agent_ai_assistant_notice(bigint)',
    'private.aka_agent_ai_assistant_notice_capture()',
    'private.aka_agent_ai_assistant_notice_seen(bigint,bigint)',
]

pre_guards = '\n'.join(guard('v624', sig, md5(olds[sig]), 'khác bản đã đọc 22/11/2026') for sig, *_ in PATCHES)
post_guards = '\n'.join(guard('v624', sig, md5(news[sig]), 'sau khi thay không đúng bản V624') for sig, *_ in PATCHES)
replaced = '\n'.join(body(news[sig]) for sig, *_ in PATCHES)
rb_pre = '\n'.join(guard('v624 rollback', sig, md5(news[sig]), 'không phải bản V624') for sig, *_ in PATCHES)
rb_post = '\n'.join(guard('v624 rollback', sig, md5(olds[sig]), 'sau khi gỡ không đúng bản trước V624') for sig, *_ in PATCHES)
restored = '\n'.join(body(olds[sig]) for sig, *_ in PATCHES)
revokes = ', '.join(q(s) for s in NEW_SIGS)

migration = f"""-- V624: mọi thông báo thành một mục "thông báo" trong hộp Trợ lý aka (docs/NOTIFICATION_ASSISTANT_INBOX_PLAN.md).
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
{pre_guards}
END
$v624_pre$;

ALTER TABLE public.ai_message ADD COLUMN notification_id bigint;
ALTER TABLE public.ai_message ADD CONSTRAINT ai_message_notification_id_fkey
  FOREIGN KEY (notification_id) REFERENCES public.auto_notifications(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX uq_ai_message_notification ON public.ai_message (notification_id) WHERE notification_id IS NOT NULL;
CREATE UNIQUE INDEX uq_ai_assistant_notice_thread ON public.ai_message_thread (org_staff_id)
  WHERE answer_mode = 'assistant' AND (intake_data ->> 'kind') = 'notices';

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('notifications.assistant_inbox', '{{"audience":"off"}}',
   'V624: chép mọi thông báo vừa có nội dung thành mục "thông báo" trong hộp Trợ lý aka (trừ assistant.result, system.*). audience: off | admin_akabiz | orgs (organizationIds) | all. off = không chép, tắt khẩn cấp không cần deploy.',
   false, true);
{NEW_FUNCTIONS}
DO $v624_grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[{revokes}] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api', f);
  END LOOP;
END
$v624_grants$;

CREATE TRIGGER trg_aka_agent_ai_assistant_notice
  AFTER INSERT OR UPDATE OF content_status ON public.auto_notifications
  FOR EACH ROW WHEN (NEW.content_status = 'ready')
  EXECUTE FUNCTION private.aka_agent_ai_assistant_notice_capture();

-- Hàm thay thế (CREATE OR REPLACE giữ chủ sở hữu và quyền)
{replaced}
DO $v624_post$
BEGIN
{post_guards}
END
$v624_post$;
COMMIT;
"""

rollback = f"""-- Gỡ V624: bỏ trigger, hàm mới, mục và hội thoại thông báo, cột ai_message.notification_id, cài đặt; trả 6 hàm về bản trước V624.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $v624_rb_pre$
BEGIN
{rb_pre}
END
$v624_rb_pre$;

DROP TRIGGER trg_aka_agent_ai_assistant_notice ON public.auto_notifications;
{restored}
DELETE FROM public.ai_message WHERE notification_id IS NOT NULL;
DELETE FROM public.ai_message_thread t
 WHERE t.answer_mode = 'assistant' AND (t.intake_data ->> 'kind') = 'notices'
   AND NOT EXISTS (SELECT 1 FROM public.ai_message m WHERE m.thread_id = t.id);
DROP FUNCTION private.aka_agent_ai_assistant_notice_capture();
DROP FUNCTION private.aka_agent_ai_assistant_notice_seen(bigint, bigint);
DROP FUNCTION private.aka_agent_ai_assistant_notice(bigint);
DROP FUNCTION private.aka_agent_ai_assistant_notice_allowed(bigint, bigint);
DROP INDEX public.uq_ai_assistant_notice_thread;
DROP INDEX public.uq_ai_message_notification;
ALTER TABLE public.ai_message DROP CONSTRAINT ai_message_notification_id_fkey;
ALTER TABLE public.ai_message DROP COLUMN notification_id;
DELETE FROM public.auto_system_settings WHERE key = 'notifications.assistant_inbox';
DO $v624_rb_post$
BEGIN
{rb_post}
END
$v624_rb_post$;
COMMIT;
"""

(ROOT / 'migrations' / f'{NAME}.sql').write_text(migration, encoding='utf-8')
(ROOT / 'migrations' / f'{ROLLBACK}.sql').write_text(rollback, encoding='utf-8')
for sig, *_ in PATCHES:
    print(f'{sig}: {md5(olds[sig])} -> {md5(news[sig])}')
print('md5 migration', md5(migration))

-- V488: Hỏi đáp AI theo dự án (ai_project_group / ai_project / ai_message_thread / ai_message). CANDIDATE, CHƯA APPLY.
-- Hợp đồng: akaAgentWebApp docs/AI_CHAT.md. Rollback: migrations/rollback_v488_ai_chat.sql.
-- App (Web/iOS/Desktop) chỉ gửi câu hỏi và đọc câu trả lời qua RPC; "bộ trả lời" (hộp đen) nhận việc và ghi câu
-- trả lời qua RPC worker. DB là nguồn sự thật duy nhất: mỗi thay đổi tăng ai_message_thread.revision để đồng bộ.
-- Chỉ thêm đối tượng mới: không ALTER bảng nóng, không FK tới auto_campaigns/auto_accounts/org_staff, không cron,
-- không trigger trên bảng có sẵn. Quá hạn trả lời được xử lý lười trong chính các RPC (không cần job).
-- DDL ⇒ PostgREST nạp lại schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $v488_preflight$
DECLARE sig text; r text;
BEGIN
  IF to_regclass('public.ai_project_group') IS NOT NULL OR to_regclass('public.ai_project') IS NOT NULL
     OR to_regclass('public.ai_message_thread') IS NOT NULL OR to_regclass('public.ai_message') IS NOT NULL THEN
    RAISE EXCEPTION 'v488: ai chat tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname = 'public' AND p.proname IN ('aka_agent_ai_chat', 'aka_agent_control_ai_chat', 'aka_agent_ai_chat_worker'))
                 OR (n.nspname = 'private' AND p.proname LIKE 'aka_agent_ai_chat%')) THEN
    RAISE EXCEPTION 'v488: ai chat functions already exist';
  END IF;
  FOREACH sig IN ARRAY ARRAY['private.aka_agent_assert_request_ownership(bigint,bigint,bigint)',
    'public.auto_assert_automation_identity(bigint,bigint,text,text)'] LOOP
    IF to_regprocedure(sig) IS NULL THEN RAISE EXCEPTION 'v488: missing dependency %', sig; END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN RAISE EXCEPTION 'v488: missing role %', r; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_attribute WHERE NOT attisdropped AND (
        (attrelid = 'public.org_staff'::regclass AND attname IN ('id', 'organization_id', 'is_active', 'deleted_at', 'is_admin_akabiz'))
     OR (attrelid = 'public.org_organization'::regclass AND attname IN ('id', 'customer_id'))
     OR (attrelid = 'public.auto_campaigns'::regclass AND attname IN ('id', 'name', 'action_id', 'account_id', 'staff_id', 'organization_id', 'is_delete'))
     OR (attrelid = 'public.auto_accounts'::regclass AND attname IN ('id', 'name', 'flatform_type'))
     OR (attrelid = 'public.auto_system_settings'::regclass AND attname IN ('key', 'value', 'is_active')))) <> 20 THEN
    RAISE EXCEPTION 'v488: dependency columns missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key LIKE 'ai_chat.%') THEN
    RAISE EXCEPTION 'v488: ai_chat.* system settings already exist';
  END IF;
END
$v488_preflight$;

-- 1. Bảng. FK chỉ giữa các bảng ai_*; mã tổ chức/nhân viên/chiến dịch/tài khoản chỉ lưu id + tên chụp lại,
-- RPC tự kiểm quyền (auto_campaigns đã có nhiều bảng con, không thêm khóa vào đường ghi của chiến dịch).
CREATE TABLE public.ai_project_group (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  rules text NOT NULL DEFAULT '' CHECK (char_length(rules) <= 20000),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_project_group_code_unique UNIQUE (code)
);
COMMENT ON TABLE public.ai_project_group IS 'Nhóm các agent hỏi đáp (vd. Hỏi đáp chiến dịch, Chatbot trên Pancake). V488.';

CREATE TABLE public.ai_project (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES public.ai_project_group(id),
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  rules text NOT NULL DEFAULT '' CHECK (char_length(rules) <= 20000),
  output_schema jsonb CHECK (output_schema IS NULL OR jsonb_typeof(output_schema) = 'object'),
  intake_schema jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(intake_schema) = 'array'),
  default_question text NOT NULL DEFAULT '' CHECK (char_length(default_question) <= 4000),
  suggested_questions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(suggested_questions) = 'array'),
  output_webhook_url text CHECK (output_webhook_url IS NULL OR output_webhook_url ~ '^https://'),
  applies_to jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(applies_to) = 'object'),
  requires_campaign boolean NOT NULL DEFAULT true,
  audience text NOT NULL DEFAULT 'admin_akabiz' CHECK (audience IN ('off', 'admin_akabiz', 'all')),
  timeout_seconds integer NOT NULL DEFAULT 300 CHECK (timeout_seconds BETWEEN 30 AND 3600),
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_project_code_unique UNIQUE (code)
);
CREATE INDEX idx_ai_project_group ON public.ai_project (group_id);
COMMENT ON TABLE public.ai_project IS 'Một agent hỏi đáp: mô tả, quy tắc, cấu trúc đầu ra (output_schema), webhook đầu ra. V488.';
COMMENT ON COLUMN public.ai_project.output_schema IS 'JSON Schema của answer_json. RPC worker chỉ kiểm các khóa "required"; bộ trả lời tự kiểm đầy đủ.';
COMMENT ON COLUMN public.ai_project.intake_schema IS 'Các ô modal thu thêm: [{key,label,type:text|textarea|select|checkbox,required,options:[{value,label}],placeholder,maxLength}].';
COMMENT ON COLUMN public.ai_project.applies_to IS '{"platforms":["zalo",...],"actionIds":["zalo_message_friend",...]}; bỏ trống = mọi chiến dịch.';
COMMENT ON COLUMN public.ai_project.audience IS 'off = ẩn; admin_akabiz = chỉ org_staff.is_admin_akabiz; all = mọi nhân viên.';

CREATE TABLE public.ai_message_thread (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES public.ai_project(id),
  project_version integer NOT NULL,
  name text NOT NULL,
  first_question text NOT NULL,
  customer_id bigint,
  organization_id bigint NOT NULL,
  org_staff_id bigint NOT NULL,
  campaign_id bigint,
  auto_account_id bigint,
  campaign_name text,
  account_name text,
  intake_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(intake_data) = 'object'),
  source text NOT NULL CHECK (source IN ('web', 'ios', 'desktop', 'api')),
  status text NOT NULL DEFAULT 'đang mở' CHECK (status IN ('đang mở', 'đã đóng')),
  request_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  message_count integer NOT NULL DEFAULT 0,
  last_message_seq integer NOT NULL DEFAULT 0,
  last_message_status text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_read_seq integer NOT NULL DEFAULT 0,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_message_thread_request_unique UNIQUE (request_id),
  CONSTRAINT ai_message_thread_read_check CHECK (last_read_seq BETWEEN 0 AND last_message_seq)
);
CREATE INDEX idx_ai_message_thread_staff_recent ON public.ai_message_thread (org_staff_id, last_message_at DESC, id DESC) WHERE NOT is_delete;
-- "Cần chú ý" = còn câu đang chờ hoặc có câu trả lời chưa đọc; câu đang chờ luôn là câu cuối và chưa thể đánh dấu đã đọc.
CREATE INDEX idx_ai_message_thread_staff_attention ON public.ai_message_thread (org_staff_id, last_message_at DESC)
  WHERE NOT is_delete AND last_message_seq > last_read_seq;
CREATE INDEX idx_ai_message_thread_project ON public.ai_message_thread (project_id);
COMMENT ON TABLE public.ai_message_thread IS 'Một hội thoại hỏi đáp AI của một nhân viên (thường gắn một chiến dịch). revision tăng theo mọi thay đổi của tin nhắn. V488.';

CREATE TABLE public.ai_message (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id bigint NOT NULL REFERENCES public.ai_message_thread(id),
  seq integer NOT NULL CHECK (seq > 0),
  request_id uuid NOT NULL,
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 4000),
  answer text CHECK (answer IS NULL OR char_length(answer) <= 50000),
  answer_json jsonb,
  status text NOT NULL DEFAULT 'chờ câu trả lời' CHECK (status IN (
    'chờ câu trả lời', 'đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời', 'hoàn thành', 'lỗi', 'đã hủy')),
  progress_note text CHECK (progress_note IS NULL OR char_length(progress_note) <= 300),
  thread_rev bigint NOT NULL,
  asked_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  started_at timestamptz,
  answered_at timestamptz,
  completed_at timestamptz,
  deadline_at timestamptz NOT NULL,
  claim_token uuid,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  worker_id text,
  error_code text,
  error_message text,
  rating smallint CHECK (rating IS NULL OR rating IN (-1, 1)),
  rating_note text CHECK (rating_note IS NULL OR char_length(rating_note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_message_request_unique UNIQUE (request_id),
  CONSTRAINT ai_message_thread_seq_unique UNIQUE (thread_id, seq)
);
-- Mỗi hội thoại chỉ có một câu đang xử lý: "không cho hỏi thêm khi đang chờ" được chặn ở DB.
CREATE UNIQUE INDEX uq_ai_message_one_active_per_thread ON public.ai_message (thread_id)
  WHERE status IN ('chờ câu trả lời', 'đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời');
-- Hàng đợi của bộ trả lời + quét quá hạn: chỉ chứa câu đang xử lý.
CREATE INDEX idx_ai_message_active_queue ON public.ai_message (status, queued_at, id)
  WHERE status IN ('chờ câu trả lời', 'đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời');
COMMENT ON TABLE public.ai_message IS 'Một dòng = một câu hỏi và câu trả lời của nó. answer chỉ trả cho app khi status = hoàn thành. V488.';

-- 2. Quyền bảng: mặc định schema public cấp toàn quyền cho anon/authenticated/service_role ⇒ thu hồi hết, bật RLS.
-- Mọi truy cập đi qua RPC SECURITY DEFINER.
ALTER TABLE public.ai_project_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_project ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_message_thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_message ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_project_group, public.ai_project, public.ai_message_thread, public.ai_message
  FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON SEQUENCE public.ai_project_group_id_seq, public.ai_project_id_seq, public.ai_message_thread_id_seq, public.ai_message_id_seq
  FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

-- 3. Cài đặt hệ thống (đổi là có hiệu lực ở lượt gọi sau, không cần deploy).
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('ai_chat.enabled', 'true', 'Hỏi đáp AI (V488): true = bật; false = ẩn menu, không nhận câu hỏi mới (vẫn đọc được hội thoại cũ).', false, true),
  ('ai_chat.max_pending_per_staff', '3', 'Hỏi đáp AI (V488): số câu hỏi đang chờ trả lời cùng lúc của một nhân viên.', false, true),
  ('ai_chat.max_questions_per_staff_per_day', '50', 'Hỏi đáp AI (V488): số câu hỏi mỗi nhân viên mỗi ngày (giờ Việt Nam).', false, true);

-- 4. Hàm phụ.
CREATE FUNCTION private.aka_agent_ai_chat_active()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT ARRAY['chờ câu trả lời', 'đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời']::text[]
$$;

CREATE FUNCTION private.aka_agent_ai_chat_setting(p_key text, p_default text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT nullif(btrim(s.value), '') FROM public.auto_system_settings s WHERE s.key = p_key AND s.is_active IS TRUE), p_default)
$$;

CREATE FUNCTION private.aka_agent_ai_chat_int_setting(p_key text, p_default integer, p_max integer)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v text := private.aka_agent_ai_chat_setting(p_key, NULL);
BEGIN
  IF v IS NULL OR v !~ '^[0-9]{1,6}$' THEN RETURN p_default; END IF;
  RETURN least(greatest(v::integer, 0), p_max);
END
$$;

CREATE FUNCTION private.aka_agent_ai_chat_uuid(p_value text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
  IF p_value IS NULL OR p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  RETURN p_value::uuid;
END
$$;

-- Số nguyên dương từ JSON (số hoặc chuỗi số); sai định dạng → NULL.
CREATE FUNCTION private.aka_agent_ai_chat_id(p_value jsonb)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE v text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) NOT IN ('number', 'string') THEN RETURN NULL; END IF;
  v := p_value #>> '{}';
  IF v !~ '^[0-9]{1,15}$' OR v::bigint <= 0 THEN RETURN NULL; END IF;
  RETURN v::bigint;
END
$$;

CREATE FUNCTION private.aka_agent_ai_chat_int(p_value jsonb, p_default integer, p_min integer, p_max integer)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE v text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) NOT IN ('number', 'string') THEN RETURN p_default; END IF;
  v := p_value #>> '{}';
  IF v !~ '^[0-9]{1,9}$' THEN RETURN p_default; END IF;
  RETURN least(greatest(v::integer, p_min), p_max);
END
$$;

CREATE FUNCTION private.aka_agent_ai_chat_project_json(p public.ai_project)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'description', p.description,
    'defaultQuestion', p.default_question, 'suggestedQuestions', p.suggested_questions, 'intakeSchema', p.intake_schema,
    'appliesTo', p.applies_to, 'requiresCampaign', p.requires_campaign, 'timeoutSeconds', p.timeout_seconds, 'version', p.version)
$$;

-- answer/answerJson chỉ ra khỏi DB khi đã "hoàn thành": app không bao giờ hiện câu trả lời dở dang.
CREATE FUNCTION private.aka_agent_ai_chat_message_json(m public.ai_message)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', m.id, 'threadId', m.thread_id, 'seq', m.seq, 'requestId', m.request_id, 'question', m.question,
    'answer', CASE WHEN m.status = 'hoàn thành' THEN m.answer END,
    'answerJson', CASE WHEN m.status = 'hoàn thành' THEN m.answer_json END,
    'status', m.status,
    'progressNote', CASE WHEN m.status IN ('đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời') THEN m.progress_note END,
    'threadRev', m.thread_rev, 'askedAt', m.asked_at, 'queuedAt', m.queued_at, 'startedAt', m.started_at, 'answeredAt', m.answered_at,
    'completedAt', m.completed_at, 'deadlineAt', m.deadline_at, 'errorCode', m.error_code, 'errorMessage', m.error_message, 'rating', m.rating)
$$;

CREATE FUNCTION private.aka_agent_ai_chat_thread_json(t public.ai_message_thread)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id', t.id, 'projectId', t.project_id, 'projectCode', p.code, 'projectName', p.name, 'name', t.name,
    'firstQuestion', t.first_question, 'campaignId', t.campaign_id, 'campaignName', t.campaign_name, 'accountId', t.auto_account_id,
    'accountName', t.account_name, 'status', t.status, 'source', t.source, 'revision', t.revision, 'messageCount', t.message_count,
    'lastMessageSeq', t.last_message_seq, 'lastMessageStatus', t.last_message_status, 'lastMessageAt', t.last_message_at,
    'lastReadSeq', t.last_read_seq,
    'pending', t.last_message_status = ANY (private.aka_agent_ai_chat_active()),
    'unread', t.last_message_seq > t.last_read_seq AND t.last_message_status IN ('hoàn thành', 'lỗi'),
    'createdAt', t.created_at)
  FROM public.ai_project p WHERE p.id = t.project_id
$$;

-- Ảnh chụp để đồng bộ. p_after = phiên bản app đang có: bằng revision → "không đổi" (một lần tra khóa chính);
-- 0 → p_limit tin cuối; còn lại → chỉ các tin đổi sau phiên bản đó.
CREATE FUNCTION private.aka_agent_ai_chat_snapshot(p_thread_id bigint, p_after bigint, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  t public.ai_message_thread%ROWTYPE;
  v_after bigint := greatest(coalesce(p_after, 0), 0);
  v_messages jsonb;
BEGIN
  SELECT * INTO t FROM public.ai_message_thread WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_thread_not_found'; END IF;
  IF v_after > 0 AND v_after = t.revision THEN
    RETURN jsonb_build_object('changed', false, 'revision', t.revision, 'lastReadSeq', t.last_read_seq, 'serverTime', clock_timestamp());
  END IF;
  IF v_after > t.revision THEN v_after := 0; END IF;
  IF v_after = 0 THEN
    SELECT jsonb_agg(private.aka_agent_ai_chat_message_json(x) ORDER BY x.seq) INTO v_messages
      FROM public.ai_message x
     WHERE x.thread_id = t.id AND x.seq > t.last_message_seq - p_limit;
  ELSE
    SELECT jsonb_agg(private.aka_agent_ai_chat_message_json(x) ORDER BY x.seq) INTO v_messages
      FROM public.ai_message x WHERE x.thread_id = t.id AND x.thread_rev > v_after;
  END IF;
  RETURN jsonb_build_object('changed', true, 'full', v_after = 0, 'revision', t.revision,
    'thread', private.aka_agent_ai_chat_thread_json(t), 'messages', coalesce(v_messages, '[]'::jsonb),
    'hasMore', v_after = 0 AND t.message_count > p_limit, 'serverTime', clock_timestamp());
END
$$;

-- Quá hạn trả lời: chuyển câu đang chờ sang "lỗi" để app không bao giờ chờ vô hạn, kể cả khi bộ trả lời chết.
-- Luôn khóa hội thoại trước rồi mới sửa tin (cùng thứ tự với mọi lệnh ghi khác).
CREATE FUNCTION private.aka_agent_ai_chat_expire(p_thread_id bigint, p_staff_id bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r record; t public.ai_message_thread%ROWTYPE; v_now timestamptz := clock_timestamp(); v_rev bigint; v_done integer := 0;
BEGIN
  FOR r IN
    SELECT m.id, m.thread_id
      FROM public.ai_message m
     WHERE m.status = ANY (private.aka_agent_ai_chat_active()) AND m.deadline_at <= v_now
       AND (p_thread_id IS NULL OR m.thread_id = p_thread_id)
       AND (p_staff_id IS NULL OR m.thread_id IN (
             SELECT s.id FROM public.ai_message_thread s
              WHERE s.org_staff_id = p_staff_id AND NOT s.is_delete AND s.last_message_seq > s.last_read_seq))
     ORDER BY m.id LIMIT 50
  LOOP
    SELECT * INTO t FROM public.ai_message_thread WHERE id = r.thread_id FOR UPDATE;
    v_rev := t.revision + 1;
    UPDATE public.ai_message
       SET status = 'lỗi', error_code = 'ai_chat_timeout', error_message = 'Trợ lý chưa trả lời kịp. Vui lòng bấm Thử lại.',
           progress_note = NULL, claim_token = NULL, lease_until = NULL, completed_at = v_now, thread_rev = v_rev, updated_at = v_now
     WHERE id = r.id AND status = ANY (private.aka_agent_ai_chat_active()) AND deadline_at <= v_now;
    IF FOUND THEN
      UPDATE public.ai_message_thread SET revision = v_rev, last_message_status = 'lỗi', updated_at = v_now WHERE id = r.thread_id;
      v_done := v_done + 1;
    END IF;
  END LOOP;
  RETURN v_done;
END
$$;

-- 5. Lõi dùng chung cho Web/iOS/Desktop. Staff/tổ chức do wrapper xác thực; ở đây kiểm nhân viên còn hoạt động.
CREATE FUNCTION private.aka_agent_ai_chat(p_staff_id bigint, p_organization_id bigint, p_client text, p_action text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_active text[] := private.aka_agent_ai_chat_active();
  v_admin boolean; v_enabled boolean;
  t public.ai_message_thread%ROWTYPE;
  m public.ai_message%ROWTYPE;
  pr public.ai_project%ROWTYPE;
  v_group_active boolean;
  v_thread_id bigint; v_message_id bigint; v_campaign_id bigint; v_request uuid; v_question text; v_intake jsonb;
  v_rev bigint; v_seq integer; v_after bigint; v_limit integer; v_count integer; v_max integer; v_day timestamptz;
  v_campaign_name text; v_account_id bigint; v_account_name text; v_action_id text; v_platform text; v_customer bigint;
  v_field jsonb; v_items jsonb; v_cursor_at timestamptz; v_cursor_id bigint; v_rating integer; v_note text; v_cap integer;
BEGIN
  IF p_client NOT IN ('web', 'ios', 'desktop') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_client'; END IF;
  IF jsonb_typeof(v_p) <> 'object' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request'; END IF;
  SELECT st.is_admin_akabiz IS TRUE INTO v_admin FROM public.org_staff st
   WHERE st.id = p_staff_id AND st.organization_id = p_organization_id AND st.is_active IS TRUE AND st.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ai_chat_access_denied'; END IF;
  v_enabled := private.aka_agent_ai_chat_setting('ai_chat.enabled', 'true') = 'true';
  v_after := coalesce(private.aka_agent_ai_chat_int(v_p -> 'afterRevision', 0, 0, 999999999), 0);

  IF p_action = 'agents' THEN
    IF NOT v_enabled THEN
      RETURN jsonb_build_object('enabled', false, 'groups', '[]'::jsonb, 'serverTime', v_now);
    END IF;
    SELECT coalesce(jsonb_agg(x.grp ORDER BY x.sort_order, x.id), '[]'::jsonb) INTO v_items FROM (
      SELECT g.id, g.sort_order, jsonb_build_object('id', g.id, 'code', g.code, 'name', g.name, 'description', g.description,
               'projects', (SELECT jsonb_agg(private.aka_agent_ai_chat_project_json(p) ORDER BY p.sort_order, p.id)
                              FROM public.ai_project p
                             WHERE p.group_id = g.id AND p.is_active
                               AND (p.audience = 'all' OR (p.audience = 'admin_akabiz' AND v_admin)))) AS grp
        FROM public.ai_project_group g
       WHERE g.is_active AND (v_p ->> 'groupCode' IS NULL OR g.code = v_p ->> 'groupCode')) x
     WHERE jsonb_typeof(x.grp -> 'projects') = 'array';
    RETURN jsonb_build_object('enabled', true, 'groups', v_items, 'serverTime', v_now,
      'limits', jsonb_build_object('maxQuestionLength', 4000,
        'maxPendingPerStaff', private.aka_agent_ai_chat_int_setting('ai_chat.max_pending_per_staff', 3, 20),
        'maxQuestionsPerDay', private.aka_agent_ai_chat_int_setting('ai_chat.max_questions_per_staff_per_day', 50, 100000)));

  ELSIF p_action IN ('open', 'ask', 'retry') THEN
    v_request := private.aka_agent_ai_chat_uuid(v_p ->> 'requestId');
    IF p_action <> 'retry' THEN
      IF v_request IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request'; END IF;
      v_question := btrim(coalesce(v_p ->> 'question', ''));
      IF v_question = '' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_question_required'; END IF;
      IF char_length(v_question) > 4000 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_question_too_long'; END IF;
    END IF;

    -- Gửi lại cùng requestId (mất phản hồi, bấm hai lần) trả đúng dòng đã lưu, không tạo thêm.
    IF p_action = 'open' THEN
      SELECT * INTO t FROM public.ai_message_thread WHERE request_id = v_request;
      IF FOUND THEN
        IF t.org_staff_id <> p_staff_id OR t.organization_id <> p_organization_id OR t.is_delete THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request';
        END IF;
        RETURN private.aka_agent_ai_chat_snapshot(t.id, 0, 50) || jsonb_build_object('reused', false);
      END IF;
    END IF;

    -- Khóa theo nhân viên trước mọi khóa hội thoại: hạn mức chờ/ngày đếm chính xác, không khóa chéo.
    PERFORM pg_advisory_xact_lock(hashtextextended('ai_chat_staff:' || p_staff_id::text, 0));

    IF p_action = 'open' THEN
      SELECT * INTO pr FROM public.ai_project WHERE id = private.aka_agent_ai_chat_id(v_p -> 'projectId');
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_agent_not_found'; END IF;
    ELSE
      v_thread_id := private.aka_agent_ai_chat_id(v_p -> 'threadId');
      SELECT * INTO t FROM public.ai_message_thread
       WHERE id = v_thread_id AND org_staff_id = p_staff_id AND organization_id = p_organization_id AND NOT is_delete FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_thread_not_found'; END IF;
      IF p_action = 'ask' THEN
        SELECT * INTO m FROM public.ai_message WHERE request_id = v_request;
        IF FOUND THEN
          IF m.thread_id <> t.id THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request'; END IF;
          RETURN private.aka_agent_ai_chat_snapshot(t.id, v_after, 50);
        END IF;
      END IF;
      SELECT * INTO pr FROM public.ai_project WHERE id = t.project_id;
    END IF;

    IF NOT v_enabled THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ai_chat_disabled'; END IF;
    SELECT g.is_active INTO v_group_active FROM public.ai_project_group g WHERE g.id = pr.group_id;
    IF NOT (pr.is_active AND v_group_active IS TRUE AND (pr.audience = 'all' OR (pr.audience = 'admin_akabiz' AND v_admin))) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ai_chat_agent_unavailable';
    END IF;

    PERFORM private.aka_agent_ai_chat_expire(NULL, p_staff_id);
    v_max := private.aka_agent_ai_chat_int_setting('ai_chat.max_pending_per_staff', 3, 20);
    v_day := date_trunc('day', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';

    IF p_action = 'open' THEN
      v_intake := coalesce(v_p -> 'intake', '{}'::jsonb);
      IF jsonb_typeof(v_intake) <> 'object' OR pg_column_size(v_intake) > 16384 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request';
      END IF;
      FOR v_field IN SELECT value FROM jsonb_array_elements(pr.intake_schema) LOOP
        IF (v_field ->> 'required') = 'true' AND btrim(coalesce(v_intake ->> (v_field ->> 'key'), '')) IN ('', 'false') THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_intake_required';
        END IF;
      END LOOP;
      v_campaign_id := private.aka_agent_ai_chat_id(v_p -> 'campaignId');
      IF v_campaign_id IS NULL THEN
        IF v_p ? 'campaignId' AND jsonb_typeof(v_p -> 'campaignId') <> 'null' THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request';
        END IF;
        IF pr.requires_campaign THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_campaign_required'; END IF;
      ELSE
        SELECT c.name, c.action_id, c.account_id, a.name, a.flatform_type
          INTO v_campaign_name, v_action_id, v_account_id, v_account_name, v_platform
          FROM public.auto_campaigns c LEFT JOIN public.auto_accounts a ON a.id = c.account_id
         WHERE c.id = v_campaign_id AND c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete IS NOT TRUE;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_campaign_not_found'; END IF;
        IF (jsonb_typeof(pr.applies_to -> 'platforms') = 'array' AND jsonb_array_length(pr.applies_to -> 'platforms') > 0
              AND NOT (pr.applies_to -> 'platforms') ? coalesce(v_platform, ''))
           OR (jsonb_typeof(pr.applies_to -> 'actionIds') = 'array' AND jsonb_array_length(pr.applies_to -> 'actionIds') > 0
              AND NOT (pr.applies_to -> 'actionIds') ? coalesce(v_action_id, '')) THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_agent_not_applicable';
        END IF;
      END IF;
      -- Cùng agent + chiến dịch đang có câu chờ: mở lại hội thoại đó thay vì tạo cái thứ hai.
      SELECT * INTO t FROM public.ai_message_thread
       WHERE org_staff_id = p_staff_id AND NOT is_delete AND last_message_seq > last_read_seq
         AND project_id = pr.id AND campaign_id IS NOT DISTINCT FROM v_campaign_id AND last_message_status = ANY (v_active)
       ORDER BY id DESC LIMIT 1;
      IF FOUND THEN
        RETURN private.aka_agent_ai_chat_snapshot(t.id, 0, 50) || jsonb_build_object('reused', true);
      END IF;
    ELSIF p_action = 'ask' THEN
      SELECT * INTO t FROM public.ai_message_thread WHERE id = t.id;
      IF t.status <> 'đang mở' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_thread_closed'; END IF;
      IF t.last_message_status = ANY (v_active) THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_message_pending'; END IF;
    ELSE
      SELECT * INTO t FROM public.ai_message_thread WHERE id = t.id;
      v_message_id := private.aka_agent_ai_chat_id(v_p -> 'messageId');
      SELECT * INTO m FROM public.ai_message WHERE id = v_message_id AND thread_id = t.id;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_message_not_found'; END IF;
      IF m.status = ANY (v_active) THEN RETURN private.aka_agent_ai_chat_snapshot(t.id, v_after, 50); END IF; -- đã thử lại rồi
      IF m.seq <> t.last_message_seq OR m.status NOT IN ('lỗi', 'đã hủy') OR t.status <> 'đang mở' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_not_retryable';
      END IF;
    END IF;

    SELECT count(*) INTO v_count FROM public.ai_message_thread s
     WHERE s.org_staff_id = p_staff_id AND NOT s.is_delete AND s.last_message_seq > s.last_read_seq AND s.last_message_status = ANY (v_active);
    IF v_count >= v_max THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_too_many_pending'; END IF;
    IF p_action <> 'retry' THEN
      v_max := private.aka_agent_ai_chat_int_setting('ai_chat.max_questions_per_staff_per_day', 50, 100000);
      SELECT count(*) INTO v_count FROM public.ai_message_thread s JOIN public.ai_message x ON x.thread_id = s.id
       WHERE s.org_staff_id = p_staff_id AND s.last_message_at >= v_day AND x.asked_at >= v_day;
      IF v_count >= v_max THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_daily_limit'; END IF;
    END IF;

    IF p_action = 'open' THEN
      SELECT o.customer_id INTO v_customer FROM public.org_organization o WHERE o.id = p_organization_id;
      INSERT INTO public.ai_message_thread (project_id, project_version, name, first_question, customer_id, organization_id, org_staff_id,
          campaign_id, auto_account_id, campaign_name, account_name, intake_data, source, request_id, revision, message_count,
          last_message_seq, last_message_status, last_message_at, created_at, updated_at)
      VALUES (pr.id, pr.version, left(regexp_replace(v_question, '\s+', ' ', 'g'), 120), v_question, v_customer, p_organization_id, p_staff_id,
          v_campaign_id, v_account_id, v_campaign_name, v_account_name, v_intake, p_client, v_request, 1, 1,
          1, 'chờ câu trả lời', v_now, v_now, v_now)
      RETURNING * INTO t;
      INSERT INTO public.ai_message (thread_id, seq, request_id, question, status, thread_rev, asked_at, queued_at, deadline_at, created_at, updated_at)
      VALUES (t.id, 1, v_request, v_question, 'chờ câu trả lời', 1, v_now, v_now, v_now + make_interval(secs => pr.timeout_seconds), v_now, v_now);
      RETURN private.aka_agent_ai_chat_snapshot(t.id, 0, 50) || jsonb_build_object('reused', false);
    ELSIF p_action = 'ask' THEN
      v_rev := t.revision + 1;
      v_seq := t.last_message_seq + 1;
      INSERT INTO public.ai_message (thread_id, seq, request_id, question, status, thread_rev, asked_at, queued_at, deadline_at, created_at, updated_at)
      VALUES (t.id, v_seq, v_request, v_question, 'chờ câu trả lời', v_rev, v_now, v_now, v_now + make_interval(secs => pr.timeout_seconds), v_now, v_now);
      UPDATE public.ai_message_thread
         SET revision = v_rev, message_count = message_count + 1, last_message_seq = v_seq, last_message_status = 'chờ câu trả lời',
             last_message_at = v_now, updated_at = v_now
       WHERE id = t.id;
    ELSE
      v_rev := t.revision + 1;
      UPDATE public.ai_message
         SET status = 'chờ câu trả lời', answer = NULL, answer_json = NULL, error_code = NULL, error_message = NULL, progress_note = NULL,
             claim_token = NULL, lease_until = NULL, claimed_at = NULL, started_at = NULL, answered_at = NULL, completed_at = NULL,
             attempt_count = 0, rating = NULL, rating_note = NULL, queued_at = v_now,
             deadline_at = v_now + make_interval(secs => pr.timeout_seconds), thread_rev = v_rev, updated_at = v_now
       WHERE id = m.id;
      UPDATE public.ai_message_thread
         SET revision = v_rev, last_message_status = 'chờ câu trả lời', last_message_at = v_now,
             last_read_seq = least(last_read_seq, last_message_seq - 1), updated_at = v_now
       WHERE id = t.id;
    END IF;
    RETURN private.aka_agent_ai_chat_snapshot(t.id, v_after, 50);

  ELSIF p_action = 'sync_pending' THEN
    PERFORM private.aka_agent_ai_chat_expire(NULL, p_staff_id);
    SELECT coalesce(jsonb_agg(private.aka_agent_ai_chat_thread_json(x) ORDER BY x.last_message_at DESC), '[]'::jsonb) INTO v_items
      FROM public.ai_message_thread x
     WHERE x.id IN (SELECT s.id FROM public.ai_message_thread s
                     WHERE s.org_staff_id = p_staff_id AND s.organization_id = p_organization_id AND NOT s.is_delete
                       AND s.last_message_seq > s.last_read_seq
                     ORDER BY s.last_message_at DESC LIMIT 20);
    RETURN jsonb_build_object('items', v_items, 'serverTime', clock_timestamp());

  ELSIF p_action = 'threads' THEN
    v_limit := private.aka_agent_ai_chat_int(v_p -> 'limit', 20, 1, 50);
    v_campaign_id := private.aka_agent_ai_chat_id(v_p -> 'campaignId');
    v_thread_id := private.aka_agent_ai_chat_id(v_p -> 'projectId');
    v_cursor_id := private.aka_agent_ai_chat_id(v_p #> '{cursor,id}');
    BEGIN
      v_cursor_at := nullif(v_p #>> '{cursor,lastMessageAt}', '')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request';
    END;
    SELECT coalesce(jsonb_agg(private.aka_agent_ai_chat_thread_json(x) ORDER BY x.last_message_at DESC, x.id DESC), '[]'::jsonb), count(*)
      INTO v_items, v_count
      FROM public.ai_message_thread x
     WHERE x.id IN (SELECT s.id FROM public.ai_message_thread s
                     WHERE s.org_staff_id = p_staff_id AND s.organization_id = p_organization_id AND NOT s.is_delete
                       AND (v_campaign_id IS NULL OR s.campaign_id = v_campaign_id)
                       AND (v_thread_id IS NULL OR s.project_id = v_thread_id)
                       AND (v_cursor_at IS NULL OR v_cursor_id IS NULL OR (s.last_message_at, s.id) < (v_cursor_at, v_cursor_id))
                     ORDER BY s.last_message_at DESC, s.id DESC LIMIT v_limit);
    RETURN jsonb_build_object('items', v_items, 'serverTime', clock_timestamp(),
      'nextCursor', CASE WHEN v_count = v_limit THEN jsonb_build_object(
          'lastMessageAt', v_items -> (v_limit - 1) -> 'lastMessageAt', 'id', v_items -> (v_limit - 1) -> 'id') END);
  END IF;

  -- Các lệnh còn lại đều theo một hội thoại của chính nhân viên.
  v_thread_id := private.aka_agent_ai_chat_id(v_p -> 'threadId');
  IF p_action IN ('sync', 'messages') THEN
    SELECT * INTO t FROM public.ai_message_thread
     WHERE id = v_thread_id AND org_staff_id = p_staff_id AND organization_id = p_organization_id AND NOT is_delete;
  ELSIF p_action IN ('cancel', 'rate', 'mark_read') THEN
    SELECT * INTO t FROM public.ai_message_thread
     WHERE id = v_thread_id AND org_staff_id = p_staff_id AND organization_id = p_organization_id AND NOT is_delete FOR UPDATE;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_action';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_thread_not_found'; END IF;

  IF p_action = 'sync' THEN
    IF t.last_message_status = ANY (v_active) THEN PERFORM private.aka_agent_ai_chat_expire(t.id, NULL); END IF;
    RETURN private.aka_agent_ai_chat_snapshot(t.id, v_after, 50);

  ELSIF p_action = 'messages' THEN
    v_limit := private.aka_agent_ai_chat_int(v_p -> 'limit', 50, 1, 100);
    v_seq := private.aka_agent_ai_chat_int(v_p -> 'beforeSeq', t.last_message_seq + 1, 1, 2000000000);
    SELECT coalesce(jsonb_agg(private.aka_agent_ai_chat_message_json(x) ORDER BY x.seq), '[]'::jsonb) INTO v_items
      FROM public.ai_message x WHERE x.thread_id = t.id AND x.seq < v_seq AND x.seq >= v_seq - v_limit;
    RETURN jsonb_build_object('messages', v_items, 'hasMore', v_seq - v_limit > 1, 'serverTime', clock_timestamp());

  ELSIF p_action = 'mark_read' THEN
    -- Câu đang chờ chưa thể "đã đọc": hội thoại vẫn nằm trong danh sách cần chú ý cho tới khi có kết quả.
    v_cap := CASE WHEN t.last_message_status = ANY (v_active) THEN t.last_message_seq - 1 ELSE t.last_message_seq END;
    v_seq := least(private.aka_agent_ai_chat_int(v_p -> 'seq', v_cap, 0, 2000000000), v_cap);
    UPDATE public.ai_message_thread SET last_read_seq = greatest(last_read_seq, v_seq) WHERE id = t.id RETURNING last_read_seq INTO v_seq;
    RETURN jsonb_build_object('ok', true, 'lastReadSeq', v_seq);
  END IF;

  v_message_id := private.aka_agent_ai_chat_id(v_p -> 'messageId');
  SELECT * INTO m FROM public.ai_message WHERE id = v_message_id AND thread_id = t.id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_message_not_found'; END IF;
  v_rev := t.revision + 1;

  IF p_action = 'cancel' THEN
    IF m.status = ANY (v_active) THEN
      UPDATE public.ai_message
         SET status = 'đã hủy', progress_note = NULL, claim_token = NULL, lease_until = NULL, completed_at = v_now, thread_rev = v_rev, updated_at = v_now
       WHERE id = m.id;
      UPDATE public.ai_message_thread
         SET revision = v_rev, last_message_status = 'đã hủy', last_read_seq = last_message_seq, updated_at = v_now
       WHERE id = t.id;
    END IF;
    RETURN private.aka_agent_ai_chat_snapshot(t.id, v_after, 50);
  END IF;

  -- rate
  IF m.status <> 'hoàn thành' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_not_rateable'; END IF;
  IF jsonb_typeof(v_p -> 'rating') = 'null' OR NOT v_p ? 'rating' THEN v_rating := NULL;
  ELSIF (v_p ->> 'rating') IN ('1', '-1') THEN v_rating := (v_p ->> 'rating')::integer;
  ELSE RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request';
  END IF;
  v_note := nullif(left(btrim(coalesce(v_p ->> 'note', '')), 1000), '');
  UPDATE public.ai_message SET rating = v_rating, rating_note = CASE WHEN v_rating IS NULL THEN NULL ELSE v_note END,
         thread_rev = v_rev, updated_at = v_now WHERE id = m.id;
  UPDATE public.ai_message_thread SET revision = v_rev, updated_at = v_now WHERE id = t.id;
  RETURN private.aka_agent_ai_chat_snapshot(t.id, v_after, 50);
END
$$;

-- 6. Wrapper theo nơi gọi (cùng một lõi ⇒ Web/iOS/Desktop hành xử giống hệt).
-- Web/iOS: API WebApp đã xác thực phiên, gọi bằng service_role.
CREATE FUNCTION public.aka_agent_control_ai_chat(p_staff_id bigint, p_organization_id bigint, p_client text, p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_session_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_client NOT IN ('web', 'ios') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_client'; END IF;
  RETURN private.aka_agent_ai_chat(p_staff_id, p_organization_id, p_client, p_action, coalesce(p_payload, '{}'::jsonb));
END
$$;

-- Desktop: gọi thẳng bằng token Desktop, cùng cách xác thực với trung tâm thông báo (V457).
CREATE FUNCTION public.aka_agent_ai_chat(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text,
  p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, NULL); -- Bind Desktop token before privileged work.
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  RETURN private.aka_agent_ai_chat(p_staff_id, p_organization_id, 'desktop', p_action, coalesce(p_payload, '{}'::jsonb));
END
$$;

-- 7. Hợp đồng của bộ trả lời (hộp đen): list (chỉ xem) | claim → progress → answer → complete | fail. Chỉ service_role/owner.
-- claim nhận theo hàng đợi, hoặc đúng một câu khi có messageId; stage='working' thì vào thẳng 'đang tìm câu trả lời'.
-- Lệnh ghi kèm claimToken chỉ có hiệu lực khi token còn đúng: worker treo rồi chạy lại không ghi đè được kết quả mới.
CREATE FUNCTION public.aka_agent_ai_chat_worker(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_active text[] := private.aka_agent_ai_chat_active();
  v_claimed text[] := ARRAY['đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời']::text[];
  t public.ai_message_thread%ROWTYPE;
  m public.ai_message%ROWTYPE;
  pr public.ai_project%ROWTYPE;
  r record;
  v_worker text; v_limit integer; v_lease integer; v_codes text[]; v_token uuid; v_rev bigint; v_n integer := 0;
  v_items jsonb := '[]'::jsonb; v_message_id bigint; v_thread_id bigint; v_status text; v_note text; v_answer text; v_json jsonb;
  v_group_rules text; v_history jsonb; v_key text; v_code text; v_retry boolean; v_complete boolean; v_working boolean; v_stop boolean; v_by_id boolean;
BEGIN
  IF jsonb_typeof(v_p) <> 'object' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request'; END IF;

  IF p_action IN ('claim', 'list') THEN
    IF p_action = 'claim' THEN
      v_worker := left(btrim(coalesce(v_p ->> 'workerId', '')), 80);
      IF v_worker = '' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_worker_id_required'; END IF;
      v_limit := private.aka_agent_ai_chat_int(v_p -> 'limit', 1, 1, 10);
      v_message_id := private.aka_agent_ai_chat_id(v_p -> 'messageId');
      IF v_p ? 'messageId' AND v_message_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request'; END IF;
      v_working := coalesce(v_p ->> 'stage', '') = 'working';
    ELSE
      v_limit := private.aka_agent_ai_chat_int(v_p -> 'limit', 20, 1, 50);
    END IF;
    v_lease := private.aka_agent_ai_chat_int(v_p -> 'leaseSeconds', 120, 30, 900);
    IF jsonb_typeof(v_p -> 'projectCodes') = 'array' AND jsonb_array_length(v_p -> 'projectCodes') > 0 THEN
      SELECT array_agg(value) INTO v_codes FROM jsonb_array_elements_text(v_p -> 'projectCodes');
    END IF;
    PERFORM private.aka_agent_ai_chat_expire(NULL, NULL);
    -- Worker giữ câu quá hạn thuê (treo/chết): trả về hàng đợi, quá 3 lần thì báo lỗi cho khách.
    FOR r IN SELECT x.id, x.thread_id FROM public.ai_message x
              WHERE x.status = ANY (v_claimed) AND x.lease_until < v_now ORDER BY x.id LIMIT 20 LOOP
      SELECT * INTO t FROM public.ai_message_thread WHERE id = r.thread_id FOR UPDATE;
      v_rev := t.revision + 1;
      UPDATE public.ai_message
         SET status = CASE WHEN attempt_count >= 3 THEN 'lỗi' ELSE 'chờ câu trả lời' END,
             error_code = CASE WHEN attempt_count >= 3 THEN 'ai_chat_answer_failed' END,
             error_message = CASE WHEN attempt_count >= 3 THEN 'Trợ lý chưa trả lời được câu hỏi này. Vui lòng bấm Thử lại.' END,
             completed_at = CASE WHEN attempt_count >= 3 THEN v_now END,
             answer = NULL, answer_json = NULL, answered_at = NULL, started_at = NULL, progress_note = NULL,
             claim_token = NULL, lease_until = NULL, thread_rev = v_rev, updated_at = v_now
       WHERE id = r.id AND status = ANY (v_claimed) AND lease_until < v_now
      RETURNING status INTO v_status;
      IF FOUND THEN
        UPDATE public.ai_message_thread SET revision = v_rev, last_message_status = v_status, updated_at = v_now WHERE id = r.thread_id;
      END IF;
    END LOOP;
    IF private.aka_agent_ai_chat_setting('ai_chat.enabled', 'true') <> 'true' THEN
      RETURN jsonb_build_object('items', '[]'::jsonb, 'enabled', false, 'serverTime', clock_timestamp());
    END IF;
    IF p_action = 'list' THEN
      -- Chỉ xem: không đổi trạng thái, không tăng phiên bản. Câu cũ nhất đứng trước.
      SELECT coalesce(jsonb_agg(q.item ORDER BY q.queued_at, q.id), '[]'::jsonb) INTO v_items
        FROM (SELECT x.id, x.queued_at, jsonb_build_object(
                'messageId', x.id, 'threadId', s.id, 'seq', x.seq, 'question', x.question, 'status', x.status, 'attempt', x.attempt_count,
                'askedAt', x.asked_at, 'deadlineAt', x.deadline_at,
                'project', jsonb_build_object('code', p.code, 'name', p.name),
                'thread', jsonb_build_object('organizationId', s.organization_id, 'staffId', s.org_staff_id, 'campaignId', s.campaign_id,
                  'campaignName', s.campaign_name, 'accountId', s.auto_account_id, 'accountName', s.account_name)) AS item
                FROM public.ai_message x
                JOIN public.ai_message_thread s ON s.id = x.thread_id
                JOIN public.ai_project p ON p.id = s.project_id
               WHERE x.status = 'chờ câu trả lời' AND x.deadline_at > v_now AND (v_codes IS NULL OR p.code = ANY (v_codes))
               ORDER BY x.queued_at, x.id LIMIT v_limit) q;
      RETURN jsonb_build_object('items', v_items, 'enabled', true, 'serverTime', clock_timestamp());
    END IF;
    FOR r IN SELECT x.id, x.thread_id FROM public.ai_message x
              WHERE x.status = 'chờ câu trả lời' AND (v_message_id IS NULL OR x.id = v_message_id)
                AND (v_codes IS NULL OR EXISTS (SELECT 1 FROM public.ai_message_thread s JOIN public.ai_project p ON p.id = s.project_id
                                                 WHERE s.id = x.thread_id AND p.code = ANY (v_codes)))
              ORDER BY x.queued_at, x.id LIMIT v_limit * 3 LOOP
      EXIT WHEN v_n >= v_limit;
      SELECT * INTO t FROM public.ai_message_thread WHERE id = r.thread_id FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;
      v_token := gen_random_uuid();
      v_rev := t.revision + 1;
      UPDATE public.ai_message
         SET status = CASE WHEN v_working THEN 'đang tìm câu trả lời' ELSE 'đang lấy thông tin câu hỏi' END,
             claim_token = v_token, lease_until = v_now + make_interval(secs => v_lease),
             claimed_at = v_now, started_at = CASE WHEN v_working THEN v_now END,
             attempt_count = attempt_count + 1, worker_id = v_worker, thread_rev = v_rev, updated_at = v_now
       WHERE id = r.id AND status = 'chờ câu trả lời' AND deadline_at > v_now
      RETURNING * INTO m;
      CONTINUE WHEN NOT FOUND;
      UPDATE public.ai_message_thread SET revision = v_rev, last_message_status = m.status, updated_at = v_now WHERE id = t.id;
      SELECT * INTO pr FROM public.ai_project WHERE id = t.project_id;
      SELECT g.rules INTO v_group_rules FROM public.ai_project_group g WHERE g.id = pr.group_id;
      SELECT coalesce(jsonb_agg(jsonb_build_object('seq', h.seq, 'question', h.question, 'answer', h.answer, 'answerJson', h.answer_json,
                                                   'status', h.status, 'askedAt', h.asked_at) ORDER BY h.seq), '[]'::jsonb)
        INTO v_history
        FROM public.ai_message h WHERE h.thread_id = t.id AND h.seq < m.seq AND h.seq >= m.seq - 20 AND h.status = 'hoàn thành';
      v_items := v_items || jsonb_build_object(
        'messageId', m.id, 'claimToken', v_token, 'threadId', t.id, 'seq', m.seq, 'question', m.question, 'status', m.status, 'attempt', m.attempt_count,
        'askedAt', m.asked_at, 'deadlineAt', m.deadline_at, 'leaseUntil', m.lease_until,
        'project', jsonb_build_object('id', pr.id, 'code', pr.code, 'name', pr.name, 'version', pr.version, 'groupRules', coalesce(v_group_rules, ''),
          'rules', pr.rules, 'outputSchema', pr.output_schema, 'outputWebhookUrl', pr.output_webhook_url),
        'thread', jsonb_build_object('organizationId', t.organization_id, 'staffId', t.org_staff_id, 'customerId', t.customer_id,
          'campaignId', t.campaign_id, 'campaignName', t.campaign_name, 'accountId', t.auto_account_id, 'accountName', t.account_name,
          'intake', t.intake_data, 'source', t.source, 'firstQuestion', t.first_question),
        'history', v_history);
      v_n := v_n + 1;
    END LOOP;
    RETURN jsonb_build_object('items', v_items, 'enabled', true, 'serverTime', clock_timestamp());
  END IF;

  IF p_action NOT IN ('progress', 'answer', 'complete', 'fail') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_action';
  END IF;
  v_message_id := private.aka_agent_ai_chat_id(v_p -> 'messageId');
  v_token := private.aka_agent_ai_chat_uuid(v_p ->> 'claimToken');
  -- Không gửi claimToken = ghi theo messageId (đường nội bộ một agent, Edge Function ai-chat-agent): vẫn chỉ ghi được câu đang được nhận.
  v_by_id := coalesce(jsonb_typeof(v_p -> 'claimToken'), 'null') = 'null';
  IF v_message_id IS NULL OR (v_token IS NULL AND NOT v_by_id) THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request'; END IF;
  SELECT x.thread_id INTO v_thread_id FROM public.ai_message x WHERE x.id = v_message_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO t FROM public.ai_message_thread WHERE id = v_thread_id FOR UPDATE;
  SELECT * INTO m FROM public.ai_message WHERE id = v_message_id;
  IF (NOT v_by_id AND m.claim_token IS DISTINCT FROM v_token) OR NOT (m.status = ANY (v_claimed)) THEN
    RETURN jsonb_build_object('ok', false, 'status', m.status,
      'reason', CASE WHEN m.status = 'đã hủy' THEN 'cancelled' WHEN m.error_code = 'ai_chat_timeout' THEN 'expired' ELSE 'not_claimed' END);
  END IF;
  IF m.deadline_at <= v_now THEN
    PERFORM private.aka_agent_ai_chat_expire(t.id, NULL);
    RETURN jsonb_build_object('ok', false, 'status', 'lỗi', 'reason', 'expired');
  END IF;
  v_rev := t.revision + 1;
  v_lease := private.aka_agent_ai_chat_int(v_p -> 'leaseSeconds', 120, 30, 900);
  SELECT * INTO pr FROM public.ai_project WHERE id = t.project_id;

  IF p_action = 'progress' THEN
    v_note := nullif(left(btrim(coalesce(v_p ->> 'note', '')), 300), '');
    v_status := CASE WHEN m.status = 'đang lấy thông tin câu hỏi' AND coalesce(v_p ->> 'stage', 'working') = 'working'
                     THEN 'đang tìm câu trả lời' ELSE m.status END;
    UPDATE public.ai_message
       SET status = v_status, progress_note = coalesce(v_note, progress_note), lease_until = v_now + make_interval(secs => v_lease),
           started_at = coalesce(started_at, CASE WHEN v_status = 'đang tìm câu trả lời' THEN v_now END),
           thread_rev = CASE WHEN v_status <> m.status OR coalesce(v_note, m.progress_note) IS DISTINCT FROM m.progress_note THEN v_rev ELSE thread_rev END,
           updated_at = v_now
     WHERE id = m.id;
    -- Chỉ gia hạn thuê thì không tăng phiên bản: app không phải tải lại gì.
    IF v_status <> m.status OR coalesce(v_note, m.progress_note) IS DISTINCT FROM m.progress_note THEN
      UPDATE public.ai_message_thread SET revision = v_rev, last_message_status = v_status, updated_at = v_now WHERE id = t.id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', v_status, 'leaseUntil', v_now + make_interval(secs => v_lease));

  ELSIF p_action = 'answer' THEN
    v_answer := btrim(coalesce(v_p ->> 'answer', ''));
    v_json := v_p -> 'answerJson';
    IF jsonb_typeof(v_json) = 'null' THEN v_json := NULL; END IF;
    v_complete := coalesce(v_p ->> 'complete', 'false') = 'true';
    IF v_answer = '' OR char_length(v_answer) > 50000 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_answer_required'; END IF;
    IF v_json IS NOT NULL AND jsonb_typeof(v_json) <> 'object' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_answer_schema_mismatch'; END IF;
    IF pr.output_schema IS NOT NULL THEN
      IF v_json IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_answer_schema_mismatch'; END IF;
      IF jsonb_typeof(pr.output_schema -> 'required') = 'array' THEN
        FOR v_key IN SELECT value FROM jsonb_array_elements_text(pr.output_schema -> 'required') LOOP
          IF NOT v_json ? v_key THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_answer_schema_mismatch'; END IF;
        END LOOP;
      END IF;
    END IF;
    v_status := CASE WHEN v_complete THEN 'hoàn thành' ELSE 'đã có câu trả lời' END;
    UPDATE public.ai_message
       SET status = v_status, answer = v_answer, answer_json = v_json, answered_at = v_now, started_at = coalesce(started_at, v_now),
           completed_at = CASE WHEN v_complete THEN v_now END, progress_note = NULL, error_code = NULL, error_message = NULL,
           claim_token = CASE WHEN v_complete THEN NULL ELSE claim_token END,
           lease_until = CASE WHEN v_complete THEN NULL ELSE v_now + make_interval(secs => v_lease) END,
           thread_rev = v_rev, updated_at = v_now
     WHERE id = m.id;
    UPDATE public.ai_message_thread
       SET revision = v_rev, last_message_status = v_status, last_message_at = CASE WHEN v_complete THEN v_now ELSE last_message_at END, updated_at = v_now
     WHERE id = t.id;
    RETURN jsonb_build_object('ok', true, 'status', v_status, 'answeredAt', v_now, 'outputWebhookUrl', pr.output_webhook_url);

  ELSIF p_action = 'complete' THEN
    IF m.status <> 'đã có câu trả lời' THEN RETURN jsonb_build_object('ok', false, 'status', m.status, 'reason', 'no_answer'); END IF;
    UPDATE public.ai_message
       SET status = 'hoàn thành', completed_at = v_now, claim_token = NULL, lease_until = NULL, thread_rev = v_rev, updated_at = v_now
     WHERE id = m.id;
    UPDATE public.ai_message_thread SET revision = v_rev, last_message_status = 'hoàn thành', last_message_at = v_now, updated_at = v_now WHERE id = t.id;
    RETURN jsonb_build_object('ok', true, 'status', 'hoàn thành', 'outputWebhookUrl', pr.output_webhook_url);
  END IF;

  -- fail: stopped → 'đã hủy' (bộ trả lời chủ động dừng; khách thấy "Đã dừng" + errorMessage nếu có);
  -- retryable + còn lượt → trả về hàng đợi; còn lại báo lỗi cho khách (errorMessage là câu khách đọc được).
  v_stop := coalesce(v_p ->> 'stopped', 'false') = 'true';
  v_retry := NOT v_stop AND coalesce(v_p ->> 'retryable', 'false') = 'true' AND m.attempt_count < 3;
  v_code := coalesce(nullif(left(btrim(coalesce(v_p ->> 'errorCode', '')), 80), ''), CASE WHEN v_stop THEN 'ai_chat_stopped' ELSE 'ai_chat_answer_failed' END);
  v_note := nullif(left(btrim(coalesce(v_p ->> 'errorMessage', '')), 500), '');
  IF NOT v_stop THEN v_note := coalesce(v_note, 'Trợ lý chưa trả lời được câu hỏi này. Vui lòng bấm Thử lại.'); END IF;
  v_status := CASE WHEN v_stop THEN 'đã hủy' WHEN v_retry THEN 'chờ câu trả lời' ELSE 'lỗi' END;
  UPDATE public.ai_message
     SET status = v_status, error_code = CASE WHEN v_retry THEN NULL ELSE v_code END, error_message = CASE WHEN v_retry THEN NULL ELSE v_note END,
         answer = NULL, answer_json = NULL, answered_at = NULL, started_at = NULL, progress_note = NULL, claim_token = NULL, lease_until = NULL,
         completed_at = CASE WHEN v_retry THEN NULL ELSE v_now END, thread_rev = v_rev, updated_at = v_now
   WHERE id = m.id;
  UPDATE public.ai_message_thread SET revision = v_rev, last_message_status = v_status, updated_at = v_now WHERE id = t.id;
  RETURN jsonb_build_object('ok', true, 'status', v_status, 'requeued', v_retry);
END
$$;

-- 8. Dữ liệu khởi tạo: nhóm "Hỏi đáp chiến dịch" + một agent, chỉ admin akaBiz thấy (đổi audience = 'all' để mở cho khách).
WITH g AS (
  INSERT INTO public.ai_project_group (code, name, description, rules, sort_order)
  VALUES ('hoi-dap-chien-dich', 'Hỏi đáp chiến dịch',
    'Trợ lý trả lời câu hỏi về một chiến dịch: vì sao chưa chạy, kết quả, lỗi và cách xử lý.',
    'Chỉ trả lời dựa trên dữ liệu thật của đúng tổ chức và chiến dịch trong hội thoại. Viết tiếng Việt tự nhiên, không lộ mã nội bộ, SQL, XPath, đường dẫn tệp hay dữ liệu của khách khác. Không chắc thì hỏi lại hoặc đề nghị chuyển chuyên viên.', 10)
  RETURNING id)
INSERT INTO public.ai_project (group_id, code, name, description, rules, output_schema, default_question, suggested_questions, audience, timeout_seconds, sort_order)
SELECT g.id, 'hoi-dap-chien-dich', 'Hỏi đáp chiến dịch',
  'Hỏi bất kỳ điều gì về chiến dịch này. Trợ lý kiểm tra dữ liệu chiến dịch rồi trả lời, thường trong 1–3 phút.',
  'Mỗi kết luận phải kèm bằng chứng lấy từ dữ liệu chiến dịch và thời điểm của dữ liệu.',
  '{"type":"object","required":["tom_tat"],"properties":{"tom_tat":{"type":"string"},"nguyen_nhan":{"type":"array","items":{"type":"object","required":["noi_dung"],"properties":{"noi_dung":{"type":"string"},"bang_chung":{"type":"string"}}}},"cach_xu_ly":{"type":"array","items":{"type":"string"}},"can_chuyen_vien":{"type":"boolean"},"do_tin_cay":{"type":"string","enum":["cao","trung_binh","thap"]},"cau_hoi_lam_ro":{"type":"string"},"thoi_diem_du_lieu":{"type":"string"}}}'::jsonb,
  'Tại sao chiến dịch không chạy?',
  '["Tại sao chiến dịch không chạy?","Hôm nay chiến dịch đã gửi được bao nhiêu?","Vì sao có nhiều lượt thất bại?","Khi nào chiến dịch chạy tiếp?"]'::jsonb,
  'admin_akabiz', 1200, 10
FROM g;

-- 9. Quyền hàm: thu hồi mặc định (PUBLIC + anon/authenticated/service_role) rồi cấp đúng chỗ.
DO $v488_function_acl$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'private' AND p.proname LIKE 'aka_agent_ai_chat%')
               OR (n.nspname = 'public' AND p.proname IN ('aka_agent_ai_chat', 'aka_agent_control_ai_chat', 'aka_agent_ai_chat_worker'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api', f);
  END LOOP;
END
$v488_function_acl$;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_ai_chat(bigint, bigint, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_ai_chat_worker(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_ai_chat(bigint, bigint, text, text, text, jsonb) TO aka_agent_desktop;

-- 10. Hậu kiểm.
DO $v488_postcheck$
DECLARE r text; tbl text;
BEGIN
  IF (SELECT count(*) FROM public.ai_project_group) <> 1 OR (SELECT count(*) FROM public.ai_project) <> 1
     OR (SELECT count(*) FROM public.auto_system_settings WHERE key LIKE 'ai_chat.%') <> 3 THEN
    RAISE EXCEPTION 'v488: seed mismatch';
  END IF;
  FOREACH tbl IN ARRAY ARRAY['public.ai_project_group', 'public.ai_project', 'public.ai_message_thread', 'public.ai_message'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = tbl::regclass) THEN RAISE EXCEPTION 'v488: RLS off on %', tbl; END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF has_table_privilege(r, tbl, 'SELECT') OR has_table_privilege(r, tbl, 'INSERT') OR has_table_privilege(r, tbl, 'UPDATE')
         OR has_table_privilege(r, tbl, 'DELETE') THEN
        RAISE EXCEPTION 'v488: % still has table privilege on %', r, tbl;
      END IF;
    END LOOP;
  END LOOP;
  IF has_function_privilege('anon', 'public.aka_agent_control_ai_chat(bigint,bigint,text,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aka_agent_ai_chat_worker(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.aka_agent_ai_chat(bigint,bigint,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_control_ai_chat(bigint,bigint,text,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_ai_chat_worker(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'private.aka_agent_ai_chat(bigint,bigint,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.aka_agent_ai_chat_snapshot(bigint,bigint,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aka_agent_control_ai_chat(bigint,bigint,text,text,jsonb,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aka_agent_ai_chat_worker(text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_ai_chat(bigint,bigint,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'v488: function privilege postcheck failed';
  END IF;
END
$v488_postcheck$;

COMMIT;

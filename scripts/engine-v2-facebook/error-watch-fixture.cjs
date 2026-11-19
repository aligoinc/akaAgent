// Bản giả của nền Hỏi đáp AI dùng chung cho các bài kiểm của bộ kiểm lỗi chiến dịch Facebook (V574, V588).
'use strict'

/** Bản giả của nền Hỏi đáp AI: cột và luật đủ cho hàm tick (đọc thân hàm production 18/11/2026). */
const AI_STUBS = `
CREATE TABLE public.ai_project_group (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL,
  description text NOT NULL DEFAULT '', rules text NOT NULL DEFAULT '', sort_order integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ai_project (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, group_id bigint NOT NULL REFERENCES public.ai_project_group(id),
  code text NOT NULL UNIQUE, name text NOT NULL, description text NOT NULL DEFAULT '', rules text NOT NULL DEFAULT '' CHECK (char_length(rules) <= 20000),
  output_schema jsonb, intake_schema jsonb NOT NULL DEFAULT '[]', default_question text NOT NULL DEFAULT '', suggested_questions jsonb NOT NULL DEFAULT '[]',
  output_webhook_url text, applies_to jsonb NOT NULL DEFAULT '{}', requires_campaign boolean NOT NULL DEFAULT true,
  audience text NOT NULL DEFAULT 'admin_akabiz' CHECK (audience IN ('off', 'admin_akabiz', 'all')),
  timeout_seconds integer NOT NULL DEFAULT 300 CHECK (timeout_seconds BETWEEN 30 AND 3600), sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), answer_mode text NOT NULL DEFAULT 'claude_code', model_id bigint, fallback_model_id bigint, form_config_id bigint);
CREATE TABLE public.ai_message_thread (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id bigint NOT NULL REFERENCES public.ai_project(id),
  first_question text, organization_id bigint, org_staff_id bigint, campaign_id bigint, intake_data jsonb NOT NULL DEFAULT '{}', source text,
  status text NOT NULL DEFAULT 'đang mở', request_id uuid, last_message_seq integer NOT NULL DEFAULT 0, last_message_status text, last_read_seq integer NOT NULL DEFAULT 0,
  is_delete boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ai_message (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, thread_id bigint NOT NULL REFERENCES public.ai_message_thread(id),
  seq integer NOT NULL, request_id uuid NOT NULL UNIQUE, question text NOT NULL, answer text, answer_json jsonb, status text NOT NULL,
  asked_at timestamptz NOT NULL DEFAULT now(), answered_at timestamptz, deadline_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION private.aka_agent_ai_chat_active() RETURNS text[] LANGUAGE sql IMMUTABLE
  AS $f$ SELECT ARRAY['chờ câu trả lời', 'đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời'] $f$;
CREATE FUNCTION public.aka_agent_ai_chat_insert(p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_request uuid := (p_payload ->> 'requestId')::uuid;
  v_staff bigint := (p_payload ->> 'staffId')::bigint;
  v_thread bigint := (p_payload ->> 'threadId')::bigint;
  pr public.ai_project%ROWTYPE; t public.ai_message_thread%ROWTYPE; m public.ai_message%ROWTYPE; v_seq integer; v_count integer;
BEGIN
  IF coalesce(btrim(p_payload ->> 'question'), '') = '' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_question_required'; END IF;
  IF char_length(p_payload ->> 'question') > 4000 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_question_too_long'; END IF;
  SELECT * INTO m FROM public.ai_message WHERE request_id = v_request;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'inserted', false, 'threadId', m.thread_id, 'messageId', m.id, 'status', m.status);
  END IF;
  IF v_thread IS NOT NULL THEN
    SELECT * INTO t FROM public.ai_message_thread WHERE id = v_thread AND NOT is_delete AND org_staff_id = v_staff;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_thread_not_found'; END IF;
    SELECT * INTO pr FROM public.ai_project WHERE id = t.project_id;
  ELSE
    SELECT * INTO pr FROM public.ai_project WHERE code = p_payload ->> 'projectCode';
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_agent_not_found'; END IF;
  END IF;
  IF NOT pr.is_active OR pr.audience = 'off' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ai_chat_agent_unavailable'; END IF;
  -- Hết hạn lười như lõi thật.
  UPDATE public.ai_message x SET status = 'lỗi' WHERE x.status = ANY (private.aka_agent_ai_chat_active()) AND x.deadline_at <= clock_timestamp();
  UPDATE public.ai_message_thread s SET last_message_status = 'lỗi'
   WHERE s.last_message_status = ANY (private.aka_agent_ai_chat_active())
     AND NOT EXISTS (SELECT 1 FROM public.ai_message x WHERE x.thread_id = s.id AND x.seq = s.last_message_seq AND x.status = ANY (private.aka_agent_ai_chat_active()));
  -- Lõi thật đọc lại hội thoại sau bước hết hạn.
  IF v_thread IS NOT NULL THEN SELECT * INTO t FROM public.ai_message_thread WHERE id = v_thread; END IF;
  IF v_thread IS NULL THEN
    -- Đang có câu chờ của cùng nhân viên + agent (+ chiến dịch): lõi trả hội thoại đó, không chèn.
    SELECT * INTO t FROM public.ai_message_thread s WHERE s.org_staff_id = v_staff AND s.project_id = pr.id AND NOT s.is_delete
       AND s.last_message_status = ANY (private.aka_agent_ai_chat_active()) ORDER BY id DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', false, 'inserted', false, 'code', 'ai_chat_message_pending', 'threadId', t.id);
    END IF;
  ELSE
    IF t.status <> 'đang mở' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_thread_closed'; END IF;
    IF t.last_message_status = ANY (private.aka_agent_ai_chat_active()) THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_message_pending'; END IF;
  END IF;
  SELECT count(*) INTO v_count FROM public.ai_message_thread s WHERE s.org_staff_id = v_staff AND NOT s.is_delete
     AND s.last_message_status = ANY (private.aka_agent_ai_chat_active());
  IF v_count >= 3 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_too_many_pending'; END IF;
  IF v_thread IS NULL THEN
    INSERT INTO public.ai_message_thread (project_id, first_question, organization_id, org_staff_id, intake_data, source, request_id, last_message_seq, last_message_status)
    VALUES (pr.id, p_payload ->> 'question', (p_payload ->> 'organizationId')::bigint, v_staff, coalesce(p_payload -> 'intake', '{}'), p_payload ->> 'source', v_request, 1, 'chờ câu trả lời')
    RETURNING * INTO t;
    v_seq := 1;
  ELSE
    v_seq := t.last_message_seq + 1;
    UPDATE public.ai_message_thread SET last_message_seq = v_seq, last_message_status = 'chờ câu trả lời' WHERE id = t.id;
  END IF;
  INSERT INTO public.ai_message (thread_id, seq, request_id, question, status, deadline_at)
  VALUES (t.id, v_seq, v_request, p_payload ->> 'question', 'chờ câu trả lời', clock_timestamp() + make_interval(secs => pr.timeout_seconds)) RETURNING * INTO m;
  RETURN jsonb_build_object('ok', true, 'inserted', true, 'threadId', t.id, 'messageId', m.id, 'status', m.status);
END $f$;
CREATE TABLE public.auto_staff_device_presence (instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id bigint NOT NULL, last_seen_at timestamptz NOT NULL);
`

module.exports = { AI_STUBS }

-- V592: đánh thức bộ trả lời "Hỏi đáp chiến dịch" chỉ khi có câu hỏi (20/11/2026).
-- Job pg_cron mỗi 2 phút đọc ai_message (bảng nhỏ, không gọi Claude). Có câu đang chờ
-- của agent hoi-dap-chien-dich / hoi-dap-chien-dich-desktop thì gọi đường /fire của
-- tác vụ cloud (mã Bearer ở Vault AKA_AGENT_AI_CHAT_ANSWER_FIRE_TOKEN). Không có câu thì
-- không tốn token nào.
-- Thiết lập auto_system_settings 'ai_chat.answer_fire' (JSON):
--   enabled (true mới chạy), routineId, until (ngày VN, quá ngày thì dừng),
--   retryMinutes (gọi lại khi câu vẫn chờ, mặc định 5), maxPerHour (mặc định 20),
--   projectCodes (mặc định hai mã Hỏi đáp).
-- Tắt: đặt "enabled": false. Gỡ: rollback_v592_ai_chat_answer_fire.sql.
-- Chỉ thêm đối tượng mới, không sửa bảng / hàm có sẵn.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v592_%') THEN
    RAISE EXCEPTION 'V592 đã có trong sổ migration, không chạy lại';
  END IF;
  IF to_regclass('public.ai_message') IS NULL OR to_regclass('public.ai_project') IS NULL THEN
    RAISE EXCEPTION 'Thiếu bảng Hỏi đáp AI';
  END IF;
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'Thiếu pg_net';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS private.ai_chat_answer_fire_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_tick_at timestamptz,
  last_waiting int NOT NULL DEFAULT 0,
  last_fire_at timestamptz,
  last_fired_message_id bigint,
  last_request_id bigint,
  fire_total bigint NOT NULL DEFAULT 0,
  fire_hour_start timestamptz,
  fire_hour_count int NOT NULL DEFAULT 0,
  last_error text
);
INSERT INTO private.ai_chat_answer_fire_state (id) VALUES (1) ON CONFLICT DO NOTHING;
REVOKE ALL ON private.ai_chat_answer_fire_state FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
SELECT 'ai_chat.answer_fire',
       '{"enabled":true,"routineId":"trig_01AKtgF3rHsr5Bs6HsTnJxHm","until":"2027-11-20","retryMinutes":5,"maxPerHour":20,"projectCodes":["hoi-dap-chien-dich","hoi-dap-chien-dich-desktop"]}',
       'V592: job aka-agent-ai-chat-answer-fire (2 phút) gọi /fire của tác vụ cloud routineId khi có câu Hỏi đáp chờ của projectCodes. enabled true mới chạy; until = ngày cuối (giờ VN); retryMinutes = gọi lại khi câu vẫn chờ; maxPerHour = trần lượt gọi mỗi giờ. Mã Bearer ở Vault AKA_AGENT_AI_CHAT_ANSWER_FIRE_TOKEN.',
       false, true
WHERE NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'ai_chat.answer_fire');

CREATE OR REPLACE FUNCTION public.aka_agent_ai_chat_answer_fire_tick_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
SET statement_timeout = '15s'
AS $fn$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_cfg jsonb;
  v_codes text[];
  v_routine text;
  v_until date;
  v_retry int;
  v_max_hour int;
  v_token text;
  v_waiting int;
  v_newest bigint;
  st private.ai_chat_answer_fire_state;
  v_req bigint;
  v_reason text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('aka-agent-ai-chat-answer-fire')) THEN
    RETURN jsonb_build_object('ok', false, 'skip', 'busy');
  END IF;

  BEGIN
    SELECT value::jsonb INTO v_cfg FROM public.auto_system_settings
     WHERE key = 'ai_chat.answer_fire' AND is_active;
  EXCEPTION WHEN OTHERS THEN v_cfg := NULL;
  END;
  IF v_cfg IS NULL OR coalesce(v_cfg ->> 'enabled', '') <> 'true' THEN
    RETURN jsonb_build_object('ok', true, 'skip', 'disabled');
  END IF;

  BEGIN v_until := (v_cfg ->> 'until')::date; EXCEPTION WHEN OTHERS THEN v_until := NULL; END;
  IF v_until IS NOT NULL AND (v_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::date > v_until THEN
    RETURN jsonb_build_object('ok', true, 'skip', 'expired');
  END IF;

  v_routine := nullif(v_cfg ->> 'routineId', '');
  IF v_routine IS NULL OR v_routine !~ '^trig_[A-Za-z0-9]+$' THEN
    RETURN jsonb_build_object('ok', false, 'skip', 'bad_routine');
  END IF;
  SELECT coalesce(array_agg(x), ARRAY['hoi-dap-chien-dich','hoi-dap-chien-dich-desktop'])
    INTO v_codes FROM jsonb_array_elements_text(coalesce(v_cfg -> 'projectCodes', '[]'::jsonb)) x;
  IF v_codes IS NULL OR cardinality(v_codes) = 0 THEN
    v_codes := ARRAY['hoi-dap-chien-dich','hoi-dap-chien-dich-desktop'];
  END IF;
  v_retry := least(greatest(coalesce((v_cfg ->> 'retryMinutes')::int, 5), 2), 60);
  v_max_hour := least(greatest(coalesce((v_cfg ->> 'maxPerHour')::int, 20), 1), 30);

  -- Câu đang chờ, hoặc đã nhận mà quá hạn giữ chỗ (phiên trước chết), còn hơn 2 phút hạn chót.
  SELECT count(*), max(m.id) INTO v_waiting, v_newest
    FROM public.ai_message m
    JOIN public.ai_message_thread t ON t.id = m.thread_id
    JOIN public.ai_project p ON p.id = t.project_id
   WHERE p.code = ANY (v_codes) AND NOT t.is_delete
     AND m.deadline_at > v_now + interval '2 minutes'
     AND (m.status = 'chờ câu trả lời'
          OR (m.status = ANY (private.aka_agent_ai_chat_active()) AND m.lease_until < v_now));

  SELECT * INTO st FROM private.ai_chat_answer_fire_state WHERE id = 1 FOR UPDATE;
  UPDATE private.ai_chat_answer_fire_state SET last_tick_at = v_now, last_waiting = v_waiting WHERE id = 1;

  IF v_waiting = 0 THEN
    RETURN jsonb_build_object('ok', true, 'waiting', 0);
  END IF;

  IF st.last_fire_at IS NOT NULL
     AND v_newest <= coalesce(st.last_fired_message_id, 0)
     AND st.last_fire_at > v_now - make_interval(mins => v_retry) THEN
    RETURN jsonb_build_object('ok', true, 'waiting', v_waiting, 'skip', 'recently_fired');
  END IF;

  IF st.fire_hour_start IS NOT NULL AND st.fire_hour_start > v_now - interval '1 hour'
     AND st.fire_hour_count >= v_max_hour THEN
    RETURN jsonb_build_object('ok', true, 'waiting', v_waiting, 'skip', 'hour_cap');
  END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets
   WHERE name = 'AKA_AGENT_AI_CHAT_ANSWER_FIRE_TOKEN' LIMIT 1;
  IF coalesce(v_token, '') = '' THEN
    UPDATE private.ai_chat_answer_fire_state SET last_error = 'Chưa có mã Vault AKA_AGENT_AI_CHAT_ANSWER_FIRE_TOKEN' WHERE id = 1;
    RETURN jsonb_build_object('ok', false, 'waiting', v_waiting, 'skip', 'no_token');
  END IF;

  v_reason := CASE WHEN v_newest > coalesce(st.last_fired_message_id, 0) THEN 'new' ELSE 'retry' END;
  BEGIN
    SELECT net.http_post(
      url := 'https://api.anthropic.com/v1/claude_code/routines/' || v_routine || '/fire',
      body := jsonb_build_object('text', 'waiting=' || v_waiting || ' newestMessageId=' || v_newest),
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'anthropic-version', '2023-06-01',
                                    'anthropic-beta', 'experimental-cc-routine-2026-04-01', 'Content-Type', 'application/json'),
      timeout_milliseconds := 10000) INTO v_req;
  EXCEPTION WHEN OTHERS THEN
    UPDATE private.ai_chat_answer_fire_state SET last_error = 'Gọi /fire lỗi: ' || left(SQLERRM, 200) WHERE id = 1;
    RETURN jsonb_build_object('ok', false, 'waiting', v_waiting, 'error', 'fire_failed');
  END;

  UPDATE private.ai_chat_answer_fire_state
     SET last_fire_at = v_now,
         last_fired_message_id = greatest(coalesce(last_fired_message_id, 0), v_newest),
         last_request_id = v_req,
         fire_total = fire_total + 1,
         fire_hour_start = CASE WHEN fire_hour_start IS NULL OR fire_hour_start <= v_now - interval '1 hour' THEN v_now ELSE fire_hour_start END,
         fire_hour_count = CASE WHEN fire_hour_start IS NULL OR fire_hour_start <= v_now - interval '1 hour' THEN 1 ELSE fire_hour_count + 1 END,
         last_error = NULL
   WHERE id = 1;

  RETURN jsonb_build_object('ok', true, 'waiting', v_waiting, 'fired', v_reason, 'requestId', v_req);
END
$fn$;

REVOKE ALL ON FUNCTION public.aka_agent_ai_chat_answer_fire_tick_v1() FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;

-- Phút lẻ để không trùng job kiểm lỗi (*/2 phút chẵn).
SELECT cron.schedule('aka-agent-ai-chat-answer-fire', '1-59/2 * * * *', 'SELECT public.aka_agent_ai_chat_answer_fire_tick_v1()');

COMMIT;

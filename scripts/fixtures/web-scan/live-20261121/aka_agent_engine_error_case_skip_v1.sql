CREATE OR REPLACE FUNCTION private.aka_agent_engine_error_case_skip_v1(p_message_id bigint, p_skip boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_key text;
  v_case private.auto_engine_error_cases%ROWTYPE;
  v_cfg jsonb;
  v_threshold integer;
  v_n integer;
  v_at text := to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI');
BEGIN
  SELECT t.intake_data ->> 'khoa' INTO v_key
    FROM public.ai_message m JOIN public.ai_message_thread t ON t.id = m.thread_id JOIN public.ai_project p ON p.id = t.project_id
   WHERE m.id = p_message_id AND p.code = 'kiem-loi-chien-dich-facebook';
  IF v_key IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'case_not_found', 'messageId', p_message_id); END IF;
  SELECT * INTO v_case FROM private.auto_engine_error_cases WHERE case_key = v_key FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'case_not_found', 'messageId', p_message_id); END IF;

  IF p_skip THEN
    -- Ca đang được kiểm (queued) thì chờ báo cáo về rồi mới bỏ qua: bước chép báo cáo chỉ nhận ca 'queued'.
    IF v_case.status NOT IN ('new', 'reported', 'failed') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'status_' || v_case.status, 'khoa', v_key);
    END IF;
    UPDATE private.auto_engine_error_cases SET status = 'muted', note = 'Bỏ qua theo người vận hành lúc ' || v_at || ' (câu ' || p_message_id || ')',
           updated_at = now() WHERE case_key = v_key;
  ELSE
    IF v_case.status <> 'muted' THEN RETURN jsonb_build_object('ok', false, 'code', 'not_muted', 'khoa', v_key, 'status', v_case.status); END IF;
    UPDATE private.auto_engine_error_cases SET status = CASE WHEN v_case.report_at IS NOT NULL THEN 'reported' ELSE 'new' END,
           note = 'Bỏ chế độ bỏ qua lúc ' || v_at, updated_at = now() WHERE case_key = v_key;
  END IF;

  SELECT CASE WHEN s.value IS NULL OR btrim(s.value) = '' THEN '{}'::jsonb ELSE s.value::jsonb END INTO v_cfg
    FROM public.auto_system_settings s WHERE s.key = 'engine.error_watch';
  v_threshold := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'skipReopenHits24h', 30)::integer, 1), 100000);
  SELECT count(*) INTO v_n FROM private.auto_engine_error_items i WHERE i.case_key = v_key AND i.occurred_at > now() - interval '24 hours';
  RETURN jsonb_build_object('ok', true, 'khoa', v_key, 'ma', v_case.public_code, 'status', CASE WHEN p_skip THEN 'muted'
           WHEN v_case.report_at IS NOT NULL THEN 'reported' ELSE 'new' END, 'hits24h', v_n, 'reopenHits24h', v_threshold);
END $function$

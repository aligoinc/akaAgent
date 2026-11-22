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
$function$

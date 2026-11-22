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
$function$

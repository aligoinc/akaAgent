CREATE OR REPLACE FUNCTION private.aka_agent_ai_assistant_stream(p_staff_id bigint, p_organization_id bigint, v_p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  st public.ai_assistant_state%ROWTYPE; v_before bigint := private.aka_agent_ai_assistant_id(v_p -> 'beforeId');
  v_limit integer := coalesce(private.aka_agent_ai_chat_int(v_p -> 'limit', 30, 1, 50), 30); v_items jsonb; v_count integer;
BEGIN
  PERFORM private.aka_agent_ai_assistant_access(p_staff_id, p_organization_id);
  IF v_before IS NULL THEN PERFORM private.aka_agent_ai_assistant_expire(p_staff_id); END IF;
  st := private.aka_agent_ai_assistant_state(p_staff_id, p_organization_id);
  SELECT coalesce(jsonb_agg(private.aka_agent_ai_assistant_item(x) ORDER BY x.id), '[]'::jsonb), count(*) INTO v_items, v_count
    FROM (SELECT * FROM public.ai_message m
           WHERE m.assistant_staff_id = p_staff_id AND (v_before IS NULL OR m.id < v_before)
           ORDER BY m.id DESC LIMIT v_limit) x;
  RETURN jsonb_build_object('items', v_items, 'hasMore', v_count = v_limit, 'lastReadMessageId', st.last_read_message_id,
    'limits', private.aka_agent_ai_assistant_limits(p_staff_id, st), 'serverTime', clock_timestamp());
END
$function$

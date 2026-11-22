CREATE OR REPLACE FUNCTION private.aka_agent_ai_assistant_sync(p_staff_id bigint, p_organization_id bigint, v_p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_after bigint := coalesce(private.aka_agent_ai_assistant_id(v_p -> 'afterId'), 0); v_new jsonb; v_watched jsonb; v_ids bigint[];
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
    FROM (SELECT * FROM public.ai_message m WHERE m.assistant_staff_id = p_staff_id AND m.id > v_after ORDER BY m.id LIMIT 50) x;
  SELECT coalesce(jsonb_agg(private.aka_agent_ai_assistant_item(m) ORDER BY m.id), '[]'::jsonb) INTO v_watched
    FROM public.ai_message m WHERE m.id = ANY (v_ids) AND m.assistant_staff_id = p_staff_id;
  RETURN jsonb_build_object('items', v_new, 'watched', v_watched, 'serverTime', clock_timestamp());
END
$function$

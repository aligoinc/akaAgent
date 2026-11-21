CREATE OR REPLACE FUNCTION public.aka_agent_engine_classify_signal(p_platform text, p_action_code text, p_phase text, p_signal jsonb)
 RETURNS TABLE(error_code text, rule_id bigint, matched_by text, is_catch_all boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_kind text := lower(coalesce(p_signal->>'kind', ''));
  v_code text := coalesce(p_signal->>'code', '');
  v_msg text := coalesce(p_signal->>'message', '');
  v_direct text := nullif(p_signal->>'errorCode', '');
BEGIN
  IF v_direct IS NOT NULL AND EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code = v_direct AND e.is_active AND NOT e.is_delete) THEN
    RETURN QUERY SELECT v_direct, NULL::bigint, 'direct'::text, false;
    RETURN;
  END IF;
  -- Thứ tự: mã chính xác > câu lỗi (message_like) > mọi mã của đúng loại tín hiệu ('*') > bắt-tất-cả (engine '*').
  -- Cùng hạng thì luật của nền tảng trước luật 'system', có thao tác trước không thao tác, có pha trước không pha.
  RETURN QUERY
  SELECT r.error_code, r.id, r.signal_kind, (r.pattern = '*')
  FROM public.auto_outcome_signal_rules r
  JOIN public.auto_error e ON e.error_code = r.error_code AND e.is_active AND NOT e.is_delete
  WHERE r.is_active
    AND r.platform IN (p_platform, 'system')
    AND (r.action_code IS NULL OR r.action_code = p_action_code)
    AND (r.phase IS NULL OR r.phase = p_phase)
    AND (
      (r.signal_kind NOT IN ('message_like', 'engine') AND r.signal_kind = v_kind AND (r.pattern = v_code OR r.pattern = '*'))
      OR (r.signal_kind = 'engine' AND r.pattern <> '*' AND v_kind = 'engine' AND r.pattern = v_code)
      OR (r.signal_kind = 'message_like' AND v_msg <> '' AND v_msg ILIKE r.pattern)
      OR (r.signal_kind = 'engine' AND r.pattern = '*')
    )
  ORDER BY
    CASE WHEN r.signal_kind = 'engine' AND r.pattern = '*' THEN 3 WHEN r.pattern = '*' THEN 2
         WHEN r.signal_kind = 'message_like' THEN 1 ELSE 0 END,
    (r.platform = 'system'), (r.action_code IS NULL), (r.phase IS NULL), r.priority, r.id
  LIMIT 1;
END $function$

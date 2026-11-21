CREATE OR REPLACE FUNCTION public.aka_agent_engine_resolve_policy(p_error_code text, p_status_id bigint, p_action_code text, p_campaign_action_id text, p_runtime_target text, p_phase text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  c_fields constant text[] := ARRAY['detail_mode','detail_status_id','sub_status_id','log_template','campaign_note_template',
    'quota_effect','target_streak_effect','streak_threshold','target_effect','requeue_after_minutes','remaining_steps',
    'lock_action_codes','lock_mode','lock_minutes','lock_days','lock_time','run_effect','pace_mode','pace_seconds',
    'campaign_effect','campaign_hold_minutes','account_effect','login_effect','streak_after_delivery'];
  v_class text;
  v_failed bigint;
  v_success bigint;
  v_defaults jsonb;
  v_error jsonb := '{}'::jsonb;
  v_status jsonb := '{}'::jsonb;
  v_guard jsonb := '{}'::jsonb;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_revs jsonb := '{}'::jsonb;
  v_status_id bigint;
  r record;
  v_row jsonb;
  v_class_part jsonb := '{}'::jsonb;
  v_code_part jsonb := '{}'::jsonb;
  v_inherit boolean := false;
BEGIN
  SELECT s.id INTO v_failed FROM public.auto_status s WHERE s.code = 'campaign_detail_failed';
  SELECT s.id INTO v_success FROM public.auto_status s WHERE s.code = 'campaign_detail_success';
  -- Mặc định an toàn có sẵn trong hàm (dùng khi dữ liệu chính sách thiếu); không ném lỗi.
  v_defaults := jsonb_build_object('lock_action_codes', '[]'::jsonb,
    'campaign_effect', 'none', 'account_effect', 'none', 'login_effect', 'none');
  IF p_error_code IS NULL THEN
    v_defaults := v_defaults || jsonb_build_object('detail_mode','write','detail_status_id',coalesce(p_status_id, v_success),
      'quota_effect','count','target_streak_effect','reset','target_effect','complete','remaining_steps','continue',
      'run_effect','continue','pace_mode','full');
  ELSIF p_phase = 'before_send' THEN
    v_defaults := v_defaults || jsonb_build_object('detail_mode','suppress','detail_status_id',v_failed,
      'quota_effect','no_count','target_streak_effect','ignore','target_effect','requeue','remaining_steps','skip',
      'run_effect','end_unit','pace_mode','none');
  ELSIF p_phase = 'in_flight' THEN
    v_defaults := v_defaults || jsonb_build_object('detail_mode','write','detail_status_id',v_failed,
      'quota_effect','count_if_committed','target_streak_effect','ignore','target_effect','complete','remaining_steps','skip',
      'run_effect','continue','pace_mode','full');
  ELSE
    v_defaults := v_defaults || jsonb_build_object('detail_mode','write','detail_status_id',v_failed,
      'quota_effect','count','target_streak_effect','increment','target_effect','complete','remaining_steps','continue',
      'run_effect','continue','pace_mode','full');
  END IF;

  IF p_error_code IS NOT NULL THEN
    SELECT e.error_class INTO v_class FROM public.auto_error e WHERE e.error_code = p_error_code;
    FOR r IN
      SELECT p.*,
        CASE WHEN p.error_code IS NOT NULL THEN 2 ELSE 1 END AS k,
        (CASE WHEN p.campaign_action_id IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN p.action_code IS NOT NULL THEN 2 ELSE 0 END
          + CASE WHEN p.runtime_target IS NOT NULL THEN 1 ELSE 0 END) AS spec
      FROM public.auto_outcome_policies p
      WHERE p.is_active AND NOT p.is_delete
        AND (p.error_code = p_error_code OR (v_class IS NOT NULL AND p.error_class = v_class))
        AND (p.action_code IS NULL OR p.action_code = p_action_code)
        AND (p.campaign_action_id IS NULL OR p.campaign_action_id = p_campaign_action_id)
        AND (p.runtime_target IS NULL OR p.runtime_target = p_runtime_target)
      ORDER BY k, spec, p.id
    LOOP
      v_row := coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(to_jsonb(r)) f
        WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
      -- V558: tách dòng theo nhóm lỗi (k = 1) và dòng theo mã (k = 2) để giải detail_mode = inherit.
      IF r.k = 1 THEN v_class_part := v_class_part || v_row; ELSE v_code_part := v_code_part || v_row; END IF;
      v_ids := v_ids || r.id;
      v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
    END LOOP;
    -- V558: inherit = cách tính của bộ cũ Facebook: lượt, chuỗi data lỗi, data đi đâu và trạng thái lịch sử theo chính sách của trạng thái
    -- kết quả, trừ khi dòng theo mã khai rõ; dòng theo nhóm lỗi không áp các trường đó.
    v_inherit := coalesce(v_code_part->>'detail_mode', v_class_part->>'detail_mode') = 'inherit';
    v_error := CASE WHEN v_inherit
      THEN (v_class_part - ARRAY['detail_status_id', 'quota_effect', 'target_streak_effect', 'target_effect']) || v_code_part
      ELSE v_class_part || v_code_part END;
  END IF;

  -- Chặn theo thao tác (dòng chỉ có action_code): áp sau cùng, ví dụ thao tác phụ gắn tag/đổi tên
  -- không bao giờ tính lượt hay chuỗi lỗi, dù mã lỗi nói gì (giống guard auxiliaryAction hiện nay).
  FOR r IN
    SELECT p.*,
      (CASE WHEN p.campaign_action_id IS NOT NULL THEN 2 ELSE 0 END + CASE WHEN p.runtime_target IS NOT NULL THEN 1 ELSE 0 END) AS spec
    FROM public.auto_outcome_policies p
    WHERE p.is_active AND NOT p.is_delete
      AND p.status_id IS NULL AND p.error_code IS NULL AND p.error_class IS NULL
      AND p.action_code = p_action_code
      AND (p.campaign_action_id IS NULL OR p.campaign_action_id = p_campaign_action_id)
      AND (p.runtime_target IS NULL OR p.runtime_target = p_runtime_target)
    ORDER BY spec, p.id
  LOOP
    v_row := to_jsonb(r);
    v_guard := v_guard || coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(v_row) f
      WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
    v_ids := v_ids || r.id;
    v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
  END LOOP;

  -- V558: inherit thì trạng thái kết quả gửi lên (p_status_id) đứng trước trạng thái của dòng theo mã (chỉ dùng khi không gửi trạng thái).
  v_status_id := CASE WHEN v_inherit
    THEN coalesce((v_guard->>'detail_status_id')::bigint, p_status_id, (v_code_part->>'detail_status_id')::bigint, (v_defaults->>'detail_status_id')::bigint)
    ELSE coalesce((v_guard->>'detail_status_id')::bigint, (v_error->>'detail_status_id')::bigint, p_status_id,
    (v_defaults->>'detail_status_id')::bigint) END;

  FOR r IN
    WITH RECURSIVE chain AS (
      SELECT s.id, s.parent_status_id, 0 AS depth FROM public.auto_status s WHERE s.id = v_status_id
      UNION ALL
      SELECT a.id, a.parent_status_id, c.depth + 1 FROM chain c JOIN public.auto_status a ON a.id = c.parent_status_id WHERE c.depth < 10
    )
    SELECT p.*, c.depth AS depth,
      (CASE WHEN p.campaign_action_id IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN p.action_code IS NOT NULL THEN 2 ELSE 0 END
        + CASE WHEN p.runtime_target IS NOT NULL THEN 1 ELSE 0 END) AS spec
    FROM chain c JOIN public.auto_outcome_policies p ON p.status_id = c.id
    WHERE p.is_active AND NOT p.is_delete
      AND (p.action_code IS NULL OR p.action_code = p_action_code)
      AND (p.campaign_action_id IS NULL OR p.campaign_action_id = p_campaign_action_id)
      AND (p.runtime_target IS NULL OR p.runtime_target = p_runtime_target)
    ORDER BY c.depth DESC, spec, p.id
  LOOP
    v_row := to_jsonb(r);
    v_status := v_status || coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(v_row) f
      WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
    v_ids := v_ids || r.id;
    v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
  END LOOP;

  -- V558: bộ cũ Facebook không có pha: data hoàn thành khi trạng thái không nói khác (inputEffect 'none').
  IF v_inherit THEN v_defaults := v_defaults || jsonb_build_object('target_effect', 'complete'); END IF;
  RETURN v_defaults || v_status || v_error || v_guard || jsonb_build_object(
    'detail_status_id', v_status_id, 'error_class', v_class, 'policy_ids', to_jsonb(v_ids), 'revisions', v_revs);
END $function$

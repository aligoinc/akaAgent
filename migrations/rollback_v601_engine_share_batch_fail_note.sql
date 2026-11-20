-- Gỡ V601: trả aka_agent_engine_report_batch_v1 về thân V503 (md5 prosrc 90994a3cbe67f6f9c1f7d5dd8f0c4c79): ghi chú tạm dừng cả lô lại là câu chung
-- "Toàn bộ N target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra".
-- SINH TỪ scripts/build-v601-sql.cjs. Lệnh DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; p pg_catalog.pg_proc%ROWTYPE; v_md5 text;
BEGIN
  v_oid := to_regprocedure('public.aka_agent_engine_report_batch_v1(uuid,jsonb,integer,boolean)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Gỡ V601: không có public.aka_agent_engine_report_batch_v1(uuid,jsonb,integer,boolean)'; END IF;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = v_oid;
  v_md5 := md5(p.prosrc);
  IF v_md5 = '90994a3cbe67f6f9c1f7d5dd8f0c4c79' THEN RAISE EXCEPTION 'Gỡ V601: thân report_batch_v1 đã là bản trước V601 (chưa apply V601 hoặc đã gỡ)'; END IF;
  IF v_md5 IS DISTINCT FROM '1a2a5099f6ce44758474d6af2f6ab8c0' THEN RAISE EXCEPTION 'Gỡ V601: thân report_batch_v1 không phải bản V601 (%)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 IS DISTINCT FROM 'a845aed50b7b18f3b65cb5377d653e6d' THEN RAISE EXCEPTION 'Gỡ V601: định nghĩa report_batch_v1 khác bản nguồn (%)', v_md5; END IF;
  IF pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR NOT p.prosecdef OR p.provolatile IS DISTINCT FROM 'v'
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'Gỡ V601: chủ sở hữu / thuộc tính report_batch_v1 khác bản đã đọc';
  END IF;
  -- Hậu kiểm so lại đúng quyền đã lưu (CREATE OR REPLACE giữ chủ sở hữu và quyền).
  PERFORM set_config('aka.v601_acl', coalesce(p.proacl::text, ''), true);
END $pre$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_report_batch_v1(p_lease_token uuid, p_items jsonb, p_batch_size integer DEFAULT NULL,
  p_already_stopped boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- V503: báo cả lô gửi dạng chia sẻ một lần (processZaloShareMessageBatch của Desktop). Mỗi data một mục { targetRunId, outcomes },
-- chốt data (final). Chế độ cho từng data như policyHandling của Desktop:
--   lô có người đã nhận được (kết quả thành công, hoặc giao một phần: đã nhận media) → mọi lỗi là target_only;
--   không ai nhận được → data có hiệu ứng mạnh nhất (getZaloPolicySideEffectPriority: đăng nhập 8, tài khoản 4, chiến dịch 2, khoá 1;
--   bằng nhau lấy data đầu) áp đủ chính sách, data khác batch_followup.
-- Không ai nhận được và chưa có chính sách nào dừng tài khoản / chiến dịch → tạm dừng chiến dịch với câu của Desktop.
-- Một mục bị report_v1 từ chối thì hoàn tác cả lô và trả lý do. p_batch_size: số data của lô (kể cả data đã báo riêng, như media quá giờ)
-- cho câu tạm dừng. p_already_stopped: lô đã dừng theo chính sách khi gửi tệp (stoppedDuringMedia của Desktop): không ai áp thêm
-- chính sách (không có data "full"), không tạm dừng "toàn bộ thất bại".
DECLARE
  v_now timestamptz := clock_timestamp();
  v_item jsonb;
  o jsonb;
  rr public.auto_engine_target_runs%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  v_campaign_id bigint;
  v_account_id bigint;
  v_runs bigint[] := '{}';
  v_run bigint;
  v_success boolean := false;
  v_best_run bigint;
  v_best integer := -1;
  v_priority integer;
  v_platform text;
  v_action text;
  v_phase text;
  v_error text;
  v_policy jsonb;
  v_scope text;
  v_res jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ok_items integer := 0;
  v_rank integer;
  v_stop_rank integer := 0;
  v_next text := 'next_target';
  v_note text;
  v_paused boolean := false;
  v_more boolean := false;
  v_rejected jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 50 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'items_invalid');
  END IF;
  FOR v_item IN SELECT x.value FROM jsonb_array_elements(p_items) x LOOP
    IF jsonb_typeof(v_item) <> 'object' OR coalesce(v_item->>'targetRunId', '') !~ '^[0-9]{1,18}$'
       OR jsonb_typeof(v_item->'outcomes') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item->'outcomes') = 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'items_invalid');
    END IF;
    v_run := (v_item->>'targetRunId')::bigint;
    IF v_run = ANY (v_runs) THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_duplicate', 'targetRunId', v_run); END IF;
    SELECT * INTO rr FROM public.auto_engine_target_runs WHERE id = v_run;
    IF NOT FOUND OR rr.lease_token IS DISTINCT FROM p_lease_token THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'lease_token_mismatch', 'targetRunId', v_run);
    END IF;
    IF v_campaign_id IS NULL THEN
      v_campaign_id := rr.campaign_id;
      v_account_id := rr.account_id;
    ELSIF v_campaign_id <> rr.campaign_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'campaign_mismatch', 'targetRunId', v_run);
    END IF;
    v_runs := v_runs || v_run;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'outcomes') y
                WHERE y.value->'ok' = 'true'::jsonb OR y.value->'evidence'->'partialDelivery' = 'true'::jsonb) THEN
      v_success := true;
    END IF;
  END LOOP;
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id;

  IF NOT v_success AND NOT coalesce(p_already_stopped, false) THEN
    FOR v_item IN SELECT x.value FROM jsonb_array_elements(p_items) x LOOP
      SELECT * INTO rr FROM public.auto_engine_target_runs WHERE id = (v_item->>'targetRunId')::bigint;
      v_priority := 0;
      FOR o IN SELECT y.value FROM jsonb_array_elements(v_item->'outcomes') y LOOP
        CONTINUE WHEN o->'ok' = 'true'::jsonb;
        v_action := o->>'actionCode';
        v_phase := coalesce(nullif(o->>'phase', ''), 'after_send');
        v_platform := NULL; v_error := NULL;
        SELECT aa.flatform_type INTO v_platform FROM public.auto_account_actions aa WHERE aa.code = v_action;
        SELECT cs.error_code INTO v_error FROM public.aka_agent_engine_classify_signal(v_platform, v_action, v_phase, coalesce(o->'signal', '{}'::jsonb)) cs;
        v_policy := public.aka_agent_engine_resolve_policy(coalesce(v_error, 'err_undefined'), NULL, v_action, c.action_id, rr.runtime_target, v_phase);
        v_priority := greatest(v_priority,
          CASE WHEN coalesce(v_policy->>'login_effect', 'none') <> 'none' THEN 8 ELSE 0 END
          + CASE WHEN coalesce(v_policy->>'account_effect', 'none') <> 'none' THEN 4 ELSE 0 END
          + CASE WHEN coalesce(v_policy->>'campaign_effect', 'none') <> 'none' THEN 2 ELSE 0 END
          + CASE WHEN jsonb_array_length(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) > 0 THEN 1 ELSE 0 END);
      END LOOP;
      IF v_priority > v_best THEN v_best := v_priority; v_best_run := rr.id; END IF;
    END LOOP;
  END IF;

  BEGIN
    FOR v_item IN SELECT x.value FROM jsonb_array_elements(p_items) x LOOP
      v_run := (v_item->>'targetRunId')::bigint;
      v_scope := CASE WHEN v_success THEN 'target_only' WHEN v_run = v_best_run THEN 'full' ELSE 'batch_followup' END;
      PERFORM set_config('aka.engine.batch_scope', CASE WHEN v_scope = 'full' THEN '' ELSE v_scope END, true);
      v_res := public.aka_agent_engine_report_v1(v_run, p_lease_token, v_item->'outcomes', true, false);
      PERFORM set_config('aka.engine.batch_scope', '', true);
      IF coalesce(v_res->>'ok', 'false') <> 'true' THEN
        RAISE EXCEPTION USING ERRCODE = 'AKB03', MESSAGE = jsonb_build_object('targetRunId', v_run, 'response', v_res)::text;
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'outcomes') y WHERE y.value->'ok' = 'true'::jsonb) THEN
        v_ok_items := v_ok_items + 1;
      END IF;
      v_rank := CASE v_res->>'next' WHEN 'ownership_lost' THEN 5 WHEN 'stop_campaign' THEN 4 WHEN 'stop_account' THEN 3 WHEN 'end_unit' THEN 2 ELSE 0 END;
      IF v_rank > v_stop_rank THEN
        v_stop_rank := v_rank;
        v_next := v_res->>'next';
        v_note := coalesce(v_res->'campaign'->>'note', v_res->'target'->>'note');
      END IF;
      v_results := v_results || jsonb_build_array(jsonb_build_object('targetRunId', v_run, 'scope', v_scope, 'response', v_res));
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'AKB03' THEN
    PERFORM set_config('aka.engine.batch_scope', '', true);
    v_rejected := SQLERRM::jsonb;
    RETURN jsonb_build_object('ok', false, 'reason', 'item_rejected', 'targetRunId', v_rejected->'targetRunId',
      'detail', v_rejected->'response');
  END;

  -- Không ai nhận được, chưa có chính sách nào dừng tài khoản / chiến dịch: tạm dừng chiến dịch để kiểm tra (như Desktop).
  IF NOT v_success AND NOT coalesce(p_already_stopped, false) AND v_stop_rank < 3 AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
       WHERE l.account_id = v_account_id AND l.lease_token = p_lease_token AND l.expires_at > clock_timestamp()) THEN
    v_note := 'Toàn bộ ' || greatest(coalesce(p_batch_size, 0), jsonb_array_length(p_items))
      || ' target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra';
    UPDATE public.auto_campaigns SET status = 'tạm dừng', note = v_note, updated_at = v_now
     WHERE id = v_campaign_id AND status IN ('đang chạy', 'chờ xử lý');
    IF FOUND THEN v_paused := true; v_stop_rank := 4; v_next := 'stop_campaign'; END IF;
  END IF;

  v_more := EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
    WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
      AND (d.schedule IS NULL OR d.schedule <= clock_timestamp())
      AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = p_lease_token));
  RETURN jsonb_build_object('ok', true, 'next', v_next, 'items', v_results,
    'summary', jsonb_build_object('items', jsonb_array_length(p_items), 'succeeded', v_ok_items, 'anyDelivered', v_success, 'paused', v_paused),
    'stopNote', CASE WHEN v_stop_rank >= 2 THEN v_note END, 'morePending', v_more);
END $f$;

DO $post$
DECLARE v_oid oid; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  v_oid := 'public.aka_agent_engine_report_batch_v1(uuid,jsonb,integer,boolean)'::regprocedure;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF md5(p.prosrc) IS DISTINCT FROM '90994a3cbe67f6f9c1f7d5dd8f0c4c79' THEN RAISE EXCEPTION 'Gỡ V601 postflight: thân report_batch_v1 %', md5(p.prosrc); END IF;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '0452e5ff91536f9f9ac1504eac5a3d54' THEN
    RAISE EXCEPTION 'Gỡ V601 postflight: định nghĩa report_batch_v1 %', md5(pg_get_functiondef(v_oid));
  END IF;
  IF pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR NOT p.prosecdef OR p.provolatile IS DISTINCT FROM 'v'
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR coalesce(p.proacl::text, '') IS DISTINCT FROM current_setting('aka.v601_acl', true) THEN
    RAISE EXCEPTION 'Gỡ V601 postflight: chủ sở hữu / quyền / thuộc tính report_batch_v1 bị đổi';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Gỡ V601 postflight: quyền report_batch_v1 quá rộng';
  END IF;
  IF NOT (has_function_privilege('service_role', v_oid, 'EXECUTE') AND has_function_privilege('aka_agent_chat_api', v_oid, 'EXECUTE')
          AND has_function_privilege('aka_agent_desktop', v_oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Gỡ V601 postflight: thiếu quyền EXECUTE report_batch_v1 của bên gọi';
  END IF;
END $post$;

COMMIT;

-- V504: loại trừ gửi (gateSendExclusion của Desktop) chạy bằng engine v2 (12/11/2026).
-- SINH TỪ scripts/build-v504-sql.cjs, không sửa tay.
--
-- Chỉ engine v2 gọi hàm mới (Fly chỉ khi tổ chức bật cờ, Desktop chỉ bản cài mới); bộ chạy cũ và hàm cũ
-- aka_agent_campaign_send_exclusion_runtime không đổi. Không thêm cột hay bảng, không đổi dữ liệu cũ.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
--   * aka_agent_engine_send_exclusion_v1 (mới): cấu hình loại trừ ('snapshot') / dữ kiện DB của người nhận ('facts'), xác thực bằng lease.
--   * EXC01, EXC02, CFG18 (mã mới, error_type 'engine v2') + luật + chính sách.
--   * Danh sách không gửi tin kiểu cũ: thao tác 'friend_blocklist', EXC03, CFG19.
--   * auto_engine_gates.send_exclusion: on_error closed (chưa kiểm được thì chưa gửi).
-- Gỡ: rollback_v504_engine_send_exclusion.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text; v_helper text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v504_%') THEN
      RAISE EXCEPTION 'V504 đã có trong sổ migration, không chạy lại';
    END IF;
    -- Production: phần đọc cấu hình / dữ kiện chép từ hàm cũ; hàm cũ đổi thì sinh lại V504 từ bản mới.
    SELECT md5(pg_get_functiondef(to_regprocedure('public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)'))) INTO v_md5;
    IF v_md5 IS DISTINCT FROM 'ca4ba08f2a0fc853c3cee79ac1190001' THEN RAISE EXCEPTION 'V504: hàm loại trừ cũ khác bản đã đọc (%)', v_md5; END IF;
    FOREACH v_helper IN ARRAY ARRAY['public.aka_agent_internal_validate_send_exclusion_selection(jsonb,bigint,bigint,bigint)', 'public.aka_agent_internal_send_exclusion_catalog()', 'public.aka_agent_internal_send_exclusion_group(bigint)', 'public.aka_agent_data_group_zalo_facts(bigint)', 'public.aka_agent_internal_delivery_cooldown_target_keys(text,text,text,text)', 'public.aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)'] LOOP
      IF to_regprocedure(v_helper) IS NULL THEN RAISE EXCEPTION 'V504: thiếu hàm %', v_helper; END IF;
    END LOOP;
  END IF;
  IF to_regprocedure('public.aka_agent_engine_claim_batch_v1(jsonb)') IS NULL THEN RAISE EXCEPTION 'V504 cần V503'; END IF;
  IF to_regprocedure('public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'V504: hàm loại trừ của engine đã có'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE public_code IN ('EXC01', 'EXC02', 'CFG18', 'EXC03', 'CFG19') OR error_code IN ('err_engine_send_excluded', 'err_engine_send_exclusion_unknown', 'err_cfg_send_exclusion_invalid', 'err_engine_friend_blocklisted', 'err_cfg_friend_blocklist_invalid')) THEN
    RAISE EXCEPTION 'V504: mã EXC01 / EXC02 / EXC03 / CFG18 / CFG19 đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE signal_kind = 'engine' AND pattern IN ('send_excluded', 'send_exclusion_unknown', 'send_exclusion_config_invalid', 'friend_blocklisted', 'friend_blocklist_invalid')) THEN
    RAISE EXCEPTION 'V504: luật loại trừ đã có';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_gates WHERE code = 'send_exclusion' AND on_error = 'open') THEN
    RAISE EXCEPTION 'V504: cổng send_exclusion không còn như V495';
  END IF;
END $pre$;

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES
  ('engine v2', 'err_engine_send_excluded', 'Thuộc điều kiện loại trừ gửi',
   'Engine v2: người nhận thuộc danh sách Zalo ID loại trừ hoặc thoả nhóm điều kiện loại trừ của tài khoản; data tạm dừng, không gửi.',
   NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'EXC01', 'target_permanent',
   'Bỏ qua vì người nhận thuộc điều kiện loại trừ gửi', 'Sửa nhóm điều kiện / danh sách loại trừ rồi bật lại data nếu muốn gửi cho người này.'),
  ('engine v2', 'err_engine_send_exclusion_unknown', 'Chưa đủ dữ liệu để kiểm tra loại trừ gửi',
   'Engine v2: không đủ dữ liệu để kết luận người nhận có thuộc điều kiện loại trừ hay không; data tạm dừng, không gửi (như bộ cũ).',
   NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'EXC02', 'target_temporary',
   'Chưa đủ dữ liệu để kiểm tra điều kiện loại trừ gửi', 'Kiểm tra lại nhóm điều kiện loại trừ (điều kiện cần dữ liệu người nhận chưa có) rồi bật lại data.'),
  ('engine v2', 'err_cfg_send_exclusion_invalid', 'Cấu hình loại trừ gửi không dùng được',
   'Cấu hình: chiến dịch bật loại trừ gửi nhưng cấu hình của tài khoản chạy thiếu, hỏng, hoặc nhóm / danh sách đã bị xoá.',
   NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'CFG18', 'content_config',
   'Không thể tải cấu hình loại trừ', 'Mở chiến dịch, chọn lại nhóm điều kiện / danh sách loại trừ cho tài khoản chạy rồi lưu.'),
  ('engine v2', 'err_engine_friend_blocklisted', 'Nằm trong danh sách không gửi tin',
   'Engine v2: bạn bè nằm trong danh sách không gửi tin Zalo kiểu cũ của chiến dịch; data hoàn thành, không gửi (như bộ cũ).',
   NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'EXC03', 'target_permanent',
   'Bỏ qua vì nằm trong danh sách không gửi tin', 'Bỏ người này khỏi danh sách không gửi tin rồi thêm lại data nếu muốn gửi.'),
  ('engine v2', 'err_cfg_friend_blocklist_invalid', 'Danh sách không gửi tin Zalo không hợp lệ',
   'Cấu hình: chiến dịch nhắn bạn bè bật danh sách không gửi tin kiểu cũ nhưng chưa chọn danh sách, danh sách đã xoá hoặc thuộc tài khoản khác.',
   NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'CFG19', 'content_config',
   'Danh sách không gửi tin Zalo không hợp lệ', 'Mở chiến dịch, chọn lại danh sách không gửi tin của tài khoản chạy (hoặc tắt) rồi lưu.');
INSERT INTO public.auto_outcome_policies (error_code, detail_mode, detail_status_id, log_template, quota_effect, target_streak_effect, target_effect,
  remaining_steps, lock_action_codes, run_effect, pace_mode, remember_target_days, campaign_effect, account_effect, login_effect, description, source)
SELECT 'err_engine_send_excluded', 'suppress', s.id, '{message}', 'no_count', 'ignore', 'hold', 'skip', '{}'::text[], 'continue',
  'none', 0, 'none', 'none', 'none', 'Thuộc điều kiện loại trừ: data tạm dừng kèm câu, không ghi lịch sử, không tính lượt, không nghỉ (như bộ cũ).', 'v504'
  FROM public.auto_status s WHERE s.code = 'campaign_detail_skipped'
UNION ALL
SELECT 'err_engine_send_exclusion_unknown', 'suppress', s.id, '{message}', 'no_count', 'ignore', 'hold', 'skip', '{}'::text[], 'continue',
  'none', 0, 'none', 'none', 'none', 'Chưa đủ dữ liệu để kiểm loại trừ: data tạm dừng kèm câu, không ghi lịch sử, không tính lượt (như bộ cũ).', 'v504'
  FROM public.auto_status s WHERE s.code = 'campaign_detail_skipped'
UNION ALL
SELECT 'err_cfg_send_exclusion_invalid', 'suppress', s.id, '{message}', 'no_count', 'ignore', 'requeue', 'skip', '{}'::text[], 'stop_campaign',
  'none', 0, 'pause', 'none', 'none', 'Cấu hình loại trừ hỏng: tạm dừng chiến dịch một lần, data về hàng đợi (bộ cũ: tạm dừng chiến dịch).', 'v504'
  FROM public.auto_status s WHERE s.code = 'campaign_detail_failed'
UNION ALL
SELECT 'err_engine_friend_blocklisted', 'suppress', s.id, '{message}', 'no_count', 'ignore', 'complete', 'skip', '{}'::text[], 'continue',
  'none', 0, 'none', 'none', 'none', 'Nằm trong danh sách không gửi tin: data hoàn thành kèm câu, không ghi lịch sử, không tính lượt, không nghỉ (như bộ cũ).', 'v504'
  FROM public.auto_status s WHERE s.code = 'campaign_detail_skipped'
UNION ALL
SELECT 'err_cfg_friend_blocklist_invalid', 'suppress', s.id, '{message}', 'no_count', 'ignore', 'requeue', 'skip', '{}'::text[], 'stop_campaign',
  'none', 0, 'pause', 'none', 'none', 'Danh sách không gửi tin không dùng được: tạm dừng chiến dịch một lần, data về hàng đợi (bộ cũ: chờ kèm câu).', 'v504'
  FROM public.auto_status s WHERE s.code = 'campaign_detail_failed';
INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('system', NULL, NULL, 'engine', 'send_excluded', 50, 'err_engine_send_excluded', 'v504', 'Người nhận thuộc điều kiện loại trừ gửi.'),
  ('system', NULL, NULL, 'engine', 'send_exclusion_unknown', 50, 'err_engine_send_exclusion_unknown', 'v504', 'Chưa đủ dữ liệu để kiểm loại trừ gửi.'),
  ('system', NULL, NULL, 'engine', 'send_exclusion_config_invalid', 50, 'err_cfg_send_exclusion_invalid', 'v504', 'Cấu hình loại trừ gửi hỏng.'),
  ('system', NULL, NULL, 'engine', 'friend_blocklisted', 50, 'err_engine_friend_blocklisted', 'v504', 'Bạn bè nằm trong danh sách không gửi tin kiểu cũ.'),
  ('system', NULL, NULL, 'engine', 'friend_blocklist_invalid', 50, 'err_cfg_friend_blocklist_invalid', 'v504', 'Danh sách không gửi tin kiểu cũ không dùng được.');
UPDATE public.auto_engine_gates SET on_error = 'closed', retry_after_seconds = 60,
  description = 'V504: danh sách loại trừ gửi; chưa kiểm được (DB lỗi) thì chưa gửi, data về hàng đợi rồi thử lại (bộ cũ cũng không gửi khi chưa kiểm được).' WHERE code = 'send_exclusion';

CREATE FUNCTION public.aka_agent_engine_send_exclusion_v1(p_target_run_id bigint, p_lease_token uuid, p_operation text,
  p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '15s' AS $f$
DECLARE
  v_now timestamptz := clock_timestamp();
  r public.auto_engine_target_runs%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  v_input public.auto_campaign_input_data%ROWTYPE;
  v_selection jsonb;
  v_ids bigint[];
  v_contact_id bigint;
  v_fact jsonb;
  v_uid text;
  v_days integer;
  v_last_sent timestamptz;
  v_keys text[];
  v_tag_ids jsonb;
  v_err text;
  v_group_id bigint;
  -- Không dùng %ROWTYPE cho bảng danh bạ: fixture kiểm thử tối thiểu không có bảng này, chỉ production có.
  v_group_account bigint;
  v_group_type text;
  v_group_name text;
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('snapshot', 'facts', 'friend_blocklist') OR p_target_run_id IS NULL OR p_lease_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  -- Xác thực bằng lease engine (như take_content_index_v1): lượt data còn mở, lease còn hạn, đúng nhân viên với Desktop.
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id;
  IF NOT FOUND OR r.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_closed'); END IF;
  IF r.lease_token IS DISTINCT FROM p_lease_token OR NOT EXISTS (
       SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost');
  END IF;
  SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id AND NOT coalesce(is_delete, false);
  IF NOT FOUND OR NOT public.aka_agent_engine_scope_ok(c.staff_id) THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;

  IF p_operation = 'snapshot' THEN
    v_selection := c.extra_settings->'zaloSendExclusionsByAccountId'->(r.account_id::text);
    IF v_selection IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'config_invalid', 'message', 'Chưa cấu hình loại trừ cho tài khoản thực hiện.');
    END IF;
    BEGIN
      -- Như hàm cũ: chỉ kiểm cấu hình của tài khoản chạy (tài khoản khác kiểm khi lưu hoặc khi chạy lượt của nó).
      PERFORM public.aka_agent_internal_validate_send_exclusion_selection(jsonb_build_object(r.account_id::text, v_selection),
        c.staff_id, c.organization_id, r.account_id);
    EXCEPTION WHEN raise_exception THEN
      v_err := SQLERRM;
      RETURN jsonb_build_object('ok', false, 'reason', 'config_invalid', 'message', CASE v_err
        WHEN 'send_exclusion_account_configuration_missing' THEN 'Chưa cấu hình loại trừ cho tài khoản thực hiện.'
        WHEN 'send_exclusion_account_not_found' THEN 'Tài khoản trong cấu hình loại trừ không còn.'
        WHEN 'send_exclusion_group_not_found' THEN 'Nhóm điều kiện loại trừ đã bị xoá.'
        WHEN 'send_exclusion_blocklist_not_found' THEN 'Danh sách Zalo ID loại trừ đã bị xoá.'
        ELSE 'Cấu hình loại trừ không hợp lệ.' END, 'code', v_err);
    END;
    SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(coalesce(v_selection->'blocklistIds', '[]'::jsonb))) INTO v_ids;
    RETURN jsonb_build_object('ok', true, 'snapshot', jsonb_build_object(
      'catalog', public.aka_agent_internal_send_exclusion_catalog(),
      'group', public.aka_agent_internal_send_exclusion_group((v_selection->>'groupId')::bigint),
      'blocklistUids', coalesce((SELECT jsonb_agg(DISTINCT btrim(ac.uid)) FROM public.auto_account_contact_group_members m
        JOIN public.auto_account_contacts ac ON ac.id = m.contact_id
        WHERE m.group_id = ANY(v_ids) AND NOT m.is_delete AND NOT ac.is_delete
          AND ac.account_id = r.account_id AND ac.staff_id = c.staff_id AND ac.organization_id = c.organization_id
          AND ac.contact_type = 'person' AND nullif(btrim(ac.uid), '') IS NOT NULL), '[]'::jsonb)));
  END IF;

  IF p_operation = 'friend_blocklist' THEN
    -- Danh sách không gửi tin kiểu cũ (getZaloFriendBlocklistUidSnapshot của Desktop): nhóm danh bạ của tài khoản chạy.
    v_group_id := CASE WHEN (c.extra_settings->>'zaloFriendBlocklistId') ~ '^[0-9]{1,18}$' THEN (c.extra_settings->>'zaloFriendBlocklistId')::bigint END;
    IF coalesce(v_group_id, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'config_invalid', 'message', 'Chưa chọn danh sách không gửi tin Zalo');
    END IF;
    SELECT g.account_id, g.contact_type, g.name INTO v_group_account, v_group_type, v_group_name FROM public.auto_account_contact_groups g
     WHERE g.id = v_group_id AND g.staff_id = c.staff_id AND g.organization_id = c.organization_id
       AND g.purpose = 'zalo_friend_blocklist' AND NOT g.is_delete;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'config_invalid', 'message', 'Danh sách không gửi tin Zalo đã bị xoá');
    END IF;
    IF v_group_account IS DISTINCT FROM r.account_id OR v_group_type IS DISTINCT FROM 'person' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'config_invalid', 'message', 'Danh sách không gửi tin không thuộc tài khoản Zalo của chiến dịch.');
    END IF;
    RETURN jsonb_build_object('ok', true, 'blocklist', jsonb_build_object('groupId', v_group_id, 'groupName', coalesce(v_group_name, ''),
      'uids', coalesce((SELECT jsonb_agg(DISTINCT btrim(ac.uid)) FROM public.auto_account_contact_group_members m
        JOIN public.auto_account_contacts ac ON ac.id = m.contact_id
        WHERE m.group_id = v_group_id AND NOT m.is_delete AND NOT ac.is_delete AND ac.account_id = r.account_id
          AND ac.contact_type = 'person' AND ac.staff_id = c.staff_id AND nullif(btrim(ac.uid), '') IS NOT NULL), '[]'::jsonb)));
  END IF;

  -- 'facts': dữ kiện trong DB của người nhận đang chạy (data của lượt, không nhận id data từ ngoài).
  SELECT * INTO v_input FROM public.auto_campaign_input_data WHERE id = r.input_data_id AND campaign_id = r.campaign_id AND NOT coalesce(is_delete, false);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_closed'); END IF;
  v_uid := coalesce(nullif(btrim(p_payload->>'uid'), ''), nullif(btrim(v_input.uid), ''));
  IF coalesce(p_payload->>'tags', '') = 'true' THEN
    IF v_uid IS NULL THEN
      v_tag_ids := NULL;
    ELSE
      SELECT ac.id INTO v_contact_id FROM public.auto_account_contacts ac
       WHERE ac.account_id = r.account_id AND ac.staff_id = c.staff_id AND ac.organization_id = c.organization_id
         AND ac.contact_type = 'person' AND ac.uid = v_uid AND NOT ac.is_delete ORDER BY ac.id LIMIT 1;
      IF v_contact_id IS NOT NULL THEN
        v_fact := public.aka_agent_data_group_zalo_facts(v_contact_id);
        v_tag_ids := v_fact->'akabiz_tag_keys';
      ELSE
        SELECT coalesce(jsonb_agg(DISTINCT t.id::text), '[]'::jsonb) INTO v_tag_ids
          FROM public.chat_zalo_account_organization b
          JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id = b.chat_zalo_account_id AND ac.zalo_id = v_uid AND ac.conversation_type = 'user'
          JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id = b.id AND conv.chat_zalo_account_conversation_id = ac.id
            AND conv.organization_id = c.organization_id
          JOIN public.chat_zalo_conversation_system_tag link ON link.chat_zalo_conversation_id = conv.id AND link.organization_id = c.organization_id
          JOIN public.auto_contact_tags t ON t.id = link.auto_contact_tag_id AND t.staff_id = c.staff_id AND t.organization_id = c.organization_id
            AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id = r.account_id)
         WHERE b.auto_account_id = r.account_id AND b.organization_id = c.organization_id AND b.is_active;
      END IF;
    END IF;
  END IF;
  IF p_payload ? 'days' THEN
    -- Số ngày ngoài 1–3650 (hàm cũ ném lỗi, Desktop coi là chưa đủ dữ liệu): không có dữ kiện, lõi kết luận "chưa đủ dữ liệu".
    v_days := CASE WHEN (p_payload->>'days') ~ '^[0-9]{1,5}$' THEN (p_payload->>'days')::integer END;
    IF v_days IS NOT NULL AND v_days BETWEEN 1 AND 3650 THEN
      v_keys := public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person', coalesce(v_uid, v_input.uid), v_input.phone, v_input.email);
      IF cardinality(v_keys) > 0 THEN
        SELECT max(h.created_at) INTO v_last_sent
          FROM public.aka_agent_internal_send_delivery_history(r.account_id, ARRAY['zalo_message_friend', 'zalo_message_stranger'],
            ((timezone('Asia/Ho_Chi_Minh', v_now)::date - v_days)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'), v_now) h
         WHERE h.target_keys && v_keys;
      END IF;
    ELSE
      v_days := NULL;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'facts', jsonb_build_object(
    'akabiz_contact', CASE WHEN v_tag_ids IS NULL THEN NULL ELSE jsonb_build_object('ids', v_tag_ids,
      'availableValues', (SELECT coalesce(jsonb_agg(t.id::text), '[]'::jsonb) FROM public.auto_contact_tags t
        WHERE t.staff_id = c.staff_id AND t.organization_id = c.organization_id AND NOT t.is_delete
          AND (t.auto_account_id IS NULL OR t.auto_account_id = r.account_id))) END,
    'campaign_delivery', CASE WHEN v_days IS NULL OR coalesce(cardinality(v_keys), 0) = 0 THEN NULL ELSE jsonb_build_object('daysSince',
      CASE WHEN v_last_sent IS NULL THEN 3651
           ELSE timezone('Asia/Ho_Chi_Minh', v_now)::date - timezone('Asia/Ho_Chi_Minh', v_last_sent)::date END) END));
END $f$;

DO $grants$
BEGIN
  REVOKE ALL ON FUNCTION public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON FUNCTION public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb) FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON FUNCTION public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb) FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb) TO service_role'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb) TO aka_agent_chat_api'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb) TO aka_agent_desktop'; END IF;
END $grants$;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '521414d40664c567b8f89f4dee5add9c' THEN RAISE EXCEPTION 'V504 postflight: send_exclusion_v1 %', v_md5; END IF;
  IF (SELECT count(*) FROM public.auto_error WHERE error_code IN ('err_engine_send_excluded', 'err_engine_send_exclusion_unknown', 'err_cfg_send_exclusion_invalid', 'err_engine_friend_blocklisted', 'err_cfg_friend_blocklist_invalid') AND is_active) <> 5
     OR (SELECT count(*) FROM public.auto_outcome_policies WHERE error_code IN ('err_engine_send_excluded', 'err_engine_send_exclusion_unknown', 'err_cfg_send_exclusion_invalid', 'err_engine_friend_blocklisted', 'err_cfg_friend_blocklist_invalid') AND source = 'v504') <> 5
     OR (SELECT count(*) FROM public.auto_outcome_signal_rules WHERE source = 'v504') <> 5 THEN
    RAISE EXCEPTION 'V504 postflight: mã / chính sách / luật thiếu';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_gates WHERE code = 'send_exclusion' AND on_error = 'closed') THEN
    RAISE EXCEPTION 'V504 postflight: cổng send_exclusion';
  END IF;
  IF has_function_privilege('anon', 'public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V504 postflight: quyền hàm mới quá rộng';
  END IF;
END $post$;

COMMIT;

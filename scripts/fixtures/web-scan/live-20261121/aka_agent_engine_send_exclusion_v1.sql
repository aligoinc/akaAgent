CREATE OR REPLACE FUNCTION public.aka_agent_engine_send_exclusion_v1(p_target_run_id bigint, p_lease_token uuid, p_operation text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '15s'
AS $function$
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
END $function$

-- Gỡ V654 (p2 rồi p1) về đúng thân hàm production đọc 25/11/2026 (md5 prosrc kiểm ở cuối).
-- Mất dữ liệu: khối của Zalo khác trong nhóm nhiều Zalo bị xoá (nhóm còn lại khối của Zalo chính); khoá dataGroupIds /
-- sentCampaignIds trong cấu hình chiến dịch giữ nguyên nhưng không còn tác dụng; chiến dịch chọn nhóm/danh sách của Zalo khác
-- sẽ bị trigger cũ từ chối khi lưu lại và bộ chạy cũ báo cấu hình loại trừ lỗi. Chỉ mục zalo_users gỡ riêng:
-- DROP INDEX CONCURRENTLY public.idx_zalo_users_account_global_id;
BEGIN;
SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text);

CREATE OR REPLACE FUNCTION public.aka_agent_internal_send_exclusion_group(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT jsonb_build_object('id',g.id,'requestId',g.create_request_id,'accountId',g.account_id,'name',g.name,'matchMode',g.match_mode,'revision',g.revision,
 'rules',COALESCE((SELECT jsonb_agg(jsonb_build_object('fieldId',r.field_id,'operatorId',r.operator_id,'value',r.value,'isEnabled',r.is_enabled,'sortOrder',r.sort_order) ORDER BY r.sort_order,r.id) FROM public.auto_campaign_send_exclusion_rules r WHERE r.group_id=g.id),'[]'))
 FROM public.auto_campaign_send_exclusion_groups g WHERE g.id=p_id AND NOT g.is_delete;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_validate_send_exclusion_selection(p_map jsonb, p_staff bigint, p_org bigint, p_account bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE entry record; aid bigint; gid bigint; ids bigint[]; group_data jsonb;
BEGIN
 IF p_map IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(p_map)<>'object' OR NOT p_map ? p_account::text THEN RAISE EXCEPTION 'send_exclusion_account_configuration_missing'; END IF;
 FOR entry IN SELECT * FROM jsonb_each(p_map) LOOP
  IF jsonb_typeof(entry.value) IS DISTINCT FROM 'object' OR NOT entry.value ? 'groupId'
    OR (entry.value->'groupId'<>'null' AND jsonb_typeof(entry.value->'groupId')<>'number') THEN RAISE EXCEPTION 'send_exclusion_group_reference_invalid'; END IF;
  aid:=entry.key::bigint;
  IF NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=aid AND staff_id=p_staff AND organization_id=p_org AND flatform_type='zalo' AND NOT is_delete) THEN RAISE EXCEPTION 'send_exclusion_account_not_found'; END IF;
  gid:=(entry.value->>'groupId')::bigint;
  IF gid IS NOT NULL THEN
   SELECT public.aka_agent_internal_send_exclusion_group(g.id) INTO group_data FROM public.auto_campaign_send_exclusion_groups g
    WHERE g.id=gid AND g.staff_id=p_staff AND g.organization_id=p_org AND g.account_id=aid AND NOT g.is_delete;
   IF group_data IS NULL THEN RAISE EXCEPTION 'send_exclusion_group_not_found'; END IF;
   PERFORM public.aka_agent_internal_validate_send_exclusion_rules(group_data->'rules',p_staff,p_org,aid);
  END IF;
  IF jsonb_typeof(entry.value->'blocklistIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'send_exclusion_blocklists_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->'blocklistIds') v WHERE jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<=0 OR trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric) THEN RAISE EXCEPTION 'send_exclusion_blocklists_invalid'; END IF;
  SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(entry.value->'blocklistIds')) INTO ids;
  IF cardinality(ids)<>(SELECT count(*) FROM public.auto_account_contact_groups g WHERE g.id=ANY(ids) AND g.account_id=aid AND g.staff_id=p_staff AND g.organization_id=p_org AND NOT g.is_delete AND g.purpose='zalo_friend_blocklist' AND g.contact_type='person') THEN RAISE EXCEPTION 'send_exclusion_blocklist_not_found'; END IF;
 END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_validate_campaign_send_exclusion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND NEW.extra_settings->'zaloSendExclusionsByAccountId' IS NOT DISTINCT FROM OLD.extra_settings->'zaloSendExclusionsByAccountId'
 AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
 PERFORM public.aka_agent_internal_validate_send_exclusion_selection(NEW.extra_settings->'zaloSendExclusionsByAccountId',NEW.staff_id,NEW.organization_id,NEW.account_id);
 RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_campaign_send_exclusion_runtime(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_claim_token uuid, p_operation text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE c public.auto_campaigns%ROWTYPE; selection jsonb; g jsonb; ids bigint[]; input public.auto_campaign_input_data%ROWTYPE;
 contact_id bigint; fact jsonb; v_uid text; days integer; last_sent timestamptz; current_time_value timestamptz:=clock_timestamp(); keys text[]; tag_ids jsonb; changed integer;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

 SELECT campaign.* INTO c FROM public.auto_campaigns campaign JOIN public.auto_accounts a ON a.id=campaign.account_id
  JOIN public.org_staff s ON s.id=campaign.staff_id AND s.organization_id=campaign.organization_id AND s.is_active
  WHERE campaign.id=p_campaign_id AND campaign.account_id=p_account_id AND campaign.staff_id=p_staff_id AND NOT campaign.is_delete
   AND a.staff_id=p_staff_id AND a.organization_id=campaign.organization_id AND NOT a.is_delete
   AND campaign.runtime_claim_token=p_claim_token AND p_claim_token IS NOT NULL
  FOR UPDATE OF campaign;
 IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_runtime_claim_lost'; END IF;
 IF p_operation='snapshot' THEN
  selection:=c.extra_settings->'zaloSendExclusionsByAccountId'->p_account_id::text;
  IF selection IS NULL THEN RAISE EXCEPTION 'send_exclusion_account_configuration_missing'; END IF;
  -- Other accounts are validated when saving configuration or starting their own run.
  PERFORM public.aka_agent_internal_validate_send_exclusion_selection(jsonb_build_object(p_account_id::text,selection),c.staff_id,c.organization_id,p_account_id);
  SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(COALESCE(selection->'blocklistIds','[]'))) INTO ids;
  RETURN jsonb_build_object('catalog',public.aka_agent_internal_send_exclusion_catalog(),'group',public.aka_agent_internal_send_exclusion_group((selection->>'groupId')::bigint),
   'blocklistUids',COALESCE((SELECT jsonb_agg(DISTINCT btrim(ac.uid)) FROM public.auto_account_contact_group_members m
    JOIN public.auto_account_contacts ac ON ac.id=m.contact_id WHERE m.group_id=ANY(ids) AND NOT m.is_delete AND NOT ac.is_delete
    AND ac.account_id=p_account_id AND ac.staff_id=p_staff_id AND ac.organization_id=c.organization_id AND ac.contact_type='person' AND NULLIF(btrim(ac.uid),'') IS NOT NULL),'[]'));
 END IF;
 SELECT * INTO input FROM public.auto_campaign_input_data WHERE id=(p_payload->>'inputId')::bigint AND campaign_id=p_campaign_id AND NOT is_delete;
 IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_input_not_found'; END IF;
 IF p_operation='pause' THEN
  UPDATE public.auto_campaign_input_data SET status='tạm dừng',note=left(p_payload->>'note',2000)
   WHERE id=input.id AND campaign_id=c.id AND status=p_payload->>'expectedStatus' AND status IN ('chờ xử lý','đang chạy') AND NOT is_delete;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('changed',changed=1);
 ELSIF p_operation<>'facts' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;
 v_uid:=COALESCE(NULLIF(btrim(p_payload->>'uid'),''),NULLIF(btrim(input.uid),''));
 IF COALESCE((p_payload->>'tags')::boolean,false) THEN
  IF v_uid IS NULL THEN tag_ids:=NULL; ELSE
   SELECT ac.id INTO contact_id FROM public.auto_account_contacts ac WHERE ac.account_id=c.account_id AND ac.staff_id=c.staff_id AND ac.organization_id=c.organization_id AND ac.contact_type='person' AND ac.uid=v_uid AND NOT ac.is_delete ORDER BY ac.id LIMIT 1;
   IF contact_id IS NOT NULL THEN
    fact:=public.aka_agent_data_group_zalo_facts(contact_id); tag_ids:=fact->'akabiz_tag_keys';
   ELSE
    SELECT COALESCE(jsonb_agg(DISTINCT t.id::text),'[]') INTO tag_ids
     FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id AND ac.zalo_id=v_uid AND ac.conversation_type='user'
     JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=c.organization_id
     JOIN public.chat_zalo_conversation_system_tag link ON link.chat_zalo_conversation_id=conv.id AND link.organization_id=c.organization_id
     JOIN public.auto_contact_tags t ON t.id=link.auto_contact_tag_id AND t.staff_id=c.staff_id AND t.organization_id=c.organization_id AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id)
     WHERE b.auto_account_id=c.account_id AND b.organization_id=c.organization_id AND b.is_active;
   END IF;
  END IF;
 END IF;
 IF p_payload ? 'days' THEN
  days:=(p_payload->>'days')::integer;
  IF days<1 OR days>3650 THEN RAISE EXCEPTION 'send_exclusion_days_invalid'; END IF;
  keys:=public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',COALESCE(v_uid,input.uid),input.phone,input.email);
  IF cardinality(keys)>0 THEN
   SELECT max(h.created_at) INTO last_sent FROM public.aka_agent_internal_send_delivery_history(c.account_id,ARRAY['zalo_message_friend','zalo_message_stranger'],((timezone('Asia/Ho_Chi_Minh',current_time_value)::date-days)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'),current_time_value) h WHERE h.target_keys && keys;
  END IF;
 END IF;
 RETURN jsonb_build_object('akabiz_contact',CASE WHEN tag_ids IS NULL THEN NULL ELSE jsonb_build_object('ids',tag_ids,'availableValues',(SELECT COALESCE(jsonb_agg(t.id::text),'[]') FROM public.auto_contact_tags t WHERE t.staff_id=c.staff_id AND t.organization_id=c.organization_id AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id))) END,
  'campaign_delivery',CASE WHEN days IS NULL OR cardinality(keys)=0 THEN NULL ELSE jsonb_build_object('daysSince',CASE WHEN last_sent IS NULL THEN 3651 ELSE timezone('Asia/Ho_Chi_Minh',current_time_value)::date-timezone('Asia/Ho_Chi_Minh',last_sent)::date END) END);
END;
$function$;

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
END $function$;

CREATE OR REPLACE FUNCTION public.aka_agent_send_exclusion_groups(p_staff_id bigint, p_organization_id bigint, p_account_id bigint, p_operation text, p_payload jsonb, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE gid bigint; revision bigint; r jsonb; prior jsonb; request_id uuid;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, NULL); -- Bind Desktop token before privileged work.

 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id AND organization_id=p_organization_id AND flatform_type='zalo' AND NOT is_delete) THEN RAISE EXCEPTION 'send_exclusion_account_not_found'; END IF;
 IF p_operation='list' THEN
  RETURN jsonb_build_object('catalog',public.aka_agent_internal_send_exclusion_catalog(),
   'options',public.aka_agent_internal_send_exclusion_options(p_staff_id,p_organization_id,p_account_id),
   'groups',COALESCE((SELECT jsonb_agg(public.aka_agent_internal_send_exclusion_group(id) ORDER BY name,id) FROM public.auto_campaign_send_exclusion_groups WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND account_id=p_account_id AND NOT is_delete),'[]'),
   'blocklists',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'count',(SELECT count(*) FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id=m.contact_id WHERE m.group_id=g.id AND NOT m.is_delete AND NOT c.is_delete AND c.account_id=p_account_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id)) ORDER BY g.name,g.id)
   FROM public.auto_account_contact_groups g WHERE g.account_id=p_account_id AND g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND NOT g.is_delete AND g.purpose='zalo_friend_blocklist'),'[]'));
 ELSIF p_operation<>'save' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;
 PERFORM public.aka_agent_internal_validate_send_exclusion_rules(p_payload->'rules',p_staff_id,p_organization_id,p_account_id);
 gid:=(p_payload->>'id')::bigint;
 IF gid IS NULL THEN
  request_id:=(p_payload->>'requestId')::uuid;
  IF request_id IS NULL THEN RAISE EXCEPTION 'send_exclusion_request_id_required'; END IF;
  INSERT INTO public.auto_campaign_send_exclusion_groups(staff_id,organization_id,account_id,name,match_mode,create_request_id)
   VALUES(p_staff_id,p_organization_id,p_account_id,btrim(p_payload->>'name'),p_payload->>'matchMode',request_id)
   ON CONFLICT(staff_id,organization_id,account_id,create_request_id) DO NOTHING RETURNING id INTO gid;
  IF gid IS NULL THEN
   SELECT public.aka_agent_internal_send_exclusion_group(id) INTO prior FROM public.auto_campaign_send_exclusion_groups
    WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND account_id=p_account_id AND create_request_id=request_id AND NOT is_delete;
   IF prior IS NULL OR prior->>'name' IS DISTINCT FROM btrim(p_payload->>'name') OR prior->>'matchMode' IS DISTINCT FROM p_payload->>'matchMode'
    OR (SELECT jsonb_agg(v ORDER BY v->>'fieldId') FROM jsonb_array_elements(prior->'rules') v) IS DISTINCT FROM (SELECT jsonb_agg(v ORDER BY v->>'fieldId') FROM jsonb_array_elements(p_payload->'rules') v)
   THEN RAISE EXCEPTION 'send_exclusion_revision_conflict'; END IF;
   RETURN prior;
  END IF;
 ELSE
  UPDATE public.auto_campaign_send_exclusion_groups g SET name=btrim(p_payload->>'name'),match_mode=p_payload->>'matchMode',revision=g.revision+1,updated_at=now()
   WHERE g.id=gid AND g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND g.account_id=p_account_id AND NOT g.is_delete AND g.revision=(p_payload->>'revision')::bigint RETURNING g.revision INTO revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_revision_conflict'; END IF;
  DELETE FROM public.auto_campaign_send_exclusion_rules WHERE group_id=gid;
 END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_payload->'rules') LOOP
  INSERT INTO public.auto_campaign_send_exclusion_rules(group_id,field_id,operator_id,value,is_enabled,sort_order)
  VALUES(gid,(r->>'fieldId')::bigint,(r->>'operatorId')::bigint,COALESCE(r->'value','null'),COALESCE((r->>'isEnabled')::boolean,false),COALESCE((r->>'sortOrder')::integer,0));
 END LOOP;
 RETURN public.aka_agent_internal_send_exclusion_group(gid);
END;
$function$;

DROP FUNCTION IF EXISTS private.aka_agent_send_exclusion_remote(public.auto_campaigns,bigint,bigint,jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_send_exclusion_block_facts(public.auto_campaigns,bigint,text,text,jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_send_exclusion_snapshot(public.auto_campaigns,bigint,boolean);
DROP FUNCTION IF EXISTS private.aka_agent_send_exclusion_needs_v2(jsonb,bigint);
DROP FUNCTION IF EXISTS private.aka_agent_send_exclusion_ids(jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_send_exclusion_group_v2(bigint);

-- p1: chỉ giữ khối của Zalo chính rồi bỏ bảng khối.
DELETE FROM public.auto_campaign_send_exclusion_rules r USING public.auto_campaign_send_exclusion_group_accounts ga, public.auto_campaign_send_exclusion_groups g
 WHERE ga.id=r.group_account_id AND g.id=ga.group_id AND ga.account_id IS DISTINCT FROM g.account_id;
UPDATE public.auto_campaign_send_exclusion_groups g SET match_mode=ga.match_mode
 FROM public.auto_campaign_send_exclusion_group_accounts ga WHERE ga.group_id=g.id AND ga.account_id=g.account_id AND g.match_mode IS DISTINCT FROM ga.match_mode;
DROP TRIGGER IF EXISTS auto_fill_send_exclusion_rule_block ON public.auto_campaign_send_exclusion_rules;
DROP FUNCTION IF EXISTS public.auto_fill_send_exclusion_rule_block();
DROP INDEX IF EXISTS public.auto_send_exclusion_rules_group;
ALTER TABLE public.auto_campaign_send_exclusion_rules
  DROP CONSTRAINT IF EXISTS auto_send_exclusion_rules_block_field_key,
  DROP CONSTRAINT IF EXISTS auto_send_exclusion_rules_block_fkey,
  ADD CONSTRAINT auto_campaign_send_exclusion_rules_group_id_field_id_key UNIQUE (group_id, field_id);
ALTER TABLE public.auto_campaign_send_exclusion_rules DROP COLUMN group_account_id;
ALTER TABLE public.auto_campaign_send_exclusion_groups DROP COLUMN version;
DROP TABLE public.auto_campaign_send_exclusion_group_accounts;
DELETE FROM public.auto_system_settings WHERE key='campaign.send_exclusion_multi_zalo';

DO $post$
DECLARE v_expected jsonb := '{
  "public.aka_agent_internal_send_exclusion_group(bigint)": "c73d260df8ba115c2ec059b7c3c138d8",
  "public.aka_agent_internal_validate_send_exclusion_selection(jsonb,bigint,bigint,bigint)": "af9913da69c3a16e921369744524f8cd",
  "public.auto_validate_campaign_send_exclusion()": "31518a224d65996ee64ccafa2bd4b008",
  "public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)": "0aaf3c6bc86bcdec10c94ed9ce21426a",
  "public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)": "521414d40664c567b8f89f4dee5add9c",
  "public.aka_agent_send_exclusion_groups(bigint,bigint,bigint,text,jsonb,text,text)": "43c3bb89ce08fcb59ab2e0b9fda68ee5"
}'::jsonb; v_key text; v_md5 text;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key);
    IF v_md5 IS DISTINCT FROM v_expected->>v_key THEN
      RAISE EXCEPTION 'V654 rollback postflight: thân % là %, cần %', v_key, v_md5, v_expected->>v_key;
    END IF;
  END LOOP;
END $post$;
COMMIT;

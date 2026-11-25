-- Gỡ V657 phần 2: trả 7 hàm về đúng thân production 25/11 (kiểm md5), xoá 4 hàm private mới.
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION private.aka_agent_send_exclusion_snapshot(p_campaign public.auto_campaigns, p_account bigint, p_v2 boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_selection jsonb; v_ids bigint[]; v_gid bigint; v_group public.auto_campaign_send_exclusion_groups%ROWTYPE; v_own bigint;
 v_other jsonb; v_blocklists jsonb; v_data_groups jsonb; v_campaigns jsonb; v_remote jsonb;
BEGIN
 v_selection:=p_campaign.extra_settings->'zaloSendExclusionsByAccountId'->p_account::text;
 IF v_selection IS NULL THEN RAISE EXCEPTION 'send_exclusion_account_configuration_missing'; END IF;
 -- Other accounts are validated when saving configuration or starting their own run.
 PERFORM public.aka_agent_internal_validate_send_exclusion_selection(jsonb_build_object(p_account::text,v_selection),p_campaign.staff_id,p_campaign.organization_id,p_account);
 SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(COALESCE(v_selection->'blocklistIds','[]'))) INTO v_ids;
 IF NOT p_v2 THEN
  IF private.aka_agent_send_exclusion_needs_v2(v_selection,p_account) THEN RAISE EXCEPTION 'send_exclusion_client_outdated'; END IF;
  RETURN jsonb_build_object('catalog',public.aka_agent_internal_send_exclusion_catalog(),'group',public.aka_agent_internal_send_exclusion_group((v_selection->>'groupId')::bigint),
   'blocklistUids',COALESCE((SELECT jsonb_agg(DISTINCT btrim(ac.uid)) FROM public.auto_account_contact_group_members m
    JOIN public.auto_account_contacts ac ON ac.id=m.contact_id WHERE m.group_id=ANY(v_ids) AND NOT m.is_delete AND NOT ac.is_delete
    AND ac.account_id=p_account AND ac.staff_id=p_campaign.staff_id AND ac.organization_id=p_campaign.organization_id AND ac.contact_type='person' AND NULLIF(btrim(ac.uid),'') IS NOT NULL),'[]'));
 END IF;
 v_gid:=(v_selection->>'groupId')::bigint;
 IF v_gid IS NOT NULL THEN
  SELECT * INTO v_group FROM public.auto_campaign_send_exclusion_groups WHERE id=v_gid AND NOT is_delete;
  SELECT ga.id INTO v_own FROM public.auto_campaign_send_exclusion_group_accounts ga WHERE ga.group_id=v_gid AND ga.account_id=p_account;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('accountId',ga.account_id,'accountName',a.name,'matchMode',ga.match_mode,
    'rules',(SELECT jsonb_agg(jsonb_build_object('fieldId',r.field_id,'operatorId',r.operator_id,'value',r.value,'isEnabled',r.is_enabled,'sortOrder',r.sort_order) ORDER BY r.sort_order,r.id)
      FROM public.auto_campaign_send_exclusion_rules r WHERE r.group_account_id=ga.id)) ORDER BY ga.sort_order,ga.id),'[]') INTO v_other
   FROM public.auto_campaign_send_exclusion_group_accounts ga
   JOIN public.auto_accounts a ON a.id=ga.account_id AND a.staff_id=p_campaign.staff_id AND a.organization_id=p_campaign.organization_id AND a.flatform_type='zalo' AND NOT a.is_delete
   WHERE ga.group_id=v_gid AND ga.account_id<>p_account
     AND EXISTS(SELECT 1 FROM public.auto_campaign_send_exclusion_rules r WHERE r.group_account_id=ga.id AND r.is_enabled);
 END IF;
 SELECT COALESCE(jsonb_agg(g.id ORDER BY g.id),'[]') INTO v_blocklists FROM public.auto_account_contact_groups g
  WHERE g.id=ANY(v_ids) AND g.account_id IS DISTINCT FROM p_account AND NOT g.is_delete;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) ORDER BY g.id),'[]') INTO v_data_groups FROM public.auto_account_contact_groups g
  WHERE g.id=ANY(private.aka_agent_send_exclusion_ids(v_selection->'dataGroupIds')) AND g.purpose='data_group' AND NOT g.is_delete AND g.organization_id=p_campaign.organization_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.id),'[]') INTO v_campaigns FROM public.auto_campaigns c
  WHERE c.id=ANY(private.aka_agent_send_exclusion_ids(v_selection->'sentCampaignIds')) AND c.staff_id=p_campaign.staff_id AND c.organization_id=p_campaign.organization_id;
 IF jsonb_array_length(COALESCE(v_other,'[]'))>0 OR jsonb_array_length(v_blocklists)>0 OR jsonb_array_length(v_data_groups)>0 OR jsonb_array_length(v_campaigns)>0 THEN
  v_remote:=jsonb_build_object('groupName',v_group.name,'blocks',COALESCE(v_other,'[]'),'blocklistIds',v_blocklists,'dataGroups',v_data_groups,'campaigns',v_campaigns);
 END IF;
 RETURN jsonb_build_object('version',2,'catalog',public.aka_agent_internal_send_exclusion_catalog(),
  'group',CASE WHEN v_own IS NULL THEN NULL ELSE jsonb_build_object('id',v_group.id,'requestId',v_group.create_request_id,'accountId',p_account,'name',v_group.name,
    'matchMode',(SELECT ga.match_mode FROM public.auto_campaign_send_exclusion_group_accounts ga WHERE ga.id=v_own),'revision',v_group.revision,
    'rules',COALESCE((SELECT jsonb_agg(jsonb_build_object('fieldId',r.field_id,'operatorId',r.operator_id,'value',r.value,'isEnabled',r.is_enabled,'sortOrder',r.sort_order) ORDER BY r.sort_order,r.id)
      FROM public.auto_campaign_send_exclusion_rules r WHERE r.group_account_id=v_own),'[]')) END,
  'blocklistUids',COALESCE((SELECT jsonb_agg(DISTINCT btrim(ac.uid)) FROM public.auto_account_contact_group_members m
    JOIN public.auto_account_contacts ac ON ac.id=m.contact_id WHERE m.group_id=ANY(v_ids) AND NOT m.is_delete AND NOT ac.is_delete
    AND ac.account_id=p_account AND ac.staff_id=p_campaign.staff_id AND ac.organization_id=p_campaign.organization_id AND ac.contact_type='person' AND NULLIF(btrim(ac.uid),'') IS NOT NULL),'[]'),
  'remote',v_remote);
END;
$function$;

CREATE OR REPLACE FUNCTION private.aka_agent_send_exclusion_block_facts(p_campaign public.auto_campaigns, p_block_account bigint, p_global_id text, p_phone text, p_rules jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_sources text[]; v_uid text; v_is_fr integer; v_now timestamptz:=clock_timestamp(); v_facts jsonb:='{}'; v_account public.auto_accounts%ROWTYPE;
 v_contact_id bigint; v_tag_ids jsonb; v_days integer; v_keys text[]; v_last timestamptz; v_status text; v_account_zalo_uid text; v_available jsonb; v_ids jsonb;
BEGIN
 SELECT * INTO v_account FROM public.auto_accounts WHERE id=p_block_account;
 SELECT ARRAY(SELECT DISTINCT f.source_key FROM jsonb_array_elements(p_rules) r JOIN public.auto_filter_fields f ON f.id=(r->>'fieldId')::bigint
   WHERE r->>'isEnabled'='true' ORDER BY 1) INTO v_sources;
 IF cardinality(v_sources)=0 THEN RETURN jsonb_build_object('accountId',p_block_account,'state','empty'); END IF;
 IF p_global_id IS NOT NULL THEN
  SELECT zu.zalo_uid, zu.is_fr INTO v_uid, v_is_fr FROM public.zalo_users zu
   WHERE zu.account_id=p_block_account AND zu.global_id=p_global_id AND zu.global_id<>'' ORDER BY zu.id LIMIT 1;
 END IF;
 IF v_sources && ARRAY['zalo_friendship','zalo_labels','akabiz_contact','zalo_profile'] THEN
  IF p_global_id IS NULL THEN RETURN jsonb_build_object('accountId',p_block_account,'state','unknown'); END IF;
  -- Zalo chưa đồng bộ bạn bè/khách lần nào: bỏ qua khối (không đủ dữ liệu để xét).
  IF NOT EXISTS(SELECT 1 FROM public.zalo_users zu WHERE zu.account_id=p_block_account)
     AND NOT EXISTS(SELECT 1 FROM public.auto_account_contacts ac WHERE ac.account_id=p_block_account AND ac.contact_type='person')
     AND NOT EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b WHERE b.auto_account_id=p_block_account AND b.organization_id=p_campaign.organization_id AND b.is_active) THEN
   RETURN jsonb_build_object('accountId',p_block_account,'state','not_synced');
  END IF;
 END IF;
 IF 'zalo_friendship'=ANY(v_sources) THEN
  v_status:='stranger';
  IF v_uid IS NOT NULL THEN
   IF v_is_fr=1 OR EXISTS(SELECT 1 FROM public.auto_account_contacts ac WHERE ac.account_id=p_block_account AND ac.contact_type='person' AND ac.uid=v_uid AND NOT ac.is_delete AND ac.is_friend) THEN
    v_status:='friend';
   ELSE
    SELECT za.zalo_uid INTO v_account_zalo_uid FROM public.zalo_accounts za WHERE za.id=v_account.zalo_account_id;
    IF v_account_zalo_uid IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e
      WHERE e.organization_id=p_campaign.organization_id AND e.staff_id=p_campaign.staff_id AND e.account_id=p_block_account AND e.account_zalo_uid=v_account_zalo_uid
        AND e.target_zalo_uid=v_uid AND e.sent_at>v_now-interval '60 days' AND e.action_type='friend_request' AND e.friended_at IS NULL AND e.rejected_at IS NULL) THEN
     v_status:='request_sent';
    END IF;
   END IF;
  END IF;
  v_facts:=v_facts||jsonb_build_object('zalo_friendship',jsonb_build_object('status',v_status));
 END IF;
 IF 'zalo_labels'=ANY(v_sources) THEN
  SELECT COALESCE(jsonb_agg(DISTINCT x.id),'[]'), COALESCE(jsonb_agg(DISTINCT x.id) FILTER (WHERE x.has),'[]') INTO v_available, v_ids FROM (
    SELECT ac.uid AS id, (v_uid IS NOT NULL AND COALESCE(ac.extra_data->'conversations','[]') ? v_uid) AS has FROM public.auto_account_contacts ac
     WHERE ac.account_id=p_block_account AND ac.contact_type='zalo_tag' AND NOT ac.is_delete AND ac.staff_id=p_campaign.staff_id AND ac.organization_id=p_campaign.organization_id
       AND NULLIF(btrim(ac.uid),'') IS NOT NULL
    UNION ALL
    SELECT t.zalo_id, (v_uid IS NOT NULL AND EXISTS(SELECT 1 FROM public.chat_zalo_account_conversation cv JOIN public.chat_zalo_account_conversation_tag ct ON ct.chat_zalo_account_conversation_id=cv.id
       WHERE cv.chat_zalo_account_id=t.chat_zalo_account_id AND cv.conversation_type='user' AND cv.zalo_id=v_uid AND ct.chat_zalo_account_tag_id=t.id))
     FROM public.chat_zalo_account_tag t JOIN public.chat_zalo_account_organization b ON b.chat_zalo_account_id=t.chat_zalo_account_id
     WHERE b.auto_account_id=p_block_account AND b.organization_id=p_campaign.organization_id AND b.is_active AND NULLIF(btrim(t.zalo_id),'') IS NOT NULL) x;
  v_facts:=v_facts||jsonb_build_object('zalo_labels',jsonb_build_object('ids',v_ids,'availableValues',v_available));
 END IF;
 IF 'akabiz_contact'=ANY(v_sources) THEN
  v_tag_ids:='[]';
  IF v_uid IS NOT NULL THEN
   SELECT ac.id INTO v_contact_id FROM public.auto_account_contacts ac WHERE ac.account_id=p_block_account AND ac.staff_id=p_campaign.staff_id AND ac.organization_id=p_campaign.organization_id
    AND ac.contact_type='person' AND ac.uid=v_uid AND NOT ac.is_delete ORDER BY ac.id LIMIT 1;
   IF v_contact_id IS NOT NULL THEN
    v_tag_ids:=COALESCE(public.aka_agent_data_group_zalo_facts(v_contact_id)->'akabiz_tag_keys','[]');
   ELSE
    SELECT COALESCE(jsonb_agg(DISTINCT t.id::text),'[]') INTO v_tag_ids
     FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id AND ac.zalo_id=v_uid AND ac.conversation_type='user'
     JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=p_campaign.organization_id
     JOIN public.chat_zalo_conversation_system_tag link ON link.chat_zalo_conversation_id=conv.id AND link.organization_id=p_campaign.organization_id
     JOIN public.auto_contact_tags t ON t.id=link.auto_contact_tag_id AND t.staff_id=p_campaign.staff_id AND t.organization_id=p_campaign.organization_id AND NOT t.is_delete
      AND (t.auto_account_id IS NULL OR t.auto_account_id=p_block_account)
     WHERE b.auto_account_id=p_block_account AND b.organization_id=p_campaign.organization_id AND b.is_active;
   END IF;
  END IF;
  v_facts:=v_facts||jsonb_build_object('akabiz_contact',jsonb_build_object('ids',v_tag_ids,'availableValues',(SELECT COALESCE(jsonb_agg(t.id::text),'[]') FROM public.auto_contact_tags t
   WHERE t.staff_id=p_campaign.staff_id AND t.organization_id=p_campaign.organization_id AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=p_block_account))));
 END IF;
 IF 'campaign_delivery'=ANY(v_sources) THEN
  SELECT max(CASE WHEN jsonb_typeof(r->'value')='number' THEN (r->>'value')::numeric WHEN jsonb_typeof(r->'value')='array' AND jsonb_typeof(r->'value'->0)='number' THEN (r->'value'->>0)::numeric END)::integer
   INTO v_days FROM jsonb_array_elements(p_rules) r JOIN public.auto_filter_fields f ON f.id=(r->>'fieldId')::bigint WHERE r->>'isEnabled'='true' AND f.source_key='campaign_delivery';
  IF v_days BETWEEN 1 AND 3650 THEN
   v_keys:=public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',v_uid,p_phone,NULL);
   IF cardinality(v_keys)>0 THEN
    SELECT max(h.created_at) INTO v_last FROM public.aka_agent_internal_send_delivery_history(p_block_account,ARRAY['zalo_message_friend','zalo_message_stranger'],
     ((timezone('Asia/Ho_Chi_Minh',v_now)::date-v_days)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'),v_now) h WHERE h.target_keys && v_keys;
    v_facts:=v_facts||jsonb_build_object('campaign_delivery',jsonb_build_object('daysSince',CASE WHEN v_last IS NULL THEN 3651
     ELSE timezone('Asia/Ho_Chi_Minh',v_now)::date-timezone('Asia/Ho_Chi_Minh',v_last)::date END));
   ELSE
    v_facts:=v_facts||jsonb_build_object('campaign_delivery',NULL);
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('accountId',p_block_account,'state','ok','facts',v_facts);
END;
$function$;

CREATE OR REPLACE FUNCTION private.aka_agent_send_exclusion_remote(p_campaign public.auto_campaigns, p_account bigint, p_input_id bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_input public.auto_campaign_input_data%ROWTYPE; v_selection jsonb; v_uid text; v_gid text; v_phone_raw text; v_phone text;
 v_match jsonb; v_blocks jsonb:='[]'; v_ids bigint[]; v_dg_phone bigint[]; v_dg_uid bigint[]; v_accounts bigint[]; v_gid_group bigint; sc record; v_sc_uid text;
 v_at timestamptz; block record;
BEGIN
 SELECT * INTO v_input FROM public.auto_campaign_input_data WHERE id=p_input_id AND campaign_id=p_campaign.id AND NOT COALESCE(is_delete,false);
 IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_input_not_found'; END IF;
 v_selection:=p_campaign.extra_settings->'zaloSendExclusionsByAccountId'->p_account::text;
 IF v_selection IS NULL THEN RAISE EXCEPTION 'send_exclusion_account_configuration_missing'; END IF;
 v_uid:=COALESCE(NULLIF(btrim(p_payload->>'uid'),''),NULLIF(btrim(v_input.uid),''));
 v_gid:=NULLIF(btrim(p_payload->>'globalId'),'');
 IF v_gid IS NULL AND v_uid IS NOT NULL THEN
  SELECT NULLIF(btrim(zu.global_id),'') INTO v_gid FROM public.zalo_users zu WHERE zu.account_id=p_account AND zu.zalo_uid=v_uid;
 END IF;
 v_phone_raw:=COALESCE(NULLIF(btrim(p_payload->>'phone'),''),NULLIF(btrim(v_input.phone),''));
 v_phone:=NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(v_phone_raw,'')),'');

 -- 1. Danh sách bạn bè/Zalo ID của Zalo khác (cùng Zalo đang gửi đã so trong 'snapshot'): theo Zalo ID chung.
 v_ids:=private.aka_agent_send_exclusion_ids(v_selection->'blocklistIds');
 IF v_gid IS NOT NULL AND cardinality(v_ids)>0 THEN
  SELECT jsonb_build_object('kind','blocklist','id',bl.id,'name',bl.name,'note',format('Thuộc danh sách Zalo ID loại trừ “%s”.',bl.name)) INTO v_match
   FROM public.auto_account_contact_groups bl
   CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE zu.account_id=bl.account_id AND zu.global_id=v_gid ORDER BY zu.id LIMIT 1 OFFSET 0) zu
   JOIN public.auto_account_contacts ac ON ac.account_id=bl.account_id AND ac.contact_type='person' AND ac.uid=zu.zalo_uid AND NOT ac.is_delete
   JOIN public.auto_account_contact_group_members m ON m.group_id=bl.id AND m.contact_id=ac.id AND NOT m.is_delete
   WHERE bl.id=ANY(v_ids) AND bl.account_id IS DISTINCT FROM p_account AND NOT bl.is_delete AND bl.purpose='zalo_friend_blocklist'
     AND bl.staff_id=p_campaign.staff_id AND bl.organization_id=p_campaign.organization_id
   ORDER BY bl.name, bl.id LIMIT 1;
 END IF;

 -- 2. Nhóm data: SĐT (liên hệ loại phone, uid = SĐT chuẩn hoá như hàm nạp) và Zalo UID (theo Zalo ID chung, hoặc Zalo ID
 -- riêng ở Zalo đang gửi). Tra theo chỉ mục uq_auto_account_contacts_account_type_uid như V519.
 IF v_match IS NULL THEN
  SELECT COALESCE(array_agg(g.id) FILTER (WHERE ci.code='phone'),'{}'), COALESCE(array_agg(g.id) FILTER (WHERE ci.code='zalo_person'),'{}')
   INTO v_dg_phone, v_dg_uid
   FROM public.auto_account_contact_groups g JOIN public.category_item ci ON ci.id=g.data_type_category_item_id
   WHERE g.id=ANY(private.aka_agent_send_exclusion_ids(v_selection->'dataGroupIds')) AND g.purpose='data_group' AND NOT g.is_delete
     AND g.organization_id=p_campaign.organization_id AND ci.code IN ('phone','zalo_person');
  IF cardinality(v_dg_phone)+cardinality(v_dg_uid)>0 THEN
   SELECT COALESCE(array_agg(DISTINCT x),'{}') INTO v_accounts FROM (
    SELECT a.id x FROM public.auto_accounts a JOIN public.auto_account_contact_groups g ON g.staff_id=a.staff_id AND g.organization_id=a.organization_id
     WHERE g.id=ANY(v_dg_phone||v_dg_uid) AND a.organization_id=p_campaign.organization_id AND a.flatform_type='zalo'
    UNION SELECT g.account_id FROM public.auto_account_contact_groups g WHERE g.id=ANY(v_dg_phone||v_dg_uid) AND g.account_id IS NOT NULL
    UNION SELECT g.bound_zalo_account_id FROM public.auto_account_contact_groups g WHERE g.id=ANY(v_dg_phone||v_dg_uid) AND g.bound_zalo_account_id IS NOT NULL
    UNION SELECT p_account) s WHERE x IS NOT NULL;
  END IF;
  IF v_phone IS NOT NULL AND cardinality(v_dg_phone)>0 THEN
   SELECT jsonb_build_object('kind','data_group','id',g.id,'name',g.name,'note',format('Có trong Nhóm data “%s”.',g.name)) INTO v_match
    FROM (SELECT ct.id FROM public.auto_account_contacts ct WHERE ct.account_id IS NULL AND ct.contact_type='phone' AND ct.uid=v_phone
           AND ct.organization_id=p_campaign.organization_id
          UNION ALL
          SELECT k.id FROM unnest(v_accounts) a(id) CROSS JOIN LATERAL (SELECT ct.id FROM public.auto_account_contacts ct
           WHERE ct.account_id=a.id AND ct.contact_type='phone' AND ct.uid=v_phone OFFSET 0) k) cand
    JOIN public.auto_account_contact_group_members m ON m.contact_id=cand.id AND m.group_id=ANY(v_dg_phone) AND NOT m.is_delete
    JOIN public.auto_account_contact_groups g ON g.id=m.group_id
    ORDER BY g.name, g.id LIMIT 1;
  END IF;
  IF v_match IS NULL AND cardinality(v_dg_uid)>0 AND (v_gid IS NOT NULL OR v_uid IS NOT NULL) THEN
   SELECT jsonb_build_object('kind','data_group','id',g.id,'name',g.name,'note',format('Có trong Nhóm data “%s”.',g.name)) INTO v_match
    FROM (SELECT k.id FROM unnest(v_accounts) a(id)
           CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE v_gid IS NOT NULL AND zu.account_id=a.id AND zu.global_id=v_gid ORDER BY zu.id LIMIT 1 OFFSET 0) zu
           CROSS JOIN LATERAL (SELECT ct.id FROM public.auto_account_contacts ct WHERE ct.account_id=a.id AND ct.contact_type='person' AND ct.uid=zu.zalo_uid OFFSET 0) k
          UNION ALL
          SELECT ct.id FROM public.auto_account_contacts ct WHERE v_uid IS NOT NULL AND ct.account_id=p_account AND ct.contact_type='person' AND ct.uid=v_uid) cand
    JOIN public.auto_account_contact_group_members m ON m.contact_id=cand.id AND m.group_id=ANY(v_dg_uid) AND NOT m.is_delete
    JOIN public.auto_account_contact_groups g ON g.id=m.group_id
    ORDER BY g.name, g.id LIMIT 1;
  END IF;
 END IF;

 -- 3. Chiến dịch đã gửi: data của chiến dịch đó có cùng khách (Zalo ID riêng ở Zalo của chiến dịch, hoặc SĐT) và đã được
 -- gửi tin thành công (như lịch sử chống gửi lặp). Tra qua idx_campaign_input_cooldown_uid / _phone rồi idx_campaign_details_input_data_id.
 IF v_match IS NULL THEN
  FOR sc IN SELECT c.id, c.name, c.account_id FROM public.auto_campaigns c
    WHERE c.id=ANY(private.aka_agent_send_exclusion_ids(v_selection->'sentCampaignIds')) AND c.staff_id=p_campaign.staff_id
      AND c.organization_id=p_campaign.organization_id AND c.id<>p_campaign.id ORDER BY c.id LOOP
   v_sc_uid:=CASE WHEN sc.account_id=p_account THEN v_uid END;
   IF v_sc_uid IS NULL AND v_gid IS NOT NULL AND sc.account_id IS NOT NULL THEN
    SELECT zu.zalo_uid INTO v_sc_uid FROM public.zalo_users zu WHERE zu.account_id=sc.account_id AND zu.global_id=v_gid ORDER BY zu.id LIMIT 1;
   END IF;
   SELECT max(d.created_at) INTO v_at FROM (
     SELECT i.id FROM public.auto_campaign_input_data i WHERE v_sc_uid IS NOT NULL AND md5(lower(btrim(i.uid)))=md5(lower(btrim(v_sc_uid)))
      AND i.uid IS NOT NULL AND btrim(i.uid)<>'' AND i.campaign_id=sc.id
     UNION
     SELECT i.id FROM public.auto_campaign_input_data i WHERE v_phone_raw IS NOT NULL AND md5(public.normalize_phone(i.phone))=md5(public.normalize_phone(v_phone_raw))
      AND i.phone IS NOT NULL AND btrim(i.phone)<>'' AND i.campaign_id=sc.id) i
    JOIN public.auto_campaign_details d ON d.input_data_id=i.id
    WHERE d.campaign_id=sc.id AND d.action_code IN ('zalo_message_friend','zalo_message_stranger') AND NOT d.is_delete
      AND (d.policy_snapshot->>'operationState'='committed' OR (d.policy_snapshot->>'operationState' IS NULL AND d.status IN ('thành công','đã gửi','đã nhận','đã xem','đã click')));
   IF v_at IS NOT NULL THEN
    v_match:=jsonb_build_object('kind','campaign','id',sc.id,'name',sc.name,'sentAt',v_at,
     'note',format('Đã được gửi ở chiến dịch “%s” ngày %s.',sc.name,to_char(timezone('Asia/Ho_Chi_Minh',v_at),'DD/MM')));
    EXIT;
   END IF;
  END LOOP;
 END IF;

 -- 4. Khối của các Zalo khác trong nhóm (chỉ khi chưa khớp danh sách nào).
 IF v_match IS NULL AND jsonb_typeof(v_selection->'groupId')='number' THEN
  v_gid_group:=(v_selection->>'groupId')::bigint;
  FOR block IN SELECT ga.id, ga.account_id FROM public.auto_campaign_send_exclusion_group_accounts ga
    JOIN public.auto_campaign_send_exclusion_groups g ON g.id=ga.group_id AND NOT g.is_delete AND g.staff_id=p_campaign.staff_id AND g.organization_id=p_campaign.organization_id
    JOIN public.auto_accounts a ON a.id=ga.account_id AND a.staff_id=p_campaign.staff_id AND a.organization_id=p_campaign.organization_id AND a.flatform_type='zalo' AND NOT a.is_delete
    WHERE ga.group_id=v_gid_group AND ga.account_id<>p_account ORDER BY ga.sort_order, ga.id LOOP
   v_blocks:=v_blocks||jsonb_build_array(private.aka_agent_send_exclusion_block_facts(p_campaign,block.account_id,v_gid,v_phone_raw,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('fieldId',r.field_id,'operatorId',r.operator_id,'value',r.value,'isEnabled',r.is_enabled))
       FROM public.auto_campaign_send_exclusion_rules r WHERE r.group_account_id=block.id),'[]')));
  END LOOP;
 END IF;
 RETURN jsonb_build_object('match',v_match,'blocks',v_blocks,'globalIdKnown',v_gid IS NOT NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_campaign_send_exclusion_runtime(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_claim_token uuid, p_operation text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE c public.auto_campaigns%ROWTYPE; input public.auto_campaign_input_data%ROWTYPE;
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
  -- V654: {"clientVersion":2} = bộ chạy hiểu nhiều Zalo / danh sách mới; bản cũ gặp cấu hình mới thì send_exclusion_client_outdated.
  RETURN private.aka_agent_send_exclusion_snapshot(c,p_account_id,COALESCE(p_payload->>'clientVersion','') ~ '^[2-9]$');
 END IF;
 IF p_operation='remote' THEN
  RETURN private.aka_agent_send_exclusion_remote(c,p_account_id,(p_payload->>'inputId')::bigint,p_payload);
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
  IF p_operation IS NULL OR p_operation NOT IN ('snapshot', 'facts', 'friend_blocklist', 'remote') OR p_target_run_id IS NULL OR p_lease_token IS NULL THEN
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
    IF c.extra_settings->'zaloSendExclusionsByAccountId'->(r.account_id::text) IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'config_invalid', 'message', 'Chưa cấu hình loại trừ cho tài khoản thực hiện.');
    END IF;
    BEGIN
      -- V654: cấu hình theo nhiều Zalo / danh sách mới chỉ chạy với lõi gửi {"clientVersion":2}.
      RETURN jsonb_build_object('ok', true, 'snapshot', private.aka_agent_send_exclusion_snapshot(c, r.account_id,
        coalesce(p_payload->>'clientVersion', '') ~ '^[2-9]$'));
    EXCEPTION WHEN raise_exception THEN
      v_err := SQLERRM;
      RETURN jsonb_build_object('ok', false, 'reason', 'config_invalid', 'message', CASE v_err
        WHEN 'send_exclusion_account_configuration_missing' THEN 'Chưa cấu hình loại trừ cho tài khoản thực hiện.'
        WHEN 'send_exclusion_account_not_found' THEN 'Tài khoản trong cấu hình loại trừ không còn.'
        WHEN 'send_exclusion_group_not_found' THEN 'Nhóm điều kiện loại trừ đã bị xoá.'
        WHEN 'send_exclusion_blocklist_not_found' THEN 'Danh sách Zalo ID loại trừ đã bị xoá.'
        WHEN 'send_exclusion_data_group_not_found' THEN 'Nhóm data loại trừ không còn dùng được.'
        WHEN 'send_exclusion_campaign_not_found' THEN 'Chiến dịch dùng để loại trừ không còn dùng được.'
        WHEN 'send_exclusion_client_outdated' THEN 'Cập nhật akaAgent để chạy loại trừ theo nhiều Zalo.'
        ELSE 'Cấu hình loại trừ không hợp lệ.' END, 'code', v_err);
    END;
  END IF;

  IF p_operation = 'remote' THEN
    BEGIN
      RETURN jsonb_build_object('ok', true, 'remote', private.aka_agent_send_exclusion_remote(c, r.account_id, r.input_data_id, p_payload));
    EXCEPTION WHEN raise_exception THEN
      v_err := SQLERRM;
      IF v_err = 'send_exclusion_input_not_found' THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_closed'); END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'config_invalid', 'message', 'Cấu hình loại trừ không hợp lệ.', 'code', v_err);
    END;
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

CREATE OR REPLACE FUNCTION public.aka_agent_send_exclusion_v2(p_staff_id bigint, p_organization_id bigint, p_operation text, p_payload jsonb, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE v_account bigint; v_query text; v_ids bigint[]; v_exclude bigint; gid bigint; v_revision bigint; v_request uuid; v_blocks jsonb; v_block jsonb;
 v_n integer; v_primary bigint; v_ga bigint; r jsonb; v_prior jsonb; v_idx integer; v_payload_cmp jsonb; v_prior_cmp jsonb;
BEGIN
 PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, NULL); -- Bind Desktop token before privileged work.
 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF NOT EXISTS(SELECT 1 FROM public.org_staff s WHERE s.id=p_staff_id AND s.organization_id=p_organization_id AND s.is_active) THEN RAISE EXCEPTION 'send_exclusion_staff_not_found'; END IF;
 p_payload:=COALESCE(p_payload,'{}');

 IF p_operation='page' THEN
  RETURN jsonb_build_object('catalog',public.aka_agent_internal_send_exclusion_catalog(),
   'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'isServer',COALESCE(a.is_zalo_server,false),'isWeb',COALESCE(a.is_zalo_show_web,false),
      'loginStatus',a.login_status,
      'syncedAt',(SELECT zu.updated_at FROM public.zalo_users zu WHERE zu.account_id=a.id ORDER BY zu.updated_at DESC LIMIT 1),
      'synced',(EXISTS(SELECT 1 FROM public.zalo_users zu WHERE zu.account_id=a.id) OR EXISTS(SELECT 1 FROM public.auto_account_contacts ac WHERE ac.account_id=a.id AND ac.contact_type='person')
        OR EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b WHERE b.auto_account_id=a.id AND b.organization_id=p_organization_id AND b.is_active)))
     ORDER BY a.name, a.id)
    FROM public.auto_accounts a WHERE a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.flatform_type='zalo' AND NOT a.is_delete),'[]'),
   'groups',COALESCE((SELECT jsonb_agg(private.aka_agent_send_exclusion_group_v2(g.id) ORDER BY g.name,g.id) FROM public.auto_campaign_send_exclusion_groups g
     WHERE g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND NOT g.is_delete),'[]'),
   'blocklists',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'accountId',g.account_id,'accountName',a.name,
      'count',(SELECT count(*) FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id=m.contact_id WHERE m.group_id=g.id AND NOT m.is_delete AND NOT c.is_delete
        AND c.account_id=g.account_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id)) ORDER BY g.name,g.id)
    FROM public.auto_account_contact_groups g JOIN public.auto_accounts a ON a.id=g.account_id AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.flatform_type='zalo' AND NOT a.is_delete
    WHERE g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND NOT g.is_delete AND g.purpose='zalo_friend_blocklist' AND g.contact_type='person'),'[]'));
 END IF;

 IF p_operation='options' THEN
  v_account:=private.aka_agent_send_exclusion_int(p_payload->'accountId');
  IF v_account IS NULL OR NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=v_account AND staff_id=p_staff_id AND organization_id=p_organization_id AND flatform_type='zalo' AND NOT is_delete) THEN
   RAISE EXCEPTION 'send_exclusion_account_not_found';
  END IF;
  RETURN jsonb_build_object('accountId',v_account,'options',public.aka_agent_internal_send_exclusion_options(p_staff_id,p_organization_id,v_account));
 END IF;

 IF p_operation='lists' THEN
  v_query:=NULLIF(left(btrim(COALESCE(p_payload->>'query','')),100),'');
  v_exclude:=private.aka_agent_send_exclusion_int(p_payload->'excludeCampaignId');
  RETURN jsonb_build_object(
   'dataGroups',CASE WHEN COALESCE(p_payload->>'kind','all') IN ('all','dataGroups') THEN COALESCE((SELECT jsonb_agg(x.item ORDER BY x.own DESC, x.name, x.id) FROM (
     SELECT g.id, g.name, (g.staff_id=p_staff_id) own, jsonb_build_object('id',g.id,'name',g.name,'dataType',ci.code,'shared',g.staff_id<>p_staff_id,'deleted',g.is_delete,
       'count',(SELECT count(*) FROM (SELECT 1 FROM public.auto_account_contact_group_members m WHERE m.group_id=g.id AND NOT m.is_delete LIMIT 100001) m)) item
     FROM public.auto_account_contact_groups g JOIN public.category_item ci ON ci.id=g.data_type_category_item_id AND ci.code IN ('phone','zalo_person')
     WHERE g.organization_id=p_organization_id AND g.purpose='data_group'
       AND ((NOT g.is_delete AND (v_query IS NULL OR g.name ILIKE '%'||replace(replace(replace(v_query,'\','\\'),'%','\%'),'_','\_')||'%')
         AND (g.staff_id=p_staff_id OR g.sharing_scope='organization' OR (g.sharing_scope='selected' AND EXISTS(SELECT 1 FROM public.auto_data_group_recipients rc WHERE rc.group_id=g.id AND rc.staff_id=p_staff_id))))
        OR g.id=ANY(private.aka_agent_send_exclusion_ids(p_payload->'dataGroupIds')))
       AND (g.is_delete OR private.group_access('data',g.id,p_staff_id,p_organization_id) IS NOT NULL)
     ORDER BY (g.id=ANY(private.aka_agent_send_exclusion_ids(p_payload->'dataGroupIds'))) DESC, (g.staff_id=p_staff_id) DESC, g.updated_at DESC, g.id DESC LIMIT 60) x),'[]') END,
   'campaigns',CASE WHEN COALESCE(p_payload->>'kind','all') IN ('all','campaigns') THEN COALESCE((SELECT jsonb_agg(x.item ORDER BY x.sel DESC, x.upd DESC NULLS LAST, x.id DESC) FROM (
     SELECT c.id, (c.id=ANY(private.aka_agent_send_exclusion_ids(p_payload->'sentCampaignIds'))) sel, c.updated_at upd,
      jsonb_build_object('id',c.id,'name',c.name,'actionId',c.action_id,'status',c.status,'accountId',c.account_id,'accountName',a.name,'deleted',c.is_delete,
       'completedAt',c.completed_at,
       'sentCount',(SELECT count(*) FROM (SELECT 1 FROM public.auto_campaign_details d WHERE d.campaign_id=c.id AND NOT d.is_delete
          AND d.action_code IN ('zalo_message_friend','zalo_message_stranger')
          AND (d.policy_snapshot->>'operationState'='committed' OR (d.policy_snapshot->>'operationState' IS NULL AND d.status IN ('thành công','đã gửi','đã nhận','đã xem','đã click'))) LIMIT 100001) d)) item
     FROM public.auto_campaigns c LEFT JOIN public.auto_accounts a ON a.id=c.account_id
     WHERE c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.id IS DISTINCT FROM v_exclude
       AND c.action_id IN ('zalo_message_phone','zalo_message_friend','zalo_message_birthday','zalo_message_group_member','zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation')
       AND ((NOT c.is_delete AND (v_query IS NULL OR c.name ILIKE '%'||replace(replace(replace(v_query,'\','\\'),'%','\%'),'_','\_')||'%'))
         OR c.id=ANY(private.aka_agent_send_exclusion_ids(p_payload->'sentCampaignIds')))
     ORDER BY (c.id=ANY(private.aka_agent_send_exclusion_ids(p_payload->'sentCampaignIds'))) DESC, c.updated_at DESC NULLS LAST, c.id DESC LIMIT 40) x),'[]') END);
 END IF;

 IF p_operation<>'save' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;
 -- save: {id?, requestId?, name, revision, blocks:[{accountId, matchMode, rules}]} (1–20 Zalo, mỗi Zalo một lần).
 v_blocks:=p_payload->'blocks';
 IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'name')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'send_exclusion_name_invalid'; END IF;
 IF jsonb_typeof(v_blocks) IS DISTINCT FROM 'array' OR jsonb_array_length(v_blocks) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'send_exclusion_blocks_invalid'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_blocks) b WHERE private.aka_agent_send_exclusion_int(b->'accountId') IS NULL OR COALESCE(b->>'matchMode','') NOT IN ('and','or'))
   OR (SELECT count(DISTINCT b->>'accountId') FROM jsonb_array_elements(v_blocks) b)<>jsonb_array_length(v_blocks) THEN RAISE EXCEPTION 'send_exclusion_blocks_invalid'; END IF;
 FOR v_block IN SELECT * FROM jsonb_array_elements(v_blocks) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=(v_block->>'accountId')::bigint AND staff_id=p_staff_id AND organization_id=p_organization_id AND flatform_type='zalo' AND NOT is_delete) THEN
   RAISE EXCEPTION 'send_exclusion_account_not_found';
  END IF;
  PERFORM public.aka_agent_internal_validate_send_exclusion_rules(v_block->'rules',p_staff_id,p_organization_id,(v_block->>'accountId')::bigint);
 END LOOP;
 v_n:=jsonb_array_length(v_blocks);
 v_primary:=(v_blocks->0->>'accountId')::bigint;
 gid:=private.aka_agent_send_exclusion_int(p_payload->'id');
 IF gid IS NULL AND COALESCE(p_payload->'id','null')<>'null' THEN RAISE EXCEPTION 'send_exclusion_group_not_found'; END IF;
 IF gid IS NULL THEN
  v_request:=CASE WHEN p_payload->>'requestId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_payload->>'requestId')::uuid END;
  IF v_request IS NULL THEN RAISE EXCEPTION 'send_exclusion_request_id_required'; END IF;
  INSERT INTO public.auto_campaign_send_exclusion_groups(staff_id,organization_id,account_id,name,match_mode,create_request_id,version)
   VALUES(p_staff_id,p_organization_id,v_primary,btrim(p_payload->>'name'),v_blocks->0->>'matchMode',v_request,CASE WHEN v_n>1 THEN 2 ELSE 1 END)
   ON CONFLICT(staff_id,organization_id,account_id,create_request_id) DO NOTHING RETURNING id INTO gid;
  IF gid IS NULL THEN
   -- Gửi lại cùng requestId (mất câu trả lời): trả nhóm đã tạo nếu nội dung giống hệt.
   SELECT private.aka_agent_send_exclusion_group_v2(id) INTO v_prior FROM public.auto_campaign_send_exclusion_groups
    WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND create_request_id=v_request AND NOT is_delete ORDER BY id LIMIT 1;
   SELECT jsonb_agg(jsonb_build_object('accountId',(b->>'accountId')::bigint,'matchMode',b->>'matchMode','rules',
     (SELECT jsonb_agg(jsonb_build_object('fieldId',(x->>'fieldId')::bigint,'operatorId',(x->>'operatorId')::bigint,'value',COALESCE(x->'value','null'),'isEnabled',COALESCE((x->>'isEnabled')::boolean,false)) ORDER BY (x->>'fieldId')::bigint) FROM jsonb_array_elements(b->'rules') x))
     ORDER BY o) INTO v_payload_cmp FROM jsonb_array_elements(v_blocks) WITH ORDINALITY t(b,o);
   SELECT jsonb_agg(jsonb_build_object('accountId',(b->>'accountId')::bigint,'matchMode',b->>'matchMode','rules',
     (SELECT jsonb_agg(jsonb_build_object('fieldId',(x->>'fieldId')::bigint,'operatorId',(x->>'operatorId')::bigint,'value',COALESCE(x->'value','null'),'isEnabled',COALESCE((x->>'isEnabled')::boolean,false)) ORDER BY (x->>'fieldId')::bigint) FROM jsonb_array_elements(b->'rules') x))
     ORDER BY o) INTO v_prior_cmp FROM jsonb_array_elements(v_prior->'blocks') WITH ORDINALITY t(b,o);
   IF v_prior IS NULL OR v_prior->>'name' IS DISTINCT FROM btrim(p_payload->>'name') OR v_prior_cmp IS DISTINCT FROM v_payload_cmp THEN
    RAISE EXCEPTION 'send_exclusion_revision_conflict';
   END IF;
   RETURN v_prior;
  END IF;
 ELSE
  UPDATE public.auto_campaign_send_exclusion_groups g SET name=btrim(p_payload->>'name'),match_mode=v_blocks->0->>'matchMode',account_id=v_primary,
    version=CASE WHEN v_n>1 THEN 2 ELSE 1 END,revision=g.revision+1,updated_at=now()
   WHERE g.id=gid AND g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND NOT g.is_delete
     AND g.revision=private.aka_agent_send_exclusion_int(p_payload->'revision') RETURNING g.revision INTO v_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_revision_conflict'; END IF;
  DELETE FROM public.auto_campaign_send_exclusion_group_accounts WHERE group_id=gid;
 END IF;
 v_idx:=0;
 FOR v_block IN SELECT b FROM jsonb_array_elements(v_blocks) WITH ORDINALITY t(b,o) ORDER BY o LOOP
  INSERT INTO public.auto_campaign_send_exclusion_group_accounts(group_id,account_id,match_mode,sort_order)
   VALUES(gid,(v_block->>'accountId')::bigint,v_block->>'matchMode',v_idx) RETURNING id INTO v_ga;
  FOR r IN SELECT * FROM jsonb_array_elements(v_block->'rules') LOOP
   INSERT INTO public.auto_campaign_send_exclusion_rules(group_id,group_account_id,field_id,operator_id,value,is_enabled,sort_order)
   VALUES(gid,v_ga,(r->>'fieldId')::bigint,(r->>'operatorId')::bigint,COALESCE(r->'value','null'),COALESCE((r->>'isEnabled')::boolean,false),COALESCE((r->>'sortOrder')::integer,0));
  END LOOP;
  v_idx:=v_idx+1;
 END LOOP;
 RETURN private.aka_agent_send_exclusion_group_v2(gid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_claim_target_v1(p_ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_staff bigint := nullif(p_ctx->>'staffId', '')::bigint;
  v_account_id bigint := nullif(p_ctx->>'accountId', '')::bigint;
  v_campaign_id bigint := nullif(p_ctx->>'campaignId', '')::bigint;
  v_runner text := nullif(btrim(p_ctx->>'runnerId'), '');
  v_runtime text := p_ctx->>'runtimeTarget';
  v_req_token uuid := nullif(p_ctx->>'leaseToken', '')::uuid;
  v_lease_seconds integer := greatest(30, public.aka_agent_engine_setting('engine.lease_seconds', '180')::integer);
  c public.auto_campaigns%ROWTYPE;
  a public.auto_accounts%ROWTYPE;
  l public.auto_engine_leases%ROWTYPE;
  t public.auto_campaign_input_data%ROWTYPE;
  v_has_lease boolean;
  v_token uuid;
  v_run_id bigint;
  v_act jsonb;
  v_code text;
  v_required boolean;
  v_decision jsonb;
  v_decisions jsonb := '{}'::jsonb;
  v_target_wait jsonb;
  v_target_key text;
  v_lock record;
  v_limit jsonb;
  v_daily numeric;
  v_window_count numeric;
  v_window_minutes numeric;
  v_used integer;
  v_oldest timestamptz;
  v_allowed boolean;
  v_boundary text;
  v_org bigint;
  v_cap_qr boolean;
  v_cap_web boolean;
  v_cap_server boolean;
  v_max integer;
  v_running bigint;
  v_day_start timestamptz := ((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_wait_note text;
  v_found boolean := false;
  v_cooldown boolean;
  v_cd_decision text;
  v_cd_note text;
  v_cd_error text;
  v_cd_paused jsonb := '[]'::jsonb;
  v_cd_skip bigint[] := '{}';
  v_cd_scanned integer := 0;
  v_dg_result jsonb;
  v_cd_deadline timestamptz;
  v_legacy_setting text;
  v_legacy_before timestamptz;
  -- V558: lượt theo lịch (loại chiến dịch không có dòng data: trang cá nhân, newsfeed Facebook).
  v_slot_mode boolean := coalesce(p_ctx->>'mode', '') = 'campaign_slot';
  v_slot timestamptz;
  v_is_facebook boolean;
  -- Quét data website: số lượt đã dùng trong ngày / trong khung giờ của mã thao tác web (để trả số lượt còn lại).
  v_web_day numeric;
  v_web_window numeric;
  -- V558: chỉ nhận đúng các data này (ctx.inputDataIds), trong lượt đang giữ lease.
  v_only_ids bigint[];
  -- V564: chiến dịch đăng nhóm bật "Xáo trộn danh sách group" (như bộ cũ xáo các data chờ ở đầu mỗi lượt).
  v_shuffle boolean := false;
  v_shuffle_count integer;
  -- V571: kiểm người nhận trên toàn hệ thống (engine.target_check).
  v_tc jsonb;                       -- {thao tác: mã} người nhận đã biết hỏng (mã đang bật, còn hiệu lực)
  v_tc_global text;                 -- global id của người nhận (zalo_users theo tài khoản + UID)
  v_tc_friend boolean := false;     -- tài khoản gửi đã là bạn bè (zalo_users.is_fr)
  v_tc_sends jsonb;                 -- mọi bước gửi đã biết hỏng: {thao tác gửi: mã}, bỏ luôn bước tìm SĐT
BEGIN
  IF v_staff IS NULL OR v_account_id IS NULL OR v_campaign_id IS NULL OR v_runner IS NULL OR v_runtime IS NULL OR v_runtime NOT IN ('desktop','fly') THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;
  -- Desktop chỉ nhận việc của chính nhân viên đăng nhập, và chỉ với vai trò Desktop.
  IF public.aka_agent_engine_desktop_staff() IS NOT NULL AND v_runtime <> 'desktop' THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;
  IF NOT public.aka_agent_engine_scope_ok(v_staff) THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  -- V558: nhận thêm đúng các data này vào lượt đang chạy (đăng nhóm Facebook kèm chia sẻ sang các nhóm đã chọn trong hộp đăng bài, như bộ
  -- cũ giữ chỗ các nhóm chia sẻ cùng data chính). Chỉ khi đang giữ lease, không cho lượt theo lịch, tối đa 50 id.
  IF p_ctx ? 'inputDataIds' THEN
    IF v_req_token IS NULL OR v_slot_mode OR jsonb_typeof(p_ctx->'inputDataIds') <> 'array'
       OR jsonb_array_length(p_ctx->'inputDataIds') NOT BETWEEN 1 AND 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_ctx->'inputDataIds') x
                   WHERE jsonb_typeof(x.value) <> 'number' OR x.value::text !~ '^[0-9]{1,18}$') THEN
      RETURN jsonb_build_object('status', 'invalid_request');
    END IF;
    SELECT array_agg(DISTINCT x.value::text::bigint) INTO v_only_ids FROM jsonb_array_elements(p_ctx->'inputDataIds') x;
  END IF;

  -- V501 (review 12/11): khoá tư vấn trước khoá dòng, đúng thứ tự của bản cũ. Chiến dịch Nhóm data: khoá nạp data của chiến dịch
  -- (cùng khoá với aka_agent_lock_campaign_input_serialization; luồng nạp Nhóm data, hàm kết thúc v219 và finish_campaign_v2 lấy
  -- khoá này trước khoá dòng chiến dịch), vì nhánh hết hạn bên dưới gọi hàm kết thúc v219.
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.id = v_campaign_id AND x.data_target_source_mode = 'data_group') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_campaign_id::text, 0));
  END IF;
  -- Tài khoản Zalo (trình duyệt) bắt đầu lượt trên Desktop: khoá giới hạn chạy đồng thời của nhân viên như claim bản cũ (v397), để
  -- hai lượt nhận cùng lúc (của bộ mới hay bộ cũ) không cùng đếm N-1 rồi cùng vượt giới hạn.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND to_regclass('public.org_staff') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.auto_accounts xa WHERE xa.id = v_account_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'zalo'
                   AND coalesce(xa.is_zalo_show_web, false) AND NOT coalesce(xa.is_zalo_server, false)) THEN
    EXECUTE 'SELECT s.max_running_zalo_web_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || v_staff::text, 0));
    END IF;
  END IF;
  -- V558: tài khoản Facebook bắt đầu lượt trên Desktop: cùng khoá giới hạn chạy đồng thời của nhân viên như claim bản cũ (v397 khoá chung
  -- cho Zalo trình duyệt và Facebook), để hai lượt nhận cùng lúc không cùng đếm N-1 rồi cùng vượt giới hạn.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND to_regclass('public.org_staff') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.auto_accounts xa WHERE xa.id = v_account_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook') THEN
    EXECUTE 'SELECT s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || v_staff::text, 0));
    END IF;
  END IF;
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.is_delete, false) OR c.staff_id IS DISTINCT FROM v_staff THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF c.account_id IS DISTINCT FROM v_account_id THEN RETURN jsonb_build_object('status', 'account_mismatch'); END IF;

  -- Không có công tắc theo loại chiến dịch: bộ chạy chỉ gọi claim cho loại mà lõi đã phủ.
  -- Desktop bản mới tự chạy bộ mới; Fly chỉ chạy bộ mới cho tổ chức bật cờ use_new_zalo_runtime (V371).
  IF v_runtime = 'fly'
     AND NOT coalesce((SELECT o.use_new_zalo_runtime FROM public.org_organization o WHERE o.id = c.organization_id), false) THEN
    RETURN jsonb_build_object('status', 'not_enabled');
  END IF;

  SELECT * INTO a FROM public.auto_accounts WHERE id = v_account_id FOR UPDATE;
  IF NOT FOUND OR coalesce(a.is_delete, false) OR a.staff_id IS DISTINCT FROM v_staff THEN
    RETURN jsonb_build_object('status', 'account_not_found');
  END IF;
  -- V558: tài khoản Facebook chỉ chạy engine trên Desktop, khi tổ chức bật engine.facebook (anh chốt Q1). Kiểm mỗi lần nhận lượt: tắt
  -- (mode off / bỏ tổ chức khỏi danh sách) có hiệu lực ở lần nhận kế tiếp, Desktop nhận not_enabled thì chạy bộ cũ.
  v_is_facebook := lower(btrim(coalesce(a.flatform_type, ''))) = 'facebook';
  IF v_is_facebook THEN
    IF v_runtime <> 'desktop' THEN RETURN jsonb_build_object('status', 'runtime_not_owner'); END IF;
    IF NOT public.aka_agent_engine_facebook_org_enabled(coalesce(c.organization_id, a.organization_id)) THEN
      RETURN jsonb_build_object('status', 'not_enabled');
    END IF;
  END IF;
  -- Quét data website (tài khoản "Website"): chỉ Desktop, chỉ tổ chức bật web_scan.campaigns. Kiểm mỗi lần nhận lượt; tắt có hiệu lực ở lần
  -- nhận kế tiếp. Tài khoản web không cần gói (anh chốt: mở theo tổ chức, lúc đầu chỉ tổ chức 1).
  IF lower(btrim(coalesce(a.flatform_type, ''))) = 'web' THEN
    IF v_runtime <> 'desktop' THEN RETURN jsonb_build_object('status', 'runtime_not_owner'); END IF;
    IF NOT public.aka_agent_web_scan_org_enabled(coalesce(c.organization_id, a.organization_id)) THEN
      RETURN jsonb_build_object('status', 'not_enabled');
    END IF;
  END IF;
  -- Bộ cũ còn giữ tài khoản (token thao tác) hoặc một chiến dịch của tài khoản (claim token, unit lease):
  -- chờ, không chạy chồng. Bộ mới không bao giờ dùng hay xoá các token này.
  IF a.runtime_operation_claim_token IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'legacy_busy', 'scope', 'account');
  END IF;
  -- V527: claim token bộ cũ còn sót trên chiến dịch đã xoá / tạm dừng không chặn tài khoản nữa. Trigger
  -- aka_agent_clear_campaign_runtime_claim_metadata cố ý giữ claim khi chiến dịch Server chuyển "đang chạy" → "tạm dừng" (chờ nơi chạy tự
  -- nhả) và App Server nhả tài khoản mà không xoá claim đó, nên claim treo hàng tháng. Chỉ bỏ qua khi đủ cả: tài khoản không còn token
  -- thao tác (kiểm ở trên), chiến dịch không giữ unit lease, không còn data "đang chạy", và cả lúc claim lẫn lần ghi cuối của chiến dịch
  -- (lúc tạm dừng / xoá) đã cũ hơn engine.legacy_stale_claim_minutes phút (mặc định 30, tối thiểu 10). Unit lease,
  -- claim trên chiến dịch chờ / đang chạy và chiến dịch vừa tạm dừng giữa lượt vẫn chặn. Không xoá token nào ở đây.
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x
              WHERE x.account_id = v_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)) THEN
    v_legacy_setting := btrim(public.aka_agent_engine_setting('engine.legacy_stale_claim_minutes', '30'));
    v_legacy_before := v_now - make_interval(mins => CASE WHEN v_legacy_setting ~ '^[0-9]{1,6}$'
                                                         THEN greatest(10, v_legacy_setting::integer) ELSE 30 END);
    IF EXISTS (SELECT 1 FROM public.auto_campaigns x
                WHERE x.account_id = v_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
                  AND NOT (x.runtime_unit_token IS NULL
                           AND (coalesce(x.is_delete, false) OR x.status = 'tạm dừng')
                           AND coalesce(x.runtime_claimed_at, '-infinity'::timestamptz) < v_legacy_before
                           AND coalesce(x.updated_at, '-infinity'::timestamptz) < v_legacy_before
                           AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                            WHERE d.campaign_id = x.id AND d.status = 'đang chạy'
                                              AND coalesce(d.is_delete, false) = false))) THEN
      RETURN jsonb_build_object('status', 'legacy_busy', 'scope', 'campaign');
    END IF;
  END IF;
  -- Cùng điều kiện nhận lượt của bản cũ (aka_agent_claim_campaign_run_unit_v2): đúng runtime sở hữu
  -- tài khoản, tài khoản còn bật và đã đăng nhập, quyền dùng app, khung giờ cho phép của nhân viên.
  IF (v_runtime = 'fly' AND (lower(btrim(coalesce(a.flatform_type, ''))) <> 'zalo' OR coalesce(a.is_zalo_show_web, false)
                              OR NOT coalesce(a.is_zalo_server, false)))
     OR (v_runtime = 'desktop' AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND coalesce(a.is_zalo_server, false)) THEN
    RETURN jsonb_build_object('status', 'runtime_not_owner');
  END IF;
  IF a.is_active IS NOT TRUE OR a.login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    RETURN jsonb_build_object('status', 'account_logged_out', 'loginStatus', a.login_status);
  END IF;
  -- V501 (G7): tài khoản tạm dừng (hay trạng thái khác "chờ xử lý"/"đang chạy") không nhận lượt, như bản cũ. "đang chạy" mà
  -- không còn ai giữ (bộ cũ đã kiểm ở trên bằng token, bộ mới bằng lease bên dưới) là sót lại sau khi app/worker tắt đột ngột.
  IF coalesce(a.status, 'chờ xử lý') NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('status', 'account_paused', 'accountStatus', a.status);
  END IF;
  -- Hai hàm có sẵn trên production gọi qua EXECUTE: PL/pgSQL phân giải tên hàm khi lập kế hoạch biểu thức.
  IF to_regprocedure('public.aka_agent_app_access_account_allowed(bigint,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_app_access_account_allowed($1, $2)' INTO v_allowed USING v_account_id, 'akaAgent';
    IF v_allowed IS NOT TRUE THEN RETURN jsonb_build_object('status', 'app_access_denied', 'reason', 'app_access_account'); END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_staff_time_allowed($1)' INTO v_allowed USING v_staff;
    IF v_allowed IS NOT TRUE THEN RETURN jsonb_build_object('status', 'staff_time_blocked'); END IF;
  END IF;
  -- V501: quyền gói Zalo của tổ chức như claim của bản cũ (aka_agent_claim_campaign_runtime_checked): Server cần QR + Server,
  -- tài khoản trình duyệt cần Web, tài khoản QR cần QR.
  v_org := coalesce(c.organization_id, a.organization_id);
  IF lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND v_org IS NOT NULL
     AND to_regprocedure('public.resolve_organization_zalo_account_capabilities(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT x.qr_enabled, x.web_enabled, x.server_enabled FROM public.resolve_organization_zalo_account_capabilities($1) x'
      INTO v_cap_qr, v_cap_web, v_cap_server USING v_org;
    IF (coalesce(a.is_zalo_server, false) AND NOT (coalesce(v_cap_qr, false) AND coalesce(v_cap_server, false)))
       OR (NOT coalesce(a.is_zalo_server, false) AND coalesce(a.is_zalo_show_web, false) AND NOT coalesce(v_cap_web, false))
       OR (NOT coalesce(a.is_zalo_server, false) AND NOT coalesce(a.is_zalo_show_web, false) AND NOT coalesce(v_cap_qr, false)) THEN
      RETURN jsonb_build_object('status', 'entitlement_denied');
    END IF;
  END IF;
  -- V558: quyền gói Facebook như bộ cũ (entitlementRepository: Facebook dùng được khi tổ chức có gói sản phẩm 3 hoặc 10 còn hạn).
  IF v_is_facebook AND v_org IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.org_organization_product p
                      WHERE p.organization_id = v_org AND p.is_deleted = false AND p.product_id IN (3, 10)
                        AND p.expiration_date IS NOT NULL AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_vn) THEN
    RETURN jsonb_build_object('status', 'entitlement_denied');
  END IF;
  -- V501 (G10): giới hạn số tài khoản Zalo (trình duyệt) chạy đồng thời của nhân viên, đếm như bản cũ (v397). Chỉ khi bắt đầu
  -- lượt (chưa giữ lease): lượt đang chạy không bị cắt giữa chừng.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo'
     AND coalesce(a.is_zalo_show_web, false) AND NOT coalesce(a.is_zalo_server, false)
     AND to_regclass('public.org_staff') IS NOT NULL THEN
    EXECUTE 'SELECT s.max_running_zalo_web_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      SELECT count(DISTINCT x.account_id) INTO v_running
        FROM public.auto_campaigns x
        JOIN public.auto_accounts xa ON xa.id = x.account_id AND xa.staff_id = x.staff_id
       WHERE x.staff_id = v_staff AND xa.id <> v_account_id
         AND (x.organization_id IS NULL OR x.organization_id = v_org)
         AND (xa.organization_id IS NULL OR xa.organization_id = v_org)
         AND (x.status = 'đang chạy' OR x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
         AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'zalo' AND xa.is_zalo_show_web = true AND xa.is_zalo_server = false;
      IF v_running >= v_max THEN RETURN jsonb_build_object('status', 'concurrency_limit', 'max', v_max); END IF;
    END IF;
  END IF;
  -- V558: giới hạn số tài khoản Facebook chạy đồng thời của nhân viên, đếm như claim bản cũ (v397): chiến dịch "đang chạy" hoặc còn token
  -- của bộ cũ, trên tài khoản Facebook khác của nhân viên. Chỉ khi bắt đầu lượt (chưa giữ lease): lượt đang chạy không bị cắt.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND v_is_facebook AND to_regclass('public.org_staff') IS NOT NULL THEN
    EXECUTE 'SELECT s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      SELECT count(DISTINCT x.account_id) INTO v_running
        FROM public.auto_campaigns x
        JOIN public.auto_accounts xa ON xa.id = x.account_id AND xa.staff_id = x.staff_id
       WHERE x.staff_id = v_staff AND xa.id <> v_account_id
         AND (x.organization_id IS NULL OR x.organization_id = v_org)
         AND (xa.organization_id IS NULL OR xa.organization_id = v_org)
         AND (x.status = 'đang chạy' OR x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
         AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook';
      IF v_running >= v_max THEN RETURN jsonb_build_object('status', 'concurrency_limit', 'max', v_max); END IF;
    END IF;
  END IF;

  -- V501 (G5): chiến dịch Nhóm data đang chờ data mới (không có data đến hạn, không có data đang chạy) khi bắt đầu lượt: như claim của
  -- bản cũ (v397) không nhận lượt và không ghi gì; hàm kết thúc Nhóm data chỉ chạy ở cuối một lượt đã chạy data (finish_campaign_v2).
  IF v_req_token IS NULL AND c.data_target_source_mode = 'data_group' AND c.status = 'chờ xử lý'
     AND NOT (c.schedule_end_date IS NOT NULL AND c.schedule_end_date <= v_now)
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                      WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false
                        AND (d.status = 'đang chạy' OR (d.status = 'chờ xử lý' AND (d.schedule IS NULL OR d.schedule <= v_now)))) THEN
    RETURN jsonb_build_object('status', 'data_group_waiting', 'note', c.note);
  END IF;

  -- Giữ chỗ tài khoản có hạn. Lease cũ đã hết hạn thì runner mới lấy được; data dở của lease cũ
  -- vẫn "đang chạy" và chỉ được aka_agent_engine_close_stale_v1 đóng (không bao giờ gửi lại).
  SELECT * INTO l FROM public.auto_engine_leases WHERE account_id = v_account_id FOR UPDATE;
  v_has_lease := FOUND;
  IF v_has_lease AND l.expires_at > v_now AND l.lease_token IS DISTINCT FROM v_req_token THEN
    RETURN jsonb_build_object('status', 'busy', 'runnerId', l.runner_id, 'expiresAt', l.expires_at);
  END IF;
  v_token := CASE WHEN v_has_lease AND l.lease_token = v_req_token AND l.expires_at > v_now THEN l.lease_token ELSE gen_random_uuid() END;
  -- V501: campaign_schedule = lịch của chiến dịch lúc bắt đầu lượt (khung giờ hiện tại của chiến dịch nhiều khung giờ).
  INSERT INTO public.auto_engine_leases AS el (account_id, lease_token, runner_id, runtime_target, campaign_id, acquired_at, heartbeat_at, expires_at, campaign_schedule)
  VALUES (v_account_id, v_token, v_runner, v_runtime, v_campaign_id, v_now, v_now, v_now + make_interval(secs => v_lease_seconds), c.schedule)
  ON CONFLICT (account_id) DO UPDATE SET
    lease_token = EXCLUDED.lease_token, runner_id = EXCLUDED.runner_id, runtime_target = EXCLUDED.runtime_target,
    campaign_id = EXCLUDED.campaign_id,
    acquired_at = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.acquired_at ELSE EXCLUDED.acquired_at END,
    campaign_schedule = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.campaign_schedule ELSE EXCLUDED.campaign_schedule END,
    heartbeat_at = EXCLUDED.heartbeat_at, expires_at = EXCLUDED.expires_at;

  IF c.status = 'tạm dừng' THEN RETURN jsonb_build_object('status', 'campaign_paused', 'leaseToken', v_token); END IF;
  IF c.status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('status', 'campaign_not_runnable', 'campaignStatus', c.status, 'leaseToken', v_token);
  END IF;
  -- V501 (G10): chiến dịch đang nạp data ban đầu chưa được chạy, như bản cũ.
  IF coalesce(c.provisioning_state, 'ready') <> 'ready' THEN
    RETURN jsonb_build_object('status', 'campaign_not_ready', 'leaseToken', v_token, 'provisioningState', c.provisioning_state);
  END IF;
  IF c.status = 'chờ xử lý' AND c.schedule IS NOT NULL AND c.schedule > v_now THEN
    RETURN jsonb_build_object('status', 'not_due', 'schedule', c.schedule, 'leaseToken', v_token);
  END IF;
  -- V501 (G1): lịch còn là ngày cũ mà chiến dịch chưa qua bảo trì lịch ngày mới: không chạy, nơi chạy cập nhật lịch rồi hỏi
  -- lại (như daily_maintenance_required của bản cũ, v340). Riêng hằng ngày không bật "chạy tiếp hôm sau" thì chạy tiếp ngay.
  IF c.status = 'chờ xử lý' AND c.schedule IS NOT NULL AND c.schedule < v_day_start
     AND NOT (coalesce(nullif(c.schedule_type, ''), 'daily') = 'daily' AND c.continue_next_day IS NOT TRUE) THEN
    RETURN jsonb_build_object('status', 'maintenance_required', 'leaseToken', v_token, 'schedule', c.schedule);
  END IF;
  -- V501 (G5): chiến dịch theo Nhóm data đã hết hạn nhận và chạy data mới: không nhận lượt; kết thúc bằng đúng hàm kết thúc Nhóm data
  -- của bản cũ (finalizeDataGroupCampaignAtHardEnd: dừng nguồn, đóng data chờ "Chiến dịch đã hết hạn", hoàn thành khi không còn data
  -- đang chạy). Hàm chưa có (DB thử) thì chỉ không nhận lượt.
  IF c.data_target_source_mode = 'data_group' AND c.schedule_end_date IS NOT NULL AND c.schedule_end_date <= v_now THEN
    IF to_regprocedure('public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)') IS NOT NULL THEN
      EXECUTE 'SELECT public.aka_agent_internal_finalize_data_group_campaign_v219($1, $2, $3, $4)' INTO v_dg_result
        USING c.staff_id, c.organization_id, c.id, 'Chiến dịch đã hết thời hạn nhận và chạy data mới';
    END IF;
    RETURN jsonb_build_object('status', 'data_group_hard_end', 'leaseToken', v_token, 'finalize', v_dg_result);
  END IF;
  -- Mốc ngày như bản cũ (daily_stop_due / daily_drain_due / vietnam_day_changed): sau giờ dừng trong ngày
  -- (mặc định 23:59) hoặc khi lease mở từ ngày trước thì không nhận data mới, để bảo trì ngày mới chạy.
  v_boundary := CASE
    WHEN c.daily_stop_time IS NOT NULL
     AND v_now >= ((v_vn + least(c.daily_stop_time, time '23:59:00')) AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN 'daily_stop_due'
    WHEN v_now >= ((v_vn + time '23:59:00') AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN 'daily_drain_due'
    WHEN v_has_lease AND l.lease_token = v_token AND (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < v_vn THEN 'vietnam_day_changed'
  END;
  IF v_boundary IS NOT NULL THEN
    -- Qua giờ dừng / giờ chốt trong ngày: không nhận data tới 0:00 hôm sau. Qua ngày khi lượt còn mở từ hôm trước:
    -- chỉ kết thúc lượt (nextAt = bây giờ) để bảo trì ngày mới chạy, xong là chạy tiếp ngay trong ngày.
    -- V501: kèm giờ dừng đã cấu hình để lõi in đúng câu ⏹ của Desktop (giờ dừng riêng hay mốc 23:59).
    RETURN jsonb_build_object('status', 'daily_boundary', 'leaseToken', v_token, 'reason', v_boundary, 'stopTime', c.daily_stop_time,
      'nextAt', CASE WHEN v_boundary = 'vietnam_day_changed' THEN v_now
                     ELSE ((v_vn + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') END);
  END IF;

  -- V558: lượt theo lịch (Q4). Mốc lịch = lịch của chiến dịch lúc nhận (chưa có lịch thì lúc tạo). Mỗi mốc chạy một lượt: mốc đã có lượt
  -- đang mở, đã thử với lease này, hoặc đã đóng mà không phải "về hàng đợi" (chờ xử lý) thì xong; claim trả no_target để nơi chạy kết thúc
  -- lượt (finish_campaign tính lịch kế tiếp như bộ cũ). Mỗi chiến dịch tối đa một lượt theo lịch đang mở (chỉ mục V557).
  IF v_slot_mode THEN
    v_slot := coalesce(c.schedule, c.created_at, v_now);
    IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr
                WHERE tr.campaign_id = v_campaign_id AND tr.slot_at IS NOT NULL
                  AND (tr.completed_at IS NULL
                       OR (tr.slot_at = v_slot AND (tr.lease_token = v_token OR tr.final_target_status IS DISTINCT FROM 'chờ xử lý')))) THEN
      RETURN jsonb_build_object('status', 'no_target', 'leaseToken', v_token, 'nextSchedule', NULL,
        'runningTargets', (SELECT count(*) FROM public.auto_engine_target_runs tr
                            WHERE tr.campaign_id = v_campaign_id AND tr.slot_at IS NOT NULL AND tr.completed_at IS NULL),
        'hasTargets', true, 'dueTried', 0, 'dataGroup', false, 'slot', true, 'slotAt', v_slot, 'cooldownPaused', '[]'::jsonb);
    END IF;
  END IF;
  -- V501 (G3): mỗi data chỉ thử một lần trong một lượt (như Desktop đi qua danh sách một lần): data vừa về hàng đợi
  -- được thử lại ở lượt sau, các data phía sau vẫn chạy trong lượt này.
  -- V501: chống gửi lặp N ngày (applyRecentDeliveryCooldown của Desktop, trước khi nhận data và trước bước tra số): gọi đúng
  -- RPC của bộ cũ cho data sắp nhận (còn "chờ xử lý", đã khoá). RPC tự tạm dừng data đã gửi gần đây; lõi in "⏸️ Bỏ qua …".
  -- Không ghi lịch sử, không tính lượt, không đổi chuỗi lỗi, không nghỉ. Mỗi lần gọi xét tối đa 50 data, và dừng khi hết ngân sách
  -- thời gian (engine.cooldown_scan_ms, mặc định 1.500 ms tính từ đầu lần gọi; review 12/11): lần gọi từ Desktop có trần 3 giây của
  -- vai trò aka_agent_desktop, quá trần thì cả lần gọi bị huỷ (kể cả các data đã tạm dừng) và lần gọi lại làm lại từ đầu. Trả
  -- cooldown_scan thì các data đã tạm dừng được giữ, lõi gọi lại ngay và đi tiếp từ data kế tiếp.
  v_cooldown := NOT v_slot_mode AND coalesce(c.extra_settings->'recentDeliveryCooldownEnabled' = 'true'::jsonb, false)
    AND to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])') IS NOT NULL;
  v_cd_deadline := v_now + make_interval(secs => (CASE WHEN public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500') ~ '^[0-9]{1,6}$'
                                                       THEN greatest(1, public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500')::integer)
                                                       ELSE 1500 END) / 1000.0);
  -- V503: nhận cả lô (claim_batch_v1) đặt một mốc chung cho mọi lần nhận trong lô, để cả lời gọi không chạm trần 3 giây của Desktop.
  IF nullif(current_setting('aka.engine.claim_deadline', true), '') IS NOT NULL THEN
    v_cd_deadline := least(v_cd_deadline, current_setting('aka.engine.claim_deadline', true)::timestamptz);
  END IF;
  -- V564: đăng nhóm bật "Xáo trộn danh sách group" (lưu kiểu boolean, đo 18/11): xáo khi nhận data kế tiếp của lượt; nhận theo danh sách
  -- inputDataIds (nhóm chia sẻ kèm) và lượt theo lịch không xáo. Mọi chiến dịch khác giữ câu chọn theo d.id + 0 (V532).
  v_shuffle := NOT v_slot_mode AND v_only_ids IS NULL AND c.action_id = 'facebook_group_post'
    AND coalesce(c.extra_settings->'shuffleGroupList' = 'true'::jsonb, false);
  LOOP
    EXIT WHEN v_slot_mode;
    -- V532: sắp theo d.id + 0 (cùng thứ tự) để planner không đi khoá chính auto_campaign_input_data_pkey. Kế hoạch theo tham số có lúc
    -- quét khoá chính từ id nhỏ nhất rồi lọc theo chiến dịch (chiến dịch 34061 ngày 14/11/2026: lọc 12,26 triệu dòng, 6,8 giây, quá
    -- trần 3 giây của Desktop). Sắp theo biểu thức buộc lấy data của chiến dịch qua chỉ mục theo chiến dịch rồi mới sắp (vài chục ms).
    IF v_shuffle THEN
      -- V564: thứ tự ngẫu nhiên theo lượt (md5 theo lease): trong lượt giữ nguyên, lượt sau (lease mới) khác, như bộ cũ xáo ở đầu lượt.
      SELECT d.* INTO t FROM public.auto_campaign_input_data d
       WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
         AND (d.schedule IS NULL OR d.schedule <= v_now)
         AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)
         AND d.id <> ALL (v_cd_skip)
       ORDER BY md5(d.id::text || v_token::text), d.id LIMIT 1 FOR UPDATE SKIP LOCKED;
    ELSE
      SELECT d.* INTO t FROM public.auto_campaign_input_data d
       WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
         AND (d.schedule IS NULL OR d.schedule <= v_now)
         AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)
         AND d.id <> ALL (v_cd_skip)
         AND (v_only_ids IS NULL OR d.id = ANY (v_only_ids))
       ORDER BY d.id + 0 LIMIT 1 FOR UPDATE SKIP LOCKED;
    END IF;
    v_found := FOUND;
    EXIT WHEN NOT v_found OR NOT v_cooldown;
    v_cd_decision := NULL; v_cd_note := NULL; v_cd_error := NULL;
    BEGIN
      EXECUTE 'SELECT x.decision, x.note FROM public.aka_agent_apply_campaign_delivery_cooldown($1, $2, $3, ARRAY[$4]::bigint[]) x'
        INTO v_cd_decision, v_cd_note USING v_campaign_id, v_account_id, v_staff, t.id;
    EXCEPTION WHEN OTHERS THEN
      v_cd_error := SQLERRM;
    END;
    IF v_cd_error IS NOT NULL THEN
      IF coalesce((SELECT g.on_error FROM public.auto_engine_gates g WHERE g.code = 'delivery_cooldown'), 'closed') = 'open' THEN EXIT; END IF;
      -- Như Desktop: chiến dịch chờ, ghi chú lý do, tự thử lại ở nhịp sau; data giữ nguyên.
      v_wait_note := 'Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: Không thể kiểm tra lịch sử gửi/đăng gần nhất: ' || v_cd_error;
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = v_wait_note, updated_at = v_now
       WHERE id = v_campaign_id AND (status IS DISTINCT FROM 'chờ xử lý' OR note IS DISTINCT FROM v_wait_note);
      RETURN jsonb_build_object('status', 'gate_unavailable', 'leaseToken', v_token, 'gate', 'delivery_cooldown', 'note', v_wait_note,
        'cooldownPaused', v_cd_paused);
    END IF;
    EXIT WHEN v_cd_decision = 'allowed';
    IF v_cd_decision IN ('paused_recent_delivery', 'paused_unidentifiable') THEN
      v_cd_paused := v_cd_paused || jsonb_build_object('inputDataId', t.id, 'name', t.name, 'phone', t.phone, 'uid', t.uid, 'email', t.email,
        'note', coalesce(nullif(btrim(v_cd_note), ''), 'Tạm dừng vì giới hạn gửi/đăng lặp.'));
    END IF;
    v_cd_skip := v_cd_skip || t.id;
    v_cd_scanned := v_cd_scanned + 1;
    IF v_cd_scanned >= 50 OR clock_timestamp() >= v_cd_deadline THEN
      RETURN jsonb_build_object('status', 'cooldown_scan', 'leaseToken', v_token, 'cooldownPaused', v_cd_paused);
    END IF;
  END LOOP;
  IF NOT v_found AND NOT v_slot_mode THEN
    RETURN jsonb_build_object('status', 'no_target', 'leaseToken', v_token,
      'nextSchedule', (SELECT min(d.schedule) FROM public.auto_campaign_input_data d
                        WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false AND d.schedule > v_now),
      'runningTargets', (SELECT count(*) FROM public.auto_campaign_input_data d
                          WHERE d.campaign_id = v_campaign_id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false),
      -- Chiến dịch chưa có data nào (khác "đã chạy hết"): host có thể chờ nguồn bơm data thay vì hoàn thành.
      'hasTargets', EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                             WHERE d.campaign_id = v_campaign_id AND coalesce(d.is_delete, false) = false),
      -- V501: data đến hạn đã thử trong lượt này (về hàng đợi): lượt kết thúc, lượt sau thử lại.
      'dueTried', (SELECT count(*) FROM public.auto_campaign_input_data d
                    WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
                      AND (d.schedule IS NULL OR d.schedule <= v_now)
                      AND EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)),
      'dataGroup', c.data_target_source_mode = 'data_group',
      'cooldownPaused', v_cd_paused);
  END IF;

  v_target_key := public.aka_agent_engine_target_key(t.phone, t.uid, t.email);
  -- V571: chiến dịch nhắn người lạ (theo SĐT / theo UID), không kiêm SMS, tổ chức bật engine.target_check: tra sổ theo SĐT và global id
  -- (UID gắn theo tài khoản nên lấy global id ở zalo_users). Bước tương ứng nhận quyết định skip ở vòng dưới. Kiểm lỗi thì coi như chưa
  -- biết (chạy như thường).
  IF NOT v_slot_mode AND c.action_id IN ('zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_friend_recommendation', 'zalo_message_remarketing_customer')
     AND NOT coalesce(c.extra_settings->'internalSmsEnabled' = 'true'::jsonb, false)
     AND NOT coalesce(c.extra_settings->'externalSmsEnabled' = 'true'::jsonb, false)
     AND private.aka_agent_engine_target_check_on(c.organization_id) THEN
    BEGIN
      IF nullif(btrim(coalesce(t.uid, '')), '') IS NOT NULL THEN
        SELECT nullif(btrim(coalesce(zu.global_id, '')), ''), coalesce(zu.is_fr = 1, false) INTO v_tc_global, v_tc_friend
          FROM public.zalo_users zu WHERE zu.account_id = v_account_id AND zu.zalo_uid = btrim(t.uid) LIMIT 1;
        v_tc_friend := coalesce(v_tc_friend, false);
      END IF;
      SELECT jsonb_object_agg(x.action_code, x.error_code) INTO v_tc FROM private.aka_agent_engine_target_check_probe(t.phone, v_tc_global) x;
    EXCEPTION WHEN OTHERS THEN
      v_tc := NULL;
    END;
    -- Chặn tin người lạ không áp với tài khoản đã là bạn bè.
    IF v_tc IS NOT NULL AND v_tc_friend THEN v_tc := v_tc - 'zalo_message_stranger'; END IF;
    IF v_tc = '{}'::jsonb THEN v_tc := NULL; END IF;
    -- "Nhắn tin theo SĐT": mọi bước gửi của chiến dịch đã biết hỏng và không tag Zalo / đổi tên / tag akaBiz (các bước cần kết quả tìm SĐT)
    -- thì bỏ luôn bước tìm SĐT; report tách thành một dòng cho mỗi bước gửi.
    IF v_tc IS NOT NULL AND c.action_id = 'zalo_message_phone' AND NOT (v_tc ? 'zalo_find_phone_user')
       AND NOT coalesce(c.extra_settings->'enableZaloTag' = 'true'::jsonb, false)
       AND NOT coalesce(c.extra_settings->'enableZaloAlias' = 'true'::jsonb, false)
       AND NOT coalesce(c.extra_settings->'enableAkaBizTag' = 'true'::jsonb, false) THEN
      -- (Bí danh "ja": "a" là biến bản ghi tài khoản của hàm.)
      SELECT CASE WHEN count(*) > 0 AND bool_and(v_tc ? (ja.value->>'code')) THEN jsonb_object_agg(ja.value->>'code', v_tc->(ja.value->>'code')) END
        INTO v_tc_sends
        FROM jsonb_array_elements(coalesce(p_ctx->'actions', '[]'::jsonb)) ja WHERE ja.value->>'code' <> 'zalo_find_phone_user';
    END IF;
  END IF;
  FOR v_act IN SELECT x.value FROM jsonb_array_elements(coalesce(p_ctx->'actions', '[]'::jsonb)) x LOOP
    v_code := v_act->>'code';
    v_required := coalesce((v_act->>'required')::boolean, true);
    v_decision := jsonb_build_object('decision', 'allow');

    SELECT s.is_disable, s.date_enable, s.disabled_error_code INTO v_lock
      FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
    IF FOUND AND v_lock.is_disable AND (v_lock.date_enable IS NULL OR v_lock.date_enable > v_now) THEN
      v_decision := jsonb_build_object('decision', 'wait', 'gate', 'action_lock', 'errorCode', v_lock.disabled_error_code, 'until', v_lock.date_enable);
    END IF;

    -- Hạn mức tính trong DB theo đúng công thức của bộ chạy Desktop/VPS (aka_agent_engine_action_limit).
    -- V505: thao tác khai "quota": false chỉ kiểm khoá, không kiểm hạn mức (huỷ lời mời kết bạn: limit_check_action_codes rỗng ở bản cũ).
    v_limit := CASE WHEN v_act->'quota' = 'false'::jsonb THEN NULL
                    ELSE public.aka_agent_engine_action_limit(v_campaign_id, v_account_id, v_code) END;
    IF v_decision->>'decision' = 'allow' AND v_limit IS NOT NULL THEN
      v_daily := (v_limit->>'daily')::numeric;
      v_window_count := (v_limit->>'windowCount')::numeric;
      v_window_minutes := (v_limit->>'windowMinutes')::numeric;
      IF coalesce(v_daily, 0) > 0 THEN
        SELECT CASE WHEN s.count_date = v_vn THEN s.count_action_in_day ELSE 0 END INTO v_used
          FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
        IF coalesce(v_used, 0) >= v_daily THEN
          v_decision := jsonb_build_object('decision', 'wait', 'gate', 'quota', 'errorCode', 'error_limit_in_day',
            'until', date_trunc('day', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' + interval '1 day');
        END IF;
      END IF;
      IF v_decision->>'decision' = 'allow' AND coalesce(v_window_count, 0) > 0 AND coalesce(v_window_minutes, 0) > 0 THEN
        SELECT count(*), min(x.at) INTO v_used, v_oldest FROM (
          -- Như countLimitDetailsInWindow của bộ chạy: không lọc is_delete.
          SELECT d.created_at AS at FROM public.auto_campaign_details d
           WHERE d.account_id = v_account_id AND d.action_code = v_code
             AND d.created_at >= v_now - make_interval(secs => (v_window_minutes * 60)::double precision)
             AND (d.counts_toward_limit IS TRUE OR (d.counts_toward_limit IS NULL AND d.status IN ('thành công', 'thất bại')))
          UNION ALL
          SELECT (m.value->>'markedAt')::timestamptz FROM public.auto_engine_target_runs rr, jsonb_array_elements(rr.marks) m
           WHERE rr.account_id = v_account_id AND rr.completed_at IS NULL
             AND m.value->>'actionCode' = v_code AND m.value->>'state' = 'pending'
        ) x;
        IF v_used >= v_window_count THEN
          -- Như bộ chạy: chờ tới khi lượt cũ nhất ra khỏi khung, ít nhất 60 giây.
          v_decision := jsonb_build_object('decision', 'wait', 'gate', 'quota', 'errorCode', 'error_limit_in_hour',
            'until', greatest(v_now + interval '60 seconds', v_oldest + make_interval(secs => (v_window_minutes * 60)::double precision)));
        END IF;
      END IF;
    END IF;

    -- Quét data website: một data (từ khoá) tốn nhiều lượt (mỗi lần hiện SĐT / mở trang một lượt), nên trả số lượt còn lại trong ngày và
    -- trong khung giờ để block dừng đúng lúc; hết lượt giữa từ khoá thì từ khoá về hàng đợi, lần nhận sau chờ theo hạn mức như mọi thao tác.
    IF v_code LIKE 'web\_%' AND v_decision->>'decision' = 'allow' AND v_limit IS NOT NULL THEN
      v_web_day := NULL; v_web_window := NULL;
      SELECT CASE WHEN s.count_date = v_vn THEN s.count_action_in_day ELSE 0 END INTO v_web_day
        FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
      SELECT count(*) INTO v_web_window FROM public.auto_campaign_details d
       WHERE d.account_id = v_account_id AND d.action_code = v_code
         AND d.created_at >= v_now - make_interval(secs => ((v_limit->>'windowMinutes')::numeric * 60)::double precision)
         AND (d.counts_toward_limit IS TRUE OR (d.counts_toward_limit IS NULL AND d.status IN ('thành công', 'thất bại')));
      v_decision := v_decision || jsonb_build_object(
        'remainingDaily', greatest((v_limit->>'daily')::numeric - coalesce(v_web_day, 0), 0),
        'remainingWindow', greatest((v_limit->>'windowCount')::numeric - coalesce(v_web_window, 0), 0));
    END IF;

    -- V571: người nhận đã biết hỏng: bước tìm SĐT bỏ qua kể cả khi đang khoá / hết lượt (không gọi Zalo, không tính lượt); bước gửi chỉ bỏ
    -- qua khi đang được phép (đang chờ thì vẫn chờ như thường) và khi bước tìm SĐT không bị bỏ.
    IF v_tc IS NOT NULL THEN
      IF v_code = 'zalo_find_phone_user' THEN
        IF v_tc ? v_code THEN
          v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc->>v_code);
        ELSIF v_tc_sends IS NOT NULL THEN
          v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc_sends::text);
        END IF;
      ELSIF v_tc ? v_code AND v_tc_sends IS NULL AND NOT (c.action_id = 'zalo_message_phone' AND v_tc ? 'zalo_find_phone_user')
            AND v_decision->>'decision' = 'allow' THEN
        v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc->>v_code);
      END IF;
    END IF;

    -- Thao tác không bắt buộc chỉ được bỏ qua với các cổng khai trong skippableGates (không khai = mọi cổng),
    -- như preflightActions: hết lượt thì bỏ qua được, đang bị khoá thì không.
    IF NOT v_required AND v_decision->>'decision' = 'wait' AND jsonb_typeof(v_act->'skippableGates') = 'array'
       AND NOT (v_act->'skippableGates' ? coalesce(v_decision->>'gate', '')) THEN
      v_required := true;
    END IF;
    IF v_decision->>'decision' = 'wait' THEN
      v_decision := v_decision || jsonb_build_object('note', regexp_replace(
        public.aka_agent_engine_wait_note(v_decision->>'errorCode', nullif(v_decision->>'until', '')::timestamptz), '^⏳ ', ''));
    END IF;
    v_decisions := v_decisions || jsonb_build_object(v_code, v_decision || jsonb_build_object('required', v_required));
    IF v_required AND v_decision->>'decision' = 'wait' AND v_target_wait IS NULL THEN v_target_wait := v_decision; END IF;
  END LOOP;
  -- requireAny: cả nhóm thao tác đều phải chờ thì không nhận data (không tra số khi không gửi được gì),
  -- hẹn lại theo thao tác mở sớm nhất.
  IF v_target_wait IS NULL AND jsonb_typeof(p_ctx->'requireAny') = 'array' AND jsonb_array_length(p_ctx->'requireAny') > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_ctx->'requireAny') q(code)
                      WHERE coalesce(v_decisions->q.code->>'decision', 'allow') <> 'wait') THEN
    SELECT v_decisions->q.code INTO v_target_wait FROM jsonb_array_elements_text(p_ctx->'requireAny') q(code)
     ORDER BY nullif(v_decisions->q.code->>'until', '')::timestamptz NULLS LAST LIMIT 1;
  END IF;

  -- Bước bắt buộc phải chờ (khoá / hạn mức): không nhận data. V501 (G2): như Desktop, KHÔNG dời lịch chiến dịch (dời lịch
  -- sang ngày sau làm chiến dịch thoát bảo trì lịch ngày mới, chạy lúc 00:00 hay vào ngày không hẹn, và đổi giờ gốc của lịch
  -- lặp khi original_schedule rỗng); chỉ ghi câu chờ khi đổi. Nơi chạy nhớ wait.until để không hỏi lại liên tục.
  IF v_target_wait IS NOT NULL THEN
    v_wait_note := public.aka_agent_engine_wait_note(v_target_wait->>'errorCode', nullif(v_target_wait->>'until', '')::timestamptz);
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = v_wait_note, updated_at = v_now
     WHERE id = v_campaign_id AND (status IS DISTINCT FROM 'chờ xử lý' OR note IS DISTINCT FROM v_wait_note);
    RETURN jsonb_build_object('status', 'wait', 'leaseToken', v_token, 'wait', v_target_wait, 'actions', v_decisions, 'cooldownPaused', v_cd_paused);
  END IF;

  -- V564: lần nhận đầu của lượt ở chiến dịch xáo trộn (lease mới, hoặc lõi báo lượt chưa nhận data nào: lần gọi trước trả cooldown_scan đã
  -- cấp lease): số data chờ đến hạn lúc bắt đầu lượt (kể cả data vừa nhận, chưa chuyển "đang chạy"), để lõi in "🔀 Đã xáo trộn danh sách N
  -- group" như bộ cũ (N > 1).
  IF v_shuffle AND (v_req_token IS DISTINCT FROM v_token OR p_ctx->>'unitStarted' = 'false') THEN
    SELECT count(*)::integer INTO v_shuffle_count FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
       AND (d.schedule IS NULL OR d.schedule <= v_now);
  END IF;

  -- Trigger phân quyền ứng dụng (V445) có thể từ chối chuyển "đang chạy": hoàn tác cả bước nhận data
  -- và giữ chỗ, trả trạng thái rõ ràng thay vì lỗi.
  BEGIN
    UPDATE public.auto_campaign_input_data SET status = 'đang chạy' WHERE id = t.id;
    -- Ghi lịch = lúc nhận khi lịch còn là ngày cũ: cổng bảo trì của bộ cũ đếm chiến dịch "đang chạy" có lịch
    -- trước đầu ngày, nên chiến dịch của bộ mới không được giữ cổng đó đóng.
    -- V501 (G6): bắt đầu chạy thì xoá ghi chú (câu chờ cũ), như claim của bản cũ (v397). Lịch ngày cũ chỉ còn tới đây với
    -- hằng ngày không chạy tiếp hôm sau (G1 ở trên).
    UPDATE public.auto_campaigns SET status = 'đang chạy',
           schedule = CASE WHEN schedule IS NULL OR schedule < (v_vn::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN v_now ELSE schedule END,
           note = CASE WHEN status = 'chờ xử lý' THEN NULL ELSE note END,
           updated_at = v_now
     WHERE id = v_campaign_id
       AND (status = 'chờ xử lý' OR schedule IS NULL OR schedule < (v_vn::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'));
    IF a.status = 'chờ xử lý' THEN UPDATE public.auto_accounts SET status = 'đang chạy', updated_at = v_now WHERE id = v_account_id; END IF;
    INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id, runtime_target, started_at,
      slot_at)
    VALUES (CASE WHEN v_slot_mode THEN NULL ELSE t.id END, v_campaign_id, v_account_id, v_staff, c.organization_id, v_token, v_runner, v_runtime, v_now,
      CASE WHEN v_slot_mode THEN v_slot END)
    RETURNING id INTO v_run_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'app_access%' THEN RAISE; END IF;
    DELETE FROM public.auto_engine_leases WHERE account_id = v_account_id AND lease_token = v_token;
    RETURN jsonb_build_object('status', 'app_access_denied', 'reason', SQLERRM);
  END;

  RETURN jsonb_build_object('status', 'claimed', 'targetRunId', v_run_id, 'leaseToken', v_token,
    'leaseExpiresAt', v_now + make_interval(secs => v_lease_seconds),
    'target', CASE WHEN v_slot_mode
                THEN jsonb_build_object('id', NULL, 'campaign_id', c.id, 'name', c.name, 'phone', NULL, 'uid', NULL, 'email', NULL,
                       'status', 'đang chạy', 'slotAt', v_slot)
                ELSE (to_jsonb(t) - 'status') || jsonb_build_object('status', 'đang chạy') END,
    'targetKey', v_target_key, 'actions', v_decisions,
    -- Cấu hình cổng kiểm cho adapter (on_error: open = lỗi kiểm vẫn gửi; closed = chờ rồi thử lại).
    'gates', (SELECT coalesce(jsonb_object_agg(g.code, jsonb_build_object('onError', g.on_error)), '{}'::jsonb) FROM public.auto_engine_gates g),
    'campaign', jsonb_build_object('id', c.id, 'actionId', c.action_id, 'status', 'đang chạy'),
    'cooldownPaused', v_cd_paused)
    -- V564: chỉ chiến dịch xáo trộn, lần nhận đầu của lượt; câu trả lời của mọi chiến dịch khác không đổi.
    || CASE WHEN v_shuffle_count IS NOT NULL THEN jsonb_build_object('shuffle', jsonb_build_object('count', v_shuffle_count)) ELSE '{}'::jsonb END;
END $function$
;

DROP FUNCTION private.aka_agent_send_exclusion_precheck(public.auto_campaigns,bigint,text,text);
DROP FUNCTION private.aka_agent_send_exclusion_precheck_on(public.auto_campaigns,bigint);
DROP FUNCTION private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean);
DROP FUNCTION private.aka_agent_send_exclusion_person_keys(bigint,text,text,text,text);
DO $post$
DECLARE r record; v_md5 text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('private.aka_agent_send_exclusion_snapshot(public.auto_campaigns,bigint,boolean)','8c0597c63fafacb582d3ff68edad1dcd'),
   ('private.aka_agent_send_exclusion_block_facts(public.auto_campaigns,bigint,text,text,jsonb)','5a7eeb467101885c205d4a5664bdd04b'),
   ('private.aka_agent_send_exclusion_remote(public.auto_campaigns,bigint,bigint,jsonb)','4d7a0ba564f7b0d044c9399aeb8571dc'),
   ('public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)','23065cacf4237d2f64398fd6062febbf'),
   ('public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)','b5418f8ac90c295c4b0fabd6a478a2a7'),
   ('public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)','525eb62d61c48acec5b43aa8c636676a'),
   ('public.aka_agent_engine_claim_target_v1(jsonb)','acf4f9d47113ae5c7ee110d96ef1b97c')) v(sig, md5) LOOP
  SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO v_md5;
  IF v_md5 IS DISTINCT FROM r.md5 THEN RAISE EXCEPTION 'Gỡ V657 p2: % không về bản production (md5 %)', r.sig, v_md5; END IF;
 END LOOP;
END $post$;
DELETE FROM supabase_migrations.schema_migrations WHERE name='migration_v657_send_exclusion_global_match_p2';
COMMIT;

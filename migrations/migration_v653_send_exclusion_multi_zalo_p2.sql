-- V653 p2: hàm DB cho loại trừ gửi theo nhiều Zalo, Nhóm data và chiến dịch đã gửi. Chạy sau p1 (và nên sau chỉ mục
-- idx_zalo_users_account_global_id của migration_v653_send_exclusion_multi_zalo_index.sql: thiếu chỉ mục thì tra Zalo ID chung
-- quét mọi người dùng Zalo của tài khoản).
-- Phương án: docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md.
--
-- Cấu hình chiến dịch (extra_settings.zaloSendExclusionsByAccountId[<Zalo gửi>]):
--   {groupId, blocklistIds, dataGroupIds?, sentCampaignIds?}. groupId: nhóm của nhân viên, gồm 1–20 khối (mỗi khối là
--   điều kiện của một Zalo, giữa các khối là HOẶC). blocklistIds: danh sách bạn bè/Zalo ID của mọi Zalo của nhân viên.
--   dataGroupIds: Nhóm data Số điện thoại / Zalo User theo UID của nhân viên hoặc được chia sẻ (≤20). sentCampaignIds:
--   chiến dịch nhắn tin Zalo của nhân viên (≤20, kể cả đã xoá); khách đã được gửi tin thành công ở chiến dịch đó thì không gửi.
--
-- Hàm:
--   * aka_agent_send_exclusion_v2 (mới, Desktop theo phiên + service_role cho API Web): page / options / lists / save.
--   * aka_agent_send_exclusion_groups (cũ, form bản cũ): chỉ thấy nhóm một khối của đúng Zalo; không lưu được nhóm nhiều khối
--     (send_exclusion_group_requires_update) để form cũ không xoá mất khối.
--   * aka_agent_campaign_send_exclusion_runtime (bộ chạy cũ) và aka_agent_engine_send_exclusion_v1 (engine v2):
--     'snapshot' nhận {"clientVersion":2} thì trả thêm khối của Zalo khác + danh sách cần tra trong DB ('remote'); không gửi
--     clientVersion mà cấu hình cần bản mới thì từ chối send_exclusion_client_outdated (app cũ tạm dừng chiến dịch, không gửi
--     sai). Thao tác mới 'remote' trả lý do khớp danh sách (Zalo ID của Zalo khác, Nhóm data, chiến dịch đã gửi) và dữ kiện
--     trong DB của khối các Zalo khác. 'facts', 'pause', 'friend_blocklist' giữ nguyên.
--   * aka_agent_internal_send_exclusion_group: chỉ trả điều kiện của khối Zalo chính (giữ hình dạng cũ).
--   * aka_agent_internal_validate_send_exclusion_selection + trigger auto_validate_campaign_send_exclusion: kiểm khoá mới.
-- CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm. Gỡ: rollback_v653_send_exclusion_multi_zalo.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE v_expected jsonb := '{
  "public.aka_agent_internal_send_exclusion_group(bigint)": "c73d260df8ba115c2ec059b7c3c138d8",
  "public.aka_agent_internal_validate_send_exclusion_selection(jsonb,bigint,bigint,bigint)": "af9913da69c3a16e921369744524f8cd",
  "public.auto_validate_campaign_send_exclusion()": "31518a224d65996ee64ccafa2bd4b008",
  "public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)": "0aaf3c6bc86bcdec10c94ed9ce21426a",
  "public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)": "521414d40664c567b8f89f4dee5add9c",
  "public.aka_agent_send_exclusion_groups(bigint,bigint,bigint,text,jsonb,text,text)": "43c3bb89ce08fcb59ab2e0b9fda68ee5"
}'::jsonb; v_key text; v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v653_%p2%') THEN
      RAISE EXCEPTION 'V653 p2: sổ migration đã có bản p2, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_campaign_send_exclusion_group_accounts') IS NULL THEN
    RAISE EXCEPTION 'V653 p2: chưa apply p1';
  END IF;
  IF to_regprocedure('public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'V653 p2: hàm aka_agent_send_exclusion_v2 đã có';
  END IF;
  IF to_regprocedure('private.group_access(text,bigint,bigint,bigint)') IS NULL THEN
    RAISE EXCEPTION 'V653 p2: thiếu private.group_access';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key);
    IF v_md5 IS DISTINCT FROM v_expected->>v_key THEN
      RAISE EXCEPTION 'V653 p2 preflight: thân % là %, cần %', v_key, v_md5, v_expected->>v_key;
    END IF;
  END LOOP;
END $guard$;

-- ===================================================================================================== đọc nhóm
CREATE OR REPLACE FUNCTION public.aka_agent_internal_send_exclusion_group(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 -- V653: hình dạng cũ (một khối) cho app/hàm cũ: điều kiện của khối Zalo chính của nhóm.
 SELECT jsonb_build_object('id',g.id,'requestId',g.create_request_id,'accountId',g.account_id,'name',g.name,'matchMode',g.match_mode,'revision',g.revision,
 'rules',COALESCE((SELECT jsonb_agg(jsonb_build_object('fieldId',r.field_id,'operatorId',r.operator_id,'value',r.value,'isEnabled',r.is_enabled,'sortOrder',r.sort_order) ORDER BY r.sort_order,r.id)
   FROM public.auto_campaign_send_exclusion_rules r JOIN public.auto_campaign_send_exclusion_group_accounts ga ON ga.id=r.group_account_id AND ga.account_id=g.account_id
   WHERE r.group_id=g.id),'[]'))
 FROM public.auto_campaign_send_exclusion_groups g WHERE g.id=p_id AND NOT g.is_delete;
$function$;

CREATE FUNCTION private.aka_agent_send_exclusion_group_v2(p_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT jsonb_build_object('id',g.id,'requestId',g.create_request_id,'accountId',g.account_id,'name',g.name,'matchMode',g.match_mode,
  'revision',g.revision,'version',g.version,
  'blocks',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ga.id,'accountId',ga.account_id,'accountName',a.name,
     'accountDeleted',(a.id IS NULL OR a.is_delete OR a.staff_id IS DISTINCT FROM g.staff_id OR a.organization_id IS DISTINCT FROM g.organization_id),
     'matchMode',ga.match_mode,'sortOrder',ga.sort_order,
     'rules',COALESCE((SELECT jsonb_agg(jsonb_build_object('fieldId',r.field_id,'operatorId',r.operator_id,'value',r.value,'isEnabled',r.is_enabled,'sortOrder',r.sort_order) ORDER BY r.sort_order,r.id)
       FROM public.auto_campaign_send_exclusion_rules r WHERE r.group_account_id=ga.id),'[]')) ORDER BY ga.sort_order,ga.id)
   FROM public.auto_campaign_send_exclusion_group_accounts ga LEFT JOIN public.auto_accounts a ON a.id=ga.account_id WHERE ga.group_id=g.id),'[]'))
 FROM public.auto_campaign_send_exclusion_groups g WHERE g.id=p_id AND NOT g.is_delete;
$function$;

-- ===================================================================================================== khoá cấu hình
CREATE FUNCTION private.aka_agent_send_exclusion_ids(p_value jsonb)
 RETURNS bigint[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN jsonb_typeof(p_value)='array' THEN ARRAY(SELECT DISTINCT (v#>>'{}')::bigint FROM jsonb_array_elements(p_value) v
   WHERE jsonb_typeof(v)='number' AND (v#>>'{}') ~ '^[0-9]{1,18}$' ORDER BY 1) ELSE ARRAY[]::bigint[] END;
$function$;

CREATE FUNCTION private.aka_agent_send_exclusion_needs_v2(p_selection jsonb, p_account bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 -- Cấu hình mà app/bộ chạy bản cũ không chạy đúng được.
 SELECT cardinality(private.aka_agent_send_exclusion_ids(p_selection->'dataGroupIds'))>0
  OR cardinality(private.aka_agent_send_exclusion_ids(p_selection->'sentCampaignIds'))>0
  OR EXISTS(SELECT 1 FROM public.auto_campaign_send_exclusion_groups g
     WHERE jsonb_typeof(p_selection->'groupId')='number' AND g.id=(p_selection->>'groupId')::bigint AND (g.version>1 OR g.account_id IS DISTINCT FROM p_account))
  OR EXISTS(SELECT 1 FROM public.auto_account_contact_groups b
     WHERE b.id=ANY(private.aka_agent_send_exclusion_ids(p_selection->'blocklistIds')) AND b.account_id IS DISTINCT FROM p_account);
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_validate_send_exclusion_selection(p_map jsonb, p_staff bigint, p_org bigint, p_account bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE entry record; aid bigint; gid bigint; ids bigint[]; block record; v_key text; v_n integer;
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
   -- V653: nhóm của nhân viên (mọi Zalo của nhân viên); kiểm điều kiện của từng khối theo Zalo của khối.
   -- Khối của Zalo đã xoá/không còn thuộc nhân viên không được xét lúc chạy nên không kiểm.
   IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_send_exclusion_groups g WHERE g.id=gid AND g.staff_id=p_staff AND g.organization_id=p_org AND NOT g.is_delete) THEN
    RAISE EXCEPTION 'send_exclusion_group_not_found';
   END IF;
   FOR block IN SELECT ga.id, ga.account_id FROM public.auto_campaign_send_exclusion_group_accounts ga
     JOIN public.auto_accounts a ON a.id=ga.account_id AND a.staff_id=p_staff AND a.organization_id=p_org AND a.flatform_type='zalo' AND NOT a.is_delete
     WHERE ga.group_id=gid ORDER BY ga.sort_order, ga.id LOOP
    PERFORM public.aka_agent_internal_validate_send_exclusion_rules(COALESCE((SELECT jsonb_agg(jsonb_build_object('fieldId',r.field_id,'operatorId',r.operator_id,'value',r.value,'isEnabled',r.is_enabled,'sortOrder',r.sort_order) ORDER BY r.sort_order,r.id)
      FROM public.auto_campaign_send_exclusion_rules r WHERE r.group_account_id=block.id),'[]'),p_staff,p_org,block.account_id);
   END LOOP;
  END IF;
  IF jsonb_typeof(entry.value->'blocklistIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'send_exclusion_blocklists_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->'blocklistIds') v WHERE jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<=0 OR trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric) THEN RAISE EXCEPTION 'send_exclusion_blocklists_invalid'; END IF;
  SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(entry.value->'blocklistIds')) INTO ids;
  -- V653: danh sách của mọi Zalo (còn) của nhân viên.
  IF cardinality(ids)<>(SELECT count(*) FROM public.auto_account_contact_groups g JOIN public.auto_accounts a ON a.id=g.account_id
    AND a.staff_id=p_staff AND a.organization_id=p_org AND a.flatform_type='zalo' AND NOT a.is_delete
    WHERE g.id=ANY(ids) AND g.staff_id=p_staff AND g.organization_id=p_org AND NOT g.is_delete AND g.purpose='zalo_friend_blocklist' AND g.contact_type='person') THEN RAISE EXCEPTION 'send_exclusion_blocklist_not_found'; END IF;
  FOREACH v_key IN ARRAY ARRAY['dataGroupIds','sentCampaignIds'] LOOP
   IF entry.value ? v_key AND (jsonb_typeof(entry.value->v_key) IS DISTINCT FROM 'array' OR jsonb_array_length(entry.value->v_key)>20
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->v_key) v WHERE jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<=0 OR trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric))
   THEN RAISE EXCEPTION 'send_exclusion_lists_invalid'; END IF;
  END LOOP;
  -- Nhóm data đã xoá: không còn loại trừ, không chặn lưu/chạy. Nhóm còn: phải dùng được (của mình hoặc được chia sẻ) và đúng loại.
  ids:=private.aka_agent_send_exclusion_ids(entry.value->'dataGroupIds');
  IF cardinality(ids)>0 THEN
   SELECT count(*) INTO v_n FROM public.auto_account_contact_groups g LEFT JOIN public.category_item ci ON ci.id=g.data_type_category_item_id
    WHERE g.id=ANY(ids) AND g.organization_id=p_org AND g.purpose='data_group'
     AND (g.is_delete OR (ci.code IN ('phone','zalo_person') AND private.group_access('data',g.id,p_staff,p_org) IS NOT NULL));
   IF v_n<>cardinality(ids) THEN RAISE EXCEPTION 'send_exclusion_data_group_not_found'; END IF;
  END IF;
  -- Chiến dịch đã gửi: của nhân viên, nhắn tin Zalo tới người; chiến dịch đã xoá vẫn loại trừ theo lịch sử của nó.
  ids:=private.aka_agent_send_exclusion_ids(entry.value->'sentCampaignIds');
  IF cardinality(ids)>0 AND cardinality(ids)<>(SELECT count(*) FROM public.auto_campaigns c WHERE c.id=ANY(ids) AND c.staff_id=p_staff AND c.organization_id=p_org
    AND c.action_id IN ('zalo_message_phone','zalo_message_friend','zalo_message_birthday','zalo_message_group_member','zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation'))
  THEN RAISE EXCEPTION 'send_exclusion_campaign_not_found'; END IF;
 END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_validate_campaign_send_exclusion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE entry record;
BEGIN
 IF TG_OP='UPDATE' AND NEW.extra_settings->'zaloSendExclusionsByAccountId' IS NOT DISTINCT FROM OLD.extra_settings->'zaloSendExclusionsByAccountId'
 AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
 PERFORM public.aka_agent_internal_validate_send_exclusion_selection(NEW.extra_settings->'zaloSendExclusionsByAccountId',NEW.staff_id,NEW.organization_id,NEW.account_id);
 -- V653: chiến dịch không loại trừ theo chính nó.
 IF NEW.id IS NOT NULL AND jsonb_typeof(NEW.extra_settings->'zaloSendExclusionsByAccountId')='object' THEN
  FOR entry IN SELECT * FROM jsonb_each(NEW.extra_settings->'zaloSendExclusionsByAccountId') LOOP
   IF NEW.id=ANY(private.aka_agent_send_exclusion_ids(entry.value->'sentCampaignIds')) THEN RAISE EXCEPTION 'send_exclusion_campaign_self'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END;
$function$;

-- ===================================================================================================== cấu hình một lượt chạy
CREATE FUNCTION private.aka_agent_send_exclusion_snapshot(p_campaign public.auto_campaigns, p_account bigint, p_v2 boolean)
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

-- ===================================================================================================== dữ kiện trong DB của một Zalo khác
CREATE FUNCTION private.aka_agent_send_exclusion_block_facts(p_campaign public.auto_campaigns, p_block_account bigint, p_global_id text, p_phone text, p_rules jsonb)
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

-- ===================================================================================================== 'remote': danh sách + khối Zalo khác
CREATE FUNCTION private.aka_agent_send_exclusion_remote(p_campaign public.auto_campaigns, p_account bigint, p_input_id bigint, p_payload jsonb)
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

-- ===================================================================================================== bộ chạy cũ (Desktop/App Server, ChatApi)
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
  -- V653: {"clientVersion":2} = bộ chạy hiểu nhiều Zalo / danh sách mới; bản cũ gặp cấu hình mới thì send_exclusion_client_outdated.
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

-- ===================================================================================================== engine v2 (V504)
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
      -- V653: cấu hình theo nhiều Zalo / danh sách mới chỉ chạy với lõi gửi {"clientVersion":2}.
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

-- ===================================================================================================== form bản cũ
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
  -- V653: form cũ chỉ thấy nhóm một khối của đúng Zalo này.
  RETURN jsonb_build_object('catalog',public.aka_agent_internal_send_exclusion_catalog(),
   'options',public.aka_agent_internal_send_exclusion_options(p_staff_id,p_organization_id,p_account_id),
   'groups',COALESCE((SELECT jsonb_agg(public.aka_agent_internal_send_exclusion_group(id) ORDER BY name,id) FROM public.auto_campaign_send_exclusion_groups WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND account_id=p_account_id AND version=1 AND NOT is_delete),'[]'),
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
  INSERT INTO public.auto_campaign_send_exclusion_group_accounts(group_id,account_id,match_mode,sort_order) VALUES(gid,p_account_id,p_payload->>'matchMode',0);
 ELSE
  -- V653: nhóm nhiều khối chỉ sửa được bằng form mới (form cũ sẽ làm mất khối của Zalo khác).
  IF EXISTS(SELECT 1 FROM public.auto_campaign_send_exclusion_groups g WHERE g.id=gid AND g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND NOT g.is_delete AND g.version>1) THEN
   RAISE EXCEPTION 'send_exclusion_group_requires_update';
  END IF;
  UPDATE public.auto_campaign_send_exclusion_groups g SET name=btrim(p_payload->>'name'),match_mode=p_payload->>'matchMode',revision=g.revision+1,updated_at=now()
   WHERE g.id=gid AND g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND g.account_id=p_account_id AND NOT g.is_delete AND g.revision=(p_payload->>'revision')::bigint RETURNING g.revision INTO revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_revision_conflict'; END IF;
  DELETE FROM public.auto_campaign_send_exclusion_rules WHERE group_id=gid;
  INSERT INTO public.auto_campaign_send_exclusion_group_accounts(group_id,account_id,match_mode,sort_order) VALUES(gid,p_account_id,p_payload->>'matchMode',0)
   ON CONFLICT (group_id,account_id) DO UPDATE SET match_mode=EXCLUDED.match_mode;
 END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_payload->'rules') LOOP
  INSERT INTO public.auto_campaign_send_exclusion_rules(group_id,field_id,operator_id,value,is_enabled,sort_order)
  VALUES(gid,(r->>'fieldId')::bigint,(r->>'operatorId')::bigint,COALESCE(r->'value','null'),COALESCE((r->>'isEnabled')::boolean,false),COALESCE((r->>'sortOrder')::integer,0));
 END LOOP;
 RETURN public.aka_agent_internal_send_exclusion_group(gid);
END;
$function$;

-- ===================================================================================================== form mới (Desktop + API Web)
CREATE FUNCTION public.aka_agent_send_exclusion_v2(p_staff_id bigint, p_organization_id bigint, p_operation text, p_payload jsonb, p_auth_username text, p_auth_password text)
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
  v_account:=CASE WHEN jsonb_typeof(p_payload->'accountId')='number' THEN (p_payload->>'accountId')::bigint END;
  IF v_account IS NULL OR NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=v_account AND staff_id=p_staff_id AND organization_id=p_organization_id AND flatform_type='zalo' AND NOT is_delete) THEN
   RAISE EXCEPTION 'send_exclusion_account_not_found';
  END IF;
  RETURN jsonb_build_object('accountId',v_account,'options',public.aka_agent_internal_send_exclusion_options(p_staff_id,p_organization_id,v_account));
 END IF;

 IF p_operation='lists' THEN
  v_query:=NULLIF(left(btrim(COALESCE(p_payload->>'query','')),100),'');
  v_exclude:=CASE WHEN jsonb_typeof(p_payload->'excludeCampaignId')='number' THEN (p_payload->>'excludeCampaignId')::bigint END;
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
          AND d.status IN ('thành công','đã gửi','đã nhận','đã xem','đã click') AND d.action_code IN ('zalo_message_friend','zalo_message_stranger') LIMIT 100001) d)) item
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
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_blocks) b WHERE jsonb_typeof(b->'accountId') IS DISTINCT FROM 'number' OR COALESCE(b->>'matchMode','') NOT IN ('and','or'))
   OR (SELECT count(DISTINCT b->>'accountId') FROM jsonb_array_elements(v_blocks) b)<>jsonb_array_length(v_blocks) THEN RAISE EXCEPTION 'send_exclusion_blocks_invalid'; END IF;
 FOR v_block IN SELECT * FROM jsonb_array_elements(v_blocks) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=(v_block->>'accountId')::bigint AND staff_id=p_staff_id AND organization_id=p_organization_id AND flatform_type='zalo' AND NOT is_delete) THEN
   RAISE EXCEPTION 'send_exclusion_account_not_found';
  END IF;
  PERFORM public.aka_agent_internal_validate_send_exclusion_rules(v_block->'rules',p_staff_id,p_organization_id,(v_block->>'accountId')::bigint);
 END LOOP;
 v_n:=jsonb_array_length(v_blocks);
 v_primary:=(v_blocks->0->>'accountId')::bigint;
 gid:=CASE WHEN jsonb_typeof(p_payload->'id')='number' THEN (p_payload->>'id')::bigint END;
 IF gid IS NULL THEN
  v_request:=(p_payload->>'requestId')::uuid;
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
     AND jsonb_typeof(p_payload->'revision')='number' AND g.revision=(p_payload->>'revision')::bigint RETURNING g.revision INTO v_revision;
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

-- ===================================================================================================== quyền
REVOKE ALL ON FUNCTION private.aka_agent_send_exclusion_group_v2(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_send_exclusion_ids(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_send_exclusion_needs_v2(jsonb,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_send_exclusion_snapshot(public.auto_campaigns,bigint,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_send_exclusion_block_facts(public.auto_campaigns,bigint,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_send_exclusion_remote(public.auto_campaigns,bigint,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text) FROM PUBLIC;
DO $grant$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text) FROM %I', v_role);
    END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['service_role','aka_agent_desktop'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text) TO %I', v_role);
    END IF;
  END LOOP;
END $grant$;

DO $post$
DECLARE v_bad bigint;
BEGIN
  -- Mọi nhóm hiện có vẫn đọc ra đúng hình dạng cũ.
  SELECT count(*) INTO v_bad FROM public.auto_campaign_send_exclusion_groups g
   WHERE NOT g.is_delete AND public.aka_agent_internal_send_exclusion_group(g.id) IS NULL;
  IF v_bad<>0 THEN RAISE EXCEPTION 'V653 p2 postflight: % nhóm không đọc được', v_bad; END IF;
  IF NOT has_function_privilege('service_role','public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'V653 p2 postflight: service_role chưa có quyền aka_agent_send_exclusion_v2';
  END IF;
END $post$;
COMMIT;

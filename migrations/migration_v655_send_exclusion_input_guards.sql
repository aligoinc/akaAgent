-- V655: chặn tham số sai kiểu ở các hàm loại trừ gửi (sau V654), sửa số "đã gửi" trong danh sách chiến dịch.
-- Sinh bằng: node scripts/build-v655-sql.cjs (không sửa tay). Tìm ra bằng scripts/send-exclusion-v654-fuzz.cjs.
--   * aka_agent_send_exclusion_v2: accountId / excludeCampaignId / id / revision / requestId sai kiểu (số thực, âm, quá lớn,
--     chuỗi, uuid sai) trả mã send_exclusion_* thay vì lỗi ép kiểu; số "đã gửi" của danh sách chiến dịch tính cả kết quả
--     operationState committed như bước loại trừ.
--   * aka_agent_internal_validate_send_exclusion_selection: khoá Zalo không phải số, groupId / id danh sách là số thực hoặc quá lớn.
--   * aka_agent_internal_validate_send_exclusion_rules (dùng chung form cũ và mới): fieldId / operatorId / isEnabled / sortOrder sai
--     kiểu báo send_exclusion_rules_invalid. App và API Web luôn gửi đúng kiểu nên không đổi hành vi của cấu hình đang có.
-- CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema. Gỡ: rollback_v655_send_exclusion_input_guards.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE v_expected jsonb := '{"public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)":"6620a8bda64da5a6cc5235cc400c8a9e","public.aka_agent_internal_validate_send_exclusion_selection(jsonb,bigint,bigint,bigint)":"70f4027f6037cf6fcc9e608771f6f252","public.aka_agent_internal_validate_send_exclusion_rules(jsonb,bigint,bigint,bigint)":"f5137095425480507d0eb44ab65990a9"}'::jsonb; v_key text; v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v655_%') THEN
      RAISE EXCEPTION 'V655: sổ migration đã có bản này, không chạy lại';
    END IF;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key);
    IF v_md5 IS DISTINCT FROM v_expected->>v_key THEN RAISE EXCEPTION 'V655: thân % là %, cần %', v_key, v_md5, v_expected->>v_key; END IF;
  END LOOP;
END $guard$;

CREATE FUNCTION private.aka_agent_send_exclusion_int(p_value jsonb)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 -- Số nguyên không âm ≤ 18 chữ số trong jsonb; khác (chuỗi, số thực, âm, quá lớn, null) thì NULL.
 SELECT CASE WHEN jsonb_typeof(p_value)='number' AND (p_value#>>'{}') ~ '^[0-9]{1,18}$' THEN (p_value#>>'{}')::bigint END;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_send_exclusion_int(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_validate_send_exclusion_rules(p_rules jsonb, p_staff bigint, p_org bigint, p_account bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r jsonb; f public.auto_filter_fields%ROWTYPE; m public.auto_filter_field_operators%ROWTYPE; vals jsonb; v jsonb; opts jsonb;
BEGIN
 IF jsonb_typeof(p_rules) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rules)=0 OR jsonb_array_length(p_rules)>100
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) x WHERE x->>'isEnabled'='true') THEN RAISE EXCEPTION 'send_exclusion_rules_required'; END IF;
 -- V655: id / cờ / thứ tự sai kiểu báo mã rõ ràng thay vì lỗi ép kiểu của Postgres.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
   OR private.aka_agent_send_exclusion_int(x->'fieldId') IS NULL OR private.aka_agent_send_exclusion_int(x->'operatorId') IS NULL
   OR COALESCE(jsonb_typeof(x->'isEnabled'),'null') NOT IN ('boolean','null')
   OR (COALESCE(x->'sortOrder','null')<>'null' AND (jsonb_typeof(x->'sortOrder')<>'number' OR (x->>'sortOrder') !~ '^-?[0-9]{1,9}$'))) THEN
  RAISE EXCEPTION 'send_exclusion_rules_invalid';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) x GROUP BY x->>'fieldId' HAVING count(*)>1) THEN RAISE EXCEPTION 'send_exclusion_duplicate_field'; END IF;
 opts:=public.aka_agent_internal_send_exclusion_options(p_staff,p_org,p_account);
 FOR r IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
  SELECT * INTO f FROM public.auto_filter_fields WHERE id=(r->>'fieldId')::bigint AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_field_unavailable'; END IF;
  SELECT m0.* INTO m FROM public.auto_filter_field_operators m0 JOIN public.auto_filter_operators o ON o.id=m0.operator_id AND o.is_active
   WHERE m0.field_id=f.id AND m0.operator_id=(r->>'operatorId')::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_operator_unavailable'; END IF;
  IF NOT COALESCE((r->>'isEnabled')::boolean,false) THEN CONTINUE; END IF;
  vals:=CASE WHEN jsonb_typeof(r->'value')='array' THEN r->'value' WHEN r->'value' IS NOT NULL AND r->'value'<>'null' THEN jsonb_build_array(r->'value') ELSE '[]' END;
  IF jsonb_array_length(vals)<m.min_values OR jsonb_array_length(vals)>m.max_values THEN RAISE EXCEPTION 'send_exclusion_value_count'; END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(vals) LOOP
   IF m.value_type='number' THEN
    IF jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'send_exclusion_number_required'; END IF;
    IF (m.validation_config ? 'min' AND (v#>>'{}')::numeric<(m.validation_config->>'min')::numeric)
    OR (m.validation_config ? 'max' AND (v#>>'{}')::numeric>(m.validation_config->>'max')::numeric)
    OR (COALESCE((m.validation_config->>'integer')::boolean,false) AND trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric) THEN RAISE EXCEPTION 'send_exclusion_number_range'; END IF;
   ELSIF m.value_type='date' THEN
    IF jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'send_exclusion_date_required'; END IF;
    PERFORM (v#>>'{}')::date;
   ELSIF m.value_type='text' AND (jsonb_typeof(v)<>'string' OR length(btrim(v#>>'{}'))=0) THEN RAISE EXCEPTION 'send_exclusion_text_required';
   ELSIF m.value_type='boolean' AND jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'send_exclusion_boolean_required'; END IF;
   IF f.options_source<>'none' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(opts) o WHERE (o->>'fieldId')::bigint=f.id AND o->'value'=v)
    -- V573: tag Zalo từng có của tài khoản rồi bị xoá trong Zalo vẫn hợp lệ; lúc chạy bộ lọc bỏ qua tag không còn (bản sửa 04/11/2026).
    AND NOT (f.options_source='zalo_labels' AND jsonb_typeof(v)='string' AND EXISTS(SELECT 1 FROM public.auto_account_contacts c
     WHERE c.account_id=p_account AND c.contact_type='zalo_tag' AND c.uid=(v#>>'{}') AND c.staff_id=p_staff AND c.organization_id=p_org))
   THEN RAISE EXCEPTION 'send_exclusion_option_unavailable'; END IF;
  END LOOP;
 END LOOP;
END;
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
    OR (entry.value->'groupId'<>'null' AND private.aka_agent_send_exclusion_int(entry.value->'groupId') IS NULL) THEN RAISE EXCEPTION 'send_exclusion_group_reference_invalid'; END IF;
  IF entry.key !~ '^[0-9]{1,18}$' THEN RAISE EXCEPTION 'send_exclusion_account_not_found'; END IF;
  aid:=entry.key::bigint;
  IF NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=aid AND staff_id=p_staff AND organization_id=p_org AND flatform_type='zalo' AND NOT is_delete) THEN RAISE EXCEPTION 'send_exclusion_account_not_found'; END IF;
  gid:=(entry.value->>'groupId')::bigint;
  IF gid IS NOT NULL THEN
   -- V654: nhóm của nhân viên (mọi Zalo của nhân viên); kiểm điều kiện của từng khối theo Zalo của khối.
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
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->'blocklistIds') v WHERE COALESCE(private.aka_agent_send_exclusion_int(v),0)<=0) THEN RAISE EXCEPTION 'send_exclusion_blocklists_invalid'; END IF;
  SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(entry.value->'blocklistIds')) INTO ids;
  -- V654: danh sách của mọi Zalo (còn) của nhân viên.
  IF cardinality(ids)<>(SELECT count(*) FROM public.auto_account_contact_groups g JOIN public.auto_accounts a ON a.id=g.account_id
    AND a.staff_id=p_staff AND a.organization_id=p_org AND a.flatform_type='zalo' AND NOT a.is_delete
    WHERE g.id=ANY(ids) AND g.staff_id=p_staff AND g.organization_id=p_org AND NOT g.is_delete AND g.purpose='zalo_friend_blocklist' AND g.contact_type='person') THEN RAISE EXCEPTION 'send_exclusion_blocklist_not_found'; END IF;
  FOREACH v_key IN ARRAY ARRAY['dataGroupIds','sentCampaignIds'] LOOP
   IF entry.value ? v_key AND (jsonb_typeof(entry.value->v_key) IS DISTINCT FROM 'array' OR jsonb_array_length(entry.value->v_key)>20
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->v_key) v WHERE COALESCE(private.aka_agent_send_exclusion_int(v),0)<=0))
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

DO $post$
DECLARE v_expected jsonb := '{"public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)":"d8a78dc8336571831d775fee4cf01857","public.aka_agent_internal_validate_send_exclusion_selection(jsonb,bigint,bigint,bigint)":"d42f8c4422b40ad6d3565e3e2213ae70","public.aka_agent_internal_validate_send_exclusion_rules(jsonb,bigint,bigint,bigint)":"f9c93ef4d769b40e5596a904979acbc2"}'::jsonb; v_key text; v_md5 text;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key);
    IF v_md5 IS DISTINCT FROM v_expected->>v_key THEN RAISE EXCEPTION 'V655 postflight: thân % là %, cần %', v_key, v_md5, v_expected->>v_key; END IF;
  END LOOP;
END $post$;
COMMIT;

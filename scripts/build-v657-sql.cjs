#!/usr/bin/env node
// Sinh migration V657 (loại trừ gửi so khớp theo SĐT / Global ID, lọc ở bước nhận data) + bản gỡ, từ thân hàm đang chạy:
//   - V654 p2: snapshot, block_facts, remote, aka_agent_campaign_send_exclusion_runtime, aka_agent_engine_send_exclusion_v1
//   - V655:    aka_agent_send_exclusion_v2
//   - V618 p2: aka_agent_engine_claim_target_v1
// md5(pg_get_functiondef) production đọc 25/11/2026 nằm ở LIVE_MD5; migration kiểm trước khi thay, bản gỡ trả đúng thân cũ.
// Phương án: docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md mục 12. Chạy: node scripts/build-v657-sql.cjs
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')

function fnBlock(sql, name) {
  const re = new RegExp(`^CREATE (?:OR REPLACE )?FUNCTION ${name.replace(/[.$]/g, m => '\\' + m)}\\([\\s\\S]*?AS \\$function\\$[\\s\\S]*?\\$function\\$\\s*;`, 'm')
  const m = sql.match(re)
  if (!m) throw new Error('không thấy hàm ' + name)
  return m[0].replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION')
}
function patch(block, pairs) {
  let out = block
  for (const [from, to] of pairs) {
    const n = out.split(from).length - 1
    if (n !== 1) throw new Error(`đoạn cần thay xuất hiện ${n} lần: ${from.slice(0, 100)}`)
    out = out.replace(from, () => to)
  }
  return out
}

const p2v654 = read('migrations/migration_v654_send_exclusion_multi_zalo_p2.sql')
const v655 = read('migrations/migration_v655_send_exclusion_input_guards.sql')
const p2v618 = read('migrations/migration_v618_web_data_scan_p2.sql')

const OLD = {
  snapshot: fnBlock(p2v654, 'private.aka_agent_send_exclusion_snapshot'),
  facts: fnBlock(p2v654, 'private.aka_agent_send_exclusion_block_facts'),
  remote: fnBlock(p2v654, 'private.aka_agent_send_exclusion_remote'),
  runtime: fnBlock(p2v654, 'public.aka_agent_campaign_send_exclusion_runtime'),
  engine: fnBlock(p2v654, 'public.aka_agent_engine_send_exclusion_v1'),
  v2: fnBlock(v655, 'public.aka_agent_send_exclusion_v2'),
  claim: fnBlock(p2v618, 'public.aka_agent_engine_claim_target_v1'),
}
/** md5(pg_get_functiondef) trên production 25/11/2026 (sau V655). */
const LIVE_MD5 = {
  snapshot: ['private.aka_agent_send_exclusion_snapshot(public.auto_campaigns,bigint,boolean)', '8c0597c63fafacb582d3ff68edad1dcd'],
  facts: ['private.aka_agent_send_exclusion_block_facts(public.auto_campaigns,bigint,text,text,jsonb)', '5a7eeb467101885c205d4a5664bdd04b'],
  remote: ['private.aka_agent_send_exclusion_remote(public.auto_campaigns,bigint,bigint,jsonb)', '4d7a0ba564f7b0d044c9399aeb8571dc'],
  runtime: ['public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)', '23065cacf4237d2f64398fd6062febbf'],
  engine: ['public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)', 'b5418f8ac90c295c4b0fabd6a478a2a7'],
  v2: ['public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)', '525eb62d61c48acec5b43aa8c636676a'],
  claim: ['public.aka_agent_engine_claim_target_v1(jsonb)', 'acf4f9d47113ae5c7ee110d96ef1b97c'],
}

const ACTIONS = "'zalo_message_phone','zalo_message_friend','zalo_message_birthday','zalo_message_group_member','zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation'"
const SUCCESS = "d.action_code IN ('zalo_message_friend','zalo_message_stranger') AND NOT d.is_delete\n" +
  "      AND (d.policy_snapshot->>'operationState'='committed' OR (d.policy_snapshot->>'operationState' IS NULL AND d.status IN ('thành công','đã gửi','đã nhận','đã xem','đã click')))"

// ============================================================================================ hàm mới (p2)
const NEW_FUNCTIONS = String.raw`
-- ===================================================================================================== khoá người nhận
CREATE FUNCTION private.aka_agent_send_exclusion_person_keys(p_account bigint, p_uid text, p_phone text, p_email text, p_global_id text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 -- V657: khoá lịch sử gửi (aka_agent_internal_delivery_cooldown_target_keys) của người nhận ở một tài khoản, cộng khoá của MỌI Zalo ID
 -- riêng mà tài khoản đó từng ghi cho cùng Global ID (Zalo ID riêng đổi theo thời gian ngay trên một nick; đo 25/11: 18% cặp lần tra).
 WITH g AS (
  SELECT COALESCE(NULLIF(btrim(COALESCE(p_global_id,'')),''),
   (SELECT NULLIF(btrim(zu.global_id),'') FROM public.zalo_users zu WHERE zu.account_id=p_account AND zu.zalo_uid=btrim(COALESCE(p_uid,'')))) gid)
 SELECT COALESCE(array_agg(DISTINCT k ORDER BY k),'{}') FROM (
  SELECT unnest(public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',p_uid,p_phone,p_email)) k
  UNION ALL
  SELECT unnest(public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',zu.zalo_uid,NULL,NULL))
   FROM g JOIN public.zalo_users zu ON zu.account_id=p_account AND zu.global_id=g.gid AND zu.global_id IS NOT NULL AND zu.global_id<>''
 ) x WHERE k IS NOT NULL;
$function$;

-- ===================================================================================================== so khớp danh sách / Nhóm data / chiến dịch
CREATE FUNCTION private.aka_agent_send_exclusion_match(p_campaign public.auto_campaigns, p_account bigint, p_selection jsonb,
  p_phone text, p_global_id text, p_uid text, p_final boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V657 (docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md mục 12): một người = SĐT đã chuẩn hoá + Global ID. Zalo ID riêng chỉ dùng để
-- tra Global ID (zalo_users của tài khoản gửi), và một Global ID đổi ra MỌI Zalo ID riêng đã ghi ở từng tài khoản. Trùng SĐT hoặc trùng
-- Global ID là cùng một người (SĐT ↔ Global ID một-một, đo 25/11). Nguồn: danh sách Zalo ID (mọi Zalo, kể cả Zalo đang gửi), Nhóm data
-- (SĐT / Zalo UID), chiến dịch đã gửi (đã nhận tin nhắn thành công). Khớp nhiều nguồn thì lấy theo thứ tự đó, trong mỗi loại theo tên, id.
-- needGlobalId: còn nguồn cần Global ID mà chưa có (bước nhận data của chiến dịch theo SĐT thì để bước sau khi tra số kiểm lại);
-- p_final = true (sau khi tra số / đọc hồ sơ) thì trả unknown: không gửi.
DECLARE v_phone text; v_gid text; v_gid_from text; v_phones text[]; v_accounts bigint[]; v_zalo_accounts bigint[]; v_match jsonb;
 v_need boolean:=false; v_lists bigint[]; v_groups bigint[]; v_has_person boolean; v_has_phone_group boolean; sc record; v_at timestamptz; v_at2 timestamptz;
 v_gid_uids text[];
BEGIN
 v_phone:=NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(p_phone,'')),'');
 v_gid:=NULLIF(btrim(COALESCE(p_global_id,'')),'');
 IF v_gid IS NOT NULL THEN v_gid_from:='target'; END IF;
 IF v_gid IS NULL AND NULLIF(btrim(COALESCE(p_uid,'')),'') IS NOT NULL THEN
  SELECT NULLIF(btrim(zu.global_id),'') INTO v_gid FROM public.zalo_users zu WHERE zu.account_id=p_account AND zu.zalo_uid=btrim(p_uid);
  IF v_gid IS NOT NULL THEN v_gid_from:='uid'; END IF;
 END IF;
 IF v_gid IS NULL AND v_phone IS NOT NULL THEN
  SELECT i.global_id INTO v_gid FROM private.auto_zalo_phone_identity i WHERE i.phone=v_phone;
  IF v_gid IS NOT NULL THEN v_gid_from:='phone_history'; END IF;
 END IF;
 IF v_phone IS NOT NULL THEN v_phones:=ARRAY[v_phone];
 ELSIF v_gid IS NOT NULL THEN
  SELECT COALESCE(array_agg(i.phone ORDER BY i.phone),'{}') INTO v_phones FROM private.auto_zalo_phone_identity i WHERE i.global_id=v_gid;
 ELSE v_phones:='{}';
 END IF;
 -- Tài khoản của tổ chức (đi qua nhân viên: auto_accounts không có chỉ mục theo tổ chức). Chỉ khi có Nhóm data / chiến dịch đã gửi.
 IF cardinality(private.aka_agent_send_exclusion_ids(p_selection->'dataGroupIds'))>0 OR cardinality(private.aka_agent_send_exclusion_ids(p_selection->'sentCampaignIds'))>0 THEN
  SELECT COALESCE(array_agg(a.id ORDER BY a.id),'{}'), COALESCE(array_agg(a.id ORDER BY a.id) FILTER (WHERE a.flatform_type='zalo'),'{}')
   INTO v_accounts, v_zalo_accounts FROM public.org_staff s JOIN public.auto_accounts a ON a.staff_id=s.id
   WHERE s.organization_id=p_campaign.organization_id AND a.organization_id=p_campaign.organization_id;
 END IF;

 -- 1. Danh sách Zalo ID loại trừ (mọi Zalo, kể cả Zalo đang gửi): thành viên → Global ID qua zalo_users của tài khoản của danh sách.
 SELECT COALESCE(array_agg(bl.id),'{}') INTO v_lists FROM public.auto_account_contact_groups bl
  WHERE bl.id=ANY(private.aka_agent_send_exclusion_ids(p_selection->'blocklistIds')) AND NOT bl.is_delete AND bl.purpose='zalo_friend_blocklist'
    AND bl.staff_id=p_campaign.staff_id AND bl.organization_id=p_campaign.organization_id;
 IF cardinality(v_lists)>0 THEN
  IF v_gid IS NULL THEN v_need:=true;
  ELSE
   SELECT jsonb_build_object('kind','blocklist','id',bl.id,'name',bl.name,'note',format('Thuộc danh sách Zalo ID loại trừ “%s”.',bl.name)) INTO v_match
    FROM public.auto_account_contact_groups bl
    WHERE bl.id=ANY(v_lists) AND EXISTS(
      SELECT 1 FROM public.zalo_users zu
       JOIN public.auto_account_contacts ac ON ac.account_id=bl.account_id AND ac.contact_type='person' AND ac.uid=zu.zalo_uid AND NOT ac.is_delete
       JOIN public.auto_account_contact_group_members m ON m.group_id=bl.id AND m.contact_id=ac.id AND NOT m.is_delete
      WHERE zu.account_id=bl.account_id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>'')
    ORDER BY bl.name, bl.id LIMIT 1;
  END IF;
 END IF;

 -- 2. Nhóm data (Số điện thoại / Zalo User): liên hệ loại SĐT so SĐT (uid = SĐT chuẩn hoá), liên hệ Zalo so Global ID.
 IF v_match IS NULL THEN
  SELECT COALESCE(array_agg(g.id),'{}'), COALESCE(bool_or(ci.code='zalo_person'),false), COALESCE(bool_or(ci.code='phone'),false)
   INTO v_groups, v_has_person, v_has_phone_group
   FROM public.auto_account_contact_groups g JOIN public.category_item ci ON ci.id=g.data_type_category_item_id AND ci.code IN ('phone','zalo_person')
   WHERE g.id=ANY(private.aka_agent_send_exclusion_ids(p_selection->'dataGroupIds')) AND g.purpose='data_group' AND NOT g.is_delete
     AND g.organization_id=p_campaign.organization_id;
  IF cardinality(v_groups)>0 THEN
   -- Nhóm khớp theo SĐT và theo Global ID xếp chung theo tên, id (một người có thể ở cả Nhóm SĐT lẫn Nhóm Zalo UID).
   SELECT jsonb_build_object('kind','data_group','id',g.id,'name',g.name,'note',format('Có trong Nhóm data “%s”.',g.name)) INTO v_match
    FROM (
     SELECT m.group_id FROM unnest(v_phones) p(ph) CROSS JOIN LATERAL (
       SELECT ct.id FROM public.auto_account_contacts ct WHERE ct.account_id IS NULL AND ct.contact_type='phone' AND ct.uid=p.ph
         AND ct.organization_id=p_campaign.organization_id AND NOT ct.is_delete
       UNION ALL
       SELECT k.id FROM unnest(v_accounts) a(id) CROSS JOIN LATERAL (
         SELECT ct.id FROM public.auto_account_contacts ct WHERE ct.account_id=a.id AND ct.contact_type='phone' AND ct.uid=p.ph AND NOT ct.is_delete OFFSET 0) k
     ) cand
     JOIN public.auto_account_contact_group_members m ON m.contact_id=cand.id AND m.group_id=ANY(v_groups) AND NOT m.is_delete
     UNION ALL
     SELECT m.group_id FROM unnest(v_zalo_accounts) a(id)
      CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE v_has_person AND zu.account_id=a.id AND zu.global_id=v_gid
        AND zu.global_id IS NOT NULL AND zu.global_id<>'' OFFSET 0) zu
      JOIN public.auto_account_contacts ct ON ct.account_id=a.id AND ct.contact_type='person' AND ct.uid=zu.zalo_uid AND NOT ct.is_delete
      JOIN public.auto_account_contact_group_members m ON m.contact_id=ct.id AND m.group_id=ANY(v_groups) AND NOT m.is_delete
    ) h JOIN public.auto_account_contact_groups g ON g.id=h.group_id
    ORDER BY g.name, g.id LIMIT 1;
   IF v_match IS NULL AND v_has_person AND v_gid IS NULL THEN v_need:=true; END IF;
   IF v_match IS NULL AND v_has_phone_group AND v_phone IS NULL AND v_gid IS NULL THEN v_need:=true; END IF;
  END IF;
 END IF;

 -- 3. Chiến dịch đã gửi: data của chiến dịch đó có cùng SĐT, hoặc có Zalo ID riêng thuộc cùng Global ID, và đã nhận tin nhắn
 -- (bạn bè / người lạ) thành công. Tra qua idx_campaign_input_cooldown_phone / _uid rồi idx_campaign_details_input_data_id.
 IF v_match IS NULL AND v_gid IS NOT NULL AND cardinality(private.aka_agent_send_exclusion_ids(p_selection->'sentCampaignIds'))>0 THEN
  -- Mọi Zalo ID riêng của Global ID ở các tài khoản Zalo của tổ chức (tính một lần cho mọi chiến dịch).
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(zu.zalo_uid))),'{}') INTO v_gid_uids FROM unnest(v_zalo_accounts) a(id)
   CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE zu.account_id=a.id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>'' OFFSET 0) zu
   WHERE btrim(zu.zalo_uid)<>'';
 END IF;
 IF v_match IS NULL THEN
  FOR sc IN SELECT c.id, c.name FROM public.auto_campaigns c
    WHERE c.id=ANY(private.aka_agent_send_exclusion_ids(p_selection->'sentCampaignIds')) AND c.staff_id=p_campaign.staff_id
      AND c.organization_id=p_campaign.organization_id AND c.id IS DISTINCT FROM p_campaign.id ORDER BY c.id LOOP
   v_at:=NULL; v_at2:=NULL;
   IF cardinality(v_phones)>0 THEN
    -- campaign_id+0: buộc tra theo chỉ mục SĐT / Zalo ID rồi lọc chiến dịch (đo 25/11: theo chỉ mục chiến dịch planner đọc mọi data của
    -- chiến dịch, ~3.100 dòng mỗi chiến dịch, và mọi kết quả gửi của chiến dịch; cách này 10 chiến dịch 2,4 ms).
    SELECT max(dd.created_at) INTO v_at FROM unnest(v_phones) p(ph)
     CROSS JOIN LATERAL (SELECT i.id FROM public.auto_campaign_input_data i WHERE md5(public.normalize_phone(i.phone))=md5(p.ph)
       AND i.phone IS NOT NULL AND btrim(i.phone)<>'' AND i.campaign_id+0=sc.id OFFSET 0) i
     CROSS JOIN LATERAL (SELECT d.created_at FROM public.auto_campaign_details d WHERE d.input_data_id=i.id AND d.campaign_id+0=sc.id
       AND ${SUCCESS} OFFSET 0) dd;
   END IF;
   IF v_gid IS NOT NULL THEN
    SELECT max(dd.created_at) INTO v_at2 FROM unnest(v_gid_uids) u(uid)
     CROSS JOIN LATERAL (SELECT i.id FROM public.auto_campaign_input_data i WHERE md5(lower(btrim(i.uid)))=md5(u.uid)
       AND i.uid IS NOT NULL AND btrim(i.uid)<>'' AND i.campaign_id+0=sc.id OFFSET 0) i
     CROSS JOIN LATERAL (SELECT d.created_at FROM public.auto_campaign_details d WHERE d.input_data_id=i.id AND d.campaign_id+0=sc.id
       AND ${SUCCESS} OFFSET 0) dd;
   ELSE
    v_need:=true;
   END IF;
   v_at:=greatest(v_at,v_at2);
   IF v_at IS NOT NULL THEN
    v_match:=jsonb_build_object('kind','campaign','id',sc.id,'name',sc.name,'sentAt',v_at,
     'note',format('Đã được gửi ở chiến dịch “%s” ngày %s.',sc.name,to_char(timezone('Asia/Ho_Chi_Minh',v_at),'DD/MM')));
    EXIT;
   END IF;
  END LOOP;
 END IF;

 RETURN jsonb_build_object('match',v_match,'globalId',v_gid,'globalIdFrom',v_gid_from,'phone',v_phone,
  'needGlobalId',v_match IS NULL AND v_need,
  'unknown',CASE WHEN v_match IS NULL AND v_need AND p_final THEN 'Chưa xác định được khách để kiểm tra loại trừ.' END);
END;
$function$;

-- ===================================================================================================== bước lọc đầu tiên
CREATE FUNCTION private.aka_agent_send_exclusion_precheck_on(p_campaign public.auto_campaigns, p_account bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V657: chiến dịch có loại trừ theo danh sách / Nhóm data / chiến dịch cho tài khoản này và công tắc campaign.send_exclusion_precheck
-- không tắt ({"enabled":false} tắt; thiếu dòng = bật). Như supportsSendExclusion của app.
DECLARE v_sel jsonb; v_raw text;
BEGIN
 IF p_campaign.action_id NOT IN (${ACTIONS}) THEN RETURN false; END IF;
 IF p_campaign.action_id NOT IN ('zalo_message_friend','zalo_message_birthday') AND p_campaign.extra_settings->'enableMessage' IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
 v_sel:=p_campaign.extra_settings->'zaloSendExclusionsByAccountId'->(p_account::text);
 IF jsonb_typeof(v_sel) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF cardinality(private.aka_agent_send_exclusion_ids(v_sel->'blocklistIds'))=0 AND cardinality(private.aka_agent_send_exclusion_ids(v_sel->'dataGroupIds'))=0
    AND cardinality(private.aka_agent_send_exclusion_ids(v_sel->'sentCampaignIds'))=0 THEN RETURN false; END IF;
 SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key='campaign.send_exclusion_precheck' AND s.is_active LIMIT 1;
 BEGIN
  IF v_raw IS NOT NULL AND v_raw::jsonb->'enabled'='false'::jsonb THEN RETURN false; END IF;
 EXCEPTION WHEN OTHERS THEN NULL;
 END;
 RETURN true;
END;
$function$;

CREATE FUNCTION private.aka_agent_send_exclusion_precheck(p_campaign public.auto_campaigns, p_account bigint, p_phone text, p_uid text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V657: bước lọc đầu tiên (nhận data của engine v2, thao tác precheck của bộ chạy cũ): so data với danh sách / Nhóm data / chiến dịch
-- bằng khoá có sẵn trước mọi lần gọi Zalo. Trả ghi chú khi phải loại, NULL khi chưa loại (bước sau khi tra số kiểm lại đủ).
DECLARE v_m jsonb;
BEGIN
 IF NOT private.aka_agent_send_exclusion_precheck_on(p_campaign,p_account) THEN RETURN NULL; END IF;
 v_m:=private.aka_agent_send_exclusion_match(p_campaign,p_account,p_campaign.extra_settings->'zaloSendExclusionsByAccountId'->(p_account::text),p_phone,NULL,p_uid,false);
 RETURN CASE WHEN jsonb_typeof(v_m->'match')='object' THEN v_m->'match'->>'note' END;
END;
$function$;
`

// ============================================================================================ remote / block_facts viết lại
const NEW_REMOTE = String.raw`CREATE OR REPLACE FUNCTION private.aka_agent_send_exclusion_remote(p_campaign public.auto_campaigns, p_account bigint, p_input_id bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V657: sau khi có Global ID thật (tra số / hồ sơ): so danh sách / Nhóm data / chiến dịch bằng private.aka_agent_send_exclusion_match
-- (SĐT hoặc Global ID, mọi Zalo ID riêng của Global ID), rồi dữ kiện khối điều kiện của các Zalo khác theo Global ID.
-- unknown: còn nguồn cần Global ID mà không xác định được (không gửi).
DECLARE v_input public.auto_campaign_input_data%ROWTYPE; v_selection jsonb; v_uid text; v_gid text; v_phone_raw text; v_m jsonb;
 v_blocks jsonb:='[]'; v_gid_group bigint; block record;
BEGIN
 SELECT * INTO v_input FROM public.auto_campaign_input_data WHERE id=p_input_id AND campaign_id=p_campaign.id AND NOT COALESCE(is_delete,false);
 IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_input_not_found'; END IF;
 v_selection:=p_campaign.extra_settings->'zaloSendExclusionsByAccountId'->p_account::text;
 IF v_selection IS NULL THEN RAISE EXCEPTION 'send_exclusion_account_configuration_missing'; END IF;
 v_uid:=COALESCE(NULLIF(btrim(p_payload->>'uid'),''),NULLIF(btrim(v_input.uid),''));
 v_phone_raw:=COALESCE(NULLIF(btrim(p_payload->>'phone'),''),NULLIF(btrim(v_input.phone),''));
 v_m:=private.aka_agent_send_exclusion_match(p_campaign,p_account,v_selection,v_phone_raw,NULLIF(btrim(p_payload->>'globalId'),''),v_uid,true);
 v_gid:=v_m->>'globalId';
 IF jsonb_typeof(v_m->'match') IS DISTINCT FROM 'object' AND jsonb_typeof(v_selection->'groupId')='number' THEN
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
 RETURN jsonb_build_object('match',CASE WHEN jsonb_typeof(v_m->'match')='object' THEN v_m->'match' END,'blocks',v_blocks,
  'globalIdKnown',v_gid IS NOT NULL,'unknown',v_m->'unknown');
END;
$function$;
`

const NEW_FACTS = String.raw`CREATE OR REPLACE FUNCTION private.aka_agent_send_exclusion_block_facts(p_campaign public.auto_campaigns, p_block_account bigint, p_global_id text, p_phone text, p_rules jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V657: dữ kiện khối điều kiện của một Zalo khác cho người nhận có Global ID p_global_id, xét MỌI Zalo ID riêng mà Zalo đó từng ghi cho
-- Global ID này (bạn bè nếu một Zalo ID là bạn bè; có tag nếu một Zalo ID có tag; tag akaBiz gộp; "đã gửi N ngày" theo mọi Zalo ID + SĐT).
DECLARE v_sources text[]; v_uids text[]:='{}'; v_any_fr boolean:=false; v_now timestamptz:=clock_timestamp(); v_facts jsonb:='{}'; v_account public.auto_accounts%ROWTYPE;
 v_contacts bigint[]; v_tag_ids jsonb; v_days integer; v_keys text[]; v_last timestamptz; v_status text; v_account_zalo_uid text; v_available jsonb; v_ids jsonb;
BEGIN
 SELECT * INTO v_account FROM public.auto_accounts WHERE id=p_block_account;
 SELECT ARRAY(SELECT DISTINCT f.source_key FROM jsonb_array_elements(p_rules) r JOIN public.auto_filter_fields f ON f.id=(r->>'fieldId')::bigint
   WHERE r->>'isEnabled'='true' ORDER BY 1) INTO v_sources;
 IF cardinality(v_sources)=0 THEN RETURN jsonb_build_object('accountId',p_block_account,'state','empty'); END IF;
 IF p_global_id IS NOT NULL THEN
  SELECT COALESCE(array_agg(zu.zalo_uid ORDER BY zu.id),'{}'), COALESCE(bool_or(zu.is_fr=1),false) INTO v_uids, v_any_fr FROM public.zalo_users zu
   WHERE zu.account_id=p_block_account AND zu.global_id=p_global_id AND zu.global_id IS NOT NULL AND zu.global_id<>'';
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
  IF cardinality(v_uids)>0 THEN
   IF v_any_fr OR EXISTS(SELECT 1 FROM public.auto_account_contacts ac WHERE ac.account_id=p_block_account AND ac.contact_type='person' AND ac.uid=ANY(v_uids) AND NOT ac.is_delete AND ac.is_friend) THEN
    v_status:='friend';
   ELSE
    SELECT za.zalo_uid INTO v_account_zalo_uid FROM public.zalo_accounts za WHERE za.id=v_account.zalo_account_id;
    IF v_account_zalo_uid IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e
      WHERE e.organization_id=p_campaign.organization_id AND e.staff_id=p_campaign.staff_id AND e.account_id=p_block_account AND e.account_zalo_uid=v_account_zalo_uid
        AND e.target_zalo_uid=ANY(v_uids) AND e.sent_at>v_now-interval '60 days' AND e.action_type='friend_request' AND e.friended_at IS NULL AND e.rejected_at IS NULL) THEN
     v_status:='request_sent';
    END IF;
   END IF;
  END IF;
  v_facts:=v_facts||jsonb_build_object('zalo_friendship',jsonb_build_object('status',v_status));
 END IF;
 IF 'zalo_labels'=ANY(v_sources) THEN
  SELECT COALESCE(jsonb_agg(DISTINCT x.id),'[]'), COALESCE(jsonb_agg(DISTINCT x.id) FILTER (WHERE x.has),'[]') INTO v_available, v_ids FROM (
    SELECT ac.uid AS id, (cardinality(v_uids)>0 AND COALESCE(ac.extra_data->'conversations','[]') ?| v_uids) AS has FROM public.auto_account_contacts ac
     WHERE ac.account_id=p_block_account AND ac.contact_type='zalo_tag' AND NOT ac.is_delete AND ac.staff_id=p_campaign.staff_id AND ac.organization_id=p_campaign.organization_id
       AND NULLIF(btrim(ac.uid),'') IS NOT NULL
    UNION ALL
    SELECT t.zalo_id, (cardinality(v_uids)>0 AND EXISTS(SELECT 1 FROM public.chat_zalo_account_conversation cv JOIN public.chat_zalo_account_conversation_tag ct ON ct.chat_zalo_account_conversation_id=cv.id
       WHERE cv.chat_zalo_account_id=t.chat_zalo_account_id AND cv.conversation_type='user' AND cv.zalo_id=ANY(v_uids) AND ct.chat_zalo_account_tag_id=t.id))
     FROM public.chat_zalo_account_tag t JOIN public.chat_zalo_account_organization b ON b.chat_zalo_account_id=t.chat_zalo_account_id
     WHERE b.auto_account_id=p_block_account AND b.organization_id=p_campaign.organization_id AND b.is_active AND NULLIF(btrim(t.zalo_id),'') IS NOT NULL) x;
  v_facts:=v_facts||jsonb_build_object('zalo_labels',jsonb_build_object('ids',v_ids,'availableValues',v_available));
 END IF;
 IF 'akabiz_contact'=ANY(v_sources) THEN
  v_tag_ids:='[]';
  IF cardinality(v_uids)>0 THEN
   SELECT COALESCE(array_agg(ac.id ORDER BY ac.id),'{}') INTO v_contacts FROM public.auto_account_contacts ac WHERE ac.account_id=p_block_account AND ac.staff_id=p_campaign.staff_id
    AND ac.organization_id=p_campaign.organization_id AND ac.contact_type='person' AND ac.uid=ANY(v_uids) AND NOT ac.is_delete;
   IF cardinality(v_contacts)>0 THEN
    SELECT COALESCE(jsonb_agg(DISTINCT x.k),'[]') INTO v_tag_ids FROM unnest(v_contacts) cid(id)
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(public.aka_agent_data_group_zalo_facts(cid.id)->'akabiz_tag_keys','[]')) x(k);
   ELSE
    SELECT COALESCE(jsonb_agg(DISTINCT t.id::text),'[]') INTO v_tag_ids
     FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id AND ac.zalo_id=ANY(v_uids) AND ac.conversation_type='user'
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
   SELECT COALESCE(array_agg(DISTINCT k ORDER BY k),'{}') INTO v_keys FROM (
     SELECT unnest(public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',NULL,p_phone,NULL)) k
     UNION ALL SELECT unnest(public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',u.uid,NULL,NULL)) FROM unnest(v_uids) u(uid)) x WHERE k IS NOT NULL;
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
`

// ============================================================================================ vá hàm có sẵn
const OWN_BLOCKLIST_UIDS = "  'blocklistUids',COALESCE((SELECT jsonb_agg(DISTINCT btrim(ac.uid)) FROM public.auto_account_contact_group_members m\n" +
  "    JOIN public.auto_account_contacts ac ON ac.id=m.contact_id WHERE m.group_id=ANY(v_ids) AND NOT m.is_delete AND NOT ac.is_delete\n" +
  "    AND ac.account_id=p_account AND ac.staff_id=p_campaign.staff_id AND ac.organization_id=p_campaign.organization_id AND ac.contact_type='person' AND NULLIF(btrim(ac.uid),'') IS NOT NULL),'[]'),\n" +
  "  'remote',v_remote);"
const NEW = {
  snapshot: patch(OLD.snapshot, [
    // V657: bộ chạy mới so cả danh sách của Zalo đang gửi theo Global ID (phần remote); bản cũ (không clientVersion) giữ danh sách UID.
    ['WHERE g.id=ANY(v_ids) AND g.account_id IS DISTINCT FROM p_account AND NOT g.is_delete;', 'WHERE g.id=ANY(v_ids) AND NOT g.is_delete;'],
    [OWN_BLOCKLIST_UIDS, "  -- V657: danh sách Zalo ID (kể cả của Zalo đang gửi) so theo Global ID trong phần remote.\n  'blocklistUids','[]'::jsonb,\n  'remote',v_remote);"],
  ]),
  runtime: patch(OLD.runtime, [
    ['contact_id bigint; fact jsonb; v_uid text; days integer;', 'contact_id bigint; fact jsonb; v_uid text; v_note text; days integer;'],
    [" IF p_operation='pause' THEN\n",
      " IF p_operation='precheck' THEN\n" +
      "  -- V657: bước lọc đầu tiên của bộ chạy cũ (trước kiểm từ chối nhận tin / chống gửi lặp / tra số): khớp danh sách / Nhóm data / chiến dịch\n" +
      "  -- thì tạm dừng data kèm lý do (không gọi Zalo, không tính lượt, không nghỉ).\n" +
      "  v_note:=private.aka_agent_send_exclusion_precheck(c,p_account_id,input.phone,input.uid);\n" +
      "  IF v_note IS NULL THEN RETURN jsonb_build_object('excluded',false); END IF;\n" +
      "  UPDATE public.auto_campaign_input_data SET status='tạm dừng',note=left(v_note,2000)\n" +
      "   WHERE id=input.id AND campaign_id=c.id AND status=COALESCE(p_payload->>'expectedStatus','chờ xử lý') AND status IN ('chờ xử lý','đang chạy') AND NOT is_delete;\n" +
      "  GET DIAGNOSTICS changed=ROW_COUNT;\n" +
      "  RETURN jsonb_build_object('excluded',true,'note',v_note,'changed',changed=1);\n" +
      " END IF;\n IF p_operation='pause' THEN\n"],
    ["keys:=public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',COALESCE(v_uid,input.uid),input.phone,input.email);",
      "keys:=private.aka_agent_send_exclusion_person_keys(c.account_id,COALESCE(v_uid,input.uid),input.phone,input.email,NULLIF(btrim(p_payload->>'globalId'),''));"],
  ]),
  engine: patch(OLD.engine, [
    ["v_keys := public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person', coalesce(v_uid, v_input.uid), v_input.phone, v_input.email);",
      "-- V657: khoá lịch sử gửi gồm mọi Zalo ID riêng của Global ID người nhận ở tài khoản này (Zalo ID riêng đổi theo thời gian).\n" +
      "      v_keys := private.aka_agent_send_exclusion_person_keys(r.account_id, coalesce(v_uid, v_input.uid), v_input.phone, v_input.email, nullif(btrim(p_payload->>'globalId'), ''));"],
  ]),
  v2: patch(OLD.v2, [
    [' v_n integer; v_primary bigint; v_ga bigint; r jsonb; v_prior jsonb; v_idx integer; v_payload_cmp jsonb; v_prior_cmp jsonb;',
      ' v_n integer; v_primary bigint; v_ga bigint; r jsonb; v_prior jsonb; v_idx integer; v_payload_cmp jsonb; v_prior_cmp jsonb;\n' +
      ' v_sel jsonb; v_c public.auto_campaigns%ROWTYPE; v_cid bigint; v_after bigint; v_limit integer; v_deadline timestamptz; v_m jsonb; v_checked integer:=0;\n' +
      ' v_excluded integer:=0; v_pending integer:=0; v_sources jsonb:=\'{}\'; v_last bigint; v_more boolean:=false; v_key text; tg record;'],
    [" IF p_operation<>'save' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;",
      " IF p_operation='preview' THEN\n" +
      "  -- V657: xem trước ở bước lưu, chỉ đọc: {accountId, selection, campaignId? | targets?:[{phone,uid}], afterId?, limit?}. Dùng đúng hàm so khớp\n" +
      "  -- của bộ chạy (danh sách / Nhóm data / chiến dịch); điều kiện của từng Zalo không tính. pending = chưa xác định được (kiểm lúc chạy).\n" +
      "  v_account:=private.aka_agent_send_exclusion_int(p_payload->'accountId');\n" +
      "  IF v_account IS NULL THEN RAISE EXCEPTION 'send_exclusion_account_not_found'; END IF;\n" +
      "  v_sel:=p_payload->'selection';\n" +
      "  IF jsonb_typeof(v_sel) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'send_exclusion_selection_invalid'; END IF;\n" +
      "  PERFORM public.aka_agent_internal_validate_send_exclusion_selection(jsonb_build_object(v_account::text,v_sel),p_staff_id,p_organization_id,v_account);\n" +
      "  v_cid:=private.aka_agent_send_exclusion_int(p_payload->'campaignId');\n" +
      "  IF v_cid IS NOT NULL THEN\n" +
      "   SELECT * INTO v_c FROM public.auto_campaigns WHERE id=v_cid AND staff_id=p_staff_id AND organization_id=p_organization_id AND NOT is_delete;\n" +
      "   IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_campaign_not_found'; END IF;\n" +
      "  ELSIF COALESCE(p_payload->'campaignId','null')<>'null' THEN RAISE EXCEPTION 'send_exclusion_campaign_not_found';\n" +
      "  ELSE v_c.staff_id:=p_staff_id; v_c.organization_id:=p_organization_id;\n" +
      "  END IF;\n" +
      "  v_after:=COALESCE(private.aka_agent_send_exclusion_int(p_payload->'afterId'),0);\n" +
      "  v_limit:=least(greatest(COALESCE(private.aka_agent_send_exclusion_int(p_payload->'limit'),200),1),500);\n" +
      "  IF jsonb_typeof(COALESCE(p_payload->'targets','null'))='array' AND jsonb_array_length(p_payload->'targets')>500 THEN RAISE EXCEPTION 'send_exclusion_preview_too_many'; END IF;\n" +
      "  v_deadline:=clock_timestamp()+interval '6 seconds';\n" +
      "  FOR tg IN SELECT x.id, x.phone, x.uid FROM (\n" +
      "     SELECT e.ord AS id, CASE WHEN jsonb_typeof(e.v->'phone')='string' THEN left(e.v->>'phone',40) END phone, CASE WHEN jsonb_typeof(e.v->'uid')='string' THEN left(e.v->>'uid',64) END uid\n" +
      "      FROM jsonb_array_elements(CASE WHEN v_cid IS NULL AND jsonb_typeof(p_payload->'targets')='array' THEN p_payload->'targets' ELSE '[]' END) WITH ORDINALITY e(v,ord)\n" +
      "      WHERE e.ord>v_after\n" +
      "     UNION ALL\n" +
      "     SELECT i.id, i.phone, i.uid FROM public.auto_campaign_input_data i WHERE v_cid IS NOT NULL AND i.campaign_id=v_cid AND NOT COALESCE(i.is_delete,false)\n" +
      "      AND i.status='chờ xử lý' AND i.id>v_after) x ORDER BY x.id LIMIT v_limit+1 LOOP\n" +
      "   IF v_checked>=v_limit OR clock_timestamp()>v_deadline THEN v_more:=true; EXIT; END IF;\n" +
      "   v_m:=private.aka_agent_send_exclusion_match(v_c,v_account,v_sel,tg.phone,NULL,tg.uid,false);\n" +
      "   v_checked:=v_checked+1; v_last:=tg.id;\n" +
      "   IF jsonb_typeof(v_m->'match')='object' THEN\n" +
      "    v_excluded:=v_excluded+1; v_key:=(v_m->'match'->>'kind')||':'||(v_m->'match'->>'id');\n" +
      "    v_sources:=jsonb_set(v_sources,ARRAY[v_key],jsonb_build_object('kind',v_m->'match'->'kind','id',v_m->'match'->'id','name',v_m->'match'->'name',\n" +
      "      'count',COALESCE((v_sources->v_key->>'count')::integer,0)+1));\n" +
      "   ELSIF (v_m->>'needGlobalId')::boolean THEN v_pending:=v_pending+1;\n" +
      "   END IF;\n" +
      "  END LOOP;\n" +
      "  RETURN jsonb_build_object('checked',v_checked,'excluded',v_excluded,'pending',v_pending,\n" +
      "   'sources',COALESCE((SELECT jsonb_agg(s.v ORDER BY (s.v->>'count')::integer DESC, s.v->>'name') FROM jsonb_each(v_sources) s(k,v)),'[]'),\n" +
      "   'nextAfterId',CASE WHEN v_more THEN v_last END);\n" +
      " END IF;\n\n IF p_operation<>'save' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;"],
  ]),
  claim: patch(OLD.claim, [
    ['  v_cd_deadline timestamptz;\n', '  v_cd_deadline timestamptz;\n  v_excl boolean := false;\n  v_ex_note text;\n'],
    ["  v_cd_deadline := v_now + make_interval(secs => (CASE WHEN public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500')",
      "  -- V657: loại trừ gửi theo danh sách / Nhóm data / chiến dịch là bước lọc đầu tiên (trước mọi lần gọi Zalo), cùng vòng với chống gửi lặp.\n" +
      "  BEGIN\n    v_excl := NOT v_slot_mode AND private.aka_agent_send_exclusion_precheck_on(c, v_account_id);\n" +
      "  EXCEPTION WHEN OTHERS THEN\n    v_excl := false;\n  END;\n" +
      "  v_cd_deadline := v_now + make_interval(secs => (CASE WHEN public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500')"],
    ['    v_found := FOUND;\n    EXIT WHEN NOT v_found OR NOT v_cooldown;\n',
      '    v_found := FOUND;\n    EXIT WHEN NOT v_found OR NOT (v_cooldown OR v_excl);\n' +
      '    IF v_excl THEN\n' +
      '      -- V657: data khớp danh sách / Nhóm data / chiến dịch thì tạm dừng kèm lý do và lấy data kế tiếp (không gọi Zalo, không tính lượt, không\n' +
      '      -- nghỉ); lõi in "⏸️ Bỏ qua …" từ cooldownPaused. Kiểm lỗi thì để bước sau khi tra số / đọc hồ sơ kiểm lại.\n' +
      '      v_ex_note := NULL;\n' +
      '      BEGIN\n        v_ex_note := private.aka_agent_send_exclusion_precheck(c, v_account_id, t.phone, t.uid);\n' +
      '      EXCEPTION WHEN OTHERS THEN\n        v_ex_note := NULL;\n      END;\n' +
      '      IF v_ex_note IS NOT NULL THEN\n' +
      "        UPDATE public.auto_campaign_input_data SET status = 'tạm dừng', note = left(v_ex_note, 2000) WHERE id = t.id AND status = 'chờ xử lý';\n" +
      "        v_cd_paused := v_cd_paused || jsonb_build_object('inputDataId', t.id, 'name', t.name, 'phone', t.phone, 'uid', t.uid, 'email', t.email, 'note', v_ex_note);\n" +
      '        v_cd_skip := v_cd_skip || t.id;\n        v_cd_scanned := v_cd_scanned + 1;\n' +
      '        IF v_cd_scanned >= 50 OR clock_timestamp() >= v_cd_deadline THEN\n' +
      "          RETURN jsonb_build_object('status', 'cooldown_scan', 'leaseToken', v_token, 'cooldownPaused', v_cd_paused);\n" +
      '        END IF;\n        CONTINUE;\n      END IF;\n      EXIT WHEN NOT v_cooldown;\n    END IF;\n'],
  ]),
}

// ============================================================================================ p1: bảng đối chiếu SĐT ↔ Global ID
const P1 = String.raw`-- V657 phần 1: bảng đối chiếu SĐT ↔ Global ID cho loại trừ gửi (docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md mục 12).
-- SINH TỪ scripts/build-v657-sql.cjs, không sửa tay. Chỉ thêm đối tượng mới: private.auto_zalo_phone_identity (+ _state), hàm nạp từ
-- kết quả Tìm SĐT thành công trong auto_campaign_details (theo id, mỗi phút có ngân sách), job pg_cron aka-agent-zalo-phone-identity,
-- thiết lập send_exclusion.identity. Gỡ: rollback_v657_send_exclusion_global_match_p1.sql (sau khi gỡ p2).
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
BEGIN
 IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v657_send_exclusion_global_match_p1') THEN
  RAISE EXCEPTION 'V657 p1 đã có trong sổ migration, không chạy lại';
 END IF;
 IF to_regclass('private.auto_zalo_phone_identity') IS NOT NULL THEN RAISE EXCEPTION 'V657 p1: bảng đối chiếu đã có'; END IF;
 IF to_regprocedure('public.aka_agent_internal_normalize_phone(text)') IS NULL THEN RAISE EXCEPTION 'V657 p1: thiếu aka_agent_internal_normalize_phone'; END IF;
 IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key='send_exclusion.identity') THEN RAISE EXCEPTION 'V657 p1: thiết lập send_exclusion.identity đã có'; END IF;
END $pre$;

CREATE TABLE private.auto_zalo_phone_identity (
  phone text PRIMARY KEY CHECK (phone ~ '^0[35789][0-9]{8}$'),
  global_id text NOT NULL CHECK (btrim(global_id) <> ''),
  seen_at timestamptz NOT NULL,
  detail_id bigint NOT NULL,
  changes integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auto_zalo_phone_identity_global ON private.auto_zalo_phone_identity (global_id);
COMMENT ON TABLE private.auto_zalo_phone_identity IS 'V657: SĐT (chuẩn hoá, di động VN) → Global ID Zalo mới nhất, lấy từ kết quả Tìm SĐT thành công (auto_campaign_details zalo_find_phone_user, data.target.phone / globalId). changes = số lần Global ID của SĐT đổi (theo dõi; đo 25/11: 0 / 2.700 SĐT). Dùng cho loại trừ gửi: biết Global ID của SĐT trước khi tra số, và SĐT của người nhận theo UID.';
CREATE TABLE private.auto_zalo_phone_identity_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_detail_id bigint NOT NULL DEFAULT 0,
  rows_upserted bigint NOT NULL DEFAULT 0,
  changes bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.auto_zalo_phone_identity_state(id) VALUES (true);
ALTER TABLE private.auto_zalo_phone_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.auto_zalo_phone_identity_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.auto_zalo_phone_identity, private.auto_zalo_phone_identity_state FROM PUBLIC;
DO $rv$
DECLARE v_role text;
BEGIN
 FOREACH v_role IN ARRAY ARRAY['anon','authenticated','aka_agent_desktop','aka_agent_chat_api','service_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN
   EXECUTE format('REVOKE ALL ON private.auto_zalo_phone_identity, private.auto_zalo_phone_identity_state FROM %I', v_role);
  END IF;
 END LOOP;
END $rv$;

CREATE FUNCTION private.aka_agent_zalo_phone_identity_ingest(p_budget_ms integer DEFAULT NULL, p_chunk integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V657: nạp kết quả Tìm SĐT thành công (theo id auto_campaign_details, từ mốc ở _state) vào bảng đối chiếu. Một SĐT lấy lần tra mới nhất;
-- Global ID đổi thì cập nhật và đếm changes. Ngân sách: send_exclusion.identity.budgetMs (dòng cài đặt V657 đặt 8 giây; thiếu thì 20 giây), chunk id mỗi phần (10.000).
DECLARE v_cfg jsonb; v_budget integer; v_chunk integer; v_deadline timestamptz; v_from bigint; v_to bigint; v_max bigint; v_rows bigint:=0; v_ch bigint:=0; v_overlap integer;
 v_n bigint; v_c bigint;
BEGIN
 BEGIN
  SELECT s.value::jsonb INTO v_cfg FROM public.auto_system_settings s WHERE s.key='send_exclusion.identity' AND s.is_active LIMIT 1;
 EXCEPTION WHEN OTHERS THEN v_cfg:=NULL;
 END;
 v_cfg:=COALESCE(v_cfg,'{}');
 IF p_budget_ms IS NULL AND v_cfg->'ingest'='false'::jsonb THEN RETURN jsonb_build_object('skipped','disabled'); END IF;
 v_budget:=COALESCE(p_budget_ms, CASE WHEN v_cfg->>'budgetMs' ~ '^[0-9]{1,6}$' THEN (v_cfg->>'budgetMs')::integer END, 20000);
 v_chunk:=least(greatest(COALESCE(p_chunk, CASE WHEN v_cfg->>'chunk' ~ '^[0-9]{1,7}$' THEN (v_cfg->>'chunk')::integer END, 10000),100),200000);
 v_overlap:=COALESCE(CASE WHEN v_cfg->>'overlap' ~ '^[0-9]{1,7}$' THEN (v_cfg->>'overlap')::integer END, 5000);
 v_deadline:=clock_timestamp()+make_interval(secs=>v_budget/1000.0);
 IF NOT pg_try_advisory_xact_lock(hashtext('aka_agent_zalo_phone_identity_ingest')) THEN RETURN jsonb_build_object('skipped','busy'); END IF;
 SELECT max(id) INTO v_max FROM public.auto_campaign_details;
 SELECT last_detail_id INTO v_from FROM private.auto_zalo_phone_identity_state WHERE id FOR UPDATE;
 -- Đọc lại một đoạn id đã qua: dòng có id nhỏ hơn mốc nhưng commit muộn (giao dịch đang mở lúc lượt trước chạy) không bị bỏ sót.
 -- Ghi lại an toàn: chỉ cập nhật khi detail_id mới lớn hơn.
 v_from:=greatest(v_from-v_overlap,0);
 LOOP
  EXIT WHEN v_from>=COALESCE(v_max,0) OR clock_timestamp()>=v_deadline;
  v_to:=least(v_from+v_chunk,v_max);
  WITH src AS (
   SELECT DISTINCT ON (x.ph) x.ph, x.gid, x.created_at, x.id FROM (
    SELECT public.aka_agent_internal_normalize_phone(COALESCE(d.data->'target'->>'phone','')) ph, NULLIF(btrim(COALESCE(d.data->'target'->>'globalId','')),'') gid, d.created_at, d.id
     FROM public.auto_campaign_details d
     WHERE d.id>v_from AND d.id<=v_to AND d.action_code='zalo_find_phone_user' AND d.status='thành công') x
   WHERE x.ph<>'' AND x.gid IS NOT NULL ORDER BY x.ph, x.id DESC),
  up AS (
   INSERT INTO private.auto_zalo_phone_identity AS t (phone, global_id, seen_at, detail_id)
   SELECT ph, gid, created_at, id FROM src
   ON CONFLICT (phone) DO UPDATE SET global_id=EXCLUDED.global_id, seen_at=EXCLUDED.seen_at, detail_id=EXCLUDED.detail_id,
     changes=t.changes+CASE WHEN t.global_id<>EXCLUDED.global_id THEN 1 ELSE 0 END, updated_at=now()
    WHERE EXCLUDED.detail_id>t.detail_id
   RETURNING (xmax<>0) AS updated, changes)
  SELECT count(*), count(*) FILTER (WHERE updated AND changes>0) INTO v_n, v_c FROM up;
  v_rows:=v_rows+v_n; v_ch:=v_ch+v_c; v_from:=v_to;
 END LOOP;
 UPDATE private.auto_zalo_phone_identity_state SET last_detail_id=greatest(last_detail_id,v_from), rows_upserted=rows_upserted+v_rows, updated_at=now() WHERE id;
 RETURN jsonb_build_object('lastDetailId',v_from,'maxDetailId',v_max,'rows',v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_zalo_phone_identity_ingest(integer,integer) FROM PUBLIC;
DO $rv2$
DECLARE v_role text;
BEGIN
 FOREACH v_role IN ARRAY ARRAY['anon','authenticated','aka_agent_desktop','aka_agent_chat_api','service_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_zalo_phone_identity_ingest(integer,integer) FROM %I', v_role);
  END IF;
 END LOOP;
END $rv2$;

INSERT INTO public.auto_system_settings(key, value, description, is_active)
VALUES ('send_exclusion.identity', '{"ingest":true,"budgetMs":8000,"chunk":10000}',
 'V657: nạp bảng đối chiếu SĐT ↔ Global ID (private.auto_zalo_phone_identity) từ kết quả Tìm SĐT thành công. ingest=false: ngừng nạp; budgetMs: thời gian mỗi lượt job (mỗi phút); chunk: số id auto_campaign_details mỗi phần; overlap: số id đã qua đọc lại mỗi lượt để không sót dòng commit muộn (mặc định 5000).', true);

DO $cron$
BEGIN
 IF to_regclass('cron.job') IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='aka-agent-zalo-phone-identity') THEN RAISE EXCEPTION 'V657 p1: job đã có'; END IF;
  PERFORM cron.schedule('aka-agent-zalo-phone-identity', '* * * * *', 'SELECT private.aka_agent_zalo_phone_identity_ingest()');
 END IF;
END $cron$;
COMMIT;
`

const P1_ROLLBACK = String.raw`-- Gỡ V657 phần 1 (chạy sau khi đã gỡ phần 2): xoá job, hàm nạp, bảng đối chiếu, thiết lập.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $g$
BEGIN
 IF to_regprocedure('private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean)') IS NOT NULL THEN
  RAISE EXCEPTION 'Gỡ V657 p2 trước';
 END IF;
 IF to_regclass('cron.job') IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='aka-agent-zalo-phone-identity') THEN PERFORM cron.unschedule('aka-agent-zalo-phone-identity'); END IF;
 END IF;
END $g$;
DROP FUNCTION private.aka_agent_zalo_phone_identity_ingest(integer,integer);
DROP TABLE private.auto_zalo_phone_identity_state;
DROP TABLE private.auto_zalo_phone_identity;
DELETE FROM public.auto_system_settings WHERE key='send_exclusion.identity';
DELETE FROM supabase_migrations.schema_migrations WHERE name='migration_v657_send_exclusion_global_match_p1';
COMMIT;
`

// ============================================================================================ p2
const REPLACED = ['snapshot', 'facts', 'remote', 'runtime', 'engine', 'v2', 'claim']
const NEW_PRIVATE = [
  'private.aka_agent_send_exclusion_person_keys(bigint,text,text,text,text)',
  'private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean)',
  'private.aka_agent_send_exclusion_precheck_on(public.auto_campaigns,bigint)',
  'private.aka_agent_send_exclusion_precheck(public.auto_campaigns,bigint,text,text)',
]
const bodyOf = { ...NEW, facts: NEW_FACTS, remote: NEW_REMOTE }
const guardList = REPLACED.map(k => `('${LIVE_MD5[k][0]}','${LIVE_MD5[k][1]}')`).join(',\n   ')

const P2 = `-- V657 phần 2: loại trừ gửi so khớp theo SĐT / Global ID, lọc ở bước nhận data (docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md mục 12).
-- SINH TỪ scripts/build-v657-sql.cjs, không sửa tay. Cần phần 1. Thêm 4 hàm private (khoá người nhận, so khớp, bật bước lọc, bước lọc);
-- viết lại private.aka_agent_send_exclusion_remote / _block_facts; vá snapshot (bộ chạy mới so cả danh sách của Zalo đang gửi theo Global
-- ID), aka_agent_campaign_send_exclusion_runtime (thao tác precheck; "đã gửi N ngày" theo mọi Zalo ID của Global ID),
-- aka_agent_engine_send_exclusion_v1 (như trên), aka_agent_send_exclusion_v2 (thao tác preview), aka_agent_engine_claim_target_v1
-- (bước lọc đầu tiên cùng vòng chống gửi lặp). Kiểm md5 bản đang chạy trước khi thay; gỡ: rollback_v657_send_exclusion_global_match_p2.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
DECLARE r record; v_md5 text;
BEGIN
 IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v657_send_exclusion_global_match_p2') THEN
  RAISE EXCEPTION 'V657 p2 đã có trong sổ migration, không chạy lại';
 END IF;
 IF to_regclass('private.auto_zalo_phone_identity') IS NULL THEN RAISE EXCEPTION 'V657 p2: cần phần 1 trước'; END IF;
 FOR r IN SELECT * FROM (VALUES
   ${guardList}) v(sig, md5) LOOP
  SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO v_md5;
  IF v_md5 IS DISTINCT FROM r.md5 THEN RAISE EXCEPTION 'V657 p2: % khác bản production 25/11 (md5 %)', r.sig, v_md5; END IF;
 END LOOP;
END $pre$;
${NEW_FUNCTIONS}
${REPLACED.map(k => bodyOf[k]).join('\n\n')}

DO $acl$
DECLARE v_role text; v_fn text;
BEGIN
 FOREACH v_fn IN ARRAY ARRAY[${NEW_PRIVATE.map(s => `'${s}'`).join(', ')}] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','aka_agent_desktop','aka_agent_chat_api','service_role'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_role); END IF;
  END LOOP;
 END LOOP;
END $acl$;

DO $post$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   ${REPLACED.map(k => `('${LIVE_MD5[k][0]}')`).join(',\n   ')}) v(sig) LOOP
  IF position('V657' IN pg_get_functiondef(to_regprocedure(r.sig)))=0 THEN RAISE EXCEPTION 'V657 postflight: % chưa thay', r.sig; END IF;
 END LOOP;
 IF has_function_privilege('aka_agent_desktop','private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean)','EXECUTE') THEN
  RAISE EXCEPTION 'V657 postflight: aka_agent_desktop chạy được hàm so khớp';
 END IF;
END $post$;
COMMIT;
`

const P2_ROLLBACK = `-- Gỡ V657 phần 2: trả 7 hàm về đúng thân production 25/11 (kiểm md5), xoá 4 hàm private mới.
BEGIN;
SET LOCAL lock_timeout = '3s';
${REPLACED.map(k => OLD[k]).join('\n\n')}

DROP FUNCTION private.aka_agent_send_exclusion_precheck(public.auto_campaigns,bigint,text,text);
DROP FUNCTION private.aka_agent_send_exclusion_precheck_on(public.auto_campaigns,bigint);
DROP FUNCTION private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean);
DROP FUNCTION private.aka_agent_send_exclusion_person_keys(bigint,text,text,text,text);
DO $post$
DECLARE r record; v_md5 text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   ${guardList}) v(sig, md5) LOOP
  SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO v_md5;
  IF v_md5 IS DISTINCT FROM r.md5 THEN RAISE EXCEPTION 'Gỡ V657 p2: % không về bản production (md5 %)', r.sig, v_md5; END IF;
 END LOOP;
END $post$;
DELETE FROM supabase_migrations.schema_migrations WHERE name='migration_v657_send_exclusion_global_match_p2';
COMMIT;
`

for (const k of REPLACED) if (!bodyOf[k].includes('V657')) throw new Error('thân mới thiếu dấu V657: ' + k)
const out = {
  'migrations/migration_v657_send_exclusion_global_match_p1.sql': P1,
  'migrations/migration_v657_send_exclusion_global_match_p2.sql': P2,
  'migrations/rollback_v657_send_exclusion_global_match_p1.sql': P1_ROLLBACK,
  'migrations/rollback_v657_send_exclusion_global_match_p2.sql': P2_ROLLBACK,
}
if (require.main === module) {
  for (const [file, text] of Object.entries(out)) { fs.writeFileSync(path.join(ROOT, file), text); console.log('ghi', file, text.length) }
}
module.exports = { OLD, NEW: bodyOf, LIVE_MD5, out }

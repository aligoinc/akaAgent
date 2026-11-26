-- V668 p2 (26/11/2026): hàm so khớp loại trừ gửi chỉ dùng dòng zalo_users có Global ID tin được (nguồn gốc dòng, V668 p1).
-- Sinh bằng: node scripts/build-gid-trust-proposal-sql.cjs --migration-p2 (thân match từ V666, gid_ok / person_keys / block_facts
-- từ V657 p2; 9 chỗ thay). Kiểm: scripts/send-exclusion-gid-trust-smoke.cjs, send-exclusion-gid-trust-fuzz.cjs, smoke V657 qua
-- scripts/gid-trust-preload.cjs. Gỡ: migrations/rollback_v668_zalo_users_global_id_guard_p2.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v668_zalo_users_global_id_guard_p1') THEN
  RAISE EXCEPTION 'V668 p2 cần V668 p1 trước';
 END IF;
 IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v668_zalo_users_global_id_guard_p2') THEN
  RAISE EXCEPTION 'V668 p2 đã có trong sổ migration, không chạy lại';
 END IF;
 IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_zalo_user_gid_trusted(jsonb,text)'))) IS DISTINCT FROM '5cb04d481f679bcd5bf24de8a202b011' THEN
  RAISE EXCEPTION 'V668 p2: private.aka_agent_zalo_user_gid_trusted khác bản V668 p1';
 END IF;
END $pre$;
DO $pre$
DECLARE r record; v_md5 text;
BEGIN
 FOR r IN SELECT * FROM (VALUES ('private.aka_agent_zalo_gid_ok(bigint,text)','1b8c3ec56d0a289aaa73309be1f876a2'),
  ('private.aka_agent_send_exclusion_person_keys(bigint,text,text,text,text)','01b21650e451fa8855e27477fd341297'),
  ('private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean)','634462cc73b51aecc5a7aa80d3f989c3'),
  ('private.aka_agent_send_exclusion_block_facts(public.auto_campaigns,bigint,text,text,jsonb)','907673fd7a7d58c594bdcae574fba6c2')) x(sig, md5) LOOP
  SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO v_md5;
  IF v_md5 IS DISTINCT FROM r.md5 THEN RAISE EXCEPTION 'Đề xuất Global ID theo nguồn gốc: % khác bản production 26/11 sau V666 (md5 %)', r.sig, v_md5; END IF;
 END LOOP;
END $pre$;

CREATE OR REPLACE FUNCTION private.aka_agent_zalo_gid_ok(p_account bigint, p_gid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 -- Global ID p_gid ghi ở zalo_users của tài khoản p_account có dùng được làm Global ID của MỘT người không: không phải Global ID của
 -- chính nick; dưới 4 dòng cùng Global ID ở tài khoản này (đọc tối đa 4 dòng qua idx_zalo_users_account_global_id); có ít nhất một
 -- dòng tin được nếu có dòng (private.aka_agent_zalo_user_gid_trusted); và luật cũ "2–3 dòng mỗi dòng một tên" xét trên các dòng tin được (dòng
 -- quét nhóm mang Global ID người xem không được tính, nên không còn lọt khi nick không ghi nhận / đổi nick / có tên rỗng; dòng không có
 -- dấu vết nguồn gốc vẫn bị luật tên chặn như V657). Nơi đọc dòng theo Global ID phải lọc thêm dòng tin được.
 SELECT CASE
  WHEN NULLIF(btrim(COALESCE(p_gid,'')),'') IS NULL THEN false
  WHEN btrim(p_gid) = ANY(private.aka_agent_zalo_own_global_ids(p_account)) THEN false
  -- Không có dòng nào: dùng được (như V657; nhánh chiến dịch đã gửi so data->'target'->>'globalId' của tài khoản không lưu dòng).
  ELSE (SELECT count(*) < 4 AND (count(*) = 0 OR count(*) FILTER (WHERE x.ok) >= 1)
      AND NOT (count(*) FILTER (WHERE x.ok) >= 2 AND count(DISTINCT x.nm) FILTER (WHERE x.ok) = count(*) FILTER (WHERE x.ok)) FROM (
    SELECT private.aka_agent_zalo_user_gid_trusted(zu.raw_payload, zu.global_id) ok,
      lower(btrim(COALESCE(NULLIF(btrim(zu.zalo_name),''),NULLIF(btrim(zu.display_name),'')))) nm FROM public.zalo_users zu
     WHERE zu.account_id = p_account AND zu.global_id = btrim(p_gid) AND zu.global_id IS NOT NULL AND zu.global_id <> '' LIMIT 4) x)
 END;
$function$;

CREATE OR REPLACE FUNCTION private.aka_agent_send_exclusion_person_keys(p_account bigint, p_uid text, p_phone text, p_email text, p_global_id text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 -- V657: khoá lịch sử gửi (aka_agent_internal_delivery_cooldown_target_keys) của người nhận ở một tài khoản, cộng khoá của MỌI Zalo ID
 -- riêng mà tài khoản đó từng ghi cho cùng Global ID (Zalo ID riêng đổi theo thời gian ngay trên một nick; đo 25/11: 18% cặp lần tra).
 WITH g0 AS (
  SELECT COALESCE(NULLIF(btrim(COALESCE(p_global_id,'')),''),
   (SELECT NULLIF(btrim(zu.global_id),'') FROM public.zalo_users zu WHERE zu.account_id=p_account AND zu.zalo_uid=btrim(COALESCE(p_uid,''))
     AND private.aka_agent_zalo_user_gid_trusted(zu.raw_payload, zu.global_id))) gid),
 -- Global ID ghi sai (của chính nick, gom nhiều người) thì không mở rộng.
 g AS (SELECT g0.gid FROM g0 WHERE private.aka_agent_zalo_gid_ok(p_account,g0.gid))
 SELECT COALESCE(array_agg(DISTINCT k ORDER BY k),'{}') FROM (
  SELECT unnest(public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',p_uid,p_phone,p_email)) k
  UNION ALL
  SELECT unnest(public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',zu.zalo_uid,NULL,NULL))
   FROM g JOIN public.zalo_users zu ON zu.account_id=p_account AND zu.global_id=g.gid AND zu.global_id IS NOT NULL AND zu.global_id<>''
    AND private.aka_agent_zalo_user_gid_trusted(zu.raw_payload, zu.global_id)
 ) x WHERE k IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION private.aka_agent_send_exclusion_match(p_campaign auto_campaigns, p_account bigint, p_selection jsonb, p_phone text, p_global_id text, p_uid text, p_final boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V666: chiến dịch đã gửi tra một lượt; aka_agent.send_exclusion_identity=off (xem trước data tự nhập) thì không dùng bảng đối chiếu SĐT ↔ Global ID.
-- Nhóm data bị gỡ chia sẻ giữa lượt vẫn loại trừ (fail closed); lượt sau snapshot báo send_exclusion_data_group_not_found, chiến dịch tạm dừng.
-- V657 (docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md mục 12): một người = SĐT đã chuẩn hoá + Global ID. Zalo ID riêng chỉ dùng để
-- tra Global ID (zalo_users của tài khoản gửi), và một Global ID đổi ra MỌI Zalo ID riêng đã ghi ở từng tài khoản. Trùng SĐT hoặc trùng
-- Global ID là cùng một người (SĐT ↔ Global ID một-một, đo 25/11). Hai tài khoản cùng nick Zalo so thẳng Zalo ID riêng. Global ID ghi
-- sai trong zalo_users (của chính nick, gom nhiều người: private.aka_agent_zalo_gid_ok) không bao giờ dùng. Nguồn: danh sách Zalo ID
-- (mọi Zalo, kể cả Zalo đang gửi), Nhóm data (SĐT / Zalo UID), chiến dịch đã gửi (đã nhận tin nhắn thành công). Khớp nhiều nguồn thì lấy
-- theo thứ tự đó, trong mỗi loại theo tên, id.
-- needGlobalId: còn nguồn cần Global ID mà chưa có (bước nhận data của chiến dịch theo SĐT thì để bước sau khi tra số kiểm lại);
-- p_final = true (sau khi tra số / đọc hồ sơ) thì trả unknown: không gửi.
DECLARE v_phone text; v_gid text; v_gid_from text; v_phones text[]; v_accounts bigint[]; v_zalo_accounts bigint[]; v_match jsonb;
 v_need boolean:=false; v_lists bigint[]; v_groups bigint[]; v_has_person boolean; v_has_phone_group boolean; sc record; v_at timestamptz; v_at2 timestamptz;
 v_gid_uids text[]; v_uid text; v_nick bigint[]; v_cand_uids text[]; v_gid_accounts bigint[];
 v_sent bigint[]; v_hit bigint; v_identity boolean:=COALESCE(current_setting('aka_agent.send_exclusion_identity',true),'')<>'off';
BEGIN
 v_phone:=NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(p_phone,'')),'');
 v_uid:=NULLIF(btrim(COALESCE(p_uid,'')),'');
 v_gid:=NULLIF(btrim(COALESCE(p_global_id,'')),'');
 -- Global ID của chính nick đang gửi không phải của người nhận.
 IF v_gid IS NOT NULL AND v_gid=ANY(private.aka_agent_zalo_own_global_ids(p_account)) THEN v_gid:=NULL; END IF;
 IF v_gid IS NOT NULL THEN v_gid_from:='target'; END IF;
 IF v_gid IS NULL AND v_uid IS NOT NULL THEN
  SELECT NULLIF(btrim(zu.global_id),'') INTO v_gid FROM public.zalo_users zu WHERE zu.account_id=p_account AND zu.zalo_uid=v_uid
   AND private.aka_agent_zalo_user_gid_trusted(zu.raw_payload, zu.global_id);
  IF NOT private.aka_agent_zalo_gid_ok(p_account,v_gid) THEN v_gid:=NULL; END IF;
  IF v_gid IS NOT NULL THEN v_gid_from:='uid'; END IF;
 END IF;
 IF v_gid IS NULL AND v_phone IS NOT NULL AND v_identity THEN
  SELECT i.global_id INTO v_gid FROM private.auto_zalo_phone_identity i WHERE i.phone=v_phone;
  IF v_gid IS NOT NULL AND v_gid=ANY(private.aka_agent_zalo_own_global_ids(p_account)) THEN v_gid:=NULL; END IF;
  IF v_gid IS NOT NULL THEN v_gid_from:='phone_history'; END IF;
 END IF;
 IF v_phone IS NOT NULL THEN v_phones:=ARRAY[v_phone];
 ELSIF v_gid IS NOT NULL AND v_identity THEN
  SELECT COALESCE(array_agg(i.phone ORDER BY i.phone),'{}') INTO v_phones FROM private.auto_zalo_phone_identity i WHERE i.global_id=v_gid;
 ELSE v_phones:='{}';
 END IF;
 -- Tài khoản cùng nick với tài khoản gửi: so thẳng Zalo ID riêng của data.
 v_nick:=CASE WHEN v_uid IS NOT NULL THEN private.aka_agent_zalo_same_nick_accounts(p_account) ELSE '{}' END;
 -- Tài khoản của tổ chức (đi qua nhân viên: auto_accounts không có chỉ mục theo tổ chức). Chỉ khi có Nhóm data / chiến dịch đã gửi.
 IF cardinality(private.aka_agent_send_exclusion_ids(p_selection->'dataGroupIds'))>0 OR cardinality(private.aka_agent_send_exclusion_ids(p_selection->'sentCampaignIds'))>0 THEN
  SELECT COALESCE(array_agg(a.id ORDER BY a.id),'{}'), COALESCE(array_agg(a.id ORDER BY a.id) FILTER (WHERE a.flatform_type='zalo'),'{}')
   INTO v_accounts, v_zalo_accounts FROM public.org_staff s JOIN public.auto_accounts a ON a.staff_id=s.id
   WHERE s.organization_id=p_campaign.organization_id AND a.organization_id=p_campaign.organization_id;
 END IF;

 -- Tài khoản Zalo của tổ chức có dòng zalo_users mang Global ID này và Global ID dùng được ở đó (kiểm một lần mỗi tài khoản, trước khi
 -- quét dòng: Global ID của một nick có thể là Global ID ghi sai của hàng chục nghìn dòng ở tài khoản của nick đó).
 IF v_gid IS NOT NULL AND cardinality(v_zalo_accounts)>0 THEN
  SELECT COALESCE(array_agg(a.id ORDER BY a.id),'{}') INTO v_gid_accounts FROM unnest(v_zalo_accounts) a(id)
   WHERE CASE WHEN EXISTS(SELECT 1 FROM public.zalo_users zu WHERE zu.account_id=a.id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>'')
     THEN private.aka_agent_zalo_gid_ok(a.id,v_gid) ELSE false END;
 ELSE v_gid_accounts:='{}';
 END IF;

 -- 1. Danh sách Zalo ID loại trừ (mọi Zalo, kể cả Zalo đang gửi): thành viên → Global ID qua zalo_users của tài khoản của danh sách;
 -- danh sách của tài khoản cùng nick: so thẳng Zalo ID riêng.
 SELECT COALESCE(array_agg(bl.id),'{}') INTO v_lists FROM public.auto_account_contact_groups bl
  WHERE bl.id=ANY(private.aka_agent_send_exclusion_ids(p_selection->'blocklistIds')) AND NOT bl.is_delete AND bl.purpose='zalo_friend_blocklist'
    AND bl.staff_id=p_campaign.staff_id AND bl.organization_id=p_campaign.organization_id;
 IF cardinality(v_lists)>0 THEN
  SELECT jsonb_build_object('kind','blocklist','id',bl.id,'name',bl.name,'note',format('Thuộc danh sách Zalo ID loại trừ “%s”.',bl.name)) INTO v_match
   FROM public.auto_account_contact_groups bl
   WHERE bl.id=ANY(v_lists) AND (
     (v_gid IS NOT NULL AND CASE WHEN private.aka_agent_zalo_gid_ok(bl.account_id,v_gid) THEN EXISTS(
      SELECT 1 FROM public.zalo_users zu
       JOIN public.auto_account_contacts ac ON ac.account_id=bl.account_id AND ac.contact_type='person' AND ac.uid=zu.zalo_uid AND NOT ac.is_delete
       JOIN public.auto_account_contact_group_members m ON m.group_id=bl.id AND m.contact_id=ac.id AND NOT m.is_delete
      WHERE zu.account_id=bl.account_id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>''
        AND private.aka_agent_zalo_user_gid_trusted(zu.raw_payload, zu.global_id)) ELSE false END)
     OR (bl.account_id=ANY(v_nick) AND EXISTS(
      SELECT 1 FROM public.auto_account_contacts ac
       JOIN public.auto_account_contact_group_members m ON m.group_id=bl.id AND m.contact_id=ac.id AND NOT m.is_delete
      WHERE ac.account_id=bl.account_id AND ac.contact_type='person' AND ac.uid=v_uid AND NOT ac.is_delete)))
   ORDER BY bl.name, bl.id LIMIT 1;
  IF v_match IS NULL AND v_gid IS NULL THEN v_need:=true; END IF;
 END IF;

 -- 2. Nhóm data (Số điện thoại / Zalo User): liên hệ loại SĐT so SĐT (uid = SĐT chuẩn hoá), liên hệ Zalo so Global ID (hoặc so thẳng
 -- Zalo ID riêng khi liên hệ thuộc tài khoản cùng nick).
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
     SELECT m.group_id FROM unnest(v_gid_accounts) a(id)
      CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE v_has_person AND zu.account_id=a.id AND zu.global_id=v_gid
        AND zu.global_id IS NOT NULL AND zu.global_id<>'' AND private.aka_agent_zalo_user_gid_trusted(zu.raw_payload, zu.global_id) OFFSET 0) zu
      JOIN public.auto_account_contacts ct ON ct.account_id=a.id AND ct.contact_type='person' AND ct.uid=zu.zalo_uid AND NOT ct.is_delete
      JOIN public.auto_account_contact_group_members m ON m.contact_id=ct.id AND m.group_id=ANY(v_groups) AND NOT m.is_delete
     UNION ALL
     SELECT m.group_id FROM unnest(v_nick) a(id)
      JOIN public.auto_account_contacts ct ON v_has_person AND ct.account_id=a.id AND ct.contact_type='person' AND ct.uid=v_uid AND NOT ct.is_delete
       AND ct.organization_id=p_campaign.organization_id
      JOIN public.auto_account_contact_group_members m ON m.contact_id=ct.id AND m.group_id=ANY(v_groups) AND NOT m.is_delete
    ) h JOIN public.auto_account_contact_groups g ON g.id=h.group_id
    ORDER BY g.name, g.id LIMIT 1;
   IF v_match IS NULL AND v_has_person AND v_gid IS NULL THEN v_need:=true; END IF;
   IF v_match IS NULL AND v_has_phone_group AND v_phone IS NULL AND v_gid IS NULL THEN v_need:=true; END IF;
  END IF;
 END IF;

 -- 3. Chiến dịch đã gửi: data của chiến dịch đó có cùng SĐT, hoặc có Zalo ID riêng của cùng người (Zalo ID của data thuộc Global ID ở
 -- tài khoản đã gửi, hoặc kết quả gửi ghi Global ID đó, hoặc tài khoản đã gửi cùng nick và cùng Zalo ID), và đã nhận tin nhắn (bạn bè /
 -- người lạ) thành công. Zalo ID riêng có thể trùng giữa các nick (đo 25/11) nên không so Zalo ID khác nick. Tra qua
 -- idx_campaign_input_cooldown_phone / _uid rồi idx_campaign_details_input_data_id.
 IF v_match IS NULL AND cardinality(private.aka_agent_send_exclusion_ids(p_selection->'sentCampaignIds'))>0 THEN
  v_gid_uids:='{}';
  IF v_gid IS NOT NULL THEN
   -- Mọi Zalo ID riêng của Global ID ở các tài khoản Zalo của tổ chức (tính một lần cho mọi chiến dịch).
   SELECT COALESCE(array_agg(DISTINCT lower(btrim(zu.zalo_uid))),'{}') INTO v_gid_uids FROM unnest(v_gid_accounts) a(id)
    CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE zu.account_id=a.id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>''
      AND private.aka_agent_zalo_user_gid_trusted(zu.raw_payload, zu.global_id) OFFSET 0) zu
    WHERE btrim(zu.zalo_uid)<>'';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT u),'{}') INTO v_cand_uids FROM unnest(v_gid_uids || CASE WHEN v_uid IS NOT NULL THEN ARRAY[lower(v_uid)] ELSE '{}'::text[] END) u;
 END IF;
 IF v_match IS NULL THEN
  v_sent:=ARRAY(SELECT c.id FROM public.auto_campaigns c
    WHERE c.id=ANY(private.aka_agent_send_exclusion_ids(p_selection->'sentCampaignIds')) AND c.staff_id=p_campaign.staff_id
      AND c.organization_id=p_campaign.organization_id AND c.id IS DISTINCT FROM p_campaign.id ORDER BY c.id);
  IF cardinality(v_sent)>0 THEN
   IF v_gid IS NULL THEN v_need:=true; END IF;
   -- V666: một lượt tra cho mọi chiến dịch đã chọn (trước: mỗi chiến dịch tra lại mọi data có SĐT / Zalo ID đó). Lấy chiến dịch id nhỏ
   -- nhất có khớp, ngày gửi mới nhất của chiến dịch đó (như vòng lặp cũ).
   SELECT h.cid, max(h.at) INTO v_hit, v_at FROM (
     SELECT i.campaign_id cid, dd.created_at at FROM unnest(v_phones) p(ph)
      CROSS JOIN LATERAL (SELECT i.id, i.campaign_id FROM public.auto_campaign_input_data i WHERE md5(public.normalize_phone(i.phone))=md5(p.ph)
        AND i.phone IS NOT NULL AND btrim(i.phone)<>'' AND i.campaign_id+0=ANY(v_sent) OFFSET 0) i
      CROSS JOIN LATERAL (SELECT d.created_at FROM public.auto_campaign_details d WHERE d.input_data_id=i.id AND d.campaign_id+0=i.campaign_id
       AND d.action_code IN ('zalo_message_friend','zalo_message_stranger') AND NOT d.is_delete
       AND (d.policy_snapshot->>'operationState'='committed' OR (d.policy_snapshot->>'operationState' IS NULL AND d.status IN ('thành công','đã gửi','đã nhận','đã xem','đã click'))) OFFSET 0) dd
     UNION ALL
     SELECT i.campaign_id, dd.created_at FROM unnest(COALESCE(v_cand_uids,'{}'::text[])) u(uid)
      CROSS JOIN LATERAL (SELECT i.id, i.campaign_id, btrim(i.uid) iuid FROM public.auto_campaign_input_data i WHERE md5(lower(btrim(i.uid)))=md5(u.uid)
        AND i.uid IS NOT NULL AND btrim(i.uid)<>'' AND i.campaign_id+0=ANY(v_sent) OFFSET 0) i
      CROSS JOIN LATERAL (SELECT d.created_at FROM public.auto_campaign_details d WHERE d.input_data_id=i.id AND d.campaign_id+0=i.campaign_id
       AND d.action_code IN ('zalo_message_friend','zalo_message_stranger') AND NOT d.is_delete
       AND (d.policy_snapshot->>'operationState'='committed' OR (d.policy_snapshot->>'operationState' IS NULL AND d.status IN ('thành công','đã gửi','đã nhận','đã xem','đã click')))
       AND ((v_uid IS NOT NULL AND d.account_id=ANY(v_nick) AND lower(i.iuid)=lower(v_uid))
         OR (v_gid IS NOT NULL AND private.aka_agent_zalo_gid_ok(d.account_id,v_gid) AND (
           NULLIF(btrim(d.data->'target'->>'globalId'),'')=v_gid
           OR EXISTS(SELECT 1 FROM public.zalo_users zu WHERE zu.account_id=d.account_id AND zu.zalo_uid=i.iuid AND zu.global_id=v_gid
             AND private.aka_agent_zalo_user_gid_trusted(zu.raw_payload, zu.global_id)))))
       OFFSET 0) dd
    ) h GROUP BY h.cid ORDER BY h.cid LIMIT 1;
   IF v_hit IS NOT NULL THEN
    SELECT jsonb_build_object('kind','campaign','id',c.id,'name',c.name,'sentAt',v_at,
     'note',format('Đã được gửi ở chiến dịch “%s” ngày %s.',c.name,to_char(timezone('Asia/Ho_Chi_Minh',v_at),'DD/MM'))) INTO v_match
     FROM public.auto_campaigns c WHERE c.id=v_hit;
   END IF;
  END IF;
 END IF;

 RETURN jsonb_build_object('match',v_match,'globalId',v_gid,'globalIdFrom',v_gid_from,'phone',v_phone,
  'needGlobalId',v_match IS NULL AND v_need,
  'unknown',CASE WHEN v_match IS NULL AND v_need AND p_final THEN 'Chưa xác định được khách để kiểm tra loại trừ.' END);
END;
$function$;

CREATE OR REPLACE FUNCTION private.aka_agent_send_exclusion_block_facts(p_campaign public.auto_campaigns, p_block_account bigint, p_global_id text, p_phone text, p_rules jsonb)
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
 -- Global ID ghi sai ở Zalo này (của chính nick, gom nhiều người) thì không có Zalo ID nào của người nhận ở đây.
 IF p_global_id IS NOT NULL AND private.aka_agent_zalo_gid_ok(p_block_account,p_global_id) THEN
  SELECT COALESCE(array_agg(zu.zalo_uid ORDER BY zu.id),'{}'), COALESCE(bool_or(zu.is_fr=1),false) INTO v_uids, v_any_fr FROM public.zalo_users zu
   WHERE zu.account_id=p_block_account AND zu.global_id=p_global_id AND zu.global_id IS NOT NULL AND zu.global_id<>''
     AND private.aka_agent_zalo_user_gid_trusted(zu.raw_payload, zu.global_id);
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

COMMIT;

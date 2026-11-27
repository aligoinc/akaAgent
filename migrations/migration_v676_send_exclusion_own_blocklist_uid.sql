-- V676 (27/11/2026): loại trừ gửi theo danh sách Zalo ID không đòi Zalo global ID khi danh sách thuộc tài khoản cùng nick với
-- tài khoản gửi (gồm chính nó): so thẳng Zalo ID riêng là đủ. Danh sách của Zalo khác nick, Nhóm data, chiến dịch đã gửi vẫn cần Global ID
-- như V666 / V668. Chỉ thay thân private.aka_agent_send_exclusion_match (md5 86daa2d825167120257250df5b88eaba → 1fdc59611507e67bb6d0db7ea8766b67); quyền, chủ, cấu hình giữ nguyên.
-- Có hiệu lực ngay cho mọi nơi chạy (Desktop, App Server, Fly) vì hàm chạy trong DB; không cần phát hành app.
-- Sinh bằng: node scripts/build-v676-sql.cjs   Kiểm: scripts/send-exclusion-v676-smoke.cjs   Gỡ: migrations/rollback_v676_send_exclusion_own_blocklist_uid.sql
-- Thay thân hàm làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $ledger$
BEGIN
  -- Hai IF lồng: một biểu thức AND vẫn phân tích bảng sổ cả khi to_regclass trả NULL (DB không có sổ).
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration\_v676\_%') THEN
      RAISE EXCEPTION 'V676 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
END $ledger$;
DO $pre$
DECLARE v_md5 text := md5(pg_get_functiondef(to_regprocedure('private.aka_agent_send_exclusion_match(auto_campaigns,bigint,jsonb,text,text,text,boolean)')));
BEGIN
  IF v_md5 IS DISTINCT FROM '86daa2d825167120257250df5b88eaba' THEN
    RAISE EXCEPTION 'Thân private.aka_agent_send_exclusion_match khác bản đã đọc 27/11/2026, dừng (md5 %, cần 86daa2d825167120257250df5b88eaba)', coalesce(v_md5, 'không có hàm');
  END IF;
END $pre$;

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
  -- Danh sách của tài khoản cùng nick (gồm chính tài khoản gửi): đã so thẳng Zalo ID riêng ở trên, không khớp là không thuộc danh sách.
  -- Chỉ cần Global ID khi còn danh sách của Zalo khác nick (không có Zalo ID riêng của cùng người để so).
  IF v_match IS NULL AND v_gid IS NULL AND EXISTS (SELECT 1 FROM public.auto_account_contact_groups bl
     WHERE bl.id=ANY(v_lists) AND NOT coalesce(bl.account_id=ANY(v_nick), false)) THEN v_need:=true; END IF;
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
$function$
;

DO $post$
DECLARE v_md5 text := md5(pg_get_functiondef(to_regprocedure('private.aka_agent_send_exclusion_match(auto_campaigns,bigint,jsonb,text,text,text,boolean)')));
BEGIN
  IF v_md5 IS DISTINCT FROM '1fdc59611507e67bb6d0db7ea8766b67' THEN
    RAISE EXCEPTION 'Thân mới không như bản sinh (md5 %, cần 1fdc59611507e67bb6d0db7ea8766b67)', coalesce(v_md5, 'không có hàm');
  END IF;
END $post$;
COMMIT;

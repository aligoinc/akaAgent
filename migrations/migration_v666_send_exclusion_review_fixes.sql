-- V666: sửa lỗi review loại trừ gửi V654–V657 (docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md mục 13).
-- SINH TỪ scripts/build-v666-sql.cjs, không sửa tay. Thay 7 hàm (kiểm md5 bản production 26/11 trước khi thay, có hai hàm nhận lượt),
-- thêm 5 hàm private (công tắc campaign.send_exclusion_multi_zalo_v2, phần mềm chạy, so lựa chọn, kiểm lúc nhận lượt) và thiết lập
-- send_exclusion.runtime = {"server":false,"desktopMinVersion":null} (chưa ai lưu được cấu hình mới cho tới khi đặt). CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v666_send_exclusion_review_fixes.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
DECLARE r record; v_md5 text;
BEGIN
 IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v666_send_exclusion_review_fixes') THEN
  RAISE EXCEPTION 'V666 đã có trong sổ migration, không chạy lại';
 END IF;
 IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v666_%') THEN RAISE EXCEPTION 'V666: số đã dùng cho migration khác'; END IF;
 IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v657_send_exclusion_global_match_p2') THEN RAISE EXCEPTION 'V666: cần V657 p2 trước'; END IF;
 IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key='send_exclusion.runtime') THEN RAISE EXCEPTION 'V666: thiết lập send_exclusion.runtime đã có'; END IF;
 FOR r IN SELECT * FROM (VALUES
   ('private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean)','1fce92fdbf84c29d3eaf18296141f6f6'),
   ('public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)','54721efc19e365fc2a4181e62a7f596a'),
   ('private.aka_agent_zalo_phone_identity_ingest(integer,integer)','327a2977660ba8198bcb90b67c2a68c4'),
   ('public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)','b8fb3c31c939426a8e2ac2f9d60da7c7'),
   ('public.aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)','0fdbb44da58b3ef82bdd85224922c428'),
   ('public.aka_agent_engine_claim_target_v1(jsonb)','8f574b0a75065ce562bc56f043f24967'),
   ('public.auto_validate_campaign_send_exclusion()','8e4fd7dc98cfcb610af35dd37440a360')) v(sig, md5) LOOP
  SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO v_md5;
  IF v_md5 IS DISTINCT FROM r.md5 THEN RAISE EXCEPTION 'V666: % khác bản production 26/11 (md5 %)', r.sig, v_md5; END IF;
 END LOOP;
END $pre$;

-- ===================================================================================================== công tắc + phần mềm chạy
CREATE FUNCTION private.aka_agent_send_exclusion_multi_on(p_staff bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V666: công tắc campaign.send_exclusion_multi_zalo_v2 ({"audience":"off"|"admin_akabiz"|"all"}) có mở cho nhân viên không (như form Desktop /
-- Web bản mới đọc; khoá cũ campaign.send_exclusion_multi_zalo do Desktop 10.7.0 / Web v144 đọc, giữ tắt). Thiếu dòng / sai JSON = tắt.
DECLARE v_raw text; v_cfg jsonb; v_audience text;
BEGIN
 SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key='campaign.send_exclusion_multi_zalo_v2' AND s.is_active LIMIT 1;
 BEGIN
  v_cfg:=NULLIF(btrim(COALESCE(v_raw,'')),'')::jsonb;
 EXCEPTION WHEN OTHERS THEN RETURN false;
 END;
 v_audience:=CASE WHEN jsonb_typeof(v_cfg)='object' THEN v_cfg->>'audience' END;
 RETURN COALESCE(v_audience='all' OR (v_audience='admin_akabiz' AND EXISTS(SELECT 1 FROM public.org_staff s WHERE s.id=p_staff AND s.is_admin_akabiz IS TRUE)),false);
END;
$function$;

CREATE FUNCTION private.aka_agent_send_exclusion_runtime_ready(p_staff bigint, p_server boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V666: phần mềm chạy tài khoản đã chạy được cấu hình loại trừ mới chưa (bản cũ bỏ qua hẳn Nhóm data / chiến dịch đã gửi). Thiết lập
-- send_exclusion.runtime:
--  - Zalo Server: server = true sau khi cài App Server mới VÀ deploy ChatApi worker có bản sửa;
--  - Desktop: máy đang gắn với tài khoản (org_staff.aka_agent_device_fingerprint_hash) chạy bản ≥ desktopMinVersion ở phiên mới nhất, và
--    mọi máy khác đang mở app (phiên chưa kết thúc, thấy trong 1 ngày; đo 26/11: 2 nhân viên / 7 ngày chạy 2 máy cùng lúc) cũng vậy.
--    Không xét mọi phiên trong 30 ngày như V511: mỗi lần mở app là một dòng, 440 / 610 nhân viên có phiên bản cũ trong 30 ngày sau khi cập nhật.
DECLARE v_raw text; v_cfg jsonb; v_min text; v_min_parts integer[]; v_hash text; v_version text;
BEGIN
 SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key='send_exclusion.runtime' AND s.is_active LIMIT 1;
 BEGIN
  v_cfg:=NULLIF(btrim(COALESCE(v_raw,'')),'')::jsonb;
 EXCEPTION WHEN OTHERS THEN RETURN false;
 END;
 IF v_cfg IS NULL OR jsonb_typeof(v_cfg)<>'object' THEN RETURN false; END IF;
 IF p_server THEN RETURN jsonb_typeof(v_cfg->'server')='boolean' AND (v_cfg->>'server')::boolean; END IF;
 v_min:=v_cfg->>'desktopMinVersion';
 IF jsonb_typeof(v_cfg->'desktopMinVersion') IS DISTINCT FROM 'string' OR v_min !~ '^\d{1,6}(\.\d{1,6}){0,3}$' THEN RETURN false; END IF;
 v_min_parts:=string_to_array(v_min,'.')::integer[];
 SELECT NULLIF(btrim(s.aka_agent_device_fingerprint_hash),'') INTO v_hash FROM public.org_staff s WHERE s.id=p_staff;
 IF v_hash IS NULL THEN RETURN false; END IF;
 SELECT d.app_version INTO v_version FROM public.auto_staff_device_presence d
  WHERE d.staff_id=p_staff AND d.device_fingerprint_hash=v_hash ORDER BY d.last_seen_at DESC LIMIT 1;
 IF v_version IS NULL OR v_version !~ '^\d{1,6}(\.\d{1,6}){0,3}$' OR string_to_array(v_version,'.')::integer[]<v_min_parts THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM public.auto_staff_device_presence d WHERE d.staff_id=p_staff AND d.ended_at IS NULL
   AND d.last_seen_at>now()-interval '1 day' AND d.device_fingerprint_hash IS DISTINCT FROM v_hash
   AND (d.app_version IS NULL OR d.app_version !~ '^\d{1,6}(\.\d{1,6}){0,3}$' OR string_to_array(d.app_version,'.')::integer[]<v_min_parts));
END;
$function$;

-- ===================================================================================================== so lựa chọn
CREATE FUNCTION private.aka_agent_send_exclusion_entry_norm(p_entry jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 -- V666: lựa chọn của một Zalo để so (khoá dataGroupIds / sentCampaignIds thiếu = mảng rỗng): client trước V666 bỏ mảng rỗng, client
 -- mới luôn ghi đủ, hai cách ghi cùng nghĩa không được coi là đổi lựa chọn.
 SELECT CASE WHEN jsonb_typeof(p_entry)='object' THEN jsonb_build_object('dataGroupIds','[]'::jsonb,'sentCampaignIds','[]'::jsonb)||p_entry ELSE p_entry END;
$function$;

CREATE FUNCTION private.aka_agent_send_exclusion_map_norm(p_map jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN jsonb_typeof(p_map)='object' THEN COALESCE((SELECT jsonb_object_agg(e.key,private.aka_agent_send_exclusion_entry_norm(e.value)) FROM jsonb_each(p_map) e),'{}'::jsonb) ELSE p_map END;
$function$;

-- ===================================================================================================== kiểm lúc nhận lượt
CREATE FUNCTION private.aka_agent_send_exclusion_claim_check(p_campaign_id bigint, p_account_id bigint, p_runner text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V666 (anh chốt 26/11: chặn lúc nhận lượt): bộ chạy bản mới báo đã chạy được cấu hình loại trừ mới (engine: ctx.sendExclusionRunner;
-- bộ cũ Desktop / App Server: header x-aka-send-exclusion-runner qua PostgREST). Bộ chạy không báo (Desktop / App Server <= 10.7.0, bộ cũ
-- ChatApi) mà lựa chọn của tài khoản này cần bản mới (aka_agent_send_exclusion_needs_v2) thì chiến dịch chuyển tạm dừng kèm ghi chú, trả
-- ghi chú; ngược lại trả NULL. Bản <= 10.6 bỏ qua hẳn Nhóm data / chiến dịch đã gửi nên đây là chốt cuối trước khi gửi nhầm.
DECLARE v_runner text:=btrim(COALESCE(p_runner,'')); v_headers text; v_sel jsonb; v_server boolean; v_note text;
BEGIN
 IF v_runner='' THEN
  BEGIN
   v_headers:=NULLIF(current_setting('request.headers',true),'');
   v_runner:=btrim(COALESCE((v_headers::jsonb)->>'x-aka-send-exclusion-runner',''));
  EXCEPTION WHEN OTHERS THEN v_runner:='';
  END;
 END IF;
 IF v_runner ~ '^[0-9]{1,3}$' AND v_runner::integer>=1 THEN RETURN NULL; END IF;
 SELECT c.extra_settings->'zaloSendExclusionsByAccountId'->(p_account_id::text) INTO v_sel FROM public.auto_campaigns c WHERE c.id=p_campaign_id;
 IF jsonb_typeof(v_sel) IS DISTINCT FROM 'object' OR NOT COALESCE(private.aka_agent_send_exclusion_needs_v2(v_sel,p_account_id),false) THEN RETURN NULL; END IF;
 SELECT COALESCE(a.is_zalo_server,false) AND NOT COALESCE(a.is_zalo_show_web,false) INTO v_server FROM public.auto_accounts a WHERE a.id=p_account_id;
 v_note:=CASE WHEN COALESCE(v_server,false)
   THEN 'Loại trừ theo Nhóm data, chiến dịch đã gửi hoặc nhiều Zalo chưa dùng được với tài khoản Zalo Server.'
   ELSE 'akaAgent trên máy này là bản cũ nên chưa chạy được loại trừ theo Nhóm data, chiến dịch đã gửi hoặc nhiều Zalo. Hãy cập nhật akaAgent rồi bấm Tiếp tục.' END;
 UPDATE public.auto_campaigns SET status='tạm dừng', note=v_note, updated_at=clock_timestamp()
  WHERE id=p_campaign_id AND status IN ('chờ xử lý','đang chạy') AND runtime_claim_token IS NULL AND runtime_unit_token IS NULL;
 RETURN v_note;
END;
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
  SELECT NULLIF(btrim(zu.global_id),'') INTO v_gid FROM public.zalo_users zu WHERE zu.account_id=p_account AND zu.zalo_uid=v_uid;
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
      WHERE zu.account_id=bl.account_id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>'') ELSE false END)
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
        AND zu.global_id IS NOT NULL AND zu.global_id<>'' OFFSET 0) zu
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
    CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE zu.account_id=a.id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>'' OFFSET 0) zu
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
           OR EXISTS(SELECT 1 FROM public.zalo_users zu WHERE zu.account_id=d.account_id AND zu.zalo_uid=i.iuid AND zu.global_id=v_gid))))
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

CREATE OR REPLACE FUNCTION public.aka_agent_send_exclusion_v2(p_staff_id bigint, p_organization_id bigint, p_operation text, p_payload jsonb, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
-- V666: preview không dùng bảng đối chiếu cho data tự nhập; lists che Nhóm data đã xoá của người khác, lọc trạng thái, đếm "đã gửi" có hạn; save kiểm công tắc.
DECLARE v_account bigint; v_query text; v_ids bigint[]; v_exclude bigint; gid bigint; v_revision bigint; v_request uuid; v_blocks jsonb; v_block jsonb;
 v_n integer; v_primary bigint; v_ga bigint; r jsonb; v_prior jsonb; v_idx integer; v_payload_cmp jsonb; v_prior_cmp jsonb;
 v_sel jsonb; v_c public.auto_campaigns%ROWTYPE; v_cid bigint; v_after bigint; v_limit integer; v_deadline timestamptz; v_m jsonb; v_checked integer:=0;
 v_excluded integer:=0; v_pending integer:=0; v_sources jsonb:='{}'; v_last bigint; v_more boolean:=false; v_key text; tg record;
 v_status text; v_campaign_list jsonb; v_cnt bigint; v_list_deadline timestamptz;
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
  -- V666: lọc trạng thái ở DB (trước: form lọc trên 40 dòng đã tải). "Đã gửi" đếm theo trạng thái thành công trên chỉ mục
  -- idx_auto_campaign_details_automation_status (index only, không đọc policy_snapshot: đo 26/11 trên 200 chiến dịch lệch 1 / 29.583 lượt so
  -- với cách đếm của so khớp; cách cũ đọc bảng: 40 chiến dịch × ~180 kết quả mất 6,8 giây đọc nguội, cách này ~1,7 giây), tới 100.001;
  -- tổng 4 giây cho cả danh sách, quá thì null.
  IF COALESCE(p_payload->>'kind','all') IN ('all','campaigns') THEN
   v_status:=CASE WHEN p_payload->>'status' IN ('chờ xử lý','đang chạy','hoàn thành','tạm dừng','lỗi') THEN p_payload->>'status' END;
   v_list_deadline:=clock_timestamp()+interval '4 seconds';
   v_campaign_list:='[]';
   FOR tg IN SELECT c.id, c.name, c.action_id, c.status, c.account_id, a.name account_name, c.is_delete, c.completed_at
     FROM public.auto_campaigns c LEFT JOIN public.auto_accounts a ON a.id=c.account_id
     WHERE c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.id IS DISTINCT FROM v_exclude
       AND c.action_id IN ('zalo_message_phone','zalo_message_friend','zalo_message_birthday','zalo_message_group_member','zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation')
       AND ((NOT c.is_delete AND (v_query IS NULL OR c.name ILIKE '%'||replace(replace(replace(v_query,'\','\\'),'%','\%'),'_','\_')||'%')
          AND (v_status IS NULL OR c.status=v_status))
         OR c.id=ANY(private.aka_agent_send_exclusion_ids(p_payload->'sentCampaignIds')))
     ORDER BY (c.id=ANY(private.aka_agent_send_exclusion_ids(p_payload->'sentCampaignIds'))) DESC, c.updated_at DESC NULLS LAST, c.id DESC LIMIT 40 LOOP
    v_cnt:=NULL;
    IF clock_timestamp()<v_list_deadline THEN
     SELECT count(*) INTO v_cnt FROM (SELECT 1 FROM public.auto_campaign_details d WHERE d.campaign_id=tg.id AND NOT d.is_delete
       AND d.status IN ('thành công','đã gửi','đã nhận','đã xem','đã click') AND d.action_code IN ('zalo_message_friend','zalo_message_stranger') LIMIT 100001) d;
    END IF;
    v_campaign_list:=v_campaign_list||jsonb_build_array(jsonb_build_object('id',tg.id,'name',tg.name,'actionId',tg.action_id,'status',tg.status,
      'accountId',tg.account_id,'accountName',tg.account_name,'deleted',tg.is_delete,'completedAt',tg.completed_at,'sentCount',v_cnt));
   END LOOP;
  END IF;
  RETURN jsonb_build_object(
   'dataGroups',CASE WHEN COALESCE(p_payload->>'kind','all') IN ('all','dataGroups') THEN COALESCE((SELECT jsonb_agg(x.item ORDER BY x.own DESC, x.name, x.id) FROM (
     SELECT g.id, g.name, (g.staff_id=p_staff_id) own, jsonb_build_object('id',g.id,
       -- V666: Nhóm data đã xoá của nhân viên khác: không trả tên / số thành viên (trước: truyền id bất kỳ là đọc được).
       'name',CASE WHEN g.is_delete AND g.staff_id<>p_staff_id THEN 'Nhóm data #'||g.id ELSE g.name END,'dataType',ci.code,'shared',g.staff_id<>p_staff_id,'deleted',g.is_delete,
       'count',CASE WHEN g.is_delete AND g.staff_id<>p_staff_id THEN 0 ELSE (SELECT count(*) FROM (SELECT 1 FROM public.auto_account_contact_group_members m WHERE m.group_id=g.id AND NOT m.is_delete LIMIT 100001) m) END) item
     FROM public.auto_account_contact_groups g JOIN public.category_item ci ON ci.id=g.data_type_category_item_id AND ci.code IN ('phone','zalo_person')
     WHERE g.organization_id=p_organization_id AND g.purpose='data_group'
       AND ((NOT g.is_delete AND (v_query IS NULL OR g.name ILIKE '%'||replace(replace(replace(v_query,'\','\\'),'%','\%'),'_','\_')||'%')
         AND (g.staff_id=p_staff_id OR g.sharing_scope='organization' OR (g.sharing_scope='selected' AND EXISTS(SELECT 1 FROM public.auto_data_group_recipients rc WHERE rc.group_id=g.id AND rc.staff_id=p_staff_id))))
        OR g.id=ANY(private.aka_agent_send_exclusion_ids(p_payload->'dataGroupIds')))
       AND (g.is_delete OR private.group_access('data',g.id,p_staff_id,p_organization_id) IS NOT NULL)
     ORDER BY (g.id=ANY(private.aka_agent_send_exclusion_ids(p_payload->'dataGroupIds'))) DESC, (g.staff_id=p_staff_id) DESC, g.updated_at DESC, g.id DESC LIMIT 60) x),'[]') END,
   'campaigns',v_campaign_list);
 END IF;

 IF p_operation='preview' THEN
  -- V657: xem trước ở bước lưu, chỉ đọc: {accountId, selection, campaignId? | targets?:[{phone,uid}], afterId?, limit?}. Dùng đúng hàm so khớp
  -- của bộ chạy (danh sách / Nhóm data / chiến dịch); điều kiện của từng Zalo không tính. pending = chưa xác định được (kiểm lúc chạy).
  v_account:=private.aka_agent_send_exclusion_int(p_payload->'accountId');
  IF v_account IS NULL THEN RAISE EXCEPTION 'send_exclusion_account_not_found'; END IF;
  v_sel:=p_payload->'selection';
  IF jsonb_typeof(v_sel) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'send_exclusion_selection_invalid'; END IF;
  PERFORM public.aka_agent_internal_validate_send_exclusion_selection(jsonb_build_object(v_account::text,v_sel),p_staff_id,p_organization_id,v_account);
  v_cid:=private.aka_agent_send_exclusion_int(p_payload->'campaignId');
  IF v_cid IS NOT NULL THEN
   SELECT * INTO v_c FROM public.auto_campaigns WHERE id=v_cid AND staff_id=p_staff_id AND organization_id=p_organization_id AND NOT is_delete;
   IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_campaign_not_found'; END IF;
  ELSIF COALESCE(p_payload->'campaignId','null')<>'null' THEN RAISE EXCEPTION 'send_exclusion_campaign_not_found';
  ELSE v_c.staff_id:=p_staff_id; v_c.organization_id:=p_organization_id;
  END IF;
  v_after:=COALESCE(private.aka_agent_send_exclusion_int(p_payload->'afterId'),0);
  v_limit:=least(greatest(COALESCE(private.aka_agent_send_exclusion_int(p_payload->'limit'),200),1),500);
  IF jsonb_typeof(COALESCE(p_payload->'targets','null'))='array' AND jsonb_array_length(p_payload->'targets')>500 THEN RAISE EXCEPTION 'send_exclusion_preview_too_many'; END IF;
  v_deadline:=clock_timestamp()+interval '6 seconds';
  -- V666: data tự nhập (targets) không dùng bảng đối chiếu SĐT ↔ Global ID: bảng gộp lượt tra số của mọi tổ chức, nhập SĐT tuỳ ý là dò
  -- được SĐT của người trong Nhóm data / danh sách Zalo ID của mình. Data của chiến dịch đã lưu vẫn dùng như lúc chạy.
  IF v_cid IS NULL THEN PERFORM set_config('aka_agent.send_exclusion_identity','off',true); END IF;
  FOR tg IN SELECT x.id, x.phone, x.uid FROM (
     SELECT e.ord AS id, CASE WHEN jsonb_typeof(e.v->'phone')='string' THEN left(e.v->>'phone',40) END phone, CASE WHEN jsonb_typeof(e.v->'uid')='string' THEN left(e.v->>'uid',64) END uid
      FROM jsonb_array_elements(CASE WHEN v_cid IS NULL AND jsonb_typeof(p_payload->'targets')='array' THEN p_payload->'targets' ELSE '[]' END) WITH ORDINALITY e(v,ord)
      WHERE e.ord>v_after
     UNION ALL
     SELECT i.id, i.phone, i.uid FROM public.auto_campaign_input_data i WHERE v_cid IS NOT NULL AND i.campaign_id=v_cid AND NOT COALESCE(i.is_delete,false)
      AND i.status='chờ xử lý' AND i.id>v_after) x ORDER BY x.id LIMIT v_limit+1 LOOP
   IF v_checked>=v_limit OR clock_timestamp()>v_deadline THEN v_more:=true; EXIT; END IF;
   v_m:=private.aka_agent_send_exclusion_match(v_c,v_account,v_sel,tg.phone,NULL,tg.uid,false);
   v_checked:=v_checked+1; v_last:=tg.id;
   IF jsonb_typeof(v_m->'match')='object' THEN
    v_excluded:=v_excluded+1; v_key:=(v_m->'match'->>'kind')||':'||(v_m->'match'->>'id');
    v_sources:=jsonb_set(v_sources,ARRAY[v_key],jsonb_build_object('kind',v_m->'match'->'kind','id',v_m->'match'->'id','name',v_m->'match'->'name',
      'count',COALESCE((v_sources->v_key->>'count')::integer,0)+1));
   ELSIF (v_m->>'needGlobalId')::boolean THEN v_pending:=v_pending+1;
   END IF;
  END LOOP;
  PERFORM set_config('aka_agent.send_exclusion_identity','',true);
  RETURN jsonb_build_object('checked',v_checked,'excluded',v_excluded,'pending',v_pending,
   'sources',COALESCE((SELECT jsonb_agg(s.v ORDER BY (s.v->>'count')::integer DESC, s.v->>'name') FROM jsonb_each(v_sources) s(k,v)),'[]'),
   'nextAfterId',CASE WHEN v_more THEN v_last END);
 END IF;

 IF p_operation<>'save' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;
 -- V666: lưu nhóm (nhiều Zalo) chỉ khi công tắc mở cho nhân viên; đọc vẫn cho để form kiểm cấu hình đã lưu.
 IF NOT private.aka_agent_send_exclusion_multi_on(p_staff_id) THEN RAISE EXCEPTION 'send_exclusion_multi_zalo_off'; END IF;
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

CREATE OR REPLACE FUNCTION private.aka_agent_zalo_phone_identity_ingest(p_budget_ms integer DEFAULT NULL::integer, p_chunk integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V666: chỉ upsert dòng mới hơn dòng đang có (không khoá lại dòng cũ), ghi số Global ID đổi vào _state.changes.
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
    SELECT public.aka_agent_internal_normalize_phone(COALESCE(d.data->'target'->>'phone','')) ph, NULLIF(btrim(COALESCE(d.data->'target'->>'globalId','')),'') gid, d.created_at, d.id,
      d.account_id
     FROM public.auto_campaign_details d
     WHERE d.id>v_from AND d.id<=v_to AND d.action_code='zalo_find_phone_user' AND d.status='thành công') x
   -- Bỏ Global ID của chính nick tra số (đo 25/11: 0 / 91.109 lượt; chặn phòng khi Zalo trả nhầm như khi đọc hồ sơ thành viên nhóm).
   WHERE x.ph<>'' AND x.gid IS NOT NULL AND NOT (x.gid=ANY(private.aka_agent_zalo_own_global_ids(x.account_id))) ORDER BY x.ph, x.id DESC),
  -- V666: chỉ dòng mới hơn dòng đang có. Trước: đoạn đọc lại (overlap) đưa ~5.000 dòng cũ vào INSERT … ON CONFLICT DO UPDATE WHERE, câu
  -- này khoá lại mọi dòng trùng khoá dù không cập nhật (mỗi dòng một bản ghi WAL, ~1,8 MB mỗi phút). changes đếm theo lượt này.
  fresh AS (
   SELECT s.ph, s.gid, s.created_at, s.id, e.global_id old_gid FROM src s LEFT JOIN private.auto_zalo_phone_identity e ON e.phone=s.ph
    WHERE e.phone IS NULL OR e.detail_id<s.id),
  up AS (
   INSERT INTO private.auto_zalo_phone_identity AS t (phone, global_id, seen_at, detail_id)
   SELECT ph, gid, created_at, id FROM fresh
   ON CONFLICT (phone) DO UPDATE SET global_id=EXCLUDED.global_id, seen_at=EXCLUDED.seen_at, detail_id=EXCLUDED.detail_id,
     changes=t.changes+CASE WHEN t.global_id<>EXCLUDED.global_id THEN 1 ELSE 0 END, updated_at=now()
    WHERE EXCLUDED.detail_id>t.detail_id
   RETURNING t.phone)
  SELECT count(*), count(*) FILTER (WHERE f.old_gid IS NOT NULL AND f.old_gid<>f.gid) INTO v_n, v_c FROM up JOIN fresh f ON f.ph=up.phone;
  v_rows:=v_rows+v_n; v_ch:=v_ch+v_c; v_from:=v_to;
 END LOOP;
 UPDATE private.auto_zalo_phone_identity_state SET last_detail_id=greatest(last_detail_id,v_from), rows_upserted=rows_upserted+v_rows, changes=changes+v_ch, updated_at=now() WHERE id;
 RETURN jsonb_build_object('lastDetailId',v_from,'maxDetailId',v_max,'rows',v_rows,'changes',v_ch);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_campaign_send_exclusion_runtime(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_claim_token uuid, p_operation text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
-- V666: khoá dòng chiến dịch FOR KEY SHARE (trước FOR UPDATE: mỗi data 2–3 lượt khoá, chặn ghi log / nút tạm dừng tới 15 giây). Thao tác chỉ đọc chiến dịch; tạm dừng data đã có điều kiện theo trạng thái.
DECLARE c public.auto_campaigns%ROWTYPE; input public.auto_campaign_input_data%ROWTYPE;
 contact_id bigint; fact jsonb; v_uid text; v_note text; days integer; last_sent timestamptz; current_time_value timestamptz:=clock_timestamp(); keys text[]; tag_ids jsonb; changed integer;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id); -- Bind Desktop token before privileged work.

 SELECT campaign.* INTO c FROM public.auto_campaigns campaign JOIN public.auto_accounts a ON a.id=campaign.account_id
  JOIN public.org_staff s ON s.id=campaign.staff_id AND s.organization_id=campaign.organization_id AND s.is_active
  WHERE campaign.id=p_campaign_id AND campaign.account_id=p_account_id AND campaign.staff_id=p_staff_id AND NOT campaign.is_delete
   AND a.staff_id=p_staff_id AND a.organization_id=campaign.organization_id AND NOT a.is_delete
   AND campaign.runtime_claim_token=p_claim_token AND p_claim_token IS NOT NULL
  FOR KEY SHARE OF campaign;
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
 IF p_operation='precheck' THEN
  -- V657: bước lọc đầu tiên của bộ chạy cũ (trước kiểm từ chối nhận tin / chống gửi lặp / tra số): khớp danh sách / Nhóm data / chiến dịch
  -- thì tạm dừng data kèm lý do (không gọi Zalo, không tính lượt, không nghỉ).
  v_note:=private.aka_agent_send_exclusion_precheck(c,p_account_id,input.phone,input.uid);
  IF v_note IS NULL THEN RETURN jsonb_build_object('excluded',false); END IF;
  UPDATE public.auto_campaign_input_data SET status='tạm dừng',note=left(v_note,2000)
   WHERE id=input.id AND campaign_id=c.id AND status=COALESCE(p_payload->>'expectedStatus','chờ xử lý') AND status IN ('chờ xử lý','đang chạy') AND NOT is_delete;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('excluded',true,'note',v_note,'changed',changed=1);
 END IF;
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
  keys:=private.aka_agent_send_exclusion_person_keys(c.account_id,COALESCE(v_uid,input.uid),input.phone,input.email,NULLIF(btrim(p_payload->>'globalId'),''));
  IF cardinality(keys)>0 THEN
   SELECT max(h.created_at) INTO last_sent FROM public.aka_agent_internal_send_delivery_history(c.account_id,ARRAY['zalo_message_friend','zalo_message_stranger'],((timezone('Asia/Ho_Chi_Minh',current_time_value)::date-days)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'),current_time_value) h WHERE h.target_keys && keys;
  END IF;
 END IF;
 RETURN jsonb_build_object('akabiz_contact',CASE WHEN tag_ids IS NULL THEN NULL ELSE jsonb_build_object('ids',tag_ids,'availableValues',(SELECT COALESCE(jsonb_agg(t.id::text),'[]') FROM public.auto_contact_tags t WHERE t.staff_id=c.staff_id AND t.organization_id=c.organization_id AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id))) END,
  'campaign_delivery',CASE WHEN days IS NULL OR cardinality(keys)=0 THEN NULL ELSE jsonb_build_object('daysSince',CASE WHEN last_sent IS NULL THEN 3651 ELSE timezone('Asia/Ho_Chi_Minh',current_time_value)::date-timezone('Asia/Ho_Chi_Minh',last_sent)::date END) END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_campaign_runtime_v2(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_runtime_target text, p_runtime_claim_token uuid)
 RETURNS TABLE(ok boolean, reason text, campaign_status text, account_status text, runtime_claim_token uuid, runtime_claim_vietnam_date date, runtime_claimed_at timestamp with time zone, db_now timestamp with time zone, vietnam_date_key date, effective_stop_time time without time zone, boundary_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V666: bộ chạy chưa báo chạy được loại trừ mới mà chiến dịch có cấu hình mới cho tài khoản: tạm dừng (aka_agent_send_exclusion_claim_check).
DECLARE
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_now timestamptz := clock_timestamp();
  v_vietnam_date date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_claimed_vietnam_date date;
  v_schedule timestamptz;
  v_schedule_type text;
  v_continue_next_day boolean;
  v_vietnam_day_start timestamptz;
  v_daily_stop_time time without time zone;
  v_effective_stop_time time without time zone;
  v_boundary_at timestamptz;
  v_campaign_status text;
  v_account_status text;
  v_stored_claim_token uuid;
  v_stored_claim_target text;
  v_stored_claim_vietnam_date date;
  v_stored_claimed_at timestamptz;
  v_stored_unit_token uuid;
  v_claimed_at timestamptz;
  v_legacy_claimed boolean := false;
  v_claim_reason text;
  v_post_claim_rejection text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN
    RAISE EXCEPTION 'campaign, account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'runtime target must be desktop or server';
  END IF;
  IF p_runtime_claim_token IS NULL THEN
    RAISE EXCEPTION 'runtime claim token is required';
  END IF;

  -- Fast DB-clock rejection avoids invoking the comparatively expensive
  -- legacy entitlement/claim path once the inclusive cutoff is already due.
  -- The same predicate is rechecked under the locks retained by that claim.
  SELECT
    campaign.daily_stop_time,
    campaign.status,
    account.status,
    campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_claim_vietnam_date,
    campaign.runtime_claimed_at,
    campaign.runtime_unit_token,
    campaign.schedule,
    lower(btrim(COALESCE(NULLIF(campaign.schedule_type, ''), 'daily'))),
    COALESCE(campaign.continue_next_day, false)
  INTO
    v_daily_stop_time,
    v_campaign_status,
    v_account_status,
    v_stored_claim_token,
    v_stored_claim_target,
    v_stored_claim_vietnam_date,
    v_stored_claimed_at,
    v_stored_unit_token,
    v_schedule,
    v_schedule_type,
    v_continue_next_day
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, 'not_found', NULL::text, NULL::text,
      NULL::uuid, NULL::date, NULL::timestamptz,
      v_now, v_vietnam_date, NULL::time, NULL::timestamptz;
    RETURN;
  END IF;

  v_effective_stop_time := LEAST(
    COALESCE(v_daily_stop_time, time '23:59:00'),
    time '23:59:00'
  );
  v_vietnam_day_start := (
    v_vietnam_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );

  -- The caller creates the UUID before the request. If the first transaction
  -- committed but its response was lost, the exact immutable tuple recovers
  -- ownership before any mutable campaign/account status is considered. A
  -- concurrent DB-first pause therefore remains visible in the result without
  -- letting another executor claim or release the shared account too early.
  -- This does not create a second claim; the unit RPC still decides whether
  -- new work may start.
  IF v_stored_claim_token = p_runtime_claim_token
    AND v_stored_claim_target = v_runtime_target
    AND v_stored_claim_vietnam_date IS NOT NULL
    AND v_stored_claim_vietnam_date <= v_vietnam_date
    AND v_stored_claimed_at IS NOT NULL
  THEN
    v_boundary_at := (
      v_stored_claim_vietnam_date + v_effective_stop_time
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    RETURN QUERY SELECT
      true,
      'already_claimed',
      v_campaign_status,
      v_account_status,
      p_runtime_claim_token,
      v_stored_claim_vietnam_date,
      v_stored_claimed_at,
      v_now,
      v_vietnam_date,
      v_effective_stop_time,
      v_boundary_at;
    RETURN;
  END IF;

  -- A durable unit lease remains authoritative independently of mutable status
  -- and parent metadata. Never let a different parent claim overlap it.
  IF v_stored_unit_token IS NOT NULL THEN
    RETURN QUERY SELECT
      false, 'unit_lease_busy', v_campaign_status, v_account_status,
      NULL::uuid, NULL::date, NULL::timestamptz,
      v_now, v_vietnam_date, v_effective_stop_time,
      (
        v_vietnam_date + v_effective_stop_time
      ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    RETURN;
  END IF;

  -- V666: bộ chạy bản cũ (không gửi header x-aka-send-exclusion-runner) mà chiến dịch có cấu hình loại trừ mới cho tài khoản:
  -- aka_agent_send_exclusion_claim_check chuyển chiến dịch tạm dừng kèm ghi chú; mọi bản app coi lý do lạ là không nhận được lượt.
  IF private.aka_agent_send_exclusion_claim_check(p_campaign_id, p_account_id, NULL) IS NOT NULL THEN
    RETURN QUERY SELECT
      false, 'send_exclusion_client_outdated', 'tạm dừng'::text, v_account_status,
      NULL::uuid, NULL::date, NULL::timestamptz,
      v_now, v_vietnam_date, v_effective_stop_time,
      (
        v_vietnam_date + v_effective_stop_time
      ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    RETURN;
  END IF;

  -- A stale daily schedule is intentional only when the user chose not to
  -- wait for the next day's configured time. Every recurring schedule that
  -- must advance still fails closed until maintenance writes its next due time.
  IF v_campaign_status = 'chờ xử lý'
    AND v_schedule IS NOT NULL
    AND v_schedule < v_vietnam_day_start
    AND NOT (
      v_schedule_type = 'daily'
      AND v_continue_next_day IS NOT TRUE
    )
  THEN
    RETURN QUERY SELECT
      false, 'daily_maintenance_required',
      v_campaign_status, v_account_status,
      NULL::uuid, NULL::date, NULL::timestamptz,
      v_now, v_vietnam_date, v_effective_stop_time,
      (
        v_vietnam_date + v_effective_stop_time
      ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    RETURN;
  END IF;

  v_boundary_at := (
    v_vietnam_date + v_effective_stop_time
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

  IF v_now >= v_boundary_at THEN
    RETURN QUERY SELECT
      false,
      CASE
        WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
        ELSE 'daily_stop_due'
      END,
      v_campaign_status,
      v_account_status,
      NULL::uuid,
      NULL::date,
      NULL::timestamptz,
      v_now,
      v_vietnam_date,
      v_effective_stop_time,
      v_boundary_at;
    RETURN;
  END IF;

  v_claimed_vietnam_date := v_vietnam_date;

  -- An exception block is deliberately used as a subtransaction. If the DB
  -- clock crosses the boundary while the legacy function is acquiring locks,
  -- raising P0231 rolls its campaign/account writes back before this function
  -- returns a normal rejection result.
  BEGIN
    SELECT claim.ok, claim.reason INTO v_legacy_claimed, v_claim_reason
    FROM public.aka_agent_claim_campaign_runtime_checked(
      p_campaign_id,
      p_account_id,
      p_staff_id,
      v_runtime_target
    ) AS claim;

    IF NOT v_legacy_claimed THEN
      -- A retry can overlap the first request: the optimistic read above may
      -- have seen pending while this legacy call later waited for the first
      -- transaction. Re-read under the locks retained by the legacy call and
      -- recover only the exact caller-supplied token.
      SELECT
        campaign.status,
        account.status,
        campaign.runtime_claim_token,
        campaign.runtime_claim_target,
        campaign.runtime_claim_vietnam_date,
        campaign.runtime_claimed_at,
        campaign.daily_stop_time,
        campaign.runtime_unit_token,
        campaign.schedule,
        lower(btrim(COALESCE(NULLIF(campaign.schedule_type, ''), 'daily'))),
        COALESCE(campaign.continue_next_day, false)
      INTO
        v_campaign_status,
        v_account_status,
        v_stored_claim_token,
        v_stored_claim_target,
        v_stored_claim_vietnam_date,
        v_stored_claimed_at,
        v_daily_stop_time,
        v_stored_unit_token,
        v_schedule,
        v_schedule_type,
        v_continue_next_day
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
       AND account.staff_id = campaign.staff_id
      WHERE campaign.id = p_campaign_id
        AND campaign.account_id = p_account_id
        AND campaign.staff_id = p_staff_id
      FOR UPDATE OF campaign, account;

      v_now := clock_timestamp();
      v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
      v_effective_stop_time := LEAST(
        COALESCE(v_daily_stop_time, time '23:59:00'),
        time '23:59:00'
      );
      v_vietnam_day_start := (
        v_vietnam_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
      );

      IF FOUND
        AND v_stored_claim_token = p_runtime_claim_token
        AND v_stored_claim_target = v_runtime_target
        AND v_stored_claim_vietnam_date IS NOT NULL
        AND v_stored_claim_vietnam_date <= v_vietnam_date
        AND v_stored_claimed_at IS NOT NULL
      THEN
        v_boundary_at := (
          v_stored_claim_vietnam_date + v_effective_stop_time
        ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
        RETURN QUERY SELECT
          true,
          'already_claimed',
          v_campaign_status,
          v_account_status,
          p_runtime_claim_token,
          v_stored_claim_vietnam_date,
          v_stored_claimed_at,
          v_now,
          v_vietnam_date,
          v_effective_stop_time,
          v_boundary_at;
        RETURN;
      END IF;

      IF FOUND AND v_stored_unit_token IS NOT NULL THEN
        RETURN QUERY SELECT
          false, 'unit_lease_busy', v_campaign_status, v_account_status,
          NULL::uuid, NULL::date, NULL::timestamptz,
          v_now, v_vietnam_date, v_effective_stop_time,
          (
            v_vietnam_date + v_effective_stop_time
          ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
        RETURN;
      END IF;

      IF FOUND
        AND v_campaign_status = 'chờ xử lý'
        AND v_schedule IS NOT NULL
        AND v_schedule < v_vietnam_day_start
        AND NOT (
          v_schedule_type = 'daily'
          AND v_continue_next_day IS NOT TRUE
        )
      THEN
        RETURN QUERY SELECT
          false, 'daily_maintenance_required',
          v_campaign_status, v_account_status,
          NULL::uuid, NULL::date, NULL::timestamptz,
          v_now, v_vietnam_date, v_effective_stop_time,
          (
            v_vietnam_date + v_effective_stop_time
          ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
        RETURN;
      END IF;

      RETURN QUERY SELECT
        false, COALESCE(v_claim_reason, 'claim_rejected'), v_campaign_status, v_account_status,
        NULL::uuid, NULL::date, NULL::timestamptz,
        v_now,
        v_vietnam_date,
        v_effective_stop_time,
        v_boundary_at;
      RETURN;
    END IF;

    -- claim_campaign_runtime retains both row locks until this outer RPC
    -- finishes, so this is the authoritative post-lock boundary check.
    SELECT
      campaign.daily_stop_time,
      campaign.status,
      account.status,
      campaign.runtime_unit_token,
      campaign.schedule,
      lower(btrim(COALESCE(NULLIF(campaign.schedule_type, ''), 'daily'))),
      COALESCE(campaign.continue_next_day, false)
    INTO
      v_daily_stop_time,
      v_campaign_status,
      v_account_status,
      v_stored_unit_token,
      v_schedule,
      v_schedule_type,
      v_continue_next_day
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    WHERE campaign.id = p_campaign_id
      AND campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
    FOR UPDATE OF campaign, account;

    v_now := clock_timestamp();
    v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
    v_effective_stop_time := LEAST(
      COALESCE(v_daily_stop_time, time '23:59:00'),
      time '23:59:00'
    );
    v_vietnam_day_start := (
      v_vietnam_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
    );
    v_boundary_at := (
      v_claimed_vietnam_date + v_effective_stop_time
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

    IF v_stored_unit_token IS NOT NULL THEN
      v_post_claim_rejection := 'unit_lease_busy';
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign runtime claim overlapped an active unit lease';
    ELSIF v_schedule IS NOT NULL
      AND v_schedule < v_vietnam_day_start
      AND NOT (
        v_schedule_type = 'daily'
        AND v_continue_next_day IS NOT TRUE
      )
    THEN
      v_post_claim_rejection := 'daily_maintenance_required';
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign runtime claim used a stale Vietnam-day schedule';
    ELSIF v_vietnam_date > v_claimed_vietnam_date THEN
      v_post_claim_rejection := 'vietnam_day_changed';
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign runtime claim crossed Vietnam midnight';
    ELSIF v_now >= v_boundary_at THEN
      v_post_claim_rejection := CASE
        WHEN v_daily_stop_time IS NULL THEN 'daily_drain_due'
        ELSE 'daily_stop_due'
      END;
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign runtime claim crossed its daily boundary';
    END IF;

    v_claimed_at := v_now;

    UPDATE public.auto_campaigns AS campaign
    SET
      runtime_claim_token = p_runtime_claim_token,
      runtime_claim_target = v_runtime_target,
      runtime_claim_vietnam_date = v_claimed_vietnam_date,
      runtime_claimed_at = v_claimed_at,
      updated_at = v_claimed_at
    WHERE campaign.id = p_campaign_id
      AND campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy';

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign runtime claim lost ownership before token assignment';
    END IF;

    -- Bind the existing account operation token in the same fresh-claim
    -- transaction. Exact-token retries and every eligibility guard stay intact.
    UPDATE public.auto_accounts AS account
    SET runtime_operation_claim_token = p_runtime_claim_token
    WHERE account.id = p_account_id
      AND account.staff_id = p_staff_id
      AND account.status = 'đang chạy';

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0231',
        MESSAGE = 'campaign account lost ownership before token assignment';
    END IF;

    RETURN QUERY SELECT
      true,
      'claimed',
      'đang chạy'::text,
      'đang chạy'::text,
      p_runtime_claim_token,
      v_claimed_vietnam_date,
      v_claimed_at,
      v_now,
      v_vietnam_date,
      v_effective_stop_time,
      v_boundary_at;
    RETURN;
  EXCEPTION
    WHEN SQLSTATE 'P0231' THEN
      -- All writes made by claim_campaign_runtime and token assignment inside
      -- the block have been rolled back. Local variables intentionally retain
      -- the rejection metadata for the structured result below.
      NULL;
  END;

  v_now := clock_timestamp();
  v_vietnam_date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  SELECT campaign.status, account.status
  INTO v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id;

  RETURN QUERY SELECT
    false,
    COALESCE(v_post_claim_rejection, 'claim_lost'),
    v_campaign_status,
    v_account_status,
    NULL::uuid,
    NULL::date,
    NULL::timestamptz,
    v_now,
    v_vietnam_date,
    v_effective_stop_time,
    v_boundary_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_claim_target_v1(p_ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- V666: bộ chạy chưa báo chạy được loại trừ mới mà chiến dịch có cấu hình mới cho tài khoản: tạm dừng (aka_agent_send_exclusion_claim_check).
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
  v_excl boolean := false;
  v_ex_note text;
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

  -- V666: lõi bản cũ (không gửi ctx.sendExclusionRunner) mà chiến dịch có cấu hình loại trừ mới cho tài khoản: tạm dừng, trả campaign_paused.
  IF c.status IN ('chờ xử lý', 'đang chạy')
     AND private.aka_agent_send_exclusion_claim_check(v_campaign_id, v_account_id, p_ctx->>'sendExclusionRunner') IS NOT NULL THEN
    c.status := 'tạm dừng';
  END IF;
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
  -- V657: loại trừ gửi theo danh sách / Nhóm data / chiến dịch là bước lọc đầu tiên (trước mọi lần gọi Zalo), cùng vòng với chống gửi lặp.
  BEGIN
    v_excl := NOT v_slot_mode AND private.aka_agent_send_exclusion_precheck_on(c, v_account_id);
  EXCEPTION WHEN OTHERS THEN
    v_excl := false;
  END;
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
    EXIT WHEN NOT v_found OR NOT (v_cooldown OR v_excl);
    IF v_excl THEN
      -- V657: data khớp danh sách / Nhóm data / chiến dịch thì tạm dừng kèm lý do và lấy data kế tiếp (không gọi Zalo, không tính lượt, không
      -- nghỉ); lõi in "⏸️ Bỏ qua …" từ cooldownPaused. Kiểm lỗi thì để bước sau khi tra số / đọc hồ sơ kiểm lại.
      v_ex_note := NULL;
      BEGIN
        v_ex_note := private.aka_agent_send_exclusion_precheck(c, v_account_id, t.phone, t.uid);
      EXCEPTION WHEN OTHERS THEN
        v_ex_note := NULL;
      END;
      IF v_ex_note IS NOT NULL THEN
        UPDATE public.auto_campaign_input_data SET status = 'tạm dừng', note = left(v_ex_note, 2000) WHERE id = t.id AND status = 'chờ xử lý';
        v_cd_paused := v_cd_paused || jsonb_build_object('inputDataId', t.id, 'name', t.name, 'phone', t.phone, 'uid', t.uid, 'email', t.email, 'note', v_ex_note);
        v_cd_skip := v_cd_skip || t.id;
        v_cd_scanned := v_cd_scanned + 1;
        IF v_cd_scanned >= 50 OR clock_timestamp() >= v_cd_deadline THEN
          RETURN jsonb_build_object('status', 'cooldown_scan', 'leaseToken', v_token, 'cooldownPaused', v_cd_paused);
        END IF;
        CONTINUE;
      END IF;
      EXIT WHEN NOT v_cooldown;
    END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.auto_validate_campaign_send_exclusion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V666: (1) client cũ (iOS / tab Web mở từ trước khi deploy) chỉ biết groupId + blocklistIds nên gửi lựa chọn thiếu khoá dataGroupIds /
-- sentCampaignIds: giữ giá trị đang lưu (client mới luôn ghi đủ hai khoá, mảng rỗng = bỏ chọn). (2) cấu hình mà bộ chạy cũ không chạy
-- đúng (aka_agent_send_exclusion_needs_v2: bản cũ bỏ qua hẳn Nhóm data / chiến dịch đã gửi, dừng chiến dịch với nhóm nhiều Zalo / danh
-- sách của Zalo khác) chỉ lưu được khi công tắc mở cho nhân viên và phần mềm chạy tài khoản đã đủ bản mới; chỉ xét lựa chọn vừa đổi
-- (so theo aka_agent_send_exclusion_entry_norm: khoá thiếu = mảng rỗng).
DECLARE entry record; v_new jsonb; v_old jsonb; v_key text; v_aid bigint; v_server boolean;
BEGIN
 v_new:=NEW.extra_settings->'zaloSendExclusionsByAccountId';
 IF TG_OP='UPDATE' THEN
  v_old:=OLD.extra_settings->'zaloSendExclusionsByAccountId';
  IF jsonb_typeof(v_new)='object' AND jsonb_typeof(v_old)='object' THEN
   FOR entry IN SELECT * FROM jsonb_each(NEW.extra_settings->'zaloSendExclusionsByAccountId') LOOP
    IF jsonb_typeof(entry.value)='object' AND jsonb_typeof(v_old->entry.key)='object' THEN
     FOREACH v_key IN ARRAY ARRAY['dataGroupIds','sentCampaignIds'] LOOP
      IF NOT entry.value ? v_key AND (v_old->entry.key) ? v_key THEN
       v_new:=jsonb_set(v_new,ARRAY[entry.key,v_key],v_old->entry.key->v_key);
      END IF;
     END LOOP;
    END IF;
   END LOOP;
   IF v_new IS DISTINCT FROM NEW.extra_settings->'zaloSendExclusionsByAccountId' THEN
    NEW.extra_settings:=jsonb_set(NEW.extra_settings,'{zaloSendExclusionsByAccountId}',v_new);
   END IF;
  END IF;
  IF private.aka_agent_send_exclusion_map_norm(v_new) IS NOT DISTINCT FROM private.aka_agent_send_exclusion_map_norm(v_old)
  AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
 END IF;
 PERFORM public.aka_agent_internal_validate_send_exclusion_selection(v_new,NEW.staff_id,NEW.organization_id,NEW.account_id);
 -- V654: chiến dịch không loại trừ theo chính nó.
 IF NEW.id IS NOT NULL AND jsonb_typeof(v_new)='object' THEN
  FOR entry IN SELECT * FROM jsonb_each(v_new) LOOP
   IF NEW.id=ANY(private.aka_agent_send_exclusion_ids(entry.value->'sentCampaignIds')) THEN RAISE EXCEPTION 'send_exclusion_campaign_self'; END IF;
  END LOOP;
 END IF;
 IF jsonb_typeof(v_new)='object' THEN
  FOR entry IN SELECT * FROM jsonb_each(v_new) LOOP
   CONTINUE WHEN jsonb_typeof(entry.value) IS DISTINCT FROM 'object' OR entry.key !~ '^[0-9]{1,18}$';
   CONTINUE WHEN TG_OP='UPDATE' AND private.aka_agent_send_exclusion_entry_norm(entry.value) IS NOT DISTINCT FROM private.aka_agent_send_exclusion_entry_norm(v_old->entry.key)
     AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id;
   v_aid:=entry.key::bigint;
   CONTINUE WHEN NOT private.aka_agent_send_exclusion_needs_v2(entry.value,v_aid);
   IF NOT private.aka_agent_send_exclusion_multi_on(NEW.staff_id) THEN RAISE EXCEPTION 'send_exclusion_multi_zalo_off'; END IF;
   SELECT COALESCE(a.is_zalo_server,false) AND NOT COALESCE(a.is_zalo_show_web,false) INTO v_server FROM public.auto_accounts a WHERE a.id=v_aid;
   IF NOT private.aka_agent_send_exclusion_runtime_ready(NEW.staff_id,COALESCE(v_server,false)) THEN
    RAISE EXCEPTION '%', CASE WHEN v_server THEN 'send_exclusion_server_not_ready' ELSE 'send_exclusion_runtime_outdated' END;
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END;
$function$;

DO $acl$
DECLARE v_role text; v_fn text;
BEGIN
 FOREACH v_fn IN ARRAY ARRAY['private.aka_agent_send_exclusion_multi_on(bigint)', 'private.aka_agent_send_exclusion_runtime_ready(bigint,boolean)', 'private.aka_agent_send_exclusion_entry_norm(jsonb)', 'private.aka_agent_send_exclusion_map_norm(jsonb)', 'private.aka_agent_send_exclusion_claim_check(bigint,bigint,text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','aka_agent_desktop','aka_agent_chat_api','service_role'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_role); END IF;
  END LOOP;
 END LOOP;
 FOREACH v_role IN ARRAY ARRAY['aka_agent_desktop', 'aka_agent_chat_api', 'service_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION private.aka_agent_send_exclusion_claim_check(bigint,bigint,text) TO %I', v_role);
  END IF;
 END LOOP;
END $acl$;

INSERT INTO public.auto_system_settings(key, value, description, is_active)
VALUES ('send_exclusion.runtime', '{"server":false,"desktopMinVersion":null}', 'V666: phần mềm chạy tài khoản đã chạy được cấu hình loại trừ gửi mới chưa (Nhóm data, chiến dịch đã gửi, nhóm nhiều Zalo, danh sách của Zalo khác; bản cũ bỏ qua hoặc dừng chiến dịch). server=true sau khi cài App Server mới VÀ deploy ChatApi worker có bản sửa; desktopMinVersion = bản Desktop đầu tiên chạy được (máy đang gắn với tài khoản và máy khác đang mở app phải từ bản này). Chưa đủ thì lưu chiến dịch có cấu hình mới bị từ chối (send_exclusion_runtime_outdated / send_exclusion_server_not_ready).', true);

DO $post$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean)'),
   ('public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)'),
   ('private.aka_agent_zalo_phone_identity_ingest(integer,integer)'),
   ('public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)'),
   ('public.aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)'),
   ('public.aka_agent_engine_claim_target_v1(jsonb)'),
   ('public.auto_validate_campaign_send_exclusion()')) v(sig) LOOP
  IF position('V666' IN pg_get_functiondef(to_regprocedure(r.sig)))=0 THEN RAISE EXCEPTION 'V666 postflight: % chưa thay', r.sig; END IF;
 END LOOP;
 IF has_function_privilege('aka_agent_desktop','private.aka_agent_send_exclusion_runtime_ready(bigint,boolean)','EXECUTE') THEN
  RAISE EXCEPTION 'V666 postflight: aka_agent_desktop chạy được hàm private mới';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aka_agent_desktop')
    AND NOT has_function_privilege('aka_agent_desktop','private.aka_agent_send_exclusion_claim_check(bigint,bigint,text)','EXECUTE') THEN
  RAISE EXCEPTION 'V666 postflight: aka_agent_desktop chưa chạy được hàm kiểm lúc nhận lượt (nhận lượt bộ cũ sẽ lỗi)';
 END IF;
 IF has_function_privilege('anon','private.aka_agent_send_exclusion_claim_check(bigint,bigint,text)','EXECUTE') THEN
  RAISE EXCEPTION 'V666 postflight: anon chạy được hàm kiểm lúc nhận lượt';
 END IF;
END $post$;
COMMIT;

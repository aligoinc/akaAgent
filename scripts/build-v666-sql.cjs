#!/usr/bin/env node
// Sinh migration V666 (sửa lỗi review loại trừ gửi V654–V657) + bản gỡ, từ thân hàm production đọc 26/11/2026
// (scripts/fixtures/send-exclusion-v666/live-20261126.json, md5(pg_get_functiondef) kiểm trước khi thay). Chạy: node scripts/build-v666-sql.cjs
// Sửa:
//   1. Trigger lưu chiến dịch (auto_validate_campaign_send_exclusion):
//      - client cũ (iOS / tab Web trước khi deploy) gửi lựa chọn thiếu dataGroupIds / sentCampaignIds: giữ giá trị đang lưu;
//      - cấu hình mà bộ chạy cũ không chạy đúng chỉ lưu được khi công tắc mở cho nhân viên và máy chạy tài khoản đủ bản mới
//        (thiết lập mới send_exclusion.runtime, như proxies.shared_runtime của V511).
//   2. Hàm so khớp: chiến dịch đã gửi tra một lượt cho mọi chiến dịch; xem trước
//      data tự nhập không dùng bảng đối chiếu SĐT ↔ Global ID (gộp lượt tra số của mọi tổ chức).
//   3. aka_agent_send_exclusion_v2: preview như trên; lists không lộ tên / số Nhóm data đã xoá của nhân viên khác, lọc trạng thái ở DB,
//      đếm "đã gửi" trên chỉ mục (tới 100.001, 4 giây cho cả danh sách, quá thì null); save kiểm công tắc.
//   4. Job nạp bảng đối chiếu: bỏ dòng đã có trước khi upsert (trước: mỗi lượt khoá lại ~5.000 dòng cũ, ~2,6 GB WAL/ngày), đếm changes đúng.
//   5. aka_agent_campaign_send_exclusion_runtime: khoá dòng chiến dịch FOR KEY SHARE thay FOR UPDATE (không chặn ghi log / tạm dừng).
//   6. Hai hàm nhận lượt (bộ cũ aka_agent_claim_campaign_runtime_v2, engine aka_agent_engine_claim_target_v1): bộ chạy không báo đã chạy được
//      cấu hình mới (header x-aka-send-exclusion-runner / ctx.sendExclusionRunner) mà chiến dịch có cấu hình mới cho tài khoản thì chiến dịch
//      chuyển tạm dừng kèm ghi chú (anh chốt 26/11: chặn lúc nhận lượt; bản cũ sau khi "Đổi máy tính" sang máy cài bản cũ).
//   Review lần 2 (26/11): công tắc thiếu dòng / sai = tắt (trước trả NULL nên coi như bật); khoá mới đọc
//   campaign.send_exclusion_multi_zalo_v2 (bản 10.7.0 / Web v144 đọc khoá cũ, giữ tắt mãi); so lựa chọn coi khoá thiếu = mảng rỗng;
//   Nhóm data bị gỡ chia sẻ vẫn loại trừ như V657 (lượt sau snapshot dừng chiến dịch), không bỏ giữa lượt.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ROOT = path.resolve(__dirname, '..')
const md5 = s => crypto.createHash('md5').update(s).digest('hex')
const LIVE = Object.fromEntries(require('./fixtures/send-exclusion-v666/live-20261126.json').map(r => [r.fn, r.def]))

function patch(block, pairs) {
  let out = block
  for (const [from, to] of pairs) {
    const n = out.split(from).length - 1
    if (n !== 1) throw new Error(`đoạn cần thay xuất hiện ${n} lần: ${from.slice(0, 120)}`)
    out = out.replace(from, () => to)
  }
  return out
}
function between(text, start, end) {
  const i = text.indexOf(start)
  const j = text.indexOf(end, i)
  if (i < 0 || j < 0 || text.indexOf(start, i + 1) >= 0) throw new Error('không thấy đoạn ' + start.slice(0, 80))
  return text.slice(i, j + end.length)
}
const marker = (def, line) => patch(def, [['AS $function$\n', 'AS $function$\n' + line + '\n']])

const SIG = {
  trigger: 'public.auto_validate_campaign_send_exclusion()',
  match: 'private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean)',
  v2: 'public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)',
  ingest: 'private.aka_agent_zalo_phone_identity_ingest(integer,integer)',
  runtime: 'public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)',
  claim: 'public.aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)',
  engineClaim: 'public.aka_agent_engine_claim_target_v1(jsonb)',
}
const FN = {
  trigger: 'public.auto_validate_campaign_send_exclusion',
  match: 'private.aka_agent_send_exclusion_match',
  v2: 'public.aka_agent_send_exclusion_v2',
  ingest: 'private.aka_agent_zalo_phone_identity_ingest',
  runtime: 'public.aka_agent_campaign_send_exclusion_runtime',
  claim: 'public.aka_agent_claim_campaign_runtime_v2',
  engineClaim: 'public.aka_agent_engine_claim_target_v1',
}
const OLD = Object.fromEntries(Object.entries(FN).map(([k, fn]) => {
  if (!LIVE[fn]) throw new Error('thiếu thân production ' + fn)
  return [k, LIVE[fn]]
}))
const OLD_MD5 = Object.fromEntries(Object.entries(OLD).map(([k, def]) => [k, md5(def)]))
// md5 đọc trên production 26/11/2026 (khớp file fixture; đổi fixture thì phải đọc lại production).
const EXPECTED_OLD_MD5 = {
  trigger: '8e4fd7dc98cfcb610af35dd37440a360', match: '1fce92fdbf84c29d3eaf18296141f6f6', v2: '54721efc19e365fc2a4181e62a7f596a',
  ingest: '327a2977660ba8198bcb90b67c2a68c4', runtime: 'b8fb3c31c939426a8e2ac2f9d60da7c7',
  claim: '0fdbb44da58b3ef82bdd85224922c428', engineClaim: '8f574b0a75065ce562bc56f043f24967',
}
for (const k of Object.keys(EXPECTED_OLD_MD5)) if (OLD_MD5[k] !== EXPECTED_OLD_MD5[k]) throw new Error(`fixture ${k} khác md5 production: ${OLD_MD5[k]}`)

const SUCCESS = "d.action_code IN ('zalo_message_friend','zalo_message_stranger') AND NOT d.is_delete\n" +
  "       AND (d.policy_snapshot->>'operationState'='committed' OR (d.policy_snapshot->>'operationState' IS NULL AND d.status IN ('thành công','đã gửi','đã nhận','đã xem','đã click')))"

// ============================================================================================ hàm mới
const NEW_FUNCTIONS = String.raw`
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
`
const NEW_PRIVATE = ['private.aka_agent_send_exclusion_multi_on(bigint)', 'private.aka_agent_send_exclusion_runtime_ready(bigint,boolean)',
  'private.aka_agent_send_exclusion_entry_norm(jsonb)', 'private.aka_agent_send_exclusion_map_norm(jsonb)',
  'private.aka_agent_send_exclusion_claim_check(bigint,bigint,text)']
// Hàm nhận lượt bộ cũ không SECURITY DEFINER (chạy dưới vai trò người gọi): ba vai trò gọi nó được chạy hàm kiểm lúc nhận lượt.
const CLAIM_CHECK_ROLES = ['aka_agent_desktop', 'aka_agent_chat_api', 'service_role']

// ============================================================================================ 1. trigger lưu chiến dịch
const NEW_TRIGGER = String.raw`CREATE OR REPLACE FUNCTION public.auto_validate_campaign_send_exclusion()
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
$function$`

// ============================================================================================ 2. so khớp
const OLD_SENT = between(OLD.match, ' IF v_match IS NULL THEN\n  FOR sc IN SELECT c.id, c.name FROM public.auto_campaigns c', '   END IF;\n  END LOOP;\n END IF;\n')
const NEW_SENT = ` IF v_match IS NULL THEN
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
       AND ${SUCCESS} OFFSET 0) dd
     UNION ALL
     SELECT i.campaign_id, dd.created_at FROM unnest(COALESCE(v_cand_uids,'{}'::text[])) u(uid)
      CROSS JOIN LATERAL (SELECT i.id, i.campaign_id, btrim(i.uid) iuid FROM public.auto_campaign_input_data i WHERE md5(lower(btrim(i.uid)))=md5(u.uid)
        AND i.uid IS NOT NULL AND btrim(i.uid)<>'' AND i.campaign_id+0=ANY(v_sent) OFFSET 0) i
      CROSS JOIN LATERAL (SELECT d.created_at FROM public.auto_campaign_details d WHERE d.input_data_id=i.id AND d.campaign_id+0=i.campaign_id
       AND ${SUCCESS}
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
`
const NEW_MATCH = marker(patch(OLD.match, [
  ['v_gid_uids text[]; v_uid text; v_nick bigint[]; v_cand_uids text[]; v_gid_accounts bigint[];',
    "v_gid_uids text[]; v_uid text; v_nick bigint[]; v_cand_uids text[]; v_gid_accounts bigint[];\n v_sent bigint[]; v_hit bigint; v_identity boolean:=COALESCE(current_setting('aka_agent.send_exclusion_identity',true),'')<>'off';"],
  [' IF v_gid IS NULL AND v_phone IS NOT NULL THEN\n  SELECT i.global_id INTO v_gid FROM private.auto_zalo_phone_identity i WHERE i.phone=v_phone;',
    ' IF v_gid IS NULL AND v_phone IS NOT NULL AND v_identity THEN\n  SELECT i.global_id INTO v_gid FROM private.auto_zalo_phone_identity i WHERE i.phone=v_phone;'],
  [" ELSIF v_gid IS NOT NULL THEN\n  SELECT COALESCE(array_agg(i.phone ORDER BY i.phone),'{}') INTO v_phones",
    " ELSIF v_gid IS NOT NULL AND v_identity THEN\n  SELECT COALESCE(array_agg(i.phone ORDER BY i.phone),'{}') INTO v_phones"],
  [OLD_SENT, NEW_SENT],
]), '-- V666: chiến dịch đã gửi tra một lượt; aka_agent.send_exclusion_identity=off (xem trước data tự nhập) thì không dùng bảng đối chiếu SĐT ↔ Global ID.\n' +
  '-- Nhóm data bị gỡ chia sẻ giữa lượt vẫn loại trừ (fail closed); lượt sau snapshot báo send_exclusion_data_group_not_found, chiến dịch tạm dừng.')

// ============================================================================================ 3. aka_agent_send_exclusion_v2
const OLD_LIST_CAMPAIGNS = between(OLD.v2, "   'campaigns',CASE WHEN COALESCE(p_payload->>'kind','all') IN ('all','campaigns') THEN", "LIMIT 40) x),'[]') END);")
const NEW_V2 = marker(patch(OLD.v2, [
  [' v_excluded integer:=0; v_pending integer:=0; v_sources jsonb:=\'{}\'; v_last bigint; v_more boolean:=false; v_key text; tg record;',
    ' v_excluded integer:=0; v_pending integer:=0; v_sources jsonb:=\'{}\'; v_last bigint; v_more boolean:=false; v_key text; tg record;\n v_status text; v_campaign_list jsonb; v_cnt bigint; v_list_deadline timestamptz;'],
  ["  v_exclude:=private.aka_agent_send_exclusion_int(p_payload->'excludeCampaignId');\n  RETURN jsonb_build_object(",
    `  v_exclude:=private.aka_agent_send_exclusion_int(p_payload->'excludeCampaignId');
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
       AND ((NOT c.is_delete AND (v_query IS NULL OR c.name ILIKE '%'||replace(replace(replace(v_query,'\\','\\\\'),'%','\\%'),'_','\\_')||'%')
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
  RETURN jsonb_build_object(`],
  ["jsonb_build_object('id',g.id,'name',g.name,'dataType',ci.code,'shared',g.staff_id<>p_staff_id,'deleted',g.is_delete,\n       'count',(SELECT count(*) FROM (SELECT 1 FROM public.auto_account_contact_group_members m WHERE m.group_id=g.id AND NOT m.is_delete LIMIT 100001) m)) item",
    "jsonb_build_object('id',g.id,\n" +
    "       -- V666: Nhóm data đã xoá của nhân viên khác: không trả tên / số thành viên (trước: truyền id bất kỳ là đọc được).\n" +
    "       'name',CASE WHEN g.is_delete AND g.staff_id<>p_staff_id THEN 'Nhóm data #'||g.id ELSE g.name END,'dataType',ci.code,'shared',g.staff_id<>p_staff_id,'deleted',g.is_delete,\n" +
    "       'count',CASE WHEN g.is_delete AND g.staff_id<>p_staff_id THEN 0 ELSE (SELECT count(*) FROM (SELECT 1 FROM public.auto_account_contact_group_members m WHERE m.group_id=g.id AND NOT m.is_delete LIMIT 100001) m) END) item"],
  [OLD_LIST_CAMPAIGNS, "   'campaigns',v_campaign_list);"],
  ["  v_deadline:=clock_timestamp()+interval '6 seconds';\n  FOR tg IN SELECT x.id, x.phone, x.uid FROM (",
    "  v_deadline:=clock_timestamp()+interval '6 seconds';\n" +
    "  -- V666: data tự nhập (targets) không dùng bảng đối chiếu SĐT ↔ Global ID: bảng gộp lượt tra số của mọi tổ chức, nhập SĐT tuỳ ý là dò\n" +
    "  -- được SĐT của người trong Nhóm data / danh sách Zalo ID của mình. Data của chiến dịch đã lưu vẫn dùng như lúc chạy.\n" +
    "  IF v_cid IS NULL THEN PERFORM set_config('aka_agent.send_exclusion_identity','off',true); END IF;\n" +
    "  FOR tg IN SELECT x.id, x.phone, x.uid FROM ("],
  ["  END LOOP;\n  RETURN jsonb_build_object('checked',v_checked,",
    "  END LOOP;\n  PERFORM set_config('aka_agent.send_exclusion_identity','',true);\n  RETURN jsonb_build_object('checked',v_checked,"],
  ["IF p_operation<>'save' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;",
    "IF p_operation<>'save' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;\n" +
    " -- V666: lưu nhóm (nhiều Zalo) chỉ khi công tắc mở cho nhân viên; đọc vẫn cho để form kiểm cấu hình đã lưu.\n" +
    " IF NOT private.aka_agent_send_exclusion_multi_on(p_staff_id) THEN RAISE EXCEPTION 'send_exclusion_multi_zalo_off'; END IF;"],
]), '-- V666: preview không dùng bảng đối chiếu cho data tự nhập; lists che Nhóm data đã xoá của người khác, lọc trạng thái, đếm "đã gửi" có hạn; save kiểm công tắc.')

// ============================================================================================ 4. job nạp bảng đối chiếu
const OLD_UPSERT = between(OLD.ingest, '  up AS (\n', '  v_rows:=v_rows+v_n; v_ch:=v_ch+v_c; v_from:=v_to;')
const NEW_UPSERT = `  -- V666: chỉ dòng mới hơn dòng đang có. Trước: đoạn đọc lại (overlap) đưa ~5.000 dòng cũ vào INSERT … ON CONFLICT DO UPDATE WHERE, câu
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
  v_rows:=v_rows+v_n; v_ch:=v_ch+v_c; v_from:=v_to;`
const NEW_INGEST = marker(patch(OLD.ingest, [
  ['ORDER BY x.ph, x.id DESC),\n' + OLD_UPSERT, 'ORDER BY x.ph, x.id DESC),\n' + NEW_UPSERT],
  ['UPDATE private.auto_zalo_phone_identity_state SET last_detail_id=greatest(last_detail_id,v_from), rows_upserted=rows_upserted+v_rows, updated_at=now() WHERE id;',
    'UPDATE private.auto_zalo_phone_identity_state SET last_detail_id=greatest(last_detail_id,v_from), rows_upserted=rows_upserted+v_rows, changes=changes+v_ch, updated_at=now() WHERE id;'],
  ["RETURN jsonb_build_object('lastDetailId',v_from,'maxDetailId',v_max,'rows',v_rows);",
    "RETURN jsonb_build_object('lastDetailId',v_from,'maxDetailId',v_max,'rows',v_rows,'changes',v_ch);"],
]), '-- V666: chỉ upsert dòng mới hơn dòng đang có (không khoá lại dòng cũ), ghi số Global ID đổi vào _state.changes.')

// ============================================================================================ 5. khoá dòng chiến dịch
const NEW_RUNTIME = marker(patch(OLD.runtime, [
  ['  FOR UPDATE OF campaign;\n IF NOT FOUND THEN RAISE EXCEPTION \'send_exclusion_runtime_claim_lost\'; END IF;',
    "  FOR KEY SHARE OF campaign;\n IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_runtime_claim_lost'; END IF;"],
]), '-- V666: khoá dòng chiến dịch FOR KEY SHARE (trước FOR UPDATE: mỗi data 2–3 lượt khoá, chặn ghi log / nút tạm dừng tới 15 giây). Thao tác chỉ đọc chiến dịch; tạm dừng data đã có điều kiện theo trạng thái.')

// ============================================================================================ 6. kiểm lúc nhận lượt
const CLAIM_MARK = '-- V666: bộ chạy chưa báo chạy được loại trừ mới mà chiến dịch có cấu hình mới cho tài khoản: tạm dừng (aka_agent_send_exclusion_claim_check).'
const NEW_CLAIM = marker(patch(OLD.claim, [
  ['  -- A stale daily schedule is intentional only when the user chose not to\n',
    `  -- V666: bộ chạy bản cũ (không gửi header x-aka-send-exclusion-runner) mà chiến dịch có cấu hình loại trừ mới cho tài khoản:
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

  -- A stale daily schedule is intentional only when the user chose not to\n`],
]), CLAIM_MARK)
const NEW_ENGINE_CLAIM = marker(patch(OLD.engineClaim, [
  ["  IF c.status = 'tạm dừng' THEN RETURN jsonb_build_object('status', 'campaign_paused', 'leaseToken', v_token); END IF;",
    `  -- V666: lõi bản cũ (không gửi ctx.sendExclusionRunner) mà chiến dịch có cấu hình loại trừ mới cho tài khoản: tạm dừng, trả campaign_paused.
  IF c.status IN ('chờ xử lý', 'đang chạy')
     AND private.aka_agent_send_exclusion_claim_check(v_campaign_id, v_account_id, p_ctx->>'sendExclusionRunner') IS NOT NULL THEN
    c.status := 'tạm dừng';
  END IF;
  IF c.status = 'tạm dừng' THEN RETURN jsonb_build_object('status', 'campaign_paused', 'leaseToken', v_token); END IF;`],
]), CLAIM_MARK)

const NEW = { trigger: NEW_TRIGGER, match: NEW_MATCH, v2: NEW_V2, ingest: NEW_INGEST, runtime: NEW_RUNTIME, claim: NEW_CLAIM, engineClaim: NEW_ENGINE_CLAIM }
const ORDER = ['match', 'v2', 'ingest', 'runtime', 'claim', 'engineClaim', 'trigger']
for (const k of ORDER) if (!NEW[k].includes('V666')) throw new Error('thân mới thiếu dấu V666: ' + k)
const semi = s => s.trimEnd().endsWith(';') ? s.trimEnd() : s.trimEnd() + ';'
// md5(pg_get_functiondef) của thân mới, đo trên PostgreSQL cục bộ sau khi chạy migration (scripts/send-exclusion-v666-smoke.cjs ghi file này).
const NEW_MD5_FILE = path.join(ROOT, 'scripts/fixtures/send-exclusion-v666/new-md5.json')
const NEW_MD5 = fs.existsSync(NEW_MD5_FILE) ? JSON.parse(fs.readFileSync(NEW_MD5_FILE, 'utf8')) : null
const guardOld = ORDER.map(k => `('${SIG[k]}','${OLD_MD5[k]}')`).join(',\n   ')

const SETTING_DESCRIPTION = 'V666: phần mềm chạy tài khoản đã chạy được cấu hình loại trừ gửi mới chưa (Nhóm data, chiến dịch đã gửi, nhóm nhiều Zalo, danh sách của Zalo khác; bản cũ bỏ qua hoặc dừng chiến dịch). server=true sau khi cài App Server mới VÀ deploy ChatApi worker có bản sửa; desktopMinVersion = bản Desktop đầu tiên chạy được (máy đang gắn với tài khoản và máy khác đang mở app phải từ bản này). Chưa đủ thì lưu chiến dịch có cấu hình mới bị từ chối (send_exclusion_runtime_outdated / send_exclusion_server_not_ready).'

const UP = `-- V666: sửa lỗi review loại trừ gửi V654–V657 (docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md mục 13).
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
   ${guardOld}) v(sig, md5) LOOP
  SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO v_md5;
  IF v_md5 IS DISTINCT FROM r.md5 THEN RAISE EXCEPTION 'V666: % khác bản production 26/11 (md5 %)', r.sig, v_md5; END IF;
 END LOOP;
END $pre$;
${NEW_FUNCTIONS}
${ORDER.map(k => semi(NEW[k])).join('\n\n')}

DO $acl$
DECLARE v_role text; v_fn text;
BEGIN
 FOREACH v_fn IN ARRAY ARRAY[${NEW_PRIVATE.map(s => `'${s}'`).join(', ')}] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','aka_agent_desktop','aka_agent_chat_api','service_role'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_role); END IF;
  END LOOP;
 END LOOP;
 FOREACH v_role IN ARRAY ARRAY[${CLAIM_CHECK_ROLES.map(r => `'${r}'`).join(', ')}] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION private.aka_agent_send_exclusion_claim_check(bigint,bigint,text) TO %I', v_role);
  END IF;
 END LOOP;
END $acl$;

INSERT INTO public.auto_system_settings(key, value, description, is_active)
VALUES ('send_exclusion.runtime', '{"server":false,"desktopMinVersion":null}', '${SETTING_DESCRIPTION.replace(/'/g, "''")}', true);

DO $post$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   ${ORDER.map(k => `('${SIG[k]}')`).join(',\n   ')}) v(sig) LOOP
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
`

const guardNew = NEW_MD5 ? ORDER.map(k => `('${SIG[k]}','${NEW_MD5[k]}')`).join(',\n   ') : null
const DOWN = `-- Gỡ V666: trả 7 hàm về đúng thân production 26/11 (kiểm md5 trước và sau), xoá 5 hàm private mới và thiết lập send_exclusion.runtime.
-- Sau khi gỡ: lựa chọn thiếu khoá từ client cũ lại làm mất Nhóm data / chiến dịch đã gửi; bộ chạy cũ lại có thể bỏ qua cấu hình mới.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
DECLARE r record; v_md5 text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v666_send_exclusion_review_fixes') THEN RAISE EXCEPTION 'Gỡ V666: V666 chưa có trong sổ'; END IF;
 -- Thân hàm phải đúng bản V666 (migration sau có vá các hàm này thì gỡ migration đó trước).
 FOR r IN SELECT * FROM (VALUES
   ${guardNew ?? "('chưa đo md5 bản V666: chạy scripts/send-exclusion-v666-smoke.cjs rồi sinh lại','')"}) v(sig, md5) LOOP
  SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO v_md5;
  IF v_md5 IS DISTINCT FROM r.md5 THEN RAISE EXCEPTION 'Gỡ V666: % không phải bản V666 (md5 %)', r.sig, v_md5; END IF;
 END LOOP;
END $pre$;
${ORDER.map(k => semi(OLD[k])).join('\n\n')}

DROP FUNCTION private.aka_agent_send_exclusion_claim_check(bigint,bigint,text);
DROP FUNCTION private.aka_agent_send_exclusion_map_norm(jsonb);
DROP FUNCTION private.aka_agent_send_exclusion_entry_norm(jsonb);
DROP FUNCTION private.aka_agent_send_exclusion_runtime_ready(bigint,boolean);
DROP FUNCTION private.aka_agent_send_exclusion_multi_on(bigint);
DELETE FROM public.auto_system_settings WHERE key='send_exclusion.runtime';
DO $post$
DECLARE r record; v_md5 text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   ${guardOld}) v(sig, md5) LOOP
  SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO v_md5;
  IF v_md5 IS DISTINCT FROM r.md5 THEN RAISE EXCEPTION 'Gỡ V666: % không về bản production (md5 %)', r.sig, v_md5; END IF;
 END LOOP;
END $post$;
DELETE FROM supabase_migrations.schema_migrations WHERE name='migration_v666_send_exclusion_review_fixes';
COMMIT;
`

const out = {
  'migrations/migration_v666_send_exclusion_review_fixes.sql': UP,
  'migrations/rollback_v666_send_exclusion_review_fixes.sql': DOWN,
}
if (require.main === module) {
  for (const [file, text] of Object.entries(out)) { fs.writeFileSync(path.join(ROOT, file), text); console.log('ghi', file, text.length, md5(text)) }
  if (!NEW_MD5) console.log('Chưa có new-md5.json: bản gỡ chưa kiểm được thân V666. Chạy send-exclusion-v666-smoke.cjs (ghi file) rồi chạy lại bộ sinh.')
}
module.exports = { OLD, NEW, ORDER, SIG, OLD_MD5, NEW_MD5_FILE, out }

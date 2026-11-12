// Sinh migration V505: lấy data đầu lượt cho engine v2 (nhắn bạn bè "toàn bộ / theo tag", chúc mừng sinh nhật, đề xuất Zalo, huỷ lời
// mời kết bạn đã gửi), theo đúng bộ chạy Desktop/VPS (đầu executeCampaignV2: materializeZalo*InputData). Đặc tả:
// docs/engine-v2-specs/zalo-other-types.md §2.2, §2.4, §2.8, §2.9, §5 mục 4. Chỉ engine v2 gọi; bộ chạy cũ không đổi.
//
//   aka_agent_engine_materialize_v1 (mới): xác thực bằng lease engine của tài khoản; 'state' đọc số data + dấu "đã lấy" + ngày VN theo giờ
//     DB; 'clear' xoá mềm data của chiến dịch huỷ lời mời khi mọi data đã hoàn thành; 'insert' thêm data và dấu "đã lấy" trong một giao
//     dịch, chỉ khi chiến dịch chưa có dòng data nào; 'hold' đưa chiến dịch về chờ / tạm dừng kèm ghi chú, có thể hẹn lịch.
//   claim_target_v1: thao tác khai "quota": false chỉ kiểm khoá, không kiểm hạn mức (huỷ lời mời: limit_check_action_codes rỗng ở bản
//     cũ). Sửa tại chỗ thân V503 (md5 prosrc 23746f92…), so khớp đúng một chỗ.
// Chạy: node scripts/build-v505-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v503 = require('./build-v503-sql.cjs')

function extract(text, name) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$f\\$([\\s\\S]*?)\\$f\\$;`)
  const m = re.exec(text)
  if (!m) throw new Error(`Không thấy ${name} trong V503`)
  return { block: m[0], body: m[1] }
}
function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}
const bodyOf = block => /AS \$f\$([\s\S]*?)\$f\$;$/.exec(block)[1]

const claim = extract(v503.migration, 'aka_agent_engine_claim_target_v1')
const LIVE = { claim: v503.NEW.claim }
if (md5(claim.body) !== LIVE.claim || LIVE.claim !== '23746f9297b52e3bf04012b1ea73ae9f') {
  throw new Error('Thân claim_target_v1 của V503 không còn khớp bản đã kiểm (23746f92…)')
}

let c = claim.block
c = patch(c, `    v_limit := public.aka_agent_engine_action_limit(v_campaign_id, v_account_id, v_code);
`, `    -- V505: thao tác khai "quota": false chỉ kiểm khoá, không kiểm hạn mức (huỷ lời mời kết bạn: limit_check_action_codes rỗng ở bản cũ).
    v_limit := CASE WHEN v_act->'quota' = 'false'::jsonb THEN NULL
                    ELSE public.aka_agent_engine_action_limit(v_campaign_id, v_account_id, v_code) END;
`, 1, 'claim: bỏ hạn mức theo thao tác')

const SIG = 'public.aka_agent_engine_materialize_v1(bigint,uuid,text,jsonb)'
const ACTIONS = `('zalo_message_friend', 'zalo_message_birthday', 'zalo_message_friend_recommendation', 'zalo_cancel_sent_friend_request')`

const fn = `CREATE FUNCTION public.aka_agent_engine_materialize_v1(p_account_id bigint, p_lease_token uuid, p_operation text,
  p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '60s' AS $f$
-- Lấy data đầu lượt của engine v2 (materializeZalo*InputData của Desktop). Nơi chạy đọc Zalo; hàm này chỉ đọc / ghi data của chiến dịch
-- đang giữ lease. Không ném lỗi nghiệp vụ: trả { ok:false, reason }.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_iso text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_campaign_id bigint;
  c public.auto_campaigns%ROWTYPE;
  v_total bigint;
  v_pending bigint;
  v_running bigint;
  v_done bigint;
  v_rows jsonb;
  v_count integer;
  v_date text;
  v_marker jsonb;
  v_note text;
  v_status text;
  v_minutes integer;
  v_schedule timestamptz;
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('state', 'clear', 'insert', 'hold') OR p_account_id IS NULL OR p_lease_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT el.campaign_id INTO v_campaign_id FROM public.auto_engine_leases el
   WHERE el.account_id = p_account_id AND el.lease_token = p_lease_token AND el.expires_at > v_now;
  IF NOT FOUND OR v_campaign_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  IF p_operation = 'state' THEN
    SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id;
  ELSE
    -- Thứ tự khoá như finish_campaign_v2 và luồng nạp data: khoá nạp data của chiến dịch, rồi chiến dịch; lease kiểm lại sau khi chờ khoá.
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_campaign_id::text, 0));
    SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.auto_engine_leases el WHERE el.account_id = p_account_id AND el.lease_token = p_lease_token
                    AND el.campaign_id = v_campaign_id AND el.expires_at > clock_timestamp()) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost');
    END IF;
  END IF;
  IF c.id IS NULL OR coalesce(c.is_delete, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'campaign_deleted'); END IF;
  IF c.account_id IS DISTINCT FROM p_account_id OR NOT public.aka_agent_engine_scope_ok(c.staff_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost');
  END IF;
  IF c.status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_not_runnable', 'campaignStatus', c.status);
  END IF;
  -- Máy chưa cập nhật (bộ cũ) đang giữ chiến dịch: không đụng data, như finish_campaign_v2.
  IF c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'legacy_busy'); END IF;
  IF c.action_id NOT IN ${ACTIONS}
     OR (c.action_id = 'zalo_message_friend' AND coalesce(c.extra_settings->>'zaloFriendTargetMode', 'selected') NOT IN ('all_friends', 'tagged_friends')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'action_not_supported');
  END IF;
  -- Nhóm data có ledger riêng, không lấy data đầu lượt (clearCampaignInputData của Desktop cũng từ chối).
  IF c.data_target_source_mode = 'data_group' THEN RETURN jsonb_build_object('ok', false, 'reason', 'data_group'); END IF;

  SELECT count(*), count(*) FILTER (WHERE d.status = 'chờ xử lý'), count(*) FILTER (WHERE d.status = 'đang chạy'),
         count(*) FILTER (WHERE d.status = 'hoàn thành')
    INTO v_total, v_pending, v_running, v_done
    FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false;

  IF p_operation = 'state' THEN
    RETURN jsonb_build_object('ok', true, 'vnDate', to_char(v_vn, 'YYYY-MM-DD'), 'total', v_total, 'pending', v_pending,
      'running', v_running, 'done', v_done, 'note', c.note,
      'markers', jsonb_strip_nulls(jsonb_build_object(
        'zaloFriendDataMaterializedAt', c.extra_settings->'zaloFriendDataMaterializedAt',
        'zaloBirthdayDataMaterializedDate', c.extra_settings->'zaloBirthdayDataMaterializedDate',
        'zaloFriendRecommendationDataMaterializedAt', c.extra_settings->'zaloFriendRecommendationDataMaterializedAt',
        'zaloCancelFriendRequestDataMaterializedAt', c.extra_settings->'zaloCancelFriendRequestDataMaterializedAt')));
  END IF;

  IF p_operation = 'clear' THEN
    -- Như shouldMaterializeZaloCancelSentFriendRequestInputData + clearCampaignInputData: chỉ huỷ lời mời, chỉ khi mọi data đã hoàn thành.
    IF c.action_id <> 'zalo_cancel_sent_friend_request' THEN RETURN jsonb_build_object('ok', false, 'reason', 'action_not_supported'); END IF;
    IF v_done < v_total OR EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.campaign_id = c.id AND tr.completed_at IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_all_done');
    END IF;
    UPDATE public.auto_campaign_input_data SET is_delete = true WHERE campaign_id = c.id AND coalesce(is_delete, false) = false;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'cleared', v_count);
  END IF;

  IF p_operation = 'insert' THEN
    -- Chỉ thêm vào chiến dịch chưa có dòng data nào: gọi lại sau khi đã thêm (hết giờ chờ, lỗi mạng) không thêm trùng.
    IF v_total > 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_empty', 'total', v_total); END IF;
    v_rows := coalesce(p_payload->'rows', '[]'::jsonb);
    IF jsonb_typeof(v_rows) <> 'array' OR jsonb_array_length(v_rows) > 20000 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
    END IF;
    -- Cột như createCampaignInputDataBatchWithRollback của Desktop (chuỗi rỗng thành NULL, trạng thái "chờ xử lý"), giữ thứ tự Zalo trả.
    INSERT INTO public.auto_campaign_input_data (campaign_id, name, phone, uid, info1, info2, info3, status, note)
    SELECT c.id, nullif(x.value->>'name', ''), nullif(x.value->>'phone', ''), nullif(btrim(x.value->>'uid'), ''),
           nullif(x.value->>'info1', ''), nullif(x.value->>'info2', ''), nullif(x.value->>'info3', ''), 'chờ xử lý', NULL
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS x(value, n)
     WHERE jsonb_typeof(x.value) = 'object' AND nullif(btrim(x.value->>'uid'), '') IS NOT NULL
     ORDER BY x.n;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_date := CASE WHEN coalesce(p_payload->>'vnDate', '') ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN p_payload->>'vnDate' ELSE to_char(v_vn, 'YYYY-MM-DD') END;
    -- Dấu "đã lấy" như Desktop (giờ của DB thay giờ máy); bảo trì lịch của bộ cũ xoá dấu khi đặt lịch mới (trừ bạn bè: một lần).
    v_marker := CASE c.action_id
      WHEN 'zalo_message_friend' THEN jsonb_build_object('zaloFriendDataMaterializedAt', v_iso, 'zaloFriendMaterializedCount', v_count)
      WHEN 'zalo_message_birthday' THEN jsonb_build_object('zaloBirthdayDataMaterializedDate', v_date, 'zaloBirthdayMaterializedCount', v_count)
      WHEN 'zalo_message_friend_recommendation' THEN jsonb_build_object('zaloFriendRecommendationDataMaterializedAt', v_iso,
        'zaloFriendRecommendationMaterializedCount', v_count)
      ELSE jsonb_build_object('zaloCancelFriendRequestDataMaterializedAt', v_iso, 'zaloCancelFriendRequestMaterializedCount', v_count) END;
    UPDATE public.auto_campaigns SET extra_settings = coalesce(extra_settings, '{}'::jsonb) || v_marker, updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'inserted', v_count);
  END IF;

  -- hold: chiến dịch về chờ (hoặc tạm dừng) kèm ghi chú, có thể hẹn lịch chạy lại sau N phút.
  v_note := left(nullif(btrim(p_payload->>'note'), ''), 2000);
  v_status := coalesce(nullif(p_payload->>'status', ''), 'chờ xử lý');
  IF v_note IS NULL OR v_status NOT IN ('chờ xử lý', 'tạm dừng') THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request'); END IF;
  v_minutes := CASE WHEN coalesce(p_payload->>'retryAfterMinutes', '') ~ '^\\d{1,4}$' THEN (p_payload->>'retryAfterMinutes')::integer END;
  v_schedule := CASE WHEN coalesce(v_minutes, 0) > 0 THEN v_now + make_interval(mins => v_minutes) ELSE c.schedule END;
  UPDATE public.auto_campaigns SET status = v_status, note = v_note, schedule = v_schedule, updated_at = v_now WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'campaignStatus', v_status, 'schedule', v_schedule);
END $f$;`

const NEW = { claim: md5(bodyOf(c)), fn: md5(bodyOf(fn)) }

const migration = `-- V505: lấy data đầu lượt cho engine v2 (bạn bè "toàn bộ / theo tag", sinh nhật, đề xuất Zalo, huỷ lời mời kết bạn đã gửi), 12/11/2026.
-- SINH TỪ scripts/build-v505-sql.cjs, không sửa tay. Đặc tả: docs/engine-v2-specs/zalo-other-types.md §2.2, §2.4, §2.8, §2.9.
--
-- Chỉ engine v2 gọi (Fly chỉ khi tổ chức bật cờ, Desktop chỉ bản cài mới); bộ chạy cũ không đổi. Không thêm cột, bảng, mã lỗi hay dữ liệu.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Cần V503 (thân claim_target_v1) và V504.
--   * aka_agent_engine_materialize_v1 (mới): đọc / ghi data đầu lượt của chiến dịch đang giữ lease.
--   * claim_target_v1: thao tác khai "quota": false chỉ kiểm khoá, không kiểm hạn mức.
-- Gỡ: rollback_v505_engine_materialize.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v505_%') THEN
      RAISE EXCEPTION 'V505 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_engine_claim_batch_v1(jsonb)') IS NULL THEN RAISE EXCEPTION 'V505 cần V503'; END IF;
  IF to_regprocedure('public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'V505 cần V504'; END IF;
  IF to_regprocedure('${SIG}') IS NOT NULL THEN RAISE EXCEPTION 'V505: hàm lấy data đầu lượt đã có'; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  IF v_md5 IS DISTINCT FROM '${LIVE.claim}' THEN RAISE EXCEPTION 'V505: thân aka_agent_engine_claim_target_v1 khác V503 (%)', v_md5; END IF;
END $pre$;

${c}

${fn}

DO $grants$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON FUNCTION ${SIG} FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON FUNCTION ${SIG} FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ${SIG} TO service_role'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ${SIG} TO aka_agent_chat_api'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ${SIG} TO aka_agent_desktop'; END IF;
END $grants$;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.claim}' THEN RAISE EXCEPTION 'V505 postflight: claim_target_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.fn}' THEN RAISE EXCEPTION 'V505 postflight: materialize_v1 %', v_md5; END IF;
  IF has_function_privilege('anon', '${SIG}', 'EXECUTE') OR has_function_privilege('authenticated', '${SIG}', 'EXECUTE') THEN
    RAISE EXCEPTION 'V505 postflight: quyền hàm mới quá rộng';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V505: xoá hàm lấy data đầu lượt, trả claim_target_v1 về thân V503.
-- SINH TỪ scripts/build-v505-sql.cjs. Nơi chạy đang dùng lấy data đầu lượt của engine v2 phải được đưa về bản trước (hoặc tắt cờ tổ chức)
-- trước khi gỡ.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regprocedure('${SIG}') IS NULL THEN RAISE EXCEPTION 'Gỡ V505: chưa có V505'; END IF;
END $pre$;

DROP FUNCTION ${SIG};

${claim.block}

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.claim}' THEN RAISE EXCEPTION 'Gỡ V505 postflight: claim_target_v1 %', v_md5; END IF;
END $post$;

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v505_engine_materialize.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v505_engine_materialize.sql'), rollback)
  console.log('V505 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}

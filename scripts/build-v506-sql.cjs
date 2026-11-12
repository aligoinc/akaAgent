// Sinh migration V506: group thời gian thực và kiêm gửi SMS nội bộ cho engine v2, theo đúng bộ chạy Desktop/VPS. Đặc tả:
// docs/engine-v2-specs/zalo-other-types.md §2.1 (SMS), §2.10 (group thời gian thực). Chỉ engine v2 gọi; bộ chạy cũ không đổi.
//
//   finish_campaign_v2: nhánh group thời gian thực như handleZaloRealtimeGroupCompletion / prepareZaloRealtimeGroupCampaignRun (data đến
//     hạn → chạy lại ngay; data tương lai → hẹn; còn ngày nhận data → chờ tới giờ gốc; hết ngày → hoàn thành), thay cho
//     'completion_not_supported' của V501. Sửa tại chỗ thân V501 (md5 prosrc 534ca511…), so khớp đúng số chỗ.
//   aka_agent_engine_sms_push_v1 (mới): kiêm SMS nội bộ (pushZaloDetailToInternalSmsIfNeeded + ensureInternalSmsChildCampaign +
//     createSmsCampaignInputDataSnapshot + reopenCompletedCampaignAfterInputInsert): một data vào chiến dịch SMS con của từng tài khoản SMS
//     đã chọn, xác thực bằng lease của lượt data.
// Chạy: node scripts/build-v506-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v501 = require('./build-v501-sql.cjs')

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}
const bodyOf = block => /AS \$f\$([\s\S]*?)\$f\$;$/.exec(block)[1]

const m = /CREATE FUNCTION public\.aka_agent_engine_finish_campaign_v2\([\s\S]*?AS \$f\$([\s\S]*?)\$f\$;/.exec(v501.migration)
if (!m) throw new Error('Không thấy finish_campaign_v2 trong V501')
const LIVE = { finish: v501.NEW.finish }
if (md5(m[1]) !== LIVE.finish || LIVE.finish !== '534ca5114184f4e4387fc8af626b064c') {
  throw new Error('Thân finish_campaign_v2 của V501 không còn khớp bản đã apply (534ca511…)')
}
const finishV501 = m[0].replace('CREATE FUNCTION public.aka_agent_engine_finish_campaign_v2(', 'CREATE OR REPLACE FUNCTION public.aka_agent_engine_finish_campaign_v2(')

let f = finishV501
f = patch(f, `  v_m text[];
BEGIN`, `  v_m text[];
  -- V506: group thời gian thực.
  v_rt_raw text;
  v_rt_key text;
  v_anchor timestamptz;
  v_rt_slot time;
BEGIN`, 1, 'finish: biến group thời gian thực')
f = patch(f, `  IF c.data_target_source_mode = 'data_group' OR c.action_id = 'zalo_message_group_realtime' THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = c.id AND status = 'đang chạy';
    RETURN jsonb_build_object('ok', false, 'reason', 'completion_not_supported', 'campaignStatus', 'chờ xử lý');
  END IF;`, `  IF c.data_target_source_mode = 'data_group' THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = c.id AND status = 'đang chạy';
    RETURN jsonb_build_object('ok', false, 'reason', 'completion_not_supported', 'campaignStatus', 'chờ xử lý');
  END IF;`, 1, 'finish: bỏ chặn group thời gian thực')
f = patch(f, `  -- 1. Data chưa đến lịch: hẹn chiến dịch tới data sớm nhất`, `  -- V506: group thời gian thực, như handleZaloRealtimeGroupCompletion (sau lượt) và prepareZaloRealtimeGroupCampaignRun (lượt không có data
  -- đến hạn) của Desktop, theo đúng thứ tự: data đến hạn còn chờ → chạy lại ngay; data tương lai → hẹn tới data sớm nhất; còn trong ngày
  -- nhận data (zaloRealtimeEndDate, ngày VN của DB) → chờ tới giờ gốc của chiến dịch (hôm nay nếu chưa qua, không thì ngày mai); hết ngày
  -- nhận → hoàn thành. Data do bộ nhận sự kiện của bản cũ đổ vào (enqueue_campaign_zalo_realtime_group_event), không đổi.
  IF c.action_id = 'zalo_message_group_realtime' THEN
    IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                  AND (d.schedule IS NULL OR d.schedule <= v_now)) THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_now, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', 'realtime_due_pending', 'campaignStatus', 'chờ xử lý');
    END IF;
    SELECT min(d.schedule) INTO v_next FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý' AND d.schedule > v_now;
    IF v_next IS NOT NULL THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', 'rescheduled_future_input', 'schedule', v_next, 'campaignStatus', 'chờ xử lý');
    END IF;
    -- getZaloRealtimeEndDateKey: "YYYY-MM-DD" giữ nguyên (so như chuỗi), dạng khác đọc như ngày giờ rồi lấy ngày VN; sai thì hết hạn.
    v_rt_raw := btrim(coalesce(c.extra_settings->>'zaloRealtimeEndDate', ''));
    v_rt_key := NULL;
    IF v_rt_raw ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN
      v_rt_key := v_rt_raw;
    ELSIF v_rt_raw <> '' THEN
      BEGIN
        v_rt_key := to_char((v_rt_raw::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');
      EXCEPTION WHEN OTHERS THEN
        v_rt_key := NULL;
      END;
    END IF;
    IF v_rt_key IS NOT NULL AND to_char(v_vn, 'YYYY-MM-DD') <= v_rt_key THEN
      -- getZaloRealtimeWaitSchedule: giờ:phút (VN) của lịch gốc, không có thì lịch hiện tại, không có nữa thì bây giờ.
      v_anchor := coalesce(c.original_schedule, c.schedule, v_now);
      v_rt_slot := date_trunc('minute', (v_anchor AT TIME ZONE 'Asia/Ho_Chi_Minh'))::time;
      v_next := ((v_vn + v_rt_slot)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
      IF v_next <= v_now THEN v_next := (((v_vn + 1) + v_rt_slot)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'); END IF;
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      -- Lượt đã chạy data thì "tiếp tục chờ" (sau lượt), chưa chạy data nào thì "đang chờ" (trước lượt), như hai câu của Desktop.
      RETURN jsonb_build_object('ok', true, 'reason', 'realtime_waiting', 'schedule', v_next, 'campaignStatus', 'chờ xử lý',
        'ranTargets', EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.lease_token = p_lease_token AND tr.campaign_id = c.id));
    END IF;
    RETURN public.aka_agent_engine_finalize_v501(c.id, 'Chiến dịch đã hết ngày nhận data theo thời gian thực và không còn data chờ chạy',
      'completed_realtime_end', NULL);
  END IF;

  -- 1. Data chưa đến lịch: hẹn chiến dịch tới data sớm nhất`, 1, 'finish: nhánh group thời gian thực')

const SMS_SIG = 'public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb)'
const sms = `CREATE FUNCTION public.aka_agent_engine_sms_push_v1(p_target_run_id bigint, p_lease_token uuid, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '30s' AS $f$
-- Kiêm gửi SMS nội bộ của engine v2, như pushZaloDetailToInternalSmsIfNeeded của Desktop: với từng tài khoản SMS đã chọn, lấy chiến dịch SMS
-- con theo bản đồ internalSmsCreatedCampaignIdsByAccount (mở lại nếu đã hoàn thành) hoặc tạo mới như createCampaign, thêm một data
-- (createSmsCampaignInputDataSnapshot) rồi mở lại nếu đã hoàn thành (reopenCompletedCampaignAfterInputInsert). Mỗi tài khoản một giao dịch
-- con: lỗi của tài khoản này không làm mất tài khoản khác. Lõi quyết định khi nào đẩy và dựng nội dung. Xác thực bằng lease của lượt data
-- (lượt có thể vừa đóng vì bước cuối của data vừa báo).
DECLARE
  v_now timestamptz := clock_timestamp();
  r public.auto_engine_target_runs%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  v_row jsonb := coalesce(p_payload->'row', '{}'::jsonb);
  v_phone text := nullif(btrim(coalesce(p_payload->'row'->>'phone', '')), '');
  v_allowed bigint[];
  v_account_id bigint;
  v_extra jsonb;
  v_mapping jsonb;
  v_child_id bigint;
  v_child_status text;
  v_sms_name text;
  v_err text;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF p_target_run_id IS NULL OR p_lease_token IS NULL OR jsonb_typeof(p_payload->'accountIds') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_row) IS DISTINCT FROM 'object' OR v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id;
  IF NOT FOUND OR r.lease_token IS DISTINCT FROM p_lease_token OR NOT EXISTS (
       SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost');
  END IF;
  -- Khoá chiến dịch nguồn: bản đồ chiến dịch SMS con đổi trong giao dịch này.
  SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id AND NOT coalesce(is_delete, false) FOR UPDATE;
  IF NOT FOUND OR NOT public.aka_agent_engine_scope_ok(c.staff_id) THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  IF c.action_id NOT IN ('zalo_message_phone', 'zalo_message_group_member') OR c.extra_settings->'internalSmsEnabled' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_enabled');
  END IF;
  -- Chỉ tài khoản SMS chiến dịch đã chọn (getInternalSmsAccountIds: số dương).
  SELECT coalesce(array_agg(DISTINCT floor(x::numeric)::bigint), '{}'::bigint[]) INTO v_allowed
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.extra_settings->'internalSmsAccountIds') = 'array'
                                        THEN c.extra_settings->'internalSmsAccountIds' ELSE '[]'::jsonb END) x
   WHERE x ~ '^[0-9]+(\\.[0-9]+)?$' AND x::numeric > 0;

  FOR v_account_id IN SELECT DISTINCT x::bigint FROM jsonb_array_elements_text(p_payload->'accountIds') x WHERE x ~ '^[0-9]{1,18}$' LOOP
    BEGIN
      IF NOT (v_account_id = ANY (v_allowed)) THEN
        RAISE EXCEPTION 'Tài khoản Sms #% không có trong cấu hình kiêm SMS của chiến dịch.', v_account_id;
      END IF;
      SELECT coalesce(nullif(a.name, ''), nullif(a.username, ''), 'Sms #' || a.id) INTO v_sms_name FROM public.auto_accounts a
       WHERE a.id = v_account_id AND NOT coalesce(a.is_delete, false) AND a.flatform_type = 'sms'
         AND a.staff_id = c.staff_id AND a.organization_id IS NOT DISTINCT FROM c.organization_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Tài khoản Sms #% không tồn tại hoặc không hợp lệ.', v_account_id; END IF;
      -- Bản đồ đọc lại mỗi tài khoản (dòng đã khoá): lần trước có thể vừa thêm chiến dịch con.
      SELECT coalesce(x.extra_settings, '{}'::jsonb) INTO v_extra FROM public.auto_campaigns x WHERE x.id = c.id;
      v_mapping := CASE WHEN jsonb_typeof(v_extra->'internalSmsCreatedCampaignIdsByAccount') = 'object'
                        THEN v_extra->'internalSmsCreatedCampaignIdsByAccount' ELSE '{}'::jsonb END;
      v_child_id := NULL;
      -- isUsableInternalSmsChildCampaign: còn, là SMS, đúng tài khoản, nguồn trống hoặc là chiến dịch này.
      IF coalesce(v_mapping->>(v_account_id::text), '') ~ '^[0-9]{1,18}$' THEN
        SELECT x.id, x.status INTO v_child_id, v_child_status FROM public.auto_campaigns x
         WHERE x.id = (v_mapping->>(v_account_id::text))::bigint AND NOT coalesce(x.is_delete, false) AND x.action_id = 'sms_send'
           AND x.account_id = v_account_id
           AND (coalesce(x.extra_settings->>'internalSmsSourceCampaignId', '') !~ '^[0-9]+(\\.[0-9]+)?$'
                OR (x.extra_settings->>'internalSmsSourceCampaignId')::numeric = c.id)
         FOR UPDATE;
        IF v_child_id IS NOT NULL AND v_child_status = 'hoàn thành' THEN
          UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, updated_at = v_now WHERE id = v_child_id;
        END IF;
      END IF;
      IF v_child_id IS NULL THEN
        -- Như createCampaign của Desktop cho chiến dịch SMS (lịch hằng ngày, chạy tiếp hôm sau, làm mới data).
        INSERT INTO public.auto_campaigns (name, action_id, account_id, secondary_account_id, status, schedule, original_schedule, schedule_type,
          schedule_end_date, daily_stop_time, schedule_days, schedule_week_days, continue_next_day, refresh_data, content, extra_settings, images,
          log, note, data_target_source_mode, data_group_id, provisioning_state, creation_bundle_id, creation_bundle_child_index, staff_id,
          organization_id)
        VALUES ('Kiêm SMS - ' || coalesce(c.name, '') || ' - ' || v_sms_name, 'sms_send', v_account_id, NULL, 'chờ xử lý', v_now, v_now, 'daily',
          NULL, NULL, NULL, NULL, true, true, coalesce(c.extra_settings->>'internalSmsContent', ''),
          jsonb_build_object('internalSmsSourceCampaignId', c.id, 'internalSmsSourceCampaignName', c.name, 'internalSmsSourceActionId', c.action_id),
          '[]'::jsonb, '', NULL, 'direct', NULL, 'ready', NULL, NULL, c.staff_id, c.organization_id)
        RETURNING id INTO v_child_id;
        UPDATE public.auto_campaigns
           SET extra_settings = v_extra || jsonb_build_object('internalSmsCreatedCampaignIdsByAccount',
                 v_mapping || jsonb_build_object(v_account_id::text, v_child_id)), updated_at = v_now
         WHERE id = c.id;
      END IF;
      INSERT INTO public.auto_campaign_input_data (campaign_id, name, phone, phone_carrier, uid, email, info1, info2, info3, info4, info5, content,
        status, note, schedule)
      VALUES (v_child_id, nullif(v_row->>'name', ''), v_phone, nullif(v_row->>'phoneCarrier', ''), nullif(v_row->>'uid', ''),
        nullif(v_row->>'email', ''), nullif(v_row->>'info1', ''), nullif(v_row->>'info2', ''), nullif(v_row->>'info3', ''),
        nullif(v_row->>'info4', ''), nullif(v_row->>'info5', ''), p_payload->>'content', 'chờ xử lý', NULL, v_now);
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, completed_at = NULL, updated_at = v_now
       WHERE id = v_child_id AND action_id = 'sms_send' AND NOT coalesce(is_delete, false) AND status = 'hoàn thành';
      v_results := v_results || jsonb_build_array(jsonb_build_object('accountId', v_account_id, 'ok', true, 'campaignId', v_child_id));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_results := v_results || jsonb_build_array(jsonb_build_object('accountId', v_account_id, 'ok', false, 'error', v_err));
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'results', v_results);
END $f$;`

const NEW = { finish: md5(bodyOf(f)), sms: md5(bodyOf(sms)) }

const migration = `-- V506: group thời gian thực và kiêm gửi SMS nội bộ cho engine v2, theo đúng bộ chạy Desktop/VPS (12/11/2026).
-- SINH TỪ scripts/build-v506-sql.cjs, không sửa tay. Đặc tả: docs/engine-v2-specs/zalo-other-types.md §2.1, §2.10.
--
-- Chỉ engine v2 gọi (Fly chỉ khi tổ chức bật cờ, Desktop chỉ bản cài mới); bộ chạy cũ không đổi. Không thêm bảng, cột, mã lỗi.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Cần V505.
--   * finish_campaign_v2: nhánh group thời gian thực (chờ data / hết ngày nhận) thay cho 'completion_not_supported'.
--   * aka_agent_engine_sms_push_v1 (mới): kiêm SMS nội bộ sang chiến dịch SMS con.
-- Gỡ: rollback_v506_engine_realtime_sms.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v506_%') THEN
      RAISE EXCEPTION 'V506 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_engine_materialize_v1(bigint,uuid,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'V506 cần V505'; END IF;
  IF to_regprocedure('${SMS_SIG}') IS NOT NULL THEN RAISE EXCEPTION 'V506: hàm kiêm SMS đã có'; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)');
  IF v_md5 IS DISTINCT FROM '${LIVE.finish}' THEN RAISE EXCEPTION 'V506: thân aka_agent_engine_finish_campaign_v2 khác V501 (%)', v_md5; END IF;
END $pre$;

${f}

${sms}

DO $grants$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION ${SMS_SIG} FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON FUNCTION ${SMS_SIG} FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON FUNCTION ${SMS_SIG} FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ${SMS_SIG} TO service_role'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ${SMS_SIG} TO aka_agent_chat_api'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ${SMS_SIG} TO aka_agent_desktop'; END IF;
END $grants$;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.finish}' THEN RAISE EXCEPTION 'V506 postflight: finish_campaign_v2 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SMS_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.sms}' THEN RAISE EXCEPTION 'V506 postflight: sms_push_v1 %', v_md5; END IF;
  IF has_function_privilege('anon', '${SMS_SIG}', 'EXECUTE') OR has_function_privilege('authenticated', '${SMS_SIG}', 'EXECUTE') THEN
    RAISE EXCEPTION 'V506 postflight: quyền hàm mới quá rộng';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V506: xoá hàm kiêm SMS, trả finish_campaign_v2 về thân V501.
-- SINH TỪ scripts/build-v506-sql.cjs. Chiến dịch SMS con đã tạo và data đã đẩy được giữ nguyên. Nơi chạy đang dùng group thời gian thực /
-- kiêm SMS của engine v2 phải được đưa về bản trước (hoặc tắt cờ tổ chức) trước khi gỡ.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regprocedure('${SMS_SIG}') IS NULL THEN RAISE EXCEPTION 'Gỡ V506: chưa có V506'; END IF;
END $pre$;

DROP FUNCTION ${SMS_SIG};

${finishV501}

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.finish}' THEN RAISE EXCEPTION 'Gỡ V506 postflight: finish_campaign_v2 %', v_md5; END IF;
END $post$;

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW, SMS_SIG }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v506_engine_realtime_sms.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v506_engine_realtime_sms.sql'), rollback)
  console.log('V506 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}

-- V506: group thời gian thực và kiêm gửi SMS nội bộ cho engine v2, theo đúng bộ chạy Desktop/VPS (12/11/2026).
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
  IF to_regprocedure('public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'V506: hàm kiêm SMS đã có'; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)');
  IF v_md5 IS DISTINCT FROM '534ca5114184f4e4387fc8af626b064c' THEN RAISE EXCEPTION 'V506: thân aka_agent_engine_finish_campaign_v2 khác V501 (%)', v_md5; END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_finish_campaign_v2(p_account_id bigint, p_lease_token uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Hết data khi còn giữ lease: kết thúc lượt như Desktop (campaignScheduler.ts, cuối executeCampaignV2 + handleCampaignCompletion +
-- rescheduleCompletedCampaignPass), theo đúng thứ tự. Trả lý do; lõi in câu tiến trình theo lý do.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_campaign_id bigint;
  l public.auto_engine_leases%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  a public.auto_accounts%ROWTYPE;
  v_extra jsonb;
  v_next timestamptz;
  v_cutoff time;
  v_slots text[];
  v_slot text;
  v_slot_minute integer;
  v_current_minute integer;
  v_candidate timestamptz;
  v_next_slot text;
  v_minutes integer;
  v_raw jsonb;
  v_mode text;
  v_suffix text;
  v_total bigint;
  v_resettable bigint;
  v_m text[];
  -- V506: group thời gian thực.
  v_rt_raw text;
  v_rt_key text;
  v_anchor timestamptz;
  v_rt_slot time;
BEGIN
  SELECT el.campaign_id INTO v_campaign_id FROM public.auto_engine_leases el
   WHERE el.account_id = p_account_id AND el.lease_token = p_lease_token AND el.expires_at > v_now;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  -- Thứ tự khoá như bản cũ: khoá nạp data của chiến dịch (cùng khoá với aka_agent_lock_campaign_input_serialization và luồng nạp
  -- Nhóm data), rồi chiến dịch, tài khoản, rồi lease (claim cũng khoá chiến dịch → tài khoản → lease).
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_campaign_id::text, 0));
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;
  SELECT * INTO a FROM public.auto_accounts WHERE id = p_account_id FOR UPDATE;
  SELECT * INTO l FROM public.auto_engine_leases
   WHERE account_id = p_account_id AND lease_token = p_lease_token AND expires_at > v_now FOR UPDATE;
  IF NOT FOUND OR l.campaign_id IS DISTINCT FROM v_campaign_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  IF c.id IS NULL OR coalesce(c.is_delete, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'campaign_deleted'); END IF;
  IF c.status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_control_won', 'campaignStatus', c.status);
  END IF;
  -- Review 12/11: máy chưa cập nhật (bộ cũ) đã nhận chiến dịch giữa lúc lõi hết data và lúc kết thúc lượt: không kết thúc / đặt lại
  -- data, như release_v1 và close_stale_v1 (chỉ đụng chiến dịch không còn token của bộ cũ).
  IF c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'legacy_busy');
  END IF;
  -- Như finalizer của VPS: tài khoản Server bị tạm dừng trong lượt thì chiến dịch về "chờ xử lý", không hoàn thành.
  IF l.runtime_target = 'fly' AND a.status IS DISTINCT FROM 'đang chạy' AND a.status IS DISTINCT FROM 'chờ xử lý' THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'account_control_won', 'accountStatus', a.status, 'campaignStatus', 'chờ xử lý');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.campaign_id = c.id AND tr.completed_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                 WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'đang chạy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'targets_remaining');
  END IF;
  -- Data đến hạn chưa thử trong lượt này (vừa được thêm vào): chạy tiếp, chưa kết thúc.
  IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
              WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                AND (d.schedule IS NULL OR d.schedule <= v_now)
                AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = p_lease_token)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'targets_remaining');
  END IF;
  -- Review 12/11: bản cũ xoá ghi chú khi bắt đầu mỗi lượt (claim v397); bộ mới chỉ xoá khi nhận được data (chiến dịch sang "đang
  -- chạy"). Lượt không nhận data nào (chiến dịch còn "chờ xử lý", ví dụ mọi data còn lại bị chống gửi lặp tạm dừng) thì ghi chú đang
  -- có là của lượt trước (câu chờ khoá / hạn mức, không kiểm được giới hạn gửi lặp): xoá trước khi hoàn thành / hẹn lại.
  IF c.status = 'chờ xử lý' AND c.note IS NOT NULL THEN
    UPDATE public.auto_campaigns SET note = NULL, updated_at = v_now WHERE id = c.id;
    c.note := NULL;
  END IF;

  -- 0. Như executeCampaignV2 (isZaloFriendAutoDataCampaign && không có data): chiến dịch nhắn bạn bè "toàn bộ / theo tag" đã lấy
  -- data một lần mà không còn dòng nào thì giữ "chờ xử lý" kèm ghi chú, không hoàn thành (chế độ lạ coi như "selected").
  IF c.action_id = 'zalo_message_friend'
     AND coalesce(c.extra_settings->>'zaloFriendTargetMode', 'selected') IN ('all_friends', 'tagged_friends')
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false) THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = 'Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy',
      updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'friend_auto_no_data', 'campaignStatus', 'chờ xử lý');
  END IF;

  -- V506: group thời gian thực, như handleZaloRealtimeGroupCompletion (sau lượt) và prepareZaloRealtimeGroupCampaignRun (lượt không có data
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
    IF v_rt_raw ~ '^\d{4}-\d{2}-\d{2}$' THEN
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

  -- 1. Data chưa đến lịch: hẹn chiến dịch tới data sớm nhất (deferCampaignUntilFutureInput), trước mọi nhánh khác.
  SELECT min(d.schedule) INTO v_next FROM public.auto_campaign_input_data d
   WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý' AND d.schedule > v_now;
  IF v_next IS NOT NULL THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'rescheduled_future_input', 'schedule', v_next, 'campaignStatus', 'chờ xử lý');
  END IF;

  -- 2. Nhóm data (handleCampaignCompletion bước 1): đúng hàm kết thúc của bản cũ (aka_agent_internal_finalize_data_group_campaign_v219,
  -- cùng lõi với bản Desktop và bản Zalo Server): data chờ / về hàng đợi → chờ xử lý; nguồn đang nhận → chờ xử lý + "Chờ data mới";
  -- nguồn dừng / hết hạn / bị xoá → hoàn thành. Lease của lượt là bằng chứng sở hữu (thay kiểm runtime của hai bản bọc).
  IF c.data_target_source_mode = 'data_group'
     AND to_regprocedure('public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_internal_finalize_data_group_campaign_v219($1, $2, $3, $4)' INTO v_raw
      USING c.staff_id, c.organization_id, c.id, p_note;
    RETURN jsonb_build_object('ok', true, 'reason', CASE WHEN (v_raw->>'completed')::boolean THEN 'data_group_completed' ELSE 'data_group_waiting' END,
      'finalize', v_raw, 'campaignStatus', v_raw->>'status');
  END IF;
  -- Nhóm theo thời gian thực có bộ kết thúc riêng của bản cũ; Nhóm data khi DB chưa có hàm kết thúc (DB thử): không tự hoàn thành
  -- (hoàn thành làm trigger dừng hẳn nguồn Nhóm data).
  IF c.data_target_source_mode = 'data_group' THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = c.id AND status = 'đang chạy';
    RETURN jsonb_build_object('ok', false, 'reason', 'completion_not_supported', 'campaignStatus', 'chờ xử lý');
  END IF;

  v_cutoff := least(coalesce(c.daily_stop_time, time '23:59:00'), time '23:59:00');
  v_extra := coalesce(c.extra_settings, '{}'::jsonb);

  -- 3. Hết ngày kết thúc.
  IF c.schedule_end_date IS NOT NULL AND v_now >= c.schedule_end_date THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_end_date', NULL);
  END IF;

  -- 4. Nhiều khung giờ (handleMultiDailyTimeSlotAfterCompletion): khung hiện tại = lịch lúc bắt đầu lượt, phải cùng ngày hôm nay.
  IF c.action_id IN ('zalo_message_friend', 'zalo_message_group') AND v_extra->'multiDailyTimeSlotsEnabled' = 'true'::jsonb THEN
    -- Tách theo dấu phẩy/xuống dòng, chuẩn hoá H, H:M, HhM, Hh (giờ 0–23, phút 0–59), bỏ trùng theo phút, xếp tăng dần.
    SELECT coalesce(array_agg(s.slot ORDER BY s.minute), '{}'::text[]) INTO v_slots FROM (
      SELECT DISTINCT ON (x.minute) x.minute, x.slot FROM (
        SELECT (m[1])::integer * 60 + coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer AS minute,
               lpad(m[1]::integer::text, 2, '0') || ':' || lpad(coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer::text, 2, '0') AS slot
          FROM regexp_split_to_table(CASE jsonb_typeof(v_extra->'multiDailyTimeSlots') WHEN 'string' THEN v_extra->>'multiDailyTimeSlots'
                                          WHEN 'number' THEN v_extra->>'multiDailyTimeSlots' ELSE '' END, '[,\r\n]+') item,
               LATERAL regexp_match(regexp_replace(lower(btrim(item)), '\s+', '', 'g'), '^(\d{1,2})(?::(\d{1,2})|h(\d{1,2})?|h)?$') m
         WHERE m IS NOT NULL AND (m[1])::integer BETWEEN 0 AND 23 AND coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer BETWEEN 0 AND 59
      ) x ORDER BY x.minute
    ) s;
    IF cardinality(v_slots) >= 2 AND l.campaign_schedule IS NOT NULL
       AND (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_vn THEN
      v_current_minute := extract(hour FROM (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer * 60
                        + extract(minute FROM (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer;
      FOREACH v_slot IN ARRAY v_slots LOOP
        v_slot_minute := split_part(v_slot, ':', 1)::integer * 60 + split_part(v_slot, ':', 2)::integer;
        CONTINUE WHEN v_slot_minute <= v_current_minute;
        v_candidate := ((v_vn + make_interval(mins => v_slot_minute))::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
        CONTINUE WHEN v_candidate <= v_now;
        v_next_slot := v_slot;
        EXIT;
      END LOOP;
      IF v_next_slot IS NULL THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_slot', NULL);
      END IF;
      IF (v_candidate AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_slot_after_cutoff', jsonb_build_object('slot', v_next_slot));
      END IF;
      v_next := v_candidate;
      v_mode := 'slot_advanced';
      v_suffix := 'ở khung giờ tiếp theo';
    END IF;
  END IF;

  -- 5. Gửi lặp lại sau x phút (handleZaloShareRepeatAfterCompletion): nhắn bạn bè/nhóm dạng chia sẻ, không nhiều khung giờ,
  -- không bật chống gửi lặp N ngày, số phút 5–1439 (số, hoặc chuỗi 1–4 chữ số).
  IF v_mode IS NULL AND c.action_id IN ('zalo_message_friend', 'zalo_message_group') AND v_extra->'zaloShareRepeatEnabled' = 'true'::jsonb
     AND v_extra->>'zaloMessageSendMode' = 'share' AND v_extra->'multiDailyTimeSlotsEnabled' IS DISTINCT FROM 'true'::jsonb
     AND v_extra->'recentDeliveryCooldownEnabled' IS DISTINCT FROM 'true'::jsonb THEN
    v_raw := v_extra->'zaloShareRepeatAfterMinutes';
    v_minutes := CASE
      WHEN jsonb_typeof(v_raw) = 'number' AND (v_raw #>> '{}') ~ '^\d+$' THEN (v_raw #>> '{}')::integer
      WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^\d{1,4}$' THEN btrim(v_raw #>> '{}')::integer END;
    IF v_minutes BETWEEN 5 AND 1439 THEN
      v_next := v_now + make_interval(mins => v_minutes);
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         OR (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> v_vn THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_repeat_next_day', NULL);
      END IF;
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_repeat_after_cutoff', NULL);
      END IF;
      v_mode := 'repeat_scheduled';
      v_suffix := 'ở lượt gửi lặp kế tiếp';
    END IF;
  END IF;

  IF v_mode IS NULL THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed', NULL);
  END IF;

  -- 6. Hẹn lượt kế tiếp (rescheduleCompletedCampaignPass).
  IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
              WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                AND (d.schedule IS NULL OR d.schedule <= v_now)) THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = 'Còn data đã đến lịch, chiến dịch sẽ tiếp tục xử lý.', updated_at = v_now
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'due_pending', 'campaignStatus', 'chờ xử lý');
  END IF;
  SELECT count(*), count(*) FILTER (WHERE d.status <> 'tạm dừng') INTO v_total, v_resettable
    FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false;
  IF v_resettable = 0 THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_rerun_data', jsonb_build_object('suffix', v_suffix));
  END IF;
  UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
   WHERE campaign_id = c.id AND coalesce(is_delete, false) = false AND status <> 'tạm dừng';
  UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
    || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END;
END $f$;

CREATE FUNCTION public.aka_agent_engine_sms_push_v1(p_target_run_id bigint, p_lease_token uuid, p_payload jsonb DEFAULT '{}'::jsonb)
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
   WHERE x ~ '^[0-9]+(\.[0-9]+)?$' AND x::numeric > 0;

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
           AND (coalesce(x.extra_settings->>'internalSmsSourceCampaignId', '') !~ '^[0-9]+(\.[0-9]+)?$'
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
END $f$;

DO $grants$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb) FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON FUNCTION public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb) FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON FUNCTION public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb) FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb) TO service_role'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb) TO aka_agent_chat_api'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb) TO aka_agent_desktop'; END IF;
END $grants$;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '48625d957157f8392c966c153016df41' THEN RAISE EXCEPTION 'V506 postflight: finish_campaign_v2 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '13bd2b9aa97c686cf2e31521db776b0f' THEN RAISE EXCEPTION 'V506 postflight: sms_push_v1 %', v_md5; END IF;
  IF has_function_privilege('anon', 'public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V506 postflight: quyền hàm mới quá rộng';
  END IF;
END $post$;

COMMIT;

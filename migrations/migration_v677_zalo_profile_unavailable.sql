-- V677 (27/11/2026): mã EXC06 "Không đọc được hồ sơ Zalo của người nhận" (err_engine_zalo_profile_unavailable) cho tín hiệu engine 'profile_unavailable' của lõi.
-- Chỉ dữ liệu: 1 dòng auto_error, dòng auto_outcome_policies chép từ err_engine_send_exclusion_unknown (EXC02) đổi câu và thêm cộng chuỗi lỗi, 4 data liền thì
-- tạm dừng chiến dịch (anh chốt 27/11/2026), 1 luật auto_outcome_signal_rules. Không thay hàm nào nên PostgREST không nạp lại schema. Sinh bằng: node scripts/build-v677-sql.cjs
-- Kiểm: mục 8 của scripts/campaign-outcome-engine-v581-smoke.cjs   Gỡ: migrations/rollback_v677_zalo_profile_unavailable.sql
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
DECLARE n integer;
BEGIN
  -- Hai IF lồng: một biểu thức AND vẫn phân tích bảng sổ cả khi to_regclass trả NULL (DB không có sổ).
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration\_v677\_%') THEN
      RAISE EXCEPTION 'V677 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE (error_code = 'err_engine_zalo_profile_unavailable' OR public_code = 'EXC06') AND NOT is_delete) THEN
    RAISE EXCEPTION 'Đã có mã err_engine_zalo_profile_unavailable / EXC06, dừng';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_engine_zalo_profile_unavailable' AND NOT is_delete)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE platform = 'zalo' AND signal_kind = 'engine' AND pattern = 'profile_unavailable') THEN
    RAISE EXCEPTION 'Đã có chính sách hoặc luật cho mã mới, dừng';
  END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE p.error_code = 'err_engine_send_exclusion_unknown' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL OR p.action_code LIKE 'zalo\_%');
  IF n < 1 THEN RAISE EXCEPTION 'Không thấy dòng chính sách của err_engine_send_exclusion_unknown để chép'; END IF;
END $pre$;

CREATE TEMP TABLE v677_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_engine_zalo_profile_unavailable', 'Không đọc được hồ sơ Zalo của người nhận', 'V677 (engine v2): chiến dịch theo UID cần Zalo global ID để kiểm loại trừ gửi mà đọc hồ sơ Zalo của người nhận không ra', NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}',
  true, false, 'EXC06', (SELECT error_class FROM public.auto_error WHERE error_code = 'err_engine_send_exclusion_unknown'), 'Chưa đọc được hồ sơ Zalo của người nhận nên chưa kiểm tra được điều kiện loại trừ gửi', NULL)
ON CONFLICT (error_code) DO UPDATE SET is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  error_name = EXCLUDED.error_name, error_desc = EXCLUDED.error_desc, customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help
  WHERE public.auto_error.error_type = 'engine v2';

INSERT INTO public.auto_outcome_policies (error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode, detail_status_id, sub_status_id,
  log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps,
  lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes,
  account_effect, login_effect, description, source)
SELECT 'err_engine_zalo_profile_unavailable', p.error_class, p.status_id, p.action_code, p.campaign_action_id, p.runtime_target, p.detail_mode, p.detail_status_id, p.sub_status_id,
       'Chưa đọc được hồ sơ Zalo của người nhận nên chưa kiểm tra được điều kiện loại trừ gửi', 'Chưa đọc được hồ sơ Zalo của người nhận nên chưa kiểm tra được điều kiện loại trừ gửi',
       p.quota_effect, 'increment', 4, p.target_effect, p.requeue_after_minutes, p.remaining_steps,
       p.lock_action_codes, p.lock_mode, p.lock_minutes, p.lock_days, p.lock_time, p.run_effect, p.pace_mode, p.pace_seconds, 'pause',
       p.campaign_hold_minutes, p.account_effect, p.login_effect,
       '[V677] Chép từ err_engine_send_exclusion_unknown (id ' || p.id || '): đọc hồ sơ Zalo không ra khi cần Global ID để kiểm loại trừ. Như EXC02 nhưng cộng chuỗi, 4 data liền thì tạm dừng chiến dịch (anh chốt 27/11/2026).', 'v677'
  FROM public.auto_outcome_policies p WHERE p.error_code = 'err_engine_send_exclusion_unknown' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL OR p.action_code LIKE 'zalo\_%');

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('zalo', NULL, NULL, 'engine', 'profile_unavailable', 10, 'err_engine_zalo_profile_unavailable', 'v677',
   '[V677] Lõi: chiến dịch theo UID cần Global ID để kiểm loại trừ gửi mà đọc hồ sơ Zalo của người nhận không ra.');

DO $post$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a(code), (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p)
   WHERE (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, '{"kind": "engine", "code": "profile_unavailable"}'::jsonb) cs)
         IS DISTINCT FROM 'err_engine_zalo_profile_unavailable';
  IF n > 0 THEN RAISE EXCEPTION 'Tín hiệu profile_unavailable: % cặp (thao tác, pha) không ra err_engine_zalo_profile_unavailable', n; END IF;
  SELECT count(*) INTO n FROM (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a(code), (VALUES ('desktop'), ('fly'), ('server')) rt(t), (VALUES ('before_send'), ('after_send')) ph(p)
   WHERE (public.aka_agent_engine_resolve_policy('err_engine_zalo_profile_unavailable', NULL, a.code, NULL, rt.t, ph.p) - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template' - 'target_streak_effect' - 'streak_threshold' - 'campaign_effect')
         IS DISTINCT FROM (public.aka_agent_engine_resolve_policy('err_engine_send_exclusion_unknown', NULL, a.code, NULL, rt.t, ph.p) - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template' - 'target_streak_effect' - 'streak_threshold' - 'campaign_effect');
  IF n > 0 THEN RAISE EXCEPTION '% cặp (thao tác, nơi chạy, pha) có chính sách khác err_engine_send_exclusion_unknown ngoài câu và phần đã chốt', n; END IF;
  -- Lõi chỉ phát tín hiệu ở bước nhắn tin (gắn tag / đổi tên có dòng riêng của bước phụ, không cộng chuỗi).
  SELECT count(*) INTO n FROM unnest(ARRAY['zalo_message_stranger', 'zalo_message_friend']) a(code), (VALUES ('desktop'), ('fly'), ('server')) rt(t), (VALUES ('before_send'), ('after_send')) ph(p),
       LATERAL public.aka_agent_engine_resolve_policy('err_engine_zalo_profile_unavailable', NULL, a.code, NULL, rt.t, ph.p) r
   WHERE r ->> 'target_streak_effect' IS DISTINCT FROM 'increment' OR r ->> 'streak_threshold' IS DISTINCT FROM '4'
      OR r ->> 'campaign_effect' IS DISTINCT FROM 'pause' OR r ->> 'target_effect' IS DISTINCT FROM 'hold';
  IF n > 0 THEN RAISE EXCEPTION 'Bước nhắn tin: % cặp chưa cộng chuỗi / tạm dừng sau 4 data / giữ data', n; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_engine_policy_lint l
   WHERE NOT EXISTS (SELECT 1 FROM v677_lint b WHERE b.issue IS NOT DISTINCT FROM l.issue AND b.subject IS NOT DISTINCT FROM l.subject);
  IF n > 0 THEN RAISE EXCEPTION '% dòng lint mới', n; END IF;
END $post$;
COMMIT;

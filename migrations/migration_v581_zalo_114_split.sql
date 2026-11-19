-- V581: tách Z114 "Tham số không hợp lệ" thành 4 mã đã rõ nguyên nhân (19/11/2026, anh chốt; câu hiển thị anh duyệt từng câu).
-- SINH TỪ scripts/build-v581-sql.cjs, không sửa tay.
--
-- Chỉ dữ liệu của engine v2 (error_type 'engine v2', không có mã Zalo trong auto_error nên bộ chạy cũ không khớp):
--   * err_engine_zalo_tag_full (TAG01): Zalo trả 114 ở bước gắn tag. Chính sách = bản chép 114 × gắn tag (dòng lịch sử
--     "thất bại", không tính lượt, không cộng chuỗi, chạy tiếp). Có hiệu lực ngay khi apply.
--   * err_engine_zalo_target_is_self (DAT03): lõi nhận ra trước khi gọi Zalo. Chính sách = bản chép err_input_invalid (data "thất bại",
--     không tính lượt, không cộng chuỗi, chạy tiếp).
--   * err_engine_zalo_uid_is_phone (DAT02): lõi nhận ra trước khi gọi Zalo. Như err_input_invalid nhưng cộng chuỗi data lỗi,
--     4 data liền thì tạm dừng chiến dịch (khách đưa nhầm cả danh sách SĐT thì không bị đánh "thất bại" hết).
--   * err_engine_zalo_uid_other_account (DAT04): Zalo trả 114 và lõi tra thấy UID thuộc tài khoản khác. Data "thất bại",
--     không tính lượt, cộng chuỗi data lỗi, 4 data liền thì tạm dừng chiến dịch, bỏ các bước còn lại của data.
--   * 4 luật auto_outcome_signal_rules (source 'v581').
-- Ba mã sau chỉ phát khi lõi mới chạy; trước đó luật của chúng không khớp gì. 114 ở mọi bước khác giữ nguyên Z114.
-- Không DDL (bảng tạm chỉ trong giao dịch), không đổi hàm. Gỡ: rollback_v581_zalo_114_split.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE n integer; r record; v jsonb;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v581_%') THEN
      RAISE EXCEPTION 'V581 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ANY (ARRAY['err_engine_zalo_tag_full', 'err_engine_zalo_uid_is_phone', 'err_engine_zalo_target_is_self', 'err_engine_zalo_uid_other_account']) AND error_type IS DISTINCT FROM 'engine v2') THEN
    RAISE EXCEPTION 'V581: một mã mới đã có và không phải engine v2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE public_code = ANY (ARRAY['TAG01', 'DAT02', 'DAT03', 'DAT04'])
               AND error_code <> ALL (ARRAY['err_engine_zalo_tag_full', 'err_engine_zalo_uid_is_phone', 'err_engine_zalo_target_is_self', 'err_engine_zalo_uid_other_account']) AND NOT is_delete) THEN
    RAISE EXCEPTION 'V581: mã công khai TAG01 / DAT02 / DAT03 / DAT04 đã có mã khác dùng';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = ANY (ARRAY['err_engine_zalo_tag_full', 'err_engine_zalo_uid_is_phone', 'err_engine_zalo_target_is_self', 'err_engine_zalo_uid_other_account']) AND is_active AND NOT is_delete)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v581')
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE platform = 'zalo' AND is_active AND (
          (signal_kind = 'zalo_code' AND pattern = '114' AND action_code = 'zalo_tag_contact')
          OR (signal_kind = 'engine' AND pattern = ANY (ARRAY['uid_is_phone', 'target_is_self', 'uid_other_account'])))) THEN
    RAISE EXCEPTION 'V581: đã có chính sách hoặc luật của các mã mới';
  END IF;
  -- Bản chép phải đúng như đã đọc 19/11/2026 (seed V495 + V500 Q2/Q3).
  v := public.aka_agent_engine_resolve_policy('err_zalo_invalid_param', NULL, 'zalo_tag_contact', NULL, 'fly', 'after_send');
  IF v->>'detail_mode' IS DISTINCT FROM 'write' OR v->>'quota_effect' IS DISTINCT FROM 'no_count' OR v->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v->>'target_effect' IS DISTINCT FROM 'complete' OR v->>'remaining_steps' IS DISTINCT FROM 'continue' OR v->>'run_effect' IS DISTINCT FROM 'continue'
     OR v->>'campaign_effect' IS DISTINCT FROM 'none' OR v->>'log_template' IS DISTINCT FROM 'Tham số không hợp lệ' THEN
    RAISE EXCEPTION 'V581: chính sách 114 × gắn tag khác bản đã đọc: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE p.error_code = 'err_zalo_invalid_param' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL OR p.action_code = 'zalo_tag_contact');
  IF n <> 2 THEN RAISE EXCEPTION 'V581: cần đúng 2 dòng chính sách của err_zalo_invalid_param cho gắn tag (thấy %)', n; END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE p.error_code = 'err_zalo_invalid_param' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL);
  IF n <> 1 THEN RAISE EXCEPTION 'V581: cần đúng 1 dòng theo mã của err_zalo_invalid_param (thấy %)', n; END IF;
  v := public.aka_agent_engine_resolve_policy('err_input_invalid', NULL, 'zalo_message_stranger', NULL, 'desktop', 'before_send');
  IF v->>'detail_mode' IS DISTINCT FROM 'write' OR v->>'quota_effect' IS DISTINCT FROM 'no_count' OR v->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v->>'target_effect' IS DISTINCT FROM 'complete' OR v->>'run_effect' IS DISTINCT FROM 'continue' OR v->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v->>'log_template' IS DISTINCT FROM 'Dữ liệu đầu vào không hợp lệ' THEN
    RAISE EXCEPTION 'V581: chính sách err_input_invalid × nhắn người lạ khác bản đã đọc: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE p.error_code = 'err_input_invalid' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL);
  IF n <> 1 THEN RAISE EXCEPTION 'V581: cần đúng 1 dòng theo mã của err_input_invalid (thấy %)', n; END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE p.error_code = 'err_input_invalid' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code = ANY (ARRAY['zalo_message_stranger', 'zalo_message_friend']));
  IF n <> 2 THEN RAISE EXCEPTION 'V581: cần đúng 2 dòng nhắn tin của err_input_invalid (thấy %)', n; END IF;
  -- Luật 114 chung (mọi thao tác) phải còn: 114 ở bước khác vẫn ra Z114.
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE platform = 'zalo' AND signal_kind = 'zalo_code' AND pattern = '114'
                   AND action_code IS NULL AND error_code = 'err_zalo_invalid_param' AND is_active) THEN
    RAISE EXCEPTION 'V581: thiếu luật 114 chung của err_zalo_invalid_param';
  END IF;
END $pre$;

CREATE TEMP TABLE v581_before_policy ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target, ph.p AS phase,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, ph.p) - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t)
 CROSS JOIN (VALUES ('before_send'), ('after_send')) ph(p);
CREATE TEMP TABLE v581_before_class ON COMMIT DROP AS
SELECT s.kind, s.code, a.code AS action_code, ph.p AS phase,
       (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, jsonb_build_object('kind', s.kind, 'code', s.code)) cs) AS error_code
  FROM (SELECT DISTINCT r.signal_kind AS kind, r.pattern AS code FROM public.auto_outcome_signal_rules r
         WHERE r.platform = 'zalo' AND r.signal_kind IN ('zalo_code', 'engine') AND r.pattern <> '*'
        UNION SELECT 'zalo_code', '114'
        UNION SELECT 'engine', x FROM unnest(ARRAY['uid_is_phone', 'target_is_self', 'uid_other_account']) x) s
 CROSS JOIN (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE v581_before_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_engine_zalo_tag_full', 'Tag Zalo đã đầy (Zalo trả 114 khi gắn tag)', 'V581 (engine v2): Zalo trả 114 ở bước gắn tag khi tổng số hội thoại đã gắn tag của tài khoản chạm khoảng 5.850', NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}',
  true, false, 'TAG01', 'target_permanent', 'Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm', 'Gỡ bớt người khỏi các tag trong Zalo rồi chạy tiếp chiến dịch.')
ON CONFLICT (error_code) DO UPDATE SET is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  error_name = EXCLUDED.error_name, error_desc = EXCLUDED.error_desc, customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help
  WHERE public.auto_error.error_type = 'engine v2';

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_engine_zalo_uid_is_phone', 'Cột UID chứa số điện thoại', 'V581 (engine v2): lõi nhận ra UID là số điện thoại trước khi gọi Zalo', NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}',
  true, false, 'DAT02', 'target_permanent', 'Data là số điện thoại, không phải UID Zalo', 'Dùng loại chiến dịch Nhắn tin theo SĐT cho danh sách này.')
ON CONFLICT (error_code) DO UPDATE SET is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  error_name = EXCLUDED.error_name, error_desc = EXCLUDED.error_desc, customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help
  WHERE public.auto_error.error_type = 'engine v2';

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_engine_zalo_target_is_self', 'Data là chính tài khoản đang gửi', 'V581 (engine v2): lõi nhận ra UID của data là UID của chính tài khoản gửi trước khi gọi Zalo', NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}',
  true, false, 'DAT03', 'target_permanent', 'Không gửi cho chính tài khoản đang gửi', NULL)
ON CONFLICT (error_code) DO UPDATE SET is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  error_name = EXCLUDED.error_name, error_desc = EXCLUDED.error_desc, customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help
  WHERE public.auto_error.error_type = 'engine v2';

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_engine_zalo_uid_other_account', 'UID được quét bằng tài khoản Zalo khác', 'V581 (engine v2): Zalo trả 114 và UID nằm trong danh bạ của tài khoản khác cùng tổ chức, không có ở tài khoản đang gửi', NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}',
  true, false, 'DAT04', 'target_permanent', 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được', 'Dùng tài khoản đã quét danh sách để chạy, hoặc quét lại bằng tài khoản này.')
ON CONFLICT (error_code) DO UPDATE SET is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  error_name = EXCLUDED.error_name, error_desc = EXCLUDED.error_desc, customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help
  WHERE public.auto_error.error_type = 'engine v2';

-- TAG01: chép dòng theo mã và dòng gắn tag của 114.
INSERT INTO public.auto_outcome_policies (error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode, detail_status_id, sub_status_id,
  log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps,
  lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes,
  account_effect, login_effect, description, source)
SELECT 'err_engine_zalo_tag_full', p.error_class, p.status_id, p.action_code, p.campaign_action_id, p.runtime_target, p.detail_mode, p.detail_status_id, p.sub_status_id,
       CASE WHEN p.action_code IS NULL THEN 'Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm' ELSE p.log_template END,
       CASE WHEN p.action_code IS NULL THEN 'Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm' ELSE p.campaign_note_template END,
       p.quota_effect, p.target_streak_effect, p.streak_threshold, p.target_effect, p.requeue_after_minutes, p.remaining_steps,
       p.lock_action_codes, p.lock_mode, p.lock_minutes, p.lock_days, p.lock_time, p.run_effect, p.pace_mode, p.pace_seconds, p.campaign_effect,
       p.campaign_hold_minutes, p.account_effect, p.login_effect,
       '[V581] Chép từ err_zalo_invalid_param (id ' || p.id || '): 114 ở bước gắn tag là tag đã đầy (đo 19/11/2026), hành vi giữ như 114.', 'v581'
  FROM public.auto_outcome_policies p WHERE p.error_code = 'err_zalo_invalid_param' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL OR p.action_code = 'zalo_tag_contact');

-- DAT02, DAT03: chép mọi dòng của err_input_invalid (dòng theo mã + dòng theo thao tác).
INSERT INTO public.auto_outcome_policies (error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode, detail_status_id, sub_status_id,
  log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps,
  lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes,
  account_effect, login_effect, description, source)
SELECT 'err_engine_zalo_uid_is_phone', p.error_class, p.status_id, p.action_code, p.campaign_action_id, p.runtime_target, p.detail_mode, p.detail_status_id, p.sub_status_id,
       CASE WHEN p.action_code IS NULL THEN 'Data là số điện thoại, không phải UID Zalo' ELSE p.log_template END,
       CASE WHEN p.action_code IS NULL THEN 'Data là số điện thoại, không phải UID Zalo' ELSE p.campaign_note_template END,
       p.quota_effect, p.target_streak_effect, p.streak_threshold, p.target_effect, p.requeue_after_minutes, p.remaining_steps,
       p.lock_action_codes, p.lock_mode, p.lock_minutes, p.lock_days, p.lock_time, p.run_effect, p.pace_mode, p.pace_seconds, p.campaign_effect,
       p.campaign_hold_minutes, p.account_effect, p.login_effect,
       '[V581] Chép từ err_input_invalid (id ' || p.id || '): UID là số điện thoại, như dữ liệu đầu vào không hợp lệ; dòng nhắn tin thêm chuỗi lỗi và ngưỡng tạm dừng.', 'v581'
  FROM public.auto_outcome_policies p WHERE p.error_code = 'err_input_invalid' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (true);
-- DAT02 ở bước nhắn tin: cộng chuỗi data lỗi, 4 data liền thì tạm dừng chiến dịch (anh chốt 19/11/2026).
UPDATE public.auto_outcome_policies
   SET target_streak_effect = 'increment', streak_threshold = 4, campaign_effect = 'pause',
       description = description || ' Anh chốt 19/11/2026: 4 data liền thì tạm dừng chiến dịch.'
 WHERE error_code = 'err_engine_zalo_uid_is_phone' AND source = 'v581' AND action_code = ANY (ARRAY['zalo_message_stranger', 'zalo_message_friend']);
INSERT INTO public.auto_outcome_policies (error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode, detail_status_id, sub_status_id,
  log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps,
  lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes,
  account_effect, login_effect, description, source)
SELECT 'err_engine_zalo_target_is_self', p.error_class, p.status_id, p.action_code, p.campaign_action_id, p.runtime_target, p.detail_mode, p.detail_status_id, p.sub_status_id,
       CASE WHEN p.action_code IS NULL THEN 'Không gửi cho chính tài khoản đang gửi' ELSE p.log_template END,
       CASE WHEN p.action_code IS NULL THEN 'Không gửi cho chính tài khoản đang gửi' ELSE p.campaign_note_template END,
       p.quota_effect, p.target_streak_effect, p.streak_threshold, p.target_effect, p.requeue_after_minutes, p.remaining_steps,
       p.lock_action_codes, p.lock_mode, p.lock_minutes, p.lock_days, p.lock_time, p.run_effect, p.pace_mode, p.pace_seconds, p.campaign_effect,
       p.campaign_hold_minutes, p.account_effect, p.login_effect,
       '[V581] Chép từ err_input_invalid (id ' || p.id || '): data là chính tài khoản đang gửi, hành vi giữ như dữ liệu đầu vào không hợp lệ.', 'v581'
  FROM public.auto_outcome_policies p WHERE p.error_code = 'err_input_invalid' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (true);

-- DAT04: dòng theo mã chép từ 114; dòng theo thao tác: không tính lượt, cộng chuỗi, 4 data liền thì tạm dừng chiến dịch, bỏ bước còn lại.
INSERT INTO public.auto_outcome_policies (error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode, detail_status_id, sub_status_id,
  log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps,
  lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes,
  account_effect, login_effect, description, source)
SELECT 'err_engine_zalo_uid_other_account', p.error_class, p.status_id, p.action_code, p.campaign_action_id, p.runtime_target, p.detail_mode, p.detail_status_id, p.sub_status_id,
       CASE WHEN p.action_code IS NULL THEN 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được' ELSE p.log_template END,
       CASE WHEN p.action_code IS NULL THEN 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được' ELSE p.campaign_note_template END,
       p.quota_effect, p.target_streak_effect, p.streak_threshold, p.target_effect, p.requeue_after_minutes, p.remaining_steps,
       p.lock_action_codes, p.lock_mode, p.lock_minutes, p.lock_days, p.lock_time, p.run_effect, p.pace_mode, p.pace_seconds, p.campaign_effect,
       p.campaign_hold_minutes, p.account_effect, p.login_effect,
       '[V581] Chép từ err_zalo_invalid_param (id ' || p.id || '): UID thuộc tài khoản Zalo khác; dòng theo thao tác quyết định tính lượt / chuỗi.', 'v581'
  FROM public.auto_outcome_policies p WHERE p.error_code = 'err_zalo_invalid_param' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL);
INSERT INTO public.auto_outcome_policies (error_code, action_code, quota_effect, target_streak_effect, streak_threshold, remaining_steps, campaign_effect,
  description, source)
SELECT 'err_engine_zalo_uid_other_account', a.code, 'no_count', 'increment', 4, 'skip', 'pause',
       '[V581] Anh chốt 19/11/2026: data "thất bại", không tính lượt, 4 data liền thì tạm dừng chiến dịch.', 'v581'
  FROM unnest(ARRAY['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend']) a(code);

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('zalo', 'zalo_tag_contact', NULL, 'zalo_code', '114', 10, 'err_engine_zalo_tag_full', 'v581', '[V581] Gắn tag gặp 114: tag của tài khoản đã đầy (13/13 tài khoản từng bị đều ở khoảng 5.820–5.890 hội thoại đã gắn tag, đo 19/11/2026).'),
  ('zalo', NULL, NULL, 'engine', 'uid_is_phone', 10, 'err_engine_zalo_uid_is_phone', 'v581', '[V581] Lõi: UID của data là số điện thoại, không gọi Zalo.'),
  ('zalo', NULL, NULL, 'engine', 'target_is_self', 10, 'err_engine_zalo_target_is_self', 'v581', '[V581] Lõi: UID của data là UID của chính tài khoản gửi, không gọi Zalo.'),
  ('zalo', NULL, NULL, 'engine', 'uid_other_account', 10, 'err_engine_zalo_uid_other_account', 'v581', '[V581] Lõi: Zalo trả 114 và UID thuộc danh bạ của tài khoản khác cùng tổ chức.');

DO $post$
DECLARE n integer; t text; a text; ph text; v_new jsonb; v_base jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.auto_error WHERE error_code = ANY (ARRAY['err_engine_zalo_tag_full', 'err_engine_zalo_uid_is_phone', 'err_engine_zalo_target_is_self', 'err_engine_zalo_uid_other_account']) AND is_active AND NOT is_delete AND error_type = 'engine v2';
  IF n <> 4 THEN RAISE EXCEPTION 'V581 postflight: cần 4 mã mới (thấy %)', n; END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_signal_rules WHERE source = 'v581' AND is_active;
  IF n <> 4 THEN RAISE EXCEPTION 'V581 postflight: cần 4 luật mới (thấy %)', n; END IF;

  FOREACH ph IN ARRAY ARRAY['before_send', 'in_flight', 'after_send'] LOOP
    -- TAG01: 114 × gắn tag ở mọi pha; 114 ở thao tác khác vẫn là Z114.
    IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_tag_contact', ph, '{"kind": "zalo_code", "code": "114"}'::jsonb) cs)
       IS DISTINCT FROM 'err_engine_zalo_tag_full' THEN
      RAISE EXCEPTION 'V581 postflight: 114 × gắn tag (%) chưa ra err_engine_zalo_tag_full', ph;
    END IF;
    FOREACH a IN ARRAY ARRAY['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend', 'zalo_change_alias', 'zalo_message_group'] LOOP
      IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, ph, '{"kind": "zalo_code", "code": "114"}'::jsonb) cs)
         IS DISTINCT FROM 'err_zalo_invalid_param' THEN
        RAISE EXCEPTION 'V581 postflight: 114 × % (%) không còn là err_zalo_invalid_param', a, ph;
      END IF;
      IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, ph, '{"kind": "engine", "code": "uid_is_phone"}'::jsonb) cs)
           IS DISTINCT FROM 'err_engine_zalo_uid_is_phone'
         OR (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, ph, '{"kind": "engine", "code": "target_is_self"}'::jsonb) cs)
           IS DISTINCT FROM 'err_engine_zalo_target_is_self'
         OR (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, ph, '{"kind": "engine", "code": "uid_other_account"}'::jsonb) cs)
           IS DISTINCT FROM 'err_engine_zalo_uid_other_account' THEN
        RAISE EXCEPTION 'V581 postflight: tín hiệu engine mới × % (%) chưa ra đúng mã', a, ph;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['desktop', 'fly'] LOOP
    -- TAG01 = 114 × gắn tag, chỉ khác câu.
    v_new := public.aka_agent_engine_resolve_policy('err_engine_zalo_tag_full', NULL, 'zalo_tag_contact', NULL, t, 'after_send');
    v_base := public.aka_agent_engine_resolve_policy('err_zalo_invalid_param', NULL, 'zalo_tag_contact', NULL, t, 'after_send');
    IF (v_new - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template') IS DISTINCT FROM
       (v_base - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template') THEN
      RAISE EXCEPTION 'V581 postflight: chính sách TAG01 (%) khác 114 × gắn tag: % / %', t, v_new, v_base;
    END IF;
    IF v_new->>'log_template' IS DISTINCT FROM 'Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm' OR v_new->>'campaign_note_template' IS DISTINCT FROM 'Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm' THEN
      RAISE EXCEPTION 'V581 postflight: câu TAG01 (%) chưa đúng: %', t, v_new;
    END IF;
    FOREACH a IN ARRAY ARRAY['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend', 'zalo_change_alias', 'zalo_tag_contact'] LOOP
      -- DAT03 = err_input_invalid, chỉ khác câu (pha trước khi gửi). DAT02 = err_input_invalid trừ chuỗi lỗi / ngưỡng / tạm dừng ở bước nhắn tin.
      v_base := public.aka_agent_engine_resolve_policy('err_input_invalid', NULL, a, NULL, t, 'before_send');
      v_new := public.aka_agent_engine_resolve_policy('err_engine_zalo_uid_is_phone', NULL, a, NULL, t, 'before_send');
      IF (v_new - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template' - 'target_streak_effect' - 'streak_threshold' - 'campaign_effect')
         IS DISTINCT FROM
         (v_base - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template' - 'target_streak_effect' - 'streak_threshold' - 'campaign_effect')
         OR v_new->>'log_template' IS DISTINCT FROM 'Data là số điện thoại, không phải UID Zalo' THEN
        RAISE EXCEPTION 'V581 postflight: chính sách DAT02 × % (%) lệch err_input_invalid ngoài phần đã chốt: % / %', a, t, v_new, v_base;
      END IF;
      IF a = ANY (ARRAY['zalo_message_stranger', 'zalo_message_friend']) THEN
        IF v_new->>'target_streak_effect' IS DISTINCT FROM 'increment' OR (v_new->>'streak_threshold')::integer IS DISTINCT FROM 4
           OR v_new->>'campaign_effect' IS DISTINCT FROM 'pause' OR v_new->>'quota_effect' IS DISTINCT FROM 'no_count'
           OR v_new->>'target_effect' IS DISTINCT FROM 'complete' OR v_new->>'detail_mode' IS DISTINCT FROM 'write' THEN
          RAISE EXCEPTION 'V581 postflight: chính sách DAT02 × % (%) chưa đúng: %', a, t, v_new;
        END IF;
      ELSIF v_new->>'target_streak_effect' IS DISTINCT FROM v_base->>'target_streak_effect' OR v_new->>'campaign_effect' IS DISTINCT FROM v_base->>'campaign_effect'
            OR v_new->>'streak_threshold' IS DISTINCT FROM v_base->>'streak_threshold' THEN
        RAISE EXCEPTION 'V581 postflight: chính sách DAT02 × % (%) không được đổi chuỗi lỗi: %', a, t, v_new;
      END IF;
      v_new := public.aka_agent_engine_resolve_policy('err_engine_zalo_target_is_self', NULL, a, NULL, t, 'before_send');
      IF (v_new - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template') IS DISTINCT FROM
         (v_base - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template')
         OR v_new->>'log_template' IS DISTINCT FROM 'Không gửi cho chính tài khoản đang gửi' THEN
        RAISE EXCEPTION 'V581 postflight: chính sách DAT03 × % (%) khác err_input_invalid: % / %', a, t, v_new, v_base;
      END IF;
    END LOOP;
    -- DAT04: như 114 × thao tác đó, trừ chuỗi lỗi / ngưỡng / tạm dừng / bỏ bước còn lại và câu.
    FOREACH a IN ARRAY ARRAY['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend'] LOOP
      v_new := public.aka_agent_engine_resolve_policy('err_engine_zalo_uid_other_account', NULL, a, NULL, t, 'after_send');
      v_base := public.aka_agent_engine_resolve_policy('err_zalo_invalid_param', NULL, a, NULL, t, 'after_send');
      IF (v_new - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template' - 'target_streak_effect' - 'streak_threshold' - 'remaining_steps' - 'campaign_effect')
         IS DISTINCT FROM
         (v_base - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template' - 'target_streak_effect' - 'streak_threshold' - 'remaining_steps' - 'campaign_effect') THEN
        RAISE EXCEPTION 'V581 postflight: chính sách DAT04 × % (%) lệch 114 ngoài phần đã chốt: % / %', a, t, v_new, v_base;
      END IF;
      IF v_new->>'quota_effect' IS DISTINCT FROM 'no_count' OR v_new->>'target_streak_effect' IS DISTINCT FROM 'increment'
         OR (v_new->>'streak_threshold')::integer IS DISTINCT FROM 4 OR v_new->>'campaign_effect' IS DISTINCT FROM 'pause'
         OR v_new->>'remaining_steps' IS DISTINCT FROM 'skip' OR v_new->>'target_effect' IS DISTINCT FROM 'complete'
         OR v_new->>'detail_mode' IS DISTINCT FROM 'write' OR v_new->>'log_template' IS DISTINCT FROM 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được' THEN
        RAISE EXCEPTION 'V581 postflight: chính sách DAT04 × % (%) chưa đúng: %', a, t, v_new;
      END IF;
    END LOOP;
  END LOOP;
  SELECT count(*) INTO n FROM v581_before_policy b
   WHERE (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, b.phase) - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION 'V581 postflight: % cặp (mã, thao tác) có sẵn bị đổi chính sách', n; END IF;
  SELECT count(*) INTO n FROM v581_before_class b
   WHERE NOT ((b.kind = 'zalo_code' AND b.code = '114' AND b.action_code = 'zalo_tag_contact')
     OR (b.kind = 'engine' AND b.code = ANY (ARRAY['uid_is_phone', 'target_is_self', 'uid_other_account'])))
     AND (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', b.action_code, b.phase, jsonb_build_object('kind', b.kind, 'code', b.code)) cs)
         IS DISTINCT FROM b.error_code;
  IF n > 0 THEN RAISE EXCEPTION 'V581 postflight: % cặp (tín hiệu, thao tác, pha) khác bị đổi phân loại', n; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_engine_policy_lint l
   WHERE NOT EXISTS (SELECT 1 FROM v581_before_lint b WHERE b.issue IS NOT DISTINCT FROM l.issue AND b.subject IS NOT DISTINCT FROM l.subject);
  IF n > 0 THEN RAISE EXCEPTION 'V581 postflight: % dòng lint mới', n; END IF;
END $post$;

COMMIT;

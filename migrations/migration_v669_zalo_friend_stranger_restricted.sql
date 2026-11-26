-- V669: chiến dịch "Nhắn tin bạn bè" gửi cho cả người chưa là bạn bè (người được gắn tag, V660; anh chốt 26/11/2026 "Cách A":
-- chỉ cần gắn tag là gửi, không phân biệt bạn bè). Phương án: docs/ZALO_TAG_AUTO_SEND_PLAN.md mục 10.
--
-- Người chưa là bạn bè có thể gặp Zalo hạn chế nhắn người lạ (mã 120 / 802). Trước V669, trong chiến dịch nhắn tin bạn bè:
--   * engine v2: data về hàng đợi ngay, kết thúc lượt, 3 data liền thì tạm dừng chiến dịch (V500 Q4, chép từ nhắn người lạ);
--     Z802 kéo dài khoảng một tuần nên mỗi lần bấm Tiếp tục lại dừng, kể cả phần gửi cho bạn bè;
--   * bộ chạy cũ: không có chính sách cho cặp (120/802, zalo_message_friend) nên rơi vào err_zalo_api_business_failed (tính lượt,
--     cộng chuỗi, 4 data liền thì tạm dừng).
-- Sau V669:
--   * engine v2: hẹn riêng data đó chạy lại lúc mở khoá "Nhắn tin người lạ" của tài khoản (dòng chung của mã khoá như cũ: 120 tới
--     09:45 hôm sau, 802 tới 09:45 sau 2 ngày; giờ hẹn của data lấy theo giờ mở khoá, không theo requeue_after_minutes), không tính
--     lượt, không cộng chuỗi, không dừng chiến dịch, lượt chạy tiếp người khác. Câu cho khách ghi giờ gửi lại ({until}).
--   * bộ chạy cũ (không có hẹn giờ theo data): data "thất bại", không tính lượt, không cộng chuỗi, không khoá thao tác, chạy tiếp
--     (hai mã: err_zalo_message_friend_stranger_restricted cho 120, _802 cho 802).
-- Bạn bè thật không gặp 120 / 802 (3 ngày tới 26/11: 0 lần trên 22.000 lượt nhắn bạn bè của engine v2).
-- Chỉ dữ liệu (bảng tạm chỉ trong giao dịch), không đổi hàm. Gỡ: rollback_v669_zalo_friend_stranger_restricted.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE r public.auto_outcome_policies%ROWTYPE; n integer; c text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v669\_%') THEN
      RAISE EXCEPTION 'V669 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  FOREACH c IN ARRAY ARRAY['err_zalo_120_message_stranger', 'err_zalo_802_message_stranger'] LOOP
    SELECT count(*) INTO n FROM public.auto_outcome_policies WHERE error_code = c AND action_code = 'zalo_message_friend' AND status_id IS NULL
       AND error_class IS NULL AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;
    IF n <> 1 THEN RAISE EXCEPTION 'V669: cần đúng 1 dòng chính sách % × zalo_message_friend (thấy %)', c, n; END IF;
    SELECT * INTO r FROM public.auto_outcome_policies WHERE error_code = c AND action_code = 'zalo_message_friend' AND status_id IS NULL
       AND error_class IS NULL AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;
    IF r.target_streak_effect IS DISTINCT FROM 'increment' OR r.streak_threshold IS DISTINCT FROM 3
       OR r.campaign_effect IS DISTINCT FROM 'pause' OR r.target_effect IS DISTINCT FROM 'requeue'
       OR r.requeue_after_minutes IS NOT NULL OR r.quota_effect IS DISTINCT FROM 'no_count'
       OR r.remaining_steps IS DISTINCT FROM 'skip' OR r.run_effect IS NOT NULL
       OR r.log_template IS NOT NULL OR r.campaign_note_template IS NOT NULL OR r.source IS DISTINCT FROM 'v500_review' THEN
      RAISE EXCEPTION 'V669: dòng chính sách % × zalo_message_friend khác bản V500 (Q4), không tự đổi', c;
    END IF;
  END LOOP;
  -- Dòng tắt (bản gỡ V669 chỉ tắt, không xoá) thì bật lại ở dưới; dòng đang bật thì không tự đổi.
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN ('err_zalo_message_friend_stranger_restricted',
               'err_zalo_message_friend_stranger_restricted_802') AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'V669: auto_error err_zalo_message_friend_stranger_restricted(_802) đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE is_active AND NOT is_delete AND 'zalo_message_friend' = ANY (zalo_action_codes)
               AND zalo_error_codes && ARRAY['120', '802']) THEN
    RAISE EXCEPTION 'V669: bộ chạy cũ đã có chính sách cho 120/802 × zalo_message_friend';
  END IF;
END $pre$;

CREATE TEMP TABLE v669_before ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, 'after_send') - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t);

-- Engine v2 (chỉ dòng của thao tác nhắn tin bạn bè; dòng chung của mã và dòng nhắn người lạ giữ nguyên).
UPDATE public.auto_outcome_policies
   SET target_effect = 'requeue_after', requeue_after_minutes = 1440, target_streak_effect = 'ignore', streak_threshold = NULL,
       campaign_effect = 'none', run_effect = 'continue',
       log_template = 'Zalo đang hạn chế nhắn người lạ, sẽ gửi lại người này lúc {until}',
       campaign_note_template = 'Zalo đang hạn chế nhắn người lạ, sẽ gửi lại người này lúc {until}',
       description = '[Q4→V669] 120 khi nhắn tin bạn bè (người được gắn tag chưa là bạn bè): hẹn data tới lúc mở khoá nhắn người lạ (09:45 hôm sau), không dừng chiến dịch, chạy tiếp.'
 WHERE error_code = 'err_zalo_120_message_stranger' AND action_code = 'zalo_message_friend' AND status_id IS NULL AND error_class IS NULL
   AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;

UPDATE public.auto_outcome_policies
   SET target_effect = 'requeue_after', requeue_after_minutes = 2880, target_streak_effect = 'ignore', streak_threshold = NULL,
       campaign_effect = 'none', run_effect = 'continue',
       log_template = 'Zalo đang hạn chế nhắn người lạ, sẽ gửi lại người này lúc {until}',
       campaign_note_template = 'Zalo đang hạn chế nhắn người lạ, sẽ gửi lại người này lúc {until}',
       description = '[Q4→V669] 802 khi nhắn tin bạn bè (người được gắn tag chưa là bạn bè): hẹn data tới lúc mở khoá nhắn người lạ (09:45 sau 2 ngày), không dừng chiến dịch, chạy tiếp.'
 WHERE error_code = 'err_zalo_802_message_stranger' AND action_code = 'zalo_message_friend' AND status_id IS NULL AND error_class IS NULL
   AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;

-- Bộ chạy cũ (đọc auto_error theo mã Zalo + thao tác; engine v2 không đọc dòng này). Không khoá thao tác nào: bộ cũ gặp dòng có khoá thì in
-- "⏸ Dừng chiến dịch" và nghỉ một lượt kể cả khi khoá thao tác khác (applyZaloPolicySideEffects → stopAfterTarget), mỗi lần 120 / 802 một
-- lần như vậy; chiến dịch nhắn người lạ của cùng tài khoản tự khoá khi chính nó gặp 120 / 802 (dòng 42 / 44).
INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, time_disable_actions, disable_action_mode, disable_action_days, disable_action_time,
  counts_toward_limit, counts_toward_bad_target, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help, detail_status)
VALUES
  ('external zalo', 'err_zalo_message_friend_stranger_restricted', 'Zalo hạn chế nhắn người lạ khi nhắn tin bạn bè (120)',
   'V669: chiến dịch nhắn tin bạn bè gửi cho người chưa là bạn bè (người được gắn tag) mà Zalo đang hạn chế nhắn người lạ (120).',
   'Zalo đang hạn chế nhắn người lạ nên chưa gửi được cho người này', 'Zalo đang hạn chế nhắn người lạ nên chưa gửi được cho người này',
   '{}', NULL, 'fixed_minutes', NULL, NULL, false, false, ARRAY['120'], ARRAY['zalo_message_friend'],
   true, false, 'Z120', 'account_restricted', 'Zalo đang hạn chế nhắn người lạ nên chưa gửi được cho người này', NULL, 'thất bại'),
  ('external zalo', 'err_zalo_message_friend_stranger_restricted_802', 'Zalo hạn chế nhắn người lạ khi nhắn tin bạn bè (802)',
   'V669: chiến dịch nhắn tin bạn bè gửi cho người chưa là bạn bè (người được gắn tag) mà Zalo đang hạn chế nhắn người lạ (802).',
   'Zalo đang hạn chế nhắn người lạ nên chưa gửi được cho người này', 'Zalo đang hạn chế nhắn người lạ nên chưa gửi được cho người này',
   '{}', NULL, 'fixed_minutes', NULL, NULL, false, false, ARRAY['802'], ARRAY['zalo_message_friend'],
   true, false, 'Z802', 'account_restricted', 'Zalo đang hạn chế nhắn người lạ nên chưa gửi được cho người này', NULL, 'thất bại')
ON CONFLICT (error_code) DO UPDATE SET error_type = EXCLUDED.error_type, error_name = EXCLUDED.error_name, error_desc = EXCLUDED.error_desc,
  noti_running_process = EXCLUDED.noti_running_process, noti_campaign = EXCLUDED.noti_campaign, disable_action_codes = EXCLUDED.disable_action_codes,
  time_disable_actions = EXCLUDED.time_disable_actions, disable_action_mode = EXCLUDED.disable_action_mode,
  disable_action_days = EXCLUDED.disable_action_days, disable_action_time = EXCLUDED.disable_action_time,
  counts_toward_limit = EXCLUDED.counts_toward_limit, counts_toward_bad_target = EXCLUDED.counts_toward_bad_target,
  zalo_error_codes = EXCLUDED.zalo_error_codes, zalo_action_codes = EXCLUDED.zalo_action_codes,
  is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help, detail_status = EXCLUDED.detail_status, updated_at = now();

DO $post$
DECLARE p jsonb; n integer; t text; c text; m integer;
BEGIN
  FOREACH t IN ARRAY ARRAY['desktop', 'fly'] LOOP
    FOREACH c IN ARRAY ARRAY['err_zalo_120_message_stranger', 'err_zalo_802_message_stranger'] LOOP
      m := CASE c WHEN 'err_zalo_120_message_stranger' THEN 1440 ELSE 2880 END;
      p := public.aka_agent_engine_resolve_policy(c, NULL, 'zalo_message_friend', NULL, t, 'after_send');
      IF p->>'target_effect' IS DISTINCT FROM 'requeue_after' OR (p->>'requeue_after_minutes')::int IS DISTINCT FROM m
         OR p->>'target_streak_effect' IS DISTINCT FROM 'ignore' OR p->>'campaign_effect' IS DISTINCT FROM 'none'
         OR p->>'run_effect' IS DISTINCT FROM 'continue' OR p->>'quota_effect' IS DISTINCT FROM 'no_count'
         OR NOT (coalesce(p->'lock_action_codes', '[]'::jsonb) ? 'zalo_message_stranger') THEN
        RAISE EXCEPTION 'V669 postflight: chính sách % × nhắn tin bạn bè (%) chưa đúng: %', c, t, p;
      END IF;
    END LOOP;
  END LOOP;
  SELECT count(*) INTO n FROM v669_before b
   WHERE NOT (b.error_code IN ('err_zalo_120_message_stranger', 'err_zalo_802_message_stranger') AND b.action_code = 'zalo_message_friend')
     AND (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, 'after_send') - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION 'V669 postflight: % cặp (mã, thao tác) khác bị đổi theo', n; END IF;
  IF (SELECT count(*) FROM public.auto_error WHERE is_active AND NOT is_delete AND 'zalo_message_friend' = ANY (zalo_action_codes)
        AND zalo_error_codes && ARRAY['120', '802']) <> 2
     OR (SELECT count(*) FROM public.auto_error WHERE is_active AND NOT is_delete AND 'zalo_message_friend' = ANY (zalo_action_codes)
        AND zalo_error_codes && ARRAY['120'] AND zalo_error_codes && ARRAY['802']) <> 0 THEN
    RAISE EXCEPTION 'V669 postflight: bộ chạy cũ cần đúng một dòng cho mỗi mã 120 / 802 × nhắn tin bạn bè';
  END IF;
  IF (SELECT count(*) FROM public.auto_error WHERE is_active AND NOT is_delete AND zalo_error_codes && ARRAY['120']
        AND 'zalo_message_stranger' = ANY (zalo_action_codes)) <> 1 THEN
    RAISE EXCEPTION 'V669 postflight: chính sách 120 nhắn người lạ của bộ chạy cũ bị đổi';
  END IF;
END $post$;

COMMIT;

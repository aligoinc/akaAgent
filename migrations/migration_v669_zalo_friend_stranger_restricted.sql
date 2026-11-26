-- V669: chiến dịch "Nhắn tin bạn bè" gửi cho cả người chưa là bạn bè (người được gắn tag, V660; anh chốt 26/11/2026 "Cách A":
-- chỉ cần gắn tag là gửi, không phân biệt bạn bè). Phương án: docs/ZALO_TAG_AUTO_SEND_PLAN.md mục 10.
--
-- Người chưa là bạn bè có thể gặp Zalo hạn chế nhắn người lạ (mã 120 / 802). Trước V669, trong chiến dịch nhắn tin bạn bè:
--   * engine v2: data về hàng đợi ngay, kết thúc lượt, 3 data liền thì tạm dừng chiến dịch (V500 Q4, chép từ nhắn người lạ);
--     Z802 kéo dài khoảng một tuần nên mỗi lần bấm Tiếp tục lại dừng, kể cả phần gửi cho bạn bè;
--   * bộ chạy cũ: không có chính sách cho cặp (120/802, zalo_message_friend) nên rơi vào err_zalo_api_business_failed (tính lượt,
--     cộng chuỗi, 4 data liền thì tạm dừng).
-- Sau V669:
--   * engine v2: hẹn riêng data đó chạy lại sau 24 giờ (120) / 48 giờ (802), không tính lượt, không cộng chuỗi, không dừng chiến
--     dịch, lượt chạy tiếp người khác. Vẫn khoá "Nhắn tin người lạ" của tài khoản như cũ (dòng chung của mã).
--   * bộ chạy cũ (không có hẹn giờ theo data): data "thất bại", không tính lượt, không cộng chuỗi, chạy tiếp.
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
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_zalo_message_friend_stranger_restricted') THEN
    RAISE EXCEPTION 'V669: auto_error err_zalo_message_friend_stranger_restricted đã có';
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
       log_template = 'Zalo đang hạn chế nhắn người lạ (mã 120), sẽ gửi lại người này sau 24 giờ',
       campaign_note_template = 'Zalo đang hạn chế nhắn người lạ (mã 120), sẽ gửi lại người này sau 24 giờ',
       description = '[Q4→V669] 120 khi nhắn tin bạn bè (người được gắn tag chưa là bạn bè): hẹn data 24 giờ, không dừng chiến dịch, chạy tiếp.'
 WHERE error_code = 'err_zalo_120_message_stranger' AND action_code = 'zalo_message_friend' AND status_id IS NULL AND error_class IS NULL
   AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;

UPDATE public.auto_outcome_policies
   SET target_effect = 'requeue_after', requeue_after_minutes = 2880, target_streak_effect = 'ignore', streak_threshold = NULL,
       campaign_effect = 'none', run_effect = 'continue',
       log_template = 'Zalo đang hạn chế nhắn người lạ (mã 802), sẽ gửi lại người này sau 48 giờ',
       campaign_note_template = 'Zalo đang hạn chế nhắn người lạ (mã 802), sẽ gửi lại người này sau 48 giờ',
       description = '[Q4→V669] 802 khi nhắn tin bạn bè (người được gắn tag chưa là bạn bè): hẹn data 48 giờ, không dừng chiến dịch, chạy tiếp.'
 WHERE error_code = 'err_zalo_802_message_stranger' AND action_code = 'zalo_message_friend' AND status_id IS NULL AND error_class IS NULL
   AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;

-- Bộ chạy cũ (đọc auto_error theo mã Zalo + thao tác; engine v2 không đọc dòng này).
INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help, detail_status)
VALUES ('external zalo', 'err_zalo_message_friend_stranger_restricted', 'Zalo hạn chế nhắn người lạ khi nhắn tin bạn bè',
  'V669: chiến dịch nhắn tin bạn bè gửi cho người chưa là bạn bè (người được gắn tag) mà Zalo đang hạn chế nhắn người lạ (120 / 802).',
  'Zalo đang hạn chế nhắn người lạ nên chưa gửi được cho người này',
  'Zalo đang hạn chế nhắn người lạ nên chưa gửi được cho người này',
  '{}', false, false, 'fixed_minutes', ARRAY['120', '802'], ARRAY['zalo_message_friend'], true, false, NULL, 'account_restricted',
  'Zalo đang hạn chế nhắn người lạ nên chưa gửi được cho người này', NULL, 'thất bại');

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
  IF (SELECT count(*) FROM public.auto_error WHERE is_active AND NOT is_delete AND zalo_error_codes && ARRAY['120']
        AND 'zalo_message_stranger' = ANY (zalo_action_codes)) <> 1 THEN
    RAISE EXCEPTION 'V669 postflight: chính sách 120 nhắn người lạ của bộ chạy cũ bị đổi';
  END IF;
END $post$;

COMMIT;

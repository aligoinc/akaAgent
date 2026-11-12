-- V508: Zalo 126/127 khi nhắn group là group chặn riêng tài khoản, không phải tài khoản bị hãm tốc (12/11/2026, anh chốt; 112 giữ nguyên).
-- SINH TỪ scripts/build-v508-sql.cjs, không sửa tay.
--
-- Chỉ sửa dữ liệu dòng chính sách (err_zalo_126_127_message_group, zalo_message_group) của engine v2 (V500, Q4): data hoàn thành ("thất bại"),
-- không tính lượt, không đếm chuỗi, không khoá thao tác, không tạm dừng chiến dịch, chạy tiếp group sau (trước: về hàng đợi, khoá nhắn group
-- 30 phút, kết thúc lượt, 3 lần liền thì tạm dừng). Lô chia sẻ mà cả lô thất bại vẫn tạm dừng theo luật lô của Desktop (V503).
-- Không DDL (bảng tạm chỉ trong giao dịch), không đổi hàm; bộ chạy cũ đọc auto_error nên không đổi. Không phụ thuộc V503–V507.
-- Gỡ: rollback_v508_zalo_group_126_127_per_group.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE r public.auto_outcome_policies%ROWTYPE; n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v508_%') THEN
      RAISE EXCEPTION 'V508 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies WHERE error_code = 'err_zalo_126_127_message_group' AND action_code = 'zalo_message_group' AND status_id IS NULL AND error_class IS NULL
     AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;
  IF n <> 1 THEN RAISE EXCEPTION 'V508: cần đúng 1 dòng chính sách 126/127 × zalo_message_group (thấy %)', n; END IF;
  SELECT * INTO r FROM public.auto_outcome_policies WHERE error_code = 'err_zalo_126_127_message_group' AND action_code = 'zalo_message_group' AND status_id IS NULL AND error_class IS NULL
     AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;
  IF r.target_streak_effect IS DISTINCT FROM 'increment' OR r.streak_threshold IS DISTINCT FROM 3
     OR r.campaign_effect IS DISTINCT FROM 'pause' OR r.target_effect IS DISTINCT FROM 'requeue'
     OR r.quota_effect IS DISTINCT FROM 'no_count' OR r.remaining_steps IS DISTINCT FROM 'skip'
     OR r.lock_action_codes IS NOT NULL OR r.run_effect IS NOT NULL THEN
    RAISE EXCEPTION 'V508: dòng chính sách 126/127 nhắn group khác bản V500 (Q4), không tự đổi';
  END IF;
END $pre$;

CREATE TEMP TABLE v508_before ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, 'after_send') - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t);

UPDATE public.auto_outcome_policies
   SET target_streak_effect = 'ignore', streak_threshold = NULL, campaign_effect = 'none', target_effect = 'complete',
       lock_action_codes = '{}', run_effect = 'continue', description = '[Q4→V508] 126/127 nhắn group: group chặn riêng tài khoản (đo 12/11/2026); không khoá, không dừng, không đếm chuỗi, data hoàn thành.'
 WHERE error_code = 'err_zalo_126_127_message_group' AND action_code = 'zalo_message_group' AND status_id IS NULL AND error_class IS NULL
     AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;

DO $post$
DECLARE p jsonb; n integer; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['desktop', 'fly'] LOOP
    p := public.aka_agent_engine_resolve_policy('err_zalo_126_127_message_group', NULL, 'zalo_message_group', NULL, t, 'after_send');
    IF p->>'target_streak_effect' IS DISTINCT FROM 'ignore' OR p->>'campaign_effect' IS DISTINCT FROM 'none'
       OR p->>'target_effect' IS DISTINCT FROM 'complete' OR jsonb_array_length(coalesce(p->'lock_action_codes', '[]'::jsonb)) <> 0
       OR p->>'run_effect' IS DISTINCT FROM 'continue' OR p->>'quota_effect' IS DISTINCT FROM 'no_count' THEN
      RAISE EXCEPTION 'V508 postflight: chính sách 126/127 nhắn group (%) chưa đúng: %', t, p;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM v508_before b
   WHERE NOT (b.error_code = 'err_zalo_126_127_message_group' AND b.action_code = 'zalo_message_group')
     AND (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, 'after_send') - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION 'V508 postflight: % cặp (mã, thao tác) khác bị đổi theo', n; END IF;
END $post$;

COMMIT;

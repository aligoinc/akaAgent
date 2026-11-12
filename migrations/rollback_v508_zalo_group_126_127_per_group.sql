-- Gỡ V508: trả dòng chính sách (err_zalo_126_127_message_group, zalo_message_group) về bản V500 (Q4).
-- SINH TỪ scripts/build-v508-sql.cjs. Chỉ dữ liệu; lịch sử chính sách ghi lại lần sửa này.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE r public.auto_outcome_policies%ROWTYPE; n integer;
BEGIN
  SELECT count(*) INTO n FROM public.auto_outcome_policies WHERE error_code = 'err_zalo_126_127_message_group' AND action_code = 'zalo_message_group' AND status_id IS NULL AND error_class IS NULL
     AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;
  IF n <> 1 THEN RAISE EXCEPTION 'Gỡ V508: cần đúng 1 dòng chính sách 126/127 × zalo_message_group (thấy %)', n; END IF;
  SELECT * INTO r FROM public.auto_outcome_policies WHERE error_code = 'err_zalo_126_127_message_group' AND action_code = 'zalo_message_group' AND status_id IS NULL AND error_class IS NULL
     AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;
  IF r.target_streak_effect IS DISTINCT FROM 'ignore' OR r.campaign_effect IS DISTINCT FROM 'none'
     OR r.target_effect IS DISTINCT FROM 'complete' OR r.run_effect IS DISTINCT FROM 'continue'
     OR r.lock_action_codes IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION 'Gỡ V508: chưa có V508 (dòng chính sách không phải bản V508)';
  END IF;
END $pre$;

CREATE TEMP TABLE v508_rollback_before ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, 'after_send') - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t);

UPDATE public.auto_outcome_policies
   SET target_streak_effect = 'increment', streak_threshold = 3, campaign_effect = 'pause', target_effect = 'requeue',
       lock_action_codes = NULL, run_effect = NULL, description = '[Q4] 126/127 nhắn nhóm.'
 WHERE error_code = 'err_zalo_126_127_message_group' AND action_code = 'zalo_message_group' AND status_id IS NULL AND error_class IS NULL
     AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete;

DO $post$
DECLARE p jsonb; n integer;
BEGIN
  p := public.aka_agent_engine_resolve_policy('err_zalo_126_127_message_group', NULL, 'zalo_message_group', NULL, 'fly', 'after_send');
  IF p->>'target_streak_effect' IS DISTINCT FROM 'increment' OR p->>'campaign_effect' IS DISTINCT FROM 'pause' OR p->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'Gỡ V508 postflight: chính sách 126/127 nhắn group chưa về Q4: %', p;
  END IF;
  SELECT count(*) INTO n FROM v508_rollback_before b
   WHERE NOT (b.error_code = 'err_zalo_126_127_message_group' AND b.action_code = 'zalo_message_group')
     AND (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, 'after_send') - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V508 postflight: % cặp (mã, thao tác) khác bị đổi theo', n; END IF;
END $post$;

COMMIT;

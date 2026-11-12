-- Gỡ V500: xoá chính sách và luật v500_review, bật lại luật seed đã tắt, tắt mã mới (không xoá dòng auto_error vì lịch sử
-- hoặc bộ nhớ mục tiêu có thể đã tham chiếu). SINH TỪ scripts/build-v500-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DELETE FROM public.auto_outcome_policies WHERE source = 'v500_review';
DELETE FROM public.auto_outcome_signal_rules WHERE source = 'v500_review';
UPDATE public.auto_outcome_signal_rules SET is_active = true, updated_at = now()
 WHERE source = 'seed_v495' AND platform = 'zalo' AND action_code IS NULL AND phase IS NULL AND NOT is_active
   AND (signal_kind, pattern) IN (('engine', 'target_missing_identity'));
UPDATE public.auto_error SET is_active = false, is_delete = true
 WHERE error_type = 'engine v2' AND error_code IN ('err_engine_zalo_not_group_member', 'err_engine_zalo_group_member_limit', 'err_engine_zalo_group_full', 'err_engine_zalo_join_group_day_limit', 'err_engine_zalo_cancel_friend_day_limit', 'err_engine_zalo_tag_outdated', 'err_engine_zalo_group_invite_pending');

DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(issue || ':' || subject, ', ') INTO v_bad FROM public.aka_agent_engine_policy_lint;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V500 postflight lint: %', v_bad; END IF;
END $post$;

COMMIT;

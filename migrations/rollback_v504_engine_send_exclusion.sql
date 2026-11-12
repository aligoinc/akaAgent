-- Gỡ V504: bỏ hàm loại trừ của engine v2, mã EXC01 / EXC02 / EXC03 / CFG18 / CFG19 (xoá nếu chưa dùng, còn thì chỉ tắt), cổng
-- send_exclusion về như V495.
-- SINH TỪ scripts/build-v504-sql.cjs. Bộ chạy cũ không phụ thuộc phần nào ở đây.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb);
UPDATE public.auto_engine_gates SET on_error = 'open', retry_after_seconds = 0,
  description = 'Danh sách loại trừ gửi (giữ như hiện nay).' WHERE code = 'send_exclusion';
DELETE FROM public.auto_outcome_signal_rules WHERE source = 'v504';
DELETE FROM public.auto_outcome_policies WHERE error_code IN ('err_engine_send_excluded', 'err_engine_send_exclusion_unknown', 'err_cfg_send_exclusion_invalid', 'err_engine_friend_blocklisted', 'err_cfg_friend_blocklist_invalid') AND source = 'v504';
UPDATE public.auto_error SET is_active = false WHERE error_code IN ('err_engine_send_excluded', 'err_engine_send_exclusion_unknown', 'err_cfg_send_exclusion_invalid', 'err_engine_friend_blocklisted', 'err_cfg_friend_blocklist_invalid');
DELETE FROM public.auto_error e WHERE e.error_code IN ('err_engine_send_excluded', 'err_engine_send_exclusion_unknown', 'err_cfg_send_exclusion_invalid', 'err_engine_friend_blocklisted', 'err_cfg_friend_blocklist_invalid')
   AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_details d WHERE d.error_code = e.error_code)
   AND NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes o WHERE o.error_code = e.error_code)
   AND NOT EXISTS (SELECT 1 FROM public.auto_account_action_status a WHERE a.disabled_error_code = e.error_code);

DO $post$
BEGIN
  IF to_regprocedure('public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V504 postflight: hàm còn'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_gates WHERE code = 'send_exclusion' AND on_error = 'open') THEN
    RAISE EXCEPTION 'Gỡ V504 postflight: cổng send_exclusion';
  END IF;
END $post$;

COMMIT;

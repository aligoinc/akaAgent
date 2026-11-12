-- Gỡ V514: bỏ trigger giữ khớp trạng thái kết quả và trả view aka_agent_engine_policy_lint về đúng bản V495 (4 loại kiểm).
-- Không có dữ liệu nào để trả lại. Thay view và xoá hàm làm PostgREST nạp lại schema: chạy ngoài giờ cao điểm.
-- Không xoá dòng trong sổ migration.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regprocedure('public.aka_agent_guard_status_system_group_v514()') IS NULL THEN
    RAISE EXCEPTION 'Gỡ V514: chưa có V514';
  END IF;
END $pre$;

DROP TRIGGER IF EXISTS auto_status_system_group_guard_v514 ON public.auto_status;
DROP FUNCTION IF EXISTS public.aka_agent_guard_status_system_group_v514();

CREATE OR REPLACE VIEW public.aka_agent_engine_policy_lint AS
SELECT 'missing_catch_all'::text AS issue, p.platform || ' / ' || ph.phase AS subject
  FROM (VALUES ('zalo'), ('facebook'), ('email')) p(platform)
  CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(phase)
 WHERE NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules r
                    WHERE r.is_active AND r.signal_kind = 'engine' AND r.pattern = '*'
                      AND r.platform IN (p.platform, 'system') AND (r.phase IS NULL OR r.phase = ph.phase) AND r.action_code IS NULL)
UNION ALL
SELECT 'error_without_class', e.error_code FROM public.auto_error e WHERE e.is_active AND NOT e.is_delete AND e.error_class IS NULL
UNION ALL
SELECT 'policy_on_inactive_error', p.id::text FROM public.auto_outcome_policies p JOIN public.auto_error e ON e.error_code = p.error_code
 WHERE p.is_active AND NOT p.is_delete AND (NOT e.is_active OR e.is_delete)
UNION ALL
SELECT 'rule_on_inactive_error', r.id::text FROM public.auto_outcome_signal_rules r JOIN public.auto_error e ON e.error_code = r.error_code
 WHERE r.is_active AND (NOT e.is_active OR e.is_delete);

DO $post$
BEGIN
  IF to_regprocedure('public.aka_agent_guard_status_system_group_v514()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.auto_status'::regclass AND tgname = 'auto_status_system_group_guard_v514') THEN
    RAISE EXCEPTION 'Gỡ V514 postflight: trigger / hàm vẫn còn';
  END IF;
  IF md5(pg_get_viewdef('public.aka_agent_engine_policy_lint'::regclass, true)) IS DISTINCT FROM 'a5731bb6a4059bd38983d6240682e1be' THEN
    RAISE EXCEPTION 'Gỡ V514 postflight: view rà soát chưa về đúng bản V495';
  END IF;
END $post$;

COMMIT;

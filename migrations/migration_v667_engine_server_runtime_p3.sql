-- V667 p3: VALIDATE ba ràng buộc runtime_target của p1. SINH TỪ scripts/build-v667-sql.cjs, không sửa tay. Mỗi lệnh một giao dịch,
-- khoá SHARE UPDATE EXCLUSIVE (không chặn đọc / ghi, chỉ chặn DDL khác); auto_engine_target_runs ~770 MB nên mất vài giây. Chạy lại được.
SET lock_timeout = '5s';
SET statement_timeout = '300s';
ALTER TABLE public.auto_engine_leases VALIDATE CONSTRAINT auto_engine_leases_runtime_target_check;
ALTER TABLE public.auto_engine_target_runs VALIDATE CONSTRAINT auto_engine_target_runs_runtime_target_check;
ALTER TABLE public.auto_outcome_policies VALIDATE CONSTRAINT auto_outcome_policies_runtime_target_check;
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname IN ('auto_engine_leases_runtime_target_check', 'auto_engine_target_runs_runtime_target_check', 'auto_outcome_policies_runtime_target_check') AND NOT c.convalidated) THEN
    RAISE EXCEPTION 'V667 p3 postflight: còn ràng buộc chưa VALIDATE';
  END IF;
  -- pg_get_constraintdef thêm " NOT VALID" khi ràng buộc chưa VALIDATE (sau p1, trước p3): so phần điều kiện.
  IF (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c WHERE c.conrelid = 'public.auto_engine_leases'::regclass AND c.conname = 'auto_engine_leases_runtime_target_check')
     IS DISTINCT FROM $c$CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text, 'server'::text])))$c$ THEN
    RAISE EXCEPTION 'V667: ràng buộc auto_engine_leases_runtime_target_check không như mong đợi';
  END IF;
  -- pg_get_constraintdef thêm " NOT VALID" khi ràng buộc chưa VALIDATE (sau p1, trước p3): so phần điều kiện.
  IF (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c WHERE c.conrelid = 'public.auto_engine_target_runs'::regclass AND c.conname = 'auto_engine_target_runs_runtime_target_check')
     IS DISTINCT FROM $c$CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text, 'server'::text])))$c$ THEN
    RAISE EXCEPTION 'V667: ràng buộc auto_engine_target_runs_runtime_target_check không như mong đợi';
  END IF;
  -- pg_get_constraintdef thêm " NOT VALID" khi ràng buộc chưa VALIDATE (sau p1, trước p3): so phần điều kiện.
  IF (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c WHERE c.conrelid = 'public.auto_outcome_policies'::regclass AND c.conname = 'auto_outcome_policies_runtime_target_check')
     IS DISTINCT FROM $c$CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text, 'server'::text])))$c$ THEN
    RAISE EXCEPTION 'V667: ràng buộc auto_outcome_policies_runtime_target_check không như mong đợi';
  END IF;
END $post$;

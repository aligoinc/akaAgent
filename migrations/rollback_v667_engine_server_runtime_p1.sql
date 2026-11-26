-- Gỡ V667 p1: ba ràng buộc runtime_target về ('desktop','fly'). SINH TỪ scripts/build-v667-sql.cjs. Gỡ p2 trước. Chỉ chạy được khi
-- không còn dòng nào mang 'server' (lượt / lease / chính sách); lượt cũ tự dọn sau engine.retention_days ngày.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
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
  IF to_regprocedure('public.aka_agent_engine_close_server_runs_v1(bigint)') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V667 p1: gỡ p2 trước'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_leases WHERE runtime_target = 'server') THEN
    RAISE EXCEPTION 'Gỡ V667 p1: public.auto_engine_leases còn dòng nơi chạy server';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs WHERE runtime_target = 'server') THEN
    RAISE EXCEPTION 'Gỡ V667 p1: public.auto_engine_target_runs còn dòng nơi chạy server';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE runtime_target = 'server') THEN
    RAISE EXCEPTION 'Gỡ V667 p1: public.auto_outcome_policies còn dòng nơi chạy server';
  END IF;
END $pre$;

ALTER TABLE public.auto_engine_leases DROP CONSTRAINT auto_engine_leases_runtime_target_check,
  ADD CONSTRAINT auto_engine_leases_runtime_target_check CHECK (runtime_target IN ('desktop', 'fly')) NOT VALID;
ALTER TABLE public.auto_engine_target_runs DROP CONSTRAINT auto_engine_target_runs_runtime_target_check,
  ADD CONSTRAINT auto_engine_target_runs_runtime_target_check CHECK (runtime_target IN ('desktop', 'fly')) NOT VALID;
ALTER TABLE public.auto_outcome_policies DROP CONSTRAINT auto_outcome_policies_runtime_target_check,
  ADD CONSTRAINT auto_outcome_policies_runtime_target_check CHECK (runtime_target IN ('desktop', 'fly')) NOT VALID;
ALTER TABLE public.auto_engine_leases VALIDATE CONSTRAINT auto_engine_leases_runtime_target_check;
ALTER TABLE public.auto_engine_target_runs VALIDATE CONSTRAINT auto_engine_target_runs_runtime_target_check;
ALTER TABLE public.auto_outcome_policies VALIDATE CONSTRAINT auto_outcome_policies_runtime_target_check;

DO $post$
BEGIN
  -- pg_get_constraintdef thêm " NOT VALID" khi ràng buộc chưa VALIDATE (sau p1, trước p3): so phần điều kiện.
  IF (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c WHERE c.conrelid = 'public.auto_engine_leases'::regclass AND c.conname = 'auto_engine_leases_runtime_target_check')
     IS DISTINCT FROM $c$CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text])))$c$ THEN
    RAISE EXCEPTION 'V667: ràng buộc auto_engine_leases_runtime_target_check không như mong đợi';
  END IF;
  -- pg_get_constraintdef thêm " NOT VALID" khi ràng buộc chưa VALIDATE (sau p1, trước p3): so phần điều kiện.
  IF (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c WHERE c.conrelid = 'public.auto_engine_target_runs'::regclass AND c.conname = 'auto_engine_target_runs_runtime_target_check')
     IS DISTINCT FROM $c$CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text])))$c$ THEN
    RAISE EXCEPTION 'V667: ràng buộc auto_engine_target_runs_runtime_target_check không như mong đợi';
  END IF;
  -- pg_get_constraintdef thêm " NOT VALID" khi ràng buộc chưa VALIDATE (sau p1, trước p3): so phần điều kiện.
  IF (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c WHERE c.conrelid = 'public.auto_outcome_policies'::regclass AND c.conname = 'auto_outcome_policies_runtime_target_check')
     IS DISTINCT FROM $c$CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text])))$c$ THEN
    RAISE EXCEPTION 'V667: ràng buộc auto_outcome_policies_runtime_target_check không như mong đợi';
  END IF;
END $post$;

COMMIT;

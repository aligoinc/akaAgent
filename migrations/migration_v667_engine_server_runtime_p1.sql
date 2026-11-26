-- V667 p1: ba ràng buộc runtime_target nhận nơi chạy 'server' (engine v2 cho tài khoản Zalo Server trên VPS). SINH TỪ
-- scripts/build-v667-sql.cjs, không sửa tay. Chỉ đổi ràng buộc (NOT VALID: dòng cũ đều đúng, p3 VALIDATE sau). Giao dịch ngắn,
-- lock_timeout 2 giây (bảng engine được ghi liên tục). DDL làm PostgREST nạp lại schema: apply buổi tối. Thứ tự: p1 → p2 → p3.
-- Gỡ: rollback_v667_engine_server_runtime_p1.sql (chỉ khi chưa có dòng 'server' nào).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v667_engine_server_runtime_p1') THEN
      RAISE EXCEPTION 'migration_v667_engine_server_runtime_p1 đã có trong sổ migration, không chạy lại';
    END IF;
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v667_%'
                AND name NOT IN ('migration_v667_engine_server_runtime_p1', 'migration_v667_engine_server_runtime_p2', 'migration_v667_engine_server_runtime_p3')) THEN
      RAISE EXCEPTION 'Số V667 đã có migration khác trong sổ: đổi số trong scripts/build-v667-sql.cjs rồi sinh lại';
    END IF;
  END IF;
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
END $pre$;

ALTER TABLE public.auto_engine_leases DROP CONSTRAINT auto_engine_leases_runtime_target_check,
  ADD CONSTRAINT auto_engine_leases_runtime_target_check CHECK (runtime_target IN ('desktop', 'fly', 'server')) NOT VALID;
ALTER TABLE public.auto_engine_target_runs DROP CONSTRAINT auto_engine_target_runs_runtime_target_check,
  ADD CONSTRAINT auto_engine_target_runs_runtime_target_check CHECK (runtime_target IN ('desktop', 'fly', 'server')) NOT VALID;
ALTER TABLE public.auto_outcome_policies DROP CONSTRAINT auto_outcome_policies_runtime_target_check,
  ADD CONSTRAINT auto_outcome_policies_runtime_target_check CHECK (runtime_target IN ('desktop', 'fly', 'server')) NOT VALID;

DO $post$
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
END $post$;

COMMIT;

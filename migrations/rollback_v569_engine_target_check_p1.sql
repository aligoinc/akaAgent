-- Gỡ V569 phần 1: bỏ hai cột target_check của auto_outcome_policies. SINH TỪ scripts/build-v569-sql.cjs.
-- Gỡ phần 2 trước (rollback_v569_engine_target_check_p2.sql): claim / report / hàm nạp đọc hai cột này.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regprocedure('private.aka_agent_engine_target_check_rules()') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V569 p1: gỡ phần 2 trước (rollback_v569_engine_target_check_p2.sql)'; END IF;
END $pre$;

ALTER TABLE public.auto_outcome_policies
  DROP CONSTRAINT IF EXISTS auto_outcome_policies_target_check_v569,
  DROP COLUMN IF EXISTS target_check_enabled,
  DROP COLUMN IF EXISTS target_check_days;

COMMIT;

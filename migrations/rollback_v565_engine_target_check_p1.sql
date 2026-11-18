-- Gỡ V565 phần 1: bỏ hai cột target_check của auto_outcome_policies. SINH TỪ scripts/build-v565-sql.cjs.
-- Gỡ phần 2 trước (rollback_v565_engine_target_check_p2.sql): claim / report / hàm nạp đọc hai cột này.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regprocedure('private.aka_agent_engine_target_check_rules()') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V565 p1: gỡ phần 2 trước (rollback_v565_engine_target_check_p2.sql)'; END IF;
END $pre$;

ALTER TABLE public.auto_outcome_policies
  DROP CONSTRAINT IF EXISTS auto_outcome_policies_target_check_v565,
  DROP COLUMN IF EXISTS target_check_enabled,
  DROP COLUMN IF EXISTS target_check_days;

COMMIT;

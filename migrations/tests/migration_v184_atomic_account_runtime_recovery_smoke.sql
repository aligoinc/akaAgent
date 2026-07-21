-- Catalog-only smoke test for migration_v184_atomic_account_runtime_recovery.sql.
-- It does not invoke recovery functions or mutate application data.

BEGIN;

DO $smoke$
DECLARE
  v_signature text;
  v_definition text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)',
    'public.release_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)',
    'public.reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'v184_smoke: missing RPC %', v_signature;
    END IF;
    IF (
      SELECT routine.prosecdef
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = to_regprocedure(v_signature)
    ) THEN
      RAISE EXCEPTION 'v184_smoke: RPC % must remain SECURITY INVOKER', v_signature;
    END IF;
    IF NOT has_function_privilege('anon', v_signature, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'v184_smoke: RPC % is missing an application-role grant', v_signature;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) AS privilege
      WHERE routine.oid = to_regprocedure(v_signature)
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'v184_smoke: RPC % must not grant EXECUTE to PUBLIC', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.auto_accounts'::regclass
      AND attribute.attname = 'runtime_operation_claim_token'
      AND attribute.atttypid = 'uuid'::regtype
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'v184_smoke: runtime operation claim-token column is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.auto_accounts'::regclass
      AND trigger.tgname = 'trg_auto_accounts_runtime_operation_claim_token'
      AND trigger.tgenabled <> 'D'
      AND NOT trigger.tgisinternal
  ) THEN
    RAISE EXCEPTION 'v184_smoke: runtime operation claim-token trigger is missing or disabled';
  END IF;
  IF NOT has_function_privilege(
    'anon',
    'public.guard_auto_account_runtime_operation_claim_token()',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.guard_auto_account_runtime_operation_claim_token()',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.guard_auto_account_runtime_operation_claim_token()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'v184_smoke: claim-token trigger function is missing an application-role grant';
  END IF;
  IF to_regprocedure('public.release_non_zalo_account_runtime_operation(bigint,bigint,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'v184_smoke: abandoned text-revision release overload must be removed';
  END IF;
  IF to_regprocedure('public.release_non_zalo_account_runtime_operation(bigint,bigint,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'v184_smoke: abandoned status-only release overload must be removed';
  END IF;
  IF to_regprocedure('public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'v184_smoke: abandoned server-generated-token claim overload must be removed';
  END IF;

  SELECT pg_get_functiondef(
    'public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)'::regprocedure
  ) INTO v_definition;
  IF position('FOR SHARE OF staff' IN v_definition) = 0
    OR position('FOR UPDATE OF account' IN v_definition) = 0
    OR position('v_account.status IS DISTINCT FROM v_previous_status' IN v_definition) = 0
    OR position('runtime_operation_claim_token = p_claim_token' IN v_definition) = 0
    OR position('''claim_token'', p_claim_token' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'v184_smoke: non-Zalo claim lock/CAS contract is missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.release_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)'::regprocedure
  ) INTO v_definition;
  IF position('FOR SHARE OF staff' IN v_definition) = 0
    OR position('FOR UPDATE OF account' IN v_definition) = 0
    OR position('account.runtime_operation_claim_token = p_claim_token' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'v184_smoke: non-Zalo release lock/revision contract is missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)'::regprocedure
  ) INTO v_definition;
  IF position('FOR UPDATE OF staff' IN v_definition) = 0
    OR position('v_result := public.reset_desktop_running_statuses(' IN v_definition) = 0
    OR position('Dừng đột ngột, không xác định kết quả; không tự thực hiện lại' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'v184_smoke: atomic no-retry recovery contract is missing';
  END IF;
END;
$smoke$;

ROLLBACK;

-- Rollback smoke for migration_v223_database_runtime_clock.sql.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_clock_oid oid := pg_catalog.to_regprocedure('public.aka_agent_get_runtime_clock()');
  v_status_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_get_account_action_status_today(bigint,text)'
  );
  v_clock record;
BEGIN
  IF v_clock_oid IS NULL OR v_status_oid IS NULL THEN
    RAISE EXCEPTION 'v223_smoke: required functions are missing';
  END IF;

  IF (SELECT routine.prosecdef FROM pg_catalog.pg_proc AS routine WHERE routine.oid = v_clock_oid)
    OR (SELECT routine.prosecdef FROM pg_catalog.pg_proc AS routine WHERE routine.oid = v_status_oid)
  THEN
    RAISE EXCEPTION 'v223_smoke: functions must remain SECURITY INVOKER';
  END IF;

  IF NOT pg_catalog.has_function_privilege('anon', v_clock_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', v_clock_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_clock_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('anon', v_status_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', v_status_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_status_oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v223_smoke: runtime roles are missing EXECUTE privileges';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) AS privilege
    WHERE routine.oid IN (v_clock_oid, v_status_oid)
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  )
  THEN
    RAISE EXCEPTION 'v223_smoke: PUBLIC must not retain EXECUTE privileges';
  END IF;

  SELECT * INTO v_clock FROM public.aka_agent_get_runtime_clock();
  IF v_clock.db_now IS NULL
    OR v_clock.vietnam_date_key <> timezone('Asia/Ho_Chi_Minh', v_clock.db_now)::date
    OR v_clock.next_vietnam_midnight <= v_clock.db_now
    OR timezone('Asia/Ho_Chi_Minh', v_clock.next_vietnam_midnight)::time <> time '00:00:00'
  THEN
    RAISE EXCEPTION 'v223_smoke: runtime clock values are inconsistent';
  END IF;
END;
$metadata$;

SET LOCAL ROLE anon;

DO $behavior$
DECLARE
  v_account_id bigint;
  v_action_code text;
  v_status_id bigint;
  v_snapshot record;
  v_today date := timezone('Asia/Ho_Chi_Minh', statement_timestamp())::date;
  v_future_rejected boolean := false;
BEGIN
  SELECT account.id
  INTO v_account_id
  FROM public.auto_accounts AS account
  WHERE COALESCE(account.is_delete, false) = false
  ORDER BY account.id
  LIMIT 1;

  SELECT action.code
  INTO v_action_code
  FROM public.auto_account_actions AS action
  WHERE COALESCE(action.is_delete, false) = false
    AND NOT EXISTS (
      SELECT 1
      FROM public.auto_account_action_status AS status
      WHERE status.account_id = v_account_id
        AND status.action_code = action.code
    )
  ORDER BY action.id
  LIMIT 1;

  IF v_account_id IS NULL OR v_action_code IS NULL THEN
    RAISE NOTICE 'v223_smoke: no unused account/action pair; behavior fixture skipped';
    RETURN;
  END IF;

  SELECT *
  INTO v_snapshot
  FROM public.aka_agent_get_account_action_status_today(v_account_id, v_action_code);

  v_status_id := (v_snapshot.action_status ->> 'id')::bigint;
  IF v_status_id IS NULL
    OR (v_snapshot.action_status ->> 'count_date')::date <> v_today
    OR (v_snapshot.action_status ->> 'count_action_in_day')::integer <> 0
    OR v_snapshot.vietnam_date_key <> v_today
  THEN
    RAISE EXCEPTION 'v223_smoke: current-day status snapshot is invalid';
  END IF;

  UPDATE public.auto_account_action_status
  SET count_action_in_day = 7,
      count_date = v_today - 1
  WHERE id = v_status_id;

  SELECT *
  INTO v_snapshot
  FROM public.aka_agent_get_account_action_status_today(v_account_id, v_action_code);

  IF (v_snapshot.action_status ->> 'count_date')::date <> v_today
    OR (v_snapshot.action_status ->> 'count_action_in_day')::integer <> 0
  THEN
    RAISE EXCEPTION 'v223_smoke: stale daily count was not reset';
  END IF;

  UPDATE public.auto_account_action_status
  SET count_action_in_day = 9,
      count_date = v_today + 1
  WHERE id = v_status_id;

  BEGIN
    PERFORM public.aka_agent_get_account_action_status_today(v_account_id, v_action_code);
  EXCEPTION WHEN OTHERS THEN
    v_future_rejected := position('is ahead of DB Vietnam date' IN SQLERRM) > 0;
  END;

  IF NOT v_future_rejected THEN
    RAISE EXCEPTION 'v223_smoke: future-dated quota state was not rejected';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_account_action_status AS status
    WHERE status.id = v_status_id
      AND status.count_date = v_today + 1
      AND status.count_action_in_day = 9
  ) THEN
    RAISE EXCEPTION 'v223_smoke: future-dated quota state was modified';
  END IF;
END;
$behavior$;

RESET ROLE;

ROLLBACK;

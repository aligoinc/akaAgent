-- Make campaign scheduling and daily action quotas use PostgreSQL time instead
-- of the Desktop/VPS wall clock. Both functions are additive and keep the
-- existing claim_campaign_runtime contract unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_get_runtime_clock()
RETURNS TABLE (
  db_now timestamptz,
  vietnam_date_key date,
  next_vietnam_midnight timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $function$
  WITH runtime_clock AS (
    SELECT statement_timestamp() AS db_now
  )
  SELECT
    runtime_clock.db_now,
    timezone('Asia/Ho_Chi_Minh', runtime_clock.db_now)::date,
    (
      (timezone('Asia/Ho_Chi_Minh', runtime_clock.db_now)::date + 1)::timestamp
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
    )
  FROM runtime_clock;
$function$;

COMMENT ON FUNCTION public.aka_agent_get_runtime_clock() IS
  'Read-only authoritative PostgreSQL clock for Desktop/App Server scheduling decisions.';

CREATE OR REPLACE FUNCTION public.aka_agent_get_account_action_status_today(
  p_account_id bigint,
  p_action_code text
)
RETURNS TABLE (
  action_status jsonb,
  db_now timestamptz,
  vietnam_date_key date,
  next_vietnam_midnight timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_today date := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_action_code text := btrim(COALESCE(p_action_code, ''));
  v_status public.auto_account_action_status%ROWTYPE;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR v_action_code = '' THEN
    RAISE EXCEPTION 'account_id and action_code are required';
  END IF;

  INSERT INTO public.auto_account_action_status (
    account_id,
    action_code,
    count_action_in_day,
    count_date,
    updated_at
  )
  VALUES (
    p_account_id,
    v_action_code,
    0,
    v_today,
    v_now
  )
  ON CONFLICT (account_id, action_code) DO NOTHING;

  SELECT status.*
  INTO v_status
  FROM public.auto_account_action_status AS status
  WHERE status.account_id = p_account_id
    AND status.action_code = v_action_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account action status was not found after insert';
  END IF;

  -- Never reset a future-dated snapshot backwards. That state can only be
  -- produced by a legacy client with a fast wall clock or manual data edits.
  IF v_status.count_date > v_today THEN
    RAISE EXCEPTION
      'account action status date % is ahead of DB Vietnam date %',
      v_status.count_date,
      v_today;
  END IF;

  IF v_status.count_date < v_today THEN
    UPDATE public.auto_account_action_status AS status
    SET
      count_action_in_day = 0,
      count_date = v_today,
      updated_at = v_now
    WHERE status.id = v_status.id
    RETURNING status.* INTO v_status;
  END IF;

  RETURN QUERY
  SELECT
    to_jsonb(v_status),
    v_now,
    v_today,
    ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
END;
$function$;

COMMENT ON FUNCTION public.aka_agent_get_account_action_status_today(bigint, text) IS
  'Atomically creates/reads the current DB-Vietnam-day quota row and fails closed on future-dated state.';

REVOKE ALL ON FUNCTION public.aka_agent_get_runtime_clock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_get_account_action_status_today(bigint, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.aka_agent_get_runtime_clock()
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_get_account_action_status_today(bigint, text)
  TO anon, authenticated, service_role;

DO $postflight$
DECLARE
  v_clock_oid oid := pg_catalog.to_regprocedure('public.aka_agent_get_runtime_clock()');
  v_status_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_get_account_action_status_today(bigint,text)'
  );
  v_clock record;
BEGIN
  IF v_clock_oid IS NULL OR v_status_oid IS NULL THEN
    RAISE EXCEPTION 'v223 postflight: runtime clock functions are missing';
  END IF;

  IF (SELECT routine.prosecdef FROM pg_catalog.pg_proc AS routine WHERE routine.oid = v_clock_oid)
    OR (SELECT routine.prosecdef FROM pg_catalog.pg_proc AS routine WHERE routine.oid = v_status_oid)
  THEN
    RAISE EXCEPTION 'v223 postflight: runtime clock functions must remain SECURITY INVOKER';
  END IF;

  IF NOT pg_catalog.has_function_privilege('anon', v_clock_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', v_clock_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_clock_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('anon', v_status_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', v_status_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_status_oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v223 postflight: runtime roles are missing EXECUTE privileges';
  END IF;

  SELECT * INTO v_clock FROM public.aka_agent_get_runtime_clock();
  IF v_clock.db_now IS NULL
    OR v_clock.vietnam_date_key <> timezone('Asia/Ho_Chi_Minh', v_clock.db_now)::date
    OR v_clock.next_vietnam_midnight <= v_clock.db_now
  THEN
    RAISE EXCEPTION 'v223 postflight: runtime clock returned inconsistent values';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;

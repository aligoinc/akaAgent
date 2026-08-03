-- Rollback smoke test for migration_v220_claim_campaign_runtime_rpc_permissions.sql.
-- Verifies that the public scheduler claim remains SECURITY INVOKER while anon
-- and authenticated callers can claim ordinary work without direct access to
-- the six RPC-only Data Group support tables.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_claim oid := pg_catalog.to_regprocedure(
    'public.claim_campaign_runtime(bigint,bigint,bigint,text)'
  );
  v_definition text;
  v_table_name text;
  v_exposed_invoker record;
  v_rpc_only_tables constant text[] := ARRAY[
    'auto_data_ingest_batches',
    'auto_account_contact_group_member_origins',
    'auto_campaign_creation_bundles',
    'auto_campaign_data_group_sources',
    'auto_campaign_input_origins',
    'auto_campaign_input_target_aliases'
  ];
BEGIN
  IF v_claim IS NULL THEN
    RAISE EXCEPTION 'v220_smoke: claim_campaign_runtime is missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_claim)
  INTO v_definition;

  IF (SELECT routine.prosecdef FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = v_claim) THEN
    RAISE EXCEPTION 'v220_smoke: claim_campaign_runtime must remain SECURITY INVOKER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL unnest(
      COALESCE(routine.proconfig, ARRAY[]::text[])
    ) AS setting(value)
    WHERE routine.oid = v_claim
      AND setting.value LIKE 'search_path=%public%'
  ) THEN
    RAISE EXCEPTION 'v220_smoke: claim_campaign_runtime search_path is not pinned';
  END IF;

  IF NOT pg_catalog.has_function_privilege('anon', v_claim, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', v_claim, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v220_smoke: runtime roles cannot execute claim_campaign_runtime';
  END IF;

  IF position('public.auto_campaign_data_group_sources' IN lower(v_definition)) > 0 THEN
    RAISE EXCEPTION 'v220_smoke: claim_campaign_runtime still reads the RPC-only source table';
  END IF;

  IF position(
      'public.aka_agent_finalize_data_group_campaign('
      IN lower(v_definition)
    ) > 0
  THEN
    RAISE EXCEPTION 'v220_smoke: invoker claim still calls the service-only Desktop finalizer';
  END IF;

  IF position(
      'public.aka_agent_finalize_zalo_server_data_group_campaign('
      IN lower(v_definition)
    ) = 0
    OR position('FOR UPDATE OF campaign' IN v_definition) = 0
    OR position(
      'public.aka_agent_finalize_zalo_server_data_group_campaign('
      IN lower(v_definition)
    ) > position('FOR UPDATE OF campaign' IN v_definition)
  THEN
    RAISE EXCEPTION 'v220_smoke: Server hard-end wrapper no longer runs before campaign locking';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
      'anon',
      'public.aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)',
      'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v220_smoke: Server hard-end wrapper is not callable by runtime roles';
  END IF;

  FOREACH v_table_name IN ARRAY v_rpc_only_tables LOOP
    IF pg_catalog.has_table_privilege(
        'anon', format('public.%I', v_table_name), 'SELECT'
      )
      OR pg_catalog.has_table_privilege(
        'authenticated', format('public.%I', v_table_name), 'SELECT'
      )
    THEN
      RAISE EXCEPTION 'v220_smoke: direct SELECT leaked on RPC-only table %', v_table_name;
    END IF;
  END LOOP;

  -- Generic regression guard: an RPC callable by either runtime role must not
  -- be SECURITY INVOKER while directly naming an RPC-only table.
  FOR v_exposed_invoker IN
    SELECT
      routine.oid,
      routine.oid::regprocedure AS signature,
      lower(pg_catalog.pg_get_functiondef(routine.oid)) AS definition
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND routine.prokind = 'f'
      AND routine.prosecdef = false
      AND (
        pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege(
          'authenticated', routine.oid, 'EXECUTE'
        )
      )
  LOOP
    FOREACH v_table_name IN ARRAY v_rpc_only_tables LOOP
      IF position(
          format('public.%I', v_table_name)
          IN v_exposed_invoker.definition
        ) > 0
      THEN
        RAISE EXCEPTION
          'v220_smoke: exposed SECURITY INVOKER function % reads RPC-only table %',
          v_exposed_invoker.signature,
          v_table_name;
      END IF;
    END LOOP;
  END LOOP;
END;
$metadata$;

DO $fixture$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_action_id text;
  v_account_id constant bigint := 8800220000000001;
  v_campaign_id constant bigint := 8800220000000002;
BEGIN
  PERFORM pg_catalog.set_config('aka_agent.v220_staff_id', '0', true);

  SELECT staff.id, staff.organization_id
  INTO v_staff_id, v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
  ORDER BY staff.id
  LIMIT 1;

  SELECT action.id INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.id = 'sms_send'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  LIMIT 1;

  IF v_staff_id IS NULL OR v_organization_id IS NULL OR v_action_id IS NULL THEN
    RAISE NOTICE 'v220_smoke: active staff/organization or sms_send action missing; behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('aka-agent-v220-claim-permission-smoke', 0)
  );

  IF EXISTS (SELECT 1 FROM public.auto_accounts WHERE id = v_account_id)
    OR EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id = v_campaign_id)
  THEN
    RAISE EXCEPTION 'v220_smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_account_id, '__v220_permission_account__', 'sms', false, false,
    'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_campaign_id, '__v220_permission_campaign__', v_action_id,
    v_account_id, 'chờ xử lý', '',
    now() - interval '1 minute', now() - interval '1 minute', 'direct',
    v_staff_id, v_organization_id, false
  );

  PERFORM pg_catalog.set_config(
    'aka_agent.v220_staff_id', v_staff_id::text, true
  );
END;
$fixture$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;
DO $anon_direct_claim$
DECLARE
  v_staff_id bigint := current_setting('aka_agent.v220_staff_id')::bigint;
BEGIN
  IF v_staff_id = 0 THEN RETURN; END IF;
  IF NOT public.claim_campaign_runtime(
    8800220000000002, 8800220000000001, v_staff_id, 'desktop'
  ) THEN
    RAISE EXCEPTION 'v220_smoke: anon direct campaign claim returned false';
  END IF;
END;
$anon_direct_claim$;
RESET ROLE;

DO $reset_after_anon$
BEGIN
  IF current_setting('aka_agent.v220_staff_id')::bigint = 0 THEN RETURN; END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id = 8800220000000002)
      IS DISTINCT FROM 'đang chạy'
    OR (SELECT status FROM public.auto_accounts WHERE id = 8800220000000001)
      IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION 'v220_smoke: anon claim did not atomically claim both rows';
  END IF;
  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý'
  WHERE id = 8800220000000002;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = 8800220000000001;
END;
$reset_after_anon$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $authenticated_direct_claim$
DECLARE
  v_staff_id bigint := current_setting('aka_agent.v220_staff_id')::bigint;
BEGIN
  IF v_staff_id = 0 THEN RETURN; END IF;
  IF NOT public.claim_campaign_runtime(
    8800220000000002, 8800220000000001, v_staff_id, 'desktop'
  ) THEN
    RAISE EXCEPTION 'v220_smoke: authenticated direct campaign claim returned false';
  END IF;
END;
$authenticated_direct_claim$;
RESET ROLE;

DO $prepare_hard_end_race$
BEGIN
  IF current_setting('aka_agent.v220_staff_id')::bigint = 0 THEN RETURN; END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id = 8800220000000002)
      IS DISTINCT FROM 'đang chạy'
    OR (SELECT status FROM public.auto_accounts WHERE id = 8800220000000001)
      IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION 'v220_smoke: authenticated claim did not atomically claim both rows';
  END IF;
  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý',
      data_target_source_mode = 'data_group',
      schedule_end_date = now() - interval '1 minute'
  WHERE id = 8800220000000002;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = 8800220000000001;
END;
$prepare_hard_end_race$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;
DO $anon_hard_end_race$
DECLARE
  v_staff_id bigint := current_setting('aka_agent.v220_staff_id')::bigint;
BEGIN
  IF v_staff_id = 0 THEN RETURN; END IF;
  IF public.claim_campaign_runtime(
    8800220000000002, 8800220000000001, v_staff_id, 'desktop'
  ) THEN
    RAISE EXCEPTION 'v220_smoke: anon claimed a hard-ended Data Group campaign';
  END IF;
END;
$anon_hard_end_race$;
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $authenticated_hard_end_race$
DECLARE
  v_staff_id bigint := current_setting('aka_agent.v220_staff_id')::bigint;
BEGIN
  IF v_staff_id = 0 THEN RETURN; END IF;
  IF public.claim_campaign_runtime(
    8800220000000002, 8800220000000001, v_staff_id, 'desktop'
  ) THEN
    RAISE EXCEPTION 'v220_smoke: authenticated claimed a hard-ended Data Group campaign';
  END IF;
END;
$authenticated_hard_end_race$;
RESET ROLE;

DO $hard_end_state$
BEGIN
  IF current_setting('aka_agent.v220_staff_id')::bigint = 0 THEN RETURN; END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id = 8800220000000002)
      IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_accounts WHERE id = 8800220000000001)
      IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v220_smoke: hard-end claim race changed durable state';
  END IF;
END;
$hard_end_state$;

-- Exercise the Server runtime as the exact Data API roles. Use an existing
-- staff whose effective Product 16/18 row grants additive Server capability
-- and still has one free Zalo slot. Environments without such a staff retain
-- all metadata/Desktop coverage above and skip only this optional behavior
-- fixture.
--
-- The expired-path finalizer completes a campaign, whose unrelated email
-- notification trigger may consume a non-transactional sequence value even
-- though this smoke ends in ROLLBACK. Disable only that trigger transactionally
-- and restore it before the test finishes. Every fixture ID is also explicit.
ALTER TABLE public.auto_campaigns
  DISABLE TRIGGER trg_aka_agent_enqueue_campaign_completed_email;

DO $server_fixture$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_action_id text;
  v_server_account_id constant bigint := 8800220000001001;
  v_direct_campaign_id constant bigint := 8800220000001002;
  v_data_group_id constant bigint := 8800220000001003;
  v_anon_expired_campaign_id constant bigint := 8800220000001004;
  v_anon_source_id constant bigint := 8800220000001005;
  v_authenticated_expired_campaign_id constant bigint := 8800220000001006;
  v_authenticated_source_id constant bigint := 8800220000001007;
BEGIN
  PERFORM pg_catalog.set_config('aka_agent.v220_server_staff_id', '0', true);

  SELECT action.id
  INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.id = 'zalo_message_friend'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  LIMIT 1;

  SELECT candidate.staff_id, candidate.organization_id
  INTO v_staff_id, v_organization_id
  FROM (
    SELECT
      staff.id AS staff_id,
      staff.organization_id,
      capabilities.max_accounts,
      (
        SELECT count(*)::integer
        FROM public.auto_accounts AS account
        WHERE account.staff_id = staff.id
          AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_delete, false) = false
      ) AS active_zalo_count
    FROM public.org_staff AS staff
    CROSS JOIN LATERAL
      public.resolve_organization_zalo_account_capabilities(
        staff.organization_id
      ) AS capabilities
    WHERE staff.is_active = true
      AND staff.organization_id IS NOT NULL
      AND COALESCE(capabilities.qr_enabled, false) = true
      AND COALESCE(capabilities.server_enabled, false) = true
  ) AS candidate
  WHERE candidate.max_accounts IS NULL
    OR candidate.max_accounts <= 0
    OR candidate.active_zalo_count < candidate.max_accounts
  ORDER BY candidate.active_zalo_count, candidate.staff_id
  LIMIT 1;

  IF v_staff_id IS NULL OR v_organization_id IS NULL OR v_action_id IS NULL THEN
    RAISE NOTICE
      'v220_smoke: Server-capable staff with spare quota or zalo_message_friend action missing; Server behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('aka-agent-v220-server-role-smoke', 0)
  );

  IF EXISTS (
      SELECT 1 FROM public.auto_accounts
      WHERE id = v_server_account_id
    )
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns
      WHERE id IN (
        v_direct_campaign_id,
        v_anon_expired_campaign_id,
        v_authenticated_expired_campaign_id
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.auto_account_contact_groups
      WHERE id = v_data_group_id
    )
    OR EXISTS (
      SELECT 1 FROM public.auto_campaign_data_group_sources
      WHERE id IN (v_anon_source_id, v_authenticated_source_id)
    )
  THEN
    RAISE EXCEPTION 'v220_smoke: reserved Server fixture ID collision';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_server_account_id, '__v220_server_role_account__',
    'zalo', false, true,
    'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_direct_campaign_id, '__v220_server_direct__', v_action_id,
    v_server_account_id, 'chờ xử lý', '',
    now() - interval '1 minute', now() - interval '1 minute', 'direct',
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_account_contact_groups (
    id, account_id, contact_type, name, purpose,
    staff_id, organization_id, is_delete
  ) VALUES (
    v_data_group_id, NULL, NULL, '__v220_server_role_group__', 'data_group',
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, schedule_end_date,
    data_target_source_mode, data_group_id,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_anon_expired_campaign_id, '__v220_server_expired_anon__',
      v_action_id, v_server_account_id, 'chờ xử lý', '',
      now() - interval '2 minutes', now() - interval '2 minutes',
      now() - interval '1 minute', 'data_group', v_data_group_id,
      v_staff_id, v_organization_id, false
    ),
    (
      v_authenticated_expired_campaign_id, '__v220_server_expired_auth__',
      v_action_id, v_server_account_id, 'chờ xử lý', '',
      now() - interval '2 minutes', now() - interval '2 minutes',
      now() - interval '1 minute', 'data_group', v_data_group_id,
      v_staff_id, v_organization_id, false
    );

  INSERT INTO public.auto_campaign_data_group_sources (
    id, campaign_id, group_id, baseline_revision,
    status, started_at, staff_id, organization_id
  ) VALUES
    (
      v_anon_source_id, v_anon_expired_campaign_id, v_data_group_id, 0,
      'active', now(), v_staff_id, v_organization_id
    ),
    (
      v_authenticated_source_id,
      v_authenticated_expired_campaign_id,
      v_data_group_id,
      0, 'active', now(), v_staff_id, v_organization_id
    );

  PERFORM pg_catalog.set_config(
    'aka_agent.v220_server_staff_id', v_staff_id::text, true
  );
END;
$server_fixture$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;
DO $anon_server_direct_claim$
DECLARE
  v_staff_id bigint :=
    current_setting('aka_agent.v220_server_staff_id')::bigint;
BEGIN
  IF v_staff_id = 0 THEN RETURN; END IF;
  IF NOT public.claim_campaign_runtime(
    8800220000001002, 8800220000001001, v_staff_id, 'server'
  ) THEN
    RAISE EXCEPTION 'v220_smoke: anon Server direct campaign claim returned false';
  END IF;
END;
$anon_server_direct_claim$;
RESET ROLE;

DO $reset_after_anon_server_direct$
BEGIN
  IF current_setting('aka_agent.v220_server_staff_id')::bigint = 0 THEN
    RETURN;
  END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id = 8800220000001002)
      IS DISTINCT FROM 'đang chạy'
    OR (SELECT status FROM public.auto_accounts WHERE id = 8800220000001001)
      IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION
      'v220_smoke: anon Server claim did not atomically claim both rows';
  END IF;
  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý', note = NULL
  WHERE id = 8800220000001002;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = 8800220000001001;
END;
$reset_after_anon_server_direct$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $authenticated_server_direct_claim$
DECLARE
  v_staff_id bigint :=
    current_setting('aka_agent.v220_server_staff_id')::bigint;
BEGIN
  IF v_staff_id = 0 THEN RETURN; END IF;
  IF NOT public.claim_campaign_runtime(
    8800220000001002, 8800220000001001, v_staff_id, 'server'
  ) THEN
    RAISE EXCEPTION
      'v220_smoke: authenticated Server direct campaign claim returned false';
  END IF;
END;
$authenticated_server_direct_claim$;
RESET ROLE;

DO $reset_after_authenticated_server_direct$
BEGIN
  IF current_setting('aka_agent.v220_server_staff_id')::bigint = 0 THEN
    RETURN;
  END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id = 8800220000001002)
      IS DISTINCT FROM 'đang chạy'
    OR (SELECT status FROM public.auto_accounts WHERE id = 8800220000001001)
      IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION
      'v220_smoke: authenticated Server claim did not atomically claim both rows';
  END IF;
  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý', note = NULL
  WHERE id = 8800220000001002;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = 8800220000001001;
END;
$reset_after_authenticated_server_direct$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;
DO $anon_server_expired_claim$
DECLARE
  v_staff_id bigint :=
    current_setting('aka_agent.v220_server_staff_id')::bigint;
BEGIN
  IF v_staff_id = 0 THEN RETURN; END IF;
  IF public.claim_campaign_runtime(
    8800220000001004, 8800220000001001, v_staff_id, 'server'
  ) THEN
    RAISE EXCEPTION 'v220_smoke: anon claimed expired Server Data Group';
  END IF;
END;
$anon_server_expired_claim$;
RESET ROLE;

DO $anon_server_expired_state$
BEGIN
  IF current_setting('aka_agent.v220_server_staff_id')::bigint = 0 THEN
    RETURN;
  END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id = 8800220000001004)
      IS DISTINCT FROM 'hoàn thành'
    OR (SELECT status FROM public.auto_accounts WHERE id = 8800220000001001)
      IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_campaign_data_group_sources
        WHERE id = 8800220000001005) IS DISTINCT FROM 'stopped'
    OR (SELECT stop_reason FROM public.auto_campaign_data_group_sources
        WHERE id = 8800220000001005) IS DISTINCT FROM 'hard_end_reached'
  THEN
    RAISE EXCEPTION
      'v220_smoke: anon Server hard-end wrapper did not finalize atomically';
  END IF;
END;
$anon_server_expired_state$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
DO $authenticated_server_expired_claim$
DECLARE
  v_staff_id bigint :=
    current_setting('aka_agent.v220_server_staff_id')::bigint;
BEGIN
  IF v_staff_id = 0 THEN RETURN; END IF;
  IF public.claim_campaign_runtime(
    8800220000001006, 8800220000001001, v_staff_id, 'server'
  ) THEN
    RAISE EXCEPTION
      'v220_smoke: authenticated claimed expired Server Data Group';
  END IF;
END;
$authenticated_server_expired_claim$;
RESET ROLE;

DO $authenticated_server_expired_state$
BEGIN
  IF current_setting('aka_agent.v220_server_staff_id')::bigint = 0 THEN
    RETURN;
  END IF;
  IF (SELECT status FROM public.auto_campaigns WHERE id = 8800220000001006)
      IS DISTINCT FROM 'hoàn thành'
    OR (SELECT status FROM public.auto_accounts WHERE id = 8800220000001001)
      IS DISTINCT FROM 'chờ xử lý'
    OR (SELECT status FROM public.auto_campaign_data_group_sources
        WHERE id = 8800220000001007) IS DISTINCT FROM 'stopped'
    OR (SELECT stop_reason FROM public.auto_campaign_data_group_sources
        WHERE id = 8800220000001007) IS DISTINCT FROM 'hard_end_reached'
  THEN
    RAISE EXCEPTION
      'v220_smoke: authenticated Server hard-end wrapper did not finalize atomically';
  END IF;
END;
$authenticated_server_expired_state$;

ALTER TABLE public.auto_campaigns
  ENABLE TRIGGER trg_aka_agent_enqueue_campaign_completed_email;

ROLLBACK;

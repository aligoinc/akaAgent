-- V489: Desktop reads the campaign detail "Báo cáo" tab through the V487 reader with its own token.
--
-- Grants EXECUTE on public.aka_agent_read_campaign_run_report to aka_agent_desktop, the same ACL as the
-- report readers Desktop already calls (aka_agent_read_report_page, aka_agent_read_campaign_effectiveness V462,
-- aka_agent_read_data_report V469). Nothing else changes: no function body, attribute, table, index, policy,
-- role/global timeout, pool or connection change, and no COMMENT (COMMENT fires pgrst_ddl_watch, GRANT does not),
-- so PostgREST does not reload its schema cache; the V487 comment still says "service_role only".
-- Identity is unchanged: auto_assert_automation_identity binds the Desktop token to p_staff_id
-- (private.aka_agent_assert_request_ownership) and then requires that staff's automation username/password.
-- The reader stays read-only (STABLE) with its 60 s statement limit; Desktop calls it once per open/refresh.
-- Rollback: migrations/rollback_v489_campaign_run_report_desktop.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  v_fn regprocedure := to_regprocedure('public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb)');
  v_grantees text[];
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v489_v487_reader_missing';
  END IF;
  IF to_regrole('aka_agent_desktop') IS NULL THEN
    RAISE EXCEPTION 'v489_desktop_role_missing';
  END IF;
  -- Exactly the V487 body and attributes that were applied on 10/11/2026.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM '4bd734ca25612bfdade631c779373d42' THEN
    RAISE EXCEPTION 'v489_reader_body_unexpected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = v_fn AND prosecdef AND provolatile = 's' AND pg_get_userbyid(proowner) = 'postgres'
      AND proconfig = ARRAY['search_path=pg_catalog, public', 'statement_timeout=60s']
  ) THEN
    RAISE EXCEPTION 'v489_reader_attributes_unexpected';
  END IF;
  SELECT array_agg(g ORDER BY g) INTO v_grantees FROM (
    SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
    FROM pg_proc pr, aclexplode(pr.proacl) a
    WHERE pr.oid = v_fn
  ) x;
  IF v_grantees = ARRAY['aka_agent_desktop', 'postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v489_already_applied_do_not_reapply';
  END IF;
  IF v_grantees IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v489_reader_acl_unexpected: %', v_grantees;
  END IF;
END
$preflight$;

GRANT EXECUTE ON FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) TO aka_agent_desktop;

DO $postflight$
DECLARE
  v_fn regprocedure := to_regprocedure('public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb)');
  v_grantees text[];
BEGIN
  SELECT array_agg(g ORDER BY g) INTO v_grantees FROM (
    SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
    FROM pg_proc pr, aclexplode(pr.proacl) a
    WHERE pr.oid = v_fn
  ) x;
  IF v_grantees IS DISTINCT FROM ARRAY['aka_agent_desktop', 'postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v489_reader_acl_unexpected_after_grant: %', v_grantees;
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v489_public_roles_can_execute';
  END IF;
  IF NOT has_function_privilege('aka_agent_desktop', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v489_desktop_cannot_execute';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM '4bd734ca25612bfdade631c779373d42' THEN
    RAISE EXCEPTION 'v489_reader_body_changed';
  END IF;
END
$postflight$;
COMMIT;

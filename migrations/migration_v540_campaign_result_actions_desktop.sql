-- V540: Desktop reads the "Hành động" filter and the "Gộp hành động vào một dòng" view of the campaign "Kết quả chạy"
-- tab through the two V539 readers with its own token (docs/CAMPAIGN_RESULT_ACTION_FILTER_DESKTOP_V540.md).
--
-- Grants EXECUTE on public.aka_agent_list_campaign_details_page_v3 and public.aka_agent_read_campaign_result_recipients
-- to aka_agent_desktop, the same ACL as the v2 results reader Desktop already calls and as V489 for the V487 report
-- reader. Nothing else changes: no function body, attribute, table, index, policy, role/global timeout, pool or
-- connection change, and no COMMENT (COMMENT fires pgrst_ddl_watch, GRANT does not), so PostgREST does not reload its
-- schema cache. Identity is unchanged: both readers first bind the Desktop token to p_staff_id
-- (private.aka_agent_assert_request_ownership) and then require that staff's automation username/password
-- (auto_assert_automation_identity). The readers stay read-only (STABLE) with their 60 s statement limit and jit off.
-- Rollback: migrations/rollback_v540_campaign_result_actions_desktop.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  v_page regprocedure := to_regprocedure('public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text,text)');
  v_recipients regprocedure := to_regprocedure('public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb)');
  v_fn regprocedure;
  v_grantees text[];
  v_applied int := 0;
BEGIN
  IF v_page IS NULL OR v_recipients IS NULL THEN
    RAISE EXCEPTION 'v540_v539_readers_missing';
  END IF;
  IF to_regrole('aka_agent_desktop') IS NULL THEN
    RAISE EXCEPTION 'v540_desktop_role_missing';
  END IF;
  -- Exactly the V539 bodies and attributes that were applied on 14/11/2026.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_page) IS DISTINCT FROM '4e5c300305409908295c49d5d1941224' THEN
    RAISE EXCEPTION 'v540_page_reader_body_unexpected';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_recipients) IS DISTINCT FROM '3fe7e5982398b42cc73fcc0433109b05' THEN
    RAISE EXCEPTION 'v540_recipients_reader_body_unexpected';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[v_page, v_recipients] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE oid = v_fn AND prosecdef AND provolatile = 's' AND pg_get_userbyid(proowner) = 'postgres'
        AND proconfig = ARRAY['search_path=pg_catalog, public', 'statement_timeout=60s', 'jit=off']
    ) THEN
      RAISE EXCEPTION 'v540_reader_attributes_unexpected: %', v_fn;
    END IF;
    SELECT array_agg(g ORDER BY g) INTO v_grantees FROM (
      SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
      FROM pg_proc pr, aclexplode(pr.proacl) a
      WHERE pr.oid = v_fn
    ) x;
    IF v_grantees = ARRAY['aka_agent_desktop', 'postgres', 'service_role'] THEN
      v_applied := v_applied + 1;
    ELSIF v_grantees IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN
      RAISE EXCEPTION 'v540_reader_acl_unexpected: % %', v_fn, v_grantees;
    END IF;
  END LOOP;
  IF v_applied = 2 THEN
    RAISE EXCEPTION 'v540_already_applied_do_not_reapply';
  END IF;
  IF v_applied = 1 THEN
    RAISE EXCEPTION 'v540_partially_applied_check_acl_by_hand';
  END IF;
END
$preflight$;

GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text,text) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb) TO aka_agent_desktop;

DO $postflight$
DECLARE
  v_page regprocedure := to_regprocedure('public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text,text)');
  v_recipients regprocedure := to_regprocedure('public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb)');
  v_fn regprocedure;
  v_grantees text[];
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[v_page, v_recipients] LOOP
    SELECT array_agg(g ORDER BY g) INTO v_grantees FROM (
      SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
      FROM pg_proc pr, aclexplode(pr.proacl) a
      WHERE pr.oid = v_fn
    ) x;
    IF v_grantees IS DISTINCT FROM ARRAY['aka_agent_desktop', 'postgres', 'service_role'] THEN
      RAISE EXCEPTION 'v540_reader_acl_unexpected_after_grant: % %', v_fn, v_grantees;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'v540_public_roles_can_execute: %', v_fn;
    END IF;
    IF NOT has_function_privilege('aka_agent_desktop', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'v540_desktop_cannot_execute: %', v_fn;
    END IF;
  END LOOP;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_page) IS DISTINCT FROM '4e5c300305409908295c49d5d1941224'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_recipients) IS DISTINCT FROM '3fe7e5982398b42cc73fcc0433109b05' THEN
    RAISE EXCEPTION 'v540_reader_body_changed';
  END IF;
END
$postflight$;
COMMIT;

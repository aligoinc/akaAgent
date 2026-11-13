-- V522: Desktop uses "Bỏ data đã có trong nhóm này / ở nhóm data khác" of the data-group import window through the
-- V519 reader with its own token.
--
-- Grants EXECUTE on public.aka_agent_read_data_group_member_matches to aka_agent_desktop, the same ACL as the readers
-- Desktop already calls with its token (V493 campaign input duplicates, V489 campaign run report, V462 effectiveness).
-- Nothing else changes: no function body, attribute, table, index, policy, setting, role/global timeout, pool or
-- connection change, and no COMMENT (COMMENT fires pgrst_ddl_watch, GRANT does not), so PostgREST does not reload its
-- schema cache.
-- Identity is unchanged: auto_assert_automation_identity binds the Desktop token to p_staff_id
-- (private.aka_agent_assert_request_ownership) and then requires that staff's automation username/password; the V519
-- body then requires the target group to be a data group owned by that staff in that organization and only reads
-- contacts, memberships and groups of that staff.
-- The reader stays read-only (STABLE) with its 15 s statement limit; Desktop calls it once per 1,000 identities only
-- when the customer checks or adds a list in the data-group import window, and reads the optional "groupMatches"
-- field of the web.campaign_input_duplicates switch itself (missing = on, false = off).
-- Numbering: V520/V521 are held by another branch (notification_package_expiring, renewal_link_tickets).
-- Rollback: migrations/rollback_v522_data_group_member_matches_desktop.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  v_fn regprocedure := to_regprocedure('public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb)');
  v_grantees text[];
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v522_v519_reader_missing';
  END IF;
  IF to_regrole('aka_agent_desktop') IS NULL THEN
    RAISE EXCEPTION 'v522_desktop_role_missing';
  END IF;
  -- Exactly the V519 body and attributes that were applied on 13/11/2026 19:57:24 VN.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM '0fffb42b865b8be45bf5a7f2f4e2db17' THEN
    RAISE EXCEPTION 'v522_reader_body_unexpected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = v_fn AND prosecdef AND provolatile = 's' AND pg_get_userbyid(proowner) = 'postgres'
      AND proconfig = ARRAY['search_path=pg_catalog, public', 'statement_timeout=15s']
  ) THEN
    RAISE EXCEPTION 'v522_reader_attributes_unexpected';
  END IF;
  SELECT array_agg(g ORDER BY g) INTO v_grantees FROM (
    SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
    FROM pg_proc pr, aclexplode(pr.proacl) a
    WHERE pr.oid = v_fn
  ) x;
  IF v_grantees = ARRAY['aka_agent_desktop', 'postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v522_already_applied_do_not_reapply';
  END IF;
  IF v_grantees IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v522_reader_acl_unexpected: %', v_grantees;
  END IF;
END
$preflight$;

GRANT EXECUTE ON FUNCTION public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb) TO aka_agent_desktop;

DO $postflight$
DECLARE
  v_fn regprocedure := to_regprocedure('public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb)');
  v_grantees text[];
BEGIN
  SELECT array_agg(g ORDER BY g) INTO v_grantees FROM (
    SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
    FROM pg_proc pr, aclexplode(pr.proacl) a
    WHERE pr.oid = v_fn
  ) x;
  IF v_grantees IS DISTINCT FROM ARRAY['aka_agent_desktop', 'postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v522_reader_acl_unexpected_after_grant: %', v_grantees;
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v522_public_roles_can_execute';
  END IF;
  IF NOT has_function_privilege('aka_agent_desktop', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v522_desktop_cannot_execute';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM '0fffb42b865b8be45bf5a7f2f4e2db17' THEN
    RAISE EXCEPTION 'v522_reader_body_changed';
  END IF;
END
$postflight$;
COMMIT;

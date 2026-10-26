-- Execute after the candidate definition within a transaction that rolls back.
-- Read-only real-data parity; no fixture writes, campaigns or external sends.
SET LOCAL ROLE anon;
DO $smoke$
DECLARE
  v_scope record;
  v_uids text[];
  v_old jsonb;
  v_new jsonb;
BEGIN
  FOR v_scope IN
    SELECT * FROM (VALUES (1578::bigint,385::bigint),(1581,385),(1175,246)) s(account_id,staff_id)
  LOOP
    SELECT array_agg(zalo_uid) INTO v_uids FROM (
      SELECT zalo_uid FROM public.zalo_users
      WHERE account_id=v_scope.account_id AND staff_id=v_scope.staff_id
      ORDER BY zalo_uid LIMIT 100
    ) sample;
    SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]'::jsonb) INTO v_old
      FROM public.zalo_users u WHERE account_id=v_scope.account_id
      AND staff_id=v_scope.staff_id AND zalo_uid=ANY(v_uids);
    SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]'::jsonb) INTO v_new
      FROM public.aka_agent_lookup_zalo_users(v_scope.account_id,v_scope.staff_id,v_uids) u;
    IF v_old IS DISTINCT FROM v_new THEN RAISE EXCEPTION 'V432 parity mismatch'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]'::jsonb) INTO v_new
      FROM public.aka_agent_lookup_zalo_users(v_scope.account_id,v_scope.staff_id,NULL) u;
    IF v_new <> '[]'::jsonb THEN RAISE EXCEPTION 'V432 null array mismatch'; END IF;
  END LOOP;
  BEGIN
    PERFORM * FROM public.aka_agent_lookup_zalo_users(1578,385,array_fill('invalid'::text,ARRAY[101]));
    RAISE EXCEPTION 'V432 missing batch guard';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END
$smoke$;
RESET ROLE;
SELECT p.oid::regprocedure::text AS signature, md5(pg_get_functiondef(p.oid)) AS checksum,
  pg_get_userbyid(p.proowner) AS owner, p.prosecdef,p.provolatile,p.proconfig,p.proacl::text AS acl
FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_lookup_zalo_users(bigint,bigint,text[])');

-- Pure policy parity, including legacy equality/NULL cutoff semantics. No customer writes.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
DO $test$
DECLARE r record; expected boolean; actual boolean; cases integer:=0; caller text;
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  FOR r IN
    SELECT n.at, s.schedule, m.source_mode, e.end_at, t.stop_at, l.legacy
    FROM (VALUES
      (timestamptz '2026-10-14 17:00:00+07'),
      (timestamptz '2026-10-14 23:59:00+07'),
      (timestamptz '2026-10-15 00:00:00+07')
    ) n(at)
    CROSS JOIN LATERAL (VALUES (NULL::timestamptz),(n.at-interval '1 second'),(n.at),(n.at+interval '1 second')) s(schedule)
    CROSS JOIN (VALUES (NULL::text),('direct'),('data_group')) m(source_mode)
    CROSS JOIN LATERAL (VALUES (NULL::timestamptz),(n.at-interval '1 second'),(n.at),(n.at+interval '1 second')) e(end_at)
    CROSS JOIN (VALUES (NULL::time),(time '00:00'),(time '17:00'),(time '23:59'),(time '23:59:59')) t(stop_at)
    CROSS JOIN (VALUES (false),(true)) l(legacy)
  LOOP
    expected:=r.schedule IS NOT NULL AND r.schedule<=r.at
      AND (r.source_mode IS DISTINCT FROM 'data_group' OR r.end_at IS NULL OR r.end_at>r.at)
      AND CASE WHEN r.legacy
        THEN r.stop_at IS NULL OR NOT (r.stop_at < timezone('Asia/Ho_Chi_Minh',r.at)::time)
        ELSE timezone('Asia/Ho_Chi_Minh',r.at)::time<least(coalesce(r.stop_at,time '23:59'),time '23:59') END;
    actual:=private.campaign_dispatch_schedule_allowed(r.schedule,r.source_mode,r.end_at,r.stop_at,r.at,r.legacy);
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'v397 policy mismatch: %',row_to_json(r); END IF;
    cases:=cases+1;
  END LOOP;
  EXECUTE 'RESET ROLE';
  IF cases<>1440 THEN RAISE EXCEPTION 'v397 incomplete matrix: %',cases; END IF;
  FOREACH caller IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',caller);
    actual:=private.campaign_dispatch_schedule_allowed(
      timestamptz '2026-10-14 08:00+07','direct',NULL,NULL,timestamptz '2026-10-14 10:00+07',true);
    IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'v397 helper inaccessible for %',caller; END IF;
    EXECUTE 'RESET ROLE';
  END LOOP;
  -- The Management API role cannot SET ROLE aka_agent_chat_api. For this pure
  -- helper (no table access), assert its schema + function privileges directly.
  IF NOT has_schema_privilege('aka_agent_chat_api','private','USAGE')
    OR NOT has_function_privilege('aka_agent_chat_api',
      'private.campaign_dispatch_schedule_allowed(timestamptz,text,timestamptz,time,timestamptz,boolean)','EXECUTE')
  THEN RAISE EXCEPTION 'v397 Chat helper access missing'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a
    WHERE p.oid='private.campaign_dispatch_schedule_allowed(timestamptz,text,timestamptz,time,timestamptz,boolean)'::regprocedure
      AND a.grantee=0 AND a.privilege_type='EXECUTE')
  THEN RAISE EXCEPTION 'v397 helper exposed to PUBLIC'; END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid='private.campaign_dispatch_schedule_allowed(timestamptz,text,timestamptz,time,timestamptz,boolean)'::regprocedure)
  THEN RAISE EXCEPTION 'v397 helper must remain invoker'; END IF;
END $test$;
SELECT 'PASS v397: 1440 schedule cases, real anon helper access, no PUBLIC grant or security definer' AS result;
ROLLBACK;

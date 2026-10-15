-- Roll app readers back before removing this additive RPC. Rehearse with ROLLBACK.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
  IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc
    WHERE oid=to_regprocedure('public.aka_agent_read_report_page(bigint,bigint,text,text,jsonb)'))
    IS DISTINCT FROM '16822ed5a6af165668d9d3ed2d5283c2' THEN
    RAISE EXCEPTION 'report_reader_changed_do_not_drop';
  END IF;
END;$guard$;
DROP FUNCTION public.aka_agent_read_report_page(bigint,bigint,text,text,jsonb);
NOTIFY pgrst,'reload schema';
COMMIT;

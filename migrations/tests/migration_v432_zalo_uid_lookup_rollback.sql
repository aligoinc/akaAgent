-- Roll application callers back first; then remove only the audited RPC.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE v_oid regprocedure:=to_regprocedure('public.aka_agent_lookup_zalo_users(bigint,bigint,text[])');
BEGIN
  IF v_oid IS NULL OR md5(pg_get_functiondef(v_oid)) <> 'bbed74070ff8bf987c3311b5fb14bcfc' THEN
    RAISE EXCEPTION 'V432 rollback: missing or changed live function';
  END IF;
END
$guard$;
DROP FUNCTION public.aka_agent_lookup_zalo_users(bigint,bigint,text[]);
NOTIFY pgrst, 'reload schema';
COMMIT;

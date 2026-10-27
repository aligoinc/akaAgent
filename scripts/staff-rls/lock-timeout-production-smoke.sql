-- Read-only smoke; no customer row is returned or modified.
BEGIN;
SET LOCAL lock_timeout='250ms'; SET LOCAL statement_timeout='5s';
DO $test$ BEGIN IF EXISTS(SELECT 1 FROM public.org_staff WHERE id=9223372036854775807) THEN RAISE EXCEPTION 'smoke sentinel exists'; END IF; END $test$;
SET LOCAL ROLE anon;
DO $test$ DECLARE denied boolean:=false; n integer; BEGIN
 BEGIN PERFORM * FROM public.aka_agent_staff_runtime_scope(NULL,'share'); EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM='staff_runtime_scope_invalid' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'invalid staff accepted'; END IF;
 denied:=false;
 BEGIN PERFORM * FROM public.aka_agent_staff_runtime_scope(9223372036854775807,'invalid'); EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM='staff_runtime_scope_invalid' THEN denied:=true; ELSE RAISE; END IF; END;
 IF NOT denied THEN RAISE EXCEPTION 'invalid mode accepted'; END IF;
 SELECT count(*) INTO n FROM public.aka_agent_staff_runtime_scope(9223372036854775807,'share');
 IF n<>0 THEN RAISE EXCEPTION 'unexpected scope row'; END IF;
 SELECT count(*) INTO n FROM public.aka_agent_staff_runtime_scope(9223372036854775807,'update');
 IF n<>0 THEN RAISE EXCEPTION 'unexpected scope row'; END IF;
 IF current_setting('lock_timeout')<>'250ms' THEN RAISE EXCEPTION 'caller lock timeout changed'; END IF;
 IF current_setting('statement_timeout')<>'5s' THEN RAISE EXCEPTION 'caller statement timeout changed'; END IF;
END $test$;
ROLLBACK;

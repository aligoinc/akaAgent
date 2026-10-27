-- Permission-only regression: no customer row is read, locked or modified.
-- Requires an existing connection authorized to SET ROLE aka_agent_chat_api.
-- Supabase's managed postgres role may not allow this; use an isolated local fixture.
-- Never grant role membership merely to run this test or reapply the migration.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $permissions$
BEGIN
  IF NOT has_table_privilege('aka_agent_chat_api',
    'public.aka_agent_staff_runtime_profile', 'SELECT')
    OR NOT has_function_privilege('aka_agent_chat_api',
      'public.aka_agent_staff_runtime_scope(bigint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Chat worker is missing a staff runtime dependency grant';
  END IF;
  IF has_table_privilege('aka_agent_chat_api',
    'public.aka_agent_staff_runtime_profile',
    'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') THEN
    RAISE EXCEPTION 'Chat worker must not have write privileges on the runtime view';
  END IF;
END;
$permissions$;

SET LOCAL ROLE aka_agent_chat_api;
SELECT id FROM public.aka_agent_staff_runtime_profile LIMIT 0;
DO $scope$
DECLARE
  rejected boolean;
  lock_mode text;
BEGIN
  FOREACH lock_mode IN ARRAY ARRAY['share', 'update'] LOOP
    rejected := false;
    BEGIN
      PERFORM * FROM public.aka_agent_staff_runtime_scope(-1, lock_mode);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'staff_runtime_scope_invalid' THEN
        RAISE;
      END IF;
      rejected := true;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION 'Runtime scope must still reject invalid staff IDs';
    END IF;
  END LOOP;
END;
$scope$;
RESET ROLE;
SELECT 'staff runtime Chat dependency permissions: PASS' AS result;
ROLLBACK;

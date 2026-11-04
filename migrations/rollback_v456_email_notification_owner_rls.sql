-- Manual rollback for V456; never run automatically or as part of deployment.
-- Drops only the two RESTRICTIVE policies V456 added. This REOPENS the leak:
-- Desktop tokens can again read every staff's notification emails. Obtain an explicit
-- rollback instruction first. ACL, RLS, functions and other policies stay unchanged.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $email_rls_v456_rollback$
DECLARE rel regclass;
BEGIN
  FOREACH rel IN ARRAY ARRAY['public.auto_email_notification_settings'::regclass,
                             'public.auto_email_notification_deliveries'::regclass]
  LOOP
    IF (SELECT array_agg(p.polname::text ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = rel)
       IS DISTINCT FROM ARRAY['v435_existing_role_access','v456_desktop_owner'] THEN
      RAISE EXCEPTION 'rollback v456: unexpected policies on %', rel;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = rel AND p.polname = 'v456_desktop_owner'
        AND NOT p.polpermissive AND p.polcmd = '*'
        AND p.polroles = ARRAY['aka_agent_desktop'::regrole::oid]
        AND pg_get_expr(p.polqual, p.polrelid) = '(staff_id = ( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request))'
        AND pg_get_expr(p.polwithcheck, p.polrelid) = '(staff_id = ( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request))'
    ) THEN RAISE EXCEPTION 'rollback v456: v456_desktop_owner drift on %', rel; END IF;
  END LOOP;
END
$email_rls_v456_rollback$;

DROP POLICY v456_desktop_owner ON public.auto_email_notification_settings;
DROP POLICY v456_desktop_owner ON public.auto_email_notification_deliveries;

COMMIT;

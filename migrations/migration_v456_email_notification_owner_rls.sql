-- V456: Desktop token chỉ đọc/ghi cài đặt và outbox thông báo email của chính staff.
-- Lỗ hổng: v435_existing_role_access là PERMISSIVE USING (true) cho aka_agent_desktop,
-- kèm SELECT cả bảng auto_email_notification_settings, nên token Desktop đọc được
-- email nhận thông báo của mọi staff và chèn outbox cho staff khác.
-- Cách sửa giống V436: thêm RESTRICTIVE policy theo private.aka_agent_staff_scope_for_request(),
-- AND với policy cũ. Không đổi ACL, không bật/tắt RLS, không sửa hàm/trigger hay policy role khác.
-- Desktop cũ (upsert 9 cột onConflict staff_id + RETURNING) và trigger
-- aka_agent_enqueue_campaign_completed_email (SECURITY INVOKER) vẫn chạy: Desktop chỉ sửa được
-- chiến dịch của mình (desktop_owned_resource) nên trigger chỉ chèn outbox cho chính staff đó.
-- Preflight fail-closed theo trạng thái live đọc ngày 04/11/2026; drift thì dừng.
-- Rollback thủ công: migrations/rollback_v456_email_notification_owner_rls.sql.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $email_rls_v456_preflight$
DECLARE
  t record;
  policy_names text[];
  expected_roles text[] := ARRAY['aka_agent_desktop','aka_message_ingest_owner','authenticator','cli_login_postgres','dashboard_user','pg_checkpoint','pg_create_subscription','pg_database_owner','pg_execute_server_program','pg_maintain','pg_monitor','pg_read_all_data','pg_read_all_settings','pg_read_all_stats','pg_read_server_files','pg_signal_backend','pg_stat_scan_tables','pg_use_reserved_connections','pg_write_all_data','pg_write_server_files','pgbouncer','supabase_auth_admin','supabase_functions_admin','supabase_privileged_role','supabase_realtime_admin','supabase_replication_admin','supabase_storage_admin'];
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('public.auto_email_notification_settings',
       '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=r/postgres,aka_agent_desktop=r/postgres}',
       '[{"col":"staff_id","acl":"{aka_agent_desktop=aw/postgres}"},{"col":"organization_id","acl":"{aka_agent_desktop=aw/postgres}"},{"col":"is_enabled","acl":"{aka_agent_desktop=aw/postgres}"},{"col":"recipient_emails","acl":"{aka_agent_desktop=aw/postgres}"},{"col":"notify_campaign_completed","acl":"{aka_agent_desktop=aw/postgres}"},{"col":"daily_report_enabled","acl":"{aka_agent_desktop=aw/postgres}"},{"col":"daily_report_time","acl":"{aka_agent_desktop=aw/postgres}"},{"col":"is_delete","acl":"{aka_agent_desktop=aw/postgres}"},{"col":"updated_at","acl":"{aka_agent_desktop=aw/postgres}"}]'),
      ('public.auto_email_notification_deliveries',
       '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,aka_agent_chat_api=ar/postgres}',
       '[{"col":"staff_id","acl":"{aka_agent_desktop=a/postgres}"},{"col":"type","acl":"{aka_agent_desktop=a/postgres}"},{"col":"dedupe_key","acl":"{aka_agent_desktop=a/postgres}"},{"col":"payload","acl":"{aka_agent_desktop=a/postgres}"}]')
    ) AS v(rel, table_acl, column_acl)
  LOOP
    IF to_regclass(t.rel) IS NULL THEN RAISE EXCEPTION 'v456: missing %', t.rel; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid = to_regclass(t.rel) AND c.relrowsecurity AND NOT c.relforcerowsecurity
        AND pg_get_userbyid(c.relowner) = 'postgres'
        AND c.relacl::text IS NOT DISTINCT FROM t.table_acl
    ) THEN RAISE EXCEPTION 'v456: owner/RLS/ACL drift on %', t.rel; END IF;
    IF (SELECT coalesce(jsonb_agg(jsonb_build_object('col', a.attname, 'acl', a.attacl::text) ORDER BY a.attnum), '[]'::jsonb)
        FROM pg_attribute a
        WHERE a.attrelid = to_regclass(t.rel) AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
       IS DISTINCT FROM t.column_acl::jsonb
    THEN RAISE EXCEPTION 'v456: column ACL drift on %', t.rel; END IF;
    SELECT array_agg(p.polname::text ORDER BY p.polname) INTO policy_names
    FROM pg_policy p WHERE p.polrelid = to_regclass(t.rel);
    IF policy_names IS DISTINCT FROM ARRAY['v435_existing_role_access'] THEN
      RAISE EXCEPTION 'v456: unexpected policies on %: %', t.rel, policy_names;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = to_regclass(t.rel) AND p.polname = 'v435_existing_role_access'
        AND p.polpermissive AND p.polcmd = '*'
        AND pg_get_expr(p.polqual, p.polrelid) = 'true'
        AND pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
        AND (SELECT array_agg(r.rolname::text ORDER BY r.rolname::text) FROM pg_roles r WHERE r.oid = ANY (p.polroles))
            = (SELECT array_agg(x ORDER BY x) FROM unnest(expected_roles) x)
    ) THEN RAISE EXCEPTION 'v456: v435_existing_role_access drift on %', t.rel; END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('private.aka_agent_staff_scope_for_request()')
      AND md5(pg_get_functiondef(p.oid)) = 'd417807fa9dc08cfecbd6cd0aab7df3e'
      AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
      AND has_function_privilege('aka_agent_desktop', p.oid, 'EXECUTE')
  ) THEN RAISE EXCEPTION 'v456: staff scope helper drift'; END IF;

  -- The completion trigger must still run as the caller (it inserts under these policies).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.aka_agent_enqueue_campaign_completed_email()')
      AND md5(pg_get_functiondef(p.oid)) = '0523c07b0878e3aaa53efb0bc97a74b8'
      AND NOT p.prosecdef
  ) THEN RAISE EXCEPTION 'v456: campaign completion trigger drift'; END IF;
END
$email_rls_v456_preflight$;

CREATE POLICY v456_desktop_owner ON public.auto_email_notification_settings
  AS RESTRICTIVE FOR ALL TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request()))
  WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));

CREATE POLICY v456_desktop_owner ON public.auto_email_notification_deliveries
  AS RESTRICTIVE FOR ALL TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request()))
  WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));

DO $email_rls_v456_postcheck$
BEGIN
  IF (SELECT count(*) FROM pg_policy p
      WHERE p.polname = 'v456_desktop_owner' AND NOT p.polpermissive AND p.polcmd = '*'
        AND p.polroles = ARRAY['aka_agent_desktop'::regrole::oid]
        AND p.polrelid IN ('public.auto_email_notification_settings'::regclass,
                           'public.auto_email_notification_deliveries'::regclass)) <> 2
  THEN RAISE EXCEPTION 'v456: postcheck failed'; END IF;
END
$email_rls_v456_postcheck$;

COMMIT;

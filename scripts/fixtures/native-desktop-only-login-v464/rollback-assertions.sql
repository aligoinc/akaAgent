-- Sau rollback v464: hàm về đúng bản V461, phiên native của tổ chức chỉ có Desktop lại bị từ chối.
DELETE FROM auto_control_sessions WHERE token_hash LIKE 'v464-rb-%';
INSERT INTO auto_control_sessions(id, staff_id, organization_id, token_hash, client_type, expires_at) VALUES
  (gen_random_uuid(), 70, 10, 'v464-rb-native-10', 'native', now() + interval '1 day'),
  (gen_random_uuid(), 70, 10, 'v464-rb-pwa-10', 'pwa', now() + interval '1 day');
DO $t$
DECLARE v jsonb;
BEGIN
  ASSERT md5(pg_get_functiondef('public.aka_agent_authenticate_control_session(text)'::regprocedure))
    = 'de8f93ee545bca94a199b2dffb9fe324', 'rollback restores V461 md5';
  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[10],"desktopOnlyLogin":true}'
  WHERE key = 'web.desktop_accounts';
  v := aka_agent_authenticate_control_session('v464-rb-native-10');
  ASSERT v->>'status' = 'capability_unavailable', 'native blocked again after rollback ' || v::text;
  v := aka_agent_authenticate_control_session('v464-rb-pwa-10');
  ASSERT v->>'status' = 'authenticated', 'pwa still allowed after rollback ' || v::text;
  UPDATE auto_system_settings SET value = '{"enabled":false,"organizationIds":null,"desktopOnlyLogin":false}'
  WHERE key = 'web.desktop_accounts';
END
$t$;

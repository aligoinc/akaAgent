-- v462 sau khi apply: chỉ phiên native của tổ chức chỉ có Desktop đổi hành vi, và chỉ khi bật desktopOnlyLogin.
DELETE FROM auto_control_sessions WHERE token_hash LIKE 'v462-%';
INSERT INTO auto_control_sessions(id, staff_id, organization_id, token_hash, client_type, expires_at) VALUES
  (gen_random_uuid(), 70, 10, 'v462-native-10a', 'native', now() + interval '1 day'),
  (gen_random_uuid(), 70, 10, 'v462-native-10b', 'native', now() + interval '1 day'),
  (gen_random_uuid(), 70, 10, 'v462-native-10c', 'native', now() + interval '1 day'),
  (gen_random_uuid(), 70, 10, 'v462-pwa-10', 'pwa', now() + interval '1 day'),
  (gen_random_uuid(), 7, 9, 'v462-native-9', 'native', now() + interval '1 day');
DO $t$
DECLARE
  f constant regprocedure := 'public.aka_agent_authenticate_control_session(text)'::regprocedure;
  v jsonb;
BEGIN
  ASSERT md5(pg_get_functiondef(f)) = '2c10aa78ac5e4ab8069c741b356e88c8', 'target md5';
  ASSERT (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = f), 'secdef/search_path kept';

  UPDATE auto_system_settings SET value = '{"enabled":false,"organizationIds":null,"desktopOnlyLogin":false}'
  WHERE key = 'web.desktop_accounts';
  v := aka_agent_authenticate_control_session('v462-native-10a');
  ASSERT v->>'status' = 'capability_unavailable', 'policy off: native desktop-only blocked ' || v::text;
  ASSERT (SELECT revoked_at IS NOT NULL FROM auto_control_sessions WHERE token_hash = 'v462-native-10a'), 'blocked session revoked';
  v := aka_agent_authenticate_control_session('v462-native-9');
  ASSERT v->>'status' = 'authenticated', 'native of org with Server unchanged ' || v::text;

  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[10],"desktopOnlyLogin":false}'
  WHERE key = 'web.desktop_accounts';
  v := aka_agent_authenticate_control_session('v462-native-10b');
  ASSERT v->>'status' = 'capability_unavailable', 'enabled without desktopOnlyLogin: native blocked ' || v::text;

  UPDATE auto_system_settings SET value = '{"enabled":true,"organizationIds":[10],"desktopOnlyLogin":true}'
  WHERE key = 'web.desktop_accounts';
  v := aka_agent_authenticate_control_session('v462-native-10c');
  ASSERT v->>'status' = 'authenticated' AND (v->'capabilities'->>'zalo_server')::boolean IS FALSE
    AND (v->'web_desktop_accounts'->>'desktopOnlyLogin')::boolean, 'desktopOnlyLogin: native allowed ' || v::text;
  v := aka_agent_authenticate_control_session('v462-pwa-10');
  ASSERT v->>'status' = 'authenticated', 'pwa unchanged ' || v::text;

  UPDATE auto_system_settings SET value = '{"enabled":false,"organizationIds":null,"desktopOnlyLogin":false}'
  WHERE key = 'web.desktop_accounts';
END
$t$;

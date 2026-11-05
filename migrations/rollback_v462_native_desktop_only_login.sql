-- Rollback v462: đưa public.aka_agent_authenticate_control_session(text) về đúng bản đích V461
-- (md5 de8f93ee545bca94a199b2dffb9fe324), tức phiên native của tổ chức chỉ có gói Zalo Desktop
-- lại bị từ chối như trước. Chỉ chạy khi hàm đang ở bản v462 (md5 2c10aa78ac5e4ab8069c741b356e88c8).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $v462_rollback$
DECLARE
  f constant regprocedure := 'public.aka_agent_authenticate_control_session(text)'::regprocedure;
  c_v461 constant text := 'de8f93ee545bca94a199b2dffb9fe324';
  c_v462 constant text := '2c10aa78ac5e4ab8069c741b356e88c8';
  c_gate_v462 constant text := 'v_session.client_type IN (''web'', ''pwa'', ''native'')';
  c_gate_v461 constant text := 'v_session.client_type IN (''web'', ''pwa'')';
  c_note_v462 constant text := '  -- Tổ chức chỉ có gói Zalo Desktop vào Web/PWA/iOS khi chính sách bật rõ desktopOnlyLogin (iOS: API chỉ nhận bản gửi header Desktop).';
  c_note_v461 constant text := '  -- Tổ chức chỉ có gói Zalo Desktop vào Web/PWA khi chính sách bật rõ desktopOnlyLogin.';
  d text;
  attrs jsonb;
BEGIN
  d := pg_get_functiondef(f);
  IF md5(d) = c_v461 THEN
    RAISE NOTICE 'Hàm đã ở bản V461, không đổi gì';
    RETURN;
  END IF;
  IF md5(d) IS DISTINCT FROM c_v462 THEN
    RAISE EXCEPTION 'v462_rollback_unexpected_definition:%', md5(d);
  END IF;

  SELECT jsonb_build_object('owner', p.proowner::regrole::text, 'secdef', p.prosecdef,
           'volatile', p.provolatile, 'config', p.proconfig, 'acl', p.proacl::text)
  INTO attrs
  FROM pg_proc p WHERE p.oid = f;

  d := replace(replace(d, c_gate_v462, c_gate_v461), c_note_v462, c_note_v461);
  IF md5(d) IS DISTINCT FROM c_v461 THEN
    RAISE EXCEPTION 'v462_rollback_checksum_mismatch:%', md5(d);
  END IF;
  EXECUTE d;

  IF md5(pg_get_functiondef(f)) IS DISTINCT FROM c_v461 THEN
    RAISE EXCEPTION 'v462_rollback_postflight_checksum:%', md5(pg_get_functiondef(f));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = f
      AND jsonb_build_object('owner', p.proowner::regrole::text, 'secdef', p.prosecdef,
            'volatile', p.provolatile, 'config', p.proconfig, 'acl', p.proacl::text) = attrs
  ) THEN
    RAISE EXCEPTION 'v462_rollback_attributes_changed';
  END IF;
END
$v462_rollback$;

COMMIT;

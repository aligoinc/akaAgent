-- v462: app iOS (phiên client_type 'native') của tổ chức chỉ có gói Zalo Desktop qua được cổng
-- xác thực phiên giống Web/PWA, khi chính sách web.desktop_accounts bật desktopOnlyLogin (V461).
--
-- Chỉ sửa public.aka_agent_authenticate_control_session(text): thêm 'native' vào danh sách
-- client_type của cổng tổ chức chỉ có Desktop, và cập nhật dòng chú thích ngay trên nó.
-- Không đổi bảng, dữ liệu, ACL, owner, SECURITY DEFINER hay search_path.
--
-- Chính sách đang tắt (desktopOnlyLogin=false) nên apply không đổi hành vi. Trước khi bật
-- desktopOnlyLogin phải deploy API chặn phiên iOS không gửi header x-aka-desktop-accounts,
-- để bản iOS cũ không vào một app trống.
--
-- Nguồn: bản đích của V461, md5 de8f93ee545bca94a199b2dffb9fe324.
-- Đích: md5 2c10aa78ac5e4ab8069c741b356e88c8 (tính trên định nghĩa production ngày 05/11/2026).
-- Rollback: migrations/rollback_v462_native_desktop_only_login.sql.
-- Test local: scripts/test-native-desktop-only-login-sql.sh.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $v462$
DECLARE
  f constant regprocedure := 'public.aka_agent_authenticate_control_session(text)'::regprocedure;
  c_source constant text := 'de8f93ee545bca94a199b2dffb9fe324';
  c_target constant text := '2c10aa78ac5e4ab8069c741b356e88c8';
  c_gate_old constant text := 'v_session.client_type IN (''web'', ''pwa'')';
  c_gate_new constant text := 'v_session.client_type IN (''web'', ''pwa'', ''native'')';
  c_note_old constant text := '  -- Tổ chức chỉ có gói Zalo Desktop vào Web/PWA khi chính sách bật rõ desktopOnlyLogin.';
  c_note_new constant text := '  -- Tổ chức chỉ có gói Zalo Desktop vào Web/PWA/iOS khi chính sách bật rõ desktopOnlyLogin (iOS: API chỉ nhận bản gửi header Desktop).';
  d text;
  attrs jsonb;
BEGIN
  d := pg_get_functiondef(f);
  IF md5(d) = c_target THEN
    RAISE NOTICE 'v462 đã được apply trước đó, không đổi gì';
    RETURN;
  END IF;
  IF md5(d) IS DISTINCT FROM c_source THEN
    RAISE EXCEPTION 'v462_unexpected_definition:%', md5(d);
  END IF;
  IF length(d) - length(replace(d, c_gate_old, '')) <> length(c_gate_old)
     OR length(d) - length(replace(d, c_note_old, '')) <> length(c_note_old) THEN
    RAISE EXCEPTION 'v462_anchor_not_unique';
  END IF;

  SELECT jsonb_build_object('owner', p.proowner::regrole::text, 'secdef', p.prosecdef,
           'volatile', p.provolatile, 'config', p.proconfig, 'acl', p.proacl::text)
  INTO attrs
  FROM pg_proc p WHERE p.oid = f;

  d := replace(replace(d, c_gate_old, c_gate_new), c_note_old, c_note_new);
  IF md5(d) IS DISTINCT FROM c_target THEN
    RAISE EXCEPTION 'v462_target_checksum_mismatch:%', md5(d);
  END IF;
  EXECUTE d;

  -- Postflight: đúng bản đích, thuộc tính và quyền giữ nguyên.
  IF md5(pg_get_functiondef(f)) IS DISTINCT FROM c_target THEN
    RAISE EXCEPTION 'v462_postflight_checksum:%', md5(pg_get_functiondef(f));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = f
      AND jsonb_build_object('owner', p.proowner::regrole::text, 'secdef', p.prosecdef,
            'volatile', p.provolatile, 'config', p.proconfig, 'acl', p.proacl::text) = attrs
  ) THEN
    RAISE EXCEPTION 'v462_attributes_changed';
  END IF;
END
$v462$;

COMMIT;

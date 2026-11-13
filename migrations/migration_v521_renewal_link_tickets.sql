-- V521: vé gia hạn dùng một lần (13/11/2026) — CHƯA APPLY, cần người dùng duyệt trước khi chạy.
-- Phương án: docs/RENEWAL_REMINDER_PLAN.md (mục 5); Desktop: docs/RENEWAL_REMINDER_DESKTOP.md; Web/API: akaAgentWebApp
-- docs/RENEWAL_REMINDER.md; cổng CRM: SqlServerDashboard docs/trang-gia-han-khach-hang.md.
--
-- Vì sao: nút "Gia hạn" cần đưa khách vào thẳng trang thanh toán của cổng CRM mà không gõ lại mật khẩu. Cách cũ là link
-- có chữ ký, phải đặt cùng một khóa bí mật (RENEWAL_PORTAL_LINK_SECRET) ở ba nơi (Fly của CRM, Fly của API Web, Supabase
-- Edge). Cách này thay bằng vé lưu trong DB: không còn khóa nào phải đặt ngoài DB.
--
-- 1) Bảng private.aka_renewal_link_tickets: mỗi dòng là một vé. Chỉ lưu SHA-256 của mã vé (lộ bảng cũng không dùng được vé),
--    nhân viên, tổ chức, dòng sản phẩm muốn gia hạn, nơi xin vé, hạn dùng 10 phút, thời điểm đã dùng. Không ai đọc/ghi trực
--    tiếp được bảng (schema private, RLS bật, thu hồi mọi quyền); chỉ ba hàm dưới đây chạm tới.
-- 2) public.aka_agent_renewal_link_ticket(p_organization_product_id): Desktop xin vé. Chỉ role aka_agent_desktop gọi được;
--    nhân viên/tổ chức lấy từ phiên Desktop (private.aka_agent_desktop_data_context()), không nhận từ tham số.
-- 3) public.aka_agent_control_renewal_link_ticket(p_staff_id, p_organization_id, p_organization_product_id): API Web xin vé
--    cho phiên Web đã xác thực. Chỉ service_role.
-- 4) public.aka_renewal_link_ticket_redeem(p_token): cổng CRM đổi vé lấy nhân viên. Chỉ service_role. Mỗi vé đổi đúng một
--    lần, trong hạn 10 phút; đổi xong CRM vẫn tự kiểm nhân viên còn hoạt động như khi đăng nhập bằng mật khẩu.
--
-- Giới hạn: mỗi nhân viên tối đa 12 vé trong 10 phút (quá thì trả rate_limited, app dùng link thường). Vé cũ tự dọn mỗi lần
-- xin vé (vé quá 1 ngày của chính nhân viên, và tối đa 200 vé quá 7 ngày của người khác); không thêm job cron.
-- Mã vé: 64 ký tự hex từ hai gen_random_uuid() (244 bit ngẫu nhiên), không cần extension.
--
-- Chỉ thêm một bảng mới và bốn hàm mới; không sửa bảng, hàm hay dữ liệu cũ. App và cổng bản cũ không gọi các hàm này.
-- CREATE TABLE/FUNCTION làm PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm. Gỡ: rollback_v521_renewal_link_tickets.sql.
-- Trước khi apply: kiểm lại sổ migration và `git log --all` xem số V521 còn trống (số dùng chung mọi repo và nhánh).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE v_missing text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v521_%') THEN
      RAISE EXCEPTION 'V521 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('private.aka_renewal_link_tickets') IS NOT NULL THEN
    RAISE EXCEPTION 'V521: private.aka_renewal_link_tickets đã có';
  END IF;
  IF to_regprocedure('public.aka_agent_renewal_link_ticket(bigint)') IS NOT NULL
     OR to_regprocedure('public.aka_agent_control_renewal_link_ticket(bigint,bigint,bigint)') IS NOT NULL
     OR to_regprocedure('public.aka_renewal_link_ticket_redeem(text)') IS NOT NULL
     OR to_regprocedure('private.aka_renewal_link_ticket_issue(bigint,bigint,bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'V521: hàm vé gia hạn đã có';
  END IF;
  IF to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN
    RAISE EXCEPTION 'V521: thiếu private.aka_agent_desktop_data_context()';
  END IF;
  SELECT string_agg(need.rolname, ', ' ORDER BY need.rolname) INTO v_missing
    FROM (VALUES ('aka_agent_desktop'), ('service_role'), ('anon'), ('authenticated')) AS need(rolname)
   WHERE NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = need.rolname);
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'V521: thiếu role: %', v_missing; END IF;
  SELECT string_agg(need.tbl || '.' || need.col, ', ' ORDER BY need.tbl, need.col) INTO v_missing
    FROM (VALUES
      ('org_staff', 'id'), ('org_staff', 'organization_id'), ('org_staff', 'is_active'),
      ('org_organization_product', 'id'), ('org_organization_product', 'organization_id'), ('org_organization_product', 'is_deleted')
    ) AS need(tbl, col)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = to_regclass('public.' || need.tbl) AND a.attname = need.col AND NOT a.attisdropped
   );
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'V521: thiếu cột: %', v_missing; END IF;
END $pre$;

CREATE TABLE private.aka_renewal_link_tickets (
  token_hash bytea PRIMARY KEY,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  organization_product_id bigint,
  client text NOT NULL CHECK (client IN ('desktop', 'web')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX idx_aka_renewal_link_tickets_staff ON private.aka_renewal_link_tickets (staff_id, created_at);
CREATE INDEX idx_aka_renewal_link_tickets_expires ON private.aka_renewal_link_tickets (expires_at);
ALTER TABLE private.aka_renewal_link_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.aka_renewal_link_tickets FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
COMMENT ON TABLE private.aka_renewal_link_tickets IS
  'Vé gia hạn dùng một lần (V521): app xin vé, cổng CRM đổi vé lấy nhân viên. Chỉ lưu SHA-256 của mã vé. Chỉ truy cập qua hàm.';

-- Lõi cấp vé. Không cấp quyền gọi cho role nào; hai hàm public bên dưới gọi thay.
CREATE FUNCTION private.aka_renewal_link_ticket_issue(
  p_staff_id bigint, p_organization_id bigint, p_organization_product_id bigint, p_client text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  c_ttl CONSTANT interval := interval '10 minutes';
  c_max_per_window CONSTANT integer := 12;
  v_now timestamptz := clock_timestamp();
  v_product bigint := p_organization_product_id;
  v_recent integer;
  v_token text;
BEGIN
  IF p_client IS NULL OR p_client NOT IN ('desktop', 'web') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'renewal_link_invalid_client';
  END IF;
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_session');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_staff s
                  WHERE s.id = p_staff_id AND s.organization_id = p_organization_id AND s.is_active) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staff_inactive');
  END IF;
  -- Dòng sản phẩm chỉ là gợi ý cho cổng mở sẵn; không thuộc tổ chức này thì bỏ gợi ý, vẫn cấp vé.
  IF v_product IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.org_organization_product p
                                            WHERE p.id = v_product AND p.organization_id = p_organization_id
                                              AND p.is_deleted IS NOT TRUE) THEN
    v_product := NULL;
  END IF;

  -- Các lượt xin vé của cùng một nhân viên chạy lần lượt, để hạn mức bên dưới không bị vượt khi gọi đồng thời.
  PERFORM pg_advisory_xact_lock(hashtextextended('aka_renewal_link_ticket:' || p_staff_id::text, 0));

  -- Dọn vé cũ (không cần job riêng): vé quá 1 ngày của chính nhân viên, và một ít vé quá 7 ngày của người khác.
  DELETE FROM private.aka_renewal_link_tickets t WHERE t.staff_id = p_staff_id AND t.created_at < v_now - interval '1 day';
  DELETE FROM private.aka_renewal_link_tickets t
   WHERE t.token_hash IN (SELECT x.token_hash FROM private.aka_renewal_link_tickets x
                           WHERE x.expires_at < v_now - interval '7 days' ORDER BY x.expires_at LIMIT 200);

  SELECT count(*) INTO v_recent FROM private.aka_renewal_link_tickets t
   WHERE t.staff_id = p_staff_id AND t.created_at > v_now - c_ttl;
  IF v_recent >= c_max_per_window THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO private.aka_renewal_link_tickets (token_hash, staff_id, organization_id, organization_product_id, client, created_at, expires_at)
  VALUES (sha256(convert_to(v_token, 'UTF8')), p_staff_id, p_organization_id, v_product, p_client, v_now, v_now + c_ttl);
  RETURN jsonb_build_object('ok', true, 'token', v_token, 'expiresAt', v_now + c_ttl);
END
$function$;

-- Desktop: nhân viên/tổ chức lấy từ phiên Desktop, không nhận từ tham số.
CREATE FUNCTION public.aka_agent_renewal_link_ticket(p_organization_product_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
BEGIN
  SELECT c.staff_id, c.organization_id INTO v_staff_id, v_organization_id
    FROM private.aka_agent_desktop_data_context() c
   LIMIT 1;
  RETURN private.aka_renewal_link_ticket_issue(v_staff_id, v_organization_id, p_organization_product_id, 'desktop');
END
$function$;

-- API Web: gọi sau khi đã xác thực phiên Web; nhân viên/tổ chức lấy từ phiên đó.
CREATE FUNCTION public.aka_agent_control_renewal_link_ticket(
  p_staff_id bigint, p_organization_id bigint, p_organization_product_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
BEGIN
  RETURN private.aka_renewal_link_ticket_issue(p_staff_id, p_organization_id, p_organization_product_id, 'web');
END
$function$;

-- Cổng CRM: đổi vé lấy nhân viên. Mỗi vé dùng đúng một lần (câu UPDATE có điều kiện là bước khóa).
CREATE FUNCTION public.aka_renewal_link_ticket_redeem(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_hash bytea;
  v_ticket private.aka_renewal_link_tickets%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  v_hash := sha256(convert_to(p_token, 'UTF8'));
  UPDATE private.aka_renewal_link_tickets t SET used_at = v_now
   WHERE t.token_hash = v_hash AND t.used_at IS NULL AND t.expires_at > v_now
  RETURNING t.* INTO v_ticket;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', coalesce(
      (SELECT CASE WHEN t.used_at IS NOT NULL THEN 'used' ELSE 'expired' END
         FROM private.aka_renewal_link_tickets t WHERE t.token_hash = v_hash), 'not_found'));
  END IF;
  RETURN jsonb_build_object('ok', true, 'staffId', v_ticket.staff_id, 'organizationId', v_ticket.organization_id,
    'organizationProductId', v_ticket.organization_product_id, 'client', v_ticket.client);
END
$function$;

-- Schema private có USAGE cho anon/authenticated/aka_agent_desktop/aka_agent_chat_api, và hàm mới mặc định cho PUBLIC gọi:
-- khóa lại ngay trong giao dịch này.
REVOKE ALL ON FUNCTION private.aka_renewal_link_ticket_issue(bigint, bigint, bigint, text) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION public.aka_agent_renewal_link_ticket(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_renewal_link_ticket(bigint) TO aka_agent_desktop;
REVOKE ALL ON FUNCTION public.aka_agent_control_renewal_link_ticket(bigint, bigint, bigint) FROM PUBLIC, anon, authenticated, aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_renewal_link_ticket(bigint, bigint, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.aka_renewal_link_ticket_redeem(text) FROM PUBLIC, anon, authenticated, aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_renewal_link_ticket_redeem(text) TO service_role;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN
    REVOKE ALL ON TABLE private.aka_renewal_link_tickets FROM aka_agent_chat_api;
    REVOKE ALL ON FUNCTION private.aka_renewal_link_ticket_issue(bigint, bigint, bigint, text) FROM aka_agent_chat_api;
    REVOKE ALL ON FUNCTION public.aka_agent_renewal_link_ticket(bigint) FROM aka_agent_chat_api;
    REVOKE ALL ON FUNCTION public.aka_agent_control_renewal_link_ticket(bigint, bigint, bigint) FROM aka_agent_chat_api;
    REVOKE ALL ON FUNCTION public.aka_renewal_link_ticket_redeem(text) FROM aka_agent_chat_api;
  END IF;
END $grants$;

COMMENT ON FUNCTION public.aka_agent_renewal_link_ticket(bigint) IS
  'Nhắc gia hạn (V521): Desktop xin vé gia hạn dùng một lần cho nhân viên của phiên Desktop. Trả {ok, token, expiresAt} hoặc {ok:false, reason}.';
COMMENT ON FUNCTION public.aka_agent_control_renewal_link_ticket(bigint, bigint, bigint) IS
  'Nhắc gia hạn (V521): API Web xin vé gia hạn dùng một lần cho phiên Web đã xác thực. Chỉ service_role.';
COMMENT ON FUNCTION public.aka_renewal_link_ticket_redeem(text) IS
  'Nhắc gia hạn (V521): cổng CRM đổi vé lấy nhân viên, mỗi vé một lần trong 10 phút. Chỉ service_role.';

DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(x.what, '; ') INTO v_bad FROM (
    SELECT r.rolname || ' gọi được ' || f.sig AS what
      FROM (VALUES
        ('private.aka_renewal_link_ticket_issue(bigint,bigint,bigint,text)', ARRAY[]::text[]),
        ('public.aka_agent_renewal_link_ticket(bigint)', ARRAY['aka_agent_desktop']),
        ('public.aka_agent_control_renewal_link_ticket(bigint,bigint,bigint)', ARRAY['service_role']),
        ('public.aka_renewal_link_ticket_redeem(text)', ARRAY['service_role'])
      ) AS f(sig, allowed)
      JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api')
     WHERE has_function_privilege(r.rolname, f.sig, 'EXECUTE') AND NOT (r.rolname = ANY (f.allowed))
    UNION ALL
    SELECT f.sig || ' thiếu quyền cho ' || a.rolname
      FROM (VALUES
        ('public.aka_agent_renewal_link_ticket(bigint)', 'aka_agent_desktop'),
        ('public.aka_agent_control_renewal_link_ticket(bigint,bigint,bigint)', 'service_role'),
        ('public.aka_renewal_link_ticket_redeem(text)', 'service_role')
      ) AS f(sig, rolname)
      JOIN pg_roles a ON a.rolname = f.rolname
     WHERE NOT has_function_privilege(a.rolname, f.sig, 'EXECUTE')
    UNION ALL
    SELECT r.rolname || ' có quyền trên bảng vé'
      FROM pg_roles r
     WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api')
       AND has_table_privilege(r.rolname, 'private.aka_renewal_link_tickets', 'SELECT, INSERT, UPDATE, DELETE')
  ) x;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V521 postflight: %', v_bad; END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'private.aka_renewal_link_tickets'::regclass) THEN
    RAISE EXCEPTION 'V521 postflight: bảng vé chưa bật RLS';
  END IF;
END $post$;

COMMIT;

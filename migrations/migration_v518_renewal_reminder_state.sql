-- V518: nhắc gia hạn trong phần mềm (13/11/2026) — CHƯA APPLY, cần người dùng duyệt trước khi chạy.
-- Phương án: docs/RENEWAL_REMINDER_PLAN.md; phía Desktop: docs/RENEWAL_REMINDER_DESKTOP.md.
--
-- 1) public.aka_agent_renewal_reminder_state(): hàm chỉ đọc cho Desktop, không nhận tham số, lấy nhân viên/tổ chức từ phiên
--    Desktop (private.aka_agent_desktop_data_context()). Trả jsonb:
--      { "today": "YYYY-MM-DD" (ngày Việt Nam theo máy chủ), "serverTime": "<ISO>",
--        "loginDays": ["YYYY-MM-DD", …]  -- các ngày Việt Nam nhân viên có đăng nhập trong 60 ngày gần nhất
--        "offers": [{ "organizationProductId", "minDaysBeforeExpiry", "bonusDays", "discountType", "discountValue" }] }
--    - loginDays lấy từ auto_staff_device_presence (mỗi lần mở Desktop là một dòng; bảng chỉ service_role đọc được nên cần
--      hàm SECURITY DEFINER) và auto_control_sessions (mỗi lần đăng nhập Web/iOS). Chỉ để tiến trình chính của Desktop
--      quyết định nhắc sớm; Desktop không hiển thị và không gửi dữ liệu này cho giao diện.
--    - offers: ưu đãi gia hạn sớm của CRM (aka_promotion.min_days_before_expiry). Cột này thuộc migration riêng của CRM
--      (SqlServerDashboard supabase/migrations/20261113120000_…); chưa có cột thì offers = [].
--    Ngoài phiên Desktop (role khác, JWT không ánh xạ nhân viên): trả ngày giờ máy chủ, hai mảng rỗng.
--    Desktop gọi một lần lúc đăng nhập và một lần khi sang ngày mới; lỗi hoặc DB chưa có hàm (PGRST202) thì chỉ nhắc
--    theo mốc ngày bằng ngày của máy.
-- 2) Một dòng auto_system_settings 'renewal.reminder' = {"audience":"admin_akabiz"}: chỉ admin akaBiz thấy để thử trên
--    production. Mở cho mọi khách: đổi audience thành "all"; tắt: "off". Thiếu dòng = tắt. Web/API đọc cùng dòng này.
--
-- Chỉ thêm một hàm mới và một dòng cài đặt; không sửa hàm, bảng hay dữ liệu cũ. App bản cũ không gọi hàm này.
-- CREATE FUNCTION làm PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm. Gỡ: rollback_v518_renewal_reminder_state.sql.
-- Trước khi apply: kiểm lại sổ migration và `git log --all` xem số V518 còn trống (số dùng chung mọi repo và nhánh).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE v_missing text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v518_%') THEN
      RAISE EXCEPTION 'V518 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_renewal_reminder_state()') IS NOT NULL THEN
    RAISE EXCEPTION 'V518: public.aka_agent_renewal_reminder_state() đã có';
  END IF;
  IF to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN
    RAISE EXCEPTION 'V518: thiếu private.aka_agent_desktop_data_context()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    RAISE EXCEPTION 'V518: thiếu role aka_agent_desktop';
  END IF;
  SELECT string_agg(need.tbl || '.' || need.col, ', ' ORDER BY need.tbl, need.col) INTO v_missing
    FROM (VALUES
      ('auto_staff_device_presence', 'staff_id'), ('auto_staff_device_presence', 'started_at'), ('auto_staff_device_presence', 'last_seen_at'),
      ('auto_control_sessions', 'staff_id'), ('auto_control_sessions', 'created_at'),
      ('org_organization_product', 'organization_id'), ('org_organization_product', 'product_id'),
      ('org_organization_product', 'product_package_id'), ('org_organization_product', 'package_type'),
      ('org_organization_product', 'expiration_date'), ('org_organization_product', 'is_deleted'),
      ('aka_promotion', 'org_product_id'), ('aka_promotion', 'org_product_package_id'), ('aka_promotion', 'purchase_scope'),
      ('aka_promotion', 'discount_type'), ('aka_promotion', 'discount_value'), ('aka_promotion', 'bonus_days'),
      ('aka_promotion', 'starts_at'), ('aka_promotion', 'ends_at'), ('aka_promotion', 'is_active'), ('aka_promotion', 'code'),
      ('auto_system_settings', 'key'), ('auto_system_settings', 'value'), ('auto_system_settings', 'description'),
      ('auto_system_settings', 'is_secret'), ('auto_system_settings', 'is_active')
    ) AS need(tbl, col)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = to_regclass('public.' || need.tbl) AND a.attname = need.col AND NOT a.attisdropped
   );
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'V518: thiếu cột: %', v_missing; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'renewal.reminder') THEN
    RAISE EXCEPTION 'V518: auto_system_settings đã có khóa renewal.reminder';
  END IF;
END $pre$;

CREATE FUNCTION public.aka_agent_renewal_reminder_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  c_window_days CONSTANT integer := 60;
  v_staff bigint;
  v_org bigint;
  v_now timestamptz := now();
  v_today date := (timezone('Asia/Ho_Chi_Minh', v_now))::date;
  v_since timestamptz := ((v_today - c_window_days)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_login jsonb := '[]'::jsonb;
  v_offers jsonb := '[]'::jsonb;
BEGIN
  SELECT ctx.staff_id, ctx.organization_id INTO v_staff, v_org
    FROM private.aka_agent_desktop_data_context() AS ctx
   LIMIT 1;

  IF v_staff IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_char(days.day, 'YYYY-MM-DD') ORDER BY days.day), '[]'::jsonb) INTO v_login
      FROM (
        SELECT DISTINCT seen.day
          FROM (
            SELECT (timezone('Asia/Ho_Chi_Minh', p.started_at))::date AS day
              FROM public.auto_staff_device_presence AS p
             WHERE p.staff_id = v_staff AND p.started_at >= v_since
            UNION ALL
            SELECT (timezone('Asia/Ho_Chi_Minh', p.last_seen_at))::date
              FROM public.auto_staff_device_presence AS p
             WHERE p.staff_id = v_staff AND p.last_seen_at >= v_since
            UNION ALL
            SELECT (timezone('Asia/Ho_Chi_Minh', s.created_at))::date
              FROM public.auto_control_sessions AS s
             WHERE s.staff_id = v_staff AND s.created_at >= v_since
          ) AS seen
         WHERE seen.day >= v_today - c_window_days AND seen.day <= v_today
      ) AS days;

    -- Cột của migration CRM có thể chưa có: kiểm trước rồi mới đọc bằng câu lệnh động.
    IF v_org IS NOT NULL AND EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.aka_promotion'::regclass AND attname = 'min_days_before_expiry' AND NOT attisdropped
    ) THEN
      EXECUTE $offers$
        SELECT COALESCE(jsonb_agg(row_to_json(found)::jsonb), '[]'::jsonb)
          FROM (
            SELECT op.id AS "organizationProductId",
                   pr.min_days_before_expiry AS "minDaysBeforeExpiry",
                   COALESCE(pr.bonus_days, 0) AS "bonusDays",
                   CASE WHEN pr.discount_type IN ('percent', 'fixed') THEN pr.discount_type END AS "discountType",
                   CASE WHEN pr.discount_type IN ('percent', 'fixed') THEN pr.discount_value END AS "discountValue"
              FROM public.org_organization_product AS op
              JOIN public.aka_promotion AS pr
                ON pr.is_active
               AND pr.code IS NULL
               AND pr.min_days_before_expiry BETWEEN 1 AND 365
               AND pr.purchase_scope IN ('renewal', 'both')
               AND (pr.starts_at IS NULL OR pr.starts_at <= $2)
               AND (pr.ends_at IS NULL OR pr.ends_at >= $2)
               AND CASE WHEN pr.org_product_package_id IS NOT NULL THEN pr.org_product_package_id = op.product_package_id
                        ELSE pr.org_product_id IS NOT NULL AND pr.org_product_id = op.product_id END
             WHERE op.organization_id = $1
               AND COALESCE(op.is_deleted, false) = false
               AND op.product_id IN (3, 10, 13, 16, 17, 18)
               AND lower(btrim(COALESCE(op.package_type, ''))) NOT IN ('', 'demo', 'free')
               AND op.expiration_date >= $2
             ORDER BY op.id, pr.min_days_before_expiry
             LIMIT 50
          ) AS found
      $offers$ INTO v_offers USING v_org, v_now;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'serverTime', to_jsonb(v_now),
    'loginDays', v_login,
    'offers', v_offers
  );
END
$function$;

COMMENT ON FUNCTION public.aka_agent_renewal_reminder_state() IS
  'V518: dữ liệu nhắc gia hạn cho phiên Desktop — ngày Việt Nam theo máy chủ, các ngày nhân viên có đăng nhập trong 60 ngày (chỉ dùng bên trong để nhắc sớm, không hiển thị cho khách) và ưu đãi gia hạn sớm của CRM. Desktop gọi lúc đăng nhập và khi sang ngày mới.';

REVOKE ALL ON FUNCTION public.aka_agent_renewal_reminder_state() FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_renewal_reminder_state() FROM %I', r);
    END IF;
  END LOOP;
END $grants$;
GRANT EXECUTE ON FUNCTION public.aka_agent_renewal_reminder_state() TO aka_agent_desktop;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('renewal.reminder', '{"audience":"admin_akabiz"}',
  'Nhắc gia hạn trong phần mềm (Web, Desktop, iOS; V518). JSON: audience off | admin_akabiz (chỉ admin akaBiz, để thử) | all (mọi khách); milestones [30,14,7,5,3,1,0]; popupFromDays 7; lockedFromDays 3; shortPackageDays 61; usageCycles 3; usageWindowDays 60; usageMaxDaysLeft 60; usageMinLoginDays 3; adminOnly false; legacyBanner false (true = job của API ghi org_staff.app_notification cho bản app chưa có giao diện nhắc). Trường thiếu lấy mặc định; thiếu dòng hoặc sai định dạng = tắt. Web/API đọc lại mỗi lượt; Desktop đọc lúc đăng nhập.',
  false, true);

DO $post$
DECLARE v_bad text; v_out jsonb;
BEGIN
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, 'public.aka_agent_renewal_reminder_state()', 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V518 postflight: role không được gọi hàm: %', v_bad; END IF;
  IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_renewal_reminder_state()', 'EXECUTE') THEN
    RAISE EXCEPTION 'V518 postflight: aka_agent_desktop chưa gọi được hàm';
  END IF;
  IF (SELECT NOT prosecdef OR provolatile <> 's' FROM pg_proc WHERE oid = 'public.aka_agent_renewal_reminder_state()'::regprocedure) THEN
    RAISE EXCEPTION 'V518 postflight: hàm phải SECURITY DEFINER, STABLE';
  END IF;
  -- Gọi ngoài phiên Desktop (role chạy migration): có ngày giờ máy chủ, không có dữ liệu của ai.
  v_out := public.aka_agent_renewal_reminder_state();
  IF v_out->>'today' !~ '^\d{4}-\d{2}-\d{2}$' OR v_out->'loginDays' <> '[]'::jsonb OR v_out->'offers' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'V518 postflight: ngoài phiên Desktop phải trả hai mảng rỗng, nhận %', v_out;
  END IF;
  IF (SELECT count(*) FROM public.auto_system_settings WHERE key = 'renewal.reminder' AND is_active AND NOT is_secret) <> 1 THEN
    RAISE EXCEPTION 'V518 postflight: thiếu dòng cài đặt renewal.reminder';
  END IF;
END $post$;

COMMIT;

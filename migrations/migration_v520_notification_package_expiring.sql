-- V520: thông báo chuông "Gói sắp hết hạn" (13/11/2026) — CHƯA APPLY, cần người dùng duyệt trước khi chạy.
-- Phương án: docs/RENEWAL_REMINDER_PLAN.md (Đợt 3); trung tâm thông báo: docs/NOTIFICATION_CENTER.md (V457);
-- Web/API: akaAgentWebApp docs/RENEWAL_REMINDER.md.
--
-- Vì sao: khách ít mở phần mềm vẫn cần thấy gói sắp hết hạn ở chuông thông báo (Desktop, Web, iOS). Trung tâm thông báo
-- (V457) đã có danh sách, số chưa đọc, đánh dấu đã đọc cho mọi loại; chỉ thiếu loại thông báo này và một đường ghi.
--
-- 1) auto_notifications.event_type nhận thêm giá trị 'package.expiring' (nới ràng buộc CHECK; 6 giá trị cũ giữ nguyên).
-- 2) public.aka_agent_notification_emit_package_expiring(p_items jsonb): job hằng ngày của API Web gọi (chỉ service_role).
--    Mỗi phần tử: { staffId, organizationId, organizationProductId, expiryDay "YYYY-MM-DD", stageKey, severity, title, body,
--    content, daysLeft, kind }. Hàm ghi thông báo đã có sẵn nội dung (content_status = 'ready'), không email, không push.
--    - Mỗi nhân viên, mỗi dòng sản phẩm, mỗi hạn, mỗi mốc chỉ một thông báo (dedupe_key = pkg:<nhân viên>:<dòng sản phẩm>:
--      <hạn>:<mốc>), nên job gọi lại mỗi ngày không sinh trùng.
--    - Chỉ nhận nhân viên đang hoạt động thuộc đúng tổ chức và dòng sản phẩm chưa xoá của tổ chức đó; phần tử sai bị bỏ qua.
--    - Khi có thông báo mốc mới cho một gói, thông báo mốc cũ chưa đọc của chính gói đó được đánh dấu đã đọc, để số trên
--      chuông không cộng dồn các mốc đã qua.
--    - Công tắc notifications.enabled tắt thì không ghi gì. Tối đa 500 phần tử mỗi lần gọi.
--    Các quy tắc "mốc nào, câu chữ gì" nằm ở mã dùng chung của app (packages/control-api/src/renewalReminder.ts), không lặp
--    lại trong SQL.
--
-- Không sửa hàm nào của V457/V465/V466/V475. Danh sách, chi tiết, số chưa đọc, đánh dấu đã đọc và dọn 90 ngày của trung tâm
-- thông báo áp dụng luôn cho loại mới. App bản cũ hiển thị loại lạ dưới nhãn chung "Thông báo" (đã kiểm trong mã Desktop,
-- Web, iOS). Bộ lọc theo loại của hàm danh sách chưa nhận loại mới, nên app không có nút lọc riêng cho loại này.
--
-- ALTER TABLE giữ khoá auto_notifications trong vài mili giây (bảng ~200 dòng, không có trigger); đặt cuối giao dịch.
-- CREATE FUNCTION/ALTER TABLE làm PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm.
-- Gỡ: rollback_v520_notification_package_expiring.sql. Trước khi apply: kiểm lại sổ migration và `git log --all` (số V520).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE
  c_expected CONSTANT text := 'CHECK ((event_type = ANY (ARRAY[''campaign.status_changed''::text, ''account.status_changed''::text, ''report.scheduled''::text, ''data_group.membership_changed''::text, ''system.test''::text, ''system.verify_email''::text])))';
  v_current text;
  v_missing text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v520_%') THEN
      RAISE EXCEPTION 'V520 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_notifications') IS NULL THEN
    RAISE EXCEPTION 'V520: thiếu bảng public.auto_notifications (V457)';
  END IF;
  IF to_regprocedure('public.aka_agent_notification_emit_package_expiring(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'V520: public.aka_agent_notification_emit_package_expiring(jsonb) đã có';
  END IF;
  IF to_regprocedure('private.aka_agent_notification_enabled()') IS NULL THEN
    RAISE EXCEPTION 'V520: thiếu private.aka_agent_notification_enabled() (V457)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'V520: thiếu role service_role';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_current
    FROM pg_constraint c
   WHERE c.conrelid = 'public.auto_notifications'::regclass AND c.conname = 'auto_notifications_event_type_check' AND c.contype = 'c';
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'V520: không thấy ràng buộc auto_notifications_event_type_check';
  END IF;
  IF v_current IS DISTINCT FROM c_expected THEN
    RAISE EXCEPTION 'V520: ràng buộc auto_notifications_event_type_check khác bản V457 (đang là: %)', v_current;
  END IF;
  SELECT string_agg(need.tbl || '.' || need.col, ', ' ORDER BY need.tbl, need.col) INTO v_missing
    FROM (VALUES
      ('auto_notifications', 'organization_id'), ('auto_notifications', 'staff_id'), ('auto_notifications', 'event_type'),
      ('auto_notifications', 'severity'), ('auto_notifications', 'entity_key'), ('auto_notifications', 'occurred_at'),
      ('auto_notifications', 'deliver_after'), ('auto_notifications', 'dedupe_key'), ('auto_notifications', 'payload'),
      ('auto_notifications', 'content_status'), ('auto_notifications', 'app_title'), ('auto_notifications', 'app_body'),
      ('auto_notifications', 'content_snapshot'), ('auto_notifications', 'template_version'), ('auto_notifications', 'read_at'),
      ('auto_notifications', 'updated_at'),
      ('org_staff', 'id'), ('org_staff', 'organization_id'), ('org_staff', 'is_active'),
      ('org_organization_product', 'id'), ('org_organization_product', 'organization_id'), ('org_organization_product', 'is_deleted')
    ) AS need(tbl, col)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = to_regclass('public.' || need.tbl) AND a.attname = need.col AND NOT a.attisdropped
   );
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'V520: thiếu cột: %', v_missing; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.auto_notifications'::regclass AND c.conname = 'auto_notifications_dedupe_unique') THEN
    RAISE EXCEPTION 'V520: thiếu ràng buộc auto_notifications_dedupe_unique';
  END IF;
END $pre$;

CREATE FUNCTION public.aka_agent_notification_emit_package_expiring(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  c_max_items CONSTANT integer := 500;
  v_now timestamptz := clock_timestamp();
  v_total integer;
  v_valid integer := 0;
  v_inserted integer := 0;
  v_superseded integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_items';
  END IF;
  v_total := jsonb_array_length(p_items);
  IF v_total > c_max_items THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_too_many_items';
  END IF;
  IF NOT private.aka_agent_notification_enabled() THEN
    RETURN jsonb_build_object('enabled', false, 'received', v_total, 'valid', 0, 'inserted', 0, 'superseded', 0);
  END IF;

  WITH parsed AS (
    SELECT (e ->> 'staffId')::bigint AS staff_id,
           (e ->> 'organizationId')::bigint AS organization_id,
           (e ->> 'organizationProductId')::bigint AS product_id,
           e ->> 'expiryDay' AS expiry_day,
           e ->> 'stageKey' AS stage_key,
           CASE WHEN e ->> 'severity' IN ('info', 'warning', 'critical') THEN e ->> 'severity' ELSE 'info' END AS severity,
           btrim(e ->> 'title') AS title,
           nullif(btrim(coalesce(e ->> 'body', '')), '') AS body,
           CASE WHEN jsonb_typeof(e -> 'content') = 'object' AND pg_column_size(e -> 'content') <= 16384 THEN e -> 'content' END AS content,
           CASE WHEN (e ->> 'daysLeft') ~ '^[0-9]{1,4}$' THEN (e ->> 'daysLeft')::integer END AS days_left,
           CASE WHEN e ->> 'kind' IN ('trial', 'paid') THEN e ->> 'kind' END AS kind
      FROM jsonb_array_elements(p_items) e
     WHERE jsonb_typeof(e) = 'object'
       AND coalesce(e ->> 'staffId', '') ~ '^[1-9][0-9]{0,17}$'
       AND coalesce(e ->> 'organizationId', '') ~ '^[1-9][0-9]{0,17}$'
       AND coalesce(e ->> 'organizationProductId', '') ~ '^[1-9][0-9]{0,17}$'
       AND coalesce(e ->> 'expiryDay', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       AND coalesce(e ->> 'stageKey', '') ~ '^[a-z][a-z0-9:]{0,23}$'
       AND char_length(btrim(coalesce(e ->> 'title', ''))) BETWEEN 1 AND 200
       AND char_length(coalesce(e ->> 'body', '')) <= 1000
  ), valid AS (
    SELECT DISTINCT ON (p.staff_id, p.product_id, p.expiry_day, p.stage_key) p.*
      FROM parsed p
      JOIN public.org_staff s ON s.id = p.staff_id AND s.organization_id = p.organization_id AND s.is_active
      JOIN public.org_organization_product op
        ON op.id = p.product_id AND op.organization_id = p.organization_id AND op.is_deleted IS NOT TRUE
     ORDER BY p.staff_id, p.product_id, p.expiry_day, p.stage_key
  ), inserted AS (
    INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, entity_key, occurred_at, deliver_after,
                                           dedupe_key, payload, content_status, app_title, app_body, content_snapshot, template_version)
    SELECT v.organization_id, v.staff_id, 'package.expiring', v.severity, 'package:' || v.product_id, v_now, v_now,
           'pkg:' || v.staff_id || ':' || v.product_id || ':' || v.expiry_day || ':' || v.stage_key,
           jsonb_strip_nulls(jsonb_build_object('organizationProductId', v.product_id, 'expiryDay', v.expiry_day,
             'stageKey', v.stage_key, 'daysLeft', v.days_left, 'kind', v.kind)),
           'ready', v.title, v.body, v.content, 1
      FROM valid v
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id, staff_id, entity_key
  ), superseded AS (
    -- Mốc cũ chưa đọc của cùng gói: đánh dấu đã đọc để số trên chuông không cộng dồn.
    UPDATE public.auto_notifications n
       SET read_at = v_now, updated_at = v_now
      FROM inserted i
     WHERE n.staff_id = i.staff_id AND n.event_type = 'package.expiring' AND n.entity_key = i.entity_key
       AND n.read_at IS NULL AND n.content_status = 'ready' AND n.id <> i.id
    RETURNING n.id
  )
  SELECT (SELECT count(*) FROM valid), (SELECT count(*) FROM inserted), (SELECT count(*) FROM superseded)
    INTO v_valid, v_inserted, v_superseded;

  RETURN jsonb_build_object('enabled', true, 'received', v_total, 'valid', v_valid, 'inserted', v_inserted, 'superseded', v_superseded);
END
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_notification_emit_package_expiring(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_notification_emit_package_expiring(jsonb) TO service_role;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    REVOKE ALL ON FUNCTION public.aka_agent_notification_emit_package_expiring(jsonb) FROM aka_agent_desktop;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN
    REVOKE ALL ON FUNCTION public.aka_agent_notification_emit_package_expiring(jsonb) FROM aka_agent_chat_api;
  END IF;
END $grants$;
COMMENT ON FUNCTION public.aka_agent_notification_emit_package_expiring(jsonb) IS
  'Nhắc gia hạn (V520): job của API Web ghi thông báo chuông "Gói sắp hết hạn" đã có nội dung, mỗi nhân viên/gói/hạn/mốc một lần. Chỉ service_role.';

-- Nới ràng buộc ở cuối giao dịch để giữ khoá bảng ngắn nhất.
ALTER TABLE public.auto_notifications DROP CONSTRAINT auto_notifications_event_type_check;
ALTER TABLE public.auto_notifications ADD CONSTRAINT auto_notifications_event_type_check
  CHECK (event_type IN ('campaign.status_changed', 'account.status_changed', 'report.scheduled',
    'data_group.membership_changed', 'system.test', 'system.verify_email', 'package.expiring'));

DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(r.rolname, ', ') INTO v_bad
    FROM pg_roles r
   WHERE r.rolname IN ('anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api')
     AND has_function_privilege(r.rolname, 'public.aka_agent_notification_emit_package_expiring(jsonb)', 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V520 postflight: role không được gọi hàm: %', v_bad; END IF;
  IF NOT has_function_privilege('service_role', 'public.aka_agent_notification_emit_package_expiring(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V520 postflight: service_role chưa gọi được hàm';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.auto_notifications'::regclass AND c.conname = 'auto_notifications_event_type_check'
                    AND c.convalidated AND pg_get_constraintdef(c.oid) LIKE '%package.expiring%') THEN
    RAISE EXCEPTION 'V520 postflight: ràng buộc loại thông báo chưa có package.expiring';
  END IF;
END $post$;

COMMIT;

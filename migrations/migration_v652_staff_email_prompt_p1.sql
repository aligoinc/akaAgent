-- V652 p1: danh sách email (email_list) trên org_staff, org_organization, aka_customer + trigger giữ danh sách.
--
-- Phương án: docs/STAFF_EMAIL_PROMPT_PLAN.md (anh duyệt 25/11/2026: "Đồng ý thực thi phương án").
-- - email_list: mọi email từng dùng, viết thường, không trùng, mới nhất đứng đầu, gồm cả email hiện tại, tối đa 20.
-- - Trigger BEFORE INSERT OR UPDATE OF email: email đổi thì đưa email mới lên đầu, giữ email cũ trong danh sách.
--   Xoá trống email thì danh sách giữ nguyên. Áp cho mọi đường sửa email (form, CRM, Web, SQL tay).
-- - ADD COLUMN với DEFAULT hằng số chỉ đổi metadata (không viết lại bảng). Ba bảng đều nóng: lock_timeout 3 giây,
--   giao dịch chỉ gồm DDL nhanh, không có bước chạy lâu. Apply buổi tối (DDL làm PostgREST nạp lại schema).
-- Thứ tự: p1 -> p2 -> p3. Gỡ: rollback_v652_staff_email_prompt.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v652_%') THEN
    RAISE EXCEPTION 'V652 đã có trong sổ migration, không chạy lại';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name IN ('org_staff', 'org_organization', 'aka_customer')
       AND column_name = 'email_list'
  ) THEN
    RAISE EXCEPTION 'V652 p1: cột email_list đã có';
  END IF;
  IF to_regprocedure('private.track_email_list()') IS NOT NULL THEN
    RAISE EXCEPTION 'V652 p1: hàm private.track_email_list() đã có';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('org_staff', 'org_organization', 'aka_customer')
         AND column_name = 'email' AND data_type = 'text') <> 3 THEN
    RAISE EXCEPTION 'V652 p1: thiếu cột email kiểu text ở một trong ba bảng';
  END IF;
END $pre$;

ALTER TABLE public.org_staff        ADD COLUMN email_list text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.org_organization ADD COLUMN email_list text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.aka_customer     ADD COLUMN email_list text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.org_staff.email_list IS
  'V652: mọi email từng dùng của tài khoản, viết thường, mới nhất đứng đầu, gồm email hiện tại, tối đa 20. Trigger trg_email_list_track tự giữ; đừng ghi tay.';
COMMENT ON COLUMN public.org_organization.email_list IS
  'V652: mọi email từng dùng của tổ chức, viết thường, mới nhất đứng đầu, gồm email hiện tại, tối đa 20. Trigger trg_email_list_track tự giữ; đừng ghi tay.';
COMMENT ON COLUMN public.aka_customer.email_list IS
  'V652: mọi email từng dùng của khách, viết thường, mới nhất đứng đầu, gồm email hiện tại, tối đa 20. Trigger trg_email_list_track tự giữ; đừng ghi tay.';

CREATE FUNCTION private.track_email_list() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_new text := lower(btrim(coalesce(NEW.email, '')));
  v_old text := CASE WHEN TG_OP = 'UPDATE' THEN lower(btrim(coalesce(OLD.email, ''))) ELSE '' END;
BEGIN
  -- Xoá trống email: giữ nguyên danh sách. Email không đổi và đã có trong danh sách: không làm gì.
  IF v_new = '' OR (v_new = v_old AND v_new = ANY (NEW.email_list)) THEN
    RETURN NEW;
  END IF;
  NEW.email_list := (
    SELECT coalesce(array_agg(x.e ORDER BY x.ord), '{}')
      FROM (SELECT t.e, min(t.ord) AS ord
              FROM unnest(ARRAY[v_new, nullif(v_old, '')] || coalesce(NEW.email_list, '{}')) WITH ORDINALITY AS t(e, ord)
             WHERE t.e IS NOT NULL AND t.e <> ''
             GROUP BY t.e
             ORDER BY min(t.ord)
             LIMIT 20) x);
  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION private.track_email_list() IS
  'V652: trigger giữ email_list (email mới đứng đầu, giữ email cũ, tối đa 20) cho org_staff, org_organization, aka_customer.';

REVOKE ALL ON FUNCTION private.track_email_list() FROM PUBLIC;

CREATE TRIGGER trg_email_list_track BEFORE INSERT OR UPDATE OF email ON public.org_staff
  FOR EACH ROW EXECUTE FUNCTION private.track_email_list();
CREATE TRIGGER trg_email_list_track BEFORE INSERT OR UPDATE OF email ON public.org_organization
  FOR EACH ROW EXECUTE FUNCTION private.track_email_list();
CREATE TRIGGER trg_email_list_track BEFORE INSERT OR UPDATE OF email ON public.aka_customer
  FOR EACH ROW EXECUTE FUNCTION private.track_email_list();

DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE t.tgname = 'trg_email_list_track' AND c.relname IN ('org_staff', 'org_organization', 'aka_customer')) <> 3 THEN
    RAISE EXCEPTION 'V652 p1 postflight: thiếu trigger trg_email_list_track';
  END IF;
END $post$;

COMMIT;

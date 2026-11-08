-- V481 (08/11/2026): Form chiến dịch 2 trên Web — cột org_staff.web_campaign_form_version + khóa auto_system_settings web.campaign_form.
-- Hợp đồng: akaAgentWebApp docs/CAMPAIGN_FORM_V2.md. Web chọn form chiến dịch theo thứ tự:
--   org_staff.web_campaign_form_version (1 | 2) → web.campaign_form {"defaultVersion":1|2} → 1 (form hiện tại).
-- Phiên bản áp cho mọi lối mở form: Thêm, Sửa, Nhân bản, Nháp, sửa lịch từ Chẩn đoán và Thêm bằng Agent. Bước Quy trình luôn form 1.
-- API đọc cột trong lượt đọc nhân viên sẵn có (đăng nhập, /me, đồng ý chính sách) và khóa trong lượt đọc /settings/web-polling sẵn có:
-- không thêm request, polling hay kết nối. API bản trước V481 không đọc cột/khóa; API mới tự bỏ cột khi DB chưa có (thử lại sau 5 phút).
-- Không ghi giá trị cho nhân viên nào (mọi dòng NULL) và khóa mặc định {"defaultVersion":1}: sau apply mọi người vẫn dùng form 1.
-- ADD COLUMN nullable không DEFAULT chỉ đổi metadata; lock_timeout 3 giây (org_staff được đọc ở mỗi lượt xác thực).
-- DDL làm PostgREST nạp lại schema → apply ngoài giờ cao điểm. Desktop không đọc cột này.
-- Bật form 2 cho một nhân viên:  UPDATE public.org_staff SET web_campaign_form_version = 2 WHERE id = <staff_id>;
-- Về form 1 cho nhân viên đó:    UPDATE public.org_staff SET web_campaign_form_version = 1 WHERE id = <staff_id>;  (NULL = theo mặc định)
-- Mặc định form 2 cho mọi người: UPDATE public.auto_system_settings SET value = '{"defaultVersion":2}', updated_at = now() WHERE key = 'web.campaign_form';
-- Rollback: migrations/rollback_v481_web_campaign_form_version.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $v481_preflight$
BEGIN
  IF to_regclass('public.org_staff') IS NULL OR to_regclass('public.auto_system_settings') IS NULL THEN
    RAISE EXCEPTION 'v481: public.org_staff hoặc public.auto_system_settings không có';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = 'public.org_staff'::regclass AND attname = 'web_campaign_form_version' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'v481: đã apply (org_staff.web_campaign_form_version đã có), không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web.campaign_form') THEN
    RAISE EXCEPTION 'v481: khóa web.campaign_form đã có, không chạy lại';
  END IF;
  IF (SELECT last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'auto_system_settings_id_seq')
       < (SELECT coalesce(max(id), 0) FROM public.auto_system_settings) THEN
    RAISE EXCEPTION 'v481: sequence auto_system_settings_id_seq thấp hơn max(id)';
  END IF;
END
$v481_preflight$;

ALTER TABLE public.org_staff
  ADD COLUMN web_campaign_form_version smallint
  CONSTRAINT org_staff_web_campaign_form_version_check
    CHECK (web_campaign_form_version IS NULL OR web_campaign_form_version IN (1, 2));

COMMENT ON COLUMN public.org_staff.web_campaign_form_version IS
  'Form chiến dịch trên Web (V481): 1 = form hiện tại, 2 = Form chiến dịch 2, NULL = theo auto_system_settings web.campaign_form (thiếu/sai = 1). Áp cho Thêm/Sửa/Nhân bản/Nháp/Agent; bước Quy trình luôn form 1. akaAgentWebApp docs/CAMPAIGN_FORM_V2.md.';

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('web.campaign_form', '{"defaultVersion":1}',
  'Form chiến dịch Web mặc định cho nhân viên chưa đặt org_staff.web_campaign_form_version: {"defaultVersion":1} form hiện tại, {"defaultVersion":2} Form chiến dịch 2. Thiếu dòng/sai định dạng = 1. API đọc cùng lượt /settings/web-polling.',
  false, true);

DO $v481_postflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = 'public.org_staff'::regclass AND a.attname = 'web_campaign_form_version'
                   AND NOT a.attisdropped AND NOT a.attnotnull AND NOT a.atthasdef AND a.atttypid = 'smallint'::regtype) THEN
    RAISE EXCEPTION 'v481 postflight: cột org_staff.web_campaign_form_version không đúng';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.org_staff'::regclass
                   AND conname = 'org_staff_web_campaign_form_version_check' AND contype = 'c') THEN
    RAISE EXCEPTION 'v481 postflight: thiếu CHECK org_staff_web_campaign_form_version_check';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_staff WHERE web_campaign_form_version IS NOT NULL) THEN
    RAISE EXCEPTION 'v481 postflight: có nhân viên đã mang giá trị form';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web.campaign_form'
      AND value = '{"defaultVersion":1}' AND is_active IS TRUE AND is_secret IS FALSE) THEN
    RAISE EXCEPTION 'v481 postflight: khóa web.campaign_form không đúng';
  END IF;
END
$v481_postflight$;

COMMIT;

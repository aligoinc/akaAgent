-- V481 (08/11/2026; cột đổi sang text ngày 09/11/2026, trước khi apply): Form chiến dịch 2 trên Web —
-- cột org_staff.web_campaign_form_version + khóa auto_system_settings web.campaign_form.
-- Hợp đồng: akaAgentWebApp docs/CAMPAIGN_FORM_V2.md. Cột là text: danh sách form nhân viên được dùng, cách nhau dấu phẩy.
--   '1' = form hiện tại, '2' = Form chiến dịch 2, '1,2' (hoặc '2,1') = hiện cả hai nút "Thêm chiến dịch" và "Thêm chiến dịch 2"
--   (cả hai nút Agent), trong form có nút chuyển Form 1/Form 2. Số đứng đầu là form mở khi không chọn (Sửa, Nhân bản, Nháp...).
--   NULL hoặc rỗng = theo web.campaign_form {"defaultVersion": 1 | 2 | "1,2"} → thiếu/sai = 1 (form hiện tại).
-- CHECK chỉ nhận số 1/2 cách nhau dấu phẩy (cho phép khoảng trắng, chuỗi rỗng), tối đa 20 ký tự: gõ sai báo lỗi ngay lúc ghi.
-- Phiên bản áp cho mọi lối mở form: Thêm, Sửa, Nhân bản, Nháp, sửa lịch từ Chẩn đoán và Thêm bằng Agent. Bước Quy trình luôn form 1.
-- API đọc cột trong lượt đọc nhân viên sẵn có (đăng nhập, /me, đồng ý chính sách) và khóa trong lượt đọc /settings/web-polling sẵn có:
-- không thêm request, polling hay kết nối. API bản trước V481 không đọc cột/khóa; API mới tự bỏ cột khi DB chưa có (thử lại sau 5 phút).
-- Không ghi giá trị cho nhân viên nào (mọi dòng NULL) và khóa mặc định {"defaultVersion":1}: sau apply mọi người vẫn dùng form 1.
-- ADD COLUMN nullable không DEFAULT chỉ đổi metadata; CHECK quét org_staff một lượt (~2.000 dòng, ~2 MB, các dòng đều NULL);
-- lock_timeout 3 giây (org_staff được đọc ở mỗi lượt xác thực). DDL làm PostgREST nạp lại schema → apply ngoài giờ cao điểm.
-- Desktop không đọc cột này.
-- Chỉ Form 2 cho một nhân viên: UPDATE public.org_staff SET web_campaign_form_version = '2'   WHERE id = <staff_id>;
-- Cả hai form (Form 1 mở mặc định): UPDATE public.org_staff SET web_campaign_form_version = '1,2' WHERE id = <staff_id>;
-- Chỉ form 1 / theo mặc định:       ... SET web_campaign_form_version = '1' ... / ... = NULL ...
-- Mặc định cho mọi người chưa đặt riêng: UPDATE public.auto_system_settings SET value = '{"defaultVersion":2}', updated_at = now()
--   WHERE key = 'web.campaign_form';   (cả hai form: '{"defaultVersion":"1,2"}')
-- Sửa/Nhân bản mở đúng form đã tạo chiến dịch (auto_campaigns.web_campaign_form, V482); tắt khóa này: thêm "followCampaignForm":false.
-- Rollback: migrations/rollback_v481_web_campaign_form_version.sql. Kiểm thử cục bộ: bash scripts/test-v481-web-campaign-form-version.sh
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
  ADD COLUMN web_campaign_form_version text
  CONSTRAINT org_staff_web_campaign_form_version_check
    CHECK (web_campaign_form_version IS NULL OR (char_length(web_campaign_form_version) <= 20
      AND web_campaign_form_version ~ '^[[:space:]]*([12][[:space:]]*(,[[:space:]]*[12][[:space:]]*)*)?$'));

COMMENT ON COLUMN public.org_staff.web_campaign_form_version IS
  'Form chiến dịch trên Web (V481), danh sách cách nhau dấu phẩy: ''1'' = form hiện tại, ''2'' = Form chiến dịch 2, ''1,2''/''2,1'' = hiện cả hai (số đầu là form mở mặc định khi sửa/nhân bản/nháp). NULL/rỗng = theo auto_system_settings web.campaign_form (thiếu/sai = 1). Áp cho Thêm/Sửa/Nhân bản/Nháp/Agent; bước Quy trình luôn form 1. akaAgentWebApp docs/CAMPAIGN_FORM_V2.md.';

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('web.campaign_form', '{"defaultVersion":1}',
  'Form chiến dịch Web cho nhân viên chưa đặt org_staff.web_campaign_form_version: {"defaultVersion":1} form hiện tại, {"defaultVersion":2} Form chiến dịch 2, {"defaultVersion":"1,2"} hiện cả hai (số đầu mở mặc định). Thiếu dòng/sai định dạng = 1. Thêm "followCampaignForm":false để Sửa/Nhân bản không khóa theo form đã tạo chiến dịch (auto_campaigns.web_campaign_form, V482). API đọc cùng lượt /settings/web-polling.',
  false, true);

DO $v481_postflight$
DECLARE
  v_check text;
  v_rejected_valid integer;
  v_accepted_invalid integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = 'public.org_staff'::regclass AND a.attname = 'web_campaign_form_version'
                   AND NOT a.attisdropped AND NOT a.attnotnull AND NOT a.atthasdef AND a.atttypid = 'text'::regtype) THEN
    RAISE EXCEPTION 'v481 postflight: cột org_staff.web_campaign_form_version không đúng';
  END IF;
  SELECT pg_get_expr(conbin, conrelid) INTO v_check FROM pg_constraint
   WHERE conrelid = 'public.org_staff'::regclass AND conname = 'org_staff_web_campaign_form_version_check' AND contype = 'c' AND convalidated;
  IF v_check IS NULL THEN
    RAISE EXCEPTION 'v481 postflight: thiếu CHECK org_staff_web_campaign_form_version_check';
  END IF;
  -- Thử chính biểu thức CHECK trên giá trị mẫu (không ghi dòng nào): hợp lệ phải qua, sai phải bị chặn.
  EXECUTE format('SELECT count(*) FILTER (WHERE (%s) IS FALSE) FROM (VALUES (NULL::text), (''''), (''  ''), (''1''), (''2''), (''1,2''), (''2,1''), ('' 1 , 2 ''), (''2,2''), (''1,2,1'')) AS t(web_campaign_form_version)', v_check)
    INTO v_rejected_valid;
  EXECUTE format('SELECT count(*) FILTER (WHERE (%s) IS NOT FALSE) FROM (VALUES (''0''), (''3''), (''12''), (''1,3''), (''1;2''), (''1 2''), (''1,''), ('',2''), (''a''), (''２''), (''1,2,1,2,1,2,1,2,1,2,1'')) AS t(web_campaign_form_version)', v_check)
    INTO v_accepted_invalid;
  IF v_rejected_valid <> 0 OR v_accepted_invalid <> 0 THEN
    RAISE EXCEPTION 'v481 postflight: CHECK sai (chặn % giá trị hợp lệ, nhận % giá trị sai)', v_rejected_valid, v_accepted_invalid;
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

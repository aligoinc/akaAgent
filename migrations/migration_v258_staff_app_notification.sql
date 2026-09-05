BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.org_staff
  ADD COLUMN IF NOT EXISTS app_notification text;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'org_staff'
      AND column_name = 'app_notification'
      AND data_type = 'text'
      AND is_nullable = 'YES'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'Unexpected definition of public.org_staff.app_notification';
  END IF;
END;
$preflight$;

COMMENT ON COLUMN public.org_staff.app_notification IS
  'Thông báo riêng cho staff trên akaAgent, ưu tiên hơn auto_system_settings key app.notification. Nhận text thường hoặc JSON: {"title":"Tiêu đề","message":"Nội dung","level":"info|success|warning|error","linkLabel":"Xem chi tiết","linkUrl":"https://...","startsAt":"ISO-8601","endsAt":"ISO-8601"}. NULL, chuỗi rỗng hoặc ngoài thời gian hiển thị thì dùng thông báo hệ thống.';

NOTIFY pgrst, 'reload schema';

COMMIT;

BEGIN;

INSERT INTO public.auto_system_settings (
  key,
  value,
  description,
  is_secret,
  is_active
)
VALUES (
  'app.notification',
  NULL,
  'Thanh thông báo dưới header app. Value nhận text thường hoặc JSON: {"title":"Tiêu đề","message":"Nội dung","level":"info|success|warning|error","linkLabel":"Xem chi tiết","linkUrl":"https://...","startsAt":"ISO-8601","endsAt":"ISO-8601"}.',
  false,
  false
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

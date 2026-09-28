-- Existing table; preserve any value already edited by an administrator.
-- Unit: seconds. Valid integers: 5..3600. Missing/invalid/disabled => 30.
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES (
  'web.campaigns.poll_interval_seconds', '30',
  'Chu kỳ tự tải lại danh sách chiến dịch và tài khoản trên màn Chiến dịch Web/PWA, tính bằng giây (5–3600). Web đọc một lần sau khi xác thực; tải lại web để nhận giá trị mới. Mặc định 30 giây.',
  false, true
)
ON CONFLICT (key) DO NOTHING;

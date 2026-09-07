-- Shared akaBiz links for desktop, web and other products.
-- Data only: no schema/RPC/permission changes. Preserve existing admin values.
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES
  ('akabiz.links.website', 'https://akabiz.net/', 'Website chính thức của akaBiz, dùng chung cho các sản phẩm.', false, true),
  ('akabiz.links.user_guide', 'https://www.youtube.com/@akabizai', 'Hướng dẫn sử dụng akaBiz, dùng chung cho các sản phẩm.', false, true),
  ('akabiz.links.upgrade_payment', NULL, 'Liên kết nâng cấp và thanh toán. Để trống để ẩn trên giao diện.', false, true),
  ('akabiz.links.contact_us', NULL, 'Liên hệ với akaBiz. Để trống để ẩn trên giao diện.', false, true)
ON CONFLICT (key) DO NOTHING;

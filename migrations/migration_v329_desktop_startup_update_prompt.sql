-- Data only. No RPC/DDL/schema reload. Live key baseline on 2026-09-28: absent.
-- NULL (or a cleared admin value) prompts every version at startup when newer
-- software exists; x.y.z prompts local versions <= x.y.z, including equality.
DO $migration$
DECLARE
  baseline_checksum text;
BEGIN
  SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb)::text)
    INTO baseline_checksum
  FROM public.auto_system_settings s
  WHERE key = 'desktop.updates.startup_prompt_max_version';

  IF baseline_checksum <> 'd751713988987e9331980363e24189ce' THEN
    RAISE EXCEPTION 'Startup update prompt setting changed since capture; refusing to overwrite';
  END IF;

  INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
  VALUES (
    'desktop.updates.startup_prompt_max_version',
    NULL,
    'Ngưỡng phiên bản tự mở form cập nhật khi khởi động Desktop và có bản mới. NULL hoặc để trống: mở với mọi phiên bản. Giá trị x.y.z (ví dụ 6.0.0): chỉ mở khi phiên bản đang dùng nhỏ hơn hoặc bằng ngưỡng. Kiểm tra định kỳ không tự mở form. Mở lại app để nhận cấu hình mới.',
    false,
    true
  );
END;
$migration$;

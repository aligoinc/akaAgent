-- Data only: no schema/RPC/auto_error change or schema reload.
-- Baseline captured on akachat 2026-10-16: this key is absent.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'zalo.phone_check.hour_limit_wait_minutes') THEN
    RAISE EXCEPTION 'Phone check hourly wait setting already exists; refusing to overwrite';
  END IF;
  INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
  VALUES (
    'zalo.phone_check.hour_limit_wait_minutes', '60',
    'Số phút nghỉ khi Kiểm tra SĐT có Zalo gặp mã 312/221, sau đó thử lại đúng SĐT. Số nguyên 1–35791; mặc định 60 nếu thiếu/sai/không đọc được. Đọc một lần ở giới hạn giờ đầu tiên trong mỗi lượt; thay đổi áp dụng cho lượt mới. Không đổi policy chiến dịch.',
    false, true
  );
END;
$migration$;

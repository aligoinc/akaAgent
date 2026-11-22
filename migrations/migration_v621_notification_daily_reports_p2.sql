-- V621 p2: xác nhận ràng buộc và chỉ mục lập lịch mới. Chạy SAU migration_v621_notification_daily_reports.sql,
-- TỪNG LỆNH một (CREATE/DROP INDEX CONCURRENTLY không chạy trong giao dịch; Supabase CLI: mỗi lệnh một lần `db query`).
-- Chỉ mục cũ chỉ phủ report.scheduled nên lượt lập lịch quét bảng đăng ký (vài chục nghìn dòng sau khi gieo) mỗi 30 giây.
ALTER TABLE public.auto_notifications VALIDATE CONSTRAINT auto_notifications_event_type_check;
ALTER TABLE public.auto_notification_subscriptions VALIDATE CONSTRAINT auto_notification_subscriptions_event_type_check;
ALTER TABLE public.auto_email_notification_settings VALIDATE CONSTRAINT auto_email_notification_settings_client_check;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auto_notification_subscriptions_reports_due ON public.auto_notification_subscriptions (next_run_at)
  WHERE event_type IN ('report.scheduled', 'report.morning') AND is_enabled;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_auto_notification_subscriptions_report_due;

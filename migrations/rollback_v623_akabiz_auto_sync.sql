-- Gỡ V623: bỏ hàm public.akabiz_import_auto_desktop_v1(jsonb).
-- Không xoá dữ liệu đã chép (tài khoản, chiến dịch, dòng lịch sử nguồn 'akabiz_auto_sqlite').
-- CHECK nguồn chỉ thu hẹp lại khi bảng chưa có dòng 'akabiz_auto_sqlite'; có rồi thì giữ CHECK rộng để không mất lịch sử.
DO $r623$
BEGIN
 IF to_regprocedure('public.akabiz_import_auto_desktop_v1(jsonb)') IS NOT NULL THEN
   DROP FUNCTION public.akabiz_import_auto_desktop_v1(jsonb);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.akabiz_zalo_import_history WHERE source_system='akabiz_auto_sqlite') THEN
   ALTER TABLE public.akabiz_zalo_import_history DROP CONSTRAINT akabiz_zalo_import_history_source_system_check;
   ALTER TABLE public.akabiz_zalo_import_history ADD CONSTRAINT akabiz_zalo_import_history_source_system_check
     CHECK (source_system='akabiz_main_sql');
 ELSE
   RAISE NOTICE 'V623 rollback: giữ CHECK nguồn mở rộng vì đã có lịch sử akabiz_auto_sqlite';
 END IF;
END $r623$;

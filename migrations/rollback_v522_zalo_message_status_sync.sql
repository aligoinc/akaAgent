-- Gỡ bỏ "Đồng bộ trạng thái tin nhắn Zalo" (migration_zalo_message_status_sync.sql).
-- Ở akaAgent file này là migrations/rollback_v522_zalo_message_status_sync.sql (giống nhau từng byte). Sau khi gỡ, muốn cài lại
-- trên DB có sổ migration thì phải xoá dòng 'migration_v522_%' khỏi sổ hoặc cài bằng một số mới.
-- Xoá trigger, hàm, lịch job, bảng của tính năng (KỂ CẢ kết quả đã ghi trong auto_zalo_message_status) và 18 dòng
-- cấu hình. Không đụng dữ liệu nguồn hay cơ chế theo dõi tương tác V339. Muốn giữ kết quả thì sao lưu bảng trước.
-- Trạng thái phụ đã ghi vào kết quả chiến dịch (auto_campaign_details.sub_status_id) được GIỮ NGUYÊN: đó là dữ liệu của
-- kết quả, và gỡ nó đồng nghĩa với ghi lại hàng loạt vào bảng lớn.
-- Quy tắc 'zalo.*' trong auto_status_event_rules và hai trạng thái đã bật trong auto_status (nếu đã chạy
-- catalog_zalo_message_status_statuses.sql) KHÔNG bị đụng tới ở đây: gỡ bằng catalog_rollback_zalo_message_status_statuses.sql.
-- Tắt tính năng mà không gỡ: chỉ cần đặt zalo.message_status_sync.enabled = 'false'.
-- Chạy bằng cùng vai trò đã apply migration (pg_cron chỉ cho gỡ lịch job của chính vai trò đã đặt).
--
-- Hai giao dịch. Giao dịch 1 chỉ gỡ hai lịch job và trigger: DROP TRIGGER khoá hẳn bảng auto_campaign_details, nên không lệnh
-- nào được phép chạy (và chờ khoá khác) sau nó trong cùng giao dịch. Không lấy được khoá trong 2 giây thì bỏ cuộc, không đổi
-- gì; chạy lại là được. Giao dịch 2 xoá phần còn lại và chạy lại được nếu bị dừng giữa chừng (ví dụ job đang chạy dở).

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $unschedule$
DECLARE
  v_job text;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOREACH v_job IN ARRAY ARRAY['aka-agent-zalo-message-status', 'aka-agent-zalo-message-status-results'] LOOP
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job) THEN
        PERFORM cron.unschedule(v_job);
      END IF;
    END LOOP;
  END IF;
END
$unschedule$;

DROP TRIGGER IF EXISTS trg_auto_zalo_status_register ON public.auto_campaign_details;

COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.aka_agent_desktop_ingest_zalo_message_status(jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_ingest_zalo_message_status(text, jsonb);
DROP FUNCTION IF EXISTS private.auto_zalo_status_run(integer);
DROP PROCEDURE IF EXISTS private.auto_zalo_status_flush_results(integer);
DROP FUNCTION IF EXISTS private.auto_zalo_status_flush_result_step(jsonb, integer);
DROP FUNCTION IF EXISTS private.auto_zalo_status_flush_result_chunk(integer, bigint);
DROP FUNCTION IF EXISTS private.auto_zalo_status_result_status_map();
DROP FUNCTION IF EXISTS private.auto_zalo_status_result_kinds(jsonb);
DROP FUNCTION IF EXISTS private.auto_zalo_status_result_rules();
DROP FUNCTION IF EXISTS private.auto_zalo_status_apply(jsonb, jsonb, text[]);
DROP FUNCTION IF EXISTS private.auto_zalo_status_on_detail_insert();
DROP FUNCTION IF EXISTS private.auto_zalo_status_register_detail(bigint, bigint, bigint, jsonb, timestamptz, jsonb);
DROP FUNCTION IF EXISTS private.auto_zalo_status_in_scope(jsonb, bigint);
DROP FUNCTION IF EXISTS private.auto_zalo_status_account(bigint, interval);
DROP FUNCTION IF EXISTS private.auto_zalo_status_has_akachat(bigint);
DROP FUNCTION IF EXISTS private.auto_zalo_status_config();
DROP FUNCTION IF EXISTS private.auto_zalo_status_timestamp(text);
DROP FUNCTION IF EXISTS private.auto_zalo_status_list(text);
DROP FUNCTION IF EXISTS private.auto_zalo_status_int(text, integer, integer, integer);
DROP FUNCTION IF EXISTS private.auto_zalo_status_bool(text, boolean);

DROP TABLE IF EXISTS private.auto_zalo_status_desktop_usage;
DROP TABLE IF EXISTS private.auto_zalo_status_result_state;
DROP TABLE IF EXISTS private.auto_zalo_status_result_queue;
DROP TABLE IF EXISTS private.auto_zalo_status_runs;
DROP TABLE IF EXISTS private.auto_zalo_status_state;
DROP TABLE IF EXISTS private.auto_zalo_status_counters;
DROP TABLE IF EXISTS private.auto_zalo_status_failures;
DROP TABLE IF EXISTS private.auto_zalo_status_accounts;
DROP TABLE IF EXISTS private.auto_zalo_status_events;
DROP TABLE IF EXISTS public.auto_zalo_message_status;

DELETE FROM public.auto_system_settings WHERE key = ANY (ARRAY[
  'zalo.message_status_sync.enabled', 'zalo.message_status_sync.capture_enabled',
  'zalo.message_status_sync.reconcile_enabled', 'zalo.message_status_sync.organization_ids',
  'zalo.message_status_sync.realtime_kinds', 'zalo.message_status_sync.keep_raw_events',
  'zalo.message_status_sync.reply_window_days', 'zalo.message_status_sync.reply_ignored_kinds',
  'zalo.message_status_sync.seen_match_mode', 'zalo.message_status_sync.track_friend_accept',
  'zalo.message_status_sync.reconcile_window', 'zalo.message_status_sync.reconcile_every_minutes',
  'zalo.message_status_sync.retention_days', 'zalo.message_status_sync.flush_interval_seconds',
  'zalo.message_status_sync.flush_max_rows', 'zalo.message_status_sync.max_events_per_day',
  'zalo.message_status_sync.update_result_status', 'zalo.message_status_sync.result_status_max_per_minute']);

COMMIT;

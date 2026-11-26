-- Gỡ migration_v659_engine_network_proxy_codes (chỉ tắt dòng mới, không xoá: auto_engine_outcomes có thể đã giữ mã NET04).
-- Desktop bản sau gửi lỗi mở trang ở bước danh tính như bước mở trang: sau khi gỡ, lỗi đó ra FB44 như bước mở trang hôm nay (không còn FB06).
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $unpatch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.aka_agent_engine_report_v1(bigint, uuid, jsonb, boolean, boolean)'::regprocedure);
  IF md5(v_def) IS DISTINCT FROM 'b39e1e9dbcab4775d96779bd4799b63a' THEN RAISE EXCEPTION 'V659: aka_agent_engine_report_v1 đã đổi (md5 %)', md5(v_def); END IF;
  IF array_length(string_to_array(v_def, '        -- V558: câu bước tiếp theo của mã Facebook (anh duyệt 17/11, Q23) nối sau câu dừng; mã khác (Zalo, SYS) giữ nguyên câu cũ.
        -- V659: NET02 (proxy của tài khoản, Facebook lẫn Zalo) cũng nối câu bước tiếp theo (anh chốt 26/11).
        || coalesce(''. '' || nullif(btrim((SELECT e.customer_help FROM public.auto_error e
                                          WHERE e.error_code = v_last_error_code
                                            AND (e.public_code LIKE ''FB%'' OR e.error_code = ''err_proxy_failed''))), ''''), '''');'), 1) <> 2 THEN RAISE EXCEPTION 'V659: đoạn vá report_v1 không đúng một chỗ'; END IF;
  v_new := replace(v_def, '        -- V558: câu bước tiếp theo của mã Facebook (anh duyệt 17/11, Q23) nối sau câu dừng; mã khác (Zalo, SYS) giữ nguyên câu cũ.
        -- V659: NET02 (proxy của tài khoản, Facebook lẫn Zalo) cũng nối câu bước tiếp theo (anh chốt 26/11).
        || coalesce(''. '' || nullif(btrim((SELECT e.customer_help FROM public.auto_error e
                                          WHERE e.error_code = v_last_error_code
                                            AND (e.public_code LIKE ''FB%'' OR e.error_code = ''err_proxy_failed''))), ''''), '''');', '        -- V558: câu bước tiếp theo của mã Facebook (anh duyệt 17/11, Q23) nối sau câu dừng; mã khác (Zalo, SYS) giữ nguyên câu cũ.
        || coalesce(''. '' || nullif(btrim((SELECT e.customer_help FROM public.auto_error e
                                          WHERE e.error_code = v_last_error_code AND e.public_code LIKE ''FB%'')), ''''), '''');');
  IF md5(v_new) IS DISTINCT FROM '78ed8f80c4ff7de3cae3eb3e36bb6e1b' THEN RAISE EXCEPTION 'V659: thân report_v1 sau vá lệch (md5 %)', md5(v_new); END IF;
  EXECUTE v_new;
  IF md5(pg_get_functiondef('public.aka_agent_engine_report_v1(bigint, uuid, jsonb, boolean, boolean)'::regprocedure)) IS DISTINCT FROM '78ed8f80c4ff7de3cae3eb3e36bb6e1b' THEN
    RAISE EXCEPTION 'V659: thân report_v1 sau khi tạo lại lệch';
  END IF;
END $unpatch$;
UPDATE public.auto_outcome_signal_rules SET is_active = false, updated_at = now() WHERE source = 'v659' AND is_active;
UPDATE public.auto_outcome_policies SET log_template = 'Mất kết nối tới Zalo, tạm ngưng tài khoản tới {until}'
 WHERE error_code = 'err_network_offline' AND is_active AND NOT is_delete AND action_code = ANY (ARRAY['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_message_friend', 'zalo_message_group', 'zalo_add_friend', 'zalo_add_group_member', 'zalo_join_group', 'zalo_join_group_link', 'zalo_tag_contact', 'zalo_change_alias', 'zalo_cancel_sent_friend_request']::text[]) AND log_template = 'Kết nối mạng bị gián đoạn, tạm ngưng tài khoản tới {until}'
   AND source IS DISTINCT FROM 'v659';
UPDATE public.auto_outcome_policies SET is_active = false WHERE source = 'v659' AND is_active;
UPDATE public.auto_error SET customer_help = NULL, updated_at = now() WHERE error_code = 'err_proxy_failed' AND customer_help = 'Kiểm tra lại proxy của tài khoản rồi bấm Tiếp tục chiến dịch.';
UPDATE public.auto_error SET customer_title = 'Kết nối mạng tạm thời gián đoạn', updated_at = now() WHERE error_code = 'err_network_offline' AND customer_title = 'Kết nối mạng bị gián đoạn';
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code = 'err_proxy_unknown_delivery';
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v659' AND is_active)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v659' AND is_active)
     OR (SELECT count(*) FROM public.auto_outcome_policies WHERE error_code = 'err_network_offline' AND is_active AND NOT is_delete
           AND action_code = ANY (ARRAY['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_message_friend', 'zalo_message_group', 'zalo_add_friend', 'zalo_add_group_member', 'zalo_join_group', 'zalo_join_group_link', 'zalo_tag_contact', 'zalo_change_alias', 'zalo_cancel_sent_friend_request']::text[]) AND log_template = 'Mất kết nối tới Zalo, tạm ngưng tài khoản tới {until}') <> 11
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_proxy_failed' AND customer_help IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_network_offline' AND customer_title = 'Kết nối mạng tạm thời gián đoạn') THEN
    RAISE EXCEPTION 'Gỡ V659: dữ liệu chưa về bản cũ';
  END IF;
END $post$;
COMMIT;

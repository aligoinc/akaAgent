-- Rollback V494 (trạng thái hệ thống + danh sách trạng thái theo hành động). Chỉ chạy khi người dùng yêu cầu rõ.
-- DDL (DROP TABLE, ALTER TABLE) làm PostgREST nạp lại schema → chạy ngoài giờ cao điểm.
--
-- Chỉ gỡ đúng những gì V494 thêm: bảng auto_account_action_result_statuses và hàm guard của nó, 8 trạng thái chưa bật
-- (6 lỗi/dừng của Zalo, 2 tương tác), ràng buộc + cột auto_status.system_status_code, bảng auto_system_statuses. Không sửa
-- dòng nào khác của auto_status.
-- Từ chối nếu 8 trạng thái mới đã được dùng (policy, auto_error theo id hoặc theo chữ, automation, kết quả đã ghi, luật sự
-- kiện / chính sách / trạng thái gốc của engine V495) hoặc
-- đã có trạng thái kết quả khác được thêm sau V494: khi đó phải đối chiếu tay, không xóa cưỡng ép.
-- Nếu sau V494 đã có trang quản trị ghi vào hai bảng mới, chép dữ liệu ra biên nhận trước:
--   SELECT * FROM public.auto_system_statuses ORDER BY sort_order;
--   SELECT * FROM public.auto_account_action_result_statuses ORDER BY action_code, sort_order;
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $v494_rollback_guard$
DECLARE
  v_new bigint[];
BEGIN
  IF to_regclass('public.auto_system_statuses') IS NULL THEN
    RAISE EXCEPTION 'rollback v494: chưa apply V494 (không có auto_system_statuses)';
  END IF;
  SELECT array_agg(id) INTO v_new FROM public.auto_status
   WHERE code IN ('campaign_detail_receiver_blocked', 'campaign_detail_account_restricted', 'campaign_detail_limit_reached',
                  'campaign_detail_session_expired', 'campaign_detail_connection_error', 'campaign_detail_result_unknown',
                  'campaign_detail_reacted', 'campaign_detail_replied');
  IF coalesce(cardinality(v_new), 0) <> 8 THEN
    RAISE EXCEPTION 'rollback v494: không đủ 8 trạng thái của V494, đối chiếu tay';
  END IF;
  IF (SELECT count(*) FROM public.auto_status WHERE component_type = 'campaign_detail') <> 30 THEN
    RAISE EXCEPTION 'rollback v494: số trạng thái kết quả khác 30, đã có trạng thái thêm sau V494';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_status WHERE id = ANY(v_new) AND is_active) THEN
    RAISE EXCEPTION 'rollback v494: có trạng thái mới đã được bật';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_account_action_status_policies WHERE status_id = ANY(v_new))
     OR EXISTS (SELECT 1 FROM public.auto_error e WHERE e.detail_status_id = ANY(v_new)
                OR lower(e.detail_status) IN (SELECT lower(status_value) FROM public.auto_status WHERE id = ANY(v_new)))
     OR EXISTS (SELECT 1 FROM public.auto_campaign_action_detail_statuses WHERE status_id = ANY(v_new))
     OR EXISTS (SELECT 1 FROM public.auto_automation_trigger_statuses WHERE sub_status_ids && v_new)
     OR EXISTS (SELECT 1 FROM public.auto_campaign_details WHERE status_id = ANY(v_new) OR sub_status_id = ANY(v_new))
     -- Engine V495: luật sự kiện, chính sách và trạng thái "xử lý như" trỏ tới 8 dòng này.
     OR EXISTS (SELECT 1 FROM public.auto_status_event_rules WHERE status_id = ANY(v_new))
     OR EXISTS (SELECT 1 FROM public.auto_outcome_policies
                 WHERE status_id = ANY(v_new) OR detail_status_id = ANY(v_new) OR sub_status_id = ANY(v_new))
     OR EXISTS (SELECT 1 FROM public.auto_status WHERE parent_status_id = ANY(v_new)) THEN
    RAISE EXCEPTION 'rollback v494: 8 trạng thái mới đã được dùng, không xóa';
  END IF;
END
$v494_rollback_guard$;

DROP TABLE public.auto_account_action_result_statuses;
DROP FUNCTION public.aka_agent_guard_action_result_status_v494();
ALTER TABLE public.auto_status DROP CONSTRAINT auto_status_detail_system_status_check;
DELETE FROM public.auto_status
 WHERE code IN ('campaign_detail_receiver_blocked', 'campaign_detail_account_restricted', 'campaign_detail_limit_reached',
                'campaign_detail_session_expired', 'campaign_detail_connection_error', 'campaign_detail_result_unknown',
                'campaign_detail_reacted', 'campaign_detail_replied');
ALTER TABLE public.auto_status DROP COLUMN system_status_code;
DROP TABLE public.auto_system_statuses;
-- Không đặt lại auto_status_id_seq: 8 id đã cấp không dùng lại.
COMMIT;

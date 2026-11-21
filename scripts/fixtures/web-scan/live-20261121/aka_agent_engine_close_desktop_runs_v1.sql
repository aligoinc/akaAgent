CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_desktop_runs_v1(p_staff_id bigint, p_exclude_zalo boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- V576 (A): Desktop đăng nhập / đăng xuất / thoát app (reset_desktop_running_statuses_no_retry, sau khi bộ lập lịch đã dừng): lượt engine v2
-- còn mở của nhân viên trên Desktop không còn ai chạy. Đóng từng lượt như hàm đóng lượt cũ của engine trước khi hàm reset đánh dấu mọi data
-- "đang chạy" là "hoàn thành": chưa ghi dấu "sắp gửi" thì về hàng đợi (chưa gửi gì), đã ghi dấu thì hoàn thành, không gửi lại.
-- Phiên Desktop chỉ đóng được lượt của chính nhân viên. Lượt đang bị khoá (job close_stale đang đóng) thì bỏ qua: job đóng nó, không chờ khoá
-- chéo. Trả số lượt đã đóng.
DECLARE
  v_id bigint;
  v_n integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR NOT public.aka_agent_engine_scope_ok(p_staff_id) THEN RETURN 0; END IF;
  FOR v_id IN
    SELECT tr.id FROM public.auto_engine_target_runs tr
      JOIN public.auto_accounts a ON a.id = tr.account_id
     WHERE tr.completed_at IS NULL AND tr.staff_id = p_staff_id AND tr.runtime_target = 'desktop'
       AND NOT (coalesce(p_exclude_zalo, false) AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo')
     ORDER BY tr.id
     FOR UPDATE OF tr SKIP LOCKED
  LOOP
    IF public.aka_agent_engine_close_run_v1(v_id, 'desktop_reset') <> 'skipped' THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $function$

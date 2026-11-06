-- Rollback thủ công V471: tắt hai policy 112/161 của zalo_message_group.
-- Giữ dòng ở trạng thái inactive để bảo toàn lịch sử (chi tiết đã ghi giữ error_code).
-- Hai mã quay về err_zalo_api_business_failed từ lượt chạy bắt đầu sau khoảng 60 giây
-- (cache danh mục); lượt đang chạy giữ danh mục cũ tới khi kết thúc.
-- KHÔNG tự trả lại hàng đợi các mục tiêu đã bị 161 chuyển sang 'tạm dừng', không sửa
-- kết quả lịch sử hoặc bộ đếm. Cách tìm các mục tiêu đó: docs/ZALO_GROUP_112_161_POLICY_V471.md.
-- Chạy khi chưa apply hoặc đã rollback thì không ghi gì.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $migration$
DECLARE
  c_action constant text := 'zalo_message_group';
  policies constant jsonb[] := ARRAY[
    $v471${"is_active":true,"is_delete":false,"error_code":"err_zalo_112_message_group","error_type":"external zalo","error_name":"Zalo từ chối gửi nội dung vào nhóm (mã 112)","error_desc":"Áp dụng riêng zalo_message_group (nhắn và chia sẻ tin vào nhóm) khi Zalo trả mã 112; Zalo không nêu lý do. Thường gặp ở bước chia sẻ phần chữ sau khi file đã vào được nhóm. Ghi thất bại, không trừ hạn mức, vẫn tính chuỗi mục tiêu lỗi, không tạm dừng mục tiêu nên lần chạy sau vẫn thử lại. Lượt đã gửi được file vẫn trừ hạn mức theo app. Không áp dụng cho đổi tên gợi nhớ, nhắn bạn bè hoặc người lạ.","error_element":null,"noti_running_process":"Zalo từ chối gửi nội dung vào nhóm này (mã 112)","noti_campaign":"Zalo từ chối gửi nội dung vào nhóm này (mã 112)","update_status_account":null,"update_status_campaign":null,"update_login_status":null,"disable_action_codes":[],"time_disable_actions":null,"disable_action_mode":"fixed_minutes","disable_action_days":null,"disable_action_time":null,"count_consecutive_errors":null,"zalo_error_codes":["112"],"zalo_action_codes":["zalo_message_group"],"detail_status":"thất bại","detail_status_id":null,"detail_mode":null,"input_effect":null,"counts_toward_limit":false,"counts_toward_bad_target":true}$v471$::jsonb,
    $v471${"is_active":true,"is_delete":false,"error_code":"err_zalo_161_group_not_found","error_type":"external zalo","error_name":"Nhóm Zalo không còn tồn tại (mã 161)","error_desc":"Áp dụng riêng zalo_message_group khi Zalo trả mã 161 “Nhóm này không tồn tại.” (nhóm đã giải tán hoặc bị xoá). Ghi không tồn tại, không trừ hạn mức, không tính chuỗi mục tiêu lỗi. input_effect=pause chuyển mục tiêu sang tạm dừng nên các khung giờ và ngày sau không gửi lại; muốn gửi lại phải chuyển mục tiêu về chờ xử lý.","error_element":null,"noti_running_process":"Nhóm Zalo này không còn tồn tại (mã 161)","noti_campaign":"Nhóm Zalo này không còn tồn tại (mã 161)","update_status_account":null,"update_status_campaign":null,"update_login_status":null,"disable_action_codes":[],"time_disable_actions":null,"disable_action_mode":"fixed_minutes","disable_action_days":null,"disable_action_time":null,"count_consecutive_errors":null,"zalo_error_codes":["161"],"zalo_action_codes":["zalo_message_group"],"detail_status":"không tồn tại","detail_status_id":null,"detail_mode":null,"input_effect":"pause","counts_toward_limit":false,"counts_toward_bad_target":false}$v471$::jsonb
  ];
  our_codes text[];
  expected jsonb;
  existing public.auto_error%ROWTYPE;
  current_state jsonb;
  others_before text;
  others_after text;
  bad text;
BEGIN
  SELECT array_agg(p->>'error_code') INTO our_codes FROM unnest(policies) p;
  SELECT md5(coalesce(string_agg(to_jsonb(e)::text, ',' ORDER BY e.id), '')) INTO others_before
    FROM public.auto_error e WHERE e.error_code <> ALL(our_codes);

  -- Chỉ tắt dòng đúng nội dung V471; dòng đã bị sửa tay thì dừng để người quyết định.
  FOREACH expected IN ARRAY policies LOOP
    SELECT * INTO existing FROM public.auto_error WHERE error_code=expected->>'error_code' FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    current_state := to_jsonb(existing)-'id'-'created_at'-'updated_at';
    IF current_state = expected THEN
      UPDATE public.auto_error SET is_active=false, updated_at=clock_timestamp() WHERE id=existing.id;
    ELSIF current_state IS DISTINCT FROM expected || '{"is_active":false}'::jsonb THEN
      RAISE EXCEPTION 'V471 rollback: % drift, review manually', expected->>'error_code';
    END IF;
  END LOOP;

  FOREACH expected IN ARRAY policies LOOP
    IF EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code=expected->>'error_code'
        AND (to_jsonb(e)-'id'-'created_at'-'updated_at') IS DISTINCT FROM expected || '{"is_active":false}'::jsonb) THEN
      RAISE EXCEPTION 'V471 rollback: % postflight failed', expected->>'error_code';
    END IF;
  END LOOP;

  SELECT md5(coalesce(string_agg(to_jsonb(e)::text, ',' ORDER BY e.id), '')) INTO others_after
    FROM public.auto_error e WHERE e.error_code <> ALL(our_codes);
  IF others_after IS DISTINCT FROM others_before THEN
    RAISE EXCEPTION 'V471 rollback: other auto_error rows changed';
  END IF;

  -- Nhắn/chia sẻ nhóm không còn nhận policy V471.
  SELECT string_agg(r.error_code, ', ') INTO bad
    FROM unnest(ARRAY['112','161']) code
    CROSS JOIN LATERAL (
      SELECT e.error_code FROM public.auto_error e
      WHERE (e.error_code=code OR code=ANY(e.zalo_error_codes))
        AND e.is_active AND NOT e.is_delete
        AND (cardinality(e.zalo_action_codes)=0 OR c_action=ANY(e.zalo_action_codes))
      ORDER BY (c_action=ANY(e.zalo_action_codes)) DESC, (e.error_code=code) DESC, e.id
      LIMIT 1
    ) r
    WHERE r.error_code = ANY(our_codes);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'V471 rollback: still resolving %', bad; END IF;
END
$migration$;
COMMIT;

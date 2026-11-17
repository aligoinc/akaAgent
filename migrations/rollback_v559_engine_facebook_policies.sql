-- Gỡ V559: xoá chính sách và luật v559_fb_draft, bật lại dòng seed_v495_error của mã Facebook, tắt 4 mã mới (không xoá dòng auto_error vì
-- lịch sử có thể đã tham chiếu), trả dòng FB04 của bộ cũ về như trước (khoá thao tác, tạm dừng tài khoản). SINH TỪ scripts/build-v559-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DELETE FROM public.auto_outcome_policies WHERE source = 'v559_fb_draft';
DELETE FROM public.auto_outcome_signal_rules WHERE source = 'v559_fb_draft';
UPDATE public.auto_outcome_policies SET is_active = true, updated_at = now()
 WHERE source = 'seed_v495_error' AND error_code IN ('err_limit_waiting_message', 'err_group_post_frequency_limit', 'err_comment_frequency_limit', 'err_fb_checkpoint', 'err_fb_feature_blocked', 'err_fb_identity_switch_failed', 'err_fb_identity_restore_failed', 'err_fb_page_permission_token_missing', 'err_fb_page_permission_no_page_token', 'err_fb_page_permission_api_error', 'err_fb_group_cannot_post_not_member', 'err_fb_group_cannot_post_join_pending', 'err_fb_group_cannot_post_admin_only', 'err_fb_group_cannot_post_unavailable', 'err_fb_comment_unavailable_post_pending', 'err_fb_comment_unavailable_comment_disabled', 'err_fb_comment_unavailable_post_not_found', 'err_fb_comment_unavailable_not_member', 'err_fb_messenger_unavailable_target_not_messageable', 'err_fb_messenger_unavailable_e2ee_pin_required', 'err_fb_messenger_unavailable_account_restricted', 'err_fb_add_friend_unavailable', 'err_fb_page_inbox_customer_not_found', 'err_fb_page_inbox_wrong_conversation', 'err_fb_page_inbox_cannot_reply_outside_window', 'err_fb_page_inbox_cannot_reply_blocked_by_user', 'err_fb_join_group_failed_limit', 'err_fb_join_group_failed_questions_required', 'err_fb_join_group_failed_ui', 'err_fb_post_not_confirmed', 'err_fb_post_not_published_content_blocked', 'err_fb_post_not_published_duplicate', 'err_fb_formatted_content_rejected', 'err_fb_media_upload_timeout', 'err_fb_composer_editor_not_found', 'err_fb_post_button_not_found', 'err_fb_page_inbox_ui', 'err_fb_upload_form_changed', 'err_fb_group_invite_ui', 'err_fb_group_composer_editor_not_found', 'err_fb_comment_box_not_found') AND action_code IS NULL AND NOT is_active AND NOT is_delete;
UPDATE public.auto_error SET is_active = false, is_delete = true
 WHERE error_type = 'engine v2' AND error_code IN ('err_engine_fb_action_failed', 'err_engine_fb_logged_out', 'err_engine_fb_ui_not_ready', 'err_engine_fb_no_history');
-- Trả câu cho khách của mã Facebook về như trước V559 (chỉ dòng còn đúng câu V559 ghi).
UPDATE public.auto_error e SET customer_title = v.old_title, customer_help = v.old_help
  FROM (VALUES
  ('err_limit_waiting_message', 'Nhắn tin', NULL, 'Facebook đang hạn chế nhắn tin cho người lạ'),
  ('err_group_post_frequency_limit', 'Giới hạn tần suất đăng bài group', NULL, 'Facebook báo tài khoản đăng bài vào nhóm quá nhanh'),
  ('err_comment_frequency_limit', 'Giới hạn tần suất comment', NULL, 'Facebook báo tài khoản bình luận quá nhanh'),
  ('err_fb_checkpoint', 'Facebook yêu cầu xác minh tài khoản', NULL, 'Facebook yêu cầu xác minh tài khoản'),
  ('err_fb_feature_blocked', 'Facebook tạm chặn một tính năng', NULL, 'Facebook đang tạm chặn tính năng này của tài khoản'),
  ('err_fb_identity_switch_failed', 'Không chuyển được sang danh tính Facebook cần dùng', NULL, 'Không chuyển được sang Page để đăng bài'),
  ('err_fb_identity_restore_failed', 'Không khôi phục được danh tính Facebook ban đầu', NULL, 'Không chuyển lại được về tài khoản cá nhân sau khi dùng Page'),
  ('err_fb_page_permission_token_missing', 'Thiếu phiên truy cập Facebook Business', NULL, 'Tài khoản chưa đăng nhập Facebook Business'),
  ('err_fb_page_permission_no_page_token', 'Thiếu quyền hoặc token đăng bài lên Page', NULL, 'Tài khoản không đăng được bài lên Page này'),
  ('err_fb_page_permission_api_error', 'Facebook Graph API tạm thời không xử lý được yêu cầu', NULL, 'Facebook đang lỗi tạm thời, chưa đăng được bài lên Page'),
  ('err_fb_group_cannot_post_not_member', 'Chưa là thành viên nhóm Facebook', NULL, 'Tài khoản chưa vào nhóm này nên chưa đăng bài được'),
  ('err_fb_group_cannot_post_join_pending', 'Đang chờ duyệt tham gia nhóm Facebook', NULL, 'Đang chờ duyệt tham gia nhóm'),
  ('err_fb_group_cannot_post_admin_only', 'Nhóm Facebook chỉ cho quản trị viên đăng bài', NULL, 'Nhóm này chỉ cho quản trị viên đăng bài'),
  ('err_fb_group_cannot_post_unavailable', 'Nhóm Facebook không khả dụng', NULL, 'Nhóm không tồn tại'),
  ('err_fb_comment_unavailable_post_pending', 'Bài Facebook đang chờ duyệt nên chưa bình luận được', NULL, 'Bài viết đang chờ duyệt nên chưa bình luận được'),
  ('err_fb_comment_unavailable_comment_disabled', 'Bài Facebook đã tắt bình luận', NULL, 'Bài viết đã tắt bình luận'),
  ('err_fb_comment_unavailable_post_not_found', 'Không tìm thấy bài Facebook để bình luận', NULL, 'Không tìm thấy bài viết để bình luận'),
  ('err_fb_comment_unavailable_not_member', 'Chưa đủ quyền thành viên để bình luận trong nhóm', NULL, 'Tài khoản chưa vào nhóm này nên chưa bình luận được'),
  ('err_fb_messenger_unavailable_target_not_messageable', 'Người nhận không thể nhận tin nhắn Facebook', NULL, 'Người này không nhận tin nhắn từ tài khoản'),
  ('err_fb_messenger_unavailable_e2ee_pin_required', 'Messenger yêu cầu thiết lập PIN hoặc khôi phục tin nhắn', NULL, 'Messenger yêu cầu mã PIN hoặc khôi phục tin nhắn'),
  ('err_fb_messenger_unavailable_account_restricted', 'Facebook hạn chế nhắn tin của tài khoản', NULL, 'Facebook đang hạn chế nhắn tin của tài khoản'),
  ('err_fb_add_friend_unavailable', 'Không thể gửi lời mời kết bạn Facebook', NULL, 'Không gửi được lời mời kết bạn (Facebook ẩn nút kết bạn)'),
  ('err_fb_page_inbox_customer_not_found', 'Không tìm thấy khách trong hộp thư Page', NULL, 'Không tồn tại'),
  ('err_fb_page_inbox_wrong_conversation', 'Chưa xác minh được đúng hội thoại khách trên Page', NULL, 'Không tìm đúng cuộc trò chuyện với khách này trên Page'),
  ('err_fb_page_inbox_cannot_reply_outside_window', 'Hội thoại Page đã ngoài thời hạn trả lời', NULL, 'Đã quá thời gian Facebook cho Page nhắn lại khách này'),
  ('err_fb_page_inbox_cannot_reply_blocked_by_user', 'Khách không cho Page gửi tin nhắn', NULL, 'Khách không nhận tin nhắn từ Page'),
  ('err_fb_join_group_failed_limit', 'Facebook giới hạn tham gia nhóm', NULL, 'Facebook tạm không cho tài khoản tham gia thêm nhóm'),
  ('err_fb_join_group_failed_questions_required', 'Nhóm Facebook yêu cầu trả lời câu hỏi tham gia', NULL, 'Nhóm bắt trả lời câu hỏi mới cho tham gia'),
  ('err_fb_join_group_failed_ui', 'Giao diện tham gia nhóm Facebook chưa xử lý được', NULL, 'Không bấm được nút tham gia nhóm'),
  ('err_fb_post_not_confirmed', 'Chưa xác nhận được kết quả đăng bài Facebook', NULL, 'Chưa xác nhận được bài đã đăng'),
  ('err_fb_post_not_published_content_blocked', 'Facebook từ chối nội dung hoặc liên kết bài đăng', NULL, 'Facebook không cho đăng nội dung hoặc link này'),
  ('err_fb_post_not_published_duplicate', 'Facebook báo nội dung đăng bị trùng', NULL, 'Facebook báo bài bị trùng nội dung'),
  ('err_fb_formatted_content_rejected', 'Facebook không nhận nội dung định dạng', NULL, 'Facebook không nhận nội dung có định dạng (chữ đậm, nghiêng…)'),
  ('err_fb_media_upload_timeout', 'Tải ảnh hoặc video lên Facebook chưa hoàn tất', NULL, 'Tải ảnh hoặc video lên Facebook chưa hoàn tất'),
  ('err_fb_composer_editor_not_found', 'Không mở được ô nhập bài đăng Facebook', NULL, 'Không mở được ô viết bài trên trang cá nhân'),
  ('err_fb_post_button_not_found', 'Không tìm thấy nút đăng hoặc chia sẻ trên Facebook', NULL, 'Không thấy nút Đăng hoặc nút Chia sẻ'),
  ('err_fb_page_inbox_ui', 'Giao diện hộp thư Page chưa sẵn sàng', NULL, 'Hộp thư Page chưa mở được'),
  ('err_fb_upload_form_changed', 'Không tìm thấy form tải media Facebook phù hợp', NULL, 'Không thấy chỗ tải ảnh hoặc video lên Facebook'),
  ('err_fb_group_invite_ui', 'Giao diện mời bạn vào nhóm Facebook chưa xử lý được', NULL, 'Không mở được chỗ mời bạn bè vào nhóm'),
  ('err_fb_group_composer_editor_not_found', 'Không tìm thấy ô đăng bài trong nhóm Facebook', NULL, 'Không thấy ô đăng bài trong nhóm'),
  ('err_fb_comment_box_not_found', 'Không tìm thấy ô bình luận', NULL, 'Không thấy ô bình luận dưới bài')
  ) AS v(error_code, old_title, old_help, new_title)
 WHERE e.error_code = v.error_code AND e.error_type = 'external facebook' AND e.customer_title IS NOT DISTINCT FROM v.new_title;
-- Trả dòng FB04 của bộ cũ về như trước V559 (chỉ khi chưa ai sửa tiếp sau V559).
UPDATE public.auto_error SET disable_action_codes = ARRAY['fb_add_friend', 'fb_comment', 'fb_group_invite', 'fb_join_group', 'fb_like_post', 'fb_message_friend', 'fb_message_page_inbox_customer', 'fb_message_stranger', 'fb_post_group', 'fb_post_my_profile', 'fb_post_page']::text[], disable_action_mode = 'indefinite',
  update_status_account = 'tạm dừng', updated_at = now()
 WHERE error_code = 'err_fb_checkpoint' AND error_type = 'external facebook' AND cardinality(disable_action_codes) = 0 AND update_status_account IS NULL;

DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(issue || ':' || subject, ', ') INTO v_bad FROM public.aka_agent_engine_policy_lint;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V559 postflight lint: %', v_bad; END IF;
END $post$;

COMMIT;

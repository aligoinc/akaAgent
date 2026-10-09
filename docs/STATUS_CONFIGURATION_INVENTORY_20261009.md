# Danh mục trạng thái và policy hiện có

Chụp danh mục akachat lúc `2026-10-09T03:34:44.203193+00:00`. Đây là toàn bộ danh mục tại thời điểm đọc, không phải danh sách DISTINCT trên toàn bộ lịch sử detail. Phân tích và thiết kế nằm trong [bản rà soát](STATUS_CONFIGURATION_AUDIT_20261009.md).

## Trạng thái input data

| ID | Code | Tên | Status key | Terminal |
| --- | --- | --- | --- | --- |
| 16 | campaign_input_data_pending | Chờ xử lý | pending | False |
| 17 | campaign_input_data_paused | Tạm dừng | paused | False |
| 18 | campaign_input_data_running | Đang chạy | running | False |
| 19 | campaign_input_data_completed | Hoàn thành | completed | True |

## Trạng thái nguồn input

| ID | Code | Tên | Status key | Terminal |
| --- | --- | --- | --- | --- |
| 11 | campaign_input_pending | Chờ xử lý | pending | False |
| 12 | campaign_input_paused | Tạm dừng | paused | False |
| 13 | campaign_input_running | Đang chạy | running | False |
| 14 | campaign_input_completed | Hoàn thành | completed | True |
| 15 | campaign_input_error | Lỗi | error | True |

## Trạng thái kết quả hành động

| ID | Code | Tên | Status key | Terminal |
| --- | --- | --- | --- | --- |
| 20 | campaign_detail_success | Thành công | success | True |
| 21 | campaign_detail_failed | Thất bại | failed | True |
| 22 | campaign_detail_error | Lỗi | error | True |
| 23 | campaign_detail_clicked | Đã click | clicked | False |
| 24 | campaign_detail_alias_changed | Đã đổi tên | alias_changed | True |
| 25 | campaign_detail_tag_applied | Đã gắn tag | tag_applied | True |
| 26 | campaign_detail_sent | Đã gửi | sent | False |
| 27 | campaign_detail_invitation_sent | Đã gửi lời mời | invitation_sent | True |
| 28 | campaign_detail_friend_request_sent | Đã gửi lời mời kết bạn | friend_request_sent | True |
| 29 | campaign_detail_message_sent | Đã gửi tin nhắn | message_sent | True |
| 30 | campaign_detail_already_friend | Đã là bạn bè | already_friend | True |
| 31 | campaign_detail_already_member | Đã là thành viên | already_member | True |
| 32 | campaign_detail_received | Đã nhận | received | False |
| 33 | campaign_detail_joined | Đã tham gia | joined | True |
| 34 | campaign_detail_viewed | Đã xem | viewed | False |
| 35 | campaign_detail_calling | Đang gọi | calling | False |
| 36 | campaign_detail_not_found | Không tồn tại | not_found | True |
| 37 | campaign_detail_tag_not_found | Tag không tồn tại | tag_not_found | True |
| 38 | campaign_detail_invalid_parameter | Tham số không hợp lệ | invalid_parameter | True |

`is_terminal` hiện là metadata; không tự điều khiển scheduler, retry hoặc cách đếm. Tên cùng dạng ở component khác nhau vẫn là các trạng thái khác nhau.

## Danh mục khác trong auto_status

| ID | Component | Code | Tên |
| --- | --- | --- | --- |
| 1 | account | account_pending | Chờ xử lý |
| 2 | account | account_running | Đang chạy |
| 3 | account | account_paused | Tạm dừng |
| 4 | account_login | account_login_not_logged_in | Chưa đăng nhập |
| 5 | account_login | account_login_logged_in | Đã đăng nhập |
| 6 | account_login | account_login_checkpoint | Checkpoint |
| 7 | campaign | campaign_pending | Chờ xử lý |
| 8 | campaign | campaign_running | Đang chạy |
| 9 | campaign | campaign_paused | Tạm dừng |
| 10 | campaign | campaign_completed | Hoàn thành |

## Toàn bộ policy lỗi

Cột hạn mức và bad target là cấu hình của policy; hiệu lực cuối hiện còn phụ thuộc caller. `detail_status=NULL` có nghĩa khác nhau theo nhánh runtime, không được suy ra mặc định là lỗi. Hai policy tắt được giữ nguyên.

| ID | Mã | Tên | Detail status | Hạn mức | Bad target | Bật |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | err_logout | Tài khoản bị đăng xuất | NULL | True | True | True |
| 2 | error_limit_in_day | Đạt giới hạn trong ngày | NULL | True | True | True |
| 3 | error_limit_in_hour | Đạt giới hạn trong giờ | NULL | True | True | True |
| 4 | err_undefined | Lỗi không xác định | NULL | True | True | True |
| 5 | err_limit_waiting_message | Nhắn tin | NULL | True | True | True |
| 6 | err_group_post_frequency_limit | Giới hạn tần suất đăng bài group | NULL | True | True | True |
| 7 | err_zalo_user_not_found | Zalo không tồn tại | không tồn tại | True | False | True |
| 8 | err_zalo_invalid_param | Tham số không hợp lệ | thất bại | True | True | True |
| 9 | err_zalo_find_phone_limit | Đạt giới hạn tìm SĐT trong giờ | NULL | True | False | True |
| 10 | err_zalo_receiver_blocks_stranger_message | Người nhận chặn tin nhắn người lạ | thất bại | False | False | True |
| 11 | err_zalo_receiver_blocks_message | Người nhận chặn tin nhắn | thất bại | False | False | True |
| 12 | err_zalo_message_stranger_limited | Hạn chế nhắn tin người lạ | thất bại | True | False | False |
| 13 | err_zalo_duplicate_or_fast_message | Tin nhắn trùng lặp hoặc gửi quá nhanh | thất bại | True | False | False |
| 14 | err_zalo_message_too_long | Nội dung quá dài | thất bại | True | True | True |
| 15 | err_zalo_add_friend_failed | Yêu cầu kết bạn không thành công | thất bại | True | True | True |
| 16 | err_zalo_session_invalid | Phiên đăng nhập Zalo không hợp lệ | NULL | False | False | True |
| 17 | err_zalo_group_invite_stranger_limit | Đạt giới hạn mời người lạ vào group | thất bại | True | False | True |
| 18 | err_zalo_api_business_failed | Thao tác Zalo thất bại | thất bại | True | True | True |
| 31 | err_zalo_friend_request_sent | Đã gửi lời mời kết bạn | đã gửi lời mời | False | False | True |
| 32 | err_zalo_already_friend | Đã là bạn bè | đã là bạn bè | False | False | True |
| 33 | err_email_recipient_not_found | Email không tồn tại | không tồn tại | False | False | True |
| 34 | err_comment_frequency_limit | Giới hạn tần suất comment | NULL | True | True | True |
| 35 | err_zalo_group_member_already_exists | Đã là thành viên group | đã là thành viên | False | False | True |
| 36 | err_zalo_find_phone_day_limit | Đạt giới hạn tìm SĐT trong ngày | NULL | True | False | True |
| 41 | err_zalo_add_friend_limit | Đạt giới hạn kết bạn trong giờ | thất bại | True | False | True |
| 42 | err_zalo_120_message_stranger | Zalo hạn chế nhắn người lạ (mã 120) | NULL | False | False | True |
| 43 | err_zalo_120_add_group_member | Zalo hạn chế thêm thành viên nhóm (mã 120) | NULL | False | False | True |
| 44 | err_zalo_802_message_stranger | Zalo hạn chế nhắn người lạ (mã 802) | NULL | False | False | True |
| 45 | err_zalo_802_add_group_member | Zalo hạn chế thêm thành viên nhóm (mã 802) | thất bại | True | False | True |
| 46 | err_zalo_123_message_friend | Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 123) | thất bại | True | False | True |
| 47 | err_zalo_123_message_stranger | Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 123) | thất bại | True | False | True |
| 48 | err_zalo_123_message_group | Zalo hạn chế nhắn nhóm do gửi nhanh hoặc trùng nội dung (mã 123) | thất bại | True | False | True |
| 49 | err_zalo_126_127_message_personal | Zalo từ chối tin nhắn cá nhân (mã 126) | thất bại | True | False | True |
| 50 | err_zalo_126_127_message_group | Zalo hạn chế nhắn nhóm (mã 126/127) | thất bại | True | False | True |
| 51 | err_zalo_126_add_group_member | Zalo từ chối lời mời vào nhóm (mã 126) | thất bại | True | False | True |
| 52 | err_zalo_221_message_group | Đạt giới hạn nhắn nhóm (mã 221) | thất bại | True | False | True |
| 53 | err_zalo_223_add_friend_pause | Danh sách yêu cầu kết bạn đã đầy | NULL | False | False | True |
| 54 | err_zalo_224_add_friend_full | Danh bạ Zalo đã đầy (mã 224) | NULL | False | False | True |
| 55 | err_zalo_215_251_add_friend_rejected | Người nhận không nhận lời mời kết bạn (mã 215/251) | thất bại | True | False | True |
| 56 | err_zalo_219_find_phone_invalid | Số điện thoại không hợp lệ (mã 219) | không tồn tại | True | False | True |
| 57 | err_zalo_227_join_group_link_invalid | Link nhóm Zalo không hợp lệ (mã 227) | thất bại | False | True | True |
| 58 | err_zalo_210_target_unavailable | Người nhận bị Zalo chặn (mã 210) | không tồn tại | False | False | True |
| 59 | err_zalo_264_269_add_group_member_pause | Zalo không cho thêm trực tiếp thành viên (mã 264/269) | NULL | False | False | True |
| 60 | err_zalo_127_message_friend | Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 127) | thất bại | True | False | True |
| 61 | err_zalo_127_message_stranger | Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 127) | thất bại | True | False | True |
| 62 | err_zalo_221_message_friend | Đạt giới hạn nhắn bạn bè (mã 221) | thất bại | True | False | True |
| 63 | err_fb_checkpoint | Facebook yêu cầu xác minh tài khoản | NULL | False | False | True |
| 64 | err_fb_feature_blocked | Facebook tạm chặn một tính năng | NULL | False | False | True |
| 65 | err_fb_identity_switch_failed | Không chuyển được sang danh tính Facebook cần dùng | NULL | False | False | True |
| 66 | err_fb_identity_restore_failed | Không khôi phục được danh tính Facebook ban đầu | NULL | False | False | True |
| 67 | err_fb_page_permission_token_missing | Thiếu phiên truy cập Facebook Business | NULL | False | False | True |
| 68 | err_fb_page_permission_no_page_token | Thiếu quyền hoặc token đăng bài lên Page | NULL | False | False | True |
| 69 | err_fb_page_permission_api_error | Facebook Graph API tạm thời không xử lý được yêu cầu | NULL | False | False | True |
| 70 | err_fb_group_cannot_post_not_member | Chưa là thành viên nhóm Facebook | thất bại | False | False | True |
| 71 | err_fb_group_cannot_post_join_pending | Đang chờ duyệt tham gia nhóm Facebook | thất bại | False | False | True |
| 72 | err_fb_group_cannot_post_admin_only | Nhóm Facebook chỉ cho quản trị viên đăng bài | thất bại | False | False | True |
| 73 | err_fb_group_cannot_post_unavailable | Nhóm Facebook không khả dụng | không tồn tại | False | False | True |
| 74 | err_fb_comment_unavailable_post_pending | Bài Facebook đang chờ duyệt nên chưa bình luận được | thất bại | False | False | True |
| 75 | err_fb_comment_unavailable_comment_disabled | Bài Facebook đã tắt bình luận | thất bại | False | False | True |
| 76 | err_fb_comment_unavailable_post_not_found | Không tìm thấy bài Facebook để bình luận | không tồn tại | False | False | True |
| 77 | err_fb_comment_unavailable_not_member | Chưa đủ quyền thành viên để bình luận trong nhóm | thất bại | False | False | True |
| 78 | err_fb_messenger_unavailable_target_not_messageable | Người nhận không thể nhận tin nhắn Facebook | thất bại | False | False | True |
| 79 | err_fb_messenger_unavailable_e2ee_pin_required | Messenger yêu cầu thiết lập PIN hoặc khôi phục tin nhắn | NULL | False | False | True |
| 80 | err_fb_messenger_unavailable_account_restricted | Facebook hạn chế nhắn tin của tài khoản | NULL | False | False | True |
| 81 | err_fb_add_friend_unavailable | Không thể gửi lời mời kết bạn Facebook | thất bại | False | False | True |
| 82 | err_fb_page_inbox_customer_not_found | Không tìm thấy khách trong hộp thư Page | không tồn tại | False | False | True |
| 83 | err_fb_page_inbox_wrong_conversation | Chưa xác minh được đúng hội thoại khách trên Page | thất bại | False | False | True |
| 84 | err_fb_page_inbox_cannot_reply_outside_window | Hội thoại Page đã ngoài thời hạn trả lời | thất bại | False | False | True |
| 85 | err_fb_page_inbox_cannot_reply_blocked_by_user | Khách không cho Page gửi tin nhắn | thất bại | False | False | True |
| 86 | err_fb_join_group_failed_limit | Facebook giới hạn tham gia nhóm | NULL | False | False | True |
| 87 | err_fb_join_group_failed_questions_required | Nhóm Facebook yêu cầu trả lời câu hỏi tham gia | thất bại | False | False | True |
| 88 | err_fb_join_group_failed_ui | Giao diện tham gia nhóm Facebook chưa xử lý được | NULL | False | False | True |
| 89 | err_fb_post_not_confirmed | Chưa xác nhận được kết quả đăng bài Facebook | thất bại | True | False | True |
| 90 | err_fb_post_not_published_content_blocked | Facebook từ chối nội dung hoặc liên kết bài đăng | thất bại | True | False | True |
| 91 | err_fb_post_not_published_duplicate | Facebook báo nội dung đăng bị trùng | thất bại | True | False | True |
| 92 | err_fb_formatted_content_rejected | Facebook không nhận nội dung định dạng | NULL | False | False | True |
| 93 | err_fb_media_upload_timeout | Tải ảnh hoặc video lên Facebook chưa hoàn tất | NULL | False | False | True |
| 94 | err_fb_composer_editor_not_found | Không mở được ô nhập bài đăng Facebook | NULL | False | False | True |
| 95 | err_fb_post_button_not_found | Không tìm thấy nút đăng hoặc chia sẻ trên Facebook | NULL | False | False | True |
| 96 | err_fb_page_inbox_ui | Giao diện hộp thư Page chưa sẵn sàng | NULL | False | False | True |
| 97 | err_fb_upload_form_changed | Không tìm thấy form tải media Facebook phù hợp | NULL | False | False | True |
| 98 | err_fb_group_invite_ui | Giao diện mời bạn vào nhóm Facebook chưa xử lý được | NULL | False | False | True |
| 99 | err_media_file_missing | Không dùng được tệp media của chiến dịch | NULL | False | False | True |
| 100 | err_input_invalid | Dữ liệu đầu vào không hợp lệ | thất bại | False | False | True |
| 101 | err_campaign_config_invalid | Cấu hình chiến dịch chưa hợp lệ | NULL | False | False | True |
| 102 | err_system_block_load | Không tải được block cần chạy | NULL | False | False | True |
| 103 | err_network_offline | Kết nối mạng tạm thời gián đoạn | NULL | False | False | True |
| 104 | err_proxy_failed | Proxy của tài khoản không kết nối được | NULL | False | False | True |
| 105 | err_ai_service_unavailable | Dịch vụ AI tạm thời không xử lý được yêu cầu | NULL | False | False | True |
| 106 | err_device_sleep | Thiết bị tạm ngừng kết nối khi ngủ | NULL | False | False | True |
| 107 | err_runtime_browser | Trình duyệt thực thi bị gián đoạn | NULL | False | False | True |
| 108 | err_server_unreachable | Chưa kết nối được máy chủ akaBiz | NULL | False | False | True |
| 109 | err_email_daily_limit | Gmail hết lượt gửi trong 24 giờ | NULL | False | False | True |
| 110 | err_email_web_login_required | Google yêu cầu đăng nhập lại Gmail | NULL | False | False | True |
| 111 | err_email_bad_credentials | Sai mật khẩu ứng dụng Gmail | NULL | False | False | True |
| 112 | err_email_login_throttled | Đăng nhập SMTP quá nhiều lần | NULL | False | False | True |
| 113 | err_email_server_busy | Máy chủ email tạm từ chối | NULL | False | False | True |
| 114 | err_email_connection | Mất kết nối tới máy chủ email | NULL | False | False | True |
| 115 | err_email_system_temporary | Lỗi kết nối server akaBiz khi gửi email | NULL | False | False | True |
| 116 | err_email_smtp_not_configured | Tài khoản email chưa cấu hình SMTP | NULL | False | False | True |
| 117 | err_email_missing_recipient | Thiếu email người nhận | thất bại | False | True | True |
| 118 | err_email_message_too_large | Email vượt dung lượng cho phép | NULL | False | False | True |
| 119 | err_email_content_blocked | Nội dung/tệp đính kèm bị chặn | NULL | False | False | True |
| 120 | err_email_send_failed | Lỗi gửi email chưa xác định | thất bại | True | True | True |

## Mapping điều kiện Automation

313 dòng mapping gồm nhiều lần dùng lại cùng tên trạng thái; không phải 313 trạng thái nghiệp vụ khác nhau. `action_code=NULL` là wildcard trong loại chiến dịch. Tất cả mapping trong bản chụp có status_id.

| Loại chiến dịch | Số mapping | Wildcard | Action cụ thể |
| --- | --- | --- | --- |
| email_send | 8 | 3 | email_send |
| facebook_comment_seeding | 8 | 3 | fb_comment, fb_like_post |
| facebook_comment_seeding_post | 8 | 3 | fb_comment, fb_like_post |
| facebook_find_data_group | 3 | 3 |  |
| facebook_find_data_search | 3 | 3 |  |
| facebook_group_invite | 8 | 3 | fb_group_invite |
| facebook_group_post | 11 | 3 | fb_comment, fb_like_post, fb_post_group |
| facebook_join_group | 7 | 3 | fb_join_group |
| facebook_message_friend | 6 | 3 | fb_message_friend |
| facebook_message_uid | 9 | 3 | fb_add_friend, fb_message_stranger |
| facebook_newsfeed_interaction | 7 | 3 | fb_comment, fb_like_post |
| facebook_page_post | 6 | 3 | fb_post_page |
| facebook_page_to_message | 7 | 3 | fb_message_page_inbox_customer |
| facebook_timeline_post | 10 | 3 | fb_comment, fb_like_post, fb_post_my_profile |
| sms_send | 8 | 3 | sms_send |
| voice_call | 3 | 0 | voice_call |
| zalo_add_group_member | 16 | 10 | zalo_add_group_member, zalo_find_phone_user |
| zalo_cancel_sent_friend_request | 12 | 10 | zalo_cancel_sent_friend_request |
| zalo_join_group_link | 13 | 10 | zalo_join_group_link |
| zalo_message_birthday | 12 | 10 | zalo_message_friend |
| zalo_message_friend | 18 | 10 | zalo_change_alias, zalo_message_friend, zalo_tag_contact |
| zalo_message_friend_recommendation | 23 | 10 | zalo_add_friend, zalo_change_alias, zalo_message_stranger, zalo_tag_contact |
| zalo_message_group | 12 | 10 | zalo_message_group |
| zalo_message_group_member | 23 | 10 | zalo_add_friend, zalo_change_alias, zalo_message_stranger, zalo_tag_contact |
| zalo_message_group_realtime | 23 | 10 | zalo_add_friend, zalo_change_alias, zalo_message_stranger, zalo_tag_contact |
| zalo_message_phone | 26 | 10 | zalo_add_friend, zalo_change_alias, zalo_find_phone_user, zalo_message_stranger, zalo_tag_contact |
| zalo_message_remarketing_customer | 23 | 10 | zalo_add_friend, zalo_change_alias, zalo_message_stranger, zalo_tag_contact |

Toàn bộ từng dòng/ID/mô tả được lưu trong [database-catalogs.json](audits/status-configuration-20261009/database-catalogs.json).

## Mẫu lịch sử gần nhất

Đọc 10.000 detail gần nhất bằng thứ tự ID giảm dần, chỉ lấy status/action_code/error_code. Có các status: `không tồn tại`, `lỗi`, `thành công`, `thất bại`, `đã gửi`, `đã là bạn bè`, `đã nhận`, `đã tham gia`. Không dùng mẫu này để khẳng định đã bao phủ mọi trạng thái lịch sử.

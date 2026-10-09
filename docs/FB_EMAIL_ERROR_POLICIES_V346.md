# Policy Facebook và Email v346

## Trạng thái

Đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`) với history **20261006033730 / migration_v346_fb_email_error_policies**, ngày 06/10/2026. **Không apply lại.** Thêm 58 policy đang bật; bảng từ 46 thành 104 dòng, toàn bộ 46 dòng cũ giữ nguyên từng giá trị và schema không đổi.

Theo yêu cầu tiếp theo của người dùng, đã bỏ bước quét tham chiếu dữ liệu riêng trong rollback. Khóa ngoại PostgreSQL vẫn hoạt động. Phép thử INSERT rồi ROLLBACK transaction đạt; phép thử DELETE để hoàn tác bị timeout 30 giây ở kiểm tra FK tự động. SQL rollback đã được lưu nhưng **chưa xác nhận hard DELETE chạy xong trong giới hạn hiện tại**. Không thêm index, tăng timeout, tắt constraint/trigger hay tăng connection.

## Kiểm tra lại sau khi làm rõ phạm vi

Người dùng xác nhận migration cần áp dụng là v346 FB/Email; v349 status_id đã bị áp dụng do hiểu nhầm. Sau khi được thông báo, người dùng xác nhận giữ v349; không chạy revert v349. Sau đó người dùng yêu cầu bỏ bước kiểm tra tham chiếu riêng của v346: “vậy bỏ qua bước kiểm tra thôi, vì kiểm tra cũng có được gì đâu”. Quyết định được lưu tại [rollback-check-decision.json](../migrations/snapshots/fb-email-policies-v346/rollback-check-decision.json).

Đã lưu thêm [before-apply.json](../migrations/snapshots/fb-email-policies-v346/before-apply.json) lúc 2026-10-06 03:29:03.181431+00, đủ **46** policy (gồm policy Zalo 221 do v348 thêm độc lập). 45 dòng ban đầu khớp toàn bộ giá trị; file before.json/backup-manifest ban đầu vẫn giữ nguyên. MD5 bản mới: `7da58da4309fca12355b1d8f95c91131`; SHA-256: `7d9fc143a0feb34fa53ae3b2991757ccab7357fda61acaae74eb68a6dcb409f0`.

Đã dựng lại preflight theo 46 dòng, quét lại source + block/workflow/RPC live: **0 tham chiếu tới 58 mã mới**; INSERT/ROLLBACK transaction lại thành công, 46 dòng cũ và sequence giữ nguyên. Các artifact chuẩn bị lần đầu được giữ trong initial-preparation/. Bản hiện tại phải dùng before-apply.json và before-apply-manifest.json.

Giữ phương án rollback bằng DELETE đúng các dòng mới. Bỏ truy vấn quét riêng các bảng dữ liệu sử dụng policy; không bỏ guard ID/mã/checksum, schema, code/workflow live hoặc FK của DB. Dữ liệu chẩn đoán không có FK cũng không còn được kiểm tra riêng. Đã thông báo kết quả DELETE timeout trước khi apply; bước kiểm chứng bắt buộc trước apply dùng INSERT rồi transaction ROLLBACK theo kế hoạch gốc, tách biệt với thử nghiệm hard DELETE bổ sung.

## Phạm vi

- Production: `akachat` / `cgjbsmqtfhqvttudyjzq`.
- 58 policy mới: 36 Facebook, 12 Email, 10 lỗi dùng chung. Tất cả `is_active=true`, `is_delete=false`.
- Giữ nguyên 46 policy hiện có tại lần kiểm tra lại, gồm dòng tắt; không sửa runtime, auto_blocks, auto_workflows, RPC, ACL hay connection.
- Các khoảng thời gian/điều kiện chưa thống nhất giữ trong mô tả, không suy diễn khóa vô thời hạn hoặc khóa account thay cho account–Page.
- Mã SMTP và Facebook không được ghi vào cột Zalo. Bật danh mục chưa tự triển khai bộ nhận diện lỗi.

## Sao lưu

- Chụp lúc `2026-10-06 00:39:55.03713+00`, đủ `45` dòng.
- Checksum PostgreSQL canonical JSON toàn bảng: `159646ca3dafb959177c1379c63e573a`.
- SHA-256 before.json: `6c6ddf2e518e32f1787e1f68b392762d399346d06851a5314afd94e06088ff3c`.
- [before.json](../migrations/snapshots/fb-email-policies-v346/before.json): đầy đủ row, ID, timestamp, trạng thái, canonical JSON/checksum; metadata cột, constraint/FK, index, trigger, RLS/ACL và sequence.
- [backup-manifest.json](../migrations/snapshots/fb-email-policies-v346/backup-manifest.json): checksum từng dòng và checksum file, bất biến trước khi INSERT.
- [catalog.json](../migrations/snapshots/fb-email-policies-v346/catalog.json): nguồn file/sheet/dòng và nguyên văn ô tham chiếu; [desired.json](../migrations/snapshots/fb-email-policies-v346/desired.json): payload chính xác.
- [after.json](../migrations/snapshots/fb-email-policies-v346/after.json) và [applied-manifest.json](../migrations/snapshots/fb-email-policies-v346/applied-manifest.json): đủ 104 dòng sau apply, ID/mã/checksum chính xác của 58 dòng mới; checksum toàn bảng `4dff9c5fb54e9267e0f4bc4b5f7a4359`.
- [SQL rollback](../migrations/tests/migration_v346_fb_email_error_policies_rollback.sql): chỉ DELETE theo receipt đã lưu, trong transaction có timeout và giữ FK; không cascade, không reset sequence, không phục hồi đè bảng. Lịch sử apply chứa receipt để khôi phục artifact nếu mất phản hồi sau commit.

## Kiểm chứng đã thực hiện

- Đọc lại backup trên đĩa: kiểm tra canonical JSON, MD5 từng dòng/toàn bảng/schema, SHA-256 manifest, số dòng và đầy đủ cột.
- Source `src`/`supabase/functions`, code/config live trong auto_blocks/auto_workflows và public function bodies: không tham chiếu tới 58 mã mới. [Runtime audit](../migrations/snapshots/fb-email-policies-v346/runtime-audit.json).
- INSERT bằng ID âm trong transaction: 58 cấu hình hợp lệ; các row cũ giữ nguyên; preflight từ chối checksum cũ sai. ROLLBACK ngoài transaction khôi phục dữ liệu, không tiêu thụ sequence. [Kết quả](../migrations/snapshots/fb-email-policies-v346/insert-smoke.json).
- Đã thử hard DELETE sau khi bỏ quét tham chiếu riêng: PostgreSQL hủy sau 30 giây tại truy vấn FK `SELECT 1 FROM ONLY public.auto_campaign_details ... error_code ... FOR KEY SHARE`. Transaction bị hủy; kiểm chứng lại 46 dòng, schema và sequence không đổi. Xem [kết quả thất bại](../migrations/snapshots/fb-email-policies-v346/delete-smoke-failure.json). Bảng detail khoảng 4 triệu dòng, chưa có index error_code; trước đó truy vấn dò một mã không tồn tại cũng timeout 5 giây.
- INSERT/transaction ROLLBACK với bản SQL cuối cùng thành công; kiểm tra checksum cũ sai và receipt rollback bị sửa đều bị từ chối. Không tiêu thụ sequence trong smoke. Không coi kết quả này là kiểm chứng hiệu năng hard DELETE.
- Apply transaction thành công, thêm 58 dòng khớp payload (is_active=true, is_delete=false); toàn bộ 46 dòng cũ và schema giữ nguyên. Mã action được kiểm tra hợp lệ/đang bật trước INSERT. Không reload schema hoặc sửa block/workflow/RPC.
- Không chạy typecheck/build ứng dụng vì không thay mã ứng dụng.

## Policy cũ được giữ nguyên

Toàn bộ **46** dòng trong before-apply.json, gồm policy đang tắt/xóa mềm và `err_zalo_221_message_friend` của v348, đã được đối chiếu checksum từng dòng sau apply.

## Danh mục mới

| Mã | Tên | Khóa hành động | Detail | Quota / bad-target |
|---|---|---|---|---|
| `err_fb_checkpoint` | Facebook yêu cầu xác minh tài khoản | fb_add_friend, fb_comment, fb_group_invite, fb_join_group, fb_like_post, fb_message_friend, fb_message_page_inbox_customer, fb_message_stranger, fb_post_group, fb_post_my_profile, fb_post_page; vô hạn | NULL | false / false |
| `err_fb_feature_blocked` | Facebook tạm chặn một tính năng | — | NULL | false / false |
| `err_fb_identity_switch_failed` | Không chuyển được sang danh tính Facebook cần dùng | — | NULL | false / false |
| `err_fb_identity_restore_failed` | Không khôi phục được danh tính Facebook ban đầu | — | NULL | false / false |
| `err_fb_page_permission_token_missing` | Thiếu phiên truy cập Facebook Business | — | NULL | false / false |
| `err_fb_page_permission_no_page_token` | Thiếu quyền hoặc token đăng bài lên Page | — | NULL | false / false |
| `err_fb_page_permission_api_error` | Facebook Graph API tạm thời không xử lý được yêu cầu | — | NULL | false / false |
| `err_fb_group_cannot_post_not_member` | Chưa là thành viên nhóm Facebook | — | thất bại | false / false |
| `err_fb_group_cannot_post_join_pending` | Đang chờ duyệt tham gia nhóm Facebook | — | thất bại | false / false |
| `err_fb_group_cannot_post_admin_only` | Nhóm Facebook chỉ cho quản trị viên đăng bài | — | thất bại | false / false |
| `err_fb_group_cannot_post_unavailable` | Nhóm Facebook không khả dụng | — | không tồn tại | false / false |
| `err_fb_comment_unavailable_post_pending` | Bài Facebook đang chờ duyệt nên chưa bình luận được | — | thất bại | false / false |
| `err_fb_comment_unavailable_comment_disabled` | Bài Facebook đã tắt bình luận | — | thất bại | false / false |
| `err_fb_comment_unavailable_post_not_found` | Không tìm thấy bài Facebook để bình luận | — | không tồn tại | false / false |
| `err_fb_comment_unavailable_not_member` | Chưa đủ quyền thành viên để bình luận trong nhóm | — | thất bại | false / false |
| `err_fb_messenger_unavailable_target_not_messageable` | Người nhận không thể nhận tin nhắn Facebook | — | thất bại | false / false |
| `err_fb_messenger_unavailable_e2ee_pin_required` | Messenger yêu cầu thiết lập PIN hoặc khôi phục tin nhắn | — | NULL | false / false |
| `err_fb_messenger_unavailable_account_restricted` | Facebook hạn chế nhắn tin của tài khoản | — | NULL | false / false |
| `err_fb_add_friend_unavailable` | Không thể gửi lời mời kết bạn Facebook | — | thất bại | false / false |
| `err_fb_page_inbox_customer_not_found` | Không tìm thấy khách trong hộp thư Page | — | không tồn tại | false / false |
| `err_fb_page_inbox_wrong_conversation` | Chưa xác minh được đúng hội thoại khách trên Page | — | thất bại | false / false |
| `err_fb_page_inbox_cannot_reply_outside_window` | Hội thoại Page đã ngoài thời hạn trả lời | — | thất bại | false / false |
| `err_fb_page_inbox_cannot_reply_blocked_by_user` | Khách không cho Page gửi tin nhắn | — | thất bại | false / false |
| `err_fb_join_group_failed_limit` | Facebook giới hạn tham gia nhóm | fb_join_group; 1440 phút | NULL | false / false |
| `err_fb_join_group_failed_questions_required` | Nhóm Facebook yêu cầu trả lời câu hỏi tham gia | — | thất bại | false / false |
| `err_fb_join_group_failed_ui` | Giao diện tham gia nhóm Facebook chưa xử lý được | — | NULL | false / false |
| `err_fb_post_not_confirmed` | Chưa xác nhận được kết quả đăng bài Facebook | — | thất bại | true / false |
| `err_fb_post_not_published_content_blocked` | Facebook từ chối nội dung hoặc liên kết bài đăng | — | thất bại | true / false |
| `err_fb_post_not_published_duplicate` | Facebook báo nội dung đăng bị trùng | — | thất bại | true / false |
| `err_fb_formatted_content_rejected` | Facebook không nhận nội dung định dạng | — | NULL | false / false |
| `err_fb_media_upload_timeout` | Tải ảnh hoặc video lên Facebook chưa hoàn tất | — | NULL | false / false |
| `err_fb_composer_editor_not_found` | Không mở được ô nhập bài đăng Facebook | — | NULL | false / false |
| `err_fb_post_button_not_found` | Không tìm thấy nút đăng hoặc chia sẻ trên Facebook | — | NULL | false / false |
| `err_fb_page_inbox_ui` | Giao diện hộp thư Page chưa sẵn sàng | — | NULL | false / false |
| `err_fb_upload_form_changed` | Không tìm thấy form tải media Facebook phù hợp | — | NULL | false / false |
| `err_fb_group_invite_ui` | Giao diện mời bạn vào nhóm Facebook chưa xử lý được | — | NULL | false / false |
| `err_media_file_missing` | Không dùng được tệp media của chiến dịch | — | NULL | false / false |
| `err_input_invalid` | Dữ liệu đầu vào không hợp lệ | — | thất bại | false / false |
| `err_campaign_config_invalid` | Cấu hình chiến dịch chưa hợp lệ | — | NULL | false / false |
| `err_system_block_load` | Không tải được block cần chạy | — | NULL | false / false |
| `err_network_offline` | Kết nối mạng tạm thời gián đoạn | — | NULL | false / false |
| `err_proxy_failed` | Proxy của tài khoản không kết nối được | — | NULL | false / false |
| `err_ai_service_unavailable` | Dịch vụ AI tạm thời không xử lý được yêu cầu | — | NULL | false / false |
| `err_device_sleep` | Thiết bị tạm ngừng kết nối khi ngủ | — | NULL | false / false |
| `err_runtime_browser` | Trình duyệt thực thi bị gián đoạn | — | NULL | false / false |
| `err_server_unreachable` | Chưa kết nối được máy chủ akaBiz | — | NULL | false / false |
| `err_email_daily_limit` | Gmail hết lượt gửi trong 24 giờ | email_send; 1440 phút | NULL | false / false |
| `err_email_web_login_required` | Google yêu cầu đăng nhập lại Gmail | — | NULL | false / false |
| `err_email_bad_credentials` | Sai mật khẩu ứng dụng Gmail | — | NULL | false / false |
| `err_email_login_throttled` | Đăng nhập SMTP quá nhiều lần | email_send; 30 phút | NULL | false / false |
| `err_email_server_busy` | Máy chủ email tạm từ chối | email_send; 30 phút | NULL | false / false |
| `err_email_connection` | Mất kết nối tới máy chủ email | email_send; 10 phút | NULL | false / false |
| `err_email_system_temporary` | Lỗi kết nối server akaBiz khi gửi email | email_send; 10 phút | NULL | false / false |
| `err_email_smtp_not_configured` | Tài khoản email chưa cấu hình SMTP | — | NULL | false / false |
| `err_email_missing_recipient` | Thiếu email người nhận | — | thất bại | false / true |
| `err_email_message_too_large` | Email vượt dung lượng cho phép | — | NULL | false / false |
| `err_email_content_blocked` | Nội dung/tệp đính kèm bị chặn | — | NULL | false / false |
| `err_email_send_failed` | Lỗi gửi email chưa xác định | — | thất bại | true / true |

## Công cụ

`node scripts/fb-email-policy-migration.cjs` dùng Supabase CLI linked qua Management API, không mở pg.Client/pg.Pool. Các mode: capture, prepare, smoke-insert, smoke, apply, verify, recover, rollback. Capture không ghi đè bản sao lưu đã có; apply yêu cầu full smoke đúng checksum; recover dùng receipt trong migration history nếu phản hồi apply không rõ.

Chưa chạy `apply` cho tới khi đã chốt và kiểm chứng phương án rollback.

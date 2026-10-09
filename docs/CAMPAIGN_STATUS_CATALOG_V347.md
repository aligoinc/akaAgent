# Danh mục trạng thái và mô tả cho agent — v347

Cập nhật sau triển khai: [v349](CAMPAIGN_STATUS_IDS_V349.md) đã thêm 16 trạng thái chuẩn và điền status_id cho 120 mapping. Các số liệu/NULL dưới đây ghi lại thời điểm v347; cần đối chiếu/revert v349 trước nếu muốn revert cả v347.

Đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`) ngày 06/10/2026; history **20261006012006 / migration_v347_campaign_status_agent_descriptions**. Không apply lại.

## Kết quả

- Thêm **55** tổ hợp trạng thái chưa có: Facebook 25, Zalo 25, SMS 2, voice call 3. Email đã có đủ các tổ hợp tìm thấy trong producer hiện tại nên không thêm trùng.
- Bảng `public.auto_campaign_action_detail_statuses`: **258 → 313 dòng**. Dòng mới `is_active=true`, `is_delete=false`.
- Thêm duy nhất cột **`description text NOT NULL DEFAULT <mô tả chung cho agent>`**, kèm COMMENT ON COLUMN. Không thêm bảng/index/RPC.
- Điền mô tả theo ngữ cảnh cho 258 dòng cũ và 55 dòng mới. Giữ nguyên mọi cột cũ, kể cả NULL, sort_order, trạng thái, ID và timestamp trong transaction áp dụng.
- Không sửa code ứng dụng, body/ACL RPC, block/workflow, auto_status hay auto_error. 11 điều kiện Automation giữ nguyên.

## Agent cần hiểu

Đây là **danh mục lựa chọn trạng thái detail**, không phải lịch sử chạy và không phải policy lỗi. Cột description không được dùng để thực thi hoặc so khớp điều kiện; không nhúng mã err_* vào bảng này.

- action_code=NULL là wildcard trong một loại chiến dịch, không phải mã hành động bị thiếu.
- status_id=NULL là trạng thái chưa có nhóm ngữ nghĩa auto_status. Không tự gắn ID thành công/thất bại theo suy đoán. Live hiện chỉ có nhóm Thành công=20, Thất bại=21, Lỗi=22.
- Automation so khớp status_value không phân biệt hoa/thường, cộng action_code cụ thể hoặc wildcard. label chỉ hiển thị; semantic ID phục vụ nhóm lựa chọn.
- Có một dòng danh mục không chứng minh runtime đã phát ra trạng thái đó, hoặc thao tác gửi/nhận đã xảy ra. Trạng thái lịch sử như “đã đổi tên” không tự trở thành alias của “thành công”.
- “đang gọi” là trạng thái trung gian; không seed các trạng thái nội bộ của voice job. Trạng thái chờ duyệt Facebook hiện ghi trong metadata/log, không tạo thêm status_value suy đoán.
- Dòng tự sinh sau này được default mô tả chung mà không cần sửa trigger/RPC. Mô tả chi tiết hiện có được giữ khi trigger cập nhật label/status_id/updated_at.
- RPC get_automation_options hiện vẫn trả tập field cũ: app đọc danh mục mới như trước, còn agent đọc description trực tiếp qua bảng/Data API. Thêm lựa chọn không tự thêm/chọn điều kiện cho Automation đang có.

## Cơ sở lựa chọn

Đối chiếu campaignActionDescriptors.ts, các nhánh ghi detail và helper trong campaignScheduler.ts, emailTrackingRepository.ts; metadata live của campaign/action/status; body live RPC SMS/voice; block 2772/2773 và 6 workflow Zalo thực sự sử dụng chúng. Các body SQL này chỉ được đọc để đối chiếu, không được chỉnh hoặc triển khai lại.

Không seed một tích Descartes hành động × trạng thái. Chẳng hạn like/newsfeed/timeline publishing và mời group không được bổ sung “thất bại” nếu nhánh hiện tại chỉ phát thành công/lỗi. Các tổ hợp đang có, kể cả tổ hợp lịch sử, giữ nguyên.

Bằng chứng và checksum nguồn nằm trong [snapshot](../migrations/snapshots/campaign-status-catalog-v347/): source-catalogs.json, producer-evidence.json, auxiliary-workflows.json, catalog.json. Migration fail-closed khi schema, business fields cũ, producer/RPC, block/workflow hoặc policy nguồn đổi.

## Snapshot và ghi đồng thời

1. [before.json](../migrations/snapshots/campaign-status-catalog-v347/before.json) lưu toàn bộ 258 dòng lúc 2026-10-06 01:14:42.719916+00, mọi cột, metadata schema/constraint/index/ACL/RLS/sequence, MD5 từng dòng/toàn bảng. File được đọc lại và kiểm tra SHA-256/MD5 trước khi smoke và apply. MD5 bảng: `645c68b8ad6d6fb34ce2fb5886c975b2`.
2. Runtime đang cập nhật updated_at nhiều lần mỗi giây. Bản preflight chỉ cho phép **updated_at** đổi từ bản lưu local; thay đổi bất kỳ business field nào hoặc số dòng/schema sẽ dừng. Lần thử đầu đã bị checksum chặn trước khi ghi, xác nhận thay đổi chỉ là runtime cập nhật timestamp.
3. [apply-before.json](../migrations/snapshots/campaign-status-catalog-v347/apply-before.json) chụp đầy đủ trạng thái **ngay sau khi lấy lock, trước ALTER/UPDATE/INSERT**. [after.json](../migrations/snapshots/campaign-status-catalog-v347/after.json) chụp ngay sau thay đổi trong cùng transaction. Hai JSON, cùng ID/checksum dòng mới và rollback SQL, được lưu nguyên tử trong history để phục hồi receipt nếu client mất kết nối sau COMMIT.
4. Đã so từng giá trị cũ của toàn bộ 258 dòng giữa apply-before và after: không đổi, **bao gồm updated_at**. Không reset timestamp để khớp một snapshot đã cũ. Hash apply-before: `50379453a9fcc4412f123bc145900985`; hash after: `fc50085d1ba8be47fe00f343add17301`.
5. applied-manifest.json lưu receipt 55 ID/campaign/action/status/checksum, hash file snapshot/migration/rollback. latest-verification.json ghi dữ liệu đọc lại; runtime tiếp tục cập nhật updated_at độc lập là bình thường.

Transaction dùng lock_timeout=3s, statement_timeout=30s, ACCESS EXCLUSIVE trên bảng danh mục nhỏ do ALTER TABLE; không giữ connection qua phiên, không thêm pool hay sửa ngân sách connection. Không khóa hoặc quét bảng auto_campaign_details lớn.

## Kiểm chứng

- Smoke trong transaction đã thêm cột, điền mô tả, INSERT 55 dòng ID âm, thử default cho dòng mới, rồi DELETE/DROP COLUMN và xác nhận toàn bảng/schema khớp snapshot trong lock; cuối cùng ROLLBACK. Sequence không bị smoke tiêu thụ/reset.
- Thử guard: snapshot business field sai, receipt checksum sai, description bị sửa, mapping đã được Automation tham chiếu đều bị từ chối. Fixture tham chiếu đọc một mapping đã dùng, không sửa điều kiện Automation.
- Apply: 55 dòng mới đều active/not-deleted, action và semantic status hợp lệ, 313 description không rỗng, không trùng identity active. Tất cả cột cũ của 258 dòng và 11 điều kiện Automation giữ nguyên trong transaction; checksum RPC/auto_error không đổi.
- REST sau apply: HTTP 200, thấy cột description và đủ 3 trạng thái voice_call. Thêm cột cần cập nhật cache schema; event trigger DDL hiện có đã xử lý. Không gọi reload thủ công hay thêm NOTIFY trùng.
- Không chạy build/typecheck ứng dụng vì không sửa source. Kiểm chứng trực tiếp SQL rollback + Data API phù hợp thay đổi này.

## Revert

Chỉ chạy khi người dùng yêu cầu revert:

`node scripts/campaign-status-catalog-migration.cjs rollback`

Hoặc review [SQL rollback](../migrations/tests/migration_v347_campaign_status_agent_descriptions_rollback.sql) đã gắn chính xác ID và checksum của đợt apply. Runner còn kiểm tra hash file SQL trước khi chạy.

Rollback kiểm tra cấu trúc bảng/cột/default/comment, toàn bộ giá trị từng dòng đã thêm, tham chiếu auto_automation_trigger_statuses, mô tả cũ và mô tả độc lập mới; chỉ xóa đúng 55 ID rồi drop cột description **không CASCADE**. Dòng mới bị runtime cập nhật updated_at cũng khiến rollback dừng đối chiếu vì checksum thay đổi. Không xóa cưỡng ép dòng đã sửa/được dùng, không TRUNCATE/phục hồi đè bảng/reset sequence.

Những dòng do runtime tự sinh độc lập được giữ; nếu chúng có mô tả tùy chỉnh, rollback dừng để tránh mất nội dung. Những trường cũ có thay đổi hợp lệ sau apply được giữ. Vì runtime ghi liên tục, bảng sau rollback không nhất thiết khớp nguyên snapshot cũ; nếu không có thay đổi độc lập, dữ liệu phải khớp apply-before. Sau rollback, runtime có thể tự tạo lại tổ hợp trạng thái khi sự kiện mới phát ra.

Giữ nguyên history apply; rollback thêm history riêng và lưu reverted.json, không xóa snapshot. Dùng mode recover nếu apply trả lỗi kết nối không rõ kết quả: đọc history trước, không INSERT lại.

## Các tổ hợp vừa bổ sung

| Loại chiến dịch | Hành động | Trạng thái | status_id |
|---|---|---|---|
| facebook_comment_seeding_post | fb_comment | lỗi | 22 |
| facebook_comment_seeding_post | fb_comment | thất bại | 21 |
| facebook_comment_seeding_post | fb_like_post | lỗi | 22 |
| facebook_comment_seeding_post | fb_like_post | thành công | 20 |
| facebook_comment_seeding | fb_comment | lỗi | 22 |
| facebook_comment_seeding | fb_like_post | lỗi | 22 |
| facebook_comment_seeding | fb_like_post | thành công | 20 |
| facebook_group_invite | fb_group_invite | lỗi | 22 |
| facebook_group_post | fb_comment | lỗi | 22 |
| facebook_group_post | fb_like_post | lỗi | 22 |
| facebook_group_post | fb_like_post | thành công | 20 |
| facebook_join_group | fb_join_group | thất bại | 21 |
| facebook_message_friend | fb_message_friend | lỗi | 22 |
| facebook_message_uid | fb_message_stranger | lỗi | 22 |
| facebook_newsfeed_interaction | fb_comment | lỗi | 22 |
| facebook_newsfeed_interaction | fb_comment | thành công | 20 |
| facebook_newsfeed_interaction | fb_like_post | lỗi | 22 |
| facebook_newsfeed_interaction | fb_like_post | thành công | 20 |
| facebook_timeline_post | fb_comment | lỗi | 22 |
| facebook_timeline_post | fb_comment | thành công | 20 |
| facebook_timeline_post | fb_comment | thất bại | 21 |
| facebook_timeline_post | fb_like_post | lỗi | 22 |
| facebook_timeline_post | fb_like_post | thành công | 20 |
| facebook_timeline_post | fb_post_my_profile | lỗi | 22 |
| facebook_timeline_post | fb_post_my_profile | thành công | 20 |
| sms_send | sms_send | không tồn tại | NULL |
| sms_send | sms_send | thành công | 20 |
| voice_call | voice_call | đang gọi | NULL |
| voice_call | voice_call | thành công | 20 |
| voice_call | voice_call | thất bại | 21 |
| zalo_add_group_member | zalo_add_group_member | đã là thành viên | NULL |
| zalo_message_birthday | zalo_message_friend | thất bại | 21 |
| zalo_message_friend_recommendation | zalo_add_friend | đã gửi lời mời | NULL |
| zalo_message_friend_recommendation | zalo_add_friend | không tồn tại | NULL |
| zalo_message_friend_recommendation | zalo_change_alias | tham số không hợp lệ | NULL |
| zalo_message_friend_recommendation | zalo_tag_contact | tag không tồn tại | NULL |
| zalo_message_friend_recommendation | zalo_tag_contact | thất bại | 21 |
| zalo_message_friend | zalo_change_alias | tham số không hợp lệ | NULL |
| zalo_message_friend | zalo_tag_contact | tag không tồn tại | NULL |
| zalo_message_friend | zalo_tag_contact | thất bại | 21 |
| zalo_message_group_member | zalo_change_alias | tham số không hợp lệ | NULL |
| zalo_message_group_member | zalo_tag_contact | tag không tồn tại | NULL |
| zalo_message_group_realtime | zalo_add_friend | không tồn tại | NULL |
| zalo_message_group_realtime | zalo_change_alias | tham số không hợp lệ | NULL |
| zalo_message_group_realtime | zalo_change_alias | thất bại | 21 |
| zalo_message_group_realtime | zalo_tag_contact | tag không tồn tại | NULL |
| zalo_message_group_realtime | zalo_tag_contact | thất bại | 21 |
| zalo_message_phone | zalo_change_alias | tham số không hợp lệ | NULL |
| zalo_message_remarketing_customer | zalo_add_friend | đã gửi lời mời | NULL |
| zalo_message_remarketing_customer | zalo_add_friend | không tồn tại | NULL |
| zalo_message_remarketing_customer | zalo_add_friend | thành công | 20 |
| zalo_message_remarketing_customer | zalo_change_alias | tham số không hợp lệ | NULL |
| zalo_message_remarketing_customer | zalo_change_alias | thành công | 20 |
| zalo_message_remarketing_customer | zalo_tag_contact | tag không tồn tại | NULL |
| zalo_message_remarketing_customer | zalo_tag_contact | thất bại | 21 |

## Công việc riêng còn chờ

V346 bổ sung policy Facebook/Email trong auto_error **chưa apply**; snapshot và dự thảo riêng vẫn giữ nguyên. Cần chốt phương án revert của bảng đó vì FK từ auto_campaign_details lớn làm physical DELETE rollback tốn thời gian. V347 không áp dụng thay cho v346 và không sửa policy lỗi.

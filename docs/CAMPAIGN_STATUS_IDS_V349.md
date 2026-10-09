# Chuẩn hóa status_id của campaign detail — v349

Làm rõ phạm vi sau triển khai: người dùng muốn áp dụng v346 (policy FB/Email), còn v349 đã được áp dụng do hiểu nhầm. Sau khi được thông báo, người dùng xác nhận **giữ v349** bằng câu “giữ đi”; không chạy revert. Xem [quyết định giữ](../migrations/snapshots/campaign-status-ids-v349/keep-decision.json) và snapshot scope-correction-review.json để đối chiếu thay đổi phát sinh.

Đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`) với history **20261006032336 / migration_v349_campaign_detail_status_ids**, ngày 06/10/2026. Không apply lại.

## Kết quả và phạm vi

- Thêm **16** trạng thái chuẩn vào `public.auto_status`, component_type=campaign_detail: tổng bảng 22 → 38; riêng component campaign_detail có 19 trạng thái.
- Điền `status_id` cho **120** mapping đang NULL trong `auto_campaign_action_detail_statuses`. Giữ nguyên 313 dòng và mọi ID mapping; sau apply còn **0** status_id NULL.
- Cập nhật đúng câu mô tả liên kết trên 120 dòng cho agent, bỏ thông tin cũ nói chưa có nhóm ngữ nghĩa. Giữ nguyên phần mô tả còn lại.
- Mỗi tên trạng thái khác nhau có một ID riêng; giữ nguyên các ID 20/21/22, không gộp alias hoặc trạng thái khác nghĩa. Toàn bộ 22 dòng auto_status cũ giữ nguyên từng giá trị.
- Các trường campaign_action_id/action_code/status_value/label/is_active/is_delete/sort_order/created_at/updated_at của mapping giữ nguyên trong transaction. Dòng đã có status_id không bị cập nhật.
- Không thay code ứng dụng, RPC, trigger, block/workflow, auto_error hoặc các điều kiện Automation. Không thêm bảng/cột/index/connection/pool; không reload schema và không có DDL chuẩn bị migration history.

## Ảnh hưởng đến app đang hoạt động

Luồng kích hoạt Automation hiện so sánh status_value (không phân biệt hoa/thường) và action_code cụ thể/wildcard. Không trường nào trong hai điều kiện này bị thay đổi. Các điều kiện đã lưu vẫn giữ nguyên.

UI và RPC lưu Automation dùng status_id để nhóm lựa chọn và bỏ điều kiện cụ thể đã được wildcard bao phủ. Migration kiểm tra quan hệ phân nhóm trước/sau trên **97969 cặp** mapping, gồm cả quy tắc loại trùng của RPC. Kết quả không gộp hoặc tách bất kỳ nhóm nào.

Đã chạy trực tiếp các hàm hiện tại trong automationDisplay.ts sau transpile: identity key và nhãn hiển thị của **313** mapping không đổi; toàn bộ **97969** cặp nhóm giữ nguyên. App không cần restart; lần tải danh mục tiếp theo nhận ID mới, còn ID lựa chọn cũ vẫn giữ.

Trigger hiện có tìm auto_status theo component_type và tên, nên sự kiện mới có thể tự gán ID tương ứng mà không cần sửa code. Trạng thái chưa từng khai báo trong tương lai vẫn có thể để NULL; migration không thêm NOT NULL hay đóng danh mục.

Các metadata mới: is_active=true, is_delete=false, is_default=false, can_set_manually=false, flatform_type=all vì danh mục tên được dùng chung (schema hiện chỉ cho all/facebook/zalo). is_terminal là mô tả milestone; các trạng thái đang gọi và tín hiệu gửi/nhận/xem/click giữ false, các kết quả helper kết thúc giữ true. Runtime kiểm tra ở đợt này không dùng cờ đó để điều khiển gửi hoặc Automation.

## Sao lưu, ghi đồng thời và kiểm chứng

[Thư mục snapshot](../migrations/snapshots/campaign-status-ids-v349/) lưu đầy đủ cả hai bảng, mọi cột, schema/constraint/index/ACL/RLS, trạng thái sequence, checksum từng dòng/toàn bảng và SHA-256 file. before.json được đọc lại và kiểm tra trước smoke/apply; backup-manifest.json lưu thông tin kiểm chứng.

Runtime thường xuyên cập nhật updated_at của mapping. Preflight chỉ cho phép trường timestamp này thay đổi so với bản local; thay đổi bất kỳ business field, số dòng, schema, auto_status hoặc body RPC liên quan sẽ dừng. apply-before.json chụp trạng thái dưới lock trước ghi, after.json chụp ngay sau ghi trong cùng transaction; hai bản và receipt được lưu nguyên tử trong migration history để xử lý trường hợp kết quả COMMIT chưa rõ.

Checksum apply-before: auto_status `5ca3688311d4fdec8d9459c1d880fa01`, mappings `7e5710391548df164a1726c3ab668005`. Sau apply: auto_status `ae58e6d62cdd1a9583b439efb02cdb9f`, mappings `eac568f2fa31cd21776ba33542b0f32e`.

Smoke dùng ID dương tạm (không gọi sequence), INSERT 16 trạng thái, backfill 120 mapping, kiểm tra nhóm/điều kiện/các cột khác, rồi thử SQL revert và cuối cùng ROLLBACK. Cả hai bảng khớp snapshot trong transaction, sequence không bị smoke tiêu thụ/reset. Các guard đã thử từ chối: checksum status sai, mapping sai/đã dùng, tham chiếu status độc lập, điều kiện Automation thay đổi, và gán sai ID 20 làm gộp nhóm.

Đã sửa lỗi cú pháp/biến trong script kiểm thử trước khi smoke hoàn tất; các lần thử lỗi đều nằm trong transaction hủy, không commit dữ liệu. Migration áp dụng là bản đã qua toàn bộ smoke.

Sau apply: Data API trả HTTP 200, đủ 19 trạng thái chuẩn campaign_detail và 0 mapping status_id NULL. Runtime function checksum, schema và 11 điều kiện Automation giữ nguyên. Không chạy build/typecheck toàn app vì không sửa source; đã kiểm chứng trực tiếp SQL, helper UI hiện tại và Data API.

Transaction dùng lock_timeout=3s, statement_timeout=30s, SHARE ROW EXCLUSIVE trên hai bảng danh mục nhỏ; SELECT thông thường vẫn được phép, writer có thể chờ ngắn trong transaction. Không khóa/quét bảng auto_campaign_details lớn. Không thể coi một thao tác ghi DB là không có chi phí, nhưng đợt này không dừng/restart app hay đổi logic nghiệp vụ.

## Revert

Chỉ khi người dùng yêu cầu revert, chạy:

`node scripts/campaign-status-ids-migration.cjs rollback`

SQL đầy đủ: [migration_v349_campaign_detail_status_ids_rollback.sql](../migrations/tests/migration_v349_campaign_detail_status_ids_rollback.sql). Dùng file này hoặc runner, không chạy riêng body lấy từ history thiếu transaction/lock bên ngoài.

Rollback giữ lock hai danh mục và SHARE lock bảng điều kiện Automation trong thời gian kiểm tra/khôi phục, giới hạn chờ 3 giây; tránh điều kiện mới được ghi sau khi kiểm tra tham chiếu. Kiểm tra schema, ID/code/checksum 16 dòng mới, checksum 120 mapping, tham chiếu phát sinh và điều kiện Automation liên quan so với baseline. Nếu runtime đã cập nhật mapping, kể cả updated_at, hoặc có thay đổi/sử dụng mới, rollback dừng để đối chiếu.

Khi đủ điều kiện: phục hồi **chỉ status_id và description** của đúng 120 mapping theo receipt, bảo đảm không còn tham chiếu mới rồi xóa đúng 16 auto_status đã thêm. Không xóa mapping/detail/điều kiện, không TRUNCATE, không khôi phục đè bảng, không reset sequence; không dùng ON DELETE SET NULL để xóa cưỡng ép tham chiếu.

Giữ snapshot và history apply; rollback ghi lịch sử riêng và reverted.json. Nếu cần revert cả v347, phải đối chiếu/revert v349 trước vì status_id và description của mapping đã đổi hợp lệ sau v347. Những trạng thái phát sinh độc lập về sau không bị xóa.

## ID đã cấp

| ID | Code | Tên |
|---:|---|---|
| 23 | campaign_detail_clicked | Đã click |
| 24 | campaign_detail_alias_changed | Đã đổi tên |
| 25 | campaign_detail_tag_applied | Đã gắn tag |
| 26 | campaign_detail_sent | Đã gửi |
| 27 | campaign_detail_invitation_sent | Đã gửi lời mời |
| 28 | campaign_detail_friend_request_sent | Đã gửi lời mời kết bạn |
| 29 | campaign_detail_message_sent | Đã gửi tin nhắn |
| 30 | campaign_detail_already_friend | Đã là bạn bè |
| 31 | campaign_detail_already_member | Đã là thành viên |
| 32 | campaign_detail_received | Đã nhận |
| 33 | campaign_detail_joined | Đã tham gia |
| 34 | campaign_detail_viewed | Đã xem |
| 35 | campaign_detail_calling | Đang gọi |
| 36 | campaign_detail_not_found | Không tồn tại |
| 37 | campaign_detail_tag_not_found | Tag không tồn tại |
| 38 | campaign_detail_invalid_parameter | Tham số không hợp lệ |

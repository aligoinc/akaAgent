# Link bình luận đầu tiên sau khi comment

Trạng thái: **V380 đã apply trên akachat ngày 13/10/2026 lúc 05:01 Việt Nam**, history `20261012220158 / migration_v380_facebook_first_comment_link`, element mới `1784 / fb_comment_permalink`. Đã đọc lại và xác minh đúng ba block, element và tám workflow không đổi. **Không apply lại khi merge/phát hành.** [Receipt](../migrations/snapshots/facebook-first-comment-link-v380/receipt.json), [preflight](../migrations/snapshots/facebook-first-comment-link-v380/preflight.json), [snapshot sau apply](../migrations/snapshots/facebook-first-comment-link-v380/after.json). Desktop cần chạy scheduler mới để lưu link vào chi tiết và log; đã đóng gói trong 8.3.0 local, chưa phát hành installer.

Cập nhật 05:11 cùng ngày: [V381](FACEBOOK_COMMENT_LINK_TRACKING_V381.md) đã bỏ tham số tracking khỏi `commentUrl` tại ba block, giữ comment/reply và tham số định danh bài. Snapshot/receipt V380 vẫn là bằng chứng lịch sử; kiểm chứng trạng thái live hiện tại bằng V381. Rollback V381 trước khi rollback V380.

## Hành vi

Người dùng đã test và xác nhận XPath bên dưới, yêu cầu lấy link đầu tiên sau khi gửi comment. Không đối chiếu tác giả, nội dung, thời gian hoặc danh sách trước/sau; chấp nhận phần tử đầu tiên có thể là bình luận đã có nếu Facebook đổi thứ tự hiển thị.

Element mới `fb_comment_permalink` trong `auto_elements`:

```xpath
(//*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')])[1]//*[@role='article' and .//*[@class='xt0psk2']]//a[contains(@href,'comment_id=') or contains(@href,'reply_comment_id=')]
```

Ba block live dùng chung cho workflow thật/test được bổ sung đọc `href` của `FIRST_ORDERED_NODE_TYPE` sau Enter, khoảng chờ 10 giây và kiểm tra giới hạn tần suất hiện có:

- `34 / fb_comment_at_position`: comment sau đăng group và comment seeding theo feed.
- `2616 / fb_comment_current_post`: comment seeding theo link bài post.
- `2710 / fb_newsfeed_comment_submit`: tương tác newsfeed, đọc trước khi workflow đóng dialog.

Block trả thêm `commentUrl`. Không click, focus, cuộn hoặc điều hướng để lấy link; không thêm thời gian chờ, đối chiếu hay retry gửi. Nếu không có dialog/link hoặc lỗi đọc element/trang, trả link rỗng và giữ kết quả comment hiện có. Hủy vẫn đi theo cơ chế hủy của runtime. Không thay xác nhận comment thành công: các block vẫn dùng Enter + chờ + kiểm tra lỗi tần suất hiện có, không thêm bằng chứng DOM mới.

Scheduler lấy link từ đúng output của từng lượt, lưu vào `auto_campaign_details.post_url` và `data.commentUrl`, thêm log `🔗 Link comment: ...`. Newsfeed giữ receipt hiện có để realtime/tổng kết không ghi hoặc tính lượt trùng. Không dùng `cleanPostLinkForStorage()` vì hàm đó xóa `comment_id`/`reply_comment_id`. Giao diện chi tiết, báo cáo và export dùng lại trường URL hiện có; không thêm cột/schema. Lượt thiếu link không lấy link của lượt trước.

## Nguồn và migration

[Snapshot live](../migrations/snapshots/facebook-first-comment-link-v380/before.json) chứa ba block, element textbox phụ thuộc và tám workflow thật/test tham chiếu; các node không có `codeOverride`. [Manifest](../migrations/snapshots/facebook-first-comment-link-v380/manifest.json) kiểm tra SHA-256; migration fail-closed theo MD5 toàn row của block/element phụ thuộc/workflow, kiểm tra element và history chưa tồn tại.

[Migration V380](../migrations/migration_v380_facebook_first_comment_link.sql) chỉ INSERT một element và UPDATE `code/output_schema/updated_at` của ba block; tám workflow và phần comment/upload cũ giữ nguyên. `output_schema` là dữ liệu JSON của block, không đổi metadata API. Không RPC/DDL/schema reload, không sửa detail lịch sử hay thêm pool/connection. Script apply dùng `supabase db query --linked` qua Management API hiện có, ghi history cùng transaction mà không tạo/alter bảng history.

```sh
node scripts/facebook-first-comment-link-v380.cjs preflight
node scripts/facebook-first-comment-link-v380.cjs apply
node scripts/facebook-first-comment-link-v380.cjs verify
```

Sau apply thành công không chạy lại khi merge/phát hành. Nếu kết quả apply không rõ, đọc history và chạy verify trước, không tự thử lại. `verify` chỉ đọc DB và cập nhật bằng chứng local. Cache XPath hiện có tự tải lại một lần khi thiếu tên mới; không cần thêm cơ chế cache hoặc timer. App cũ có thể chạy block mới và có `commentUrl` trong output, nhưng cần scheduler mới để lưu/hiện link.

[Rollback](../migrations/snapshots/facebook-first-comment-link-v380/rollback.sql) kiểm tra toàn row sau patch (trừ `updated_at`), khôi phục đúng code/schema output/thời gian của ba block. Giữ element mới, history và link/comment detail đã lưu; không xóa lịch sử.

## Kiểm chứng

- `node scripts/facebook-first-comment-link-smoke.cjs`: 48 ca chạy JS block thật, scheduler thật và PostgreSQL WASM offline; kiểm tra link đầu tiên, giữ query comment/reply, thiếu link/lỗi đọc vẫn thành công, không gửi lại, comment chỉ ảnh, bỏ qua/lỗi gửi/giới hạn tần suất, không dùng lại link giữa các lượt, newsfeed realtime/tổng kết và explicit envelopes không ghi trùng hoặc mượn link của input khác/kết quả lỗi, migration/rollback và drift guards.
- `node scripts/action-status-mixed-output-smoke.cjs`: 25 ca output cũ/mới, thứ tự kết quả và tính lượt đã qua.
- Hai typecheck Node/renderer đã qua.
- Chưa tự gửi comment thật. XPath đã được người dùng xác nhận; luồng end-to-end sau tích hợp còn cần test thực tế trên app có scheduler mới.

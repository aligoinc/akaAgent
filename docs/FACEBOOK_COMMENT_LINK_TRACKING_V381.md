# Bỏ tracking khỏi link comment Facebook

**Đã apply V381 trên akachat lúc 05:11 ngày 13/10/2026 (Việt Nam)**, history `20261012221138 / migration_v381_facebook_comment_link_tracking`. Đã đọc lại và xác minh toàn bộ ba block, element 1784 và tám workflow liên quan. Không apply lại khi merge/phát hành. [Receipt](../migrations/snapshots/facebook-comment-link-tracking-v381/receipt.json), [preflight](../migrations/snapshots/facebook-comment-link-tracking-v381/preflight.json), [snapshot sau apply](../migrations/snapshots/facebook-comment-link-tracking-v381/after.json).

V380 trả nguyên `href`, nên URL lưu/log còn `__cft__[0]`, `__cft__[1]`, `__tn__` từ Facebook. V381 làm sạch ngay trong `getFirstCommentUrl()` ở ba block 34, 2616, 2710: bỏ query key bắt đầu bằng `__` hoặc `utm_`, cùng `fbclid`, `mibextid`, `ref`, `refid`, `refsrc`, `locale`. Giữ `comment_id`, `reply_comment_id`, `id`, `story_fbid`, `fbid`, các tham số khác và fragment để bảo toàn đích bài/comment. Dùng `URL`/`URLSearchParams`; không cắt toàn bộ query. Link không parse được giữ hành vi cũ.

Ví dụ URL được người dùng cung cấp sau khi làm sạch:

```text
https://www.facebook.com/groups/164469482423151/permalink/1378592311010856/?comment_id=1387816013421819
```

XPath `fb_comment_permalink`, lựa chọn link đầu tiên, submit, khoảng chờ, kiểm tra tần suất và kết quả thành công giữ nguyên. Không thêm thao tác DOM, retry, điều hướng hoặc thời gian chờ. Không sửa scheduler, output schema, RPC, schema DB hay detail/link lịch sử; không cần schema reload hoặc nguồn connection mới. Block được nạp mới sẽ trả URL sạch; lượt đang giữ code cũ có thể vẫn trả URL cũ. Khả năng lưu/hiện link vẫn cần scheduler V380; bản sửa tracking không thêm yêu cầu cập nhật app.

## Nguồn và rollback

[Snapshot trước sửa](../migrations/snapshots/facebook-comment-link-tracking-v381/before.json) được lấy trực tiếp từ linked production `cgjbsmqtfhqvttudyjzq`; [manifest](../migrations/snapshots/facebook-comment-link-tracking-v381/manifest.json) giữ SHA-256 và canonical MD5. [Migration](../migrations/migration_v381_facebook_comment_link_tracking.sql) chỉ thay `code/updated_at` của ba block sau khi khóa, kiểm tra checksum toàn row và dependencies, V380 history có mặt và V381 chưa tồn tại. Apply qua Management API hiện có, history cùng transaction; không có DDL chuẩn bị.

[Rollback](../migrations/snapshots/facebook-comment-link-tracking-v381/rollback.sql) có guard chống ghi đè patch mới, khôi phục đúng code và timestamp của ba block trước V381; giữ history, element và detail cũ. **Rollback V381 trước V380.** Các script V380 vẫn kiểm tra bản V380 lịch sử, không dùng `verify` V380 để kiểm tra live sau V381.

## Kiểm chứng

- `node scripts/facebook-comment-link-tracking-v381-smoke.cjs`: 46 ca, thực thi JS của cả ba block và PostgreSQL WASM offline. Bao gồm URL mẫu, reply, query encode, `permalink.php`, `photo.php`, tham số chưa biết, fragment, URL lỗi/rỗng, lỗi đọc link, giữ output cũ và chuỗi thao tác; migration, rollback, block/element/workflow drift và history guards.
- `node scripts/facebook-first-comment-link-smoke.cjs`: 48 ca V380 qua, bao gồm scheduler lưu link và không tạo detail trùng.
- Live preflight/apply/read-back: đúng ba block, element và tám workflow không đổi.
- Không tự gửi comment thật. Lần test tiếp theo cần để workflow nạp block mới.

Lệnh `node scripts/facebook-comment-link-tracking-v381.cjs verify` đọc DB và cập nhật bằng chứng local; không chạy lại `apply` sau khi đã có history.

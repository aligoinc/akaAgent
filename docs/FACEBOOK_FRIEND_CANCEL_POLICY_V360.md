# Facebook kết bạn — hủy sau click và thứ tự policy v360

Ngày kiểm chứng: 09/10/2026. Production: `akachat / cgjbsmqtfhqvttudyjzq`.

## Thay đổi

Block `fb_add_friend` giữ kết quả `accepted` / `request_sent` ngay sau khi `page.click()` hoàn tất. Hủy trong sleep 2 giây trả lại kết quả đó; hủy trước click hoặc click chưa hoàn tất không được suy thành công. Tiêu chí thành công vẫn theo C# facebook.com đã đối chiếu trong [v359](FACEBOOK_FRIEND_STATUSES_V359.md), không thêm probe xác nhận hoặc retry.

Scheduler ghi một detail thành công có tính lượt, đánh dấu `deliveryCommitted` và giữ input hoàn thành khi workflow bị hủy/account bị dừng. Hủy sau thao tác đã hoàn tất không tự tạo `err_undefined`; lỗi thật của bước khác vẫn được xử lý theo policy. Các trạng thái đã gửi trước đó/đã là bạn/thiếu nút giữ cách xử lý v359.

Mỗi target giữ chung quyết định pause qua các lần áp policy. Khi một policy đã chuyển campaign sang `tạm dừng`, các policy sau vẫn áp trạng thái account/login và khóa hành động, nhưng không ghi đè trạng thái hoặc note của quyết định pause. Chiều ngược lại vẫn cho phép nâng từ `chờ xử lý` lên `tạm dừng`. Bộ đếm bad-target tiếp tục tăng tối đa một lần cho input có nhiều lỗi.

## Đối chiếu DOM

| C# step | Workflow v360 | Khác DOM không | Lý do |
|---|---|---|---|
| Probe đã gửi → chấp nhận → đã là bạn → thêm bạn | Giữ nguyên v359 | Không | Chỉ sửa kết quả khi hủy |
| Click nút đầu tiên rồi chờ | Giữ XPath, click target và sleep 2 giây của v359 | Không so với v359 | Khi hủy sleep, lưu lại click đã hoàn tất |

Khác biệt pacing Electron/C# và nguồn selector được ghi rõ trong audit v359.

## Migration và triển khai

[Migration v360](../migrations/migration_v360_facebook_friend_cancel_commit.sql) được dựng từ [snapshot live mới](../scripts/fixtures/facebook-friend-cancellation-live.json), không lấy body v359 trên đĩa để ghi đè. Preflight toàn row block MD5 `80a5c705172c9dc509f59f65fba595d3`, kiểm tra bốn selector và bốn workflow; chỉ cập nhật `code`/`updated_at` của block 39. MD5 code đích: `e8712f551ee23df11353fca29c15525a`.

Không sửa policy, RPC, schema, XPath, workflow, output schema hoặc connection. Apply/history chạy qua linked Management API, không DDL phụ hoặc reload schema. App cũ không có `facebookFriendOutcomeVersion=1` tiếp tục chạy nguyên body legacy.

Đã apply lúc **09:50:28 ngày 09/10/2026 (Việt Nam)**, history `20261009025028 / migration_v360_facebook_friend_cancel_commit`. Code checksum đích, bốn selector/workflow và policy đã được xác minh. Không apply lại khi phát hành Desktop.

Desktop đã build production local; chưa đóng gói/phát hành installer trong task này. Cần chạy Desktop mới để có cả phần scheduler; app đang phát hành vẫn dùng nhánh legacy.

## Kiểm chứng

- `node scripts/facebook-friend-status-smoke.cjs`: Electron DOM + block executor thật và method sleep thật. Hủy trước click, ngay sau click, trong sleep cho gửi/chấp nhận; click thất bại không thành công giả. Chạy code finalize input thật cho shutdown, pause và account-stop, xác nhận hoàn thành/không retry, một quota và không tăng lỗi do hủy. Giữ lỗi nhắn tin thật trong target có click kết bạn thành công.
- Cùng smoke: lỗi nhắn tin đạt ngưỡng 3→4 rồi policy kết bạn khóa action/account/login; giữ trạng thái và note pause đầu tiên với policy sau có status null/chờ xử lý/giới hạn giờ/tạm dừng. Chiều chờ xử lý→tạm dừng vẫn hoạt động. Kiểm tra policy/quota và các trạng thái v359 tiếp tục chạy.
- `node scripts/facebook-friend-cancellation-migration.cjs smoke`: trước apply, thử drift block/code/metadata, từng selector, từng workflow và apply lặp; xác nhận rollback toàn bộ.
- `node scripts/facebook-friend-cancellation-migration.cjs verify`: kiểm tra code đích, selector/workflow không đổi, policy và history sau apply.
- `node scripts/facebook-message-waiting-limit-smoke.cjs`, hai typecheck node/web và production build.

Không gửi lời mời Facebook thật trong kiểm thử. Rollback cần chụp checksum live mới trước khi khôi phục baseline, không apply lại v359/v360.

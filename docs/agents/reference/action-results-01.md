# Rich share và kết quả hành động

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 1024–1039. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
- Zalo rich share: friend/group share campaigns retain formatting and send up to 50 targets through nested `msgInfo.rtfProps`; never force normal/plain on rich toggle, templates or quick edit. Chat Sync recognizes `webchat/rtf` and its `params` styles. Preserve media-first/per-target failure behavior. If the whole spin is blank without media, recover a nonblank branch before forwarding; preserve optional blanks when text/media remains. See [ZALO_RICH_SHARE.md](../../../docs/ZALO_RICH_SHARE.md).

V362/V363/V364 đã apply 09/10/2026: reader/Automation/CRM tương thích, writer result theo claim+unit và quyền SELECT(code,is_active,is_delete) của Chat trên catalog action. Không apply lại; audit/checksum/rollback ở [ACTION_STATUS_READERS_V362.md](../../../docs/ACTION_STATUS_READERS_V362.md). Policy nạp một lần/run, detail lưu quyết định đã áp dụng; không tính lại lịch sử, không thêm pool/polling và giữ adapter payload cũ.

Output cũ/mới dùng lẫn phải ghi theo thứ tự step và giữ context verify/link/pending; Newsfeed realtime/tổng kết dùng chung receipt theo step, chỉ tính một lượt dù block giữ cả `liked`/`commented` và `actionResult`. Kiểm chứng: `node scripts/action-status-mixed-output-smoke.cjs`; xem [audit](../../../docs/ACTION_STATUS_READERS_V362.md#mixed-output-review-fixes--09102026).

Kết quả explicit giữ origin qua merge/parallel/spread/JSON; thao tác mới phải trả result mới, không tái dùng marker `__akaActionResultSource`. Email explicit dùng lại liên kết tracking sau ghi detail, batch truyền `emailTrackingMessageId` từng result; kiểm chứng `node scripts/action-status-origin-tracking-smoke.cjs`, xem [audit](../../../docs/ACTION_STATUS_READERS_V362.md#result-origins-and-email-tracking-review-fixes--09102026).

Partial-send Zalo phải giữ `deliveryCommitted` qua adapter cũ/explicit; kiểm tra origin ngay sau producer, lưu kết quả hợp lệ đã hoàn tất trước cleanup và không chạy node kế tiếp khi xung đột. Group-post explicit dùng chung hậu xử lý legacy và receipt chống lặp; kiểm chứng `node scripts/action-status-result-boundary-smoke.cjs`, xem [audit](../../../docs/ACTION_STATUS_READERS_V362.md#partial-delivery-and-result-boundaries--09102026).

Dual output Zalo giữ cờ dừng/chống chạy lại của helper theo origin, kể cả suppress/relay; `handledErrorCode` ngăn áp lại cùng policy lỗi. Bằng chứng committed/unknown không được hạ thành chưa gửi; smoke `action-status-helper-controls-smoke.cjs`, xem [audit](../../../docs/ACTION_STATUS_READERS_V362.md#helper-controls-and-execution-evidence--09102026).

Adapter helper cũ/explicit dùng chung guard NULL/suppress/requeue/quota và hậu xử lý log/SMS; receipt explicit chỉ hậu xử lý một lần, batch không mượn input người khác. Smoke `action-status-helper-compat-smoke.cjs`; xem [audit](../../../docs/ACTION_STATUS_READERS_V362.md#legacy-helper-compatibility-and-sms--09102026).

Explicit result có ngưỡng lỗi phải chờ chốt toàn bộ target, giữ receipt policy chống áp lặp và kiểm tra input ownership ngay sau producer cho cả unit 0/1/n input. Smoke: `node scripts/action-status-threshold-input-smoke.cjs`; xem [audit](../../../docs/ACTION_STATUS_READERS_V362.md#error-thresholds-and-input-ownership--09102026).


<!-- END PRESERVED SOURCE -->

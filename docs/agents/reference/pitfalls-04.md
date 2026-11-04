# Các lỗi và ràng buộc cần giữ

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 976–981. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
- **Emojis trong source files**: KHÔNG viết emoji vào TS/TSX trừ khi user yêu cầu. Emoji trong **log strings** (`📝`/`✅`/`❌`/...) là customer-facing vocabulary đã agreed, được expected trong `sendLog`/`appendCampaignLog`/block code.
- **Zalo server event replay** (buffered vs live): mỗi lần desktop reconnect, gateway gửi `hello` kèm `getBufferedEvents(staffId)` ([zaloServerGateway.ts](../../../src/server/main/zaloServerGateway.ts)) và client replay hết (trừ `CAMPAIGN_LOG`) → renderer `onZaloLoginQrEvent` hiện toast. → Event **transient/live** (login-QR) phải publish qua `publishLiveEvent` (gateway `publishLive`, KHÔNG buffer), KHÔNG `publishEvent` (buffer). Nếu để login-QR vào `isUserFacingActivityChannel`/`emitActivity` → buffer → mỗi lần mở app phát lại "Đăng nhập Zalo thành công" cũ. Guard client `wasTracked` chỉ chặn đường `operations` snapshot, KHÔNG chặn đường buffered-events.
- **Zalo local Chat transport**: raw event chỉ enqueue sau khi serialize được và replay đúng wire; payload lỗi chỉ log `accountId/eventType`, event không ACK bị bỏ sau 10 replay. Mỗi control connection phải replay backlog xong mới gửi live; timeout welcome 15 giây/heartbeat ACK 45 giây, tối đa 10 reconnect và chỉ reset budget bằng ACK của đúng socket hiện hành. Status account giống hệt nhau trong cùng control attachment phải được dedupe theo state/close/error semantic (không theo `observedAt`); reconnect hoặc đổi generation phải phát lại trạng thái hiện tại.
- **Zalo local sticker enrichment**: luôn enqueue `message`/`old_messages` nguyên bản trước `sticker_details`; lookup chỉ dùng API của listener `running+ready`, qua queue tuần tự có timeout/cache/cap và fence theo runtime generation ([zaloLocalChatSyncService.ts](../../../src/main/services/zaloLocalChatSyncService.ts)).
- **Zalo local listener retry**: mỗi account/generation chỉ tự khởi động listener tối đa 10 lần lỗi; khi hết lượt vẫn attach control với status lỗi nhưng không auto-start lại. Chỉ `running+ready` ổn định 60 giây, đổi generation, detach/QR hoặc retry thủ công (kèm invalidate runtime) mới mở budget mới.


<!-- END PRESERVED SOURCE -->

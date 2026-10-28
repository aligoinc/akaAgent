# Browser, Facebook và nội dung

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 416–438. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
### Webview controller

Menu **akaChat** nằm ngay dưới **Trình duyệt**, nhúng `https://chat.akabiz.biz/` qua `ChatPage` và `ChatWebService`. Quyền menu dùng riêng `AuthUser.chatWebEnabledAtLogin` + `chatWebSessionId`, chụp sau bootstrap/login và giữ nguyên qua các lần refresh `isChatSync`; thay đổi quyền trong lúc app mở không mount/unmount Chat. Tài khoản không có snapshot quyền không render menu, không tải module ChatPage, không tạo session/service hoặc network/timer/listener riêng cho Chat. Có quyền vẫn chỉ khởi tạo sau lần mở menu đầu tiên; sau đó giữ webview chạy nền khi chuyển menu/ẩn cửa sổ. Chat không đăng ký vào WebviewRegistry/PageControllerRegistry của tài khoản automation.

Menu **CRM** nằm dưới akaChat (dưới Trình duyệt nếu không có akaChat), chỉ dành cho `organizationId === 1`, độc lập Chat Sync và cờ admin. [CrmPage.tsx](../../../src/renderer/src/pages/CrmPage.tsx) lazy-load `https://aka10000.fly.dev/`; IPC/main kiểm tra lại tổ chức và phiên akaAgent trước khi tạo [CrmWebService](../../../src/main/services/crmWebService.ts). CRM đăng nhập thủ công, không đọc/gửi credential akaAgent hoặc tự gia hạn; partition `persist:akaagent_crm_1_<staffId>` giữ cookie/storage riêng của staff, còn logout/expire/quit đóng guest/popup và chặn mở lại trong cleanup. Chuyển menu giữ webview; guest/popup sandbox và navigation loading dùng cùng quy tắc với akaChat. Kiểm chứng chung bằng `node scripts/run-chat-web-smoke-test.cjs`.

Loading phủ trang của [ChatPage.tsx](../../../src/renderer/src/pages/ChatPage.tsx) chỉ bật khi `did-start-navigation` có `isMainFrame && !isInPlace`; không dùng `did-start-loading` vì đổi hội thoại bằng `history.pushState`, hash và back/forward trong cùng document cũng phát sự kiện này, gây nhấp nháy.

Khi guest akaChat/CRM phát `render-process-gone`, phải bỏ guest đã crash và tạo webview mới khi phục hồi; không gọi `reload()` hoặc `loadURL()` trên guest đó vì Electron 33/macOS có thể dừng cả main process bằng `SIGTRAP`. CRM bỏ descriptor và giữ partition/cookie để nút thử lại tạo webview mới. akaChat đóng guest ngay trong main, tăng `ChatWebState.webviewGeneration` để renderer đổi key chỉ sau khi xác thực thành công; authentication đang chờ cũng không được điều hướng guest đã crash. Gia hạn cookie và chuyển hội thoại bình thường không đổi generation. Smoke test phải kiểm tra crash thật, retry, crash trong lúc xác thực và giữ đúng phiên đăng nhập.

Phiên Chat do main quản lý trong partition `persist:akaagent_chat_<organizationId>_<staffId>`: bỏ cookie xác thực cũ ở lần mở đầu của mỗi phiên akaAgent, gọi `/api/auth/login` bằng credentials main, kiểm tra đúng staff/organization rồi mới cho attach webview. Cookie HttpOnly hiện hạn 7 ngày; dùng một timer gia hạn trước 24 giờ, kiểm tra khi resume/mở lại menu, không reload webview khi gia hạn thành công. Logout/expire/đổi tài khoản/quit phải hủy request, đóng guest/popup, xóa cookie và chặn IPC mở lại trong cleanup; phản hồi cũ không được khôi phục phiên. Logout chủ động trong Chat chờ CTA Kết nối lại. Không đưa credential, cookie hoặc management secret vào renderer/URL/log. Guest/popup cùng origin phải sandbox, không có preload/Node; link ngoài chỉ HTTP(S). Kiểm chứng bằng `node scripts/run-chat-web-smoke-test.cjs` (Electron + HTTPS local, cần openssl; không dùng DB/Chat production), hai typecheck và build.

Chat 401/logout phải được nhận ở `onHeadersReceived`: web có thể chuyển trang ngay sau headers và hủy body trước `onCompleted`. Main chặn redirect `/?reason=session-expired` để tự khôi phục phiên; chốt `/api/auth/login` trong guest/popup phải bao phủ query string và dấu `/` cuối, kiểm tra theo pathname ([chatWebService.ts](../../../src/main/services/chatWebService.ts)).

Đồng bộ tag Zalo trong form chiến dịch của tenant Chat phải gọi `ZaloChatApiClient.listLabels()` (`queryType='list_labels'`) rồi persist `zalo_tag`/membership tại Desktop; không được rơi về `ZaloServerClient` chỉ vì socket App Server đang offline.

V352 đã apply `20261007025522 / migration_v352_zalo_server_campaign_tags` trên akachat ngày 07/10/2026. Packaged Server gắn tag akaBiz bằng parent claim + run-unit token và input UID qua RPC riêng; Desktop giữ credential auth. Core tag v290 giữ nguyên, không cấp EXECUTE trực tiếp; không thêm connection hoặc retry gửi khi tag lỗi. Cần binary Server 8.1.1; không apply lại. Xem [audit và kiểm chứng](../../../docs/ZALO_SERVER_CAMPAIGN_TAGS_V352.md).

V353 đã apply `20261007031133 / migration_v353_zalo_server_campaign_tag_limits` ngày 07/10/2026 theo yêu cầu bỏ giới hạn riêng: không chặn 100 tag/lần gọi, không đặt lock timeout riêng, RPC dùng statement timeout 60 giây như Local; caller bỏ abort 20 giây. Giữ toàn bộ guard quyền/claim/recipient và cách xử lý lỗi như Local. Không apply lại v352/v353; bộ cài 8.1.1 được build lại sau v353. Xem [audit](../../../docs/ZALO_SERVER_CAMPAIGN_TAG_LIMITS_V353.md).

V354 đã apply `20261007031753 / migration_v354_zalo_server_deleted_tags` trên akachat ngày 07/10/2026: RPC tag Server bỏ kiểm tra `NOT t.is_delete` ở bước xác minh scope; core chung tiếp tục lọc tag đã xóa như Local. Tag sai staff/org/account/cấu hình vẫn bị chặn; person/group và all-deleted no-op đã kiểm chứng. Không sửa app hoặc cần build lại, không apply lại v352–354. Xem [audit](../../../docs/ZALO_SERVER_DELETED_TAGS_V354.md).

[src/main/playwright/webviewController.ts](../../../src/main/playwright/webviewController.ts) — thin wrapper exposing `isConnected()` + `getURL()` cho `webContents` của Electron `<webview>` đã embed cho từng tài khoản FB. Visible webviews vẫn dùng cho login thủ công, check login của account cũ/tạo thủ công, chạy workflow và test trong editor; account import tự động dùng HTTP dưới đây.

<!-- END PRESERVED SOURCE -->

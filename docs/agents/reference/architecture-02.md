# IPC

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 736–753. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
### IPC pattern

[src/main/ipc/handlers.ts](../../../src/main/ipc/handlers.ts) gom các nhóm trong `handlers/` directory:
- `authHandlers` (login/logout/me/reset device lock/change password)
- `campaignHandlers` (CRUD campaign + scheduler control)
- `browserHandlers` ([handlers/browserHandlers.ts](../../../src/main/ipc/handlers/browserHandlers.ts)) — webview register/unregister/status. Khi register cũng register vào cả `WebviewRegistry` (cho contactLoader / scheduler `isRegistered` check) lẫn `PageControllerRegistry` (editor/test runs dùng visible webview)
- `accountHandlers` / `accountContactHandlers` / `updateHandlers`
  - `DB_LIST_ACCOUNT_ACTIONS` returns active `auto_account_actions`; `ACCOUNT_ACTION_OVERVIEW` returns `auto_account_actions` + `auto_account_action_status` for account modals ([accountActionRepository.ts](../../../src/main/data/repositories/accountActionRepository.ts)).
  - Ô chọn tài khoản và thống kê ngày trong form dùng chung `ACCOUNT_CAMPAIGN_ACTION_SNAPSHOT`, chỉ tải một lần cho các lựa chọn form có thể dùng; không query lại theo action/account/toggle/focus và không count giờ. Mẫu số ngày vẫn dùng [accountActionLimits.ts](../../../src/shared/accountActionLimits.ts); API `ACCOUNT_CAMPAIGN_ACTION_USAGE` cũ giữ tương thích nhưng form không gọi nữa. [Hợp đồng và smoke](../../../docs/CAMPAIGN_ACCOUNT_PICKER_STATUS.md).
  - Zalo IPC (`zalo:login-qr-start`, `zalo:login-qr-cancel`, `zalo:check-session`, `zalo:logout`) lives in `accountHandlers` and talks to `ZaloRuntimeService`; these calls must stay main-process only for raw session access.
- `aiHandlers` ([handlers/aiHandlers.ts](../../../src/main/ipc/handlers/aiHandlers.ts)) — app-level rewrite/tạo nhiều biến thể nội dung form và campaign assistant gọi centralized AI qua `aiRuntimeService` (`app_ai_rewrite_content`, `app_ai_write_multi_other_content`, `app_campaign_assistant_chat`); payload không truyền `shopId`.
- `akaBizIntegrationHandlers` ([handlers/akaBizIntegrationHandlers.ts](../../../src/main/ipc/handlers/akaBizIntegrationHandlers.ts)) — Cài đặt chung: lookup/save tích hợp SMS/Zalo Web/Desktop, chọn folder Desktop, list external campaigns và list shop SMS external; API list item phải enrich `status`, Desktop list đọc SQLite local.
- `reportHandlers` ([handlers/reportHandlers.ts](../../../src/main/ipc/handlers/reportHandlers.ts)) — Báo cáo theo tài khoản: summary + detail/export. Tab chung vẫn gộp `lỗi` vào thất bại; tab trạng thái hành động có IPC/contract riêng, đếm từng trạng thái chính và Chờ xử lý.
- `mediaHandlers` ([handlers/mediaHandlers.ts](../../../src/main/ipc/handlers/mediaHandlers.ts)) — thư viện Media/R2 settings/upload/list/delete. Cấu hình cloud lưu trong `auto_system_settings` với keys `media.storage.*`; chỉ admin thấy/sửa cấu hình. R2 service hardcode `region='auto'`; `key_prefix` rỗng là chủ ý, không tự thêm app folder/prefix.
- `v2Handlers` ([handlers/v2Handlers.ts](../../../src/main/ipc/handlers/v2Handlers.ts)) — engine v2: BLOCK_LIST/SAVE/DELETE, WORKFLOW_LIST/GET/SAVE/DELETE, ELEMENT_LIST/SAVE/DELETE, WORKFLOW_TEST_RUN, BLOCK_TEST_RUN, RUN_STOP, RUN_PROGRESS broadcast, RUN_LOG broadcast

Mỗi handler `ipcMain.handle(eventName, fn)` → method tương ứng repository/service. Renderer gọi qua `electronAPI.xxx()` ([preload/index.ts](../../../src/preload/index.ts), typed trong [electron.d.ts](../../../src/renderer/src/types/electron.d.ts)).


<!-- END PRESERVED SOURCE -->

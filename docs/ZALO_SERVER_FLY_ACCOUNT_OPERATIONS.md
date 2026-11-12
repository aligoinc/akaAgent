# Thao tác tài khoản Zalo Server của tổ chức không Chat chạy trên Fly (kế hoạch mục 16.9)

> 11/11/2026. **Chỉ ở local, chưa commit, chưa deploy, chưa phát hành.** Code ở ba worktree `campaign-engine-v2` (akaAgent,
> akaAgentChatApi, akaAgentWebApp). Không thêm migration: dùng lại V497 (`aka_agent_zalo_server_flag_route`) và V498
> (`aka_agent_zalo_server_on_fly_v1`), cả hai đã apply.

## Vì sao

Tổ chức không Chat bật cờ `org_organization.use_new_zalo_runtime` (V497) có tài khoản Zalo Server chạy trên Fly. Khi
ChatApi đã nhận tổ chức (có dòng `to_fly` trong `private.auto_zalo_server_session_handoff`), App Server thả tổ chức đó.

Trước khi sửa, Desktop, Web và iOS vẫn gửi mọi thao tác tài khoản Server của tổ chức này tới App Server vì "không có Chat":
quét QR, kiểm phiên, đăng xuất, bạn bè/nhóm/nhãn, kiểm SĐT. Các thao tác đều lỗi. Desktop còn ghi lặp lại vào log
`[ZaloServerClient] Connection failed: Sai thông tin đăng nhập, gói chưa bật Zalo Server hoặc đã hết hạn` (thấy khi thử bản
Desktop 9.5.1 engine v2 với tổ chức 526 ngày 11/11).

## Luật

Tài khoản Zalo Server của người đăng nhập **đi ChatApi** khi tổ chức có Chat, **hoặc** tổ chức không Chat chạy Server trên
Fly theo cờ. Riêng hai thứ vẫn chỉ dành cho tổ chức có Chat:

- runtime cục bộ (tài khoản QR chạy trên máy qua ChatApi);
- dữ liệu Chat (hội thoại, tin nhắn, danh bạ Chat): processor của ChatApi đã chặn ghi bằng `chat_data_allowed` từ V497.

Quét data trả kết quả về client. Desktop ghi vào `auto_account_contacts` như đường App Server, không ghi bảng `chat_*`.

## Thay đổi

| Nơi | Thay đổi |
|---|---|
| ChatApi `apps/chat-api/src/desktopAuthRoutes.ts` | `organizationAllowed` cấp phiên Desktop cho tổ chức theo cờ ở cả scope `zalo_qr_login` (đã deploy 20:59 VN 11/11) và **`zalo_data_scan`** (mới). Scope `zalo_local_runtime` vẫn chỉ cho tổ chức có Chat. Các route QR, đăng xuất, danh sách tài khoản và quét data không đòi Chat; chúng chỉ kiểm quyền nhân viên, quyền tài khoản và liên kết Fly (`canDispatchDataScan`), nên không phải sửa. |
| Desktop `src/shared/zaloServerOnFly.ts` (mới) | `isServerOnFlyUser(user)` (cờ V498 chốt lúc đăng nhập) và `serverAccountsUseChatApi(user)` = có Chat **hoặc** chạy trên Fly. |
| Desktop `src/main/services/zaloChatApiClient.ts` | `requireEnabled()` nhận cả tổ chức chạy trên Fly, nên quét QR, kiểm phiên, đăng xuất, quét data, kiểm SĐT đi ChatApi. `isRealtimeOnly()` đổi tên thành `isServerOnFlyOnly()`; thêm `serverAccountsUseChatApi()`. Bỏ `ensureRealtimeToken` (giờ trùng `ensureToken`). Runtime cục bộ vẫn qua `requireLocalRuntimeEnabled`. |
| Desktop `src/main/ipc/handlers.ts` | Tổ chức chạy trên Fly: **không bật App Server client**, chỉ bật ChatApi client. Kiểm SĐT đổi chế độ theo `serverAccountsUseChatApi`. |
| Desktop `accountHandlers.ts`, `accountContactHandlers.ts`, `zaloPhoneCheckHandlers.ts` | Chọn ChatApi cho tài khoản Server theo `serverAccountsUseChatApi`: QR, kiểm phiên, đăng xuất, bạn bè/nhóm/thành viên nhóm, huỷ quét, kiểm SĐT. Tham số `isChatSync` đổi tên cho đúng nghĩa. |
| Desktop `src/main/data/mappers.ts`, `campaignPendingReasonRepository.ts` | Tài khoản Server của tổ chức chạy trên Fly được tính như tài khoản do ChatApi quản lý: `hasZaloSession` theo trạng thái đăng nhập; lý do đang chờ và tab Hành động theo đường chat (`isChatManaged`). |
| WebApp `packages/control-api` | `zaloServerUsesChatApi(user)` dùng chung cho Web và iOS; hợp đồng `ControlUser.zaloServerOnFly?`. `packages/control-client` đọc trường mới. |
| WebApp API (`aka-agent-control.service.ts`, `routes.ts`) | `/me` và lúc đăng nhập trả `zaloServerOnFly: true` khi tổ chức không Chat và `aka_agent_zalo_server_flag_route(org)` đúng (lỗi kiểm thì không trả, giữ như cũ). `requireChatApiAccount` và chiếu `hasZaloSession` của tài khoản Server nhận cả tổ chức theo cờ (`serverAccountsUseChatApi`). |
| WebApp Web `AccountsPage`, `CampaignsPage`, `CampaignFormPage`, `DataPage`, `ZaloPhoneCheckModal` | `usesChatApi` = `zaloServerUsesChatApi(user)`. |
| WebApp iOS `RealtimeProvider`, `ContactsBrowser` | Tổ chức chạy trên Fly nối kênh tiến trình của ChatApi như tổ chức có Chat (App Server đã thả tổ chức); quét bạn bè/nhóm đi ChatApi. |

## Kiểm thử

- ChatApi: `desktopAuthRoutes.test.ts` 5 ca: phiên QR và phiên quét data cho tổ chức theo cờ; runtime cục bộ vẫn chỉ cho Chat; tổ chức không Chat, không Fly bị từ chối; không nối phụ thuộc mới thì giữ y như cũ.
- Desktop: `node scripts/run-zalo-chat-realtime-only-smoke-test.cjs` 8 nhóm. Dùng ChatApi giả (`/api/chat/desktop/session`, `/api/chat/desktop/data-scan-session`, `/api/chat/zalo/accounts`, `data-scan-queries`, `logout`, `/ws`), kiểm:
  - kiểm phiên, quét nhãn, đăng xuất của tài khoản Server đi ChatApi với đúng phiên;
  - runtime cục bộ bị từ chối;
  - tổ chức còn trên App Server không gọi ChatApi.
- Desktop: hai typecheck sạch.
- WebApp:
  - typecheck 8 workspace sạch;
  - API `aka-agent-control.service.test.ts` 231 ca, có 3 ca mới (`/me` trả `zaloServerOnFly`; tài khoản Server đi ChatApi; tổ chức có Chat không hỏi thêm; lỗi kiểm thì giữ App Server);
  - `packages/control-api` `zaloServerUsesChatApi.test.ts` 5 ca;
  - Web 117 file, có ca mới đọc `zaloServerOnFly` trong `controlApi.test.ts`. Ca `CampaignsPage` chọn 1.001 dòng hết giờ khi chạy chung; chạy riêng 87/87 đạt, như các lần trước;
  - iOS 72 file / 481 ca.

Chưa chạy trên production: chưa có bản Desktop, Web, iOS hay ChatApi nào chứa phần này.

## Thứ tự lên production (mỗi bước khi anh bảo "làm")

1. **Deploy ChatApi nhóm `api`**, chép phần `desktopAuthRoutes.ts` (scope `zalo_data_scan`) sang thư mục dựng `akaAgentChatApi-deploy-v2` trước. Không đổi gì với tổ chức có Chat; tổ chức theo cờ lấy thêm được phiên quét data.
2. **Deploy Web/API**: chép phần API và Web sang thư mục dựng của Web, như lần deploy v104. Tổ chức theo cờ (hiện chỉ 526) thấy thao tác tài khoản Server đi ChatApi. Tổ chức khác không đổi, vì `zaloServerOnFly` chỉ có khi đúng.
3. **Phát hành Desktop**: cùng bản engine v2. Phải chờ duyệt bảng mã lỗi trước khi phát hành rộng.
4. **Phát hành iOS** khi có đợt phát hành app.

## Giới hạn

- Desktop chốt cờ lúc đăng nhập. Bật hoặc tắt cờ của tổ chức thì Desktop phải đăng nhập lại mới đổi đường.
- Web đọc `/me` mỗi lần tải. iOS đọc theo nhịp làm mới phiên của app.
- Lý do đang chờ và tab Hành động của tổ chức theo cờ đi theo đường chat. Riêng chiến dịch do engine v2 chạy (`zalo_message_phone` chỉ chữ), giới hạn được tính trong claim theo công thức Desktop. Màn này có thể lệch một chút với loại chiến dịch đó; xem kế hoạch mục 12.4.
- Luồng chuyển chế độ staff kiểu cũ giữa Desktop và App Server (`requestRuntimeHandoff`, `requestDesktopHandoffReady`) không đổi. Luồng này không áp dụng cho tổ chức theo cờ, vì định tuyến theo tổ chức, không theo chế độ staff.

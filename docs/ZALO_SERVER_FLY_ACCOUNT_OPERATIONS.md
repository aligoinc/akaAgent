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

## V529: Desktop chọn nơi chạy như Web (14/11/2026)

**Đã apply akachat 14/11/2026 08:55:07 VN** (`20261114015453 / migration_v529_desktop_server_on_fly_flag_route`; không apply lại;
md5 sổ = file `a1217f23…`; [biên nhận](../migrations/snapshots/desktop-server-on-fly-flag-route-v529/apply-receipt.json)).

- **Lỗi.** V498 `aka_agent_zalo_server_on_fly_v1()` chỉ đúng khi tổ chức có Chat hoặc đã có dòng `to_fly`. Web, ChatApi và
  runtime Fly thì dùng `aka_agent_zalo_server_flag_route(org)`. Tổ chức bật cờ có gói Server mà chưa có tài khoản Server nào
  (tổ chức mới tạo qua V528) chưa có dòng `to_fly`. Vì vậy Desktop ≥ 9.6.0 tạo và quét QR tài khoản Server đầu tiên trên App
  Server.
- **Hệ quả.** Ngay sau đó ChatApi tạo dòng `to_fly` và App Server thả tổ chức trong ≤ 60 giây. Lượt quét đang dở thì bị cắt;
  quét xong rồi thì phiên bị chép sang Fly, đúng loại phiên bị Zalo đá sáng 14/11.
- **Sửa.**
  - [V529](../migrations/migration_v529_desktop_server_on_fly_flag_route.sql) thêm `OR aka_agent_zalo_server_flag_route(org)`
    vào hàm, giữ hai điều kiện cũ (có Chat; còn dòng `to_fly`).
  - Quyền và thuộc tính hàm giữ nguyên (chỉ `aka_agent_desktop` gọi; SECURITY DEFINER; STABLE).
  - Lúc apply chỉ 12 tổ chức đổi kết quả, đều bật cờ, có gói Server, chưa có tài khoản Server: 1422, 2095, 2104, 2114, 2116,
    2126, 2127, 2128, 2129, 2133, 2137, 2140.
- **Kiểm.**
  - `node scripts/test-v529-desktop-server-on-fly-flag-route.cjs`: 9 nhóm trên PG17. Fixture khớp md5 bản live của V498 và
    `aka_agent_zalo_server_flag_route`.
  - Sau apply, gọi thử bằng phiên Desktop thật trong giao dịch tự huỷ: tổ chức 1422 trả `true`; tổ chức 465 (chỉ Desktop,
    không gói Server) trả `false`.
  - PostgREST nạp lại schema mất 7,1 giây (sát trần 8 giây). Trong khoảng đó 495 request quá 1 giây; không có lỗi 5xx.
- **Gỡ.** [rollback](../migrations/rollback_v529_desktop_server_on_fly_flag_route.sql) trả đúng thân V498 (md5 `0e8f19b1…`).
- **Desktop chọn theo cờ** (code 14/11/2026, sau 9.7.0, chưa phát hành).
  - V529 chỉ có tác dụng khi Desktop gọi hàm. Desktop ≤ 9.7.0 chỉ gọi V498/V529 lúc đăng nhập, và chỉ khi lúc đó tổ chức đã có quyền
    Server. Vì vậy gói Server được thêm giữa phiên vẫn đi App Server cho tới khi đăng nhập lại: lượt đọc lại gói 30 giây cập nhật
    quyền nhưng giữ `zaloServerOnFly` cũ.
  - Anh chốt: chỉ theo cờ, bật = Fly, tắt = App Server, không xét gói. `AuthUser.zaloServerOnFly` lấy từ cờ engine v2 đã đọc lúc
    đăng nhập (V513, `resolveZaloServerOnFlyAtLogin` trong `src/shared/zaloServerOnFly.ts`). Desktop bỏ lượt gọi V498 (xoá
    `zaloServerOnFlyRepository.ts`), nên mỗi lần đăng nhập bớt một request.
  - `isServerOnFlyUser` vẫn đòi quyền Server. Tổ chức chưa có gói Server thì không có gì để chuyển. Gói đến giữa phiên thì lượt
    đọc lại 30 giây khởi động lại kết nối và tài khoản Server đi ChatApi ngay, không cần đăng nhập lại.
  - Kiểm: `node scripts/zalo-server-on-fly-login-smoke.cjs` (5 nhóm), `node scripts/run-zalo-chat-realtime-only-smoke-test.cjs`
    (8 nhóm), hai typecheck, `electron-vite build`.
  - Hàm DB V498/V529 vẫn giữ cho máy cài 9.6.0/9.7.0.

## Giới hạn

- Desktop chốt cờ lúc đăng nhập. Bật hoặc tắt cờ của tổ chức thì Desktop phải đăng nhập lại mới đổi đường. Gói Server được
  thêm giữa phiên thì tự đổi đường trong ≤ 30 giây, nhưng chỉ ở bản Desktop sau 9.7.0 (mục V529).
- Web đọc `/me` mỗi lần tải. iOS đọc theo nhịp làm mới phiên của app.
- Lý do đang chờ và tab Hành động của tổ chức theo cờ đi theo đường chat. Riêng chiến dịch do engine v2 chạy (`zalo_message_phone` chỉ chữ), giới hạn được tính trong claim theo công thức Desktop. Màn này có thể lệch một chút với loại chiến dịch đó; xem kế hoạch mục 12.4.
- Luồng chuyển chế độ staff kiểu cũ giữa Desktop và App Server (`requestRuntimeHandoff`, `requestDesktopHandoffReady`) không đổi. Luồng này không áp dụng cho tổ chức theo cờ, vì định tuyến theo tổ chức, không theo chế độ staff.

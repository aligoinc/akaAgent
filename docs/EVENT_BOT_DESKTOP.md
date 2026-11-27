# Bot sự kiện: phần Desktop + App Server (đợt 1)

Đi cùng [hợp đồng](EVENT_BOT_TECH.md) và [phương án](EVENT_BOT_PLAN.md). Chưa build / phát hành; RPC của V672 chưa có trên DB thì
bộ chạy im lặng tắt (PGRST202).

## File

| File | Việc |
|---|---|
| `packages/campaign-engine/src/eventBot/index.ts` | Lõi gửi: dựng tin từ `message` (nhiều mẫu `\|`, spin, `#{FULL_NAME}`, `#{SEX{…}}`, ngày), gửi qua cổng `{sendText, getProfile?, errorHints?, businessNow?}`, xếp lỗi thành `p_result`; lọc sinh nhật theo `sdob` (dùng `friendProfile` của `zalo/materialize.ts`, nay export) |
| `src/main/services/eventBotRuntime.ts` | Vòng chạy thuần (không Electron / Supabase), một vòng cho cả tiến trình |
| `src/main/services/eventBotHost.ts` | Nối vòng chạy với DB và `ZaloRuntimeService`: `createDesktopEventBot`, `createServerEventBot` |
| `src/main/data/repositories/eventBotRepository.ts` | 4 RPC (bản `aka_agent_desktop_event_bot_*_v1` và bản `service_role` `p_source = 'server'`) |
| `src/main/ipc/handlers.ts` | Desktop: bật cùng `zaloRealtimeGroupManager` khi có quyền Zalo QR / trình duyệt; dừng ở mọi chỗ dừng runtime Zalo; chờ việc đang gửi tối đa 15 giây trước `zaloRuntime.clearAll()` (đăng xuất, thoát, hết phiên) |
| `src/server/main/zaloServerRuntimeManager.ts` | App Server: một vòng trong `ZaloServerRuntimeManager`, gom tài khoản của mọi runtime nhân viên đang `running` |
| `src/main/services/desktopRuntimeSnapshot.ts` | Khoá `eventBot: {state, accounts, lastClaimAt}` đứng sau `accounts` (phần cũ giữ nguyên byte) |
| `src/main/services/journeyWebService.ts`, `src/shared/journeyWebDesktop.ts`, `journeyWebHandlers.ts`, preload | Dịch vụ nhúng nhận trang (`view`: `automation` \| `eventBot`), mỗi trang một webview / trạng thái / đường mặc định / tiêu đề, chung một lần đăng nhập và phân vùng |
| `src/renderer/src/pages/EventBotPage.tsx`, `JourneysEmbed.tsx`, `TopBar.tsx`, `App.tsx` | Mục menu "Bot sự kiện" (khi có gói Zalo) ngay dưới "Tự động hóa", nhúng `/automation/event-bot?embed=desktop` |

## Luồng

1. `sync` lúc bật và 2 phút một lần. `enabled=false` thì đọc lại sau 30 phút; DB chưa có hàm thì thử lại sau 30 phút. App Server chỉ
   gọi khi đang giữ ít nhất một tài khoản Zalo (`p_account_ids` = tài khoản có phiên trong các runtime).
2. Mỗi `pollSeconds` (mặc định 30): báo lại kết quả còn treo (lỗi mạng lúc báo), rồi một `claim` cho tài khoản bot bật mà tiến trình đang
   giữ: Desktop = Zalo QR có phiên trong bộ nhớ (`cachedAccountIds`) hoặc Zalo trình duyệt có tab đã xác minh (`hasVerifiedWebSession`);
   không đăng nhập thêm. Không có thì không gọi. Desktop không nhận việc khi bộ giữ sau khi máy ngủ đang giữ (`sleepGuard.canStartWork`).
3. Gửi lần lượt từng việc bằng `zaloRuntime.sendMessageToUser` (Zalo trình duyệt đi qua API bắt từ tab, cùng hàm), `getUserProfile` chỉ
   khi mẫu có `#{SEX{…}}` / `#{ORIGINAL_NAME}` hoặc thiếu tên. Kết quả:
   - có msgId → `sent`; thành công không msgId → `sent`, `msgId: null` (DB ghi `no_msg_id`, tạm dừng 30 phút);
   - lỗi trước khi gọi Zalo (dấu `zaloPreCall`, tài khoản mất phiên, nội dung rỗng, lỗi mở kết nối, HTTP 429) → `failed`;
   - Zalo từ chối (ZaloApiError) → `failed` + `zaloCode`;
   - đứt mạng sau khi yêu cầu đi, hết giờ chờ (120 giây), HTTP 5xx → `unknown` (không gửi lại).
4. Sinh nhật: tài khoản có `birthday.scanToday` thì đọc bạn bè 500 / trang (nghỉ 2–5 giây giữa trang, tối đa 200 trang), lọc `sdob` theo
   ngày VN của DB (`getDatabaseRuntimeClock`), gọi `birthdays` (≤ 2.000 / lần; không ai cũng gọi với mảng rỗng để DB ghi đã quét). Lỗi
   thì thử lại sau 30 phút; xong thì không quét lại trong ngày.
5. Dừng (đăng xuất / thoát / đổi chế độ / App Server dừng): không nhận việc mới; tin đang gửi chờ kết quả rồi báo; việc đã nhận mà chưa
   gửi báo `failed` ("Bot dừng trước khi gửi tin này").

Không đọc / ghi hạn mức, `auto_campaign_details`, `auto_engine_leases`, khoá thao tác, trạng thái chiến dịch / tài khoản.

## Request thêm

- Không có gói Zalo QR / trình duyệt: 0.
- Có, công tắc `event_bot` tắt: 1 `sync` lúc đăng nhập rồi 30 phút một lần.
- Công tắc bật, không tài khoản nào bật bot: 1 `sync` / 2 phút.
- Có tài khoản bật bot đang đăng nhập: thêm 1 `claim` / 30 giây cho cả tiến trình, 1 `report` mỗi tin, mỗi ngày 1 lượt đọc bạn bè + 1
  `birthdays` mỗi tài khoản bật sinh nhật. `getDatabaseRuntimeClock` dùng chung bộ đệm 10 phút của bộ lập lịch.
- App Server: như trên nhưng gom cả VPS vào một lượt; không giữ tài khoản nào thì 0.

## Kiểm thử

- `node scripts/event-bot/desktop/runtime-smoke.cjs` (23 ca, RPC giả + Zalo giả): tắt / không tài khoản / App Server không giữ / PGRST202 →
  không claim; claim → gửi → `sent`; 120 → `failed` + mã; lỗi mạng trước khi gửi / dấu preCall → `failed`; không msgId → `sent` null;
  ECONNRESET → `unknown`; báo lại khi báo lỗi mạng, không gửi lại; hồ sơ + spin; một tin một lúc; dừng giữa lúc gửi; mất phiên sau lúc
  nhận việc; sinh nhật nhiều trang / một lần trong ngày / ngày mới / rỗng / lỗi thử lại sau 30 phút; bộ giữ máy ngủ; lõi xếp loại
  (500, 429, hết giờ, hết hạn chờ, nội dung rỗng, mã `g…`); ảnh chụp giữ nguyên byte phần cũ.
- `ELECTRON_DISABLE_SANDBOX=1 node scripts/journey-web-embed-electron-smoke.cjs` (Electron thật, 9 ca; thêm ca "Bot sự kiện: trang thứ
  hai cùng phiên, webview riêng, Quy trình vẫn sống").
- `node scripts/desktop-runtime-snapshot-smoke.cjs` (14), `node scripts/campaign-engine-boundary-check.cjs`, typecheck lõi +
  `tsconfig.node.json` + `tsconfig.web.json`.

## Chưa làm / giới hạn

- Chưa chạy với DB thật (V672 chưa apply), chưa chạy trong Electron thật với Zalo thật, chưa build App Server.
- Zalo trình duyệt: gửi được vì `sendMessage` dùng API bắt từ tab; chỉ chạy khi tab của tài khoản đã mở và xác minh trong app (như chiến
  dịch). Đọc bạn bè cho sinh nhật cũng qua API đó, chưa thử thật.
- Desktop không gửi `p_account_ids` khi `sync` (theo hợp đồng); DB trả mọi tài khoản bot bật của nhân viên, app tự lọc theo phiên.
- Fly (đợt 2) chưa có; lõi chép sang ChatApi bằng `scripts/sync-campaign-engine.cjs` khi làm.
- Web hiển thị "cần cập nhật app" dựa vào việc presence có khoá `eventBot` hay không.

# Dòng báo mất mạng (Desktop) — 12/11/2026

Trạng thái: **code ở nhánh `claude/great-goodall-nt1m9d`, chưa merge `dev_3`, chưa build/phát hành Desktop**. Không migration, không RPC mới, không đổi quyền DB, không thêm hẹn giờ hay request khi đang có mạng. Port bản Web: akaAgentWebApp `docs/NETWORK_STATUS_BAR.md` (đã merge `dev` qua #212, chưa deploy). Bản thiết kế (canvas riêng tư của người dùng): [Dòng báo mất mạng — tối ưu UI/UX](https://claude.ai/artifact/4xQqJjpfQE4jxqKZ6gvDz6).

## Khách thấy gì

| Lúc | Dòng báo |
| --- | --- |
| Mất mạng | **Mất kết nối mạng.** Kiểm tra lại sau **60** giây · nút **Kiểm tra ngay**. Số giây giảm dần, vạch 2 px ở đáy ngắn dần theo |
| Đang thử lại | **Mất kết nối mạng.** Đang kiểm tra lại… (ẩn nút và vạch) |
| Hết 60 giây, vẫn chưa có mạng | Đếm lại từ 60 |
| Từ lượt thử thất bại thứ 3 (khoảng 2 phút) | **Vẫn chưa có mạng.** Hãy xem lại wifi hoặc dây mạng. · Kiểm tra lại sau … giây · nút **Kiểm tra ngay** |
| Có mạng lại | **Đã có mạng trở lại.** Tự ẩn sau 4 giây |

- Thẻ nhỏ cao 28 px, giữa cửa sổ, treo ngay dưới thanh trên cùng của app: Windows/Linux ở 72 px (vùng tiêu đề 36 px + thanh công cụ 36 px), macOS ở 36 px (thanh công cụ nằm chung với thanh tiêu đề), màn đăng nhập/khởi động ở 36 px. Không đặt trong thanh trên cùng vì đó là vùng kéo cửa sổ và bên phải có nút Cập nhật/Đăng xuất, câu dài sẽ đè lên.
- Nổi trên trang, Chat/CRM nhúng và hầu hết cửa sổ (lớp 20500), không đẩy bố cục. Nút "Kiểm tra ngay" bấm được trên cả chiều cao thẻ, không tràn xuống dưới.
- Giao diện tối (mặc định) chữ #FFAAAA / xanh #77CDA5; giao diện sáng (`body.theme-light`) chữ #BA3434 / #14734B.
- Thay dải "Mất kết nối mạng — Không thể kết nối Internet…" cũ của [AppNotificationBar](../src/renderer/src/components/AppNotificationBar/AppNotificationBar.tsx) (chỉ dựa vào `navigator.onLine`, không đếm ngược, không tự kiểm tra lại); thanh đó nay chỉ hiện thông báo do DB điều khiển.
- Trình đọc màn hình chỉ đọc câu báo (`role="status"`), một lần mỗi khi câu đổi; số giây và nút nằm ngoài vùng đó.

## Khi nào coi là mất mạng

Khác Web ở chỗ request tới máy chủ dữ liệu đi từ main process (`desktopFetch` của client Supabase), không đi từ trang.

1. **Dấu hiệu**: trình duyệt của cửa sổ báo `offline` (hoặc app mở lên khi `navigator.onLine` đã là `false`), hoặc main báo một request tới máy chủ dữ liệu lỗi mạng (`fetch` ném lỗi, không tính request bị huỷ). Bộ chạy chiến dịch gọi DB định kỳ nên mất mạng thường được phát hiện trong vòng một nhịp tick, kể cả khi người dùng không thao tác.
2. **Lượt thử**: renderer gọi IPC `network:probe` → main `GET https://cgjbsmqtfhqvttudyjzq.supabase.co/auth/v1/health` kèm khóa định danh dự án (publishable, không bí mật), hạn 8 giây, không đọc DB, không cần phiên đăng nhập. Có phản hồi HTTP bất kỳ (kể cả 401/503) là còn mạng; chỉ lỗi mạng hoặc quá hạn mới tính là mất. Dòng báo chỉ hiện khi lượt thử thất bại.
3. **Thử lại**: hết 60 giây; bấm Kiểm tra ngay; trình duyệt báo `online`; cửa sổ được focus/hiện lại sau khi quá hạn (máy ngủ dậy). Main báo một request có phản hồi thì coi là có mạng ngay, không cần thử.

Tín hiệu main → renderer (`network:request-signal`): `failed` tối đa một lần mỗi giây (bộ chạy có thể lỗi hàng loạt); `ok` chỉ gửi khi trước đó đã gửi `failed`, nên lúc mạng bình thường không có IPC nào. Renderer giữ lắng nghe suốt đời trang: tín hiệu tới lúc chưa gắn dòng báo (đổi màn đăng nhập ↔ app) được nhớ và thử ngay khi gắn; gỡ dòng báo lúc đang mất mạng cũng vậy.

Tải lên máy chủ: khi mất mạng thật thì lượt thử không tới máy chủ. Khi một request lỗi mạng mà máy chủ vẫn trả lời, mỗi máy thử tối đa một lần mỗi 15 giây (`/auth/v1/health` là đường kiểm tra nhẹ của GoTrue, trả 200 khi có khóa định danh nên không lẫn vào số 401/403 dùng để đếm máy bản cũ).

## File

- [src/shared/networkStatus.ts](../src/shared/networkStatus.ts): tên kênh IPC và kiểu tín hiệu.
- [src/main/services/networkStatusSignals.ts](../src/main/services/networkStatusSignals.ts): giới hạn tín hiệu, lượt thử `probeNetwork`.
- [src/main/data/supabaseClient.ts](../src/main/data/supabaseClient.ts): `desktopFetch` báo `failed`/`ok`; `probeDesktopBackend()`.
- [src/main/ipc/handlers/networkStatusHandlers.ts](../src/main/ipc/handlers/networkStatusHandlers.ts): IPC lượt thử, chuyển tín hiệu sang cửa sổ chính. Preload: `probeNetwork`, `onNetworkRequestSignal`.
- [src/renderer/src/lib/networkStatus.ts](../src/renderer/src/lib/networkStatus.ts): trạng thái và lịch thử; chép từ Web, chỉ khác phần lượt thử (IPC) và nguồn tín hiệu request (main). Sửa logic thì sửa cả hai repo.
- [src/renderer/src/components/NetworkStatusBar/](../src/renderer/src/components/NetworkStatusBar/NetworkStatusBar.tsx): dòng báo và CSS. Gắn trong [App.tsx](../src/renderer/src/App.tsx) ở màn khởi động, đăng nhập và trong app.

App Server dùng khóa máy chủ nên không đi qua `desktopFetch`: không phát tín hiệu, giao diện của nó không đổi.

Hằng số: `NETWORK_RECHECK_SECONDS` (60), `NETWORK_LONG_OFFLINE_FAILED_CHECKS` (3), `NETWORK_RESTORED_NOTICE_MS` (4 000) trong renderer; `NETWORK_PROBE_TIMEOUT_MS` (8 000) trong main.

## Kiểm thử

```sh
node scripts/network-status-smoke.cjs                                         # 8 ca: tín hiệu, lượt thử, desktopFetch thật
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/network-status-ui-smoke.cjs # 13 ca trên Electron thật, đồng hồ giả
```

Bài giao diện dùng `page.clock`: đồng hồ giả cũng làm đứng hiệu ứng CSS nên bài bật giảm chuyển động (kiểm luôn nhánh `prefers-reduced-motion`), và `page.screenshot` treo khi đồng hồ đang đứng nên bài không chụp ảnh. Chụp ảnh thì dùng cửa sổ hiện thật (`show: true`) trên xvfb: cửa sổ ẩn mất ~4,7 giây mỗi ảnh, lâu hơn thời gian thẻ "Đã có mạng trở lại" hiện.

## Giới hạn

- Máy chủ lỗi nhưng vẫn trả phản hồi (502/503) không tính là mất mạng.
- Chỉ theo dõi đường tới máy chủ dữ liệu. Zalo, Facebook, máy chủ AI (agent.akabiz.net) hay cập nhật app lỗi riêng thì không hiện dòng báo.
- Lỗi khi gia hạn phiên (trước khi request được gửi) không tính là dấu hiệu; request kế tiếp lỗi mạng mới tính.
- Không tự tải lại dữ liệu khi có mạng lại; các màn vẫn theo nhịp tải sẵn có.

## Gỡ

Bỏ `<NetworkStatusBar />` trong `App.tsx`. Tín hiệu trong `desktopFetch` khi đó vẫn gửi IPC nhưng không ai nghe; muốn bỏ hẳn thì bỏ thêm `registerNetworkStatusHandlers` và hai lời gọi trong `desktopFetch`. Muốn lấy lại dải cũ thì khôi phục nhánh `isOffline` của `AppNotificationBar`.

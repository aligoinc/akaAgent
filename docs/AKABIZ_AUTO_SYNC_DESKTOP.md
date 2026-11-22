# Đồng bộ akaBiz Auto sang akaAgent — phương án 2 (app akaAgent Desktop đọc SQLite)

Ngày 22/11/2026 · **Trạng thái: mã trên nhánh `claude/stoic-lovelace-45o53s`, chưa merge, chưa build Desktop, chưa chạy trên Electron thật, chưa gọi API thật** (API của akaAgentWebApp đang viết cùng lúc, chưa deploy).

Phương án và quyết định của người dùng: akaAgentWebApp `docs/AKABIZ_AUTO_SYNC_PLAN.md`. Hợp đồng API (bắt buộc theo): akaAgentWebApp `docs/AKABIZ_AUTO_SYNC.md`. Thiết kế giao diện người dùng đã xem: https://claude.ai/artifact/CdS5nL4a2mcZHwxcHY5Prh (artboard PA2_TheAkaBiz, PA2_KetNoi, rồi các bước 2–5 dùng chung).

## Khách thấy gì

Cài đặt chung › Tích hợp akaBiz › thẻ **akaBiz Desktop** (đã liên kết, có `dbPath`) có thêm khối "Đồng bộ tài khoản và chiến dịch" (nhãn Mới) và nút **Đồng bộ**. Bấm mở hộp thoại 5 bước:

1. **Kết nối**: tài khoản akaAgent lấy từ phiên đang đăng nhập (không hỏi lại), tên đăng nhập akaBiz lấy từ liên kết, chỉ hỏi **mật khẩu akaBiz** (liên kết cũ chỉ cần tên đăng nhập, chép dữ liệu cần xác nhận chủ dữ liệu); hiện đường dẫn file dữ liệu.
2. **Cài đặt**: nền tảng Zalo / Facebook (Facebook khoá khi tổ chức chưa có gói); **một** loại tài khoản Zalo cho cả lượt, chỉ bật loại có gói, mỗi loại ghi số chỗ còn trống; danh sách tài khoản (tài khoản đã chép ghi "Đã có · <loại>, dùng lại"); phạm vi chiến dịch (Dừng/Chờ xử lý hoặc Tất cả, kèm số); "Chỉ đồng bộ chiến dịch mới cập nhật gần đây" mặc định bật 90 ngày, nhập 1–365, chọn nhanh 7/30/90/180/365; dòng đếm "N / tổng chiến dịch sẽ được đồng bộ" đổi ngay. Thiếu chỗ cho tài khoản mới, chưa chọn gì, số ngày sai thì hiện lý do và khoá nút Xem trước. Có lượt đang dở thì hiện nút **Chạy tiếp** (dùng cài đặt đã lưu ở máy chủ, bỏ qua Xem trước).
3. **Xem trước**: chạy thử (không ghi): tài khoản tạo mới / dùng lại, chiến dịch chép được theo loại, số dòng, thay đổi khi chép, bỏ qua, cần xử lý. Có nút "Dừng xem trước".
4. **Đang đồng bộ**: thanh tiến độ theo dòng, chiến dịch đang chép, vài dòng nhật ký. Không đóng được (nút X khoá, Esc và click ngoài không tác dụng). Lỗi thì hiện câu của máy chủ, nút **Thử lại** (máy chủ chạy tiếp từ con trỏ) và **Để sau**.
5. **Hoàn tất**: việc cần làm tiếp: đăng nhập lại tài khoản mới (Zalo Server quét QR trên akaAgent, loại khác đăng nhập trong app), **dừng chiến dịch bên akaBiz Desktop trước khi bật bên akaAgent**, thêm lại ảnh, xử lý chiến dịch chưa chép được; nút Đồng bộ lại.

Cài đặt lần trước lưu `localStorage` khoá `aka.akabizAutoSync.settings.v1:<tổ chức>:<nhân viên>` (không có mật khẩu).

## Mã

| Tệp | Việc |
| --- | --- |
| [src/shared/akaBizAutoSync.ts](../src/shared/akaBizAutoSync.ts) | Kiểu, kênh IPC, nhãn, hàm lọc chiến dịch theo lựa chọn (giống máy chủ) |
| [src/main/services/akaBizAutoSyncService.ts](../src/main/services/akaBizAutoSyncService.ts) | Đọc SQLite chỉ đọc + vòng verify → begin → campaign → inputs → publish → finish; không nhập Electron |
| [src/main/ipc/handlers/akaBizIntegrationHandlers.ts](../src/main/ipc/handlers/akaBizIntegrationHandlers.ts) | 4 kênh `akabiz:auto-sync:connect/run/cancel/close` + sự kiện `akabiz:auto-sync:progress` |
| [src/preload/index.ts](../src/preload/index.ts) | `akaBizAutoSyncConnect/Run/Cancel/Close`, `onAkaBizAutoSyncProgress` |
| [src/renderer/src/components/Settings/AkaBizAutoSyncModal.tsx](../src/renderer/src/components/Settings/AkaBizAutoSyncModal.tsx) + `akaBizAutoSync.css` | Hộp thoại 5 bước; khối trong thẻ ở `GeneralSettingsModal.tsx` |

IPC trả `{ ok: true, data } | { ok: false, code, message }` (không ném lỗi qua IPC để khách không thấy "Error invoking remote method").

## Đọc SQLite

- File = `akabiz_integrations.akaBizDesktop.dbPath` (`<thư mục cài>\Resources2\akabiz_auto_local.db`). Mở `better-sqlite3` **chỉ đọc**, `timeout` 5 giây (akaBiz Auto đang ghi thì chờ; quá thì báo "akaBiz Desktop đang ghi dữ liệu…"), mở / đóng quanh từng lượt đọc. Không ghi SQLite (khác chức năng đẩy SĐT sang akaBiz Desktop vẫn ghi `autoCampaignDetail`).
- `installId`: bảng `akaAgentSyncSetting` khoá `install_id` (akaBiz Auto tạo ở phương án 1) nếu có; không có thì sha256(đường dẫn đầy đủ, chữ thường) 32 ký tự hex. Cùng một file mà PA1 đã tạo bảng thì hai phương án dùng chung khoá nguồn.
- Chỉ đọc dòng `AccountId` + `StaffId` của nhân viên akaBiz máy chủ trả về ở bước xác minh (cùng file có thể chứa dữ liệu nhân viên khác).
- Giá trị gửi đi giống akaBiz Auto (EF6 + Newtonsoft) gửi: cột khai báo `BIT` → `true/false`, cột ngày (`DATETIME` hoặc tên bắt đầu `Date` / `Schedule`) `yyyy-MM-dd HH:mm:ss.fffffff` → `yyyy-MM-ddTHH:mm:ss[.fffffff]` (bỏ phần lẻ toàn số 0, bỏ múi giờ), BLOB bỏ.
- `campaign`: mọi cột `autoCampaign` trừ `Log`. Dòng: lô 500 theo `Id` tăng, bỏ `IsDelete = 1`, bỏ `ContentMessage` / `ErrorImagePath`, `ErrorMessage` cắt 500 ký tự. `refs` đúng mục 6 của hợp đồng (bảng chưa có trong file cũ thì gửi rỗng).
- Lọc trên máy để đếm (nền tảng theo tiền tố mã, Shop đã chọn, trạng thái, ngày cập nhật = max của 3 cột ngày so với mốc `asOf` máy chủ trả); máy chủ lọc lại.

## Gọi API

- Gốc `https://agent.akabiz.net` (`AKA_AGENT_AKABIZ_AUTO_SYNC_API_URL` chỉ để kiểm thử). Xác minh: `POST /api/aka-agent/desktop/v1/akabiz-auto-sync/verify` kèm `Authorization: Bearer <token phiên Desktop>` (như đường AI); các lời gọi sau gửi `x-akabiz-sync-ticket`. Hạn mỗi lời gọi 60 giây, `redirect: 'error'`.
- Mật khẩu akaBiz chỉ nằm trong service tới khi đóng hộp thoại (đóng = `close` xoá phiên), chỉ đi trong thân lời gọi verify, không ghi log, không trả về giao diện. Đổi nhân viên đăng nhập thì phiên bị xoá ở lượt gọi kế.
- Thử lại: lỗi mạng / 503 chờ 5 giây, tối đa 4 lần liền; `akabiz_sync_busy` chờ 5 giây, tối đa 60 lần; `akabiz_sync_ticket_expired` → xác minh lại bằng mật khẩu trong bộ nhớ → `begin` → làm lại chiến dịch đang dở (máy chủ trả con trỏ), tối đa 3 lần mỗi chiến dịch; `akabiz_sync_cursor_conflict` / `akabiz_sync_incomplete` → đọc tiếp từ `details.cursor` của máy chủ. API chưa có đường này (404/405) → "Máy chủ akaAgent chưa hỗ trợ đồng bộ akaBiz Auto".
- Chiến dịch có trong `campaigns.complete` của `begin` không gọi `campaign` lại (đếm "đã chép trước đó").

## Kiểm thử

```sh
npm rebuild better-sqlite3            # bản Node cho bài kiểm (bản đóng gói vẫn build cho Electron ở postinstall)
node scripts/akabiz-auto-sync-desktop-smoke.cjs     # 12 nhóm: service thật + SQLite tạm cột như akaBiz Auto + API giả theo hợp đồng
node scripts/run-akabiz-auto-sync-ui-smoke.cjs      # 6 nhóm: hộp thoại thật trên Chromium của Playwright, IPC giả
AKABIZ_AUTO_SYNC_UI_SHOTS=<thư mục> node scripts/run-akabiz-auto-sync-ui-smoke.cjs   # kèm ảnh chụp
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
npx electron-vite build
```

Bài kiểm service: sai mật khẩu; Bearer + installId; chỉ chiến dịch đúng nhân viên, không xoá; xem trước chỉ gửi chiến dịch trong lựa chọn, khuôn dòng thô, không publish/finish; mật khẩu không xuất hiện ở lời gọi nào khác verify hay ở sự kiện tiến trình; đồng bộ thật với vé hết hạn giữa chừng + mất câu trả lời (con trỏ lệch) + máy chủ bận → đủ 1.203 dòng không trùng; lượt sau bỏ chiến dịch đã chép; chiến dịch bị bỏ qua vẫn đi hết thanh tiến độ; 404; đóng phiên; file SQLite không đổi sau mọi lượt.

## Chưa kiểm chứng

- Chưa chạy trong Electron thật, chưa đọc file `akabiz_auto_local.db` thật (bài kiểm dựng bảng theo model EF của repo akaBizAuto; DDL gốc không có trong repo đó).
- Chưa gọi API thật (chưa deploy). Câu lỗi hiện cho khách là `message` của máy chủ.
- System.Data.SQLite có thể lưu ngày dạng khác ISO (ticks, Julian) nếu chuỗi kết nối đặt `DateTimeFormat`; App.config của akaBiz Auto không đặt nên mặc định ISO8601.

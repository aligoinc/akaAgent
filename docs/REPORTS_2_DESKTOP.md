# Menu Báo cáo 2 trên Desktop (nhúng trang Báo cáo 2 của Web)

Người dùng yêu cầu ngày 23/11/2026: "HIỂN THỊ LÊN DESKTOP akaAgent > nhánh dev 3. Thêm menu: Báo cáo 2 > hiển thị trang báo cáo này. Giữ nguyên menu báo cáo như hiện tại".

**Trạng thái:**
- Mã nằm trên nhánh `claude_bao-cao-2_from_dev_3_23_11`, tách từ `dev_3`.
- Chưa merge, chưa build bộ cài, chưa phát hành.
- Không đổi DB.
- Phần Web nằm trên nhánh `claude/stoic-faraday-j1w4s1` của akaAgentWebApp, chưa deploy. Chi tiết phía Web ở `docs/REPORTS_2_DESKTOP.md` của repo đó.

## Hành vi

- **Vị trí menu.** Thanh bên trái có mục **Báo cáo 2** (biểu tượng `TrendingUp`) ngay dưới **Báo cáo**. Mọi nhân viên đều thấy mục này. Kênh nào hiện (Zalo, SMS, Facebook, Email) do máy chủ quyết theo sản phẩm của tổ chức và tài khoản nhân viên quản lý, giống trên Web.
- **Menu Báo cáo giữ nguyên.** Trang Báo cáo hiệu quả với 5 thẻ và Báo cáo dữ liệu không đổi.
- **Cách hiển thị.** Mục Báo cáo 2 mở trang `/reports-2?embed=desktop&theme=<sáng|tối>` của Web trong một webview. Số liệu, bộ lọc, nút Làm mới là của trang Web. Desktop không chép logic báo cáo và không đọc DB cho trang này.
- **Link ra ngoài trang.** Khi trang bấm sang chỗ khác, Desktop mở màn của chính nó:
  - chiến dịch: màn Chiến dịch, mở đúng chiến dịch;
  - "Thêm chiến dịch": form trống;
  - tài khoản: màn Chiến dịch, mở đúng tài khoản;
  - "Xem tất cả …": trang Báo cáo, đúng thẻ Theo chiến dịch / Chi tiết theo tài khoản;
  - "Kiểm tra số điện thoại": Quét data.

  Link khác mở trình duyệt.
- **Mở chiến dịch chạy trên Desktop.** Trong Desktop, mọi chiến dịch mở được, kể cả chiến dịch Zalo QR, Zalo trình duyệt, Facebook, Email: trang Web nhúng bỏ nhãn "Desktop" và câu "Làm trên app Desktop".
- **Khi nào tải.** Không tải gì tới khi khách mở menu lần đầu. Rời menu thì webview vẫn giữ. Không có hẹn giờ, không polling.

## Mã

**Dịch vụ dùng chung** (`src/main/services/desktopWebEmbedService.ts`). Đây là phần tách từ `JourneyWebService`, nay cấu hình theo trang (`DesktopWebEmbedSurface`: tên, phân vùng, kênh IPC, luật đường đi, phân loại link ra ngoài). Luật đăng nhập native, cookie httpOnly trong phân vùng, chặn đăng nhập từ trang, chặn tải tệp, tự đăng nhập lại một lần khi hết phiên và dọn phiên khi đăng xuất là **một bản cho cả hai trang**.

Có thêm một lớp kiểm: sau điều hướng trong trang (`did-navigate-in-page`), nếu trang dừng ở đường ngoài trang này thì báo lỗi kèm nút Thử lại. Ví dụ: bản Web chưa có Báo cáo 2 tự chuyển sang Tự động hóa.

**Hai trang:**

| | Tự động hóa › Quy trình | Báo cáo 2 |
| --- | --- | --- |
| Dịch vụ | `journeyWebService.ts` (`JourneyWebService`) | `reports2WebService.ts` (`Reports2WebService`) |
| Phân vùng | `persist:akaagent_web_<tổ chức>_<nhân viên>` (giữ tên cũ) | `persist:akaagent_web_reports2_<tổ chức>_<nhân viên>` |
| Đường trong khung | `/automation…` trừ `/automation/from-campaigns` | `/reports-2` |
| Hằng số / phân loại | `src/shared/journeyWebDesktop.ts` | `src/shared/reports2WebDesktop.ts` |
| IPC | `journey-web:*` | `reports2-web:*` |
| Đăng ký IPC | `journeyWebHandlers.ts` | `reports2WebHandlers.ts` |
| Giao diện | `components/Automation/JourneysEmbed.tsx` | `pages/Reports2Page.tsx` |

- Mỗi trang một phân vùng vì `webRequest` và quyền của Electron gắn theo phân vùng: hai dịch vụ trên cùng phân vùng sẽ ghi đè bộ lọc của nhau.
- Mỗi trang một phiên native. Mở cả hai trang là hai lượt đăng nhập native. Phiên native không tính vào hạn 3 thiết bị Web.
- Đăng ký IPC dùng chung `desktopWebEmbedHandlers.ts`. `handlers.ts` dọn cả hai trang ở bốn chỗ đăng xuất / đổi tài khoản và báo đổi mật khẩu cho cả hai.
- Giao diện khung dùng chung `components/WebEmbed/DesktopWebEmbedFrame.tsx` (CSS `desktopWebEmbed.css`, lớp `.journeys-embed*` chuyển từ `automationHub.css`). Đối tượng `api` truyền vào phải ổn định qua các lần vẽ (đặt ở cấp module), nếu không khung đăng ký lại và gọi `prepare` liên tục.
- Trang Báo cáo hiệu quả nhận prop `openTab` (`{ tab, nonce }`) để Báo cáo 2 mở đúng thẻ.

## Thứ tự đưa lên

1. Deploy API/Web của akaAgentWebApp. Phần "mọi loại tài khoản" (#299) và chế độ nhúng `/reports-2` đều cần bản Web mới.
2. Phát hành Desktop.

Nếu phát hành sai thứ tự, mục Báo cáo 2 báo "Trang Báo cáo 2 chưa có trên máy chủ" kèm Thử lại. Mục này không hiện nhầm trang khác và không ảnh hưởng menu khác.

## Kiểm chứng (23/11/2026)

- Đạt hai lần kiểm kiểu: `npx tsc --noEmit -p tsconfig.node.json` và `npx tsc --noEmit -p tsconfig.web.json`.
- `npm run build` đạt.
- `node scripts/journey-web-embed-electron-smoke.cjs` đạt 8/8 sau khi tách dịch vụ dùng chung: Tự động hóa không đổi hành vi.
- `node scripts/reports2-web-embed-electron-smoke.cjs` đạt 8/8. Bài này chạy trên Electron thật với máy chủ cục bộ và gồm:
  - đăng nhập và cookie trong phân vùng riêng;
  - chỉ gắn webview `/reports-2`;
  - link ra ngoài mở màn Desktop đúng loại;
  - Tự động hóa và Báo cáo 2 cùng mở không lẫn nhau;
  - trang không tự đăng nhập được;
  - trang dừng ngoài Báo cáo 2 thì báo lỗi;
  - dọn phiên từng khung.

**Chưa kiểm:**
- Bộ cài trên Windows và macOS.
- Nhìn mục menu trên app thật.
- Trang thật với API và phiên thật (cần deploy Web).

# Build akaAgent Desktop và App Server 9.7.0 — 14/11/2026

Đã build local ba bộ cài Desktop (Windows x64, macOS ARM64, macOS Intel x64) và bộ cài App Server Windows x64 nội bộ, cùng một nguồn:

- Worktree `.claude/worktrees/release-9.7.0`, nhánh `codex/release-9.7.0`, source commit `17d94bde48246525afe0875d36cfadc85d45f79b`.
- Nền `origin/dev_3` tại `ca2b779cd82016bb4d1b926cef81b9ead25b0cf6` (sau PR #673).
- Commit build chỉ đổi version trong `package.json`, `package-lock.json`, `version.txt`.
- Dependency cài sạch bằng `npm ci` trong worktree. `better-sqlite3` dựng lại cho Electron arm64, checksum `ced697fc…` như repo chính.

Thời điểm build (14/11/2026):

- Desktop **01:07:02–01:11:11 VN**: Windows 103 giây, Mac ARM64 75 giây, Mac Intel 71 giây.
- App Server **01:11:21–01:12:10 VN**: 49 giây.

**Phát hành:** feed Windows, Mac, Mac Intel trả 9.7.0 từ 01:24–01:25 VN 14/11. Bộ cài trên `akabiz.net/UpdateAutoSqlite/akaAgent/` có cùng số byte với bảng dưới (kiểm 02:30 VN, `Last-Modified` 18:24:49 / 18:25:11 UTC). App Server: VPS khởi động lại 02:14:18 VN, chưa xác nhận đã cài bản 9.7.0. Lúc build không đổi DB, không deploy service.

## Có gì mới

So với 9.6.0 (`3c59c5cd`) có các PR #654–#673; nhiều PR chỉ là tài liệu hoặc SQL. Phần chạy trong app:

- **Dừng listener Zalo không để lại kết nối "ma"** (#673), ở cả Desktop lẫn App Server. zca-js 2.1.2 tự mở lại kết nối nếu bị dừng lúc đang chờ nối lại hoặc đang bắt tay, và mất dấu socket mới nếu bị dừng rồi bật lại ngay (làm mới listener trước khi gửi tệp).
- **Gia hạn phiên Desktop không phụ thuộc giờ máy** (#658, #660). Máy chậm giờ không còn bị từ chối (401) mỗi giờ. Dọn lượt chạy coi "JWT expired" là lỗi tạm thời.
- **Engine v2 trên Desktop:**
  - lỗi xảy ra trước khi gọi Zalo được xếp "chưa gửi" và data về hàng đợi (#659);
  - kiêm akaBiz Sms không đẩy chồng cho cùng data khi akaBiz treo (#666).
- **Nhắc gia hạn trong phần mềm** (#668): nhãn "Còn N ngày", dải nhắc, hộp thoại theo mốc, cổng gia hạn trong app, chuông "Gói sắp hết hạn".
  - Lúc build, cài đặt `renewal.reminder` (id 115) là `{"audience":"all","bell":true,"legacyBanner":true}`. Phát hành xong thì mọi khách dùng 9.7.0 thấy nhắc gia hạn ngay.
  - Tắt khẩn cấp: `{"audience":"off"}`.
- **Lọc trùng khi thêm data vào Nhóm data** (#670; V522 đã apply).
- **Đồng bộ trạng thái tin nhắn Zalo** (#672) đang tắt: chưa có dòng `zalo.message_status_sync.enabled`, SQL V525/V526 chưa apply. Bản này chỉ thêm một lượt đọc cấu hình mỗi 15 phút cho tiến trình đang gửi/nhận tin Zalo.
- Bỏ thời hạn theo dõi tương tác Zalo khỏi chữ hiển thị (#665).

## App Server: có build lại

Gói App Server gồm 223 file nguồn (đồ thị import từ `src/server/{main,preload,renderer}`, làm theo [build-01](../../agents/reference/build-01.md)). Từ Server 9.6.0 (`3c59c5cd`), 26 file trong số đó đã đổi. Thay đổi chạy trên đường Zalo Server:

- `8b0d5e94` (#673): dừng listener không để lại kết nối ma, gồm lúc App Server thả tổ chức sang Fly, đăng xuất, làm mới listener trước khi gửi tệp.
- `626551cb`, `2d2a7cc7` (#672): đồng bộ trạng thái tin nhắn, đang tắt.

Các file đổi còn lại (phiên Desktop, nhắc gia hạn, engine v2) chỉ chạy ở Desktop.

## Bộ cài

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-9.7.0/akaAgent-Setup-9.7.0.exe` | 153293083 | `a84fb74518eabee5d69b1ed8b85faedd89b0c68b901fb3f322cb438ba8c069da` |
| macOS ARM64 | `dist/build-9.7.0/akaAgent.dmg` | 182972142 | `a787aa27e16140172c720ebedf0c3698ea17fbbc40d957fed90da1f1d99a82cb` |
| macOS Intel x64 | `dist/build-9.7.0/akaAgentIntel.dmg` | 190141668 | `76df2aab955e3b2f9052a3f354c8b93886d8b986dd5b113293e8f099755d320e` |
| App Server Windows x64 (nội bộ) | `dist-server/akaAgent-Zalo-Server-Internal-Setup-9.7.0.exe` | 140479036 | `40468c9f5a6940f2028e5d52880ede774cc39bac1e4c3a7e4e1704211bf19161` |

Đường dẫn tính từ repo chính `/Users/lequangnhut/Repos/akaAgent`:

- Bộ cài Desktop, `SHA256SUMS` và receipt ở `dist/build-9.7.0/`; log và file kiểm ở `dist/build-9.7.0-work/`.
- Bản App Server mang đi cài ở `dist-server/akaAgent-Zalo-Server-Internal-Setup-9.7.0.exe` (quyền 600), kèm `.sha256`. Thư mục build riêng ở `dist-server/private/2026-11-13T18-11-21-466Z/` (quyền 700).
- Bộ cài App Server chứa credential backend ở resource riêng ngoài ASAR. Chỉ cài trên máy chủ quản lý; không upload công khai, không đưa vào Git hay Desktop.

Không đưa bộ cài vào Git. Bản gốc trong worktree vẫn còn tới khi dọn worktree.

## Kiểm chứng

**Mã nguồn**
- Hai typecheck không lỗi.
- Smoke đạt:
  - dừng listener zca-js 12/12 (chạy lớp Listener thật với máy chủ WebSocket cục bộ, có đối chứng tái hiện lỗi);
  - gia hạn phiên lệch giờ 15;
  - nhắc gia hạn Desktop 14 nhóm;
  - đối chiếu thành viên nhóm data 12/12;
  - bộ chạy engine Desktop 10 nhóm;
  - hạn giờ media và lỗi trước khi gọi Zalo;
  - ảnh chụp runtime Desktop 12;
  - giảm đọc giao diện 13 nhóm;
  - gửi lặp lại 42 ca;
  - giảm request App Server 19/19.
- `campaign-outcome-engine-check-all` đạt 30 bước (SQL engine trên Postgres 17, lõi, bộ chạy Desktop, danh mục bản cũ).
- **`zalo-message-status-sync-smoke` hỏng:** 24 nhóm đạt, rồi hỏng ở "file nối DB, Desktop" với lỗi "phải có hẹn giờ gửi lô".
  - Lỗi có sẵn trước bản build: hỏng giống hệt ở `f4632806` (nhánh #672 trước khi gộp `dev_3`), `23b38d58` và `2e144ba6`, và không phụ thuộc giờ chạy.
  - Bản sửa listener không đụng các file này. Tính năng đang tắt trên production.

**Manifest đầu vào build**
- 1.464 file: file Git theo dõi dưới `src/`, `scripts/`, `build/`, `packages/` và 9 file cấu hình gốc.
- Chụp lúc 01:01:41 trước build và 01:13:52 sau build, cùng sha256 `e95ada05…`. Cây làm việc sạch suốt quá trình.

**Desktop** (script hậu kiểm của bản 9.6.0, đổi đường dẫn và số bản):
- **Version:** `resources/version.txt` (updater đọc file này) và `package.json` trong ASAR là 9.7.0 ở cả ba bản. Windows PE FileVersion/ProductVersion 9.7.0 (app `8664`, installer `14c`). Mac `CFBundleShortVersionString` 9.7.0, identity `com.akabiz.auto`.
- **Mã đóng gói:** 108 file `out/` trong ASAR giống hệt bản build ở cả ba bản. Main có `startZaloListenerGuarded`/`stopZaloListenerGuarded`.
- **Quét secret:** toàn bộ file đóng gói (627 file Windows, 631 mỗi bản Mac, tính cả `app.asar`). Không có JWT `service_role`/anon (kể cả anon cũ), `sb_secret_` hay resource `server-private`.
- **Windows:** payload giải nén từ installer khớp `win-unpacked` (`akaAgent.exe`, `app.asar`, `version.txt`, `better_sqlite3.node`).
- **Mac:** kiến trúc executable và mọi `.node` đúng (arm64 / x86_64). `codesign --verify --deep --strict` đạt (ad-hoc). Electron trong app nạp better-sqlite3 và chạy truy vấn đạt (Intel qua Rosetta). `hdiutil verify` đạt; mount read-only thì `app.asar` và executable khớp app.

**App Server** (`scripts/staff-rls/verify-private-server-build.cjs`), đều đạt:
- Windows x64; payload khớp `win-unpacked`; main Server trong ASAR khớp bản build và có bản sửa listener.
- Credential nạp được trên profile sạch, và không có trong source, `out/`, `out-server/` (quét 4.471 file); thư mục private bị Git ignore.
- Version 9.7.0.

**Module native và log**
- Module SQLite gốc của worktree và của repo chính giữ checksum `ced697fc…`.
- Log, receipt và file kiểm không chứa credential.

**Bộ cài cũ:** 52 bộ cài `.exe`/`.dmg` trong `dist/` và `dist-server/` của repo chính giữ nguyên checksum.

## Giới hạn và việc tiếp theo

- Windows chưa ký Authenticode, chưa cài/chạy trên Windows thật. Bản 9.6.0 cũng vậy, và khách báo phải tắt bảo vệ thời gian thực của Windows Defender mới cập nhật được.
- Mac ký ad-hoc, chưa notarize; Intel chỉ thử qua Rosetta.
- Chưa chạy luồng đăng nhập, chiến dịch hay Zalo thật trên bộ cài.
- Cài App Server lên VPS nên làm ngoài giờ cao điểm: lần cài 9.5.1 làm mọi tài khoản Server đăng nhập lại cùng lúc ([9.5.1](../akaagent-server-9.5.1-20261110/README.md)).
- Bản sửa listener không giải thích được việc mất phiên khi chuyển tài khoản Server sang Fly ngày 13/11 (xem mục pitfall "Dừng listener Zalo" trong `CLAUDE.md`).

[Receipt](build-receipt.json).

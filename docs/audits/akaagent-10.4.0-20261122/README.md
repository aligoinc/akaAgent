# Build akaAgent Desktop 10.4.0 — 22/11/2026

Đã build ba bộ cài Desktop 10.4.0 (Windows x64, macOS ARM64, macOS Intel x64) theo yêu cầu ("check code akaAgent sync về rồi build bản mới").
Không build App Server (xem mục dưới).

**Nguồn**

- Worktree `.claude/worktrees/release-10.4.0`, nhánh `codex/release-10.4.0`, source commit `4621949a4bf9eb4f0ec0d8540584bd4cd31b9875`.
- Commit này chỉ đổi version 10.3.0 → 10.4.0 ở `package.json`, `package-lock.json` (hai chỗ của gói gốc) và `version.txt`.
- Nền là `origin/dev_3` `993b5b9f13385d9e550ae0538b490f299573ad7f`, sau PR #777.
- Dependency cài sạch bằng `npm ci` trong worktree, xong lúc 22:21:00 VN. `better-sqlite3` dựng cho Electron arm64, checksum `ced697fc…`, trùng repo chính.

**Thời điểm build (VN, 22/11/2026)**

| Bản | Thời gian | Thời lượng |
| --- | --- | ---: |
| Windows | 22:23:07–22:25:28 | 141 giây |
| Mac ARM64 | 22:25:28–22:27:27 | 119 giây |
| Mac Intel | 22:27:27–22:28:49 | 82 giây |

**Phát hành:** chưa upload, chưa đổi feed; anh tự phát hành Desktop. Bước build không đổi DB, không deploy service.

PE FileVersion là `(10<<16)+4`.

## Có gì mới

So với 10.3.0 (`120d54a7`, bản đang trên feed), bản này có PR #774–#777. Các thay đổi chạy trong app:

- **Đồng bộ akaBiz Auto sang akaAgent** (#775; V623 và V625 đã apply).
  - Thẻ "akaBiz Desktop" trong Cài đặt chung (khi đã liên kết, có `dbPath`) có thêm khối "Đồng bộ tài khoản và chiến dịch" và nút Đồng bộ, mở hộp thoại 5 bước.
  - App đọc file SQLite của akaBiz Desktop ở chế độ chỉ đọc rồi gửi lên API akaAgentWebApp.
  - **API WebApp của tính năng này chưa deploy** và công tắc `web.akabiz_auto_sync` chưa có dòng. Desktop không đọc công tắc này, nên sau khi phát hành, khách đã liên kết akaBiz Desktop sẽ thấy nút Đồng bộ; bấm vào thì nhận câu "Máy chủ akaAgent chưa hỗ trợ đồng bộ akaBiz Auto. Vui lòng thử lại sau." tới khi API được deploy.
- **Thông báo nổi Desktop** (#776; V624 đã apply).
  - Thông báo nổi góc phải cho Chào ngày mới, báo cáo 12:00 / 18:00 và chiến dịch hoàn thành; nhãn "Chào ngày mới"; ô số cho phần nội dung `display: 'tiles'`.
  - Không thêm nhịp đọc DB định kỳ: chỉ đọc danh sách khi số chưa đọc của chuông tăng, hỏi số chưa đọc ở mốc báo cáo.
  - Tài liệu của tính năng ghi Desktop độc lập với thứ tự đưa lên của API / iOS (chỉ đọc trung tâm thông báo có sẵn). `notifications.default_reports` vẫn `off` lúc build, nên khách chỉ nhận báo cáo theo đăng ký sẵn có.
- #774 và #777 chỉ đổi DB và tài liệu (V621, V622 đã apply).

## App Server: không build lại

Gói App Server gồm 255 file nguồn. Sau 10.3.0 chỉ `src/shared/types.ts` đổi (#776), và chỉ đổi kiểu TypeScript: thêm trường tuỳ chọn `upcomingRunAts` và `display`, thêm loại nội dung `assistant`. Kiểu không ra mã chạy, nên bộ cài App Server 10.3.0 vẫn đúng mã. Danh sách ở `dist/build-10.4.0-work/server-graph.json`. App Server 10.3.0 vẫn chưa cài lên VPS.

## Bộ cài Desktop

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-10.4.0/akaAgent-Setup-10.4.0.exe` | 153473659 | `50e3f6196cdcbbda08305f5a482db24f0dd0afa3fc1ec7c8d259b637ca29fa19` |
| macOS ARM64 | `dist/build-10.4.0/akaAgent.dmg` | 183144723 | `8f6c2edb56d4f31419795322d4b5d631d03bf0e0e53fe48bb527fe01fff2ddb5` |
| macOS Intel x64 | `dist/build-10.4.0/akaAgentIntel.dmg` | 190312642 | `46f816002f2ee795ab7432494374bfdba7633b30112c0063b0ed6e76589384f8` |

Đường dẫn tính từ repo chính. `dist/build-10.4.0/` chứa bộ cài, `SHA256SUMS`, file `.sha256` và receipt. `dist/build-10.4.0-work/` chứa log, file kiểm và script.

## Kiểm chứng

Thứ tự theo bài học 10.3.0: hai typecheck trước khi build, build xong cả ba bản rồi mới chạy toàn bộ bộ kiểm (22:30–23:00 VN), không chạy song song với build.

**Mã nguồn.** Hai typecheck không lỗi (trước build và trong bộ kiểm). 105/119 bước đạt. 14 bước lỗi đều đã giải thích, không bước nào do bản build:

| Bước | Vì sao |
| --- | --- |
| `server-rest-smoke`, `post-bump-fixes-smoke`, `post-bump-rotation-smoke`, `post-bump-rotation-replay`, `upgrade-portal-desktop-smoke` | Lỗi của bài kiểm như 10.3.0 (thông báo giống hệt), bài kiểm trên `dev_3` chưa sửa. Bản chép đã vá của 10.3.0 chạy ngay trong bộ kiểm (`*-patched`): cả 5 đạt. |
| `message-status-sync-smoke`, `pending-reason-smoke`, `engagement-smoke` | Hỏng sẵn, thông báo giống hệt 10.3.0. |
| `fb-replay-20261118` | 1.138 dòng khớp, 2 khác chưa giải thích như 10.0.0 → 10.3.0. |
| `repeat-v561-smoke`, `repeat-v561-with-v585-smoke` | Lỗi của bài kiểm theo giờ chạy: chạy lúc 22:32 / 22:44 VN, nhánh "chạy lại sau N giờ kiểu cũ" coi từ 22:00 VN là quá giờ trong ngày (như 10.2.0). Chạy lại sau 00:00 VN: đạt (xem dưới). |
| `notification-v621-smoke`, `notification-v622-smoke`, `notification-v624-smoke` | Lỗi môi trường: macOS chỉ có bash 3.2. `pgenv.sh` mở rộng mảng rỗng `"${AS[@]}"` dưới `set -u` (bash < 4.4 báo unbound variable), `smoke_v621.sh` dùng `declare -A`. Chạy lại bằng bản chép `bash32/` chỉ đổi cú pháp: V624 đạt ngay; V621 / V622 hỏng thêm một ca theo giờ chạy (fixture đặt lịch `now() + 1 giờ`, sau 23:00 VN rơi sang ngày mai), chạy lại sau 00:00 VN: đạt (xem dưới). |

**Chạy lại sau 00:00 VN 23/11** (`03-reruns-summary.log`):
- `notification-v621-smoke` (bản chép bash 3.2) lúc 00:00:50: đạt, gồm bộ kiểm cũ 103 / 20 / 27 trên nền V621, gỡ và apply lại.
- `notification-v622-smoke` (bản chép bash 3.2) lúc 00:00:57: đạt.
- `repeat-v561-smoke` và `repeat-v561-with-v585-smoke` lúc 00:00:44 / 00:00:47 hỏng ở nhóm 5 (engine v2 kết thúc lượt) khi chưa qua 1 phút sau nửa đêm; nghi bài đặt lịch `now() − 1 phút` nên rơi về ngày hôm trước. Chạy lại lúc 00:01:13 / 00:01:17: cả hai 9/9 nhóm đạt.

Các bài kiểm riêng của PR mới đều đạt:
- `akabiz-auto-sync-desktop-smoke` 12/12 (chạy bằng Electron ở chế độ Node để dùng `better-sqlite3` dựng cho Electron, không `npm rebuild`), `akabiz-auto-sync-ui-smoke` 6/6.
- `notification-toast-smoke` 10 ca, `notification-toast-ui-smoke` 13 nhóm.
- `notification-v624-smoke` (bản chép bash 3.2).

Số liệu nổi bật:

- `campaign-outcome-engine-check-all`: 35 bước đạt.
- Phát lại Facebook bản chép 16/11: 1.171 dòng khớp, 7 khác đã chốt, 0 khác chưa giải thích.
- Kịch bản sự cố Facebook, cả ba bộ 0 vi phạm: mặc định 3 hạt giống / 182 cú gửi; DB như production 20 hạt giống / 1.108 cú gửi; dừng app ngẫu nhiên + chạy bằng Page 12 hạt giống / 799 cú gửi.
- Kịch bản engine trên DB như production: 532 lượt, 2.981 lần gửi; 0 vi phạm mới, 1 vi phạm đã biết (I1b, như 10.2.0 / 10.3.0).
- Giả lập dài theo dõi tương tác, 1 hạt giống: theo dõi Desktop 100% lúc khoẻ / 99,81% lúc nhiều lỗi, VPS 100% / 99,92%.
- Phát lại Up tin 21 ngày (bản chép đã vá): bài trùng câu 56,0% → 13,1%.

**Bộ cài Desktop.** `dist/build-10.4.0-work/verify-build.cjs` đạt cả ba bản:

- Version: `version.txt` trong `resources/` và version trong ASAR là 10.4.0; PE FileVersion / ProductVersion của installer và `akaAgent.exe` là `(10<<16)+4`; Info.plist là 10.4.0.
- 108 file `out/` trong ASAR khớp checksum bản dựng. Quét 627 (Windows) / 631 (Mac) tệp: không có tài nguyên Server, JWT `service_role`, `sb_secret_` hay anon key cũ.
- 83 dấu kiểm có đủ: các dấu của 10.0.0 → 10.3.0, cộng 5 dấu mới của #775 / #776 (`markers-new.json`). 5 dấu mới đều vắng trong main / renderer của bộ cài 10.3.0 đang trên feed (giải nén bằng `7za`). Lời gọi V498 vắng.
- Windows: payload NSIS khớp `win-unpacked`.
- Mac: kiến trúc executable và mọi `.node` đúng; chữ ký ad-hoc kiểm được; SQLite nạp được (Intel qua Rosetta); DMG mount chỉ đọc, nội dung khớp app.
- Manifest 1.865 tệp đầu vào giống hệt trước / sau build.
- 83 bộ cài cũ của repo chính giữ nguyên checksum; module `better-sqlite3` của repo chính và worktree giữ nguyên.

**Thiết lập DB đọc lúc build** (chỉ đọc, 22:24 VN): `engine.facebook` mode all; `notifications.assistant_inbox` = all; `notifications.default_reports` = off; `web.akabiz_auto_sync` chưa có dòng; `web_scan.campaigns` chỉ tổ chức 1; `zalo.campaign_engagement.enabled` = true. Migration từ 21/11 16:00 UTC: V621, V622, V623, V625, V624.

## Giới hạn

- Windows chưa ký Authenticode, chưa cài / chạy trên Windows thật. Mac ký ad-hoc, chưa notarize; Intel chỉ thử SQLite qua Rosetta.
- Chưa chạy luồng đăng nhập, chiến dịch hay Facebook / Zalo thật trên bộ cài.
- Đồng bộ akaBiz Auto: chưa chạy trên Electron thật với SQLite của akaBiz Desktop thật; API WebApp chưa deploy.
- Thông báo nổi: chưa chạy trong Electron thật, chỉ bài kiểm giao diện trên Chromium với IPC giả.

[Receipt](build-receipt.json).

# Build akaAgent Desktop 10.2.0 — 20/11/2026

Đã build ba bộ cài Desktop 10.2.0: Windows x64, macOS ARM64 và macOS Intel x64. Không build App Server.

**Nguồn**

- Worktree `.claude/worktrees/release-10.2.0`, nhánh `codex/release-10.2.0`, source commit `19e0cddedf2ceffe703e2061654caf3a44d28187`.
- Commit này chỉ đổi version 10.1.0 → 10.2.0 ở `package.json`, `package-lock.json` (hai chỗ của gói gốc) và `version.txt`.
- Nền là `origin/dev_3` `37efb347e8d5886c4cff4e810dfe125d3894384e`, sau PR #757.
- Dependency cài sạch bằng `npm ci` trong worktree, xong lúc 22:31:06 VN. `better-sqlite3` dựng lại cho Electron arm64, checksum `ced697fc…`, trùng repo chính.

**Thời điểm build:** 22:51:02–22:54:20 VN, 20/11/2026. Windows 84 giây, Mac ARM64 55 giây, Mac Intel 59 giây.

**Phát hành:** chưa upload, chưa đổi feed; anh tự phát hành. Bước build không đổi DB, không deploy service.

Lên 10.2.0 không đổi cách so phiên bản; PE FileVersion là `(10<<16)+2`.

## Có gì mới

So với 10.1.0 (`a195d29d`, bản đang trên feed) có PR #728–#757. Phần chạy trong app:

- **"Nâng cấp và mua gói"** (#732, dung688, merge 19/11 22:02). Mọi lối gia hạn, nâng cấp, mua gói mở chung một form trong phần mềm, nhúng cổng CRM `/gia-han`. Lối vào: mục menu ngay dưới "Thông tin tài khoản", nút trong Thông tin tài khoản, link ở màn đăng nhập và dải thông báo, nút "Mua hoặc dùng thử" trong thông báo "chưa được kích hoạt hoặc đã hết hạn". Không có migration mới, dùng vé V521.
- **Trang "Tin nhắn Facebook"** (#746): gom Messenger của nhiều tài khoản Facebook trong một trang.
- **Quét data: câu lỗi cho khách và nút "Mở trình duyệt"** (#749, #756). Lỗi mở trang Facebook, thiếu mã xác minh Business, tài khoản chưa đăng nhập, Zalo trình duyệt mất phiên thì hiện câu mới kèm nút mở đúng tab ở trang cần xem. Nút khoá 3 giây cho tab tải trang rồi mới chuyển sang trang Trình duyệt.
- **AutoCheck không hạ tài khoản Facebook khi tab đang ở trang lỗi** (#754). Trước đây tab hiện trang lỗi (`chrome-error://`) bị coi là "chưa đăng nhập".
- **Engine Facebook: lượt bị ngắt từ ngoài không còn thành lỗi chung SYS99** (#734). Thoát / cập nhật app, đăng xuất, tạm dừng giữa lúc block đang chờ thì ra RUN01 (data về hàng đợi) hoặc SYS02 (đã ghi dấu gửi), không cộng chuỗi data lỗi, không dừng oan chiến dịch.
- **Engine Facebook: DOM cả trang kèm ảnh lỗi** (#739; V595 đã apply 12:35 VN 20/11). Block lỗi chụp ảnh thì lưu thêm DOM rút gọn (bỏ script, style, giá trị ô ẩn) trên máy; khi có yêu cầu chẩn đoán thì gửi kèm ảnh.
- **Bộ giữ máy ngủ chỉ nhận việc lại khi máy đã thức liền 60 giây** (#735). Sửa ca Mac thức tạm vài giây vẫn nhận data rồi ngủ lại.
- **Dòng "⏸ Dừng gửi"** khi cả lô gửi dạng chia sẻ thất bại (#750, lõi engine; V601 đã apply 16:01 VN 20/11).
- Câu lỗi khi thiếu mã đọc hộp thư page đổi thành `Không đọc được tin nhắn của page "<tên>" bằng tài khoản này.` (#749).

PR chỉ đổi DB, block "[engine]" hoặc tài liệu (đã apply production, app không đổi): #728, #729–#731, #733 (V591), #736–#738 (V593, V594), #740–#742, #744 (V598), #745 (V597), #747–#748 (V599), #751–#753, #755 (V600, V602), #757 (V603).

## App Server: không build lại

Gói App Server gồm 247 file nguồn (đồ thị import từ `src/server/{main,preload,renderer}`, theo [build-01](../../agents/reference/build-01.md)). Có 52 file đổi kể từ Server 9.7.0 (`17d94bde`) và 10 file đổi sau 10.1.0:

- `packages/campaign-engine/src/{contracts,runUnit,zalo/share}.ts` (#750): engine v2 chỉ tạo khi `runtimeTarget === 'desktop'`; tài khoản Server chạy bộ cũ trên App Server hoặc engine trên Fly.
- `src/main/engineAdapters/facebook/{errorScreenshots,milestoneOutcomes}.ts`, phần Facebook của `campaignScheduler.ts` (#734, #739) và câu lỗi quét page Facebook trong `contactLoader.ts` (#749): App Server không chạy Facebook.
- `src/main/services/proxyRuntimeService.ts`, `src/shared/types.ts` (#746): chỉ đổi kiểu dữ liệu.
- `src/main/services/systemSleepGuard.ts` (#735): bộ giữ máy ngủ, mặc định tắt trên Windows (chưa có dòng `desktop.sleep_guard`).

Anh chỉ yêu cầu build Desktop. App Server trên VPS giữ bản 9.7.0.

## Bộ cài

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-10.2.0/akaAgent-Setup-10.2.0.exe` | 153341776 | `af64bf3e99ffb1aae6570dec90b33915c5e84ba3edb8253fb3032d844016ea36` |
| macOS ARM64 | `dist/build-10.2.0/akaAgent.dmg` | 183084439 | `4a9fc13ffe5956acfedc33e1b383c42a982c250a3d8dfbdb6759e20fe916a290` |
| macOS Intel x64 | `dist/build-10.2.0/akaAgentIntel.dmg` | 190277749 | `c430e2cb05029b0943c0a8cd49190ed4510ea3700216f86e10ded4842dbe562b` |

Đường dẫn tính từ repo chính `/Users/lequangnhut/Repos/akaAgent`:

- `dist/build-10.2.0/` chứa bộ cài, `SHA256SUMS`, file `.sha256` của từng bộ cài và receipt.
- `dist/build-10.2.0-work/` chứa log, file kiểm và script.

Không đưa bộ cài vào Git. Bản gốc trong worktree còn tới khi dọn worktree.

## Kiểm chứng

**Mã nguồn.** Hai typecheck không lỗi. 82/87 bước kiểm đạt; 5 bước lỗi đều đã giải thích, không do bản build:

| Bước | Vì sao |
| --- | --- |
| `zalo-message-status-sync-smoke` | Hỏng sẵn từ nhánh #672 ("phải có hẹn giờ gửi lô"), như 9.7.0 → 10.1.0; tính năng đang tắt. |
| `fb-replay-20261118` | Phát lại bản chép 18/11: 1.138 dòng khớp, 2 khác chưa giải thích như 10.0.0 và 10.1.0 (Up tin 51975, đăng nhóm 55640). |
| `upgrade-portal-desktop-smoke` | Lỗi của bài kiểm: nhóm "store giao diện" (#732) so nguyên đối tượng thông báo của `uiStore`, mà #749 thêm khoá `extraAction: null`. Bản chép chỉ sửa dòng so đó: 22/22 nhóm đạt. Bài kiểm trên `dev_3` cần sửa riêng. |
| `repeat-v561-smoke`, `repeat-v561-with-v585-smoke` | Lỗi của bài kiểm theo giờ chạy: nhánh "quá giờ trong ngày" coi mọi giờ từ 22:00 VN là quá giờ, nhưng chiến dịch thử dừng lúc 23:59 và chạy lại sau 1 giờ, nên tới 22:59 hàm DB vẫn hẹn chạy lại đúng như V558 (lúc 22:36:25 hẹn 23:36:25). Chạy lại lúc 23:00 VN: cả hai 9/9 nhóm đạt. |

Smoke riêng cho PR mới đều đạt: `upgrade-portal-ui-smoke`, `fb-v591/v597/v598/v603-smoke`, `error-watch-v593/v594/v599/v602-smoke`, `facebook-messages-smoke`, `data-scan-browser-help-smoke`, `engine-v601-smoke`, `facebook-tab-login-probe-smoke`, và `scenarios.cjs --seeds 12 --interrupt 0.08 --pages 3` (giả lập dừng app ở thời điểm ngẫu nhiên, chạy bằng Page).

Số liệu nổi bật (trích từ receipt):

- `campaign-outcome-engine-check-all`: 35 bước đạt.
- Phát lại Facebook bản chép 16/11: 1.171 dòng khớp, 7 khác đã chốt, 0 khác chưa giải thích.
- Kịch bản sự cố Facebook: mặc định 3 hạt giống / 182 cú gửi; DB như production 20 hạt giống / 1.108 cú gửi; dừng app ngẫu nhiên + Page 12 hạt giống / 799 cú gửi; cả ba 0 vi phạm.
- Kịch bản engine trên DB như production tối 20/11 (V601 luôn nạp, kèm V561, V564, V571, V575, V576, V581, V585): 532 lượt / 2.981 lần gửi, 0 vi phạm mới, 1 vi phạm đã biết (I1b, data trùng trong cùng lô chia sẻ, như 10.1.0), 0 kịch bản sự cố lỗi.
- Phát lại Up tin 21 ngày: bài trùng câu 56,0% → 13,1%; bài nhiều tài khoản 83,0% → 7,1%.

**Bộ cài.** `dist/build-10.2.0-work/verify-build.cjs`, đạt cả ba bản:

- `version.txt` trong `resources/` và version trong ASAR là 10.2.0; PE FileVersion / ProductVersion của installer và `akaAgent.exe` là `(10<<16)+2`; Info.plist 10.2.0.
- Mọi file `out/` trong ASAR khớp checksum bản dựng; không có tài nguyên Server, JWT `service_role`, `sb_secret_`, anon key cũ.
- 64 dấu kiểm có đủ: dấu của 10.0.0, 10.1.0 và 11 dấu mới của #732–#756 (`markers-new.json`); 11 dấu mới vắng trong main / renderer của bộ cài 10.1.0 đang trên feed (giải nén bằng `7za`). Lời gọi V498 `aka_agent_zalo_server_on_fly_v1` vắng.
- Windows: payload NSIS (`akaAgent.exe`, `app.asar`, `version.txt`, `better_sqlite3.node`) khớp `win-unpacked`.
- Mac: kiến trúc executable và mọi `.node` đúng (arm64 / x86_64); ký ad-hoc kiểm được; SQLite nạp được trong app đóng gói (Intel qua Rosetta); DMG kiểm checksum và mount chỉ đọc khớp app.
- Manifest 1.684 tệp đầu vào giống hệt trước / sau build; 75 bộ cài cũ trong `dist/`, `dist-server/` của repo chính giữ nguyên checksum; module SQLite gốc của repo chính và worktree khôi phục.

**Thiết lập DB đọc lúc build** (chỉ đọc, 22:35 VN): `engine.facebook` mode all; `engine.error_watch` bật, `fire` và `imageRequests` bật; chưa có dòng `desktop.sleep_guard` (mặc định Mac bật, Windows tắt); sổ migration tới V603.

## Giới hạn

- Windows chưa ký Authenticode, chưa cài / chạy trên Windows thật.
- Mac ký ad-hoc, chưa notarize; Intel chỉ thử SQLite qua Rosetta.
- Chưa chạy đăng nhập, chiến dịch, Facebook / Zalo thật trên bộ cài.
- Trang "Tin nhắn Facebook" (#746): bố cục thanh trên mới chưa xem trên app thật; giao diện tiếng Anh chỉ kiểm trên trang giả; chưa đo RAM mỗi trang Messenger.
- Form "Nâng cấp và mua gói" (#732) chưa chạy trên Electron thật với cổng CRM thật.
- Nút "Mở trình duyệt" (#749 / #756) đã thử trong app dev 20/11; chưa thử Zalo trình duyệt "chưa sẵn sàng" và lỗi mã xác minh thật.
- Bộ giữ máy ngủ chờ máy thức liền 60 giây (#735) chưa chạy trên Mac thật.
- App Server không build lại (giữ 9.7.0).

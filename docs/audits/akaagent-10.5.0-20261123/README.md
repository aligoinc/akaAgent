# Build akaAgent Desktop 10.5.0 — 23/11/2026

Đã build ba bộ cài Desktop 10.5.0 (Windows x64, macOS ARM64, macOS Intel x64) theo yêu cầu ("sync code akaAgent về rồi build bản mới").
Không build App Server (xem mục dưới).

**Nguồn**

- Worktree `.claude/worktrees/release-10.5.0`, nhánh `codex/release-10.5.0`, source commit `dd4395eddb926a65c73a820a15f72a5ebbd19dae`.
- Commit này chỉ đổi version 10.4.0 → 10.5.0 ở `package.json`, `package-lock.json` (hai chỗ của gói gốc) và `version.txt`.
- Nền là `origin/dev_3` `3d63c4536faeb5b1d4629560624c3010636b8da1`, sau PR #779.
- Dependency cài sạch bằng `npm ci` trong worktree, xong lúc 20:51:48 VN. `better-sqlite3` dựng cho Electron arm64, checksum `ced697fc…`, trùng repo chính.

**Thời điểm build (VN, 23/11/2026)**

| Bản | Thời gian | Thời lượng |
| --- | --- | ---: |
| Windows | 20:52:56–20:54:25 | 89 giây |
| Mac ARM64 | 20:54:26–20:55:26 | 60 giây |
| Mac Intel | 20:55:26–20:56:25 | 59 giây |

**Phát hành:** anh tự phát hành. Kiểm 00:36 VN 25/11: feed Windows, Mac, Mac Intel trả 10.5.0; ba bộ cài trên akabiz.net tải lên 21:10 VN 23/11, cùng số byte với bản build (chỉ so số byte). Bước build không đổi DB, không deploy service.

**Không có trong bản này:** #780–#784 merge `dev_3` ngày 24/11, sau lúc build.

PE FileVersion là `(10<<16)+5`.

## Có gì mới

So với 10.4.0 (`4621949a`, bản đang trên feed), bản này chỉ thêm PR #778 (merge `dev_3` 23:03 VN 22/11, sau lúc build 10.4.0). #779 chỉ là version + biên nhận 10.4.0.

- **Khung "Sau khi chạy: đưa khách vào nhóm"** trong form chiến dịch thường và form Agent.
  - Nháp lưu ở `values.campaignResultGroups`; lưu chiến dịch thì bật đồng bộ trước bước bật chiến dịch.
  - Lỗi đồng bộ thì giữ chiến dịch tạm dừng và hiện bảng ba nút ở chân form.
  - Main gọi API Web `/api/aka-agent/desktop/v1/campaign-result-groups` bằng token phiên Desktop (kênh IPC `campaign-result-groups:call`).
- **Trang Tự động hóa có ba thẻ.**
  - Quy trình: webview nhúng trang Tự động hóa của Web (`?embed=desktop`), main tự đăng nhập và đặt cookie phiên trong phân vùng riêng của nhân viên.
  - Từ chiến dịch: các đồng bộ "Sau khi chạy".
  - Quy tắc cũ: chỉ hiện khi nhân viên còn quy tắc, không tạo mới. `AutomationProcessor` chỉ chạy khi nhân viên còn quy tắc cũ.
- V627 (nhóm data Facebook cho khung Sau khi chạy) đã apply 22:28 VN 22/11.
- **API / Web đang chạy đã có phần của #778** (đọc chỉ đọc 20:54 VN 23/11, máy Web cập nhật 13:59 VN 23/11): bundle API có đường `desktop/v1/campaign-result-groups` và phiên native `aka_agent_control_session`; bundle Web có chế độ nhúng (`aka.embed`, câu "akaAgent: cần đăng nhập lại"). Bundle API cũng đã có đường `akabiz-auto-sync` của #775.

## App Server: không build lại

Gói App Server gồm 255 file nguồn. #778 không đổi file nào trong gói. So với bản App Server 10.3.0 (`120d54a7`), vẫn chỉ `src/shared/types.ts` đổi (#776, chỉ đổi kiểu TypeScript), như lúc build 10.4.0. Bộ cài App Server 10.3.0 vẫn đúng mã. Danh sách ở `dist/build-10.5.0-work/server-graph.json`.

## Bộ cài Desktop

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-10.5.0/akaAgent-Setup-10.5.0.exe` | 153547600 | `c1c3e91f49438b0f9f5ad501bf3dc31ae5bf9d4c305a148df6e6d50e9d12281e` |
| macOS ARM64 | `dist/build-10.5.0/akaAgent.dmg` | 183197254 | `aa2b12098ffd5d4f18ad7fdea64230b52379b25022c217205a1372ca0075c567` |
| macOS Intel x64 | `dist/build-10.5.0/akaAgentIntel.dmg` | 190352183 | `cf565fd2126279e4c8abc87d85209a271d744e2b18c440a36b7022cff91bf6a6` |

Đường dẫn tính từ repo chính. `dist/build-10.5.0/` chứa bộ cài, `SHA256SUMS`, file `.sha256` và receipt. `dist/build-10.5.0-work/` chứa log, file kiểm và script.

## Kiểm chứng

Thứ tự theo build-01: hai typecheck trước khi build, build xong cả ba bản rồi mới chạy toàn bộ bộ kiểm (20:57–21:33 VN), không chạy song song với build. Bộ kiểm chạy trước 22:00 VN để tránh các bài hỏng theo giờ chạy.

**Mã nguồn.** Hai typecheck không lỗi (trước build và trong bộ kiểm). 112/122 bước đạt. 10 bước lỗi đều đã giải thích, không bước nào do bản build:

| Bước | Vì sao |
| --- | --- |
| `server-rest-smoke`, `post-bump-fixes-smoke`, `post-bump-rotation-smoke`, `post-bump-rotation-replay`, `upgrade-portal-desktop-smoke` | Lỗi của bài kiểm như 10.3.0 / 10.4.0, thông báo giống hệt 10.4.0 (so log). Bài kiểm trên `dev_3` chưa sửa. Bản chép đã vá chạy ngay trong bộ kiểm (`*-patched`): cả 5 đạt. |
| `message-status-sync-smoke`, `pending-reason-smoke`, `engagement-smoke` | Hỏng sẵn, thông báo giống hệt 10.4.0. |
| `fb-replay-20261118` | 1.138 dòng khớp, 2 khác chưa giải thích như 10.0.0 → 10.4.0. |
| `notification-v622-smoke` | Lỗi của bài kiểm theo giờ chạy. `v622_tests.sql` đặt lịch 60 chiến dịch ở `now() + 2 giờ` và chiến dịch đăng fanpage ở `now() + 3 giờ`; chạy lúc 21:33 VN thì chiến dịch fanpage (00:33) rơi sang ngày mai, ca "hơn 50 chiến dịch" ra 62 thay vì 63. Bài này hỏng từ 21:00 VN, không phải từ 23:00 như ghi ở 10.4.0. Bản chép `patched-v622/` chỉ đổi hai khoảng thành `+ 20` / `+ 40` phút, chạy lại lúc 21:33:52: đạt cả 11 ca (`03-reruns-summary.log`). |

Khác 10.4.0: ba bài DB V621 / V622 / V624 chạy luôn bằng bản chép cho bash 3.2 (`bash32/`), nên không còn lỗi môi trường; `campaign-repeat-v561-smoke` và bản kèm V585 chạy lúc 20:59 / 21:12 VN: đạt.

Các bài kiểm riêng của #778 đều đạt:
- `campaign-result-groups-desktop-smoke` 5/5 (hợp đồng chép nguyên văn WebApp, client main gọi API cục bộ: thành công, lỗi nghiệp vụ, API chưa có đường, mất mạng).
- `campaign-result-groups-ui-smoke` 8/8 (khung trong form và thẻ Từ chiến dịch trên Chromium, IPC giả).
- `journey-web-embed-electron-smoke` 8/8 (Electron thật, máy chủ cục bộ đóng vai API + trang Web nhúng: đăng nhập native, cookie httpOnly trong phân vùng riêng, chặn link ra ngoài, đăng nhập lại một lần khi hết phiên, dọn cookie khi đăng xuất).

Số liệu nổi bật (giống 10.4.0, #778 không đụng engine):

- `campaign-outcome-engine-check-all`: 35 bước đạt.
- Phát lại Facebook bản chép 16/11: 1.171 dòng khớp, 7 khác đã chốt, 0 khác chưa giải thích.
- Kịch bản sự cố Facebook, cả ba bộ 0 vi phạm: mặc định 3 hạt giống / 182 cú gửi; DB như production 20 hạt giống / 1.108 cú gửi; dừng app ngẫu nhiên + chạy bằng Page 12 hạt giống / 799 cú gửi.
- Kịch bản engine trên DB như production: 532 lượt, 2.981 lần gửi; 0 vi phạm mới, 1 vi phạm đã biết (I1b, như 10.2.0 → 10.4.0).
- Giả lập dài theo dõi tương tác, 1 hạt giống: theo dõi Desktop 100% lúc khoẻ / 99,81% lúc nhiều lỗi, VPS 100% / 99,92%.
- Phát lại Up tin 21 ngày (bản chép đã vá): bài trùng câu 56,0% → 13,1%.

**Bộ cài Desktop.** `dist/build-10.5.0-work/verify-build.cjs` đạt cả ba bản:

- Version: `version.txt` trong `resources/` và version trong ASAR là 10.5.0; PE FileVersion / ProductVersion của installer và `akaAgent.exe` là `(10<<16)+5`; Info.plist là 10.5.0.
- 108 file `out/` trong ASAR khớp checksum bản dựng. Quét 627 (Windows) / 631 (Mac) tệp: không có tài nguyên Server, JWT `service_role`, `sb_secret_` hay anon key cũ.
- 89 dấu kiểm có đủ: các dấu của 10.0.0 → 10.4.0, cộng 6 dấu mới của #778 (`markers-new.json`). 6 dấu mới đều vắng trong main / renderer của bộ cài 10.4.0 đang trên feed (giải nén bằng `7za`). Lời gọi V498 vắng.
- Windows: payload NSIS khớp `win-unpacked`.
- Mac: kiến trúc executable và mọi `.node` đúng; chữ ký ad-hoc kiểm được; SQLite nạp được (Intel qua Rosetta); DMG mount chỉ đọc, nội dung khớp app.
- Manifest 1.886 tệp đầu vào giống hệt trước / sau build.
- 86 bộ cài cũ của repo chính giữ nguyên checksum; module `better-sqlite3` của repo chính và worktree giữ nguyên.

**Thiết lập DB đọc lúc build** (chỉ đọc, 20:54 VN): `engine.facebook` mode all; `notifications.assistant_inbox` = all; `notifications.default_reports` = off; `web.akabiz_auto_sync` chưa có dòng; `web_scan.campaigns` chỉ tổ chức 1; `zalo.campaign_engagement.enabled` = true. Migration từ 22/11 22:00 VN: V627, V629, V630, V516 (V629 / V630 / V516 không có code trong bản này).

## Giới hạn

- Windows chưa ký Authenticode, chưa cài / chạy trên Windows thật. Mac ký ad-hoc, chưa notarize; Intel chỉ thử SQLite qua Rosetta.
- Chưa chạy luồng đăng nhập, chiến dịch hay Facebook / Zalo thật trên bộ cài.
- Sau khi chạy / Tự động hóa (#778): chưa chạy với API Web thật và tài khoản thật; bài Electron thật dùng máy chủ cục bộ đóng vai API + trang Web nhúng.

[Receipt](build-receipt.json).

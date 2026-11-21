# Build akaAgent Desktop 10.3.0 và App Server 10.3.0 — 21/11/2026

Đã build ba bộ cài Desktop 10.3.0 (Windows x64, macOS ARM64, macOS Intel x64) theo yêu cầu ("Build Desktop"). Sau đó build bộ cài App Server nội bộ 10.3.0 theo câu hỏi của anh ("build app server được chưa?").

**Nguồn**

- Worktree `.claude/worktrees/release-10.3.0`, nhánh `codex/release-10.3.0`, source commit `120d54a7eba878c4d1dcf8af7494d18df67ab701`.
- Commit này chỉ đổi version 10.2.0 → 10.3.0 ở `package.json`, `package-lock.json` (hai chỗ của gói gốc) và `version.txt`.
- Nền là `origin/dev_3` `3a08a107f96cea5f7057dd588e8de2ab7fd4520c`, sau PR #771.
- Dependency cài sạch bằng `npm ci` trong worktree, xong lúc 23:18:08 VN. `better-sqlite3` dựng cho Electron arm64, checksum `ced697fc…`, trùng repo chính.

**Thời điểm build (VN, 21/11/2026)**

| Bản | Thời gian | Thời lượng |
| --- | --- | ---: |
| Windows | 23:26:35–23:28:13 | 98 giây |
| Mac ARM64 | 23:28:13–23:29:21 | 68 giây |
| Mac Intel | 23:29:21–23:30:28 | 67 giây |
| App Server | 23:34:00–23:35:05 | 65 giây |

**Phát hành:** chưa upload, chưa đổi feed; anh tự phát hành Desktop. App Server chưa cài lên VPS. Bước build không đổi DB, không deploy service.

PE FileVersion là `(10<<16)+3`.

## Có gì mới

So với 10.2.0 (`19e0cdde`, bản đang trên feed), bản này có PR #760–#771. Các thay đổi chạy trong app:

- **Quét data Nhà Tốt / Batdongsan / Trang Vàng** (#770, #771; V618 đã apply 21:06 VN 21/11). Ba loại chiến dịch "Tìm data" chạy bằng engine v2, kèm loại tài khoản mới "Website". Chỉ tổ chức 1 thấy, theo công tắc `web_scan.campaigns`.
- **Đăng bài nhóm Facebook ẩn danh** (#765, #768; V616 và V617 đã apply).
  - Form đăng nhóm có thêm ô "Đăng bài ẩn danh". Khi bật, form ẩn Kiêm comment, Kiêm up tin và Đăng bài dạng chia sẻ.
  - Nhóm không cho đăng ẩn danh thì ra FB51. Không bật được công tắc ẩn danh thì ra FB52.
- **Trạng thái "Đã từ chối kết bạn"** (#764; V615 đã apply). Bộ đọc sự kiện Zalo ghi lại lúc người nhận từ chối lời mời kết bạn.
- **Theo dõi tương tác Zalo** (#762, #766):
  - Lần đọc cấu hình và lời gọi RPC có giới hạn thời gian, kèm log bước bị treo.
  - Khi cấu hình vừa hết hạn, app dùng tạm bản cũ trong lúc đọc lại.
- **Ca lỗi 533** (#760; V607 đã apply). Bộ lập lịch đọc trang đang mở khi block tự trả mã lỗi trước lúc gửi: trang xác minh thì ra FB04, trang đăng nhập thì ra FB43.
- **Chiến dịch tìm data đẩy data qua DB, quản trị viên group vào Nhóm data, tab Data tìm được theo quản trị viên** (#761, #763, #767, #769; V608, V610 và V614 đã apply). Các PR này làm ở máy khác.

## App Server: có build lại

Gói App Server gồm 255 file nguồn: 70 file đổi kể từ Server 9.7.0 (`17d94bde`), 29 file đổi sau 10.2.0. Trong số đó có `campaignScheduler.ts` và theo dõi tương tác Zalo (`src/main/services/zaloCampaignEngagement.ts`, `src/shared/zaloCampaignEngagement.ts`). Vì vậy VPS cần bản này mới có hạn đọc cấu hình, dùng tạm cấu hình vừa hết hạn và ghi được mốc từ chối kết bạn. Danh sách file ở `dist/build-10.3.0-work/server-graph.json`.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist-server/akaAgent-Zalo-Server-Internal-Setup-10.3.0.exe` | 140579955 | `15419ab377601204a38e7658f374ada39c45bdbe75dd9c5201fe28a0521a853a` |

Bản gốc và `verification-before.json` nằm ở `dist-server/private/2026-11-21T16-34-00-619Z/` của repo chính.

`scripts/staff-rls/verify-private-server-build.cjs` đạt các mục sau:
- Windows x64; payload trong bộ cài khớp bản dựng; `server_main` khớp.
- Khoá backend nạp được trên máy sạch, và không lọt vào mã nguồn, gói Desktop hay JS.
- Đã quét 5.054 tệp; thư mục nằm ngoài Git.
- Bộ cài Server cũ giữ nguyên; module gốc của máy build được khôi phục.

Bộ cài này có khoá backend trích được, nên chỉ cài trên VPS do akaBiz quản lý, không phát hành.

## Bộ cài Desktop

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-10.3.0/akaAgent-Setup-10.3.0.exe` | 153389683 | `e25c82372caf1be74c71de73ca8733409eac3f521a7044b792b255e936347939` |
| macOS ARM64 | `dist/build-10.3.0/akaAgent.dmg` | 183123174 | `147aa2c1eb65e6667adb0bf7c53646d032a8cdacf551de0d568fcfcb79c8843c` |
| macOS Intel x64 | `dist/build-10.3.0/akaAgentIntel.dmg` | 190286636 | `e148db5e478dc556319534d40e6f7f659530676df23cb625e3bf48a325bac65c` |

Đường dẫn tính từ repo chính. `dist/build-10.3.0/` chứa bộ cài, `SHA256SUMS`, file `.sha256` và receipt. `dist/build-10.3.0-work/` chứa log, file kiểm và script.

## Kiểm chứng

**Bộ kiểm phải chạy lại sau build.**
- Lần chạy đầu đi song song với build. Build Desktop và build Server thay `better-sqlite3` của worktree bằng bản Windows / x64 trong lúc đóng gói, nên các bài dùng SQLite ra kết quả sai: lỗi `dlopen`, có bài báo đạt mà 0 dòng khớp.
- Hai lần chạy bị dừng giữa chừng được lưu ở `aborted-concurrent/` và `aborted-server-build/`.
- Kết quả dưới đây là lần chạy lại, 23:35–00:14 VN, khi không còn build nào chạy.

**Mã nguồn.** Hai typecheck không lỗi. 96/107 bước đạt. 11 bước lỗi đều đã giải thích, không bước nào do bản build:

| Bước | Vì sao |
| --- | --- |
| `server-rest-smoke` | Lỗi của bài kiểm: VM dựng `runAccountCampaignQueue` thiếu hàm `isWebAccountPlatform` mà #770 thêm vào. Bản chép có thêm hàm này: 19/19 đạt. |
| `post-bump-fixes-smoke` | Lỗi của bài kiểm: chỉ tìm lời gọi trong 6.000 ký tự đầu của `reportFacebookEngineRows`. #760 làm hàm dài thêm, nên lời gọi nay nằm ở ký tự 6.557. Bản chép nới lên 8.000: 9/9 đạt. |
| `post-bump-rotation-smoke`, `post-bump-rotation-replay` | Lỗi của bài kiểm: harness không truyền `isGroupPostAnonymous` (#765). Bản chép đã vá: smoke đạt 10/10; phát lại cho đúng số của 10.2.0. |
| `upgrade-portal-desktop-smoke` | Như 10.2.0: bài kiểm chưa biết khoá `extraAction`. Bản chép đạt 22/22. |
| `repeat-v561-smoke`, `repeat-v561-with-v585-smoke` | Lỗi của bài kiểm theo giờ chạy: lúc 23:38 VN nhánh "gửi lặp lại sau mỗi x phút" bị đẩy sang ngày mới. Chạy lại lúc 00:05 VN: cả hai 9/9. |
| `message-status-sync-smoke` | Hỏng sẵn từ nhánh #672, như 9.7.0 → 10.2.0; tính năng đang tắt. |
| `fb-replay-20261118` | 1.138 dòng khớp, 2 khác chưa giải thích như 10.0.0 → 10.2.0. |
| `pending-reason-smoke`, `engagement-smoke` | Lỗi có sẵn: trên mã 10.2.0 (`37efb347`) cũng hỏng giống hệt. Hai bài này lần đầu được đưa vào bộ kiểm build. |

Các bài kiểm riêng của PR mới đều đạt:
- `fb-v607-smoke`, `fb-v616-smoke`, `fb-v617-smoke`.
- `engagement-v615-smoke`, `engagement-config-bound-smoke`, `engagement-config-bound-real-fetch`, `engagement-chaos-sim --seeds 1`.
- `web-scan-v618/runner/push/form-ui-smoke`.
- `find-data-*` (app, V608, quản trị viên, hai form), `account-actions-smoke`, `limit-progress-smoke`.

Ba bài không chạy:
- `desktop-web-sim` và `live-*-check`: ra trang thật.
- `ingest-realfn-smoke`: cần thư mục đọc từ production.
- `test_v614_keys`: cần bộ giá trị thật.

Số liệu nổi bật:

- `campaign-outcome-engine-check-all`: 35 bước đạt.
- Phát lại Facebook bản chép 16/11: 1.171 dòng khớp, 7 khác đã chốt, 0 khác chưa giải thích.
- Kịch bản sự cố Facebook, cả ba bộ 0 vi phạm:
  - mặc định: 3 hạt giống, 182 cú gửi;
  - DB như production: 20 hạt giống, 1.108 cú gửi;
  - dừng app ngẫu nhiên + chạy bằng Page: 12 hạt giống, 799 cú gửi.
- Kịch bản engine trên DB như production: 532 lượt, 2.981 lần gửi; 0 vi phạm mới, 1 vi phạm đã biết (I1b, như 10.2.0).
- Giả lập dài theo dõi tương tác, 1 hạt giống, tỉ lệ lượt gửi được theo dõi:

  | Máy | Lúc khoẻ | Lúc nhiều lỗi |
  | --- | ---: | ---: |
  | Desktop | 100% | 99,81% |
  | VPS | 100% | 99,92% |

  Luồng ghi không kẹt.
- Phát lại Up tin 21 ngày: bài trùng câu 56,0% → 13,1%.

**Bộ cài Desktop.** `dist/build-10.3.0-work/verify-build.cjs` đạt cả ba bản:

- Version:
  - `version.txt` trong `resources/` và version trong ASAR là 10.3.0;
  - PE FileVersion / ProductVersion của installer và `akaAgent.exe` là `(10<<16)+3`;
  - Info.plist là 10.3.0.
- Mọi file `out/` trong ASAR khớp checksum bản dựng. Không có tài nguyên Server, JWT `service_role`, `sb_secret_` hay anon key cũ.
- 78 dấu kiểm có đủ: gồm các dấu của 10.0.0 → 10.2.0, cộng 14 dấu mới của #760–#770 (`markers-new.json`).
  - 14 dấu mới đều vắng trong main / renderer của bộ cài 10.2.0 đang trên feed (giải nén bằng `7za`).
  - Lời gọi V498 vắng.
- Windows: payload NSIS khớp `win-unpacked`.
- Mac:
  - kiến trúc executable và mọi `.node` đúng;
  - chữ ký ad-hoc kiểm được;
  - SQLite nạp được (Intel qua Rosetta);
  - DMG mount ở chế độ chỉ đọc, nội dung khớp app.
- Manifest 1.834 tệp đầu vào giống hệt trước / sau build.
- 78 bộ cài cũ của repo chính giữ nguyên checksum.

**Thiết lập DB đọc lúc build** (chỉ đọc, 23:21 VN):
- `engine.facebook` mode all.
- `web_scan.campaigns` chỉ tổ chức 1.
- `zalo.campaign_engagement.enabled` = true.
- Chưa có dòng `desktop.sleep_guard`.
- Sổ migration tới V620. V619 / V620 là agent soạn nội dung, làm ở máy khác, không thuộc bản này.

## Giới hạn

- Windows chưa ký Authenticode, chưa cài / chạy trên Windows thật. Mac ký ad-hoc, chưa notarize.
- Chưa chạy đăng nhập, chiến dịch, Facebook / Zalo thật trên bộ cài.
- Quét data website: không chạy giả lập ra trang thật trong lần build này, chưa chạy với DB thật trong app.
- Đăng ẩn danh: chưa thử tài khoản chỉ là thành viên nhóm, chưa thử giao diện tiếng Anh.
- App Server 10.3.0 chưa cài lên VPS, chưa chạy trên Windows thật.
- Bài kiểm trên `dev_3` cần sửa riêng: `server-rest`, `post-bump-fixes`, `post-bump-rotation` (harness), `upgrade-portal-desktop`, `pending-reason`, `engagement`.

# Build akaAgent Desktop 10.1.0 — 19/11/2026

Đã build ba bộ cài Desktop 10.1.0: Windows x64, macOS ARM64, macOS Intel x64. Không build App Server.

**Nguồn**

- Worktree `.claude/worktrees/release-10.1.0`, nhánh `codex/release-10.1.0`, source commit `930f85fc03d78c023c0759f5ffe9e41f7002f93c`.
- Commit này chỉ đổi version 10.0.0 → 10.1.0 ở `package.json`, `package-lock.json` (hai chỗ của gói gốc) và `version.txt`.
- Nền là `origin/dev_3` `f31c8e7fc5d14f3ad8711e73ae6275ce473fb6dc`, sau PR #725.
- Dependency cài sạch bằng `npm ci` trong worktree, xong lúc 20:06:43 VN. `better-sqlite3` dựng lại cho Electron arm64, checksum `ced697fc…`, trùng repo chính.

**Thời điểm build:** 20:23:50–20:26:56 VN, 19/11/2026. Windows 78 giây, Mac ARM64 56 giây, Mac Intel 52 giây.

**Phát hành:** chưa upload, chưa đổi feed; anh tự phát hành. Bước build không đổi DB, không deploy service.

Lên 10.1.0 không đổi cách so phiên bản. Updater so từng phần bằng số, và đã kiểm khi lên số chính 10 ở [10.0.0](../akaagent-10.0.0-20261118/README.md). PE FileVersion là `(10<<16)+1`.

## Có gì mới

So với 10.0.0 (`fad8c14f`, bản đang trên feed) có PR #720–#725. Phần chạy trong app:

- **Tách mã Z114 "Tham số không hợp lệ" trong engine Zalo của Desktop** (#720; V581 đã apply 11:17 VN 19/11).
  - Engine trên Desktop ra DAT02 khi cột UID chứa SĐT, DAT03 khi gửi cho chính tài khoản gửi, DAT04 khi UID thuộc tài khoản khác.
  - Để biết UID thuộc tài khoản khác, Desktop tra tài khoản sở hữu UID khi Zalo trả 114.
  - TAG01 (tag đầy) chỉ cần DB, đã chạy từ 11:19 VN.
  - Phần Fly của #720 (ChatApi #174) đã deploy `worker` 20:22 VN 19/11, không thuộc bước build.
- **Mục menu chuột phải "Kiểm tra nhập mã xác minh Fanpage"** cho tài khoản Facebook (#721). Khi quét page mà Facebook đòi mã xác minh, câu lỗi hướng dẫn khách vào mục này.
  - Câu lỗi tương ứng ở ba block đăng bài / quét page nằm ở migration V582, **chưa apply**. PR #721 dặn chỉ apply sau khi bản Desktop có mục menu được phát hành.
  - Số 582 trong sổ đã thuộc `migration_v582_aka_assistant_images` (13:15 VN 19/11), nên phải đổi số rồi sinh lại bằng `scripts/build-v582-sql.cjs` trước khi apply.
- **Hỏi đáp AI: đính kèm ảnh vào câu hỏi** (#722, dung688). Desktop chọn hoặc dán ảnh, tải lên kho media, xem ảnh của câu đã gửi. Edge Function `ai-chat-agent` bản 5 đã deploy 09:41 VN 19/11.
- **Hạn chờ đo bằng đồng hồ đơn điệu** (#724). Máy bị kéo lùi giờ không còn làm lượt chạy treo.
  - Áp dụng cho chờ phần tử trên trang, vòng chờ trong code block (`Date` của sandbox), bộ phát hiện block treo, nghỉ giữa hai data, chờ của quét data.
  - Tình huống gốc: 18/11, một máy Windows 9.9.0 bị đặt lùi giờ mỗi giờ, lượt Facebook treo từ 17:18 tới khi khách mở lại app.

PR chỉ đổi DB hoặc tài liệu: #725 (V585 "Chạy nhiều khung giờ" dạng mảng, đã apply 15:56 VN 19/11) và #723 (tài liệu).

Không có trong bản này: mục "Lỗi không xác định" của đợt 2 kiểm lỗi Facebook. V588 đã apply, nhưng code Desktop của đợt này chưa merge `dev_3` lúc build.

## App Server: không build lại

Gói App Server gồm 247 file nguồn (đồ thị import từ `src/server/{main,preload,renderer}`, theo [build-01](../../agents/reference/build-01.md)). Có 50 file đổi kể từ Server 9.7.0 (`17d94bde`) và 9 file đổi sau 10.0.0:

- `packages/campaign-engine/src/zalo/messagePhone.ts`, `src/main/engineAdapters/desktopZaloPort.ts`, `src/main/data/repositories/accountContactRepository.ts` (#720): engine v2 chỉ tạo khi `runtimeTarget === 'desktop'`. Hàm tra tài khoản sở hữu UID chỉ cổng Desktop gọi.
- `src/main/engineAdapters/facebook/pageTrace.ts` (#724) và phần Facebook của `contactLoader.ts` (#721): App Server không chạy Facebook.
- `campaignScheduler.ts`, `contactLoader.ts`, `blockExecutor.ts`, `pageController.ts`, `src/shared/monotonicNow.ts` (#724) có chạy trên App Server (nghỉ giữa hai data, kiểm điều khiển Zalo Server khi đang nghỉ, code block, chờ của quét data).
  - Khi đồng hồ máy không bị chỉnh, khoảng chờ đo bằng đồng hồ đơn điệu bằng khoảng đo bằng giờ máy.
  - VPS lấy giờ từ máy chủ, nên hành vi không đổi.

Anh chỉ yêu cầu build Desktop. App Server trên VPS giữ bản 9.7.0.

## Bộ cài

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-10.1.0/akaAgent-Setup-10.1.0.exe` | 153302904 | `9c65ee6b8bc725485f595444bd6a97832451070cc5bf77cea972397b9861a96e` |
| macOS ARM64 | `dist/build-10.1.0/akaAgent.dmg` | 183065455 | `476c523cd1a274a5796ccabdb9a8cd81886d66811be92934fa1cb3f54f626fb3` |
| macOS Intel x64 | `dist/build-10.1.0/akaAgentIntel.dmg` | 190211737 | `3765b6097eacdc18826bc4f026f0a4e6d47400cf1f8890f592f1044c1cc5181b` |

Đường dẫn tính từ repo chính `/Users/lequangnhut/Repos/akaAgent`:

- `dist/build-10.1.0/` chứa bộ cài, `SHA256SUMS`, file `.sha256` của từng bộ cài và receipt.
- `dist/build-10.1.0-work/` chứa log, file kiểm và script của lần build này. Log deploy `worker` ChatApi cùng tối nằm ở thư mục con `chatapi-worker-deploy/`.

Không đưa bộ cài vào Git. Bản gốc trong worktree còn tới khi dọn worktree.

## Kiểm chứng

**Mã nguồn.** Hai typecheck không lỗi. 66/70 bước kiểm đạt; 4 bước lỗi đều đã giải thích, không do bản build.

| Nhóm | Kết quả |
| --- | --- |
| Toàn bộ chuỗi kiểm của 10.0.0: smoke 9.9.0, `campaign-outcome-engine-check-all`, engine Facebook (13 smoke), Up tin, quản trị viên group, PR chỉ đổi DB (V571–V576) | đạt, trừ 3 bước ở dưới |
| `campaign-outcome-engine-check-all` (gồm smoke V581 của #720) | 34 bước đạt |
| #720: `campaign-outcome-engine-v581-smoke` | đạt |
| #721: `facebook-business-token-v582-smoke` (V582 trên PG17, bản gỡ) | đạt |
| #722: `ai-chat/desktop_image_smoke.sh`, `ai-chat/edge_agent_image_smoke.mjs` | đạt |
| #722: `run-ai-chat-images-ui-smoke` | đạt 8 nhóm khi chạy lại bằng Chrome (xem dưới) |
| #724: `engine-v2-facebook/clock-rollback-smoke` | đạt |
| #725: `engine-v2-multi-slot-array-v585-smoke`, `campaign-repeat-v561-smoke` với `WITH_V585=1` | đạt |
| Phát lại lịch sử Facebook thật, bản chép 16/11 | 1.171 dòng khớp, 7 khác đã chốt, 0 khác chưa giải thích |
| Kịch bản sự cố Facebook mặc định / như production (V575, V576; 20 hạt giống) | 182 / 1.108 cú gửi, không vi phạm bất biến nào |
| Kịch bản engine Facebook + lặp lại (`--skip-general`) | 37 lượt, 179 lần gửi, 0 vi phạm |
| Kịch bản engine đủ phần trên DB như production tối 19/11 (V561, V564, V571, V575, V576, V585) | 532 lượt, 2.981 lần gửi, 0 vi phạm mới, 1 đã biết |
| Phát lại Up tin 21 ngày thật | bài trùng câu 56,0% → 13,1% |

**Bốn bước lỗi:**

- `server-rest-smoke`: lỗi của script kiểm, do #724.
  - Script lấy nguyên văn thân `sleepBetweenTargets` rồi chạy trong VM với đồng hồ giả, chỉ cấp `Date` và `setTimeout`. Từ #724 thân hàm gọi `monotonicNow()`, nên VM báo `monotonicNow is not defined`.
  - Chạy lại bản sao script có thêm `monotonicNow` theo đồng hồ giả: 19/19 đạt.
  - Bản sửa script nằm ở nhánh riêng `claude/server-rest-smoke-monotonic`, không vào bản build.
- `ai-chat-images-ui-smoke`: lỗi môi trường. Script dùng Chromium riêng của Playwright (chưa tải trên máy build) và chỉ nhận đường dẫn Chrome qua `AI_CHAT_UI_CHROMIUM`. Chạy lại với `AI_CHAT_UI_CHROMIUM=<Chrome>`: 8 nhóm đạt.
- `zalo-message-status-sync`: hỏng giống hệt 9.7.0 → 10.0.0. Lỗi có từ nhánh #672; tính năng đang tắt, V525/V526 chưa apply.
- Phát lại Facebook bằng bản chép 18/11: 1.138 dòng khớp, 2 khác chưa giải thích như 10.0.0. Hai chỗ đã ghi ở [docs/ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md](../../ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md).

**Manifest đầu vào build:** 1.629 file (file Git theo dõi dưới `src/`, `scripts/`, `build/`, `packages/` và 9 file cấu hình gốc). Chụp trước và sau build, cả hai cùng sha256 `c66a186d…`; cây làm việc sạch suốt quá trình.

**Desktop** (script hậu kiểm của 10.0.0, đổi số bản, đổi bản đối chứng và thêm dấu kiểm của PR mới)

- **Version:** `resources/version.txt` (updater đọc file này) và `package.json` trong ASAR đều là 10.1.0 ở cả ba bản.
  - Windows: PE FileVersion / ProductVersion dạng số là `(10<<16)+1` (655361) ở cả app (`8664`) lẫn installer (`14c`).
  - Chuỗi FileVersion là 10.1.0; chuỗi ProductVersion là 10.1.0 (installer) và 10.1.0.0 (app).
  - Mac: `CFBundleShortVersionString` và `CFBundleVersion` là 10.1.0, identity `com.akabiz.auto`.
- **Mã đóng gói:** 108 file `out/` trong ASAR giống hệt bản build, ở cả ba bản. Mỗi bản kiểm 49 dấu.
  - Dấu giữ từ 9.9.0 và toàn bộ 25 dấu mới của 10.0.0 vẫn còn. Main không còn gọi `aka_agent_zalo_server_on_fly_v1` (V498).
  - 10 dấu mới (7 trong main, 3 trong renderer), mỗi PR có app đổi ít nhất hai dấu:
    - #720: `Failed to look up Zalo UID owner`, `otherAccountOutcome`;
    - #721: câu "Facebook đang yêu cầu nhập mã xác minh cho tài khoản này" và nhãn menu;
    - #722: `AKA_AGENT_AI_CHAT_IMAGE_API_URL`, `AI_CHAT_DESKTOP_IMAGE_PATH`, hai câu giao diện ảnh đính kèm;
    - #724: `createBlockDate`, `monotonicDeadline`.
  - Cả 10 dấu không có trong bộ cài 10.0.0 đang trên feed (đọc từ `app.asar` của `dist/build-10.0.0/akaAgent-Setup-10.0.0.exe`, sha256 `3c1f8714…`).
- **Quét secret** trên toàn bộ file đóng gói, tính cả `app.asar`: 627 file bản Windows, 631 file mỗi bản Mac. Không có JWT `service_role`/anon (kể cả anon cũ), `sb_secret_` hay resource `server-private`.
- **Windows:** payload giải nén từ installer khớp `win-unpacked` (`akaAgent.exe`, `app.asar`, `version.txt`, `better_sqlite3.node`).
- **Mac:**
  - Kiến trúc executable và file `.node` đúng (arm64 / x86_64).
  - `codesign --verify --deep --strict` đạt (ký ad-hoc).
  - Electron trong app nạp được better-sqlite3 và chạy truy vấn đạt; bản Intel chạy qua Rosetta.
  - `hdiutil verify` đạt; mount read-only thì `app.asar` và executable khớp app.

**Module native:** module SQLite gốc của worktree và của repo chính giữ checksum `ced697fc…`.

**Bộ cài cũ:** 69 bộ cài `.exe`/`.dmg` trong `dist/` và `dist-server/` của repo chính giữ nguyên checksum.

**Checkout chính:** không sửa code, không commit, không đổi nhánh. Lúc build checkout chính ở `dev_3` `876218f1`. `CLAUDE.md` của checkout chính có thay đổi chưa commit của nhiều phiên, nên chỉ ghi checksum trước / sau.

**Cài đặt đọc lúc build** (20:08:30 VN, một câu SELECT chỉ đọc qua Supabase MCP):

- `desktop.updates.startup_prompt_max_version`: NULL, tức hộp cập nhật hiện lúc khởi động cho mọi phiên bản.
- `desktop.sleep_guard`: chưa có dòng (mặc định Mac bật, Windows tắt, 10 phút).
- `engine.facebook`: `{"mode":"all"}`; `engine.target_check`: `mode: all`; `engine.error_watch`: `enabled`, `enqueue` bật, `fire` và `imageRequests` tắt.
- `campaign.repeat_after_completion`: `{"audience":"all","sweeper":true}`; `ai_chat.enabled`: `true`.
- `facebook.max_comments`: 20; `facebook.block_hang_minutes`: 10; `campaign.wait_note_minutes`: 10; `facebook.error_signs` md5 `797af974…` (bản V575).
- `renewal.reminder`: `{"audience":"all","bell":true,"legacyBanner":true}`; `affiliate.program`: `audience: all`.
- `zalo.campaign_engagement.enabled`: `true`; `zalo.message_status_sync.enabled`: chưa có dòng.
- Sổ migration tới V588. Danh sách đủ ở receipt.

## Giới hạn

- Windows chưa ký Authenticode, chưa cài hay chạy trên Windows thật.
- Mac ký ad-hoc, chưa notarize; bản Intel chỉ thử qua Rosetta.
- Chưa chạy luồng đăng nhập, chiến dịch hay Facebook / Zalo thật trên bộ cài này.
- #724 chưa thử trên Windows thật bị đổi giờ. Đã kiểm bằng smoke đồng hồ giả (có bản đối chứng code cũ vẫn treo) và bộ kịch bản sự cố.
- Câu lỗi Fanpage ở block (#721) cần V582. V582 chưa apply và phải đổi số.
- DAT02–DAT04 trên Desktop chỉ kiểm bằng smoke trên PG17; chưa gặp lượt 114 thật sau khi phát hành.
- App Server không build lại (giữ 9.7.0).

[Receipt](build-receipt.json).

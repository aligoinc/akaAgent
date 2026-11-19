# Build akaAgent Desktop 10.1.0 — 19/11/2026 (build lại lần 2)

Đã build lại ba bộ cài Desktop 10.1.0 (Windows x64, macOS ARM64, macOS Intel x64). Lý do: PR #726 merge vào `dev_3` lúc 20:09 VN, sau khi nhánh build lần 1 đã cắt. #726 là đợt 2 kiểm lỗi Facebook, có mục "Lỗi không xác định" cho admin akaBiz. Không build App Server.

**Bộ cài lần 1 (nền `f31c8e7f`, 20:23–20:26 VN) đã bị thay, không phát hành.** Bộ cài lần 1 giữ ở `dist/build-10.1.0-r1-f31c8e7f/` của repo chính, thông tin ở mục [Lần build 1 (đã thay)](#lần-build-1-đã-thay).

**Nguồn (lần 2)**

- Worktree `.claude/worktrees/release-10.1.0`, nhánh `codex/release-10.1.0-r2`, source commit `a195d29d96fdab989ce316fa763ddadff2bbb74d`.
- Commit này chỉ đổi version 10.0.0 → 10.1.0 ở `package.json`, `package-lock.json` (hai chỗ của gói gốc) và `version.txt`. Nó là cherry-pick của commit version lần 1 (`930f85fc`).
- Nền là `origin/dev_3` `f778ffa91eb0207856e1838e5f01dfc76edfb151`, sau PR #726.
- Dependency cài sạch bằng `npm ci` trong worktree, xong lúc 20:39:34 VN. `better-sqlite3` dựng lại cho Electron arm64, checksum `ced697fc…`, trùng repo chính.

**Thời điểm build lần 2:** 20:54:28–20:57:39 VN, 19/11/2026. Windows 82 giây, Mac ARM64 54 giây, Mac Intel 55 giây.

**Phát hành:** chưa upload, chưa đổi feed; anh tự phát hành. Bước build không đổi DB, không deploy service.

Lên 10.1.0 không đổi cách so phiên bản. Updater so từng phần bằng số, và đã kiểm khi lên số chính 10 ở [10.0.0](../akaagent-10.0.0-20261118/README.md). PE FileVersion là `(10<<16)+1`.

Sau khi cắt nhánh lần 2, `dev_3` nhận thêm #728 lúc 20:54 VN. PR này chỉ sửa script kiểm `server-rest`, không đổi code app.

## Có gì mới

So với 10.0.0 (`fad8c14f`, bản đang trên feed) có PR #720–#726. Phần chạy trong app:

- **Mới ở lần 2: mục "Lỗi không xác định" trong menu tài khoản** (#726; V588 đã apply 19/11).
  - Chỉ admin akaBiz thấy mục này.
  - Hộp thoại liệt kê các ca lỗi engine Facebook chưa phân loại, cùng kết luận và câu cho khách mà phiên Claude Code trên cloud đề xuất.
  - Admin duyệt câu, duyệt mã lỗi đề xuất hoặc bỏ duyệt. Hộp thoại gọi một kênh IPC `engine-error-review:call` tới RPC `aka_agent_engine_error_review`.
  - DB chưa có hàm thì hộp thoại báo "đang được cập nhật".
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

## App Server: không build lại

Gói App Server gồm 247 file nguồn (đồ thị import từ `src/server/{main,preload,renderer}`, theo [build-01](../../agents/reference/build-01.md)). Có 50 file đổi kể từ Server 9.7.0 (`17d94bde`), 9 file đổi sau 10.0.0, và 0 file đổi sau lần 1: #726 không chạm gói Server. 9 file đổi sau 10.0.0:

- `packages/campaign-engine/src/zalo/messagePhone.ts`, `src/main/engineAdapters/desktopZaloPort.ts`, `src/main/data/repositories/accountContactRepository.ts` (#720): engine v2 chỉ tạo khi `runtimeTarget === 'desktop'`. Hàm tra tài khoản sở hữu UID chỉ cổng Desktop gọi.
- `src/main/engineAdapters/facebook/pageTrace.ts` (#724) và phần Facebook của `contactLoader.ts` (#721): App Server không chạy Facebook.
- `campaignScheduler.ts`, `contactLoader.ts`, `blockExecutor.ts`, `pageController.ts`, `src/shared/monotonicNow.ts` (#724) có chạy trên App Server (nghỉ giữa hai data, kiểm điều khiển Zalo Server khi đang nghỉ, code block, chờ của quét data).
  - Khi đồng hồ máy không bị chỉnh, khoảng chờ đo bằng đồng hồ đơn điệu bằng khoảng đo bằng giờ máy.
  - VPS lấy giờ từ máy chủ, nên hành vi không đổi.

Anh chỉ yêu cầu build Desktop. App Server trên VPS giữ bản 9.7.0.

## Bộ cài (lần 2)

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-10.1.0/akaAgent-Setup-10.1.0.exe` | 153319824 | `0b21f05e6f303e9157bd49c219097a0d48d623d2b2b175faff3f9988283f8588` |
| macOS ARM64 | `dist/build-10.1.0/akaAgent.dmg` | 183058547 | `b13d2b29df2789d5787ffa5c34584782f8573ea2d576fd6c194fd986c1465878` |
| macOS Intel x64 | `dist/build-10.1.0/akaAgentIntel.dmg` | 190238614 | `42e977e4c80988344bbf4c2c5859658a9b3d8eab868e66760af4d89775e7dcb9` |

Đường dẫn tính từ repo chính `/Users/lequangnhut/Repos/akaAgent`:

- `dist/build-10.1.0/` chứa bộ cài lần 2, `SHA256SUMS`, file `.sha256` của từng bộ cài và receipt.
- `dist/build-10.1.0-work/` chứa log, file kiểm và script của lần 2. Bằng chứng lần 1 chuyển vào thư mục con `r1-f31c8e7f/`, gồm cả log deploy `worker` ChatApi (`r1-f31c8e7f/chatapi-worker-deploy/`).
- `dist/build-10.1.0-r1-f31c8e7f/` chứa bộ cài lần 1 (không xoá, không phát hành).

Không đưa bộ cài vào Git. Bản gốc trong worktree còn tới khi dọn worktree.

## Kiểm chứng (lần 2)

**Mã nguồn.** Hai typecheck không lỗi. 69/72 bước kiểm đạt; 3 bước lỗi đều đã biết, không do bản build.

| Nhóm | Kết quả |
| --- | --- |
| Toàn bộ chuỗi kiểm của 10.0.0: smoke 9.9.0, `campaign-outcome-engine-check-all`, engine Facebook (13 smoke), Up tin, quản trị viên group, PR chỉ đổi DB (V571–V576) | đạt, trừ 3 bước ở dưới |
| `campaign-outcome-engine-check-all` (gồm smoke V581 của #720) | 34 bước đạt |
| #720: `campaign-outcome-engine-v581-smoke` | đạt |
| #721: `facebook-business-token-v582-smoke` (V582 trên PG17, bản gỡ) | đạt |
| #722: `ai-chat/desktop_image_smoke.sh`, `ai-chat/edge_agent_image_smoke.mjs`, `run-ai-chat-images-ui-smoke` (với `AI_CHAT_UI_CHROMIUM=<Chrome>`) | đạt |
| #724: `engine-v2-facebook/clock-rollback-smoke` | đạt |
| #725: `engine-v2-multi-slot-array-v585-smoke`, `campaign-repeat-v561-smoke` với `WITH_V585=1` | đạt |
| #726: `engine-v2-facebook/error-review-v588-smoke`, `run-engine-error-review-ui-smoke` (hộp thoại thật, IPC giả lập), `error-watch-smoke`, `error-watch-agent-smoke` | đạt |
| Phát lại lịch sử Facebook thật, bản chép 16/11 | 1.171 dòng khớp, 7 khác đã chốt, 0 khác chưa giải thích |
| Kịch bản sự cố Facebook mặc định / như production (V575, V576; 20 hạt giống) | 182 / 1.108 cú gửi, không vi phạm bất biến nào |
| Kịch bản engine Facebook + lặp lại (`--skip-general`) | 37 lượt, 179 lần gửi, 0 vi phạm |
| Kịch bản engine đủ phần trên DB như production tối 19/11 (V561, V564, V571, V575, V576, V585) | 532 lượt, 2.981 lần gửi, 0 vi phạm mới, 1 đã biết |
| Phát lại Up tin 21 ngày thật | bài trùng câu 56,0% → 13,1% |

**Ba bước lỗi:**

- `server-rest-smoke`: lỗi của script kiểm, do #724.
  - Script chạy nguyên văn thân `sleepBetweenTargets` trong VM, chỉ cấp `Date` và `setTimeout`. Từ #724 thân hàm gọi `monotonicNow()`.
  - Bản sửa script merge `dev_3` qua #728 (`310f53f1`) lúc 20:54 VN, sau khi cắt nhánh lần 2.
  - Chạy lại script của #728 trên mã nguồn lần 2: 19/19 đạt.
- `zalo-message-status-sync`: hỏng giống hệt 9.7.0 → 10.0.0. Lỗi có từ nhánh #672; tính năng đang tắt, V525/V526 chưa apply.
- Phát lại Facebook bằng bản chép 18/11: 1.138 dòng khớp, 2 khác chưa giải thích như 10.0.0. Hai chỗ đã ghi ở [docs/ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md](../../ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md).

**Manifest đầu vào build:** 1.638 file (file Git theo dõi dưới `src/`, `scripts/`, `build/`, `packages/` và 9 file cấu hình gốc). Chụp trước và sau build, cả hai cùng sha256 `99e95072…`; cây làm việc sạch suốt quá trình.

**Desktop** (script hậu kiểm của lần 1, thêm dấu kiểm của #726)

- **Version:** `resources/version.txt` (updater đọc file này) và `package.json` trong ASAR đều là 10.1.0 ở cả ba bản.
  - Windows: PE FileVersion / ProductVersion dạng số là `(10<<16)+1` (655361) ở cả app (`8664`) lẫn installer (`14c`).
  - Chuỗi FileVersion là 10.1.0; chuỗi ProductVersion là 10.1.0 (installer) và 10.1.0.0 (app).
  - Mac: `CFBundleShortVersionString` và `CFBundleVersion` là 10.1.0, identity `com.akabiz.auto`.
- **Mã đóng gói:** 108 file `out/` trong ASAR giống hệt bản build, ở cả ba bản. Mỗi bản kiểm 53 dấu.
  - Dấu giữ từ 9.9.0 và toàn bộ 25 dấu mới của 10.0.0 vẫn còn. Main không còn gọi `aka_agent_zalo_server_on_fly_v1` (V498).
  - 14 dấu mới (9 trong main, 5 trong renderer), mỗi PR có app đổi ít nhất hai dấu:
    - #720: `Failed to look up Zalo UID owner`, `otherAccountOutcome`;
    - #721: câu "Facebook đang yêu cầu nhập mã xác minh cho tài khoản này" và nhãn menu;
    - #722: `AKA_AGENT_AI_CHAT_IMAGE_API_URL`, `AI_CHAT_DESKTOP_IMAGE_PATH`, hai câu giao diện ảnh đính kèm;
    - #724: `createBlockDate`, `monotonicDeadline`;
    - #726: `engine-error-review:call`, `aka_agent_engine_error_review`, hai câu của hộp thoại.
  - Cả 14 dấu không có trong bộ cài 10.0.0 đang trên feed (đọc từ `app.asar` của `dist/build-10.0.0/akaAgent-Setup-10.0.0.exe`, sha256 `3c1f8714…`).
  - 4 dấu của #726 cũng không có trong bộ cài lần 1 (đọc từ `app.asar` của lần 1, chép ra trước khi build lại).
- **Quét secret** trên toàn bộ file đóng gói, tính cả `app.asar`: 627 file bản Windows, 631 file mỗi bản Mac. Không có JWT `service_role`/anon (kể cả anon cũ), `sb_secret_` hay resource `server-private`.
- **Windows:** payload giải nén từ installer khớp `win-unpacked` (`akaAgent.exe`, `app.asar`, `version.txt`, `better_sqlite3.node`).
- **Mac:**
  - Kiến trúc executable và file `.node` đúng (arm64 / x86_64).
  - `codesign --verify --deep --strict` đạt (ký ad-hoc).
  - Electron trong app nạp được better-sqlite3 và chạy truy vấn đạt; bản Intel chạy qua Rosetta.
  - `hdiutil verify` đạt; mount read-only thì `app.asar` và executable khớp app.

**Module native:** module SQLite gốc của worktree và của repo chính giữ checksum `ced697fc…`.

**Bộ cài cũ:** 72 bộ cài `.exe`/`.dmg` trong `dist/` và `dist-server/` của repo chính giữ nguyên checksum, gồm 3 bộ cài lần 1 trong `dist/build-10.1.0-r1-f31c8e7f/`.

**Checkout chính:** không sửa code, không commit, không đổi nhánh. Lúc build lần 2 checkout chính ở `dev_3` `876218f1`. `CLAUDE.md` của checkout chính có thay đổi chưa commit của nhiều phiên, nên chỉ ghi checksum trước / sau.

**Cài đặt đọc lúc build lần 2** (20:40:56 VN, một câu SELECT chỉ đọc qua Supabase MCP; giống hệt lần 1 lúc 20:08:30 VN):

- `desktop.updates.startup_prompt_max_version`: NULL, tức hộp cập nhật hiện lúc khởi động cho mọi phiên bản.
- `desktop.sleep_guard`: chưa có dòng (mặc định Mac bật, Windows tắt, 10 phút).
- `engine.facebook`: `{"mode":"all"}`; `engine.target_check`: `mode: all`; `engine.error_watch`: `enabled`, `enqueue` bật, `fire` và `imageRequests` tắt.
- `campaign.repeat_after_completion`: `{"audience":"all","sweeper":true}`; `ai_chat.enabled`: `true`.
- `facebook.max_comments`: 20; `facebook.block_hang_minutes`: 10; `campaign.wait_note_minutes`: 10; `facebook.error_signs` md5 `797af974…` (bản V575).
- `renewal.reminder`: `{"audience":"all","bell":true,"legacyBanner":true}`; `affiliate.program`: `audience: all`.
- `zalo.campaign_engagement.enabled`: `true`; `zalo.message_status_sync.enabled`: chưa có dòng.
- Sổ migration tới V588. Danh sách đủ ở receipt.

## Lần build 1 (đã thay)

- **Nguồn:** nhánh `codex/release-10.1.0` (PR #727), source commit `930f85fc03d78c023c0759f5ffe9e41f7002f93c` (chỉ đổi version), nền `origin/dev_3` `f31c8e7fc5d14f3ad8711e73ae6275ce473fb6dc` sau PR #725.
- **Thời điểm build:** 20:23:50–20:26:56 VN, 19/11/2026.
- **Vì sao thay:** #726 merge vào `dev_3` lúc 20:09 VN, khi nhánh lần 1 đã cắt; lần 1 không có mục "Lỗi không xác định". Phần còn lại giống lần 2.
- **Bộ cài lần 1** (chuyển sang `dist/build-10.1.0-r1-f31c8e7f/`, không xoá, không phát hành):

  | Nền tảng | File | Bytes | SHA-256 |
  | --- | --- | ---: | --- |
  | Windows x64 | `akaAgent-Setup-10.1.0.exe` | 153302904 | `9c65ee6b8bc725485f595444bd6a97832451070cc5bf77cea972397b9861a96e` |
  | macOS ARM64 | `akaAgent.dmg` | 183065455 | `476c523cd1a274a5796ccabdb9a8cd81886d66811be92934fa1cb3f54f626fb3` |
  | macOS Intel x64 | `akaAgentIntel.dmg` | 190211737 | `3765b6097eacdc18826bc4f026f0a4e6d47400cf1f8890f592f1044c1cc5181b` |

- **Kiểm chứng lần 1:** 66/70 bước kiểm đạt; manifest 1.629 file giống hệt trước / sau build (`c66a186d…`); hậu kiểm ba bộ cài đạt (version, 108 file `out/`, 49 dấu, quét secret, payload NSIS / DMG, SQLite).
  - Bốn bước lỗi: ba bước như lần 2.
  - Bước thứ tư là `ai-chat-images-ui-smoke`: script dùng Chromium riêng của Playwright, chưa tải trên máy build. Chạy lại với `AI_CHAT_UI_CHROMIUM=<Chrome>` thì đạt 8 nhóm; lần 2 đặt sẵn biến này.
- **Bằng chứng lần 1:** `dist/build-10.1.0-work/r1-f31c8e7f/` của repo chính. Tóm tắt lần 1 cũng nằm trong receipt, khoá `rebuild.replaces_round_1`.

## Giới hạn

- Windows chưa ký Authenticode, chưa cài hay chạy trên Windows thật.
- Mac ký ad-hoc, chưa notarize; bản Intel chỉ thử qua Rosetta.
- Chưa chạy luồng đăng nhập, chiến dịch hay Facebook / Zalo thật trên bộ cài này.
- #724 chưa thử trên Windows thật bị đổi giờ. Đã kiểm bằng smoke đồng hồ giả (có bản đối chứng code cũ vẫn treo) và bộ kịch bản sự cố.
- Mục "Lỗi không xác định" (#726) chỉ kiểm bằng smoke giao diện với IPC giả lập và smoke V588 trên PG17. Chưa mở trong Electron thật với DB thật.
- Câu lỗi Fanpage ở block (#721) cần V582. V582 chưa apply và phải đổi số.
- DAT02–DAT04 trên Desktop chỉ kiểm bằng smoke trên PG17; chưa gặp lượt 114 thật sau khi phát hành.
- App Server không build lại (giữ 9.7.0).

[Receipt](build-receipt.json).

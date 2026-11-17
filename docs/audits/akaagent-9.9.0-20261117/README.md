# Build akaAgent Desktop 9.9.0 — 17/11/2026

Đã build local ba bộ cài Desktop: Windows x64, macOS ARM64, macOS Intel x64. Không build App Server.

**Nguồn**

- Worktree `.claude/worktrees/release-9.9.0`, nhánh `codex/release-9.9.0`, source commit `c6d417910f052264903bfb5771890ce50e3cee58`.
- Nền là `origin/dev_3` tại `0ca740cf5490ef1e3633a23558e221b2d7d8d0d0`, sau PR #693.
- Commit build chỉ đổi version trong `package.json`, `package-lock.json`, `version.txt`.
- Dependency cài sạch bằng `npm ci` trong worktree, 21:03:26–21:03:38 VN. `better-sqlite3` được dựng lại cho Electron arm64; checksum `ced697fc…`, trùng repo chính.

**Thời điểm build:** 21:09:22–21:12:42 VN, 17/11/2026. Windows mất 89 giây, Mac ARM64 57 giây, Mac Intel 54 giây.

**Chưa phát hành:** chưa upload; feed cả ba nền tảng vẫn trả 9.7.0 (9.8.0 build ngày 16/11 cũng chưa phát hành). Bước build không đổi DB, không deploy service. Cùng tối, ngoài bước build: V563 đã apply lúc 20:03 VN, worker ChatApi đã deploy lúc 20:59 VN (đồng bộ lõi engine, ChatApi #163).

## Có gì mới

So với 9.8.0 (`7707bacc`) có các PR #689–#693. Phần chạy trong app:

- **Engine v2 cho chiến dịch Facebook** (#690).
  - Cả 13 loại chiến dịch Facebook chạy bằng engine khi tổ chức nằm trong thiết lập `engine.facebook`. Lúc build thiết lập này chỉ có tổ chức 1, nên các tổ chức khác chạy bộ cũ như 9.8.0.
  - Desktop đọc thiết lập lúc đăng nhập; đổi danh sách tổ chức thì nhân viên phải đăng nhập lại.
  - DB V556–V560 đã apply 17/11. V563 (#693) sửa riêng block / chính sách của engine (comment đúng bài, câu ⚠️ khi chưa lấy được link, FB11, tìm nhóm giao diện tiếng Anh, comment không làm dừng chiến dịch đăng nhóm), chỉ là dữ liệu DB, đã apply 20:03 VN 17/11.
  - Đã thử thật 17/11 bằng app chạy từ nhánh (không phải bộ cài này): 13 loại, kể cả đăng nhóm bằng Page.
- **Áp cho mọi khách dùng 9.9.0, kể cả tổ chức chưa bật engine Facebook:**
  - Form chiến dịch Facebook giới hạn "Số comment tối đa" / "Số bài cần comment" theo `facebook.max_comments` (lúc build là 20; sửa ở DB, không cần phát hành).
  - AutoCheck: tài khoản Facebook đang "checkpoint" chỉ được nâng về "đã đăng nhập" khi hỏi thẳng Facebook thấy đã qua xác minh, tối đa 5 phút một lần. Trước đây cookie `c_user` còn là nâng nhầm.
  - Presence gọi `aka_agent_device_presence_v2` (có từ V556; DB chưa có thì quay về bản cũ) để nhận yêu cầu lấy ảnh lỗi engine.
  - Hook của engine trong `workflowEngine` / `pageController` / `blockHelpers` dùng chung với bộ cũ; khi chiến dịch chạy bộ cũ thì không có hook nào, hành vi bộ cũ giữ nguyên (smoke `workflow-hooks`, phát lại lịch sử thật).
- **Lặp lại sau khi chạy xong** (#689 form, #691 bộ chạy cũ, #692 kiểm thử; V561 đã apply).
  - Form có nhóm cài đặt "Lặp lại sau khi chạy xong" khi `campaign.repeat_after_completion` mở cho tài khoản. Lúc build là `audience: admin_akabiz`, nên khách thường chưa thấy.
  - Bộ chạy cũ Desktop gọi `aka_agent_campaign_repeat_decide_v1`; engine Desktop in câu "Đã chạy xong lượt i/n". Chi tiết chiến dịch hiện hai dòng cài đặt.
  - Số lượt đã chạy chưa hiện trên Desktop (Web có): hàm `getCampaignRepeatStates` (`aka_agent_campaign_repeat_state_v1`) chưa có nơi gọi nên không vào bản build.

## App Server: không build lại

Gói App Server gồm 241 file nguồn (đồ thị import từ `src/server/{main,preload,renderer}`, theo [build-01](../../agents/reference/build-01.md)). Có 36 file đổi kể từ Server 9.7.0 (`17d94bde`), gồm 12 file đã xét ở 9.8.0. Không thay đổi nào làm khác hành vi trên đường Zalo Server:

- `campaignScheduler.ts`:
  - Engine chỉ tạo khi `runtimeTarget === 'desktop'`.
  - `writeCampaignDetail` chỉ chuyển kết quả sang engine khi có chiến dịch Facebook đang chạy bằng engine; ngoài ra gọi đúng `createCampaignDetail` như trước.
  - Lặp lại sau khi chạy xong bỏ qua `runtimeTarget === 'server'`; App Server dựa vào bộ quét trong DB như tài liệu V561.
- `workflowEngine.ts`, `pageController.ts`, `blockHelpers.ts`, `src/main/engineAdapters/**`, `packages/campaign-engine/**`: chạy Facebook / webview hoặc engine; App Server không chạy cả hai.
- `supabase.ts`, `campaignRepository.ts`, `campaignRepeatRepository.ts`: chỉ thêm hàm (ghi lại ghi chú dừng của engine, quyết định / đăng ký lặp), App Server không gọi.
- `desktopUiRepository.ts`, `src/shared/desktopUiReads.ts`, `src/shared/types.ts`, `src/shared/v2Types.ts`, `src/shared/campaignRepeat.ts`, `campaignPendingReasonService.ts`: cài đặt giao diện, kiểu dữ liệu, nút "Lý do đang chờ" của Desktop.

Anh chỉ yêu cầu build Desktop. App Server trên VPS giữ bản 9.7.0.

## Bộ cài

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-9.9.0/akaAgent-Setup-9.9.0.exe` | 153288365 | `15bd1b2ea7dc7147f8887b2cf1732e4105b5116b17cb7e6369c12688282de0b6` |
| macOS ARM64 | `dist/build-9.9.0/akaAgent.dmg` | 183047219 | `9e5c3f9e0278bf9106efe27c8e7a02a02d7e36bd7b7669cf3cbe4b5c973021d7` |
| macOS Intel x64 | `dist/build-9.9.0/akaAgentIntel.dmg` | 190194376 | `a4a72acca4b3c37551881b365bb8b46b4dcafb2ce94d9e6afcebd89be3852457` |

Đường dẫn tính từ repo chính `/Users/lequangnhut/Repos/akaAgent`:

- `dist/build-9.9.0/` chứa bộ cài, `SHA256SUMS`, file `.sha256` của từng bộ cài và receipt.
- `dist/build-9.9.0-work/` chứa log, file kiểm và các script.

Không đưa bộ cài vào Git. Bản gốc trong worktree còn tới khi dọn worktree.

## Kiểm chứng

**Mã nguồn**

- Hai typecheck không lỗi.
- 37/39 bước kiểm đạt (gồm hai typecheck): toàn bộ smoke của 9.8.0 và smoke của các PR mới.

  | Nhóm | Kết quả |
  | --- | --- |
  | Smoke của 9.8.0 (ảnh chụp runtime, giảm đọc giao diện, gửi lặp lại, request App Server, dừng listener, lệch giờ phiên, hạn giờ media, bộ chạy engine Desktop, nhắc gia hạn, đối chiếu nhóm data, nơi chạy Server, `chatSync`, bộ lọc Kết quả chạy service + giao diện) | đạt |
  | `campaign-outcome-engine-check-all` | 33 bước đạt |
  | Lặp lại: bộ chạy (`campaign-repeat-scheduler-smoke`) 29 ca, SQL V561 9 nhóm, form trong Electron 8 ca, e2e bộ chạy cũ + bộ quét 4 nhóm | đạt |
  | Engine Facebook: sql, copy, core, error-signs, policy-parity, legacy-catalog, v563 (code block chạy trong Chromium), desktop-fb, workflow-hooks, page-trace, screenshots, autocheck, wait-reason | đạt |
  | Phát lại lịch sử Facebook thật (`replay.cjs`, chỉ đọc) | 1.168 dòng khớp, 10 khác đã chốt, 0 khác chưa giải thích |
  | Kịch bản sự cố Facebook (`scenarios.cjs`) | không vi phạm bất biến nào |
  | Kịch bản engine có Facebook + lặp lại (`engine-v2-scenarios/run.cjs --skip-general`) | 37 lượt, 179 lần gửi, 0 vi phạm |

- **Hai smoke lỗi, đều không phải lỗi của app:**
  - `zalo-message-status-sync`: hỏng giống hệt 9.7.0 / 9.8.0 (so log bỏ đường dẫn: trùng từng dòng). Lỗi có từ nhánh #672; tính năng đang tắt, V525/V526 chưa apply.
  - `aff-partner-desktop-smoke`: lúc build đạt 7/8 nhóm. Nhóm còn lại dò câu đọc cài đặt bằng regex đòi khoá `affiliate.program` đứng cuối danh sách; #690 thêm `facebook.max_comments` sau nó. Khoá vẫn nằm trong cùng câu đọc (`desktopUiRepository.ts` dòng 38), không thêm request. Đã sửa regex ở commit sau build trên nhánh release (kiểm khoá nằm trong mảng `.in('key', [...])` và chỉ có một câu đọc `auto_system_settings`; thử bỏ khoá thì smoke hỏng); chạy lại 8/8.

**Manifest đầu vào build**

- 1.556 file: các file Git theo dõi dưới `src/`, `scripts/`, `build/`, `packages/` và 9 file cấu hình gốc.
- Chụp trước build và sau build, cả hai cùng sha256 `c86d7a6f…`. Cây làm việc sạch suốt quá trình (sửa regex smoke làm sau khi chụp manifest sau build).

**Desktop** (script hậu kiểm của 9.8.0, đã đổi đường dẫn, số bản và dấu kiểm)

- **Version:** `resources/version.txt` (updater đọc file này) và `package.json` trong ASAR đều là 9.9.0 ở cả ba bản.
  - Windows: PE FileVersion/ProductVersion 9.9.0 (app `8664`, installer `14c`).
  - Mac: `CFBundleShortVersionString` 9.9.0, identity `com.akabiz.auto`.
- **Mã đóng gói:** 108 file `out/` trong ASAR giống hệt bản build, ở cả ba bản.
  - Main có đủ dấu của bản này: `aka_agent_engine_facebook_enabled_v1`, `engine-facebook-identity`, `aka_agent_campaign_repeat_decide_v1`, `aka_agent_campaign_repeat_sync_v1`, cùng dấu của 9.8.0.
  - Main không còn gọi `aka_agent_zalo_server_on_fly_v1` (V498).
  - Lần hậu kiểm đầu báo thiếu `aka_agent_campaign_repeat_state_v1`: hàm này chưa có nơi gọi trên Desktop nên không vào bản build (đúng tài liệu V561). Đã bỏ dấu này rồi chạy lại.
- **Quét secret** trên toàn bộ file đóng gói, tính cả `app.asar`: 627 file bản Windows, 631 file mỗi bản Mac. Không có JWT `service_role`/anon (kể cả anon cũ), `sb_secret_` hay resource `server-private`.
- **Windows:** payload giải nén từ installer khớp `win-unpacked` (`akaAgent.exe`, `app.asar`, `version.txt`, `better_sqlite3.node`).
- **Mac:**
  - Kiến trúc executable và file `.node` mỗi bản đều đúng (arm64 / x86_64).
  - `codesign --verify --deep --strict` đạt (ký ad-hoc).
  - Electron trong app nạp được better-sqlite3 và chạy truy vấn đạt; bản Intel chạy qua Rosetta.
  - `hdiutil verify` đạt; mount read-only thì `app.asar` và executable khớp app.

**Module native:** module SQLite gốc của worktree và của repo chính giữ checksum `ced697fc…`.

**Bộ cài cũ:** 60 bộ cài `.exe`/`.dmg` trong `dist/` và `dist-server/` của repo chính giữ nguyên checksum.

**Cài đặt đọc lúc build** (21:04:44 VN):

- `engine.facebook`: `{"mode":"orgs","organizationIds":[1]}`.
- `campaign.repeat_after_completion`: `{"audience":"admin_akabiz","sweeper":true}`.
- `facebook.max_comments`: 20; `facebook.block_hang_minutes`: 10; `campaign.wait_note_minutes`: 10; `facebook.error_signs` md5 `7e25dd65…` (bản V563).
- `renewal.reminder`: `{"audience":"all","bell":true,"legacyBanner":true}`.
- `affiliate.program`: `audience: all`.
- `desktop.updates.startup_prompt_max_version`: NULL, tức hộp cập nhật hiện lúc khởi động cho mọi phiên bản.
- `zalo.campaign_engagement.enabled`: `true`; `zalo.message_status_sync.enabled`: chưa có dòng.
- Sổ migration có V513, V529, V540, V546, V556–V561, V563.

## Giới hạn

- Windows chưa ký Authenticode, chưa cài hay chạy trên Windows thật. Với 9.6.0 khách từng báo phải tắt bảo vệ thời gian thực của Windows Defender mới cập nhật được.
- Mac ký ad-hoc, chưa notarize; bản Intel chỉ thử qua Rosetta.
- Chưa chạy luồng đăng nhập, chiến dịch hay Facebook / Zalo thật trên bộ cài này. Engine Facebook đã thử thật 17/11 bằng app chạy từ nhánh; các đường chưa thử thật: Page ngoài đăng nhóm, tìm data bằng search, đăng nhóm kèm chia sẻ, newsfeed có like, Up tin tự sinh.
- `server-graph.cjs` chạy từ gốc worktree như [build-01](../../agents/reference/build-01.md) dặn (241 file, 36 đổi).

[Receipt](build-receipt.json).

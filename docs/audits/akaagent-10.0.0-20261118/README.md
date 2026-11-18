# Build akaAgent Desktop 10.0.0 — 18/11/2026

Đã build local ba bộ cài Desktop: Windows x64, macOS ARM64, macOS Intel x64. Không build App Server.

**Nguồn**

- Worktree `.claude/worktrees/release-10.0.0`, nhánh `codex/release-10.0.0`, source commit `8cd8181abb78a7031ffb1ff88d386b35cb5be029`.
- Nền là `origin/dev_3` tại `514d306c8b9d28fa82a7bbaf1aec390a6cdea304`, sau PR #716.
- Commit build chỉ đổi version trong `package.json`, `package-lock.json`, `version.txt` (9.9.0 → 10.0.0).
- Dependency cài sạch bằng `npm ci` trong worktree, 21:19:46–21:19:59 VN. `better-sqlite3` được dựng lại cho Electron arm64; checksum `ced697fc…`, trùng repo chính.

**Thời điểm build:** 21:39:31–21:43:07 VN, 18/11/2026. Windows mất 95 giây, Mac ARM64 62 giây, Mac Intel 59 giây.

**Phát hành:** chưa upload, chưa đổi feed; anh tự phát hành. Lúc 21:46 VN feed cả ba nền tảng còn trả 9.9.0. Bước build không đổi DB, không deploy service.

## Lên số chính 10: đã kiểm trước khi build

Đổi số chính từ 9 lên 10 không làm sai chỗ nào so phiên bản. Mọi chỗ đều tách số theo major.minor.patch rồi so từng phần bằng số, không chỗ nào so chuỗi:

- **Updater** (`src/main/services/updater.ts` dòng 63–117, 191): `normalizeVersion` / `parseVersion` / `compareVersions` so từng phần bằng số. 9.9.0 → 10.0.0 là có bản mới; 10.0.0 → 9.9.0 hay 9.10.0 thì không.
- **Hộp cập nhật lúc khởi động** (`updater.ts` dòng 156–166, ngưỡng `desktop.updates.startup_prompt_max_version`): ngưỡng phải dạng `x.y.z`, so bằng `compareVersions`. Lúc build ngưỡng là NULL, tức hộp hiện cho mọi phiên bản khi có bản mới.
- **Bản đang cài trên máy khách:** mọi bản `updater.ts` từ 07/05/2026 (`b389ed16`) so như trên; bản đầu tiên (22/04/2026) dùng `parseInt` cả chuỗi, 10 vẫn lớn hơn. Máy 9.x, 8.x, 7.x… sẽ thấy 10.0.0 là bản mới.
- **Hộp cập nhật của bản cũ** (`App.tsx` trước 28/09/2026, `SILENT_STARTUP_UPDATE_MIN_VERSION = 6`): chỉ đọc số chính của bản đang cài, bằng số.
- **DB** (V511 `private.aka_agent_proxy_shared_runtime_ready`, `desktopMinVersion`): so mảng số `string_to_array(...)::integer[]`.
- **Đóng gói:** electron-builder và `build/installer.nsh` không so phiên bản; PE FileVersion là `(10<<16)+0`, vừa 16 bit.
- `scripts/`, `packages/`, `resources/`, phần còn lại của `src/`: không có chỗ so phiên bản app.

Chạy thử `updater.ts` thật (đóng gói bằng esbuild, máy chủ phiên bản và DB giả): 10 ca "có bản mới" và 4 ca ngưỡng hộp cập nhật đều đúng. Bài này ở `dist/build-10.0.0-work/00-v10-updater-check.cjs` của repo chính, không đưa vào repo.

`scripts/startup-update-prompt-smoke-test.cjs` đã hỏng từ `321e41fc` (27/10/2026): bản giả chỉ có `.from('auto_system_settings')`, còn repository đọc ngưỡng qua RPC `aka_agent_desktop_startup_policy`. Lỗi của smoke, không liên quan 10.0.0, nên không đưa vào bước kiểm.

## Có gì mới

So với 9.9.0 (`c6d41791`) có các PR #695–#716. Phần chạy trong app:

- **Engine v2 in dòng "🔀 Đã xáo trộn danh sách N group"** (#696). Chiến dịch đăng nhóm bật "Xáo trộn danh sách group" chạy bằng engine in dòng này một lần, ngay sau 🚀, như bộ cũ. Thứ tự xáo do DB quyết định (V564, apply 10:35 VN 18/11), nên máy 9.9.0 đã đăng theo thứ tự xáo, chỉ thiếu dòng này.
- **Dòng "⏸ Chiến dịch "<tên>" đã được tạm dừng."** (#698). Khi chính sách lỗi của engine tạm dừng chiến dịch, lịch sử chạy có thêm dòng này ngay sau dòng lý do. Zalo Server trên Fly chỉ có dòng này khi chép lõi sang ChatApi và deploy `worker`; việc đó không thuộc bước build.
- **Câu lỗi khi quét QR Zalo qua proxy bị từ chối** (#702). Proxy từ chối kết nối (407, 403…) thì báo "Proxy của tài khoản từ chối kết nối tới Zalo (mã N). Vui lòng kiểm tra lại proxy." thay cho "Cannot get API login version". Chỉ ở bước quét QR.
- **Không nhận việc mới khi máy vừa ngủ dậy mà chưa có người dùng** (#707).
  - Khi máy thức tạm (Mac đang ngủ vẫn thức vài giây mỗi ~16 phút), bộ lập lịch không mở lượt mới, engine dừng sau data đang làm.
  - Thôi giữ khi có thao tác, mở khoá màn hình, hoặc máy thức liên tục 10 phút.
  - Công tắc `desktop.sleep_guard`: lúc build chưa có dòng, tức mặc định Mac bật, Windows tắt. Desktop đọc lúc đăng nhập và mỗi 10 phút.
  - Presence báo `runtime_state.sleepHold` khi đang giữ.
- **Tiến trình và mã lỗi engine như bộ cũ** (#709; V575 đã apply 17:08 VN 18/11):
  - dòng lỗi dạng `❌/⚠️ <thao tác> "<data>": <câu> (mã)`, cả Facebook lẫn Zalo;
  - FB45 không làm mất "✅ Hoàn thành"; câu "chạy lại sau N giờ" đúng chữ bộ cũ; "ℹ️ Bỏ qua" khi đăng nhóm kèm chia sẻ bị bỏ qua;
  - nhắn UID "Lấy đề xuất bạn bè" chạy trong engine; newsfeed hằng ngày hết lượt khi bật "Tiếp tục khi chạm giới hạn" thì hoàn thành như bộ cũ;
  - câu FB41 bỏ XPath, bỏ dòng ⚠️ trùng; lỗi tệp theo nguyên nhân: CFG20 khi tệp không còn trên máy, CFG01 khi không tải được.
- **Up tin Facebook** (#711; V531 đã apply 17:32 VN 18/11):
  - các lượt up của một bài lấy câu khác nhau (câu bắt đầu ngẫu nhiên mỗi bài, ghi sẵn vào dòng data);
  - tài khoản up tin đã xoá không nhận lượt, không tạo chiến dịch up tin mới;
  - chiến dịch up tin mới tạo nghỉ 30 giây giữa hai comment, không làm mới data; bảo trì ngày mới lấy lịch theo lượt chờ sớm nhất;
  - bài bị gỡ thì đóng các lượt còn chờ của bài; form hiện câu cảnh báo bài có video; đổi "Nội dung up tin" thì chép sang chiến dịch up tin đã tạo.

Các PR khác chỉ đổi DB (đã apply, có hiệu lực với mọi bản app) hoặc tài liệu: #697 (V568, đã gỡ), #699/#700 (V571 kiểm người nhận), #701 (V572 comment theo mã bài của hộp thoại), #703 (V573 tag Zalo đã xoá trong loại trừ), #708/#710 (V574), #713/#715 (V576 đóng lượt bỏ dở), #695, #704–#706, #712, #714, #716.

## App Server: không build lại

Gói App Server gồm 245 file nguồn (đồ thị import từ `src/server/{main,preload,renderer}`, theo [build-01](../../agents/reference/build-01.md)). Có 44 file đổi kể từ Server 9.7.0 (`17d94bde`), trong đó 18 file đổi sau 9.9.0. Với 18 file này:

- **Chỉ #702 đổi hành vi trên đường Zalo Server:** App Server quét QR tài khoản Server cũng qua `runLoginQr`. Vì không build lại, App Server vẫn báo câu cũ "Cannot get API login version" khi proxy từ chối. Chỉ là câu lỗi; cách kết nối không đổi (bộ đọc mã chỉ gắn ở lượt quét QR).
- `packages/campaign-engine/**`, `desktopZaloPort.ts`, `desktopFacebookRunner.ts`, `errorSigns.ts`: engine v2 chỉ tạo khi `runtimeTarget === 'desktop'`; App Server không chạy engine.
- `campaignScheduler.ts`:
  - bộ giữ khi máy ngủ là tuỳ chọn `startWorkGate`, App Server không truyền;
  - newsfeed, đề xuất bạn bè, Up tin là Facebook, App Server không chạy Facebook.
- `campaignMediaSource.ts`: chỉ thêm trường nguyên nhân lỗi cho engine; bộ cũ vẫn đọc câu lỗi như trước.
- `campaignRepository.ts`, `supabase.ts`, `campaignInputContentRotation.ts`, `postBumpContent.ts`, `types.ts`: phần Up tin; chèn data không mang chỉ số câu thì đi đúng lệnh cũ.
- `systemSettingsRepository.ts`, `systemSleepGuard.ts`: công tắc bộ giữ khi máy ngủ, App Server không gọi.

Anh chỉ yêu cầu build Desktop. App Server trên VPS giữ bản 9.7.0. Muốn App Server có câu lỗi QR mới thì phải build Server riêng.

## Bộ cài

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-10.0.0/akaAgent-Setup-10.0.0.exe` | 153292091 | `e707408565bc23b4f9391c22a5937fd0e5674c7acec37ad5cdd1e70096f4c180` |
| macOS ARM64 | `dist/build-10.0.0/akaAgent.dmg` | 183036128 | `1ab018286ad4e939259ab1ccf4f13f074bf51dc87f932fdfc1de3a81c1d202cc` |
| macOS Intel x64 | `dist/build-10.0.0/akaAgentIntel.dmg` | 190187804 | `6b90fd192b6d22736ec88295a234c82f40f5f85edda0df8da97efb736d0f31dc` |

Đường dẫn tính từ repo chính `/Users/lequangnhut/Repos/akaAgent`:

- `dist/build-10.0.0/` chứa bộ cài, `SHA256SUMS`, file `.sha256` của từng bộ cài và receipt.
- `dist/build-10.0.0-work/` chứa log, file kiểm và các script. Lần này script nằm sẵn ở thư mục này, đường dẫn worktree ghi cứng, log ghi thẳng vào đây.

Không đưa bộ cài vào Git. Bản gốc trong worktree còn tới khi dọn worktree.

## Kiểm chứng

**Mã nguồn**

- Hai typecheck không lỗi.
- 54/57 bước kiểm đạt (gồm hai typecheck): toàn bộ smoke của 9.9.0, smoke của các PR mới, và smoke của các PR chỉ đổi DB.

  | Nhóm | Kết quả |
  | --- | --- |
  | Smoke của 9.9.0 (ảnh chụp runtime, giảm đọc giao diện, gửi lặp lại, request App Server, dừng listener, lệch giờ phiên, hạn giờ media, bộ chạy engine Desktop, nhắc gia hạn, đối chiếu nhóm data, nơi chạy Server, `chatSync`, bộ lọc Kết quả chạy service + giao diện, Đối tác akaBiz, lặp lại sau khi chạy xong) | đạt |
  | `campaign-outcome-engine-check-all` (gồm smoke media / chia sẻ của #698, lõi / V504 / V506 của #709) | 33 bước đạt |
  | Engine Facebook: sql, copy, core, error-signs, policy-parity, legacy-catalog, v563, desktop-fb (32 nhóm), workflow-hooks, page-trace, screenshots, autocheck, wait-reason | đạt |
  | #696: `v564-smoke` 12/12 | đạt |
  | #702: `zalo-qr-proxy-reject-smoke` 6/6 (zca-js thật qua proxy giả, không ra mạng) | đạt |
  | #707: `desktop-sleep-guard-smoke` 12/12, `desktop-runtime-snapshot-smoke` | đạt |
  | #709: `v575-smoke` 10/10, `progress-format-smoke` 6/6, `electron-real-smoke` 5/5 (Electron thật, trang giả) | đạt |
  | #711: `post-bump-fixes-smoke` 9/9, `post-bump-content-rotation-smoke` 10/10 | đạt |
  | Phát lại Up tin 21 ngày thật (`post-bump-content-rotation-replay`, chỉ đọc bản chép) | bài trùng câu 56,0% → 13,1%; bài nhiều tài khoản trùng 83,0% → 7,1% (đúng số #711) |
  | Phát lại lịch sử Facebook thật, bản chép 16/11 (như 9.9.0) | 1.171 dòng khớp, 7 khác đã chốt, 0 khác chưa giải thích |
  | Kịch bản sự cố Facebook mặc định / như production (V575, V576; 20 hạt giống) | 182 / 1.108 cú gửi, không vi phạm bất biến nào |
  | Kịch bản engine Facebook + lặp lại (`--skip-general`) | 37 lượt, 179 lần gửi, 0 vi phạm |
  | Kịch bản engine đủ phần, DB như production tối 18/11 (V561, V564, V571, V575, V576) | 532 lượt, 2.981 lần gửi, 0 vi phạm mới, 1 đã biết |
  | PR chỉ đổi DB: V571 23/23, V573 13/13, error-watch 17/17 + 9/9, V576 24/24 | đạt |

- **Ba bước lỗi, đều không do bản build:**
  - `zalo-message-status-sync`: hỏng giống hệt 9.7.0 / 9.8.0 / 9.9.0 (so log bỏ đường dẫn với 9.9.0: trùng từng dòng). Lỗi có từ nhánh #672; tính năng đang tắt, V525/V526 chưa apply.
  - Phát lại lịch sử Facebook bằng bản chép 18/11 (bản #709 dùng): 1.138 dòng khớp, 2 khác chưa giải thích nên script thoát 1. Hai chỗ này đã ghi ở [docs/ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md](../../ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md), có từ trước V575: Up tin 51975 và đăng nhóm 55640, bộ cũ không ghi dòng còn engine có ghi. Số đếm trùng lần chạy của #709.
  - `v572-smoke` lần đầu 16/17: ca "comment seeding / workflow khác: V572 chạy y V563" lệch vì bản đối chứng V563 chỉ comment `[P1]` (phụ thuộc thời điểm hộp thoại của trang giả trong Chrome), còn V572 cả ba lần đều `[P1, P1]`. Chạy lại hai lần ngay sau đó: 17/17. Smoke này chỉ chạy code block trong DB (V572 đã apply), không dùng code app.

**Manifest đầu vào build**

- 1.598 file: các file Git theo dõi dưới `src/`, `scripts/`, `build/`, `packages/` và 9 file cấu hình gốc.
- Chụp trước build và sau build, cả hai cùng sha256 `454bd7fa…`. Cây làm việc sạch suốt quá trình.

**Desktop** (script hậu kiểm của 9.9.0, đã đổi đường dẫn, số bản, `(10<<16)+0` và dấu kiểm)

- **Version:** `resources/version.txt` (updater đọc file này) và `package.json` trong ASAR đều là 10.0.0 ở cả ba bản.
  - Windows: PE FileVersion / ProductVersion dạng số là `(10<<16)+0` ở cả app (`8664`) lẫn installer (`14c`); chuỗi FileVersion 10.0.0, chuỗi ProductVersion 10.0.0 (installer) / 10.0.0.0 (app).
  - Mac: `CFBundleShortVersionString` và `CFBundleVersion` 10.0.0, identity `com.akabiz.auto`.
- **Mã đóng gói:** 108 file `out/` trong ASAR giống hệt bản build, ở cả ba bản.
  - Main còn đủ dấu của 9.9.0 và không còn gọi `aka_agent_zalo_server_on_fly_v1` (V498).
  - 17 dấu mới trong main, mỗi PR ít nhất một (#696 `markShuffled`, #698 `policyPausedProgress`, #702 `observeProxyConnectRejections`, #707 `desktop.sleep_guard`, #709 `formatTargetActionLog`, #711 `content_rotation_indexes`…), cộng câu cảnh báo bài video của #711 trong renderer. Cả 18 dấu đều không có trong bản 9.9.0 (đọc từ `app.asar` của bản build 9.9.0). Danh sách đủ ở receipt.
  - Không dùng câu tiến trình làm dấu: "🔀 Đã xáo trộn danh sách" và "đã được tạm dừng." đã có sẵn trong 9.9.0 (bộ cũ in cùng câu).
- **Quét secret** trên toàn bộ file đóng gói, tính cả `app.asar`: 627 file bản Windows, 631 file mỗi bản Mac. Không có JWT `service_role`/anon (kể cả anon cũ), `sb_secret_` hay resource `server-private`.
- **Windows:** payload giải nén từ installer khớp `win-unpacked` (`akaAgent.exe`, `app.asar`, `version.txt`, `better_sqlite3.node`).
- **Mac:**
  - Kiến trúc executable và file `.node` mỗi bản đều đúng (arm64 / x86_64).
  - `codesign --verify --deep --strict` đạt (ký ad-hoc).
  - Electron trong app nạp được better-sqlite3 và chạy truy vấn đạt; bản Intel chạy qua Rosetta.
  - `hdiutil verify` đạt; mount read-only thì `app.asar` và executable khớp app.

**Module native:** module SQLite gốc của worktree và của repo chính giữ checksum `ced697fc…`.

**Bộ cài cũ:** 63 bộ cài `.exe`/`.dmg` trong `dist/` và `dist-server/` của repo chính giữ nguyên checksum.

**Checkout chính:** không sửa, không commit, không đổi nhánh (vẫn `dev_3` `514d306c`). `CLAUDE.md` của checkout chính có thay đổi chưa commit của phiên khác và đã đổi trong lúc build (checksum `af8c79d3…` → `8af603b2…`), nên lần này chỉ ghi checksum, không kiểm giữ nguyên như 9.9.0.

**Cài đặt đọc lúc build** (21:26:27 VN, một câu SELECT chỉ đọc qua Supabase MCP):

- `desktop.updates.startup_prompt_max_version`: NULL, tức hộp cập nhật hiện lúc khởi động cho mọi phiên bản.
- `desktop.sleep_guard`: chưa có dòng (mặc định Mac bật, Windows tắt, 10 phút).
- `engine.facebook`: `{"mode":"all"}`.
- `campaign.repeat_after_completion`: `{"audience":"all","sweeper":true}`.
- `engine.target_check`: `mode: all` (thiết lập DB của V571, không thuộc bản build).
- `facebook.max_comments`: 20; `facebook.block_hang_minutes`: 10; `campaign.wait_note_minutes`: 10; `facebook.error_signs` md5 `797af974…` (bản V575).
- `renewal.reminder`: `{"audience":"all","bell":true,"legacyBanner":true}`; `affiliate.program`: `audience: all`.
- `zalo.campaign_engagement.enabled`: `true`; `zalo.message_status_sync.enabled`: chưa có dòng.
- Sổ migration có V513, V529, V531, V540, V546, V556–V576 (V568 còn dòng sổ dù đã gỡ).

## Giới hạn

- Windows chưa ký Authenticode, chưa cài hay chạy trên Windows thật. Với 9.6.0 khách từng báo phải tắt bảo vệ thời gian thực của Windows Defender mới cập nhật được.
- Mac ký ad-hoc, chưa notarize; bản Intel chỉ thử qua Rosetta.
- Chưa chạy luồng đăng nhập, chiến dịch hay Facebook / Zalo thật trên bộ cài này.
- Bộ giữ khi máy ngủ (#707) chưa thử trên Mac thật ngủ qua đêm; câu lỗi QR proxy (#702) chưa chạy trên Electron thật với proxy thật; Up tin (#711) chưa chạy với Facebook thật.
- Dòng ⏸ (#698) và định dạng dòng lỗi (#709) trên Zalo Server ở Fly cần chép lõi sang ChatApi và deploy `worker` riêng.
- `server-graph.cjs` chạy từ gốc worktree như [build-01](../../agents/reference/build-01.md) dặn (245 file, 44 đổi từ Server 9.7.0, 18 đổi sau 9.9.0).

[Receipt](build-receipt.json).

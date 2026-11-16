# Build akaAgent Desktop 9.8.0 — 16/11/2026

Đã build local ba bộ cài Desktop: Windows x64, macOS ARM64, macOS Intel x64. Không build App Server.

**Nguồn**

- Worktree `.claude/worktrees/release-9.8.0`, nhánh `codex/release-9.8.0`, source commit `7707bacc12a897f149e97a7bdd9e224542efcdd0`.
- Nền là `origin/dev_3` tại `0ae0d6f2c63630cc807a644a60d8db34fb74d795`, sau PR #687.
- Commit build chỉ đổi version trong `package.json`, `package-lock.json`, `version.txt`.
- Dependency cài sạch bằng `npm ci` trong worktree, 23:28:39–23:28:50 VN. `better-sqlite3` được dựng lại cho Electron arm64; checksum `ced697fc…`, trùng repo chính.

**Thời điểm build:** 23:32:52–23:36:10 VN, 16/11/2026. Windows mất 82 giây, Mac ARM64 56 giây, Mac Intel 60 giây.

**Chưa phát hành:** chưa upload, feed cả ba nền tảng vẫn trả 9.7.0. Lúc build không đổi DB, không deploy service.

## Có gì mới

So với 9.7.0 (`17d94bde`) có các PR #674–#687. Nhiều PR chỉ gồm SQL hoặc tài liệu. Phần chạy trong app:

- **Engine v2 trên Desktop: lỗi mạng khi tải tệp lên, trước khi gửi, được xếp "chưa gửi"** (#687).
  - Data về hàng đợi với mã NET01, thay vì bị đóng với mã UNK01 ("không rõ kết quả").
  - Ngoại lệ giữ UNK01: lời gọi có chữ kèm một tệp không làm chú thích được (video, gif, pdf), vì zca-js gửi chữ trước rồi mới tải tệp.
- **Mục "Đối tác akaBiz" trong menu tài khoản** (#685, #686).
  - Mọi tài khoản đều thấy. Bấm vào là mở cổng `crm.akabiz.net/gia-han/doi-tac` bằng trình duyệt ngoài; không mở được thì hiện hộp thoại dự phòng.
  - V546 đã apply. Lúc build, `affiliate.program` là `audience: all`, nên phát hành xong mọi khách dùng 9.8.0 sẽ thấy mục này.
  - Tắt khẩn cấp: đổi thành `audience: off`.
- **Tab "Kết quả chạy" có bộ lọc Hành động và tuỳ chọn "Gộp hành động vào một dòng"** (#684). Hai hàm đọc V539 đã có trên akachat; quyền cho Desktop (V540) đã apply 15/11.
- **Nơi chạy tài khoản Zalo Server đi theo cờ engine v2 đọc lúc đăng nhập (V513)** (#679).
  - Cờ bật thì chạy trên Fly (ChatApi), cờ tắt thì chạy trên App Server.
  - Bỏ lượt gọi V498.
  - Gói Server được thêm giữa phiên thì vòng đọc lại gói mỗi 30 giây tự chuyển sang ChatApi.
- **Tài khoản Server quét QR trên Fly có lại mục "Đăng xuất Zalo" trong menu chuột phải** (#681). Màn tài khoản gửi `chatSync` theo nơi đang giữ phiên.
- Các PR chỉ có SQL, đã apply từ trước: V527 (#674), V528 (#676), V532 (#683). Bộ kiểm engine mới nằm trong `campaign-outcome-engine-check-all`.

## App Server: không build lại

Gói App Server gồm 229 file nguồn (đồ thị import từ `src/server/{main,preload,renderer}`, làm theo [build-01](../../agents/reference/build-01.md)). Có 12 file đổi kể từ Server 9.7.0 (`17d94bde`). Không thay đổi nào làm khác hành vi trên đường Zalo Server:

- `src/main/services/campaignMediaExecution.ts` (#687): chỉ gắn thêm một dấu (symbol) vào lỗi tải tệp rồi ném lại đúng lỗi đó. Bộ chạy cũ trên App Server không đọc dấu này; câu lỗi và luồng xử lý giữ nguyên.
- `src/main/engineAdapters/desktopZaloPort.ts`, `packages/campaign-engine/src/zalo/common.ts` (#687): thuộc engine v2, App Server không chạy.
- `campaignRepository.ts`, `campaignResultActionsRepository.ts`, `reportReadFlights.ts`, `src/shared/campaignResultActions.ts` (#684): phần đọc tab Kết quả chạy của giao diện Desktop.
- `desktopUiRepository.ts`, `src/shared/desktopUiReads.ts`, `src/shared/affPartner.ts` (#681, #685, #686): màn tài khoản và cài đặt giao diện Desktop.
- `src/shared/zaloServerOnFly.ts`, `src/shared/types.ts` (#679, #684): quyết định lúc đăng nhập Desktop, và kiểu dữ liệu.

Anh chỉ yêu cầu build Desktop. App Server trên VPS giữ bản 9.7.0.

## Bộ cài

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-9.8.0/akaAgent-Setup-9.8.0.exe` | 153306288 | `3465aec5938e98205f11ddbc8018b01ea021c24d96ec266f95ed1fcd75e387c8` |
| macOS ARM64 | `dist/build-9.8.0/akaAgent.dmg` | 183010221 | `3ab72b367591374449b54a10a2445bab65faa2625a9a5bdc0aac914e057fc3c7` |
| macOS Intel x64 | `dist/build-9.8.0/akaAgentIntel.dmg` | 190180175 | `b48d2732c342e467037c4e6adb4adc00266a3b3c0452e4611dbc249b3d67dcb3` |

Đường dẫn tính từ repo chính `/Users/lequangnhut/Repos/akaAgent`:

- `dist/build-9.8.0/` chứa bộ cài, `SHA256SUMS`, file `.sha256` của từng bộ cài và receipt.
- `dist/build-9.8.0-work/` chứa log, file kiểm và các script.

Không đưa bộ cài vào Git. Bản gốc trong worktree còn tới khi dọn worktree.

## Kiểm chứng

**Mã nguồn**

- Hai typecheck không lỗi.
- Smoke đạt:

  | Smoke | Kết quả |
  | --- | --- |
  | ảnh chụp runtime Desktop | 12 |
  | giảm đọc giao diện | 13 nhóm |
  | gửi lặp lại | 42 ca |
  | giảm request App Server | 19/19 |
  | dừng listener zca-js | 12/12 |
  | gia hạn phiên lệch giờ | 15 |
  | hạn giờ media, gồm lỗi mạng khi tải tệp lên trước khi gửi | đạt |
  | bộ chạy engine Desktop | 11 nhóm |
  | nhắc gia hạn Desktop | 14 nhóm |
  | đối chiếu thành viên nhóm data | 12/12 |
  | chọn nơi chạy Server lúc đăng nhập | 5 nhóm |
  | `chatSync` của màn tài khoản | 5 ca |
  | bộ lọc Kết quả chạy, phần service | 8/8 |
  | bộ lọc Kết quả chạy, giao diện (`CampaignPanel` thật trong Electron, IPC giả) | 11/11 |
  | Đối tác akaBiz | 8 nhóm |

- `campaign-outcome-engine-check-all` đạt 33 bước: SQL engine trên Postgres 17 (gồm V527, V532), lõi, bộ chạy Desktop, danh mục bản cũ.
- **`zalo-message-status-sync-smoke` hỏng, nhưng là lỗi có sẵn.**
  - Hỏng giống hệt 9.7.0: so log sau khi bỏ đường dẫn thì trùng từng dòng.
  - 24 nhóm đạt, rồi hỏng ở "file nối DB, Desktop" với lỗi "phải có hẹn giờ gửi lô".
  - Lỗi có từ nhánh #672. Tính năng đang tắt (chưa có dòng `zalo.message_status_sync.enabled`), SQL V525/V526 chưa apply.

**Manifest đầu vào build**

- 1.492 file: các file Git theo dõi dưới `src/`, `scripts/`, `build/`, `packages/` và 9 file cấu hình gốc.
- Chụp lúc 23:29:43 (trước build) và 23:37:26 (sau build), cả hai cùng sha256 `ef5620b7…`. Cây làm việc sạch suốt quá trình.

**Desktop** (script hậu kiểm của 9.7.0, đã đổi đường dẫn và số bản)

- **Version:** `resources/version.txt` (updater đọc file này) và `package.json` trong ASAR đều là 9.8.0 ở cả ba bản.
  - Windows: PE FileVersion/ProductVersion 9.8.0 (app `8664`, installer `14c`).
  - Mac: `CFBundleShortVersionString` 9.8.0, identity `com.akabiz.auto`.
- **Mã đóng gói:** 108 file `out/` trong ASAR giống hệt bản build, ở cả ba bản.
  - Main có đủ dấu của bản này: `aka-agent.campaign-media.upload-not-sent`, `aff-partner:summary`, `aka_agent_aff_partner`, `aka_agent_read_campaign_result_recipients`, `aka_agent_engine_desktop_enabled_v1`, cùng dấu listener của 9.7.0.
  - Main không còn gọi `aka_agent_zalo_server_on_fly_v1` (V498).
- **Quét secret** trên toàn bộ file đóng gói, tính cả `app.asar`: 627 file bản Windows, 631 file mỗi bản Mac. Không có JWT `service_role`/anon (kể cả anon cũ), `sb_secret_` hay resource `server-private`.
- **Windows:** payload giải nén từ installer khớp `win-unpacked` (`akaAgent.exe`, `app.asar`, `version.txt`, `better_sqlite3.node`).
- **Mac:**
  - Kiến trúc executable và 2 file `.node` mỗi bản đều đúng (arm64 / x86_64).
  - `codesign --verify --deep --strict` đạt (ký ad-hoc).
  - Electron trong app nạp được better-sqlite3 và chạy truy vấn đạt; bản Intel chạy qua Rosetta.
  - `hdiutil verify` đạt; mount read-only thì `app.asar` và executable khớp app.

**Module native:** module SQLite gốc của worktree và của repo chính giữ checksum `ced697fc…`.

**Bộ cài cũ:** 57 bộ cài `.exe`/`.dmg` trong `dist/` và `dist-server/` của repo chính giữ nguyên checksum.

**Cài đặt đọc lúc build** (23:33:06 VN):

- `renewal.reminder`: `{"audience":"all","bell":true,"legacyBanner":true}`.
- `affiliate.program`: `audience: all`.
- `desktop.updates.startup_prompt_max_version`: NULL, tức hộp cập nhật hiện lúc khởi động cho mọi phiên bản.
- `zalo.campaign_engagement.enabled`: `true`.
- `zalo.message_status_sync.enabled`: chưa có dòng.
- Sổ migration có V513, V529, V540, V546.

## Giới hạn

- Windows chưa ký Authenticode, chưa cài hay chạy trên Windows thật. Với 9.6.0 khách từng báo phải tắt bảo vệ thời gian thực của Windows Defender mới cập nhật được.
- Mac ký ad-hoc, chưa notarize; bản Intel chỉ thử qua Rosetta.
- Chưa chạy luồng đăng nhập, chiến dịch hay Zalo thật trên bộ cài. Mục "Đối tác akaBiz" chưa chạy bằng phiên Desktop thật.
- `server-graph.cjs` phải chạy từ gốc worktree. Lần đầu chạy từ thư mục `dist/build-9.8.0-work` thì ra 0 file đổi, vì khoá `metafile` của esbuild tính theo thư mục đang đứng. Đã chạy lại đúng chỗ (12 file), xem [build-01](../../agents/reference/build-01.md).

[Receipt](build-receipt.json).

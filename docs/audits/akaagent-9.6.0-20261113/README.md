# Build akaAgent Desktop và App Server 9.6.0 — 13/11/2026

Đã build local ba bộ cài Desktop (Windows x64, macOS ARM64, macOS Intel x64) và bộ cài App Server Windows x64 nội bộ, cùng một nguồn:

- Worktree `.claude/worktrees/release-9.6.0`, nhánh `codex/release-9.6.0`, source commit `3c59c5cd65009ceea81dd4c1f511190a898c1eb7`.
- Nền `origin/dev_3` tại `7c0a6a79c23af562293f7755c7ebd3b643470529` (sau PR #653).
- Commit build chỉ đổi version trong `package.json`, `package-lock.json`, `version.txt`.
- Dependency cài sạch bằng `npm ci` trong worktree (778 gói). `better-sqlite3` dựng lại cho Electron arm64, checksum `ced697fc…` như repo chính.

Thời điểm build (13/11/2026):

- Desktop **00:43:39–00:47:07 VN**: Windows 88 giây, Mac ARM64 62 giây, Mac Intel 58 giây.
- App Server **00:47:24–00:48:13 VN**: 49 giây.

**Chưa upload, phát hành hay đổi feed; App Server chưa cài lên VPS.** Không đổi DB, không deploy service.

## Có gì mới

So với Desktop 9.5.0 (`cf29bc19`) có 35 PR (#618–#653). Chính:

- **Engine chiến dịch v2:**
  - Desktop chỉ chạy bộ mới khi bản cài có bộ mới **và** tổ chức bật cờ `use_new_zalo_runtime` (V513, #651). Tổ chức chưa bật cờ chạy như cũ.
  - Tài khoản Server của tổ chức bật cờ dùng ChatApi cho QR, kiểm phiên, đăng xuất, quét data, kiểm SĐT (`serverAccountsUseChatApi`) và nghe tiến trình từ ChatApi.
  - Bản 9.5.0 không có hai phần này, nên nhân viên tổ chức không Chat dùng Desktop cần bản này trước khi bật cờ cho tổ chức của họ.
- Quản lý proxy theo tổ chức: đọc proxy theo tổ chức; bộ chạy dừng khi tài khoản có proxy mà không đọc được (V511, #652).
- Cột "Giới hạn lượt" trên danh sách chiến dịch và tab "Hành động" dạng thẻ (V502, #648).
- Giảm đọc DB khi không ai nhìn giao diện (#646). Đang tắt cho tới khi có dòng cài đặt.
- Lọc trùng khi tải data và khi "Thêm data" (V491/V493, #634, #643, #645).
- Mặc định chia đều data cho các tài khoản (#640).
- Gửi lặp lại sau x phút cho chiến dịch chia sẻ (#635, #636). Đang ẩn.
- Tab Báo cáo theo chiến dịch (V489, #625), tab Hành động trong chi tiết chiến dịch (#623).
- Hỏi đáp AI theo nhóm agent Desktop (#632), nút "Trợ lý aka" (#644).
- Xuất nhóm Facebook tìm được (#630).

## App Server: có build lại

Gói App Server gồm 214 file nguồn (đồ thị import từ `src/server/{main,preload,renderer}`, làm theo
[build-01](../../agents/reference/build-01.md)). Từ Server 9.5.1 (`d1400ddb`), 28 file trong số đó đã đổi. Ba thay đổi chạy trên đường
Zalo Server:

- `4a476f70`: note đếm ngược hạn mức lại cập nhật mỗi phút.
- `4b8fc15a`: bộ chạy gửi lặp lại sau x phút cho chiến dịch Zalo gửi dạng chia sẻ.
- `7ef1600b`: đọc proxy theo tổ chức. Đây là điều kiện để bật proxy dùng chung `proxies.shared_runtime.server` theo
  [V511](../../WEB_PROXY_MANAGEMENT_V511.md).

Code engine v2 nằm trong gói nhưng chỉ chạy cho tài khoản Desktop (`runtimeTarget === 'desktop'`).

## Bộ cài

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-9.6.0/akaAgent-Setup-9.6.0.exe` | 153214569 | `33ce5cfa65736b28e3204630dc3332ebcc2f658e5e2f0f59547610ac4d8dfe3c` |
| macOS ARM64 | `dist/build-9.6.0/akaAgent.dmg` | 182909288 | `554d655397e7c3736cd27996f545f54112bfbcbdd621922bfc3dbbec3fd11efc` |
| macOS Intel x64 | `dist/build-9.6.0/akaAgentIntel.dmg` | 190096367 | `e384fc8d43ace1b373dcc5a64ba39cecf1f5e8772140e695af1f117fc59af47b` |
| App Server Windows x64 (nội bộ) | `dist-server/private/2026-11-12T17-47-24-534Z/akaAgent-Zalo-Server-Internal-Setup-9.6.0.exe` | 140427821 | `f4127287a535bc98ca343330fe64a900401835e74507516a1712d2186b651cf2` |

Đường dẫn tính từ repo chính `/Users/lequangnhut/Repos/akaAgent`:

- Bộ cài Desktop, `SHA256SUMS` và receipt ở `dist/build-9.6.0/`; log và file kiểm ở `dist/build-9.6.0-work/`.
- Bản App Server mang đi cài ở `dist-server/akaAgent-Zalo-Server-Internal-Setup-9.6.0.exe` (quyền 600), kèm `.sha256`.
- Bộ cài App Server chứa credential backend ở resource riêng ngoài ASAR. Chỉ cài trên máy chủ quản lý; không upload công khai, không đưa vào Git hay Desktop.

Không đưa bộ cài vào Git. Bản gốc trong worktree vẫn còn tới khi dọn worktree.

## Kiểm chứng

**Mã nguồn**
- Hai typecheck không lỗi.
- Smoke đạt:
  - ảnh chụp runtime Desktop 12 ca;
  - giảm đọc giao diện 13 nhóm;
  - gửi lặp lại 42 ca;
  - giảm request App Server 19/19.
- `campaign-outcome-engine-check-all` đạt 28 bước: SQL V495–V514 trên Postgres 17, lõi, bộ chạy Desktop 9 nhóm, danh mục bản cũ 3 nhóm.

**Manifest đầu vào build**
- 1.411 file: file Git theo dõi dưới `src/`, `scripts/`, `build/`, `packages/` và 9 file cấu hình gốc.
- Chụp lúc 00:41:25 trước build và 00:51:15 sau build, cùng sha256 `0ea585bb…`. Cây làm việc sạch suốt quá trình.

**Desktop** (script hậu kiểm của bản 9.4.0, đổi đường dẫn và số bản):
- **Version:** `resources/version.txt` (updater đọc file này) và `package.json` trong ASAR là 9.6.0 ở cả ba bản. Windows PE FileVersion/ProductVersion 9.6.0 (app `8664`, installer `14c`). Mac `CFBundleShortVersionString` 9.6.0, identity `com.akabiz.auto`.
- **Mã đóng gói:** 108 file `out/` trong ASAR giống hệt bản build ở cả ba bản.
- **Quét secret:** toàn bộ file đóng gói (627 file Windows, 631 mỗi bản Mac, tính cả `app.asar`). Không có JWT `service_role`/anon (kể cả anon cũ), `sb_secret_` hay resource `server-private`.
- **Windows:** payload giải nén từ installer khớp `win-unpacked` (`akaAgent.exe`, `app.asar`, `version.txt`, `better_sqlite3.node`).
- **Mac:** kiến trúc executable và mọi `.node` đúng (arm64 / x86_64). `codesign --verify --deep --strict` đạt (ad-hoc). Electron trong app nạp better-sqlite3 và chạy truy vấn đạt (Intel qua Rosetta). `hdiutil verify` đạt; mount read-only thì `app.asar` và executable khớp app.

**App Server** (`scripts/staff-rls/verify-private-server-build.cjs`), đều đạt:
- Windows x64; payload khớp `win-unpacked`; main Server trong ASAR khớp bản build.
- Credential nạp được trên profile sạch, và không có trong source, `out/`, `out-server/` (quét 4.379 file); thư mục private bị Git ignore.
- Version 9.6.0.

**Module native và log**
- Module SQLite gốc của worktree và của repo chính giữ checksum `ced697fc…`.
- Log, receipt và file kiểm không chứa credential.

**Bộ cài cũ:** 65 bộ cài 9.x trong `dist/` và `dist-server/` của repo chính giữ nguyên checksum. 87 bộ cài 8.x do người dùng tự dọn trong lúc build (khoảng 00:45 VN); danh sách ở `dist/build-9.6.0-work/removed-by-others-during-build.json`.

## Giới hạn và việc tiếp theo

- Windows chưa ký Authenticode, chưa cài/chạy trên Windows thật.
- Mac ký ad-hoc, chưa notarize; Intel chỉ thử qua Rosetta.
- Chưa chạy luồng đăng nhập, chiến dịch hay Zalo thật trên bộ cài.
- Cài App Server lên VPS nên làm ngoài giờ cao điểm. Lần cài 9.5.1 (13:41 VN 10/11) làm mọi tài khoản Server đăng nhập lại cùng lúc, đẩy p50 REST toàn hệ lên ~580 ms trong 5 phút ([9.5.1](../akaagent-server-9.5.1-20261110/README.md)).

[Receipt](build-receipt.json).

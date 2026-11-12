# Bản Desktop thử nội bộ 9.5.1 (engine v2) — 11/11/2026

**Bản thử, không phát hành.** Không tải lên, không đổi feed cập nhật, không đổi DB. Dựng theo yêu cầu "Dựng bản thử" để xem tiến trình chiến dịch của tổ chức không Chat chạy trên Fly (tổ chức 526) trên Desktop.

- Nguồn: worktree `campaign-engine-v2`, nhánh `feat/campaign-engine-v2`, nền `54cfde31` (`dev_3` tại #636) cộng thay đổi chưa commit của engine v2 và phần nghe tiến trình (V498). Không có #637–#643 của `dev_3`.
- Phiên bản 9.5.1 (`version.txt` sẵn có). Feed hiện là 9.5.0 nên bản thử không bị nhắc cập nhật; khi feed lên bản cao hơn thì app sẽ nhắc như thường.
- Chỉ macOS ARM64. Build 21:07:59–21:09:05 VN (`npm run build:mac`).

## Bộ cài

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| macOS ARM64 | `dist/build-9.5.1-test-engine-v2/akaAgent-9.5.1-test-engine-v2.dmg` | 182834227 | `b97b6c8bf17ad35836e67728341a2115657c35b9a0026de0a6edac372a473511` |

Không đưa bộ cài vào Git.

## Kiểm chứng

- Manifest đầu vào build (618 file: `src`, `build`, `packages/campaign-engine`, `package.json`, `package-lock.json`, `version.txt`, cấu hình vite/tsconfig, script ký ad-hoc) ghi trước và sau build: giống nhau (`3f88a4ec…`).
- Hai typecheck đạt. `node scripts/campaign-outcome-engine-check-all.cjs` 10/10 bước đạt (SQL V495 35, V496 6, V497 10, V498 9, Desktop nghe tiến trình 5, lõi 23, bộ chạy Desktop 6, danh mục bản cũ 3).
- `resources/version.txt`, `Info.plist`, `package.json` trong ASAR đều 9.5.1; `com.akabiz.auto`; entrypoint `./out/main/index.js`.
- Executable và `better_sqlite3.node` arm64; `fsevents.node` universal.
- `out/` trong ASAR có mã mới: `aka_agent_zalo_server_on_fly_v1`, `isServerOnFlyRealtimeUser`, `campaign_engine_journal`, `aka_agent_engine_claim_target_v1`, `/api/chat/desktop/session`.
- Quét 12.453 file (ASAR và `Resources/`): không có JWT `service_role`/anon, `sb_secret_` hay `supabase-server-secret.key`.
- `codesign --verify --deep --strict` đạt (ad-hoc); `hdiutil verify` hợp lệ; mount read-only: `app.asar`, executable, `version.txt` khớp app đã đóng gói.
- Electron 33.4.11 trong app nạp better-sqlite3, `select sqlite_version()` = 3.53.1.

## Lưu ý khi cài

- Cài đè akaAgent đang có trên máy (cùng định danh, cùng dữ liệu `aka-biz-auto`). Quay lại: cài lại DMG 9.5.0 (`dist/build-9.5.0/akaAgent.dmg` ở checkout chính).
- Bản này chạy bộ mới cho tài khoản Zalo QR/Web của người đăng nhập với chiến dịch "Nhắn tin theo SĐT" chỉ chữ; nên đăng nhập bằng tài khoản thử (tổ chức 526).
- Desktop đọc "tổ chức chạy trên Fly" lúc đăng nhập (V498); đổi cờ thì đăng nhập lại.
- Presence báo `app_version` 9.5.1 cho máy cài bản này.

## Đã dùng để thử — 11/11/2026

Chạy thẳng từ `dist` với `--user-data-dir=~/Library/Application Support/aka-biz-auto-test-engine-v2` (không cài) lúc 21:14 VN. Nhân viên 547 (tổ chức 526) đăng nhập 21:14:55; ChatApi api v173 cấp phiên Desktop (200) và app nối kênh realtime. Chạy lại 32956 lúc 21:15:57: **anh thấy dòng tiến trình trên tab Tiến trình của Desktop**. Tác dụng phụ: AutoCheck hạ tài khoản Facebook 2509 xuống `chưa đăng nhập` (hồ sơ trình duyệt trống); `ZaloServerClient` báo lỗi nối App Server lặp lại (App Server đã thả tổ chức 526).

## Giới hạn

Ký ad-hoc, chưa notarize. Chỉ ARM64. Chưa chạy chiến dịch bằng tài khoản Zalo QR/Web trên bản đóng gói (tổ chức 526 không có).

[Receipt](build-receipt.json). Log lệnh và manifest ở `dist/build-9.5.1-test-engine-v2/` (không trong Git).

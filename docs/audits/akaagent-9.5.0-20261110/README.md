# Build akaAgent Desktop 9.5.0 — 10/11/2026

Đã build local ba bộ cài Desktop từ repo chính `/Users/lequangnhut/Repos/akaAgent`, nhánh `codex/release-9.5.0`, source commit `cf29bc19c5c65ca25fbfb91670e4b45a14dcb3ed`, base `dev_3` / `origin/dev_3` tại `6769f91cdae6b9cf6c578f396fda4e44b1e041d8` (sau PR #617). Không dùng worktree. Commit build chỉ đổi version trong `package.json`, `package-lock.json`, `version.txt`; không sửa runtime/dependency.

Build tuần tự **09:16:59–09:20:46 VN ngày 10/11/2026** (Windows 82 s, Mac ARM64 63 s, Mac Intel 71 s). **Chưa upload/phát hành hoặc cập nhật feed.** Không đổi DB, không deploy service.

So với 9.4.0 (base `57f8c0a1`), bản này có thêm: thêm data vào nhóm chia lô (V483) và nhập file nhiều phần (V485), ảnh chụp runtime gửi kèm tài khoản Facebook, trang Báo cáo dữ liệu trên Desktop.

## Bộ cài

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-9.5.0/akaAgent-Setup-9.5.0.exe` | 152730827 | `5918043b84db2f8bf99d113a53d8aa08f98c721813dd36eaf0b57b037edd03db` |
| macOS ARM64 | `dist/build-9.5.0/akaAgent.dmg` | 182776919 | `eb8478767e0374950b8690afd8fa1e21958a3f8d479220ea0856a3ba90ea69b6` |
| macOS Intel x64 | `dist/build-9.5.0/akaAgentIntel.dmg` | 189942026 | `f1c70cceb9a758aff6abec7b3e0741bc289482dba0c7203056a7ac0ecd1c77a9` |

Bản lưu theo version và `SHA256SUMS` ở `dist/build-9.5.0/`, cùng alias hiện hành và file `.sha256` trong `dist/`. Không đưa installer vào Git.

## App Server

**Không build lại**, giữ bộ nội bộ 9.3.0 ngày 05/11. Gói Server gồm 166 file nguồn (đồ thị import từ `src/server/{main,preload,renderer}`); từ commit Server 9.3.0 `646ddd98` tới `6769f91c` chỉ 3 file trong số đó đổi: `campaignScheduler.ts` (ghi chiến dịch đang chạy cho heartbeat Desktop, phần đọc không nằm trong gói Server), `dataGroupRepository.ts` và `dataGroupIngestChunks.ts` (chỉ gọi từ UI Desktop và "Tìm data" Facebook; Server chỉ chạy Zalo Server). Không đổi `src/server`, `zaloServerProtocol.ts`, script/cấu hình build Server hay dependency.

## Kiểm chứng

- Hai typecheck (node/preload/shared, renderer) đạt. Smoke ảnh chụp runtime Desktop offline 12/12 đạt. `build:win`, `build:mac`, `build:mac:intel` đều exit 0; `verify-windows-installer-contract` và `verify-win-native-modules` (trong `build:win`) đạt.
- Version 9.5.0 ở `package.json` trong ASAR cả ba bản; Windows PE FileVersion `9.5.0`, ProductVersion `9.5.0.0`, app x64 (machine `8664`), installer NSIS (`14c`); Mac `CFBundleShortVersionString` 9.5.0, identity `com.akabiz.auto`, entrypoint `./out/main/index.js`.
- Kiến trúc: executable và `better_sqlite3.node` đúng x86-64 (Windows), arm64 (Mac ARM64), x86_64 (Mac Intel).
- 115 file `out/` trong ASAR giống hệt nhau ở cả ba bản và có mã nhập file nhiều phần V485. Không thấy JWT `service_role`/anon, token `sb_secret_` hay resource Server trong Desktop.
- Giải nén installer Windows: `akaAgent.exe`, `app.asar`, `better_sqlite3.node` khớp checksum với `win-unpacked`.
- Mac: `codesign --verify --deep --strict` đạt (ad-hoc); `hdiutil verify` hai DMG đạt; mount read-only, `app.asar` và executable khớp app đã đóng gói.
- Electron 33.4.11 trong app đóng gói nạp better-sqlite3 và `SELECT 1` đạt (SQLite 3.53.1): arm64 trực tiếp, x64 qua Rosetta.
- 140 installer cũ trong `dist/` và `dist-server/` giữ nguyên checksum (gồm App Server). DMG alias trước build trùng bản 9.4.0 đã lưu ở `dist/build-9.4.0/`; `latest.yml`/`latest-mac.yml` cũ sao lưu ở `dist/build-9.5.0-work/prebuild/`. Native SQLite của máy build khôi phục đúng checksum `ced697fc…` (arm64).
- Giữ nguyên thay đổi local chưa commit `CLAUDE.md`.

## Giới hạn

Windows chưa ký Authenticode và chưa cài/chạy trên Windows thật. Mac ký ad-hoc, chưa notarize; Intel chỉ thử qua Rosetta. Không chạy luồng đăng nhập, chiến dịch hoặc Zalo thật; quét secret chỉ trong `out/` của ASAR.

[Receipt](build-receipt.json). Log build và file kiểm chứng ở `dist/build-9.5.0-work/` (không trong Git).

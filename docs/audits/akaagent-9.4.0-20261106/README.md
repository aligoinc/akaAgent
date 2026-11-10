# Build akaAgent Desktop 9.4.0 — 06/11/2026

Đã build local ba bộ cài Desktop từ repo chính `/Users/lequangnhut/Repos/akaAgent`, nhánh `codex/release-9.4.0`, source commit `247ec9aaf0e145320ef166508abb6c00eb01bbfc`, base `dev_3` / `origin/dev_3` tại `57f8c0a1184dab03d15ae6f96ea7372aff9ff3c0`. Không dùng worktree để build. Commit build chỉ đổi version trong `package.json`, `package-lock.json`, `version.txt`; không sửa runtime/dependency.

Build tuần tự **20:32:46–20:36:15 VN ngày 06/11/2026**; hậu kiểm hoàn tất **20:37:30 VN**. **Chưa upload/phát hành hoặc cập nhật feed.** Không build App Server; bộ Server nội bộ 9.3.0 ngày 05/11 vẫn giữ nguyên. Không deploy service, apply migration hoặc đổi DB.

## Bộ cài

| Nền tảng | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-9.4.0/akaAgent-Setup-9.4.0.exe` | 152800551 | `5f4e55d1c12454334c090504d56ae2bf23028e0e19d53fee6ee955b7d42ebee0` |
| macOS ARM64 | `dist/build-9.4.0/akaAgent.dmg` | 182748859 | `de22a368cc01a28ece0b7438a3372cacc5ba873f3c596677262da8e19f52b381` |
| macOS Intel x64 | `dist/build-9.4.0/akaAgentIntel.dmg` | 189894572 | `1c79bdc4d1d3de41b76062c20ebf1e477ef347cd919a91bb06a019794c9fea56` |

Bản lưu theo version và `SHA256SUMS` ở `dist/build-9.4.0/`, cùng alias hiện hành trong `dist/`. Không đưa installer vào Git.

## Kiểm chứng

- Hai typecheck node/preload/shared và renderer đạt. Smoke Desktop runtime snapshot đạt 8 ca offline. `build:win`, `build:mac`, `build:mac:intel` đều exit 0.
- Windows qua installer contract và verifier native theo profile Desktop; giải nén bộ cài và đối chiếu executable, ASAR, version resource, native SQLite với unpacked output. App/native x64, PE version 9.4.0.
- Mac executable và các native module đúng ARM64/x86_64; Info.plist/version resource 9.4.0, identity `com.akabiz.auto`. Chữ ký ad-hoc hợp lệ. DMG verify đạt, mount read-only và đối chiếu payload với app đã đóng gói.
- Electron trong từng app Mac nạp SQLite và chạy truy vấn memory thành công. Intel thử qua Rosetta trên máy ARM64.
- ASAR của cả ba bản khớp output build; 1.167 build inputs không đổi checksum trong khi build. Desktop không chứa resource `server-private`, JWT `service_role`, token `sb_secret_` hoặc anon token legacy được đối chiếu; không ghi credential vào audit/log.
- 111 installer cũ giữ nguyên checksum, bao gồm App Server. Generic DMG/metadata trước build có bản sao riêng. Native SQLite host khôi phục đúng checksum; Electron 33.4.11 ARM64 nạp SQLite và `SELECT 1` đạt.
- Giữ nguyên hai thay đổi local có sẵn: `CLAUDE.md` và `docs/DE_XUAT_ENGINE_CHIEN_DICH_CHUNG.md`.

## Giới hạn

Windows chưa ký Authenticode và chưa cài/chạy trên Windows thật. Mac chưa notarize với Apple; Intel chưa thử phần cứng thật. Không chạy luồng người dùng đã đăng nhập, campaign hoặc thao tác Zalo thật. Kết quả package/typecheck không thay thế kiểm thử các luồng đó.

[Receipt đầy đủ](build-receipt.json). Log, manifest và backup nằm riêng tại `/Users/lequangnhut/.codex/builds/akaagent-9.4.0-20261106T133124Z`.

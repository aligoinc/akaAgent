# Build akaAgent 9.3.0 — 05/11/2026

Đã build đủ Desktop Windows x64, macOS ARM64, macOS Intel x64 và App Server Windows x64 nội bộ từ repo chính `/Users/lequangnhut/Repos/akaAgent`, nhánh `codex/release-9.3.0`, commit `646ddd98` (base `dev_3` / `origin/dev_3` tại `c332ecf5`). Không dùng worktree để build. Chỉ đổi metadata version trong `package.json`, `package-lock.json`, `version.txt`; không sửa source runtime hoặc dependency.

Build tuần tự **00:00:53–00:04:38 VN ngày 05/11/2026** bằng `build:win`, `build:mac`, `build:mac:intel`, `build:server:win:private`; hậu kiểm hoàn tất **00:05:59 VN**. Build local, **chưa upload/phát hành hoặc cập nhật feed**; các PR chỉ chứa source version/tài liệu/receipt, không chứa bộ cài.

## Bộ cài

| Nền tảng | Đường dẫn tương đối từ repo | Byte | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-9.3.0/akaAgent-Setup-9.3.0.exe` | 152804160 | `a3aeba58d4dbea993172505fb45867c90ce7fc87b048dbe7cf182547d5b23d14` |
| macOS ARM64 | `dist/build-9.3.0/akaAgent.dmg` | 182692567 | `71ac3c9c194adc07b590b53743ee9bb2ac65fb12c16b91ef186aaa57b16abce6` |
| macOS Intel x64 | `dist/build-9.3.0/akaAgentIntel.dmg` | 189904531 | `08804f4443b04e41dbddc938a4e105a8b2e1330b73f70b23f572d24b895c65ab` |
| App Server Windows x64 nội bộ | `dist-server/private/2026-11-04T17-03-53-218Z/akaAgent-Zalo-Server-Internal-Setup-9.3.0.exe` | 140343359 | `ae01b08cf53617be555567d455ff34445c966ceb7e212eaf9f31177710b633ee` |

Desktop có bản lưu theo version và `SHA256SUMS` tại `dist/build-9.3.0/`, cùng alias hiện hành trong `dist/`. Server dùng thư mục private riêng có `SHA256SUMS`; giữ tại máy chủ quản lý, không upload công khai. Bộ cài chứa credential backend hiện có ở resource riêng, ngoài ASAR, không đưa vào Desktop hoặc Git.

## Kiểm chứng

- Hai typecheck node/preload/shared và renderer đạt; cả bốn production build/package exit 0. Installer contract và verifier theo đúng profile Desktop/Server đạt.
- Package/resource/PE hoặc Info.plist đều 9.3.0. Desktop giữ identity `aka-biz-auto`, `com.akabiz.auto`, entrypoint `./out/main/index.js`; Server dùng `out-server/main/index.js`.
- Giải nén Windows installer xác nhận executable, ASAR, version và SQLite native khớp unpacked; executable/native đúng x64. Server loader đọc đúng credential trên profile sạch trong VM cô lập; 14 ca chọn key đạt.
- Mac executable/native đúng ARM64 hoặc x86_64, ký ad-hoc hợp lệ. DMG checksum và payload sau mount read-only khớp; packaged Electron nạp SQLite và query in-memory thành công, Intel chạy qua Rosetta trên host ARM64.
- Output ASAR khớp build local; 1.124 build inputs giữ checksum. Desktop không chứa Server resource, credential backend thực tế hoặc anon token cũ. Không ghi credential vào log/audit.
- 105 installer cũ giữ checksum; generic DMG/metadata trước build có bản sao riêng. Native host khôi phục đúng checksum, Electron 33.4.11 ARM64 nạp SQLite và `SELECT 1` đạt. Giữ nguyên `CLAUDE.md` và tài liệu đề xuất người dùng đang sửa.

## Giới hạn và phạm vi

Windows chưa ký Authenticode/chưa cài chạy trên Windows thật. Mac chỉ ký ad-hoc, chưa Apple notarization; chưa thử phần cứng Intel thật. Không khởi động runtime nghiệp vụ, gửi tin hoặc chạy chiến dịch. Không thay DB, deploy service hay cấu hình mobile/APNs trong lượt build này. Không apply lại V457/V458 hoặc V460.

Tài liệu [rollout và canary thông báo trước đó](../notification-center-20261104/README.md) được đưa vào PR cùng lượt này; trạng thái deploy/Web/API được kiểm chứng độc lập với build bộ cài.

[Receipt đầy đủ đã lọc secret](build-receipt.json). Log, manifest và bản sao trước build nằm riêng tại `/Users/lequangnhut/.codex/builds/akaagent-9.3.0-20261104T165834Z`.

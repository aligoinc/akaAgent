# akaAgent 8.2.0 — build lại ngày 10/10/2026

Đã deploy Chat worker trước, rồi build đủ bốn bộ cài từ repo chính `dev_3`, commit `b126b88b1b1dd6c9c9ef97bb08f63ef5cd8b88ae` sau khi merge PR #478. Package và `version.txt` đều là **8.2.0**, Electron **33.4.11**. Các thay đổi local sẵn có của task V371/tài liệu được giữ nguyên; không sửa source ứng dụng hoặc áp dụng migration trong đợt deploy/build này.

## Bộ cài

| Bản | Đường dẫn từ repo | MiB |
|---|---|---:|
| windows-desktop | `dist/akaAgent-Setup-8.2.0.exe` | 112.8 |
| windows-server | `dist-server/akaAgent-Zalo-Server-Setup-8.2.0.exe` | 102.1 |
| mac-arm64 | `dist/akaAgent.dmg` | 137.4 |
| mac-intel | `dist/akaAgentIntel.dmg` | 144.2 |

Bốn lệnh `build:win`, `build:server:win`, `build:mac`, `build:mac:intel` đều thành công, chạy lần lượt để không dùng lẫn native module. Hai typecheck đều đạt. Payload ASAR của hai installer Windows khớp thư mục đóng gói và verifier xác nhận đúng executable/profile cùng native PE x64. Hai DMG đã được verify và mount chỉ đọc để đối chiếu payload; executable/SQLite đúng ARM64 hoặc x86_64, chữ ký ad-hoc hợp lệ. Mỗi gói Desktop khớp 110 file compiled hiện tại, Server khớp 10 file; phiên bản và entry point đều đúng. Native SQLite của máy build đã được khôi phục, checksum khớp trước build.

Bộ cài Windows chưa ký chứng thư; macOS dùng chữ ký ad-hoc, chưa notarize theo cấu hình hiện tại. Chưa chạy installer trên Windows hoặc thực hiện chiến dịch thật để thử. Chưa upload, phát hành hay đổi updater trong DB.

## Evidence

- [Build receipt](audits/akaagent-8.2.0-20261010/build-receipt.json): commit, thời điểm, SHA256, kích thước, kết quả kiểm tra từng bộ cài.
- Manifest local: `dist/build-8.2.0-manifest.json`; checksum: `dist/build-8.2.0-SHA256SUMS.txt`; log và metadata updater riêng từng target: `dist/build-8.2.0-logs/`.
- Các artifact cũ bị trùng tên đã được sao lưu tại `dist/archive/before-8.2.0-20261010-030150/`, kèm manifest/checksum. Artifact trong worktree cũ được giữ nguyên.
- [Deploy Chat worker](../../akaAgentChatApi/docs/DEPLOY_RESULT_CATALOG_CACHE_20261010.md): commit `b542f20`, thay image trên cùng worker, giữ API/runtime và toàn bộ cấu hình tài nguyên/kết nối. Health checks HTTP 200, 232 file compiled khớp, chu kỳ xử lý đầu không lỗi/tồn đọng. Không áp dụng lại migration.

Chỉ build/deploy các thay đổi đã merge. Lịch sử detail, bộ đếm, note/log và dữ liệu policy không được sửa trong đợt này.

## Build lại sau PR #479

Ngày 10/10/2026 (giờ Việt Nam), cả bốn bộ cài được build lại từ commit `55760cad7ced7f85a01f5139e4215b0fa426c21a` trên `dev_3`, gồm bản sửa log lỗi policy đã merge trong PR #479. Giữ phiên bản **8.2.0** và các tên file trong bảng trên. Đợt này chỉ build local, không deploy Chat worker, áp dụng migration hoặc phát hành bộ cài.

Hai typecheck và bốn lệnh đóng gói đều thành công. Đã giải nén kiểm tra payload của hai EXE; xác minh chữ ký ad-hoc, kiến trúc, chạy SQLite đóng gói và mount chỉ đọc hai DMG để đối chiếu. Toàn bộ file compiled trong mỗi gói khớp kết quả build tương ứng. Source và các thay đổi local có sẵn giữ nguyên; native SQLite của máy build được khôi phục đúng checksum. Chưa chạy installer trên Windows thật; trạng thái ký chứng thư/notarize giữ như đợt trước.

- [Receipt sau PR #479](audits/akaagent-8.2.0-20261010/rebuild-pr479-receipt.json) lưu commit, thời điểm, checksum và kết quả kiểm chứng mới.
- Các đường dẫn `dist/build-8.2.0-manifest.json`, `dist/build-8.2.0-SHA256SUMS.txt` và `dist/build-8.2.0-logs/` hiện thuộc đợt build sau PR #479.
- Bộ cài, manifest, checksum và log của đợt sau PR #478 được giữ tại `dist/archive/before-8.2.0-pr479-20261010-040230/`, trong các thư mục con `dist/` và `dist-server/`; `archive-manifest.json` chứa checksum đã kiểm chứng. Receipt cũ ở phần Evidence được giữ nguyên để đối chiếu lịch sử.

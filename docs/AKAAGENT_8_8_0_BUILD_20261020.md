# akaAgent 8.8.0 — build local ngày 20/10/2026

Đã đóng gói ba bản Desktop từ `dev_3` tại commit `1a796638ca5a6c0642d27dd3d169a3af48ce2885`, gồm PR #526, với metadata phiên bản local **8.8.0**. PR này ghi lại bộ cài đã hoàn tất; không thay dependency hoặc runtime. Phiên bản được đồng bộ trong `package.json`, hai vị trí metadata của `package-lock.json` và `version.txt`. Electron **33.4.11**.

| Bản | File trong `dist/build-8.8.0/` | MiB |
|---|---|---:|
| Windows x64 | `akaAgent-Setup-8.8.0.exe` | 113.2 |
| macOS ARM64 | `akaAgent.dmg` | 137.7 |
| macOS Intel x64 | `akaAgentIntel.dmg` | 144.6 |

Chạy lần lượt `npm run build:win`, `npm run build:mac`, `npm run build:mac:intel`. Hai typecheck và 107 ca V419 (89 runtime, 18 Electron DOM) đạt. Cả ba bộ cài đúng phiên bản, kiến trúc và bundle khớp output; installer Windows qua contract và đối chiếu payload giải nén. Hai bản Mac qua kiểm tra chữ ký ad-hoc, checksum/mount DMG và chạy SQLite đóng gói, Intel qua Rosetta. Native SQLite của máy build được khôi phục đúng checksum ban đầu.

Đã kiểm tra bundle có các tính năng Desktop mới, IPC hạn mức upload độc lập và điều kiện mở sửa chiến dịch theo trạng thái. Source đầu vào không đổi trong ba lượt đóng gói và xác minh. Bằng chứng hoàn tất lúc **23:03 ngày 20/10/2026, giờ Việt Nam**.

Chỉ build local, chưa upload/phát hành, deploy hoặc apply migration. Windows chưa ký chứng thư; macOS ký ad-hoc, chưa notarize. Chưa chạy installer trên Windows thật hoặc thực hiện chiến dịch Facebook thật trong lượt kiểm chứng này.

## App Server

Không cần build lại App Server nếu đang dùng bộ **8.6.0** đã đóng gói từ commit `8e54f6056881512af1831a238c9d5817c0f95e63`. Đã đối chiếu tới commit build Desktop: entrypoint, runtime manager, session restorer, contact loader, protocol và hợp đồng loại trừ gửi không đổi. Các thay đổi mới ở Desktop form/import, Facebook và DB tương thích; nhánh AI form mới dùng `formConfigId`, giữ hành vi AI chiến dịch cũ.

Installer `dist-server/akaAgent-Zalo-Server-Setup-8.6.0.exe` được giữ nguyên, SHA256 `f0d4426263e58daad88731bd469e1926638452de125e358448250020afe2f0d1`. Chưa kiểm tra phiên bản Server đang triển khai thực tế; kết luận trên áp dụng cho baseline 8.6.0 đã xác minh.

## Bằng chứng

- [Build receipt](audits/akaagent-8.8.0-20261020/build-receipt.json): source commit, phiên bản, kích thước và SHA256 từng bộ cài.
- [Kết quả kiểm chứng](audits/akaagent-8.8.0-20261020/verification.json).
- [Đối chiếu App Server](audits/akaagent-8.8.0-20261020/server-compatibility.json).
- [SHA256SUMS](audits/akaagent-8.8.0-20261020/SHA256SUMS).
- Bộ cài, log, source manifest và công cụ xác minh đầy đủ giữ local tại `dist/build-8.8.0/`; không đưa binary vào Git.

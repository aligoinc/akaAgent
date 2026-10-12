# akaAgent 8.3.0 — build local ngày 13/10/2026

Đã đóng gói ba bản Desktop từ repo chính `dev_3`, commit `6591c260d5d8a5869a753cf175e20d482dbdd3dc` sau khi merge PR #485. Đổi phiên bản trong `package.json`, root metadata của `package-lock.json` và `version.txt` từ 8.2.0 thành **8.3.0**; không đổi dependency. Electron **33.4.11**. Hoàn tất xác minh lúc **05:26 Việt Nam**.

| Bản | File từ repo | MiB |
|---|---|---:|
| Windows x64 | `dist/akaAgent-Setup-8.3.0.exe` | 112.8 |
| macOS ARM64 | `dist/akaAgent.dmg` | 137.4 |
| macOS Intel | `dist/akaAgentIntel.dmg` | 144.3 |

Chạy lần lượt `npm run build:win`, `npm run build:mac`, `npm run build:mac:intel` để tránh dùng lẫn native SQLite. Hai typecheck đều qua. Cả ba bộ cài khớp phiên bản và 110 file compiled của từng lượt build. Windows qua installer contract, giải nén payload và xác minh executable/native PE x64. Hai bản Mac qua kiểm tra chữ ký ad-hoc, kiến trúc, chạy SQLite đóng gói và verify/mount DMG chỉ đọc để đối chiếu payload. Native module của máy build đã khôi phục đúng checksum.

Chỉ build local; **chưa upload/phát hành hoặc đổi updater trên DB**. Windows chưa ký chứng thư; macOS dùng ad-hoc, chưa notarize theo cấu hình hiện có. Chưa chạy installer trên Windows thật hoặc thực hiện chiến dịch Facebook thật trong lượt build này. V379/V380/V381 đã apply trước đó, không apply lại.

## App Server

Không cần build App Server cho đợt thay đổi này. Đã đối chiếu từ commit của [bản Server 8.2.0 sau PR #479](audits/akaagent-8.2.0-20261010/rebuild-pr479-receipt.json), `55760cad7ced7f85a01f5139e4215b0fa426c21a`, tới commit build hiện tại: thay đổi nghiệp vụ là link bài/comment Facebook; phần còn lại là chẩn đoán khi người dùng mở giao diện Desktop và nhãn media. Server chỉ nhận account Zalo Server qua `shouldProcessAccountForRuntime()`, không chạy các nhánh Facebook. Không thay luồng thực thi Zalo Server.

File `dist-server/akaAgent-Zalo-Server-Setup-8.2.0.exe` được giữ nguyên, SHA256 `f98624566755fab38a3f190a7e44ca02ddd8dea7582ee8406a203d43563f6744`. Không build, deploy hoặc phát hành Server trong đợt này.

## Bằng chứng

- [Build receipt](audits/akaagent-8.3.0-20261013/build-receipt.json): source commit, thời gian, SHA256, kích thước và kết quả xác minh từng bộ cài.
- Manifest local: `dist/build-8.3.0-manifest.json`; checksum: `dist/build-8.3.0-SHA256SUMS.txt`; log/metadata updater riêng từng target: `dist/build-8.3.0-logs/`.
- DMG 8.2.0 và metadata cũ bị trùng tên đã sao lưu có checksum tại `dist/archive/before-8.3.0-20261013-052106/`. Installer Windows 8.2.0 và các build trước giữ nguyên.
- Toàn bộ source đầu vào và các thay đổi local có sẵn được đối chiếu checksum sau đóng gói; chỉ cập nhật tài liệu trạng thái V379/V380 sau khi kiểm chứng xong. Ba file khai báo phiên bản đã được commit/push lên `dev_3` trong `0d17076c`; tài liệu này lưu bằng chứng của bộ cài đã kiểm chứng trước commit đó.

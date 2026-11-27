# Build akaAgent 10.9.0 — 27/11/2026

Anh yêu cầu "ok bắt đầu deploy và build đi" (27/11): build Desktop (Windows x64, macOS ARM64, macOS Intel) và App Server nội bộ từ `dev_3`
mới nhất, cùng đợt deploy ChatApi, Chat Web, Web. Số liệu đầy đủ ở [build-receipt.json](build-receipt.json).

## Kết quả

| Bản | Tệp | Byte | SHA-256 |
|---|---|---|---|
| Windows x64 | `akaAgent-Setup-10.9.0.exe` | 153.567.540 | `d4fb2c369adca45a5af8c47319cc2c6400d40757d8368b611aae0218dab2dc40` |
| macOS ARM64 | `akaAgent.dmg` | 183.300.665 | `9a41c89c5ba829b4a71939282abd1cccc86a0b16630f5e0d9fb6fb9fae8666fb` |
| macOS Intel | `akaAgentIntel.dmg` | 190.474.030 | `66f9f5aeab1b83f112a01986fb12c5630a8f7ece66d608a926df7031120a8e47` |
| App Server Windows x64 (nội bộ) | `akaAgent-Zalo-Server-Internal-Setup-10.9.0.exe` | 140.676.766 | `6fdab4bb1dc0ef4089b4a35ad58a986a8394e8a765d2ca7595d269913958b4b3` |

- Nguồn: worktree `release-10.9.0`, nhánh `codex/release-10.9.0` `1e2690fb` (chỉ đổi version), nền `dev_3` `e076fca9` (sau #835).
- Build 17:27:30–17:33:24 VN; đầu vào build (2.136 tệp) không đổi trước / sau.
- Bộ cài Desktop ở `dist/build-10.9.0/` của repo chính; App Server ở `dist-server/` (bản gốc + kiểm ở
  `dist-server/private/2026-11-27T10-32-24-784Z/`). Bằng chứng ở `dist/build-10.9.0-work/`.
- **Desktop đã phát hành** (anh tự tải lên): feed ba nền tảng trả 10.9.0, bộ cài trên akabiz.net tải lên 17:46 VN, cùng số byte với bản build
  (chỉ so số byte). 20:31 VN có 13 nhân viên chạy 10.9.0 (2 Mac, 11 Windows; máy đầu tiên 17:50 VN).
- **App Server chưa cài VPS** (chưa kiểm). Bộ cài có sẵn khoá backend: chỉ cài lên VPS, không phát hành.

## Mới so với 10.8.0 lần 2

- #825 lịch tuần / tháng bắt buộc ngày kết thúc hợp lệ, tới ngày đó chiến dịch dừng hẳn (form Desktop; V674 đã apply).
- #826 Bot sự kiện (V672): Desktop và App Server chạy bot, trang Web nhúng `?embed=desktop`.
- #829 DAT04 / EXC06 thay EXC02 hàng loạt (UID của tài khoản khác, đọc hồ sơ Zalo không ra; V676 / V677 đã apply).
- #830 lô chia sẻ Zalo không in dòng ⚠️ cho lỗi lẻ phía người nhận.
- #833 App Server ghi `[ServerHealth]` mỗi phút vào `server.log`.
- #835 tài khoản không kẹt "đang chạy" khi còn dấu giữ lượt cũ (V681 + bộ lập lịch Desktop / App Server).
- #822 "Lý do đang chờ" của "Chạy cùng lúc"; #818, #820, #823 chỉ dữ liệu DB; còn lại là tài liệu / biên nhận.
- Gói App Server có 19 tệp đổi so với App Server 10.8.0 (`5f91bbfc`): Bot sự kiện (#826), đo sức khoẻ (#833), V681 (#835), lô chia sẻ
  (#830), EXC02 (#829) và Cách A tự gửi theo tag Zalo (#812, có trong Desktop 10.8.0 lần 2 nhưng App Server 10.8.0 chưa có).

## Kiểm

- Hai typecheck sạch. Hậu kiểm ba bộ cài Desktop đạt: version trong ASAR / `resources/version.txt` / PE / Info.plist, kiến trúc, quét khoá bí
  mật, payload NSIS và DMG khớp app, SQLite trong app Mac chạy được, 11 bộ cài cũ giữ checksum. Đối chứng dấu nguồn là bundle 10.8.0 lần 2.
  App Server: payload khớp, khoá backend chỉ có trong bản nội bộ (quét 5.574 tệp).
- Bộ kiểm 200 bước: 170 đạt, 30 hỏng đã giải thích.
  - 26 bước hỏng cùng lý do với 10.8.0 lần 2.
  - `run-campaign-schedule-ai-ui-smoke.cjs`: bài kiểm viết trước #825. Dữ liệu mẫu có ngày kết thúc 21/10/2026 (form báo "Ngày kết thúc đã
    qua") và có ca xoá ngày kết thúc lịch tuần (form báo "Vui lòng chọn ngày kết thúc."). Form làm đúng #825. Bản chép
    `patched-schedule-ai-clock/` đặt đồng hồ trang thử về 14/10/2026 và bỏ ca xoá: đạt.
  - `fb-v663-smoke`: hai ca theo thời gian hỏng khi máy đang chạy nặng; chạy lại lúc máy rảnh 66/66.
  - `schedule-end-ui-fuzz` (mới, #825): bản WebApp dùng để kiểm thiếu `scripts/campaign-schedule-end-fuzz`; thêm thư mục đó thì đạt.
  - `event-bot-v672-sql` (mới, #826): mảng rỗng dưới `set -u` hỏng trên bash 3.2 của Mac; bản chép `bash32/` đạt.
- 22 bước chạy lại bằng bản chép đã vá hoặc đúng môi trường: đều đạt (bản chép cũ `patched-schedule-ai/` thay bằng `-clock`).
- Bộ kiểm dừng giữa chừng lúc 17:58 VN (phiên chạy nền kết thúc), chạy tiếp bằng `run-checks-rest.sh`; xong 20:08 VN.

## Lưu ý

- Bộ cài được phát hành lúc 17:46 VN, trước khi bộ kiểm chạy xong. Không bước nào chỉ ra lỗi của app.
- Windows chưa ký Authenticode, chưa chạy trên Windows thật. Mac ký ad-hoc, chưa notarize.

# Build lại akaAgent Desktop 10.8.0 (lần 2) — 27/11/2026

Anh yêu cầu "build lại app bản 10.8.0" sau khi merge #817, rồi chốt qua hộp chọn: **giữ số 10.8.0** và **chỉ build Desktop**.
Số liệu đầy đủ ở [build-receipt.json](build-receipt.json). Lần 1 (tối 26/11): [akaagent-10.8.0-20261126](../akaagent-10.8.0-20261126/README.md).

## Kết quả

| Bản | Tệp | Byte | SHA-256 |
|---|---|---|---|
| Windows x64 | `akaAgent-Setup-10.8.0.exe` | 153.534.337 | `597ebec643341c7cdacd2d7e166fc1dab1ba4ce2658f51eb29d8f191125b1536` |
| macOS ARM64 | `akaAgent.dmg` | 183.261.861 | `7ba6c4779804244891d291a533ca3304dc59ac4dc8717585e3ecd622df66ea01` |
| macOS Intel | `akaAgentIntel.dmg` | 190.420.663 | `4681e51a49d17e9cecc6f0db7911a86de65f79f4ddea84b0dabc97c3dd216b64` |

- Nguồn: worktree `release-10.8.0-r2`, nhánh `codex/release-10.8.0-r2` = `origin/dev_3` `f69fbe3c` (sau #817). Không có commit đổi
  version (10.8.0 đã vào `dev_3` qua #814).
- Build 06:15:02–06:18:18 VN; đầu vào build (2.087 tệp) không đổi trước / sau.
- Bộ cài nằm ở `dist/build-10.8.0/` của repo chính. Bộ cài lần 1 cất ở `dist/build-10.8.0-r1-581826a0/` (không xoá); bằng chứng lần 1 ở
  `dist/build-10.8.0-work/r1-581826a0/`.
- Chưa tải lên, chưa đổi feed: anh tự phát hành.

## Mới so với lần 1

- #817 số đoạn chat chưa đọc trên menu Tin nhắn Facebook.
- #812 Cách A tự gửi cho người được gắn tag Zalo, kể cả người chưa là bạn bè (V669 / V671 đã apply 21:46 VN 26/11). Bản lần 2 không còn mã
  `err_engine_zalo_tag_not_friend` trong main.
- #811, #813, #814, #815, #816: chỉ tài liệu / biên nhận.

## Lưu ý

- **Máy đang chạy 10.8.0 lần 1 không nhận lần 2 qua bộ cập nhật** (cùng số bản). 24 giờ tới 06:1x VN 27/11 có 16 nhân viên chạy 10.8.0.
  Chỉ máy còn bản cũ hơn và máy cài mới nhận lần 2.
- **App Server không build lại** (anh chốt). Gói App Server có 7 tệp đổi so với App Server 10.8.0 đang ở VPS, đều của #812 Cách A
  (`campaignScheduler.ts`, `zaloTagSyncRuntime.ts`, lõi engine): tài khoản Zalo Server trên VPS chưa có Cách A. Việc này anh giao dung688 (26/11).
- Thư mục `dist/build-9.x … 10.7.0` và `dist/build-10.x-work` của repo chính đã bị xoá giữa 21:31 VN 26/11 (lần 1 ghi nhận 99 bộ cài) và
  06:14 VN 27/11 (còn 8), không do lượt build này. Hậu kiểm vì vậy chỉ kiểm được dấu nguồn giữ từ 9.9.0 và dấu của 10.8.0 lần 1.

## Kiểm

- Hai typecheck sạch. Hậu kiểm ba bộ cài đạt: version trong ASAR / `resources/version.txt` / PE / Info.plist, kiến trúc, quét khoá bí mật,
  payload NSIS và DMG khớp app, SQLite trong app Mac chạy được, bộ cài cũ giữ checksum. Đối chứng là bundle của lần 1 (dmg `2e399ebf…`).
- Bộ kiểm 186 bước: 157 đạt, 29 lỗi đã giải thích; 27 lỗi giống hệt lần 1. Hai lỗi mới:
  - `multi-slot-v585-smoke`: bài này hỏng nếu chạy trước 08:00 VN, và lần này chạy lúc 06:33. Bản chép bỏ ca 6 thì đạt.
  - `server-rest-smoke-patched`: bản chép bài kiểm thiếu hai hàm giả của #805 / #810. Thêm vào thì 19/19 đạt.
- 20 bước chạy lại bằng bản chép đã vá hoặc môi trường đúng: đều đạt.
- Các bài "bản chép" chép từ lần 1 ghi cứng đường dẫn worktree lần 1. Lượt kiểm đầu chạy chúng trên code lần 1; em đã sửa đường dẫn và chạy
  lại 8 bài trên code lần 2 (`03-checks-patched-r2.log`). Kết quả ghi trong biên nhận là của lượt chạy lại.

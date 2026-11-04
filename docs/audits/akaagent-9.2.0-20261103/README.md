# Build akaAgent Desktop 9.2.0 — 03/11/2026

Đã build Windows x64, macOS ARM64 và macOS Intel x64 từ repo chính
`/Users/lequangnhut/Repos/akaAgent`, nhánh `dev_3`, commit
`d493dd9e3b2dde04ffb73afaed8c3ddbd64dc178`; không dùng worktree.
Metadata `package.json`, `package-lock.json` và `version.txt` đã là 9.2.0 từ lượt
build Server trước đó. Lượt này không sửa source runtime hoặc dependency.

Build tuần tự từ 05:56:58 đến 06:00:41 ngày 03/11/2026 giờ Việt Nam bằng các
wrapper hiện có: `npm run build:win`, `npm run build:mac`,
`npm run build:mac:intel`. Hậu kiểm hoàn tất lúc 06:02:08.

## Bộ cài

| Nền tảng | File trong `dist/` | Byte | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `akaAgent-Setup-9.2.0.exe` | 152718389 | `eff1d64b821c8c7ca79dca1deb3eec9a4af5c3af29973f50c11a11f7892b195c` |
| macOS ARM64 | `akaAgent.dmg` | 182621257 | `f050be790fddab03c119c25efad3963561997cc5aa7a6496cfe149472693c128` |
| macOS Intel x64 | `akaAgentIntel.dmg` | 189812901 | `969f54c7fbc7d01d1e3f755762563b0cfebfa1e81c6d574c06bb05cae67d13cf` |

Bản lưu theo version, `SHA256SUMS` và receipt nằm trong `dist/build-9.2.0/`.
Mỗi bộ cài ở `dist/` cũng có file `.sha256` đi kèm.
[Receipt kiểm chứng](build-receipt.json) ghi đường dẫn đầy đủ và kết quả từng bản.

## Kiểm chứng

- Hai typecheck node/preload/shared và renderer chạy mới, đều đạt.
- Ba production build và installer contract đạt. Giữ identity `aka-biz-auto`,
  app ID `com.akabiz.auto`, entrypoint Desktop `./out/main/index.js`.
- Version package/resource/PE hoặc Info.plist đều 9.2.0. 108 file output trong
  mỗi ASAR khớp output local; 1.085 build inputs giữ nguyên checksum trong lượt.
- Windows wrapper xác nhận native x64; verifier giải nén installer, so sánh
  executable, ASAR, SQLite native và version với `win-unpacked`.
- Hai Mac đúng kiến trúc executable/native; chữ ký ad-hoc và DMG checksum đạt.
  Mount DMG read-only xác nhận payload. Packaged Electron nạp SQLite và thực hiện
  truy vấn trong bộ nhớ thành công; bản Intel chạy qua Rosetta trên host ARM64.
- Desktop không chứa thư mục credential Server, backend key thực tế hoặc anon
  token từng nhúng trong source. Không đưa giá trị credential vào log/audit.
- Native host được khôi phục đúng checksum; Electron 33.4.11 ARM64 nạp SQLite và
  `SELECT 1` đạt. Bộ cài cũ cùng file người dùng giữ nguyên.

## Giới hạn và trạng thái bàn giao

Windows chưa có chữ ký Authenticode và chưa được cài/chạy trên Windows thật.
Mac chỉ ký ad-hoc, chưa Apple notarization; chưa kiểm tra trên phần cứng Intel
thật. Không khởi động runtime nghiệp vụ, gửi tin hoặc chạy chiến dịch thật.

Đây là build local, chưa upload/phát hành hoặc cập nhật feed. Không apply DB,
không kích hoạt V447, không deploy service/CRM trong lượt này. Tại mốc bàn giao
build, metadata version và audit lưu local, chưa commit/push. Server 9.2.0 được build ở lượt riêng;
xem [audit Server](../akaagent-server-9.2.0-20261103/README.md).

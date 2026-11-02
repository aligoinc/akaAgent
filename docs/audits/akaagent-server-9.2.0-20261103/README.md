# Build akaAgent Zalo Server 9.2.0 — 03/11/2026

Đã build Windows x64 nội bộ từ repo chính `/Users/lequangnhut/Repos/akaAgent`, nhánh `dev_3`, commit `5df2678f3ae4e26fd97dc6a168d24dc6192b920f`; không dùng worktree. Repo đã fetch và khớp `origin/dev_3`. Chỉ cập nhật metadata version trong package.json, package-lock.json và version.txt lên 9.2.0; không đổi dependency/source runtime.

Dùng wrapper `npm run build:server:win:private`, publish never. Bộ cài nằm trong thư mục private bị Git ignore; credential server-only nằm ngoài ASAR và không có trong source/JS/Desktop/renderer. Không upload hoặc phát hành công khai.

[Receipt và SHA-256](build-receipt.json) ghi đường dẫn bộ cài, kích thước, commit và chứng cứ. Hai typecheck đạt; Server main/preload/renderer production build và installer contract đạt. Verifier giải nén installer để so sánh payload, xác nhận executable/native PE x64, main bundle khớp build, version package/resource/PE đều 9.2.0, loader đọc credential trên profile sạch (VM cô lập). Smoke chọn key 14 ca đạt. 895 build inputs giữ checksum, 12 bộ cài Server cũ và file người dùng giữ nguyên.

Native host được wrapper khôi phục đúng checksum; Electron 33.4.11 ARM64 nạp SQLite và SELECT 1 thành công. Installer và executable chưa có chữ ký Authenticode. Chưa cài/chạy trên Windows thật; không khởi động Server production hoặc chạy chiến dịch/Zalo thử nghiệm.

Build này không đổi DB, không kích hoạt V447, không build/phát hành Desktop 9.2.0 và không deploy CRM. Tại mốc bàn giao build, metadata version và audit mới lưu local, chưa commit/push.

## Xác nhận cài đặt của người dùng

Ngày 03/11/2026, người dùng xác nhận “đã cài app server mới rồi”. Đây là xác nhận của người dùng; agent chưa kiểm tra trực tiếp phiên bản/process trên máy chủ Windows. Xác nhận này không thay đổi điều kiện phát hành Desktop hoặc cấp quyền kích hoạt V447.

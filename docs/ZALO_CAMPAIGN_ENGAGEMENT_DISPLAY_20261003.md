# Tương tác Zalo: chỉ hiển thị dấu đã ghi nhận — 03/10/2026

Theo yêu cầu người dùng, cột Tương tác Zalo trên Desktop/Web để trống khi không có dấu. Bỏ các nhãn Không áp dụng, Không theo dõi, Chưa ghi nhận và Hết thời gian theo dõi trong ô kết quả. Chỉ hiện Đã xem, Đã phản hồi, Đã thả cảm xúc, Đã kết bạn cùng thời điểm; dấu lịch sử vẫn hiện khi hết hạn. Bộ lọc Chưa ghi nhận và dữ liệu Excel giữ nguyên.

Sửa duy nhất formatter `engagementDisplay` trong shared contract, đồng bộ cả ba repo. Không thay runtime/SQL/setting hay cơ chế gửi. Desktop chưa phát hành installer mới; bản sao Chat được giữ đồng bộ source, không cần deploy lại worker/runtime cho formatter UI không dùng tại đó.

## Web production

- URL: https://agent.akabiz.net.
- Machine cũ `48ee749f357398`; update 2026-10-02T17:18:24Z (00:18:24 ngày 03/10 giờ Việt Nam), instance `01M3YSZE3XJ5TV7QSDBPWWQMGD`.
- Image `registry.fly.io/aka-agent-web-app:engagement-marks-only-20261003@sha256:58669f8c42d7d659f1aa1f1336de21b2d45bec596223cd7d368b5296e2c5976b`.
- Chỉ `config.image` thay đổi; số machine, CPU/RAM, môi trường và cơ chế connection giữ nguyên. Không migration/reload schema hay đổi công tắc enabled.
- Frozen context lấy nguyên build vừa deploy trước đó, chỉ thay formatter và fixture E2E. Không đưa thay đổi mobile/iOS khác vào image.
- API bundle SHA-256 giữ nguyên `992df6a0c21553bdf73faeeca3f446bf112dfbeda46ac4bbece052267164e309`. Main JS mới `/assets/index-Bd5j13OD.js`; HTTP HTML/JS khớp hash file đang chạy.

## Kiểm chứng

- Main node/renderer typecheck, Chat typecheck và Web typecheck/build PASS. Shared contract ba repo byte-identical.
- Desktop Electron UI và core smoke PASS: ô trống, bốn dấu, bộ lọc, Excel đủ 200 dòng, 1600/850px; HTTP bị chặn.
- Web toàn suite: 1.544 PASS, 1 fail ở test render-count cũ `CampaignFormPage > cập nhật tiến độ theo chunk mà không render lại form` (39 thay vì 38), cùng hiện tượng đã ghi ở audit trước. Chạy riêng toàn bộ file: 104/104 PASS; không sửa/nới test đó.
- Ba Playwright fixture trên assets production PASS: Desktop Chromium, Android Chromium, iPhone WebKit; kiểm tra ba ô không có dấu đều trống, bốn dấu vẫn có, bộ lọc none vẫn trả dòng trống, xuất đủ 996 dòng lọc. API/WebSocket bị intercept, không gửi Zalo hoặc đăng nhập khách hàng.
- Health 200, trang chủ 200, API thiếu xác thực 401; diff check ba repo PASS.

Rollback Web về image trước `registry.fly.io/aka-agent-web-app:campaign-engagement-20261002@sha256:6b3ce5846cf84b3acc1ea221ea19ba5034f12c12803e8ae627f988232ffd51e7` bằng cách chỉ thay image trên cùng machine. Không thay DB hoặc runtime. Evidence local: `/tmp/engagement-marks-only-20261003`; logs `/tmp/engagement-blank-*`.

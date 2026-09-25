# Log và note khi áp dụng policy Zalo

Desktop và app Zalo Server dùng chung `CampaignScheduler`. Bản sửa bổ sung log nguyên nhân cho share batch, gồm policy không tạo detail, và lý do dừng sau target/batch. Các lỗi có cùng nội dung trong một batch chỉ thêm một dòng tiến trình; detail từng target và dòng kết quả tổng hợp giữ nguyên.

Giữ nguyên nội dung log cũ, đặc biệt `✅ Hoàn thành` và thông báo pause chung. Không đổi quota, bộ đếm, policy scope, claim/settle, requeue, chống gửi trùng hoặc xử lý target-only của batch có cả thành công và thất bại.

`logCampaignProgress` nhận được campaign khi caller đã có đối tượng này. Nếu append DB thất bại, event realtime vẫn mang `accountId`/tên tài khoản và campaign để không bị bộ lọc tài khoản loại bỏ. Không thêm query lấy context, cache/timer hay connection. Caller chỉ có ID vẫn được hỗ trợ.

Khóa hành động mới ghi thông báo campaign đầy đủ vào `disabled_reason`. Nhờ đó Chat preclaim đọc lại cùng lý do và giữ phần hướng dẫn xử lý. Không đổi lịch mở khóa; không tính lại hoặc backfill các khóa đã tồn tại. Chat cần phát hành worker cùng database package chứa thay đổi tương ứng.

Không thay cơ chế live-only sau reconnect, giới hạn lịch sử, reset note theo lịch hoặc dữ liệu policy. Không có migration hay RPC mới.

Kiểm chứng local, không gửi Zalo hoặc ghi production:

```sh
node scripts/zalo-policy-progress-smoke-test.cjs
node scripts/zalo-policy-days-at-time-smoke-test.cjs
node scripts/campaign-empty-share-smoke-test.cjs
node scripts/zalo-rich-share-smoke-test.cjs
node scripts/campaign-failure-cleanup-smoke-test.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
npm run build:server
```

Smoke mới kiểm tra policy không có detail, log share bị thiếu, dedupe trong batch, giữ nguyên log đường chạy thường, context khi DB append lỗi và lý do khóa đầy đủ. Những smoke còn lại bảo vệ quota/scope, thời gian khóa, các nhánh kết thúc batch và cleanup không gửi lại.

## Rà soát bổ sung: lý do dừng phải còn ở trạng thái cuối

Đợt rà soát sau PR #440 kiểm tra note sau bước kết thúc lượt, thay vì chỉ kiểm tra có lệnh ghi log. Đã sửa các trường hợp:

- Đủ ngưỡng lỗi: `handleCampaignBadTarget` truyền note riêng gồm số data lỗi, ngưỡng và nguyên nhân sang `applyRuntimeErrorPolicy`. Log policy cũ giữ nguyên; kết quả trả về cho batch cũng giữ note đầy đủ. Khi lỗi engine chỉ có `message`, dùng nguyên nhân này thay cho thông báo `Có lỗi xảy ra`; chẩn đoán/safe message vẫn được ưu tiên.
- Policy trùng với yêu cầu pause: chuyển lý do dừng từ target/batch vào helper hoàn tất pause. Pause thủ công không có policy giữ hành vi cũ; Server vẫn giữ trạng thái/note campaign đã được điều khiển trước đó.
- Policy 600: bước dừng vì tài khoản đăng xuất giữ phần hướng dẫn đăng nhập lại trong note, đồng thời giữ log đăng xuất hiện có.
- Khóa có trước lượt chạy: chỉ thêm log `Chưa thể chạy chiến dịch` khi CAS cập nhật note thành công. Cùng lý do không ghi lại ở mỗi nhịp; CAS thất bại không phát log chặn sai cho owner mới.

| Nhánh | Kiểm chứng |
|---|---|
| Lỗi 1–4, lỗi thứ 5 | Smoke gọi bộ đếm + áp policy thật, kiểm tra note cuối có số/nguyên nhân và log cũ còn nguyên |
| Pause sau policy, Desktop/Server | Smoke gọi helper kết thúc lượt thật và kiểm tra note sau cùng; pause thường vẫn như cũ |
| Page inbox 5 lỗi → chạy lại một lần → 10 lỗi | Smoke giữ quy tắc hiện có, note ngưỡng cuối đầy đủ |
| Khóa trước khi claim | Kiểm tra CAS thành công/thất bại và số log phát ra |
| Policy 600 | Kiểm tra note hướng dẫn còn sau account guard, log cũ giữ nguyên |
| 120/802/223, share, quota, cleanup | Smoke days-at-time, rich-share, empty-share và failure-cleanup hiện có |

Test dùng method runtime thật với adapter cục bộ; không phải chiến dịch Zalo thật. Chat có kiểm chứng xuyên executor → SQL bộ đếm PGlite → scheduler cho cả target và batch. Không sửa lịch maintenance, giới hạn lịch sử hoặc cách nhận log sau reconnect; các ranh giới vòng đời/quyền điều khiển mới vẫn có quyền đổi trạng thái/lý do dừng. Không có migration.

Kết quả local 26/09/2026: hai typecheck PASS; build Desktop/Server PASS; năm smoke ở trên PASS. Đối chiếu AST xác nhận 171 lời gọi log có template trong scheduler giữ nguyên template cũ.

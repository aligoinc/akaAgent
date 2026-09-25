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

# Cache catalog policy kết quả 60 giây

Thay đổi ngày 10/10/2026, chuẩn bị trong worktree riêng trên akaAgent `0b315a33`
và akaAgentChatApi `07ceb4b` sau khi fetch các nhánh gốc. Chưa deploy, chưa đóng
gói/phát hành bộ cài mới; không có migration hay thay đổi dữ liệu production.

## Phạm vi

Giữ nguyên chỗ lấy catalog khi nhận/phục hồi một lượt chạy. Hàm lấy catalog
dùng cache RAM chung, thời hạn 60 giây kể từ khi đọc và dựng catalog thành công.
Hết hạn thì lần bắt đầu lượt tiếp theo mới tải lại. Các yêu cầu đồng thời cùng
chờ một promise, kể cả khi catalog có nhiều trang. Không có polling hoặc timer
tải định kỳ; chỉ có deadline cho một đợt đọc HTTP đang thực hiện.

- Local và packaged Zalo Server dùng một cache trong mỗi process, chung giữa
  các staff runtime. Chỉ cache bốn catalog toàn hệ thống: `auto_status`,
  `auto_account_action_status_policies`, `auto_error`, `auto_account_actions`.
- Chat chia sẻ cache theo đúng Kysely client đang có bằng `WeakMap`; các
  repository dùng cùng client cùng chia sẻ một lượt đọc. Client/DB khác nhau
  không chia sẻ dữ liệu hoặc promise. Worker production tiếp tục dùng pool cũ.
- Cache không giữ campaign, target, token hoặc bộ đếm. RAM của từng lượt vẫn
  giữ catalog đã nhận như trước. Refresh thay bản cache, không sửa bản cũ.
- Mỗi lượt vẫn chạy preflight theo action/declaration của chính lượt đó,
  kể cả khi lấy catalog từ cache. Cache không ghi nhớ kết quả preflight của
  một action để cho phép action khác.
- Theo yêu cầu sau review, nếu tải/mapping/kiểm tra cấu trúc thất bại thì giữ
  nguyên **catalog hoàn chỉnh đã tải thành công trước đó** để tiếp tục dùng.
  Không trộn dữ liệu mới đọc dở vào bản cũ. Chờ ít nhất 60 giây tính từ lúc lỗi,
  rồi lần cần đọc tiếp theo mới thử lại; trong khoảng chờ, không query thêm.
- Chưa từng tải thành công thì không có bản dự phòng: lỗi đi về đường xử lý
  hiện có, vẫn chờ 60 giây trước lần đọc lại. Không tự chế policy hoặc thêm
  queue/retry nền/câu note/log mới.
- Local/Server giới hạn **toàn bộ đợt đọc HTTP** ở 60 giây, dùng chung
  `AbortController` cho mọi bảng/trang. Deadline hoặc một bảng lỗi sẽ hủy các
  request còn lại và dọn timer, để cache có thể trả bản cũ và thử đợt sau.
  Không dùng `Promise.race` để bỏ rơi request. Chat tiếp tục dùng giới hạn
  checkout SQL có sẵn trong client/pool, không thêm timeout hay pool riêng.
- Tải thành công một policy đang tắt/thiếu policy cho action vẫn bị chặn bởi
  preflight như trước. Chỉ lỗi tải/dựng catalog dùng bản dự phòng, không dùng
  bản cũ để né cấu hình đã được đọc thành công.

Ví dụ: A bắt đầu ở giây 0 tải DB; B/C bắt đầu ở giây 10/50 lấy RAM; D bắt đầu
ở giây 65 tải lại. A/B/C vẫn dùng bản đã lấy cho hết lượt. Nếu không có lượt
mới thì không phát sinh lượt tải dù đã qua 60 giây. Nhiều máy/process có cache
riêng; đây không phải cache toàn hệ thống dùng chung giữa các máy.

**60 giây là thời hạn tái sử dụng dữ liệu cho lượt bắt đầu mới, không phải
cam kết cập nhật policy của chiến dịch đang chạy mỗi phút.** Việc thay đổi
policy giữa một lượt chạy không nằm trong thay đổi này. Đây là tối ưu đọc DB;
preflight, thao tác, chọn/áp dụng policy, writer, settlement, retry, input,
note/log và lịch sử giữ nguyên luồng hiện có. Những RPC không thuộc đường đọc
catalog này tiếp tục giữ nguyên truy vấn/guard của chúng.

## Kiểm chứng

- `node scripts/action-status-catalog-cache-smoke.cjs`: 9 nhóm kiểm tra đạt;
  30 lượt trên nhiều staff chia sẻ đúng 5 request (2 trang status + 3 bảng),
  đủ dữ liệu mới công bố cache, TTL chính xác, dedupe, lỗi đọc/validation,
  clock lùi, fallback/backoff 60 giây, fixture xác nhận AbortSignal hủy mọi
  request bị treo, giữ catalog đang chạy và parity code cache với Chat.
  Test HTTP dùng transport giả lập, không gọi mạng thật.
- `node scripts/action-status-policy-smoke.cjs`: 35 kiểm tra đạt.
- `node scripts/action-status-runtime-smoke.cjs`: 22 kiểm tra đạt, dùng SQL
  PGlite và adapter runtime Local/Chat; không có thao tác ngoài hệ thống.
- Chat `campaignActionResults.cache.test.ts`: 7 test đạt, thực thi SELECT thật
  trên PGlite; concurrent repositories, expiry, preflight riêng, refresh lỗi,
  catalog sai, cold failure, policy mới bị tắt và tách biệt hai DB client.
- Chat `actionStatusPolicies.integration.test.ts` và
  `zaloCampaignScheduler.test.ts`: 171 test đạt.
- Hai typecheck akaAgent, typecheck/build Chat, `npm run build` (Local) và
  `npm run build:server` đều đạt. Build Local có cảnh báo Vite về module được
  import cả tĩnh và động; không có lỗi build. Không tạo installer hoặc triển
  khai production trong bước này.

Các con số request trên là test offline có kiểm soát, không phải benchmark
latency hoặc load test production. Mỗi cache miss vẫn dùng nguyên query và
phân trang hiện tại; số request phụ thuộc số trang thực tế. Cache hit không
gọi DB. Không tăng pool, connection, process hay replica.

## Phát hành và hoàn nguyên

Cần phát hành binary Local/packaged Server và deploy Chat worker có package
database mới để dùng cache. Không cần migration/reload schema, đổi block hoặc
workflow. Chưa làm các bước phát hành trong thay đổi này.

Hoàn nguyên code cache đưa việc đọc catalog về mỗi lượt như trước. Không có
dữ liệu/schema cần rollback, không tính lại detail hoặc bộ đếm lịch sử.

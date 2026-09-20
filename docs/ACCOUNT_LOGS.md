# Lịch sử tài khoản

`public.auto_account_logs` chỉ phục vụ tra lỗi bằng quyền quản trị Supabase. Không có UI, foreign key, trigger, backfill hay tự xóa. Không đọc bảng này để quyết định nghiệp vụ. Migration: `migrations/migration_v292_auto_account_logs.sql`.

## Dữ liệu

Giữ đúng 10 cột đã thống nhất: `id`, `created_at`, `account_id`, `campaign_id`, `login_status`, `account_status`, `source`, `event_type`, `message`, `details`. `created_at` do runtime chụp trước khi gửi, không phải thứ tự request tới DB; khi cần đối chiếu xem thêm `id`.

Trạng thái, nguồn và loại sự kiện là text tự do. Logger không giới hạn tập giá trị. Trạng thái chưa xác định để `NULL`, không suy đoán từ kết quả RPC chỉ trả boolean hoặc số lượng. `campaign_id` là chiến dịch liên quan nếu nơi phát sinh biết được context.

`source` phản ánh tiến trình phát log: `desktop`, `zalo_server`, `chat_api`. Cùng tài khoản có thể có log từ nhiều nguồn. Yêu cầu dừng (`*_pause_requested`) khác với runtime đã hoàn tất lượt đang chạy (`campaign_paused`). Log `campaign` ghi nhận trạng thái DB, không khẳng định producer đã dừng ngay.

## Ghi log

- `src/shared/accountLog.ts`: hợp đồng chung, chụp payload, lọc thông tin nhạy cảm, timeout 5 giây. Bản tương ứng trong Chat API là `packages/database/src/accountLogContract.ts`; giữ hai file giống nhau.
- `src/main/services/accountLogService.ts`: `recordAccountLog(event): void`, dùng cho Desktop và Zalo Server; Supabase INSERT độc lập, không `.select()`.
- Chat API: `packages/database/src/accountLog.ts`, mỗi event gửi ngay một HTTP POST tới `aka_agent_record_account_log(jsonb,jsonb)`; PostgREST quản lý pool SQL, logger không tạo PostgreSQL connection theo event. Timeout/shutdown abort request, không chờ flush. Cấu hình public API mặc định chỉ bật khi `DATABASE_URL` khớp project production (direct host hoặc Supabase pooler username); DB local/khác không gửi log production. `CreateDatabaseOptions.accountLogHttp` cho phép chỉ định endpoint/key hoặc `null` để tắt.
- Mỗi event gửi một dòng ngay, không batch/retry/flush khi logout hoặc thoát. Bắt cả lỗi tạo payload, khởi tạo transport, DB, timeout và rejection đến muộn.
- Ghi trạng thái sau write thành công; Chat API chỉ gửi sau commit. Claim sai token, CAS không cập nhật hoặc transaction rollback không báo thành công.
- Context được chụp trước request; cache chỉ chứa metadata scalar theo ID, có giới hạn dung lượng, không chứa event chờ gửi. Polling giữ nguyên trạng thái không tạo thêm log trạng thái.
- Cache campaign cập nhật account/tên mới mỗi lần đọc, gỡ liên kết ở account cũ khi đổi account; đọc lại không tiêu thụ mốc so sánh trạng thái trước khi broadcast sau write.
- Dedupe cảnh báo Desktop/Server: polling account giữ baseline riêng; QR là sự kiện riêng theo từng lượt; mỗi listener giữ baseline riêng và reset khi phục hồi (kể cả cipher refresh không phát status) hoặc tạo instance mới. Lỗi serialize metadata không chặn listener delivery.
- Cảnh báo listener Chat API chụp staff/organization/runtime generation sau write thành công. RPC HTTP độc lập tìm campaign còn claim của đúng account/runtime, với thời điểm claim không mới hơn sự kiện; vẫn nhận campaign đang dừng mềm. Nếu claim đã được giải phóng hoặc session đã thay thế trước khi ghi thì để campaign NULL, không gán sang lượt mới. Phần lookup chỉ nằm trong request log, không thêm query vào transaction nghiệp vụ.
- Recovery RPC tổng hợp của Desktop/Server không trả ID từng row đã đổi: `runtime_recovery_observed` là quan sát trạng thái sau vòng phục hồi theo staff/subtype, không khẳng định từng row đã được reset. Truy vấn quan sát độc lập, timeout 5 giây, tối đa 1.000 tài khoản; không chặn recovery.

Các điểm tích hợp: cập nhật login/check/logout, claim/release thao tác, chuyển trạng thái chiến dịch/tài khoản, yêu cầu pause/resume, dừng tại ranh giới lượt chạy, cleanup lỗi, lỗi API Zalo, QR/listener và lỗi Data Scan. Không sửa akaBizApi; sự kiện chỉ có tại SMS/voice backend chưa được thu thập.

Chỉ nhận metadata chẩn đoán dạng scalar trong `details` (mã lỗi, API, action, tên chiến dịch, trạng thái trước, lý do). Không truyền raw error, request/response, nội dung hội thoại, cookie, session, token, password, IMEI; văn bản lỗi được rút gọn và che mẫu credential/URL. Đừng thêm payload nghiệp vụ vào lời gọi logger.

## Quyền truy cập

Bật RLS. `anon`, `authenticated`, `aka_agent_chat_api` chỉ có quyền INSERT các cột payload và USAGE sequence; không SELECT/UPDATE/DELETE. Policy kiểm tra account tồn tại và campaign nếu có thuộc account chính/phụ. Desktop/Server hiện dùng anon Data API với xác thực staff riêng; dữ liệu log vì vậy là telemetry không đáng tin để làm bằng chứng xác thực hay kiểm toán quyền. Tra cứu bằng quyền admin/service role.

Ví dụ tra cứu trong SQL Editor bằng quyền admin:

```sql
SELECT created_at, source, login_status, account_status,
       campaign_id, event_type, message, details
FROM public.auto_account_logs
WHERE account_id = 123 -- thay bằng ID cần kiểm tra
ORDER BY created_at DESC, id DESC
LIMIT 200;
```

## Kiểm chứng và phát hành

Schema phải được apply trước khi phát hành runtime mới. v292 tạo bảng; v293 thêm RPC HTTP chỉ ghi một dòng. Cả hai cần reload PostgREST vì đổi metadata API. Audit v293 và checksum: [ACCOUNT_LOG_HTTP_RPC_AUDIT.md](ACCOUNT_LOG_HTTP_RPC_AUDIT.md). Smoke SQL `migrations/tests/migration_v292_auto_account_logs_smoke.sql` luôn rollback, kiểm tra cấu trúc, trạng thái tương lai, ACL và policy.

Desktop: `node scripts/run-account-log-smoke-test.cjs`, `node scripts/zalo-server-session-restore-smoke-test.cjs`, hai typecheck, `npm run build`, `npm run build:server`.

Chat API: `npm run typecheck`, `npm run build`, Vitest `accountLog.test.ts`, `accountLogCommit.integration.test.ts`, `accountLogContext.integration.test.ts` và regression liên quan runtime/campaign/database. Test dùng mock/PGlite, không gọi Zalo thật.

Chấp nhận thiếu log do mất mạng, timeout, DB từ chối kết nối, thoát app hoặc nguồn chưa tích hợp. Không retry hay dùng bảng này làm nguồn quyết định nghiệp vụ.

### Kiểm chứng ngày 20/09/2026

- Đã apply production `akachat` / `cgjbsmqtfhqvttudyjzq`, lịch sử `20260920082633`, tên `v292_auto_account_logs`.
- SHA-256 migration: `74b7711462550f54e92389ae0170bbfd9ac11b7e42b094a6581ca38c909ab73b`.
- Smoke SQL rollback đạt; RLS bật, không lưu dòng thử nghiệm. REST anon đọc log và chèn account không hợp lệ đều trả `42501`/HTTP 401, xác nhận metadata API đã nạp.
- Smoke logger và 30 test session restore đạt; hai typecheck, build Desktop và Server đạt. Build còn cảnh báo DataScanModal vừa import tĩnh vừa import động đã có sẵn.
- Chat API typecheck/build và 8 file Vitest liên quan (184 test) đạt. Không gọi Zalo thật.
- Đây là rollout schema và build local; chưa phát hành installer hoặc deploy tiến trình Chat API/runtime mới.

### Sửa sau review cùng ngày

- Đã sửa cache account/tên campaign sau khi gán lại; giữ dedupe và mốc trạng thái cho broadcast.
- Thay giới hạn hai request bằng kết nối riêng cho từng event; test burst 25 event gửi đủ 25 request, lỗi/timeout và shutdown vẫn được cô lập.
- Listener Chat API tra campaign trong chính câu INSERT log, kiểm tra staff/org/generation/target/thời điểm claim. Test có nhiều staff, dừng mềm, đổi chiến dịch, đổi phiên và release claim.
- Hai typecheck Desktop, typecheck/build Chat API, build Desktop/Server, smoke logger và 30 test session restore đều đạt. Chat API: 192 test liên quan logger/campaign và 16 test repository tài khoản đạt (76 test ngoài phạm vi được filter bỏ).
- Không thay schema/quyền truy cập và chưa deploy runtime.

### Sửa transport HTTP và dedupe sau review

- Chat API dùng HTTP RPC cho từng sự kiện; giữ timeout 5 giây và gửi sau commit, không batch/queue/retry. Test burst 100 event xác nhận đủ 100 request được phát trước response đầu tiên.
- QR cùng hết hạn ở hai lượt được ghi hai dòng. Listener lỗi → phục hồi → lỗi lại và đổi listener đều có baseline mới; polling không đổi vẫn không sinh thêm log.
- Đã apply v293 lên production; smoke rollback và HTTP RPC trả 204 đạt, không lưu dòng thử nghiệm. Chi tiết signature/checksum/quyền ở audit liên kết trên.
- Runtime vẫn chỉ được build local, chưa deploy Chat API/worker hoặc phát hành installer mới.

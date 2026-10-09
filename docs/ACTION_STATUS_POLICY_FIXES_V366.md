# Sửa runtime policy trạng thái — V366

Ngày 09/10/2026, chỉ project **akachat / cgjbsmqtfhqvttudyjzq**. History đã apply: `20261009133014 / migration_v366_action_status_runtime_fixes`. Không apply lại V361–365.

Các lỗi đã sửa:

- Batch media giữ thứ tự thao tác: gửi thành công trước timeout được reset trước khi tăng lỗi; kết quả thành công ghi trong phần tổng kết không xóa các timeout đến sau. `badTargetResetBefore` là quyết định trong JSON snapshot hiện có, được settlement áp dụng một lần cùng transaction. Policy Thành công vẫn quyết định có reset hay không.
- Batch không có target thành công: khi đạt ngưỡng dừng, các detail còn lại vẫn được ghi, nhưng guard dừng tăng được lưu trong quyết định hiệu lực. Desktop/packaged Server kiểm tra ngưỡng ngay tại từng lần settlement.
- Email thành công được áp dụng reset theo policy; `countsTowardBadTarget=false` của helper chỉ miễn tăng lỗi, không vô hiệu reset thành công.
- Thiếu địa chỉ Email giữ miễn quota trước khi gửi, kể cả khi không có `errorCode`.
- Open/click đến trước liên kết được trigger mới chiếu sang `sub_status_id` khi liên kết. Trigger và callback cùng khóa tracking trước detail; click không bị hạ về open; cập nhật cùng giá trị không phát thêm cạnh Automation. Repository chỉ đổi text cho detail legacy có `status_id IS NULL`.

Kiểm tra thêm nhánh timeout không tạo detail: adapter managed giữ guard không requeue thao tác có kết quả chưa chắc chắn. Không đổi thông báo hiện có, không gửi lại để thử và không tính lại lịch sử.

## DB và tương thích

Không thêm bảng/cột/index, không sửa policy hoặc block/workflow. Thêm một trigger function và trigger trên `auto_email_message_trackings`, sửa body một RPC với signature giữ nguyên. Trigger dùng quyền invoker; không cấp thêm quyền client hay mở thêm connection. Payload settlement cũ thiếu field mới giữ hành vi cũ. Các guard claim/tenant/input, idempotency, policy và account quota của V363 được giữ nguyên.

Định nghĩa RPC được lấy trực tiếp live theo skill `safe-supabase-rpc-migration`, so với V363 và khóa bằng checksum/thuộc tính:

- `public.aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)`
- MD5 nguồn: `b2079cdddae3b165f409b3c42bbac834`
- MD5 sau sửa: `a46368117d2815b67442383cd753089b`
- Trigger mới `public.aka_agent_project_linked_email_status_v366()` MD5: `bce579723476038fdb8ab633045d2d24`.

Owner, security mode, volatility, search path, timeout và ACL RPC được giữ nguyên, kiểm tra lại sau apply. Không thêm lệnh reload schema; chữ ký/kiểu trả về/quan hệ API không đổi. Data API vẫn trả dữ liệu và từ chối payload sai theo guard hiện có.

Snapshot/manifest trước và sau, định nghĩa nguồn/đích, smoke và rollback ở [action-status-policies-v366](../migrations/snapshots/action-status-policies-v366/). Đọc lại backup và xác minh checksum trước apply. Các bảng cấu hình giữ nguyên giá trị; riêng `auto_campaign_action_detail_statuses.id=183` được luồng catalog đang chạy cập nhật `updated_at` trong cửa sổ snapshot. Không cột nào khác thay đổi; chi tiết nằm trong `after-manifest.json`.

## Kiểm chứng

- 237 test executor Chat hiện có và 11 test integration managed executor + SQL đều đạt.
- 78 kiểm tra Desktop/packaged Server + runtime thật + PostgreSQL WASM: thứ tự media, stop threshold, policy success `ignore`, suppress, replay receipt, Email helper/quota/link/callback, giữ detail legacy.
- Smoke media timeout, partial send, rich share, policy progress và runtime adapter đều đạt; note/log cũ được so sánh trong các smoke hiện có.
- Hai typecheck Desktop, production build Desktop và packaged Server; TypeScript build Chat đều đạt.
- Live smoke trước/sau apply chạy bằng role `anon`, kết thúc bằng `ROLLBACK`: reset+increment, replay, payload cũ, claim sai, early Email event và giữ main result. Không có thao tác gửi/kết bạn/tham gia nhóm thật trong test.
- Local rollback khôi phục đúng checksum RPC nguồn và chỉ gỡ trigger/function V366. Rollback có guard checksum/thuộc tính/trigger và không sửa dữ liệu lịch sử.

## Phát hành và rollback

Chat worker dùng cùng một machine, cùng giới hạn pool và tài nguyên. API, Zalo runtime và Web không đổi trong đợt sửa. Image/config/health được lưu trong `deployment-receipt.json`. Worker cũ nhận SIGTERM trực tiếp tại tiến trình Node lúc 20:33:44 Việt Nam, đi qua shutdown và thoát code 0 trước khi thay image. Không chạy chồng hai worker.

Desktop/packaged Server đã build local; chưa phát hành bộ cài. App cũ tiếp tục dùng đường cũ. Rollback runtime chỉ ảnh hưởng xử lý tiếp theo; giữ schema/catalog/readers đã được dùng bởi lịch sử. Trước khi chạy `rollback.sql` của V366, dừng hoặc hoàn nguyên writer sử dụng guard mới. SQL không TRUNCATE, reset sequence, xóa detail hoặc phục hồi đè bảng.

Worker mới bắt đầu lúc 20:35:24 Việt Nam. Chu kỳ thống kê đầu hoàn tất 20:36:28: normalize 956 claimed / 954 completed / 2 failed, project 942/942, không infrastructure error. Hai normalize failure không được ghi là test pass hay bị che; trước đổi image cũng có các failure loại này. Hash ba file compiled trên machine khớp build local. API Chat và Web health đều HTTP 200; cấu hình mọi machine ngoài image worker khớp trước deploy.

# Sửa tương thích trạng thái — V367

Ngày 09/10/2026. Đã apply trên **akachat / cgjbsmqtfhqvttudyjzq**: `20261009155339 / migration_v367_action_status_compatibility`. Không apply lại V361–366.

## Ba lỗi đã sửa

1. Lịch sử gửi dùng bằng chứng `policy_snapshot.operationState=committed` để nhận cả mã trạng thái mới và kết quả gửi một phần đã xác nhận. Detail legacy chưa có bằng chứng vẫn dùng đúng năm text cũ. Không suy ra đã gửi từ report group hoặc policy hiện tại. Hai nhánh UNION ALL không trùng dòng, giữ index legacy.
2. Hai trigger Automation hỗ trợ điều kiện cũ Email “đã xem/đã click”, SMS “đã gửi/đã nhận/thất bại” khi kết quả mới giữ nguyên trạng thái chính và chuyển trạng thái phụ. Chỉ xét cạnh điều kiện vừa thành đúng; giữ unique chống trùng theo rule/detail. Điều kiện đã có bộ lọc phụ vẫn so khớp đầy đủ chính + phụ, không được mở rộng bởi nhánh tương thích. Không sửa các rule đã lưu hoặc quét lại lịch sử.
3. Cả RPC trang detail v1/v2 đều lọc/tìm theo text cũ, tên/giá trị trạng thái chính và phụ. Presentation thêm field JSON tùy chọn `statusValue`. Dropdown Desktop/Web đưa trạng thái phụ đang hiển thị vào lựa chọn. RPC signature, tham số, kiểu JSON trả về tổng thể và payload cũ vẫn giữ nguyên.

Không thêm bảng/cột, không sửa policy, block/workflow, note/log hoặc mẫu thông báo cũ; không backfill input/detail, không tính lại quota. Không thêm connection/pool/listener/job. Chat không cần thay binary trong đợt này.

## Index và API

Thêm partial index `auto_detail_committed_delivery_v367` trên `(account_id, action_code, created_at DESC, input_data_id)`, chỉ lấy operationState committed. Tạo bằng một câu CREATE INDEX CONCURRENTLY riêng qua linked Management API đang dùng; không bọc SET/BEGIN hoặc mở kết nối SQL khác. Giới hạn statement của đường này là 2 phút; tạo thực tế mất 21,8 giây, index valid/ready, kích thước 32 kB lúc apply. Bảng detail khoảng 4,6 GB.

Migration body dùng lock_timeout 2 giây / statement_timeout 30 giây. Preflight yêu cầu đúng định nghĩa và trạng thái index, cùng checksum/thuộc tính của năm RPC. Không tạo/sửa bảng migration history phụ. Không gửi thêm lệnh reload schema; event trigger DDL hiện có tự thông báo PostgREST khi CREATE OR REPLACE FUNCTION. Giữ trigger đó và kiểm tra API sau apply: quan hệ chính/phụ HTTP 200, hai RPC từ chối thiếu xác thực đúng guard cũ.

## Nguồn RPC và checksum

Đã capture đúng signature live trước khi dựng SQL. Sau khi chuẩn hóa bằng PostgreSQL, bốn body Automation/reader khớp V362; helper lịch sử khớp V330. Chỉ thay các đoạn trong `function-diff.patch`. Owner, security mode, volatility, settings, ACL, guard tenant/claim, khóa nhóm, reconciliation/outbox, lọc engagement, phân trang và thứ tự cũ được giữ.

- `public.aka_agent_enqueue_campaign_detail_automations()`
  - Nguồn: `9858143987af45606d6da1ba5ea4dbb4`; đích: `8f00d3496adbc0f1a82c5261f7824018`.
- `public.aka_agent_enqueue_group_only_automations()`
  - Nguồn: `8e520c75e512e99aeba552e4792d873d`; đích: `a8bcf3ae13ffd7baddba76d104d2ad1e`.
- `public.aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)`
  - Nguồn: `58d02e6696fa3f89cda13cea288df876`; đích: `a8e94d7a35d42064236d369c6e0e088d`.
- `public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)`
  - Nguồn: `10faa8adcee8daef16c7a9b60aca5d97`; đích: `0cab9241430282691f320221acf2ed5d`.
- `public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)`
  - Nguồn: `593cdd93a81e86d37ce026465550d4f9`; đích: `fb398b4e0fb53a5ebef8269805d51a8e`.

## Backup và kiểm chứng

Snapshot/manifest và định nghĩa trước/sau nằm trong [action-status-compatibility-v367](../migrations/snapshots/action-status-compatibility-v367/). Backup gồm mọi dòng/cột cấu hình, schema, constraint, index, quyền và checksum; được đọc lại trước mọi thay đổi. Mọi cột policy/config cũ giữ nguyên. Trong cửa sổ snapshot, luồng catalog live cập nhật riêng updated_at của 18 dòng; ghi cụ thể trong after-manifest, không coi đó là dữ liệu của migration.

- 77 kiểm tra PostgreSQL local: migration/rollback khôi phục đúng body, drift guard, index sai bị từ chối, Email/SMS callbacks thật, cạnh Automation/dedupe/tenant, explicit subfilter, giữ main/log/quota, filter/search và lịch sử gửi. Hai index đủ điều kiện dùng; cooldown thật chặn mã custom committed.
- Smoke live trước và sau apply đều ROLLBACK: writer thật ghi kết quả custom đã xác nhận; cooldown chặn lượt tiếp; hai loại Automation nhận open đúng một lần; click không bị open hạ xuống; reader v1/v2 và guard tenant được kiểm tra bằng role service_role thật. Chỉ tạo campaign paused và dữ liệu giả trong transaction; outbox chưa commit nên worker không thể thấy. Không gửi tin/Email/kết bạn/tham gia nhóm thật. Sequence có thể có khoảng trống sau test; không reset.
- Hai typecheck Desktop, toàn bộ typecheck Web, build Desktop/packaged Server/Web đều đạt. API Web: 734 test đạt. Browser E2E chọn trạng thái phụ và xác nhận tham số gửi tới API đạt. Build Web có cảnh báo kích thước chunk hiện hữu, không phải lỗi build.
- Một EXPLAIN ANALYZE có giới hạn 5 giây cho filter trên campaign mẫu live chạy 0,8 ms; đây là mẫu đơn lẻ, không phải benchmark mọi quy mô campaign.

## Triển khai và khôi phục

Web source `f17c0a79296a06926dea4417dee837e0db3cfc21` đã deploy vào machine hiện có `48ee749f357398`, image `registry.fly.io/aka-agent-web-app:action-status-v367-20261009@sha256:8f364722a1c1b8a58b8626a1cfcd43cbe480b69ab85c13e9b91225d6f87b58ee`. Số machine và toàn bộ config ngoài image khớp trước deploy. Health và bundle HTTP 200; `/assets/index-DdCheDhL.js` khớp SHA256 build local. Desktop/packaged Server đã build local, **chưa phát hành bộ cài**. Không push/merge nhánh nguồn.

[SQL rollback](../migrations/tests/migration_v367_action_status_compatibility_rollback.sql) chỉ phục hồi năm body nguồn sau khi đối chiếu checksum/thuộc tính; dừng nếu có patch khác. Không xóa detail/history hoặc phục hồi đè bảng. Giữ index vô hại và các reader/catalog của V361–366. Revert Web dùng image trước trong deployment-receipt trên cùng machine; việc revert sẽ đưa lại các lỗi tương thích này nên cần đối chiếu runtime đang dùng trước khi thực hiện. Giữ mọi snapshot/lịch sử apply/rollback.

# Tracking Email độc lập nhóm báo cáo — V368

Đã apply trên **akachat / cgjbsmqtfhqvttudyjzq** ngày 09/10/2026, history **20261009162432 / migration_v368_email_status_observations**. Không apply lại V361–368.

## Thay đổi

Trước đây, open/click và liên kết tracking chỉ ghi trạng thái phụ khi `detail.report_group='success'`. Kết quả gửi đã được xác nhận nhưng policy phân nhóm `pending`, `skipped` hoặc `failure` vì vậy mất trạng thái phụ và cạnh Automation tương ứng.

Ba hàm hiện dùng bằng chứng đã lưu `policy_snapshot.operationState='committed'`. Chỉ thay một điều kiện trong mỗi body; xem [diff chính xác](../migrations/snapshots/email-status-observations-v368/function-diff.patch). Callback hoặc quan sát đến trước liên kết đều áp dụng cho cả bốn nhóm báo cáo. `unknown`/`not_committed` không được coi là đã gửi chỉ vì nhóm báo cáo là success. Click không bị open hạ xuống; callback lặp giữ chống trùng rule/detail.

Giữ nguyên trạng thái chính, policy snapshot, report group, quota, log và đường cập nhật text của detail legacy. Không backfill, gửi lại, tính lại lịch sử hoặc sửa policy/block/workflow. Không thêm bảng/cột/index, RPC, quyền, timer hoặc connection/pool. Bản sửa chỉ ở DB; không cần đổi binary Desktop/Server/Chat hay deploy Web.

## Nguồn live và kiểm chứng

Đã đọc `pg_get_functiondef()` cùng owner/security/volatility/settings/ACL từ linked production trước khi dựng SQL, sau đó đọc lại backup và xác minh checksum từng dòng/toàn bảng. Nguồn được đối chiếu với body mới nhất trong V362/V366 bằng PostgreSQL local; không có drift. Changelog Supabase và [quy tắc CREATE OR REPLACE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html) được kiểm tra trước triển khai.

| Signature trong `public` | MD5 trước | MD5 sau |
| --- | --- | --- |
| `aka_agent_mark_email_click(text,text)` | `13bd35c961fe486823ff0263887911f0` | `9f0ec78c3127d0f48605298b5ea2c3f0` |
| `aka_agent_mark_email_open(text,text)` | `43fa1d3a95fca0448e714a9dddff16c3` | `e13f3b6c3de915b2713965b76dbd33a7` |
| `aka_agent_project_linked_email_status_v366()` | `bce579723476038fdb8ab633045d2d24` | `6535346b9292f2c69031bb801f5a5f68` |

- **203 kiểm tra local** dùng writer, callback và Automation thật trên PostgreSQL WASM: mọi nhóm báo cáo; open/click trước/sau liên kết; cả hai loại đích Automation; replay/dedupe; giữ nguyên toàn bộ field chính của detail; legacy text; trạng thái chưa xác nhận; callback role anon; migration/rollback và guard chống body/ACL drift.
- **Smoke live trước và sau apply đều kết thúc bằng ROLLBACK**, lần lượt khoảng 0,421 và 0,399 giây. Mỗi lượt dùng tám kết quả từ writer thật, campaign giả tạm dừng và địa chỉ `example.invalid`; callback chạy bằng role anon thật. Outbox không commit nên worker không thể xử lý. Không gửi Email/Facebook/Zalo thật. Sequence có thể có khoảng trống sau test; không reset.
- API sau apply: open/click trả HTTP 200 và từ chối token sai; quan hệ main/sub status trả HTTP 200. Không gửi thêm lệnh reload; giữ event trigger DDL hiện có. Owner, security mode, volatility, settings, ACL và signature khớp trước apply; các hàm ngoài phạm vi không đổi.
- 104 policy lỗi, 19 policy trạng thái, 25 action và các bảng cấu hình còn lại giữ nguyên giá trị. Chỉ `updated_at` của 13 dòng danh mục Automation được luồng live cập nhật độc lập trong cửa sổ snapshot; liệt kê trong after-manifest. Không khôi phục đè những timestamp đó.
- Security advisors trước apply ghi nhận cảnh báo hiện hữu trên DB; bốn cảnh báo liên quan hai callback là quyền EXECUTE anon/authenticated của API token công khai vốn có. Token UUID và guard hiện có được giữ, không cấp thêm quyền. Không sửa các đối tượng ngoài task.

Nguồn ứng dụng không đổi trong bản sửa này. Hai typecheck Desktop, typecheck Chat/Web và các regression suite đã đạt ở lượt review ngay trước sửa; không dùng kết quả đó để thay thế kiểm chứng SQL live ở trên.

## Backup và rollback

Snapshot trước/sau, toàn bộ schema/constraint/index/quyền của các bảng cấu hình, metadata tracking, nguồn/đích ba hàm, manifest và receipt nằm tại [email-status-observations-v368](../migrations/snapshots/email-status-observations-v368/). Backup trước apply được đọc lại và xác minh trước mọi ghi DB. Migration dùng `lock_timeout=2s`, `statement_timeout=30s`, checksum và thuộc tính fail-closed; lịch sử ghi trong cùng transaction, không có DDL chuẩn bị history phụ.

[SQL rollback](../migrations/tests/migration_v368_email_status_observations_rollback.sql) chỉ phục hồi ba body nguồn sau khi khớp checksum và thuộc tính. Nếu có patch mới thì dừng. Giữ schema, policy, detail, trạng thái phụ đã quan sát và lịch sử apply; không xóa hoặc tính lại dữ liệu. Rollback sẽ đưa lại hạn chế tracking theo report group cho các sự kiện tiếp theo.

Mã nguồn nằm trong worktree của task; chưa push/merge. Repo chính và bộ cài chưa phát hành giữ nguyên.

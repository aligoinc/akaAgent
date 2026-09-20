# Account-log HTTP RPC v293

Đã apply ngày 20/09/2026 vào `akachat`, ref `cgjbsmqtfhqvttudyjzq`; lịch sử migration `20260920090213`, tên `v293_account_log_http_rpc`. Chưa deploy runtime Chat API/worker hay installer Desktop/Server mới.

## Source và preflight

- Exact signature: `public.aka_agent_record_account_log(jsonb,jsonb)`.
- Trước khi dựng SQL: `to_regprocedure(...) = NULL`, truy vấn `pg_proc` theo namespace/tên trả không có overload. Source checksum: không áp dụng vì function chưa tồn tại.
- Migration dùng `CREATE FUNCTION`, không replace function hiện hữu. Preflight từ chối nếu bất kỳ overload cùng tên đã xuất hiện hoặc bảng v292 chưa có. Không có DB-only patch cũ bị ghi đè.
- Không thay schema/policy/ACL của bảng `auto_account_logs` hoặc RPC nghiệp vụ. Các bảng/cột tham chiếu đã được đối chiếu trực tiếp với linked production.

## Target đã xác minh

- `md5(pg_get_functiondef(oid))`: `e97b1a12c22506780949f500ff572db2` (khớp giữa rollback validation và sau apply).
- SHA-256 của [migration](../migrations/migration_v293_account_log_http_rpc.sql): `9dc3c0c5425754cb8abafb068528ffb29d7890a08dac60c50d35afd72c512a41`.
- Owner `postgres`; `SECURITY DEFINER`, `VOLATILE`, trả `void`; `search_path=''`, `statement_timeout=4s`, `lock_timeout=1s`.
- ACL execute: `postgres`, `anon`, `authenticated`, `service_role`; đã revoke `PUBLIC`.
- Definer chỉ phục vụ tra binding runtime nội bộ và append log. Hàm kiểm tra account tồn tại/campaign thuộc account chính hoặc phụ theo contract v292; không trả row/ID, không cấp quyền đọc bảng cho client.
- Lookup campaign giữ guard account/staff/organization/generation/target/thời điểm claim; vẫn nhận claim đang dừng mềm. Release/đổi session hoặc campaign mới hơn sự kiện khiến context về NULL. Explicit campaign/null được runtime ưu tiên trước khi gửi.

## Kiểm chứng

- Dựng migration + [smoke SQL](../migrations/tests/migration_v293_account_log_http_rpc_smoke.sql) trong transaction rollback trước apply: đạt. Chạy lại smoke rollback sau apply: đạt; không còn dòng có marker smoke.
- HTTP POST bằng public anon key tới RPC với account không tồn tại trả `204`, không ghi dữ liệu; xác nhận schema cache và EXECUTE hoạt động.
- PGlite chạy bản sao nguyên migration trong Chat API: multi-staff, campaign pause, đổi claim, generation/owner mismatch, free-text status, anon append-only, invalid account/campaign và preflight đều đạt. Fixture phải luôn giống byte-for-byte migration.
- Logger HTTP test: 100 sự kiện phát 100 request ngay trước bất kỳ response nào, snapshot context, explicit null, timeout/late rejection, HTTP/network/serialize errors và shutdown không flush.
- Desktop smoke chạy emitter QR/listener thật với transport mock: hai lượt QR, phục hồi listener, cipher refresh không phát status, listener mới và polling độc lập. Không gọi Zalo thật.
- Security advisors sau apply có hai cảnh báo execute definer qua `anon`/`authenticated`. Đây là quyền gọi endpoint append-only có chủ đích theo contract telemetry v292; lookup binding nội bộ không trả dữ liệu. Không thay đổi quyết định đã chốt về quyền ghi log công khai.

PostgREST reload là cần thiết vì v293 bổ sung signature RPC cho Data API. Client vẫn chấp nhận mất log khi HTTP lỗi/timeout/thoát app; không đọc log để quyết định nghiệp vụ.

Hai typecheck Desktop và typecheck/build Chat API đạt; build Desktop/Server đạt (cảnh báo DataScanModal import tĩnh/động đã có sẵn). Smoke logger, 30 test session restore và 210 test Chat liên quan đạt; các test ngoài phạm vi của suite repository đã được filter bỏ. Hai bản contract TypeScript và hai bản migration/fixture giống nhau, `git diff --check` sạch.

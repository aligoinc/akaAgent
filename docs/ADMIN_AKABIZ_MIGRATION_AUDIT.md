# Audit migration v294 — Admin akaBiz

RPC cron sau đó được tối ưu bằng [v296](ADMIN_CRON_V296_AUDIT.md). Checksum trong bảng dưới là target tại thời điểm apply v294, không phải checksum cron hiện tại.

- Target: linked production **`cgjbsmqtfhqvttudyjzq`**, ngày 20/09/2026.
- Migration: `migrations/migration_v294_admin_akabiz.sql`.
- Source: bảng `auto_admin_api_docs` và cả sáu exact signature bên dưới chưa tồn tại khi kiểm tra live. Không có source checksum vì tất cả là đối tượng mới.
- Preflight fail-closed nếu bảng/signature đã tồn tại; dùng `CREATE FUNCTION`, không thay thế function cũ. Không có live patch bị ghi đè; ACL bảng legacy giữ nguyên.
- Trước apply: migration + smoke trong một transaction kết thúc `ROLLBACK` đã qua. Metadata, owner, ACL và checksum target lấy ngay trong transaction này.
- **Đã apply production thành công** bằng Supabase migration tool, chỉ migration v294. History version: `20260920132125`, name: `migration_v294_admin_akabiz`.
- Sau apply: cả sáu checksum, owner, security mode, volatility, config và ACL khớp target; bảng có RLS, client không có table grant và seed API akaChat tồn tại. Smoke SQL rollback sau apply cũng PASS.
- Migration phát `NOTIFY pgrst, 'reload schema'` vì có metadata API mới. Kiểm tra HTTP PostgREST cả năm RPC với credential sai nhận `401 / 42501 / admin_access_denied`; truy cập trực tiếp bảng nhận `401 / 42501`. Không có lỗi schema cache hoặc HTTP 503 trong kiểm chứng.

## Function signatures và target checksum

| Exact signature (`public`) | `md5(pg_get_functiondef)` | Volatility |
| --- | --- | --- |
| `aka_agent_admin_assert_access(bigint,text,text)` | `1644f95929edee967b02b51b1b785b0e` | STABLE |
| `aka_agent_admin_docs(bigint,text,text,text,jsonb)` | `1a760b48ffee2a75ae29f85c02ce5cb8` | VOLATILE |
| `aka_agent_admin_notifications(bigint,text,text,text,jsonb)` | `ec4117c4cc813bf8fe926c21e7da3c8d` | VOLATILE |
| `aka_agent_admin_settings(bigint,text,text,text,jsonb)` | `6bdb2aebad3cd7a8b83ccfdba3e103c9` | VOLATILE |
| `aka_agent_admin_cron(bigint,text,text,text,jsonb)` | `3560ba2bf0ae9f63f380ef343c0c7313` | STABLE |
| `aka_agent_admin_triggers(bigint,text,text,text,jsonb)` | `9f2b68cdb38f9e3209d32e1420af4b01` | STABLE |

Tất cả owner `postgres`, `SECURITY DEFINER`, `search_path=pg_catalog, public`. Helper chỉ có owner EXECUTE. Năm RPC nhóm có ACL `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}`. Năm RPC nhóm có `statement_timeout=8s`; docs/notifications/settings/cron có `TimeZone=UTC`, `lock_timeout=3s`.

## Smoke SQL

`migrations/tests/migration_v294_admin_akabiz_smoke.sql` kiểm tra:

- Sai password, non-admin, `is_admin=NULL`, chỉ `is_admin_akabiz`, staff inactive và admin khác org bị từ chối.
- Doc CRUD, URL không hợp lệ, stale version.
- Thông báo text/JSON tương lai và xóa nội dung bằng chuỗi rỗng; staff lookup; CAS.
- Secret list không lộ, reveal đúng giá trị, lưu riêng mô tả giữ giá trị, stale save bị từ chối.
- Cron đọc metadata, phân trang cursor không chồng trang, detail và từ chối action chạy job.
- Trigger list không tải definition/body, detail tải body; ACL không cho truy cập trực tiếp.

Mọi mutation kiểm thử rollback; không chạy cron/hàm đang xem, không gửi thông báo thử cho người dùng.

## Kiểm chứng desktop

- Hai typecheck `tsconfig.node.json` và `tsconfig.web.json`: PASS.
- Production build: PASS. Còn warning có sẵn về DataScanModal vừa import static vừa import dynamic.
- `node scripts/run-admin-smoke-test.cjs`: PASS, gồm khóa phiên chặn mở guest mới trong cleanup logout, sandbox popup, cookie tách biệt, crash thật/retry, CRUD và secret.
- `node scripts/run-login-screen-content-smoke-test.cjs`: PASS, bao gồm ưu tiên thông báo staff/chung và thời gian/link.
- `node scripts/run-chat-web-smoke-test.cjs`: PASS, regression CRM/akaChat.

## Security advisors sau apply

Đã đối chiếu baseline. Các finding mới cho đối tượng Admin đều tương ứng với thiết kế RPC-only đã chọn:

- INFO [RLS enabled, no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) trên `auto_admin_api_docs`: cố ý không cho truy cập trực tiếp; table/sequence grants cũng đã thu hồi.
- WARN [anon SECURITY DEFINER executable](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) và [authenticated SECURITY DEFINER executable](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) trên năm RPC nhóm: EXECUTE phục vụ Supabase client hiện tại, nhưng mọi nhánh đều qua kiểm tra credential/staff active/admin/org1 trước khi đọc hoặc ghi. Helper không public. Smoke SQL và HTTP đã xác minh credential/quyền không hợp lệ bị chặn.

Không thay đổi quyền các bảng/function legacy ngoài phạm vi để xử lý cảnh báo sẵn có.

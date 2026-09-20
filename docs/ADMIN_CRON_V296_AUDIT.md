# Admin cron — v296, 20/09/2026

## Sự cố và bản sửa

Lọc log của job đã tắt (`jobid=8`) bị timeout. Bảng `cron.job_run_details` có khoảng 1,25 triệu dòng theo thống kê, dung lượng 822 MB, chỉ có primary-key index `runid`. Kế hoạch cũ chọn index scan ngược rồi mới lọc `jobid`, phải đọc nhiều trang heap rải rác để tìm đủ 101 kết quả cũ. Truy vấn RPC bị hủy khi kiểm chứng giới hạn 15 giây.

V296 đọc cửa sổ tối đa 5.000 dòng mới nhất bằng primary key trước khi lọc (màn hình không lọc chỉ đọc 101 dòng). Nếu chưa đủ kết quả, nhánh lịch sử thưa dùng lọc và top-N sort, `ORDER BY runid + 0 DESC`, để tránh quét index ngược không giới hạn. Trả tối đa 100 dòng, cursor là `runid` của dòng thứ 100; tên job chỉ join sau khi lấy trang. `EXECUTE ... USING` chỉ dùng SQL cố định và tham số bind, không nhận SQL từ client.

Không thêm bảng/index/pool/listener, không tăng timeout hoặc cấu hình parallel workers. Timeout RPC vẫn 8 giây. Với lịch sử thưa, DB vẫn cần xét lịch sử cũ; thời gian đo dưới đây không bảo đảm cho mọi kích thước dữ liệu tương lai.

## Live definition và apply

- Project: `cgjbsmqtfhqvttudyjzq` (linked production).
- Exact signature: `public.aka_agent_admin_cron(bigint,text,text,text,jsonb)`.
- Source `md5(pg_get_functiondef)`: `3560ba2bf0ae9f63f380ef343c0c7313`; đã capture live và đối chiếu body trùng v294, không có DB-only patch.
- Target: `56a86a47ffa20258ea837b2a1289609c`.
- Giữ nguyên owner `postgres`, `SECURITY DEFINER`, `STABLE`, `search_path=pg_catalog, public`, `TimeZone=UTC`, `statement_timeout=8s`, `lock_timeout=3s`.
- ACL giữ `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}`; giữ helper kiểm tra credential/staff active/admin/org1 và hành vi `jobs`/`detail`.
- Preflight fail-closed nếu signature thiếu hoặc source checksum khác. Migration + smoke đã kiểm chứng trong transaction rollback trước apply.
- Đã apply riêng `migration_v296_admin_cron_filtered_logs.sql`, history version `20260920133903`, name `migration_v296_admin_cron_filtered_logs`.
- Dùng `supabase db query --linked`, ghi history vào bảng migration có sẵn trong cùng transaction, không thêm DDL chuẩn bị `CREATE/ALTER ... IF NOT EXISTS`. Không explicit reload schema vì chỉ thay body; các event trigger chung giữ nguyên. PostgREST sau apply hoạt động, credential sai trả `401 / 42501 / admin_access_denied`.

## Kiểm chứng sau apply

SQL smoke rollback: `migrations/tests/migration_v296_admin_cron_filtered_logs_smoke.sql`.

| Trường hợp | Số dòng | Thời gian đo sau apply |
| --- | ---: | ---: |
| Không lọc, các trường UI rỗng/null | 100 | 4,6 ms |
| Job 8 đã tắt, lịch sử cũ | 100 | 398,5 ms |
| Job không tồn tại | 0 | 218,9 ms |
| Kết quả thất bại | 100 | 290,3 ms |

Trang đầu và trang tiếp theo của job 8 được đối chiếu trực tiếp với DB, không trùng/mất dòng. Chi tiết, timezone, guard và từ chối action chạy job đều PASS. Checksum/owner/ACL/config sau apply khớp target. Không chạy cron hoặc gửi thông báo thử.

Hai typecheck và production build PASS. Electron fixture PASS: lịch có mô tả tiếng Việt và biểu thức gốc, filter/error/retry/empty-state đúng; form thông báo dùng “khách hàng” và nút Tìm căn theo đáy ô Username. Screenshot fixture: `/tmp/akaagent-admin-customer-picker-smoke.png`.

Security advisors của RPC vẫn có cảnh báo EXECUTE cho [anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) và [authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), giống v294: RPC SECURITY DEFINER có guard bắt buộc theo thiết kế hiện có. Bản sửa không mở rộng ACL hoặc bỏ guard.

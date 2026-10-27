# Thu hồi quyền legacy của akaAgent — V435

Đã apply **akachat** (`cgjbsmqtfhqvttudyjzq`) lúc **23:53:25 ngày 27/10/2026**, migration **20261027165325 / migration_v435_desktop_permission_cutover**. Người dùng đã cho phép thu hồi và xác nhận phát hành 9.1.0. Ba feed Windows/Mac ARM/Mac Intel đã trả `9.1.0` trước khi apply và trong hậu kiểm. **Không apply lại migration cũ B/C hoặc khôi phục các grant Desktop đã loại bỏ.**

## Phạm vi và hành vi

- Thu hồi quyền trực tiếp của `PUBLIC`, `anon`, `authenticated` trên 113 bảng/view akaAgent, 87 sequence liên quan và 596 hàm thuộc đường truy cập dữ liệu. 232 ACL hàm thực sự thay đổi; phần còn lại vốn đã khóa.
- Bật RLS thêm 47 bảng; toàn bộ **109 bảng** trong phạm vi nay đã bật RLS. Bốn đối tượng còn lại là view, được bảo vệ bằng ACL.
- Giữ các policy đã tồn tại. Bảng trước đây chưa bật RLS có policy tương thích cho những role hiện hữu ngoài anon/authenticated; ACL tối thiểu của Desktop vẫn là giới hạn thao tác. Không thêm ràng buộc tổ chức, sở hữu, dữ liệu hay thay đổi nghiệp vụ.
- Desktop mất SELECT toàn bảng `ai_model`, chỉ được SELECT 11 cột metadata, không có `api_key`. Backend giữ quyền đọc key. Các quyền sửa tổ chức/staff, sửa tổ chức của tài khoản/chiến dịch, đọc Vault trực tiếp đã bị loại ở đợt trước và không được cấp lại.
- Giữ nguyên ACL 12 hàm bootstrap/pre-request/akaMap liên quan. Các RPC có xác thực theo nghiệp vụ vẫn hoạt động; không vô hiệu hóa khóa anon hay publishable ở gateway.
- Quyền hữu hiệu của tất cả role ngoài anon/authenticated được đối chiếu ngay trong transaction và giữ nguyên, ngoại trừ SELECT AI key của Desktop như chủ đích. Service role, Chat API và CRM backend giữ quyền.

## Ngoại lệ cập nhật cho app cũ

`anon` chỉ được đọc `value`, `key`, `is_active`, `is_secret` trên `auto_system_settings`, với policy SELECT chỉ thấy dòng:

`key = 'desktop.updates.startup_prompt_max_version' AND is_active AND NOT is_secret`

App 9.0.0 đọc dòng này trước đăng nhập. Không đổi giá trị setting. Không cấp quyền ghi, không cho đọc dòng cấu hình khác. RPC bootstrap mới `aka_agent_desktop_startup_policy()` vẫn được phép. Đây là lý do giữ khóa anon hợp lệ nhưng thu hồi quyền dữ liệu của role.

## Kiểm chứng

- PostgreSQL 17 local: schema/hàm từ capture thật, dữ liệu giả; 8 nhóm đạt gồm guard chống metadata drift, query cập nhật cũ, bootstrap, ghi tài khoản/chiến dịch, runtime profile, category join, metadata AI, từ chối quyền thừa, backend và hoàn nguyên có gate.
- Diễn tập production `BEGIN … ROLLBACK` đạt. Lượt đầu gặp deadlock và rollback toàn bộ; lượt NOWAIT tiếp theo gặp bảng bận. Candidate cuối lấy khóa theo nhóm bằng NOWAIT, tối đa 40 lần cách nhau 50 ms, giải phóng nhóm khóa khi thử thất bại. Không hủy phiên khách hàng. Diễn tập thành công được xác nhận trở về đúng digest baseline.
- Apply một migration bằng Supabase MCP. Hậu kiểm metadata khớp hoàn toàn trạng thái đã diễn tập.
- **1.245 định nghĩa hàm**, owner, security mode, volatility và cấu hình timeout giữ nguyên; role/membership/default ACL/constraint/trigger, định nghĩa view và kiểu/default cột giữ nguyên. Không có `CREATE OR REPLACE FUNCTION`.
- **20 kiểm tra HTTP thật đạt**: anon JWT cũ và publishable đều bị từ chối đọc staff, tổ chức, tài khoản, chiến dịch, AI key (`42501`); query cập nhật cũ thấy đúng một dòng; bootstrap mới HTTP 200; ba feed 9.1.0 và backend health HTTP 200.
- Chưa thực hiện cài đặt/nâng cấp trọn luồng từ Windows/Mac cũ trong lượt cutover; người dùng đang kiểm tra bằng bộ cài 9.1.0. Không có phiên Desktop đăng nhập đang mở ở thời điểm kiểm tra UI, nên không coi kiểm chứng SQL/HTTP là kiểm chứng toàn bộ tính năng Desktop.
- Security advisor giảm cảnh báo RLS-disabled 248→202, public anon SECURITY DEFINER 213→58, authenticated 211→56 và view definer 9→5. Các cảnh báo ngoài phạm vi không được sửa trong migration này.

Checksum hàm trọng yếu trước = sau:

| Hàm | MD5 định nghĩa |
|---|---|
| `public.aka_agent_block_denied_ip_request()` | `ff086d95d4ba66cad668bfe48a705e11` |
| `public.aka_agent_desktop_ai_identity(uuid,uuid)` | `5600c48f72d1343670b3e7cfd31ce491` |
| `public.aka_agent_staff_time_allowed(bigint)` | `a294e60011edd8d42e90ac2f74ce744c` |
| `public.aka_agent_get_vault_secret(text)` | `a99f67a293add94677a9f85145fe211d` |

## Bằng chứng và hoàn nguyên

- Candidate đã apply: `migrations/migration_v435_desktop_permission_cutover.sql`.
- Phạm vi, digest, kết quả: `migrations/snapshots/desktop-cutover-v435/{plan,verification,local-test,http-test,advisors}.json`.
- Capture đầy đủ pg_get_functiondef/ACL trước–sau và diễn tập giữ **ngoài Git**, thư mục riêng `~/.codex/deployments/desktop-cutover-v435-20261027/`, mode 0700/0600. Không chứa dữ liệu khách; định nghĩa DB được coi là nội bộ và không đưa vào PR.
- Tái chạy smoke: đặt `V435_EVIDENCE_DIR` trỏ tới thư mục capture rồi chạy `node scripts/desktop-session-rls/cutover-v435/smoke.cjs`. Các script chỉ dựng PostgreSQL local, không apply production.
- `migrations/rollback_v435_desktop_permission_cutover.sql` khôi phục ACL/RLS cũ, **mở lại truy cập dữ liệu bằng anon/authenticated**. Không chạy tự động. Cần chỉ thị riêng của người dùng, setting `aka_agent.v435_rollback='approved-reopen-legacy-access'` và digest metadata đúng trạng thái sau apply. Nếu metadata đã đổi, phải capture/đối chiếu trước, không bỏ guard. Rollback không thay body hàm.

Token Desktop vẫn cho phép những thao tác app cần theo ACL đã rà soát; migration này không thay thế backend API đầy đủ và không ngăn người đã đăng nhập tự gọi các thao tác còn được cấp.

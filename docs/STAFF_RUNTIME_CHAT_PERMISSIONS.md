# Quyền staff runtime của Chat worker — 27/10/2026

Đã apply trên **akachat `cgjbsmqtfhqvttudyjzq` lúc 17:29:39 VN**, history `20261027102939 / staff_runtime_chat_worker_permissions`. PR này lưu nguyên SQL đã chạy, không tạo một lần apply mới. Canonical: [migration](../supabase/migrations/20261027102858_staff_runtime_chat_worker_permissions.sql); tên file do Supabase CLI tạo trước khi apply nên timestamp khác history. **Không apply lại hoặc bulk push.**

## Nguyên nhân

Migration B `staff_rls_runtime_compatibility` lúc 12:37:53 thêm view `aka_agent_staff_runtime_profile` và helper `aka_agent_staff_runtime_scope(bigint,text)`, rồi chuyển 34 RPC invoker sang dùng chúng. ACL của RPC cũ được giữ, nhưng hai dependency mới chỉ cấp quyền cho anon/authenticated/service_role, thiếu role SQL thực tế `aka_agent_chat_api`.

Worker bắt đầu gặp permission denied từ khoảng 12:38. Role có BYPASSRLS vẫn cần quyền SELECT/EXECUTE trên object. Cleanup thất bại và một số mục giữ trạng thái lỗi trong RAM ngay cả khi DB đã nhả claim. Bộ smoke ban đầu chỉ thử role Chat trực tiếp trên `org_staff`, chưa đi qua view/helper mới; số kiểm thử đạt trước đó không chứng minh tương thích đường runtime của Chat.

## Bản sửa đã áp dụng

- Chỉ cấp SELECT view và EXECUTE helper cho `aka_agent_chat_api`; không cấp quyền ghi view.
- Preflight kiểm tra đúng signature, checksum, owner, security mode, volatility, config, ACL nguồn, role BYPASSRLS và `org_staff` RLS=false. Không thay function/view body hoặc quyền của các role khác.
- Đã thử transaction kết thúc ROLLBACK trước apply, xác minh quyền và checksum sau apply. Security advisors giữ 9 mục, không có mục mới.

| Object | Checksum định nghĩa trước = sau |
|---|---|
| `aka_agent_staff_runtime_scope(bigint,text)` | `41d7a8af8bb781e59157a5b919621492` |
| `aka_agent_staff_runtime_profile` | `ede238aba1a0de0cebd9fa33ff183f4a` |
| `aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)` | `91b1ff4d36fc5c1ff2f9364bd7301fba` |

Giữ bản vá helper kế thừa lock timeout của caller, V397/V389, token/CAS/unit ownership, policy, quota và lịch chạy. Helper vẫn SECURITY DEFINER với `search_path=pg_catalog, public`; cleanup vẫn SECURITY INVOKER. Không restart/deploy worker, thêm nguồn connection hoặc bật RLS C.

## Kiểm chứng và phục hồi

Lần xử lý sự cố dùng cleanup repository hiện có và payload claim/unit gốc. Chỉ xóa đúng entry RAM sau kết quả `cleaned`/`already_cleaned`, kiểm tra entry/token/controller không đổi và producer đã kết thúc; 17 ca guard đạt. Không clear toàn map hoặc gửi lại input có kết quả chưa chắc chắn.

- 82 chiến dịch / 37 staff: 16 cleanup DB, 66 đã sạch DB; gỡ đúng 82 entry RAM.
- Lúc 17:35:55: không còn ownership cũ; 80 chiến dịch / 36 staff đã có tiến độ mới. Hai chiến dịch còn lại chờ đúng giờ dừng/ngưỡng policy.
- Năm input cũ đã hoàn thành giữ nguyên, không có command mới sau phục hồi.
- Bốn entry không thuộc diện phục hồi (đổi route, logout, khách tạm dừng) và Desktop giữ nguyên.

Đây là snapshot sau xử lý, không phải cam kết trạng thái các chiến dịch ở thời điểm đọc tài liệu. Evidence và script thao tác có ID/token/log khách giữ ngoài Git tại `~/.codex/audits/akaAgentChatApi/staff-recovery-20261027/`; không đưa vào source hoặc quy trình deploy.

[Smoke quyền](../migrations/tests/staff_runtime_chat_worker_permissions_smoke.sql) đổi **role SQL thật**, đọc view với LIMIT 0 và gọi helper với ID không hợp lệ để kiểm tra được quyền EXECUTE mà không khóa/sửa row khách. Smoke kết thúc ROLLBACK; thiếu một trong hai quyền phải báo lỗi. Nó không thực hiện cleanup hoặc chạy chiến dịch và không thay thế kiểm chứng end-to-end ở trên.

Khi chuẩn bị PR, PostgreSQL 17.11 local đạt 10 kiểm tra: tái hiện hai lỗi thiếu quyền, smoke thất bại trước grant, dry run không giữ grant, migration/smoke thành công, hai nhánh share/update với ID không tồn tại, chặn apply lại và bắt lỗi khi mất từng grant. Fixture dùng định nghĩa đã chụp, không có dữ liệu khách. Live read-only xác nhận hai quyền còn hiệu lực, body/metadata giữ nguyên và RLS=false; SQL trong Git khớp nguyên văn statement của migration history. Kết nối postgres quản trị Supabase không được SET ROLE sang Chat nên bài đổi role chạy local; không cấp membership để vượt giới hạn này.

## Cutover và hoàn nguyên

**C chưa apply; `org_staff` vẫn RLS=false tại thời điểm sửa.** Guard C và rollback C đang so ACL trước hai grant này nên sẽ dừng an toàn. Trước cutover được cho phép riêng, phải chụp lại live, cập nhật đúng tập ACL kỳ vọng và smoke role Chat qua dependency mới. Không thu hồi quyền Chat để làm guard cũ vượt qua.

Không có lý do hoàn nguyên hai grant trên worker đang dùng các RPC của B: việc đó tái tạo lỗi. Nếu cần bỏ B, phải lập kế hoạch quay lại dependency cũ trước, kiểm tra live/checksum/ACL và các caller; không chạy REVOKE độc lập. Migration lịch sử cố ý chỉ nhận ACL nguồn, không nhận ACL đã apply; không sửa preflight để chạy lại.

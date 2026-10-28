# Desktop chỉ đọc hồ sơ nhân viên của chính mình — 28/10/2026

Bản chụp đầy đủ `before.json`, `full-before.json`, `full-after.json` đã chuyển khỏi repo ngày 28/10/2026. Đọc tại `migrations/snapshots/staff-self-access/` trong kho `AKA_AGENT_PRIVATE_SECURITY_DIR` (mặc định `$HOME/.codex/incident-recovery/akaAgent-ip-block`). Generator và smoke đã dùng đường dẫn ngoài repo; migration, plan và bằng chứng kiểm thử còn lại giữ nguyên.

**Cập nhật 01:11:32 VN ngày 28/10/2026:** theo yêu cầu tiếp theo, đã mở lại danh sách người nhận chia sẻ, chỉ **ID + tên hiển thị của nhân viên đang hoạt động, chưa xóa, cùng tổ chức**. Migration production `20261027181132 / staff_sharing_directory`; canonical [20261027180909_staff_sharing_directory.sql](../supabase/migrations/20261027180909_staff_sharing_directory.sql). Không cần cập nhật app, mở lại form chia sẻ để tải danh sách. Các ghi chú chặn danh sách bên dưới mô tả phiên bản 01:02 trước thay đổi này.

Chỉ bỏ một nhánh trả `[]` trong `public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)`: source MD5 `5bb87b66104f2dad716797e28cd6cccc` → target `af95bdbae9bfc75343ddd96eda51dcc7`. Giữ kiểm tra staff ID theo JWT, credential, tổ chức, chủ nhóm, CAS/revision, V414 và timeout/ACL. Biết ID người nhận vẫn không đọc được username/SĐT/mật khẩu hoặc runtime profile của họ bằng token của mình. View runtime, sáu RPC quản trị và helper danh tính giữ nguyên; tên chủ nhóm khác trong badge vẫn được che như trước.

**Kiểm chứng bản cập nhật:** bảy nhóm local đạt, gồm đủ hai field, lọc org/active/deleted, token giả mạo staff/org bị từ chối, dùng ID trả về vẫn không đọc được hồ sơ khác, chọn/lưu người nhận với UI contract cũ và kiểm tra owner/revision, own-user/backend giữ nguyên, metadata ngoài hàm không đổi, rollback hẹp. Production rollback trial và hậu kiểm cả sáu mapping Auth đạt; không ghi hàng nghiệp vụ. Hai HTTP kiểm tra anon không đọc được danh sách hoặc runtime view đạt. 1.245 hàm khác và view giữ checksum/metadata; chỉ một body RPC thay đổi. Evidence ở [staff-sharing-directory](../migrations/snapshots/staff-sharing-directory/). [Rollback riêng](../migrations/rollback_staff_sharing_directory.sql) chỉ đóng lại picker và kiểm tra target checksum/ACL/owner, không thay view hoặc các chặn hồ sơ staff. Không apply lại migration này.

Đã apply **akachat** (`cgjbsmqtfhqvttudyjzq`) lúc **01:02:48 VN ngày 28/10/2026**, migration production `20261027180248 / desktop_staff_self_access`. Canonical SQL: [20261027175514_desktop_staff_self_access.sql](../supabase/migrations/20261027175514_desktop_staff_self_access.sql). Không apply lại; không cần build, cập nhật hoặc restart Desktop để nhận quyền DB mới.

Người dùng chấp nhận mất chức năng quản trị trên Desktop và xác nhận **chặn cả danh sách người nhận chia sẻ**. Đây là thay đổi server theo yêu cầu tiếp theo, bổ sung giới hạn danh tính vào phạm vi hồ sơ staff sau V435; không chạy lại các candidate A/B/C cũ.

## Hành vi

- Token `aka_agent_desktop` lấy staff ID từ ánh xạ riêng `private.aka_agent_desktop_users` theo `sub` của JWT. Không tin staff ID truyền vào RPC hoặc cờ admin để mở rộng phạm vi hồ sơ.
- View `aka_agent_staff_runtime_profile` chỉ trả hồ sơ của staff đó. Helper khóa runtime chỉ trả/khóa đúng staff đó; RPC kiểm tra thời hạn trả false với staff khác. Thiếu claim, claim sai định dạng hoặc không có mapping đều bị đóng quyền.
- Thu hồi riêng EXECUTE của Desktop trên sáu RPC: `aka_agent_staff_management`, `aka_agent_admin_cron`, `aka_agent_admin_docs`, `aka_agent_admin_notifications`, `aka_agent_admin_settings`, `aka_agent_admin_triggers`. Chữ ký của cả sáu là `(bigint,text,text,text,jsonb)`. Không sửa body hoặc quyền các role khác.
- `aka_agent_group_sharing(...,p_action='staff',...)` trả `[]` cho Desktop. Mọi action của RPC này yêu cầu staff ID khớp token, đồng thời giữ kiểm tra username/password hiện có.
- Nhóm data/nội dung đã chia sẻ vẫn truy cập được theo quyền cũ. Tên chủ nhóm khác trong kết quả chia sẻ được thay bằng `Nhân viên #<id>`; tên của chính mình giữ nguyên. Các ID nghiệp vụ và recipient ID đã lưu được giữ để không phá cấu hình chia sẻ hiện tại. Danh sách ID+tên đồng nghiệp để chọn người nhận bị chặn.
- Quyền service_role và Chat worker giữ nguyên. Login, bootstrap, reset/recovery và truy cập hồ sơ bằng bộ thông tin đăng nhập hợp lệ vẫn theo hợp đồng cũ. Không đổi issuer/token, phiên Auth, dữ liệu staff, mật khẩu, dữ liệu chiến dịch hoặc tài khoản.

Đây là giới hạn **hồ sơ nhân viên và RPC quản trị**, không phải thu hẹp toàn bộ bảng dữ liệu nghiệp vụ hoặc toàn bộ secret khác. Credential/session của tài khoản chạy tự động, proxy và cấu hình media tiếp tục theo quyền trước đó để giữ tương thích. Việc này cũng không xóa được dữ liệu đã bị tải về trước đây; ai có bộ thông tin đăng nhập hợp lệ của một staff khác vẫn có thể xác thực thành staff đó qua luồng đăng nhập hiện có.

## Định nghĩa và checksum

Chụp mới 1.245 hàm trước khi dựng candidate. Đối chiếu tất cả migration liên quan: group sharing giữ body V414 (bao gồm tên tài khoản nguồn), private group access giữ V409, thời hạn giữ V310. Runtime scope giữ hotfix kế thừa `lock_timeout` ngày 27/10 và ACL Chat/Desktop sau V435. Không lấy body từ migration lịch sử để ghi đè live.

| Chữ ký | Source MD5 | Target MD5 |
|---|---|---|
| `public.aka_agent_staff_runtime_scope(bigint,text)` | `41d7a8af8bb781e59157a5b919621492` | `b24e654e7f7d3e840db80611affdaa43` |
| `public.aka_agent_staff_time_allowed(bigint)` | `a294e60011edd8d42e90ac2f74ce744c` | `7569f2b3816985cac48c114c891b5672` |
| `public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)` | `d6bbdca20f780005a411e8a6be6ae8e5` | `5bb87b66104f2dad716797e28cd6cccc` |
| `private.group_access(text,bigint,bigint,bigint)` | `251162422553d81d432151554b5ea16a` | `d173eaf22b0b6b6958a6f8f40cdaa82d` |
| `private.aka_agent_staff_scope_for_request()` | mới | `d417807fa9dc08cfecbd6cd0aab7df3e` |

Helper mới SECURITY DEFINER/STABLE, search_path `pg_catalog`; chỉ postgres, Desktop, service_role, Chat có EXECUTE. Dùng `current_setting('role')` để nhận diện caller qua các lớp SECURITY DEFINER; `current_user` trong những lớp đó là owner nên không dùng để phân loại request. View giữ security_barrier, thứ tự/kiểu cột và ACL. Lookup danh tính dùng scalar subquery trong view để PostgreSQL có thể tính một lần mỗi statement, theo [hướng dẫn Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations).

## Kiểm chứng

- **11 nhóm PostgreSQL 17 local** với toàn bộ metadata live và dữ liệu giả lập: guard từ chối patch mới ngoài dự kiến; 12 lời gọi own-user trước/sau giống nhau; bootstrap login/startup; cấm đọc cùng org/khác org; claims sai đóng quyền; sáu RPC admin bị từ chối ngay cả khi biết credential admin; danh sách chia sẻ rỗng; nhóm đã chia sẻ còn dùng được và tên chủ khác bị che; backend/Chat tương thích; validation/lock timeout giữ nguyên; metadata ngoài phạm vi giữ nguyên; hoàn nguyên chính xác và chạy candidate trong transaction rollback.
- **Production rollback trial trước apply**: đủ cả **6 staff đang có mapping Auth**, bao gồm admin; so sánh own profile, runtime/capability, khóa staff, chặn staff khác, chặn admin RPC và recipient picker. Không xuất username/password/token hoặc profile ra kết quả tool. Kiểm tra mọi hàm/relation ngoài phạm vi. Sau đó chạy rollback trong cùng giao dịch, kiểm chứng khôi phục chính xác rồi ROLLBACK. Không ghi hàng nghiệp vụ.
- **Production hậu kiểm** cùng các ca trên đạt lúc 01:02:54 VN. Tổng 1.246 hàm: một helper mới; chỉ bốn body đổi, sáu ACL Desktop đổi. **1.241 định nghĩa hàm cũ còn lại giữ checksum**. View runtime là relation duy nhất đổi definition; toàn bộ ACL bảng/cột, RLS, policy, trigger, constraint, role, default ACL giữ nguyên. Hook chặn IP giữ MD5 `ecfc014981c5058f9cd84e0e8e504bed`.
- **20 HTTP checks đạt**: anon cũ/publishable vẫn bị chặn ở bảng bảo vệ; startup RPC và ngoại lệ cập nhật app cũ hoạt động; feed ba nền tảng vẫn 9.1.0; backend health HTTP 200.
- Kiểm tra quyền của phiên Desktop thật được mô phỏng bằng SET ROLE + claims ngay trong DB; không trích xuất/mint access token và không mở lại toàn bộ bộ cài hoặc chạy chiến dịch khách thật. Không cần typecheck/build vì không sửa mã client.

Evidence: [verification.json](../migrations/snapshots/staff-self-access/verification.json), [local-test.json](../migrations/snapshots/staff-self-access/local-test.json), [production-trial.json](../migrations/snapshots/staff-self-access/production-trial.json), [production-post-check.json](../migrations/snapshots/staff-self-access/production-post-check.json), [http-test.json](../migrations/snapshots/staff-self-access/http-test.json). Candidate target và bằng chứng kiểm thử còn ở thư mục này; bản chụp metadata đầy đủ trước/sau đã chuyển sang kho ngoài repo nêu ở đầu tài liệu. Các snapshot này không sao chép hàng khách hàng.

## Hoàn nguyên

[rollback_desktop_staff_self_access.sql](../migrations/rollback_desktop_staff_self_access.sql) yêu cầu chỉ thị riêng để mở lại quyền đọc staff/quản trị. Guard yêu cầu target checksum và ACL chính xác, cùng GUC `aka_agent.staff_self_access_rollback='approved'`. Chạy trong transaction, kiểm tra rồi COMMIT chỉ khi thật sự được yêu cầu. Rollback đã diễn tập local và production trong giao dịch không commit; sau apply không rollback quyền thật.

**Sửa finding P2 ngày 28/10/2026:** bổ sung guard kiểm tra đầy đủ định nghĩa, ACL, owner và options của view `aka_agent_staff_runtime_profile` trước khi rollback ghi đè. Generator trong `scripts/staff-self-access/smoke.cjs` cũng giữ guard này khi sinh lại SQL. Đối chiếu read-only xác nhận metadata view production còn khớp target đã lưu. 12 nhóm PostgreSQL 17 local đạt, gồm bốn ca từ chối khi định nghĩa/quyền/owner/security_barrier bị thay đổi, metadata không bị sửa sau các ca từ chối và hoàn nguyên chính xác khi target khớp. Chỉ sửa file local; không chạy rollback hoặc thay đổi quyền production. Đây vẫn là rollback của bản 01:02; các guard RPC cũ phải tiếp tục từ chối những patch mới hơn, không cập nhật checksum để vượt guard.

Không chạy lại generator/rollback/candidate permission cũ làm mất giới hạn này. Migration sau có đụng bốn hàm trên hoặc view runtime phải chụp lại live và giữ patch self-access này.

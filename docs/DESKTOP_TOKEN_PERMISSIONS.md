# Rà soát quyền token Desktop — 27/10/2026

Đã apply **chỉ phần quyền của `aka_agent_desktop`** trên akachat `cgjbsmqtfhqvttudyjzq`. Không thu hồi anon/authenticated, không bật hoặc đổi RLS/policy, không sửa dữ liệu khách hàng, không thay source ứng dụng/query/mapper/timeout trong lượt này. Không cần build lại chỉ để nhận thay đổi ACL; bộ cài token mới vẫn chưa phát hành.

| Migration production | Giờ Việt Nam | Canonical |
| --- | --- | --- |
| `20261027143544 / desktop_token_least_privilege` | 21:35:44 | `supabase/migrations/20261027141754_desktop_token_least_privilege.sql` |
| `20261027143914 / desktop_proxy_payload_permissions` | 21:39:14 | `supabase/migrations/20261027143747_desktop_proxy_payload_permissions.sql` |
| `20261027145236 / desktop_embedded_join_permissions` | 21:52:36 | `supabase/migrations/20261027144727_desktop_embedded_join_permissions.sql` |

Không apply lại A, hotfix pre-request hoặc các migration trên. Candidate B và rollback cũ đã bị chặn bằng lỗi không điều kiện vì phần GRANT cũ sẽ cấp lại quyền dư. Hai generator cũ cũng bị chặn. Khi người dùng cho phép khóa anon, phải capture live mới và dựng cutover/rollback từ quyền đã thu hẹp; **không xóa guard rồi chạy lại bản B cũ**, không bulk-push migrations.

## Kết quả

- `org_staff`: không còn quyền đọc/ghi trực tiếp bằng token Desktop. Đăng nhập, khôi phục bằng máy, đổi mật khẩu và quản lý nhân viên tiếp tục dùng RPC hiện có; Server dùng role riêng. Runtime đọc view không chứa mật khẩu.
- `org_organization`: chỉ SELECT; không INSERT/UPDATE/DELETE/TRUNCATE. Token không sửa trực tiếp `organization_id` hoặc `staff_id` của `auto_accounts`/`auto_campaigns`.
- Bỏ TRUNCATE/REFERENCES/TRIGGER và các quyền không có đường dùng trong app. INSERT/UPDATE cấp theo cột payload; giữ DELETE chỉ nơi source thực sự dùng. Sequence chỉ giữ USAGE nơi INSERT cần.
- Bỏ EXECUTE trên 268 hàm ứng dụng không cần thiết, gồm `public.aka_agent_get_vault_secret(text)`. Với hàm trước đây hưởng EXECUTE qua PUBLIC, giữ nguyên quyền hiệu lực cho 35 role hiện có khác rồi mới bỏ PUBLIC để token Desktop thực sự bị chặn. Không bổ sung quyền hiệu lực cho các role đó.
- Những tính năng có thật như sửa workflow/block/element/cấu hình media vẫn cần quyền ghi. Bản này không thêm phân quyền từng dòng hoặc vai trò admin riêng; token còn có thể tự gọi các thao tác được giữ. Không cam kết đã ngăn mọi hành vi sửa dữ liệu bằng token.
- **Anon vẫn giữ mọi quyền hiệu lực trước đó theo yêu cầu người dùng.** Vì vậy người giữ anon cũ vẫn truy cập như trước đến khi được phép cutover.

## Cách rà soát và kiểm chứng

`least-privilege-source.cjs` dùng TypeScript AST/type checker cho 646 callsite, resolve tên bảng/RPC động, payload/union/spread/builder; loại các đường chỉ chạy trên Server tin cậy. Hai payload Record qua nhiều hàm có checksum source bắt buộc. Không còn payload ghi chưa resolve. Builder phải được phân tích trước inferred type: TypeScript có thể mất các trường khi spread `Record<string,unknown>`. Đã sửa thứ tự này và bổ sung riêng bảy cột tạo/sửa Proxy bằng migration thứ hai, giữ nguyên migration đã apply đầu tiên.

`least-privilege-sql.py` dùng parser PostgreSQL để đi theo SECURITY INVOKER, trigger, default, CHECK và RLS policy; dừng tại SECURITY DEFINER vì nội bộ chạy bằng quyền owner. Không có dynamic SQL hoặc dependency chưa resolve trong phạm vi cần quyền caller. Inventory có 55 relation dependency và 152 function dependency (gồm hàm extension chuẩn); migration rà 65 bảng/view, 64 sequence và giữ 151 hàm ứng dụng cần dùng.

Kiểm tra cuối:

- PostgreSQL 17 local: 10 nhóm đạt, gồm tạo/sửa Proxy đủ payload, account/campaign, staff RPC/bootstrap, view runtime, AI read, pre-request; phủ cả ca bị từ chối đọc/sửa staff, Vault, đổi org account/campaign, hard delete, TRUNCATE và sửa catalog không dùng. 149 hàm không thuộc runtime của test là stub chỉ để kiểm ACL, không dùng để khẳng định nghiệp vụ của các hàm đó.
- Đủ 836 quyền bảng/cột; 151 RPC cần giữ có EXECUTE; 268 hàm dư không còn EXECUTE. Tất cả đã kiểm lại trên production, không ghi dữ liệu khách để thử.
- Trước apply: chạy candidate trong transaction ROLLBACK trên production; guard kiểm drift ACL/body/config/owner/schema/default/trigger/check/roles. Sau apply: hash quyền hiệu lực bảng/cột/hàm/sequence của cả 35 role khác giữ nguyên; hash toàn bộ function definitions, role metadata, memberships, RLS và policies giữ nguyên.
- Hai typecheck app đạt. Lượt này không sửa code chạy của app nên không đóng gói/redeploy endpoint. Chưa canary toàn bộ UI hoặc tài khoản khách thật; SQL smoke không thay thế việc đó.
- Candidate cutover và rollback cũ bị từ chối kể cả đã đặt các cờ approval cũ. Checksum V431 và mọi patch live giữ nguyên qua hash toàn bộ hàm.

Hai dependency có chủ ý không cấp thêm: `ai_log` chỉ SELECT `id` đúng query; nhánh trigger quản trị `auto_control_web_device_policy` chưa từng có quyền UPDATE cho Desktop và không được các key media của app kích hoạt. Không mở quyền mới cho nhánh đó.

Snapshot/receipt ở `migrations/snapshots/desktop-session-rls/`: `least-privilege-preflight.json`, `least-privilege-schema-dependencies.json`, `least-privilege-source.json`, `least-privilege-dependencies.json`, `least-privilege-plan-corrected.json`, `least-privilege-applied.json`, `proxy-payload-applied.json`, `least-privilege-final-state.json`, `least-privilege-final-verification.json`. Chỉ metadata, không có secret hoặc dữ liệu khách. `least-privilege-plan.json` là plan của migration đầu đã apply; plan corrected là trạng thái cuối cần dùng.

`public.aka_agent_get_vault_secret(text)`: source=target body MD5 `a99f67a293add94677a9f85145fe211d`; owner/security/config/caller Sheet/email giữ nguyên, chỉ ACL Desktop bị gỡ. Pre-request `public.aka_agent_block_denied_ip_request()` vẫn được giữ EXECUTE, body MD5 `ff086d95d4ba66cad668bfe48a705e11`; không đổi IP block.

Security advisor vẫn báo các vấn đề legacy (bảng public chưa RLS, hàm SECURITY DEFINER gọi bằng anon, view definer, search_path...). Chúng không được sửa trong lượt này vì sẽ vượt yêu cầu giữ quyền cũ/RLS. [Giải thích cảnh báo RLS của Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).

Đã kiểm tra thêm các schema ngoài phạm vi bảng ứng dụng: Desktop không có CREATE trên schema nào, không có USAGE auth/storage/vault. Quyền mặc định extension trên `net` còn tồn tại nhưng schema không được Data API expose: probe chỉ đọc `limit=0` trả HTTP 406/PGRST106, danh sách expose là public và graphql_public. Không chỉnh extension hoặc quyền hệ thống trong lượt này. Số lượng các loại cảnh báo advisor trước/sau không đổi; bằng chứng ở `least-privilege-schema-advisor-check.json`.

## AI: đã viết proxy, chưa triển khai production

Sau lượt rà soát quyền, theo yêu cầu tiếp theo đã sửa source Desktop chỉ đọc các cột model không bí mật và gửi AI qua API mới trong akaAgentWebApp. Bộ dựng request/parser/log giữ nguyên; API giữ key, xác thực token và chọn model/endpoint từ DB. Trusted App Server giữ đường gọi cũ. **V434 chưa apply, API chưa deploy, Desktop chưa phát hành**; xem [hợp đồng và kiểm chứng](DESKTOP_AI_PROXY.md).

Giải pháp cuối dùng WebApp API, không thêm Edge Function. Timeout theo DB (tối đa hiện tại 300 giây), hủy và không retry được giữ ở transport; bổ sung giới hạn body/admission của máy chủ được ghi rõ trong hợp đồng. Không chuyển toàn bộ truy cập DB của app sang API trong lượt này.

**SELECT api_key của token và anon trên production vẫn được giữ theo yêu cầu trì hoãn khóa.** Vì vậy source mới không nhận key nhưng người giữ quyền cũ vẫn tự query được. Sau khi API/app mới hoạt động, chỉ lúc người dùng yêu cầu mới chặn đọc key qua token/anon và audit mọi view/RPC/JSON có thể lộ key; không tự xoay key hoặc bật RLS. Thay đổi source không được coi là đã hoàn tất cutover bảo mật.

## Ma trận quyền cuối

INSERT/UPDATE bên dưới luôn là danh sách cột cụ thể, không GRANT toàn bảng; xem plan corrected để biết đầy đủ cột và callsite/dependency trong source report. Kết quả mới nhất sau sửa embedded join là **837 quyền**, 56 relation dependency; 151 RPC cần giữ và 268 hàm bị gỡ không đổi. Các số 836/55 và 10 nhóm ở phần audit trước là kết quả trước sửa join.

### Sửa embedded join — 27/10/2026, 21:52 VN

Review xác nhận `listDataTypeCategoryItems()` join `category_item` với `category_type`, nhưng inventory cũ chỉ xét `.from()` nên thu hồi nhầm quyền đọc bảng đích. Production với role Desktop trả 42501, ảnh hưởng danh mục loại nhóm data và lưu kết quả Kiểm tra SĐT vào nhóm.

Đã bổ sung SELECT `category_type` bằng migration riêng ở trên, giữ nguyên policy SELECT đã có. Không sửa query/parser/mapper của app, không bật RLS hay cấp quyền ghi. Hai migration thu hẹp quyền trước giữ nguyên checksum, không apply lại.

Inventory nay xét mọi PostgREST `.select()`, kể cả query đã gán vào biến; resolve alias, hint/FK, inner, spread, empty/nested embed, string/template/union, array join, static filter và helper parameter. Aggregate không bị coi là bảng; biểu thức hoặc relationship không resolve được làm audit dừng. 313 select/60 embedded select đạt; so với plan trước chỉ bổ sung category_type, không đổi function/sequence grant.

`select-dependencies-smoke.cjs` kiểm parser/resolver và callsite thật. `least-privilege-smoke.cjs` đạt **11 nhóm**, có gọi repository + SDK thật qua SQL bridge hẹp đến PostgreSQL: trước thu hẹp đọc đúng, sau thu hẹp tái hiện 42501, sau fix trả đúng hai loại/sort/thứ tự/kiểu, loại record inactive/sai namespace; UPDATE vẫn bị từ chối. Đây không phải PostgREST server local. Guard ACL drift, toàn bộ quyền role khác/body/config/RLS và legacy cutover guard tiếp tục đạt.

Dry run production ROLLBACK và post-apply READ ONLY đạt: kết quả JSON query join của anon/Desktop giống nhau, Desktop chỉ SELECT; hash quyền hiệu lực 35 role khác và toàn bộ role/function/RLS/policy metadata không đổi. Receipt: `embedded-join-preflight.json`, `embedded-join-applied.json`, `embedded-join-local-verification.json`; final-state và plan corrected đã cập nhật. Chưa canary UI bộ cài thật; sửa ACL có hiệu lực mà không cần build lại app.

| Bảng/view | Quyền Desktop được giữ |
| --- | --- |
| `public.ai_form_configs` | SELECT |
| `public.ai_log` | SELECT (1 cột), INSERT (30 cột) |
| `public.ai_model` | SELECT |
| `public.ai_prompt` | SELECT |
| `public.ai_using` | SELECT |
| `public.aka_agent_staff_runtime_profile` | SELECT |
| `public.aka_crm_status` | SELECT |
| `public.auto_account_action_status` | SELECT, INSERT (5 cột), UPDATE (10 cột) |
| `public.auto_account_action_status_policies` | SELECT |
| `public.auto_account_actions` | SELECT |
| `public.auto_account_contact_group_members` | SELECT, INSERT (4 cột), UPDATE (4 cột) |
| `public.auto_account_contact_groups` | SELECT, INSERT (8 cột), UPDATE (3 cột) |
| `public.auto_account_contacts` | SELECT, INSERT (16 cột), UPDATE (16 cột) |
| `public.auto_account_error_state` | SELECT, INSERT (5 cột), UPDATE (3 cột) |
| `public.auto_account_groups` | SELECT, INSERT (6 cột), UPDATE (6 cột) |
| `public.auto_account_logs` | INSERT (9 cột) |
| `public.auto_accounts` | SELECT, INSERT (12 cột), UPDATE (27 cột) |
| `public.auto_automation_actions` | Không có |
| `public.auto_automation_data_types` | Không có |
| `public.auto_blocks` | SELECT, INSERT (14 cột), UPDATE (14 cột), DELETE |
| `public.auto_campaign_action_data_types` | SELECT |
| `public.auto_campaign_action_detail_statuses` | SELECT |
| `public.auto_campaign_actions` | SELECT, INSERT (10 cột), UPDATE (10 cột) |
| `public.auto_campaign_details` | SELECT, INSERT (11 cột), UPDATE (3 cột) |
| `public.auto_campaign_error_state` | SELECT, INSERT (6 cột), UPDATE (6 cột) |
| `public.auto_campaign_input_data` | SELECT, INSERT (16 cột), UPDATE (17 cột) |
| `public.auto_campaign_inputs` | SELECT, INSERT (8 cột), UPDATE (9 cột) |
| `public.auto_campaign_run_events` | SELECT, INSERT (24 cột) |
| `public.auto_campaign_zalo_realtime_group_events` | SELECT, INSERT (9 cột), UPDATE (2 cột) |
| `public.auto_campaigns` | SELECT, INSERT (26 cột), UPDATE (33 cột) |
| `public.auto_contact_tags` | SELECT, INSERT (4 cột), UPDATE (3 cột) |
| `public.auto_content_groups` | SELECT, INSERT (7 cột), UPDATE (6 cột) |
| `public.auto_content_templates` | SELECT, INSERT (9 cột), UPDATE (9 cột) |
| `public.auto_control_web_device_policy` | Không có |
| `public.auto_elements` | SELECT, INSERT (8 cột), UPDATE (8 cột), DELETE |
| `public.auto_email_link_trackings` | SELECT, INSERT (3 cột), UPDATE (2 cột) |
| `public.auto_email_message_trackings` | SELECT, INSERT (6 cột), UPDATE (5 cột) |
| `public.auto_email_notification_deliveries` | INSERT (4 cột) |
| `public.auto_email_notification_settings` | SELECT, INSERT (9 cột), UPDATE (9 cột) |
| `public.auto_error` | SELECT |
| `public.auto_media_files` | SELECT, INSERT (9 cột), UPDATE (2 cột) |
| `public.auto_media_group_items` | SELECT, INSERT (4 cột), UPDATE (4 cột), DELETE |
| `public.auto_media_groups` | SELECT, INSERT (4 cột), UPDATE (3 cột) |
| `public.auto_proxies` | SELECT, INSERT (9 cột), UPDATE (9 cột) |
| `public.auto_run_steps` | SELECT, INSERT (11 cột), UPDATE (5 cột) |
| `public.auto_runs` | SELECT, INSERT (11 cột), UPDATE (4 cột) |
| `public.auto_staff_device_login_settings` | Không có |
| `public.auto_status` | SELECT |
| `public.auto_system_settings` | SELECT, INSERT (6 cột), UPDATE (6 cột) |
| `public.auto_workflows` | SELECT, INSERT (10 cột), UPDATE (10 cột), DELETE |
| `public.auto_zalo_api_error_logs` | INSERT (16 cột) |
| `public.category_item` | SELECT |
| `public.category_type` | SELECT |
| `public.org_group` | Không có |
| `public.org_group_staff` | Không có |
| `public.org_organization` | SELECT |
| `public.org_organization_product` | SELECT |
| `public.org_staff` | Không có |
| `public.v_sales_opp_overview` | Không có |
| `public.v_sales_opp_task_hom_nay` | Không có |
| `public.v_trial_cham_14ngay` | Không có |
| `public.zalo_accounts` | SELECT, INSERT (7 cột), UPDATE (7 cột) |
| `public.zalo_group_members` | SELECT, INSERT (15 cột), UPDATE (15 cột) |
| `public.zalo_groups` | SELECT, INSERT (33 cột), UPDATE (33 cột) |
| `public.zalo_users` | SELECT, INSERT (37 cột), UPDATE (37 cột) |

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

## Rà soát liên repo ngày 28/10/2026

**Còn năm luồng dùng anon cần sửa trong Chat API, ChatWeb và akaMap.** Giữ quyền SQL của backend không bảo đảm mọi đường HTTP phụ của backend đó hoạt động. Lượt audit này chỉ đọc production và chạy fixture local, không apply migration, deploy, sửa runtime hoặc mở lại quyền anon. Kết quả HTTP cuối lúc 00:31:47 Việt Nam.

### Các lỗi xác nhận được

| Repo và đường gọi | Bằng chứng | Ảnh hưởng và hướng sửa |
|---|---|---|
| akaAgentChatApi — `packages/database/src/campaignEngagementConfig.ts:17` | Reader dùng anon từ `accountLogHttp.ts`; GET cấu hình `zalo.campaign_engagement.*` trả HTTP 401, `42501 permission denied for table auto_system_settings`. | Cache hết hạn sau 60 giây thì worker không đọc được cấu hình để cập nhật metadata phản hồi/đã xem/reaction/kết bạn. `CampaignEngagementRepository.tick()` dừng lượt tracking và retry; `revision()` trả rỗng khi chưa có config. Đây là nhánh theo dõi tương tác tùy chọn, không phải bằng chứng toàn bộ gửi chiến dịch dừng. Chuyển reader sang đường backend tin cậy với đúng bốn setting, giữ timeout/cache và hành vi gửi. |
| akaAgentChatApi — `packages/database/src/accountLog.ts:13` | `createDatabase()` của API và worker không truyền override; mặc định HTTP anon gọi `aka_agent_record_account_log`. Live không còn EXECUTE anon; logs sau cutover có 40 HTTP 401 trên RPC này. | Mất các bản ghi chẩn đoán tài khoản; hàm chủ động nuốt lỗi và không retry nên luồng chính vẫn tiếp tục. Cần thay credential/đường backend của recorder, giữ tính độc lập với nghiệp vụ; không cấp lại RPC cho anon. |
| akaAgentChatApi — `apps/chat-api/src/appNotification.ts:15` | GET `app.notification` bằng anon trả HTTP 401/42501. | `/api/chat/zalo/app-notification` lỗi khi không có thông báo riêng cho staff và rơi vào fallback hệ thống. Có thể dùng RPC hẹp `aka_agent_desktop_login_content()` rồi chọn đúng thông báo, giữ ưu tiên staff và parser. |
| akaAgentChatWeb — `lib/login-screen-content.js:19` | Endpoint production `/api/auth/login-content` trả HTTP 503; source gọi bảng settings bằng anon rồi biến lỗi thành 503. | Mất thông báo và bốn link trên màn hình đăng nhập; endpoint xác thực là luồng riêng. Chuyển sang RPC công khai hẹp hiện có, đã xác minh HTTP 200. RPC đã lọc active/nonsecret nhưng không trả hai cờ này, nên phải điều chỉnh mapper tương ứng, không giữ filter làm mất toàn bộ kết quả. |
| google-map/akaMap — `src/main/services/data-groups.ts:345` | GET `category_item` với embedded `category_type` trả HTTP 401/42501. Bốn RPC list groups/list datasets/create/ingest cũng mất EXECUTE anon. Fixture đổi role thật tái hiện lỗi quyền của client list RPC. | Đăng nhập akaMap qua `akamap_staff_client` vẫn có quyền; phần nhóm data và đưa kết quả quét sang akaAgent bị chặn. Cần token hoặc backend cho riêng data-group service và danh mục, giữ payload và các kiểm tra credentials hiện có. Không đặt service-role trong bản cài khách. |

Ưu tiên khôi phục engagement Chat và nhóm data akaMap, sau đó recorder và thông báo/login content. Không sửa bằng cách cấp rộng lại anon. Các RPC public bootstrap chỉ phù hợp dữ liệu công khai; việc mở rộng quyền backend, nếu cần, phải giới hạn đúng caller/câu đọc/RPC và kiểm chứng cả dependency. Không thêm pool SQL hoặc thay timeout/nghiệp vụ để chữa quyền.

### Đối chiếu sự cố org_staff buổi chiều

Commit sửa `dadbb721`, merge `91031bb0` (PR #560), tương ứng migration đã apply lúc 17:29:39 ngày 27/10. Nguyên nhân và phục hồi ở [STAFF_RUNTIME_CHAT_PERMISSIONS.md](STAFF_RUNTIME_CHAT_PERMISSIONS.md): thiếu SELECT view `aka_agent_staff_runtime_profile` và EXECUTE `aka_agent_staff_runtime_scope(bigint,text)` cho role SQL `aka_agent_chat_api`.

Hai quyền này vẫn còn trên live sau V435; role Chat vẫn BYPASSRLS và có quyền nền trên staff. Fixture PostgreSQL 17 với definition/owner/ACL/policy chụp từ live, dữ liệu giả, đổi sang role Chat thực thi đọc view, cả scope `share`/`update`, service overload đọc nhóm data và cleanup với payload hợp lệ nhưng campaign không tồn tại (`false/not_found`) đều đạt. Không cấp membership production để vượt giới hạn SET ROLE của tài khoản quản trị. Bài cleanup này kiểm chứng quyền đường vào/helper, không phải một lượt cleanup chiến dịch khách thật.

### Phạm vi và kết quả còn lại

Đã kiểm kê 20 checkout chính; 19 repo có remote được fetch và không lệch upstream ở thời điểm kiểm tra. Hai worktree trùng không tính thành repo riêng. Đã tìm thêm trong danh sách 53 repo GitHub của aligoinc, kiểm tra riêng 36 repo chưa có checkout chính; kết quả tìm kiếm là trên default branch, không đại diện mọi bản deploy cũ. Những file người dùng/task khác đang sửa được giữ nguyên.

| Nhóm repo | Kết quả trong đường gọi đã kiểm tra |
|---|---|
| akaAgent Desktop và App Server | 987 assertion quyền Desktop được giữ đạt; fixture đọc runtime profile/helper, metadata AI và category join đạt. App Server nội bộ dùng backend credential. HTTP updater cũ vẫn 200 và thấy một setting; RPC login content mới 200. Không thấy thiếu quyền mới ở các đường đã đối chiếu. |
| akaAgentWebApp, gồm Web/mobile | Backend dùng service_role; endpoint login content production 200. Đã kiểm tra source gọi RPC đúng overload và helper/backend, không suy quyền từ frontend key. |
| akaBizApi, akaBizSms, akaBizSmsMac, akaBizSMSWeb | SMS/mobile đi qua backend API; API Supabase dùng service_role. SMSWeb cũ dùng SQL Server. Không thấy đường mới bị V435 thu hồi trong phạm vi source đã đọc. |
| akaBizWebClient, akaBizWebPortal | Các đường Supabase liên quan chạy backend dùng secret/service credential. |
| akabiz-zalo-gateway | Legacy tables ngoài cutover; ingest/message-state RPC dùng `requireSupabaseAdmin`, không dùng client anon mặc định. |
| akaBizAff, akaBizAuto, akaBizFacebook, akaBizFacebookWebApp, akaBizZalo, akaBizZaloApi, akaBizZaloWebApp, akabizrpa | Rà source Supabase/SQL và đối chiếu tên bảng/RPC trong phạm vi V435; chưa thấy regression quyền mới. Không đánh đồng các quyền anon đã thiếu trước V435 với lỗi cutover này. |
| akaCRM, akaBizChat, akaBizChatServer, akaAgent_OpenCode, agent_cskh, akabiz-chat-web, pancake_mess | Đọc thêm 90 file runtime qua GitHub, đối chiếu với catalog live và các trigger legacy; chưa thấy caller cần quyền bị thu hồi mới. akaCRM dùng bảng legacy `staffs`, không phải trực tiếp `org_staff`. |
| akaStaff và Ads-Page-Maker | Đường được tìm thấy đi qua Edge Functions `getinfo_app_ghiam`/`track-web-visit`; function sau dùng service_role. |

Đã đọc 17 Edge Function đang triển khai liên quan các caller trên, gồm session issuer, tạo CRM/customer, logging/tracking, email worker/open/click, Google Sheet sync và các endpoint legacy. Đường DB liên quan dùng service_role; các function không truy cập DB không chịu ACL bảng. Đây không phải audit toàn bộ 111 Edge Functions hoặc thử ghi nghiệp vụ qua chúng.

Kiểm tra gián tiếp 82 trigger trên 30 bảng legacy và các helper reachable. `fn_set_chat_zalo_cskh_source()` là invoker đọc `aka_crm_status` đã khóa anon, nhưng những caller `trigger_from_contact` tìm thấy chạy qua `fn_upsert_aka_customer_v1`/contact/referral/nudge SECURITY DEFINER owner postgres hoặc Edge service_role, nên không kết luận nhầm thành lỗi CRM. Các dependency thiếu quyền khác phải so before/after; một số đã thiếu từ trước hoặc chỉ được nhắc trong chuỗi metadata, không phải lời gọi thực thi.

**Rủi ro có sẵn ở akaCRM:** source frontend tạo `supabaseAdmin` từ `VITE_SUPABASE_SERVICE_ROLE_KEY`. Nếu biến được điền khi build thì key được đưa vào JavaScript phía khách; dùng nội bộ không làm mất rủi ro này. Cần chuyển thao tác admin về backend riêng. Lượt này chưa xác minh giá trị/bundle production, không đọc/in key và không xoay credential.

### Bằng chứng và giới hạn

- Snapshot catalog kiểm tra lúc đầu audit khớp digest sau V435 `2b27a17c504a2c7eb855a999009af162`. Không suy ra mọi đường gọi anon đều tương thích chỉ từ việc giữ nguyên quyền backend.
- Cửa sổ logs production 23:53:25 ngày 27/10 đến 00:11:18 ngày 28/10: Desktop role có 4.405 HTTP 200, 95 HTTP 201, 164 HTTP 204; không thấy 401/403/5xx. Service role không thấy lỗi quyền. PostgreSQL permission errors trong cửa sổ này thuộc `authenticator`, không thấy lỗi quyền từ role SQL Chat/CRM. Số request thành công không thay thế kiểm chứng từng tính năng.
- Logs vẫn có nhiều lỗi anon từ app cũ hoặc nhánh chưa chuyển; user-agent `node` không đủ xác định repo/phiên bản. Chỉ gán finding khi ghép được source, quyền live và đường HTTP tương ứng.
- Fixture local xác nhận 987 quyền giữ lại, các dependency Chat nêu trên, và tái hiện năm trường hợp anon bị chặn. Fixture không có dữ liệu khách; schema usage được cấp cho môi trường dựng, quyền schema cần thiết của role Chat được đối chiếu riêng trên live.
- HTTP đọc thật lúc 00:29:49: engagement/settings Chat/category akaMap đều 401/42501; updater cũ 200. Lúc 00:31:47: RPC public login content 200, ChatWeb login content 503, WebApp login content 200. Không gọi gửi tin, tạo nhóm, ingest hoặc thay đổi dữ liệu khách để thử.
- Evidence/script riêng ở `~/.codex/audits/supabase-cross-repo-20261028/`: source inventory, dependency review, HTTP receipts và `local-role-smoke-result.txt`. Raw source/metadata/log giữ ngoài Git, không đưa credential/dữ liệu khách vào báo cáo.

Chưa kiểm chứng tất cả màn hình trên từng app, từng bản cài cũ hoặc mọi deployment branch; không tuyên bố toàn hệ thống đã chạy hoàn toàn. Các finding trên **chưa sửa** trong lượt audit này.

## Sửa năm luồng HTTP — candidate 28/10/2026

Theo yêu cầu tiếp theo của người dùng, đã sửa source của năm luồng nêu trên trong Chat API, ChatWeb và akaMap, giữ chức năng/timeout; **chưa apply migration hoặc deploy production**. Ba checkout được fetch và xác nhận bằng upstream trước khi tạo nhánh `codex/rls-http-compat`: Chat API từ `58a1252`, ChatWeb từ `8d9ecfd`, akaMap từ `3f17c29`. Không sửa phần AI dấu `|` đã hoãn.

| Luồng | Cách sửa | Giới hạn giữ nguyên |
|---|---|---|
| Chat engagement | Secret backend + reader hẹp service-only `aka_agent_chat_aux_settings('engagement')`; đúng bốn setting active/nonsecret | HTTP 5s, DB 3s, cache RAM 60s, best effort |
| Chat account log | Cùng RPC/body hiện tại, đổi sang credential server của API và worker | HTTP 5s, DB 4s/lock 1s, không queue/retry/SQL pool |
| Chat system notice | Reader service-only scope `notification`, giữ active key, ưu tiên notice staff và parser | HTTP 10s, DB 3s |
| ChatWeb login content | RPC public hẹp `aka_agent_desktop_login_content()` đã có; chấp nhận thiếu flags đã được SQL lọc | HTTP 10s, caller abort, refresh/UI/parser cũ |
| akaMap nhóm data | Gateway Edge allowlist năm thao tác, credential chỉ giữ trên backend, wrapper typed gọi overload cũ | Catalog/create DB 3s; list/datasets/ingest 60s; không thêm client/Edge deadline |

System notice sau login trước đây không lọc `is_secret`; reader backend giữ đúng điều kiện đó. ChatWeb public vẫn chỉ trả nonsecret. Không dùng public login RPC cho cả hai vì sẽ vô tình thay logic notice Chat.

### Quyền và hợp đồng SQL

Candidate: [20261027173856_cross_repo_http_permissions.sql](../supabase/migrations/20261027173856_cross_repo_http_permissions.sql). Chỉ thêm bảy hàm mới (nguồn live chưa tồn tại), owner postgres, SECURITY INVOKER, search_path cố định, EXECUTE chỉ postgres/service_role. REVOKE rõ PUBLIC/anon/authenticated vì default ACL production có grant riêng. Không thay hàm hiện có, bảng, policy, role, pool hoặc quyền anon đã thu hồi. Reader mới có function-level timeout để PostgREST hoist đúng ngân sách cũ; service_role mặc định kế thừa authenticator 8s, nên chỉ thay key mà không giữ timeout sẽ sai yêu cầu.

Helper cũ `auto_assert_automation_identity` tin service_role và return sớm. Helper private mới kiểm tra đúng predicate caller thường: id/org/active/username/password; mỗi Map wrapper gọi helper này trước overload cũ. Không bổ sung điều kiện subscription, máy, quyền admin hoặc ràng buộc tổ chức mới. Category giữ join/filters/order cũ. List/datasets giữ RETURNS TABLE đúng kiểu; không gom thành JSON scalar làm mất giới hạn hàng PostgREST. Ingest/create giữ JSONB cũ. Edge chuyển nguyên bytes thành công, không đổi timestamp/bigint/null; error chỉ giữ code/message, bỏ details/hint.

Map giữ page 200, sáu dataset request đồng thời, chunk 10.000 dòng, hai lần thử và request ID/hash cũ; Edge không tự retry. Gateway JWT public chỉ là khóa đi qua Edge, không cấp quyền dữ liệu. Không đóng gói secret backend vào app.

Review đã sửa chặn IP: Edge lấy đủ ba header IP mà hook DB đang dùng và gắn `_edge_ip_headers` vào payload service-only; client tự gửi trường này bị từ chối. Helper yêu cầu context, tạm đặt các candidate gốc cho `aka_agent_block_denied_ip_request()` rồi khôi phục header trước nghiệp vụ. Không gửi lại IP bằng HTTP header ở hop Edge → REST, nên proxy hop sau không thay mất IP gốc; không mang cookie/Authorization trong metadata, không thêm request DB và không nhân bản deny-list trong Edge. Hook live mới nhất đã có cả hai IP chặn, giữ nguyên body/ACL/config/checksum; source được đọc lại trước sửa candidate.

Hai loader Chat chuẩn hóa key rỗng thành `undefined`: `.env.example` dùng DB local được, còn resolver production vẫn yêu cầu backend credential hợp lệ. 50 test tập trung Chat (12 ca key/config mới), 12 test gateway/service/UI akaMap và typecheck hai phần đều đạt. Cơ chế header đầu vào giữ giả định gateway Supabase/Cloudflare của đường REST cũ; hậu kiểm Edge đã deploy vẫn cần thiết. [Tài liệu header Cloudflare](https://developers.cloudflare.com/fundamentals/reference/http-headers/) mô tả header visitor và chuỗi proxy; code giữ mọi candidate mà hook hiện có đã kiểm tra.

Các dependency live đã chụp `pg_get_functiondef`, owner/security/volatility/config/ACL và khóa preflight; nguồn = target, không thay thế:

| Chữ ký existing | MD5 nguồn = sau candidate |
|---|---|
| `aka_agent_block_denied_ip_request()` | `ecfc014981c5058f9cd84e0e8e504bed` |
| `auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` |
| `aka_agent_create_data_group(bigint,bigint,text,text,text,bigint,text,text)` | `715a0e87caf388972e730b14d94ed6ed` |
| `aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)` | `450e18ee137eaa3f5f1032f945bb2dc7` |
| `aka_agent_list_data_group_datasets(bigint,bigint,bigint,text,text)` | `bfb8d564579c245a983814bf94944e2f` |
| `aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)` | `d4d42baec8810c79db4090b982a100e9` |

Target local `md5(pg_get_functiondef)`, source cả bảy hàm mới = absent:

| Chữ ký mới | MD5 target |
|---|---|
| `public.aka_agent_chat_aux_settings(text)` | `3d617a075b57042966d0b532e4e7137a` |
| `private.akamap_assert_data_group_identity(jsonb)` | `fa192c26786b71d42ba2ed3917c3dc0f` |
| `public.akamap_data_group_types(jsonb)` | `3ca461cf05ba92b3fd8f1e6ec30a48b2` |
| `public.akamap_create_data_group(jsonb)` | `34db9ee25c12c111d73813d5c7b1c8b5` |
| `public.akamap_list_data_groups(jsonb)` | `c8fd0c4b8c4e013b869ff13483a7e4d5` |
| `public.akamap_list_data_group_datasets(jsonb)` | `6d3e3aed770aacb2b22923b9aff88ae9` |
| `public.akamap_ingest_data_group(jsonb)` | `7edb60e44988e9576d3442157c1498ab` |

Metadata target lưu ở [targets.json](../migrations/snapshots/cross-repo-http-permissions/targets.json). Capture định nghĩa đầy đủ giữ riêng tại `~/.codex/audits/supabase-cross-repo-20261028/fix-live-functions.json`, không đưa source chứa dữ liệu nội bộ vào Git. Migration từ chối dependency drift và bất kỳ overload cùng tên đã tồn tại; khi live đổi phải chụp và review lại, không bỏ guard hoặc ghi đè.

### Kiểm chứng và giới hạn

- Chat API: toàn bộ 1.603 test/106 file đạt; bổ sung ca timeout notice sau đó và chạy 15 test tập trung đều đạt. Typecheck/build đạt. Bao gồm từ chối key anon/publishable/sai project, secret/JWT headers, log HTTP không SQL/retry, engagement cache/error và notice deadline.
- ChatWeb: build và 179 test đạt; thêm ca deadline/timestamp rồi chạy 5 ca login content và lint đạt. Reader source gọi RPC public production HTTP 200 (234 ms); chưa deploy Web mới.
- akaMap: 15 ca service/classifier/UI/backend đạt; sau bổ sung retry, 9 ca service/backend đạt. Main/renderer build, typecheck main và standalone Edge handler/test đạt. Kiểm tra client thật ghép handler với backend HTTP giả, allowlist/credentials/response bytes/cancel/ID retry.
- [SQL smoke](../scripts/cross-repo-http-permissions-smoke.cjs) dựng PostgreSQL 17 qua Unix socket, metadata-only schema/functions/ACL/policies và synthetic rows. Khôi phục defaults, partial unique indexes và triggers liên quan ingest từ capture, không dùng dữ liệu khách. Schema USAGE là scaffolding local; live service_role đã được đối chiếu quyền schema. Các module không nằm trên đường này không phải bản sao production hoàn chỉnh.
- SQL đạt 12 nhóm kiểm tra: service-only cho bảy hàm, timeout cũ, 120 ca IP/header/route bị chặn (IPv4, IPv6 mapped/hex, CIDR và chuỗi proxy), IP lân cận hợp lệ/khôi phục header, 20 danh tính giả bị từ chối và thiếu credential/context, catalog/create/list/ingest/dataset/replay parity, phân trang và timestamp microsecond. Ingest xác nhận thêm đúng một membership hợp lệ, không chỉ tạo dataset rỗng. Transaction thử apply được rollback; đổi config dependency bị từ chối; tất cả định nghĩa/ACL/config/owner/security hiện có giữ nguyên; apply lại bị từ chối. Rollback có gate/checksum, diễn tập rồi rollback thật trên fixture khôi phục đúng metadata cũ, không mở anon. [Receipt local và SHA-256 migration](../migrations/snapshots/cross-repo-http-permissions/local-verification.json).
- Không gửi tin Zalo, không tạo nhóm/ingest dữ liệu khách. Chưa kiểm chứng HTTP của RPC mới qua PostgREST production, Edge đang deploy hoặc bộ cài Windows; đó là bước hậu kiểm sau khi được phép triển khai.

Tái chạy SQL local: đặt `CROSS_REPO_CAPTURE` trỏ tới `~/.codex/audits/supabase-cross-repo-20261028/review-fixture.json` (metadata cutover + hook IP live đọc lại trong `review-ip-hook.json`), chạy `node scripts/cross-repo-http-permissions-smoke.cjs`. Preflight từ chối snapshot cũ còn hook IP trước incident; script chỉ dựng cluster local rồi xóa, không apply production.

### Triển khai và hoàn nguyên

1. Khi người dùng cho phép apply: fresh capture/preflight rồi apply đúng candidate chung trên akachat; không bulk push hay apply lại V435/A/B/C.
2. Cấu hình `AKA_AGENT_SUPABASE_SERVICE_ROLE_KEY` server-only cho cả Chat API và worker, rồi deploy hai process trên tài nguyên hiện có. Thiếu/sai loại key làm startup dừng trước khi tạo pool, không fallback anon.
3. Deploy ChatWeb; RPC public login content đã có nên không cần migration riêng.
4. Deploy `google-map/supabase/functions/akamap-data-groups` với `verify_jwt=true`, dùng secret Supabase cung cấp trên Edge; hậu kiểm bằng tài khoản test được phép rồi đóng gói/phát hành akaMap.

Hoàn nguyên riêng: [rollback_cross_repo_http_permissions.sql](../migrations/rollback_cross_repo_http_permissions.sql), chỉ sau khi mọi caller mới đã ngừng dùng. Cần setting `aka_agent.cross_repo_http_rollback='approved-after-callers-stopped'`, đúng target definition/metadata/ACL, bọc transaction. Chỉ DROP bảy hàm mới, không CASCADE, không mở anon hoặc rollback cutover. Có thể giữ schema additive khi sửa/rollback image; không quay về client anon để khôi phục chức năng.

## Apply và deploy năm luồng HTTP — 28/10/2026

Candidate phía trên đã apply thành `20261027181400 / cross_repo_http_permissions`, không apply lại. Chat API/worker, ChatWeb, WebApp và Edge akaMap đã deploy; akaMap 3.0.7 đã build local, chưa upload. Giữ nguyên anon đã khóa. Xem [audit production, bộ cài và rollback](CROSS_REPO_RLS_DEPLOY_20261028.md).

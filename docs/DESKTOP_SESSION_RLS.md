# Desktop: thay anon JWT bằng token đăng nhập

**Cutover đã hoàn tất lúc 23:53:25 VN ngày 27/10/2026:** V435 (`20261027165325`) thu hồi anon/authenticated trên dữ liệu akaAgent, bật RLS còn thiếu và bỏ quyền Desktop đọc AI key. Quyền token đã thu hẹp, backend và bootstrap giữ nguyên; app cũ chỉ được đọc một dòng cấu hình cập nhật để nhận 9.1.0. V435 thay bước B và staff C lịch sử; **không chạy B/C hoặc rollback cũ**. Xem [audit V435](DESKTOP_PERMISSION_CUTOVER_V435.md). Các trạng thái chưa thu hồi/chưa deploy bên dưới ghi nhận những giai đoạn trước đó.

**Cập nhật ngày 27/10/2026:** đã thu hẹp quyền token theo tính năng thực tế và bổ sung SELECT `category_type` bị thiếu trong embedded join lúc 21:52 VN. Không còn đọc/ghi trực tiếp staff, sửa tổ chức hoặc gọi Vault; 268 hàm dư bị gỡ, giữ 837 quyền bảng/cột cần dùng. Anon và RLS giữ nguyên. **B/rollback cũ đã bị chặn, không còn là candidate có thể apply**; phải dựng cutover mới từ quyền hiện tại khi người dùng cho phép. Source Desktop mới đã chuyển AI qua akaAgentWebApp và bỏ đọc `api_key`; V434/API còn chưa apply/deploy, quyền đọc key production vẫn giữ. Xem [proxy AI](DESKTOP_AI_PROXY.md) và [audit quyền](DESKTOP_TOKEN_PERMISSIONS.md).

## Phạm vi ban đầu trước rà soát quyền ngày 27/10/2026 (lịch sử)

Người dùng yêu cầu giữ nguyên quyền và hành vi hiện tại, chỉ ngăn người có anon key cũ truy cập dữ liệu akaAgent. Bản này **không thêm phân quyền theo staff/tổ chức**, không kiểm tra lại quan hệ sở hữu dữ liệu, không sửa dữ liệu khách hàng. Backend API đầy đủ là công việc sau.

**A đã apply trên akachat lúc 20:34:17 Việt Nam ngày 27/10/2026: `20261027133417 / desktop_session_identity`. Không apply lại A. Endpoint `aka-agent-desktop-session` đã deploy v1 lúc 20:43:27 Việt Nam cùng ngày; B chưa chạy, chưa thu hồi anon hoặc bật thêm RLS trên bảng nghiệp vụ production.** Chỉ thu hồi khi người dùng yêu cầu rõ, sau khi có bản app mới và cập nhật khách. Build kiểm chứng source không đồng nghĩa đã đóng gói/phát hành bộ cài. Các ghi chú candidate bên dưới là lịch sử chuẩn bị trước apply; xem audit production ở cuối tài liệu.

Không chạy migration staff phase C cũ cùng bản này. Hai giai đoạn dưới đây có thể tách thời điểm để chạy thử Desktop mới trong khi Desktop cũ vẫn hoạt động.

## Hai giai đoạn triển khai

| Giai đoạn | Candidate | Tác động |
| --- | --- | --- |
| A — chuẩn bị token | `supabase/migrations/20261027095004_desktop_session_identity.sql` + Edge `aka-agent-desktop-session` | Tạo role đăng nhập và ánh xạ Auth user; sao chép đúng quyền anon hiện có cho role mới. Thêm 13 policy cùng biểu thức cũ trên bảng đã bật RLS. Không thu hồi quyền cũ, không bật thêm RLS bảng nghiệp vụ. |
| B — khóa anon, chờ yêu cầu riêng | `supabase/migrations/20261027100931_desktop_data_rls_activation.sql` | Thu hồi quyền anonymous/default authenticated trên 113 bảng/view liên quan và các RPC dữ liệu được audit. Bật RLS trên 47 bảng trước đó chưa bật, cho role Desktop truy cập như cũ bằng `USING (true) WITH CHECK (true)`. Giữ nguyên policy nghiệp vụ đã có. |

A, hotfix `20261027134848 / desktop_session_pre_request_permission` và endpoint `aka-agent-desktop-session` v1 đã triển khai. Có thể bắt đầu canary đăng nhập Desktop mới; chưa kiểm thử đăng nhập tài khoản khách thật trên production. **Không cần chạy B để thử app mới.** B yêu cầu cờ `aka_agent.desktop_rls_cutover = 'approved-after-client-update'` trong đúng phiên SQL và toàn bộ preflight phải đạt. Cờ này là chốt chống chạy nhầm, không thay thế yêu cầu cho phép từ người dùng. Không bulk-push toàn bộ migrations.

Khi cutover được yêu cầu: cập nhật/canary Desktop trước, capture quyền live sau rà soát và dựng B/rollback mới, rồi mới apply bản đã kiểm chứng. Không dùng candidate B lịch sử dưới đây vì nó sao chép lại quyền rộng. Desktop cũ dùng anon sẽ không truy cập dữ liệu sau cutover. App Server giữ khóa backend đã cấp trước đây; các backend tin cậy giữ quyền hiệu lực đã capture. Không xoay JWT signing key hoặc thay khóa các app khác.

## Code và quyền dữ liệu

- Desktop bỏ legacy anon JWT và bỏ đọc `SUPABASE_ANON_KEY`. Publishable key còn trong app chỉ nhận diện project; truy cập dữ liệu gửi JWT riêng sau đăng nhập.
- Role `aka_agent_desktop` không login SQL, không kế thừa role khác, không bypass RLS. Quyền bảng/cột/sequence và 244 RPC được sao chép từ quyền anon hiện có, gồm các helper runtime cần thiết và helper Vault được bổ sung sau review.
- **Không thay nội dung bất kỳ RPC/trigger hiện có nào**, không đổi owner, security mode, chữ ký hoặc function-local timeout. Các patch live V431, staff runtime lock-timeout và Chat API được giữ nguyên.
- Giữ role timeout Desktop `statement_timeout=3s`, `lock_timeout=8s`; không đổi timeout anon/authenticated/authenticator. Không tăng timeout bulk reader.
- Giữ truy vấn, bộ lọc staff/org phía ứng dụng và kiểm tra nghiệp vụ trong RPC như cũ. Không thêm actor column, trigger thu hồi theo org/password, ledger Zalo, RPC ghi Zalo, hoặc điều kiện mới cho campaign/account.
- Những dòng campaign có org khác org hiện tại của staff vẫn được đọc/ghi đúng theo hành vi cũ; nếu RPC cũ đã từ chối thao tác thì tiếp tục từ chối. Không yêu cầu sửa dữ liệu staff #1240 để triển khai bản này.
- Bootstrap đã kiểm tra credential/proof máy tiếp tục dùng được trước đăng nhập, gồm akaMap. RPC startup mới chỉ trả scalar cấu hình updater công khai. Không mở anonymous table fallback.
- Sửa review màn hình login: `public.aka_agent_desktop_login_content()` được thêm vào candidate A, không nhận tham số và chỉ trả `id/key/value/updated_at` của `app.notification` cùng bốn key `akabiz.links.website/user_guide/upgrade_payment/contact_us`, với `is_active=true,is_secret=false`. Client gọi RPC bootstrap qua publishable key trước login/sau logout, giữ parser, IPC, thời gian chờ 10 giây và lịch tải cũ. RPC có quyền `anon/aka_agent_desktop/service_role`; không cấp quyền bảng settings. Sau B vẫn chỉ đọc được các giá trị công khai này.
- Schema `private` phải tiếp tục nằm ngoài PostgREST. Probe production chỉ đọc đã trả `406 PGRST106`; helper không được công khai thành API schema.

Sửa review RPC Vault ngày 27/10/2026: generator trước đây bỏ sót `public.aka_agent_get_vault_secret(text)` vì helper `SECURITY DEFINER` đọc `vault.decrypted_secrets`, không nhắc trực tiếp bảng nghiệp vụ. Đã thêm capture này vào preflight, danh sách chuyển/thu hồi quyền và rollback. A chỉ bổ sung grant Desktop tương đương quyền đang hưởng qua `PUBLIC`, không khóa client cũ. B riêng mới thu hồi `PUBLIC/anon/authenticated`, giữ quyền hiệu lực của Desktop đã đăng nhập và các backend tin cậy theo phạm vi đã chốt. Không đổi thân hàm, owner, security mode, search path, timeout hoặc caller email/Google Sheet. Không đọc giá trị secret production.

**Giới hạn chủ ý:** người có token đăng nhập hợp lệ vẫn có quyền DB rộng như trước. Bản này chặn người chỉ có anon key cũ; chưa ngăn khách đã đăng nhập tự gửi request bằng token của họ. Provider/storage key mà Desktop hiện cần dùng vẫn nằm trong phạm vi quyền cũ; chuyển việc đó sang backend thuộc giai đoạn tiếp theo.

## Vòng đời token

Endpoint nhỏ dùng service-role ở Edge, không nhúng khóa backend hoặc signing secret vào Desktop. Endpoint xác minh credential/device theo cơ chế đăng nhập hiện có, tạo/reuse Auth user ngẫu nhiên mang role Desktop và cấp challenge dùng một lần. Desktop gọi managed Auth `verify`/`refresh` trực tiếp, tránh gộp rate limit verify/refresh theo IP Edge. Không gửi email magic link thật.

Token chỉ giữ trong RAM main process, không qua IPC hoặc lưu đĩa. Main thay header Authorization của HTTP client hiện có; không tạo DB pool/connection hoặc polling DB mới. Request dữ liệu bình thường không thêm lượt xác thực. Gia hạn dùng chung một promise; request có deadline vẫn được hủy, write thất bại không bị gửi lại. Không fallback sang anon.

Client lấy hạn dùng thực tế từ JWT `exp`, không giả định production luôn một giờ. Local Auth được cấu hình một giờ cho smoke test. Gia hạn có ngân sách riêng 10 giây; khi token còn dưới 5 giây, caller chờ gia hạn trong AbortSignal của chính caller. Đăng nhập có thêm các lượt Auth và ngân sách handshake 45 giây; không khẳng định độ trễ đăng nhập giống hệt bản cũ.

Logout xóa token local ngay và cố gắng thu hồi refresh session từ xa. Managed Auth không làm JWT đã cấp mất hiệu lực ngay: JWT đó còn hiệu lực tới `exp`; không thêm per-query revocation guard. Lỗi mạng/rate limit khi gia hạn giữ token còn hạn; token hết hạn không được dùng. Lỗi refresh bị từ chối rõ ràng gọi cleanup đăng xuất hiện có.

Sửa review ngày 27/10/2026: sau lỗi gia hạn tạm thời, timer và request DB cùng dùng mốc thử lại sau 30 giây. Request trong khoảng chờ không gọi Auth thêm và không dời mốc retry; token còn hạn tiếp tục dùng, token hết hạn bị chặn trước khi gửi DB. Không thêm thời gian chờ cho caller hoặc đổi ngân sách gia hạn 10 giây/deadline request. Gia hạn thành công hoặc đăng nhập phiên mới xóa trạng thái retry; lỗi trả về muộn của phiên cũ không tác động phiên mới.

Sửa trải nghiệm mất mạng/sleep theo yêu cầu ngày 27/10/2026: token hết hạn trong lúc chờ retry và lỗi gia hạn tạm thời (mạng/429/503) trả `TypeError: fetch failed` qua đường lỗi dữ liệu sẵn có, giống lỗi fetch của app cũ. Không thêm popup, banner hay thông báo kết nối/đăng nhập; màn hình vẫn có thể hiển thị lỗi thao tác như trước khi mất mạng. Giữ phiên và retry nền; chỉ lỗi từ chối Auth thực sự hoặc sai danh tính mới chạy cleanup phiên. Giữ nguyên deadline, khoảng retry 30 giây và không phát lại write. Đã kiểm thử clock mô phỏng mất mạng 8 giờ, sleep 24 giờ và phản hồi gia hạn đã hết hạn khi máy thức; chưa kiểm thử suspend/resume trên bộ cài thật.

Rà soát query/format ngày 27/10/2026: **không khẳng định mọi query/code đều giữ nguyên**. Có ba đường đọc trước login đã đổi: kiểm tra gói dùng Edge `check` → RPC service-role, cấu hình updater dùng RPC startup, nội dung login dùng RPC public. Projection/filter/order của products, nội dung và parser giữ hành vi cũ; login RPC sắp theo key trước khi chuyển sang Map. Query nghiệp vụ sau login và các mapper/ngày giờ giữ source gốc; lớp fetch chỉ thay xác thực, không đọc/đổi response body. 27 ca SQL JSON + SDK local đối chiếu trước/sau đạt: UTC/Asia_Ho_Chi_Minh, phần lẻ sáu chữ số, ngày không giờ, NULL/chuỗi rỗng, ID số nguyên an toàn lớn, số/boolean/JSON, thứ tự gói, hạn sử dụng và thông báo theo lịch. Probe metadata production chỉ đọc xác nhận UTC/ISO, không có override định dạng theo các role hiện tại và ba RPC mới chưa tồn tại. Chưa canary endpoint đã deploy hoặc bộ cài thật; không sửa logic sản phẩm/migration trong lượt rà soát này.

Sửa review cleanup identity: không xóa Auth user vừa tạo nếu `bind_user` trả lỗi hoặc mất phản hồi, vì DB có thể đã commit và lượt đăng nhập lại đang dùng identity đó. Chỉ xóa identity thừa khi RPC thành công xác nhận một Auth user khác là identity chính. Giữ nguyên RPC, số lượt truy vấn và timeout. Nếu bind thật sự chưa commit, có thể còn Auth user chưa được gắn staff, không có session; bản này không thêm tác vụ tự động dọn những user đó. Kiểm tra `null` rõ ràng cho kết quả cấp challenge để handler qua strict typecheck với SDK được pin.

## Capture và kiểm chứng

Snapshot ở `migrations/snapshots/desktop-session-rls/` chỉ chứa schema, function definitions, ACL/policy và fixture metadata, không có hàng nghiệp vụ khách hoặc credential production. Generator đọc capture, không tự kết nối DB. Metadata preflight kiểm tra checksum/owner/security/config/ACL của hàm, bảng/view, policy, column ACL và sequence. B chấp nhận đúng baseline cộng quyền Desktop đã chuẩn bị ở A; metadata khác phải capture/review lại.

Đối chiếu chỉ đọc production akachat `cgjbsmqtfhqvttudyjzq` ngày 27/10/2026 đạt trong `BEGIN READ ONLY ... ROLLBACK`. Một grant SELECT mới của Chat API trên view runtime đã được capture và giữ nguyên; không sửa production trong lượt này.

Ba RPC mới, source checksum không áp dụng vì chưa tồn tại; checksum target từ fixture PostgreSQL 17. Preflight riêng của RPC login ngày 27/10/2026 trên akachat xác nhận signature chưa tồn tại và kiểu cột settings, chỉ đọc/rollback; xem `login-content-preflight.json`:

| Chữ ký | MD5 `pg_get_functiondef` |
| --- | --- |
| `public.aka_agent_desktop_session_admin(text,jsonb)` | `0f7bf99a4f0b78914c97133a47486f97` |
| `public.aka_agent_desktop_startup_policy()` | `b8f48557c26ed1039fec5cdb87212936` |
| `public.aka_agent_desktop_login_content()` | `997f54ddf67f808a1b3ac47596981036` |

Các RPC hiện có có source=target definition checksum; xem capture và `post-cutover-state.json`. Không dựng lại hàm từ migration cũ.

Helper bổ sung: `public.aka_agent_get_vault_secret(text)` có source=target MD5 `a99f67a293add94677a9f85145fe211d`, owner `postgres`, `SECURITY DEFINER`, volatility `v`, `search_path=public, vault`. Metadata live akachat khớp snapshot; body khớp phần helper V69, giữ caller Sheet V297/live và email. Chi tiết capture chỉ đọc ở `vault-helper-preflight.json`; thay đổi candidate chỉ là ACL, chưa apply production.

Các kết quả sau là kiểm chứng ở thời điểm chuẩn bị A/B, trước lần thu hẹp quyền. Các script cutover/rollback cũ đã bị chặn; kiểm chứng hiện tại nằm ở `least-privilege-smoke.cjs` và audit quyền mới:

- `scripts/desktop-session-rls/identity-sql-smoke.cjs`: 19 kiểm tra issuer, credential/device, quyền server-only, Auth session giả/xóa và SQL login public (allowlist, secret/disabled/NULL, projection, rỗng, không cấp quyền bảng).
- `session-smoke.cjs`: 8 nhóm về token còn hạn/hết hạn, một lượt refresh cho 20 caller, hủy, logout và phản hồi phiên cũ.
- `session-refresh-backoff-smoke.cjs`: 8 nhóm hồi quy dùng clock/timer kiểm soát; 20 request tuần tự chỉ tạo một lượt Auth khi lỗi 429/mạng, retry đúng sau 30 giây, phục hồi lịch bình thường, hết hạn/abort, timer đua request, phiên mới và từ chối vĩnh viễn. Thêm mất mạng 8 giờ, sleep 24 giờ và phản hồi đã hết hạn sau sleep: giữ phiên, lỗi kết nối thông thường và tự phục hồi.
- `session-offline-http-smoke.cjs`: 7 nhóm với SDK/HTTP loopback thật và clock kiểm soát; đối chiếu lỗi với fetch mất kết nối của client cũ, giữ nguyên lỗi tải của repository cho renderer; Auth lỗi mạng/429/503 và khoảng retry không phát sinh thông báo đăng nhập. Gia hạn phục hồi không replay write, token hết hạn không đến DB; Auth 401 thật vẫn kết thúc phiên một lần.
- `query-format-parity-smoke.cjs`: 5 nhóm/27 ca dữ liệu; đối chiếu AST query repository và source mapper với HEAD, kết quả SELECT cũ với ba RPC candidate trên PostgreSQL local, reader/entitlement cũ và mới, URL/body/filter/range/response/count qua SDK. RLS smoke 47 kiểm tra chạy lại đạt, các body/config/timeout RPC đang có giữ nguyên.
- `client-http-smoke.cjs`: 8 kiểm tra SDK HTTP thật về header token, bootstrap, không auth roundtrip, không replay write, abort socket và không anon fallback; repository login thật qua SDK đọc được thông báo/liên kết trước login và sau logout, không Authorization, không đọc bảng settings trực tiếp.
- `scripts/run-login-screen-content-smoke-test.cjs`: bốn nhóm parser/URL/thời gian, RPC public không nhận key từ caller, thông báo staff ưu tiên/fallback và IPC. Mock cập nhật theo RPC staff hiện có, không mở lại reader bảng staff.
- `auth-http-smoke.cjs`: 10 nhóm với Supabase Auth thật v2.197.0 local; issue/verify/custom role/refresh/logout, concurrency và lỗi HTTP. Ba nhóm cleanup mới kiểm tra commit rồi mất phản hồi/client hủy trong khi retry đã đăng nhập, lỗi trước commit rồi retry, và hai lần tạo identity đồng thời chỉ xóa bản thừa đã xác nhận. Kiểm tra user/mapping/session thật và refresh sau cleanup; SQL bridge local thay PostgREST cho issuer RPC, không tạo user Auth production hoặc gửi email.
- `edge-typecheck.cjs`: strict typecheck riêng cho handler, resolve import Deno `npm:` sang đúng SDK 2.99.1 đã cài. Hai tsconfig app không bao gồm Edge; kiểm tra local này không thay thế kiểm chứng Deno/deploy khi được phép triển khai.
- `rls-smoke.cjs`: 47 kiểm tra/nhóm; quyền 113 bảng/view và mọi cột trước–sau khớp; app cũ và mới cùng chạy sau A; kết quả đọc/ghi, policy AI cũ và campaign org cũ giữ nguyên; năm tình huống runtime boundary; anon bị chặn sau B, RPC login public vẫn trả đúng nội dung; toàn bộ body/config/security RPC được kiểm checksum.
- `vault-helper-smoke.cjs`: 11 nhóm PostgreSQL local với Vault giả; A giữ quyền cũ, B cần cờ riêng và chặn drift ACL/config trước mọi thay đổi. Sau B, anon/authenticated/role chỉ hưởng PUBLIC không đọc được helper; token và backend giữ quyền cũ. Dispatcher Sheet thật ghi request/header/token vào sink HTTP local, email caller thật đi qua đọc Vault đến guard thiếu `pg_net` (không kiểm thử gửi email thật). Body/owner/security/config ba hàm giữ nguyên; rollback kiểm tra drift và khôi phục chính xác quyền sau A.
- `rollback.cjs`: khôi phục đúng quyền/policy/RLS của trạng thái sau A, giữ Desktop token hoạt động, mở lại anon; ACL drift bảng hoặc helper Vault làm rollback dừng.
- Smoke staff/proof/Server hiện có: 59 kiểm tra; nhận diện máy v3: 65; Auth v2: 40; kiểm tra hết hạn staff đều đạt. Hai typecheck và build source Desktop/Server đạt; không thấy legacy JWT literal trong source main, output Desktop hoặc capture.

Fixture dựng schema/function/123 trigger từ metadata vào PG17 tạm, chỉ dùng dữ liệu giả. Có PK/unique/check; không dựng toàn bộ FK/NOT NULL/default/index ngoài đường kiểm chứng. Setup tình huống runtime tắt trigger trong transaction setup rồi bật lại trước gọi RPC. Không giả định test này thay cho canary bộ cài thật hoặc benchmark tải production. Auth production configuration/token lifetime và bộ cài Windows/macOS vẫn cần kiểm chứng khi triển khai được phép.

## Apply A production — 27/10/2026

Theo yêu cầu apply của người dùng, chỉ chạy A trên `akachat / cgjbsmqtfhqvttudyjzq`; history `20261027133417 / desktop_session_identity`, lúc 20:34:17 Việt Nam. Giữ B và staff phase C chưa chạy. Source A SHA-256 `acc064f9687dabaf8a696e9e5e8740e2b73aa76476122fae24eb7c26d14e0dc7`; SQL gửi apply bổ sung **chỉ trong transaction migration** `lock_timeout=3s, statement_timeout=30s`, SHA-256 `7001198e811079e5dfbe5276014881fb5dc79c16d7edfa92165999395a538138`. Không đổi timeout role cũ hoặc timeout RPC.

Trước apply đã xác nhận project healthy, chụp metadata live, chạy toàn bộ A với ROLLBACK và xác minh role/bảng private/ba RPC mới vẫn chưa tồn tại sau rollback. Dry run và post-apply khớp chính xác: 113 bảng/view cùng RLS/ACL cũ, 540 định nghĩa RPC cùng owner/security/volatility/config/quyền cũ, 87 sequence và 13 policy cũ giữ nguyên. Chỉ thêm 13 policy tương đương cho role Desktop trên bảng vốn đã bật RLS. Ba RPC mới có source checksum không tồn tại và target đúng bảng MD5 phía trên; patch V431/staff runtime và các hàm cũ giữ nguyên.

Role mới `NOLOGIN NOINHERIT NOBYPASSRLS`, có membership cho authenticator và timeout 3s/8s đúng candidate. Bảng ánh xạ private mới có RLS, 0 hàng, không cấp SELECT cho anon/Desktop. Không tạo Auth user, ghi dữ liệu nghiệp vụ khách hoặc deploy endpoint. `org_staff`, `auto_accounts`, `auto_campaigns` vẫn RLS=false; `org_organization` giữ RLS=true có sẵn trước apply.

Bảy kiểm tra HTTP production đạt: nội dung login và startup qua RPC mới khớp query cũ; query anon cũ trên staff/tổ chức/tài khoản/chiến dịch với `limit=0` đều HTTP 200; issuer service-role-only trả 401/42501 cho publishable key. Kiểm tra Edge Function list xác nhận endpoint cấp token chưa deploy, vì lượt này chỉ apply migration.

Security advisor đã kiểm tra. Ba mục liên quan mới là chủ ý của thiết kế: bảng private RLS không có policy trực tiếp ([giải thích](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)), hai RPC đọc public `SECURITY DEFINER` được gọi trước login và chỉ trả allowlist active/non-secret ([giải thích](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)). Không mở quyền bảng để xử lý cảnh báo. Receipt gồm metadata, ACL, checksum và kết quả HTTP: [apply-a-20261027.json](../migrations/snapshots/desktop-session-rls/apply-a-20261027.json).

## Hoàn nguyên B

`migrations/rollback_desktop_data_rls_activation.sql` chỉ dùng sau B, với yêu cầu riêng và cờ `aka_agent.desktop_rls_rollback = 'approved-legacy-access-reopens'`. Preflight so sánh toàn bộ trạng thái sau B; drift phải được review trước. Rollback trả về giai đoạn A: app token và app anon cùng dùng được, giữ identity objects và Auth users. Không xóa dữ liệu khách hoặc Auth user. Rollback cố ý mở lại quyền anon cũ.

Rollback này cũng cố ý mở lại quyền helper Vault cũ; helper được đưa vào snapshot/guard và khôi phục ACL như các entrypoint khác. Không chạy rollback như một bước cập nhật app thông thường.

## Deploy endpoint production — 27/10/2026

Theo yêu cầu người dùng, đã deploy riêng `aka-agent-desktop-session` trên project akachat (`cgjbsmqtfhqvttudyjzq`) lúc **20:43:27 Việt Nam ngày 27/10/2026**. Function ID `aa364f24-20c0-437e-8e9d-ac0841650e8d`, version **1**, trạng thái **ACTIVE**; URL [endpoint](https://cgjbsmqtfhqvttudyjzq.supabase.co/functions/v1/aka-agent-desktop-session). Chỉ upload `index.ts` và `handler.ts`; đọc lại source đã deploy khớp nguyên văn hai file local. Bundle SHA256 `1fb0cb641e3bca84b149176c8d8fcec40b9c8100bc4444b3fb7adcb63925b786`.

Giữ `verify_jwt=false` vì đây là bootstrap trước login; handler tự xác thực credential/device qua RPC service-role và xác minh Auth user cho register/logout. Dùng secret môi trường mặc định của Supabase, không chép khóa backend vào Desktop hoặc receipt. Strict typecheck của handler với SDK pin `2.99.1` đạt; runtime Edge thực tế trả đúng phản hồi.

**16 kiểm tra HTTP production đạt:** method/JSON/action/field/body limit; `check` và `login` từ chối staff không tồn tại qua RPC live; `register`/`logout` từ chối token sai; hai RPC public hoạt động; bốn query anon cũ `limit=0` vẫn HTTP 200; issuer RPC vẫn từ chối caller public. Các lỗi chỉ trả thông báo chung, response Edge có `Cache-Control: no-store`.

Metadata trước/sau deploy của ba RPC, role Desktop và quyền/RLS bốn bảng staff/tổ chức/tài khoản/chiến dịch khớp. Ba checksum định nghĩa RPC khớp receipt A; mapping Desktop vẫn 0 hàng. Không apply migration, không chạy B/C, không thu hồi anon hoặc ghi dữ liệu khách hàng trong smoke. Không đóng gói/phát hành app trong lượt deploy. **Chưa canary đăng nhập/gia hạn bằng tài khoản staff thật trên production**; luồng thành công đã kiểm chứng trước đó với Supabase Auth thật v2.197.0 ở local.

Receipt: [deploy-edge-20261027.json](../migrations/snapshots/desktop-session-rls/deploy-edge-20261027.json). Nếu cần hoàn nguyên endpoint, chỉ vô hiệu hóa function này; không chạy B hoặc rollback DB. Các ghi chú “endpoint chưa deploy” trong audit apply A phía trên mô tả trạng thái ở thời điểm apply A.

## Sửa quyền pre-request của token — 27/10/2026

Canary Desktop báo `42501: permission denied for function aka_agent_block_denied_ip_request` tại `load auth organization`. Token đã được cấp nhưng PostgREST gọi hook `pgrst.db_pre_request=public.aka_agent_block_denied_ip_request` dưới role JWT trước truy vấn tổ chức. Inventory A theo bảng/RPC của client bỏ sót hook gateway không nhắc bảng nghiệp vụ; SQL fixture trước đó không chạy bước pre-request, còn smoke HTTP deploy chỉ dùng caller public hoặc dữ liệu xác thực sai.

Đã apply riêng hotfix trên akachat lúc **20:48:48 Việt Nam ngày 27/10/2026**, migration `20261027134848 / desktop_session_pre_request_permission`; canonical [20261027134745_desktop_session_pre_request_permission.sql](../supabase/migrations/20261027134745_desktop_session_pre_request_permission.sql). Chỉ thêm `GRANT EXECUTE ON FUNCTION public.aka_agent_block_denied_ip_request() TO aka_agent_desktop`. Không sửa/apply lại A, không deploy lại endpoint hoặc build lại app để nhận sửa quyền này; không chạy B/C, không thu hồi anon hoặc thay đổi RLS.

Exact signature `public.aka_agent_block_denied_ip_request()`, MD5 định nghĩa trước = sau **`ff086d95d4ba66cad668bfe48a705e11`**. Giữ owner `postgres`, SECURITY INVOKER, STABLE, `search_path=pg_catalog`, toàn bộ quyền cũ và cấu hình authenticator. Function hiện tại chỉ dùng `pg_catalog`, không có dependency ứng dụng khác. Giữ nguyên rule IP và cách kiểm tra tất cả `cf-connecting-ip`/`x-real-ip`/`x-forwarded-for`; tuyệt đối không tắt hook để xử lý lỗi quyền.

Dry run production chạy GRANT + hook dưới role Desktop rồi ROLLBACK, xác minh grant chưa tồn tại sau rollback trước khi apply. Sau apply, metadata chỉ khác một quyền Desktop. Smoke transaction read-only dưới role Desktop/anon: IP hợp lệ qua được hook và query `org_organization LIMIT 0`; IP bị chặn IPv4, IPv6-mapped và hop forwarded vẫn trả PT403. Không đọc hàng dữ liệu khách hoặc thay đổi dữ liệu nghiệp vụ trong smoke. Chưa có xác nhận đăng nhập đầy đủ thành công từ người dùng sau hotfix.

Bổ sung [pre-request-smoke.cjs](../scripts/desktop-session-rls/pre-request-smoke.cjs), **15 nhóm kiểm tra đạt** trên PostgreSQL local: tái hiện lỗi trước grant, đọc tổ chức sau grant, header lỗi/rỗng, bốn đường IP bị chặn trên bốn role, metadata/quyền cũ, idempotence, guard drift, B và rollback B không làm mất grant, và diễn tập rollback đúng một quyền. Chạy test này cùng các bài token/RLS trước cutover. Hook là dependency transport dùng cho cả bootstrap public, giữ ngoài danh sách thu hồi RPC dữ liệu của B.

Security advisor trước/sau không có finding nhắc hook. [Capture live](../migrations/snapshots/desktop-session-rls/pre-request-preflight.json) và [receipt apply](../migrations/snapshots/desktop-session-rls/pre-request-applied-20261027.json) lưu đủ body/checksum/owner/config/ACL. Rollback chỉ khi được yêu cầu rõ và sau kiểm tra drift: thu hồi đúng grant Desktop trên hook; thao tác đó làm lỗi đăng nhập quay lại, không dùng như bước rollout thông thường.

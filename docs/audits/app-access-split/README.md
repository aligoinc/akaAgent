# Quyền riêng akaChat/akaAgent — 03/11/2026

**V451 đã apply 11:15:06 VN, ledger `20261103041506`:** [canonical Chat identity khi bật đồng bộ](CANONICAL_IDENTITY_FIX_20261103.md),
[230 ca PG17 + trial ROLLBACK](canonical-identity-verification-20261103.json).
Không đổi dữ liệu người dùng hoặc triển khai app; giữ V449/V450.
[Receipt apply](canonical-identity-apply-receipt-20261103.json); không apply lại V451.
[Rà soát nguồn ID sau apply](IDENTITY_CHECK_AUDIT_20261103.md): ba nhóm check legacy
còn lại, bốn repro local đã xác nhận; chưa sửa/deploy thêm.

**V450 đã apply lúc 10:21:32 VN:** [cấp lại Chat Server khi chủ khóa/hết hạn](SHARED_OWNER_GRANT_FIX_20261103.md),
[receipt](shared-owner-grant-receipt-20261103.json). Bổ sung nhánh cấp quyền cho V449;
giữ điều kiện akaAgent/QR local, không đổi cờ/chia sẻ thật và không deploy/build app.
Không apply lại V449/V450.

**V449 đã apply lúc 09:52:08 VN:** [Chat sharing khi chủ bị khóa/hết hạn](SHARED_OWNER_FIX_20261103.md),
[receipt](shared-owner-receipt-20261103.json). Quyền người nhận/ACL và akaAgent giữ nguyên;
không deploy service/build bộ cài/đổi CRM. Không apply lại V449. Đây là trạng thái
mới hơn các baseline helper trước đó trong audit.

**V445/V446, hai private auth patches và V447 đã apply; policy true từ 06:07:41 Việt Nam ngày 03/11/2026.** Backend/runtime, Chat Web và WebApp đã deploy từ repo chính; Server mới được người dùng xác nhận đã cài; Desktop 9.2.0 ba nền tảng đã build local, chưa được agent upload/phát hành. CRM không đổi source/deployment. Xem [activation và hậu kiểm](ACTIVATION_20261103.md), [receipt activation](activation-receipt.json) và [deploy](DEPLOYMENT_20261103.md). Tài liệu nghiệp vụ: [APP_ACCESS_SPLIT](../../APP_ACCESS_SPLIT.md). Các kết quả source/build và câu “chưa apply/chưa kích hoạt” bên dưới là lịch sử trước activation này; không dùng để apply lại hoặc rollback mở quyền.

## Hiệu năng sau activation — 03/11/2026

[Kiểm tra production 06:21–06:28](PERFORMANCE_20261103.md) là baseline trước sửa.
**Đã tối ưu cả ba điểm**: [V448, Chat API và đo lại](PERFORMANCE_FIX_20261103.md),
[receipt DB](performance-v448-apply-receipt.json). Index CONCURRENTLY live lúc
06:40:52 VN; API deploy từ repo chính lúc 06:47:34 VN. Giữ RPC/ACL/RLS, quyền và
cleanup; không tăng pool/polling/replica, không cần build lại app. Không apply lại.

## Apply DB tương thích — 03/11/2026

Người dùng yêu cầu apply migration và tạm hoãn hai lỗi review còn lại. Sau đó xác nhận: “Chưa triển khai — giữ V447 chưa kích hoạt”. Chỉ apply các bước tương thích trên `akachat / cgjbsmqtfhqvttudyjzq`; không đổi source triển khai hay kích hoạt quyền riêng.

| Bước | Ledger UTC | Giờ Việt Nam 03/11/2026 |
| --- | --- | --- |
| V445 schema/helper | `20261102215958 / migration_v445_app_access_schema` | 04:59:58 |
| V446 callers | `20261102220006 / migration_v446_app_access_callers` | 05:00:06 |
| Private IP pre-request | `20261102220027 / app_access_ip_pre_request` | 05:00:27 |
| Private desktop admin | `20261102220028 / app_access_desktop_admin` | 05:00:28 |

[Receipt apply](apply-receipt.json) ghi checksum source/wrapper, ledger, kết quả trial và hậu kiểm. Capture mới 44 exact live signatures cùng view/policy khớp baseline; transaction thử cả bốn bước kết thúc ROLLBACK trong 3,96 giây. Hash toàn bộ trường cũ của 1.854 staff và 9.192 account giữ nguyên trong trial; không sửa `is_chat_sync`. Sau apply, 4 cột boolean NOT NULL đúng mặc định, không có cờ NULL; 4 receipt khởi tạo hoàn tất; bảng private bật RLS và không cấp client SELECT/INSERT/UPDATE/DELETE.

Hậu kiểm full preflight của V447 đạt với 42 target functions, 2 private auth patches, 11 runtime dependencies, policy và view; **không chạy phần activation**. Smoke helper live dưới `service_role` và `aka_agent_desktop` kiểm cơ chế legacy cho 1.786 tổ chức, 50 staff và 50 account ở cả hai app. Management API không có quyền `SET ROLE aka_agent_chat_api`; role này đã kiểm ACL/metadata và quyền của helper, chưa smoke trực tiếp bằng phiên Chat API production. Không mở thêm quyền để chạy smoke. Không kiểm HTTP/UI/provider production hoặc gửi tin/chạy chiến dịch thật.

Private capture, SQL auth, wrapper và kết quả ở `$HOME/.codex/incident-recovery/akaAgent-ip-block/app-access-20261103/apply-20261102T215821Z/`, không đưa full body/IP vào Git. Public stages dùng Supabase MCP; private stages dùng Management API qua CLI linked đã có, ghi ledger trong cùng transaction. Không thêm SQL connection/pool/worker/replica. Một lần đọc hậu kiểm qua MCP lỗi kết nối upstream; đọc lại qua CLI và full metadata postcheck thành công.

**Hai lỗi P2 được tạm hoãn, không sửa trong lần apply:**

- Dòng legacy trùng Zalo ID được bootstrap bật Chat có thể làm `app_access_reserve_chat_identity` từ chối QR lại của dòng đang giữ binding hợp lệ (`zalo_already_linked`). Tình huống đã tái hiện local; trước apply không tìm thấy nhóm đang đáp ứng đầy đủ điều kiện trong dữ liệu live đã kiểm.
- Cấp lại quyền Chat đồng thời với projection trạng thái Server có thể deadlock do thứ tự account → binding và binding → account. Transaction bị chọn rollback; không phải khóa DB vĩnh viễn. Đã tái hiện local với SQLSTATE `40P01`.

Tại mốc apply DB tương thích 05:00, các nhánh quyền riêng còn bị gate false; hai lỗi trên chưa được xử lý. V447 sau đó đã kích hoạt theo chỉ thị trực tiếp sau deploy/build; xem audit activation đầu trang. Không apply lại bốn bước tương thích hoặc V447.

## Phạm vi source

| Repo | Phần thay đổi | Trạng thái |
| --- | --- | --- |
| akaAgent | Shared types, main repository/IPC, auth/refresh, account snapshot, reader QR local, App Server routing, menu account/staff, SQL | Source + build local |
| akaAgentChatApi | Guard login/session/API/realtime/claim/dispatch, staff/account creation, assignment/runtime projection, menu backend | Source + typecheck/build local |
| akaAgentWebApp | Control API/proxy, contracts/client, menu account/staff | Source + build local |
| akaAgentChatWeb | Proxy + menu account/staff | Source + build local |
| SqlServerDashboard (CRM) | Không sửa | Không deploy |

Cả bốn nhánh source là `codex/app-access-split`. akaAgent dùng managed worktree riêng từ `origin/dev_3`; giữ nguyên thay đổi người dùng ở checkout chính. Người dùng đã yêu cầu tạo bốn PR ngày 03/11/2026: akaAgent vào `dev_3`, Chat API/Chat Web/WebApp vào `dev`. Lượt tạo PR không merge, deploy, phát hành hoặc apply thêm DB; `labs/` của Chat API nằm ngoài phạm vi.

Ở lượt trước PR, người dùng chấp nhận Desktop cũ không hỗ trợ tổ chức có product 5 và không cần đợi mọi máy cập nhật; thứ tự khi đó là deploy backend/runtime và phát hành Desktop trước activation. Sau deploy và build ba bộ cài Desktop 9.2.0, người dùng yêu cầu trực tiếp apply V447; chỉ thị mới thay bước chờ phát hành cho lần activation này. Máy cũ thuộc org có product 5 gặp giới hạn QR/Chat-only cần cập nhật; org không có product 5 giữ legacy. V447 đã kích hoạt, không có gate theo phiên bản máy. Kiểm chứng trước push ghi tại [receipt PR](pr-verification.json); các kết quả build/test bên dưới giữ mốc kiểm chứng ban đầu.

## Migration và private assets

1. Trước rollout, kiểm tra ledger/version mới nhất và project ref. Các số 445/446/447 là candidate sau V444; không coi filename là bằng chứng đã apply.
2. Capture dữ liệu quyền/quota bằng [SQL read-only](../../../migrations/audits/app_access_capture.sql), lưu ngoài Git. Capture RPC exact signature lại và đối chiếu với [source metadata](../../../migrations/snapshots/app-access/source-metadata.json). Drift thì dừng và đối chiếu, không thay checksum để vượt guard.
3. Trial `ROLLBACK`, sau đó khi có chỉ thị apply: [V445 schema/helper](../../../migrations/migration_v445_app_access_schema.sql), rồi [V446 callers](../../../migrations/migration_v446_app_access_callers.sql). Policy vẫn false. Bốn cờ, receipt, bootstrap và guard giữ chế độ tương thích khi rollout.
4. Apply hai private SQL patches đã capture live: `ip-pre-request-candidate.sql` và `desktop-admin-candidate.sql` trong `$HOME/.codex/incident-recovery/akaAgent-ip-block/app-access-20261103/`. Chúng giữ nguyên IP checks, owner/ACL/config. Không deploy Edge từ source Git cũ, không thay `pgrst.db_pre_request` sang hook khác. Full bodies không nằm trong repo.
5. Deploy backend/runtime/worker và UI/Desktop tương thích; xác nhận đúng bản trên mọi instance. Tái sử dụng pool/cache/refresh, không tăng connection/worker/replica. Client cũ đi qua DB/API guards; held work giữ context cleanup đến khi hoàn tất.
6. Chỉ sau đó apply [V447 activation](../../../migrations/migration_v447_app_access_activate.sql). Guard đối chiếu 42 function candidates, hai private auth patches, 11 signature runtime không đổi, SELECT policies và view staff runtime đã scope, gồm body/owner/ACL/security/volatility/config tương ứng. V445 cũng kiểm metadata view trước khi tạo policy. Kích hoạt không sửa `is_chat_sync` hay thêm mode/revision.
7. Hậu kiểm exact metadata theo [verified manifest](../../../migrations/snapshots/app-access/verified-candidate.json), smoke tenant legacy/separate, account/staff quota, QR local/Server và cleanup trước rollout rộng. Không tự chạy tin nhắn/chiến dịch thật.

[Rollback trước activation](../../../migrations/rollback/app_access_pre_activation.sql) khôi phục đúng 13 live RPC bodies/metadata; giữ schema và receipt để không mất quyết định. Private rollback ở cùng thư mục private. Sau activation, rollback này fail-closed (`app_access_active_requires_roll_forward`); sửa tiến thay vì tắt policy và mở lại quyền đã thu hồi.

[Generator](../../../scripts/generate-app-access-rollout.py) chỉ đọc baseline/candidate đã trial và xuất SQL, không kết nối DB. Manifest chứa source/target MD5 của từng signature và SHA-256 hai migration. Hai private function chỉ công khai metadata/checksum, không body/IP.

## Kiểm chứng

- PostgreSQL 17 disposable local: **98 ca nghiệp vụ** trong Chat API `load-tests/app-access.mjs`. Bao gồm legacy, Chat-only, first5/renewal/cleanup CRM, MAX/NULL/0, quota FB khác Zalo, owner-only counting, locked staff, last-seat concurrency, replay/actor mismatch, independent flags, stop/reenable/cleanup, held transport sau hết hạn, late QR session denial, duplicate binding, tenant denial và local Chat claim không cần gói Zalo Agent, secondary-account stopping và ownership của account có organization_id NULL. Mười ca review đầu bổ sung kiểm first5 của dòng Chat-created, gia hạn, Web runtime, QR theo app và completion thật qua repository, SMS pending qua service_role sau tắt account/chủ, giữ SMS legacy. Lượt thứ ba thêm 16 ca ACL/view/list/route trước và sau activation; toàn bộ harness không cấp Desktop SELECT bảng/cột org_staff.
- Catalog rehearsal `load-tests/app-access-rpc.mjs`: 31 exact live baselines, 13 RPC đổi, 42 target functions và hai private auth patches. Schema/callers/private patches/activation thử transaction ROLLBACK; guard reapply/drift từ chối; rollback phục hồi exact checksum/owner/ACL/config. Rehearsal không tái tạo toàn bộ trigger/RLS production và không thay thế smoke trên môi trường rollout.
- Chat API: **119 files / 1.752 tests pass** sau sửa review, typecheck/build TypeScript pass. Giữ các test identity trùng, quyền tenant/staff, shared access, receipt/unknown-send/restart/cleanup hiện có; bao gồm route DTO/replay, final-dispatch denial và safe-boundary cho app_access_denied (kể cả share batch). QR tests kiểm app khởi tạo, header giả và quyền đã thu hồi khi completion muộn.
- WebApp API: **69 files / 1.340 tests pass** sau cập nhật fixture legacy. Web suite trước đó **861 tests pass**; thêm **4 UI tests pass** cho busy/retry/stale session/stopping. Shared packages và Mobile regression pass trong lần full suite; không thêm UI Mobile.
- Chromium Web/PWA: **2 E2E pass**, mock backend và synthetic account. Legacy ẩn menu; separate bật Chat, khóa nút trong mutation, payload explicit và render lại trạng thái. Không gọi production/provider. [Ảnh đã kiểm tra](ui-menu.png).
- Chat Web: **200 tests pass**, Next production build pass.
- akaAgent: hai typecheck node/web pass; production renderer/main/preload build pass. `zalo-web-session-recovery-smoke-test.cjs` pass với reader mới, giữ recovery budget/timeout/cleanup và số lần đọc DB.

## Lượt review trước — bốn lỗi đã sửa

- Runtime reader trả lại Zalo Web có quyền Agent; consumer chỉ dành cho QR/local Chat vẫn loại Web.
- SMS chỉ lấy việc pending khi account và chủ còn quyền Agent. `aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)` được capture lại từ live trong lượt sửa; giữ nguyên pending/carrier/schedule/paging, không đổi completion receipt. Source checksum `70ffadf2302e9601f68d1af0dab41469`, target `832d4d8f23cdf61b31f34802270d3679`; các signature khác xem manifest.
- QR dùng app đã xác thực cho actor/account thay vì Chat OR Agent. Operation giữ app khởi tạo tới final commit; test header giả, cả hai app, Server/local và chủ tự yêu cầu đều được bổ sung.
- First product 5 capture lại quyền Agent legacy của dòng Chat-created; receipt giữ nguyên quyết định tắt quyền khi gia hạn.

## Lượt review thứ hai — năm lỗi đã sửa

- Gói Chat độc lập dùng được điều kiện gửi tin, feature action và đồng bộ lịch sử; ba repository dùng chung helper, legacy giữ resolver cũ.
- Data Scan chặn account tắt Agent tại HTTP admission và trước dispatch. Source Chat của refresh danh bạ được gắn nội bộ; revoke/lỗi DB/cancel trong lúc kiểm quyền không gửi query mới và vẫn giữ receipt.
- Lifecycle Desktop giữ QR local reader khi không có gói Zalo Agent nhưng staff còn quyền Agent; group manager chiến dịch giữ gate riêng, stopping không clear runtime.
- Restrictive SELECT RLS ẩn Chat-only khỏi client Desktop cũ/count. RPC session local mới là invoker, giữ owner RLS và CAS; ngoại lệ request path chỉ dành cho danh sách RPC claim/cleanup đã capture. Header giả không bỏ được filter. Đã thử role Desktop thật trong local PG: session commit/mark/clear-invalid, cross-staff denial, claim, sai token và cleanup đúng token.
- Activation capture các dòng tạo trong khoảng V445–V447 trước khi flip gate, có khóa writer trong cùng transaction. Test writer đang mở khiến activation fail/rollback, retry giữ quyền vừa commit; helper không chạy khi đã active và gia hạn không reset quyết định.

Kiểm chứng bổ sung: **68 ca SQL local**, **5 ca lifecycle smoke** chạy hàm production với runtime giả, catalog **39 target + 2 private auth**, **11 signature runtime phụ thuộc không sửa**; activation từ chối policy drift. Hai typecheck và production build Desktop pass, Web recovery smoke pass. Chat API **119 files / 1.748 tests pass**, build TypeScript pass; guard binding inactive được kiểm thêm bằng SQL local sau full suite. Phạm vi Web/PWA và Chat Web không thay đổi trong lượt sửa này; kết quả UI/build của chúng là từ lượt triển khai trước.

Không gửi tin hoặc chạy chiến dịch thật. Chưa kiểm bộ cài Windows/macOS, thiết bị Zalo thật, HTTP production, staged deployment đa instance hoặc thao tác trực tiếp trên CRM thật. Các luồng CRM được kiểm bằng SQL theo thứ tự/payload hiện có; CRM source không bị chỉnh.

## Lượt review thứ ba — lỗi P1 ACL của SELECT policy

Policy cũ đọc trực tiếp `org_staff` để suy tổ chức; live Desktop không có SELECT bảng hay cột staff. PostgreSQL báo 42501 ngay cả trước activation và với account đã có organization_id. Fixture cũ cấp dư SELECT nên 68 ca trước chưa bắt được lỗi này.

Policy nay dùng view `public.aka_agent_staff_runtime_profile` hiện hành, có security_barrier và lọc theo staff token. Không sửa view, RPC production hay cấp thêm quyền; giữ owner RLS, danh sách ngoại lệ runtime/cleanup và các token/CAS. View source = target MD5 `bb879c13f7469398e75650bf7403a7d7`; owner/ACL/options trong [capture read-only](../../../migrations/snapshots/app-access/runtime-profile-view.json). Đã đọc lại 26 signature patched/private/runtime trong lượt sửa và không thấy drift so với baseline; helper khóa/time staff cũng khớp live.

- **84 ca SQL pass** với Desktop không được SELECT bảng/cột org_staff. Dùng view và hai helper staff capture thật; test đọc scope, cờ bật/tắt, org NULL, legacy trước/sau activation, session commit/mark/CAS, claim và cleanup đều qua.
- Đối chứng policy cũ trên cùng fixture mới thất bại đúng **42501 org_staff trước activation**.
- Catalog 31 baseline / 13 RPC đổi / 39 target / 2 private auth / 11 runtime dependencies pass; trial ROLLBACK, activation, rollback trước activation và từ chối rollback sau activation giữ nguyên.
- Bốn kiểu drift view (definition, owner, ACL, security_barrier) bị chặn ở cả V445 và V447. Không dùng composite type rỗng để thay view trong catalog rehearsal.

Lượt này chỉ sửa SQL policy/guard, snapshot, harness/generator và tài liệu. Không đổi TypeScript hay UI; các kết quả typecheck/build/full suite phía trên thuộc lượt trước và không chạy lại ở lượt này. Kiểm chứng ACL dùng SET ROLE/context giả lập local, chưa gọi PostgREST production.

## Lượt review thứ tư — QR muộn và trùng identity khi bật Chat

- QR native/remote được niêm phong nguồn app, requester, chủ và claim trong receipt private hiện có trước khi scan. Backend prepare trước command; Desktop chỉ bind claim, không tự đổi nguồn. Final local session commit khóa staff/account, kiểm quyền của đúng requester/app, ACL quản lý và claim hiện tại rồi lưu session/receipt trong cùng transaction. Không dùng quyền app còn lại để hợp thức hóa QR cũ; direct PATCH session không có receipt trong transaction bị chặn.
- Cancel chờ prepare kết thúc rồi đóng receipt, không phát start muộn sau cancel/detach. Claim vẫn giữ tới producer kết thúc. Final commit bị từ chối không downgrade session/login status cũ; reader mark/clear và Server recovery giữ luồng riêng.
- Cấp Chat cho account đã login tạo reservation inactive bằng binding/UNIQUE/identity lock hiện có, không raw session và không phiên thứ hai. Hai dòng cùng UID chưa từng có binding chỉ một dòng bật thành công. Tắt Chat giữ binding. Binding đã xóa không tự bị chuyển; flag reservation bảo vệ trong lúc chờ luồng reuse hiện có. Undelete không được giành lại identity đang được dòng khác giữ.
- **98 ca SQL pass**, gồm 14 ca mới về tranh chấp identity, reservation offline/disable/reenable/deleted/undelete, QR native bị tắt Agent nhưng Chat còn bật, QR Chat bị thu hồi trong khi Agent còn bật, requester/ACL bị thu hồi, claim xoay vòng, cancel/replay/direct PATCH và rollback session cũ. Test dùng validator thật, enrollment repository thật để kích hoạt đúng binding đã giữ và RPC với role Desktop, không cấp SELECT org_staff. Ca thu hồi quyền requester giữ transaction mở để kiểm final commit chờ khóa rồi đọc lại quyền.
- Hai đối chứng local bỏ từng guard đều thất bại đúng kỳ vọng: origin guard bị bỏ thì QR muộn commit được; reservation trigger bị bỏ thì hai request cùng thành công (`2 !== 1`). Bốn ca smoke chạy phương thức Desktop production với SDK/DB giả; bốn test coordinator mới kiểm prepare/send/cancel/detach muộn.
- Đọc lại 29 exact live signatures trong lượt này, metadata/checksum không drift. Ba helper mới chưa tồn tại live. Manifest hiện có **42 target functions**, 13 existing RPC patches, 2 private auth patches và 11 runtime dependencies không đổi. Trial schema/callers/activation/private patches và rollback giữ checksum/ACL/config; không apply production.
- Kiểm chứng lượt này: Chat API **119 files / 1.752 tests pass**, build TypeScript pass; Desktop hai typecheck và production build pass, 4 QR smoke + 5 lifecycle smoke + Web session recovery smoke pass. Web/PWA/Chat Web không sửa trong lượt này; kết quả của chúng giữ từ lượt trước. Không kiểm thiết bị/provider, PostgREST production hoặc bộ cài.
- Nền akaAgent đã fast-forward `dev_3` từ `ee8dca61` tới `7a9fb192`, giữ toàn bộ thay đổi feature; stash backup còn giữ. CRM Git sạch. Không thêm pool/poll/replica, không sửa source auth riêng hoặc deploy.

## Những điểm cần giữ khi review

- Không tháo claim trong RPC tắt quyền. `running → pending` và xóa token phục vụ cleanup vẫn được phép; claim/token mới bị chặn. Receipt chỉ hoàn tất khi không còn held work, kể cả secondary account và campaign có organization_id NULL.
- Không chặn event lịch sử đã nhận khiến mất outcome; chặn job/batch mới và giữ drain/receipt cũ. Outgoing observation vẫn được nhận để xử lý unknown-send.
- Không dùng danh sách Agent cho reader Chat-only. Session-bearing RPC chỉ ở main/backend và scope chủ, không đi qua preload/renderer.
- Hook IP và desktop-admin dùng private live source; ACL helper cho application callers `service_role`, `aka_agent_desktop`, `aka_agent_chat_api`, không mở SELECT/EXECUTE cho anon để che lỗi. Pre-request entrypoint void giữ grant cần thiết cho hook hiện tại.
- Không apply tự động V447 cùng schema trước khi deploy callers. Không áp lại migration đã live ở lần rollout sau.

## Hồ sơ sau rollout

[Kiểm chứng PR version và hồ sơ triển khai](rollout-pr-verification.json) đối chiếu 1.085 build inputs với bộ cài Desktop 9.2.0 đã kiểm chứng. Không đổi source runtime/SQL, không apply hoặc deploy lại khi tạo PR. Ba repo web/API chỉ cập nhật tài liệu; các receipt deploy/build giữ trạng thái tại mốc thực hiện, trạng thái activation hiện tại ở đầu tài liệu.

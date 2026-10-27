# Bảo vệ org_staff bằng RLS — A/B đã apply, C đang hoãn

**Nhận diện máy v3 đã apply akachat 27/10/2026 lúc 15:57 VN:** `20261027085744 / device_identity_v3`; hai RPC auth và ba helper khớp target, giữ 363 hàm ngoài phạm vi/ACL/policy. DB đã có các đối tượng v3 mà guard C yêu cầu; **C vẫn chưa apply, app chưa phát hành**. Không apply lại v3; [audit](DEVICE_IDENTITY_V3.md#apply-production--27102026).

**Timeout staff đã sửa production 27/10/2026 lúc 15:50 VN:** `20261027085042 / staff_runtime_inherit_lock_timeout` chỉ bỏ override chờ khóa 3s của helper B; giữ caller timeout, body/ACL và 38 hàm liên quan. C vẫn chưa bật. Không apply lại; [audit và rollback](STAFF_RUNTIME_LOCK_TIMEOUT.md).

**A/B đã apply akachat lúc 12:37 ngày 27/10/2026 (giờ Việt Nam) theo yêu cầu để test. C chưa apply, `org_staff` vẫn RLS=false. Server nội bộ 9.0.0 đã đóng gói local lúc 12:53; Desktop chưa đóng gói cập nhật, chưa triển khai/phát hành.** Người dùng yêu cầu cập nhật Desktop/App Server trước, rồi mới cho phép bật RLS. Không tự thực hiện bước cuối theo giờ hoặc chỉ vì đã phát hành bộ cài.

**akaMap ngày 27/10/2026:** đã sync `google-map` từ `origin/main` (`9a790f0`) và chuẩn bị source trên `codex/akamap-staff-rls`: login/restore/reset qua RPC mới `akamap_staff_client`, giữ binding legacy riêng. **RPC đã apply akachat lúc 14:51 VN (`20261027075130 / akamap_staff_rls_client`), akaMap chưa phát hành/cập nhật; C tiếp tục hoãn.** Canonical `google-map/supabase/migrations/20261027072455_akamap_staff_rls_client.sql`, không apply lại. Checksum target `45ced18f36302afbe9e9a785e3271d14`; schema/quyền/RLS/trigger và ba RPC dependency giữ nguyên. 76 ca SQL từ định nghĩa live chạy local, 8 ca SQL production chỉ đọc/rollback và 5 HTTP đạt. Trước apply: 31 ca client/Electron/hồi quy, main typecheck/build đạt; renderer còn 74 lỗi có sẵn giống baseline. Xem `google-map/docs/STAFF_RLS_COMPATIBILITY.md`. Cần cập nhật client này trước cutover; guard SQL C không kiểm tra phiên bản các app bên ngoài.

## Phạm vi và hiện trạng

Project duy nhất: `cgjbsmqtfhqvttudyjzq` (akachat). Audit trước apply lúc **12:05 ngày 27/10/2026, giờ Việt Nam** ghi nhận `org_staff` RLS=false, không policy; 86 định nghĩa RPC/owner/security/ACL chưa đổi, các đối tượng mới chưa tồn tại. Receipt lịch sử: [production-unchanged.json](../migrations/snapshots/staff-rls/production-unchanged.json). Preflight 12:35 xác nhận lại đủ 86 hàm trước khi apply A/B; trạng thái sau apply ở phần bên dưới.

`org_organization` **đã bật RLS**; anon/authenticated chỉ SELECT qua policy tương thích hiện có. Không bật lại hoặc đổi chính sách bảng này. CRM dùng backend secret; `service_role`, `aka_agent_chat_api`, `crm_interest_worker` hiện có BYPASSRLS. Cutover giữ quyền backend và quyền cột `crm_interest_worker` hiện có.

Mục tiêu là chặn đọc mật khẩu và INSERT/UPDATE/DELETE/TRUNCATE trực tiếp `org_staff` bằng khóa công khai; không phải chuyển toàn bộ ứng dụng sang Supabase Auth hay kiểm toán mọi RPC/bảng khác. SQL Editor/DB owner và backend có quyền quản trị vẫn sửa được.

## Code ứng dụng

- Desktop đăng nhập, đồng ý chính sách, liên kết máy, đổi mật khẩu, bật workflow test, thông báo cá nhân và tích hợp akaBiz dùng `aka_agent_staff_client(text,text,text,jsonb)`. RPC xác thực username/password, đọc lại dưới khóa hàng, giới hạn action/trường; không nhận thay đổi organization/admin/quyền/kích hoạt. Kết quả profile liệt kê cột rõ ràng, không chứa password.
- Quyền workflow test được kiểm tra lại trong DB. Tích hợp cập nhật từng loại atomic, không ghi đè loại khác. Client chặn phản hồi khi phiên/tổ chức đã đổi; đăng nhập cũng chặn nếu CRM chuyển tổ chức giữa đọc và bind.
- Giữ thời hạn staff/gói, policy, binding v2, đổi máy, IPC trả descriptor thay vì mật khẩu. Không thêm pool, connection thường trực hoặc polling.
- App Server chỉ cài trên máy do chủ hệ thống quản lý, theo xác nhận của người dùng. Entry point Server nạp backend secret trước khi khởi tạo client/dịch vụ; thiếu/sai định dạng khóa thì báo lỗi và dừng, không rơi về anon. Desktop không tự đọc biến môi trường khóa Server.

### Giữ lấy lại thông tin bằng máy

Main process lưu khóa ngẫu nhiên 256 bit trong `<userData>/staff-device-recovery-v1.key`, mode 0600, giữ qua cập nhật. Khóa mới được ghi vào file tạm cùng thư mục bằng exclusive create, fsync rồi đóng; chỉ sau khi RPC xác thực username/password/binding và đăng ký SHA-256 thành công mới rename thay file chính. Khóa hợp lệ được dùng lại; file rỗng/sai định dạng được sửa qua cùng luồng này sau đăng nhập hợp lệ. Tắt “ghi nhớ đăng nhập” không xóa khóa khôi phục, đúng yêu cầu giữ chức năng độc lập với ghi nhớ.

Đọc khôi phục không tự tạo/thay khóa; file hỏng báo lỗi, không mở fallback. Sai mật khẩu/binding, lỗi đọc quyền/I/O hoặc RPC không có phản hồi xác nhận không thay file chính. Ghi tạm/rename thất bại được dọn file tạm và lần đăng nhập hợp lệ tiếp theo thử lại. Main xếp tuần tự các lượt đăng ký; Desktop đã có single-instance lock, nên các lượt đồng thời dùng cùng khóa thay vì ghi đè proof của nhau. Nếu DB đã đăng ký nhưng rename/phản hồi lỗi, cần đăng nhập lại để đăng ký và lưu đồng bộ. Không thêm lượt gọi DB cho luồng đăng ký bình thường.

RPC `aka_agent_recover_staff_credentials(text,text)` chỉ trả thông tin khi chứng minh được khóa trên máy, fingerprint hiện tại, một staff duy nhất, đúng tổ chức/binding, active và còn thời hạn. Bảng private không có quyền đọc công khai. Trigger hủy đăng ký khi password, username, organization hoặc binding thay đổi. Đổi mật khẩu từ app đăng ký lại bằng mật khẩu mới; nếu ghi khóa thất bại, đăng nhập bằng mật khẩu vẫn hợp lệ và lần đăng nhập thành công tiếp theo sẽ thử đăng ký lại.

Trước cutover, máy chưa có khóa có thể dùng luồng khôi phục cũ **chỉ khi** RPC trạng thái trả rõ `legacyRecoveryAllowed=true`; khôi phục thành công đăng ký khóa mới. Sau cutover, máy chưa từng đăng nhập bản mới cần nhập mật khẩu một lần/nhờ CRM hỗ trợ. Không thể duy trì khôi phục bằng fingerprint công khai sau khi khóa đọc mật khẩu mà vẫn bảo đảm bí mật. Lỗi mạng/khóa không hợp lệ không mở fallback.

Khóa gắn với thư mục dữ liệu và tài khoản hệ điều hành đang chạy app; cài lại hệ điều hành/xóa thư mục dữ liệu/đổi máy có thể mất khóa. Các trường hợp này cần đăng nhập lại. CRM reset password/đổi binding chủ động thu hồi quyền khôi phục cũ.

## Ba bước DB tách biệt

| Bước | Migration | Tác động |
|---|---|---|
| A — đã apply | `supabase/migrations/20261027044346_staff_rls_client_api.sql` | Thêm API xác thực, bảng private recovery và trigger; **không đổi RLS/grant bảng staff**. |
| B — đã apply | `supabase/migrations/20261027044627_staff_rls_runtime_compatibility.sql` | Thêm projection chỉ đọc và helper khóa hàng; sửa 34 RPC invoker từ đúng source live; **không đổi RLS/grant bảng staff**. |
| C — chưa apply | `supabase/migrations/20261027044628_staff_rls_activation.sql` | Bật staff RLS và thu hồi toàn bộ quyền bảng/cột công khai, bao gồm TRUNCATE; thu hồi RPC đọc toàn hàng `get_managed_staff(bigint)` khỏi PUBLIC/anon/authenticated. |

B giữ nguyên owner, invoker, volatility, proconfig, ACL, mọi predicate, khóa account/campaign, token, CAS, expiry, cleanup và lịch chạy. 28 RPC lấy khóa staff qua helper definer hẹp; phần ghi nghiệp vụ vẫn chạy invoker. Helper chỉ trả 13 cột runtime. Bản B ban đầu đặt timeout chờ khóa 3 giây; bản vá đã apply lúc 15:50 VN bỏ override này để kế thừa thời gian chờ của luồng gọi, theo [audit timeout](STAFF_RUNTIME_LOCK_TIMEOUT.md). View `aka_agent_staff_runtime_profile` được cấp **SELECT duy nhất**, không password, fingerprint, integrations hoặc quyền CRM. Metadata tên/phone/username và quota/runtime vẫn đọc được để giữ discovery hiện có; không mô tả đây là cơ chế cách ly toàn bộ thông tin nhân viên.

Mọi patch B có preflight checksum + attributes từ live. Tại thời điểm chuẩn bị A/B, C kiểm tra 41 định nghĩa/metadata đã chuẩn bị, view và trigger, trạng thái policy/role hiện tại. Guard view trong C và rollback so sánh tập quyền bằng `aclexplode`: owner đúng `acldefault('r', relowner)` của phiên bản server (PostgreSQL 17 có thêm MAINTAIN), ba role anon/authenticated/service_role chỉ SELECT, đúng grantor và không grant option. Thứ tự ACL không ảnh hưởng; mọi quyền thừa/thiếu, role lạ/PUBLIC hoặc grant theo cột đều bị chặn. Giữ checksum/owner/security_barrier/trigger và guard 41 hàm. Chỉ tạo hàm thay thế từ bản đã chụp. Nếu drift, **dừng và chụp/diff lại**, không bỏ preflight. Tất cả 34 body live khớp định nghĩa tương ứng mới nhất trong repo; đã đối chiếu đúng overload, giữ cả V397 schedule guard và V389 lifecycle/cleanup.

Sau bản vá timeout và nhận diện máy v3, C cùng rollback C đã cập nhật guard thành **44 hàm** và bổ sung kiểm tra đối tượng v3. Đây là cập nhật điều kiện kiểm tra trước cutover; **C vẫn chưa apply**. Xem [audit v3](DEVICE_IDENTITY_V3.md) và [audit timeout](STAFF_RUNTIME_LOCK_TIMEOUT.md).

Handoff chi tiết chữ ký/source checksum/target checksum/ACL:

- [source.json](../migrations/snapshots/staff-rls/source.json): 86 định nghĩa live đọc trong task, không dữ liệu khách hàng.
- [runtime-patches.json](../migrations/snapshots/staff-rls/runtime-patches.json): 34 chữ ký và source/target nguyên văn.
- [repository-audit.json](../migrations/snapshots/staff-rls/repository-audit.json): mọi migration có nhắc hàm và định nghĩa đối chiếu đúng overload.
- [local-target.json](../migrations/snapshots/staff-rls/local-target.json), [local-view.json](../migrations/snapshots/staff-rls/local-view.json): target checksum/owner/security/config/ACL từ PostgreSQL cục bộ; chưa phải receipt production.

## Apply A/B production — 27/10/2026

Đã apply riêng hai file canonical, không bulk push và không chạy C:

| Bước | Migration production | Thời điểm Việt Nam |
|---|---|---|
| A | `20261027053735 / staff_rls_client_api` | 12:37:35 |
| B | `20261027053753 / staff_rls_runtime_compatibility` | 12:37:53 |

Preflight lưu đủ checksum/owner/security/config/ACL của 86 chữ ký, khớp source đã review. A+B được chạy thử cùng guard và smoke trong transaction `ROLLBACK` trước khi apply; sau rollback xác nhận cả API/view/bảng recovery chưa tồn tại. Sau apply, **41 hàm target và view/trigger đều khớp**, 52 hàm còn lại trong snapshot giữ nguyên. Giữ V397 schedule guard, V389 lifecycle/cleanup, invoker/ACL/token/CAS của 34 runtime patch. Source và target theo từng chữ ký nằm trong các snapshot được liên kết phía trên.

**12 ca SQL chỉ đọc dưới role anon** đạt trước/sau apply: profile xác thực không password; sai password/field/staff ID/proof bị chặn; legacy status còn bật; scope share/missing/invalid-lock; đọc/quyền ghi legacy giữ nguyên; view chỉ đọc và recovery private. Credential chỉ được dùng trong DB để thử profile read, không xuất ra output. Không ghi dữ liệu nghiệp vụ khách hàng; bảng recovery 0 hàng tại kiểm tra 12:38. Script tái chạy: [prepare-readonly-smoke.sql](../scripts/staff-rls/prepare-readonly-smoke.sql).

**6 request PostgREST thật** đạt: status HTTP 200/`legacyRecoveryAllowed=true`; login sai, field không hợp lệ và proof sai đều HTTP 400 với mã dự kiến; view và đọc staff legacy `limit=0` HTTP 200. Không lấy hàng dữ liệu khách hoặc đăng nhập khách qua HTTP.

`org_staff` vẫn RLS=false, không policy, ACL giữ nguyên; `org_organization` giữ nguyên RLS/policy/ACL. Chưa cấu hình/triển khai App Server, chưa đóng gói/phát hành Desktop. Bản source mới có thể bắt đầu test với A/B hiện tại. Theo yêu cầu tiếp theo, bổ sung bộ cài Server nội bộ có khóa như phần bên dưới.

Receipt: [preflight](../migrations/snapshots/staff-rls/production-prepare-preflight.json), [sau apply](../migrations/snapshots/staff-rls/production-prepare-applied.json), [HTTP](../migrations/snapshots/staff-rls/production-http-prepare.json), [advisors đã lọc](../migrations/snapshots/staff-rls/security-advisors-after-prepare.json). Không apply lại A/B. Muốn sửa RPC đã live phải chụp định nghĩa mới và tạo migration mới theo skill.

## Bộ cài Server nội bộ — 27/10/2026

Người dùng xác nhận Server chỉ chạy trên máy chủ do mình quản lý và yêu cầu tự lấy khóa, gói sẵn để chỉ cần cài. Lệnh `npm run build:server:win:private` đọc khóa từ phiên Supabase CLI đã đăng nhập vào **akachat**, kiểm tra role/ref của JWT và thử HTTP `org_staff?select=id&limit=0`, không lấy hàng khách hàng hoặc ghi DB. Nếu CLI trả khóa `akaAgentServer` dạng secret đầy đủ thì ưu tiên khóa đó; nếu không, dùng `service_role` hiện có. Khóa secret bị che và khóa đặt tên cho backend khác không được chọn. Có thể cung cấp file bằng `AKA_AGENT_SERVER_SUPABASE_SECRET_FILE` hoặc biến runtime cùng tên ở trên; không truyền giá trị qua tham số dòng lệnh.

Build staging nằm trong thư mục tạm mode 0700, file khóa 0600, được dọn trong finally. Cấu hình builder chỉ chứa đường dẫn, không chứa giá trị khóa. Bộ cài tên `akaAgent-Zalo-Server-Internal-Setup-9.0.0.exe`, output riêng `dist-server/private/<timestamp>/`, không ghi đè bản Server cũ. `publish=null` và `--publish never`; thư mục output có nhãn INTERNAL-ONLY và đã nằm trong Git ignore. **Khóa có thể trích xuất từ bộ cài**: giữ riêng bộ cài, unpacked output và bản sao lưu; không gửi khách hàng hoặc upload công khai.

Main Server nạp theo thứ tự env → file trong userData → `resources/server-private/supabase-server-secret.key` của app đã đóng gói. Chỉ thiếu file (ENOENT) mới chuyển nguồn; file rỗng/hỏng hoặc lỗi quyền/I/O dừng để tránh che lỗi cấu hình. Dev và Desktop không tự đọc resource này. Không nhúng khóa vào mã JS, renderer hoặc cấu hình Desktop. Đây là thay đổi đóng gói, không apply lại A/B hoặc bật C.

**Kết quả 12:53 VN:** bộ cài local `dist-server/private/2026-10-27T05-51-18-438Z/akaAgent-Zalo-Server-Internal-Setup-9.0.0.exe` (107.227.969 byte), SHA-256 `b986726fa57c4576d99c9600b24f6840cc507847e1536422e6bc029cbaa9fcfd`. Dùng khóa service_role hiện có qua CLI; không tạo/xoay khóa, không ghi DB. Hai typecheck, build Desktop/Server, 59 ca client, 14 ca chọn khóa đạt. Giải nén EXE xác minh payload/app.asar/native/key; thử loader với payload đã giải nén và userData mới không env đạt. Quét 3.070 file source/output, log và config không có khóa ngoài resource nội bộ; mã JS/renderer/Desktop không chứa khóa. Checksum bộ cài Server cũ, app.asar cũ, metadata update và native host giữ nguyên; staging khóa đã xóa. Receipt/log ở cùng thư mục build. Chưa chạy trên Windows thật, chưa upload hoặc cài lên máy chủ. Lệnh kiểm chứng lại: `node scripts/staff-rls/verify-private-server-build.cjs dist-server/private/2026-10-27T05-51-18-438Z`.

### Test lại bộ cài theo yêu cầu — 27/10/2026, 13:47 VN

Bộ cài giữ SHA-256 như trên; giải nén payload/native/key và quét source/output lại đạt. 59 client + 14 chọn khóa + 129 Auth v2 + 30 ca phục hồi phiên Server, session expiry, Electron nhớ đăng nhập qua restart, UI khôi phục và UI quản trị Server đều đạt. Trên akachat, 12 ca SQL chỉ đọc chạy trong transaction ROLLBACK đạt; `org_staff` vẫn RLS=false, `org_organization` giữ RLS=true.

Test mới `scripts/staff-rls/private-server-electron-smoke.cjs <private-output-directory>` lấy Main/preload/renderer từ chính app.asar của bộ cài. Chạy bằng Electron **macOS**, userData/cwd mới, không env khóa; ép nhánh packaged/resources để nạp key thật trong payload. Chỉ thay thân startServer trong bản sao tạm bằng kiểm tra HTTP có allowlist, không tạo gateway/runtime/chiến dịch. Client thật gọi 4 request chỉ đọc: trạng thái bảo mật, staff/organization `limit=0`, RPC từ chối đăng nhập sai. Preload/UI tải và trả snapshot giả rỗng; không thấy key trong DOM/IPC/process log. Dọn process và thư mục tạm thành công.

Đây xác nhận code đóng gói/nạp khóa/client/UI trên host hiện tại, **không thay thế kiểm thử cài/nâng cấp và chạy runtime Windows thật**. Không có Windows VM/Wine trong môi trường này. Không chạy chiến dịch, ghi dữ liệu nghiệp vụ, bật C hoặc apply migration. Receipt chi tiết nằm ở `dist-server/private/2026-10-27T05-51-18-438Z/test-20261027/summary.json` và `electron-packaged-smoke.json` trong thư mục build.

## Thứ tự triển khai sau khi được yêu cầu

1. **A/B đã hoàn thành và kiểm chứng như trên; không apply lại.** Trước cutover cần chụp lại target checksum/ACL/role để bắt drift. **Không dùng bulk `db push`**: C cố ý có chốt dừng, và repo còn migration khác.
2. Cập nhật App Server bằng **bộ cài nội bộ** đã chứa khóa, chỉ cài trên máy chủ quản lý. Bản thường vẫn hỗ trợ `AKA_AGENT_SERVER_SUPABASE_SECRET_KEY` hoặc `%PROGRAMDATA%\akaAgentServer\supabase-server-secret.key`; cả hai được ưu tiên hơn khóa trong bộ cài để xoay khóa. Không đưa khóa vào VITE_*, Git, Desktop, renderer, socket hoặc log. Khởi động lại và kiểm tra discovery, reconnect, chạy/dừng và xử lý tương tác.
3. Phát hành/cập nhật Desktop mới **sau khi A/B sẵn sàng**. Đăng nhập thành công trên các máy cần khôi phục bằng máy để tạo proof. Thử ghi nhớ bật/tắt, lấy lại thông tin, đổi password/máy, notification/integration/workflow test và chiến dịch. Kiểm tra máy chưa đăng ký có đường nhập password/CRM hỗ trợ. RPC akaMap đã apply, không apply lại; cần thử và cập nhật client akaMap đã sửa trước C, các bộ cài cũ vẫn dùng anon trực tiếp trên staff.
4. Xác nhận mức cập nhật khách hàng. Xuất bản bản mới không chứng minh khách đã cập nhật; client cũ đọc/ghi staff trực tiếp sẽ bị lỗi sau C. Phải quyết định thời điểm cắt và thông báo/cập nhật theo vận hành thực tế.
5. **Chỉ khi người dùng xác nhận sau cập nhật**, chạy riêng C trong session quản trị đã đặt `aka_agent.staff_rls_cutover='approved-after-client-update'`. Thiếu giá trị này thì transaction dừng trước mọi thay đổi. Không cài giá trị này làm default của role/database hoặc tự đặt trong CI.
6. Sau C xác minh staff RLS=true, public table/column privileges=false, thử request trực tiếp bằng anon bị từ chối; đăng nhập/khôi phục/campaign/CRM và App Server thật vẫn hoạt động. Kiểm tra `legacyRecoveryAllowed=false`. Chụp receipt production mới.

Bản mới cần API A; A/B đã sẵn sàng trên akachat để test. Các bước cập nhật/phát hành ứng dụng và bật C chưa thực hiện.

### Rà soát các repo khác — 27/10/2026

Đã rà 20 thư mục dự án riêng trong `/Users/lequangnhut/Repos` (không đếm hai worktree trùng của ChatApi/WebApp). Các checkout có upstream đã fetch và khớp upstream tại lúc kiểm tra; `akaBizSmsMac` chỉ có source local chưa commit. Đây là đối chiếu source/đường truy cập với thay đổi C, không phải smoke sau cutover hoặc xác nhận mọi bản đang cài trùng source.

| Dự án | Kết quả trong phạm vi staff RLS C |
|---|---|
| `akaAgent` Desktop / App Server | Đã sửa source trong PR #555. Vẫn phải cập nhật bản đang cài trước C. |
| `akaAgentWebApp` Web/PWA/native mobile | Client gọi Control API; backend singleton dùng `AKA_AGENT_SUPABASE_SERVICE_ROLE_KEY`. Không thấy truy cập staff trực tiếp từ mobile/web. |
| `akaAgentChatWeb`, `akaAgentChatApi` | Web qua API; SQL backend `aka_agent_chat_api` giữ BYPASSRLS và quyền hiện có. |
| `akaBizSms` (`26953ff`), `akaBizSmsMac` | Gọi `/api/aka-agent/sms/*` qua akaBizApi, không gọi staff bằng anon. Voice của akaBizSms cũng qua backend này. |
| `akaBizApi` (`1930016`) | SMS/voice kiểm tra staff và tổ chức bằng `getAkaAgentSupabaseClient()` dùng service-role. C giữ quyền backend. |
| `akaBizWebPortal` (`2d76e42`) | Đọc staff/organization và đăng ký qua server client dùng `SUPABASE_SECRET_KEY`. C giữ quyền backend khi triển khai đúng cấu hình đó. |
| **`google-map` / akaMap (`9a790f0` → `codex/akamap-staff-rls`)** | Bản cũ GET/PATCH staff bằng anon nên lỗi sau C. Source mới đã chuyển login/restore/reset sang RPC có credential và khóa hàng; giữ binding legacy riêng với akaAgent. RPC đã apply `20261027075130 / akamap_staff_rls_client`; **chưa phát hành/cập nhật client**, vẫn cần hoàn tất trước C. Audit ở `google-map/docs/STAFF_RLS_COMPATIBILITY.md`. |
| `akaBizSMSWeb` | Bản .NET dùng SQL Server `akabiz_sms` và bảng `Staff`; không phải `public.org_staff` của akachat. |
| `akaBizAuto`, `akabizrpa` | Luồng staff chính dùng SQL Server/API cũ. Các đường Supabase tìm thấy đọc `accounts`, ghi `aka_order`, hoặc gọi `aka-tracking-app-insert`; Edge Function live dùng service-role và bảng `aka_tracking_app`. Không thấy phụ thuộc trực tiếp staff C. |
| `akaBizAff`, `akaBizFacebook`, `akaBizFacebookWebApp`, `akaBizZalo`, `akaBizZaloWebApp`, `akaBizZaloApi`, `akaBizWebClient`, `akabiz-zalo-gateway` | Đã tìm bảng/RPC/project và lần theo các API/client liên quan. Không thấy đọc/ghi `org_staff` bằng anon trong source hiện có; các luồng tìm thấy dùng API/bảng legacy hoặc backend service-role. Không mở rộng kết luận này sang RLS của các bảng khác. |

Đối chiếu thêm danh sách GitHub thấy 53 repo trong `aligoinc`, trong đó 36 repo không có checkout riêng ở đây. `akaBizApi` và app Android `akaBizSms` đang kiểm tra thuộc `lequangnhut27`; không nhầm với repo cũ `aligoinc/akabizsms`. Tìm kiếm remote chỉ phản ánh nhánh mặc định/index và chưa thay thế audit đầy đủ các repo/nhánh/bản triển khai chưa có local. Không tuyên bố đã kiểm chứng toàn bộ 53 repo.

Một phát hiện riêng cần xác minh bản triển khai: `aligoinc/akaCRM` tại `07a6d55`, `src/services/supabase.ts`, lấy `VITE_SUPABASE_SERVICE_ROLE_KEY` để tạo client admin, được import từ React `NotificationContext.tsx`. Nếu bản đang phát hành cung cấp khóa thật theo cấu hình này, khóa đi vào frontend và có thể vượt staff RLS. Repo này dùng `staffs`/`accounts` legacy, chưa thấy `org_staff` trong tìm kiếm nhánh mặc định; đây là rủi ro lộ quyền backend, không phải bằng chứng C làm hỏng CRM. Chưa đọc giá trị khóa, kiểm tra bundle production, sửa hoặc xoay khóa trong lượt audit.

Advisors sau apply vẫn báo `org_staff` chưa có RLS, phù hợp việc chủ động hoãn C ([linter](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public)). Ngoại lệ dự kiến: view definer chỉ chứa 13 cột runtime và SELECT-only ([linter view](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)); recovery private bật RLS nhưng không public policy; bốn API definer được anon/authenticated gọi có chủ ý. API client/recovery xác thực bằng password/proof và allowlist, status/helper chỉ trả trạng thái/metadata cần tương thích. Đây không phải Supabase Auth session. Đã kiểm tra ACL/guard thực tế; không cấp thêm quyền hay đổi view sang invoker chỉ để làm hết cảnh báo, vì sẽ phá tương thích sau C.

## Rollback

[rollback-activation.sql](../migrations/snapshots/staff-rls/rollback-activation.sql) chỉ hoàn nguyên C, giữ A/B và recovery. Có gate `aka_agent.staff_rls_rollback='approved-restore-legacy-access'`, kiểm tra target function/view/trigger và trạng thái bảo vệ trước khi trả lại quyền cũ. Rollback này khôi phục cả lỗ hổng đọc/sửa công khai nên là quyết định vận hành rõ ràng, không tự thực hiện khi request lỗi.

[rollback-runtime.sql](../migrations/snapshots/staff-rls/rollback-runtime.sql) tùy chọn hoàn nguyên B khi staff RLS=false (hiện tại C chưa chạy; nếu C đã chạy thì phải hoàn nguyên C trước). Kiểm tra đủ 34 target checksum/attributes rồi phục hồi source nguyên văn và xóa helper/view. Không xóa recovery table/khóa máy hoặc API A. Giữ API A cho Desktop đã cập nhật; quay lại bộ cài trước nếu cần. Không drop dữ liệu recovery tự động.

## Kiểm chứng local

Kết quả sau sửa hai finding review: **123 ca SQL trên PostgreSQL 16.15, 129 ca SQL trên PostgreSQL 17.11, 129 ca auth, 55 ca client**; các kiểm tra phiên/Electron/renderer, hai typecheck và hai build đều đạt. [Receipt và SHA-256](../migrations/snapshots/staff-rls/verification.json). PostgreSQL production được đọc trong review là 17.6; kiểm chứng local cùng major 17, không thay đổi production.

- `scripts/staff-rls/run-sql-smoke.cjs`: PostgreSQL 16.15 và 17.11 tách biệt, schema không dữ liệu khách; auth/allowlist/recovery, token thu hồi sau password/reset, merge integration; 34 checksum/attributes; activation gate; anon/auth table + view/private denial; CRM/Chat role; shared/exclusive lock chặn ghi đồng thời; 7 ca runtime boundary/ownership/deletion/held expiry trước–sau RLS; hai rollback và checksum source. Fixture có default ACL public như production; kiểm tra 11 kiểu drift trên PG16, 14 trên PG17 (thêm MAINTAIN cho từng client role), cả guard C và rollback. ACL đổi thứ tự vẫn hợp lệ. [PG16 receipt](../migrations/snapshots/staff-rls/sql-verification-pg16.json), [PG17 receipt](../migrations/snapshots/staff-rls/sql-verification-pg17.json). Generator sắp thứ tự đầy đủ chữ ký overload, kết quả giống nhau giữa hai receipt.
- `scripts/auth-v2-smoke-test.ts`: hồi quy ghi nhớ, migration/recovery cũ, IPC/race, binding RPC và đổi tổ chức.
- `scripts/staff-rls/client-smoke.cjs`: phản hồi không password, phiên cũ, lỗi RPC không lộ dữ liệu, key file/reuse, status fail closed, backend env/file/missing-key và Desktop không tự nâng quyền. Thêm 31 ca với filesystem thật: file rỗng/hỏng, sai password/binding, chưa xác thực không publish, khôi phục sau sửa/reload, 10 lượt đăng ký đồng thời, lỗi đọc/open/ghi dở/fsync/close/rename, mất phản hồi và retry; khóa tốt không bị xoay.
- `scripts/staff-session-expiry-smoke.cjs`: login/refresh/expiry/drain giữ hành vi.
- Electron hardware identity + local login qua restart; renderer recovery giữ password ngoài DOM, nhớ/tắt nhớ và phản hồi đến muộn.
- Hai typecheck; build Desktop và Server. Build Server được chạy riêng để xác minh output thật ở `out-server/` (không chạy song song hai lệnh electron-vite vì loader config có thể dùng chung cache).

Giới hạn: chưa kiểm tra bộ cài trên Windows thật, chưa chạy toàn bộ luồng 34 RPC với dữ liệu sản xuất, chưa smoke CRM/App Server production sau cutover vì C chưa apply. Phần production đã kiểm chứng A/B bằng checksum, 12 ca SQL và 6 HTTP như trên; chưa thay thế kiểm tra end-to-end ứng dụng thực tế.

Tái tạo: `python3 scripts/staff-rls/build-runtime-compatibility.py`, `python3 scripts/staff-rls/audit-source.py`. Khi thay API/target có chủ ý, tạo receipt mới trên DB local rồi `python3 scripts/staff-rls/guard-cutover.py`, chạy lại SQL smoke. Không đổi checksum guard chỉ để vượt một lỗi drift chưa hiểu.

Cơ sở quyền backend và view: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [service-role client](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z).

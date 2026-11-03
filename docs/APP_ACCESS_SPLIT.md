# Quyền akaAgent và akaChat

**V453 đã apply 12:16:02 VN ngày 03/11/2026:** theo chỉ thị người dùng, bỏ kiểm
quyền akaAgent trên từng request khỏi hook IP; giữ kiểm IP và các guard khác.
[Quyết định hiện hành và kiểm chứng](audits/app-access-split/IP_HOOK_ACCESS_REMOVAL_20261103.md).

[V452 runtime identity](audits/app-access-split/RUNTIME_IDENTITY_FIX_20261103.md):
DB đã apply; status/flag giữ binding, canonical owner không bị duplicate legacy chặn.
Đăng ký local đối chiếu actual UID với binding; Chat API đã deploy từ repo chính
lúc 11:58:23 VN, source `83d2736`; receipt/giới hạn kiểm chứng xem audit.

V451 đã apply — [dùng binding Chat khi bật đồng bộ](audits/app-access-split/CANONICAL_IDENTITY_FIX_20261103.md):
**Đã apply 11:15:06 VN ngày 03/11/2026**, ledger `20261103041506`. Binding hiện có là nguồn Zalo ID; unbound đang đăng xuất
không bị ID legacy chặn, unbound đang đăng nhập vẫn reserve identity. QR thực vẫn chống trùng.

V450 đã apply: [cấp lần đầu/bật lại Chat Server khi chủ bị khóa hoặc hết hạn](audits/app-access-split/SHARED_OWNER_GRANT_FIX_20261103.md).
Actor vẫn cần quyền quản lý; giữ quota, gói, tenant, chống trùng và điều kiện host QR local.

Chia sẻ khi chủ bị khóa/hết hạn: [V449 đã apply 03/11/2026](audits/app-access-split/SHARED_OWNER_FIX_20261103.md).
Chat kiểm quyền người sử dụng và ACL; trạng thái/thời hạn chủ chỉ chặn akaAgent.
Chủ bị xóa hoặc sai tenant vẫn làm account mất điều kiện dùng Chat.

Tối ưu sau activation: [V448 và query Chat API đã triển khai 03/11/2026](audits/app-access-split/PERFORMANCE_FIX_20261103.md).
Giữ quyền/cleanup, không cần build lại Desktop/App Server; không apply lại index.

Ngày 03/11/2026, **V445, V446, hai private auth patches và V447 đã apply** trên production `cgjbsmqtfhqvttudyjzq`; không apply lại. **V447 kích hoạt lúc 06:07:41 Việt Nam, policy true**: 4 tổ chức dùng quyền riêng, 1.782 tổ chức giữ legacy. Chat API/worker/Server runtime, Chat Web và WebApp/API đã deploy từ repo chính; Server mới được người dùng xác nhận đã cài. Desktop 9.2.0 ba nền tảng đã build local, chưa được agent upload/phát hành. Activation theo chỉ thị trực tiếp mới nhất sau build; CRM không đổi source/deployment. Xem [activation và hậu kiểm](audits/app-access-split/ACTIVATION_20261103.md), [receipt apply tương thích](audits/app-access-split/apply-receipt.json), [deploy](audits/app-access-split/DEPLOYMENT_20261103.md) và [hợp đồng rollout](audits/app-access-split/README.md).

## Quy tắc và schema

Tổ chức có bất kỳ dòng `org_organization_product.product_id=5` nào, kể cả hết hạn/xóa mềm, dùng quyền riêng sau khi kích hoạt V447. Không có dòng 5 thì giữ nguyên cơ chế legacy. Gói Chat hết hạn không fallback về `is_chat_sync`. Không ghi lại `is_chat_sync`, không thêm `app_access_mode` hoặc `app_access_revision`.

| Bảng | Cột | Tác dụng |
| --- | --- | --- |
| `org_staff` | `is_aka_agent_enabled`, `is_akachat_enabled` | Hai quyền được cấp cho nhân viên |
| `auto_accounts` | `is_aka_agent_enabled`, `is_akachat_enabled` | Hai quyền được cấp cho tài khoản dùng chung ID |

Bốn cột là boolean NOT NULL. Backfill trước khi đặt mặc định. Tạo từ Agent mặc định true/false; Chat ghi false/true rõ ràng. Quyền được cấp khác quyền hiệu lực: vẫn kiểm tra gói, trạng thái/thời hạn staff, owner, subtype, ACL chia sẻ và tenant. Legacy bỏ qua cờ mới.

`private.app_access_requests` có UUID khóa chính, org/actor/target, payload/result JSONB, status và timestamps. Bảng không lưu credential/session, bật RLS và không cấp client SELECT/INSERT/UPDATE. Receipt bootstrap có actor NULL, một dòng mỗi tổ chức, FK organization ON DELETE CASCADE để không cản cleanup CRM. Receipt mutation khóa request ID, ràng buộc actor/payload; request lặp trả kết quả đã lưu và trạng thái cleanup hiện tại. Không dùng updated_at làm CAS. Receipt `target_type=qr` niêm phong app/người yêu cầu, chủ và claim token của lần QR; khi commit ghi transaction ID và Zalo ID, không lưu raw session. Index riêng theo account/claim hỗ trợ kiểm tra retry, không thêm cột quyền hoặc revision.

Các helper `app_access_*` tính quyền/quota, bootstrap và guard. `private.app_access_policy_enabled()` là công tắc rollout toàn deployment, mặc định false; không phải mode tenant. Mode tenant vẫn được suy từ dòng product 5. V447 chốt quyền legacy phát sinh trong khoảng rollout rồi đổi công tắc trong cùng transaction, sau khi mọi caller mới đã sẵn sàng.

## Hạn mức

| Hạn mức | akaAgent | akaChat |
| --- | --- | --- |
| Account | Theo chủ và nền tảng: Facebook 3/10, Zalo 16/18, Email 13, SMS 17 | Theo chủ, chỉ product 5 |
| Staff | Toàn tổ chức, nhóm 3/10/13/16/17/18 | Toàn tổ chức, chỉ product 5 |

Gói hợp lệ: `is_deleted=false`, expiration đến hết ngày Việt Nam. MAX, không cộng; có gói hợp lệ với `max_accounts` NULL/≤0 thì không giới hạn. `max_staff` NULL/≤0 cấp 0 suất. Không có gói thì không có quyền. Cờ bật trên dòng chưa xóa vẫn chiếm suất khi staff bị khóa/hết hạn hoặc account đăng xuất/vô hiệu hóa. Chia sẻ không nhân suất. Cả hai app dùng hai suất độc lập.

Giữ quyền được cấp đang vượt mức, báo overLimit và chặn cấp thêm. Tắt trả suất; bật lại kiểm tra lại quota. Transaction dùng advisory lock theo tổ chức/chủ, khóa staff/account và receipt để bảo vệ suất cuối. Chỉ patch quyền được yêu cầu; hai request hợp lệ khác ID đổi cùng quyền thì request được xử lý sau thắng.

## Client, runtime và quyền

- Desktop dùng `electronAPI.appAccess.snapshot/set` qua IPC main-frame và RPC có staff credential trong main. Web/PWA dùng `/app-access/snapshot|set` trong Control API. Chat Web proxy `/api/chat/app-access/*` tới Chat API `/api/chat/zalo/app-access/*`. Body không được chọn actor/org, không nhận revision mới.
- Snapshot có quyền cấp/hiệu lực, product IDs, quota, runtime và stopping. UI chỉ hiện nút mới trong separate mode; có mutex, busy, UUID retry và bỏ response phiên cũ. Sau mutation tải lại danh sách/quota.
- Account owner hoặc admin quản lý account được đổi cờ account; chỉ org admin đổi cờ staff. Chủ chỉ dùng Agent vẫn có thể bật Chat cho đồng nghiệp. Chat chỉ hỗ trợ Zalo QR local/Server, không Facebook/Zalo Web.
- Từ V449, chủ bị khóa/hết hạn không làm account mất điều kiện Chat nếu account/gói vẫn hợp lệ; người nhận vẫn cần staff Chat hợp lệ và ACL tài khoản/hội thoại. Chủ bị khóa/hết hạn vẫn không đăng nhập/thao tác được; quyền chiến dịch vẫn kiểm trạng thái/thời hạn/quyền akaAgent của chủ. Chủ phải tồn tại, chưa xóa và đúng tenant. Không tự cấp chia sẻ hoặc đổi suất/cờ. Quyền giữ QR local vẫn yêu cầu host akaAgent hợp lệ, không được mở bằng quyền Chat của account.
- Danh sách/picker/snapshot Agent lọc quyền ở backend; account không có Agent không được claim/chạy. Các luồng xác thực/kiểm tra quyền của app, Control token, campaign daily/control và DB claim trigger giữ kiểm quyền mới. Từ V453, Desktop pre-request không còn kiểm quyền akaAgent chung trên từng request theo chỉ thị người dùng; các guard riêng vẫn giữ. RPC SMS `aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)` cũng kiểm quyền Agent của account/chủ trước khi trả việc pending; không đổi RPC báo kết quả gửi. RLS/ownership/CAS hiện hành vẫn giữ.
- Tắt Agent ghi cờ và receipt stopping trước khi trả UI. Không xóa claim/unit, không retry kết quả gửi chưa rõ. Chặn claim/dispatch mới, runtime giữ quyền cleanup và hồi phục sau restart đến khi producer xác nhận kết thúc. Bật lại Agent bị chặn khi còn held work; quyền Chat vẫn đổi độc lập.
- Tắt Chat ẩn account/hội thoại, chặn action/job mới nhưng giữ lịch sử/phân công/binding. Event lịch sử đã được nhận vẫn hoàn tất receipt; quan sát tin gửi đi vẫn được xử lý để giải quyết kết quả gửi chưa rõ. Không dùng cờ Chat để cắt transport đang phục vụ Agent/cleanup.
- Server Chat phục vụ account Agent hợp lệ dù gói Chat hết hạn. Reader nội bộ main trả cả Zalo Web khi còn quyền Agent; danh sách session QR/local Chat vẫn loại Web. QR local chỉ dùng Chat được đọc bởi reader nội bộ main, không xuất session ra renderer. Cấm thu hồi Agent của staff đang giữ QR local bật Chat; phải chuyển Server hoặc tắt Chat trước. App Server cũ loại tổ chức separate để tránh phiên thứ hai.

Đọc trực tiếp `auto_accounts` bằng role Desktop có thêm restrictive SELECT policy, nên client cũ, count và truy vấn lồng cũng bỏ tài khoản tắt Agent. Policy owner cũ vẫn giữ. Danh sách ngoại lệ là các RPC runtime/cleanup cụ thể theo `request.path` và POST do PostgREST thiết lập, không đọc header caller; chúng giữ nguyên SECURITY INVOKER, claim/token/receipt và RLS sở hữu. Catalog capture 11 signature phụ thuộc và guard cả policy lẫn metadata trước activation. Cơ chế request context theo [tài liệu PostgREST](https://docs.postgrest.org/en/stable/references/transactions.html#request-path-and-method).

Khi account có `organization_id=NULL`, policy đọc tổ chức qua view hiện hành `aka_agent_staff_runtime_profile` đã scope theo staff token. Desktop không được SELECT bảng/cột `org_staff`; không cấp thêm quyền để chạy policy. V445 và V447 kiểm checksum/owner/ACL/security_barrier của view trước khi tiếp tục. Fixture SQL dùng đúng view và helper khóa staff đã capture, giữ kiểm tra từ chối đọc staff trực tiếp cả trước/sau activation. PostgreSQL kiểm quyền trên subquery dù một nhánh OR/COALESCE có thể bỏ qua nó, nên không được đưa SELECT bảng staff trở lại policy.

`aka_agent_app_access_local_session(bigint,bigint,text,jsonb)` là RPC invoker chỉ ở main để commit/kiểm tra/xóa session QR local và đọc ba trường route phục vụ dừng. Không nhận update tùy ý, không trả raw session, kiểm staff/owner/app hiện tại và giữ CAS khi xóa session invalid. Reader đọc session vẫn dùng RPC scoped hiện có; claim/cleanup dùng nguyên body live. Lifecycle Desktop giữ reader Chat khi gói Zalo Agent hết hạn nhưng staff còn Agent từ gói khác, tách group manager chiến dịch và giữ transport khi stopping.

Gửi tin, feature action và đồng bộ lịch sử dùng chung điều kiện capability Chat: separate đọc quyền Chat, legacy giữ resolver sản phẩm Zalo Agent cũ. Data Scan HTTP chỉ nhận source Agent từ backend, kiểm owner/staff/account trước admission; coordinator recheck live ngay trước dispatch, giữ receipt nếu bị từ chối và không dispatch sau cancel/detach. Làm mới danh bạ nội bộ gắn source Chat; caller không được đổi source bằng payload/header.

## Danh tính Zalo và CRM

Bật app còn lại dùng đúng `auto_accounts.id`. Giữ UNIQUE/binding/generation và khóa danh tính hiện có. Bật Chat sau login kiểm tra liên kết/UID; account khác đã giữ cùng Zalo trong tổ chức bị từ chối. Tắt Chat không giải phóng binding. Giữ guard tái sử dụng binding của account đã xóa; không gộp/chuyển lịch sử hoặc chuyển chủ tự động. QR hoàn tất kiểm tra lại quyền, subtype và generation trước commit. Với account đã đăng nhập nhưng chưa có binding, bật Chat tạo reservation bằng chính bảng binding/UNIQUE hiện có trong transaction cấp suất: inactive, generation 0, không session. Runtime đăng ký sau dùng đường enrollment hiện có để kích hoạt binding. Tắt Chat giữ reservation; trùng identity rollback cả cờ/quota. Trường hợp binding của account đã xóa vẫn do luồng enrollment hiện hành tái sử dụng; cấp Chat không tự chuyển binding, và undelete không được chiếm lại danh tính đã được dòng khác giữ.

QR quản lý kiểm quyền của cả người yêu cầu và tài khoản theo ứng dụng đã được backend xác thực. Header client không được tự chọn ứng dụng. Coordinator giữ ứng dụng khởi tạo tới khi QR local/Server hoàn tất; quyền của app còn lại không thay thế quyền đã bị thu hồi. Nhánh reader/enrollment nội bộ vẫn giữ điều kiện transport riêng. QR native tạo receipt với nguồn Agent; QR remote được backend tạo receipt theo app/người yêu cầu thật trước khi gửi command. Desktop chỉ gắn claim token vào receipt đó. `aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)` kiểm nguồn, quyền actor/chủ/account và claim hiện tại trong cùng transaction commit session. `mark`/clear của reader không cần quyền bắt đầu QR mới. Direct session write của client cũ bị chặn nếu không có receipt commit trong transaction hiện tại. Hủy chờ prepare rồi đóng receipt; phản hồi prepare muộn không phát QR sau cancel/detach. Commit bị từ chối giữ nguyên session và login status cũ.

CRM tiếp tục ghi gói/quota trên từng dòng product và cập nhật `org_organization.max_staff` như cũ. App separate đọc quota theo nhóm product, legacy giữ org.max_staff. Bootstrap first product 5 bảo toàn quyền legacy đang cấp kể cả vượt mức; tổ chức chưa dùng Chat chỉ bật admin chính nếu đủ điều kiện. Receipt ngăn gia hạn bật lại quyền đã tắt. Giữ thứ tự org → staff → product và cleanup khi lỗi; không đổi giá, payload, endpoint hoặc UI CRM.

Khi có lịch sử gói Agent, first5 khôi phục cờ Agent của các dòng legacy trước khi kiểm quyền riêng, kể cả dòng được client Chat mới tạo với cờ Agent=false. Legacy vốn bỏ qua cờ này. Bước capture chỉ chạy một lần; gia hạn không khôi phục quyết định tắt quyền sau chuyển đổi.

V447 dùng `SHARE ROW EXCLUSIVE` trên product/staff/account trong bước capture cuối để chặn ghi đồng thời tới khi gate đã bật. `lock_timeout=5s`, `statement_timeout=60s`; tranh khóa thì rollback và thử lại sau, không tăng ngân sách connection. Capture chỉ phục hồi quyền legacy của nhóm gói liên quan, không cấp Agent cho tổ chức chỉ có Chat. Receipt ghi thời điểm chốt; helper từ chối chạy sau activation và gia hạn không chạy lại. Không chạy V447 cùng V445 trước khi các caller mới đã sẵn sàng.

Quyết định rollout trước PR ngày 03/11/2026: người dùng chấp nhận Desktop cũ không hỗ trợ tổ chức từng có product 5. Không cần đợi toàn bộ người dùng cài bản mới; cần deploy backend/runtime tương thích và phát hành bản Desktop mới trước activation. Máy cũ của tổ chức có product 5 có thể bị từ chối QR local hoặc không duy trì Chat-only và cần cập nhật; tổ chức không có product 5 vẫn legacy. V447 bật toàn deployment, không kiểm phiên bản từng máy hay chuyển từng tổ chức. Quyết định này không phải chỉ thị apply V447 hoặc deploy trong task tạo PR.

Chỉ thị mới sau build Desktop 9.2.0: người dùng yêu cầu trực tiếp apply V447; đã kích hoạt lúc 06:07:41 ngày 03/11/2026. Chỉ thị này thay bước chờ phát hành cho lần activation này, không đồng nghĩa bộ cài đã upload/phát hành. Các giới hạn của client cũ và yêu cầu roll forward sau activation vẫn giữ.

## Giới hạn và bàn giao

Tái sử dụng pool, cache, refresh và worker hiện có; không thêm polling/replica/nguồn SQL production. Hai connection của harness chỉ nằm trong PostgreSQL disposable local.

Migration canonical nằm tại repo akaAgent, không nhân bản SQL sang repo khác. Private IP/auth patches và rollback nằm ngoài Git trong `app-access-20261103` dưới thư mục incident-recovery hiện có. Không deploy Edge từ Git cũ. Rollback trước kích hoạt giữ schema/receipt/quyết định người dùng; sau kích hoạt phải roll forward để không mở lại quyền đã thu hồi.

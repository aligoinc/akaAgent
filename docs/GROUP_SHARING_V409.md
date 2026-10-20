# Chia sẻ nhóm data và nhóm nội dung — V409

## Trạng thái bàn giao

Triển khai tại `akaAgent` (Desktop + migration) và repo `akaAgentWebApp` (Web/API).
Migration **đã apply** trên `akachat` (`cgjbsmqtfhqvttudyjzq`) ngày 20/10/2026,
lúc 15:38:46 giờ Việt Nam: `20261020083846 / migration_v409_group_sharing`.
Kiểm thử trước/sau apply và chạy thử rollback đều đạt. Không apply lại V409.
Chưa deploy API/Web hoặc đóng gói/phát hành Desktop.

## Hợp đồng

- `GroupSharing`: `private | organization | selected`, danh sách ID người nhận, revision dạng chuỗi.
- `GroupAccess`: chủ sở hữu/tên, `owner | shared`, `canManage/canUse/canCopy`.
- Mặc định riêng tư; toàn tổ chức tính theo thành viên hiện tại, bao gồm thành viên gia nhập sau.
- Chỉ chủ nhóm lưu chia sẻ bằng CAS; admin nhận chia sẻ vẫn chỉ đọc. Reader nhân viên riêng chỉ trả ID/tên của người đang hoạt động, chưa bị xóa trong cùng tổ chức.
- Người nhận xem, xuất Excel, dùng làm nguồn chiến dịch, nhân bản nhóm/mẫu và sao chép các data được chọn vào nhóm riêng. Picker đích chỉ trả nhóm riêng. Tên/màu/thứ tự/ghi chú, data/mẫu gốc, đồng bộ/bộ lọc và chia sẻ lại vẫn chỉ chủ nhóm được thao tác.
- Panel người nhận trả thông tin nhóm và data; không trả lịch sử, chiến dịch, nguồn đồng bộ, tên tài khoản hoặc cấu hình riêng của chủ nhóm. ID tài khoản gốc chỉ phục vụ điều kiện tương thích, không cấp quyền tài khoản.
- Bản sao khác nhân viên có contact/template mới, chủ sở hữu mới, không chia sẻ lại, không đồng bộ, không gắn tài khoản hoặc mang theo bằng chứng bạn bè/tham gia nhóm Zalo. Các trường thông tin bổ sung sao chép chỉ `info1`–`info5`.
- Thu hồi chia sẻ hoặc nhân viên bị xóa/rời tổ chức/ngừng hoạt động chặn đọc/copy/intake. Nguồn đang hoạt động bị chuyển `stopped/sharing_revoked`; cấp lại quyền không tự bật lại. Input, snapshot nội dung và bản sao đã tạo được giữ nguyên.
- Quy ước thu hồi đã chốt khi review ngày 20/10/2026: yêu cầu mới sau thu hồi bị chặn; thao tác đã bắt đầu trước thu hồi được phép hoàn tất và nhận thêm data trong khoảng đó. Đây là hành vi được chấp nhận, không phải finding cần sửa; giữ nguyên luồng khóa/quyền hiện có.
- Lựa chọn nhóm nội dung mới tải lại kho trước khi chụp nội dung; backend kiểm tra quyền khi lưu snapshot mới. Snapshot đã lưu được giữ khi sửa phần khác, kể cả sau thu hồi.
- Không tạo polling/pool/connection ứng dụng mới. Dùng client hiện có, tải khi mở/làm mới/thao tác. Generation theo nhóm/phiên bỏ phản hồi cũ; lỗi tải không được biến thành kết luận thu hồi.

## Điều chỉnh giao diện — 20/10/2026

- Badge chỉ hiện tên người chia sẻ, nằm ở hàng cuối phần thông tin nhóm trong danh sách quản lý và picker nguồn. Giữ một dòng, tên dài có dấu `…`; rê chuột xem tên đầy đủ.
- Nhóm data có nút **Chia sẻ** cạnh tên nhóm trong tab **Thông tin**. Nhóm nội dung có nút cạnh tiêu đề nhóm đang chọn phía trên danh sách mẫu; không chiếm khu vực xem trước và không hiện ở **Tất cả mẫu / Chưa phân nhóm**.
- Chỉ chủ nhóm thấy nút. Bấm nút mới mở hộp thoại và đọc cấu hình/danh sách nhân viên; chỉ ghi khi bấm **Lưu chia sẻ**, lưu thành công đóng hộp thoại. Người nhận giữ badge và thao tác sao chép hiện có.
- Hộp thoại dùng native modal dialog, giữ focus bên trong, Escape đóng hộp và trả focus về nút mở. Đổi nhóm/phiên đóng hộp, bỏ phản hồi muộn; lỗi tải có **Tải lại**, xung đột phiên bản giữ hộp để xử lý.
- Kiểm chứng: hai typecheck Desktop, production build Desktop/Web; 22 test trang quản lý Web; smoke Electron/Chromium với lưu, CAS, Escape/focus, tải lỗi, đổi nhóm/phiên, người nhận và picker đích. Browser trên bundle Web kiểm tra vị trí ở 1440/850px cùng badge tên dài.
- Chỉ đổi giao diện; không sửa migration/API hoặc triển khai ứng dụng.

## Database, RPC và tương thích

`migrations/migration_v409_group_sharing.sql` là migration canonical, được dựng bởi
`scripts/group-sharing/build.py` từ định nghĩa live đã chụp, không từ migration cũ.

Hai bảng nhóm thêm `sharing_scope`, `sharing_revision` riêng, không cập nhật data revision.
Hai bảng người nhận có khóa `(group_id,staff_id)` và chỉ mục ngược; bật RLS và không cấp
quyền bảng cho client. Journal copy private dùng request ID/hash để retry không tạo bản sao trùng.

RPC mới:

```text
public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)
```

RPC xác thực credential Desktop hoặc context service-role API, kiểm tra staff/org hiện tại;
không tin danh tính trong JSON. IPC chỉ main frame, allowlist thao tác và ID số nguyên dương.
Các thao tác public: staff/get/save/copy; readers và kiểm tra snapshot gọi từ repository.

Chín RPC/helper hiện có chỉ đổi guard đọc nhóm/chủ contact của nguồn. Giữ chữ ký, owner,
SECURITY DEFINER, volatility, config, ACL và tất cả khóa/lịch/dedup/runtime checks khác.
Danh sách đầy đủ với checksum trước/sau và thuộc tính nằm tại:

- `migrations/snapshots/group-sharing-v409/inventory.json`
- `migrations/snapshots/group-sharing-v409/expected-functions.json`
- `migrations/snapshots/group-sharing-v409/verification.json`

Preflight kiểm tra 11 định nghĩa nguồn cùng owner/ACL; khác checksum thì dừng để chụp lại live.
Lock nhóm là gốc cho bind/reactivate/snapshot/intake và thu hồi, sau đó giữ barrier campaign
hiện có. Trigger thay đổi staff dừng subscription chia sẻ không còn hợp lệ theo cùng thứ tự khóa.

Reader cũ vẫn chỉ trả nhóm riêng. Web mới gửi `x-aka-group-sharing: 1`; API dùng reader mới
khi có cờ này, không sửa context auth cache. Native/client cũ tiếp tục dùng đường cũ.
**Theo lựa chọn tương thích đã chốt, ACL/RLS của bảng nhóm/contact/template cũ không siết lại.**
Do đó phiên bản này không khóa truy cập trực tiếp các bảng legacy bằng credential DB cũ;
quyền thao tác được thực thi tại ứng dụng mới và API/RPC. Đây là giới hạn có chủ đích.

## Kiểm chứng

- Trước apply, `node scripts/group-sharing/verify.cjs`: thực thi migration và SQL smoke đầy đủ trên akachat rồi rollback, chạy thử rollback V409, so checksum/owner/ACL/config với baseline và xác nhận live không đổi. Không chạy lại script này khi V409 đã apply.
- Sau apply, `node scripts/group-sharing/verify-applied.cjs`: đọc và so checksum/thuộc tính live, ACL bảng cũ, schema/RLS mới; chạy SQL smoke và thử rollback trong transaction rồi `ROLLBACK`, cuối cùng xác nhận V409 vẫn còn nguyên.
- SQL fixture: chủ nhóm, người được chọn, người không được chọn, admin, khác tổ chức; private/selected/organization, CAS lỗi, catalog trước phân trang, đích riêng, mutation bị chặn, copy độc lập/idempotent, preview, snapshot một lần, bind/intake liên tục, revoke/reactivate, staff rời/gia nhập lại, Zalo không cấp quyền tài khoản/bằng chứng quan hệ, nội dung sau thu hồi. Gọi với role `anon`/`service_role`, credential thật của fixture; toàn bộ rollback.
- `node scripts/group-sharing/concurrency-smoke.cjs`: PostgreSQL 16 cô lập, chạy helper khóa/thu hồi mới với hai connection test; cả hai thứ tự intake–revoke, CAS hai người lưu, rời/gia nhập tổ chức. Các dependency không thuộc phần tranh chấp dùng fixture tối thiểu; SQL live ở trên kiểm tra luồng đầy đủ.
- `node scripts/group-sharing/ipc-smoke.cjs`: direct IPC main-frame/action/ID guard.
- `node scripts/group-sharing/ui-smoke.cjs`: Electron quản lý nội dung/data và picker đích; Chromium chạy component chia sẻ của Web. Tải khi mở hộp, chọn/tìm nhân viên, lưu/đóng/focus, CAS, lỗi tải, chỉ đọc, copy, đổi nhóm/phiên và phản hồi muộn; ảnh hộp thoại tại `/tmp/group-sharing-dialog-electron.png`.
- `node scripts/content-template-loading-smoke-test.cjs`: hồi quy phân trang đến trang rỗng, tải lỗi không mất cache, mutation/session race.
- Web/API bổ sung test actor từ phiên, permission/CAS, phân trang, snapshot cũ/mới và hai trang quản lý nhóm chia sẻ.
- Một assertion Web cũ dùng câu báo lỗi tài khoản đã bị thay trước nhiệm vụ này; chỉ cập nhật expected text để khớp code hiện tại, không đổi hành vi clone.

Kết quả typecheck/build/test cuối cùng ghi trong `migrations/snapshots/group-sharing-v409/application-checks.json`.
Không gửi tin nhắn hoặc chạy chiến dịch thật trong kiểm thử.

## Sửa review 2 và 3 — 20/10/2026

- Copy nhóm/mẫu nội dung dùng chính unique index hiện có để cấp tên. Nhóm giữ tên đích yêu cầu hoặc `<nguồn> - Bản sao`, nếu trùng thêm `(2)`, `(3)`… Mẫu giữ tên gốc nếu còn trống, khi trùng dùng `<tên> - Bản sao`, rồi `(2)`, `(3)`… Không thay tên hoặc nội dung nguồn.
- `ON CONFLICT` chỉ xử lý unique index tên theo nhân viên, tính cả hoa/thường và khoảng trắng hai đầu. Copy nội dung giữ advisory lock transaction theo nhân viên nhận trước khóa nhóm để hai nhóm nhiều mẫu, khác thứ tự không chờ tên lẫn nhau. Tạo mẫu thông thường vẫn được phân xử bằng unique index. Không đổi khóa nguồn chiến dịch, không thêm pool/polling. Journal request vẫn trả cùng kết quả khi retry; không tạo thêm bản sao.
- Web render badge ngay dưới tên mỗi nhóm data. Test kiểm tra trong từng hàng, gồm các nhóm trùng tên từ hai người chia sẻ và nhóm riêng, thay vì tìm badge trên toàn trang.
- SQL rollback bổ sung owner copy, mẫu thứ hai cùng nhóm, copy nhóm nhiều lần, copy vào nhóm riêng có sẵn, va chạm tên hoa/thường/khoảng trắng, retry và sửa/xóa bản sao không ảnh hưởng nguồn.
- `node scripts/group-sharing/copy-concurrency-smoke.cjs` dùng PostgreSQL 16 cô lập và RPC copy thực tế, xác nhận hai copy từ nguồn khác nhau cùng tranh tên và copy đua với thao tác tạo mẫu thông thường.
- Tại thời điểm sửa review, định nghĩa/owner/ACL của 11 hàm live vẫn khớp baseline; lưu tại `migrations/snapshots/group-sharing-v409/review-live-preflight.json`. Chín body RPC cũ được patch bởi V409 không thay đổi trong lượt sửa này. Chỉ cập nhật helper copy mới trong migration V409 trước khi apply.

Kiểm chứng bổ sung và checksum migration sau sửa nằm tại
`migrations/snapshots/group-sharing-v409/review-fixes-checks.json`; receipt
`application-checks.json` giữ nguyên kết quả kiểm chứng trước review.

## Apply production — 20/10/2026

- Project: `akachat` (`cgjbsmqtfhqvttudyjzq`); migration `20261020083846 / migration_v409_group_sharing`.
- SHA256 migration canonical: `08281d80afef48986653f49bd2d19fb14eb0202c95c11180a933c428944fd3b4`. Apply đúng nội dung đã qua review 2/3, không bulk-push migration khác.
- Chụp lại đầy đủ định nghĩa và thuộc tính 11 hàm ngay trước apply; tất cả khớp baseline. Chín hàm được patch có checksum đích đúng kỳ vọng; hai reader cũ và ACL bảng legacy giữ nguyên. Giữ các patch live về khóa, lịch, dedup, runtime, owner/SECURITY DEFINER/volatility/config/ACL ngoài guard đọc nhóm và chủ contact nguồn.
- RPC mới `public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)` có MD5 định nghĩa `75e14dbec647c96812bed7d8c165fc18`. PostgREST đã nhận schema mới; lời gọi HTTP thiếu credential bị từ chối bằng `automation_auth_required`.
- SQL smoke trước/sau apply đạt, gồm role `anon`/`service_role`, quyền/cùng tổ chức/CAS, copy trùng tên và độc lập, nguồn một lần/liên tục, thu hồi và tương thích Zalo. Chạy thử rollback sau apply khôi phục đúng định nghĩa cũ trong transaction rồi `ROLLBACK`; kiểm tra lại V409 vẫn nguyên vẹn. Không gửi tin hoặc chạy campaign thật.
- Sau apply, 4.401 nhóm data và 192 nhóm nội dung hiện có đều `private`. Ba bảng sharing/journal bật RLS, không cấp quyền trực tiếp cho client.
- Advisor phát sinh đúng ba thông báo [RLS không có policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) do bảng chỉ qua RPC, cùng thông báo RPC SECURITY DEFINER có thể gọi bởi [anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) và [authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Đây là ACL có chủ đích của endpoint có kiểm tra identity/staff/org/quyền; test từ chối credential và quyền sai đã đạt. Không phát sinh disabled-RLS hoặc mutable-search-path mới.

Audit trong `migrations/snapshots/group-sharing-v409/`:

- `apply-live-before.json`, `apply-live-after.json`: định nghĩa, checksum và thuộc tính thực tế trước/sau.
- `apply-verification.json`: từng chữ ký RPC với source/target checksum, kết quả smoke/rollback.
- `apply-result.json`, `apply-http-smoke.json`, `apply-advisors.json`: kết quả apply, HTTP và đối chiếu advisor.
- `verification.json`: lần chạy thử cuối trước apply; `productionChanged:false` trong receipt này chỉ mô tả lần rehearsal, không phải trạng thái triển khai hiện tại.

## Rollout DB → API → Desktop/Web

1. **Đã xong:** kiểm tra live checksum/owner/ACL và chạy thử migration/rollback trên đúng project.
2. **Đã xong:** apply V409 version `20261020083846`, xác minh SQL/HTTP/schema/ACL và lưu audit. Không apply lại; dùng `node scripts/group-sharing/verify-applied.cjs` để kiểm chứng bản đang chạy.
3. Deploy API tương thích cả legacy và reader mới. Kiểm tra đăng nhập, reader cũ own-only, reader mới và save CAS bằng tài khoản test.
4. Phát hành Desktop và Web có UI/reader mới. Không phát hành client mới trước DB/API. Mở lại hoặc tải lại nhóm để nạp quyền hiện tại.
5. Kiểm tra một chia sẻ có chọn người, một bản sao độc lập và thu hồi nguồn test; không kích hoạt campaign thật ngoài phạm vi được cho phép.

## Rollback

Rollback client/API về bản trước trước khi thu hồi RPC mới. Chạy file
`migrations/tests/migration_v409_group_sharing_rollback.sql` theo quy trình được duyệt.
File có checksum guard chín hàm V409, dừng nguồn chia sẻ liên nhân viên rồi khôi phục
đúng body cũ và thu hồi EXECUTE RPC mới. Nếu có patch mới hơn, guard dừng để tránh ghi đè.

Không xóa cột/bảng sharing/journal, contact/template đã sao chép, input hoặc snapshot nội dung.
Giữ metadata phục vụ phục hồi/audit; schema cleanup là một migration riêng nếu cần.
Không chạy lại V409 sau rollback mà chưa tạo migration forward mới dựa trên live.

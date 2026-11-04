# Tích hợp và quản trị

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 367–409. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
### Loại trừ gửi Zalo

Danh mục điều kiện/toán tử lấy từ DB; UI và runtime dùng metadata cùng adapter/evaluator hỗ trợ trong [campaignSendExclusion.ts](../../../src/shared/campaignSendExclusion.ts). Mỗi account chọn nhóm/danh sách riêng; snapshot giữ suốt lượt, đọc nguồn theo nhu cầu, thiếu dữ liệu thì tạm dừng bằng CAS. Kiểm tra/gắn tag dùng chung context RAM với một `getLabels` mỗi input/batch; giữ opt-out/cooldown độc lập và quota tìm SĐT đã thực hiện. Xem [hướng dẫn](../../../docs/CAMPAIGN_SEND_EXCLUSIONS.md).

V330 đã apply trên akachat với history `20260928172551 / migration_v330_campaign_send_exclusions`; không apply lại khi phát hành. Chat runtime/worker đã deploy; bộ cài Desktop/legacy Zalo Server 7.8.0 đã build local. [Audit DB](../../../docs/CAMPAIGN_SEND_EXCLUSIONS_V330_AUDIT.md) và các smoke `send-exclusion-*` kiểm tra metadata động, tenant/CAS, request tag và vòng đời runtime.

### Kho mẫu nội dung

Chia sẻ nhóm data/nội dung dùng `groupSharingRepository` và IPC `groupSharing` với `GroupAccess`, `GroupSharing` cùng revision chia sẻ riêng. Reader mới lọc quyền trước phân trang; picker đích chỉ nhóm riêng. Nút **Chia sẻ** cạnh tên nhóm chỉ mở dialog khi chủ nhóm bấm; badge người nhận chỉ tên, một dòng ở cuối thông tin nhóm. Dùng client/cache hiện có, hủy phản hồi cũ theo nhóm/phiên; hợp đồng và rollout DB → API → Desktop/Web tại [GROUP_SHARING_V409.md](../../../docs/GROUP_SHARING_V409.md).

[contentTemplateStore.ts](../../../src/renderer/src/stores/contentTemplateStore.ts) chia sẻ dữ liệu/request đang tải giữa kho mẫu và form; form chỉ tải khi dùng mẫu/nhóm, mutation làm mới một lượt sau khi request cũ kết thúc, logout/đổi staff bỏ dữ liệu và phản hồi cũ. Repository phân trang theo ID đến trang rỗng, không đếm riêng từng nhóm; `templateCount=null` khi chưa có danh sách mẫu đầy đủ, lỗi mạng giữ dữ liệu cũ và cho thử lại; xóa nhóm vẫn kiểm tra tồn tại mẫu qua server (`limit(1)`). Smoke: `node scripts/content-template-loading-smoke-test.cjs` và `node scripts/run-content-template-loading-ui-smoke.cjs`.

### Đồng bộ Google Sheet vào nhóm data

Tab **Đồng bộ ngoài** dùng `dataGroupExternalSync` qua main/preload/renderer và RPC tenant; parser/mapper dùng chung Desktop/Edge tại [googleSheetSync.ts](../../../src/shared/googleSheetSync.ts). V297–301 đã apply, Edge `aka-agent-google-sheet-sync` v3 dùng xác thực nội bộ Vault. Cron 66 hiện có kiểm tra nguồn đến hạn mỗi 30 giây, một lease toàn hệ thống; không thêm SQL pool/job. Import chỉ thêm mới, giữ seen ledger khi gỡ data/xóa nguồn; preview không ghi. Xem [hướng dẫn](../../../docs/DATA_GROUP_GOOGLE_SHEET_SYNC.md) và [audit index v301](../../../docs/DATA_GROUP_SHEET_V301_AUDIT.md).

UI chỉ theo dõi pending/running mỗi 10 giây, tối đa 5 phút, khi tab/dialog đồng bộ hiện và không mở editor; thành công tải lại member/group/panel rồi dừng. Sửa nguồn tự kết nối, đổi chế độ tiêu đề tự đọc lại, cột thay đổi phải ghép lại; chỉ mount một panel giữa chế độ rộng/hẹp. Kiểm chứng bằng parser smoke, UI smoke Google Sheet, SQL rollback và hai typecheck/build.

Ngày dừng Google Sheet bắt buộc khi lưu Desktop: mặc định hôm nay +7, tối đa +180 ngày theo giờ Việt Nam; form/main dùng chung kiểm tra trong [googleSheetSync.ts](../../../src/shared/googleSheetSync.ts). Nguồn cũ NULL vẫn chạy, chỉ điền ngày khi mở sửa và ghi khi Lưu; không backfill/migration. Xem [hướng dẫn và smoke](../../../docs/DATA_GROUP_GOOGLE_SHEET_SYNC.md).

V311 cấp thêm `EXECUTE` cho `service_role` trên `aka_agent_data_group_external_sync(bigint,bigint,text,text,text,jsonb)` và `aka_agent_list_data_group_members_v3` để Web gọi được RPC; giữ nguyên body/owner/ACL Desktop và không reload schema. Smoke phải đổi role SQL thật bằng `SET LOCAL ROLE service_role`, không chỉ đặt JWT claim. Xem [audit v311](../../../docs/DATA_GROUP_SHEET_V311_AUDIT.md).

### Admin akaBiz (desktop)

Cron Admin v296 tối ưu lọc log job thưa/đã tắt: thử cửa sổ PK 5.000 dòng, thiếu 101 kết quả mới dùng lọc/top-N sort `runid+0` để tránh index scan ngược trên toàn heap; vẫn cursor `runid`, trả 100 dòng và không thêm index/pool/timer. Body live và audit hiện tại ở [ADMIN_CRON_V296_AUDIT.md](../../../docs/ADMIN_CRON_V296_AUDIT.md), không lấy lại body v294 để ghi đè. UI lịch có diễn giải tiếng Việt bên cạnh cron gốc; phần thông báo gọi người nhận là “khách hàng” nhưng vẫn lưu theo `org_staff`.


Menu **Admin akaBiz** dưới **Cài đặt Workflow** chỉ nhận `org_staff.is_admin IS TRUE AND organization_id=1`, qua `AuthUser.isAdmin`; tuyệt đối không dùng `isAdminAkabiz` để cấp quyền này. Cờ được đọc lúc login/bootstrap và refresh quyền hiện có. IPC `admin:*` chỉ nhận main renderer frame; RPC `aka_agent_admin_{docs,notifications,settings,cron,triggers}` luôn xác thực process-only credentials và gọi helper `aka_agent_admin_assert_access` kiểm tra live staff active/admin/org1. Không mở rộng discovery Zalo Server vì cờ desktop này.

Migration v294 chỉ thêm bảng `auto_admin_api_docs` (RLS, RPC-only) và sáu function mới; không thay ACL legacy `org_staff`/`auto_system_settings`. Thông báo dùng nguyên `app.notification`/`org_staff.app_notification`, xóa bằng `''`; sửa raw text/JSON kể cả tương lai/hết hạn. Settings chỉ sửa mô tả/giá trị với CAS, secret list bị che và reveal riêng; không log/persist secret. Cron/trigger chỉ đọc, log keyset 100 dòng theo `runid`, không polling hoặc chạy SQL; body hàm chỉ tải khi mở chi tiết. Tái sử dụng Supabase HTTP client, không thêm pool/connection riêng.

`AdminDocsWebService` tạo một guest cho tài liệu đang mở, partition `persist:akaagent_admin_docs_1_<staffId>_<docId>` riêng CRM/akaChat; main nhận ID và lấy URL từ DB. Guest/popup sandbox, không preload/Node; khác origin mở ngoài. Chuyển doc/menu, logout/expire/đổi staff/mất quyền đóng guest/popup; cookie giữ riêng. Guest crash phải tạo mới, không reload guest cũ. Xem [hướng dẫn](../../../docs/ADMIN_AKABIZ.md), [audit](../../../docs/ADMIN_AKABIZ_MIGRATION_AUDIT.md); smoke fixture: `node scripts/run-admin-smoke-test.cjs`.

Doc API chỉ cấp `clipboard-sanitized-write` cho guest/popup đang được service quản lý, đúng origin và còn quyền; không cấp clipboard read hoặc tự focus/show cửa sổ. Form secret dùng revision của bản nháp để phản hồi reveal đến muộn không ghi đè nội dung vừa nhập/xóa.

### Quản lý nhân viên (desktop)

V310 dùng `org_organization.use_staff_expiration`: mặc định false cho tổ chức hiện có và tổ chức mới → hạn tổ chức; true → kiểm tra thêm hạn nhân viên, NULL vẫn kế thừa hạn tổ chức. Quyền sản phẩm luôn được kiểm tra. V312 đã drop cột `use_organization_expiration`; hướng dẫn và checksum trong [audit](../../../docs/STAFF_MANAGEMENT_MIGRATION_AUDIT.md).

Menu dưới **Cài đặt** dành cho `org_staff.is_admin IS TRUE` ở mọi tổ chức; module [staffManagement](../../../src/shared/staffManagement.ts) đi qua main-frame IPC và RPC kiểm tra credential/admin/tenant live, dùng Supabase HTTP hiện có. Quota lấy `org_organization.max_staff`; mật khẩu tải riêng, không log/storage; mutation giữ revision và request ID khi retry. Hướng dẫn, hạn nhân viên và audit v305–307: [STAFF_MANAGEMENT.md](../../../docs/STAFF_MANAGEMENT.md), [STAFF_MANAGEMENT_MIGRATION_AUDIT.md](../../../docs/STAFF_MANAGEMENT_MIGRATION_AUDIT.md).

V308 thêm trưởng phòng qua `org_group_staff.is_admin`, cùng quy tắc Chat: một phòng trong form, cấp người mới thay người cũ; chuyển phòng giữ lựa chọn vai trò. `saveStaff` cùng lock tổ chức Chat, không đổi admin tổ chức; payload cũ thiếu `isDepartmentManager` giữ hành vi cũ. Smoke SQL v308 và Electron kiểm tra vai trò, CAS/replay, phân quyền và hiển thị.


<!-- END PRESERVED SOURCE -->

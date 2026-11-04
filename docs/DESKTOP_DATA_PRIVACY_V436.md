# Giới hạn dữ liệu Desktop — V436

Đã apply trên **akachat (`cgjbsmqtfhqvttudyjzq`) lúc 16:39:22 VN ngày
28/10/2026**, ledger `20261028093922 / migration_v436_desktop_data_privacy`.
[Receipt](../migrations/snapshots/desktop-data-privacy-v436/apply-receipt.json).
Không apply lại. Chỉ thay DB; không cần cập nhật app, không sửa source/query client,
UI, dữ liệu khách hoặc timeout. Không mở lại quyền anon/authenticated.

## Phạm vi và ngoại lệ cần giữ

| Dữ liệu | Giới hạn token Desktop | Chức năng giữ nguyên |
| --- | --- | --- |
| Liên hệ, nhóm data, tag, media/thư mục media | Đọc/ghi dữ liệu thuộc staff của token; membership phải thuộc nhóm của mình. Guard chặn đổi chủ, tạo/chuyển sang org khác và gắn tham chiếu mới của staff khác. | CRUD/import hiện tại; raw dữ liệu riêng không thay thế quyền chia sẻ qua RPC. |
| Nhóm/mẫu nội dung | Chủ quản lý; người nhận đọc nhóm được chia sẻ theo tổ chức hoặc danh sách chọn, không sửa nguồn. Mẫu chia sẻ phải nằm trong nhóm chính hợp lệ/đang hoạt động. | Picker, đọc/xuất/dùng nội dung, copy độc lập, chia sẻ/thu hồi và snapshot hiện có. |
| `auto_system_settings` | Chỉ staff có `is_admin_akabiz`, đang hoạt động/chưa xóa trong DB mới được ghi. | Đọc settings app cần; admin lưu cấu hình media. Policy riêng chặn DeepSeek vẫn còn hiệu lực. |
| `auto_elements` | Khách chỉ sửa element không builtin của mình; không tự đổi thành builtin/chuyển chủ. Admin hệ thống hợp lệ vẫn quản trị được. | Đọc XPath dùng chung và cache runtime không đổi. Block/workflow vẫn readonly như cutover trước. |
| `org_organization` | Chỉ org của mình và org hệ thống; chỉ SELECT `id`, `name`, `staff_admin_id`, `is_admin_akabiz`. | Login đọc tên tổ chức; block/workflow/element tìm catalog hệ thống. Không có quyền ghi tổ chức. |
| `org_organization_product` | Chỉ đọc gói của org hiện tại. | Các query entitlement/giới hạn đang dùng. Backend/Server vẫn dùng quyền riêng. |

**Chia sẻ data không mở raw bảng của người khác:** RPC `aka_agent_group_sharing`
hiện có vẫn kiểm tra quyền, che provenance/account của chủ và cho phép đọc/xuất,
copy, dùng nguồn hợp lệ. Người nhận không sửa nguồn. Mẫu nội dung chia sẻ được
đọc theo cùng tiêu chí của RPC. Quyền chia sẻ theo nhóm chính không được mở rộng
qua `secondary_group_ids`.

Dữ liệu legacy có org/tham chiếu khác hiện tại vẫn sửa được các field không liên
quan; chỉ kiểm tra org/tham chiếu khi tạo mới hoặc thay giá trị đó. Không sửa dữ
liệu legacy. Preflight chỉ đếm, không xuất dữ liệu: không có mẫu gắn nhóm chính/
nhóm phụ khác chủ hoặc media membership khác chủ tại thời điểm rà soát. Không
thực hiện full scan nặng để sửa dữ liệu liên hệ; guard giữ tham chiếu cũ không đổi.

**Chưa thu hồi** đọc `media.storage.secret_access_key` và
`zalo.group_link.ginfo_proxy_url`: app hiện tại dùng trực tiếp cho upload/scan.
Muốn giấu các giá trị này cần chuyển luồng sang backend và cập nhật app sau.
Không suy từ V436 rằng mọi secret cấu hình đều đã được giấu.

## Đối chiếu code và RPC

Nền source `09a81aaa` (đã sync `origin/dev_3`); 478 hash ứng dụng và file ngoài
phạm vi giữ nguyên. Rà các repository:

- `accountContactRepository`, `contactTagRepository`: owner trong payload/filter;
  cập nhật tag qua `aka_agent_mutate_contact_tags`, không mở thêm column grant.
- `groupSharingRepository`, `contentTemplateRepository`: chia sẻ đi qua RPC;
  direct CRUD thuộc chủ; embedded join tên nhóm tiếp tục được phép.
- `mediaFileRepository`: CRUD/membership thuộc chủ; admin media settings kiểm tra
  `isAdminAkabiz`; cần giữ secret upload cho bản app hiện tại.
- `elementV2Repository`: cache đọc mọi XPath; own nonbuiltin CRUD và admin được
  giữ. `blockRepository`/`workflowV2Repository` cần ID staff/org hệ thống.
- `authRepository`, `entitlementRepository`: các cột org nêu trên và gói cùng org
  đủ cho query hiện tại. `serverRuntimeRepository` dùng backend riêng.

Đối chiếu 207 hàm liên quan từ live, gồm entrypoint Desktop và helper. Các entrypoint
SECURITY DEFINER liên quan đã có binding token/ownership hoặc đi qua
`auto_assert_automation_identity`; wrapper dataset kiểm tra qua
`aka_agent_assert_request_ownership`. Helper entitlement invoker chịu RLS. Không
thay body RPC; trigger mới kiểm tra `current_setting('role')` cả khi đang ở trong
SECURITY DEFINER để không bỏ qua quyền ghi Desktop.

Giữ nguyên patch thu hồi chia sẻ `0e17dec0570937cfea8a1ae035e2af4d`, patch cooldown,
IP hook, staff privacy, account/campaign guard và ngoại lệ updater cũ.

## SQL và checksum

Canonical: [migration](../migrations/migration_v436_desktop_data_privacy.sql).
Thêm **23 restrictive policy, 11 trigger, 3 helper private**; chỉ thay ACL SELECT
Desktop của org. Không bật/tắt thêm RLS, không đổi ACL caller khác. Policy AND với
policy cũ; trigger giữ owner và kiểm tra reference mới.

Ba helper là hàm mới, source signature chưa tồn tại trước apply:

| Exact signature | MD5 `pg_get_functiondef` sau apply |
| --- | --- |
| `private.aka_agent_desktop_data_context()` | `1c661248ef952acb98ee2a2082cf8bf8` |
| `private.aka_agent_desktop_shared_content_groups()` | `ce9391404723fb4355bd113d84a7159d` |
| `private.aka_agent_guard_desktop_data_write()` | `df137ce894beaf837f8862138d385734` |

Owner `postgres`, SECURITY DEFINER, search_path `pg_catalog, public`; hai helper
đọc STABLE và chỉ thêm EXECUTE cho Desktop; trigger function chỉ owner được gọi
trực tiếp. Không mở PUBLIC/anon/authenticated/backend EXECUTE cho helper mới.
**1.255 hàm cũ giữ nguyên body/owner/ACL/config/volatility**, gồm mọi timeout.
771 relation khác, toàn bộ policy/trigger cũ, indexes, constraints, role/membership
và default ACL giữ nguyên.

Preflight fail-closed kiểm checksum/metadata 207 dependency, schema/ACL 13 bảng,
policy/trigger cũ và ba signature mới chưa tồn tại. Full capture live chứa source
bảo mật nên nằm ngoài Git trong
`$HOME/.codex/incident-recovery/akaAgent-ip-block/migrations/snapshots/desktop-data-privacy-v436/`
(qua `privateSecurityAsset`). Snapshot Git chỉ chứa metadata phạm vi/checksum,
không có token, khóa hoặc row dữ liệu khách.

## Kiểm chứng

- [13 nhóm PostgreSQL 17](../migrations/snapshots/desktop-data-privacy-v436/local-test.json):
  tái hiện lỗ hổng; deny cross-staff/direct/definer/claims sai; CRUD và upsert bằng
  payload hiện tại; JSON chia sẻ trước/sau; copy data/nội dung thật qua RPC;
  chọn/dùng nhóm; lưu/thu hồi chia sẻ nguồn chiến dịch; tag; cleanup nhóm phụ;
  legacy org; admin settings/element; quyền backend; rollback exact.
- Workload local 100.000 contacts: count + trang đầu 55 ms tổng; cập nhật 10.000
  contacts 714 ms. Đây là số đo fixture local, không cam kết độ trễ production.
  Không tăng timeout hoặc số connection của ứng dụng.
- Production trial `BEGIN → migration → role probes → guarded rollback → ROLLBACK`
  đạt **219 mapping Auth đang hoạt động**. Capture sau trial khớp toàn bộ bản trước.
- Sau apply, 219 mapping kiểm tra context, đọc thư viện, org/gói, catalog hệ thống,
  shared groups và DeepSeek block đều đạt; metadata khớp mục tiêu.
- [30 HTTP checks](../migrations/snapshots/desktop-data-privacy-v436/http-test.json):
  legacy anon/publishable không đọc bảng dữ liệu, updater cũ chỉ thấy một dòng,
  startup RPC, feed 9.1.0 ba nền tảng và backend health đều đạt.
- Hai typecheck và `npm run build` sạch. Không chạy UI mọi bộ cài hoặc campaign
  gửi thật trong lượt này; không deploy service hay phát hành bộ cài.

Lệnh tái kiểm local: `node scripts/desktop-data-privacy/smoke.cjs` (cần private
capture, PostgreSQL 17). `verify-live.cjs` so sánh **capture đã lưu**, không tự query
production. `http-smoke.cjs` chỉ đọc HTTP, không trích token phiên khách.
Không chạy generator/migration cũ để ghi đè quyền production mới.

## Rollback

[Rollback riêng V436](../migrations/rollback_v436_desktop_data_privacy.sql) yêu cầu
chỉ thị rõ vì mở lại quyền đã chặn, cùng setting transaction
`aka_agent.data_privacy_rollback='approved'`. Guard từ chối khi helper/ACL/policy/
trigger trong phạm vi bị drift; bỏ đúng 23 policy/11 trigger/3 helper và khôi phục
SELECT org trước V436. Không ảnh hưởng các lớp hạn chế trước V436.

Chỉ dùng bản rollback đã review với live tại thời điểm thực hiện. Không chạy B/C,
V435 hoặc rollback ownership cũ để xử lý lỗi của V436.

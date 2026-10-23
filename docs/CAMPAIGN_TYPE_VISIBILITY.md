# Hiển thị loại chiến dịch — Desktop và Web

Ngày kiểm chứng: 23/10/2026. **V423 đã apply production akachat lúc 16:06 VN (`20261023090604`); Web/API đã deploy lúc 16:25 VN, chưa đóng gói/phát hành Desktop.** Canonical SQL chỉ nằm ở repo `akaAgent`; Web tham chiếu cùng migration. Không apply lại. Các ghi chú candidate bên dưới là lịch sử trước apply.

## Hợp đồng

Cấu hình thuộc tổ chức, dùng chung giữa Desktop và Web. Chỉ nhân viên đang hoạt động, chưa xóa, trong khung truy cập hiện có và có `org_staff.is_admin = true` được ghi. Nhân viên thường đọc/tìm/thu gọn. Backend đọc quyền hiện tại khi ghi, không dựa vào cờ quản trị cũ của renderer.

Bảng `public.auto_campaign_type_visibility`: khóa `organization_id`, `hidden_action_ids text[]`, `revision`, `updated_by`, `updated_at`. Không có hàng cấu hình nghĩa là hiện tất cả; mã mới mặc định hiện. RLS bật và thu hồi quyền đọc/ghi trực tiếp của PUBLIC/anon/authenticated/service_role. Chỉ các wrapper RPC được cấp quyền gọi. Mảng chỉ gồm ID loại chiến dịch từ `auto_campaign_actions`, không dùng mã hành động Gắn tag/Đổi tên độc lập.

- Desktop đọc catalog theo entitlement và năng lực tài khoản hiện có; realtime Zalo cần QR.
- Web chỉ quản lý Zalo/SMS; đếm chiến dịch Web vẫn theo phạm vi Zalo Server/SMS hiện tại.
- `N CD` đếm chiến dịch chưa xóa của nhân viên đang xem, tất cả trạng thái, giữ tenant/account/subtype và quyền đọc hiện có, kể cả account soft-delete theo reader hiện hành.
- Patch `{ actionId, visible }[]` chỉ thay các ID gửi lên. UPDATE giữ khóa hàng và hợp với trạng thái mới nhất. Hai admin sửa các mã khác nhau không mất dữ liệu; cùng mã lấy commit sau. Hiện tất cả trên Web giữ nguyên Facebook/Email.
- Snapshot: `{ organizationId, revision, hiddenActionIds, updatedAt, canEdit }`; cài đặt thêm `catalog` với tên/nền tảng/số CD. Form chỉ đọc snapshot, không thực hiện query đếm.

## UI và tích hợp

Thiết kế nguồn: `Downloads/Thiết kế akaAgent (13)/Cài đặt chung - Hiển thị loại chiến dịch.dc.html`. Triển khai React trong Cài đặt chung, tab ngay sau Khách hàng từ chối nhận tin. Dùng tên tổ chức thật và catalog thật; màu nền/chữ theo theme của ứng dụng. Desktop tối đa 1320 × 860, sidebar 252px, nội dung cuộn; Web chuyển sidebar ngang và nội dung một cột trên màn hình nhỏ, chừa chỗ cho thanh điều hướng dưới.

Checkbox native có `indeterminate`, `aria-checked=mixed` và thao tác Space. Nhóm chọn một phần → chọn tất cả; chọn đủ → bỏ tất cả. Tìm tên không dấu/mã chỉ lọc hàng nhìn thấy, không đổi phạm vi thao tác nhóm. Hiện tất cả chỉ gửi catalog của màn hình hiện tại.

Queue tự lưu gom thao tác trong 300ms, tối đa một write đang chạy, giữ ý định mới nhất theo ID. Trong khi write đang chạy vẫn sửa tiếp checkbox được. Kết quả lỗi được nhập lại vào queue, giữ ý định mới hơn, dừng tự thử và hiện Thử lại. Chỉ ack backend mới cập nhật snapshot dùng để lọc; không cập nhật lạc quan danh sách. Đóng/đổi tab bị chặn khi đang lưu. Web giữ queue theo phiên đăng nhập qua điều hướng/unmount; view chỉ hủy lần đọc catalog. Khi quay lại vẫn thấy lựa chọn chưa lưu và Thử lại nếu lỗi. Đổi phiên mới hủy queue/debounce và vô hiệu hóa callback cũ; request ghi đã gửi có thể hoàn tất nhưng không cập nhật phiên mới. Desktop tiếp tục chặn đóng modal/chuyển tab khi đang lưu.

Desktop: IPC `settings:campaign-type-visibility:get/patch`, chỉ main frame; dùng current-user credentials, entitlement và Supabase HTTP client hiện có. Deadline 15s, kiểm tra phiên trước/sau RPC. Web: `GET/PATCH /api/aka-agent/control/v1/settings/campaign-type-visibility`, auth hiện có, GET có AbortSignal/deadline 15s, PATCH do DB kiểm tra quyền sống. Không thêm polling, pool hoặc connection.

Hai RPC phân trang nhận `p_filters.applyDisplaySettings` tùy chọn. Client Desktop/Web mới bật cờ; client cũ/native không truyền vẫn giữ kết quả cũ. Loại bị ẩn được lọc trong CTE trước phân trang, total và selection, kể cả explicit IDs. Anchor nháp client mới thêm `actionId`, lọc nháp và campaign cùng lượt đọc. Response trả `displaySettings` cùng trang; nhịp polling cũ nhận thay đổi máy khác, không tạo lượt đọc thêm vì revision của page thay đổi. Lưu tại máy hiện tại phát tín hiệu tải lại ngay. Revision thấp và phản hồi phiên cũ không ghi đè snapshot mới; thay đổi cấu hình xóa lựa chọn hàng loạt cũ.

Catalog nghiệp vụ vẫn đầy đủ cho runtime, báo cáo, liên kết và form sửa campaign đã tạo. Form thêm lọc bộ chọn nhưng luôn giữ loại đang chọn và dữ liệu đang soạn. Không chạm scheduler/quota, trạng thái chiến dịch hoặc lịch chạy; phần chi tiết đang ghim và nhãn tài khoản đang chạy giữ nguồn dữ liệu cũ.

## Migration và preflight

Canonical: [migration_v423_campaign_type_visibility.sql](../migrations/migration_v423_campaign_type_visibility.sql).

Đã đọc trực tiếp định nghĩa live từ project **akachat / cgjbsmqtfhqvttudyjzq**, không dùng project legacy. Snapshot đầy đủ định nghĩa/owner/ACL/security/volatility/search_path/timeout ở [source.json](../migrations/snapshots/campaign-type-visibility-v423/source.json). Reader Desktop giữ bản V328 đang live; reader Web giữ patch orphan V415. Không lấy định nghĩa từ migration cũ rồi thay thế toàn bộ.

| RPC/dependency | MD5 live trước sửa |
| --- | --- |
| `aka_agent_desktop_campaign_page` | `0a57f824f6be155b8dafd2c636f36823` |
| `aka_agent_control_campaign_page` | `e081e2adaa53652506e9628e851aa604` |
| `aka_agent_staff_time_allowed` | `a294e60011edd8d42e90ac2f74ce744c` |
| `auto_assert_automation_identity` | `5a9a503db72b965eb644739f5f60905d` |

Migration chặn nếu bốn checksum nguồn lệch hoặc object mới đã tồn tại. Chỉ hai hàm page được sửa; thêm năm hàm (ba private, hai public) và một bảng. Giữ nguyên owner, ACL, security mode, volatility và cấu hình của hai reader; không sửa hai dependency. Đối chiếu lại live trước bàn giao vẫn khớp cả bốn checksum và metadata nguồn. Schema private vốn đã có USAGE cho service_role, lệnh GRANT không mở thêm quyền trên production. [target.json](../migrations/snapshots/campaign-type-visibility-v423/target.json) chứa metadata/checksum đầu ra đo trên PostgreSQL local.

## Kiểm chứng

Toàn bộ dữ liệu kiểm thử là synthetic; catalog fixture gồm 27 loại thực tế. Không tạo/sửa campaign hoặc preference production.

- **SQL: 22 ca** trên PostgreSQL 16 local độc lập: default, tenant/credentials/active/admin, ACL/RLS, malformed/duplicate/unsupported IDs, Web giữ Facebook, concurrent disjoint/cùng mã, nháp/total/selection, pinned/running/orphan, catalog mới, client legacy bằng JSON trước–sau, metadata/dependency không đổi, transaction rollback và rollback từ chối patch mới hơn.
- **100.000 campaign local**: page Desktop 511ms, Web 252ms, catalog + counts 63ms (gồm overhead psql local); gate 2s đạt. Đây là workload local có index fixture, không phải SLA production. Form snapshot không chạy nhánh group count.
- **10 ca repository Desktop** qua serialization Supabase HTTP giả lập: identity/capability, count flag, patch, validation, lỗi không lộ SQL, thay phiên trước khi gửi và sau khi trả.
- **8 kịch bản Electron cài đặt/form**: kích thước thiết kế, 27 loại, keyboard/partial, tìm và chọn nhóm, ẩn/hiện tất cả, queue lỗi/thử lại, readonly, cửa sổ nhỏ và giữ loại/nội dung form đang mở sau khi ẩn.
- **4 kịch bản Electron danh sách**: 1.205 campaign/13 trang, total/menu action và account, selection cùng cờ, phản hồi page cũ bị chặn sau ack mới, tối đa một lượt sửa khi server tiếp tục trả revision cũ.
- **13 contract/session + 8 API + 11 API pagination + 10 component queue/UI** đạt. Hồi quy Web có 66 ca CampaignsPage, 16 SettingsPage, 109 CampaignFormPage (gồm hai ca form ẩn loại/giữ catalog sửa).
- **6 browser cases** (Desktop Chromium và Android Chromium): readonly, tự lưu/thử lại, Web-only reset, remote update qua đúng một lượt poll, lọc nháp/total, form không đếm lại. Kiểm tra màn hình nhỏ không tràn ngang, phần cuối cuộn được và không bị thanh điều hướng che.
- Hai typecheck Desktop; typecheck toàn monorepo Web/API/shared/mobile; production build Desktop và Web/API. Không build installer hay native mobile.

Ảnh kiểm tra giao diện và log local ở `dist/campaign-type-visibility-verification/` (thư mục artifact bị Git ignore, không phải bộ cài).

Lệnh tái lập Desktop:

```sh
node scripts/run-campaign-type-visibility-sql-smoke.cjs
node scripts/run-campaign-type-visibility-repository-smoke.cjs
node scripts/run-campaign-type-visibility-ui-smoke.cjs
node scripts/run-campaign-type-visibility-list-smoke.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

Lệnh Web:

```sh
npm run test -w @aka-agent/control-api -- campaignTypeVisibility.test.ts
npm run test -w @aka-agent/api -- campaignTypeVisibility.test.ts aka-agent-control.campaignList.test.ts
npm run test -w @aka-agent/web -- CampaignTypeVisibilitySettings.test.tsx CampaignFormPage.test.tsx CampaignsPage.test.tsx SettingsPage.test.tsx
npm run test:e2e -w @aka-agent/web -- campaign-type-visibility.spec.ts --project='Desktop Chromium' --project='Android Chromium'
npm run typecheck
npm run build
```

Một lượt chạy Web song song với build có ca chọn 1.001 hàng vượt timeout test 15s; chạy lại riêng đạt 8,8s với cùng giới hạn, không sửa timeout hay logic để bỏ qua.

Giới hạn kiểm chứng: browser/Electron dùng API/IPC fixtures; database kiểm chứng riêng trên local, chưa nối client thật vào migration production. Script legacy `run-desktop-ui-reads-smoke.cjs` đi qua paging/selection/query/error/session regressions rồi dừng tại selector `Lịch sử gần đây` đã đổi thành `Lịch sử chạy` từ luồng log V408; không coi toàn script này là pass, không thay runtime lịch sử để phục vụ fixture cũ. Các smoke mới ở trên kiểm chứng trực tiếp phần danh sách liên quan tính năng này.

## Rollout và rollback

1. Reread live definitions/checksum và ACL trước apply; nếu lệch phải rebuild candidate trên live mới. Apply riêng canonical V423 trong transaction, không bulk-push lịch sử migration.
2. Sau xác nhận DB, triển khai API, rồi Web/Desktop. Native/client cũ tiếp tục không truyền `applyDisplaySettings`. Desktop dev cần restart main/preload.
3. Kiểm tra admin và nhân viên cùng tổ chức, hai tổ chức khác nhau, Desktop ↔ Web, đổi preference và tổng/nháp/chọn nhiều. Theo dõi thời gian read bằng nhịp/log sẵn có; không thêm poll.
4. Rollback ưu tiên hạ client/API trước DB. Nếu cần bỏ V423, export preference trước vì rollback xóa bảng cấu hình mới. Dùng [rollback.sql](../migrations/snapshots/campaign-type-visibility-v423/rollback.sql), có guard checksum cả hai reader và năm hàm mới; khi có patch mới hơn phải dừng và đối chiếu live. Rollback giữ campaign/runtime/data và khôi phục chính xác hai định nghĩa live đã chụp.

Giai đoạn triển khai/kiểm thử ban đầu chưa thay production. Bước apply database riêng được ghi bên dưới; deploy/phát hành vẫn là bước riêng.

## Sửa ba finding review — 23/10/2026

1. **RPC Web:** ACL mặc định live trong schema public cấp EXECUTE trực tiếp cho anon/authenticated/service_role; chỉ REVOKE PUBLIC không đủ. Candidate nay thu hồi đủ PUBLIC/anon/authenticated/service_role rồi chỉ cấp lại service_role; guard kiểm tra effective privilege của hai role công khai ngay trong migration. Fixture local tái hiện cả default ACL của functions và tables; thử đọc/ghi giả danh admin của hai tổ chức bằng anon/authenticated đều bị chặn trước nghiệp vụ, service_role và Desktop vẫn hoạt động. Không đổi body của RPC hay checksum định nghĩa; ACL cần kiểm tra riêng.
2. **Tự lưu khi điều hướng Web:** queue thuộc phiên đăng nhập, tiếp tục debounce và flush tuần tự dù trang cài đặt unmount. Ack cập nhật snapshot và báo danh sách reload ngay; lỗi giữ ý định chưa lưu để quay lại Thử lại. Logout/đổi phiên dispose queue, hủy debounce/follow-up và bỏ ack cũ. Không thêm polling/connection; Desktop giữ cơ chế modal chặn đóng/chuyển tab hiện có.
3. **Nền tảng form Web:** nền tảng mặc định và fallback lấy từ catalog đang hiển thị. Ẩn hết Zalo thì chọn SMS còn hiện ngay; loại đã chọn trong form đang mở và catalog form sửa vẫn được giữ.

Đã đọc lại đúng project akachat / cgjbsmqtfhqvttudyjzq: cả bốn định nghĩa live, checksum, owner, ACL, volatility, security và config vẫn khớp source.json. Default ACL đọc lại lưu tại [review-default-acl.json](../migrations/snapshots/campaign-type-visibility-v423/review-default-acl.json). Reader Desktop V328 và patch orphan Web V415 được giữ nguyên. Không apply production.

| Chữ ký chính xác | Source MD5 | Target MD5 |
| --- | --- | --- |
| `aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])` | `e081e2adaa53652506e9628e851aa604` | `12d454fbc38217dea3497addd39ed832` |
| `aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])` | `0a57f824f6be155b8dafd2c636f36823` | `3a16a880e5906c7d4a55b19f8b4c13c7` |
| `aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean)` | Chưa tồn tại live | `38cef8f7febb9b4e2147a0b9b99c2898` |

Kiểm chứng bổ sung: 22 ca SQL (gồm ACL production, tenant/role, concurrent patches, rollback và legacy JSON); 100k local đo Desktop 372ms/Web 180ms/catalog counts 50ms. Web có 14 component UI/queue, 4 session queue, 111 form, 16 SettingsPage và 10 browser cases Desktop/Android. Browser tái hiện thao tác tích rồi điều hướng trước debounce, xác nhận PATCH và trang danh sách cập nhật; tự chọn SMS khi Zalo bị ẩn. Unit kiểm tra pending/in-flight khi đổi route, lỗi và Retry sau remount, thu hồi admin cùng revision, đổi phiên trước/sau request. 66 ca CampaignsPage cũng đạt: tổng 211 ca unit/component Web liên quan. Typecheck cả bảy workspace và production build Web/API đạt; `git diff --check` hai repo sạch. Lượt sửa này không đổi mã ứng dụng Desktop nên giữ kết quả hai typecheck/build/Electron của lượt triển khai trước; SQL local tiếp tục kiểm tra reader/quyền Desktop. Chưa apply migration, deploy hoặc đóng gói.

## Apply production — 23/10/2026

Người dùng yêu cầu giữ nguyên finding queue Web và apply migration. Đã apply riêng canonical V423 lên **akachat / cgjbsmqtfhqvttudyjzq**, migration **`20261023090604 / migration_v423_campaign_type_visibility`**, lúc **16:06:04 VN**. Không bulk-push và không apply lại khi deploy clients.

Trước apply đã đọc lại đầy đủ đúng bốn chữ ký live, định nghĩa và metadata, khớp chính xác nguồn đã kiểm chứng. Snapshot [production-source.json](../migrations/snapshots/campaign-type-visibility-v423/production-source.json) và [production-preflight.json](../migrations/snapshots/campaign-type-visibility-v423/production-preflight.json) giữ định nghĩa, default ACL và checksum runtime trước thao tác. Giữ nguyên patch Desktop V328, Web orphan V415, hai helper danh tính/khung truy cập và năm chữ ký runtime/progress/config-version được đối chiếu. Bảng mới là RLS/RPC-only; Web wrapper chỉ service_role, Desktop wrapper vẫn xác minh credentials theo cơ chế hiện có.

Kiểm chứng apply:

- Chạy lại **22 ca SQL local**, gồm concurrent disjoint/cùng mã, quyền với default ACL production, client cũ và guarded rollback. Workload 100k local: Desktop 374ms, Web 179ms, catalog/counts 47ms.
- Trên PostgreSQL production 17.6: thử candidate cùng **18 kiểm tra trong transaction kết thúc ROLLBACK**; bảng mới biến mất và bốn checksum nguồn được khôi phục. Cả bảy target có checksum/owner/ACL/security/volatility/config đúng kỳ vọng trước commit thật.
- Sau apply: **18 kiểm tra transaction rollback** đạt lần nữa; đọc/ghi qua RPC, admin/viewer/tenant, thiếu credentials, mã không hợp lệ, Web không sửa Facebook, số CD đối chiếu dữ liệu hiện có, snapshot/revision, lọc nháp/tổng/chọn nhiều và JSON legacy đều đạt. Các thay đổi preference thử đều rollback; bảng còn **0 hàng**, mặc định hiện tất cả. Không tạo hay cập nhật campaign/account/runtime để kiểm thử.
- Đọc lại đủ **14 chữ ký**: bảy target khớp; hai helper danh tính và năm runtime/progress/config-version giữ nguyên checksum cùng metadata. Xem [production-target.json](../migrations/snapshots/campaign-type-visibility-v423/production-target.json), chứa chữ ký chính xác và định nghĩa sau apply; source/target MD5 của hai reader và Web wrapper ở bảng review bên trên.
- Security advisor không thêm ERROR. Ba finding mới là các quyền có chủ đích: bảng RPC-only có [RLS không policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), Desktop wrapper SECURITY DEFINER cho [anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) và [authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Wrapper kiểm tra danh tính, tenant, trạng thái nhân viên và admin; kiểm thử thiếu credentials/viewer/cross-tenant bị từ chối. Web wrapper không có hai quyền công khai này. Diff advisor lưu trong [production-advisors.json](../migrations/snapshots/campaign-type-visibility-v423/production-advisors.json).

Biên bản máy đọc được: [production-results.json](../migrations/snapshots/campaign-type-visibility-v423/production-results.json). [production-smoke.sql](../migrations/snapshots/campaign-type-visibility-v423/production-smoke.sql) là script tự chứa BEGIN/ROLLBACK và kiểm tra metadata; chỉ dành cho lúc bảng preference còn rỗng, tự chặn trước khi ghi nếu đã có cấu hình thật. Rollback schema dùng file guarded rollback hiện có, chưa rollback production.

**Finding được chấp nhận:** Web giữ queue theo phiên; nếu loại đang chờ lưu bị gỡ khỏi catalog/quyền gói, entry không hợp lệ có thể chặn các thay đổi hợp lệ đi cùng. Đóng/mở form không xóa queue; reload Web hoặc đăng xuất/đăng nhập sẽ bỏ lựa chọn chưa lưu và cần chọn lại. Người dùng yêu cầu bỏ qua, không sửa finding này.

Bước database đã hoàn tất. Chưa deploy phần tính năng này lên API/Web, chưa đóng gói/phát hành Desktop; tiếp tục rollout API → Web/Desktop theo kế hoạch khi được yêu cầu.

## Kiểm tra trước PR — 23/10/2026

Bản PR Desktop được dựng trên `origin/dev_3` tại `7e3b8ca1`, chỉ gồm Hiển thị loại chiến dịch; không gồm thay đổi picker thống kê tài khoản, phiên bản hay đóng gói đang làm riêng. Hai typecheck và production build đạt; 10 ca repository, 8 kịch bản Electron cài đặt/form và 4 kịch bản danh sách đạt. Badge “Mới” đã bỏ trên Desktop/Web theo yêu cầu. Migration V423 đã apply, không chạy lại khi merge PR.

## Deploy Web/API — 23/10/2026

Web/API đã deploy lên [agent.akabiz.net](https://agent.akabiz.net) lúc 16:25 VN từ `93eeec9`. Chỉ đổi image trên machine Fly hiện có 1 shared CPU/512 MB, health 1/1. Typecheck bảy workspace, build, 2.600 unit test, 15 browser local và 15 browser trên asset production (API/WS giả lập), 21 HTTP và bảy checksum runtime đạt. Đọc lại 14 checksum DB sau deploy vẫn khớp; không apply lại V423. Badge “Mới” đã bỏ và finding queue giữ nguyên theo yêu cầu. Desktop chưa đóng gói/phát hành. Biên bản và rollback nằm ở repo Web: `docs/CAMPAIGN_TYPE_VISIBILITY_DEPLOY_20261023.md`.

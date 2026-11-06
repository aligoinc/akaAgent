# Web quản lý tài khoản và chiến dịch Desktop (V461)

Web/PWA hiển thị và quản lý tài khoản Zalo **mã QR** và **trình duyệt** do app Desktop chạy,
cùng chiến dịch, tiến trình và trạng thái app Desktop. App Desktop vẫn là nơi chạy duy nhất;
Web chỉ đọc/ghi dữ liệu trong DB. Mọi dòng thuộc loại này mang nhãn **Desktop**; Zalo Server và
SMS mang nhãn **Web**.

## Trạng thái — ĐÃ APPLY akachat 04/11/2026 23:33:21 VN

- `20261104163321 / migration_v461_web_desktop_accounts` (apply_migration qua Supabase MCP, người dùng
  bấm xác nhận). **Không apply lại.** Số đã đổi nhiều lần vì bị dùng trước: v453
  (`remove_aka_agent_access_from_ip_hook_v453`), v454 (`migration_v454_app_access_guard_performance`), rồi
  v455–v460 trên dev_3; các migration đó không sửa 10 hàm của bản này (v457 chỉ đọc
  `auto_staff_device_presence`). Bốn lần thử trước (03/11 17:30, 22:02; 04/11 00:10, 20:56) dừng ở thẻ
  xác nhận MCP không được bấm, production không đổi.
- Trước apply (22:26–23:30 VN, tải 0,8 tiến trình dùng CPU/8 vCPU): 10 hàm nguồn khớp md5; script so sánh
  chỉ đọc trên dữ liệu thật đạt 10/10 `patch_dry_run`, 9/9 `*_legacy_same` (3 nhân viên nhiều chiến dịch
  Zalo Server/SMS nhất: trang 2,1–4,6 ms cũ ↔ 2,2–3,8 ms mới, snapshot 5,2–12,4 ↔ 5,0–12,1 ms; logs cũ
  4,5–66 ms do cache lạnh lượt đầu ↔ mới 0,8–1,6 ms), không `already_applied`. Đường Desktop (chưa ai
  gọi): trang 4,6–8,6 ms, activity 1,3–3,4 ms, snapshot 12,9–101,6 ms (101,6 ms là nhân viên 48 tài khoản).
- Hậu kiểm 23:33–23:40 VN: 10 hàm ở md5 đích; md5 4 hàm mới trùng bản áp local từ file repo
  (`214999ca…`, `ea05f7ca…`, `b1385c38…`, `0bc017aa…`); 3 hàm Control mới chỉ `service_role` (+ owner),
  helper private chỉ owner; quyền 10 hàm cũ giữ nguyên (presence vẫn `aka_agent_desktop` + `service_role`);
  cột `runtime_state`/`runtime_state_at` + CHECK có; `web.desktop_accounts` = `enabled:false`; smoke
  production (BEGIN/ROLLBACK, `service_role`) đạt; 63 heartbeat trong 60 giây sau apply, 66 máy online
  (85 lúc 22:26, giảm theo giờ khuya). PostgREST nạp lại schema 3,0 s, 0 lỗi 503/5xx; phút apply p99
  283 ms rồi về ~105 ms.
- Chính sách bật cho tổ chức 1 lúc 11:09:43 VN, rồi **cho mọi tổ chức** lúc 11:27:53 VN ngày 06/11/2026 (xem mục canary bên dưới). **API/Web đã deploy** (người dùng tự deploy từ akaAgentWebApp `dev`, bản mới chạy khoảng 12:15–12:22 VN 06/11; hậu kiểm ở mục canary). **Chưa** phát hành Desktop/mobile.
- Đường dự phòng khi không bấm được thẻ MCP: `migrations/tests/migration_v461_web_desktop_accounts_guarded_apply.sql`
  (xem Rollout). Không dùng cho v461 nữa vì đã apply (script tự từ chối khi chạy lại).

## V464 — app iOS cho tổ chức chỉ có gói Desktop — ĐÃ APPLY akachat 05/11/2026 17:54:39 VN

- `20261105105439 / migration_v464_native_desktop_only_login` (apply_migration qua Supabase MCP, người dùng
  bấm xác nhận). **Không apply lại** (file tự bỏ qua khi hàm đã ở md5 đích).
- Đổi số từ v462 vì V462/V463 thuộc báo cáo hiệu quả chiến dịch (dev_3, PR #598). Hai migration đó được
  một phiên khác apply trước lúc 17:43:19 / 17:44:27 VN cùng ngày; không đụng hàm này, md5 nguồn vẫn đúng.
  Client iOS: akaAgentWebApp PR #151.
- Trước apply (17:51 VN): tải bình thường (edge 15 phút p50 50–57 ms, p99 186–492 ms, 0 lỗi 503; 1,6 tiến
  trình dùng CPU/8 vCPU); hàm ở md5 nguồn `de8f93ee…`; owner `postgres`, SECURITY DEFINER,
  `search_path=public`, ACL `{postgres=X/postgres,service_role=X/postgres}`; chính sách tắt; chưa có v464 trên
  production lẫn dev_3.
- Hậu kiểm (17:54–17:56 VN): md5 đích `2c10aa78ac5e4ab8069c741b356e88c8`, có cổng `'native'`; owner/SECURITY
  DEFINER/search_path/ACL giữ nguyên; chính sách vẫn `{"enabled":false,"organizationIds":null,"desktopOnlyLogin":false}`.
  Gọi thử với token không tồn tại trả `invalid_session` (không ghi gì). PostgREST nạp lại schema
  10:54:39 → 10:54:51 UTC (truy vấn schema 10,5 giây); phút đó p99 1,6 giây, 0 lỗi 5xx/503; RPC xác thực 0 lỗi.
- Chính sách vẫn tắt nên khách chưa thấy gì thay đổi. Bật `desktopOnlyLogin` chỉ sau khi API của
  akaAgentWebApp PR #151 đã deploy (API đó trả 401 cũ cho bản iOS không gửi header Desktop).

- `migrations/migration_v464_native_desktop_only_login.sql`: chỉ sửa cổng trong
  `aka_agent_authenticate_control_session(text)`, thêm `'native'` vào `client_type IN ('web', 'pwa')`
  của nhánh tổ chức chỉ có gói Zalo Desktop, kèm một dòng chú thích. Nguồn md5
  `de8f93ee545bca94a199b2dffb9fe324` (bản đích V461, đã kiểm trên production 05/11/2026 13:38 VN) →
  đích `2c10aa78ac5e4ab8069c741b356e88c8`. Không đổi bảng, dữ liệu, ACL, owner, SECURITY DEFINER, search_path.
- Chính sách đang tắt nên apply không đổi hành vi: phiên iOS vẫn bị từ chối (và thu hồi) cho tới khi bật
  `desktopOnlyLogin`. **Trước khi bật** phải deploy API chặn phiên iOS không gửi header
  `x-aka-desktop-accounts` (bản iOS cũ), nếu không bản cũ sẽ vào một app trống.
- Là `CREATE OR REPLACE FUNCTION` nên PostgREST nạp lại schema: apply ngoài giờ cao điểm.
- Rollback: `migrations/rollback_v464_native_desktop_only_login.sql` (guard md5, về đúng bản V461).
- Test local `scripts/test-native-desktop-only-login-sql.sh` (fixtures V461 → V461 → v464): md5 đích, quyền
  giữ nguyên; chính sách tắt thì native vẫn bị chặn và thu hồi; Web/PWA và tổ chức có Server không đổi; bật
  `desktopOnlyLogin` thì native qua; áp lại bỏ qua; rollback về V461; hàm nguồn lệch thì từ chối, không đổi gì.

## Bật/tắt

`auto_system_settings` key `web.desktop_accounts` (seed bởi migration):

```json
{"enabled": false, "organizationIds": null, "desktopOnlyLogin": false}
```

- `enabled`: bật cho tổ chức có quyền tài khoản QR (`zalo_account_capabilities.qr`) hoặc trình
  duyệt (`.web`). Hàm đọc kiểm tra kiểu bằng `pg_input_is_valid`, sai định dạng thì coi là tắt.
- `organizationIds`: `null` = mọi tổ chức; mảng ID = chỉ các tổ chức đó (canary).
- `desktopOnlyLogin`: cho tổ chức chỉ có Desktop (không Zalo Server/SMS) đăng nhập Web/PWA để
  quản lý Desktop. Native app không đổi.
- Tắt khẩn cấp: đặt `enabled=false`. Không phải DDL nên không nạp lại schema PostgREST.

Web mới gửi header `x-aka-desktop-accounts: 1`. Client không gửi header (Web cũ, app iOS) nhận
đúng phạm vi Zalo Server/SMS như trước. Client Web chỉ nhận dòng Desktop khi `/me` của phiên
xác nhận quyền đúng loại (QR/trình duyệt); chưa có `/me` hoặc chính sách tắt giữa phiên thì
lọc bỏ (fail closed).

## Hợp đồng DB

- `p_platforms` nhận token: `'zalo'` (giữ nghĩa Zalo Server), `'sms'`, `'zalo_qr'`, `'zalo_web'`.
  Lời gọi cũ chỉ gửi `zalo`/`sms` cho kết quả giống hệt trước.
- Vá có kiểm md5 nguồn → đích: snapshot tài khoản (thêm `desktopPresence`), trang chiến dịch
  (`runtime_target`, bộ lọc `runtimeTargets`, `isZaloShowWeb`, `runtimeBusy`), log chiến dịch,
  tạo/sửa/xoá chiến dịch, thêm data, đổi trạng thái data, presence và xác thực phiên.
- Sửa chiến dịch không được đổi lớp chạy (Desktop ↔ Server) khi đổi tài khoản.
- Xoá chiến dịch Desktop bị từ chối khi còn claim/unit lease (`campaign_running`): lease mồ côi
  của chiến dịch đã xoá vẫn đóng cổng bảo trì sau 00:00 (xem CLAUDE.md, mục quét staff bị treo).
- RPC mới (chỉ `service_role`):
  - `aka_agent_control_set_desktop_campaign_status`: tạm dừng ghi `tạm dừng` ngay, không đụng
    lease; `pause_pending=true` khi lượt chạy còn sống. Scheduler Desktop kiểm trạng thái trước
    mỗi mục tiêu nên dừng sau mục tiêu đang xử lý. Tiếp tục chỉ từ `tạm dừng` và khi không còn
    claim/unit lease (`runtime_busy`). Mỗi thao tác ghi một dòng lịch sử chạy.
  - `aka_agent_control_desktop_activity`: tối đa 50 chiến dịch Desktop đang/vừa chạy (30 phút),
    đọc theo con trỏ `id`, lookback 10 giây cho commit muộn, ≤ 200 dòng/lượt.
  - `aka_agent_control_web_desktop_accounts_policy` (+ helper private).
- `auto_staff_device_presence.runtime_state/runtime_state_at`: ảnh chụp bộ chạy từ heartbeat,
  CHECK ≤ 32 KB; RPC presence chỉ lưu khi là object và phiên chưa kết thúc.

## API/Web (akaAgentWebApp)

- Tài khoản: danh sách, bộ lọc **Nơi chạy**, nhãn Desktop/Web, trạng thái app Desktop và lý do
  chưa sẵn sàng. Sửa tên/nhóm/proxy, bật/tắt, xoá; tắt/xoá bị từ chối khi còn lease. Đăng nhập
  QR, kiểm tra/đăng xuất phiên và tạm dừng/tiếp tục **tài khoản** Desktop chỉ trên app Desktop.
- Chiến dịch: danh sách/bộ lọc/nhãn, thêm/sửa/nhân bản/xoá, tạm dừng/tiếp tục (lô 10), thêm
  data, báo cáo. Chẩn đoán và "Tại sao CD không chạy?" chỉ cho Zalo Server; chiến dịch Desktop
  hiện gợi ý từ trạng thái app (app tắt, tab trình duyệt chưa mở, đang dừng sau mục tiêu).
- Tiến trình: gộp lịch sử chạy Desktop vào panel, nhãn DESKTOP/WEB. Thêm **một request mỗi chu
  kỳ** (`web.campaigns.poll_interval_seconds`, mặc định 30 giây) chỉ khi tab Tiến trình đang mở,
  trang đang hiển thị và lượt trước đã xong; không chạy khi chính sách tắt.
- Trạng thái app Desktop đi kèm snapshot tài khoản sẵn có (không thêm request).
- Form: chọn được tài khoản Desktop; tải group/tag và lấy data từ Zalo cho tài khoản Desktop
  thực hiện trên app Desktop, Web dùng danh sách app đã lưu (Load).

## Desktop

- Heartbeat presence 30 giây có sẵn gửi thêm `p_device.runtime`
  ([desktopRuntimeSnapshot.ts](../src/main/services/desktopRuntimeSnapshot.ts)):
  `{v, scheduler:{state, since}, accounts:[{id, ready, reason, runningCampaignId, progress}]}`.
  `state`: `running`/`idle`/`stopped`/`blocked_daily_maintenance` (đánh dấu trong
  `onWaiting` của cổng bảo trì, [handlers.ts](../src/main/ipc/handlers.ts)); `reason`:
  `inactive`/`paused`/`not_logged_in`/`browser_tab_closed`. Chỉ đọc RAM của scheduler
  (`getRuntimeSnapshotSource`), không thêm truy vấn/timer/kết nối; tối đa 200 tài khoản
  (~20 KB). Server trước V461 bỏ qua khoá này.
- Web hiển thị hướng dẫn **Đăng xuất rồi Đăng nhập lại** khi app chờ bảo trì quá 10 phút
  (đúng cách gỡ đã kiểm chứng; tắt/mở app hoặc resume không đủ).
- Renderer đọc lại danh sách tài khoản một lần khi cửa sổ được focus và lần đọc trước cũ hơn chu
  kỳ tài khoản ([useDesktopUiPolling.ts](../src/renderer/src/hooks/useDesktopUiPolling.ts)),
  để thấy thay đổi từ Web; không polling nền mới. Scheduler vẫn đọc DB mỗi tick nên thay đổi từ
  Web có hiệu lực ngay với việc chạy.

## Kiểm chứng

- SQL local PostgreSQL 16 (`scripts/test-web-desktop-accounts-sql.sh`, fixtures
  `scripts/fixtures/web-desktop-accounts-v461/`): apply → assertions → apply lại → rollback →
  rollback assertions → apply lại đều đạt. Smoke chỉ đọc production:
  `migrations/tests/migration_v461_web_desktop_accounts_smoke.sql` (BEGIN/ROLLBACK).
- Desktop: `tsc` node + web sạch; `node scripts/desktop-runtime-snapshot-smoke.cjs` 8/8.
- Web/API: typecheck 7 workspace; test xem báo cáo cuối phiên. Chưa chạy trên Desktop/Windows
  thật, chưa có trình duyệt thật.

- Áp bằng Supabase SQL Editor khi không bấm được thẻ xác nhận MCP:
  `migrations/tests/migration_v461_web_desktop_accounts_guarded_apply.sql` (sinh bởi
  `scripts/build-v461-guarded-apply-sql.py`). Một giao dịch: so sánh chỉ đọc → chốt chặn (kiểm nào
  không đạt thì `v461_guard_failed`/`v461_unexpected_definition`, rollback toàn bộ) → thân migration →
  ghi `supabase_migrations.schema_migrations`. Test local
  `scripts/test-web-desktop-accounts-guarded-apply.sh`: chạy một thông điệp như SQL Editor, trạng thái
  cuối giống hệt áp file migration thường (fingerprint hàm/cột/constraint/cấu hình), chạy lại bị chặn,
  hàm nguồn lệch thì dừng mà không đổi gì.

## Canary tổ chức 1 (akaBiz) — 06/11/2026 11:09:43 VN

- `auto_system_settings` id 93: `{"enabled":false,"organizationIds":null,"desktopOnlyLogin":false}` →
  `{"enabled":true,"organizationIds":[1],"desktopOnlyLogin":false}` (UPDATE có guard giá trị cũ, một dòng, không
  DDL nên PostgREST không nạp lại schema). `organizationIds` phải là số (`[1]`); chuỗi `["1"]` không khớp.
- Hậu kiểm: `aka_agent_control_web_desktop_accounts_policy` trả `enabled:true` cho tổ chức 1, `enabled:false` cho
  2/26/358/990/0/NULL; `desktopOnlyLogin` false ở mọi tổ chức. Một dòng khoá, `is_secret` false, ACL hàm giữ
  `{postgres=X/postgres,service_role=X/postgres}`. `aka_agent_authenticate_control_session` chỉ đọc chính sách cho
  `desktopOnlyLogin` (vẫn md5 `2c10aa78…`), tổ chức 1 có gói Server/SMS nên đăng nhập không đổi. Edge 04:00–04:10
  UTC: 0 lỗi 5xx, RPC xác thực 0 lỗi; không lỗi Postgres nào liên quan.
- Tổ chức 1 có 28 tài khoản Zalo không phải Server, gói QR + trình duyệt. Người dùng **chưa thấy gì** cho tới khi
  deploy API/Web từ akaAgentWebApp `dev` (PR #151 đã merge, `a9501e5`): API đang chạy là bản cũ, không đọc chính
  sách (0 lượt gọi RPC chính sách trong edge log).
- Tắt: đặt lại `{"enabled":false,"organizationIds":null,"desktopOnlyLogin":false}`, không cần deploy.
- **Mở cho mọi tổ chức lúc 11:27:53 VN** theo yêu cầu người dùng (bỏ bước canary):
  `{"enabled":true,"organizationIds":[1],...}` → `{"enabled":true,"organizationIds":null,"desktopOnlyLogin":false}`
  (UPDATE có guard giá trị cũ). Hậu kiểm: hàm chính sách trả `enabled:true` cho 1/2/26/358/990, `false` cho 0/NULL,
  `desktopOnlyLogin` false; hàm xác thực vẫn md5 `2c10aa78…`. Sau khi deploy API/Web, 437 tổ chức có tài khoản Zalo
  không phải Server (1.365 tài khoản) sẽ thấy dòng Desktop nếu gói có quyền QR/trình duyệt.
- `desktopOnlyLogin` vẫn tắt: tổ chức chỉ có gói Desktop chưa đăng nhập được Web/iOS. Chỉ bật sau khi API mới đã
  chạy (API cũ không có phạm vi Desktop nên tổ chức đó sẽ vào một app trống).
- **Hậu kiểm production sau deploy API/Web (06/11/2026, 12:15–13:43 VN)**:
  - Web: bundle `index-DkxFdYif.js` giống từng byte bản build local từ `dev` `a9501e5` (sha256 `4e0325b9…`), có header
    `x-aka-desktop-accounts`; `/healthz` 200; route control không đăng nhập trả 401.
  - API: `aka_agent_control_desktop_activity` lần đầu được gọi lúc 12:22:05 VN (trước đó chưa bao giờ), 256 lượt tới
    13:42. Từ IP API WebApp `167.88.158.106`: xác thực 6.649, snapshot tài khoản 2.260, trang chiến dịch 1.605,
    tiến trình Desktop 252, chính sách 6 — 100% HTTP 200, p50 15–22 ms, p95 ≤ 235 ms, 0 lỗi.
  - Hai cụm 5xx cùng khoảng thời gian **không do Web/API**: 12:14–12:17 VN (~110, hết thời gian chờ 3 s/8 s khi
    gateway chat cập nhật cùng dòng `contacts` trùng cron 12:15 `zalo-customer-phone-capture-v1` +
    `aka-order-org-status-reconcile` 17 s); 13:36 VN (~27, backend CRM ghi `org_organization_product` giữ khoá
    `aka-agent-zalo-runtime-entitlement-mutation` ~8 s nên claim chiến dịch Desktop hết 3 s).

## Rollout

1. Ngoài giờ cao điểm (DDL nạp lại schema PostgREST): kiểm số migration + md5, apply v461,
   chạy smoke chỉ đọc.
2. Deploy API rồi Web (API mới chạy được với Web cũ; Web mới cần API mới).
3. Bật chính sách cho tổ chức canary qua `organizationIds`, rồi mở rộng.
4. Phát hành Desktop có ảnh chụp runtime (không bắt buộc: thiếu thì Web chỉ hiện online/offline).

## Rollback

- Nhanh: `enabled=false`.
- Đầy đủ: `migrations/snapshots/web-desktop-accounts-v461/rollback.sql` (có guard md5) khôi phục
  10 định nghĩa từ `baseline.sql`, xoá 4 hàm mới, constraint/cột runtime và dòng cấu hình.
  Không mở lại quyền legacy nào.

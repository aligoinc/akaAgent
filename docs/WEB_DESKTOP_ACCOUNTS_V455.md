# Web quản lý tài khoản và chiến dịch Desktop (V455)

Web/PWA hiển thị và quản lý tài khoản Zalo **mã QR** và **trình duyệt** do app Desktop chạy,
cùng chiến dịch, tiến trình và trạng thái app Desktop. App Desktop vẫn là nơi chạy duy nhất;
Web chỉ đọc/ghi dữ liệu trong DB. Mọi dòng thuộc loại này mang nhãn **Desktop**; Zalo Server và
SMS mang nhãn **Web**.

## Trạng thái (03/11/2026)

- `migrations/migration_v455_web_desktop_accounts.sql` là **candidate, chưa apply production**.
  Bản nháp ban đầu đặt số v453, nhưng production đã có `20261103051602 /
  remove_aka_agent_access_from_ip_hook_v453` (và `20261103045414 / chat_runtime_identity_v452`)
  nên đổi thành v454; 16:28 VN cùng ngày production có thêm `20261103092858 /
  migration_v454_app_access_guard_performance` (không đụng 10 hàm của bản này) nên đổi tiếp thành
  v455. Kiểm tra lại số và md5 ngay trước khi apply.
- Kiểm tra drift chỉ đọc lúc viết: cả 10 hàm nguồn trên akachat khớp md5 nguồn trong spec của
  migration; 3 hàm mới và cột `runtime_state` chưa tồn tại. `create_control_campaign_v2` (API
  đang gọi) chỉ gọi lại `create_control_campaign` nên không cần vá riêng.
- API/Web (akaAgentWebApp) chưa deploy; Desktop chưa đóng gói/phát hành.
- Chính sách mặc định **tắt**: apply migration không đổi hành vi nào cho tới khi bật.

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
  (~20 KB). Server trước V455 bỏ qua khoá này.
- Web hiển thị hướng dẫn **Đăng xuất rồi Đăng nhập lại** khi app chờ bảo trì quá 10 phút
  (đúng cách gỡ đã kiểm chứng; tắt/mở app hoặc resume không đủ).
- Renderer đọc lại danh sách tài khoản một lần khi cửa sổ được focus và lần đọc trước cũ hơn chu
  kỳ tài khoản ([useDesktopUiPolling.ts](../src/renderer/src/hooks/useDesktopUiPolling.ts)),
  để thấy thay đổi từ Web; không polling nền mới. Scheduler vẫn đọc DB mỗi tick nên thay đổi từ
  Web có hiệu lực ngay với việc chạy.

## Kiểm chứng

- SQL local PostgreSQL 16 (`scripts/test-web-desktop-accounts-sql.sh`, fixtures
  `scripts/fixtures/web-desktop-accounts-v455/`): apply → assertions → apply lại → rollback →
  rollback assertions → apply lại đều đạt. Smoke chỉ đọc production:
  `migrations/tests/migration_v455_web_desktop_accounts_smoke.sql` (BEGIN/ROLLBACK).
- Desktop: `tsc` node + web sạch; `node scripts/desktop-runtime-snapshot-smoke.cjs` 8/8.
- Web/API: typecheck 7 workspace; test xem báo cáo cuối phiên. Chưa chạy trên Desktop/Windows
  thật, chưa có trình duyệt thật.

## Rollout

1. Ngoài giờ cao điểm (DDL nạp lại schema PostgREST): kiểm số migration + md5, apply v455,
   chạy smoke chỉ đọc.
2. Deploy API rồi Web (API mới chạy được với Web cũ; Web mới cần API mới).
3. Bật chính sách cho tổ chức canary qua `organizationIds`, rồi mở rộng.
4. Phát hành Desktop có ảnh chụp runtime (không bắt buộc: thiếu thì Web chỉ hiện online/offline).

## Rollback

- Nhanh: `enabled=false`.
- Đầy đủ: `migrations/snapshots/web-desktop-accounts-v455/rollback.sql` (có guard md5) khôi phục
  10 định nghĩa từ `baseline.sql`, xoá 4 hàm mới, constraint/cột runtime và dòng cấu hình.
  Không mở lại quyền legacy nào.

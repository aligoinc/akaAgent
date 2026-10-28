# RPC và migration

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 298–323. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
## Bắt buộc dùng skill cho RPC migration

Web/PWA fingerprint recovery v335 đã apply `20261002043251 / web_device_fingerprint_v335`; v336 grouping đã apply `20261002051556 / web_device_fingerprint_groups_v336`, WebApp deployed 02/10/2026. Không apply lại v331/v332/v335/v336. Separate cookie identity from admission group: exact live same-staff/tenant fingerprints share one slot, including existing duplicates, without rotating sibling tokens. Group-aware v2/v1, overview, soft release and explicit logout/hard revoke are live; only known-cookie login rotation and denied entry stay cookie-scoped. Missing collection retains that cookie identity’s fingerprint; quota/revision/policy→staff locks remain mandatory. No auto-release at login, native/background changes or connection increase. See [v335 audit](../../../docs/WEB_DEVICE_FINGERPRINT_V335.md) and [v336 production audit](../../../docs/WEB_DEVICE_FINGERPRINT_GROUPS_V336.md).

Web/PWA device limit v331 đã apply `20260929063252 / web_device_limits_v331` và deploy WebApp ngày 29/09/2026; không apply lại. Canonical [SQL](../../../migrations/migration_v331_web_device_limits.sql) adds atomic per-staff admission on entry/login only, revisioned default 3 and grouped revoke, preserving live auth/expiry RPCs and native/Desktop behavior. Existing singleton only, no connection increase/polling; see [audit](../../../docs/WEB_DEVICE_LIMITS_V331.md).

Web/PWA **Đổi thiết bị** v332 đã apply `20260929073354 / web_device_release_v332` và deploy cùng ngày; không apply lại. [RPC release](../../../migrations/migration_v332_web_device_release.sql) chỉ xóa admission của nhóm Web/PWA, giữ phiên/cookie/định danh và cho phép máy hiện tại. Trang đang mở tiếp tục dùng; mở/F5 mới nhận lại chỗ, hết chỗ mới dùng cơ chế từ chối/thu hồi v331. Giữ nguyên hard logout/password/native và khóa staff chung với claim/revoke. Xem [audit/deploy](../../../docs/WEB_DEVICE_RELEASE_V332.md).

Mọi task tạo, sửa, review hoặc apply SQL có `CREATE OR REPLACE FUNCTION`, `DROP/ALTER FUNCTION` hay thay đổi RPC **bắt buộc** dùng skill [`safe-supabase-rpc-migration`](../../../.agents/skills/safe-supabase-rpc-migration/SKILL.md) trước khi dựng body SQL. Không được lấy body từ migration cũ trước khi đã đọc đúng signature đang chạy bằng `pg_get_functiondef()` và thêm preflight checksum fail-closed.

Migration mới theo quy ước repo: `migrations/migration_v<N>_<mo_ta>.sql`; kiểm tra số phiên bản mới nhất trước khi chọn N và không để lại bản timestamp trùng nội dung trong `supabase/migrations`.

V324 lưu SQL gốc của Web account snapshot RPC, chuyển nguyên nội dung từ akaAgentWebApp. Đã apply với history `20260928111039 / web_account_read_snapshot`; không apply lại hoặc đổi history chỉ vì chuyển repo. Xem [audit v324](../../../docs/WEB_ACCOUNT_SNAPSHOT_V324_AUDIT.md).

V325–326 lưu nguyên SQL phân trang chiến dịch Web và seed chu kỳ polling, cùng history đã apply `20260928093929 / web_campaign_list_page_and_polling_setting` (hai statements). Đây là chuyển nguồn từ WebApp, không apply lại, tạo history mới hoặc reload schema; test/benchmark WebApp đọc file qua `AKA_AGENT_REPO`. Xem [audit v325–326](../../../docs/WEB_CAMPAIGN_MIGRATIONS_V325_V326_AUDIT.md).

Desktop UI polling uses two v327 keys `desktop.campaigns.poll_interval_seconds` and `desktop.accounts.poll_interval_seconds`, default 30s each, read once per login. Keep one visibility-aware coordinator with separate clocks and passive in-flight deduplication; state events coalesce at 300ms. UI campaign reads use the authenticated Desktop page RPC, 100 combined rows plus one pinned detail, progress only for those IDs; preserve cross-page selection, drafts, running-account labels and supplemental filter options. Picker/reference catalogs load on demand without progress or polling. Account snapshots return catalog only when metadata changes, never raw sessions. Do not change runtime/scheduler/login/group-watcher timers for UI optimizations. V327 was applied to akachat as `20260928141133 / migration_v327_desktop_ui_reads`; Desktop is not yet published. Do not reapply on release; see [audit and tests](../../../docs/DESKTOP_UI_READS_V327.md).

Desktop v328 separates selected configuration freshness from runtime `updated_at`, reads verified log deltas only for the visible log tab, reuses page account names and ignores unchanged Server snapshots; local log appends must emit `CAMPAIGN_LOG_UPDATED`, never state invalidations. **V328 is not applied yet**: apply before this Desktop build; preserve 30s polling/business logic and see [audit, rollout and tests](../../../docs/DESKTOP_UI_READ_DELTAS.md).

Campaign Info uses successful source-ID reads (including `[]`) for the matching campaign/auth scope; never restore removed links from cached catalog relations. Keep the last confirmed IDs on read failure and ignore obsolete selection results; the form preview still falls back to its full catalog when no source-ID snapshot is supplied.

**Chỉ reload schema khi thực sự cần thiết**: chỉ yêu cầu PostgREST reload khi metadata mà API sử dụng đã thay đổi (bảng/cột, quan hệ, signature/kiểu trả về hoặc thuộc tính RPC liên quan đến API), hoặc đã xác nhận schema cache bị cũ. Thay đổi chỉ dữ liệu, code/config trong `auto_blocks`/`auto_workflows` hoặc seed row không cần reload; không thêm `NOTIFY pgrst, 'reload schema'` theo thói quen. Trước khi chọn công cụ apply, kiểm tra cả DDL phụ: bước chuẩn bị `supabase_migrations` bằng `CREATE/ALTER ... IF NOT EXISTS` cũng có thể kích hoạt trigger reload dù không đổi cấu trúc API. Với bản chỉ đổi dữ liệu, ưu tiên đường thực thi không phát sinh DDL phụ không cần thiết, vẫn giữ transaction, checksum/preflight và lịch sử migration theo quy ước. Không tự tắt trigger reload chung để né vấn đề; khi metadata API thực sự đổi, vẫn phải bảo đảm cache được cập nhật và kiểm tra API sau apply. Sự cố 08–09/09/2026 đã ghi nhận reload sau migration bị timeout và gây `PGRST002`/HTTP 503; chưa xác nhận nội dung SQL của migration làm DB quá tải.

Tài khoản dùng `auto_account_logs` chỉ để chẩn đoán, không tham gia nghiệp vụ. Chat gửi mỗi event qua HTTP RPC v293 sau commit (5 giây, không queue/batch/retry); QR không dùng dedupe polling, listener reset baseline khi phục hồi/đổi instance. Xem [ACCOUNT_LOGS.md](../../../docs/ACCOUNT_LOGS.md) và [audit RPC](../../../docs/ACCOUNT_LOG_HTTP_RPC_AUDIT.md).


<!-- END PRESERVED SOURCE -->

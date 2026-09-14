# Đổi máy tính và presence — v262/v281

Đã áp `migrations/migration_v262_staff_device_change_presence.sql` lên linked production
`cgjbsmqtfhqvttudyjzq` ngày 2026-09-07. Không sửa RPC hiện hữu, trigger quota hoặc
đường cập nhật trực tiếp của akaBiz/legacy. Chưa đóng gói/phát hành installer mới.

Ngày 2026-09-14 đã áp [migration v281](../migrations/migration_v281_account_menu_device_change_unlimited.sql)
lên cùng production để menu không giới hạn/trừ lượt ở cả RPC legacy và v2.
Thông báo thành công/chưa liên kết máy trong menu không còn hiển thị số lượt;
màn hình đăng nhập vẫn dùng giới hạn cũ. Bản UI cần app được build từ source mới.

## Hành vi

- Login: bấm Đổi máy tính → modal nhập username → cảnh báo → gỡ binding nếu còn lượt và không có phiên Online.
  Đăng nhập đúng mật khẩu sau đó mới liên kết máy mới.
- Menu: xác thực staff/máy, không giới hạn số lần và không trừ quota; không kiểm tra Online, dừng tác vụ hoặc logout.
- `org_staff.device_changes_remaining` nullable, default 5; không CHECK/NOT NULL/trigger quota.
  Chỉ nhánh login của RPC trừ lượt; `NULL` được hiểu là 5 khi tính kết quả.
  Nhánh menu giữ nguyên giá trị DB, kể cả 0, số âm hoặc NULL. Không tự gia hạn.
- Presence: mỗi lần đăng nhập thành công có UUID mới; heartbeat mỗi 30 giây,
  timeout 5 giây, single flight. Lỗi chỉ tạo diagnostic tối đa mỗi 5 phút.
  Không có callback điều khiển auth/runtime; mất mạng không gây logout/pause/recovery.
- Nếu đăng nhập mới phải chờ request phiên cũ, heartbeat đầu tiên được gửi ngay
  khi hàng đợi hết bận, chỉ cho phiên hiện tại. Phiên đã dừng/thay thế không gửi bù;
  heartbeat đã thử nhưng thất bại vẫn chờ nhịp định kỳ, không retry dồn dập.
- Online là chưa kết thúc và heartbeat gần hơn 120 giây theo đồng hồ DB.
  Mất tín hiệu từ 120 giây hoặc chưa có dữ liệu cho phép reset ở login.
  Lỗi truy vấn là lỗi thao tác, không được coi là Offline.
- Khi thoát app, tiếp tục heartbeat trong cleanup/recovery hiện có và chỉ gửi kết
  thúc best effort sau cleanup; không đợi phản hồi presence trước khi quit.
  Nếu request không kịp tới DB, trạng thái tự hết Online sau 120 giây mất tín hiệu.
  End đến trước registration tạo tombstone để chặn heartbeat muộn.
- Không theo dõi đăng nhập thất bại, không ghi log từng heartbeat/công việc.
  Presence có thể có khoảng mất tín hiệu; nó không chứng minh máy đã tắt hoặc hoạt động liên tục.

## RPC và kiểm tra migration

Trước khi dựng body, cả ba exact signature dưới đây được kiểm tra bằng
`to_regprocedure`, `pg_get_functiondef`, owner, security mode, volatility, config,
ACL và MD5 trên linked production: **đều chưa tồn tại** (source checksum `NULL`).
Tìm toàn bộ migrations không có body cũ. Vì vậy không có live patch bị thay thế.
Preflight cho phép absent hoặc đúng target checksum; checksum khác làm transaction thất bại.

| Signature trong schema `public` | MD5 target đã xác minh sau apply |
|---|---|
| `aka_agent_prepare_device_change(text)` | `4752e10a9ab45fee879d9f55d4c2817b` |
| `aka_agent_reset_device_binding(text,text,text,uuid,jsonb,jsonb)` | `84bf195ed63d67eb35b718b19a6fed4c` |
| `aka_agent_device_presence(text,text,uuid,jsonb,boolean)` | `b504f4928a9dd271dec783796a7a0374` |

- Owner: `postgres`; tất cả `SECURITY DEFINER`, volatility `v`,
  `search_path=pg_catalog, public`. Reset/presence có `lock_timeout=3s`.
- EXECUTE: `postgres`, `anon`, `authenticated`, `service_role`; đã revoke `PUBLIC`.
  Đây là API hẹp: prepare/login reset cố ý dùng username; menu/presence kiểm tra
  credential staff. `instance_id` là định danh quan sát, không phải token cấp quyền.
- Hai bảng mới bật RLS, revoke quyền trực tiếp của `PUBLIC`/`anon`/`authenticated`.
  `service_role` có quyền quản trị; client chỉ gọi RPC.
- Advisor ghi nhận [RPC definer cho anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
  [RPC definer cho authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
  và [RLS không có policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
  Đây là cấu hình có chủ đích của API credential/username với bảng RPC-only;
  kiểm thử đã xác nhận client không đọc được bảng trực tiếp.
- Không thêm hai bảng vào publication Realtime. Index Online là `(staff_id, last_seen_at DESC) WHERE ended_at IS NULL`.

## Retry và giao tiếp ứng dụng

Main process ghi journal không chứa password tại
`app.getPath('userData')/device-change-requests/<hash>.json` trước khi gửi mutation.
Journal giữ username/source, request UUID và snapshot staff/hash/boundAt; ghi file tạm,
fsync rồi rename. Khi mất phản hồi hoặc app restart, dùng lại UUID/snapshot.
Lỗi đọc journal chặn riêng thao tác đổi máy, không tự tạo request mới có thể trừ thêm lượt.

RPC khóa staff trước khi kiểm tra history/binding/quota/presence. Gỡ binding,
tắt remember/auto-login của binding cũ, chỉ trừ lượt cho login và ghi history cùng transaction.
Menu ghi `remaining_before = remaining_after`; `remainingChanges` vẫn là số để tương thích client cũ,
nhưng không phải giới hạn của menu. V2 chỉ gỡ binding mới và tắt tùy chọn local qua IPC.
History replay trả kết quả trước đó kể cả khi đã có binding mới. Snapshot cũ không
được gỡ một binding mới. Kết quả đã xác định mới xóa journal.

IPC mới: `auth:reset-device-lock-by-username`; preload:
`resetDeviceLockByUsername(username): Promise<DeviceLockResetResult>`.
Menu dùng IPC cũ với RPC mới. Result có `success`, `changed`, `remainingChanges`, `code`.
Credentials xác thực menu/presence chỉ nằm trong main process, không thêm vào AuthUser.

## Audit migration v281

Apply target: `cgjbsmqtfhqvttudyjzq` (`akachat`), ngày 2026-09-14.
Hai body nguồn đọc trực tiếp bằng `pg_get_functiondef()` trùng migration v262/v276,
không có patch chỉ tồn tại trên DB. Preflight nhận đúng checksum nguồn/đích,
chặn signature thiếu hoặc checksum/owner/ACL/security/config khác dự kiến.

| Exact signature trong schema `public` | MD5 nguồn | MD5 đích đã xác minh |
|---|---|---|
| `aka_agent_reset_device_binding(text,text,text,uuid,jsonb,jsonb)` | `84bf195ed63d67eb35b718b19a6fed4c` | `20528bcb292a243fd4f0166dec3cb05e` |
| `aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb)` | `e678f336deea7a51285afc1686a5fd7d` | `dfc6d177499fbf9fc51526d7b9fba6f4` |

Giữ nguyên owner `postgres`, `SECURITY DEFINER`, volatility `v`,
`search_path=pg_catalog, public`, `lock_timeout=3s`, ACL EXECUTE của
`postgres/anon/authenticated/service_role` và không cấp quyền cho `PUBLIC`.
Giữ row lock, CAS hash/boundAt hoặc revision, replay request ID, whitelist metadata,
password/máy, Online guard của login, presence và cách gỡ binding riêng từng phiên bản.
Advisor vẫn ghi nhận quyền EXECUTE definer của anon/authenticated theo contract RPC hẹp đã có;
không thay đổi quyền truy cập bảng hoặc hàm.

Kiểm chứng trước/sau apply: ba SQL smoke v262/v276/v281 trong transaction rollback,
hai typecheck, production build, device-change smoke, auth v2 (112 checks), auth renderer smoke.
V281 thử 7 lần đổi cho từng quota 5/1/0/-1/NULL trên mỗi phiên bản (70 lần),
không trừ lượt, no-op, replay sau rebind, CAS cũ, password/máy, role anon,
login Online và lượt cuối 1→0. Reapply đúng target qua; patch checksum khác bị chặn và rollback.
API prepare/reset legacy/v2 trả HTTP 200 trước/sau apply, từ chối staff không tồn tại.
Không để lại fixture; chưa đóng gói/phát hành installer.

Không thêm `NOTIFY`: metadata API không đổi. Trigger DDL `pgrst_ddl_watch` hiện hữu
vẫn bật và tự phát reload khi `CREATE OR REPLACE FUNCTION`; API đã được kiểm tra sau apply.

## Kiểm thử đã chạy

- Typecheck main/preload/shared và renderer; production build.
- `node scripts/run-device-change-smoke-test.cjs`: double click, journal trước mutation,
  mất phản hồi sau commit, process restart, giữ CAS, phản hồi lỗi, mất mạng 10 phút,
  reconnect cùng instance, timeout, single flight, đổi password, logout/quit trong lúc request treo;
  đăng nhập lại khi end cũ chưa trả lời phải gửi heartbeat mới ngay khi hết bận,
  không gửi nhầm phiên đã thay thế/dừng. Test chạy callback before-quit thật với
  automation stop/recovery được giữ chờ để xác nhận presence còn hoạt động trong
  cleanup và quit không đợi phản hồi end.
- `migrations/tests/migration_v262_staff_device_change_presence_smoke.sql`: chạy rollback
  trước và sau apply trên production; default 5, 1→0, hết lượt, NULL, Online 119 giây,
  stale 120 giây, old-binding presence, menu không kết thúc presence, tombstone,
  replay/new binding, remember settings và quyền RPC/table.
- PostgreSQL local tạm, hai connection độc lập: cùng request ID đều nhận kết quả đã commit;
  khác request ID chỉ một lần đổi, một history, một lượt bị trừ. Lỗi history rollback
  cả binding/quota; lỗi query presence giữ binding/quota. Reapply giữ số lượt đã thay đổi;
  sai checksum bị chặn. Cluster local đã dừng sau test.
- Agent-browser với component thật và API giả lập: vị trí link dưới lấy username,
  mở modal được khi form login trống, autofocus ô username, hủy không gửi request,
  chỉ xác nhận cảnh báo mới gửi username đã trim, không cần password, success điền username về form login và hiện số lượt,
  Online hiện đúng câu đã duyệt; menu success giữ user và tắt remember/auto-login,
  không gọi logout. Không có browser error; chỉnh compact spacing cho cửa sổ thấp.
- App Supabase client gọi được cả ba RPC production; staff không tồn tại không được
  đăng ký presence hoặc reset binding. Không để lại fixture smoke trong production.
- 1.000 heartbeat cập nhật cùng instance trong transaction rollback production:
  **350,13 ms thời gian DB** sau apply (358,18 ms trước apply). Đây là phép đo tuần tự,
  không bao gồm mạng và không phải chứng nhận tải 1.000 máy đồng thời. N phiên tạo
  khoảng N/30 heartbeat request mỗi giây.

## Tra cứu trong DB

Thay `123` bằng staff ID cần kiểm tra. Trạng thái được suy ra khi đọc:

```sql
SELECT instance_id, device_fingerprint_hash, device_label, device_platform,
       app_version, started_at, last_seen_at, ended_at,
       CASE WHEN ended_at IS NOT NULL THEN 'Offline — app đã báo thoát'
            WHEN last_seen_at > clock_timestamp() - interval '120 seconds' THEN 'Online'
            ELSE 'Offline — mất tín hiệu' END AS presence_status
FROM public.auto_staff_device_presence
WHERE staff_id = 123
ORDER BY started_at DESC;

SELECT created_at, source, old_binding, requesting_device,
       remaining_before, remaining_after, request_id
FROM public.auto_staff_device_change_history
WHERE staff_id = 123
ORDER BY created_at DESC;
```

Không có presence nghĩa là chưa có dữ liệu theo dõi. Khi tra nhiều máy, nhóm theo
`device_fingerprint_hash`; nhiều instance trên cùng hash không phải nhiều máy.

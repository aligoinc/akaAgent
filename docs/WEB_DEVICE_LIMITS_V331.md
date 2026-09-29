# Web/PWA device admission — v331 audit

Ngày 29/09/2026: **đã apply production và deploy WebApp** theo yêu cầu người dùng. Project đã xác minh: `cgjbsmqtfhqvttudyjzq` (`akachat`), PostgreSQL 17.6. History `20260929063252 / web_device_limits_v331`. Không dùng project legacy. Nguồn canonical: [migration v331](../migrations/migration_v331_web_device_limits.sql); WebApp chỉ tham chiếu qua `AKA_AGENT_REPO`. Không apply lại.

## Live dependencies được giữ nguyên

Metadata/definition đầy đủ được lưu tại [snapshot audit](../migrations/snapshots/v331_web_device_auth_audit.json). Hai hàm dưới đây chỉ được gọi/tham chiếu, không bị CREATE OR REPLACE, DROP, ALTER hoặc đổi ACL:

| Exact signature | Source = target MD5 của `pg_get_functiondef` |
| --- | --- |
| `public.aka_agent_authenticate_control_session(text)` | `7995d6e92b16eb17b44995e14aae1b87` |
| `public.aka_agent_staff_time_allowed(bigint)` | `a294e60011edd8d42e90ac2f74ce744c` |

Giữ nguyên các patch live kiểm tra nhân viên hết hạn/hoạt động, scope tổ chức, capability và revision capability đã có trong session authentication. Helper thời hạn live khác bản lịch sử; không chép lại body lịch sử. Hai hàm vẫn owner `postgres`, SECURITY DEFINER, giữ nguyên volatility/search_path/config/ACL captured trong snapshot.

## RPC và trigger function mới

Source checksum của các hàm dưới đây: **không tồn tại** tại thời điểm audit. Preflight fail-closed nếu namespace `aka_agent_control_web_device%`, bảng policy hoặc cột `web_device_%` đã tồn tại. Tất cả dùng `CREATE FUNCTION`, không thay thế hàm live.

Target MD5 được đo bằng `pg_get_functiondef` trên PostgreSQL 16 local và đã xác nhận khớp trên PostgreSQL 17 production sau apply:

| Exact signature | Target MD5 |
| --- | --- |
| `public.aka_agent_control_web_device_limit(text,boolean,boolean)` | `67e5e3b04c7c661a1f008615cfd84766` |
| `public.aka_agent_control_web_device_policy_changed()` | `b170a3043de5a6a5366d645f11f885b9` |
| `public.aka_agent_control_web_device_claim(bigint,bigint,uuid,uuid,text,text,text,timestamp with time zone)` | `fbd5933e5fc7c4a600e523ad4572772c` |
| `public.aka_agent_control_web_device_overview(bigint,bigint,uuid)` | `93faf6dab8bd9da786eb737a1a847cab` |
| `public.aka_agent_control_web_device_revoke(bigint,bigint,uuid)` | `2eed26df527dd2ca0106da507ba73a8f` |

Các hàm mới SECURITY INVOKER, `search_path=pg_catalog,public`; limit IMMUTABLE, overview STABLE, còn lại VOLATILE. Claim/revoke: `lock_timeout=3s`, `statement_timeout=8s`; overview: `statement_timeout=8s`. Đã xác minh owner production `postgres`, metadata và ACL `{postgres=X/postgres,service_role=X/postgres}`; không PUBLIC/anon/authenticated EXECUTE. Local disposable DB dùng owner của tiến trình local, không giả định owner đó là production owner.

Policy table có RLS, không cấp quyền cho PUBLIC/anon/authenticated. Live ACL là `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` do default privileges của production đã cấp quyền bảng cho service_role. Trigger lưu revision mới khi hạn mức hiệu lực đổi, không reset khi chỉ sửa mô tả. Claim khóa policy shared + row staff cho count/write nguyên tử. Phiên cũ không bị xóa/thu hồi khi apply. Native/Desktop không nhận chỗ qua các RPC này.

## Smoke và handoff

WebApp harness `scripts/test-web-device-sql.sh` chạy migration canonical trên DB local dùng một lần. Behavioral/ACL smoke dùng `SET LOCAL ROLE service_role` và kết thúc `ROLLBACK`. Đã đạt: 5 phiên legacy chỉ 3 được nhận chỗ; login lại, expiry, thu hồi, policy/staff/tenant; fallback và revision `3 → 2 → 3`; native không tính. Các transaction thật đồng thời xác nhận tối đa N cho login/F5 và một chỗ cho cùng cookie/token.

Backend/Web/native unit tests, typecheck và build ở akaAgentWebApp đã đạt. Browser fixtures kiểm tra desktop Chromium, Android Chromium và iPhone WebKit, gồm retry mạng và public route không chạy web-entry. Không gửi tin hoặc chạy chiến dịch thật.

Đã kiểm tra namespace chưa tồn tại ngay trước apply và chạy duy nhất v331. Sau apply, cả năm target hashes/metadata/ACL khớp; hai dependency hashes giữ nguyên. Live behavioral smoke dưới `SET LOCAL ROLE service_role`, trong transaction `ROLLBACK`, đã đạt: cấp đủ 3 chỗ, F5 cùng thiết bị, từ chối máy thứ tư, thu hồi legacy bị từ chối, staff/tenant isolation, native không tính, expiry/revoke giải phóng chỗ và login cùng cookie thay phiên. Không lưu dữ liệu thử hoặc thu hồi phiên người dùng. Schema mới được PostgREST nhận: overview scope rỗng và claim staff không tồn tại đều trả HTTP 200 với kết quả đúng từ máy backend hiện có.

Supabase security advisor chỉ có INFO `rls_enabled_no_policy` cho bảng policy mới, đúng thiết kế service-role-only; không mở policy cho browser để xóa INFO. [Giải thích của Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Ứng dụng cập nhật lúc `2026-09-29T06:35:50Z` trên máy Fly `48ee749f357398`, image `registry.fly.io/aka-agent-web-app:web-devices-6b8694c-20260929@sha256:dc2496427338596b00b7b74ead1810d9868a56c0e3fc17a26bd569dab375a622`. Giữ nguyên một máy shared CPU/256 MB, chỉ đổi image. Chín browser cases với production-served assets và dữ liệu giả lập đạt trên desktop/Android/iPhone. Chi tiết ở `akaAgentWebApp/docs/WEB_DEVICE_LIMITS_DEPLOY_20260929.md`.

Không thêm SQL connection/pool/worker hoặc tăng budget production. WebApp dùng backend singleton Supabase sẵn có; `/me` nền giữ nguyên, chỉ bước mở/F5/login thêm cấp chỗ. Hướng dẫn cấu hình, lỗi và rollback ứng dụng ở `akaAgentWebApp/docs/WEB_DEVICE_LIMITS.md`.

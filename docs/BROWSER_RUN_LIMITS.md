# Giới hạn tài khoản chạy — v340

## Hành vi và cách sử dụng

Trong **Cài đặt chung → Giới hạn tài khoản chạy**, mỗi nhân viên đặt hai số độc lập cho Zalo (trình duyệt) và Facebook. Ô trống tương ứng SQL `NULL` (không giới hạn). Nhập số nguyên từ 1 đến 2.147.483.647. Cấu hình dùng chung trên mọi máy của cùng nhân viên; không áp dụng cho Zalo QR/Server, Email hoặc SMS.

Phạm vi hỗ trợ là **một Desktop đang đăng nhập cho mỗi nhân viên**. Cấu hình lưu theo nhân viên nên được giữ khi đổi máy. Cố tình chạy đồng thời nhiều Desktop nằm ngoài phạm vi bảo đảm: recovery theo staff hiện có có thể xóa ownership của máy khác. Không mở rộng recovery trong tính năng này.

DB chỉ cấp lượt mới khi số tài khoản khác đang chiếm chỗ nhỏ hơn giới hạn. Nhiều chiến dịch trên một account chỉ tính một lần. Chỉ đăng nhập/mở tab hoặc chạy thao tác account không có chiến dịch không chiếm chỗ. Khoảng chờ trong lượt, nghỉ/lướt phụ và unit chưa settle vẫn giữ chỗ. Giảm giới hạn không ngắt lượt hiện tại.

Khi hết chỗ, chiến dịch giữ **chờ xử lý**, dưới tên/loại chiến dịch xuất hiện:

> Đã đạt giới hạn tài khoản Facebook chạy đồng thời. Chiến dịch sẽ tự chạy khi có chỗ.

Zalo dùng tên “Zalo (trình duyệt)” trong cùng câu. Thông tin → Tổng quan → Ghi chú hiển thị đầy đủ. Scheduler bỏ phần còn lại của queue account trong tick đó và thử lại theo nhịp 30 giây đang có. Không ghi note/log lặp khi nội dung không đổi. Claim thành công xóa note. Các chiến dịch chưa tới lượt kiểm tra trong queue giữ note hiện có.

## Luồng và ranh giới

- `src/shared/browserRunLimits.ts`: contract IPC, kiểm tra số/revision, nội dung ghi chú.
- `BrowserRunLimitsSettings` chỉ fetch khi mount mục cài đặt; khóa form/đóng trong lúc save, giữ draft khi lỗi hoặc CAS conflict, cho tải lại chủ động. Parent key theo staff/organization và generation bỏ phản hồi cũ. Credentials không vào renderer.
- Main-frame-only IPC → `browserRunLimitsRepository` → RPC `aka_agent_browser_run_limits`. Repository kiểm tra cùng staff/org và cùng object credentials sau await. SQL kiểm tra credentials lại sau khóa, cả với service_role; chỉ sửa chính staff và đúng revision.
- Ba cột `org_staff`: `max_running_zalo_web_accounts`, `max_running_facebook_accounts`, `browser_run_limits_revision`. Không đổi ACL/RLS legacy của bảng.
- `aka_agent_claim_campaign_runtime_checked` là SECURITY INVOKER, chứa body claim live trước task và thêm admission. Wrapper boolean legacy và v2 cùng gọi helper. V2 giữ wire shape và trả `reason=concurrency_limit_reached` khi chặn.
- Thứ tự khóa: staff SHARE → entitlement advisory shared → admission advisory theo staff (Desktop và có ít nhất một giới hạn) → campaign/account. Save dùng staff UPDATE nên không thể thay cấu hình giữa admission. Advisory chỉ giữ trong transaction, không giữ suốt lượt chạy.
- Đếm `DISTINCT campaign.account_id` cùng staff/tenant, trạng thái đang chạy hoặc còn parent/unit token; bao phủ legacy và drain. Không dùng cờ active/login/delete để bỏ một ownership còn sống. Không có ledger/TTL hay timer mới. Index `auto_campaigns_staff_id_idx` hiện có hỗ trợ truy vấn.
- Tái sử dụng singleton Supabase HTTP. Không thêm SQL client/pool, process/replica hay ngân sách connection. Khi cả hai giới hạn NULL, bỏ qua admission advisory/count; khi bật, thêm một count trong claim hiện có. HTTP vẫn tiêu thụ tài nguyên DB phía server.

## Migration và audit production

**Đã apply lên akachat `cgjbsmqtfhqvttudyjzq` ngày 02/10/2026**, history **`20261002103201 / migration_v340_browser_run_limits`**. Không apply lại khi phát hành Desktop.

Canonical SQL: `migrations/migration_v340_browser_run_limits.sql`.
SHA-256: `72533e2288348f9b1e8d774c64939895f22056785f6ea3aebf71f6482229c161`.

| Signature public | MD5 nguồn | MD5 sau apply |
| --- | --- | --- |
| `claim_campaign_runtime(bigint,bigint,bigint,text)` | `02038a74bbd1238f276dee3109ae21cf` | `d629c23b56764f78d0e754bd524727d6` |
| `aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)` | `c822891785abb3fadf2576ec02b6b6f8` | `0fdbb44da58b3ef82bdd85224922c428` |
| `aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text)` | Mới | `3e7288046c6d08a25fef71468c8e03c9` |
| `aka_agent_browser_run_limits(bigint,bigint,text,text,text,jsonb)` | Mới | `79f9f689e1e87631ca8a704a7ffff9b4` |

Nguồn `pg_get_functiondef`, owner/ACL/security/volatility/config đã capture trong `scripts/fixtures/browser-run-limits/live-source.json`; metadata đích ở `expected-target.json` cùng thư mục. Hai checksum nguồn khớp audit migration v305, gồm các patch staff expiry và token từ v268. Bảo toàn guard subtype/capability, Data Group hard end qua wrapper hẹp, pending/schedule/provisioning/login, retry token, unit lease, lịch ngày Việt Nam và rollback khi vượt boundary. Không lấy body từ migration cũ để dựng SQL.

Migration kiểm tra fail-closed cả nguồn/attributes, sự vắng mặt của tên/cột mới và target checksum/attributes trước commit. Claim cũ/v2 giữ owner `postgres`, SECURITY INVOKER, volatility, search_path và ACL nguyên trạng. Helper mới cấp execute cho các role runtime hiện hữu; settings RPC SECURITY DEFINER, search_path cố định, timeout 10s/lock timeout 5s và credential guard, revoke PUBLIC.

Đã chạy migration trong transaction ROLLBACK trên production, so metadata đích và xác nhận definitions/cột trở về nguồn. CLI bị treo tại lần đọc metadata (không có query tương ứng đang chạy trên DB); dừng đúng process đó và dùng Supabase connector cùng project để rollback/apply/verify. Apply qua `apply_migration`, không bulk-push. Cột và RPC mới là API metadata nên có schema reload. PostgREST sau apply: RPC settings được nhận diện, từ chối thiếu credentials; v2 trả `not_found` cho identity giả mà không ghi dữ liệu.

Sau apply chạy `migrations/tests/migration_v340_browser_run_limits_rollback.sql`: role SQL thật `anon`, chọn một staff hợp lệ bằng khóa SKIP LOCKED, kiểm tra get/save, CAS, thiếu credential và sai tenant, rồi ROLLBACK. Credentials chỉ nằm trong biến SQL, không xuất ra client/log. Kiểm tra sau rollback: số staff có cấu hình khác NULL vẫn bằng 0.

Security advisors có cảnh báo theo phân loại [anon SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) và [authenticated SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) cho settings RPC. Execute này là chủ ý theo mô hình credential RPC hiện tại; đã kiểm chứng auth/tenant dưới role thật, không coi quyền execute là quyền sửa một staff bất kỳ. Không đổi ACL các đối tượng legacy ngoài phạm vi.

## Kiểm chứng và phát hành

Đã PASS:

- `node scripts/browser-run-limits-smoke-test.cjs`: shared validation, phương thức scheduler thật, ưu tiên giới hạn giờ/ngày trước hết chỗ và chỉ đổi lý do sau khi quota được phép chạy lại, note/CAS/dedup, dừng queue đúng tick, identity/session fencing repository, main-frame IPC.
- `node scripts/run-browser-run-limits-sql-smoke.cjs`: PostgreSQL local biệt lập, definitions/ACL live, rollback sạch, stale checksum fail-closed, hai session tranh chỗ cuối qua legacy/v2, distinct account, hai loại độc lập, staff độc lập, giảm/bỏ giới hạn, pause/unit, login-only, guard cũ và index staff. Không dùng connection production.
- `node scripts/run-browser-run-limits-ui-smoke.cjs`: modal thật với IPC fixture, mạng ngoài bị chặn; lazy load, validation, save/null, draft conflict, lỗi mạng/retry, busy close guard, late save sau đổi staff, sáng/tối 1280/780px. Đã xem ảnh chụp giao diện.
- Smoke hiện có: `campaign-pause-note-smoke-test.cjs`, `campaign-failure-cleanup-smoke-test.cjs`, `facebook-rest-browse-smoke-test.cjs`.
- `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`, `npm run build`. Build có cảnh báo dynamic/static import đã có; không có lỗi.

Desktop đã build local, chưa đóng gói/phát hành installer. Giữ version hiện tại.

Sau apply, dùng `node scripts/browser-run-limits-migration.cjs verify` để so metadata/history, hoặc `api` để chỉ smoke PostgREST. Mode `smoke`/`apply` cố ý từ chối nguồn đã đổi, không dùng để apply lại. Rollback tính năng theo người dùng bằng để trống hai ô; không drop RPC/cột đang được client sử dụng.

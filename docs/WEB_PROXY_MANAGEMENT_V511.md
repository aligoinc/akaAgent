# V511 — Quản lý proxy theo tổ chức trên Web

Ngày 12/11/2026. **Chưa apply production.** Code Web/API ở akaAgentWebApp (`docs/WEB_PROXY_MANAGEMENT.md`), Desktop/App Server ở repo này (chưa phát hành). Hợp đồng dùng chung: akaAgentWebApp `packages/control-api/src/proxyManagement.ts`.

## Vì sao

- Proxy (`auto_proxies`) trước đây thuộc riêng từng nhân viên. Người dùng chốt: proxy thêm và quản lý ở cấp **tổ chức**, mọi nhân viên trong tổ chức thấy và chọn được.
- Web cần trang Quản lý proxy tập trung: hạn dùng, trạng thái kết nối (kiểm tra hằng ngày), tài khoản đang dùng. Bật theo cờ trên bảng tổ chức.
- Số liệu 12/11/2026: 327 proxy sống của 54 tổ chức, mỗi tổ chức chỉ một người thêm, 0 tên trùng trong tổ chức. 368 tài khoản gắn proxy, 363 chạy trên Desktop (Facebook 150, Zalo 212, email 1), 5 Zalo Server (tổ chức 557, 572, 1550). 0 tài khoản dùng proxy của nhân viên hoặc tổ chức khác.

## Đối tượng thêm/đổi

| Đối tượng | Nội dung |
|---|---|
| `org_organization.web_proxy_management_enabled` | boolean NOT NULL DEFAULT false. Bật trang Proxy trên Web cho tổ chức. Không ảnh hưởng Desktop, app iOS. Migration không bật cho tổ chức nào. |
| `auto_proxies.expires_on`, `note` | Hạn dùng (ngày giờ Việt Nam) và ghi chú (≤ 500 ký tự) do khách nhập. Desktop không có quyền ghi hai cột này. |
| Index tên | `auto_proxies_staff_name_unique (staff_id, lower(name))` → `auto_proxies_org_name_unique (organization_id, lower(name))`, thêm `idx_auto_proxies_org`. |
| `auto_proxy_checks` | Một dòng mỗi proxy: `status` pending/ok/failed/local, giờ kiểm tra, lần cuối hoạt động, hỏng từ lúc nào, độ trễ, IP ra, mã lỗi, số lần hỏng liên tiếp, lịch kiểm tra kế tiếp, lease, `endpoint_hash`. RLS bật, thu hồi mọi quyền (kể cả `service_role`); chỉ đọc/ghi qua RPC. Tách khỏi `auto_proxies` để kiểm tra không đổi `updated_at` (Web dùng chống ghi đè). |
| Policy Desktop trên `auto_proxies` | `desktop_owned_resource` (ALL, theo nhân viên) → `desktop_org_read` (SELECT theo tổ chức) + `desktop_owned_insert/update/delete` (theo nhân viên). Policy `auto_accounts` (EXISTS proxy đọc được) tự cho Desktop gắn proxy của tổ chức; trigger bên dưới quyết định có được không. |
| Trigger `trg_account_proxy_scope_guard` trên `auto_accounts` | BEFORE INSERT/UPDATE OF proxy_id, staff_id, organization_id, flatform_type, is_zalo_server, is_zalo_show_web, is_delete. Proxy phải cùng tổ chức (`proxy_wrong_organization`). Proxy do nhân viên khác thêm chỉ gắn được khi phần mềm chạy tài khoản đã đọc proxy theo tổ chức (`proxy_shared_runtime_not_ready`). Không đổi proxy/nhân viên/loại thì thoát ngay. Áp cho mọi đường ghi (Web, Desktop, RPC, SQL tay). |
| `auto_system_settings` | `proxies.check_mode` = `off` (off/shadow/on). `proxies.shared_runtime` = `{"server":false,"desktopMinVersion":null}`. |
| RPC `aka_agent_control_proxies(staff, org, action, payload)` | `service_role`, SECURITY DEFINER, 15 s. Kiểm nhân viên còn hoạt động, đúng tổ chức, tổ chức đã bật cờ. Lệnh: `list`, `get`, `summary`, `accounts`, `can_assign`, `create`, `create_many` (≤ 200, bỏ trùng), `update` (CAS `updated_at`), `set_expiry` (`expiresOn` hoặc `addDays`), `delete`, `reassign`, `check_now` (trả mật khẩu cho API để kiểm tra, giới hạn 30 giây/proxy), `check_all` (10 phút/tổ chức). |
| RPC `aka_agent_proxy_check_worker(action, payload)` | `service_role`. `claim` nhận ≤ 50 proxy tới hạn của tổ chức đã bật cờ (lease 30–600 giây, khoá advisory để nhiều máy API không nhận trùng). `report` ghi kết quả. |

Hàm phụ ở schema `private` (`aka_agent_proxy_*`, `aka_agent_guard_account_proxy_scope`), thu hồi EXECUTE khỏi PUBLIC. Không sửa hàm cũ nào: `create_control_zalo_account_atomic`, `update/delete_control_zalo_proxy_atomic` (Web/iOS cũ vẫn dùng) giữ nguyên.

## Luật

- **Quyền**: xem, thêm, chọn, bấm Kiểm tra = mọi nhân viên của tổ chức. Sửa, tắt, xoá, đặt hạn = người thêm hoặc quản trị tổ chức (`org_staff.is_admin` hoặc `org_organization.staff_admin_id`). Gỡ/chuyển proxy = chỉ tài khoản của chính mình; tài khoản `đang chạy` bỏ qua.
- **Khoá địa chỉ**: proxy có tài khoản chạy trên Desktop đang dùng thì Web không đổi giao thức/địa chỉ/cổng/tên đăng nhập/mật khẩu (`proxy_endpoint_locked`), vì phần mềm đang chạy không nhận thay đổi tại chỗ. Đổi tên, hạn, ghi chú vẫn được.
- **Tắt/xoá** bị chặn khi còn tài khoản dùng (`proxy_in_use`).
- **Trùng**: tên không trùng trong tổ chức (không phân biệt hoa thường); cùng địa chỉ + cổng + tên đăng nhập trong tổ chức là trùng.
- **Kiểm tra** (bộ kiểm tra ở API Fly, akaAgentWebApp `apps/api/src/modules/proxies`): lượt hằng ngày 06:00 giờ Việt Nam + 0–29 phút theo id, cách lần trước ≥ 6 giờ. Hỏng lần đầu thì thử lại sau 2 phút; hỏng lần hai mới ghi `failed`. Khách bấm Kiểm tra: API thử lại một lần sau 2 giây, hỏng là ghi `failed` ngay. Proxy bị sửa trong lúc kiểm tra (`endpoint_hash` khác) thì bỏ kết quả. Kết quả cũ của địa chỉ đã đổi hiện là "Chưa kiểm tra". `local` = địa chỉ nội bộ hoặc proxy không mật khẩu chỉ cho phép theo IP (không báo hỏng).
- **`proxies.shared_runtime`**: `server: true` sau khi App Server mới (đọc proxy theo tổ chức) đã cài trên VPS. `desktopMinVersion` = bản Desktop đầu tiên có code đọc theo tổ chức; một nhân viên chỉ gắn được proxy đồng nghiệp cho tài khoản Desktop khi **mọi** máy của họ hoạt động trong 30 ngày (`auto_staff_device_presence`) đều ≥ bản đó. Tổ chức đồng bộ chat (`akaAgentChatApi`) không dùng proxy, việc này không đổi.

## Code Desktop/App Server đi kèm (repo này, chưa phát hành)

- `proxyRepository`: `listProxies`/`getProxy` đọc theo `organization_id`; `updateProxy`/`deleteProxy` từ chối proxy của đồng nghiệp.
- Bộ chạy dừng và báo lỗi khi tài khoản có `proxy_id` mà không đọc được proxy (`MISSING_ACCOUNT_PROXY_MESSAGE` ở `src/shared/proxyRuntime.ts`): `proxyRuntimeService.prepareAccountSession`, `zaloRuntimeService.createZaloClient`, `facebookLoginService.applyProxy`. Bản cũ chạy thẳng bằng mạng của máy.
- `accountRepository` dịch lỗi trigger sang tiếng Việt. Cửa sổ Quản lý proxy đánh dấu proxy "đồng nghiệp thêm", chỉ xem. Ô chọn proxy hiện proxy cả tổ chức.
- Nhập Facebook (`aka_agent_facebook_login`) vẫn chỉ nhận proxy của chính nhân viên (RPC cũ, báo "Proxy không còn hợp lệ").

## Triển khai

1. Apply ba phần theo thứ tự `migration_v511_web_proxy_management_p1.sql` (cột, bảng, index, policy Desktop, cài đặt, hàm phụ, trigger) → `_p2.sql` (RPC cho Web) → `_p3.sql` (RPC bộ kiểm tra, quyền, kiểm tra cuối); mỗi phần một giao dịch, phần sau từ chối khi phần trước chưa xong, phần nào cũng từ chối chạy lại. Tách vì cả file ~67 KB quá sức một lần gửi của công cụ apply. DDL trên `org_organization`/`auto_proxies`/`auto_accounts` làm PostgREST nạp lại schema (`lock_timeout` 3 giây). Kiểm md5 sổ = md5 từng file.
2. Bật cờ cho 3 tổ chức đang có tài khoản Zalo Server dùng proxy (nếu không, Web mới ẩn cửa sổ proxy họ đang dùng). Câu này chạy trigger đồng bộ đơn hàng CRM của từng tổ chức:
   ```sql
   UPDATE public.org_organization SET web_proxy_management_enabled = true
   WHERE id IN (557, 572, 1550) AND NOT web_proxy_management_enabled;
   ```
3. Deploy API/Web akaAgentWebApp. Bộ kiểm tra chạy nhưng `proxies.check_mode = off` nên không kiểm tra.
4. Chạy thử: `UPDATE auto_system_settings SET value = 'shadow' WHERE key = 'proxies.check_mode';` Admin akaBiz thấy kết quả, khách không thấy. Đo báo sai: proxy bị ghi `failed` mà tài khoản dùng nó vừa chạy thành công trong 30 phút. Dưới 1% thì `on`; cao hơn thì chuyển bộ kiểm tra sang VPS Zalo Server ở Việt Nam.
5. Cài App Server mới trên VPS rồi đặt `server: true`. Phát hành Desktop rồi đặt `desktopMinVersion`.

Tắt nhanh: `proxies.check_mode = 'off'`; ẩn trang cho tổ chức: cờ `false`. Không cần deploy.

## Rollback

`migrations/rollback_v511_web_proxy_management.sql`: gỡ trigger, hàm, bảng kiểm tra, cột hạn/ghi chú, cờ tổ chức, cài đặt; dựng lại policy và index cũ. Từ chối khi còn tài khoản dùng proxy của nhân viên khác (sau khi gỡ, bản Desktop/App Server mới sẽ vẫn đọc được nhưng RLS cũ chặn Desktop, nên phải chuyển/gỡ proxy các tài khoản đó trước). Mất hạn dùng, ghi chú và kết quả kiểm tra đã lưu. API/Web đã deploy vẫn chạy: thiếu cột/hàm thì coi như cờ tắt.

## Kiểm thử

`bash scripts/test-v511-web-proxy-management.sh` (PG16 cục bộ, 105 kiểm tra; apply ba phần theo thứ tự, phần 2 trước phần 1 bị từ chối): preflight khớp hàm/policy/index production, quyền, cờ, mọi lệnh RPC, quyền người thêm/quản trị, trigger trên mọi đường ghi, Desktop đọc cả tổ chức nhưng chỉ ghi của mình, bộ kiểm tra (lease, 2 lần hỏng, thử lại, hash), chạy lại bị từ chối, rollback và apply lại.

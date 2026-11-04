# Màn Gia hạn sau đăng nhập — cổng CRM `/gia-han`

Nhánh `dev_auto_nang_cap` (04/11/2026). Khi tổ chức không còn sản phẩm akaAgent còn hạn, Desktop không chỉ báo
"Tài khoản của bạn đã hết hạn" mà mở màn **Gia hạn** nhúng cổng tự phục vụ của CRM (repo SqlServerDashboard,
`https://crm.akabiz.net/gia-han`, tài liệu CRM `docs/trang-gia-han-khach-hang.md`). Khách chọn gói, quét QR; CRM tự
gia hạn đúng dòng `org_organization_product` khi nhận tiền; app tự đăng nhập lại.

Form đăng nhập có thêm link **Lấy lại tài khoản** (`/gia-han/lay-lai-tai-khoan`) và **Đăng ký dùng thử**
(`/gia-han/dang-ky-dung-thu`), mở bằng trình duyệt ngoài.

Không đổi: App Server, WebApp, câu báo của app cũ. App ≤ 9.2.0 chỉ hưởng thay đổi DB của link
"Nâng cấp và thanh toán" (mục DB).

## Phân loại và trang mở

`classifyRenewalRequirement` (`src/shared/renewalPortal.ts`) chạy khi `findRenewalRequirement`
(`entitlementRepository.ts`) xác nhận không còn quyền akaAgent nào (cùng quy tắc đăng nhập: product
3/10/13/16/17/18, còn hạn tới hết ngày VN). Quy tắc theo CRM `resolvePortalLanding` nhưng chỉ xét sản phẩm akaAgent.

| Tình huống | Trang CRM | `opid` (sản phẩm trọng tâm) |
|---|---|---|
| Có gói trả phí (`package_type` khác rỗng/demo/free) đã hết hạn | `/gia-han/het-han-goi` → Gia hạn chọn sẵn đúng gói đang dùng | gói trả phí mới hết hạn nhất |
| Chỉ còn bản dùng thử đã hết hạn | `/gia-han/het-han-dung-thu` (Nâng cấp, xin gia hạn dùng thử) | bản dùng thử mới hết hạn nhất |
| Không có sản phẩm akaAgent | `/gia-han/nang-cap` | không có |
| Nhân viên bị khoá / hết hạn do quản trị tổ chức | Không chuyển; giữ câu báo cũ | — |

- Phải truyền `opid`: trang đích của CRM xét **mọi** sản phẩm của tổ chức (aka Map, akaBiz Chat…).
- Facebook 3/10 cùng nhóm; nếu dòng mới nhất là product 10 thì mở trang product 3 (catalog CRM chưa bán gói 10).
- Chế độ tách quyền (tổ chức có product 5): khi hết gói akaAgent, `aka_agent_staff_client` ném `app_access_denied`
  trước bước kiểm gói nên chưa vào màn Gia hạn; câu báo đã sửa (trước đây báo nhầm lỗi kết nối) và chỉ tới
  "Nâng cấp và thanh toán". Ký link cho nhóm này cần thao tác server riêng không đòi quyền akaAgent (việc sau).

## Luồng

1. `ensureStaffSubscriptionActive` (`authRepository.ts`) ném `RenewalRequiredError` (message vẫn là câu cũ) kèm
   staff/org/fingerprint đã xác minh và quyết định máy v3. Bước này chạy trước khoá máy và chính sách như cũ, nên
   mật khẩu đã đúng. Quyết định máy `manual_login_required` (thông tin đã lưu không được dùng) vẫn trả về đăng nhập
   thủ công, không mở màn Gia hạn bằng thông tin đó; `device_locked` vẫn ưu tiên báo hết hạn như trước, khoá máy xử
   lý ở lượt đăng nhập lại sau khi gia hạn.
2. `runLogin` (`authHandlers.ts`) giữ `pendingRenewal` trong RAM main (tối đa 60 phút không dùng; xoá khi đăng nhập
   mới, huỷ, đăng xuất, đăng nhập thành công) và trả `{status:'renewal_required', renewal}`. Renderer chỉ nhận
   loại trang, tên đăng nhập, tên/hạn sản phẩm — không mật khẩu, token, link hay `opid`.
3. Tự đăng nhập lúc mở app trả `renewal` trong bootstrap. Phiên đang dùng hết vì hết gói (`handlers.ts`,
   `runSessionExpiryCheck`): main kiểm lại bằng endpoint `check` rồi gửi `AUTH_RENEWAL_REQUIRED`.
4. `RenewalPage` gắn webview `about:blank` vào phân vùng `akaagent_renewal`; `RenewalWebService` gọi Edge
   `renewal_link`, kiểm URL thuộc `https://crm.akabiz.net/gia-han*` rồi nạp thẳng vào guest.
   Edge lỗi/chưa có action/chưa có khoá → nạp `/gia-han?next=<trang>`; khách đăng nhập cổng bằng mật khẩu.
5. Kiểm lại (`AUTH_RENEWAL_RECHECK`): 1 request `check`; còn hết hạn thì cập nhật màn hình, còn hạn thì chạy lại
   đầy đủ `runLogin` với đúng `source` cũ (không nâng thành manual). Gợi kiểm khi: trang CRM đổi tiêu đề thành
   `RENEWAL_ORDER_COMPLETED_TITLE`, cửa sổ được focus (cách lần trước ≥ 20 giây), mỗi 60 giây khi màn đang hiện
   (dừng sau 30 phút), hoặc khách bấm "Tôi đã thanh toán – vào phần mềm".
6. `renewal_ended`: gói đã còn hạn nhưng đăng nhập vướng bước khác (khoá máy…) hoặc phiên gia hạn đã hết → về màn
   đăng nhập kèm câu báo. Chính sách/đăng nhập thủ công đi tiếp như luồng thường.

IPC: `AUTH_RENEWAL_RECHECK`, `AUTH_RENEWAL_CANCEL`, `AUTH_RENEWAL_OPEN_EXTERNAL` (ký link mới rồi
`shell.openExternal`), `AUTH_RENEWAL_WEB_PREPARE`, `AUTH_RENEWAL_WEB_RELOAD`, sự kiện `AUTH_RENEWAL_WEB_STATE`,
`AUTH_RENEWAL_REQUIRED`.

## Bảo mật

- Khóa `RENEWAL_PORTAL_LINK_SECRET` chỉ ở Supabase Edge secrets và Fly `aka10000`; không vào bộ cài.
- `sub` lấy từ kết quả `aka_agent_desktop_session_admin('check')`; `opid` chỉ nhận dòng sản phẩm akaAgent của
  chính tổ chức. Token sống 10 phút, mỗi lần mở/tải lại tạo mới, không ghi log, không qua renderer; CRM tự xoá `?t=`.
- Webview: sandbox, không preload, chỉ điều hướng trong cổng; link ngoài/popup mở trình duyệt; chỉ cấp quyền ghi
  clipboard; chặn tải file; khi đóng màn xoá storage/cache/kết nối của phân vùng.
- Không thêm connection/pool. Kiểm lại dùng endpoint đăng nhập hiện có, tối đa 1 request/phút khi màn hiện.
- Link mở được cổng của tổ chức; người có mật khẩu vốn đã đăng nhập được cổng bằng form CRM.

## Edge `renewal_link` — bản vá cần áp vào source riêng

**Hoãn theo quyết định ngày 04/11/2026.** Hiện chạy bằng trang đăng nhập cổng: Edge chưa vá trả 400, app nạp
`/gia-han?next=<trang>` và khách gõ lại tên đăng nhập + mật khẩu akaAgent trên trang CRM. Khi áp bản vá dưới đây
và đặt khoá, app tự chuyển sang link ký số, không cần phát hành lại. Hai hệ quả của chế độ này: (1) không có `opid`
nên trang đích CRM tự chọn theo mọi sản phẩm của tổ chức; đo 04/11, CRM chọn sản phẩm không phải akaAgent cho 4/766
tổ chức đã hết hẳn akaAgent; (2) khách quen đăng nhập tự động có thể quên mật khẩu, mà Lấy lại tài khoản cần email
(mục CRM), nên cần đặt liên hệ hỗ trợ trên Fly.

Source `aka-agent-desktop-session` nằm ở kho bảo mật ngoài repo (xem
[README](../supabase/functions/aka-agent-desktop-session/README.md)). Thêm vào handler live, giữ nguyên mọi quy tắc
chặn IP và thao tác hiện có. Helper ký (WebCrypto, không thư viện):
[`supabase/functions/_shared/renewalPortalLink.ts`](../supabase/functions/_shared/renewalPortalLink.ts) — chép kèm khi
deploy từ kho bảo mật.

```ts
import { createRenewalPortalLink, pickRenewalOrganizationProductId, RenewalLinkUnavailable } from '../_shared/renewalPortalLink.ts'

// Danh sách action và key được phép:
if (!['check', 'login', 'register', 'logout', 'renewal_link'].includes(action)) throw new InvalidRequest()
const allowed = action === 'logout' ? ['action', 'accessToken']
  : ['action', 'username', 'password', 'fingerprintHash',
    ...(action === 'register' ? ['accessToken'] : []), ...(action === 'renewal_link' ? ['opid'] : [])]

// Ngay sau nhánh 'check':
if (action === 'renewal_link') {
  if (body.opid !== undefined && (typeof body.opid !== 'number' || !Number.isSafeInteger(body.opid) || body.opid <= 0)) throw new InvalidRequest()
  const checked = await call('check', credentials) // cùng xác thực/time_allowed/app access như đăng nhập
  try {
    const link = await createRenewalPortalLink({
      staffId: checked.staffId,
      organizationProductId: pickRenewalOrganizationProductId(checked.products, body.opid),
      secret: Deno.env.get('RENEWAL_PORTAL_LINK_SECRET'),
      origin: Deno.env.get('RENEWAL_PORTAL_ORIGIN')
    })
    return new Response(JSON.stringify(link), { headers }) // { url, expiresAt }, Cache-Control: no-store
  } catch (error) {
    if (error instanceof RenewalLinkUnavailable) return new Response(JSON.stringify({ error: 'renewal_link_unavailable' }), { status: 503, headers })
    throw error
  }
}
```

Secrets: `supabase secrets set RENEWAL_PORTAL_LINK_SECRET=<cùng giá trị Fly aka10000>` (≥ 32 ký tự, CRM dùng nguyên
chuỗi đã trim làm khóa HMAC). `RENEWAL_PORTAL_ORIGIN` để trống = `https://crm.akabiz.net`. Chưa áp bản vá → Edge trả
400 cho action lạ, Desktop tự dùng trang đăng nhập cổng.

Kiểm chéo không cần deploy: `CRM_REPO=<checkout SqlServerDashboard đã npm ci> node scripts/renewal-portal/renewal-portal-contract-test.mjs`.

## DB

- **Đã đổi 04/11/2026 15:42 VN** (được duyệt trực tiếp): `auto_system_settings` id 43
  `akabiz.links.upgrade_payment` `https://akabiz.net/` → `https://crm.akabiz.net/gia-han`. Key dùng chung cho mọi
  sản phẩm; card "Nâng cấp và thanh toán" của mọi bản Desktop nhận ngay. Hoàn tác: đặt lại value cũ.
- **[V460](../migrations/migration_v460_desktop_login_renewal_links.sql) — chưa apply.** Thêm
  `akabiz.links.recover_account`, `akabiz.links.trial_signup` vào `aka_agent_desktop_login_content()` và seed 2 row.
  Live trước: md5 `997f54ddf67f808a1b3ac47596981036` (owner postgres, SECURITY DEFINER, STABLE,
  `search_path=pg_catalog`, ACL postgres/anon/service_role). Đích: `8ac766131b581f03fcf21faf31809356`. Thử trong
  transaction tự huỷ trên production 04/11: đích đúng md5, ACL giữ nguyên, RPC trả 2 key mới; áp rồi
  [rollback](../migrations/rollback_v460_desktop_login_renewal_links.sql) trả về đúng md5 cũ; sau thử live vẫn md5 cũ,
  0 row mới. Chưa apply thì Desktop dùng link mặc định trong `src/shared/renewalPortal.ts`. Apply ngoài 14–16h VN vì
  `CREATE OR REPLACE` làm PostgREST nạp lại schema. Lúc thử còn đánh số V456; đổi sang V460 ngày 04/11 vì V456–V459
  đã được dùng trên `dev_3` (V456 email đã apply). Kiểm lại live trước khi merge: md5, owner, ACL, cấu hình như trên,
  0 row seed.

## CRM (SqlServerDashboard, nhánh `dev_auto_nang_cap`)

- `preferredRenewalPackageId`: gia hạn chọn sẵn đúng gói trả phí đang dùng nếu còn bán.
- Trang Nâng cấp đổi tiêu đề thành `RENEWAL_ORDER_COMPLETED_TITLE` khi đơn `completed` (hợp đồng với
  `src/shared/renewalPortal.ts`, phải đổi cả hai bên).
- Cần đặt trên Fly: `RENEWAL_PORTAL_LINK_SECRET` (nếu chưa), `RENEWAL_PORTAL_SUPPORT_PHONE`,
  `RENEWAL_PORTAL_SUPPORT_ZALO_URL` (catalog production 04/11 trả `null`, trang Lấy lại tài khoản chưa có nút liên hệ).
- Lấy lại tài khoản cần email + SĐT khớp; 04/11 chỉ 17/1.837 tổ chức và 18/1.904 nhân viên có email.

## Kiểm chứng và trạng thái

Đã chạy 04/11/2026: hai typecheck Desktop, `npm run build`, contract test 12 PASS (gồm xác minh bằng `jsonwebtoken`
của CRM), token Edge qua đúng `verifyRenewalLinkToken` của CRM (sai khóa bị từ chối), test CRM
`renewal-portal.test.ts` 28 PASS, thử V460/rollback tự huỷ trên production.

Chưa làm: chạy Electron với tài khoản hết hạn thật, deploy Edge `renewal_link` (hoãn, xem mục Edge), apply V460, deploy CRM, đặt biến
môi trường Fly, thanh toán thật, đóng gói/phát hành Desktop, kiểm Windows/Mac thật.

Dữ liệu 04/11: 595 tổ chức chỉ còn dùng thử hết hạn (69 mở app trong 30 ngày), 173 tổ chức hết hạn gói (21 mở app
trong 30 ngày), 10 tổ chức chế độ tách quyền (1 hết gói akaAgent, 2 chưa có gói).

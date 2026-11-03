# Rà soát nguồn danh tính Zalo sau V451 — 03/11/2026

V451 đã apply theo chỉ thị lúc **11:15:06 Việt Nam**, ledger `20261103041506`.
[Receipt apply](canonical-identity-apply-receipt-20261103.json).
Rà soát tiếp theo là read-only với production; các repro dùng PostgreSQL disposable.
**Có ba nhóm kiểm tra ID cũ còn lại, chưa sửa trong lượt này.**
[Kết quả/giới hạn kiểm chứng](identity-check-audit-verification-20261103.json).

## 1. Trigger khi xác nhận trạng thái đăng nhập vẫn lấy ID legacy

`private.app_access_reserve_enabled_identity()` sau V451 có MD5
`66a710beb5d36f03d16d4684fd1a5385`. Nhánh bỏ reserve chỉ dành cho đổi cờ Chat
thuần túy. Khi `login_status` đổi sang `đã đăng nhập`, hàm vẫn gọi
`app_access_reserve_chat_identity(NEW.id,org,NEW.zalo_account_id)`.
Nguồn: `migrations/migration_v451_chat_canonical_identity.sql:145–156`.

- Chat API `packages/database/src/chatAccountManagementRepository.ts:972–983`
  hoàn tất Server QR bằng binding/profile Zalo thực rồi UPDATE login_status;
  không thay `auto_accounts.zalo_account_id`. Nếu dòng này có ID legacy khác
  Zalo vừa quét, trigger từ chối `account_already_has_another_zalo`, rollback
  bước lưu QR dù binding được dựng đúng. Trường hợp ID legacy trỏ binding khác
  cũng có thể bị báo `zalo_already_linked`.
- `aka_agent_app_access_local_session(...,'mark',...)` cũng chỉ đổi trạng thái/
  timestamps; local session đã xác thực có thể bị cùng trigger từ chối nếu ID cũ
  lệch binding. Desktop `checkSession`/warm session đi qua nhánh này.

Repro local: first5 thật trên fixture legacy; bật Chat cho Server unbound đang
đăng xuất thành công; tạo binding từ profile giả lập mới rồi chạy đúng UPDATE
cuối của Server QR thì thất bại. Control cùng profile/binding với legacy ID NULL
thành công. Public RPC local `mark` cũng tái hiện thất bại. Không quét QR/provider
thật, không chạy toàn HTTP Server QR trong test này.

Hướng sửa cần chuẩn bị riêng: phân biệt xác nhận binding Server hiện có với cấp
reservation mới từ session local; không dùng ID legacy để đối chiếu lại một
binding đã được kiểm tra bằng profile thực. Giữ các guard dành cho actual QR
candidate, tenant/claim/session/generation và tái sử dụng binding đã xóa.
Phần này nằm ở DB, không cần build Desktop.

## 2. Đăng ký runtime local kiểm legacy ID trước binding

Chat API `packages/database/src/chatAccountManagementRepository.ts:1050–1082`
JOIN `zalo_accounts` qua `auto_accounts.zalo_account_id` và bắt UID đó khớp
`expectedZaloId` trước khi đọc binding. Vì vậy khi actual candidate khớp binding
Chat nhưng legacy ID lệch, `validateLocalRuntimeCandidate()` cho qua, còn
`registerLocalRuntime()` báo không tìm thấy tài khoản local đã đăng nhập.

Đã gọi hai method repository thật trên cùng fixture có lịch sử trước first5 và
xác nhận sự khác nhau. Repro không chứng minh session giả lập đã login provider;
nó chứng minh guard DB dùng hai nguồn ID khác nhau cho cùng candidate/binding.
Khi legacy ID NULL, INNER JOIN cũng loại row trước khi xét binding.

Hướng sửa cần giữ bằng chứng session thực do runtime xác minh, scope chủ/org,
claim/generation và lock, rồi dùng binding canonical cho account đã liên kết.
Không chỉ bỏ điều kiện expected UID hoặc tin vào payload của client. Phần này
cần source và deploy **Chat API** nếu triển khai; chưa sửa/deploy trong lượt audit.

## 3. Duplicate legacy trước khi xét binding — lỗi P2 đã hoãn

`private.app_access_reserve_chat_identity(bigint,bigint,bigint)` có MD5 live
`e1b81ef404854cd4290496a9dfc0ff46`; chưa đổi từ V445.
Nhánh đầu so `a.zalo_account_id=p_zalo` trên dòng khác Chat=true, logged-in,
chưa xóa, trước khi xét binding canonical của chính account đang đăng nhập.
Nguồn tương ứng: `migrations/migration_v445_app_access_schema.sql:378–386`.

Legacy duplicate được first5 bảo toàn có thể chặn chính dòng đang giữ binding
hợp lệ. Repro tạo hai dòng legacy cùng UID, một binding chính chủ; sau first5,
reservation của chủ binding bị từ chối. Cho dòng duplicate về logged-out trong
DB disposable thì cùng reservation thành công. Đây là P2 đã thống nhất tạm hoãn,
không phải lỗi mới do V451 tạo ra. Một P2 khác về thứ tự khóa vẫn ngoài audit này.

Không được bỏ toàn bộ kiểm tra dòng unbound logged-in: nó còn giữ chỗ trong lúc
đợi enrollment tái sử dụng binding của account đã xóa. Cần sửa có phân biệt
canonical binding và reservation hợp lệ, kiểm tranh chấp hai account. Phần này ở DB.

## Dữ liệu live tại 11:20:53 Việt Nam

Quét Zalo QR local/Server chưa xóa trong các tổ chức từng có product 5; xử lý cả
`organization_id=NULL` bằng org của chủ, bỏ row sai tenant. Không đọc raw session.

- **0** dòng đã có binding nhưng legacy UID khác binding UID.
- **0** dòng Chat-enabled/logged-in có legacy UID đụng binding của dòng khác.
- **3** Server unbound đang logged-out còn legacy ID: **9701, 9709** (org 1835)
  và **9963** (org 1879). Cả ba hiện Chat=false. Đây là dữ liệu có thể đi vào
  trường hợp 1 nếu được bật Chat rồi login Zalo khác ID cũ; không khẳng định đang lỗi.

Không sửa account/owner/binding/flags hoặc làm mới session của các dòng này.
Trường hợp `zl MN` bật đồng bộ đã được xử lý bởi V451; QR local mới vẫn commit
actual Zalo ID cùng session qua receipt, nên không tự suy các lỗi trên xảy ra
với mọi lần đăng nhập hoặc riêng `zl MN`.

## Các đường đã khớp nguồn và phạm vi

- Chat Web account list đọc ID/tên từ binding → `chat_zalo_account`; không lấy
  tên để chống trùng.
- Server QR candidate và local candidate API đối chiếu profile thực với binding;
  Server runtime assignment lấy `expected_zalo_id` từ Chat identity và adapter
  so với UID thực sau login. Các guard này cần giữ.
- Desktop local QR kiểm actual profile trước lưu; DB QR commit kiểm actual
  `zaloAccountId` cùng claim/receipt trước cập nhật session. Chỗ duplicate trong
  helper dùng chung vẫn còn như mục 3.
- Web/PWA API và UI app-access gọi backend/RPC hiện có; không có thêm bộ kiểm tra
  trùng từ tên hoặc ID legacy trên client trong luồng bật/tắt đã rà.
- Các reader của akaAgent/Web vẫn có projection metadata từ `zalo_accounts`;
  khác tên hiển thị không tự đồng nghĩa sai guard quyền/danh tính. Không đổi UI.

Rà source akaAgent, Chat API, Chat Web, WebApp/API và akaBizApi; đối chiếu live
catalog/function và trigger liên quan. Không audit toàn bộ nghiệp vụ Zalo ngoài
identity/Chat enrollment hoặc chứng nhận mọi runtime production.

## Chạy lại repro

Trong repo Chat API, sau build hiện có:

```bash
APP_ACCESS_IDENTITY_AUDIT=1 \
PHASE1_PG_BIN=/opt/homebrew/opt/postgresql@17/bin \
AKA_AGENT_REPO=/Users/lequangnhut/.codex/worktrees/app-access-akaagent/akaAgent \
node load-tests/app-access.mjs
```

Harness feature **230 ca đạt**; module `app-access-identity-audit.mjs` xác nhận
**4 repro hành vi lỗi hiện tại** của ba nhóm trên. Diagnostic dùng assertion
expected rejection để giữ bằng chứng, không được hiểu là các lỗi đã được sửa.
Tái sử dụng hai client local sẵn có, không thêm connection/polling production,
không gửi tin hoặc chạy campaign. Source audit không yêu cầu deploy.

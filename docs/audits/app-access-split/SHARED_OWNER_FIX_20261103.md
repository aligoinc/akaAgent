# Chia sẻ Chat khi chủ tài khoản bị khóa hoặc hết hạn — V449

Bổ sung sau review: [V450 đã apply để sửa cấp lần đầu/bật lại Chat Server](SHARED_OWNER_GRANT_FIX_20261103.md).
V449 và kết quả kiểm chứng dưới đây được giữ nguyên.

**Đã apply production** `akachat / cgjbsmqtfhqvttudyjzq` lúc **09:52:08 Việt Nam, 03/11/2026**.
Ledger: `20261103025208 / migration_v449_chat_shared_owner_access`.
Không apply lại. [Receipt và hậu kiểm](shared-owner-receipt-20261103.json).

## Hành vi sau sửa

V445 đặt điều kiện chủ tài khoản đang hoạt động và còn hạn ở nhánh chung của
helper tài khoản. Vì vậy, tổ chức chuyển sang quyền riêng bị mất quyền Chat trên
tài khoản có chủ bị khóa/hết hạn, dù đồng nghiệp nhận chia sẻ vẫn đủ quyền Chat.
V449 chuyển đúng hai điều kiện này sang nhánh akaAgent.

- Chat vẫn yêu cầu account chưa xóa, chủ tồn tại/chưa xóa và đúng tổ chức, cờ
  Chat bật, Zalo QR/Server và gói product 5 hợp lệ. Chủ bị khóa/hết hạn không
  tự làm account mất điều kiện dùng Chat.
- Người sử dụng vẫn phải qua xác thực staff, quyền Chat hiện tại và ACL tài
  khoản/hội thoại. Chủ bị khóa/hết hạn vẫn bị từ chối đăng nhập và thao tác.
- akaAgent vẫn kiểm trạng thái/thời hạn/quyền của chủ; không cho chạy chiến
  dịch trên các tài khoản này. Legacy giữ nguyên.
- Không đổi cờ cấp quyền, quota, trạng thái staff, chủ sở hữu, chia sẻ, binding,
  phiên Zalo hoặc lịch sử. Không tự đăng nhập hay tự cấp chia sẻ cho ai.
- QR local vẫn cần máy giữ kết nối và staff host đủ quyền akaAgent. Sửa helper
  Chat không cho phép staff bị khóa/hết hạn giữ Desktop runtime; trường hợp đó
  cần xử lý host/Server theo luồng hiện có, không tạo phiên thứ hai.

## Phạm vi SQL và nguồn chuẩn

Chỉ sửa `public.aka_agent_app_access_account_allowed(bigint,text)` từ exact live
definition đã capture; không thay các hàm auth/session/RPC khác.

| Thuộc tính | Trước | Sau |
| --- | --- | --- |
| MD5 `pg_get_functiondef` | `694f41f6896f5c031f76a181ee0d9286` | `daf197a1cc419fd29030338e2ef2c936` |
| Owner / security / volatility | `postgres` / SECURITY DEFINER / STABLE | Giữ nguyên |
| EXECUTE | `postgres`, `service_role`, `aka_agent_desktop`, `aka_agent_chat_api` | Giữ nguyên; `anon`/`authenticated` bị từ chối |
| Config | `search_path=pg_catalog, public, private` | Giữ nguyên; không thêm function timeout |

Tài liệu nguồn:

- [Migration V449](../../../migrations/migration_v449_chat_shared_owner_access.sql):
  preflight/postflight kiểm body, owner, ACL, config và metadata fail-closed.
- [Capture baseline và phụ thuộc](../../../migrations/snapshots/chat-shared-owner/baseline.json).
- [Canonical target](../../../migrations/snapshots/chat-shared-owner/target-definition.sql).
- [Production rehearsal](../../../migrations/snapshots/chat-shared-owner/production-trial.sql):
  candidate, assertions, rollback hẹp và kết thúc `ROLLBACK`.
- [Rollback hẹp](../../../migrations/snapshots/chat-shared-owner/rollback.sql):
  chỉ phục hồi điều kiện cũ của helper này nếu có chỉ thị rollback; không tắt
  V447 hay thay cờ người dùng. Đã thử local và trong rehearsal production,
  **không áp dụng rollback sau lần apply thật**.

Không thay schema/return type/signature nên không yêu cầu manual PostgREST
reload. Các DDL event trigger hiện có vẫn bật. Migration chỉ dùng timeout
transaction cục bộ `lock_timeout=5s`, `statement_timeout=20s`; không tăng pool,
connection production, polling, replica hoặc global timeout.

## Kiểm chứng

Local PostgreSQL 17 disposable đạt **144 ca**, gồm **46 ca mới**:

- Chủ khóa/hết hạn; người nhận khóa/hết hạn/tắt Chat/xóa; thiếu ACL, hỗ trợ trực
  tiếp hội thoại và cross-tenant; chủ/account xóa, sai platform/subtype/tenant;
  Chat tắt/gói hết hạn/xóa; account org NULL; quota không đổi.
- Route HTTP account-access thật cùng `ChatStaffRepository`; repository danh
  sách, SQL ACL hội thoại và scope CTE, dispatch permission và Server runtime
  assignment thật. Không chỉ kiểm helper qua mock.
- Chủ bị chặn HTTP/snapshot, campaign claim và local runtime; kiểm EXECUTE các
  role, drift metadata/ACL, apply lặp, trial rollback, rollback hẹp và reapply.

Harness ở repo Chat API: `load-tests/app-access-shared-owner.mjs`, được gọi từ
`load-tests/app-access.mjs`. Sau `npm run build`, chạy với `AKA_AGENT_REPO` trỏ
checkout chứa V449: `node load-tests/app-access.mjs`. Chỉ dùng PostgreSQL local
disposable; không dùng URL production. Fixture quyền/table chỉ phục vụ test,
không phải SQL triển khai.

Chat API full suite đạt **120 files / 1.756 tests**; `npm run build` (TypeScript)
đạt. akaAgent đạt cả `tsconfig.node.json` và `tsconfig.web.json` typecheck.

Rehearsal production đối chiếu **596 account, 76 staff, 1.297 hàm** rồi rollback
sạch. Chỉ 7 account org 1 đổi Chat eligibility; quyền akaAgent, staff và legacy
không đổi. Lần rehearsal đầu thử `SET LOCAL ROLE aka_agent_chat_api` bị Management
postgres từ chối và toàn transaction rollback; sau đó kiểm ACL/schema privilege
trên production, kiểm thực thi role/HTTP bằng PG17 local. Không mở quyền để
vượt giới hạn Management API và không coi đó là kiểm HTTP production.

Hậu kiểm sau apply:

- Account org 1: `2666`, `3359`, `4949`, `4992`, `4993`, `4994`, `7025` đều
  `chat_allowed=true`, `agent_allowed=false`; các chủ vẫn bị khóa, quyền staff
  Chat/Agent đều false.
- Org 1 có **35/35 account bật Chat đủ điều kiện Chat** (trước sửa 28/35).
  Suất staff Chat vẫn **25/100**. Đây là eligibility, không phải số phiên Zalo
  đang đăng nhập hay bằng chứng đã chia sẻ cho người khác.
- Metadata helper giữ nguyên; **1.296 hàm khác**, mọi RLS policy và trigger
  không nội bộ có fingerprint không đổi. V447 vẫn bật. Chi tiết trong receipt.

## Trạng thái bàn giao

Source SQL/audit ở akaAgent; regression harness/tài liệu ở Chat API. Không đổi
runtime TypeScript, Chat Web, WebApp hay CRM. **Không cần deploy service hoặc
build lại Desktop/App Server cho sửa này**; lần này không deploy, đóng gói,
upload/phát hành bộ cài. Không gửi tin/chạy chiến dịch thật hoặc kiểm provider/UI
production. Source vẫn cần được đưa vào nhánh chính qua quy trình PR riêng;
merge PR sau này không phải chỉ thị apply lại V449.

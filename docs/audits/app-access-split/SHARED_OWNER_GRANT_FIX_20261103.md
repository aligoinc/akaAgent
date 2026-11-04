# Cấp lại quyền Chat Server khi chủ bị khóa/hết hạn — V450

**Đã apply production** `akachat / cgjbsmqtfhqvttudyjzq` lúc **10:21:32 Việt Nam,
03/11/2026**. Ledger `20261103032132 / migration_v450_chat_shared_owner_grant`.
Không apply lại. [Receipt và hậu kiểm](shared-owner-grant-receipt-20261103.json).

## Lỗi và hành vi sau sửa

[V449](SHARED_OWNER_FIX_20261103.md) đã bỏ điều kiện khóa/hết hạn của chủ khỏi
quyền hiệu lực Chat. Tuy nhiên trigger cấp quyền còn kiểm điều kiện này cho cả
hai app: admin tắt Chat được nhưng bật lại trả `app_access_denied`, dù gói/quota
đủ. Review đã tái hiện bằng RPC thật trên PG17 cho cả chủ khóa và hết hạn.

V450 chỉ sửa `private.app_access_validate_account(public.auto_accounts,public.auto_accounts)`:

- Chat trên Zalo Server được cấp lần đầu hoặc bật lại cho tài khoản có chủ bị
  khóa/hết hạn, qua actor có quyền quản lý hiện hành.
- Chủ vẫn phải tồn tại, chưa xóa, đúng tổ chức. Gói, quota theo chủ, Zalo
  subtype, khóa transaction và chống trùng danh tính giữ nguyên.
- akaAgent và QR local giữ kiểm tra chủ hoạt động/còn hạn. QR local còn yêu cầu
  quyền akaAgent của host; không mở kết nối cho staff bị khóa.
- Staff login/refresh, quyền người nhận, ACL chia sẻ và quyền hiệu lực V449
  giữ nguyên. Không tự bật cờ, tạo chia sẻ, đổi chủ hoặc đăng nhập Zalo.
- Legacy, bypass bootstrap first5, bỏ qua quyền đã cấp không thay đổi và cleanup
  dòng xóa giữ nguyên. Không sửa V449 hoặc migration đã live.

## Nguồn chuẩn và migration

| Thuộc tính | Trước | Sau |
| --- | --- | --- |
| MD5 `pg_get_functiondef` | `ff633bcc1b189376d584685f1b6decf7` | `bb948da088b5a8be76f9516e08255a14` |
| Owner / security / volatility | `postgres` / SECURITY DEFINER / VOLATILE | Giữ nguyên |
| ACL helper private | `{postgres=X/postgres}` | Giữ nguyên; không cấp EXECUTE cho client/backend |
| Config | `search_path=pg_catalog, public, private` | Giữ nguyên |

Capture exact live lúc 10:15:58 VN trước khi dựng SQL. Đối chiếu V445–V449,
caller/trigger, quota/time helpers và FK staff. Chỉ thay điều kiện trong nhánh
kiểm tra cấp quyền; không thêm query, index, nguồn connection, pool hoặc polling.

- [Baseline và metadata phụ thuộc](../../../migrations/snapshots/chat-shared-owner-grant/baseline.json).
- [Migration V450](../../../migrations/migration_v450_chat_shared_owner_grant.sql):
  checksum/owner/ACL/config/security/volatility và metadata có guard fail-closed.
- [Canonical target](../../../migrations/snapshots/chat-shared-owner-grant/target-definition.sql).
- [Rehearsal production](../../../migrations/snapshots/chat-shared-owner-grant/production-trial.sql).
- [Hậu kiểm](../../../migrations/snapshots/chat-shared-owner-grant/production-postcheck.sql).
- [Rollback hẹp](../../../migrations/snapshots/chat-shared-owner-grant/rollback.sql):
  khôi phục riêng validator trước V450, giữ V449/V447; chỉ dùng khi có chỉ thị
  rollback. Đã thử trước apply thật, không rollback sau apply.

Không đổi API signature, return type hoặc quyền nên không cần manual PostgREST
reload. DDL event triggers hiện có vẫn bật. Timeout transaction migration là
`lock_timeout=5s`, `statement_timeout=20s`; không sửa function/global timeout.

## Kiểm chứng

**188 ca native PostgreSQL 17 đạt**, gồm 144 ca trước đó và **44 ca V450**:

- Negative control trước sửa tái hiện lỗi cho chủ khóa/hết hạn; sau sửa admin
  tắt/bật lại và cấp lần đầu thành công, cờ akaAgent không bị ghi đè.
- Retry cùng request ID không thêm receipt/suất; đổi payload cùng ID bị từ chối.
  Hai caller tranh suất cuối chỉ một thành công, dùng hai client local sẵn có.
- Actor khóa/hết hạn/xóa, chủ tự thao tác khi bị khóa/hết hạn, staff không được
  chia sẻ, chủ xóa/sai tenant bị từ chối. Account org NULL vẫn theo chủ.
- Hết gói/xóa gói, hết suất, max_accounts NULL/0, subtype không hỗ trợ, trùng
  Zalo (rollback cờ/quota/receipt), local QR và quyền akaAgent được kiểm tra.
- RPC hiện có dưới `aka_agent_chat_api`, `service_role` và Desktop admin có
  receipt; mọi role ngoài postgres vẫn không được gọi trực tiếp helper private.
  Không cấp thêm quyền trong production để chạy test.
- Drift body/metadata/ACL, trial ROLLBACK, apply lặp bị chặn, rollback hẹp và
  reapply đạt. Rollback V450 không làm mất hành vi V449.

Harness Chat API `load-tests/app-access-shared-owner-grant.mjs` được gọi từ
`load-tests/app-access.mjs`. Sau `npm run build`, chạy:

```bash
PHASE1_PG_BIN=/path/to/postgresql17/bin AKA_AGENT_REPO=/absolute/path/to/akaAgent node load-tests/app-access.mjs
```

Cần PG17 để canonical checksum view/function khớp production; PG16 tự chọn
bởi `pg_config` có thể báo `app_access_view_drift` từ harness V445.
Hai typecheck akaAgent và build TypeScript Chat API đạt trong lượt V450.
Không chạy lại full suite API vì không sửa production TS; kết quả 1.756 tests
trong audit V449 thuộc lượt trước.

Production rehearsal dùng bản sao composite của 7 account org 1, **không UPDATE
tài khoản thật**. Trước sửa cả 7 bị từ chối cấp lại; sau sửa 6 Server được phép,
QR local `2666` vẫn bị từ chối vì chủ bị khóa. Đối chiếu 405 account org 1 và
1.297 hàm, thử rollback hẹp rồi kết thúc ROLLBACK; read-back xác nhận source
checksum trước apply thật.

Hậu kiểm sau apply xác nhận 7 probe đúng kỳ vọng; 1.296 hàm khác, RLS policies,
noninternal triggers, cờ account và cờ/trạng thái/thời hạn staff không đổi.
V447 vẫn bật; 7 account vẫn có Chat eligibility từ V449, chủ vẫn bị khóa và
akaAgent bị từ chối. Không suy ra QR local có runtime online hoặc tài khoản đã
được chia sẻ cho người khác từ kết quả eligibility.

Production chỉ kiểm metadata/ACL và validator với bản sao row; không thực thi
HTTP/UI, đổi quyền thực, gửi tin hoặc chạy chiến dịch. Thực thi caller role và
RPC mutation được kiểm trên PG17 local.

## Bàn giao

Source migration/audit ở akaAgent; regression harness/tài liệu ở Chat API.
**Không cần deploy service hoặc build lại Desktop/App Server**. Lượt này không
deploy, đóng gói/phát hành hoặc đổi CRM. Source chưa commit/push/tạo PR; merge
sau này không phải chỉ thị apply lại V449/V450.

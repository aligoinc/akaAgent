# Liên kết Chat là nguồn danh tính khi bật đồng bộ — V451

**Đã apply 11:15:06 Việt Nam ngày 03/11/2026**, ledger `20261103041506`,
trên `cgjbsmqtfhqvttudyjzq`; không apply lại. Không deploy/build bộ cài. Giữ V449/V450.
[Receipt apply](canonical-identity-apply-receipt-20261103.json),
[kiểm chứng trước apply](canonical-identity-verification-20261103.json).

[Rà soát sau apply](IDENTITY_CHECK_AUDIT_20261103.md) tìm thấy ba nhóm kiểm tra
legacy ID còn lại ở login-status trigger, local registration và duplicate
reservation đã hoãn. V451 chỉ sửa bật quyền; các nhánh này chưa sửa.

## Vấn đề và hành vi mới

Danh sách akaChat lấy Zalo ID/tên từ `chat_zalo_account_organization` →
`chat_zalo_account`. Trong khi đó validator bật Chat luôn lấy `zalo_accounts.zalo_uid`
qua `auto_accounts.zalo_account_id`, kể cả đã đăng xuất và chưa có liên kết Chat.
Vì vậy tài khoản có ID cũ có thể hiện “Chưa xác định Zalo” nhưng bật lại báo trùng.
Đã tái hiện trường hợp account 192; không thay đổi cờ, session hoặc liên kết của người dùng.

V451 dùng liên kết Chat hiện có làm nguồn chuẩn cho **bật quyền Chat**:

- Có binding: dùng Zalo ID của binding, kiểm tenant, giữ nguyên ID/tên/lịch sử/generation.
- Chưa có binding và đang đăng xuất: bỏ qua ID legacy khi cấp quyền; không tạo binding giả.
- Chưa có binding và đang đăng nhập: vẫn kiểm và reserve ID đang dùng trong transaction.
- Trigger chỉ bỏ reserve lại từ ID legacy khi thay cờ trên dòng đã có binding cùng org,
  không đổi owner/tenant/identity/login/session hoặc undelete. Các thay đổi này vẫn qua guard cũ.
- QR candidate và commit vẫn dùng Zalo ID thực vừa quét, giữ reservation/UNIQUE/claim/receipt.
  Zalo đã thuộc dòng khác còn tồn tại vẫn bị từ chối; binding của chính dòng cũng không được đổi sang Zalo khác.
- Tên hiển thị không phải khóa chống trùng. Không đổi tên tự đặt của auto account.

Giữ V449/V450, quota, auth/actor/tenant, host QR local, policy legacy/separate và
luồng tái sử dụng binding của dòng đã xóa. Không sửa `is_chat_sync`, schema quyền,
CRM, reader/list API hoặc runtime. Hai P2 đã hoãn về legacy duplicate khi QR commit
và thứ tự khóa binding/account vẫn ngoài phạm vi; không coi V451 là xử lý toàn bộ dữ liệu cũ.

## Exact live capture và migration

Production đã xác nhận `akachat / cgjbsmqtfhqvttudyjzq`, PostgreSQL 17.
[Baseline mới](../../../migrations/snapshots/chat-canonical-identity/baseline.json)
chứa exact live definitions và metadata của hai hàm thay đổi cùng ba dependency.
Candidate dựng từ live V450/V445, không dựng lại từ migration lịch sử.

| Signature | Source MD5 | Target MD5 |
| --- | --- | --- |
| `private.app_access_validate_account(auto_accounts,auto_accounts)` | `bb948da088b5a8be76f9516e08255a14` | `f9f8f66c263a45c7196808f1781a64cf` |
| `private.app_access_reserve_enabled_identity()` | `ddc0b1c0b4e11534cc5e8a403ec07158` | `66a710beb5d36f03d16d4684fd1a5385` |

Cả hai vẫn owner postgres, SECURITY DEFINER/VOLATILE, ACL `{postgres=X/postgres}`,
search_path `pg_catalog, public, private`; giữ parallel/leakproof/strict/cost/rows.
Preflight/postflight kiểm body và toàn bộ metadata, bao gồm ba dependency không đổi:
`app_access_reserve_chat_identity(bigint,bigint,bigint)`, `app_access_guard_flags()` và
`aka_agent_app_access_qr_operation(bigint,bigint,uuid,text,jsonb)`. Drift thì dừng.

- [Migration canonical](../../../migrations/migration_v451_chat_canonical_identity.sql).
- [Target definition](../../../migrations/snapshots/chat-canonical-identity/target-definition.sql).
- [Rollback hẹp](../../../migrations/snapshots/chat-canonical-identity/rollback.sql): chỉ trả hai hàm về live trước V451;
  giữ activation/V449/V450 và mọi quyết định quyền/dữ liệu, nhưng lỗi từ chối ID cũ sẽ quay lại.
- [Trial production](../../../migrations/snapshots/chat-canonical-identity/production-trial.sql): chỉ truyền bản sao row,
  thử candidate và rollback trong cùng transaction kết thúc `ROLLBACK`, không UPDATE account/binding.

## Kiểm chứng

Harness Chat API `load-tests/app-access-canonical-identity.mjs` tái sử dụng hai client
của PostgreSQL disposable hiện có. Tổng **230 ca**, gồm **42 ca mới**. Hai negative
control tái hiện lỗi trên hàm live cũ trước khi cài candidate vào DB local.

Bao phủ logged-out stale ID; binding canonical ở local/Server, online/offline;
quyền qua service_role/Chat API/Desktop với credential fixture; receipt/retry;
quota và tranh suất cuối; tranh identity; không đổi flag app còn lại; locked owner;
tenant/actor/subtype/package/host; ACL private; QR candidate + public commit đúng/sai
ID; thu hồi quyền sau begin giữ claim; drift/reapply fail-closed; rollback hẹp.

```bash
PHASE1_PG_BIN=/opt/homebrew/opt/postgresql@17/bin \
AKA_AGENT_REPO=/Users/lequangnhut/.codex/worktrees/app-access-akaagent/akaAgent \
node load-tests/app-access.mjs
```

Hai typecheck akaAgent và `npm run build` Chat API đạt. Không gửi tin, login Zalo
thật hoặc chạy chiến dịch; chưa canary UI qua bộ cài thật. Không rerun toàn bộ
unit suite API cho V451 vì chỉ đổi SQL và harness; full suite của V449 đã ghi riêng.

Trial production đạt: bản sao account 192 bật được khi logged-out, đổi bản sao
sang logged-in vẫn báo trùng; bản sao account đã có binding dùng binding dù legacy
ID khác. Fingerprint flags/bindings và mọi function public/private khác không đổi.
Hậu kiểm sau ROLLBACK xác nhận cả năm definitions/owner/ACL/config trở về baseline.
Trial không lưu mutation/receipt nghiệp vụ. Sau chỉ thị apply, recapture khớp cả 5 signatures,
chạy lại trial ROLLBACK rồi apply riêng V451. Hậu kiểm hai target hashes/metadata đạt;
flags/binding identity/staff state/RLS policies/triggers/mọi function khác giữ nguyên.
[Postcheck](../../../migrations/snapshots/chat-canonical-identity/production-postcheck.sql)
kết thúc ROLLBACK, giữ guard login trùng và quyền private, không bật/tắt tài khoản thật.

## Hiệu năng và rollout

Hai lookup mới theo `auto_account_id` dùng UNIQUE index hiện có
`uq_chat_zalo_account_organization_auto_account`; join identity dùng PK
`chat_zalo_account_pkey`. Không thêm index, pool, connection source, polling hoặc
query trên đường xử lý từng tin nhắn. Chưa đo tải traffic dài hạn sau apply.

Đã apply riêng V451 theo chỉ thị người dùng; không chạy lại V449/V450 hoặc bulk push.
Hậu kiểm ledger/body/owner/ACL/config và hành vi đạt; không apply lại V451. Không cần build/deploy Desktop,
Server, Chat API/Web hay CRM cho bản SQL này. Không có `NOTIFY` reload chủ động;
vẫn giữ event trigger DDL đang có. Không tự bật Chat cho account 192 hay đổi binding 1159.
